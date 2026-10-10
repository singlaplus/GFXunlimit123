const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { deleteAssetCompletely } = require('../services/assetDeletion');
const { recoverAssetLifecycleOperations } = require('../services/assetLifecycleOperations');

async function prepareAsset(t, overrides = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-asset-delete-'));
  const assetRoot = path.join(tempRoot, 'assets');
  const thumbnailRoot = path.join(tempRoot, 'thumbnails');
  const filename = 'contributor/Pending/asset.jpg';
  const thumbnailPath = '2026/10/02/title_asset_42.webp';
  const orphanThumbnailPath = '2026/10/02/old_asset_42.webp';
  await fs.mkdir(path.dirname(path.join(assetRoot, filename)), { recursive: true });
  await fs.mkdir(path.join(thumbnailRoot, '2026/10/02'), { recursive: true });
  await fs.writeFile(path.join(assetRoot, filename), 'original');
  await fs.writeFile(path.join(assetRoot, 'contributor/Pending/other.jpg'), 'other');
  await fs.writeFile(path.join(thumbnailRoot, thumbnailPath), 'thumbnail');
  await fs.writeFile(path.join(thumbnailRoot, orphanThumbnailPath), 'orphan');
  await fs.writeFile(path.join(thumbnailRoot, '2026/10/02/other_asset_42.webp'), 'other');
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));

  const state = {
    asset: {
      id: 42,
      filename,
      uploaded_by: 7,
      title: 'Asset',
      status: 'approved',
      requesterRole: 'admin',
      ...overrides,
    },
    operations: [],
    nextOperationId: 1,
    transactionCount: 0,
  };
  let snapshot;
  let failCommitAt = null;
  let failCommitAfterPersist = false;
  let failDelete = null;

  function query(sql, values = []) {
    if (/SELECT id, filename, uploaded_by, title, status FROM images/.test(sql)) {
      return { rows: state.asset ? [{ ...state.asset }] : [] };
    }
    if (/SELECT role FROM users/.test(sql)) return { rows: [{ role: state.asset.requesterRole }] };
    if (/SELECT thumbnail_path FROM asset_thumbnail_metadata/.test(sql)) {
      return { rows: [{ thumbnail_path: state.thumbnailPath || thumbnailPath }] };
    }
    if (/SELECT thumbnail_path FROM asset_thumbnail_orphans/.test(sql)) {
      return { rows: [{ thumbnail_path: state.orphanThumbnailPath || orphanThumbnailPath }] };
    }
    if (/SELECT id FROM images WHERE id = \$1 FOR UPDATE/.test(sql)) {
      return { rows: state.asset ? [{ id: state.asset.id }] : [] };
    }
    if (/^INSERT INTO asset_lifecycle_operations/.test(sql)) {
      const operation = {
        id: state.nextOperationId++,
        asset_id: values[0],
        operation: 'delete',
        state: 'prepared',
        old_filename: values[1],
        thumbnail_paths: JSON.parse(values[2]),
      };
      state.operations.push(operation);
      return { rows: [{ id: operation.id }] };
    }
    if (/^SELECT id, asset_id, operation, state, old_filename, new_filename, (?:content_sha256, )?thumbnail_paths/.test(sql)) {
      const operation = state.operations.find((item) => item.id === Number(values[0]));
      return { rows: operation ? [{ ...operation }] : [] };
    }
    if (/^SELECT filename FROM images/.test(sql)) {
      return { rows: state.asset ? [{ filename: state.asset.filename }] : [] };
    }
    if (/^UPDATE asset_lifecycle_operations/.test(sql)) {
      const operationId = values.length > 1 ? Number(values[2]) : Number(values[0]);
      const operation = state.operations.find((item) => item.id === operationId);
      if (operation) {
        operation.state = values.length > 1
          ? values[0]
          : sql.includes("'db_committed'") ? 'db_committed' : operation.state;
        operation.error_message = values[1] ?? null;
      }
      return { rows: [] };
    }
    if (/^DELETE FROM images/.test(sql)) {
      if (failDelete) throw failDelete;
      const deleted = state.asset;
      state.asset = null;
      return { rows: deleted ? [{ id: deleted.id }] : [] };
    }
    return { rows: [], rowCount: 1 };
  }

  const client = {
    async query(sql, values = []) {
      if (sql === 'BEGIN') {
        state.transactionCount += 1;
        snapshot = structuredClone(state);
      }
      if (sql === 'ROLLBACK' && snapshot) {
        Object.assign(state, snapshot);
        snapshot = null;
      }
      if (/^SELECT pg_advisory_(lock|unlock)/.test(sql)) return { rows: [{}] };
      if (sql === 'COMMIT') {
        if (state.transactionCount === failCommitAt && !failCommitAfterPersist) {
          Object.assign(state, snapshot);
          snapshot = null;
          return Promise.reject(new Error('commit failed'));
        }
        snapshot = null;
        const result = { rows: [] };
        if (state.transactionCount === failCommitAt && failCommitAfterPersist) {
          failCommitAt = null;
          throw new Error('commit acknowledgement failed');
        }
        return result;
      }
      return query(sql, values);
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query(sql, values = []) {
      if (/WHERE state IN/.test(sql)) {
        return { rows: state.operations.filter((item) => ['prepared', 'db_committed', 'recovery_required'].includes(item.state)).map((item) => ({ ...item })) };
      }
      return query(sql, values);
    },
  };
  const assetThumbnails = {
    acquireAssetLifecycleLock: async () => () => {},
    getOriginalAssetStorageRoot: () => assetRoot,
    getThumbnailStorageRoot: () => thumbnailRoot,
    normalizeThumbnailRelativePath(value) {
      if (!/^\d{4}\/\d{2}\/\d{2}\/[^/]+_42\.webp$/.test(value)) throw new Error('Invalid thumbnail path');
      return value;
    },
  };
  const thumbnailQueue = { async cancelAssetThumbnailJobs() {} };

  return {
    assetRoot,
    thumbnailRoot,
    filename,
    thumbnailPath,
    orphanThumbnailPath,
    state,
    pool,
    client,
    dependencies: { pool, assetThumbnails, thumbnailQueue },
    failCommit(at, afterPersist = false) {
      failCommitAt = at;
      failCommitAfterPersist = afterPersist;
    },
    failImageDelete(error) { failDelete = error; },
  };
}

