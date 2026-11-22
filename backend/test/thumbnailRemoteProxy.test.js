const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/blockPostgres');
const { once } = require('node:events');
const express = require('express');
const { Readable } = require('node:stream');
const {
  buildRemoteThumbnailUrl,
  proxyRemoteVideoPreviewDelete,
  proxyRemoteThumbnail,
  shouldProxyRemoteThumbnail,
} = require('../utils/thumbnailRemoteProxy');

const PC2_BASE_URL = 'http://100.102.63.63:5000';

async function listen(app, t) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return server.address().port;
}

async function request(port, requestPath, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, { redirect: 'manual', headers });
  return {
    status: response.status,
    headers: response.headers,
    body: Buffer.from(await response.arrayBuffer()),
  };
}

function makeProxyApp(httpClient, authorization = null) {
  const app = express();
  app.get('/api/assets/:id/thumbnail', (req, res) => proxyRemoteThumbnail({
    req,
    res,
    assetId: req.params.id,
    authorization,
    cacheControl: 'public, max-age=300, must-revalidate',
    baseUrl: PC2_BASE_URL,
    httpClient,
  }));
  return app;
}

test('Mac proxies thumbnails only when no local thumbnail root is configured', () => {
  assert.equal(shouldProxyRemoteThumbnail('darwin', ''), true);
  assert.equal(
    shouldProxyRemoteThumbnail('darwin', ' /Users/gfxunlimit/Documents/stocksite/GFXunlimitThumbnails '),
    false
  );
  assert.equal(shouldProxyRemoteThumbnail('win32'), false);
  assert.equal(shouldProxyRemoteThumbnail('linux'), false);
});

test('builds remote thumbnail URLs only from validated numeric asset IDs', () => {
  assert.equal(
    buildRemoteThumbnailUrl(PC2_BASE_URL, '21'),
    'http://100.102.63.63:5000/api/assets/21/thumbnail'
  );
  for (const assetId of ['../21', '21/thumbnail', '0', '-1', '2147483648']) {
    assert.throws(() => buildRemoteThumbnailUrl(PC2_BASE_URL, assetId));
  }
  for (const baseUrl of [
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'http://100.102.63.63:5000/proxy',
    'http://user:password@100.102.63.63:5000',
  ]) {
    assert.throws(() => buildRemoteThumbnailUrl(baseUrl, 21));
  }
});

test('fails clearly when the remote thumbnail service is not configured', async (t) => {
  const app = express();
  app.get('/api/assets/:id/thumbnail', (req, res) => proxyRemoteThumbnail({
    req,
    res,
    assetId: req.params.id,
    cacheControl: 'private, no-store',
    baseUrl: '',
    httpClient: { get: assert.fail },
  }));
  const port = await listen(app, t);
  const response = await request(port, '/api/assets/21/thumbnail');

  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(response.body.toString()), {
    error: 'Remote thumbnail service is not configured',
  });
});

test('streams a remote WebP thumbnail with safe headers and the verified authorization context', async (t) => {
  let requestedUrl;
  let requestedHeaders;
  const image = Buffer.from('webp-image-data');
  const httpClient = {
    async get(url, options) {
      requestedUrl = url;
      requestedHeaders = options.headers;
      assert.equal(options.responseType, 'stream');
      assert.equal(options.decompress, false);
      assert.equal(options.timeout, 10000);
      assert.equal(options.maxRedirects, 0);
      return {
        status: 200,
        headers: {
          'content-type': 'image/webp',
          'content-length': String(image.length),
          etag: '"thumbnail-etag"',
          'last-modified': 'Sat, 03 Oct 2026 12:00:00 GMT',
        },
        data: Readable.from(image),
      };
    },
  };
  const app = makeProxyApp(httpClient, 'Bearer locally-verified-token');
  const port = await listen(app, t);
  const response = await request(port, '/api/assets/21/thumbnail');

  assert.equal(requestedUrl, `${PC2_BASE_URL}/api/assets/21/thumbnail`);
  assert.deepEqual(requestedHeaders, { authorization: 'Bearer locally-verified-token' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('content-length'), String(image.length));
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300, must-revalidate');
  assert.equal(response.headers.get('etag'), '"thumbnail-etag"');
  assert.equal(response.headers.get('last-modified'), 'Sat, 03 Oct 2026 12:00:00 GMT');
  assert.deepEqual(response.body, image);
});

test('proxies optimized MP4 previews with byte-range support', async (t) => {
  let requestedHeaders;
  const video = Buffer.from('video-bytes');
  const app = express();
  app.get('/api/assets/:id/video-previews/optimized', (req, res) => proxyRemoteThumbnail({
    req,
    res,
    assetId: req.params.id,
    cacheControl: 'public, max-age=300, must-revalidate',
    remotePath: '/video-previews/optimized',
    baseUrl: PC2_BASE_URL,
    httpClient: {
      async get(_url, options) {
        requestedHeaders = options.headers;
        return {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-length': String(video.length),
            'content-range': `bytes 0-${video.length - 1}/100`,
            'accept-ranges': 'bytes',
          },
          data: Readable.from(video),
        };
      },
    },
  }));
  const port = await listen(app, t);
  const response = await request(port, '/api/assets/21/video-previews/optimized', {
    Range: `bytes=0-${video.length - 1}`,
  });

  assert.deepEqual(requestedHeaders, { range: `bytes=0-${video.length - 1}` });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(response.headers.get('content-range'), `bytes 0-${video.length - 1}/100`);
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(response.body, video);
});

