const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { moveAssetFileAndUpdate } = require('../services/assetFileMove');
const {
  recoverAssetLifecycleOperations,
  recoverLifecycleOperation,
} = require('../services/assetLifecycleOperations');

async function createFixture(t, newStatus = 'Approved') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-asset-move-'));
  const oldFilename = 'varsha/2026/10/Pending/asset.jpg';
  const newFilename = `varsha/2026/10/${newStatus}/asset.jpg`;
  const oldPath = path.join(root, ...oldFilename.split('/'));
  const newPath = path.join(root, ...newFilename.split('/'));
  await fs.mkdir(path.dirname(oldPath), { recursive: true });
  await fs.writeFile(oldPath, 'original');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const state = {
    asset: { id: 251, filename: oldFilename, status: 'pending', uploaded_by: 227, title: 'dsg' },
    operations: [],
    nextOperationId: 1,
  };
  const failures = { update: null, commit: null };
  let transactionSnapshot;
  let commitCount = 0;

  function queryState(sql, values = []) {
    if (/^SELECT id, filename, status, uploaded_by/.test(sql)) {
      return { rows: state.asset ? [{ ...state.asset }] : [] };
    }
    if (/^SELECT filename FROM images/.test(sql)) {
      return { rows: state.asset ? [{ filename: state.asset.filename }] : [] };
    }
    if (/^INSERT INTO asset_lifecycle_operations/.test(sql)) {
      const operation = {
        id: state.nextOperationId++,
        asset_id: Number(values[0]),
        operation: 'move',
        state: 'prepared',
        old_filename: values[1],
        new_filename: values[2],
        content_sha256: values[3] ?? null,
        temporary_device: null,
        temporary_inode: null,
        thumbnail_paths: [],
      };
      state.operations.push(operation);
      return { rows: [{ id: operation.id }] };
    }
    if (/^SELECT id, asset_id, operation, state, old_filename, new_filename, content_sha256,\s+temporary_device, temporary_inode, thumbnail_paths/.test(sql)) {
      const operation = state.operations.find((item) => item.id === Number(values[0]));
      return { rows: operation ? [{ ...operation }] : [] };
    }
    if (/^UPDATE asset_lifecycle_operations/.test(sql)) {
      const operationId = sql.includes('SET temporary_device = NULL')
        ? Number(values[0])
        : Number(values[2] ?? values[0]);
      const operation = state.operations.find((item) => item.id === operationId);
      if (operation) {
        if (sql.includes('SET temporary_device = NULL')) {
          operation.temporary_device = null;
          operation.temporary_inode = null;
        } else if (sql.includes('temporary_device')) {
          operation.temporary_device = values[0];
          operation.temporary_inode = values[1];
        } else if (values.length > 1) {
          operation.state = values[0];
          operation.error_message = values[1];
        } else {
          operation.state = sql.includes("'db_committed'") ? 'db_committed' : operation.state;
        }
      }
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE images/.test(sql)) {
      if (failures.update) throw failures.update;
      state.asset = { ...state.asset, status: values[0], filename: values[1] };
      return { rows: [{ ...state.asset }] };
    }
    if (/^(SELECT pg_advisory_lock|SELECT pg_advisory_unlock)/.test(sql)) return { rows: [{ pg_advisory_lock: true }] };
    return { rows: [] };
  }

  const client = {
    async query(sql, values = []) {
      if (sql === 'BEGIN') transactionSnapshot = structuredClone(state);
      if (sql === 'ROLLBACK' && transactionSnapshot) {
        Object.assign(state, transactionSnapshot);
        transactionSnapshot = null;
      }
      if (sql === 'COMMIT') {
        commitCount += 1;
        if (failures.commit) {
          if (failures.commit.at === commitCount) {
            const error = failures.commit.error;
            if (failures.commit.afterPersist) transactionSnapshot = null;
            failures.commit = null;
            throw error;
          }
        }
        transactionSnapshot = null;
      }
      return queryState(sql, values);
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query(sql, values = []) {
      if (/WHERE state IN/.test(sql)) {
        return {
          rows: state.operations.filter((item) =>
            ['prepared', 'db_committed', 'recovery_required'].includes(item.state) ||
            (item.operation === 'move' && item.state === 'completed' &&
              (item.temporary_device !== null && item.temporary_device !== undefined ||
                item.temporary_inode !== null && item.temporary_inode !== undefined))
          ).map((item) => ({ ...item })),
        };
      }
      if (/^SELECT id, asset_id, operation, state, old_filename, new_filename, content_sha256,\s+temporary_device, temporary_inode, thumbnail_paths/.test(sql)) {
        const operation = state.operations.find((item) => item.id === Number(values[0]));
        return { rows: operation ? [{ ...operation }] : [] };
      }
      return queryState(sql, values);
    },
  };

  return { root, oldFilename, newFilename, oldPath, newPath, state, failures, client, pool };
}

