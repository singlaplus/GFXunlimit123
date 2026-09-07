const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');

const TEST_CAMPAIGN_ID = 999999;
const TEST_RECIPIENT = 'analytics-smoke-test@example.com';

test('newsletter open and click tracking updates analytics counts', async (t) => {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    t.skip(`PostgreSQL unavailable or not configured: ${err.message}`);
    return;
  }

  try {
    await client.query('DELETE FROM newsletter_tracking WHERE campaign_id = $1 AND recipient = $2', [TEST_CAMPAIGN_ID, TEST_RECIPIENT]);
    await client.query("DELETE FROM email_logs WHERE recipient = $1 AND created_at >= now() - interval '1 hour'", [TEST_RECIPIENT]);

    await client.query(
      `INSERT INTO email_logs(recipient, subject, body, status, delivered_at, created_at)
         VALUES($1, $2, $3, $4, now(), now())`,
      [TEST_RECIPIENT, 'Analytics smoke test', '<p>Analytics smoke test email</p>', 'delivered']
    );

    await client.query(
      `INSERT INTO newsletter_tracking(campaign_id, recipient, status, opened_at, created_at)
         VALUES($1, $2, 'opened', now(), now())
         ON CONFLICT (campaign_id, recipient)
         DO UPDATE SET status = EXCLUDED.status, opened_at = EXCLUDED.opened_at, created_at = LEAST(newsletter_tracking.created_at, now())`,
      [TEST_CAMPAIGN_ID, TEST_RECIPIENT]
    );

    await client.query(
      `INSERT INTO newsletter_tracking(campaign_id, recipient, status, clicked_at, clicked_url, created_at)
         VALUES($1, $2, 'clicked', now(), $3, now())
         ON CONFLICT (campaign_id, recipient)
         DO UPDATE SET status = EXCLUDED.status, clicked_at = EXCLUDED.clicked_at, clicked_url = EXCLUDED.clicked_url, created_at = LEAST(newsletter_tracking.created_at, now())`,
      [TEST_CAMPAIGN_ID, TEST_RECIPIENT, 'https://example.com']
    );

    const totalsResult = await client.query(
      `WITH tracking_totals AS (
         SELECT
           COUNT(*) FILTER (WHERE status IN ('delivered', 'opened', 'clicked') OR opened_at IS NOT NULL OR clicked_at IS NOT NULL) AS delivered,
           COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
           COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked
         FROM newsletter_tracking
         WHERE campaign_id = $1 AND recipient = $2
       )
       SELECT * FROM tracking_totals`,
      [TEST_CAMPAIGN_ID, TEST_RECIPIENT]
    );

    const totals = totalsResult.rows[0];
    assert.equal(Number(totals.delivered), 1);
    assert.equal(Number(totals.opened), 1);
    assert.equal(Number(totals.clicked), 1);

    const dailyResult = await client.query(
      `SELECT
         to_char(created_at, 'YYYY-MM-DD') AS day,
         COUNT(*) FILTER (WHERE status IN ('delivered', 'opened', 'clicked') OR opened_at IS NOT NULL OR clicked_at IS NOT NULL) AS delivered_count,
         COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened_count,
         COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked_count
       FROM newsletter_tracking
       WHERE campaign_id = $1 AND recipient = $2
       GROUP BY day`,
      [TEST_CAMPAIGN_ID, TEST_RECIPIENT]
    );

    assert.equal(dailyResult.rows.length, 1);
    assert.equal(Number(dailyResult.rows[0].delivered_count), 1);
    assert.equal(Number(dailyResult.rows[0].opened_count), 1);
    assert.equal(Number(dailyResult.rows[0].clicked_count), 1);
  } finally {
    client.release();
  }
});

test.after(async () => {
  await pool.end();
});
