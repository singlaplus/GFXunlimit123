const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createAssetStorageConnections,
  getDisconnectedStorageForRequest,
} = require('../services/assetStorageConnections');
const {
  createAssetStorageCardConnections,
  getConnectedStorageLocations,
} = require('../services/assetStorageCardConnections');
const { createAssetStorageCardCounts } = require('../services/assetStorageCardCounts');

test('disconnected storage blocks its own application file routes', () => {
  const disconnected = { assets: false, thumbnails: false };
  const connected = { assets: true, thumbnails: true };

  assert.equal(getDisconnectedStorageForRequest('GET', '/api/files/asset.jpg', disconnected), 'assets');
  assert.equal(getDisconnectedStorageForRequest('POST', '/upload', disconnected), 'assets');
  assert.equal(getDisconnectedStorageForRequest('GET', '/images/42/download-original', disconnected), 'assets');
  assert.equal(getDisconnectedStorageForRequest('PUT', '/images/42/download', disconnected), 'assets');
  assert.equal(getDisconnectedStorageForRequest('GET', '/api/assets/42/thumbnail', disconnected), 'thumbnails');
  assert.equal(getDisconnectedStorageForRequest('GET', '/images/42/download-thumbnail', disconnected), 'thumbnails');
  assert.equal(getDisconnectedStorageForRequest('POST', '/images/42/thumbnail/retry', disconnected), 'thumbnails');
  assert.equal(getDisconnectedStorageForRequest('GET', '/api/files/branding/logo.png', disconnected), null);
  assert.equal(getDisconnectedStorageForRequest('GET', '/api/assets/42/thumbnail', { assets: false, thumbnails: true }), null);
  assert.equal(getDisconnectedStorageForRequest('GET', '/api/files/asset.jpg', connected), null);
  assert.equal(getDisconnectedStorageForRequest('GET', '/api/assets/42/thumbnail', connected), null);
});

test('per-card disconnection blocks requests only when all configured locations are disconnected', () => {
  const locations = {
    assetLocations: [
      { id: 'assets-1', path: '/storage/assets-1' },
      { id: 'assets-2', path: '/storage/assets-2' },
    ],
    thumbnailLocations: [{ id: 'thumbnails-1', path: '/storage/thumbnails-1' }],
  };
  const disconnectedAssets = { assets: { '2': false }, thumbnails: {} };

  assert.equal(
    getDisconnectedStorageForRequest(
      'GET',
      '/images/42/download-original',
      { assets: true, thumbnails: true, ...locations },
      disconnectedAssets
    ),
    null
  );
  assert.equal(
    getDisconnectedStorageForRequest(
      'GET',
      '/images/42/download-original',
      { assets: true, thumbnails: true, ...locations },
      { assets: { '1': false, '2': false }, thumbnails: {} }
    ),
    'assets'
  );
});

test('asset storage connections default to connected and persist individual changes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-storage-connections-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'settings', 'connections.json');
  const connections = createAssetStorageConnections(filePath);

  assert.deepEqual(connections.get(), {
    assets: true,
    thumbnails: true,
    assetRoot: null,
    thumbnailRoot: null,
    assetLocations: [],
    thumbnailLocations: [],
    defaultAssetLocationId: null,
    defaultThumbnailLocationId: null,
  });
  assert.equal(connections.update({ assets: false }).assets, false);
  assert.equal(createAssetStorageConnections(filePath).get().assets, false);
  assert.deepEqual(connections.update({ thumbnails: false }), {
    ...connections.get(),
    assets: false,
    thumbnails: false,
  });
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
    assetLocations: [{ id: 'assets-1', label: 'Asset 1', path: assetRoot }],
    thumbnailLocations: [{ id: 'thumbnails-1', label: 'Thumbnail 1', path: thumbnailRoot }],
    defaultAssetLocationId: 'assets-1',
    defaultThumbnailLocationId: 'thumbnails-1',
  });
});

test('storage locations have stable labels, independent defaults, and configured caps', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-storage-multiple-roots-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'connections.json');
  const connections = createAssetStorageConnections(filePath, {});
  connections.update({ assetRoot: '/storage/assets-1', thumbnailRoot: '/storage/thumbnails-1' });

  const secondAsset = connections.addLocation('assets', '/storage/assets-2');
  const secondThumbnail = connections.addLocation('thumbnails', '/storage/thumbnails-2');
  assert.equal(secondAsset.assetLocations[1].label, 'Asset 2');
  assert.equal(secondThumbnail.thumbnailLocations[1].label, 'Thumbnail 2');
  assert.equal(secondAsset.defaultAssetLocationId, 'assets-1');

  const selectedAsset = connections.setDefault('assets', secondAsset.assetLocations[1].id);
  const selectedThumbnail = connections.setDefault('thumbnails', secondThumbnail.thumbnailLocations[1].id);
  assert.equal(selectedAsset.assetRoot, '/storage/assets-2');
  assert.equal(selectedThumbnail.thumbnailRoot, '/storage/thumbnails-2');
  assert.equal(connections.getConfiguredStorageRoots().assetsRoot, '/storage/assets-2');
  assert.equal(connections.getConfiguredStorageRoots().thumbnailStoragePath, '/storage/thumbnails-2');

  const afterAssetDeletion = connections.removeLocation('assets', secondAsset.assetLocations[1].id);
  assert.equal(afterAssetDeletion.assetLocations.length, 1);
  assert.equal(afterAssetDeletion.defaultAssetLocationId, 'assets-1');
  assert.equal(afterAssetDeletion.assetRoot, '/storage/assets-1');
  assert.throws(() => connections.removeLocation('assets', 'assets-1'), /primary storage location/i);

  connections.addLocation('assets', '/storage/assets-2');
  for (let index = 3; index <= 99; index += 1) {
    connections.addLocation('assets', `/storage/assets-${index}`);
  }
  assert.throws(() => connections.addLocation('assets', '/storage/assets-100'), /maximum of 99/i);
  for (let index = 3; index <= 9; index += 1) {
    connections.addLocation('thumbnails', `/storage/thumbnails-${index}`);
  }
  assert.throws(() => connections.addLocation('thumbnails', '/storage/thumbnails-10'), /maximum of 9/i);
});

