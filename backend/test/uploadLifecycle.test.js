const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/blockPostgres');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const pool = require('../db');
const thumbnailQueue = require('../thumbnail-queue-worker');
const assetThumbnails = require('../utils/assetThumbnails');

process.env.DISABLE_EMAIL_SCHEDULER = 'true';
process.env.DISABLE_CURRENCY_SCHEDULER = 'true';
const previousSchemaInitialization = process.env.DISABLE_SERVER_SCHEMA_INITIALIZATION;
const previousUserDeletionScheduler = process.env.DISABLE_USER_DELETION_SCHEDULER;
const previousNodeEnv = process.env.NODE_ENV;
const previousLocalUploadTestStorage = process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE;
process.env.NODE_ENV = 'test';
process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE = 'true';
process.env.DISABLE_SERVER_SCHEMA_INITIALIZATION = 'true';
process.env.DISABLE_USER_DELETION_SCHEDULER = 'true';
const originalCronSchedule = cron.schedule;
const originalGetOriginalAssetStorageRoot = assetThumbnails.getOriginalAssetStorageRoot;
assetThumbnails.getOriginalAssetStorageRoot = (relativePath) => {
  if (
    process.env.NODE_ENV === 'test' &&
    process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE === 'true' &&
    process.env.ASSETS_ROOT
  ) {
    return process.env.ASSETS_ROOT;
  }
  return originalGetOriginalAssetStorageRoot(relativePath);
};
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
const originalPoolConnect = pool.connect;
const originalQueueUpload = thumbnailQueue.queueAssetThumbnailJob;

