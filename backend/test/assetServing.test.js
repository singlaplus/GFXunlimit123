const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const {
  createAssetServingHandler,
  encodeAssetPath,
  getProductionAssetRoot,
} = require('../utils/assetServing');
const { getThumbnailStorageDirectory } = require('../utils/assetThumbnail');

async function listen(app, t) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return server.address().port;
}

function request(port, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('local asset handler securely serves central files and existing thumbnails', async (t) => {
  const assetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-assets-'));
  t.after(() => fs.rm(assetRoot, { recursive: true, force: true }));

  const originalRelativePath = 'Contri6/2026/08/Approved/1786170072206-I01062026AMJ01.jpg';
  const originalPath = path.join(assetRoot, ...originalRelativePath.split('/'));
  const originalContent = Buffer.from('central asset file contents');
  await fs.mkdir(path.dirname(originalPath), { recursive: true });
  await fs.writeFile(originalPath, originalContent);

  const thumbnailDirectory = getThumbnailStorageDirectory(originalPath);
  assert.equal(path.relative(assetRoot, thumbnailDirectory).split(path.sep).join('/'), 'Contri6/2026/08/thumbnails');
  const thumbnailRelativePath = 'Contri6/2026/08/thumbnails/1786170072206-I01062026AMJ01-thumb.jpg';
  const thumbnailPath = path.join(assetRoot, ...thumbnailRelativePath.split('/'));
  await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
  await fs.writeFile(thumbnailPath, Buffer.from('thumbnail contents'));

  const app = express();
  app.use('/api/files', createAssetServingHandler({
    getAssetRoot: () => assetRoot,
    getAssetPath: (req) => decodeURIComponent(String(req.path || '').replace(/^\/+/, '')),
    getRemotePath: (assetPath) => `/api/files/${encodeAssetPath(assetPath)}`,
    proxyHandler: (_req, res) => res.status(502).json({ error: 'Unexpected remote proxy' }),
  }));
  app.get('/api/thumbnail', createAssetServingHandler({
    getAssetRoot: () => assetRoot,
    getAssetPath: (req) => req.query.file,
    getRemotePath: () => '/api/thumbnail',
    proxyHandler: (_req, res) => res.status(502).json({ error: 'Unexpected remote proxy' }),
    missingAssetMessage: 'Missing file parameter',
    immutableVersions: true,
  }));
  const port = await listen(app, t);

  const nestedAsset = await request(port, `/api/files/${originalRelativePath}`);
  assert.equal(nestedAsset.status, 200);
  assert.equal(nestedAsset.headers['content-type'], 'image/jpeg');
  assert.equal(Number(nestedAsset.headers['content-length']), originalContent.length);
  assert.ok(nestedAsset.headers.etag);
  assert.ok(nestedAsset.headers['last-modified']);
  assert.equal(nestedAsset.headers['accept-ranges'], 'bytes');
  assert.deepEqual(nestedAsset.body, originalContent);

  const headResponse = await request(port, `/api/files/${originalRelativePath}`, { method: 'HEAD' });
  assert.equal(headResponse.status, 200);
  assert.equal(Number(headResponse.headers['content-length']), originalContent.length);
  assert.equal(headResponse.body.length, 0);

  const rangeResponse = await request(port, `/api/files/${originalRelativePath}`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers['content-range'], `bytes 0-3/${originalContent.length}`);
  assert.deepEqual(rangeResponse.body, originalContent.subarray(0, 4));

  const thumbnailResponse = await request(port, `/api/thumbnail?file=${encodeURIComponent(thumbnailRelativePath)}`);
  assert.equal(thumbnailResponse.status, 200);
  assert.equal(thumbnailResponse.headers['content-type'], 'image/jpeg');
  assert.doesNotMatch(thumbnailResponse.headers['cache-control'], /immutable/);
  assert.deepEqual(thumbnailResponse.body, Buffer.from('thumbnail contents'));

  const versionedThumbnailResponse = await request(
    port,
    `/api/thumbnail?file=${encodeURIComponent(thumbnailRelativePath)}&v=2026-08-20T10%3A15%3A00.000Z`
  );
  assert.equal(versionedThumbnailResponse.status, 200);
  assert.match(versionedThumbnailResponse.headers['cache-control'], /max-age=31536000/);
  assert.match(versionedThumbnailResponse.headers['cache-control'], /immutable/);

  const missingResponse = await request(port, '/api/files/Contri6/2026/08/Approved/missing.jpg');
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(JSON.parse(missingResponse.body.toString()), { error: 'Asset not found' });

  const traversalResponse = await request(port, '/api/files/%2e%2e/secret.txt');
  assert.equal(traversalResponse.status, 400);
  assert.deepEqual(JSON.parse(traversalResponse.body.toString()), { error: 'Invalid asset path' });

  const missingThumbnailParameter = await request(port, '/api/thumbnail');
  assert.equal(missingThumbnailParameter.status, 400);
  assert.deepEqual(JSON.parse(missingThumbnailParameter.body.toString()), { error: 'Missing file parameter' });

  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-assets-outside-'));
  t.after(() => fs.rm(outsideRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'outside the asset root');
  try {
    await fs.symlink(outsideRoot, path.join(assetRoot, 'outside'), 'dir');
    const symlinkTraversal = await request(port, '/api/files/outside/secret.txt');
    assert.equal(symlinkTraversal.status, 400);
    assert.deepEqual(JSON.parse(symlinkTraversal.body.toString()), { error: 'Invalid asset path' });
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
  }
});

test('local asset root is selected only in production when configured', () => {
  assert.equal(getProductionAssetRoot('production', 'F:/GFXunlimitAssets'), 'F:/GFXunlimitAssets');
  assert.equal(getProductionAssetRoot('production', '  F:/GFXunlimitAssets  '), 'F:/GFXunlimitAssets');
  assert.equal(getProductionAssetRoot('development', 'F:/GFXunlimitAssets'), null);
  assert.equal(getProductionAssetRoot('production', ''), null);
});

test('asset handler preserves the remote PC2 proxy branch when no local root is configured', async (t) => {
  let proxyPath;
  const app = express();
  app.use('/api/files', createAssetServingHandler({
    getAssetRoot: () => null,
    getAssetPath: (req) => decodeURIComponent(String(req.path || '').replace(/^\/+/, '')),
    getRemotePath: (assetPath) => `/api/files/${encodeAssetPath(assetPath)}`,
    proxyHandler: (_req, res, upstreamPath) => {
      proxyPath = upstreamPath;
      return res.json({ proxied: upstreamPath });
    },
  }));
  const port = await listen(app, t);

  const response = await request(port, '/api/files/Contri6/2026/08/Approved/hero%20image.jpg');
  assert.equal(response.status, 200);
  assert.equal(proxyPath, '/api/files/Contri6/2026/08/Approved/hero%20image.jpg');
  assert.deepEqual(JSON.parse(response.body.toString()), { proxied: proxyPath });
});