for (const status of ['Approved', 'Rejected']) {
  test(`moves an original to ${status} and records matching database state`, async (t) => {
    const fixture = await createFixture(t, status);
    const result = await moveAssetFileAndUpdate(fixture.pool, 251, status, fixture.root);

    assert.equal(result.asset.filename, fixture.newFilename);
    assert.equal(result.asset.status, status.toLowerCase());
    assert.equal(fixture.state.asset.filename, fixture.newFilename);
    assert.equal(fixture.state.operations[0].state, 'completed');
    await assert.rejects(fs.access(fixture.oldPath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'original');
  });
}

test('restores the old database-valid file after a database update failure', async (t) => {
  const fixture = await createFixture(t);
  fixture.failures.update = new Error('database update failed');

  await assert.rejects(moveAssetFileAndUpdate(fixture.pool, 251, 'Approved', fixture.root), /database update failed/);
  assert.equal(fixture.state.asset.filename, fixture.oldFilename);
  assert.equal(fixture.state.operations[0].state, 'aborted');
  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
});

test('does not overwrite a destination created after the initial collision check', async (t) => {
  const fixture = await createFixture(t);
  const originalLink = fs.link;
  fs.link = async (source, destination) => {
    await fs.writeFile(destination, 'unrelated destination');
    return originalLink(source, destination);
  };

  try {
    await assert.rejects(
      moveAssetFileAndUpdate(fixture.pool, 251, 'Approved', fixture.root),
      /EEXIST|already exists/i
    );
  } finally {
    fs.link = originalLink;
  }

  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'unrelated destination');
  assert.equal(fixture.state.operations[0].state, 'recovery_required');
});

test('does not remove a same-content destination it cannot attribute to the move', async (t) => {
  const fixture = await createFixture(t);
  const originalLink = fs.link;
  fs.link = async (source, destination) => {
    await fs.writeFile(destination, 'original');
    return originalLink(source, destination);
  };

  try {
    await assert.rejects(
      moveAssetFileAndUpdate(fixture.pool, 251, 'Approved', fixture.root),
      /EEXIST|already exists/i
    );
  } finally {
    fs.link = originalLink;
  }

  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'original');
  assert.equal(fixture.state.operations[0].state, 'recovery_required');
});

test('rejects an unrelated pre-existing destination without changing either file', async (t) => {
  const fixture = await createFixture(t);
  await fs.mkdir(path.dirname(fixture.newPath), { recursive: true });
  await fs.writeFile(fixture.newPath, 'unrelated destination');

  await assert.rejects(
    moveAssetFileAndUpdate(fixture.pool, 251, 'Approved', fixture.root),
    /already exists/i
  );

  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'unrelated destination');
  assert.equal(fixture.state.operations.length, 0);
});

