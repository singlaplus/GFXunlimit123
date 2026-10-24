const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  cleanupAbandonedUploadStaging,
  hashStagedUpload,
  normalizeUploadRequestId,
  publishStagedUpload,
  verifyPublishedUpload,
} = require('../services/assetUploadLifecycle');

async function createStagedUpload(root, filename, content) {
  const stagedPath = path.join(root, '.upload-staging', 'request-1', filename);
  await fs.mkdir(path.dirname(stagedPath), { recursive: true });
  await fs.writeFile(stagedPath, content);
  const staged = await hashStagedUpload(root, stagedPath);
  return {
    stagedPath,
    witness: { ...staged.witness, sha256: staged.sha256 },
  };
}

test('upload request IDs must be UUIDs and normalize consistently', () => {
  const requestId = 'A2f85cf0-6b5e-4db7-9cac-1fbe5fa2dc31';
  assert.equal(normalizeUploadRequestId(requestId), requestId.toLowerCase());
  assert.throws(() => normalizeUploadRequestId('not-a-uuid'), /valid Idempotency-Key UUID/);
});

test('startup staging cleanup removes only request-scoped directories under the real asset root', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-staging-cleanup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingRoot = path.join(root, '.upload-staging');
  const requestDirectory = path.join(stagingRoot, randomUUID());
  const unrecognizedEntry = path.join(stagingRoot, 'preserve-me');
  await fs.mkdir(requestDirectory, { recursive: true });
  await fs.writeFile(path.join(requestDirectory, 'interrupted.part'), 'partial');
  await fs.writeFile(unrecognizedEntry, 'do not delete');

  const result = await cleanupAbandonedUploadStaging({ assetRoot: root, platform: 'linux' });
  assert.equal(result.removed, 1);
  assert.equal(result.pending.length, 1);
  assert.equal(await fs.readFile(unrecognizedEntry, 'utf8'), 'do not delete');
  await assert.rejects(fs.stat(requestDirectory), { code: 'ENOENT' });
});

test('macOS without ASSETS_ROOT does not touch local fallback staging', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-no-local-root-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requestDirectory = path.join(root, '.upload-staging', randomUUID());
  await fs.mkdir(requestDirectory, { recursive: true });
  await fs.writeFile(path.join(requestDirectory, 'partial.part'), 'partial');

  const result = await cleanupAbandonedUploadStaging({
    assetRoot: root,
    platform: 'darwin',
    configuredAssetRoot: '',
  });
  assert.deepEqual(result, { removed: 0, pending: [] });
  assert.equal(await fs.readFile(path.join(requestDirectory, 'partial.part'), 'utf8'), 'partial');
});

test('publishes the same staged inode without overwriting and verifies its content', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-asset-upload-publish-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const content = Buffer.from('complete original asset bytes');
  const { stagedPath, witness } = await createStagedUpload(root, 'original.jpg', content);
  const relativePath = 'owner/2026/10/Pending/original.jpg';

  const published = await publishStagedUpload(root, stagedPath, relativePath, witness);
  assert.equal(published.stats.size, content.length);
  assert.equal(published.alreadyPublished, false);
  await assert.rejects(fs.stat(stagedPath), { code: 'ENOENT' });

  const destination = path.join(root, relativePath);
  assert.deepEqual(await fs.readFile(destination), content);
  const verified = await verifyPublishedUpload(root, relativePath, witness);
  assert.equal(verified.sha256, witness.sha256);
});

test('publishes matching staged content when the filesystem identity is not stable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-asset-upload-unstable-identity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const content = Buffer.from('verified content on a filesystem with unstable file identities');
  const { stagedPath, witness } = await createStagedUpload(root, 'original.jpg', content);
  const relativePath = 'owner/2026/10/Pending/original.jpg';
  const persistedWitness = { ...witness, device: 'stale-device', inode: 'stale-inode' };
  let identityMarkedUnavailable = false;

  const published = await publishStagedUpload(
    root,
    stagedPath,
    relativePath,
    persistedWitness,
    async () => {
      identityMarkedUnavailable = true;
      persistedWitness.device = null;
      persistedWitness.inode = null;
    }
  );

  assert.equal(identityMarkedUnavailable, true);
  assert.equal(published.stats.size, content.length);
  assert.equal(persistedWitness.device, null);
  assert.equal(persistedWitness.inode, null);
  assert.equal((await verifyPublishedUpload(root, relativePath, persistedWitness)).sha256, witness.sha256);
});

