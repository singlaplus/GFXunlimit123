const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { deleteAssetCompletely } = require('../services/assetDeletion');

function makeDependencies(asset, { thumbnailDeleteResult = true } = {}) {
  const root = asset.testRoot;
  const operations = [];
  const client = {
    async query(sql, values) {
      operations.push({ sql, values });
      if (/SELECT id, filename, uploaded_by, title, status FROM images/.test(sql)) return { rows: [asset] };
      if (/SELECT role FROM users/.test(sql)) return { rows: [{ role: asset.requesterRole || 'admin' }] };
      if (/SELECT thumbnail_path FROM asset_thumbnail_metadata/.test(sql)) {
        return { rows: [{ thumbnail_path: asset.thumbnailPath }] };
      }
      if (/SELECT thumbnail_path FROM asset_thumbnail_orphans/.test(sql)) {
        return { rows: [{ thumbnail_path: asset.orphanThumbnailPath }] };
      }
      if (/DELETE FROM images/.test(sql)) return { rows: [{ id: asset.id }] };
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  const pool = { connect: async () => client };
  const assetThumbnails = {
    acquireAssetLifecycleLock: async () => () => {},
    getOriginalAssetStorageRoot: () => root,
    async deleteAssetThumbnail(_assetId, thumbnailPath) {
      if (!thumbnailDeleteResult) return false;
      if (thumbnailPath) {
        await fs.unlink(path.join(asset.thumbnailRoot, ...thumbnailPath.split('/')));
      }
      return true;
    }
  };
  const thumbnailQueue = { async cancelAssetThumbnailJobs() { operations.push({ cancelledJobs: true }); } };
  return { dependencies: { pool, assetThumbnails, thumbnailQueue }, operations };
}

async function prepareAsset(t) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-asset-delete-'));
  const assetRoot = path.join(tempRoot, 'assets');
  const thumbnailRoot = path.join(tempRoot, 'thumbnails');
  await fs.mkdir(path.join(assetRoot, 'contributor', 'Pending'), { recursive: true });
  await fs.mkdir(path.join(thumbnailRoot, '2026', '10'), { recursive: true });
  await fs.writeFile(path.join(assetRoot, 'contributor', 'Pending', 'asset.jpg'), 'original');
  await fs.writeFile(path.join(assetRoot, 'contributor', 'Pending', 'other.jpg'), 'unrelated');
  await fs.writeFile(path.join(thumbnailRoot, '2026', '10', 'asset.webp'), 'thumbnail');
  await fs.writeFile(path.join(thumbnailRoot, '2026', '10', 'other.webp'), 'unrelated thumbnail');
  await fs.writeFile(path.join(thumbnailRoot, '2026', '10', 'old-asset.webp'), 'orphan');
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  return {
    id: 42,
    filename: 'contributor/Pending/asset.jpg',
    uploaded_by: 7,
    title: 'Asset',
    status: 'approved',
    thumbnailPath: '2026/10/asset.webp',
    orphanThumbnailPath: '2026/10/old-asset.webp',
    thumbnailRoot,
    testRoot: assetRoot,
    requesterRole: 'admin'
  };
}

test('deletes only the selected asset, original, thumbnail, orphan, and related records', async (t) => {
  const asset = await prepareAsset(t);
  const { dependencies, operations } = makeDependencies(asset);

  const result = await deleteAssetCompletely(asset.id, 99, dependencies);

  assert.equal(result.deleted, true);
  await assert.rejects(fs.access(path.join(asset.testRoot, asset.filename)), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(asset.thumbnailRoot, '2026/10/asset.webp')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(asset.thumbnailRoot, '2026/10/old-asset.webp')), { code: 'ENOENT' });
  await fs.access(path.join(asset.testRoot, 'contributor/Pending/other.jpg'));
  await fs.access(path.join(asset.thumbnailRoot, '2026/10/other.webp'));
  assert.ok(operations.some(({ sql }) => /DELETE FROM asset_thumbnail_metadata/.test(sql)));
  assert.ok(operations.some(({ sql }) => /DELETE FROM asset_thumbnail_orphans/.test(sql)));
  assert.ok(operations.some(({ sql }) => /DELETE FROM images/.test(sql)));
});

test('keeps a pending asset and its original when thumbnail cleanup fails', async (t) => {
  const asset = await prepareAsset(t);
  const { dependencies } = makeDependencies(asset, { thumbnailDeleteResult: false });
  asset.status = 'not_submitted';
  asset.requesterRole = 'contributor';

  await assert.rejects(
    deleteAssetCompletely(asset.id, asset.uploaded_by, dependencies),
    /Thumbnail cleanup failed/
  );
  await fs.access(path.join(asset.testRoot, asset.filename));
});

test('preserves contributor deletion permission limits for Pending assets', async (t) => {
  const asset = await prepareAsset(t);
  asset.status = 'pending';
  asset.requesterRole = 'contributor';
  const { dependencies } = makeDependencies(asset);

  await assert.rejects(
    deleteAssetCompletely(asset.id, asset.uploaded_by, dependencies),
    { statusCode: 403 }
  );
  await fs.access(path.join(asset.testRoot, asset.filename));
});
