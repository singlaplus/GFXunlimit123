const express = require('express');
const jwt = require('jsonwebtoken');
const { enqueueEmail } = require('./email/queue');
const { resolveNotificationEventKey } = require('./email/notificationRules');

const EVENT_TYPES = new Set([
  'USER_REGISTERED', 'USER_LOGIN', 'USER_LOGOUT', 'USER_LOGIN_FAILED', 'PASSWORD_CHANGED',
  'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'EMAIL_VERIFIED', 'PROFILE_UPDATED',
  'ASSET_VIEWED', 'ASSET_LIKED', 'ASSET_UNLIKED', 'ASSET_FAVORITED', 'ASSET_UNFAVORITED', 'ASSET_DOWNLOADED',
  'CART_CREATED', 'CART_ITEM_ADDED', 'CART_ITEM_REMOVED', 'CART_UPDATED', 'CHECKOUT_STARTED',
  'ORDER_CREATED', 'ORDER_UPDATED', 'ORDER_COMPLETED', 'ORDER_CANCELLED', 'ORDER_FAILED', 'ORDER_REFUNDED',
  'PAYMENT_STARTED', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'COUPON_CREATED', 'COUPON_APPLIED',
  'COUPON_USED', 'COUPON_FAILED', 'COUPON_EXPIRED', 'SUBSCRIPTION_STARTED', 'SUBSCRIPTION_RENEWED',
  'SUBSCRIPTION_CHANGED', 'SUBSCRIPTION_CANCELLED', 'SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_EXPIRING',
  'ASSET_UPLOADED', 'ASSET_PROCESSING', 'THUMBNAIL_GENERATION_STARTED', 'THUMBNAIL_GENERATION_COMPLETED',
  'THUMBNAIL_GENERATION_FAILED', 'ASSET_SUBMITTED', 'ASSET_APPROVED', 'ASSET_REJECTED', 'ASSET_UPDATED',
  'ASSET_DELETED', 'EARNING_CREATED', 'PAYOUT_REQUESTED', 'PAYOUT_APPROVED', 'PAYOUT_PROCESSED', 'PAYOUT_FAILED',
  'ADMIN_LOGIN', 'ADMIN_LOGOUT', 'ADMIN_ACTION', 'ADMIN_SETTING_CHANGED', 'ADMIN_USER_UPDATED',
  'ACCOUNT_STATUS_CHANGED', 'ADMIN_ASSET_UPDATED', 'ADMIN_ORDER_UPDATED', 'ADMIN_PAYMENT_UPDATED', 'ADMIN_PROMOTION_CREATED', 'ADMIN_COUPON_CREATED'
]);

const DEFAULT_EVENT_POLICY = {
  ASSET_UPLOADED: { internal: true, notifyAdmins: true, email: false },
  ASSET_APPROVED: { internal: true, notifyAdmins: false, email: true },
  ASSET_REJECTED: { internal: true, notifyAdmins: false, email: true },
  ACCOUNT_STATUS_CHANGED: { internal: true, notifyAdmins: true, email: false },
  ORDER_CREATED: { internal: true, notifyAdmins: true, email: true },
  ORDER_COMPLETED: { internal: true, notifyAdmins: true, email: true },
  PAYMENT_SUCCESS: { internal: true, notifyAdmins: true, email: true },
  PAYMENT_FAILED: { internal: true, notifyAdmins: true, email: true },
  ASSET_DOWNLOADED: { internal: false, notifyAdmins: false, email: false },
  USER_LOGIN: { internal: false, notifyAdmins: false, email: false },
  USER_LOGOUT: { internal: false, notifyAdmins: false, email: false },
};

const ASSET_NOTIFICATION_EVENTS = new Set([
  'ASSET_UPLOADED', 'ASSET_SUBMITTED', 'ASSET_APPROVED', 'ASSET_REJECTED', 'ASSET_UPDATED',
  'ASSET_DELETED', 'THUMBNAIL_GENERATION_COMPLETED', 'THUMBNAIL_GENERATION_FAILED',
  'ASSET_DOWNLOADED', 'ASSET_FAVORITED'
]);

async function createAssetNotifications(pool, { userIds = [], message, eventType, assetTitle, ownerId, actorId, status }) {
  const recipients = [...new Set(userIds.map(Number).filter(Boolean))];
  const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
  recipients.push(...admins.rows.map((user) => Number(user.id)).filter(Boolean));
  const users = await pool.query(
    'SELECT id, username FROM users WHERE id = ANY($1::int[]) AND username IS NOT NULL',
    [[...new Set(recipients)]]
  );
  const contextUsers = await pool.query(
    'SELECT id, username FROM users WHERE id = ANY($1::int[])',
    [[...new Set([ownerId, actorId].map(Number).filter(Boolean))]]
  );
  const context = new Map(contextUsers.rows.map((user) => [Number(user.id), user.username]));
  const actorName = context.get(Number(actorId)) || 'A user';
  const ownerName = context.get(Number(ownerId)) || 'the uploader';
  const detailMessage = message || `${eventType || 'Asset event'}: ${assetTitle || 'asset'}${status ? ` (${status})` : ''}`;
  const eventLabel = {
    ASSET_UPLOADED: 'uploaded',
    ASSET_SUBMITTED: 'submitted for review',
    ASSET_APPROVED: 'approved',
    ASSET_REJECTED: 'rejected',
    ASSET_UPDATED: 'updated',
    ASSET_DELETED: 'deleted',
    THUMBNAIL_GENERATION_COMPLETED: 'thumbnail generation completed for',
    THUMBNAIL_GENERATION_FAILED: 'thumbnail generation failed for'
  }[eventType];
  const formattedMessage = eventType === 'ASSET_FAVORITED'
    ? `${actorName} favorited asset "${assetTitle || 'Untitled'}", uploaded by ${ownerName}.`
    : eventType === 'ASSET_DOWNLOADED'
    ? `${actorName} downloaded asset "${assetTitle || 'Untitled'}", uploaded by ${ownerName}.`
    : eventType
    ? `Asset "${assetTitle || 'Untitled'}" was ${eventLabel || eventType.replace('ASSET_', '').toLowerCase().replaceAll('_', ' ')} by ${actorName}, uploaded by ${ownerName}${status ? ` (status: ${status})` : ''}.`
    : detailMessage;
  for (const user of users.rows) {
    await pool.query(
      'INSERT INTO notifications (username, message, is_read) VALUES ($1, $2, FALSE)',
      [user.username, formattedMessage]
    );
  }
}

async function createCouponNotifications(pool, { userIds = [], message }) {
  const rule = (await pool.query(
    "SELECT enabled, enable_internal FROM notification_rules WHERE event_key = 'COUPON_NOTIFICATION' LIMIT 1"
  )).rows[0];
  if (rule?.enabled === false || rule?.enable_internal !== true) return;
  const recipients = [...new Set(userIds.map(Number).filter(Boolean))];
  const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
  recipients.push(...admins.rows.map((user) => Number(user.id)).filter(Boolean));
  const users = await pool.query(
    'SELECT username FROM users WHERE id = ANY($1::int[]) AND username IS NOT NULL',
    [[...new Set(recipients)]]
  );
  for (const user of users.rows) {
    await pool.query(
      'INSERT INTO notifications (username, message, is_read) VALUES ($1, $2, FALSE)',
      [user.username, message]
    );
  }
}

async function createPaymentNotifications(pool, { userIds = [], eventType, message, orderId, paymentMethod, customerId }) {
  const rule = (await pool.query(
    "SELECT enabled, enable_internal FROM notification_rules WHERE event_key = 'PAYMENT_NOTIFICATION' LIMIT 1"
  )).rows[0];
  if (rule?.enabled === false || rule?.enable_internal !== true) return;
  let notificationMessage = message;
  if (orderId) {
    const orderResult = await pool.query(
      `SELECT o.id, o.order_number, o.customer_id, customer.username AS customer_username, o.payment_method,
              oi.asset_id, oi.title, oi.contributor_id, oi.contributor_username
       FROM orders o
       LEFT JOIN users customer ON customer.id = o.customer_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.id = $1
       ORDER BY oi.id`,
      [orderId]
    );
    const order = orderResult.rows[0];
    if (order) {
      const assets = orderResult.rows
        .filter((row) => row.asset_id !== null)
        .map((row) => `${row.title || 'Untitled'} (owner: ${row.contributor_username || 'Unknown'}${row.contributor_id ? `, ID: ${row.contributor_id}` : ''})`);
      const status = eventType === 'PAYMENT_SUCCESS' ? 'completed' : eventType === 'PAYMENT_FAILED' ? 'failed' : 'started';
      notificationMessage = `Payment ${status} | Customer: ${order.customer_username || 'Unknown'} | Asset${assets.length === 1 ? '' : 's'}: ${assets.length ? assets.join('; ') : 'N/A'} | Order ID: ${order.id} (${order.order_number || 'N/A'}) | Payment method: ${paymentMethod || order.payment_method || 'N/A'}${message && eventType === 'PAYMENT_FAILED' ? ` | Reason: ${message.replace(/^Payment failed for order [^:]+:?\s*/i, '')}` : ''}`;
    }
  }
  const recipients = [...new Set(userIds.map(Number).filter(Boolean))];
  const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
  recipients.push(...admins.rows.map((user) => Number(user.id)).filter(Boolean));
  const users = await pool.query(
    'SELECT username FROM users WHERE id = ANY($1::int[]) AND username IS NOT NULL',
    [[...new Set(recipients)]]
  );
  for (const user of users.rows) {
    await pool.query(
      'INSERT INTO notifications (username, message, is_read) VALUES ($1, $2, FALSE)',
      [user.username, notificationMessage]
    );
  }
}