test('does not publish different content when filesystem identity is unstable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-asset-upload-unstable-content-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { stagedPath, witness } = await createStagedUpload(root, 'original.jpg', Buffer.from('uploaded content'));
  let identityMarkedUnavailable = false;

  await assert.rejects(
    publishStagedUpload(
      root,
      stagedPath,
      'owner/2026/10/Pending/original.jpg',
      { ...witness, device: 'stale-device', inode: 'stale-inode', sha256: '0'.repeat(64) },
      async () => { identityMarkedUnavailable = true; }
    ),
    { code: 'UPLOAD_STAGING_MISMATCH', message: 'Staged upload does not match its persisted content witness.' }
  );
  assert.equal(identityMarkedUnavailable, false);
});

test('copies and verifies uploads when the storage filesystem does not support hard links', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-asset-upload-no-hard-links-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const content = Buffer.from('copy fallback keeps the uploaded bytes verified');
  const { stagedPath, witness } = await createStagedUpload(root, 'original.jpg', content);
  const relativePath = 'owner/2026/10/Pending/original.jpg';
  const persistedWitness = { ...witness };
  let identityMarkedUnavailable = false;

  const published = await publishStagedUpload(
    root,
    stagedPath,
    relativePath,
    witness,
    async () => {
      identityMarkedUnavailable = true;
      persistedWitness.device = null;
      persistedWitness.inode = null;
    },
    async () => {
      const error = new Error('Hard links are unsupported.');
      error.code = 'ENOTSUP';
      throw error;
    }
  );

  assert.equal(identityMarkedUnavailable, true);
  assert.equal(published.stats.size, content.length);
  assert.deepEqual(await fs.readFile(path.join(root, relativePath)), content);
  assert.equal(await fs.stat(stagedPath).then(() => true, (error) => error.code !== 'ENOENT'), false);
  assert.equal((await verifyPublishedUpload(root, relativePath, persistedWitness)).sha256, witness.sha256);
});

test('does not treat an existing destination as the same upload when identity is unavailable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-asset-upload-identity-collision-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const content = Buffer.from('same bytes do not prove this is the same upload operation');
  const { stagedPath, witness } = await createStagedUpload(root, 'original.jpg', content);
  const relativePath = 'owner/2026/10/Pending/original.jpg';
  const destination = path.join(root, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content);

  await assert.rejects(
    publishStagedUpload(
      root,
      stagedPath,
      relativePath,
      { ...witness, device: 'stale-device', inode: 'stale-inode' },
      async () => {},
      async () => {
        const error = new Error('Hard links are unsupported.');
        error.code = 'ENOTSUP';
        throw error;
      }
    ),
    { code: 'UPLOAD_DESTINATION_COLLISION' }
  );
  assert.equal(await fs.readFile(stagedPath, 'utf8'), content.toString());
});

test('a pre-existing destination collision is preserved with the staging file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-asset-upload-collision-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { stagedPath, witness } = await createStagedUpload(root, 'original.jpg', Buffer.from('new content'));
  const relativePath = 'owner/2026/10/Pending/original.jpg';
  const destination = path.join(root, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, 'unrelated existing content');

  await assert.rejects(
    publishStagedUpload(root, stagedPath, relativePath, witness),
    { code: 'UPLOAD_DESTINATION_COLLISION' }
  );
  assert.equal(await fs.readFile(destination, 'utf8'), 'unrelated existing content');
  assert.equal(await fs.readFile(stagedPath, 'utf8'), 'new content');
});
