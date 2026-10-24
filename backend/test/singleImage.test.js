const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/blockPostgres');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cron = require('node-cron');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const sharp = require('sharp');
const { Readable } = require('node:stream');

process.env.DISABLE_EMAIL_SCHEDULER = 'true';
process.env.DISABLE_CURRENCY_SCHEDULER = 'true';
const previousNodeEnv = process.env.NODE_ENV;
const previousLocalUploadTestStorage = process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE;
const previousSchemaInitialization = process.env.DISABLE_SERVER_SCHEMA_INITIALIZATION;
const previousUserDeletionScheduler = process.env.DISABLE_USER_DELETION_SCHEDULER;
process.env.NODE_ENV = 'test';
process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE = 'true';
process.env.DISABLE_SERVER_SCHEMA_INITIALIZATION = 'true';
process.env.DISABLE_USER_DELETION_SCHEDULER = 'true';
const originalCronSchedule = cron.schedule;
const originalPoolConnect = Pool.prototype.connect;
const singleImageSelect = /SELECT id, title, filename, category, keywords, created_at, downloads, views, likes,[\s\S]*FROM images\s+WHERE id = \$1/i;
const catalogPreviewSelect = /SELECT filename, thumbnail_generated_at, status, uploaded_by\s+FROM images\s+WHERE id = \$1/i;
cron.schedule = () => ({ stop() {} });
Pool.prototype.connect = async () => ({
  query: async () => ({ rows: [] }),
  release() {},
});

const pool = require('../db');
const originalPoolQuery = pool.query;
const { app } = require('../server');
const assetStorageConnections = require('../services/assetStorageConnections');
const assetStorageCardConnections = require('../services/assetStorageCardConnections');
const assetThumbnails = require('../utils/assetThumbnails');

cron.schedule = originalCronSchedule;
pool.query = originalPoolQuery;
Pool.prototype.connect = originalPoolConnect;
if (previousSchemaInitialization === undefined) delete process.env.DISABLE_SERVER_SCHEMA_INITIALIZATION;
else process.env.DISABLE_SERVER_SCHEMA_INITIALIZATION = previousSchemaInitialization;
if (previousUserDeletionScheduler === undefined) delete process.env.DISABLE_USER_DELETION_SCHEDULER;
else process.env.DISABLE_USER_DELETION_SCHEDULER = previousUserDeletionScheduler;

test.after(async () => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousLocalUploadTestStorage === undefined) delete process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE;
  else process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE = previousLocalUploadTestStorage;
  await pool.end();
});

function request(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: 'GET',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString(),
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('single-image endpoint serves approved assets publicly without internal fields', async (t) => {
  const originalQuery = pool.query;
  const publicImage = {
    id: 196,
    title: 'ankit 1',
    filename: 'contributor/2026/10/Approved/asset.jpg',
    category: 'Images',
    keywords: 'asset',
    created_at: '2026-10-03T00:00:00.000Z',
    downloads: 3,
    views: 5,
    likes: 2,
    status: 'approved',
    collection: 'General',
    description: 'Public description',
    type: 'image',
    file_size: 1024,
    extension: 'jpg',
    mime_type: 'image/jpeg',
    original_filename: 'asset.jpg',
    thumbnail_url: '/api/thumbnail?file=asset-thumb.jpg',
    thumbnail_generated_at: '2026-10-03T00:00:00.000Z',
    thumbnail_status: 'COMPLETED',
  };
  let queryText;
  pool.query = async (sql, values) => {
    if (!singleImageSelect.test(sql)) return originalQuery(sql, values);
    queryText = sql;
    return { rows: [publicImage] };
  };

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    pool.query = originalQuery;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const response = await request(server.address().port, '/images/196');
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.id, 196);
  assert.equal(body.title, 'ankit 1');
  assert.equal(body.filename, 'asset.jpg');
  assert.equal(body.thumbnail_url, '/api/assets/196/thumbnail');
  assert.equal(body.thumbnail_status, publicImage.thumbnail_status);
  for (const field of [
    'uploaded_by',
    'earnings',
    'checksum',
    'processing_status',
    'processing_started_at',
    'processing_completed_at',
    'processing_error',
    'thumbnail_error',
    'thumbnail_path',
    'upload_file_device',
    'upload_file_inode',
  ]) {
    assert.equal(Object.hasOwn(body, field), false, `${field} must not be returned publicly`);
  }
  assert.doesNotMatch(queryText, /SELECT\s+\*/i);
  for (const field of Object.keys(publicImage)) {
    assert.match(queryText, new RegExp(`\\b${field}\\b`, 'i'));
  }
});

