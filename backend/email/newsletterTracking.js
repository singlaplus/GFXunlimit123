const crypto = require('crypto');

function getTrackingWindowStatus(createdAt) {
  if (!createdAt) return 'archived';
  const created = new Date(createdAt);
  const now = new Date();
  const hoursDiff = (now.getTime() - created.getTime()) / (1000 * 60 * 60);
  return hoursDiff <= 6 ? 'active' : 'archived';
}

function injectTrackingIntoHtml(html, campaignId, recipient, baseUrl) {
  if (!html) return html;
  const safeRecipient = encodeURIComponent(recipient || 'unknown');
  const normalizedBaseUrl = (baseUrl || '').replace(/\/$/, '');
  const openUrl = `${normalizedBaseUrl}/admin/email/newsletter/track/open/${campaignId}/${safeRecipient}`;
  const clickBase = `${normalizedBaseUrl}/admin/email/newsletter/track/click/${campaignId}/${safeRecipient}`;

  const pixel = `<img src="${openUrl}" alt="" width="1" height="1" style="display:block;width:1px;height:1px;border:0;opacity:0;position:fixed;right:0;bottom:0;pointer-events:none;" />`;
  let updated = html;

  if (/<body\b/i.test(updated)) {
    updated = updated.replace(/<body[^>]*>/i, (match) => `${match}${pixel}`);
  } else {
    updated = `${updated}${pixel}`;
  }

  updated = updated.replace(/<a\s+([^>]*href=["'])(https?:\/\/[^"']+)(["'][^>]*>)/gi, (match, prefix, href, suffix) => {
    const encodedHref = encodeURIComponent(href);
    return `<a ${prefix}${clickBase}?url=${encodedHref}${suffix}`;
  });
  return updated;
}

function buildNewsletterExportLog(rows) {
  const totals = rows.reduce((acc, row) => {
    acc.sent += Number(row.sent || row.total || 0);
    acc.delivered += Number(row.delivered || 0);
    acc.opened += Number(row.opened || 0);
    acc.clicked += Number(row.clicked || 0);
    return acc;
  }, { sent: 0, delivered: 0, opened: 0, clicked: 0 });

  const lines = [
    'campaign_id,recipient,status,created_at,opened_at,clicked_at,tracking_status',
    ...rows.map((row) => [
      row.campaign_id || '',
      row.recipient || '',
      row.status || '',
      row.created_at || '',
      row.opened_at || '',
      row.clicked_at || '',
      row.tracking_status || ''
    ].join(','))
  ];
  return lines.join('\n');
}

module.exports = { getTrackingWindowStatus, injectTrackingIntoHtml, buildNewsletterExportLog };