async function isMessageTypeEnabled(pool, messageType) {
  const result = await pool.query('SELECT enabled FROM message_types WHERE code = $1', [messageType]);
  return result.rows[0]?.enabled === true;
}

function normalizeAdminInboxReadState(rows = []) {
  return rows.map((row) => {
    const readAt = row.read_at ?? row.readAt ?? null;
    const isRead = row.is_read ?? (readAt !== null && readAt !== undefined && readAt !== '');
    return { ...row, read_at: readAt, is_read: Boolean(isRead) };
  });
}

function isAdminInboxCreditRequestRow(row = {}) {
  const orderType = String(row.order_type || '').trim().toLowerCase();
  const paymentMethod = String(row.payment_method || '').trim().toLowerCase();
  const orderStatus = String(row.order_status || '').trim().toLowerCase();
  const paymentStatus = String(row.payment_status || '').trim().toLowerCase();
  const pendingStatuses = new Set(['pending', 'requested', 'awaiting_approval', 'awaiting_admin_approval', 'review', 'in_review']);
  const finishedStatuses = new Set(['completed', 'cancelled', 'rejected', 'approved', 'closed', 'failed', 'paid']);

  if (orderType !== 'credit_purchase') return false;
  if (finishedStatuses.has(orderStatus) || finishedStatuses.has(paymentStatus)) return false;

  if (paymentMethod === 'request to admin' || paymentMethod === 'request-to-admin') return true;
  return pendingStatuses.has(orderStatus) || pendingStatuses.has(paymentStatus) || orderStatus === '' || paymentStatus === 'pending';
}

function bearerUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return token ? jwt.verify(token, 'secretkey').user : null;
}

function resolveEventDeliveryPolicy(eventType, rule) {
  const policy = DEFAULT_EVENT_POLICY[eventType] || {};
  const ruleEnabled = rule ? rule.enabled !== false : true;
  return {
    activity: true,
    internal: ruleEnabled && (rule ? rule.enable_internal !== false : policy.internal === true),
    email: ruleEnabled && (rule ? rule.enable_email === true : policy.email === true),
    notifyAdmins: rule ? rule.recipient_roles?.map((role) => String(role).toUpperCase()).includes('ADMIN') : policy.notifyAdmins === true,
  };
}

async function findEventRule(pool, eventType) {
  const aliases = {
    USER_LOGIN: 'sign_in',
    USER_LOGOUT: 'sign_out',
    ASSET_DOWNLOADED: 'download',
    ASSET_FAVORITED: 'favorite',
    ASSET_UPLOADED: 'new_upload',
    USER_REGISTERED: 'new_customer',
    ACCOUNT_STATUS_CHANGED: 'account_status_changed',
  };
  const keys = [...new Set([eventType, aliases[eventType], resolveNotificationEventKey(eventType)].filter(Boolean))];
  const result = await pool.query('SELECT * FROM notification_rules WHERE event_key = ANY($1::text[]) ORDER BY array_position($1::text[], event_key) LIMIT 1', [keys]);
  return result.rows[0];
}