test('storage folders can be assigned to a specific generated card without changing another card default', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-storage-card-paths-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const connections = createAssetStorageConnections(path.join(directory, 'connections.json'), {});
  connections.update({ assetRoot: '/storage/assets-1', thumbnailRoot: '/storage/thumbnails-1' });

  const saved = connections.setLocation('assets', 3, '/storage/assets-3');
  const savedThumbnail = connections.setLocation('thumbnails', 2, '/storage/thumbnails-2');

  assert.equal(saved.assetLocations[0].path, '/storage/assets-1');
  assert.equal(saved.assetLocations[1], null);
  assert.equal(saved.assetLocations[2].path, '/storage/assets-3');
  assert.equal(saved.defaultAssetLocationId, 'assets-1');
  assert.equal(saved.assetRoot, '/storage/assets-1');
  assert.equal(savedThumbnail.thumbnailLocations[0].path, '/storage/thumbnails-1');
  assert.equal(savedThumbnail.thumbnailLocations[1].path, '/storage/thumbnails-2');
  assert.equal(savedThumbnail.defaultThumbnailLocationId, 'thumbnails-1');
  assert.equal(savedThumbnail.thumbnailRoot, '/storage/thumbnails-1');
  assert.throws(() => connections.setLocation('assets', 2, '/storage/assets-1'), /already been added/i);
  assert.throws(() => connections.setLocation('assets', 100, '/storage/assets-100'), /invalid/i);
});

test('asset storage connections reject corrupt persisted settings', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-storage-connections-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'connections.json');
  fs.writeFileSync(filePath, JSON.stringify({ assets: 'false', thumbnails: true }));

  assert.throws(() => createAssetStorageConnections(filePath).get(), /invalid/i);
});

test('storage-card connection statuses persist independently by type and location', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-storage-card-connections-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'settings', 'card-connections.json');
  const connections = createAssetStorageCardConnections(filePath);

  assert.deepEqual(connections.get(), { assets: {}, thumbnails: {} });
  connections.update('assets', 1, false);
  connections.update('assets', 2, true);
  connections.update('assets', 3, false);
  connections.update('thumbnails', 1, false);
  connections.remove('assets', 2);

  assert.deepEqual(createAssetStorageCardConnections(filePath).get(), {
    assets: { '1': false, '2': false },
    thumbnails: { '1': false },
  });
  assert.throws(() => connections.update('assets', 100, true), /invalid/i);
  assert.throws(() => connections.update('thumbnails', 10, true), /invalid/i);
  assert.deepEqual(
    connections.getConnectedLocations('assets', [
      { id: 'assets-one', path: '/assets-one' },
      { id: 'assets-two', path: '/assets-two' },
    ]),
    []
  );
  assert.deepEqual(
    getConnectedStorageLocations(
      'thumbnails',
      [{ id: 'thumbnail-one' }, { id: 'thumbnail-two' }],
      { thumbnails: { '2': false } }
    ),
    [{ id: 'thumbnail-one' }]
  );
});

test('storage-card counts persist per admin user and preserve configured location slots', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-storage-card-counts-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'settings', 'counts.json');
  const counts = createAssetStorageCardCounts(filePath);

  assert.deepEqual(counts.get(12), { assets: 1, thumbnails: 1 });
  assert.deepEqual(counts.set(12, 'assets', 4), { assets: 4, thumbnails: 1 });
  assert.deepEqual(createAssetStorageCardCounts(filePath).get(12), { assets: 4, thumbnails: 1 });
  assert.deepEqual(counts.get(13), { assets: 1, thumbnails: 1 });
  assert.deepEqual(counts.get(12, { assets: 3, thumbnails: 2 }), { assets: 4, thumbnails: 2 });
  assert.deepEqual(counts.get(12, {}, { assets: 8, thumbnails: 9 }), { assets: 4, thumbnails: 2 });
  assert.throws(() => counts.set(12, 'thumbnails', 1, 2), /between 2 and 9/i);
  assert.throws(() => counts.set(12, 'assets', 100), /between 1 and 99/i);
});
