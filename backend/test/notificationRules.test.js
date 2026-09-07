const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRecipients, resolveNotificationEventKey, buildNotificationEmailContent } = require('../email/notificationRules');
const { isCollectionAwareLiveAsset } = require('../email/routes');
const { resolveEventDeliveryPolicy } = require('../messaging');

test('normalizeRecipients trims, deduplicates, and preserves bcc addresses', () => {
  const recipients = normalizeRecipients([
    ' user@example.com ',
    'user@example.com',
    'bcc:admin@example.com',
    'bcc:admin@example.com',
    '  another@example.com '
  ]);

  assert.deepEqual(recipients, ['user@example.com', 'bcc:admin@example.com', 'another@example.com']);
});

test('resolveNotificationEventKey maps legacy login/logout events to configured keys', () => {
  assert.equal(resolveNotificationEventKey('login'), 'sign_in');
  assert.equal(resolveNotificationEventKey('log in'), 'sign_in');
  assert.equal(resolveNotificationEventKey('logout'), 'sign_out');
  assert.equal(resolveNotificationEventKey('log out'), 'sign_out');
  assert.equal(resolveNotificationEventKey('download'), 'download');
  assert.equal(resolveNotificationEventKey('like'), 'favorite');
  assert.equal(resolveNotificationEventKey('favorite'), 'favorite');
});

test('resolveNotificationEventKey keeps the daily reports event stable for scheduled summaries', () => {
  assert.equal(resolveNotificationEventKey('daily report'), 'daily_reports');
  assert.equal(resolveNotificationEventKey('daily reports'), 'daily_reports');
  assert.equal(resolveNotificationEventKey('daily_reports'), 'daily_reports');
});

test('resolveNotificationEventKey maps account status changes to the managed notification rule key', () => {
  assert.equal(resolveNotificationEventKey('account_status_changed'), 'account_status_changed');
  assert.equal(resolveNotificationEventKey('account status changed'), 'account_status_changed');
  assert.equal(resolveNotificationEventKey('account_status_updated'), 'account_status_changed');
});

test('event delivery policy keeps login and asset views activity-only by default', () => {
  assert.deepEqual(resolveEventDeliveryPolicy('USER_LOGIN'), { activity: true, internal: false, email: false, notifyAdmins: false });
  assert.deepEqual(resolveEventDeliveryPolicy('ASSET_VIEWED'), { activity: true, internal: false, email: false, notifyAdmins: false });
});

test('event delivery policy enables notification and email defaults', () => {
  assert.deepEqual(resolveEventDeliveryPolicy('ASSET_APPROVED'), { activity: true, internal: true, email: true, notifyAdmins: false });
  assert.deepEqual(resolveEventDeliveryPolicy('ORDER_COMPLETED'), { activity: true, internal: true, email: true, notifyAdmins: true });
});

test('notification rules override the default relationship', () => {
  assert.deepEqual(resolveEventDeliveryPolicy('ORDER_COMPLETED', { enabled: true, enable_internal: false, enable_email: false, recipient_roles: [] }), { activity: true, internal: false, email: false, notifyAdmins: false });
  assert.deepEqual(resolveEventDeliveryPolicy('ASSET_VIEWED', { enabled: true, enable_internal: true, enable_email: true, recipient_roles: ['CUSTOMER'] }), { activity: true, internal: true, email: true, notifyAdmins: false });
});

test('live assets count only approved images that belong to an available collection', () => {
  assert.equal(isCollectionAwareLiveAsset({ status: 'approved', collection: 'Spring' }, ['Spring', 'Summer']), true);
  assert.equal(isCollectionAwareLiveAsset({ status: 'approved', collection: 'Autumn' }, ['Spring', 'Summer']), false);
  assert.equal(isCollectionAwareLiveAsset({ status: 'approved', collection: '' }, ['Spring', 'Summer']), false);
  assert.equal(isCollectionAwareLiveAsset({ status: 'approved', collection: 'Spring' }, []), true);
  assert.equal(isCollectionAwareLiveAsset({ status: 'pending', collection: 'Spring' }, ['Spring', 'Summer']), false);
});

test('buildNotificationEmailContent renders custom templates for download and favorite events', () => {
  const template = {
    subject: 'Download alert for {{first_name}}',
    body: '<p>Hello {{user_name}}, your asset {{asset_title}} was downloaded.</p>'
  };

  const result = buildNotificationEmailContent({
    eventKey: 'download',
    eventLabel: 'Image Downloaded',
    activityDetails: 'User downloaded an image from the platform.',
    displayName: 'Alex Carter',
    email: 'alex@example.com',
    template,
    userData: { username: 'alex', full_name: 'Alex Carter' },
    templateData: { asset_title: 'Sunset Series' }
  });

  assert.equal(result.subject, 'Download alert for Alex');
  assert.match(result.html, /Hello Alex Carter/);
  assert.match(result.html, /Sunset Series/);
  assert.match(result.text, /Hello Alex Carter/);
});