test('public image listing hides storage paths while preserving asset fields', async (t) => {
  const originalQuery = pool.query;
  pool.query = async (sql, values) => {
    if (/SELECT images\.\*, users\.username/i.test(sql)) {
      return {
        rows: [{
          id: 42,
          title: 'Sample',
          filename: 'contributor/2026/10/Approved/sample.jpg',
          original_filename: '/private/storage/sample-original.jpg',
          thumbnail_url: '/api/thumbnail?file=contributor%2Fthumbnails%2Fsample.webp',
          thumbnail_path: 'contributor/thumbnails/sample.webp',
          upload_file_device: 'private-device',
          upload_file_inode: 'private-inode',
          upload_thumbnail_location_id: 'private-location',
          views: 12,
        }],
      };
    }
    if (/COUNT\(\*\)::int AS total_images/i.test(sql)) {
      return { rows: [{ total_images: 1, total_likes: 0, total_downloads: 0, total_views: 12 }] };
    }
    return originalQuery(sql, values);
  };

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    pool.query = originalQuery;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const response = await request(server.address().port, '/images?page=1&limit=1');
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.images[0].filename, 'sample.jpg');
  assert.equal(body.images[0].original_filename, 'sample-original.jpg');
  assert.equal(body.images[0].thumbnail_url, '/api/assets/42/thumbnail');
  assert.equal(body.images[0].views, 12);
  for (const field of [
    'thumbnail_path',
    'upload_file_device',
    'upload_file_inode',
    'upload_thumbnail_location_id',
  ]) {
    assert.equal(Object.hasOwn(body.images[0], field), false, `${field} must not be returned publicly`);
  }
  assert.doesNotMatch(response.body, /private\/storage|contributor\/2026|thumbnail%2Fsample/);
});

test('catalog preview rejects a 3x2 image instead of returning a successful placeholder-sized preview', async (t) => {
  const originalQuery = pool.query;
  const originalAxiosRequest = axios.request;
  const originalServerUrl = process.env.PC2_ASSET_SERVER_URL;
  process.env.PC2_ASSET_SERVER_URL = 'http://100.102.63.63:5000';
  pool.query = async (sql, values) => {
    if (catalogPreviewSelect.test(sql)) {
      assert.equal(String(values[0]), '180');
      return {
        rows: [{
          filename: 'owner/2026/10/asset.jpg',
          thumbnail_generated_at: null,
          status: 'approved',
          uploaded_by: 71,
        }],
      };
    }
    return originalQuery(sql, values);
  };
  axios.request = async () => ({
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
    data: await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#778899' },
    }).jpeg().toBuffer(),
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    pool.query = originalQuery;
    axios.request = originalAxiosRequest;
    if (originalServerUrl === undefined) delete process.env.PC2_ASSET_SERVER_URL;
    else process.env.PC2_ASSET_SERVER_URL = originalServerUrl;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const response = await request(
    server.address().port,
    '/api/catalog-preview/180?quality=63&watermark=true&v=fixture'
  );
  assert.equal(response.status, 422);
  assert.match(JSON.parse(response.body).error, /too small to be a valid stock asset/);
});