test('does not remove a committed move source when the destination content differs', async (t) => {
  const fixture = await createFixture(t);
  await fs.mkdir(path.dirname(fixture.newPath), { recursive: true });
  await fs.writeFile(fixture.newPath, 'unrelated destination');
  fixture.state.asset.filename = fixture.newFilename;
  fixture.state.operations.push({
    id: 76,
    asset_id: 251,
    operation: 'move',
    state: 'db_committed',
    old_filename: fixture.oldFilename,
    new_filename: fixture.newFilename,
    content_sha256: crypto.createHash('sha256').update('original').digest('hex'),
    thumbnail_paths: [],
  });

  const result = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });

  assert.equal(result.failed, 1);
  assert.equal(fixture.state.operations[0].state, 'recovery_required');
  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'unrelated destination');
});

test('does not remove the source for a same-content destination without an identity witness', async (t) => {
  const fixture = await createFixture(t);
  await fs.mkdir(path.dirname(fixture.newPath), { recursive: true });
  await fs.writeFile(fixture.newPath, 'original');
  fixture.state.asset.filename = fixture.newFilename;
  fixture.state.operations.push({
    id: 79,
    asset_id: 251,
    operation: 'move',
    state: 'db_committed',
    old_filename: fixture.oldFilename,
    new_filename: fixture.newFilename,
    content_sha256: crypto.createHash('sha256').update('original').digest('hex'),
    thumbnail_paths: [],
  });

  const result = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });

  assert.equal(result.failed, 1);
  assert.equal(fixture.state.operations[0].state, 'recovery_required');
  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'original');
});

test('preserves a planted same-content temporary hard link without journaled identity', async (t) => {
  const fixture = await createFixture(t);
  await fs.mkdir(path.dirname(fixture.newPath), { recursive: true });
  const temporaryPath = `${fixture.newPath}.asset-lifecycle-82.tmp`;
  await fs.copyFile(fixture.oldPath, temporaryPath);
  await fs.link(temporaryPath, fixture.newPath);
  fixture.state.asset.filename = fixture.oldFilename;
  fixture.state.operations.push({
    id: 82,
    asset_id: 251,
    operation: 'move',
    state: 'prepared',
    old_filename: fixture.oldFilename,
    new_filename: fixture.newFilename,
    content_sha256: crypto.createHash('sha256').update('original').digest('hex'),
    temporary_device: null,
    temporary_inode: null,
    thumbnail_paths: [],
  });

  const result = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });

  assert.equal(result.failed, 1);
  assert.equal(fixture.state.operations[0].state, 'recovery_required');
  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'original');
  assert.equal(await fs.readFile(temporaryPath, 'utf8'), 'original');
});

test('recovers a committed move with a journal-verified destination idempotently', async (t) => {
  const fixture = await createFixture(t);
  await fs.mkdir(path.dirname(fixture.newPath), { recursive: true });
  await fs.writeFile(fixture.newPath, 'original');
  const temporaryPath = `${fixture.newPath}.asset-lifecycle-75.tmp`;
  await fs.link(fixture.newPath, temporaryPath);
  const temporaryStats = await fs.lstat(temporaryPath);
  fixture.state.asset.filename = fixture.newFilename;
  fixture.state.operations.push({
    id: 75,
    asset_id: 251,
    operation: 'move',
    state: 'db_committed',
    old_filename: fixture.oldFilename,
    new_filename: fixture.newFilename,
    content_sha256: crypto.createHash('sha256').update('original').digest('hex'),
    temporary_device: String(temporaryStats.dev),
    temporary_inode: String(temporaryStats.ino),
    thumbnail_paths: [],
  });

  const first = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });
  const second = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });

  assert.equal(first.failed, 0);
  assert.equal(first.recovered, 1);
  assert.equal(second.failed, 0);
  assert.equal(second.recovered, 0);
  assert.equal(fixture.state.operations[0].state, 'completed');
  await assert.rejects(fs.access(fixture.oldPath), { code: 'ENOENT' });
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'original');
  await assert.rejects(fs.access(temporaryPath), { code: 'ENOENT' });
});