async function recordEvent(pool, eventType, data = {}) {
  if (!EVENT_TYPES.has(eventType)) throw new Error(`Unsupported activity event: ${eventType}`);
  const result = await pool.query(
    `INSERT INTO activity_events(event_type, user_id, user_role, ip_address, asset_id, order_id, payment_id,
      subscription_id, coupon_id, description, metadata, success, error_message)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [eventType, data.userId || null, data.userRole || null, data.ipAddress || null, data.assetId || null,
      data.orderId || null, data.paymentId || null, data.subscriptionId || null, data.couponId || null,
      data.description || eventType.replace(/_/g, ' '), data.metadata || {}, data.success !== false, data.errorMessage || null]
  );

  const rule = await findEventRule(pool, eventType);
  const delivery = resolveEventDeliveryPolicy(eventType, rule);
  const internalEnabled = delivery.internal && data.notificationOnly !== true;
  const emailEnabled = delivery.email && data.notificationOnly !== true;
  const message = data.message || data.description || eventType.replace(/_/g, ' ');
  const subject = data.subject || eventType.replace(/_/g, ' ');

  if (eventType.startsWith('PAYMENT_')) {
    await createPaymentNotifications(pool, {
      userIds: [data.userId],
      eventType,
      message,
      orderId: data.orderId,
      paymentMethod: data.metadata?.payment_method || data.metadata?.gateway,
      customerId: data.userId
    });
  }

  if (ASSET_NOTIFICATION_EVENTS.has(eventType) && data.skipAssetNotification !== true) {
    await createAssetNotifications(pool, {
      userIds: [data.userId, data.metadata?.contributor_id],
      message,
      eventType,
      assetTitle: data.assetTitle || data.metadata?.asset_title,
      ownerId: data.metadata?.contributor_id || data.userId,
      actorId: data.actorId || data.userId,
      status: data.status
    });
  }

  if (internalEnabled) {
    const recipientRoles = Array.isArray(rule?.recipient_roles) ? rule.recipient_roles.map((role) => String(role).toUpperCase()) : [];
    const recipientIds = new Set((Array.isArray(data.notifyUserIds) ? data.notifyUserIds : data.userId && (!recipientRoles.length || recipientRoles.includes(String(data.userRole || '').toUpperCase())) ? [data.userId] : []).map(Number).filter(Boolean));
    const shouldNotifyAdmins = data.notifyAdmins === true || recipientRoles.includes('ADMIN') || (!rule && delivery.notifyAdmins);
    if (shouldNotifyAdmins) {
      const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
      admins.rows.forEach((admin) => recipientIds.add(Number(admin.id)));
    }
    for (const recipientId of recipientIds) {
      await createDirectMessage(pool, { senderId: null, recipientId, subject, body: message, messageType: rule?.message_type || data.messageType || 'SYSTEM_NOTIFICATION', priority: data.priority || 'NORMAL', relatedOrderId: data.orderId, relatedAssetId: data.assetId, relatedPaymentId: data.paymentId, referenceId: data.referenceId });
    }
  }
  if (emailEnabled && data.email) {
    const settings = (await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1')).rows[0] || {};
    const template = rule?.template_id ? (await pool.query('SELECT subject, body FROM email_templates WHERE id = $1', [rule.template_id])).rows[0] : null;
    await enqueueEmail('event-notification', { to: data.email, subject: template?.subject || subject, settings, templateBody: template?.body, templateData: { html: `<p>${message}</p>` }, source: 'event-engine' });
  }
  return result.rows[0];
}

async function publishEvent(pool, eventType, data = {}) {
  return recordBusinessEvent(pool, eventType, data);
}

async function recordBusinessEvent(pool, eventType, data = {}) {
  try {
    return await recordEvent(pool, eventType, data);
  } catch (err) {
    console.error(`Activity event ${eventType} failed:`, err.message || err);
    return null;
  }
}

async function clearConversationVisibilityForParticipants(pool, conversationId, ...participantIds) {
  const flattened = participantIds.flatMap((value) => Array.isArray(value) ? value : [value]);
  const ids = [...new Set(flattened.map(Number).filter((value) => Number.isFinite(value) && value > 0))];
  if (!conversationId || !ids.length) return 0;
  const result = await pool.query('DELETE FROM conversation_hidden_for_users WHERE conversation_id = $1 AND user_id = ANY($2::int[]) RETURNING user_id', [conversationId, ids]);
  return Number(result.rowCount || 0);
}

async function createDirectMessage(pool, { senderId, recipientId, subject, body, messageType = 'DIRECT_MESSAGE', priority = 'NORMAL', conversationId, attachments = [], relatedOrderId, relatedAssetId, relatedPaymentId, referenceId }) {
  const resolvedMessageType = await isMessageTypeEnabled(pool, messageType) ? messageType : 'DIRECT_MESSAGE';
  let id = conversationId;
  if (!id && subject) {
    const existing = await pool.query(`SELECT mc.id FROM message_conversations mc JOIN messages m ON m.conversation_id = mc.id
      WHERE mc.subject = $1 AND (($2::int IS NOT NULL AND ((m.sender_id = $2 AND m.recipient_id = $3) OR (m.sender_id = $3 AND m.recipient_id = $2)))
      OR ($2::int IS NULL AND m.recipient_id = $3)) ORDER BY mc.updated_at DESC LIMIT 1`, [subject, senderId || null, recipientId]);
    id = existing.rows[0]?.id;
  }
  if (!id) {
    id = (await pool.query('INSERT INTO message_conversations(subject, priority) VALUES($1,$2) RETURNING id', [subject || '', priority])).rows[0].id;
    await pool.query("UPDATE message_conversations SET ticket_id = 'GFX-' || LPAD(id::text, 3, '0') WHERE id = $1", [id]);
  }
  const result = await pool.query(
    `INSERT INTO messages(conversation_id, sender_id, recipient_id, message_type, body, attachments,
      related_order_id, related_asset_id, related_payment_id, reference_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [id, senderId || null, recipientId, resolvedMessageType, body, Array.isArray(attachments) ? attachments : [], relatedOrderId || null, relatedAssetId || null, relatedPaymentId || null, referenceId || null]
  );
  const participants = await pool.query(`SELECT DISTINCT user_id FROM (
      SELECT sender_id AS user_id FROM messages WHERE conversation_id = $1 AND sender_id IS NOT NULL
      UNION ALL
      SELECT recipient_id AS user_id FROM messages WHERE conversation_id = $1 AND recipient_id IS NOT NULL
    ) participant_ids`, [id]);
  const participantIds = participants.rows.map((row) => Number(row.user_id)).filter((value) => Number.isFinite(value) && value > 0);
  const adminParticipants = await pool.query("SELECT id FROM users WHERE role = 'admin'");
  participantIds.push(...adminParticipants.rows.map((row) => Number(row.id)).filter((value) => Number.isFinite(value) && value > 0));
  if (participantIds.length) await clearConversationVisibilityForParticipants(pool, id, participantIds);
  await pool.query('UPDATE message_conversations SET updated_at = now() WHERE id = $1', [id]);
  return { ...result.rows[0], conversation_id: id };
}

async function resolveBroadcastRecipients(pool, audience = {}) {
  const config = typeof audience === 'string' ? { type: audience } : audience || {};
  const type = String(config.type || 'everyone').toLowerCase();
  if (type === 'selected_users' || type === 'selected_contributors') {
    const ids = (Array.isArray(config.userIds) ? config.userIds : []).map(Number).filter(Boolean);
    if (!ids.length) return [];
    const roleClause = type === 'selected_contributors' ? " AND role = 'contributor'" : '';
    return (await pool.query(`SELECT id, email, role FROM users WHERE id = ANY($1::int[])${roleClause} AND status <> 'blocked'`, [ids])).rows;
  }
  if (type === 'subscription') {
    if (!config.subscriptionId) return [];
    return (await pool.query('SELECT DISTINCT u.id, u.email, u.role FROM users u JOIN custom_subscriptions s ON s.customer_id = u.id WHERE s.id = $1 AND u.status <> \'blocked\'', [config.subscriptionId])).rows;
  }
  const conditions = ["status <> 'blocked'"];
  const params = [];
  if (type === 'customers') conditions.push("role IN ('customer', 'buyer')");
  if (type === 'contributors') conditions.push("role = 'contributor'");
  if (config.criteria?.role && ['admin', 'customer', 'buyer', 'contributor'].includes(String(config.criteria.role).toLowerCase())) { params.push(String(config.criteria.role).toLowerCase()); conditions.push(`role = $${params.length}`); }
  if (config.criteria?.country) { params.push(String(config.criteria.country)); conditions.push(`country = $${params.length}`); }
  return (await pool.query(`SELECT id, email, role FROM users WHERE ${conditions.join(' AND ')}`, params)).rows;
}

async function deliverBroadcast(pool, broadcast) {
  const config = typeof broadcast.audience === 'string'
    ? (() => {
        try { return JSON.parse(broadcast.audience) || {}; } catch { return { type: broadcast.audience }; }
      })()
    : broadcast.audience || {};
  const recipients = await resolveBroadcastRecipients(pool, config);
  if (broadcast.send_internal) for (const recipient of recipients) await createDirectMessage(pool, { senderId: broadcast.created_by, recipientId: recipient.id, subject: broadcast.subject, body: broadcast.body, messageType: 'SYSTEM_NOTIFICATION', priority: broadcast.priority });
  if (broadcast.send_email) {
    const settings = (await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1')).rows[0] || {};
    for (const recipient of recipients.filter((item) => item.email)) await enqueueEmail('broadcast', { to: recipient.email, subject: broadcast.subject, templateBody: broadcast.body, templateData: {}, settings, source: 'broadcast' });
  }
  return { recipientCount: recipients.length, audienceType: config.type || 'everyone' };
}

async function processScheduledBroadcasts(pool) {
  const due = (await pool.query("SELECT * FROM message_broadcasts WHERE status = 'SCHEDULED' AND scheduled_at <= now() AND (expires_at IS NULL OR expires_at > now()) ORDER BY scheduled_at ASC LIMIT 20")).rows;
  for (const broadcast of due) {
    const claimed = await pool.query("UPDATE message_broadcasts SET status='SENDING' WHERE id=$1 AND status='SCHEDULED' RETURNING *", [broadcast.id]);
    if (!claimed.rows[0]) continue;
    try { await deliverBroadcast(pool, claimed.rows[0]); await pool.query("UPDATE message_broadcasts SET status='SENT' WHERE id=$1", [broadcast.id]); }
    catch (error) { console.error('Scheduled broadcast failed:', error.message || error); await pool.query("UPDATE message_broadcasts SET status='FAILED' WHERE id=$1", [broadcast.id]); }
  }
  await pool.query("UPDATE message_broadcasts SET status='EXPIRED' WHERE status='SCHEDULED' AND expires_at IS NOT NULL AND expires_at <= now()");
}

function createMessagingRouter(pool, authenticateToken, verifyAdmin) {
  const router = express.Router();
  router.use(authenticateToken);
  const broadcastTimer = setInterval(() => processScheduledBroadcasts(pool).catch((error) => console.error('Broadcast scheduler failed:', error.message || error)), 30000);
  broadcastTimer.unref?.();

  router.get('/types', async (req, res) => {
    const result = await pool.query('SELECT code, label, category FROM message_types WHERE enabled = TRUE ORDER BY category, label');
    res.json(result.rows);
  });

  router.get('/recipients', verifyAdmin, async (req, res) => {
    const search = String(req.query.search || '').trim();
    const params = search ? [`%${search}%`] : [];
    const searchClause = search ? ' AND (username ILIKE $1 OR email ILIKE $1 OR full_name ILIKE $1)' : '';
    const result = await pool.query(`SELECT id, username, email, full_name, role
      FROM users WHERE role IN ('admin', 'customer', 'buyer', 'contributor') AND status <> 'blocked'${searchClause}
      ORDER BY username LIMIT 100`, params);
    res.json(result.rows);
  });

  router.get('/summary', async (req, res) => {
    const userRecord = (await pool.query('SELECT role, created_at FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
    const userRole = userRecord.role;
    const isAdmin = String(userRole || '').toLowerCase() === 'admin';
    const visibleFilter = `m.recipient_id = $1`;
    const adminCreatedAtFilter = isAdmin ? ' AND m.created_at >= $2' : '';
    const summaryParams = isAdmin ? [req.user.id, userRecord.created_at] : [req.user.id];
    const [unread, recent] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM messages m WHERE ${visibleFilter}${adminCreatedAtFilter} AND NOT EXISTS (SELECT 1 FROM message_read_for_users read_state WHERE read_state.message_id = m.id AND read_state.user_id = $1)
        AND NOT EXISTS (SELECT 1 FROM message_hidden_for_users hidden WHERE hidden.message_id = m.id AND hidden.user_id = $1)
        AND ((SELECT role FROM users WHERE id = $1) = 'admin' OR NOT EXISTS
          (SELECT 1 FROM messages reply WHERE reply.conversation_id = m.conversation_id AND reply.sender_id = $1 AND reply.created_at > m.created_at))`, summaryParams),
      pool.query(`SELECT m.*, CASE WHEN EXISTS (SELECT 1 FROM message_read_for_users read_state WHERE read_state.message_id = m.id AND read_state.user_id = $1) THEN (SELECT read_state.read_at FROM message_read_for_users read_state WHERE read_state.message_id = m.id AND read_state.user_id = $1) ELSE m.read_at END AS read_at, mc.subject, u.username AS sender_username FROM messages m JOIN message_conversations mc ON mc.id=m.conversation_id LEFT JOIN users u ON u.id=m.sender_id
        WHERE ${visibleFilter}${adminCreatedAtFilter} AND NOT EXISTS (SELECT 1 FROM message_read_for_users read_state WHERE read_state.message_id = m.id AND read_state.user_id = $1) AND NOT EXISTS (SELECT 1 FROM message_hidden_for_users hidden WHERE hidden.message_id = m.id AND hidden.user_id = $1)
        AND ((SELECT role FROM users WHERE id = $1) = 'admin' OR NOT EXISTS
          (SELECT 1 FROM messages reply WHERE reply.conversation_id = m.conversation_id AND reply.sender_id = $1 AND reply.created_at > m.created_at))
        ORDER BY m.created_at DESC LIMIT 8`, summaryParams)
    ]);
    res.json({ unread: unread.rows[0].count, recent: recent.rows });
  });

  router.get('/', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const search = String(req.query.search || '').trim();
    const inboxView = String(req.query.view || '').toLowerCase() === 'inbox';
    const announcementsView = String(req.query.view || '').toLowerCase() === 'announcements';
    const params = [];
    const userRole = (await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id])).rows[0]?.role;
    const isAdmin = String(userRole || '').toLowerCase() === 'admin';
    params.push(req.user.id);
    const adminCreatedAtFilter = isAdmin ? ' AND m.created_at >= $2' : '';
    const adminRecipientView = isAdmin && (inboxView || announcementsView) ? ` OR (
        EXISTS (SELECT 1 FROM users sender_user WHERE sender_user.id = m.sender_id AND sender_user.role <> 'admin')
        AND EXISTS (SELECT 1 FROM messages team_message JOIN users team_admin ON team_admin.id = team_message.sender_id OR team_admin.id = team_message.recipient_id WHERE team_message.conversation_id = m.conversation_id AND team_admin.role = 'admin')
      )` : '';
    const announcementTypeClause = announcementsView ? " AND m.message_type NOT IN ('DIRECT_MESSAGE', 'SUPPORT_MESSAGE')" : '';
    let clause = (isAdmin && !inboxView && !announcementsView) ? `WHERE TRUE${adminCreatedAtFilter}` : `WHERE (m.recipient_id = $1${adminRecipientView})${adminCreatedAtFilter}${announcementTypeClause}${announcementsView ? '' : ' AND NOT EXISTS (SELECT 1 FROM message_read_for_users read_state WHERE read_state.message_id = m.id AND read_state.user_id = $1)'}
      AND NOT EXISTS (SELECT 1 FROM message_hidden_for_users hidden WHERE hidden.message_id = m.id AND hidden.user_id = $1)
      AND NOT EXISTS (SELECT 1 FROM messages reply WHERE reply.conversation_id = m.conversation_id
        AND (reply.sender_id = $1 OR (EXISTS (SELECT 1 FROM users reply_user WHERE reply_user.id = reply.sender_id AND reply_user.role = 'admin') AND EXISTS (SELECT 1 FROM users logged_user WHERE logged_user.id = $1 AND logged_user.role = 'admin')))
        AND reply.created_at > m.created_at)
      AND m.id = (SELECT latest.id FROM messages latest WHERE latest.conversation_id = m.conversation_id AND latest.created_at >= m.created_at ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1)`;
    if (isAdmin) params.push((await pool.query('SELECT created_at FROM users WHERE id = $1', [req.user.id])).rows[0]?.created_at);
    if (search) { params.push(`%${search}%`); const searchPlaceholder = `$${params.length}`; clause += ` AND (m.body ILIKE ${searchPlaceholder} OR mc.subject ILIKE ${searchPlaceholder} OR CAST(mc.id AS TEXT) ILIKE ${searchPlaceholder} OR CAST(m.related_order_id AS TEXT) ILIKE ${searchPlaceholder} OR CAST(m.related_asset_id AS TEXT) ILIKE ${searchPlaceholder} OR CAST(m.related_payment_id AS TEXT) ILIKE ${searchPlaceholder} OR u.username ILIKE ${searchPlaceholder} OR u.email ILIKE ${searchPlaceholder} OR ru.username ILIKE ${searchPlaceholder} OR ru.email ILIKE ${searchPlaceholder} OR m.message_type ILIKE ${searchPlaceholder})`; }
    params.push(limit);
    const result = await pool.query(`SELECT m.*, CASE WHEN EXISTS (SELECT 1 FROM message_read_for_users read_state WHERE read_state.message_id = m.id AND read_state.user_id = $1) THEN (SELECT read_state.read_at FROM message_read_for_users read_state WHERE read_state.message_id = m.id AND read_state.user_id = $1) ELSE m.read_at END AS read_at, mc.subject, mc.ticket_id, mc.priority, mc.status, mc.related_order_id AS conversation_order_id,
      mc.related_asset_id AS conversation_asset_id, mc.related_payment_id AS conversation_payment_id,
      mc.reference_id AS conversation_reference_id, u.username AS sender_username
      FROM messages m JOIN message_conversations mc ON mc.id=m.conversation_id LEFT JOIN users u ON u.id=m.sender_id LEFT JOIN users ru ON ru.id=m.recipient_id
      ${clause} ORDER BY m.created_at DESC LIMIT $${params.length}`, params);
    res.json(result.rows);
  });

  router.get('/conversations', async (req, res) => {
    const userRecord = (await pool.query('SELECT role, created_at FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
    const userRole = userRecord.role;
    const isAdmin = String(userRole || '').toLowerCase() === 'admin';
    const adminCreatedAtFilter = isAdmin ? ' AND m.created_at >= $3' : '';
    const participantCreatedAtFilter = isAdmin ? ' AND participant.created_at >= $3' : '';
    const adminVisibilityClause = isAdmin ? ` OR EXISTS (
        SELECT 1 FROM users admin_user
        WHERE admin_user.role = 'admin'
          AND (admin_user.id = participant.sender_id OR admin_user.id = participant.recipient_id)
      )` : '';
    const result = await pool.query(`SELECT mc.*, MAX(m.created_at) AS last_message_at,
      COUNT(m.id)::int AS message_count,
      COALESCE(SUM(CASE WHEN (m.recipient_id = $1 OR ($2::boolean AND EXISTS (SELECT 1 FROM users recipient_user WHERE recipient_user.id = m.recipient_id AND recipient_user.role = 'admin'))) AND NOT EXISTS (SELECT 1 FROM message_read_for_users read_state WHERE read_state.message_id = m.id AND read_state.user_id = $1) THEN 1 ELSE 0 END), 0)::int AS unread_count
      FROM message_conversations mc JOIN messages m ON m.conversation_id = mc.id
      WHERE m.created_at >= COALESCE($3::timestamptz, m.created_at)${adminCreatedAtFilter} AND EXISTS (SELECT 1 FROM messages participant WHERE participant.conversation_id = mc.id${participantCreatedAtFilter}
        AND (participant.sender_id = $1 OR participant.recipient_id = $1${adminVisibilityClause}))
        AND NOT EXISTS (SELECT 1 FROM conversation_hidden_for_users hidden WHERE hidden.conversation_id = mc.id AND hidden.user_id = $1)
        AND NOT EXISTS (SELECT 1 FROM message_hidden_for_users hidden WHERE hidden.message_id = m.id AND hidden.user_id = $1)
      GROUP BY mc.id ORDER BY last_message_at DESC LIMIT 100`, isAdmin ? [req.user.id, isAdmin, userRecord.created_at] : [req.user.id, isAdmin, null]);
    res.json(result.rows);
  });

  router.get('/conversations/:id', async (req, res) => {
    const userRecord = (await pool.query('SELECT role, created_at FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
    const userRole = userRecord.role;
    const isAdmin = String(userRole || '').toLowerCase() === 'admin';
    const adminCreatedAtFilter = isAdmin ? ' AND m.created_at >= $3' : '';
    const adminVisibilityClause = isAdmin ? ` OR EXISTS (
        SELECT 1 FROM users admin_user
        WHERE admin_user.role = 'admin'
          AND (admin_user.id = m.sender_id OR admin_user.id = m.recipient_id)
      )` : '';
    const reactivateHidden = await pool.query(`DELETE FROM conversation_hidden_for_users hidden
      WHERE hidden.conversation_id = $1 AND hidden.user_id = $2
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = $1
          AND (m.sender_id = $2 OR m.recipient_id = $2)
          AND m.created_at > hidden.hidden_at
      ) RETURNING 1`, [req.params.id, req.user.id]);
    const result = await pool.query(`SELECT m.*, mc.subject, mc.ticket_id, mc.priority, mc.status,
      mc.related_order_id AS conversation_order_id, mc.related_asset_id AS conversation_asset_id,
      mc.related_payment_id AS conversation_payment_id, mc.reference_id AS conversation_reference_id,
      u.username AS sender_username
      FROM messages m JOIN message_conversations mc ON mc.id = m.conversation_id
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE mc.id = $1 AND m.created_at >= COALESCE($3::timestamptz, m.created_at) AND ((m.sender_id = $2 OR m.recipient_id = $2)${adminVisibilityClause})${adminCreatedAtFilter}
        AND NOT EXISTS (SELECT 1 FROM message_hidden_for_users hidden WHERE hidden.message_id = m.id AND hidden.user_id = $2)
      ORDER BY m.created_at DESC`, [req.params.id, req.user.id, isAdmin ? userRecord.created_at : null]);
    if (!result.rows.length) {
      const recovered = await pool.query(`SELECT m.*, mc.subject, mc.ticket_id, mc.priority, mc.status,
        mc.related_order_id AS conversation_order_id, mc.related_asset_id AS conversation_asset_id,
        mc.related_payment_id AS conversation_payment_id, mc.reference_id AS conversation_reference_id,
        u.username AS sender_username
        FROM messages m JOIN message_conversations mc ON mc.id = m.conversation_id
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE mc.id = $1 AND m.created_at >= COALESCE($3::timestamptz, m.created_at) AND (m.sender_id = $2 OR m.recipient_id = $2)
        ORDER BY m.created_at DESC LIMIT 100`, [req.params.id, req.user.id, isAdmin ? userRecord.created_at : null]);
      if (!recovered.rows.length) return res.status(404).json({ error: 'Conversation not found' });
      result.rows = recovered.rows;
    }
    await pool.query(`INSERT INTO message_read_for_users(message_id, user_id)
      SELECT m.id, $2 FROM messages m
      WHERE m.conversation_id = $1 AND (m.recipient_id = $2 OR ($3::boolean AND EXISTS (SELECT 1 FROM users recipient_user WHERE recipient_user.id = m.recipient_id AND recipient_user.role = 'admin')))
      ON CONFLICT (message_id, user_id) DO NOTHING`, [req.params.id, req.user.id, isAdmin]);
    res.json({ conversationId: req.params.id, ticketId: result.rows[0].ticket_id, subject: result.rows[0].subject, messages: result.rows });
  });

  router.delete('/conversations/:id', async (req, res) => {
    const role = (await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id])).rows[0]?.role;
    const isAdmin = String(role || '').toLowerCase() === 'admin';
    const result = await pool.query(`SELECT mc.id, mc.ticket_id FROM message_conversations mc
      WHERE mc.id = $1 AND ($2::boolean OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = mc.id AND (m.sender_id = $3 OR m.recipient_id = $3)))`, [req.params.id, isAdmin, req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Conversation not found' });
    await pool.query('INSERT INTO conversation_hidden_for_users(conversation_id, user_id) VALUES($1, $2) ON CONFLICT DO NOTHING', [result.rows[0].id, req.user.id]);
    res.json({ ok: true, conversationId: result.rows[0].id, ticketId: result.rows[0].ticket_id, deletedForEveryone: false, hiddenForUser: true });
  });

  router.delete('/clear-all', async (req, res) => {
    try {
      const view = String(req.query.view || req.body?.view || '').toLowerCase();
      const role = (await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id])).rows[0]?.role;
      const isAdmin = String(role || '').toLowerCase() === 'admin';
      const userId = Number(req.user.id);
      if (!Number.isInteger(userId) || userId <= 0) return res.status(401).json({ error: 'Invalid user identity' });
      if (!['inbox', 'conversations', 'announcements', 'activity', 'system-events'].includes(view)) {
        return res.status(400).json({ error: 'Unsupported clear-all view' });
      }

      if (view === 'conversations') {
        await pool.query(`INSERT INTO conversation_hidden_for_users(conversation_id, user_id)
          SELECT DISTINCT m.conversation_id, ${userId} FROM messages m
          WHERE m.sender_id = ${userId} OR m.recipient_id = ${userId}
            OR (${isAdmin} AND EXISTS (
              SELECT 1 FROM messages admin_message
              JOIN users admin_user ON admin_user.id = admin_message.sender_id OR admin_user.id = admin_message.recipient_id
              WHERE admin_message.conversation_id = m.conversation_id AND admin_user.role = 'admin'
            )) ON CONFLICT DO NOTHING`);
      } else if (view === 'activity' || view === 'system-events') {
        await pool.query(`INSERT INTO activity_hidden_for_users(event_id, user_id)
          SELECT activity_events.id, ${userId} FROM activity_events
          WHERE ${isAdmin ? 'TRUE' : `activity_events.user_id = ${userId}`} ON CONFLICT DO NOTHING`);
      } else {
        const announcementClause = view === 'announcements' ? " AND m.message_type NOT IN ('DIRECT_MESSAGE', 'SUPPORT_MESSAGE')" : '';
        await pool.query(`INSERT INTO message_hidden_for_users(message_id, user_id)
          SELECT DISTINCT m.id, ${userId} FROM messages m
          WHERE (m.recipient_id = ${userId} OR (${isAdmin} AND EXISTS (
            SELECT 1 FROM users sender_user WHERE sender_user.id = m.sender_id AND sender_user.role <> 'admin'
          )))${announcementClause} ON CONFLICT DO NOTHING`);
      }
      res.json({ ok: true, view });
    } catch (err) {
      console.error('Clear-all error:', err.message || err);
      res.status(500).json({ error: err.message || 'Unable to clear items.' });
    }
  });

  router.get('/activity', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const userRole = (await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id])).rows[0]?.role;
    const meaningfulEvents = [
      'USER_REGISTERED', 'USER_LOGIN', 'USER_LOGOUT', 'USER_LOGIN_FAILED', 'PASSWORD_CHANGED',
      'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'EMAIL_VERIFIED', 'PROFILE_UPDATED',
      'ASSET_VIEWED', 'ASSET_LIKED', 'ASSET_UNLIKED', 'ASSET_FAVORITED', 'ASSET_UNFAVORITED', 'ASSET_DOWNLOADED',
      'CART_CREATED', 'CART_ITEM_ADDED', 'CART_ITEM_REMOVED', 'CART_UPDATED', 'CHECKOUT_STARTED',
      'ORDER_CREATED', 'ORDER_UPDATED', 'ORDER_COMPLETED', 'ORDER_CANCELLED', 'ORDER_FAILED', 'ORDER_REFUNDED',
      'PAYMENT_STARTED', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED',
      'COUPON_CREATED', 'COUPON_APPLIED', 'COUPON_USED', 'COUPON_FAILED', 'COUPON_EXPIRED',
      'SUBSCRIPTION_STARTED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_CHANGED', 'SUBSCRIPTION_CANCELLED',
      'SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_EXPIRING'
    ];
    if (String(userRole || '').toLowerCase() === 'contributor') meaningfulEvents.push(
      'ASSET_UPLOADED', 'ASSET_PROCESSING', 'THUMBNAIL_GENERATION_STARTED', 'THUMBNAIL_GENERATION_COMPLETED',
      'THUMBNAIL_GENERATION_FAILED', 'ASSET_SUBMITTED', 'ASSET_APPROVED', 'ASSET_REJECTED', 'ASSET_UPDATED',
      'ASSET_DELETED', 'EARNING_CREATED', 'PAYOUT_REQUESTED', 'PAYOUT_APPROVED', 'PAYOUT_PROCESSED', 'PAYOUT_FAILED'
    );
    const search = String(req.query.search || '').trim();
    const searchParams = search ? [`%${search}%`] : [];
    const searchClause = search ? ' AND (event_type ILIKE $3 OR description ILIKE $3 OR CAST(asset_id AS TEXT) ILIKE $3 OR CAST(order_id AS TEXT) ILIKE $3)' : '';
    const [result, count] = await Promise.all([
      pool.query(`SELECT id, event_type, asset_id, order_id, description, success, created_at
        FROM activity_events
        WHERE user_id = $1 AND event_type = ANY($2::text[]) AND created_at >= now() - interval '7 days'
          AND NOT EXISTS (SELECT 1 FROM activity_hidden_for_users hidden WHERE hidden.event_id = activity_events.id AND hidden.user_id = $1)${searchClause}
        ORDER BY created_at DESC LIMIT $${searchParams.length + 3} OFFSET $${searchParams.length + 4}`, [req.user.id, meaningfulEvents, ...searchParams, limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS total FROM activity_events WHERE user_id = $1 AND event_type = ANY($2::text[]) AND created_at >= now() - interval '7 days'
        AND NOT EXISTS (SELECT 1 FROM activity_hidden_for_users hidden WHERE hidden.event_id = activity_events.id AND hidden.user_id = $1)${searchClause}`, [req.user.id, meaningfulEvents, ...searchParams])
    ]);
    const total = count.rows[0].total;
    res.json({ rows: result.rows, total, offset, limit, hasMore: offset + result.rows.length < total });
  });

  router.post('/', async (req, res) => {
    const { recipientId, recipientUsername, subject, body, messageType, priority, conversationId, attachments, relatedOrderId, relatedAssetId, relatedPaymentId, referenceId } = req.body || {};
    const hasRecipient = Boolean(recipientId || String(recipientUsername || '').trim());
    const hasMessageType = Boolean(String(messageType || '').trim());
    if (hasRecipient === hasMessageType || !String(subject || '').trim() || !String(body || '').trim()) return res.status(400).json({ error: 'Provide exactly one of recipient or message type, plus subject and body' });
    let recipients;
    if (hasRecipient) {
      const recipient = await pool.query(recipientUsername
        ? 'SELECT id, role FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1'
        : 'SELECT id, role FROM users WHERE id = $1', [recipientUsername || recipientId]);
      if (!recipient.rows[0]) return res.status(404).json({ error: 'Recipient not found' });
      recipients = recipient.rows;
    } else {
      const normalizedType = String(messageType).trim().toUpperCase();
      const targetRoles = normalizedType.includes('CONTRIBUTOR') ? ['contributor']
        : normalizedType.includes('CUSTOMER') ? ['customer', 'buyer']
          : normalizedType.includes('BUYER') ? ['buyer']
            : normalizedType.includes('ADMIN') ? ['admin'] : [];
      if (!targetRoles.length) return res.status(400).json({ error: 'This message type cannot select recipients automatically; choose a recipient username' });
      recipients = (await pool.query('SELECT id, role FROM users WHERE role = ANY($1::text[]) AND status <> \'blocked\' ORDER BY id', [targetRoles])).rows;
      if (!recipients.length) return res.status(404).json({ error: 'No recipients found for this message type' });
    }
    const sender = await pool.query('SELECT id, role, email FROM users WHERE id = $1', [req.user.id]);
    if (sender.rows[0].role !== 'admin' && recipients.some((recipient) => recipient.role !== 'admin')) return res.status(403).json({ error: 'Messages must be sent to an admin' });
    if (messageType && !(await isMessageTypeEnabled(pool, messageType))) return res.status(400).json({ error: 'Unsupported message type' });
    const normalizedPriority = ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority) ? priority : 'NORMAL';
    const created = await Promise.all(recipients.map((recipient) => createDirectMessage(pool, { senderId: req.user.id, recipientId: recipient.id, subject, body: String(body).trim(), messageType, priority: normalizedPriority, conversationId, attachments, relatedOrderId, relatedAssetId, relatedPaymentId, referenceId })));
    res.status(201).json(created[0]);
  });

  router.post('/conversations/:id/messages', async (req, res) => {
    const { body, attachments, messageType, relatedOrderId, relatedAssetId, relatedPaymentId, referenceId } = req.body || {};
    if (!String(body || '').trim()) return res.status(400).json({ error: 'body is required' });
    await pool.query(`DELETE FROM conversation_hidden_for_users hidden
      WHERE hidden.conversation_id = $1 AND hidden.user_id = $2
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = $1
          AND (m.sender_id = $2 OR m.recipient_id = $2)
          AND m.created_at > hidden.hidden_at
      )`, [req.params.id, req.user.id]);

    const participantResult = await pool.query(`SELECT DISTINCT u.id, u.role, mc.subject, mc.priority
      FROM messages m JOIN message_conversations mc ON mc.id = m.conversation_id
      JOIN users u ON u.id = m.sender_id OR u.id = m.recipient_id
      WHERE m.conversation_id = $1`, [req.params.id]);
    const currentUser = (await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id])).rows[0];
    const isAdmin = String(currentUser?.role || '').toLowerCase() === 'admin';
    const participant = participantResult.rows.find((item) => Number(item.id) !== Number(req.user.id) && (isAdmin ? String(item.role || '').toLowerCase() !== 'admin' : String(item.role || '').toLowerCase() === 'admin'));
    if ((!isAdmin && !participantResult.rows.some((item) => Number(item.id) === Number(req.user.id))) || !participant) return res.status(404).json({ error: 'Conversation not found' });

    res.status(201).json(await createDirectMessage(pool, {
      senderId: req.user.id,
      recipientId: Number(participant.id),
      subject: participant.subject,
      body: String(body).trim(),
      messageType,
      priority: participant.priority,
      conversationId: req.params.id,
      attachments,
      relatedOrderId,
      relatedAssetId,
      relatedPaymentId,
      referenceId,
    }));
  });

  router.put('/:id/read', async (req, res) => {
    const message = await pool.query(`SELECT m.id FROM messages m
      WHERE m.id = $1 AND (m.recipient_id = $2 OR (
        EXISTS (SELECT 1 FROM users current_user_role WHERE current_user_role.id = $2 AND current_user_role.role = 'admin')
        AND EXISTS (SELECT 1 FROM users recipient_role WHERE recipient_role.id = m.recipient_id AND recipient_role.role = 'admin')
      ))`, [req.params.id, req.user.id]);
    if (!message.rows[0]) return res.status(404).json({ error: 'Message not found' });
    const result = await pool.query(`INSERT INTO message_read_for_users(message_id, user_id)
      VALUES($1, $2) ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = now()
      RETURNING message_id AS id, read_at`, [req.params.id, req.user.id]);
    res.json(result.rows[0]);
  });

  router.put('/:id/unread', async (req, res) => {
    const message = await pool.query(`SELECT m.id FROM messages m
      WHERE m.id = $1 AND (m.recipient_id = $2 OR (
        EXISTS (SELECT 1 FROM users current_user_role WHERE current_user_role.id = $2 AND current_user_role.role = 'admin')
        AND EXISTS (SELECT 1 FROM users recipient_role WHERE recipient_role.id = m.recipient_id AND recipient_role.role = 'admin')
      ))`, [req.params.id, req.user.id]);
    if (!message.rows[0]) return res.status(404).json({ error: 'Message not found' });
    await pool.query('DELETE FROM message_read_for_users WHERE message_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ id: Number(req.params.id), read_at: null });
  });

  router.delete('/:id', async (req, res) => {
    const role = (await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id])).rows[0]?.role;
    const isAdmin = String(role || '').toLowerCase() === 'admin';
    const result = await pool.query(`SELECT m.id FROM messages m
      WHERE m.id = $1 AND (m.sender_id = $2 OR m.recipient_id = $2 OR ($3::boolean AND EXISTS (
        SELECT 1 FROM messages admin_message
        JOIN users admin_user ON admin_user.id = admin_message.sender_id OR admin_user.id = admin_message.recipient_id
        WHERE admin_message.conversation_id = m.conversation_id AND admin_user.role = 'admin'
      )))`, [req.params.id, req.user.id, isAdmin]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Message not found' });
    if (isAdmin) {
      await pool.query(`
        INSERT INTO message_hidden_for_users(message_id, user_id)
        SELECT $1, id FROM users WHERE role = 'admin'
        ON CONFLICT DO NOTHING
      `, [result.rows[0].id]);
      return res.json({ ok: true, messageId: result.rows[0].id, deletedForEveryone: true, hiddenForAdmins: true });
    }
    await pool.query('INSERT INTO message_hidden_for_users(message_id, user_id) VALUES($1, $2) ON CONFLICT DO NOTHING', [result.rows[0].id, req.user.id]);
    res.json({ ok: true, messageId: result.rows[0].id, deletedForEveryone: false, hiddenForUser: true });
  });

  router.put('/read-all', async (req, res) => {
    await pool.query(`INSERT INTO message_read_for_users(message_id, user_id)
      SELECT m.id, $1 FROM messages m
      WHERE m.recipient_id = $1 OR (EXISTS (SELECT 1 FROM users current_user_role WHERE current_user_role.id = $1 AND current_user_role.role = 'admin')
        AND EXISTS (SELECT 1 FROM users recipient_role WHERE recipient_role.id = m.recipient_id AND recipient_role.role = 'admin'))
      ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = now()`, [req.user.id]);
    res.json({ ok: true });
  });

  router.get('/admin/activity/export', verifyAdmin, async (req, res) => {
    const result = await pool.query(`SELECT a.id, a.event_type, a.user_id, a.user_role, u.username, u.email,
        a.description, a.success, a.created_at
      FROM activity_events a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.created_at >= now() - interval '180 days'
      ORDER BY a.created_at DESC`);
    const csvValue = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const header = ['id', 'event_type', 'user_id', 'user_role', 'username', 'email', 'description', 'success', 'created_at'];
    const csv = [header, ...result.rows.map((row) => header.map((field) => csvValue(row[field])))].map((row) => row.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="admin-activity-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  });

  router.get('/admin/activity/counts', verifyAdmin, async (req, res) => {
    const result = await pool.query(`SELECT event_type, COUNT(*)::int AS count
      FROM activity_events
      WHERE NOT EXISTS (SELECT 1 FROM activity_hidden_for_users hidden WHERE hidden.event_id = activity_events.id AND hidden.user_id = $1)
        AND created_at >= CURRENT_DATE
        AND created_at < CURRENT_DATE + interval '1 day'
        AND created_at >= now() - interval '180 days'
      GROUP BY event_type
      ORDER BY event_type`, [req.user.id]);
    res.json(result.rows);
  });

  router.get('/admin/activity', verifyAdmin, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const params = [];
    const filters = [];
    const addFilter = (sql, value) => { params.push(value); filters.push(sql.replace('?', `$${params.length}`)); };
    const user = String(req.query.user || '').trim();
    const role = String(req.query.role || '').trim().toLowerCase();
    const category = String(req.query.category || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim();
    if (user) {
      if (/^\d+$/.test(user)) addFilter('a.user_id = ?', Number(user));
      else { params.push(`%${user}%`); filters.push(`(u.username ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    }
    if (role) addFilter("LOWER(COALESCE(a.user_role, u.role, '')) = ?", role);
    if (req.query.eventType) addFilter('a.event_type = ?', String(req.query.eventType).trim().toUpperCase());
    if (search) { params.push(`%${search}%`); filters.push(`(a.event_type ILIKE $${params.length} OR a.description ILIKE $${params.length} OR a.metadata::text ILIKE $${params.length} OR u.username ILIKE $${params.length} OR u.email ILIKE $${params.length} OR CAST(a.asset_id AS TEXT) ILIKE $${params.length} OR CAST(a.order_id AS TEXT) ILIKE $${params.length} OR CAST(a.payment_id AS TEXT) ILIKE $${params.length})`); }
    if (category === 'admin') filters.push("(a.event_type LIKE 'ADMIN_%' OR LOWER(COALESCE(a.user_role, u.role, '')) = 'admin')");
    if (category === 'security') filters.push("a.event_type IN ('USER_LOGIN', 'USER_LOGOUT', 'USER_LOGIN_FAILED', 'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'EMAIL_VERIFIED', 'ADMIN_LOGIN', 'ADMIN_LOGOUT')");
    if (['asset', 'order', 'payment', 'subscription', 'coupon'].includes(category)) {
      const upper = category.toUpperCase();
      filters.push(`(a.event_type LIKE '${upper}_%' OR a.${category}_id IS NOT NULL)`);
    }
    if (req.query.from) addFilter('a.created_at >= ?::timestamptz', String(req.query.from));
    if (req.query.to) addFilter('a.created_at <= ?::timestamptz', String(req.query.to));
    for (const field of ['asset', 'order', 'payment', 'subscription', 'coupon']) {
      if (req.query[field] && /^\d+$/.test(String(req.query[field]))) addFilter(`a.${field}_id = ?`, Number(req.query[field]));
    }
    filters.push(`NOT EXISTS (SELECT 1 FROM activity_hidden_for_users hidden WHERE hidden.event_id = a.id AND hidden.user_id = $${params.length + 1})`);
    params.push(req.user.id);
    filters.push("a.created_at >= now() - interval '180 days'");
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const limitPlaceholder = params.length + 1;
    const offsetPlaceholder = params.length + 2;
    const [result, count] = await Promise.all([
      pool.query(`SELECT a.*, u.username, u.email FROM activity_events a LEFT JOIN users u ON u.id=a.user_id ${where} ORDER BY a.created_at DESC LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}`, [...params, limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS total FROM activity_events a LEFT JOIN users u ON u.id=a.user_id ${where}`, params)
    ]);
    const total = count.rows[0].total;
    res.json({ rows: result.rows, total, offset, limit, hasMore: offset + result.rows.length < total });
  });
  router.get('/admin/inbox', verifyAdmin, async (req, res) => {
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_inbox_closed (
      admin_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id BIGINT NOT NULL,
      closed_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (admin_id, source_type, source_id)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_inbox_read (
      admin_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id BIGINT NOT NULL,
      read_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (admin_id, source_type, source_id)
    )`);
    const activityTypes = ['ASSET_SUBMITTED', 'PAYOUT_REQUESTED'];
    const activities = await pool.query(`
      SELECT a.id, 'activity' AS source_type, a.event_type AS category, a.description,
             a.user_id, u.username, a.order_id, a.asset_id, a.subscription_id,
             a.payment_id, a.coupon_id, a.created_at,
             EXISTS (
               SELECT 1 FROM admin_inbox_read r
               WHERE r.admin_id = $2 AND r.source_type = 'activity' AND r.source_id = a.id
             ) AS is_read,
             (SELECT r.read_at FROM admin_inbox_read r WHERE r.admin_id = $2 AND r.source_type = 'activity' AND r.source_id = a.id) AS read_at
      FROM activity_events a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.event_type = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM admin_inbox_closed c WHERE c.admin_id = $2 AND c.source_type = 'activity' AND c.source_id = a.id)
        AND a.event_type IN ('ASSET_SUBMITTED', 'PAYOUT_REQUESTED')
        AND LOWER(COALESCE(a.description, '')) NOT SIMILAR TO '%(approved|approv|rejected|reject|completed|complete|cancelled|cancel|revoked|revoke|closed|close|resolved|resolve)%'
      ORDER BY a.created_at DESC LIMIT 200`, [activityTypes, req.user.id]);
    const messages = await pool.query(`
      SELECT m.id, 'message' AS source_type, mc.subject AS category, m.body AS description,
             m.sender_id AS user_id, u.username, m.related_order_id AS order_id,
             m.related_asset_id AS asset_id, m.related_payment_id AS payment_id,
             m.created_at,
             EXISTS (
               SELECT 1 FROM admin_inbox_read r
               WHERE r.admin_id = $1 AND r.source_type = 'message' AND r.source_id = m.id
             ) AS is_read,
             (SELECT r.read_at FROM admin_inbox_read r WHERE r.admin_id = $1 AND r.source_type = 'message' AND r.source_id = m.id) AS read_at
      FROM messages m
      JOIN message_conversations mc ON mc.id = m.conversation_id
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE (m.recipient_id = $1 OR EXISTS (SELECT 1 FROM users r WHERE r.id = m.recipient_id AND r.role = 'admin'))
        AND (LOWER(mc.subject) LIKE ANY($2::text[]) OR LOWER(m.body) LIKE ANY($2::text[]))
        AND NOT EXISTS (SELECT 1 FROM admin_inbox_closed c WHERE c.admin_id = $1 AND c.source_type = 'message' AND c.source_id = m.id)
        AND LOWER(COALESCE(mc.subject, '') || ' ' || COALESCE(m.body, '')) NOT SIMILAR TO '%(approved|approv|rejected|reject|completed|complete|cancelled|cancel|revoked|revoke|closed|close|resolved|resolve)%'
      ORDER BY m.created_at DESC LIMIT 200`, [req.user.id, ['%asset review required%', '%credit request approval%', '%payout approval%', '%subscription approval%']]);
    const [pendingAssets, pendingCredits, pendingPayouts, pendingSubscriptions, pendingContributors] = await Promise.all([
      pool.query(`SELECT i.id, 'asset-request' AS source_type, 'Asset review required' AS category,
                         CONCAT('Asset uploaded by ', COALESCE(u.username, 'unknown'), ' is awaiting approval: ', COALESCE(i.title, 'Untitled'), '.') AS description,
                         i.uploaded_by AS user_id, u.username, i.id AS asset_id, i.created_at,
                         EXISTS (
                           SELECT 1 FROM admin_inbox_read r
                           WHERE r.admin_id = $1 AND r.source_type = 'asset-request' AND r.source_id = i.id
                         ) AS is_read,
                         (SELECT r.read_at FROM admin_inbox_read r WHERE r.admin_id = $1 AND r.source_type = 'asset-request' AND r.source_id = i.id) AS read_at
                  FROM images i LEFT JOIN users u ON u.id = i.uploaded_by
                  WHERE LOWER(COALESCE(i.status, '')) IN ('pending', 'submitted', 'awaiting_approval')
                    AND NOT EXISTS (SELECT 1 FROM admin_inbox_closed c WHERE c.admin_id = $1 AND c.source_type = 'asset-request' AND c.source_id = i.id)
                  ORDER BY i.created_at DESC LIMIT 200`, [req.user.id]),
      pool.query(`SELECT o.id, 'credit-request' AS source_type,
                         CASE
                           WHEN LOWER(COALESCE(o.payment_method, '')) = 'request to admin' THEN 'Customer credit request pending approval'
                           ELSE 'Credit request approval required'
                         END AS category,
                         CONCAT('Customer ', COALESCE(u.username, COALESCE(u.email, 'unknown')), ' requested credits in order ', COALESCE(o.order_number, o.id::text), '.') AS description,
                         o.customer_id AS user_id, u.username, o.id AS order_id, o.created_at,
                         EXISTS (
                           SELECT 1 FROM admin_inbox_read r
                           WHERE r.admin_id = $1 AND r.source_type = 'credit-request' AND r.source_id = o.id
                         ) AS is_read,
                         (SELECT r.read_at FROM admin_inbox_read r WHERE r.admin_id = $1 AND r.source_type = 'credit-request' AND r.source_id = o.id) AS read_at
                  FROM orders o JOIN users u ON u.id = o.customer_id
                  WHERE o.order_type = 'credit_purchase'
                    AND (
                      LOWER(COALESCE(o.payment_method, '')) = 'request to admin'
                      OR LOWER(COALESCE(o.order_status, '')) IN ('pending', 'requested', 'awaiting_approval', 'awaiting_admin_approval', 'review', 'in_review')
                      OR LOWER(COALESCE(o.payment_status, '')) IN ('pending', 'awaiting_payment', 'awaiting_approval')
                    )
                    AND LOWER(COALESCE(o.order_status, '')) NOT IN ('completed', 'cancelled', 'rejected', 'approved', 'closed', 'failed', 'paid')
                    AND LOWER(COALESCE(o.payment_status, '')) NOT IN ('completed', 'cancelled', 'rejected', 'approved', 'closed', 'failed', 'paid')
                    AND NOT EXISTS (SELECT 1 FROM admin_inbox_closed c WHERE c.admin_id = $1 AND c.source_type = 'credit-request' AND c.source_id = o.id)
                  ORDER BY o.created_at DESC LIMIT 200`, [req.user.id]),
      pool.query(`SELECT p.id, 'payout-request' AS source_type, 'Payout approval required' AS category,
                         CONCAT('Contributor ', COALESCE(u.username, 'unknown'), ' requested payout of ', p.requested_credits, ' credits.') AS description,
                         p.contributor_id AS user_id, u.username, p.created_at,
                         EXISTS (
                           SELECT 1 FROM admin_inbox_read r
                           WHERE r.admin_id = $1 AND r.source_type = 'payout-request' AND r.source_id = p.id
                         ) AS is_read,
                         (SELECT r.read_at FROM admin_inbox_read r WHERE r.admin_id = $1 AND r.source_type = 'payout-request' AND r.source_id = p.id) AS read_at
                  FROM payout_requests p JOIN users u ON u.id = p.contributor_id
                  WHERE LOWER(COALESCE(p.status, 'pending')) IN ('pending', 'reviewed')
                    AND NOT EXISTS (SELECT 1 FROM admin_inbox_closed c WHERE c.admin_id = $1 AND c.source_type = 'payout-request' AND c.source_id = p.id)
                  ORDER BY p.created_at DESC LIMIT 200`, [req.user.id]),
      pool.query(`SELECT s.id, 'subscription-request' AS source_type, 'Subscription approval required' AS category,
                         CONCAT('Subscription ', COALESCE(s.base_plan, 'Custom Subscription'), ' for ', COALESCE(u.username, s.customer_email, 'customer'), ' is awaiting approval.') AS description,
                         s.customer_id AS user_id, u.username, s.id AS subscription_id, s.created_at,
                         EXISTS (
                           SELECT 1 FROM admin_inbox_read r
                           WHERE r.admin_id = $1 AND r.source_type = 'subscription-request' AND r.source_id = s.id
                         ) AS is_read,
                         (SELECT r.read_at FROM admin_inbox_read r WHERE r.admin_id = $1 AND r.source_type = 'subscription-request' AND r.source_id = s.id) AS read_at
                  FROM custom_subscriptions s LEFT JOIN users u ON u.id = s.customer_id
                  WHERE LOWER(COALESCE(s.status, 'pending')) IN ('pending', 'requested', 'awaiting_approval')
                    AND NOT EXISTS (SELECT 1 FROM admin_inbox_closed c WHERE c.admin_id = $1 AND c.source_type = 'subscription-request' AND c.source_id = s.id)
                  ORDER BY s.created_at DESC LIMIT 200`, [req.user.id]),
      pool.query(`SELECT u.id, 'contributor-request' AS source_type, 'New contributor approval required' AS category,
                         CONCAT('New contributor ', COALESCE(u.username, u.email, 'unknown'), ' is awaiting approval.') AS description,
                         u.id AS user_id, u.username, u.created_at,
                         EXISTS (
                           SELECT 1 FROM admin_inbox_read r
                           WHERE r.admin_id = $1 AND r.source_type = 'contributor-request' AND r.source_id = u.id
                         ) AS is_read,
                         (SELECT r.read_at FROM admin_inbox_read r WHERE r.admin_id = $1 AND r.source_type = 'contributor-request' AND r.source_id = u.id) AS read_at
                  FROM users u
                  WHERE LOWER(TRIM(COALESCE(u.role, ''))) = 'contributor'
                    AND LOWER(COALESCE(u.status, 'pending')) IN ('pending', 'awaiting_approval', 'requested', 'review')
                    AND NOT EXISTS (SELECT 1 FROM admin_inbox_closed c WHERE c.admin_id = $1 AND c.source_type = 'contributor-request' AND c.source_id = u.id)
                  ORDER BY u.created_at DESC LIMIT 200`, [req.user.id])
    ]);
    const rows = [...activities.rows, ...messages.rows, ...pendingAssets.rows, ...pendingCredits.rows, ...pendingPayouts.rows, ...pendingSubscriptions.rows, ...pendingContributors.rows]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(normalizeAdminInboxReadState(rows));
  });

  router.post('/admin/inbox/:sourceType/:sourceId/read', verifyAdmin, async (req, res) => {
    const sourceType = String(req.params.sourceType || '').trim();
    const sourceId = Number(req.params.sourceId);
    if (!['activity', 'message', 'asset-request', 'credit-request', 'payout-request', 'subscription-request', 'contributor-request'].includes(sourceType) || !Number.isInteger(sourceId) || sourceId <= 0) {
      return res.status(400).json({ error: 'Invalid admin inbox item' });
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_inbox_read (
      admin_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id BIGINT NOT NULL,
      read_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (admin_id, source_type, source_id)
    )`);
    const result = await pool.query(`INSERT INTO admin_inbox_read(admin_id, source_type, source_id, read_at)
      VALUES($1,$2,$3,now())
      ON CONFLICT (admin_id, source_type, source_id) DO UPDATE SET read_at = now()
      RETURNING read_at`, [req.user.id, sourceType, sourceId]);
    res.json({ ok: true, sourceType, sourceId, read_at: result.rows[0]?.read_at || new Date().toISOString() });
  });

  router.post('/admin/inbox/:sourceType/:sourceId/close', verifyAdmin, async (req, res) => {
    const sourceType = String(req.params.sourceType || '').trim();
    const sourceId = Number(req.params.sourceId);
    if (!['activity', 'message', 'asset-request', 'credit-request', 'payout-request', 'subscription-request', 'contributor-request'].includes(sourceType) || !Number.isInteger(sourceId) || sourceId <= 0) {
      return res.status(400).json({ error: 'Invalid admin inbox item' });
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_inbox_closed (
      admin_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id BIGINT NOT NULL,
      closed_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (admin_id, source_type, source_id)
    )`);
    await pool.query(`INSERT INTO admin_inbox_closed(admin_id, source_type, source_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [req.user.id, sourceType, sourceId]);
    res.json({ ok: true, sourceType, sourceId });
  });

  router.get('/admin/broadcasts', verifyAdmin, async (req, res) => {
    const result = await pool.query('SELECT id, subject, body, audience, priority, send_internal, send_email, scheduled_at, expires_at, status, created_by, created_at FROM message_broadcasts ORDER BY created_at DESC LIMIT 100');
    res.json(result.rows.map((row) => ({ ...row, audience: typeof row.audience === 'string' ? (() => { try { return JSON.parse(row.audience); } catch { return { type: row.audience }; } })() : row.audience })));
  });

  router.post('/admin/broadcasts/preview', verifyAdmin, async (req, res) => {
    const { subject = '', body = '', audience = { type: 'everyone' }, priority = 'NORMAL' } = req.body || {};
    const recipients = await resolveBroadcastRecipients(pool, audience);
    res.json({ subject: String(subject), body: String(body), priority, recipientCount: recipients.length });
  });

  router.post('/admin/broadcasts/test', verifyAdmin, async (req, res) => {
    const { to, subject, body } = req.body || {};
    if (!to || !String(body || '').trim()) return res.status(400).json({ error: 'to and body are required' });
    const settings = (await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1')).rows[0] || {};
    await enqueueEmail('broadcast-test', { to, subject: subject || 'Broadcast test', templateBody: body, templateData: {}, settings, source: 'broadcast-test' });
    res.json({ ok: true });
  });

  router.post('/admin/broadcasts', verifyAdmin, async (req, res) => {
    const { id, subject, body, audience = { type: 'everyone' }, priority = 'NORMAL', sendInternal = true, sendEmail = false, scheduledAt, expiresAt, action = 'save' } = req.body || {};
    if (!String(subject || '').trim() || !String(body || '').trim()) return res.status(400).json({ error: 'subject and body are required' });
    if (!sendInternal && !sendEmail) return res.status(400).json({ error: 'Select internal notification, email, or both' });
    const normalizedPriority = ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(String(priority).toUpperCase()) ? String(priority).toUpperCase() : null;
    if (!normalizedPriority) return res.status(400).json({ error: 'Invalid priority' });
    const status = scheduledAt && new Date(scheduledAt) > new Date() ? 'SCHEDULED' : action === 'send' ? 'SENDING' : 'DRAFT';
    const serializedAudience = JSON.stringify(audience);
    let saved;
    if (id) saved = (await pool.query('UPDATE message_broadcasts SET subject=$1, body=$2, audience=$3, priority=$4, send_internal=$5, send_email=$6, scheduled_at=$7, expires_at=$8, status=$9 WHERE id=$10 RETURNING *', [subject, body, serializedAudience, normalizedPriority, sendInternal, sendEmail, scheduledAt || null, expiresAt || null, status, id])).rows[0];
    else saved = (await pool.query('INSERT INTO message_broadcasts(subject, body, audience, priority, send_internal, send_email, scheduled_at, expires_at, status, created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [subject, body, serializedAudience, normalizedPriority, sendInternal, sendEmail, scheduledAt || null, expiresAt || null, status, req.user.id])).rows[0];
    if (status === 'SENDING') { const delivery = await deliverBroadcast(pool, saved); await pool.query("UPDATE message_broadcasts SET status='SENT' WHERE id=$1", [saved.id]); return res.json({ ...saved, status: 'SENT', ...delivery }); }
    res.json(saved);
  });

  router.post('/admin/broadcasts/:id/cancel', verifyAdmin, async (req, res) => {
    const result = await pool.query("UPDATE message_broadcasts SET status='CANCELLED' WHERE id=$1 AND status='SCHEDULED' RETURNING id, status", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Scheduled broadcast not found' });
    res.json(result.rows[0]);
  });

  router.get('/admin/rules', verifyAdmin, async (req, res) => res.json((await pool.query('SELECT * FROM notification_rules ORDER BY event_key')).rows));
  router.put('/admin/rules/:eventKey', verifyAdmin, async (req, res) => {
    const { enableInternal, enableEmail, recipients, recipientRoles, templateId, enabled } = req.body || {};
    const result = await pool.query('UPDATE notification_rules SET enable_internal=$1, enable_email=$2, recipients=$3, recipient_roles=$4, template_id=$5, enabled=$6, updated_at=now() WHERE event_key=$7 RETURNING *', [enableInternal !== false, enableEmail === true, recipients || [], recipientRoles || [], templateId || null, enabled !== false, req.params.eventKey]);
    res.json(result.rows[0] || {});
  });

  router.post('/support', async (req, res) => {
    const { subject, body, priority, attachments, relatedOrderId, relatedAssetId, relatedPaymentId, referenceId } = req.body || {};
    if (!String(body || '').trim()) return res.status(400).json({ error: 'body is required' });
    const sender = (await pool.query('SELECT id, role FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!sender || !['customer', 'buyer', 'contributor'].includes(String(sender.role).toLowerCase())) return res.status(403).json({ error: 'Support chat is available to customers and contributors' });
    const admins = (await pool.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id")).rows.map((row) => Number(row.id)).filter(Boolean);
    if (!admins.length) return res.status(503).json({ error: 'No admin is available to receive messages' });
    const normalizedPriority = ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority) ? priority : 'NORMAL';
    const supportSubject = subject || 'Support request';
    const created = await createDirectMessage(pool, {
      senderId: req.user.id,
      recipientId: admins[0],
      subject: supportSubject,
      body: String(body).trim(),
      messageType: 'SUPPORT_MESSAGE',
      priority: normalizedPriority,
      attachments,
      relatedOrderId,
      relatedAssetId,
      relatedPaymentId,
      referenceId,
    });
    res.status(201).json(created || { ok: true, conversation_id: null });
  });

  return router;
}

module.exports = { createMessagingRouter, createDirectMessage, clearConversationVisibilityForParticipants, createAssetNotifications, createCouponNotifications, normalizeAdminInboxReadState, isAdminInboxCreditRequestRow, recordEvent, recordBusinessEvent, publishEvent, EVENT_TYPES, resolveEventDeliveryPolicy };