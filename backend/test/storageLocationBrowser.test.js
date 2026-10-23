const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  browseStorageDirectory,
  getAllowedStorageRoots,
  resolveAllowedDirectory,
  validateStorageRootPair,
} = require('../services/storageLocationBrowser');

test('macOS folder browsing includes the system drive', () => {
  const roots = getAllowedStorageRoots({ platform: 'darwin' });

  assert.ok(roots.includes(path.parse(process.cwd()).root));
});

test('folder browsing stays inside allowed mounts and skips symbolic links', (t) => {
  const volume = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-browser-'));
  t.after(() => fs.rmSync(volume, { recursive: true, force: true }));
  const allowedRoot = fs.realpathSync(volume);
  const assets = path.join(volume, 'assets');
  const thumbnails = path.join(volume, 'thumbnails');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-browser-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(assets);
  fs.mkdirSync(thumbnails);
  fs.mkdirSync(path.join(assets, 'nested'));
  fs.symlinkSync(outside, path.join(assets, 'linked-outside'));

  const listing = browseStorageDirectory(assets, [allowedRoot]);

  assert.deepEqual(listing.directories.map((entry) => entry.name), ['nested']);
  assert.equal(listing.parentPath, allowedRoot);
  assert.throws(() => resolveAllowedDirectory(outside, [allowedRoot]), /mounted storage location/i);
});

test('asset and thumbnail roots must be existing separate folders inside allowed mounts', (t) => {
  const volume = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-browser-roots-'));
  t.after(() => fs.rmSync(volume, { recursive: true, force: true }));
  const allowedRoot = fs.realpathSync(volume);
  const assets = path.join(volume, 'assets');
  const thumbnails = path.join(volume, 'thumbnails');
  fs.mkdirSync(assets);
  fs.mkdirSync(thumbnails);
  fs.mkdirSync(path.join(assets, 'nested'));

  assert.deepEqual(validateStorageRootPair(assets, thumbnails, [allowedRoot]), {
    assetRoot: fs.realpathSync(assets),
    thumbnailRoot: fs.realpathSync(thumbnails),
  });
  assert.throws(() => validateStorageRootPair(assets, path.join(assets, 'nested'), [allowedRoot]), /separate/i);
  assert.throws(() => validateStorageRootPair(assets, path.join(volume, 'missing'), [allowedRoot]), /does not exist/i);
});