test('deletes the selected asset and thumbnails while preserving unrelated files', async (t) => {
  const fixture = await prepareAsset(t);
  const result = await deleteAssetCompletely(42, 99, fixture.dependencies);

  assert.equal(result.deleted, true);
  assert.equal(result.cleanupPending, false);
  assert.equal(fixture.state.asset, null);
  assert.equal(fixture.state.operations[0].state, 'completed');
  await assert.rejects(fs.access(path.join(fixture.assetRoot, fixture.filename)), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(fixture.thumbnailRoot, fixture.thumbnailPath)), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(fixture.thumbnailRoot, fixture.orphanThumbnailPath)), { code: 'ENOENT' });
  await fs.access(path.join(fixture.assetRoot, 'contributor/Pending/other.jpg'));
  await fs.access(path.join(fixture.thumbnailRoot, '2026/10/02/other_asset_42.webp'));
});

test('database failure before commit preserves the row and original and aborts durable intent', async (t) => {
  const fixture = await prepareAsset(t);
  fixture.failCommit(2);

  await assert.rejects(deleteAssetCompletely(42, 99, fixture.dependencies), /commit failed/);
  assert.ok(fixture.state.asset);
  assert.equal(fixture.state.asset.filename, fixture.filename);
  assert.equal(fixture.state.operations[0].state, 'aborted');
  await fs.access(path.join(fixture.assetRoot, fixture.filename));
  await fs.access(path.join(fixture.thumbnailRoot, fixture.thumbnailPath));
});

test('ambiguous committed deletion remains recoverable and removes originals and thumbnails', async (t) => {
  const fixture = await prepareAsset(t);
  fixture.failCommit(2, true);

  await assert.rejects(deleteAssetCompletely(42, 99, fixture.dependencies), /commit acknowledgement failed/);
  assert.equal(fixture.state.asset, null);
  assert.equal(fixture.state.operations[0].state, 'completed');
  await assert.rejects(fs.access(path.join(fixture.assetRoot, fixture.filename)), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(fixture.thumbnailRoot, fixture.thumbnailPath)), { code: 'ENOENT' });
});

test('failed database deletion leaves a durable prepared operation and keeps all files', async (t) => {
  const fixture = await prepareAsset(t);
  fixture.failImageDelete(new Error('database delete failed'));

  await assert.rejects(deleteAssetCompletely(42, 99, fixture.dependencies), /database delete failed/);
  assert.ok(fixture.state.asset);
  assert.equal(fixture.state.operations[0].state, 'aborted');
  await fs.access(path.join(fixture.assetRoot, fixture.filename));
  await fs.access(path.join(fixture.thumbnailRoot, fixture.thumbnailPath));
});

test('retries committed deletion cleanup after restart and is idempotent', async (t) => {
  const fixture = await prepareAsset(t);
  fixture.state.asset = null;
  fixture.state.operations.push({
    id: 80,
    asset_id: 42,
    operation: 'delete',
    state: 'db_committed',
    old_filename: fixture.filename,
    new_filename: null,
    thumbnail_paths: [fixture.thumbnailPath, fixture.orphanThumbnailPath],
  });

  const first = await recoverAssetLifecycleOperations(fixture.pool, {
    assetRoot: fixture.assetRoot,
    thumbnailRoot: fixture.thumbnailRoot,
  });
  const second = await recoverAssetLifecycleOperations(fixture.pool, {
    assetRoot: fixture.assetRoot,
    thumbnailRoot: fixture.thumbnailRoot,
  });

  assert.equal(first.failed, 0);
  assert.equal(first.recovered, 1);
  assert.equal(second.failed, 0);
  assert.equal(second.recovered, 0);
  assert.equal(fixture.state.operations[0].state, 'completed');
  await assert.rejects(fs.access(path.join(fixture.assetRoot, fixture.filename)), { code: 'ENOENT' });
});

