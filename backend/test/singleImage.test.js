const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const cron = require('node-cron');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

process.env.DISABLE_EMAIL_SCHEDULER = 'true';
process.env.DISABLE_CURRENCY_SCHEDULER = 'true';
const originalCronSchedule = cron.schedule;
const originalPoolConnect = Pool.prototype.connect;
const singleImageSelect = /SELECT id, title, filename, category, keywords, created_at, downloads, views, likes,[\s\S]*FROM images\s+WHERE id = \$1/i;
cron.schedule = () => ({ stop() {} });
Pool.prototype.connect = async () => ({
  query: async () => ({ rows: [] }),
  release() {},
});

const pool = require('../db');
const originalPoolQuery = pool.query;
const { app } = require('../server');

cron.schedule = originalCronSchedule;
pool.query = originalPoolQuery;
Pool.prototype.connect = originalPoolConnect;

test.after(async () => {
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
    filename: 'asset.jpg',
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
  assert.equal(body.thumbnail_url, publicImage.thumbnail_url);
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
  ]) {
    assert.equal(Object.hasOwn(body, field), false, `${field} must not be returned publicly`);
  }
  assert.doesNotMatch(queryText, /SELECT\s+\*/i);
  for (const field of Object.keys(publicImage)) {
    assert.match(queryText, new RegExp(`\\b${field}\\b`, 'i'));
  }
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
