const { Worker, Queue } = require('bullmq');
const IORedis = require('ioredis');
const pool = require('../db');
const { sendMail, renderTemplate } = require('./mailer');
const { injectTrackingIntoHtml } = require('./newsletterTracking');

const connectionString = process.env.REDIS_URL || process.env.REDIS || null;
if (!connectionString) {
  console.warn('No REDIS_URL configured — email queue worker disabled.');
  process.exit(0);
}

const connection = new IORedis(connectionString);
const emailQueue = new Queue('emails', { connection });

const worker = new Worker('emails', async job => {
  const { to, subject, templateBody, templateData, settings, campaignId, recipient, source } = job.data;
  await pool.query("UPDATE email_queue SET status='processing', attempts=attempts + 1 WHERE job_id = $1", [job.id]);
  try {
    const html = templateBody ? renderTemplate(templateBody, templateData) : (templateData && templateData.html) || '';
    const trackedHtml = injectTrackingIntoHtml(html, campaignId || 0, recipient || to, process.env.APP_URL || 'http://localhost:5000');
    await sendMail(settings, { to, subject, html: trackedHtml, text: templateData && templateData.text });
    await pool.query(
      `INSERT INTO email_logs(email_id, recipient, event, template_id, subject, body, status, queued_at, sent_at, delivered_at, retry_count, created_at)
       VALUES($1,$2,$3,$4,$5,$6,'sent',now(),now(),now(),$7,now())`,
      [String(job.id), to, source || 'email', job.data.templateId || null, subject || '', trackedHtml || '', job.attemptsMade || 0]
    );
    await pool.query("UPDATE email_queue SET status='sent', sent_at=now(), error_message=NULL WHERE job_id = $1", [job.id]);

    if (recipient) {
      await pool.query(
        `INSERT INTO newsletter_tracking(campaign_id, recipient, status, created_at)
         VALUES($1, $2, 'delivered', now())
         ON CONFLICT (campaign_id, recipient)
         DO UPDATE SET status = 'delivered', created_at = LEAST(newsletter_tracking.created_at, now())`,
        [campaignId || 0, recipient]
      );
    }

    return true;
  } catch (err) {
    console.error('Email job failed', err);
    const retrying = Boolean(job.opts?.attempts && (job.attemptsMade + 1) < job.opts.attempts);
    await pool.query(`INSERT INTO email_logs(email_id, recipient, event, template_id, subject, body, status, queued_at, failed_at, retry_count, error_message, created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now(),now(),$8,$9,now())`, [String(job.id), to, source || 'email', job.data.templateId || null, subject || '', templateBody || '', retrying ? 'retrying' : 'failed', job.attemptsMade || 0, err.message]);
    await pool.query("UPDATE email_queue SET status=$1, failed_at=CASE WHEN $1='failed' THEN now() ELSE failed_at END, retry_count=retry_count + 1, error_message=$2 WHERE job_id = $3", [retrying ? 'retrying' : 'failed', err.message, job.id]);
    throw err;
  }
}, { connection });

worker.on('failed', (job, err) => {
  console.error('Job failed', job.id, err.message || err);
});