test('leaves committed deletion pending when required thumbnail storage is unavailable', async (t) => {
  const fixture = await prepareAsset(t);
  fixture.state.asset = null;
  fixture.state.operations.push({
    id: 82,
    asset_id: 42,
    operation: 'delete',
    state: 'db_committed',
    old_filename: fixture.filename,
    new_filename: null,
    thumbnail_paths: [fixture.thumbnailPath],
  });

  const result = await recoverAssetLifecycleOperations(fixture.pool, {
    assetRoot: fixture.assetRoot,
    thumbnailRoot: null,
  });

  assert.equal(result.recovered, 0);
  assert.equal(result.failed, 1);
  assert.equal(fixture.state.operations[0].state, 'recovery_required');
  assert.match(fixture.state.operations[0].error_message, /thumbnail storage is unavailable/i);
  await fs.access(path.join(fixture.assetRoot, fixture.filename));
  await fs.access(path.join(fixture.thumbnailRoot, fixture.thumbnailPath));
});

test('resolves database-only deletion recovery without filesystem roots', async (t) => {
  const fixture = await prepareAsset(t);
  fixture.state.operations.push({
    id: 83,
    asset_id: 42,
    operation: 'delete',
    state: 'prepared',
    old_filename: fixture.filename,
    new_filename: null,
    thumbnail_paths: [fixture.thumbnailPath],
  });

  const result = await recoverAssetLifecycleOperations(fixture.pool, {
    assetRoot: null,
    thumbnailRoot: null,
  });

  assert.equal(result.failed, 0);
  assert.equal(result.recovered, 1);
  assert.equal(fixture.state.operations[0].state, 'aborted');
  await fs.access(path.join(fixture.assetRoot, fixture.filename));
  await fs.access(path.join(fixture.thumbnailRoot, fixture.thumbnailPath));
});

test('rejects symlinked original and thumbnail paths without deleting their targets', async (t) => {
  const fixture = await prepareAsset(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-asset-delete-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'asset.jpg'), 'outside');
  await fs.rm(path.join(fixture.assetRoot, 'contributor'), { recursive: true });
  await fs.symlink(outside, path.join(fixture.assetRoot, 'contributor'), 'dir');

  const result = await deleteAssetCompletely(42, 99, fixture.dependencies);
  assert.equal(result.deleted, true);
  assert.equal(result.cleanupPending, true);
  assert.equal(fixture.state.operations[0].state, 'recovery_required');
  assert.equal(await fs.readFile(path.join(outside, 'asset.jpg'), 'utf8'), 'outside');
});

test('retains durable recovery when thumbnail cleanup hits a symlink and retries after repair', async (t) => {
  const fixture = await prepareAsset(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-thumbnail-delete-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'title_asset_42.webp'), 'outside');
  await fs.rm(path.join(fixture.thumbnailRoot, '2026'), { recursive: true });
  await fs.symlink(outside, path.join(fixture.thumbnailRoot, '2026'), 'dir');

  const result = await deleteAssetCompletely(42, 99, fixture.dependencies);
  assert.equal(result.cleanupPending, true);
  assert.equal(fixture.state.asset, null);
  assert.equal(fixture.state.operations[0].state, 'recovery_required');
  assert.equal(await fs.readFile(path.join(outside, 'title_asset_42.webp'), 'utf8'), 'outside');

  await fs.unlink(path.join(fixture.thumbnailRoot, '2026'));
  await fs.mkdir(path.dirname(path.join(fixture.thumbnailRoot, fixture.thumbnailPath)), { recursive: true });
  await fs.writeFile(path.join(fixture.thumbnailRoot, fixture.thumbnailPath), 'thumbnail');
  const recovery = await recoverAssetLifecycleOperations(fixture.pool, {
    assetRoot: fixture.assetRoot,
    thumbnailRoot: fixture.thumbnailRoot,
  });
  assert.equal(recovery.failed, 0);
  assert.equal(fixture.state.operations[0].state, 'completed');
  await assert.rejects(fs.access(path.join(fixture.thumbnailRoot, fixture.thumbnailPath)), { code: 'ENOENT' });
});

test('preserves contributor deletion authorization limits for Pending assets', async (t) => {
  const fixture = await prepareAsset(t, { status: 'pending', requesterRole: 'contributor' });

  await assert.rejects(deleteAssetCompletely(42, 7, fixture.dependencies), { statusCode: 403 });
  assert.ok(fixture.state.asset);
  await fs.access(path.join(fixture.assetRoot, fixture.filename));
});
