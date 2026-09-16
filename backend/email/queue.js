const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const pool = require('../db');
const { sendMail, renderTemplate } = require('./mailer');

const connectionString = process.env.REDIS_URL || process.env.REDIS || null;

let emailQueue = null;
if (connectionString) {
  const connection = new IORedis(connectionString);
  emailQueue = new Queue('emails', { connection });
}

async function processDatabaseEmailQueue() {
  if (emailQueue) return;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const queued = await client.query(`
      SELECT * FROM email_queue
      WHERE status = 'queued' AND (scheduled_at IS NULL OR scheduled_at <= now())
      ORDER BY created_at ASC
      LIMIT 5
      FOR UPDATE SKIP LOCKED
    `);
    for (const row of queued.rows) {
      await client.query("UPDATE email_queue SET status='processing', attempts=attempts + 1 WHERE id = $1", [row.id]);
      try {
        const payload = row.payload || {};
        const settings = (await client.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1')).rows[0] || {};
        const html = payload.templateBody ? renderTemplate(payload.templateBody, payload.templateData || {}) : (payload.templateData?.html || '');
        await sendMail(settings, { to: payload.to || row.recipient, subject: payload.subject || row.subject || '', html, text: payload.templateData?.text || '' });
        await client.query("UPDATE email_queue SET status='sent', sent_at=now(), error_message=NULL WHERE id = $1", [row.id]);
        await client.query(
          `INSERT INTO email_logs(email_id, recipient, event, template_id, subject, body, status, queued_at, sent_at, delivered_at, retry_count, created_at)
           VALUES($1,$2,$3,$4,$5,$6,'sent',$7,now(),now(),$8,now())`,
          [String(row.job_id || row.id), payload.to || row.recipient || '', row.event || 'email', row.template_id || null, payload.subject || row.subject || '', html, row.queued_at || row.created_at || new Date(), row.retry_count || 0]
        );
      } catch (error) {
        console.error('Database email job failed:', error.message || error);
        await client.query('ROLLBACK');
        await pool.query("UPDATE email_queue SET status='failed', failed_at=now(), error_message=$2 WHERE id = $1", [row.id, error.message || String(error)]);
        await client.query('BEGIN');
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Database email queue worker failed:', error.message || error);
  } finally {
    client?.release();
  }
}

if (!emailQueue) {
  const databaseQueueTimer = setInterval(() => processDatabaseEmailQueue().catch((error) => console.error('Database email queue worker failed:', error.message || error)), 5000);
  databaseQueueTimer.unref?.();
}

async function enqueueEmail(jobName, payload, opts = {}) {
  const queueOptions = { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: false, ...opts };
  if (emailQueue) {
    const job = await emailQueue.add('send-email', payload, queueOptions);
    // also persist into email_queue table for record
    try {
      await pool.query(`INSERT INTO email_queue(job_id, payload, status, scheduled_at, created_at, queued_at, recipient, event, template_id, subject, related_user_id, related_order_id, related_asset_id)
        VALUES($1,$2,'queued',$3,now(),now(),$4,$5,$6,$7,$8,$9,$10)`, [job.id, payload, queueOptions.delay ? new Date(Date.now() + queueOptions.delay) : null, payload.to || payload.recipient || null, payload.event || jobName, payload.templateId || null, payload.subject || null, payload.relatedUserId || null, payload.relatedOrderId || null, payload.relatedAssetId || null]);
    } catch (err) {
      console.error('Failed to persist email queue record', err);
    }
    return job.id;
  }

  // fallback: insert into email_queue table
  try {
    const r = await pool.query(`INSERT INTO email_queue(payload, status, scheduled_at, created_at, queued_at, recipient, event, template_id, subject, related_user_id, related_order_id, related_asset_id)
      VALUES($1,'queued',$2,now(),now(),$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [payload, opts.scheduled_at || null, payload.to || payload.recipient || null, payload.event || jobName, payload.templateId || null, payload.subject || null, payload.relatedUserId || null, payload.relatedOrderId || null, payload.relatedAssetId || null]);
    return r.rows[0].id;
  } catch (err) {
    console.error('Failed to insert into email_queue', err);
    throw err;
  }
}

module.exports = { enqueueEmail };