test.after(async () => {
  pool.query = originalPoolQuery;
  pool.connect = originalPoolConnect;
  thumbnailQueue.queueAssetThumbnailJob = originalQueueUpload;
  assetThumbnails.getOriginalAssetStorageRoot = originalGetOriginalAssetStorageRoot;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousLocalUploadTestStorage === undefined) delete process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE;
  else process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE = previousLocalUploadTestStorage;
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

function makeMultipart(
  boundary,
  includeCompleteFile = true,
  imageField = 'image',
  content = Buffer.from('asset'),
  filename = 'asset.jpg',
  mimeType = 'image/jpeg',
  collection = null,
  fields = {},
  preSubmission = true
) {
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="preSubmission"\r\n\r\n${preSubmission}\r\n`,
    ...(collection
      ? [`--${boundary}\r\nContent-Disposition: form-data; name="collection"\r\n\r\n${collection}\r\n`]
      : []),
    ...Object.entries(fields).map(([field, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\n\r\n${value}\r\n`
    ),
    `--${boundary}\r\nContent-Disposition: form-data; name="${imageField}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
  ];
  if (includeCompleteFile) {
    parts.push(content);
    parts.push(`\r\n--${boundary}--\r\n`);
  } else {
    parts.push(Buffer.from('partial'));
  }

  return parts.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part));
}

function sendUpload(port, body, boundary, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/upload',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.reduce((total, part) => total + part.length, 0),
        ...extraHeaders
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

function sendJsonRequest(port, requestPath, body, requestToken = token) {
  const serializedBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requestToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(serializedBody)
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
    request.end(serializedBody);
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

test('rejects unauthenticated uploads before reading or staging file data', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-unauthorized-'));
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  process.env.ASSETS_ROOT = temporaryRoot;
  pool.query = async () => {
    throw new Error('An unauthenticated upload must not query for a user.');
  };
  t.after(async () => {
    pool.query = originalPoolQuery;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const server = await startServer(t);
  const boundary = '----gfx-upload-lifecycle-unauthorized';
  const response = await sendUpload(
    server.address().port,
    makeMultipart(boundary),
    boundary,
    { Authorization: '' }
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await getDirectoryEntries(temporaryRoot), []);
});

test('finalizes a complete upload in Pending and responds only with verified file size', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-finalize-'));
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  process.env.ASSETS_ROOT = temporaryRoot;
  pool.connect = async () => ({
    query: async () => ({ rows: [] }),
    release() {},
  });
  t.after(async () => {
    pool.query = originalPoolQuery;
    pool.connect = originalPoolConnect;
    thumbnailQueue.queueAssetThumbnailJob = originalQueueUpload;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  let insertedImage;
  let nextImageId = 455;
  const savedImages = [];
  let generatedThumbnailIsReady = false;
  let queuedThumbnailJobs = 0;
  pool.query = async (sql, values) => {
    if (/SELECT role, status, contributor_cooling_until, username, custom_permissions\s+FROM users/.test(sql)) {
      return { rows: [{ role: 'contributor', status: 'active', username: 'upload-test-user', custom_permissions: {} }] };
    }
    if (/SELECT \* FROM images WHERE uploaded_by = \$1 AND upload_request_id = \$2/.test(sql)) {
      return {
        rows: savedImages.filter((image) =>
          image.uploaded_by === values[0] && image.upload_request_id === values[1]
        ),
      };
    }
    if (/INSERT INTO images/.test(sql)) {
      insertedImage = {
        id: nextImageId++,
        filename: values[1],
        collection: values[3],
        status: values[12],
        file_size: values[7],
        uploaded_by: values[11],
        thumbnail_status: 'pending',
        upload_request_id: values[13],
        upload_content_sha256: values[14],
        upload_request_hash: values[15],
        upload_file_device: values[16],
        upload_file_inode: values[17],
        upload_target_status: values[18],
        original_filename: 'asset.jpg',
        upload_error: null,
      };
      savedImages.push(insertedImage);
      return { rows: [insertedImage] };
    }
    if (/UPDATE images\s+SET status = COALESCE\(NULLIF\(upload_target_status/.test(sql)) {
      assert.equal(generatedThumbnailIsReady, true);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [{ id: 1 }], rowCount: 1 };
  };
  thumbnailQueue.queueAssetThumbnailJob = async () => {
    queuedThumbnailJobs += 1;
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
    makeMultipart(boundary, true, 'image', Buffer.from('asset'), 'asset.jpg', 'image/jpeg', 'Templates'),
    boundary,
    { 'Idempotency-Key': 'c99547ed-2ff2-44c6-9fbf-218e3b61f1b9' }
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.upload_complete, true);
  assert.equal(body.finalized, true);
  assert.equal(body.file_size, 5);
  assert.equal(body.filename, insertedImage.filename);
  assert.equal(insertedImage.collection, 'Photos');
  assert.equal(body.original_filename, 'asset.jpg');
  const filenameParts = path.basename(insertedImage.filename).match(
    /^upload-test-user_(\d{2})(\d{2})(\d{4})_asset\.jpg$/
  );
  assert.ok(filenameParts);
  assert.equal(
    insertedImage.filename,
    path.join('upload-test-user', filenameParts[3], filenameParts[2], 'Pending', path.basename(insertedImage.filename))
  );
  assert.equal(insertedImage.status, 'upload_processing');
  assert.equal(insertedImage.filename.startsWith('.upload-staging/'), false);
  const finalizedStats = await fs.stat(path.join(temporaryRoot, insertedImage.filename));
  assert.equal(finalizedStats.isFile(), true);
  assert.equal(finalizedStats.size, insertedImage.file_size);
  assert.deepEqual(await getDirectoryEntries(path.join(temporaryRoot, '.upload-staging')), []);

  generatedThumbnailIsReady = true;
  insertedImage.thumbnail_status = 'COMPLETED';
  insertedImage.upload_target_status = 'not_submitted';
  const replay = await sendUpload(
    server.address().port,
    makeMultipart(boundary),
    boundary,
    { 'Idempotency-Key': 'c99547ed-2ff2-44c6-9fbf-218e3b61f1b9' }
  );
  assert.equal(replay.status, 200);
  const replayBody = JSON.parse(replay.body);
  assert.equal(replayBody.id, insertedImage.id);
  assert.equal(replayBody.filename, insertedImage.filename);
  assert.equal(replayBody.idempotent_replay, true);
  assert.equal(replayBody.asset_status, 'not_submitted');
  assert.equal(replayBody.thumbnail_processing_status, 'READY');
  assert.equal(queuedThumbnailJobs, 1);
  assert.equal(savedImages.length, 1);
  assert.equal((await fs.readFile(path.join(temporaryRoot, insertedImage.filename))).length, 5);
});

test('does not report upload success when the finalized original disappears before final verification', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-missing-final-'));
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  process.env.ASSETS_ROOT = temporaryRoot;
  pool.connect = async () => ({
    query: async () => ({ rows: [] }),
    release() {},
  });
  t.after(async () => {
    pool.query = originalPoolQuery;
    pool.connect = originalPoolConnect;
    thumbnailQueue.queueAssetThumbnailJob = originalQueueUpload;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  let insertedImage;
  const savedImages = [];
  pool.query = async (sql, values) => {
    if (/SELECT role, status, contributor_cooling_until, username, custom_permissions\s+FROM users/.test(sql)) {
      return { rows: [{ role: 'contributor', status: 'active', username: 'upload-missing-final-user', custom_permissions: {} }] };
    }
    if (/SELECT \* FROM images WHERE uploaded_by = \$1 AND upload_request_id = \$2/.test(sql)) {
      return {
        rows: savedImages.filter((image) =>
          image.uploaded_by === values[0] && image.upload_request_id === values[1]
        ),
      };
    }
    if (/INSERT INTO images/.test(sql)) {
      insertedImage = {
        id: 456,
        filename: values[1],
        status: values[12],
        file_size: values[7],
        uploaded_by: values[11],
        thumbnail_status: 'pending',
        upload_request_id: values[13],
        upload_content_sha256: values[14],
        upload_request_hash: values[15],
        upload_file_device: values[16],
        upload_file_inode: values[17],
        upload_target_status: values[18],
        original_filename: 'asset.jpg',
        upload_error: null,
      };
      savedImages.push(insertedImage);
      return { rows: [insertedImage] };
    }
    return { rows: [], rowCount: 1 };
  };
  thumbnailQueue.queueAssetThumbnailJob = async () => {
    await fs.unlink(path.join(temporaryRoot, insertedImage.filename));
    return 'missing-original-test-job';
  };

  const server = await startServer(t);
  const boundary = '----gfx-upload-lifecycle-missing-final';
  const response = await sendUpload(
    server.address().port,
    makeMultipart(boundary),
    boundary,
    { 'Idempotency-Key': 'c99547ed-2ff2-44c6-9fbf-218e3b61f1c0' }
  );

  assert.equal(response.status, 500);
  const body = JSON.parse(response.body);
  assert.equal(body.upload_complete, undefined);
  assert.equal(body.finalized, undefined);
  assert.match(body.error, /missing after upload completion/);
  assert.deepEqual(await getDirectoryEntries(path.join(temporaryRoot, '.upload-staging')), []);
});

test('cleans the exact finalized file and staging directory when asset-record creation fails', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-failure-'));
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  process.env.ASSETS_ROOT = temporaryRoot;
  pool.connect = async () => ({
    query: async () => ({ rows: [] }),
    release() {},
  });
  t.after(async () => {
    pool.query = originalPoolQuery;
    pool.connect = originalPoolConnect;
    thumbnailQueue.queueAssetThumbnailJob = originalQueueUpload;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  pool.query = async (sql) => {
    if (/SELECT role, status, contributor_cooling_until, username, custom_permissions\s+FROM users/.test(sql)) {
      return { rows: [{ role: 'contributor', status: 'active', username: 'upload-failure-user', custom_permissions: {} }] };
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

test('rejects a multipart image field mismatch explicitly and removes staged bytes', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-field-mismatch-'));
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  process.env.ASSETS_ROOT = temporaryRoot;
  pool.query = async (sql) => {
    if (/SELECT role, status, contributor_cooling_until, username, custom_permissions\s+FROM users/.test(sql)) {
      return { rows: [{ role: 'contributor', status: 'active', username: 'upload-mismatch-user', custom_permissions: {} }] };
    }
    return { rows: [], rowCount: 0 };
  };
  t.after(async () => {
    pool.query = originalPoolQuery;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const server = await startServer(t);
  const boundary = '----gfx-upload-lifecycle-field-mismatch';
  const response = await sendUpload(
    server.address().port,
    makeMultipart(boundary, true, 'asset'),
    boundary
  );

  assert.equal(response.status, 400);
  assert.match(JSON.parse(response.body).error, /Unexpected field/);
  assert.deepEqual(await getDirectoryEntries(path.join(temporaryRoot, '.upload-staging')), []);
});

test('rejects unsupported file types before creating an asset record', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-invalid-type-'));
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  process.env.ASSETS_ROOT = temporaryRoot;
  pool.query = async (sql) => {
    if (/SELECT role, status, contributor_cooling_until, username, custom_permissions\s+FROM users/.test(sql)) {
      return { rows: [{ role: 'contributor', status: 'active', username: 'upload-invalid-type-user', custom_permissions: {} }] };
    }
    throw new Error('An unsupported file type must not create an asset record.');
  };
  t.after(async () => {
    pool.query = originalPoolQuery;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const server = await startServer(t);
  const boundary = '----gfx-upload-lifecycle-invalid-type';
  const response = await sendUpload(
    server.address().port,
    makeMultipart(boundary, true, 'image', Buffer.from('not-an-image'), 'payload.exe', 'application/x-msdownload')
  );

  assert.equal(response.status, 400);
  assert.equal(typeof JSON.parse(response.body).error, 'string');
  assert.deepEqual(await getDirectoryEntries(path.join(temporaryRoot, '.upload-staging')), []);
});

test('requires description and type for regular uploads', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-required-fields-'));
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  process.env.ASSETS_ROOT = temporaryRoot;
  pool.query = async (sql) => {
    if (/SELECT role, status, contributor_cooling_until, username, custom_permissions\s+FROM users/.test(sql)) {
      return {
        rows: [{ role: 'contributor', status: 'active', username: 'required-fields-user', custom_permissions: {} }],
      };
    }
    throw new Error('Missing required metadata must be rejected before database writes.');
  };
  t.after(async () => {
    pool.query = originalPoolQuery;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const server = await startServer(t);
  for (const [missingField, metadata] of [
    ['description', { title: 'Asset title', category: 'Nature', keywords: 'forest', type: 'commercial' }],
    ['type', { title: 'Asset title', category: 'Nature', keywords: 'forest', description: 'Forest image' }],
  ]) {
    const boundary = `----gfx-upload-required-${missingField}`;
    const response = await sendUpload(
      server.address().port,
      makeMultipart(boundary, true, 'image', Buffer.from('asset'), 'asset.jpg', 'image/jpeg', 'Photos', metadata, false),
      boundary
    );

    assert.equal(response.status, 400, `${missingField} should be required`);
    assert.equal(response.body, '"All fields are required"');
  }
  assert.deepEqual(await getDirectoryEntries(path.join(temporaryRoot, '.upload-staging')), []);
});

test('requires description and type before submitting a bulk draft', async (t) => {
  const sessionId = 'bulk-submit-required-fields-session';
  const sessionToken = jwt.sign(
    { user: contributorId, sid: sessionId },
    process.env.JWT_SECRET || 'secretkey'
  );
  const assets = new Map([
    [61, {
      id: 61,
      uploaded_by: contributorId,
      status: 'draft',
      title: 'Draft title',
      description: '',
      category: 'Nature',
      collection: 'Photos',
      keywords: 'forest',
      type: 'commercial',
      filename: 'asset.jpg',
      original_filename: 'asset.jpg',
    }],
    [62, {
      id: 62,
      uploaded_by: contributorId,
      status: 'draft',
      title: 'Draft title',
      description: 'Forest image',
      category: 'Nature',
      collection: 'Photos',
      keywords: 'forest',
      type: '',
      filename: 'asset.jpg',
      original_filename: 'asset.jpg',
    }],
  ]);
  pool.query = async (sql, values) => {
    if (/SELECT last_activity_at FROM auth_sessions/.test(sql)) {
      return { rows: [{ last_activity_at: new Date() }] };
    }
    if (/SELECT status\s+FROM users/.test(sql)) {
      return { rows: [{ status: 'active' }] };
    }
    if (/SELECT role FROM users WHERE id = \$1/.test(sql)) {
      return { rows: [{ role: 'contributor' }] };
    }
    if (/SELECT id, uploaded_by, status, title, description, category, collection, keywords, type, filename, original_filename/.test(sql)) {
      return { rows: [assets.get(values[0])] };
    }
    throw new Error('Incomplete draft metadata must be rejected before database updates.');
  };
  t.after(() => {
    pool.query = originalPoolQuery;
  });

  const server = await startServer(t);
  for (const assetId of assets.keys()) {
    const response = await sendJsonRequest(
      server.address().port,
      `/my-uploads/${assetId}/submit`,
      {},
      sessionToken
    );

    assert.equal(response.status, 400);
    assert.equal(
      JSON.parse(response.body).error,
      'Complete the required metadata before submitting this asset.'
    );
  }
});

test('enforces the contributor upload limit before creating an asset record', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-upload-size-limit-'));
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  process.env.ASSETS_ROOT = temporaryRoot;
  pool.query = async (sql) => {
    if (/SELECT role, status, contributor_cooling_until, username, custom_permissions\s+FROM users/.test(sql)) {
      return {
        rows: [{
          role: 'contributor',
          status: 'active',
          username: 'upload-size-user',
          custom_permissions: { upload_limit_value: 1, upload_limit_unit: 'MB' },
        }],
      };
    }
    throw new Error('An over-limit upload must not create or update database records.');
  };
  t.after(async () => {
    pool.query = originalPoolQuery;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const server = await startServer(t);
  const boundary = '----gfx-upload-lifecycle-size-limit';
  const response = await sendUpload(
    server.address().port,
    makeMultipart(boundary, true, 'image', Buffer.alloc(1024 * 1024 + 1, 'x')),
    boundary
  );

  assert.equal(response.status, 413);
  assert.match(JSON.parse(response.body).error, /1 MB upload limit/);
  assert.deepEqual(await getDirectoryEntries(path.join(temporaryRoot, '.upload-staging')), []);
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
    if (/SELECT role, status, contributor_cooling_until, username, custom_permissions\s+FROM users/.test(sql)) {
      return { rows: [{ role: 'contributor', status: 'active', username: 'upload-abort-user', custom_permissions: {} }] };
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