test('recreates a missing committed destination and clears its identity after cleanup', async (t) => {
  const fixture = await createFixture(t);
  fixture.state.asset.filename = fixture.newFilename;
  fixture.state.operations.push({
    id: 83,
    asset_id: 251,
    operation: 'move',
    state: 'db_committed',
    old_filename: fixture.oldFilename,
    new_filename: fixture.newFilename,
    content_sha256: crypto.createHash('sha256').update('original').digest('hex'),
    temporary_device: null,
    temporary_inode: null,
    thumbnail_paths: [],
  });

  const first = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });
  const second = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });

  assert.equal(first.failed, 0);
  assert.equal(first.recovered, 1);
  assert.equal(second.failed, 0);
  assert.equal(second.recovered, 0);
  assert.equal(fixture.state.operations[0].state, 'completed');
  assert.equal(fixture.state.operations[0].temporary_device, null);
  assert.equal(fixture.state.operations[0].temporary_inode, null);
  await assert.rejects(fs.access(fixture.oldPath), { code: 'ENOENT' });
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'original');
  await assert.rejects(fs.access(`${fixture.newPath}.asset-lifecycle-83.tmp`), { code: 'ENOENT' });
});

test('recovers after source cleanup using the journaled destination hash', async (t) => {
  const fixture = await createFixture(t);
  await fs.mkdir(path.dirname(fixture.newPath), { recursive: true });
  await fs.writeFile(fixture.newPath, 'original');
  const temporaryPath = `${fixture.newPath}.asset-lifecycle-85.tmp`;
  await fs.link(fixture.newPath, temporaryPath);
  const temporaryStats = await fs.lstat(temporaryPath);
  await fs.unlink(fixture.oldPath);
  fixture.state.asset.filename = fixture.newFilename;
  fixture.state.operations.push({
    id: 85,
    asset_id: 251,
    operation: 'move',
    state: 'db_committed',
    old_filename: fixture.oldFilename,
    new_filename: fixture.newFilename,
    content_sha256: crypto.createHash('sha256').update('original').digest('hex'),
    temporary_device: String(temporaryStats.dev),
    temporary_inode: String(temporaryStats.ino),
    thumbnail_paths: [],
  });

  const first = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });
  const second = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });

  assert.equal(first.failed, 0);
  assert.equal(first.recovered, 1);
  assert.equal(second.failed, 0);
  assert.equal(second.recovered, 0);
  assert.equal(fixture.state.operations[0].state, 'completed');
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'original');
  await assert.rejects(fs.access(temporaryPath), { code: 'ENOENT' });
});

test('retries temporary-link cleanup after a crash following journal completion', async (t) => {
  const fixture = await createFixture(t);
  await fs.mkdir(path.dirname(fixture.newPath), { recursive: true });
  const temporaryPath = `${fixture.newPath}.asset-lifecycle-86.tmp`;
  await fs.copyFile(fixture.oldPath, temporaryPath);
  await fs.link(temporaryPath, fixture.newPath);
  const temporaryStats = await fs.lstat(temporaryPath);
  fixture.state.asset.filename = fixture.newFilename;
  const operation = {
    id: 86,
    asset_id: 251,
    operation: 'move',
    state: 'db_committed',
    old_filename: fixture.oldFilename,
    new_filename: fixture.newFilename,
    content_sha256: crypto.createHash('sha256').update('original').digest('hex'),
    temporary_device: String(temporaryStats.dev),
    temporary_inode: String(temporaryStats.ino),
    thumbnail_paths: [],
  };
  fixture.state.operations.push(operation);

  const originalUnlink = fs.unlink;
  fs.unlink = async (filePath) => {
    if (filePath === temporaryPath) throw new Error('simulated crash before temporary unlink');
    return originalUnlink(filePath);
  };
  try {
    await assert.rejects(
      recoverLifecycleOperation(fixture.pool, operation, { assetRoot: fixture.root }),
      /simulated crash/
    );
  } finally {
    fs.unlink = originalUnlink;
  }

  assert.equal(fixture.state.operations[0].state, 'completed');
  await assert.rejects(fs.access(fixture.oldPath), { code: 'ENOENT' });
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'original');
  await fs.access(temporaryPath);

  const retry = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });
  const repeatedRetry = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });

  assert.equal(retry.failed, 0);
  assert.equal(retry.recovered, 1);
  assert.equal(repeatedRetry.failed, 0);
  assert.equal(repeatedRetry.recovered, 0);
  assert.equal(fixture.state.operations[0].state, 'completed');
  assert.equal(fixture.state.operations[0].temporary_device, null);
  assert.equal(fixture.state.operations[0].temporary_inode, null);
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'original');
  await assert.rejects(fs.access(temporaryPath), { code: 'ENOENT' });
});

