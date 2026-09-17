const express = require('express');
const router = express.Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { encrypt, decrypt, sendMail, renderTemplate, createTransportFromSettings } = require('./mailer');
const { enqueueEmail } = require('./queue');
const { deleteReferencedUploadFiles, normalizeUploadPath } = require('./templateAssets');
const { normalizeRecipients } = require('./notificationRules');
const { getTrackingWindowStatus, injectTrackingIntoHtml, buildNewsletterExportLog } = require('./newsletterTracking');
const { getDailyReportSubject } = require('./daily-report-subject');

function ensureUploadDirectory(relativeSegments) {
  const targetDir = path.resolve(__dirname, '..', 'uploads', ...relativeSegments);
  fs.mkdirSync(targetDir, { recursive: true });
  return targetDir;
}

const DEFAULT_TEMPLATE_LIBRARY = {
  email: {
    name: 'Default email template',
    subject: 'Welcome {{user_name}}',
    body: '<p>Hello {{user_name}},</p><p>Thanks for joining {{site_name}}.</p>'
  },
  internal_message: {
    name: 'Default internal message template',
    subject: '{{site_name}} update for {{user_name}}',
    body: '<p>Hello {{user_name}},</p><p>Your account update is ready. Please review the latest status in your dashboard.</p>'
  }
};

const DEFAULT_TAX_MAIL_CONFIG = {
  smtp_settings: {},
  settings: {
    enable_reminders: true,
    reminder_interval_days: 7,
    reminder_subject: 'Tax Form Submission Reminder',
    enable_approval_notification: true,
    enable_rejection_notification: true,
    renewal_days_left: [200, 150, 100, 50, 30, 15, 10, 7, 5, 3, 2, 1],
    expired_reminder_interval_days: 15,
    monthly_unsubmitted_reminder_day: 9,
    monthly_unsubmitted_reminder_template: 'reminder'
  },
  templates: {
    reminder: {
      name: 'Tax Form Reminder',
      subject: 'Please Submit Your Tax Form',
      body: "Dear {{contributor_name}},\n\nThis is a friendly reminder that we haven't yet received your tax form.\n\nTo ensure timely payment processing, please submit your tax information as soon as possible by logging into your contributor account.\n\nIf you have already submitted your form, please disregard this message.\n\nBest regards,\nThe Team"
    },
    approved: {
      name: 'Tax Form Approved',
      subject: 'Your Tax Form Has Been Approved',
      body: 'Dear {{contributor_name}},\n\nGood news! Your tax form has been reviewed and approved.\n\nYou are now cleared for payment processing. Earnings will be processed according to our regular payment schedule.\n\nThank you for your contribution!\n\nBest regards,\nThe Team'
    },
    rejected: {
      name: 'Tax Form Requires Revision',
      subject: 'Action Required: Tax Form Revision',
      body: "Dear {{contributor_name}},\n\nWe've reviewed your tax form and need some additional information or corrections.\n\nPlease log into your account and resubmit your form with the necessary updates. Our support team is available if you have any questions.\n\nBest regards,\nThe Team"
    },
    expired: {
      name: 'Tax Form Expired',
      subject: 'Your Tax Form Expired on {{expiry_date}}',
      body: "Dear {{contributor_name}},\n\nYour tax form expired on {{expiry_date}} and payment processing has been paused until a new form is submitted.\n\nPlease log in to your contributor account and resubmit your tax information as soon as possible to avoid delays in future payouts.\n\nBest regards,\nThe Team"
    }
  }
};

const escapeTaxMailHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const renderTaxMailHtml = (subject, body, accentColor = '#0f766e', fontFamily = 'Georgia, serif', imageUrl = '') => {
  const safeAccent = /^#[0-9a-f]{6}$/i.test(String(accentColor)) ? accentColor : '#0f766e';
  const safeFont = ['Georgia, serif', 'Arial, sans-serif', 'Verdana, sans-serif'].includes(fontFamily) ? fontFamily : 'Georgia, serif';
  const safeImageUrl = /^(https?:\/\/|\/api\/files\/)/i.test(String(imageUrl)) ? escapeTaxMailHtml(imageUrl) : '';
  const bodyLines = String(body || '').split(/\r?\n/);
  const bodyHtml = bodyLines.map((line, index) => {
    const imageBeforeClosing = safeImageUrl && /best regards\s*,?/i.test(line) ? `<img src="${safeImageUrl}" alt="GFXunlimit Tax Services" style="display:block;width:100%;max-height:240px;object-fit:cover;margin:20px 0 24px;border-radius:10px" />` : '';
    const content = escapeTaxMailHtml(line)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/\[(.+?)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" style="color:' + safeAccent + ';font-weight:700">$1</a>');
    return `${imageBeforeClosing}${content.trim() ? `<p style="margin:0 0 14px">${content}</p>` : '<div style="height:6px"></div>'}`;
  }).join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f7f8;padding:32px 12px;font-family:${safeFont};color:#1f2937"><div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 12px 35px rgba(15,23,42,.12)"><div style="padding:28px 32px;background:linear-gradient(135deg,${safeAccent},#123c55);color:#ffffff"><div style="font:700 11px Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;opacity:.8">GFXunlimit Tax Services</div><h1 style="margin:10px 0 0;font:700 24px Arial,sans-serif">${escapeTaxMailHtml(subject)}</h1></div><div style="padding:32px;font-size:16px;line-height:1.65">${bodyHtml}</div><div style="margin:0 32px;padding:18px 0 26px;border-top:1px solid #e5e7eb;color:#64748b;font:12px Arial,sans-serif">This is an automated tax form notification from GFXunlimit.</div></div></body></html>`;
};

const NORMALIZED_TEMPLATE_VARIABLES = [
  '{{user_name}}',
  '{{user_email}}',
  '{{order_id}}',
  '{{asset_name}}',
  '{{asset_id}}',
  '{{amount}}',
  '{{currency}}',
  '{{download_url}}',
  '{{subscription_name}}',
  '{{expiry_date}}',
  '{{coupon_code}}',
  '{{site_name}}'
];

const normalizeTemplateType = (value) => {
  const normalized = String(value || 'email').trim().toLowerCase();
  return normalized === 'internal_message' || normalized === 'internal-message' || normalized === 'internal' ? 'internal_message' : 'email';
};

const ensureTemplateVariables = (value) => {
  const list = Array.isArray(value) ? value : [];
  const next = [];
  const seen = new Set();
  for (const item of list) {
    const cleaned = String(item || '').trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    next.push(cleaned);
  }
  for (const variable of NORMALIZED_TEMPLATE_VARIABLES) {
    if (!seen.has(variable)) next.push(variable);
  }
  return next;
};

const getDefaultTemplate = (templateType = 'email') => {
  const selected = DEFAULT_TEMPLATE_LIBRARY[normalizeTemplateType(templateType)] || DEFAULT_TEMPLATE_LIBRARY.email;
  return {
    name: selected.name,
    subject: selected.subject,
    body: selected.body,
    variables: [...NORMALIZED_TEMPLATE_VARIABLES],
    template_type: normalizeTemplateType(templateType),
    enabled: true,
    is_default: true
  };
};

const getCollectionAwareLiveAssetsQuery = () => `
  SELECT COUNT(*)::int AS live_assets
  FROM images i
  WHERE i.status ILIKE 'approved'
    AND (
      NOT EXISTS (
        SELECT 1
        FROM collections c
        WHERE TRIM(COALESCE(c.name, '')) <> ''
      )
      OR EXISTS (
        SELECT 1
        FROM collections c
        WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(i.collection))
      )
    )
`;

const normalizeAssetName = (value, fallback = 'Other / Unassigned') => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return fallback;

  const aliases = {
    other: 'Other / Unassigned',
    'other / unassigned': 'Other / Unassigned',
    unassigned: 'Other / Unassigned',
    photos: 'Photos',
    photo: 'Photos',
    psd: 'Psd',
    templates: 'Templates',
    template: 'Templates',
    vectors: 'Vectors',
    vector: 'Vectors',
    videos: 'Videos',
    video: 'Videos',
    commercial: 'Commercial',
    editorial: 'Editorial',
    abstract: 'Abstract',
    animals: 'Animals',
    arts: 'Arts',
    backgrounds: 'Backgrounds',
    beauty: 'Beauty',
    business: 'Business',
    celebrities: 'Celebrities',
    education: 'Education',
    fashion: 'Fashion',
    people: 'People',
    texture: 'Texture',
    '23': '23'
  };

  return aliases[String(raw).toLowerCase()] || raw;
};

const normalizeBreakdownList = (rows, preferredOrder = []) => {
  if (!Array.isArray(rows)) return [];

  const orderMap = preferredOrder.reduce((acc, name, index) => {
    acc[String(name).trim().toLowerCase()] = index;
    return acc;
  }, {});

  const grouped = new Map();
  rows.forEach((row) => {
    const name = normalizeAssetName(row?.name, 'Other / Unassigned');
    const count = Number(row?.asset_count ?? row?.count ?? 0);
    const key = String(name).trim().toLowerCase();
    if (!key) return;

    if (grouped.has(key)) {
      grouped.get(key).count += count;
    } else {
      grouped.set(key, { name, count });
    }
  });

  return Array.from(grouped.values())
    .filter((item) => item && item.name)
    .sort((a, b) => {
      const aOrder = orderMap[String(a.name).trim().toLowerCase()];
      const bOrder = orderMap[String(b.name).trim().toLowerCase()];
      if (aOrder !== undefined || bOrder !== undefined) {
        if (aOrder === undefined) return 1;
        if (bOrder === undefined) return -1;
        return aOrder - bOrder;
      }
      return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
    });
};

const normalizeRevenueBreakdownList = (rows, preferredOrder = []) => {
  if (!Array.isArray(rows)) return [];

  const orderMap = preferredOrder.reduce((acc, name, index) => {
    acc[String(name).trim().toLowerCase()] = index;
    return acc;
  }, {});

  const grouped = new Map();
  rows.forEach((row) => {
    const name = String(row?.name || 'Other / Unassigned').trim() || 'Other / Unassigned';
    const value = Number(row?.total_value ?? row?.amount ?? row?.sum ?? row?.count ?? row?.asset_count ?? 0);
    const key = String(name).trim().toLowerCase();
    if (!key) return;

    if (grouped.has(key)) {
      grouped.get(key).count += value;
    } else {
      grouped.set(key, { name, count: value });
    }
  });

  return Array.from(grouped.values())
    .filter((item) => item && item.name)
    .sort((a, b) => {
      const aOrder = orderMap[String(a.name).trim().toLowerCase()];
      const bOrder = orderMap[String(b.name).trim().toLowerCase()];
      if (aOrder !== undefined || bOrder !== undefined) {
        if (aOrder === undefined) return 1;
        if (bOrder === undefined) return -1;
        return aOrder - bOrder;
      }
      return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
    });
};

const normalizeCurrencyValueBreakdowns = (breakdown, preferredCurrencies = []) => {
  const currencyOrder = new Map(preferredCurrencies.map((currency, index) => [currency, index]));
  const grouped = new Map();

  Object.entries(breakdown || {}).forEach(([groupKey, rows]) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const currency = String(row?.currency || 'USD').trim().toUpperCase();
      if (!grouped.has(currency)) {
        grouped.set(currency, { currency, collections: [], categories: [], type: [] });
      }
      const targetKey = groupKey === 'collection' ? 'collections' : groupKey === 'category' ? 'categories' : 'type';
      grouped.get(currency)[targetKey].push({
        name: row?.name || 'Other / Unassigned',
        count: Number(row?.total_value || 0),
        currency
      });
    });
  });

  return Array.from(grouped.values()).sort((a, b) => {
    const aOrder = currencyOrder.get(a.currency);
    const bOrder = currencyOrder.get(b.currency);
    if (aOrder !== undefined || bOrder !== undefined) {
      if (aOrder === undefined) return 1;
      if (bOrder === undefined) return -1;
      return aOrder - bOrder;
    }
    return a.currency.localeCompare(b.currency);
  });
};

const addCurrencyTotals = (breakdown, currencyRows = []) => {
  const totals = new Map(currencyRows.map((row) => [String(row.currency || 'USD').toUpperCase(), Number(row.total_value || 0)]));
  return breakdown.map((item) => ({ ...item, name: item.currency, total: totals.get(item.currency) || 0 }));
};

const isCollectionAwareLiveAsset = (image, availableCollections = []) => {
  const status = String(image?.status || '').trim().toLowerCase();
  const isLiveStatus = ['approved', 'published', 'live'].includes(status);
  const collectionName = String(image?.collection || '').trim();

  if (!isLiveStatus) return false;
  if (!Array.isArray(availableCollections) || availableCollections.length === 0) return true;

  return availableCollections.some((name) => String(name || '').trim().toLowerCase() === collectionName.toLowerCase());
};

const getDownloadBreakdownWindow = async (poolRef, intervalExpression) => {
  const [collectionRes, categoryRes, typeRes] = await Promise.all([
    poolRef.query(`
      SELECT COALESCE(NULLIF(TRIM(i.collection), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count
      FROM downloads d LEFT JOIN images i ON i.id = d.image_id
      WHERE d.downloaded_at >= NOW() - INTERVAL '${intervalExpression}'
      GROUP BY 1 ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(i.category, ''), ',', 1)), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count
      FROM downloads d LEFT JOIN images i ON i.id = d.image_id
      WHERE d.downloaded_at >= NOW() - INTERVAL '${intervalExpression}'
      GROUP BY 1 ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(INITCAP(TRIM(i.type)), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count
      FROM downloads d LEFT JOIN images i ON i.id = d.image_id
      WHERE d.downloaded_at >= NOW() - INTERVAL '${intervalExpression}'
      GROUP BY 1 ORDER BY name
    `)
  ]);

  return {
    collection: collectionRes.rows,
    category: categoryRes.rows,
    type: typeRes.rows
  };
};

const getOrderBreakdown = async (poolRef, statusColumn, statusValue = null, oneItemPerOrder = false) => {
  const statusFilter = statusValue === 'successful'
    ? `WHERE LOWER(COALESCE(o.${statusColumn}, '')) IN ('completed', 'paid', 'success', 'successful')`
    : statusValue
      ? `WHERE LOWER(COALESCE(o.${statusColumn}, '')) = '${statusValue}'`
      : '';
  const itemJoin = oneItemPerOrder
    ? 'LEFT JOIN LATERAL (SELECT oi.* FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id, oi.asset_id LIMIT 1) oi ON TRUE'
    : 'LEFT JOIN order_items oi ON oi.order_id = o.id';
  const [collectionRes, categoryRes, typeRes] = await Promise.all([
    poolRef.query(`
      SELECT COALESCE(NULLIF(TRIM(i.collection), ''), 'Other / Unassigned') AS name,
             COUNT(DISTINCT o.id)::int AS asset_count
      FROM orders o
      ${itemJoin}
      LEFT JOIN images i ON i.id = oi.asset_id
      ${statusFilter}
      GROUP BY 1 ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(oi.category, i.category, ''), ',', 1)), ''), 'Other / Unassigned') AS name,
             COUNT(DISTINCT o.id)::int AS asset_count
      FROM orders o
      ${itemJoin}
      LEFT JOIN images i ON i.id = oi.asset_id
      ${statusFilter}
      GROUP BY 1 ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(INITCAP(TRIM(i.type)), ''), 'Other / Unassigned') AS name,
             COUNT(DISTINCT o.id)::int AS asset_count
      FROM orders o
      ${itemJoin}
      LEFT JOIN images i ON i.id = oi.asset_id
      ${statusFilter}
      GROUP BY 1 ORDER BY name
    `)
  ]);

  return { collection: collectionRes.rows, category: categoryRes.rows, type: typeRes.rows };
};

