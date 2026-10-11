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