test('proxies an authenticated video-preview deletion to the remote asset server', async (t) => {
  let requestedUrl;
  let requestedHeaders;
  const app = express();
  app.delete('/api/assets/:id/video-previews/frame/:index', (req, res) =>
    proxyRemoteVideoPreviewDelete({
      req,
      res,
      assetId: req.params.id,
      remotePath: `/video-previews/frame/${req.params.index}`,
      baseUrl: PC2_BASE_URL,
      httpClient: {
        async delete(url, options) {
          requestedUrl = url;
          requestedHeaders = options.headers;
          return { status: 200, data: { deleted: true } };
        },
      },
    }));
  const port = await listen(app, t);
  const response = await fetch(
    `http://127.0.0.1:${port}/api/assets/21/video-previews/frame/2`,
    { method: 'DELETE', headers: { authorization: 'Bearer admin-session-token' } }
  );

  assert.equal(requestedUrl, `${PC2_BASE_URL}/api/assets/21/video-previews/frame/2`);
  assert.deepEqual(requestedHeaders, { authorization: 'Bearer admin-session-token' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
});

test('sets a download filename when proxying a thumbnail download', async (t) => {
  const app = express();
  app.get('/api/assets/:id/thumbnail', (req, res) => proxyRemoteThumbnail({
    req,
    res,
    assetId: req.params.id,
    cacheControl: 'private, no-store',
    contentDisposition: 'attachment; filename="thumbnail-21.webp"',
    baseUrl: PC2_BASE_URL,
    httpClient: {
      async get() {
        return {
          status: 200,
          headers: { 'content-type': 'image/webp' },
          data: Readable.from(Buffer.from('webp-image-data')),
        };
      },
    },
  }));
  const port = await listen(app, t);
  const response = await request(port, '/api/assets/21/thumbnail');

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="thumbnail-21.webp"');
});

test('does not forward credentials for public thumbnail requests', async (t) => {
  let requestedHeaders;
  const app = makeProxyApp({
    async get(_url, options) {
      requestedHeaders = options.headers;
      return {
        status: 200,
        headers: { 'content-type': 'image/webp' },
        data: Readable.from(Buffer.from('public-thumbnail')),
      };
    },
  });
  const port = await listen(app, t);
  const response = await request(port, '/api/assets/21/thumbnail');

  assert.deepEqual(requestedHeaders, {});
  assert.equal(response.status, 200);
});

test('maps remote 404 and 403 to safe local responses without forwarding upstream details', async (t) => {
  for (const [upstreamStatus, expectedMessage] of [[404, 'Thumbnail not found'], [403, 'Access denied']]) {
    const app = makeProxyApp({
      async get() {
        return {
          status: upstreamStatus,
          headers: { 'content-type': 'application/json' },
          data: Readable.from(Buffer.from('internal PC2 details')),
        };
      },
    });
    const port = await listen(app, t);
    const response = await request(port, '/api/assets/21/thumbnail');

    assert.equal(response.status, upstreamStatus);
    assert.deepEqual(JSON.parse(response.body.toString()), { error: expectedMessage });
  }
});

test('maps remote 5xx responses to a safe 502 response', async (t) => {
  const app = makeProxyApp({
    async get() {
      return {
        status: 503,
        headers: { 'content-type': 'text/plain' },
        data: Readable.from(Buffer.from('internal PC2 details')),
      };
    },
  });
  const port = await listen(app, t);
  const response = await request(port, '/api/assets/21/thumbnail');

  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(response.body.toString()), { error: 'Remote thumbnail service is unavailable' });
});

test('maps remote request timeouts to a safe 504 response', async (t) => {
  const app = makeProxyApp({
    async get() {
      const error = new Error('PC2 internal network address timed out');
      error.code = 'ECONNABORTED';
      throw error;
    },
  });
  const port = await listen(app, t);
  const response = await request(port, '/api/assets/21/thumbnail');

  assert.equal(response.status, 504);
  assert.deepEqual(JSON.parse(response.body.toString()), { error: 'Remote thumbnail service timed out' });
});

test('preserves only the safe same-origin legacy thumbnail redirect', async (t) => {
  const app = makeProxyApp({
    async get() {
      return {
        status: 302,
        headers: { location: '/api/thumbnail?file=legacy%2Fthumb.jpg' },
        data: Readable.from(''),
      };
    },
  });
  const port = await listen(app, t);
  const response = await request(port, '/api/assets/21/thumbnail');

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/api/thumbnail?file=legacy%2Fthumb.jpg');
});
