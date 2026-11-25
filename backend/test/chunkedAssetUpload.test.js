const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  CHUNK_UPLOAD_TTL_MS,
  assembleChunkedUpload,
  cleanupExpiredChunkUploads,
  getChunkUploadId,
  initializeChunkUpload,
  readSession,
  saveUploadChunk,
} = require('../services/chunkedAssetUpload');

async function createAssetRoot(t) {
  const assetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-chunk-upload-'));
  t.after(() => fs.rm(assetRoot, { recursive: true, force: true }));
  return assetRoot;
}

async function initialize(assetRoot, overrides = {}) {
  return initializeChunkUpload({
    assetRoot,
    userId: 42,
    uploadRequestId: '4a281bc8-a1bd-4ed8-b63e-91bb2d668041',
    filename: 'original.eps',
    mimeType: 'application/postscript',
    fileSize: 10,
    maxFileSize: 100,
    chunkSize: 4,
    ...overrides,
  });
}

test('stores exact-sized chunks idempotently and assembles their original byte sequence', async (t) => {
  const assetRoot = await createAssetRoot(t);
  const { session } = await initialize(assetRoot);

  assert.equal(session.totalChunks, 3);
  assert.deepEqual(
    await saveUploadChunk({ assetRoot, uploadId: session.uploadId, userId: 42, chunkIndex: 0, contents: Buffer.from('1234') }),
    { chunkIndex: 0, received: true, alreadyReceived: false },
  );
  assert.equal(
    (await saveUploadChunk({
      assetRoot,
      uploadId: session.uploadId,
      userId: 42,
      chunkIndex: 0,
      contents: Buffer.from('1234'),
    })).alreadyReceived,
    true,
  );
  await saveUploadChunk({ assetRoot, uploadId: session.uploadId, userId: 42, chunkIndex: 1, contents: Buffer.from('5678') });
  await saveUploadChunk({ assetRoot, uploadId: session.uploadId, userId: 42, chunkIndex: 2, contents: Buffer.from('90') });

  const destinationPath = path.join(assetRoot, '.upload-staging', 'assembled');
  await fs.mkdir(path.dirname(destinationPath));
  const assembled = await assembleChunkedUpload({
    assetRoot,
    uploadId: session.uploadId,
    userId: 42,
    destinationPath,
  });

  assert.equal(assembled.size, 10);
  assert.deepEqual(await fs.readFile(destinationPath), Buffer.from('1234567890'));
});

test('rejects invalid lengths, conflicting retries, missing chunks, and another user', async (t) => {
  const assetRoot = await createAssetRoot(t);
  const { session } = await initialize(assetRoot);
  const chunkOptions = { assetRoot, uploadId: session.uploadId, userId: 42, chunkIndex: 0 };

  await assert.rejects(
    saveUploadChunk({ ...chunkOptions, contents: Buffer.from('short') }),
    { statusCode: 400 },
  );
  await saveUploadChunk({ ...chunkOptions, contents: Buffer.from('1234') });
  await assert.rejects(
    saveUploadChunk({ ...chunkOptions, contents: Buffer.from('abcd') }),
    { statusCode: 409 },
  );
  await assert.rejects(
    readSession(assetRoot, session.uploadId, 99),
    { statusCode: 404 },
  );

  const destinationPath = path.join(assetRoot, '.upload-staging', 'incomplete');
  await fs.mkdir(path.dirname(destinationPath));
  await assert.rejects(
    assembleChunkedUpload({ assetRoot, uploadId: session.uploadId, userId: 42, destinationPath }),
    (error) => error.statusCode === 409 && error.missingChunks.join(',') === '1,2',
  );
  await assert.rejects(fs.stat(destinationPath), { code: 'ENOENT' });
});

test('returns existing chunks on matching init and rejects idempotency-key metadata conflicts', async (t) => {
  const assetRoot = await createAssetRoot(t);
  await assert.rejects(initialize(assetRoot, { fileSize: 101 }), { statusCode: 413 });
  const first = await initialize(assetRoot);
  await saveUploadChunk({
    assetRoot,
    uploadId: first.session.uploadId,
    userId: 42,
    chunkIndex: 0,
    contents: Buffer.from('1234'),
  });

  const resumed = await initialize(assetRoot);
  assert.equal(resumed.session.uploadId, first.session.uploadId);
  assert.deepEqual(resumed.receivedChunks, [0]);
  await assert.rejects(
    initialize(assetRoot, { filename: 'different.eps' }),
    { statusCode: 409 },
  );
});

test('persists regular-upload metadata and binds thumbnail sessions to their image session', async (t) => {
  const assetRoot = await createAssetRoot(t);
  const image = await initialize(assetRoot, {
    preSubmission: false,
    formFields: { title: 'Regular asset', collection: 'Templates' },
  });
  const thumbnail = await initialize(assetRoot, {
    uploadRequestId: 'aa19dc4e-7dc7-4e8d-aad3-79b5a4ce867a',
    filename: 'preview.png',
    mimeType: 'image/png',
    fieldName: 'thumbnail',
    preSubmission: false,
    parentUploadId: image.session.uploadId,
  });

  assert.equal(image.session.preSubmission, false);
  assert.deepEqual((await readSession(assetRoot, image.session.uploadId, 42)).session.formFields, {
    title: 'Regular asset',
    collection: 'Templates',
  });
  assert.equal(thumbnail.session.fieldName, 'thumbnail');
  assert.equal(thumbnail.session.parentUploadId, image.session.uploadId);
  await assert.rejects(
    initialize(assetRoot, {
      uploadRequestId: '321fa836-06b0-4d34-a920-98eeea3a3248',
      fieldName: 'thumbnail',
      preSubmission: true,
      parentUploadId: image.session.uploadId,
    }),
    { statusCode: 400 },
  );
});

test('expires only old chunk sessions under the configured staging root', async (t) => {
  const assetRoot = await createAssetRoot(t);
  const now = Date.now();
  const old = await initialize(assetRoot, {
    uploadRequestId: '635346a9-a762-4b56-a2e4-a2c7af78ec9b',
    now: now - CHUNK_UPLOAD_TTL_MS - 1000,
  });
  const fresh = await initialize(assetRoot, {
    uploadRequestId: '7f1bc53f-143b-4e8c-af9e-4e2f6d5f9810',
    now,
  });
  await fs.utimes(
    path.join(assetRoot, '.chunked-upload-staging', old.session.uploadId),
    new Date(now - CHUNK_UPLOAD_TTL_MS - 1000),
    new Date(now - CHUNK_UPLOAD_TTL_MS - 1000),
  );
  const unrecognizedDirectory = path.join(assetRoot, '.chunked-upload-staging', 'preserve-me');
  await fs.mkdir(unrecognizedDirectory);

  assert.equal(await cleanupExpiredChunkUploads(assetRoot, now), 1);
  await assert.rejects(readSession(assetRoot, old.session.uploadId, 42), { statusCode: 404 });
  assert.equal((await readSession(assetRoot, fresh.session.uploadId, 42)).session.uploadId, fresh.session.uploadId);
  assert.equal((await fs.stat(unrecognizedDirectory)).isDirectory(), true);
  assert.equal(getChunkUploadId(42, old.session.uploadRequestId), old.session.uploadId);
});