test('preserves files and requires recovery when completed temporary identity mismatches', async (t) => {
  const fixture = await createFixture(t);
  await fs.mkdir(path.dirname(fixture.newPath), { recursive: true });
  await fs.writeFile(fixture.newPath, 'original');
  const temporaryPath = `${fixture.newPath}.asset-lifecycle-87.tmp`;
  await fs.writeFile(temporaryPath, 'original');
  const temporaryStats = await fs.lstat(temporaryPath);
  fixture.state.asset.filename = fixture.newFilename;
  fixture.state.operations.push({
    id: 87,
    asset_id: 251,
    operation: 'move',
    state: 'completed',
    old_filename: fixture.oldFilename,
    new_filename: fixture.newFilename,
    content_sha256: crypto.createHash('sha256').update('original').digest('hex'),
    temporary_device: String(temporaryStats.dev),
    temporary_inode: String(temporaryStats.ino + 1),
    thumbnail_paths: [],
  });

  const result = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });

  assert.equal(result.failed, 1);
  assert.equal(fixture.state.operations[0].state, 'recovery_required');
  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'original');
  assert.equal(await fs.readFile(temporaryPath, 'utf8'), 'original');
});

test('reconciles a commit failure without leaving DB and filesystem paths inconsistent', async (t) => {
  const fixture = await createFixture(t);
  fixture.failures.commit = { at: 2, error: new Error('commit failed') };

  await assert.rejects(moveAssetFileAndUpdate(fixture.pool, 251, 'Approved', fixture.root), /commit failed/);
  assert.equal(fixture.state.asset.filename, fixture.oldFilename);
  assert.equal(fixture.state.operations[0].state, 'aborted');
  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
});

test('leaves an unattributed temporary file and prepared journal pending after interruption', async (t) => {
  const fixture = await createFixture(t);
  fixture.state.operations.push({
    id: 77,
    asset_id: 251,
    operation: 'move',
    state: 'prepared',
    old_filename: fixture.oldFilename,
    new_filename: fixture.newFilename,
    content_sha256: crypto.createHash('sha256').update('original').digest('hex'),
    thumbnail_paths: [],
  });
  const temporaryPath = `${fixture.newPath}.asset-lifecycle-77.tmp`;
  await fs.mkdir(path.dirname(temporaryPath), { recursive: true });
  await fs.writeFile(temporaryPath, 'partial');

  const firstRecovery = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });
  const secondRecovery = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });

  assert.equal(firstRecovery.failed, 1);
  assert.equal(secondRecovery.failed, 1);
  assert.equal(fixture.state.operations[0].state, 'recovery_required');
  assert.equal(fixture.state.asset.filename, fixture.oldFilename);
  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
  assert.equal(await fs.readFile(temporaryPath, 'utf8'), 'partial');
});