test('single-image endpoint still requires authentication for non-approved assets', async (t) => {
  const originalQuery = pool.query;
  let queryCount = 0;
  pool.query = async (sql, values) => {
    if (!singleImageSelect.test(sql)) return originalQuery(sql, values);
    queryCount += 1;
    return { rows: [{ id: 197, status: 'pending' }] };
  };

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    pool.query = originalQuery;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const response = await request(server.address().port, '/images/197');
  assert.equal(response.status, 401);
  assert.equal(JSON.parse(response.body), 'Access denied');
  assert.equal(queryCount, 1);
});

test('single-image endpoint returns the existing 404 response before authentication for missing assets', async (t) => {
  const originalQuery = pool.query;
  pool.query = async (sql, values) => {
    if (!singleImageSelect.test(sql)) return originalQuery(sql, values);
    return { rows: [] };
  };

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    pool.query = originalQuery;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const response = await request(server.address().port, '/images/999999');
  assert.equal(response.status, 404);
  assert.equal(JSON.parse(response.body), 'Image not found');
});

test('private pre-submission assets are available only to their owner through image and file preview routes', async (t) => {
  const originalQuery = pool.query;
  const privateImage = {
    id: 198,
    title: 'Private draft',
    filename: 'contributor/2026/10/Pending/private.jpg',
    uploaded_by: 7,
    status: 'not_submitted',
    thumbnail_status: 'COMPLETED',
    extension: 'jpg',
  };
  pool.query = async (sql, values) => {
    if (/SELECT i\.filename, i\.uploaded_by, i\.status, t\.status AS generated_thumbnail_status/i.test(sql)) {
      return { rows: [{ ...privateImage, generated_thumbnail_status: 'READY', format: 'webp' }] };
    }
    if (/SELECT uploaded_by, status FROM images WHERE filename = \$1/i.test(sql)) {
      return { rows: [{ uploaded_by: 7, status: 'not_submitted' }] };
    }
    if (/SELECT last_activity_at FROM auth_sessions/i.test(sql)) {
      return { rows: [{ last_activity_at: new Date() }] };
    }
    if (/SELECT status\s+FROM users\s+WHERE id = \$1/i.test(sql)) {
      return { rows: [{ status: 'active' }] };
    }
    if (/SELECT role FROM users WHERE id = \$1/i.test(sql)) {
      return { rows: [{ role: 'contributor' }] };
    }
    return originalQuery(sql, values);
  };

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    pool.query = originalQuery;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const ownerToken = jwt.sign({ user: 7, sid: 'owner-session' }, process.env.JWT_SECRET || 'secretkey', { expiresIn: '1h' });
  const otherContributorToken = jwt.sign({ user: 9, sid: 'other-session' }, process.env.JWT_SECRET || 'secretkey', { expiresIn: '1h' });
  const ownerPreview = await request(server.address().port, '/api/images/198', { Authorization: 'Bearer ' + ownerToken });
  assert.equal(ownerPreview.status, 302);
  const otherPreview = await request(server.address().port, '/api/images/198', { Authorization: 'Bearer ' + otherContributorToken });
  assert.equal(otherPreview.status, 404);
  const otherOriginalFile = await request(
    server.address().port,
    '/api/files/contributor/2026/10/Pending/private.jpg',
    { Authorization: 'Bearer ' + otherContributorToken }
  );
  assert.equal(otherOriginalFile.status, 404);
});