const getOrderValueBreakdown = async (poolRef, statusColumn, statusValue = null, groupByCurrency = false) => {
  const statusFilter = statusValue ? `WHERE LOWER(COALESCE(o.${statusColumn}, '')) = '${statusValue}'` : '';
  const valueExpression = 'COALESCE(oi.total_price, oi.unit_price * oi.quantity, o.total_amount)';
  const currencyExpression = "UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD'))";
  const selectCurrency = groupByCurrency ? `${currencyExpression} AS currency,` : '';
  const groupBy = groupByCurrency ? '1, 2' : '1';
  const [collectionRes, categoryRes, typeRes] = await Promise.all([
    poolRef.query(`
      SELECT ${selectCurrency} COALESCE(NULLIF(TRIM(i.collection), ''), 'Other / Unassigned') AS name,
             COALESCE(SUM(${valueExpression}), 0)::numeric AS total_value
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN images i ON i.id = oi.asset_id
      ${statusFilter}
      GROUP BY ${groupBy} ORDER BY name
    `),
    poolRef.query(`
      SELECT ${selectCurrency} COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(oi.category, i.category, ''), ',', 1)), ''), 'Other / Unassigned') AS name,
             COALESCE(SUM(${valueExpression}), 0)::numeric AS total_value
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN images i ON i.id = oi.asset_id
      ${statusFilter}
      GROUP BY ${groupBy} ORDER BY name
    `),
    poolRef.query(`
      SELECT ${selectCurrency} COALESCE(NULLIF(INITCAP(TRIM(i.type)), ''), 'Other / Unassigned') AS name,
             COALESCE(SUM(${valueExpression}), 0)::numeric AS total_value
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN images i ON i.id = oi.asset_id
      ${statusFilter}
      GROUP BY ${groupBy} ORDER BY name
    `)
  ]);

  return { collection: collectionRes.rows, category: categoryRes.rows, type: typeRes.rows };
};

const getFinancialBreakdownWindow = async (poolRef, dateClause) => {
  const valueQueries = {
    revenue: 'COALESCE(o.subtotal, 0) + COALESCE(o.tax, 0)',
    discount: 'COALESCE(o.discount, 0)',
    earnings: 'COALESCE(o.total_amount, 0)'
  };
  const rowsFor = (valueExpression, dimension) => poolRef.query(`
    SELECT UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD')) AS currency,
           ${dimension}, COALESCE(SUM(${valueExpression}), 0)::numeric AS total_value
    FROM orders o
    LEFT JOIN LATERAL (SELECT oi.* FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id, oi.asset_id LIMIT 1) oi ON TRUE
    LEFT JOIN images i ON i.id = oi.asset_id
    WHERE LOWER(COALESCE(o.payment_status, '')) IN ('completed', 'paid') AND ${dateClause}
    GROUP BY 1, 2 ORDER BY currency, name
  `);
  const totalsFor = (valueExpression) => poolRef.query(`
    SELECT UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD')) AS currency,
           COALESCE(SUM(${valueExpression}), 0)::numeric AS total_value
    FROM orders o
    WHERE LOWER(COALESCE(o.payment_status, '')) IN ('completed', 'paid') AND ${dateClause}
    GROUP BY 1 ORDER BY currency
  `);
  const dimensions = {
    collection: "COALESCE(NULLIF(TRIM(i.collection), ''), 'Other / Unassigned') AS name",
    category: "COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(oi.category, i.category, ''), ',', 1)), ''), 'Other / Unassigned') AS name",
    type: "COALESCE(NULLIF(INITCAP(TRIM(i.type)), ''), 'Other / Unassigned') AS name"
  };
  const groups = await Promise.all(Object.entries(valueQueries).map(async ([metric, expression]) => {
    const [totals, collection, category, type] = await Promise.all([
      totalsFor(expression),
      rowsFor(expression, dimensions.collection),
      rowsFor(expression, dimensions.category),
      rowsFor(expression, dimensions.type)
    ]);
    const result = totals.rows.map((row) => ({ currency: String(row.currency || 'USD').toUpperCase(), total: Number(row.total_value || 0), collections: [], categories: [], type: [] }));
    const assign = (rows, key) => rows.forEach((row) => {
      const currency = String(row.currency || 'USD').toUpperCase();
      const target = result.find((item) => item.currency === currency);
      if (target && Number(row.total_value || 0) !== 0) target[key].push({ name: row.name, count: Number(row.total_value || 0) });
    });
    assign(collection.rows, 'collections'); assign(category.rows, 'categories'); assign(type.rows, 'type');
    return [metric, result.filter((item) => item.total !== 0)];
  }));
  return Object.fromEntries(groups);
};