test('recovers an interrupted prepared move only when destination and temporary link identity match', async (t) => {
  const fixture = await createFixture(t);
  const operationId = 80;
  const temporaryPath = `${fixture.newPath}.asset-lifecycle-${operationId}.tmp`;
  await fs.mkdir(path.dirname(temporaryPath), { recursive: true });
  await fs.copyFile(fixture.oldPath, temporaryPath);
  await fs.link(temporaryPath, fixture.newPath);
  const temporaryStats = await fs.lstat(temporaryPath);
  fixture.state.operations.push({
    id: operationId,
    asset_id: 251,
    operation: 'move',
    state: 'prepared',
    old_filename: fixture.oldFilename,
    new_filename: fixture.newFilename,
    content_sha256: crypto.createHash('sha256').update('original').digest('hex'),
    temporary_device: String(temporaryStats.dev),
    temporary_inode: String(temporaryStats.ino),
    thumbnail_paths: [],
  });

  const first = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });
  const second = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });

  assert.equal(first.failed, 0);
  assert.equal(first.recovered, 1);
  assert.equal(second.failed, 0);
  assert.equal(second.recovered, 0);
  assert.equal(fixture.state.operations[0].state, 'aborted');
  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
  await assert.rejects(fs.access(fixture.newPath), { code: 'ENOENT' });
  await assert.rejects(fs.access(temporaryPath), { code: 'ENOENT' });
});

test('completes a committed same-path status move without touching the file', async (t) => {
  const fixture = await createFixture(t);
  await fs.mkdir(path.dirname(fixture.newPath), { recursive: true });
  await fs.rename(fixture.oldPath, fixture.newPath);
  fixture.state.asset.filename = fixture.newFilename;
  fixture.state.asset.status = 'pending';

  const result = await moveAssetFileAndUpdate(fixture.pool, 251, 'Approved', fixture.root);

  assert.equal(result.asset.filename, fixture.newFilename);
  assert.equal(fixture.state.asset.status, 'approved');
  assert.equal(fixture.state.operations[0].old_filename, fixture.newFilename);
  assert.equal(fixture.state.operations[0].new_filename, fixture.newFilename);
  assert.equal(fixture.state.operations[0].state, 'completed');
  assert.equal(await fs.readFile(path.join(fixture.root, fixture.newFilename), 'utf8'), 'original');
});

test('recovers a committed same-path move and remains idempotent', async (t) => {
  const fixture = await createFixture(t);
  await fs.mkdir(path.dirname(fixture.newPath), { recursive: true });
  await fs.rename(fixture.oldPath, fixture.newPath);
  fixture.state.asset.filename = fixture.newFilename;
  fixture.state.asset.status = 'approved';
  fixture.state.operations.push({
    id: 84,
    asset_id: 251,
    operation: 'move',
    state: 'db_committed',
    old_filename: fixture.newFilename,
    new_filename: fixture.newFilename,
    content_sha256: null,
    thumbnail_paths: [],
  });

  const first = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: null });
  const second = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: null });

  assert.equal(first.recovered, 1);
  assert.equal(first.failed, 0);
  assert.equal(second.recovered, 0);
  assert.equal(fixture.state.operations[0].state, 'completed');
  assert.equal(await fs.readFile(path.join(fixture.root, fixture.newFilename), 'utf8'), 'original');
});

test('leaves filesystem-dependent move recovery pending when local storage is unavailable', async (t) => {
  const fixture = await createFixture(t);
  fixture.state.operations.push({
    id: 78,
    asset_id: 251,
    operation: 'move',
    state: 'prepared',
    old_filename: fixture.oldFilename,
    new_filename: fixture.newFilename,
    thumbnail_paths: [],
  });

  const result = await recoverAssetLifecycleOperations(fixture.pool, {
    assetRoot: null,
    thumbnailRoot: null,
  });

  assert.equal(result.recovered, 0);
  assert.equal(result.failed, 1);
  assert.equal(fixture.state.operations[0].state, 'recovery_required');
  assert.match(fixture.state.operations[0].error_message, /original asset storage is unavailable/i);
  assert.equal(fixture.state.asset.filename, fixture.oldFilename);
  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
});