test('thumbnail download does not fall back to a legacy file when its generated thumbnail is unavailable', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-download-disconnected-'));
  const assetsRoot = path.join(directory, 'assets');
  const connectedThumbnailRoot = path.join(directory, 'thumbnails-connected');
  const disconnectedThumbnailRoot = path.join(directory, 'thumbnails-disconnected');
  const legacyThumbnailPath = path.join(assetsRoot, 'legacy-thumbnail.jpg');
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.mkdirSync(connectedThumbnailRoot, { recursive: true });
  fs.mkdirSync(disconnectedThumbnailRoot, { recursive: true });
  fs.writeFileSync(legacyThumbnailPath, Buffer.from('legacy thumbnail'));

  const originalQuery = pool.query;
  const originalConnectionsGet = assetStorageConnections.get;
  const originalCardConnectionsGet = assetStorageCardConnections.get;
  const originalThumbnailRoot = assetThumbnails.getThumbnailStorageRoot;
  const originalAssetRoot = assetThumbnails.getOriginalAssetStorageRoot;
  const image = {
    id: 901,
    filename: 'contributor/source.psd',
    thumbnail_url: '/api/thumbnail?file=legacy-thumbnail.jpg',
    uploaded_by: 7,
    status: 'approved',
    thumbnail_path: '2026/10/24/original_title_901.webp',
    generated_thumbnail_status: 'READY',
    format: 'webp',
  };

  pool.query = async (sql) => {
    if (/SELECT i\.id, i\.filename, i\.thumbnail_url, i\.uploaded_by, i\.status/i.test(sql)) {
      return { rows: [image] };
    }
    if (/SELECT role FROM users WHERE id = \$1/i.test(sql)) {
      return { rows: [{ role: 'admin' }] };
    }
    throw new Error(`Unexpected query in thumbnail-download test: ${sql}`);
  };
  assetStorageConnections.get = () => ({
    assets: true,
    thumbnails: true,
    assetLocations: [{ id: 'assets-1', path: assetsRoot }],
    thumbnailLocations: [
      { id: 'thumbnails-1', path: connectedThumbnailRoot },
      { id: 'thumbnails-2', path: disconnectedThumbnailRoot },
    ],
  });
  assetStorageCardConnections.get = () => ({ assets: {}, thumbnails: { '2': false } });
  assetThumbnails.getThumbnailStorageRoot = () => connectedThumbnailRoot;
  assetThumbnails.getOriginalAssetStorageRoot = () => assetsRoot;

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    pool.query = originalQuery;
    assetStorageConnections.get = originalConnectionsGet;
    assetStorageCardConnections.get = originalCardConnectionsGet;
    assetThumbnails.getThumbnailStorageRoot = originalThumbnailRoot;
    assetThumbnails.getOriginalAssetStorageRoot = originalAssetRoot;
    fs.rmSync(directory, { recursive: true, force: true });
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const token = jwt.sign({ user: 7 }, process.env.JWT_SECRET || 'secretkey', { expiresIn: '1h' });
  const response = await request(server.address().port, '/images/901/download-thumbnail', {
    Authorization: `Bearer ${token}`,
  });

  assert.equal(response.status, 404);
  assert.equal(response.body, '"Thumbnail not available"');
});

