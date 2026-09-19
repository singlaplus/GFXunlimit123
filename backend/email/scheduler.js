const { sendMail, renderTemplate } = require('./mailer');
const { buildDailyWebsiteSummary, renderDailyWebsiteSummaryHtml } = require('./routes');
const { getDailyReportSubject } = require('./daily-report-subject');

async function processDueScheduledBlogs({
  poolRef = require('../db'),
  now = new Date(),
} = {}) {
  return poolRef.query(
    `UPDATE blog_drafts
     SET status = 'published', updated_at = NOW()
     WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= $1
     RETURNING id`,
    [now]
  );
}

async function processDueDailyReportSchedules({
  poolRef = require('../db'),
  sendMailImpl = sendMail,
  now = new Date(),
} = {}) {
  await poolRef.query(
    'ALTER TABLE daily_report_schedules ADD COLUMN IF NOT EXISTS last_sent_date DATE'
  );
  await poolRef.query(
    'ALTER TABLE daily_report_schedules ADD COLUMN IF NOT EXISTS report_settings JSONB DEFAULT NULL'
  );
  await poolRef.query(
    "UPDATE daily_report_schedules SET report_settings = (SELECT daily_report_settings FROM users WHERE role = 'admin' AND daily_report_settings IS NOT NULL ORDER BY id LIMIT 1) WHERE report_settings IS NULL"
  );
  const schedulesResult = await poolRef.query(
    'SELECT id, time, frequency, report_settings, last_sent_date FROM daily_report_schedules'
  );
  const today = now.toISOString().slice(0, 10);
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const settingsResult = await poolRef.query(
    "SELECT id, daily_report_settings FROM users WHERE role = 'admin' AND daily_report_settings IS NOT NULL ORDER BY ((daily_report_settings->'reportSmtp'->>'smtp_host') IS NOT NULL) DESC, id LIMIT 1"
  );
  const summary = schedulesResult.rows?.length ? await buildDailyWebsiteSummary({ poolRef }) : null;

  for (const schedule of schedulesResult.rows || []) {
    const scheduleLockKey = 100000 + Number(schedule.id || 0);
    const lockResult = await poolRef.query('SELECT pg_try_advisory_lock($1) AS locked', [scheduleLockKey]);
    if (!lockResult.rows[0]?.locked) continue;

    try {
    const scheduleTime = String(schedule.time || '').slice(0, 5);
    const lastSentDate = schedule.last_sent_date instanceof Date
      ? schedule.last_sent_date.toISOString().slice(0, 10)
      : String(schedule.last_sent_date || '').slice(0, 10);
    const sentDate = lastSentDate ? new Date(`${lastSentDate}T00:00:00Z`) : null;
    const currentDate = new Date(`${today}T00:00:00Z`);
    const elapsedDays = sentDate ? Math.floor((currentDate - sentDate) / (24 * 60 * 60 * 1000)) : null;
    const frequency = String(schedule.frequency || 'daily').toLowerCase();
    const frequencyDue = !sentDate
      || (frequency === 'weekly' && elapsedDays >= 7)
      || (frequency === 'monthly' && (currentDate.getUTCMonth() !== sentDate.getUTCMonth() || currentDate.getUTCFullYear() !== sentDate.getUTCFullYear()))
      || (frequency !== 'weekly' && frequency !== 'monthly' && elapsedDays >= 1);
    if (!summary || scheduleTime > currentTime || !frequencyDue) continue;

    const defaultSettings = settingsResult.rows[0]?.daily_report_settings || {};
    const scheduleSettings = schedule.report_settings || {};
    const mergedReportSmtp = { ...(defaultSettings.reportSmtp || {}) };
    Object.entries(scheduleSettings.reportSmtp || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') mergedReportSmtp[key] = value;
    });
    const settings = {
      ...defaultSettings,
      ...scheduleSettings,
      enabled: scheduleSettings.enabled ?? defaultSettings.enabled,
      email: scheduleSettings.email || defaultSettings.email,
      metrics: { ...(defaultSettings.metrics || {}), ...(scheduleSettings.metrics || {}) },
      reportSmtp: mergedReportSmtp
    };
    const recipient = String(settings.email || '').trim();
    if (settings.enabled === false || !recipient) continue;

    const claimResult = await poolRef.query(
      'UPDATE daily_report_schedules SET last_sent_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND (last_sent_date IS NULL OR last_sent_date < $1::date) RETURNING id',
      [today, schedule.id]
    );
    if (!claimResult.rows.length) continue;

    try {
    const html = renderDailyWebsiteSummaryHtml(summary, settings.metrics || null);
    const subject = getDailyReportSubject({ siteName: summary.siteName, metrics: settings.metrics || {}, date: now });
    {
      const mailResult = await sendMailImpl(settings.reportSmtp || {}, {
        to: recipient,
        subject,
        html,
        text: `${summary.siteName} daily website summary.`
      });

      const rejectedRecipients = Array.isArray(mailResult?.rejected) ? mailResult.rejected : [];
      if (rejectedRecipients.some((value) => String(value).toLowerCase() === recipient.toLowerCase())) {
        throw new Error(`SMTP rejected scheduled report recipient: ${recipient}`);
      }

      await poolRef.query(
        `INSERT INTO email_logs(recipient, subject, body, status, delivered_at, created_at, email_id, sent_at)
         VALUES($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5, CURRENT_TIMESTAMP)`,
        [recipient, subject, html, 'delivered', mailResult?.messageId || null]
      );
    }

    } catch (error) {
      await poolRef.query(
        'UPDATE daily_report_schedules SET last_sent_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [lastSentDate || null, schedule.id]
      );
      throw error;
    }
    } finally {
      await poolRef.query('SELECT pg_advisory_unlock($1)', [scheduleLockKey]);
    }
  }
}

async function processDueScheduledEmails({
  poolRef = require('../db'),
  sendMailImpl = sendMail,
  enqueueEmailImpl = null,
  now = new Date(),
} = {}) {
  const rows = await poolRef.query(
    "SELECT * FROM scheduled_emails WHERE active = true AND next_run IS NOT NULL AND next_run <= $1",
    [now]
  );

  for (const row of rows.rows || []) {
    const payload = row.payload || {};
    const settingsRes = await poolRef.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    const settings = settingsRes.rows[0] || {};

    const html = payload.body ? renderTemplate(payload.body, payload.templateData || {}) : '';
    await sendMailImpl(settings, {
      to: payload.to || payload.recipient,
      subject: payload.subject || '',
      html,
      text: payload.body || '',
    });

    await poolRef.query(
      'INSERT INTO email_logs(recipient, subject, body, status, created_at) VALUES($1,$2,$3,$4, now())',
      [payload.to || payload.recipient || '', payload.subject || '', html || '', 'sent']
    );

    await poolRef.query(
      "UPDATE email_queue SET status = 'sent', last_error = NULL, scheduled_at = NULL WHERE payload->>'to' = $1 AND status IN ('queued', 'scheduled', 'pending')",
      [payload.to || payload.recipient || '']
    );

    const next = row.cron_expression ? null : null;
    await poolRef.query('UPDATE scheduled_emails SET next_run = $1, active = $2 WHERE id = $3', [next, row.cron_expression ? true : false, row.id]);
  }
}

module.exports = { processDueScheduledBlogs, processDueScheduledEmails, processDueDailyReportSchedules };
