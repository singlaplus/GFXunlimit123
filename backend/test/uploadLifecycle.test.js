const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const pool = require('../db');
const thumbnailQueue = require('../thumbnail-queue-worker');

process.env.DISABLE_EMAIL_SCHEDULER = 'true';
process.env.DISABLE_CURRENCY_SCHEDULER = 'true';
const previousSchemaInitialization = process.env.DISABLE_SERVER_SCHEMA_INITIALIZATION;
const previousUserDeletionScheduler = process.env.DISABLE_USER_DELETION_SCHEDULER;
process.env.DISABLE_SERVER_SCHEMA_INITIALIZATION = 'true';
process.env.DISABLE_USER_DELETION_SCHEDULER = 'true';
const originalCronSchedule = cron.schedule;
cron.schedule = () => ({ stop() {} });
const { app } = require('../server');
cron.schedule = originalCronSchedule;
if (previousSchemaInitialization === undefined) delete process.env.DISABLE_SERVER_SCHEMA_INITIALIZATION;
else process.env.DISABLE_SERVER_SCHEMA_INITIALIZATION = previousSchemaInitialization;
if (previousUserDeletionScheduler === undefined) delete process.env.DISABLE_USER_DELETION_SCHEDULER;
else process.env.DISABLE_USER_DELETION_SCHEDULER = previousUserDeletionScheduler;

const contributorId = 54031;
const token = jwt.sign({ user: contributorId }, process.env.JWT_SECRET || 'secretkey');
const originalPoolQuery = pool.query;
const originalQueueUpload = thumbnailQueue.queueAssetThumbnailJob;

test.after(async () => {
  pool.query = originalPoolQuery;
  thumbnailQueue.queueAssetThumbnailJob = originalQueueUpload;
  await pool.end();
});

function startServer(t) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve) => {
    server.once('listening', () => {
      t.after(() => new Promise((close, reject) => {
        server.close((error) => error ? reject(error) : close());
      }));
      resolve(server);
    });
  });
}

function makeMultipart(boundary, includeCompleteFile = true) {
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="preSubmission"\r\n\r\ntrue\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="asset.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
  ];
  if (includeCompleteFile) {
    parts.push(Buffer.from('asset'));
    parts.push(`\r\n--${boundary}--\r\n`);
  } else {
    parts.push(Buffer.from('partial'));
  }
  return parts.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part));
}

function sendUpload(port, body, boundary) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/upload',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.reduce((total, part) => total + part.length, 0)
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString()
      }));
    });
    request.on('error', reject);
    body.forEach((part) => request.write(part));
    request.end();
  });
}

async function getDirectoryEntries(directory) {
  try {
    return await fs.readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

test('finalizes a complete upload in Pending and responds only with verified file size', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-finalize-'));
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  process.env.ASSETS_ROOT = temporaryRoot;
  t.after(async () => {
    pool.query = originalPoolQuery;
    thumbnailQueue.queueAssetThumbnailJob = originalQueueUpload;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  let insertedImage;
  pool.query = async (sql, values) => {
    if (/SELECT role, status, contributor_cooling_until, username FROM users/.test(sql)) {
      return { rows: [{ role: 'contributor', status: 'active', username: 'upload-test-user' }] };
    }
    if (/INSERT INTO images/.test(sql)) {
      insertedImage = { id: 455, filename: values[1], status: values[12], file_size: values[7] };
      return { rows: [insertedImage] };
    }
    return { rows: [{ id: 1 }], rowCount: 1 };
  };
  thumbnailQueue.queueAssetThumbnailJob = async () => {
    const finalizedPath = path.join(temporaryRoot, insertedImage.filename);
    const stats = await fs.stat(finalizedPath);
    assert.equal(stats.isFile(), true);
    assert.equal(stats.size, insertedImage.file_size);
    return 'test-thumbnail-job';
  };
  const server = await startServer(t);
  const boundary = '----gfx-upload-lifecycle-success';
  const response = await sendUpload(
    server.address().port,
    makeMultipart(boundary),
    boundary
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.upload_complete, true);
  assert.equal(body.finalized, true);
  assert.equal(body.file_size, 5);
  assert.equal(insertedImage.status, 'upload_processing');
  assert.equal(insertedImage.filename.startsWith('.upload-staging/'), false);
  const finalizedStats = await fs.stat(path.join(temporaryRoot, insertedImage.filename));
  assert.equal(finalizedStats.isFile(), true);
  assert.equal(finalizedStats.size, insertedImage.file_size);
  assert.deepEqual(await getDirectoryEntries(path.join(temporaryRoot, '.upload-staging')), []);
});

test('cleans the exact finalized file and staging directory when asset-record creation fails', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-failure-'));
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  process.env.ASSETS_ROOT = temporaryRoot;
  t.after(async () => {
    pool.query = originalPoolQuery;
    thumbnailQueue.queueAssetThumbnailJob = originalQueueUpload;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  pool.query = async (sql) => {
    if (/SELECT role, status, contributor_cooling_until, username FROM users/.test(sql)) {
      return { rows: [{ role: 'contributor', status: 'active', username: 'upload-failure-user' }] };
    }
    if (/INSERT INTO images/.test(sql)) throw new Error('database insert failed');
    return { rows: [], rowCount: 0 };
  };
  const server = await startServer(t);
  const boundary = '----gfx-upload-lifecycle-failure';
  const response = await sendUpload(
    server.address().port,
    makeMultipart(boundary),
    boundary
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await getDirectoryEntries(path.join(temporaryRoot, '.upload-staging')), []);
  assert.deepEqual(
    await getDirectoryEntries(path.join(temporaryRoot, 'upload-failure-user', new Date().getFullYear().toString(), String(new Date().getMonth() + 1).padStart(2, '0'), 'Pending')),
    []
  );
});

test('removes an interrupted upload from its request-specific staging directory', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-abort-'));
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  process.env.ASSETS_ROOT = temporaryRoot;
  t.after(async () => {
    pool.query = originalPoolQuery;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  pool.query = async (sql) => {
    if (/SELECT role, status, contributor_cooling_until, username FROM users/.test(sql)) {
      return { rows: [{ role: 'contributor', status: 'active', username: 'upload-abort-user' }] };
    }
    return { rows: [], rowCount: 0 };
  };
  const server = await startServer(t);
  const boundary = '----gfx-upload-lifecycle-abort';
  const partialBody = makeMultipart(boundary, false);
  const request = http.request({
    hostname: '127.0.0.1',
    port: server.address().port,
    path: '/upload',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    }
  });
  request.on('error', () => {});
  partialBody.forEach((part) => request.write(part));
  await new Promise((resolve) => setTimeout(resolve, 100));
  request.destroy();

  const stagingRoot = path.join(temporaryRoot, '.upload-staging');
  let stagingEntries = ['pending'];
  for (let attempt = 0; attempt < 40 && stagingEntries.length > 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    stagingEntries = await getDirectoryEntries(stagingRoot);
  }
  assert.deepEqual(stagingEntries, []);
  assert.deepEqual(await getDirectoryEntries(path.join(temporaryRoot, 'upload-abort-user')), []);
});
