function normalizeRecipients(recipients) {
  if (!Array.isArray(recipients)) return [];

  const seen = new Set();
  const normalized = [];

  for (const recipient of recipients) {
    const value = String(recipient || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

function resolveNotificationEventKey(eventKey) {
  const normalized = String(eventKey || '').trim().toLowerCase().replace(/[_\s-]+/g, '_');
  if (normalized === 'login' || normalized === 'log_in') return 'sign_in';
  if (normalized === 'signout' || normalized === 'sign_out' || normalized === 'logout' || normalized === 'log_out') return 'sign_out';
  if (normalized === 'like' || normalized === 'favorite' || normalized === 'favourite') return 'favorite';
  if (normalized === 'daily_report' || normalized === 'daily_reports' || normalized === 'dailyreport') return 'daily_reports';
  if (normalized === 'account_status_change' || normalized === 'account_status_changed' || normalized === 'account_status_updated' || normalized === 'account_updated') return 'account_status_changed';
  return normalized;
}

function buildNotificationEmailContent({
  eventKey,
  eventLabel,
  activityDetails,
  displayName,
  email,
  template,
  userData = {},
  templateData = {}
}) {
  const templateSource = template && typeof template === 'object' ? template : {};
  const subjectTemplate = String(templateSource.subject || `${eventLabel} - ${displayName}`).trim();
  const bodyTemplate = String(templateSource.body || `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h3>${eventLabel}</h3>
      <p><strong>Activity:</strong> ${activityDetails}</p>
      <p><strong>User Name:</strong> ${displayName}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Details:</strong> ${activityDetails}</p>
    </div>
  `);

  const replacements = {
    first_name: String(userData.full_name || userData.username || displayName || '').split(/\s+/)[0] || 'User',
    user_name: userData.full_name || userData.username || displayName || 'User',
    customer_email: email || '',
    contributor_email: email || '',
    asset_title: templateData.asset_title || templateData.assetTitle || 'your asset',
    asset_owner_email: userData.email || email || '',
    download_link: templateData.download_link || templateData.downloadLink || '#',
    site_name: templateData.site_name || templateData.siteName || 'GFXunlimit',
    admin_email: templateData.admin_email || templateData.adminEmail || '',
    event_name: eventLabel || eventKey || 'Notification',
    activity: activityDetails || '',
    user_email: email || '',
    display_name: displayName || userData.full_name || userData.username || 'User',
    event_label: eventLabel || eventKey || 'Notification'
  };

  const renderToken = (value) => String(value || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, token) => {
    return replacements[token] ?? `{{${token}}}`;
  });

  const subject = renderToken(subjectTemplate);
  const html = renderToken(bodyTemplate);
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  return { subject, html, text };
}

module.exports = {
  normalizeRecipients,
  resolveNotificationEventKey,
  buildNotificationEmailContent,
};
