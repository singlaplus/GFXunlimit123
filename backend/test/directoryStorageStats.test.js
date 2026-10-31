const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { getDirectoryStorageStats } = require('../services/directoryStorageStats');

test('reports folder size and filesystem capacity for an existing directory', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'database-location-stats-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'database.backup'), Buffer.alloc(17));

  const stats = await getDirectoryStorageStats(root);

  assert.equal(stats.directoryExists, true);
  assert.equal(stats.folderSizeBytes, 17);
  if (typeof fs.statfsSync === 'function') {
    assert.ok(stats.driveFreeBytes > 0);
  }
});

test('reports zero folder size and parent filesystem capacity for a not-yet-created directory', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'database-location-parent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missingDirectory = path.join(root, 'Database');

  const stats = await getDirectoryStorageStats(missingDirectory);

  assert.equal(stats.directoryExists, false);
  assert.equal(stats.folderSizeBytes, 0);
  if (typeof fs.statfsSync === 'function') {
    assert.ok(stats.driveFreeBytes > 0);
  }
});
