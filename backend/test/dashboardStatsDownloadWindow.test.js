const test = require('node:test');
const assert = require('node:assert/strict');

const {
  summarizeContributorDownloadWindowCounts,
  summarizeContributorUploadWindowCounts,
} = require('../dashboardStats');

test('summarizeContributorDownloadWindowCounts keeps date-window totals distinct from the aggregate total', () => {
  const windowCounts = summarizeContributorDownloadWindowCounts({
    downloads_today: 2,
    downloads_last_7_days: 5,
    downloads_last_30_days: 9,
    downloads_last_365_days: 15,
  });

  assert.deepEqual(windowCounts, {
    downloads_today: 2,
    downloadsToday: 2,
    downloads_last_7_days: 5,
    downloadsLast7Days: 5,
    downloads_last_30_days: 9,
    downloadsLast30Days: 9,
    downloads_last_365_days: 15,
    downloadsLast365Days: 15,
  });

  assert.notEqual(windowCounts.downloadsToday, windowCounts.downloadsLast7Days);
  assert.notEqual(windowCounts.downloadsLast7Days, windowCounts.downloadsLast30Days);
  assert.notEqual(windowCounts.downloadsLast30Days, windowCounts.downloadsLast365Days);
  assert.ok(windowCounts.downloadsLast365Days >= windowCounts.downloadsLast30Days);
});

test('summarizeContributorDownloadWindowCounts handles camelCase and default zero values', () => {
  const windowCounts = summarizeContributorDownloadWindowCounts({
    downloadsToday: 3,
    downloadsLast7Days: 7,
    downloadsLast30Days: 11,
    downloadsLast365Days: 19,
  });

  assert.equal(windowCounts.downloads_today, 3);
  assert.equal(windowCounts.downloads_last_7_days, 7);
  assert.equal(windowCounts.downloads_last_30_days, 11);
  assert.equal(windowCounts.downloads_last_365_days, 19);

  const defaults = summarizeContributorDownloadWindowCounts({});
  assert.equal(defaults.downloads_today, 0);
  assert.equal(defaults.downloads_last_7_days, 0);
  assert.equal(defaults.downloads_last_30_days, 0);
  assert.equal(defaults.downloads_last_365_days, 0);
});

test('summarizeContributorUploadWindowCounts preserves real date-window totals', () => {
  const windowCounts = summarizeContributorUploadWindowCounts({
    uploads_today: 1,
    uploads_last_7_days: 2,
    uploads_last_30_days: 3,
    uploads_last_365_days: 4,
  });

  assert.equal(windowCounts.uploadsToday, 1);
  assert.equal(windowCounts.uploadsLast7Days, 2);
  assert.equal(windowCounts.uploadsLast30Days, 3);
  assert.equal(windowCounts.uploadsLast365Days, 4);
  assert.ok(windowCounts.uploadsLast365Days >= windowCounts.uploadsLast30Days);
});
