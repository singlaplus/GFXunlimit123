const fs = require("node:fs/promises");
const path = require("node:path");

const NEWSLETTER_AUDIENCES = new Set([
  "customer_active",
  "customer_inactive",
  "contributor_active",
  "contributor_inactive",
  "all",
]);
const NEWSLETTER_ATTACHMENT_FOLDER = "Newsletter attachment";
const NEWSLETTER_ATTACHMENT_FILENAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.[a-z0-9]{1,10})?$/;
const NEWSLETTER_ATTACHMENT_CONTENT_TYPES = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

async function enqueueEmail(...args) {
  const queue = require("../email/queue");
  return queue.enqueueEmail(...args);
}

function normalizeRecipientEmails(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[,\s;]+/);
  return [...new Set(values.map((email) => String(email || "").trim().toLowerCase()).filter(Boolean))];
}

function isNewsletterAttachmentFilename(value) {
  return NEWSLETTER_ATTACHMENT_FILENAME_PATTERN.test(String(value || ""));
}

function getNewsletterAttachmentContentType(filename) {
  return NEWSLETTER_ATTACHMENT_CONTENT_TYPES[path.extname(String(filename || "")).toLowerCase()]
    || "application/octet-stream";
}

async function resolveNewsletterAttachments(value, attachmentStorageDirectory) {
  const attachments = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? JSON.parse(value)
      : [];
  if (!Array.isArray(attachments) || attachments.length > 5) {
    throw new Error("Newsletter attachment records are invalid.");
  }
  if (attachments.length === 0) return [];
  const directory = typeof attachmentStorageDirectory === "function"
    ? attachmentStorageDirectory()
    : attachmentStorageDirectory;
  if (!directory) throw new Error("Newsletter attachment storage is not configured.");

  const resolvedDirectory = path.resolve(directory);
  const resolved = [];
  let totalSize = 0;
  for (const attachment of attachments) {
    const filename = String(attachment?.filename || "");
    if (!isNewsletterAttachmentFilename(filename)) {
      throw new Error("A newsletter attachment record is invalid.");
    }
    const filePath = path.resolve(resolvedDirectory, filename);
    if (path.dirname(filePath) !== resolvedDirectory) {
      throw new Error("A newsletter attachment path is invalid.");
    }
    const stats = await fs.lstat(filePath);
    if (!stats.isFile()) throw new Error("A newsletter attachment is unavailable.");
    totalSize += stats.size;
    const suppliedName = String(attachment?.name || "attachment").split(/[\\/]/).pop();
    const name = suppliedName
      .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
      .trim()
      .slice(0, 180) || "attachment";
    const contentType = getNewsletterAttachmentContentType(filename);
    const isInlineImage = contentType.startsWith("image/");
    const cid = String(attachment?.cid || "");
    if (isInlineImage && cid !== `newsletter-${path.basename(filename, path.extname(filename))}@newsletter.gfxunlimit`) {
      throw new Error("A newsletter inline image reference is invalid.");
    }
    resolved.push({
      filename: name,
      path: filePath,
      contentType,
      ...(isInlineImage
        ? { cid, contentDisposition: "inline" }
        : {})
    });
  }
  if (totalSize > 20 * 1024 * 1024) {
    throw new Error("Newsletter attachments must total 20 MB or less.");
  }
  return resolved;
}

function getAudienceConditions(audience, values = []) {
  const normalizedAudience = String(audience || "").trim().toLowerCase();
  if (!NEWSLETTER_AUDIENCES.has(normalizedAudience)) {
    throw new Error("Choose a valid newsletter audience.");
  }

  const conditions = [
    "LOWER(BTRIM(COALESCE(role, ''))) IN ('customer', 'contributor')",
    "NULLIF(BTRIM(email), '') IS NOT NULL",
  ];
  const params = [];

  if (normalizedAudience !== "all") {
    const [role, activity] = normalizedAudience.split("_");
    params.push(role);
    conditions.push(`LOWER(BTRIM(COALESCE(role, ''))) = $${params.length}`);
    conditions.push(activity === "active"
      ? "last_login_at >= NOW() - INTERVAL '30 days'"
      : "(last_login_at IS NULL OR last_login_at < NOW() - INTERVAL '30 days')");
  }

  if (values.search) {
    params.push(`%${String(values.search).trim()}%`);
    conditions.push(`(email ILIKE $${params.length} OR username ILIKE $${params.length} OR full_name ILIKE $${params.length})`);
  }

  if (values.emails) {
    params.push(values.emails);
    conditions.push(`LOWER(BTRIM(email)) = ANY($${params.length}::text[])`);
  }

  return { conditions, params };
}

