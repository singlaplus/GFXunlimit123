const test = require('node:test');
const assert = require('node:assert/strict');
const { processDueScheduledEmails } = require('./scheduler');

test('processes due scheduled emails by sending them directly when no queue worker is available', async () => {
  const calls = [];
  const fakePool = {
    async query(text, params) {
      if (text.includes('FROM scheduled_emails')) {
        return { rows: [{ id: 7, payload: { to: 'user@example.com', subject: 'Hello', body: 'Body' }, cron_expression: null, next_run: new Date('2026-01-01T00:00:00Z'), active: true }] };
      }
      if (text.includes('UPDATE scheduled_emails')) {
        calls.push({ text, params });
        return { rows: [{ id: 7 }] };
      }
      if (text.includes('SELECT * FROM email_settings')) {
        return { rows: [{ sender_name: 'Test', sender_email: 'test@example.com' }] };
      }
      return { rows: [] };
    }
  };

  const fakeSendMail = async (settings, mailOptions) => {
    calls.push({ type: 'sendMail', settings, mailOptions });
  };

  await processDueScheduledEmails({
    poolRef: fakePool,
    sendMailImpl: fakeSendMail,
    enqueueEmailImpl: async () => 'job-id',
  });

  assert.equal(calls.filter((entry) => entry.type === 'sendMail').length, 1);
  assert.equal(calls.some((entry) => entry.text && entry.text.includes('UPDATE scheduled_emails')), true);
});

test('marks one-off schedules as completed after they are sent', async () => {
  const calls = [];
  const fakePool = {
    async query(text, params) {
      if (text.includes('FROM scheduled_emails')) {
        return { rows: [{ id: 7, payload: { to: 'user@example.com', subject: 'Hello', body: 'Body' }, cron_expression: null, next_run: new Date('2026-01-01T00:00:00Z'), active: true }] };
      }
      if (text.includes('UPDATE scheduled_emails')) {
        calls.push({ text, params });
        return { rows: [{ id: 7 }] };
      }
      if (text.includes('SELECT * FROM email_settings')) {
        return { rows: [{ sender_name: 'Test', sender_email: 'test@example.com' }] };
      }
      return { rows: [] };
    }
  };

  const fakeSendMail = async () => {};

  await processDueScheduledEmails({
    poolRef: fakePool,
    sendMailImpl: fakeSendMail,
    enqueueEmailImpl: async () => 'job-id',
  });

  assert.equal(calls.some((entry) => entry.params && entry.params[0] === null && entry.params[1] === false), true);
});
