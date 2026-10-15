const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/blockPostgres');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createFinalUploadFilename,
  getUploadDateParts,
  sanitizeOriginalUploadFilename,
  sanitizeUploadUsername,
} = require('../services/assetUploadFilename');
const { hashStagedUpload, publishStagedUpload } = require('../services/assetUploadLifecycle');
const { normalizeAssetPath } = require('../utils/assetServing');
const {
  getAssetSourceInfo,
  normalizeStoredFilename,
} = require('../utils/assetThumbnails');
const pool = require('../db');
const axios = require('axios');

const date = new Date('2026-10-10T12:00:00.000Z');
const utcParts = getUploadDateParts(date, 'UTC');

test('formats JPG, AI, EPS, PSD, and other supported filename suffixes', () => {
  for (const [original, expected] of [
    ['ankit.jpg', 'varsha_10102026_ankit.jpg'],
    ['logo.ai', 'varsha_10102026_logo.ai'],
    ['design.eps', 'varsha_10102026_design.eps'],
    ['poster.psd', 'varsha_10102026_poster.psd'],
    ['image.png', 'varsha_10102026_image.png'],
    ['document.pdf', 'varsha_10102026_document.pdf'],
  ]) {
    assert.equal(createFinalUploadFilename('varsha', original, utcParts), expected);
  }
});

test('retains the complete original basename and multi-part extension without duplicating suffixes', () => {
  assert.equal(
    createFinalUploadFilename('varsha', 'press.release.tar.gz', utcParts),
    'varsha_10102026_press.release.tar.gz'
  );
  assert.equal(
    createFinalUploadFilename('varsha', 'ankit.jpg.jpg', utcParts),
    'varsha_10102026_ankit.jpg.jpg'
  );
});

test('strips traversal directories and sanitizes unsafe characters and controls', () => {
  assert.equal(
    createFinalUploadFilename('varsha', '..\\..\\unsafe:name\u0001.jpg', utcParts),
    'varsha_10102026_unsafe_name_.jpg'
  );
  assert.equal(sanitizeUploadUsername('varsha/name'), 'varsha_name');
  assert.equal(sanitizeOriginalUploadFilename('C:\\folder\\image.ai'), 'image.ai');
});

test('generated names remain valid for stored paths, file serving, and thumbnail source lookup', async () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  const originalServerUrl = process.env.PC2_ASSET_SERVER_URL;
  const originalQuery = pool.query;
  const originalHead = axios.head;
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'darwin' });
  delete process.env.ASSETS_ROOT;
  process.env.PC2_ASSET_SERVER_URL = 'http://127.0.0.1:5000';
  pool.query = async () => ({ rows: [{ session_id: 'test-session' }] });
  axios.head = async () => ({ headers: { 'content-length': '5' } });

  try {
    const basename = createFinalUploadFilename(
      'varsha',
      '100%_design.jpg',
      utcParts
    );
    const relativePath = `varsha/2026/10/Pending/${basename}`;
    assert.equal(basename, 'varsha_10102026_100__design.jpg');
    assert.equal(normalizeStoredFilename(relativePath), relativePath);
    assert.equal(normalizeAssetPath(relativePath), relativePath);

    const source = await getAssetSourceInfo(relativePath, 71);
    assert.equal(
      source.url,
      'http://127.0.0.1:5000/api/files/varsha/2026/10/Pending/varsha_10102026_100__design.jpg'
    );
  } finally {
    pool.query = originalQuery;
    axios.head = originalHead;
    Object.defineProperty(process, 'platform', originalPlatform);
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    if (originalServerUrl === undefined) delete process.env.PC2_ASSET_SERVER_URL;
    else process.env.PC2_ASSET_SERVER_URL = originalServerUrl;
  }
});

test('replaces C0, DEL, and C1 control characters in filename components', () => {
  for (const control of ['\u0001', '\u007f', '\u0085', '\u009f']) {
    const filename = sanitizeOriginalUploadFilename(`design${control}draft.jpg`);
    assert.equal(filename, 'design_draft.jpg');
  }
});

test('rejects empty, extensionless, and filesystem-overlong names', () => {
  assert.throws(() => sanitizeOriginalUploadFilename('..'), /invalid/i);
  assert.throws(() => sanitizeOriginalUploadFilename('no-extension'), /extension/);
  assert.throws(
    () => createFinalUploadFilename('varsha', `${'a'.repeat(250)}.jpg`, utcParts),
    /filesystem filename limit/
  );
});

test('formats dates using the configured SERVER timezone across a date boundary', () => {
  const beforeBoundary = new Date('2026-10-10T06:59:59.000Z');
  const afterBoundary = new Date('2026-10-10T07:00:00.000Z');

  assert.equal(getUploadDateParts(beforeBoundary, 'America/Los_Angeles').dateStamp, '09102026');
  assert.equal(getUploadDateParts(afterBoundary, 'America/Los_Angeles').dateStamp, '10102026');
  assert.equal(utcParts.dateStamp, '10102026');
});

test('a filename collision never overwrites the existing original', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-named-collision-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const relativeFilename = `varsha/2026/10/Pending/${createFinalUploadFilename('varsha', 'ankit.jpg', utcParts)}`;
  const destination = path.join(root, relativeFilename);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, 'previous asset');

  const stagedPath = path.join(root, '.upload-staging', 'request', 'upload.jpg');
  await fs.mkdir(path.dirname(stagedPath), { recursive: true });
  await fs.writeFile(stagedPath, 'new asset');
  const staged = await hashStagedUpload(root, stagedPath);

  await assert.rejects(
    publishStagedUpload(root, stagedPath, relativeFilename, {
      ...staged.witness,
      sha256: staged.sha256,
    }),
    { code: 'UPLOAD_DESTINATION_COLLISION', statusCode: 409 }
  );
  assert.equal(await fs.readFile(destination, 'utf8'), 'previous asset');
  assert.equal(await fs.readFile(stagedPath, 'utf8'), 'new asset');
});
