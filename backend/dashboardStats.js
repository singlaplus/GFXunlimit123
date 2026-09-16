function summarizeContributorDownloadWindowCounts(row = {}) {
  const downloadsToday = Number(row.downloads_today ?? row.downloadsToday ?? 0);
  const downloadsLast7Days = Number(row.downloads_last_7_days ?? row.downloadsLast7Days ?? 0);
  const downloadsLast30Days = Number(row.downloads_last_30_days ?? row.downloadsLast30Days ?? 0);
  const downloadsLast365Days = Number(row.downloads_last_365_days ?? row.downloadsLast365Days ?? 0);

  return {
    downloads_today: downloadsToday,
    downloadsToday,
    downloads_last_7_days: downloadsLast7Days,
    downloadsLast7Days,
    downloads_last_30_days: downloadsLast30Days,
    downloadsLast30Days,
    downloads_last_365_days: downloadsLast365Days,
    downloadsLast365Days,
  };
}

function summarizeContributorUploadWindowCounts(row = {}) {
  const uploadsToday = Number(row.uploads_today ?? row.uploadsToday ?? 0);
  const uploadsLast7Days = Number(row.uploads_last_7_days ?? row.uploadsLast7Days ?? 0);
  const uploadsLast30Days = Number(row.uploads_last_30_days ?? row.uploadsLast30Days ?? 0);
  const uploadsLast365Days = Number(row.uploads_last_365_days ?? row.uploadsLast365Days ?? 0);

  return {
    uploads_today: uploadsToday,
    uploadsToday,
    uploads_last_7_days: uploadsLast7Days,
    uploadsLast7Days,
    uploads_last_30_days: uploadsLast30Days,
    uploadsLast30Days,
    uploads_last_365_days: uploadsLast365Days,
    uploadsLast365Days,
  };
}

module.exports = {
  summarizeContributorDownloadWindowCounts,
  summarizeContributorUploadWindowCounts,
};