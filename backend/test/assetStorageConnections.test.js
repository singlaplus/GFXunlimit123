const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createAssetStorageConnections,
  getDisconnectedStorageForRequest,
} = require('../services/assetStorageConnections');

test('disconnected storage blocks its own application file routes', () => {
  const disconnected = { assets: false, thumbnails: false };
  const connected = { assets: true, thumbnails: true };

  assert.equal(getDisconnectedStorageForRequest('GET', '/api/files/asset.jpg', disconnected), 'assets');
  assert.equal(getDisconnectedStorageForRequest('POST', '/upload', disconnected), 'assets');
  assert.equal(getDisconnectedStorageForRequest('GET', '/images/42/download-original', disconnected), 'assets');
  assert.equal(getDisconnectedStorageForRequest('PUT', '/images/42/download', disconnected), 'assets');
  assert.equal(getDisconnectedStorageForRequest('GET', '/api/assets/42/thumbnail', disconnected), 'thumbnails');
  assert.equal(getDisconnectedStorageForRequest('POST', '/images/42/thumbnail/retry', disconnected), 'thumbnails');
  assert.equal(getDisconnectedStorageForRequest('GET', '/api/files/branding/logo.png', disconnected), null);
  assert.equal(getDisconnectedStorageForRequest('GET', '/api/assets/42/thumbnail', { assets: false, thumbnails: true }), null);
  assert.equal(getDisconnectedStorageForRequest('GET', '/api/files/asset.jpg', connected), null);
  assert.equal(getDisconnectedStorageForRequest('GET', '/api/assets/42/thumbnail', connected), null);
});

test('asset storage connections default to connected and persist individual changes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-storage-connections-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'settings', 'connections.json');
  const connections = createAssetStorageConnections(filePath);

  assert.deepEqual(connections.get(), { assets: true, thumbnails: true, assetRoot: null, thumbnailRoot: null });
  assert.deepEqual(connections.update({ assets: false }), { assets: false, thumbnails: true, assetRoot: null, thumbnailRoot: null });
  assert.deepEqual(createAssetStorageConnections(filePath).get(), { assets: false, thumbnails: true, assetRoot: null, thumbnailRoot: null });
  assert.deepEqual(connections.update({ thumbnails: false }), { assets: false, thumbnails: false, assetRoot: null, thumbnailRoot: null });
});

test('asset and thumbnail location overrides persist and take precedence over environment roots', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-storage-roots-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'connections.json');
  const assetRoot = path.join(directory, 'assets');
  const thumbnailRoot = path.join(directory, 'thumbnails');
  const connections = createAssetStorageConnections(filePath);

  connections.update({ assetRoot, thumbnailRoot });

  assert.deepEqual(createAssetStorageConnections(filePath).getConfiguredStorageRoots(), {
    assetsRoot: assetRoot,
    thumbnailStoragePath: thumbnailRoot,
  });
});

test('asset storage connections reject corrupt persisted settings', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-storage-connections-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'connections.json');
  fs.writeFileSync(filePath, JSON.stringify({ assets: 'false', thumbnails: true }));

  assert.throws(() => createAssetStorageConnections(filePath).get(), /invalid/i);
});