async function findNewsletterRecipients(poolRef, audience, { search = "", emails = null } = {}) {
  const normalizedSearch = String(search || "").trim();
  const requestedEmails = emails ? normalizeRecipientEmails(emails) : null;
  const { conditions, params } = getAudienceConditions(audience, {
    search: normalizedSearch,
    emails: requestedEmails,
  });
  const result = await poolRef.query(
    `SELECT id, username, full_name, email, role, last_login_at
     FROM users
     WHERE ${conditions.join(" AND ")}
     ORDER BY LOWER(email), id
     LIMIT ${requestedEmails ? 10000 : 100}`,
    params
  );
  return result.rows;
}

async function queueNewsletterCampaign({
  poolRef,
  campaign,
  enqueueEmailImpl = enqueueEmail,
  attachmentStorageDirectory,
}) {
  const requestedEmails = normalizeRecipientEmails(campaign.recipients);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (requestedEmails.length === 0) {
    throw new Error("Select at least one newsletter recipient.");
  }
  if (requestedEmails.some((email) => !emailPattern.test(email))) {
    throw new Error("Remove invalid email addresses from the recipient list.");
  }
  const eligibleRecipients = await findNewsletterRecipients(poolRef, campaign.audience, {
    emails: requestedEmails,
  });
  const recipientsByEmail = new Map(eligibleRecipients.map((recipient) => [
    String(recipient.email).trim().toLowerCase(),
    recipient
  ]));
  const recipients = requestedEmails.map((email) => (
    recipientsByEmail.get(email) || { email }
  ));
  const attachments = await resolveNewsletterAttachments(
    campaign.attachments,
    attachmentStorageDirectory
  );
  const newsletterSettingsResult = await poolRef.query(
    `SELECT * FROM promotion_newsletter_smtp_settings WHERE id = 1`
  );
  const newsletterSettings = newsletterSettingsResult.rows[0] || (
    await poolRef.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1')
  ).rows[0] || {};

  for (const recipient of recipients) {
    const jobId = await enqueueEmailImpl("send-email", {
      to: recipient.email,
      recipient: recipient.email,
      subject: campaign.subject,
      templateBody: campaign.body,
      templateData: { recipient_name: recipient.full_name || recipient.username || "" },
      event: "newsletter",
      relatedUserId: recipient.id,
      campaignId: campaign.id,
      attachments,
      settings: newsletterSettings,
    });
    await poolRef.query(
      `INSERT INTO promotion_email_logs (campaign_id, recipient, status, metadata)
       VALUES ($1, $2, 'queued', $3)`,
      [campaign.id, recipient.email, JSON.stringify({ job_id: jobId })]
    );
  }

  const updateResult = await poolRef.query(
    `UPDATE promotion_email_campaigns
     SET status = 'sent', sent_at = NOW(), metadata = COALESCE(metadata, '{}'::jsonb) - 'delivery_error',
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [campaign.id]
  );
  return { campaign: updateResult.rows[0], queued: recipients.length };
}

async function processDuePromotionNewsletters({
  poolRef,
  enqueueEmailImpl = enqueueEmail,
  now = new Date(),
  attachmentStorageDirectory,
}) {
  const client = await poolRef.connect();
  let dueCampaigns = [];
  try {
    await client.query("BEGIN");
    const due = await client.query(
      `SELECT *
       FROM promotion_email_campaigns
       WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= $1
       ORDER BY scheduled_at, id
       LIMIT 10
       FOR UPDATE SKIP LOCKED`,
      [now]
    );
    dueCampaigns = due.rows;
    for (const campaign of dueCampaigns) {
      await client.query(
        "UPDATE promotion_email_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1",
        [campaign.id]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const results = [];
  for (const campaign of dueCampaigns) {
    try {
      results.push(await queueNewsletterCampaign({
        poolRef,
        campaign,
        enqueueEmailImpl,
        attachmentStorageDirectory
      }));
    } catch (error) {
      await poolRef.query(
        `UPDATE promotion_email_campaigns
         SET status = 'draft',
             metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [campaign.id, JSON.stringify({ delivery_error: error.message || String(error) })]
      );
      console.error(`Failed to send scheduled newsletter campaign ${campaign.id}`, error);
    }
  }
  return results;
}

module.exports = {
  NEWSLETTER_AUDIENCES,
  NEWSLETTER_ATTACHMENT_FOLDER,
  getNewsletterAttachmentContentType,
  findNewsletterRecipients,
  isNewsletterAttachmentFilename,
  normalizeRecipientEmails,
  processDuePromotionNewsletters,
  queueNewsletterCampaign,
};