test('private original proxy authenticates cookie and bearer requests and preserves SERVER rejection', async (t) => {
  const originalQuery = pool.query;
  const originalAxiosRequest = axios.request;
  const originalServerUrl = process.env.PC2_ASSET_SERVER_URL;
  const image = {
    uploaded_by: 7,
    status: 'not_submitted',
  };
  const forwardedHeaders = [];
  let upstreamStatus = 403;
  let upstreamCalls = 0;

  process.env.PC2_ASSET_SERVER_URL = 'http://100.102.63.63:5000';
  pool.query = async (sql, values) => {
    if (/SELECT uploaded_by, status FROM images WHERE filename = \$1/i.test(sql)) {
      return { rows: [image] };
    }
    if (/SELECT last_activity_at FROM auth_sessions/i.test(sql)) {
      return { rows: [{ last_activity_at: new Date() }] };
    }
    if (/SELECT status\s+FROM users\s+WHERE id = \$1/i.test(sql)) {
      return { rows: [{ status: 'active' }] };
    }
    if (/SELECT role FROM users WHERE id = \$1/i.test(sql)) {
      return { rows: [{ role: Number(values[0]) === 8 ? 'admin' : 'contributor' }] };
    }
    if (/SELECT session_id FROM auth_sessions/i.test(sql)) {
      return { rows: [{ session_id: `session-${values[0]}` }] };
    }
    return originalQuery(sql, values);
  };
  axios.request = async (config) => {
    upstreamCalls += 1;
    forwardedHeaders.push(config.headers);
    return {
      status: upstreamStatus,
      headers: { 'content-type': 'application/json' },
      data: Readable.from([Buffer.from('{"error":"SERVER denied access"}')]),
    };
  };

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    pool.query = originalQuery;
    axios.request = originalAxiosRequest;
    if (originalServerUrl === undefined) delete process.env.PC2_ASSET_SERVER_URL;
    else process.env.PC2_ASSET_SERVER_URL = originalServerUrl;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const ownerToken = jwt.sign(
    { user: 7, sid: 'owner-session' },
    process.env.JWT_SECRET || 'secretkey',
    { expiresIn: '1h' }
  );
  const cookieResponse = await request(
    server.address().port,
    '/api/files/contributor/2026/10/Pending/private.jpg',
    { Cookie: `authToken=${ownerToken}` }
  );
  assert.equal(cookieResponse.status, 403);
  assert.equal(upstreamCalls, 1);
  assert.match(forwardedHeaders[0].authorization, /^Bearer\s+\S+$/);
  assert.notEqual(forwardedHeaders[0].authorization, `Bearer ${ownerToken}`);
  assert.equal(Object.hasOwn(forwardedHeaders[0], 'cookie'), false);

  upstreamStatus = 404;
  const bearerResponse = await request(
    server.address().port,
    '/api/files/contributor/2026/10/Pending/private.jpg',
    { Authorization: `Bearer ${ownerToken}` }
  );
  assert.equal(bearerResponse.status, 404);
  assert.equal(upstreamCalls, 2);

  const otherToken = jwt.sign(
    { user: 9, sid: 'other-session' },
    process.env.JWT_SECRET || 'secretkey',
    { expiresIn: '1h' }
  );
  const deniedResponse = await request(
    server.address().port,
    '/api/files/contributor/2026/10/Pending/private.jpg',
    { Authorization: `Bearer ${otherToken}` }
  );
  assert.equal(deniedResponse.status, 404);
  assert.equal(upstreamCalls, 2);
});

test('catalog preview allows asset owners and admins for pending assets only', async (t) => {
  const originalQuery = pool.query;
  let imageStatus = 'pending';
  pool.query = async (sql, values) => {
    if (/SELECT filename, thumbnail_generated_at, status, uploaded_by\s+FROM images\s+WHERE id = \$1/i.test(sql)) {
      return { rows: [{ filename: 'pending.bmp', status: imageStatus, uploaded_by: 7 }] };
    }
    if (/SELECT role, status\s+FROM users\s+WHERE id = \$1/i.test(sql)) {
      const userId = Number(values[0]);
      return { rows: [{ role: userId === 8 ? 'admin' : 'contributor', status: 'active' }] };
    }
    return originalQuery(sql, values);
  };

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    pool.query = originalQuery;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const port = server.address().port;
  const anonymousResponse = await request(port, '/api/catalog-preview/218');
  assert.equal(anonymousResponse.status, 401);

  const ownerToken = jwt.sign({ user: 7 }, process.env.JWT_SECRET || 'secretkey');
  const ownerResponse = await request(port, '/api/catalog-preview/218', {
    Authorization: `Bearer ${ownerToken}`,
  });
  assert.equal(ownerResponse.status, 415);
  assert.equal(ownerResponse.headers['cache-control'], 'private, no-store');

  const adminToken = jwt.sign({ user: 8 }, process.env.JWT_SECRET || 'secretkey');
  const adminResponse = await request(port, '/api/catalog-preview/218', {
    Authorization: `Bearer ${adminToken}`,
  });
  assert.equal(adminResponse.status, 415);

  const otherUserToken = jwt.sign({ user: 9 }, process.env.JWT_SECRET || 'secretkey');
  const otherUserResponse = await request(port, '/api/catalog-preview/218', {
    Authorization: `Bearer ${otherUserToken}`,
  });
  assert.equal(otherUserResponse.status, 403);

  imageStatus = 'approved';
  const publicResponse = await request(port, '/api/catalog-preview/218');
  assert.equal(publicResponse.status, 415);
  assert.equal(publicResponse.headers['cache-control'], 'public, max-age=300');
});
