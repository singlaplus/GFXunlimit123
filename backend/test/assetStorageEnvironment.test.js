const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const dotenv = require('dotenv');
const { updateStorageRootsInEnv } = require('../services/assetStorageEnvironment');

test('updates storage roots in .env while preserving unrelated settings', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-storage-env-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, '.env');
  const previousAssetsRoot = process.env.ASSETS_ROOT;
  const previousThumbnailRoot = process.env.THUMBNAIL_STORAGE_PATH;
  t.after(() => {
    if (previousAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = previousAssetsRoot;
    if (previousThumbnailRoot === undefined) delete process.env.THUMBNAIL_STORAGE_PATH;
    else process.env.THUMBNAIL_STORAGE_PATH = previousThumbnailRoot;
  });

  fs.writeFileSync(envPath, [
    'JWT_SECRET=keep-this-value',
    'ASSETS_ROOT=/old/assets # replaced',
    'export THUMBNAIL_STORAGE_PATH=/old/thumbnails',
    'PORT=5000',
    '',
  ].join('\n'), { mode: 0o640 });

  const assetRoot = path.join(directory, 'new assets');
  const thumbnailRoot = path.join(directory, 'new thumbnails');
  updateStorageRootsInEnv(assetRoot, thumbnailRoot, envPath);

  const content = fs.readFileSync(envPath, 'utf8');
  const parsed = dotenv.parse(content);
  assert.equal(parsed.ASSETS_ROOT, assetRoot);
  assert.equal(parsed.THUMBNAIL_STORAGE_PATH, thumbnailRoot);
  assert.equal(parsed.JWT_SECRET, 'keep-this-value');
  assert.equal(parsed.PORT, '5000');
  assert.equal(content.match(/^ASSETS_ROOT=/gm).length, 1);
  assert.equal(content.match(/^THUMBNAIL_STORAGE_PATH=/gm).length, 1);
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o640);
  assert.equal(process.env.ASSETS_ROOT, assetRoot);
  assert.equal(process.env.THUMBNAIL_STORAGE_PATH, thumbnailRoot);
});

test('quotes storage paths safely and rejects invalid paths without writing', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-storage-env-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, '.env');
  fs.writeFileSync(envPath, 'PORT=5000\n');

  const assetRoot = path.join(directory, `assets "with 'both' quotes"`);
  const thumbnailRoot = path.join(directory, 'thumbnails\\archive');
  updateStorageRootsInEnv(assetRoot, thumbnailRoot, envPath);

  const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
  assert.equal(parsed.ASSETS_ROOT, assetRoot);
  assert.equal(parsed.THUMBNAIL_STORAGE_PATH, thumbnailRoot);
  assert.throws(() => updateStorageRootsInEnv('relative/assets', thumbnailRoot, envPath), /absolute path/i);
});