test('startup recovery completes a committed move and can run repeatedly', async (t) => {
  const fixture = await createFixture(t);
  await fs.mkdir(path.dirname(fixture.newPath), { recursive: true });
  const temporaryPath = `${fixture.newPath}.asset-lifecycle-81.tmp`;
  await fs.copyFile(fixture.oldPath, temporaryPath);
  await fs.link(temporaryPath, fixture.newPath);
  const temporaryStats = await fs.lstat(temporaryPath);
  fixture.state.asset.filename = fixture.newFilename;
  fixture.state.asset.status = 'approved';
  fixture.state.operations.push({
    id: 81,
    asset_id: 251,
    operation: 'move',
    state: 'db_committed',
    old_filename: fixture.oldFilename,
    new_filename: fixture.newFilename,
    temporary_device: String(temporaryStats.dev),
    temporary_inode: String(temporaryStats.ino),
    thumbnail_paths: [],
  });

  const first = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });
  const second = await recoverAssetLifecycleOperations(fixture.pool, { assetRoot: fixture.root });

  assert.equal(first.failed, 0);
  assert.equal(first.recovered, 1);
  assert.equal(second.recovered, 0);
  assert.equal(fixture.state.asset.filename, fixture.newFilename);
  assert.equal(fixture.state.operations[0].state, 'completed');
  await assert.rejects(fs.access(fixture.oldPath), { code: 'ENOENT' });
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'original');
  await assert.rejects(fs.access(temporaryPath), { code: 'ENOENT' });
});

test('refuses traversal and symlinked asset paths', async (t) => {
  const fixture = await createFixture(t);
  fixture.state.asset.filename = '../escape.jpg';
  await assert.rejects(
    moveAssetFileAndUpdate(fixture.pool, 251, 'Approved', fixture.root),
    /path escapes|invalid/i
  );

  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-asset-move-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const symlinkFixture = await createFixture(t);
  symlinkFixture.state.asset.filename = 'linked/Pending/asset.jpg';
  const symlinkRoot = path.join(symlinkFixture.root, 'linked');
  await fs.symlink(outside, symlinkRoot, 'dir');
  await fs.mkdir(path.join(outside, 'Pending'), { recursive: true });
  await fs.writeFile(path.join(outside, 'Pending', 'asset.jpg'), 'outside');
  await assert.rejects(
    moveAssetFileAndUpdate(
      symlinkFixture.pool,
      251,
      'Approved',
      symlinkFixture.root
    ),
    /unsafe directory/i
  );
  assert.equal(await fs.readFile(path.join(outside, 'Pending', 'asset.jpg'), 'utf8'), 'outside');
});

test('keeps the old original when publishing the staged copy fails', async (t) => {
  const fixture = await createFixture(t);
  const originalLink = fs.link;
  fs.link = async (source, destination) => {
    if (destination === fixture.newPath) throw new Error('final link failed');
    return originalLink(source, destination);
  };
  try {
    await assert.rejects(
      moveAssetFileAndUpdate(fixture.pool, 251, 'Approved', fixture.root),
      /final link failed/
    );
  } finally {
    fs.link = originalLink;
  }
  assert.equal(fixture.state.asset.filename, fixture.oldFilename);
  assert.equal(await fs.readFile(fixture.oldPath, 'utf8'), 'original');
  assert.equal(fixture.state.operations[0].state, 'aborted');
});

test('preserves the committed file when commit acknowledgement is ambiguous', async (t) => {
  const fixture = await createFixture(t);
  fixture.failures.commit = {
    at: 2,
    error: new Error('commit acknowledgement failed'),
    afterPersist: true,
  };

  await assert.rejects(
    moveAssetFileAndUpdate(fixture.pool, 251, 'Approved', fixture.root),
    /commit acknowledgement failed/
  );
  assert.equal(fixture.state.asset.filename, fixture.newFilename);
  assert.equal(fixture.state.operations[0].state, 'completed');
  await assert.rejects(fs.access(fixture.oldPath), { code: 'ENOENT' });
  assert.equal(await fs.readFile(fixture.newPath, 'utf8'), 'original');
});
