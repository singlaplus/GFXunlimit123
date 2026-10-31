const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  findNewsletterRecipients,
  normalizeRecipientEmails,
  processDuePromotionNewsletters,
  queueNewsletterCampaign,
} = require("../services/promotionNewsletters");

test("normalizes newsletter recipient addresses and removes duplicates", () => {
  assert.deepEqual(
    normalizeRecipientEmails(" Alice@example.com, bob@example.com\nalice@example.com "),
    ["alice@example.com", "bob@example.com"]
  );
});

test("filters recipient search by audience activity and query", async () => {
  let queryText = "";
  let queryParams = [];
  const expectedRows = [{ id: 1, email: "active@example.com", role: "customer" }];
  const recipients = await findNewsletterRecipients({
    query: async (sql, params) => {
      queryText = sql;
      queryParams = params;
      return { rows: expectedRows };
    },
  }, "customer_active", { search: "active" });

  assert.deepEqual(recipients, expectedRows);
  assert.match(queryText, /last_login_at >= NOW\(\) - INTERVAL '30 days'/);
  assert.match(queryText, /email ILIKE \$2 OR username ILIKE \$2 OR full_name ILIKE \$2/);
  assert.deepEqual(queryParams, ["customer", "%active%"]);
});

test("queues system and manually entered newsletter recipients", async () => {
  const insertedLogs = [];
  const emailJobs = [];
  const newsletterSmtpSettings = {
    sender_name: "Newsletter",
    sender_email: "news@example.com",
    smtp_host: "smtp.example.com",
    smtp_port: 587,
    smtp_user: "news@example.com",
    smtp_pass: "encrypted-password"
  };
  const poolRef = {
    query: async (sql, params) => {
      if (sql.includes("SELECT id, username")) {
        return {
          rows: [
            { id: 7, username: "reader", full_name: "Newsletter Reader", email: "reader@example.com" }
          ],
        };
      }
      if (sql.includes("promotion_newsletter_smtp_settings")) {
        return { rows: [newsletterSmtpSettings] };
      }
      if (sql.includes("INSERT INTO promotion_email_logs")) {
        insertedLogs.push(params);
        return { rows: [] };
      }
      if (sql.includes("UPDATE promotion_email_campaigns")) {
        return { rows: [{ id: 10, status: "sent" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await queueNewsletterCampaign({
    poolRef,
    campaign: {
      id: 10,
      audience: "all",
      recipients: ["Reader@example.com", "outside@example.com"],
      subject: "Welcome",
      body: "<p>Hello {{recipient_name}}</p>",
    },
    enqueueEmailImpl: async (jobName, payload) => {
      emailJobs.push({ jobName, payload });
      return "job-1";
    },
  });

  assert.equal(result.queued, 2);
  assert.equal(result.campaign.status, "sent");
  assert.equal(emailJobs[0].jobName, "send-email");
  assert.equal(emailJobs[0].payload.to, "reader@example.com");
  assert.equal(emailJobs[0].payload.templateData.recipient_name, "Newsletter Reader");
  assert.equal(emailJobs[1].payload.to, "outside@example.com");
  assert.equal(emailJobs[1].payload.templateData.recipient_name, "");
  assert.equal(emailJobs[1].payload.relatedUserId, undefined);
  assert.deepEqual(emailJobs[0].payload.settings, newsletterSmtpSettings);
  assert.equal(insertedLogs.length, 2);
  assert.equal(insertedLogs[0][1], "reader@example.com");
  assert.equal(insertedLogs[1][1], "outside@example.com");
});

test("rejects invalid manually entered newsletter email addresses", async () => {
  await assert.rejects(queueNewsletterCampaign({
    poolRef: { query: async () => ({ rows: [] }) },
    campaign: {
      id: 11,
      audience: "customer_active",
      recipients: ["not-an-email"],
      subject: "Welcome",
      body: "Hello",
    },
    enqueueEmailImpl: async () => "unused",
  }), /invalid email addresses/);
});

test("queues uploaded newsletter attachments from the configured storage folder", async () => {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "newsletter-attachments-"));
  const attachmentDirectory = path.join(storageRoot, "Newsletter attachment");
  const filename = "123e4567-e89b-42d3-a456-426614174000.pdf";
  const imageFilename = "123e4567-e89b-42d3-a456-426614174001.png";
  await fs.mkdir(attachmentDirectory);
  await fs.writeFile(path.join(attachmentDirectory, filename), "newsletter PDF");
  await fs.writeFile(path.join(attachmentDirectory, imageFilename), "newsletter PNG");

  const emailJobs = [];
  const poolRef = {
    query: async (sql) => {
      if (sql.includes("SELECT id, username")) {
        return { rows: [{ id: 7, username: "reader", email: "reader@example.com" }] };
      }
      if (sql.includes("UPDATE promotion_email_campaigns")) {
        return { rows: [{ id: 12, status: "sent" }] };
      }
      return { rows: [] };
    },
  };
  try {
    await queueNewsletterCampaign({
      poolRef,
      attachmentStorageDirectory: attachmentDirectory,
      campaign: {
        id: 12,
        audience: "all",
        recipients: ["reader@example.com"],
        subject: "Newsletter",
        body: "<p>Message</p>",
        attachments: [
          { filename, name: "newsletter.pdf" },
          {
            filename: imageFilename,
            name: "newsletter.png",
            cid: "newsletter-123e4567-e89b-42d3-a456-426614174001@newsletter.gfxunlimit"
          }
        ],
      },
      enqueueEmailImpl: async (jobName, payload) => {
        emailJobs.push({ jobName, payload });
        return "attachment-job";
      },
    });

    assert.deepEqual(emailJobs[0].payload.attachments, [
      {
        filename: "newsletter.pdf",
        path: path.join(attachmentDirectory, filename),
        contentType: "application/pdf"
      },
      {
        filename: "newsletter.png",
        path: path.join(attachmentDirectory, imageFilename),
        contentType: "image/png",
        cid: "newsletter-123e4567-e89b-42d3-a456-426614174001@newsletter.gfxunlimit",
        contentDisposition: "inline"
      }
    ]);
  } finally {
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});

test("claims due newsletter campaigns and queues them once", async () => {
  const campaign = {
    id: 15,
    audience: "all",
    recipients: ["reader@example.com"],
    subject: "Scheduled",
    body: "Hello",
  };
  const clientQueries = [];
  const poolQueries = [];
  const poolRef = {
    connect: async () => ({
      query: async (sql) => {
        clientQueries.push(sql);
        return sql.includes("FROM promotion_email_campaigns")
          ? { rows: [campaign] }
          : { rows: [] };
      },
      release: () => {},
    }),
    query: async (sql, params) => {
      poolQueries.push(sql);
      if (sql.includes("SELECT id, username")) {
        return {
          rows: [{ id: 9, username: "reader", email: "reader@example.com" }],
        };
      }
      if (sql.includes("UPDATE promotion_email_campaigns") && sql.includes("RETURNING")) {
        return { rows: [{ id: campaign.id, status: "sent" }] };
      }
      return { rows: [] };
    },
  };
  const jobs = [];

  const results = await processDuePromotionNewsletters({
    poolRef,
    now: new Date("2099-01-01T00:00:00Z"),
    enqueueEmailImpl: async (name, payload) => {
      jobs.push({ name, payload });
      return "scheduled-job";
    },
  });

  assert.equal(results.length, 1);
  assert.equal(jobs.length, 1);
  assert.match(clientQueries.find((query) => query.includes("FROM promotion_email_campaigns")), /FOR UPDATE SKIP LOCKED/);
  assert.ok(clientQueries.includes("COMMIT"));
  assert.ok(poolQueries.some((query) => query.includes("INSERT INTO promotion_email_logs")));
});
