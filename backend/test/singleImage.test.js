const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const cron = require('node-cron');
const { Pool } = require('pg');

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

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: 'GET',
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString(),
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