const buildDailyWebsiteSummary = async ({ poolRef = pool } = {}) => {
  const [usersRes, contributorsRes, customersRes, adminsRes, pendingUsersRes, blockedUsersRes, activeContributorsRes, inactiveContributorsRes, pendingContributorsRes, blockedContributorsRes, deletedContributorsRes, activeCustomersRes, inactiveCustomersRes, pendingCustomersRes, blockedCustomersRes, deletedCustomersRes, totalAssetsRes, liveAssetsRes, collectionLiveAssetsRes, categoryLiveAssetsRes, typeLiveAssetsRes, pendingAssetsRes, collectionPendingAssetsRes, categoryPendingAssetsRes, typePendingAssetsRes, rejectedAssetsRes, collectionRejectedAssetsRes, categoryRejectedAssetsRes, typeRejectedAssetsRes, deletedAssetsRes, collectionDeletedAssetsRes, categoryDeletedAssetsRes, typeDeletedAssetsRes, ordersRes, revenueRes, discountRes, earningsRes, currencyRevenueBreakdownRes, collectionRevenueBreakdownRes, categoryRevenueBreakdownRes, typeRevenueBreakdownRes, downloadsRes, downloadCollectionRes, downloadCategoryRes, downloadTypeRes, last24HoursDownloadsRes, last24HourCollectionDownloadsRes, last24HourCategoryDownloadsRes, last24HourTypeDownloadsRes, last7DaysDownloadsRes, last30DaysDownloadsRes, last365DaysDownloadsRes, currentMonthDownloadsRes, currentFyDownloadsRes, pricingRes] = await Promise.all([
    poolRef.query("SELECT COUNT(*)::int AS total_users FROM users"),
    poolRef.query("SELECT COUNT(*)::int AS total_contributors FROM users WHERE role = 'contributor'"),
    poolRef.query("SELECT COUNT(*)::int AS total_customers FROM users WHERE role = 'customer'"),
    poolRef.query("SELECT COUNT(*)::int AS total_admins FROM users WHERE role = 'admin'"),
    poolRef.query("SELECT COUNT(*)::int AS pending_users FROM users WHERE status ILIKE 'pending'"),
    poolRef.query("SELECT COUNT(*)::int AS blocked_users FROM users WHERE status ILIKE 'blocked'"),
    poolRef.query("SELECT COUNT(*)::int AS active_contributors FROM users WHERE role ILIKE 'contributor' AND status ILIKE 'active'"),
    poolRef.query("SELECT COUNT(*)::int AS inactive_contributors FROM users WHERE role ILIKE 'contributor' AND status ILIKE 'inactive'"),
    poolRef.query("SELECT COUNT(*)::int AS pending_contributors FROM users WHERE role ILIKE 'contributor' AND status ILIKE 'pending'"),
    poolRef.query("SELECT COUNT(*)::int AS blocked_contributors FROM users WHERE role ILIKE 'contributor' AND status ILIKE 'blocked'"),
    poolRef.query("SELECT COUNT(*)::int AS deleted_contributors FROM activity_events WHERE event_type = 'ACCOUNT_STATUS_CHANGED' AND user_role ILIKE 'contributor' AND created_at >= NOW() - INTERVAL '30 days' AND (metadata->>'new_status' ILIKE 'deleted' OR metadata->>'action' ILIKE 'delete')"),
    poolRef.query("SELECT COUNT(*)::int AS active_customers FROM users WHERE role ILIKE 'customer' AND status ILIKE 'active'"),
    poolRef.query("SELECT COUNT(*)::int AS inactive_customers FROM users WHERE role ILIKE 'customer' AND status ILIKE 'inactive'"),
    poolRef.query("SELECT COUNT(*)::int AS pending_customers FROM users WHERE role ILIKE 'customer' AND status ILIKE 'pending'"),
    poolRef.query("SELECT COUNT(*)::int AS blocked_customers FROM users WHERE role ILIKE 'customer' AND status ILIKE 'blocked'"),
    poolRef.query("SELECT COUNT(*)::int AS deleted_customers FROM activity_events WHERE event_type = 'ACCOUNT_STATUS_CHANGED' AND user_role ILIKE 'customer' AND created_at >= NOW() - INTERVAL '30 days' AND (metadata->>'new_status' ILIKE 'deleted' OR metadata->>'action' ILIKE 'delete')"),
    poolRef.query("SELECT COUNT(*)::int AS total_assets FROM images"),
    poolRef.query(getCollectionAwareLiveAssetsQuery()),
    poolRef.query(`
      SELECT c.name, COUNT(i.id)::int AS asset_count
      FROM collections c
      LEFT JOIN images i
        ON LOWER(TRIM(COALESCE(i.collection, ''))) = LOWER(TRIM(c.name))
       AND i.status ILIKE 'approved'
      GROUP BY c.id, c.name
      ORDER BY c.name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(category, ''), ',', 1)), ''), 'Other / Unassigned') AS name,
             COUNT(*)::int AS asset_count
      FROM images
      WHERE status ILIKE 'approved'
        AND (
          NOT EXISTS (
            SELECT 1
            FROM collections c
            WHERE TRIM(COALESCE(c.name, '')) <> ''
          )
          OR EXISTS (
            SELECT 1
            FROM collections c
            WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(images.collection))
          )
        )
      GROUP BY 1
      ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(INITCAP(TRIM(type)), ''), 'Other / Unassigned') AS name,
             COUNT(*)::int AS asset_count
      FROM images
      WHERE status ILIKE 'approved'
        AND (
          NOT EXISTS (
            SELECT 1
            FROM collections c
            WHERE TRIM(COALESCE(c.name, '')) <> ''
          )
          OR EXISTS (
            SELECT 1
            FROM collections c
            WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(images.collection))
          )
        )
      GROUP BY 1
      ORDER BY name
    `),
    poolRef.query("SELECT COUNT(*)::int AS pending_assets FROM images WHERE status ILIKE 'pending'"),
    poolRef.query(`
      SELECT c.name, COUNT(i.id)::int AS asset_count
      FROM collections c
      LEFT JOIN images i
        ON LOWER(TRIM(COALESCE(i.collection, ''))) = LOWER(TRIM(c.name))
       AND i.status ILIKE 'pending'
      GROUP BY c.id, c.name
      ORDER BY c.name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(category, ''), ',', 1)), ''), 'Other / Unassigned') AS name,
             COUNT(*)::int AS asset_count
      FROM images
      WHERE status ILIKE 'pending'
      GROUP BY 1
      ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(INITCAP(TRIM(type)), ''), 'Other / Unassigned') AS name,
             COUNT(*)::int AS asset_count
      FROM images
      WHERE status ILIKE 'pending'
      GROUP BY 1
      ORDER BY name
    `),
    poolRef.query("SELECT COUNT(*)::int AS rejected_assets FROM images WHERE status ILIKE 'rejected'"),
    poolRef.query(`
      SELECT COALESCE(c.name, 'Other / Unassigned') AS name,
             COUNT(i.id)::int AS asset_count
      FROM images i
      LEFT JOIN collections c
        ON LOWER(TRIM(COALESCE(i.collection, ''))) = LOWER(TRIM(c.name))
      WHERE i.status ILIKE 'rejected'
      GROUP BY c.id, c.name
      ORDER BY c.name NULLS LAST
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(category, ''), ',', 1)), ''), 'Other / Unassigned') AS name,
             COUNT(*)::int AS asset_count
      FROM images
      WHERE status ILIKE 'rejected'
      GROUP BY 1
      ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(INITCAP(TRIM(type)), ''), 'Other / Unassigned') AS name,
             COUNT(*)::int AS asset_count
      FROM images
      WHERE status ILIKE 'rejected'
      GROUP BY 1
      ORDER BY name
    `),
    poolRef.query("SELECT COUNT(*)::int AS deleted_assets_last_30_days FROM activity_events WHERE event_type = 'ASSET_DELETED' AND created_at >= NOW() - INTERVAL '30 days'"),
    poolRef.query(`
      SELECT c.name,
             COUNT(a.id)::int AS asset_count
      FROM collections c
      LEFT JOIN activity_events a
        ON a.event_type = 'ASSET_DELETED'
       AND a.created_at >= NOW() - INTERVAL '30 days'
       AND LOWER(TRIM(COALESCE(a.metadata->>'collection', a.metadata->>'collection_name', ''))) = LOWER(TRIM(c.name))
      GROUP BY c.id, c.name
      UNION ALL
      SELECT 'Other / Unassigned' AS name,
             COUNT(*)::int AS asset_count
      FROM activity_events a
      WHERE a.event_type = 'ASSET_DELETED'
        AND a.created_at >= NOW() - INTERVAL '30 days'
        AND NOT EXISTS (
          SELECT 1
          FROM collections c
          WHERE LOWER(TRIM(COALESCE(a.metadata->>'collection', a.metadata->>'collection_name', ''))) = LOWER(TRIM(c.name))
        )
      ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(metadata->>'category', ''), NULLIF(metadata->>'category_primary', ''), 'Other / Unassigned') AS name,
             COUNT(*)::int AS asset_count
      FROM activity_events
      WHERE event_type = 'ASSET_DELETED'
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1
      ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(INITCAP(metadata->>'type'), ''), 'Other / Unassigned') AS name,
             COUNT(*)::int AS asset_count
      FROM activity_events
      WHERE event_type = 'ASSET_DELETED'
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1
      ORDER BY name
    `),
    poolRef.query("SELECT COUNT(*)::int AS total_orders FROM orders"),
    poolRef.query("SELECT COALESCE(SUM(CASE WHEN LOWER(COALESCE(payment_status, '')) IN ('completed', 'paid') THEN COALESCE(subtotal, 0) + COALESCE(tax, 0) ELSE 0 END), 0)::numeric AS total_revenue FROM orders"),
    poolRef.query("SELECT COALESCE(SUM(CASE WHEN LOWER(COALESCE(payment_status, '')) IN ('completed', 'paid') THEN discount ELSE 0 END), 0)::numeric AS total_discount FROM orders"),
    poolRef.query("SELECT COALESCE(SUM(CASE WHEN LOWER(COALESCE(payment_status, '')) IN ('completed', 'paid') THEN total_amount ELSE 0 END), 0)::numeric AS total_earnings FROM orders"),
    poolRef.query("SELECT UPPER(COALESCE(NULLIF(TRIM(currency), ''), 'USD')) AS name, COALESCE(SUM(COALESCE(subtotal, 0) + COALESCE(tax, 0)), 0)::numeric AS total_value FROM orders WHERE LOWER(COALESCE(payment_status, '')) IN ('completed', 'paid') GROUP BY 1 ORDER BY CASE UPPER(COALESCE(NULLIF(TRIM(currency), ''), 'USD')) WHEN 'INR' THEN 0 WHEN 'USD' THEN 1 WHEN 'EUR' THEN 2 ELSE 3 END, 1"),
    poolRef.query(`
            SELECT UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD')) AS currency,
              COALESCE(NULLIF(TRIM(i.collection), ''), 'Other / Unassigned') AS name,
              COALESCE(SUM(COALESCE(o.subtotal, 0) + COALESCE(o.tax, 0)), 0)::numeric AS total_value
      FROM orders o
            LEFT JOIN LATERAL (SELECT oi.* FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id, oi.asset_id LIMIT 1) oi ON TRUE
      LEFT JOIN images i ON i.id = oi.asset_id
      WHERE LOWER(COALESCE(o.payment_status, '')) IN ('completed', 'paid')
      GROUP BY 1, 2 ORDER BY currency, name
    `),
    poolRef.query(`
            SELECT UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD')) AS currency,
              COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(oi.category, i.category, ''), ',', 1)), ''), 'Other / Unassigned') AS name,
              COALESCE(SUM(COALESCE(o.subtotal, 0) + COALESCE(o.tax, 0)), 0)::numeric AS total_value
      FROM orders o
            LEFT JOIN LATERAL (SELECT oi.* FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id, oi.asset_id LIMIT 1) oi ON TRUE
      LEFT JOIN images i ON i.id = oi.asset_id
      WHERE LOWER(COALESCE(o.payment_status, '')) IN ('completed', 'paid')
      GROUP BY 1, 2 ORDER BY currency, name
    `),
    poolRef.query(`
            SELECT UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD')) AS currency,
              COALESCE(NULLIF(INITCAP(TRIM(i.type)), ''), 'Other / Unassigned') AS name,
              COALESCE(SUM(COALESCE(o.subtotal, 0) + COALESCE(o.tax, 0)), 0)::numeric AS total_value
      FROM orders o
            LEFT JOIN LATERAL (SELECT oi.* FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id, oi.asset_id LIMIT 1) oi ON TRUE
      LEFT JOIN images i ON i.id = oi.asset_id
      WHERE LOWER(COALESCE(o.payment_status, '')) IN ('completed', 'paid')
      GROUP BY 1, 2 ORDER BY currency, name
    `),
    poolRef.query("SELECT COUNT(*)::int AS total_downloads FROM downloads"),
    poolRef.query(`
      SELECT COALESCE(NULLIF(TRIM(i.collection), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count
      FROM downloads d LEFT JOIN images i ON i.id = d.image_id
      GROUP BY 1 ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(i.category, ''), ',', 1)), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count
      FROM downloads d LEFT JOIN images i ON i.id = d.image_id
      GROUP BY 1 ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(INITCAP(TRIM(i.type)), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count
      FROM downloads d LEFT JOIN images i ON i.id = d.image_id
      GROUP BY 1 ORDER BY name
    `),
    poolRef.query("SELECT COUNT(*)::int AS download_count FROM downloads WHERE downloaded_at >= NOW() - INTERVAL '24 hours'"),
    poolRef.query(`
      SELECT COALESCE(NULLIF(TRIM(i.collection), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count
      FROM downloads d LEFT JOIN images i ON i.id = d.image_id
      WHERE d.downloaded_at >= NOW() - INTERVAL '24 hours'
      GROUP BY 1 ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(i.category, ''), ',', 1)), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count
      FROM downloads d LEFT JOIN images i ON i.id = d.image_id
      WHERE d.downloaded_at >= NOW() - INTERVAL '24 hours'
      GROUP BY 1 ORDER BY name
    `),
    poolRef.query(`
      SELECT COALESCE(NULLIF(INITCAP(TRIM(i.type)), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count
      FROM downloads d LEFT JOIN images i ON i.id = d.image_id
      WHERE d.downloaded_at >= NOW() - INTERVAL '24 hours'
      GROUP BY 1 ORDER BY name
    `),
    poolRef.query("SELECT COUNT(*)::int AS download_count FROM downloads WHERE downloaded_at >= NOW() - INTERVAL '7 days'"),
    poolRef.query("SELECT COUNT(*)::int AS download_count FROM downloads WHERE downloaded_at >= NOW() - INTERVAL '30 days'"),
    poolRef.query("SELECT COUNT(*)::int AS download_count FROM downloads WHERE downloaded_at >= NOW() - INTERVAL '365 days'"),
    poolRef.query("SELECT COUNT(*)::int AS download_count FROM downloads WHERE downloaded_at >= date_trunc('month', NOW()) AND downloaded_at < date_trunc('month', NOW()) + INTERVAL '1 month'"),
    poolRef.query(`SELECT COUNT(*)::int AS download_count FROM downloads WHERE downloaded_at >= CASE
      WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN make_date(EXTRACT(YEAR FROM NOW())::int, 4, 1)
      ELSE make_date(EXTRACT(YEAR FROM NOW())::int - 1, 4, 1)
    END
    AND downloaded_at < CASE
      WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN make_date(EXTRACT(YEAR FROM NOW())::int + 1, 4, 1)
      ELSE make_date(EXTRACT(YEAR FROM NOW())::int, 4, 1)
    END`),
    poolRef.query("SELECT exchange_rate FROM pricing_settings ORDER BY id DESC LIMIT 1")
  ]);

  const [last7DaysBreakdown, last30DaysBreakdown, last365DaysBreakdown, currentMonthBreakdown, currentFyBreakdown] = await Promise.all([
    getDownloadBreakdownWindow(poolRef, '7 days'),
    getDownloadBreakdownWindow(poolRef, '30 days'),
    getDownloadBreakdownWindow(poolRef, '365 days'),
    Promise.all([
      poolRef.query("SELECT COALESCE(NULLIF(TRIM(i.collection), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count FROM downloads d LEFT JOIN images i ON i.id = d.image_id WHERE d.downloaded_at >= date_trunc('month', NOW()) AND d.downloaded_at < date_trunc('month', NOW()) + INTERVAL '1 month' GROUP BY 1 ORDER BY name"),
      poolRef.query("SELECT COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(i.category, ''), ',', 1)), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count FROM downloads d LEFT JOIN images i ON i.id = d.image_id WHERE d.downloaded_at >= date_trunc('month', NOW()) AND d.downloaded_at < date_trunc('month', NOW()) + INTERVAL '1 month' GROUP BY 1 ORDER BY name"),
      poolRef.query("SELECT COALESCE(NULLIF(INITCAP(TRIM(i.type)), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count FROM downloads d LEFT JOIN images i ON i.id = d.image_id WHERE d.downloaded_at >= date_trunc('month', NOW()) AND d.downloaded_at < date_trunc('month', NOW()) + INTERVAL '1 month' GROUP BY 1 ORDER BY name")
    ]).then(([collection, category, type]) => ({ collection: collection.rows, category: category.rows, type: type.rows })),
    Promise.all([
      poolRef.query("SELECT COALESCE(NULLIF(TRIM(i.collection), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count FROM downloads d LEFT JOIN images i ON i.id = d.image_id WHERE d.downloaded_at >= CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN make_date(EXTRACT(YEAR FROM NOW())::int, 4, 1) ELSE make_date(EXTRACT(YEAR FROM NOW())::int - 1, 4, 1) END AND d.downloaded_at < CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN make_date(EXTRACT(YEAR FROM NOW())::int + 1, 4, 1) ELSE make_date(EXTRACT(YEAR FROM NOW())::int, 4, 1) END GROUP BY 1 ORDER BY name"),
      poolRef.query("SELECT COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(i.category, ''), ',', 1)), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count FROM downloads d LEFT JOIN images i ON i.id = d.image_id WHERE d.downloaded_at >= CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN make_date(EXTRACT(YEAR FROM NOW())::int, 4, 1) ELSE make_date(EXTRACT(YEAR FROM NOW())::int - 1, 4, 1) END AND d.downloaded_at < CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN make_date(EXTRACT(YEAR FROM NOW())::int + 1, 4, 1) ELSE make_date(EXTRACT(YEAR FROM NOW())::int, 4, 1) END GROUP BY 1 ORDER BY name"),
      poolRef.query("SELECT COALESCE(NULLIF(INITCAP(TRIM(i.type)), ''), 'Other / Unassigned') AS name, COUNT(*)::int AS asset_count FROM downloads d LEFT JOIN images i ON i.id = d.image_id WHERE d.downloaded_at >= CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN make_date(EXTRACT(YEAR FROM NOW())::int, 4, 1) ELSE make_date(EXTRACT(YEAR FROM NOW())::int - 1, 4, 1) END AND d.downloaded_at < CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN make_date(EXTRACT(YEAR FROM NOW())::int + 1, 4, 1) ELSE make_date(EXTRACT(YEAR FROM NOW())::int, 4, 1) END GROUP BY 1 ORDER BY name")
    ]).then(([collection, category, type]) => ({ collection: collection.rows, category: category.rows, type: type.rows }))
  ]);

  const financialWindows = await Promise.all([
    getFinancialBreakdownWindow(poolRef, "o.created_at >= NOW() - INTERVAL '7 days'"),
    getFinancialBreakdownWindow(poolRef, "o.created_at >= NOW() - INTERVAL '30 days'"),
    getFinancialBreakdownWindow(poolRef, "o.created_at >= date_trunc('month', NOW())"),
    getFinancialBreakdownWindow(poolRef, "o.created_at >= CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN make_date(EXTRACT(YEAR FROM NOW())::int, 4, 1) ELSE make_date(EXTRACT(YEAR FROM NOW())::int - 1, 4, 1) END"),
    getFinancialBreakdownWindow(poolRef, "o.created_at >= NOW() - INTERVAL '365 days'")
  ]);

  const [totalOrdersBreakdown, failedOrdersBreakdown, paymentFailedCountBreakdown, paymentFailedValueBreakdown] = await Promise.all([
    getOrderBreakdown(poolRef, 'payment_status', 'successful', true),
    getOrderBreakdown(poolRef, 'order_status', 'failed'),
    getOrderBreakdown(poolRef, 'payment_status', 'failed'),
    getOrderValueBreakdown(poolRef, 'payment_status', 'failed', true)
  ]);

  const totalRevenueUsd = Number(revenueRes.rows[0]?.total_revenue || 0);
  const totalDiscountUsd = Number(discountRes.rows[0]?.total_discount || 0);
  const totalEarningsUsd = Number(earningsRes.rows[0]?.total_earnings || 0);
  const exchangeRate = Number(pricingRes.rows[0]?.exchange_rate || 83);
  const totalRevenueInr = totalRevenueUsd * exchangeRate;
  const totalDiscountInr = totalDiscountUsd * exchangeRate;
  const totalEarningsInr = totalEarningsUsd * exchangeRate;
  const paymentFailedCurrencyRows = (await poolRef.query("SELECT UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD')) AS currency, COALESCE(SUM(COALESCE(oi.total_price, oi.unit_price * oi.quantity, o.total_amount)), 0)::numeric AS total_value FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id WHERE LOWER(COALESCE(o.payment_status, '')) = 'failed' GROUP BY 1")).rows;
  const paymentFailedValueInr = paymentFailedCurrencyRows.reduce((total, row) => {
    const value = Number(row.total_value || 0);
    return total + (row.currency === 'INR' ? value : value * exchangeRate);
  }, 0);
  const paymentFailedCurrencyBreakdown = addCurrencyTotals(
    normalizeCurrencyValueBreakdowns(paymentFailedValueBreakdown, ['INR', 'USD', 'EUR']),
    paymentFailedCurrencyRows
  );
  const discountCurrencyRows = (await poolRef.query("SELECT UPPER(COALESCE(NULLIF(TRIM(currency), ''), 'USD')) AS currency, COALESCE(SUM(discount), 0)::numeric AS total_value FROM orders WHERE LOWER(COALESCE(payment_status, '')) IN ('completed', 'paid') GROUP BY 1 ORDER BY CASE UPPER(COALESCE(NULLIF(TRIM(currency), ''), 'USD')) WHEN 'INR' THEN 0 WHEN 'USD' THEN 1 WHEN 'EUR' THEN 2 ELSE 3 END, 1")).rows;
  const discountCouponRows = (await poolRef.query("SELECT UPPER(COALESCE(NULLIF(TRIM(currency), ''), 'USD')) AS currency, COALESCE(NULLIF(TRIM(coupon_code), ''), 'No Coupon') AS name, COALESCE(SUM(discount), 0)::numeric AS total_value FROM orders WHERE LOWER(COALESCE(payment_status, '')) IN ('completed', 'paid') GROUP BY 1, 2 ORDER BY currency, name")).rows;
  const discountCollectionRows = (await poolRef.query("SELECT UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD')) AS currency, COALESCE(NULLIF(TRIM(i.collection), ''), 'Other / Unassigned') AS name, COALESCE(SUM(o.discount), 0)::numeric AS total_value FROM orders o LEFT JOIN LATERAL (SELECT oi.* FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id, oi.asset_id LIMIT 1) oi ON TRUE LEFT JOIN images i ON i.id = oi.asset_id WHERE LOWER(COALESCE(o.payment_status, '')) IN ('completed', 'paid') GROUP BY 1, 2 ORDER BY currency, name")).rows;
  const discountCategoryRows = (await poolRef.query("SELECT UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD')) AS currency, COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(oi.category, i.category, ''), ',', 1)), ''), 'Other / Unassigned') AS name, COALESCE(SUM(o.discount), 0)::numeric AS total_value FROM orders o LEFT JOIN LATERAL (SELECT oi.* FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id, oi.asset_id LIMIT 1) oi ON TRUE LEFT JOIN images i ON i.id = oi.asset_id WHERE LOWER(COALESCE(o.payment_status, '')) IN ('completed', 'paid') GROUP BY 1, 2 ORDER BY currency, name")).rows;
  const discountTypeRows = (await poolRef.query("SELECT UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD')) AS currency, COALESCE(NULLIF(INITCAP(TRIM(i.type)), ''), 'Other / Unassigned') AS name, COALESCE(SUM(o.discount), 0)::numeric AS total_value FROM orders o LEFT JOIN LATERAL (SELECT oi.* FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id, oi.asset_id LIMIT 1) oi ON TRUE LEFT JOIN images i ON i.id = oi.asset_id WHERE LOWER(COALESCE(o.payment_status, '')) IN ('completed', 'paid') GROUP BY 1, 2 ORDER BY currency, name")).rows;
  const discountCurrencyBreakdown = discountCurrencyRows.map((currencyRow) => ({
    currency: currencyRow.currency,
    total: Number(currencyRow.total_value || 0),
    coupons: discountCouponRows.filter((couponRow) => couponRow.currency === currencyRow.currency && Number(couponRow.total_value || 0) !== 0).map((couponRow) => ({ name: couponRow.name, count: Number(couponRow.total_value || 0) })),
    collections: discountCollectionRows.filter((row) => row.currency === currencyRow.currency && Number(row.total_value || 0) !== 0).map((row) => ({ name: row.name, count: Number(row.total_value || 0) })),
    categories: discountCategoryRows.filter((row) => row.currency === currencyRow.currency && Number(row.total_value || 0) !== 0).map((row) => ({ name: row.name, count: Number(row.total_value || 0) })),
    type: discountTypeRows.filter((row) => row.currency === currencyRow.currency && Number(row.total_value || 0) !== 0).map((row) => ({ name: row.name, count: Number(row.total_value || 0) }))
  })).filter((currencyRow) => currencyRow.total !== 0);
  const earningsCurrencyRows = (await poolRef.query("SELECT UPPER(COALESCE(NULLIF(TRIM(currency), ''), 'USD')) AS currency, COALESCE(SUM(total_amount), 0)::numeric AS total_value FROM orders WHERE LOWER(COALESCE(payment_status, '')) IN ('completed', 'paid') GROUP BY 1 ORDER BY CASE UPPER(COALESCE(NULLIF(TRIM(currency), ''), 'USD')) WHEN 'INR' THEN 0 WHEN 'USD' THEN 1 WHEN 'EUR' THEN 2 ELSE 3 END, 1")).rows;
  const earningsCollectionRows = (await poolRef.query("SELECT UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD')) AS currency, COALESCE(NULLIF(TRIM(i.collection), ''), 'Other / Unassigned') AS name, COALESCE(SUM(o.total_amount), 0)::numeric AS total_value FROM orders o LEFT JOIN LATERAL (SELECT oi.* FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id, oi.asset_id LIMIT 1) oi ON TRUE LEFT JOIN images i ON i.id = oi.asset_id WHERE LOWER(COALESCE(o.payment_status, '')) IN ('completed', 'paid') GROUP BY 1, 2 ORDER BY currency, name")).rows;
  const earningsCategoryRows = (await poolRef.query("SELECT UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD')) AS currency, COALESCE(NULLIF(TRIM(SPLIT_PART(COALESCE(oi.category, i.category, ''), ',', 1)), ''), 'Other / Unassigned') AS name, COALESCE(SUM(o.total_amount), 0)::numeric AS total_value FROM orders o LEFT JOIN LATERAL (SELECT oi.* FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id, oi.asset_id LIMIT 1) oi ON TRUE LEFT JOIN images i ON i.id = oi.asset_id WHERE LOWER(COALESCE(o.payment_status, '')) IN ('completed', 'paid') GROUP BY 1, 2 ORDER BY currency, name")).rows;
  const earningsTypeRows = (await poolRef.query("SELECT UPPER(COALESCE(NULLIF(TRIM(o.currency), ''), 'USD')) AS currency, COALESCE(NULLIF(INITCAP(TRIM(i.type)), ''), 'Other / Unassigned') AS name, COALESCE(SUM(o.total_amount), 0)::numeric AS total_value FROM orders o LEFT JOIN LATERAL (SELECT oi.* FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id, oi.asset_id LIMIT 1) oi ON TRUE LEFT JOIN images i ON i.id = oi.asset_id WHERE LOWER(COALESCE(o.payment_status, '')) IN ('completed', 'paid') GROUP BY 1, 2 ORDER BY currency, name")).rows;
  const earningsCurrencyBreakdown = earningsCurrencyRows.map((currencyRow) => ({
    currency: currencyRow.currency,
    total: Number(currencyRow.total_value || 0),
    collections: earningsCollectionRows.filter((row) => row.currency === currencyRow.currency && Number(row.total_value || 0) !== 0).map((row) => ({ name: row.name, count: Number(row.total_value || 0) })),
    categories: earningsCategoryRows.filter((row) => row.currency === currencyRow.currency && Number(row.total_value || 0) !== 0).map((row) => ({ name: row.name, count: Number(row.total_value || 0) })),
    type: earningsTypeRows.filter((row) => row.currency === currencyRow.currency && Number(row.total_value || 0) !== 0).map((row) => ({ name: row.name, count: Number(row.total_value || 0) }))
  })).filter((currencyRow) => currencyRow.total !== 0);

  return {
    siteName: process.env.APP_NAME || 'GFXunlimit',
    generatedAt: new Date(),
    totalUsers: Number(usersRes.rows[0]?.total_users || 0),
    totalContributors: Number(contributorsRes.rows[0]?.total_contributors || 0),
    totalCustomers: Number(customersRes.rows[0]?.total_customers || 0),
    totalAdmins: Number(adminsRes.rows[0]?.total_admins || 0),
    pendingUsers: Number(pendingUsersRes.rows[0]?.pending_users || 0),
    blockedUsers: Number(blockedUsersRes.rows[0]?.blocked_users || 0),
    activeContributors: Number(activeContributorsRes.rows[0]?.active_contributors || 0),
    inactiveContributors: Number(inactiveContributorsRes.rows[0]?.inactive_contributors || 0),
    pendingContributors: Number(pendingContributorsRes.rows[0]?.pending_contributors || 0),
    blockedContributors: Number(blockedContributorsRes.rows[0]?.blocked_contributors || 0),
    deletedContributorsLast30Days: Number(deletedContributorsRes.rows[0]?.deleted_contributors || 0),
    activeCustomers: Number(activeCustomersRes.rows[0]?.active_customers || 0),
    inactiveCustomers: Number(inactiveCustomersRes.rows[0]?.inactive_customers || 0),
    pendingCustomers: Number(pendingCustomersRes.rows[0]?.pending_customers || 0),
    blockedCustomers: Number(blockedCustomersRes.rows[0]?.blocked_customers || 0),
    deletedCustomersLast30Days: Number(deletedCustomersRes.rows[0]?.deleted_customers || 0),
    totalAssets: Number(totalAssetsRes.rows[0]?.total_assets || 0),
    liveAssets: Number(liveAssetsRes.rows[0]?.live_assets || 0),
    collectionLiveAssets: normalizeBreakdownList(collectionLiveAssetsRes.rows, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryLiveAssets: normalizeBreakdownList(categoryLiveAssetsRes.rows, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeLiveAssets: normalizeBreakdownList(typeLiveAssetsRes.rows, ['Commercial', 'Editorial', 'Other / Unassigned']),
    pendingAssets: Number(pendingAssetsRes.rows[0]?.pending_assets || 0),
    collectionPendingAssets: normalizeBreakdownList(collectionPendingAssetsRes.rows, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryPendingAssets: normalizeBreakdownList(categoryPendingAssetsRes.rows, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typePendingAssets: normalizeBreakdownList(typePendingAssetsRes.rows, ['Commercial', 'Editorial', 'Other / Unassigned']),
    rejectedAssets: Number(rejectedAssetsRes.rows[0]?.rejected_assets || 0),
    collectionRejectedAssets: normalizeBreakdownList(collectionRejectedAssetsRes.rows, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryRejectedAssets: normalizeBreakdownList(categoryRejectedAssetsRes.rows, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeRejectedAssets: normalizeBreakdownList(typeRejectedAssetsRes.rows, ['Commercial', 'Editorial', 'Other / Unassigned']),
    deletedAssetsLast30Days: Number(deletedAssetsRes.rows[0]?.deleted_assets_last_30_days || 0),
    collectionDeletedAssetsLast30Days: normalizeBreakdownList(collectionDeletedAssetsRes.rows, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryDeletedAssetsLast30Days: normalizeBreakdownList(categoryDeletedAssetsRes.rows, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeDeletedAssetsLast30Days: normalizeBreakdownList(typeDeletedAssetsRes.rows, ['Commercial', 'Editorial', 'Other / Unassigned']),
    totalOrders: Number((await poolRef.query("SELECT COUNT(*)::int AS total_orders FROM orders WHERE LOWER(COALESCE(payment_status, '')) IN ('completed', 'paid', 'success', 'successful')")).rows[0]?.total_orders || 0),
    failedOrders: Number((await poolRef.query("SELECT COUNT(*)::int AS failed_orders FROM orders WHERE LOWER(COALESCE(order_status, '')) = 'failed'")).rows[0]?.failed_orders || 0),
    paymentFailedCount: Number((await poolRef.query("SELECT COUNT(*)::int AS payment_failed_count FROM orders WHERE LOWER(COALESCE(payment_status, '')) = 'failed'")).rows[0]?.payment_failed_count || 0),
    paymentFailedValue: paymentFailedValueInr,
    discountCurrencyBreakdown,
    earningsCurrencyBreakdown,
    collectionTotalOrders: normalizeBreakdownList(totalOrdersBreakdown.collection, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryTotalOrders: normalizeBreakdownList(totalOrdersBreakdown.category, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeTotalOrders: normalizeBreakdownList(totalOrdersBreakdown.type, ['Commercial', 'Editorial', 'Other / Unassigned']),
    collectionFailedOrders: normalizeBreakdownList(failedOrdersBreakdown.collection, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryFailedOrders: normalizeBreakdownList(failedOrdersBreakdown.category, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeFailedOrders: normalizeBreakdownList(failedOrdersBreakdown.type, ['Commercial', 'Editorial', 'Other / Unassigned']),
    collectionPaymentFailedCount: normalizeBreakdownList(paymentFailedCountBreakdown.collection, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryPaymentFailedCount: normalizeBreakdownList(paymentFailedCountBreakdown.category, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typePaymentFailedCount: normalizeBreakdownList(paymentFailedCountBreakdown.type, ['Commercial', 'Editorial', 'Other / Unassigned']),
    collectionPaymentFailedValue: normalizeRevenueBreakdownList(paymentFailedValueBreakdown.collection, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryPaymentFailedValue: normalizeRevenueBreakdownList(paymentFailedValueBreakdown.category, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typePaymentFailedValue: normalizeRevenueBreakdownList(paymentFailedValueBreakdown.type, ['Commercial', 'Editorial', 'Other / Unassigned']),
    paymentFailedCurrencyBreakdown,
    revenueLast7Days: financialWindows[0].revenue,
    discountLast7Days: financialWindows[0].discount,
    earningsLast7Days: financialWindows[0].earnings,
    revenueLast30Days: financialWindows[1].revenue,
    discountLast30Days: financialWindows[1].discount,
    earningsLast30Days: financialWindows[1].earnings,
    revenueCurrentMonth: financialWindows[2].revenue,
    discountCurrentMonth: financialWindows[2].discount,
    earningsCurrentMonth: financialWindows[2].earnings,
    revenueCurrentFy: financialWindows[3].revenue,
    discountCurrentFy: financialWindows[3].discount,
    earningsCurrentFy: financialWindows[3].earnings,
    revenueLast365Days: financialWindows[4].revenue,
    discountLast365Days: financialWindows[4].discount,
    earningsLast365Days: financialWindows[4].earnings,
    totalRevenueUsd,
    totalRevenueInr,
    totalDiscountUsd,
    totalDiscountInr,
    totalEarningsUsd,
    totalEarningsInr,
    exchangeRate,
    currencyRevenueBreakdown: normalizeRevenueBreakdownList(currencyRevenueBreakdownRes.rows, ['INR', 'USD', 'EUR']),
    collectionRevenueBreakdown: normalizeRevenueBreakdownList(collectionRevenueBreakdownRes.rows, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryRevenueBreakdown: normalizeRevenueBreakdownList(categoryRevenueBreakdownRes.rows, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeRevenueBreakdown: normalizeRevenueBreakdownList(typeRevenueBreakdownRes.rows, ['Commercial', 'Editorial', 'Other / Unassigned']),
    revenueCurrencyBreakdown: addCurrencyTotals(normalizeCurrencyValueBreakdowns({
      collection: collectionRevenueBreakdownRes.rows,
      category: categoryRevenueBreakdownRes.rows,
      type: typeRevenueBreakdownRes.rows
    }, ['INR', 'USD', 'EUR']), currencyRevenueBreakdownRes.rows.map((row) => ({
      currency: row.name,
      total_value: row.total_value
    }))),
    totalDownloads: Number(downloadsRes.rows[0]?.total_downloads || 0),
    collectionTotalDownloads: normalizeBreakdownList(downloadCollectionRes.rows, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryTotalDownloads: normalizeBreakdownList(downloadCategoryRes.rows, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeTotalDownloads: normalizeBreakdownList(downloadTypeRes.rows, ['Commercial', 'Editorial', 'Other / Unassigned']),
    collectionLast24HoursDownloads: normalizeBreakdownList(last24HourCollectionDownloadsRes.rows, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryLast24HoursDownloads: normalizeBreakdownList(last24HourCategoryDownloadsRes.rows, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeLast24HoursDownloads: normalizeBreakdownList(last24HourTypeDownloadsRes.rows, ['Commercial', 'Editorial', 'Other / Unassigned']),
    last24HoursDownloads: Number(last24HoursDownloadsRes.rows[0]?.download_count || 0),
    last7DaysDownloads: Number(last7DaysDownloadsRes.rows[0]?.download_count || 0),
    collectionLast7DaysDownloads: normalizeBreakdownList(last7DaysBreakdown.collection, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryLast7DaysDownloads: normalizeBreakdownList(last7DaysBreakdown.category, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeLast7DaysDownloads: normalizeBreakdownList(last7DaysBreakdown.type, ['Commercial', 'Editorial', 'Other / Unassigned']),
    last30DaysDownloads: Number(last30DaysDownloadsRes.rows[0]?.download_count || 0),
    collectionLast30DaysDownloads: normalizeBreakdownList(last30DaysBreakdown.collection, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryLast30DaysDownloads: normalizeBreakdownList(last30DaysBreakdown.category, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeLast30DaysDownloads: normalizeBreakdownList(last30DaysBreakdown.type, ['Commercial', 'Editorial', 'Other / Unassigned']),
    last365DaysDownloads: Number(last365DaysDownloadsRes.rows[0]?.download_count || 0),
    collectionLast365DaysDownloads: normalizeBreakdownList(last365DaysBreakdown.collection, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryLast365DaysDownloads: normalizeBreakdownList(last365DaysBreakdown.category, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeLast365DaysDownloads: normalizeBreakdownList(last365DaysBreakdown.type, ['Commercial', 'Editorial', 'Other / Unassigned']),
    currentMonthDownloads: Number(currentMonthDownloadsRes.rows[0]?.download_count || 0),
    collectionCurrentMonthDownloads: normalizeBreakdownList(currentMonthBreakdown.collection, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryCurrentMonthDownloads: normalizeBreakdownList(currentMonthBreakdown.category, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeCurrentMonthDownloads: normalizeBreakdownList(currentMonthBreakdown.type, ['Commercial', 'Editorial', 'Other / Unassigned']),
    currentFyDownloads: Number(currentFyDownloadsRes.rows[0]?.download_count || 0),
    collectionCurrentFyDownloads: normalizeBreakdownList(currentFyBreakdown.collection, ['Other / Unassigned', 'Photos', 'Psd', 'Templates', 'Vectors', 'Videos']),
    categoryCurrentFyDownloads: normalizeBreakdownList(currentFyBreakdown.category, ['23', 'Abstract', 'Animals', 'Arts', 'Backgrounds', 'Beauty', 'Business', 'Celebrities', 'Education', 'Fashion', 'People', 'Texture', 'Other / Unassigned']),
    typeCurrentFyDownloads: normalizeBreakdownList(currentFyBreakdown.type, ['Commercial', 'Editorial', 'Other / Unassigned']),
    newToday: Number(last24HoursDownloadsRes.rows[0]?.download_count || 0),
  };
};

const formatCurrency = (value) => {
  const n = Number(value || 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
};

const renderDailyMetricCards = (summary, selectedMetrics = null) => {
  const number = (value) => Math.round(Number(value || 0)).toLocaleString('en-US');
  const currency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const currencyValue = (value, item = {}) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(item.currency || 'USD').toUpperCase(),
    maximumFractionDigits: 2
  }).format(Number(value || 0));
  const list = (title, items, formatter = number) => Array.isArray(items) && items.length
    ? `<div style="margin-top:10px; padding:10px 10px 8px; border:1px solid #dbe6ff; border-radius:10px; background:#fff; box-shadow:inset 0 1px 0 rgba(255,255,255,.45);"><div style="font-weight:800; font-size:10px; letter-spacing:.06em; text-transform:uppercase; color:#1d4ed8; margin-bottom:6px;">${title}:</div><ul style="margin:0; padding-left:18px; color:#334155; line-height:1.55; font-size:11px;">${items.map((item) => `<li style="margin-bottom:2px;">${item.name || item.label || 'Value'}: ${formatter(item.count ?? item.value, item)}</li>`).join('')}</ul></div>`
    : '';
  const groupedDetails = (prefix, formatter = number) => `${list('Collections', summary[`collection${prefix}`], formatter)}${list('Categories', summary[`category${prefix}`], formatter)}${list('Type', summary[`type${prefix}`], formatter)}`;
  const statusDetails = (items) => list(items[0], items[1].map(([name, value]) => ({ name, count: value })));
  const revenueDetails = `${list('Currencies', summary.revenueCurrencyBreakdown, (value, item) => currencyValue(item.total ?? value, item))}${(summary.revenueCurrencyBreakdown || []).map((item) => `<div style="margin-top:8px;"><strong>${item.currency}</strong>${list('Collections', item.collections, currencyValue)}${list('Categories', item.categories, currencyValue)}${list('Type', item.type, currencyValue)}</div>`).join('')}`;
  const paymentFailedDetails = (summary.paymentFailedCurrencyBreakdown || []).map((item) => `<div style="margin-top:10px; padding:10px; border:1px solid #dbe6ff; border-radius:10px; background:#fff;"><div style="font-weight:800; color:#1d4ed8;">${item.currency}: ${currencyValue(item.total, item)}</div>${list('Collections', item.collections, currencyValue)}${list('Categories', item.categories, currencyValue)}${list('Type', item.type, currencyValue)}</div>`).join('');
  const discountDetails = `${list('Currencies', summary.discountCurrencyBreakdown, (value, item) => currencyValue(item.total ?? value, item))}${(summary.discountCurrencyBreakdown || []).map((item) => `<div style="margin-top:8px;"><strong>${item.currency}</strong>${list('Collections', item.collections, currencyValue)}${list('Categories', item.categories, currencyValue)}${list('Type', item.type, currencyValue)}</div>`).join('')}`;
  const windowCards = [
    ['Last7Days', 'Last 7 Days'], ['Last30Days', 'Last 30 Days'], ['CurrentMonth', 'Current Month'], ['CurrentFy', 'Current FY'], ['Last365Days', 'Last 365 Days']
  ].flatMap(([suffix, label]) => ['revenue', 'discount', 'earnings'].map((metric) => {
    const sections = summary[`${metric}${suffix}`] || [];
    const details = `${list('Currencies', sections, (value, item) => currencyValue(item.total ?? value, item))}${sections.map((item) => `<div style="margin-top:8px;"><strong>${item.currency}</strong>${list('Collections', item.collections, currencyValue)}${list('Categories', item.categories, currencyValue)}${list('Type', item.type, currencyValue)}</div>`).join('')}`;
    const metricLabel = metric[0].toUpperCase() + metric.slice(1);
    return [`${metric}${suffix}`, `${metricLabel} ${label}`, '', details];
  }));
  const cards = [
    ['totalAssets', 'Total Assets', summary.totalAssets, statusDetails(['Assets', [['Live Assets', summary.liveAssets], ['Pending Assets', summary.pendingAssets], ['Rejected Assets', summary.rejectedAssets], ['Deleted Assets (Last 30 Days)', summary.deletedAssetsLast30Days]]])],
    ['totalUsers', 'Total Users', summary.totalUsers, statusDetails(['Users', [['Customers', summary.totalCustomers], ['Admins', summary.totalAdmins], ['Contributors', summary.totalContributors], ['Pending Users', summary.pendingUsers], ['Blocked Users', summary.blockedUsers]]])],
    ['totalContributors', 'Total Contributors', summary.totalContributors, statusDetails(['Contributor Status', [['Active', summary.activeContributors], ['Inactive', summary.inactiveContributors], ['Pending', summary.pendingContributors], ['Blocked', summary.blockedContributors], ['Deleted (Last 30 Days)', summary.deletedContributorsLast30Days]]])],
    ['totalCustomers', 'Total Customers', summary.totalCustomers, statusDetails(['Customer Status', [['Active', summary.activeCustomers], ['Inactive', summary.inactiveCustomers], ['Pending', summary.pendingCustomers], ['Blocked', summary.blockedCustomers], ['Deleted (Last 30 Days)', summary.deletedCustomersLast30Days]]])],
    ['liveAssets', 'Live Assets', summary.liveAssets, groupedDetails('LiveAssets')],
    ['pendingAssets', 'Pending Assets', summary.pendingAssets, groupedDetails('PendingAssets')],
    ['rejectedAssets', 'Rejected Assets', summary.rejectedAssets, groupedDetails('RejectedAssets')],
    ['deletedAssetsLast30Days', 'Deleted Assets (Last 30 Days)', summary.deletedAssetsLast30Days, groupedDetails('DeletedAssetsLast30Days')],
    ['totalOrders', 'Total Orders', summary.totalOrders, groupedDetails('TotalOrders')],
    ['paymentFailedCount', 'Payment Failed Value', '', paymentFailedDetails],
    ['totalRevenueInr', 'Revenue', '', revenueDetails],
    ['totalDiscountInr', 'Discount', summary.totalDiscountInr, discountDetails],
    ['totalEarningsInr', 'Earnings', '', `${list('Currencies', summary.earningsCurrencyBreakdown, (value, item) => currencyValue(item.total ?? value, item))}${(summary.earningsCurrencyBreakdown || []).map((item) => `<div style="margin-top:8px;"><strong>${item.currency}</strong>${list('Collections', item.collections, currencyValue)}${list('Categories', item.categories, currencyValue)}${list('Type', item.type, currencyValue)}</div>`).join('')}`],
    ...windowCards,
    ['totalDownloads', 'Total Downloads', summary.totalDownloads, groupedDetails('TotalDownloads')],
    ['last24HoursDownloads', 'Last 24 Hr Downloads', summary.last24HoursDownloads, groupedDetails('Last24HoursDownloads')],
    ['last7DaysDownloads', 'Last 7 Days Downloads', summary.last7DaysDownloads, groupedDetails('Last7DaysDownloads')],
    ['last30DaysDownloads', 'Last 30 Days Downloads', summary.last30DaysDownloads, groupedDetails('Last30DaysDownloads')],
    ['last365DaysDownloads', 'Last 365 Days Downloads', summary.last365DaysDownloads, groupedDetails('Last365DaysDownloads')],
    ['currentMonthDownloads', 'Current Month Downloads', summary.currentMonthDownloads, groupedDetails('CurrentMonthDownloads')],
    ['currentFyDownloads', 'Current FY Downloads', summary.currentFyDownloads, groupedDetails('CurrentFyDownloads')]
  ].filter(([key]) => !selectedMetrics || selectedMetrics[key]);

  const emailGroups = [
    ['Website Overview', ['totalUsers', 'totalContributors', 'totalCustomers', 'totalAssets']],
    ['Asset Statistics', ['liveAssets', 'pendingAssets', 'rejectedAssets', 'deletedAssetsLast30Days']],
    ['Orders & Payments', ['totalOrders', 'failedOrders', 'paymentFailedCount']],
    ['Financial Performance', ['totalRevenueInr', 'totalDiscountInr', 'totalEarningsInr', 'revenueLast7Days', 'discountLast7Days', 'earningsLast7Days', 'revenueLast30Days', 'discountLast30Days', 'earningsLast30Days', 'revenueCurrentMonth', 'discountCurrentMonth', 'earningsCurrentMonth', 'revenueCurrentFy', 'discountCurrentFy', 'earningsCurrentFy', 'revenueLast365Days', 'discountLast365Days', 'earningsLast365Days']],
    ['Downloads', ['totalDownloads', 'last24HoursDownloads', 'last7DaysDownloads', 'last30DaysDownloads', 'last365DaysDownloads', 'currentMonthDownloads', 'currentFyDownloads']]
  ];
  const groupedCards = emailGroups.map(([groupLabel, keys]) => ({ groupLabel, cards: cards.filter(([key]) => keys.includes(key)) })).filter((group) => group.cards.length > 0);
  const assignedCardKeys = new Set(emailGroups.flatMap(([, keys]) => keys));
  const otherCards = cards.filter(([key]) => !assignedCardKeys.has(key));
  if (otherCards.length) groupedCards.push({ groupLabel: 'Other Metrics', cards: otherCards });
  return `<div style="height:auto; max-height:720px; overflow-y:auto; scrollbar-width:thin; padding:2px; font-size:13px;">
    ${groupedCards.map(({ groupLabel, cards: groupCards }) => `<section style="margin:0 0 18px; padding:12px; border:1px solid #dbe6ff; border-radius:12px; background:#f8fbff;">
      <h3 style="margin:0 0 10px; padding:10px 12px; border-radius:9px; background:#eef4ff; color:#1e3a8a; font-size:14px;">${groupLabel}</h3>
      <div style="font-size:0;">
        ${groupCards.map(([key, label, value, details]) => `<div style="display:inline-block; vertical-align:top; box-sizing:border-box; width:31.5%; height:240px; overflow-y:auto; scrollbar-width:thin; margin:0 1.5% 14px 0; padding:14px 12px; border:1px solid #c7d8ff; border-radius:14px; background:linear-gradient(135deg,#f1f5ff,#f8fbff); color:#23324d; font-size:13px;">
          <div style="font-size:12px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#2563eb;">${label}</div>
          ${value !== '' ? `<div style="margin-top:8px; font-size:26px; line-height:1.15; font-weight:800; color:#1d4ed8; word-break:break-word;">${typeof value === 'number' ? number(value) : value}</div>` : ''}
          ${details ? `<div style="margin-top:14px; line-height:1.7; font-size:12px;">${details}</div>` : ''}
        </div>`).join('')}
      </div>
    </section>`).join('')}
  </div>`;
};

const renderDailyWebsiteSummaryHtml = (summary, selectedMetrics = null) => {
  const dateText = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(summary.generatedAt);

  const metricsData = [
    ['totalUsers', 'Users', summary.totalUsers],
    ['totalCustomers', 'Customers', summary.totalCustomers],
    ['totalContributors', 'Contributors', summary.totalContributors],
    ['liveAssets', 'Live Assets', summary.liveAssets],
    ['pendingAssets', 'Pending Assets', summary.pendingAssets],
    ['rejectedAssets', 'Rejected Assets', summary.rejectedAssets],
    ['deletedAssetsLast30Days', 'Deleted Assets (Last 30 Days)', summary.deletedAssetsLast30Days],
    ['totalOrders', 'Orders', summary.totalOrders],
    ['totalRevenueUsd', 'Revenue (USD)', formatCurrency(summary.totalRevenueUsd)],
    ['totalRevenueInr', 'Revenue (INR)', new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(summary.totalRevenueInr)],
    ['totalDownloads', 'Downloads', summary.totalDownloads],
    ['last24HoursDownloads', 'Last 24 Hr Downloads', summary.last24HoursDownloads],
    ['last7DaysDownloads', 'Last 7 Days Downloads', summary.last7DaysDownloads],
    ['last30DaysDownloads', 'Last 30 Days Downloads', summary.last30DaysDownloads],
    ['last365DaysDownloads', 'Last 365 Days Downloads', summary.last365DaysDownloads],
    ['currentMonthDownloads', 'Current Month Downloads', summary.currentMonthDownloads],
    ['currentFyDownloads', 'Current FY Downloads', summary.currentFyDownloads]
  ].filter(([key]) => !selectedMetrics || selectedMetrics[key]);

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; background: #f8fafc; padding: 24px;">
      <div style="max-width: 760px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #1d4ed8, #2563eb); color: #fff; padding: 20px 24px;">
          <div style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.82;">Website Summary</div>
          <h2 style="margin: 8px 0 0; font-size: 28px;">${summary.siteName}</h2>
          <div style="margin-top: 8px; font-size: 13px; opacity: 0.88;">Generated: ${dateText}</div>
        </div>
        <div style="padding: 24px;">
          ${renderDailyMetricCards(summary, selectedMetrics)}
          ${selectedMetrics ? '' : `<div style="border-top: 1px solid #e2e8f0; padding-top: 18px; color: #334155; line-height: 1.6;">
            <div><strong>Daily status:</strong> ${summary.liveAssets} live assets, ${summary.pendingAssets} pending review, ${summary.rejectedAssets} rejected, ${summary.totalOrders} orders processed, and ${formatCurrency(summary.totalRevenueUsd)} USD (₹${summary.totalRevenueInr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}) in completed revenue.</div>
            <div style="margin-top: 8px;"><strong>Engagement:</strong> ${summary.totalDownloads} total asset downloads recorded so far, ${summary.last24HoursDownloads} in the last 24 hours, ${summary.last7DaysDownloads} in the last 7 days, and ${summary.currentFyDownloads} in the current FY.</div>
          </div>`}
        </div>
      </div>
    </div>
  `;
};

function verifyAdminLocal(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json('Access denied');
    const token = authHeader.split(' ')[1];
    const secrets = [...new Set([process.env.JWT_SECRET, 'secretkey'].filter(Boolean))];
    let decoded;
    let lastError;
    for (const secret of secrets) {
      try {
        decoded = jwt.verify(token, secret);
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!decoded) throw lastError || new Error('Invalid token');
    // basic check
    pool.query('SELECT role FROM users WHERE id = $1', [decoded.user]).then(result => {
      if (result.rows.length === 0) return res.status(404).json('User not found');
      if (result.rows[0].role !== 'admin') return res.status(403).json('Admin access only');
      req.user = decoded.user;
      next();
    }).catch(err => {
      console.error(err);
      res.status(500).json('Server error');
    });
  } catch (err) {
    console.error(err);
    res.status(401).json('Invalid token');
  }
}

const emailTemplateStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      const dir = path.join(__dirname, '..', 'uploads', 'website', 'email template');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const emailTemplateUpload = multer({
  storage: emailTemplateStorage,
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for email template uploads'));
    }
  }
});

const scheduledEmailStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      const dir = ensureUploadDirectory(['website', 'emails']);
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const scheduledEmailUpload = multer({
  storage: scheduledEmailStorage,
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for scheduled email uploads'));
    }
  }
});

router.post('/upload-image', verifyAdminLocal, emailTemplateUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    const relativePath = path.relative(path.join(__dirname, '..', 'uploads'), req.file.path).replace(/\\/g, '/');
    const url = `/api/files/${relativePath}`;
    res.json({ url });
  } catch (err) {
    console.error('Email template image upload failed', err);
    res.status(500).json({ error: 'Image upload failed' });
  }
});

router.post('/scheduled/upload-image', verifyAdminLocal, scheduledEmailUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const uploadRoot = path.resolve(__dirname, '..', 'uploads');
    const relativePath = path.relative(uploadRoot, req.file.path).replace(/\\/g, '/');
    const url = `/api/files/${relativePath}`;

    res.json({ url, storedPath: req.file.path });
  } catch (err) {
    console.error('Scheduled email image upload failed', err);
    res.status(500).json({ error: 'Image upload failed' });
  }
});

router.delete('/uploaded-file', verifyAdminLocal, async (req, res) => {
  try {
    const uploadPath = req.body?.path || req.query?.path;
    const resolvedPath = normalizeUploadPath(uploadPath, path.resolve(__dirname, '..'));

    if (!resolvedPath) {
      return res.status(400).json({ error: 'Invalid upload path' });
    }

    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }

    fs.unlinkSync(resolvedPath);
    res.json({ ok: true });
  } catch (err) {
    console.error('Email template asset deletion failed', err);
    res.status(500).json({ error: 'Failed to delete uploaded file' });
  }
});

function preserveStoredPassword(body, stored) {
  if (!stored || !stored.smtp_pass) return body.smtp_pass;
  const sentPass = body?.smtp_pass;
  if (sentPass === '*****' || sentPass === undefined || sentPass === null || sentPass === '') {
    return stored.smtp_pass;
  }
  return sentPass;
}

function normalizeSmtpUser(settings) {
  if (!settings.smtp_user && settings.sender_email) {
    settings.smtp_user = settings.sender_email;
  }
  return settings;
}

async function upsertNewsletterTracking(campaignId, recipient, status = 'delivered') {
  try {
    await pool.query(
      `INSERT INTO newsletter_tracking(campaign_id, recipient, status, created_at)
       VALUES($1, $2, $3, now())
       ON CONFLICT (campaign_id, recipient)
       DO UPDATE SET status = EXCLUDED.status`,
      [campaignId, recipient, status]
    );
  } catch (err) {
    console.error('Failed to write newsletter tracking event', err);
  }
}

async function backfillDeliveredTrackingFromLogs() {
  try {
    await pool.query(`
      INSERT INTO newsletter_tracking(campaign_id, recipient, status, created_at)
      SELECT 0, recipient, 'delivered', MIN(created_at)
      FROM email_logs
      WHERE status IN ('sent', 'delivered')
      GROUP BY recipient
      ON CONFLICT (campaign_id, recipient)
      DO UPDATE SET status = 'delivered', created_at = LEAST(newsletter_tracking.created_at, EXCLUDED.created_at)
    `);
  } catch (err) {
    console.error('Failed to backfill newsletter tracking from email logs', err);
  }
}

// Get or create settings (single row)
router.get('/settings', verifyAdminLocal, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    if (r.rows.length === 0) return res.json({});
    const s = r.rows[0];
    // do not reveal passwords in plain text
    s.smtp_pass = s.smtp_pass ? '*****' : '';
    s.imap_pass = s.imap_pass ? '*****' : '';
    res.json(s);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.post('/settings', verifyAdminLocal, async (req, res) => {
  try {
    const body = req.body || {};
    let smtpEncrypted = null;
    let imapEncrypted = null;
    let popEncrypted = null;

    if (body.smtp_pass && body.smtp_pass !== '*****') {
      smtpEncrypted = encrypt(body.smtp_pass);
    } else {
      const current = await pool.query('SELECT smtp_pass FROM email_settings ORDER BY id DESC LIMIT 1');
      if (current.rows.length > 0 && current.rows[0].smtp_pass && current.rows[0].smtp_pass !== '*****') {
        smtpEncrypted = current.rows[0].smtp_pass;
      }
    }

    if (body.imap_pass && body.imap_pass !== '*****') {
      imapEncrypted = encrypt(body.imap_pass);
    } else {
      const current = await pool.query('SELECT imap_pass FROM email_settings ORDER BY id DESC LIMIT 1');
      if (current.rows.length > 0 && current.rows[0].imap_pass && current.rows[0].imap_pass !== '*****') {
        imapEncrypted = current.rows[0].imap_pass;
      }
    }

    if (body.pop_pass && body.pop_pass !== '*****') {
      popEncrypted = encrypt(body.pop_pass);
    } else {
      const current = await pool.query('SELECT pop_pass FROM email_settings ORDER BY id DESC LIMIT 1');
      if (current.rows.length > 0 && current.rows[0].pop_pass && current.rows[0].pop_pass !== '*****') {
        popEncrypted = current.rows[0].pop_pass;
      }
    }

    const q = `INSERT INTO email_settings(sender_name, sender_email, reply_to, provider, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, incoming_protocol, imap_host, imap_port, imap_user, imap_pass, imap_secure, pop_host, pop_port, pop_user, pop_pass, pop_secure, auth_required, connection_timeout, daily_limit, max_per_minute, enable_queue, enable_logging, enable_retry, retry_attempts, retry_delay, enable_bounce_handling, enable_tracking_pixel, enable_click_tracking, updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32, now()) RETURNING *`;
    const vals = [
      body.sender_name || null,
      body.sender_email || null,
      body.reply_to || null,
      body.provider || 'smtp',
      body.smtp_host || null,
      body.smtp_port || null,
      body.smtp_user || null,
      smtpEncrypted,
      !!body.smtp_secure,
      body.incoming_protocol || 'imap',
      body.imap_host || null,
      body.imap_port || null,
      body.imap_user || null,
      imapEncrypted,
      !!body.imap_secure,
      body.pop_host || null,
      body.pop_port || null,
      body.pop_user || null,
      popEncrypted,
      !!body.pop_secure,
      body.auth_required !== false,
      body.connection_timeout || 10000,
      body.daily_limit || 1000,
      body.max_per_minute || 60,
      body.enable_queue !== false,
      body.enable_logging !== false,
      body.enable_retry !== false,
      body.retry_attempts || 3,
      body.retry_delay || 60000,
      !!body.enable_bounce_handling,
      !!body.enable_tracking_pixel,
      !!body.enable_click_tracking
    ];
    const r = await pool.query(q, vals);
    const inserted = r.rows[0];
    inserted.smtp_pass = inserted.smtp_pass ? '*****' : '';
    inserted.imap_pass = inserted.imap_pass ? '*****' : '';
    inserted.pop_pass = inserted.pop_pass ? '*****' : '';
    res.json(inserted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

router.get('/tax-mail-config', verifyAdminLocal, async (req, res) => {
  try {
    const result = await pool.query('SELECT smtp_settings, settings, templates, updated_at FROM tax_mail_settings WHERE id = 1');
    const row = result.rows[0] || {};
    const smtpSettings = { ...DEFAULT_TAX_MAIL_CONFIG.smtp_settings, ...(row.smtp_settings || {}) };
    if (smtpSettings.smtp_pass) smtpSettings.smtp_pass = '*****';
    res.json({
      smtp_settings: smtpSettings,
      settings: { ...DEFAULT_TAX_MAIL_CONFIG.settings, ...(row.settings || {}) },
      templates: { ...DEFAULT_TAX_MAIL_CONFIG.templates, ...(row.templates || {}) },
      updated_at: row.updated_at || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load tax mail configuration' });
  }
});

router.put('/tax-mail-config', verifyAdminLocal, async (req, res) => {
  try {
    const existingResult = await pool.query('SELECT smtp_settings, settings, templates FROM tax_mail_settings WHERE id = 1');
    const existing = existingResult.rows[0] || {};
    const incomingSmtp = req.body?.smtp_settings || {};
    const currentSmtp = existing.smtp_settings || {};
    const smtpSettings = {
      ...currentSmtp,
      ...incomingSmtp,
      smtp_pass: incomingSmtp.smtp_pass && incomingSmtp.smtp_pass !== '*****'
        ? encrypt(incomingSmtp.smtp_pass)
        : (currentSmtp.smtp_pass || '')
    };
    const settings = { ...DEFAULT_TAX_MAIL_CONFIG.settings, ...(existing.settings || {}), ...(req.body?.settings || {}) };
    const templates = { ...DEFAULT_TAX_MAIL_CONFIG.templates, ...(existing.templates || {}), ...(req.body?.templates || {}) };
    const result = await pool.query(
      `INSERT INTO tax_mail_settings(id, smtp_settings, settings, templates, updated_at)
       VALUES(1, $1::jsonb, $2::jsonb, $3::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET smtp_settings = EXCLUDED.smtp_settings, settings = EXCLUDED.settings, templates = EXCLUDED.templates, updated_at = now()
       RETURNING settings, templates, updated_at`,
      [JSON.stringify(smtpSettings), JSON.stringify(settings), JSON.stringify(templates)]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save tax mail configuration' });
  }
});

router.post('/tax-mail/verify', verifyAdminLocal, async (req, res) => {
  try {
    const body = req.body || {};
    const transport = await createTransportFromSettings(body);
    await transport.verify();
    res.json({ status: 'connected' });
  } catch (err) {
    res.status(400).json({ status: 'failed', error: err.message });
  }
});

router.post('/tax-mail/send-test', verifyAdminLocal, async (req, res) => {
  try {
    const { to, subject, body, accentColor, fontFamily, imageUrl } = req.body || {};
    if (!to) return res.status(400).json({ error: 'Missing recipient' });
    const configResult = await pool.query('SELECT smtp_settings FROM tax_mail_settings WHERE id = 1');
    const smtpSettings = configResult.rows[0]?.smtp_settings || {};
    if (!smtpSettings.smtp_host || !smtpSettings.smtp_user || !smtpSettings.smtp_pass) {
      return res.status(400).json({ error: 'Tax mail SMTP settings are not configured' });
    }
    const finalSubject = subject || 'Tax form test email';
    const finalBody = body || '<p>Tax form test email</p>';
    const html = renderTaxMailHtml(finalSubject, finalBody, accentColor, fontFamily, imageUrl);
    const result = await sendMail(smtpSettings, {
      to,
      subject: finalSubject,
      text: finalBody.replace(/<[^>]*>/g, ''),
      html
    });
    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send tax mail', detail: err.message });
  }
});

// Verify SMTP connection using current settings
router.post('/verify', verifyAdminLocal, async (req, res) => {
  try {
    const body = req.body || {};
    const r = await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    const stored = r.rows[0];
    if (!stored && !body.smtp_host) return res.status(400).json({ status: 'no_settings' });

    const settings = normalizeSmtpUser({ ...stored, ...body });
    settings.smtp_pass = preserveStoredPassword(body, stored);

    const okTransport = await createTransportFromSettings(settings);
    try {
      await okTransport.verify();
      res.json({ status: 'connected' });
    } catch (err) {
      res.status(400).json({ status: 'failed', error: err.message });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verify failed', detail: err.message });
  }
});

// Send test email
router.get('/daily-report-preview', verifyAdminLocal, async (req, res) => {
  try {
    const summary = await buildDailyWebsiteSummary({ poolRef: pool });
    let reportSettings = null;
    if (req.query.scheduleId) {
      const scheduleResult = await pool.query(
        'SELECT report_settings FROM daily_report_schedules WHERE id = $1',
        [req.query.scheduleId]
      );
      reportSettings = scheduleResult.rows[0]?.report_settings || null;
    }
    if (!reportSettings) {
      const settingsResult = await pool.query('SELECT daily_report_settings FROM users WHERE id = $1', [req.user]);
      reportSettings = settingsResult.rows[0]?.daily_report_settings || {};
    }
    const selectedMetrics = reportSettings.metrics || null;
    const html = renderDailyWebsiteSummaryHtml(summary, selectedMetrics);
    const subject = getDailyReportSubject({ siteName: summary.siteName, metrics: selectedMetrics || {}, date: new Date(summary.generatedAt) });
    res.json({ ok: true, summary, html, subject, reportSettings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load daily report preview', detail: err.message });
  }
});

router.post('/send-test', verifyAdminLocal, async (req, res) => {
  try {
    const { to, subject, body, ...bodySettings } = req.body || {};
    if (!to) return res.status(400).json({ error: 'Missing recipient' });
    const r = await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    const stored = r.rows[0];
    if (!stored && !bodySettings.smtp_host) return res.status(400).json({ error: 'No email settings configured' });

    const settings = normalizeSmtpUser({ ...stored, ...bodySettings });
    settings.smtp_pass = preserveStoredPassword(bodySettings, stored);

    const finalSubject = subject || 'GFXunlimit: Test Email';
    const finalBody = body || '<p>GFXunlimit test email content.</p>';
    const trackedBody = injectTrackingIntoHtml(finalBody, 0, to, process.env.APP_URL || 'http://localhost:5000');
    const result = await sendMail(settings, {
      to,
      subject: finalSubject,
      text: finalBody.replace(/<[^>]*>/g, ''),
      html: trackedBody,
    });
    // log delivered status for successful test sends
    await pool.query(
      'INSERT INTO email_logs(recipient, subject, body, status, delivered_at, created_at) VALUES($1,$2,$3,$4, now(), now())',
      [to, finalSubject, trackedBody, 'delivered']
    );

    await pool.query(
      `INSERT INTO newsletter_tracking(campaign_id, recipient, status, created_at)
       VALUES($1, $2, 'delivered', now())
       ON CONFLICT (campaign_id, recipient)
       DO UPDATE SET status = 'delivered', created_at = LEAST(newsletter_tracking.created_at, now())`,
      [0, to]
    );
    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send test email', detail: err.message });
  }
});

// Templates CRUD
router.get('/templates', verifyAdminLocal, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name, subject, body, variables, template_type, enabled, is_default, created_at, updated_at FROM email_templates ORDER BY name');
    res.json(r.rows.map((row) => ({
      ...row,
      template_type: normalizeTemplateType(row.template_type),
      enabled: row.enabled !== false,
      is_default: row.is_default === true,
      variables: ensureTemplateVariables(row.variables)
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

router.get('/templates/:id', verifyAdminLocal, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM email_templates WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = r.rows[0];
    res.json({
      ...row,
      template_type: normalizeTemplateType(row.template_type),
      enabled: row.enabled !== false,
      is_default: row.is_default === true,
      variables: ensureTemplateVariables(row.variables)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load template' });
  }
});

router.post('/templates', verifyAdminLocal, async (req, res) => {
  try {
    const { id, name, subject, body, variables, template_type, enabled, is_default } = req.body || {};
    const normalizedType = normalizeTemplateType(template_type);
    const resolvedName = String(name || '').trim();
    if (!resolvedName) return res.status(400).json({ error: 'Template name is required' });

    const finalVariables = ensureTemplateVariables(variables);
    const finalEnabled = enabled !== false;
    const finalDefault = is_default === true;

    if (finalDefault) {
      await pool.query('UPDATE email_templates SET is_default = FALSE WHERE template_type = $1', [normalizedType]);
    }

    if (id) {
      const r = await pool.query(
        'UPDATE email_templates SET name=$1, subject=$2, body=$3, variables=$4, template_type=$5, enabled=$6, is_default=$7, updated_at=now() WHERE id=$8 RETURNING *',
        [resolvedName, subject || '', body || '', finalVariables, normalizedType, finalEnabled, finalDefault, id]
      );
      return res.json({ ...r.rows[0], template_type: normalizeTemplateType(r.rows[0].template_type), enabled: r.rows[0].enabled !== false, is_default: r.rows[0].is_default === true });
    }

    const r = await pool.query(
      'INSERT INTO email_templates(name, subject, body, variables, template_type, enabled, is_default) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [resolvedName, subject || '', body || '', finalVariables, normalizedType, finalEnabled, finalDefault]
    );
    res.json({ ...r.rows[0], template_type: normalizeTemplateType(r.rows[0].template_type), enabled: r.rows[0].enabled !== false, is_default: r.rows[0].is_default === true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save template' });
  }
});

router.post('/templates/test', verifyAdminLocal, async (req, res) => {
  try {
    const { to, templateType, subject, body, data = {} } = req.body || {};
    if (!to) return res.status(400).json({ error: 'Recipient email is required' });

    const selectedType = normalizeTemplateType(templateType);
    const templateSubject = String(subject || DEFAULT_TEMPLATE_LIBRARY[selectedType].subject || 'Template test').trim();
    const templateBody = body || DEFAULT_TEMPLATE_LIBRARY[selectedType].body || '<p>Template test content</p>';
    const settingsRes = await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    const settings = settingsRes.rows[0] || {};
    const html = renderTemplate(templateBody, data || {});
    const finalSubject = renderTemplate(templateSubject, data || {});
    const trackedHtml = injectTrackingIntoHtml(html, 0, to, process.env.APP_URL || 'http://localhost:5000');
    const result = await sendMail(settings, {
      to,
      subject: finalSubject,
      text: html.replace(/<[^>]*>/g, ''),
      html: trackedHtml,
    });

    await pool.query(
      'INSERT INTO email_logs(recipient, subject, body, status, delivered_at, created_at) VALUES($1,$2,$3,$4, now(), now())',
      [to, finalSubject, trackedHtml, 'delivered']
    );

    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send test template', detail: err.message });
  }
});

router.post('/templates/restore-default', verifyAdminLocal, async (req, res) => {
  try {
    const { templateType } = req.body || {};
    const normalizedType = normalizeTemplateType(templateType);
    const defaultTemplate = getDefaultTemplate(normalizedType);
    const existing = await pool.query('SELECT * FROM email_templates WHERE template_type = $1 AND is_default = TRUE LIMIT 1', [normalizedType]);

    if (existing.rows[0]) {
      const r = await pool.query(
        'UPDATE email_templates SET name=$1, subject=$2, body=$3, variables=$4, template_type=$5, enabled=$6, is_default=$7, updated_at=now() WHERE id=$8 RETURNING *',
        [defaultTemplate.name, defaultTemplate.subject, defaultTemplate.body, defaultTemplate.variables, normalizedType, true, true, existing.rows[0].id]
      );
      return res.json({ ...r.rows[0], template_type: normalizeTemplateType(r.rows[0].template_type), enabled: r.rows[0].enabled !== false, is_default: r.rows[0].is_default === true });
    }

    const r = await pool.query(
      'INSERT INTO email_templates(name, subject, body, variables, template_type, enabled, is_default) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [defaultTemplate.name, defaultTemplate.subject, defaultTemplate.body, defaultTemplate.variables, normalizedType, true, true]
    );
    res.json({ ...r.rows[0], template_type: normalizeTemplateType(r.rows[0].template_type), enabled: r.rows[0].enabled !== false, is_default: r.rows[0].is_default === true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to restore default template' });
  }
});

router.delete('/templates/:id', verifyAdminLocal, async (req, res) => {
  try {
    const existing = await pool.query('SELECT body FROM email_templates WHERE id = $1', [req.params.id]);
    const templateBody = existing.rows[0]?.body || '';

    if (templateBody) {
      await deleteReferencedUploadFiles(templateBody, path.resolve(__dirname, '..'));
    }

    await pool.query('DELETE FROM email_templates WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

router.get('/queue', verifyAdminLocal, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, job_id, payload, status, attempts, last_error, scheduled_at, created_at, recipient, event, template_id, subject, queued_at, sent_at, failed_at, retry_count, error_message, related_user_id, related_order_id, related_asset_id
      FROM email_queue
      WHERE status IN ('queued', 'scheduled', 'pending', 'processing', 'retrying')
      ORDER BY created_at DESC
    `);

    const items = (r.rows || []).map((row) => {
      const payload = row.payload || {};
      return {
        id: row.id,
        jobId: row.job_id,
        status: String(row.status || 'queued').toUpperCase(),
        recipient: row.recipient || payload.to || payload.recipient || 'Unknown recipient',
        subject: row.subject || payload.subject || '(No subject)',
        event: row.event || payload.event || payload.source || 'email',
        templateId: row.template_id || payload.templateId || null,
        createdAt: row.created_at,
        queuedAt: row.queued_at || row.created_at,
        sentAt: row.sent_at,
        failedAt: row.failed_at,
        retryCount: row.retry_count || row.attempts || 0,
        error: row.error_message || row.last_error || null,
        relatedUserId: row.related_user_id,
        relatedOrderId: row.related_order_id,
        relatedAssetId: row.related_asset_id,
      };
    });

    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load queue' });
  }
});

router.post('/queue/:id/retry', verifyAdminLocal, async (req, res) => {
  try {
    const existing = await pool.query('SELECT * FROM email_queue WHERE id::text = $1 OR job_id = $1 ORDER BY id DESC LIMIT 1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Email queue item not found' });
    const row = existing.rows[0];
    if (!['failed', 'cancelled'].includes(String(row.status).toLowerCase())) return res.status(400).json({ error: 'Only failed or cancelled emails can be retried' });
    const payload = row.payload || { to: row.recipient, subject: row.subject, source: row.event };
    const jobId = await enqueueEmail('retry-email', { ...payload, event: row.event || 'retry' }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    await pool.query("UPDATE email_queue SET status='retrying', retry_count=retry_count + 1, error_message=NULL WHERE id = $1", [row.id]);
    res.json({ ok: true, jobId, status: 'RETRYING' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retry email' });
  }
});

// Enqueue email
router.post('/enqueue', verifyAdminLocal, async (req, res) => {
  try {
    const { to, subject, templateId, templateData, body, scheduledAt } = req.body || {};
    if (!to) return res.status(400).json({ error: 'Missing recipient' });
    let templateBody = body || null;
    if (templateId) {
      const t = await pool.query('SELECT body FROM email_templates WHERE id = $1', [templateId]);
      if (t.rows[0]) templateBody = t.rows[0].body;
    }
    const settingsRes = await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    const settings = settingsRes.rows[0] || {};
    const payload = {
      to,
      subject,
      templateBody,
      templateData,
      settings,
      source: templateId ? 'template' : 'manual',
      templateId: templateId || null,
    };
    if (scheduledAt) {
      // insert into DB scheduled
      await pool.query('INSERT INTO email_queue(payload, status, scheduled_at, created_at) VALUES($1,$2,$3, now())', [payload, 'scheduled', scheduledAt]);
      return res.json({ ok: true, scheduled: true });
    }
    const jobId = await enqueueEmail('send-email', payload);
    res.json({ ok: true, jobId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to enqueue' });
  }
});

// Logs
router.get('/logs', verifyAdminLocal, async (req, res) => {
  try {
    const { q, status, limit = 100, offset = 0 } = req.query;
    let base = 'SELECT * FROM email_logs';
    const where = [];
    const vals = [];
    if (q) { vals.push(`%${q}%`); where.push(`(recipient ILIKE $${vals.length} OR subject ILIKE $${vals.length} OR body ILIKE $${vals.length})`); }
    if (status) { vals.push(String(status).toLowerCase()); where.push(`status = $${vals.length}`); }
    if (where.length) base += ' WHERE ' + where.join(' AND ');
    base += ' ORDER BY created_at DESC LIMIT ' + Number(limit) + ' OFFSET ' + Number(offset);
    const r = await pool.query(base, vals);
    res.json(r.rows.map((row) => ({
      ...row,
      email_id: row.email_id || row.id,
      event: row.event || 'email',
      status: String(row.status || 'failed').toUpperCase(),
      queued_at: row.queued_at || row.created_at,
      sent_at: row.sent_at || row.delivered_at || null,
      failed_at: row.failed_at || (String(row.status).toLowerCase() === 'failed' ? row.created_at : null),
      retry_count: row.retry_count || row.retries || 0,
      error: row.error_message || null,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load logs' });
  }
});

// Newsletter subscribers
router.post('/newsletter/subscribers', verifyAdminLocal, async (req, res) => {
  try {
    const { email, name, segments } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Missing email' });
    const r = await pool.query('INSERT INTO newsletter_subscribers(email, name, segments) VALUES($1,$2,$3) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, segments=EXCLUDED.segments RETURNING *', [email, name || null, segments || []]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add subscriber' });
  }
});

router.get('/newsletter/subscribers', verifyAdminLocal, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM newsletter_subscribers ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load subscribers' });
  }
});

// Newsletter campaigns
router.post('/newsletter/campaigns', verifyAdminLocal, async (req, res) => {
  try {
    const { title, subject, body, scheduled_at } = req.body || {};
    const r = await pool.query('INSERT INTO newsletter_campaigns(title, subject, body, scheduled_at) VALUES($1,$2,$3,$4) RETURNING *', [title, subject, body, scheduled_at || null]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

router.post('/newsletter/send-campaign/:id', verifyAdminLocal, async (req, res) => {
  try {
    const id = req.params.id;
    const c = await pool.query('SELECT * FROM newsletter_campaigns WHERE id = $1', [id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Campaign not found' });
    const campaign = c.rows[0];
    const subs = await pool.query('SELECT email, name FROM newsletter_subscribers WHERE subscribed = true');
    const settingsRes = await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    const settings = settingsRes.rows[0] || {};
    for (const s of subs.rows) {
      const trackingBody = injectTrackingIntoHtml(campaign.body || '', campaign.id, s.email, process.env.APP_URL || 'http://localhost:5000');
      const payload = {
        to: s.email,
        subject: campaign.subject,
        templateBody: trackingBody,
        templateData: { subscriber_name: s.name },
        settings,
        campaignId: campaign.id,
        recipient: s.email,
        source: 'newsletter',
      };
      await enqueueEmail('send-email', payload);
    }
    res.json({ ok: true, queued: subs.rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send campaign' });
  }
});

router.get('/newsletter/track/open/:campaignId/:recipient', async (req, res) => {
  try {
    const { campaignId, recipient } = req.params;
    await pool.query(
      `INSERT INTO newsletter_tracking(campaign_id, recipient, status, opened_at, created_at)
       VALUES($1, $2, 'opened', now(), now())
       ON CONFLICT (campaign_id, recipient)
       DO UPDATE SET status = 'opened', opened_at = now()`,
      [campaignId, decodeURIComponent(recipient)]
    );
    res.set('Content-Type', 'image/gif');
    res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'));
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

router.get('/newsletter/track/click/:campaignId/:recipient', async (req, res) => {
  try {
    const { campaignId, recipient } = req.params;
    const target = req.query.url ? decodeURIComponent(req.query.url) : '/';
    await pool.query(
      `INSERT INTO newsletter_tracking(campaign_id, recipient, status, clicked_at, clicked_url, created_at)
       VALUES($1, $2, 'clicked', now(), $3, now())
       ON CONFLICT (campaign_id, recipient)
       DO UPDATE SET status = 'clicked', clicked_at = now(), clicked_url = $3`,
      [campaignId, decodeURIComponent(recipient), target]
    );
    res.redirect(target);
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

router.get('/newsletter/export-log/:campaignId', verifyAdminLocal, async (req, res) => {
  try {
    const campaignId = req.params.campaignId;
    const rows = await pool.query(`
      SELECT campaign_id, recipient, status, created_at, opened_at, clicked_at, clicked_url,
      CASE WHEN created_at IS NULL THEN 'archived'
           WHEN now() - created_at <= interval '6 hours' THEN 'active'
           ELSE 'archived' END AS tracking_status
      FROM newsletter_tracking
      WHERE campaign_id = $1
      ORDER BY created_at DESC
    `, [campaignId]);
    const csv = buildNewsletterExportLog(rows.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="newsletter-report-${campaignId}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export newsletter log' });
  }
});

router.get('/newsletter/stats/:campaignId', verifyAdminLocal, async (req, res) => {
  try {
    const campaignId = req.params.campaignId;
    const rows = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE status IN ('sent','delivered')) AS sent,
             COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
             COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
             COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked
      FROM newsletter_tracking
      WHERE campaign_id = $1
    `, [campaignId]);
    const stats = rows.rows[0] || {};
    res.json({
      sent: Number(stats.sent || 0),
      delivered: Number(stats.delivered || 0),
      opened: Number(stats.opened || 0),
      clicked: Number(stats.clicked || 0),
      tracking_window: '6 hours',
      status: getTrackingWindowStatus(rows.rows[0]?.created_at || null)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load newsletter stats' });
  }
});

// Notification rules CRUD
router.get('/notification-rules', verifyAdminLocal, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM notification_rules ORDER BY event_key');
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load rules' });
  }
});

router.post('/notification-rules', verifyAdminLocal, async (req, res) => {
  try {
    const { event_key, enable_email, enable_internal, enable_dashboard, recipients, active, schedule_time, metadata } = req.body || {};
    if (!event_key) {
      return res.status(400).json({ error: 'Event key is required' });
    }
    const recipientList = normalizeRecipients(Array.isArray(recipients)
      ? recipients
      : typeof recipients === 'string'
      ? recipients.split(',').map((item) => item.trim()).filter(Boolean)
      : []);
    const normalizedScheduleTime = (schedule_time || (metadata && metadata.schedule_time) || '11:00').trim();
    const normalizedMetadata = { ...(metadata || {}), schedule_time: normalizedScheduleTime };
    const isActive = active !== undefined ? !!active : (enable_email !== false || enable_internal !== false || enable_dashboard !== false);
    const emailEnabled = isActive ? (enable_email !== false) : false;
    const internalEnabled = isActive ? (enable_internal !== false) : false;
    const dashboardEnabled = isActive ? (enable_dashboard !== false) : false;
    const r = await pool.query(
      'INSERT INTO notification_rules(event_key, enable_email, enable_internal, enable_dashboard, recipients, schedule_time, metadata) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_key) DO UPDATE SET enable_email=EXCLUDED.enable_email, enable_internal=EXCLUDED.enable_internal, enable_dashboard=EXCLUDED.enable_dashboard, recipients=EXCLUDED.recipients, schedule_time=EXCLUDED.schedule_time, metadata=EXCLUDED.metadata, updated_at=now() RETURNING *',
      [event_key, emailEnabled, internalEnabled, dashboardEnabled, recipientList, normalizedScheduleTime, normalizedMetadata]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save rule' });
  }
});

router.delete('/notification-rules/:event_key', verifyAdminLocal, async (req, res) => {
  try {
    const eventKey = req.params.event_key;
    if (!eventKey) {
      return res.status(400).json({ error: 'Event key is required' });
    }
    const r = await pool.query('DELETE FROM notification_rules WHERE event_key = $1 RETURNING *', [eventKey]);
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    res.json({ ok: true, deleted: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

// Scheduled emails
router.get('/scheduled', verifyAdminLocal, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM scheduled_emails ORDER BY id DESC');
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load scheduled emails' });
  }
});

router.post('/scheduled', verifyAdminLocal, async (req, res) => {
  try {
    const { name, payload, cron_expression, next_run, active } = req.body || {};
    const r = await pool.query('INSERT INTO scheduled_emails(name, payload, cron_expression, next_run, active) VALUES($1,$2,$3,$4,$5) RETURNING *', [name, payload || {}, cron_expression || null, next_run || null, active !== false]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create scheduled email' });
  }
});

router.put('/scheduled/:id', verifyAdminLocal, async (req, res) => {
  try {
    const { name, payload, cron_expression, next_run, active } = req.body || {};
    const r = await pool.query(
      'UPDATE scheduled_emails SET name = $1, payload = $2, cron_expression = $3, next_run = $4, active = $5 WHERE id = $6 RETURNING *',
      [name, payload || {}, cron_expression || null, next_run || null, active !== false, req.params.id]
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Scheduled email not found' });
    }

    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update scheduled email' });
  }
});

router.delete('/scheduled/:id', verifyAdminLocal, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM scheduled_emails WHERE id = $1 RETURNING *', [req.params.id]);
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Scheduled email not found' });
    }
    res.json({ ok: true, deleted: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete scheduled email' });
  }
});

// Preview template rendering
router.post('/preview', verifyAdminLocal, async (req, res) => {
  try {
    const { body, data } = req.body || {};
    const html = renderTemplate(body || '', data || {});
    res.json({ html });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

function getEmailAnalyticsDateClauses(range, customFrom, customTo) {
  let interval = '30 days';
  let dateWhereClause = "WHERE created_at >= now() - interval '30 days'";
  let trackingWhereClause = "WHERE created_at >= now() - interval '30 days' OR opened_at >= now() - interval '30 days' OR clicked_at >= now() - interval '30 days'";
  let trackingOpenedWhereClause = "WHERE opened_at IS NOT NULL AND opened_at >= now() - interval '30 days'";
  let trackingClickedWhereClause = "WHERE clicked_at IS NOT NULL AND clicked_at >= now() - interval '30 days'";

  if (range === 'today') {
    interval = '1 day';
    dateWhereClause = "WHERE created_at >= now() - interval '1 day'";
    trackingWhereClause = "WHERE created_at >= now() - interval '1 day' OR opened_at >= now() - interval '1 day' OR clicked_at >= now() - interval '1 day'";
    trackingOpenedWhereClause = "WHERE opened_at IS NOT NULL AND opened_at >= now() - interval '1 day'";
    trackingClickedWhereClause = "WHERE clicked_at IS NOT NULL AND clicked_at >= now() - interval '1 day'";
  } else if (range === 'yesterday') {
    interval = '1 day';
    dateWhereClause = "WHERE created_at >= now() - interval '2 days' AND created_at < now() - interval '1 day'";
    trackingWhereClause = "WHERE (created_at >= now() - interval '2 days' AND created_at < now() - interval '1 day') OR (opened_at >= now() - interval '2 days' AND opened_at < now() - interval '1 day') OR (clicked_at >= now() - interval '2 days' AND clicked_at < now() - interval '1 day')";
    trackingOpenedWhereClause = "WHERE opened_at IS NOT NULL AND opened_at >= now() - interval '2 days' AND opened_at < now() - interval '1 day'";
    trackingClickedWhereClause = "WHERE clicked_at IS NOT NULL AND clicked_at >= now() - interval '2 days' AND clicked_at < now() - interval '1 day'";
  } else if (range === '7d') {
    interval = '7 days';
    dateWhereClause = "WHERE created_at >= now() - interval '7 days'";
    trackingWhereClause = "WHERE created_at >= now() - interval '7 days' OR opened_at >= now() - interval '7 days' OR clicked_at >= now() - interval '7 days'";
    trackingOpenedWhereClause = "WHERE opened_at IS NOT NULL AND opened_at >= now() - interval '7 days'";
    trackingClickedWhereClause = "WHERE clicked_at IS NOT NULL AND clicked_at >= now() - interval '7 days'";
  } else if (range === '30d') {
    interval = '30 days';
    dateWhereClause = "WHERE created_at >= now() - interval '30 days'";
    trackingWhereClause = "WHERE created_at >= now() - interval '30 days' OR opened_at >= now() - interval '30 days' OR clicked_at >= now() - interval '30 days'";
    trackingOpenedWhereClause = "WHERE opened_at IS NOT NULL AND opened_at >= now() - interval '30 days'";
    trackingClickedWhereClause = "WHERE clicked_at IS NOT NULL AND clicked_at >= now() - interval '30 days'";
  } else if (range === 'lifetime') {
    interval = 'all time';
    dateWhereClause = '';
    trackingWhereClause = '';
    trackingOpenedWhereClause = 'WHERE opened_at IS NOT NULL';
    trackingClickedWhereClause = 'WHERE clicked_at IS NOT NULL';
  } else if (range === 'custom' && (customFrom || customTo)) {
    const fromDate = customFrom ? `'${customFrom}'::date` : "NULL";
    const toDate = customTo ? `'${customTo}'::date` : "NULL";
    dateWhereClause = `WHERE (${fromDate} IS NULL OR created_at::date >= ${fromDate}) AND (${toDate} IS NULL OR created_at::date <= ${toDate})`;
    trackingWhereClause = `WHERE ((${fromDate} IS NULL OR created_at::date >= ${fromDate}) AND (${toDate} IS NULL OR created_at::date <= ${toDate})) OR ((${fromDate} IS NULL OR opened_at::date >= ${fromDate}) AND (${toDate} IS NULL OR opened_at::date <= ${toDate})) OR ((${fromDate} IS NULL OR clicked_at::date >= ${fromDate}) AND (${toDate} IS NULL OR clicked_at::date <= ${toDate}))`;
    trackingOpenedWhereClause = `WHERE opened_at IS NOT NULL AND (${fromDate} IS NULL OR opened_at::date >= ${fromDate}) AND (${toDate} IS NULL OR opened_at::date <= ${toDate})`;
    trackingClickedWhereClause = `WHERE clicked_at IS NOT NULL AND (${fromDate} IS NULL OR clicked_at::date >= ${fromDate}) AND (${toDate} IS NULL OR clicked_at::date <= ${toDate})`;
  }

  return { interval, dateWhereClause, trackingWhereClause, trackingOpenedWhereClause, trackingClickedWhereClause };
}

// Analytics: aggregates and daily counts for selected range
router.get('/analytics', verifyAdminLocal, async (req, res) => {
  try {
    const range = (req.query.range || '7d').toLowerCase();
    const customFrom = req.query.from;
    const customTo = req.query.to;
    const clauses = getEmailAnalyticsDateClauses(range, customFrom, customTo);
    const { dateWhereClause, trackingWhereClause, trackingOpenedWhereClause, trackingClickedWhereClause } = clauses;

    let interval = clauses.interval;

    if (range === 'custom' && !(customFrom || customTo)) {
      interval = 'custom range';
    }

    await backfillDeliveredTrackingFromLogs();

    const totalsQuery = `
      WITH combined_events AS (
        SELECT DISTINCT recipient, status, created_at, opened_at, clicked_at, delivered_at
        FROM (
          SELECT recipient, status, created_at, NULL::timestamptz AS opened_at, NULL::timestamptz AS clicked_at, delivered_at
          FROM email_logs
          ${dateWhereClause}
          UNION ALL
          SELECT recipient, status, created_at, opened_at, clicked_at, created_at AS delivered_at
          FROM newsletter_tracking
          ${trackingWhereClause}
        ) event_rows
      )
      SELECT
        COUNT(*) FILTER (WHERE status = 'sent') AS sent,
        COUNT(*) FILTER (WHERE status = 'delivered' OR opened_at IS NOT NULL OR clicked_at IS NOT NULL) AS delivered,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked,
        COUNT(*) FILTER (WHERE status = 'sent') AS total
      FROM combined_events
    `;

    const totals = await pool.query(totalsQuery);
    const daily = await pool.query(`
      WITH email_daily AS (
        SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
               COUNT(*) FILTER (WHERE status = 'sent') AS sent_count,
               COUNT(*) FILTER (WHERE status = 'delivered') AS delivered_count
        FROM email_logs
        ${dateWhereClause}
        GROUP BY day
      ),
      opened_daily AS (
        SELECT to_char(opened_at, 'YYYY-MM-DD') AS day,
               COUNT(*) AS opened_count
        FROM newsletter_tracking
        ${trackingOpenedWhereClause}
        GROUP BY day
      ),
      clicked_daily AS (
        SELECT to_char(clicked_at, 'YYYY-MM-DD') AS day,
               COUNT(*) AS clicked_count
        FROM newsletter_tracking
        ${trackingClickedWhereClause}
        GROUP BY day
      )
      SELECT day,
             COALESCE(SUM(sent_count), 0) AS sent_count,
             COALESCE(SUM(delivered_count), 0) AS delivered_count,
             COALESCE(SUM(opened_count), 0) AS opened_count,
             COALESCE(SUM(clicked_count), 0) AS clicked_count
      FROM (
        SELECT day, sent_count, delivered_count, 0 AS opened_count, 0 AS clicked_count FROM email_daily
        UNION ALL
        SELECT day, 0 AS sent_count, 0 AS delivered_count, opened_count, 0 AS clicked_count FROM opened_daily
        UNION ALL
        SELECT day, 0 AS sent_count, 0 AS delivered_count, 0 AS opened_count, clicked_count FROM clicked_daily
      ) combined
      GROUP BY day
      ORDER BY day
    `);

    const queueCount = await pool.query("SELECT COUNT(*) AS queued FROM email_queue WHERE status = 'queued'");
    res.json({
      totals: {
        sent: Number(totals.rows[0].sent || 0),
        delivered: Number(totals.rows[0].delivered || 0),
        opened: Number(totals.rows[0].opened || 0),
        clicked: Number(totals.rows[0].clicked || 0),
        total: Number(totals.rows[0].total || 0),
      },
      queued: Number(queueCount.rows[0].queued || 0),
      daily: daily.rows,
      range,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compute analytics' });
  }
});

router.get('/analytics/export', verifyAdminLocal, async (req, res) => {
  try {
    const range = (req.query.range || '7d').toLowerCase();
    const customFrom = req.query.from;
    const customTo = req.query.to;
    const { dateWhereClause } = getEmailAnalyticsDateClauses(range, customFrom, customTo);

    const { trackingWhereClause } = getEmailAnalyticsDateClauses(range, customFrom, customTo);

    let query = `
      WITH combined_events AS (
        SELECT DISTINCT recipient, cc_recipients, bcc_recipients, subject, status, error_message, created_at, delivered_at
        FROM (
          SELECT recipient, NULL::text AS cc_recipients, NULL::text AS bcc_recipients, subject, status, error_message, created_at, delivered_at
          FROM email_logs
          ${dateWhereClause}
          UNION ALL
          SELECT recipient, NULL::text AS cc_recipients, NULL::text AS bcc_recipients, '' AS subject, status, NULL::text AS error_message, created_at, created_at AS delivered_at
          FROM newsletter_tracking
          ${trackingWhereClause}
        ) event_rows
      )
      SELECT recipient, cc_recipients, bcc_recipients, subject, status, error_message, created_at, delivered_at
      FROM combined_events
      ORDER BY created_at DESC NULLS LAST
    `;

    if (!dateWhereClause) {
      query = `
        WITH combined_events AS (
          SELECT DISTINCT recipient, cc_recipients, bcc_recipients, subject, status, error_message, created_at, delivered_at
          FROM (
            SELECT recipient, NULL::text AS cc_recipients, NULL::text AS bcc_recipients, subject, status, error_message, created_at, delivered_at
            FROM email_logs
            UNION ALL
            SELECT recipient, NULL::text AS cc_recipients, NULL::text AS bcc_recipients, '' AS subject, status, NULL::text AS error_message, created_at, created_at AS delivered_at
            FROM newsletter_tracking
          ) event_rows
        )
        SELECT recipient, cc_recipients, bcc_recipients, subject, status, error_message, created_at, delivered_at
        FROM combined_events
        ORDER BY created_at DESC NULLS LAST
      `;
    }

    const result = await pool.query(query);
    const rows = result.rows || [];
    const csvLines = [
      ['recipient', 'cc_recipients', 'bcc_recipients', 'subject', 'status', 'error_message', 'created_at', 'delivered_at'].join(','),
      ...rows.map((row) => [
        row.recipient || '',
        row.cc_recipients || '',
        row.bcc_recipients || '',
        row.subject || '',
        row.status || '',
        row.error_message || '',
        row.created_at ? new Date(row.created_at).toISOString() : '',
        row.delivered_at ? new Date(row.delivered_at).toISOString() : ''
      ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="email-analytics-${range}${customFrom || customTo ? `-${customFrom || 'from'}-${customTo || 'to'}` : ''}.csv"`);
    res.send(csvLines.join('\n'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export email analytics CSV' });
  }
});

require('./daily-report-routes')(router, pool, verifyAdminLocal);

module.exports = router;
module.exports.buildDailyWebsiteSummary = buildDailyWebsiteSummary;
module.exports.renderDailyWebsiteSummaryHtml = renderDailyWebsiteSummaryHtml;
module.exports.getDailyReportSubject = getDailyReportSubject;
module.exports.isCollectionAwareLiveAsset = isCollectionAwareLiveAsset;
module.exports.getCollectionAwareLiveAssetsQuery = getCollectionAwareLiveAssetsQuery;
