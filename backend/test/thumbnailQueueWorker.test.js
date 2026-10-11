const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const assetThumbnails = require('../utils/assetThumbnails');
const thumbnailQueue = require('../thumbnail-queue-worker');

test.after(async () => {
  await pool.end();
});

test('does not start the worker on macOS without configured thumbnail storage', async () => {
  assert.equal(thumbnailQueue.shouldInitializeThumbnailWorker({
    platform: 'darwin',
    nodeEnv: 'production',
    thumbnailStoragePath: '',
    allowLocalTestStorage: false,
  }), false);
  assert.equal(thumbnailQueue.shouldInitializeThumbnailWorker({
    platform: 'darwin',
    nodeEnv: 'production',
    thumbnailStoragePath: 'F:\\GFXunlimitThumbnails',
    allowLocalTestStorage: false,
  }), true);
  assert.equal(thumbnailQueue.shouldInitializeThumbnailWorker({
    platform: 'win32',
    nodeEnv: 'production',
    thumbnailStoragePath: '',
    allowLocalTestStorage: false,
  }), true);
  assert.equal(thumbnailQueue.shouldInitializeThumbnailWorker({
    platform: 'darwin',
    nodeEnv: 'test',
    thumbnailStoragePath: '',
    allowLocalTestStorage: true,
  }), true);
  if (process.platform === 'darwin') {
    const previousStoragePath = process.env.THUMBNAIL_STORAGE_PATH;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousLocalStorageOverride = process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE;
    delete process.env.THUMBNAIL_STORAGE_PATH;
    process.env.NODE_ENV = 'production';
    delete process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE;
    try {
      assert.equal(await thumbnailQueue.initialize(), false);
      assert.equal(thumbnailQueue.queue, null);
      assert.equal(thumbnailQueue.worker, null);
    } finally {
      if (previousStoragePath === undefined) delete process.env.THUMBNAIL_STORAGE_PATH;
      else process.env.THUMBNAIL_STORAGE_PATH = previousStoragePath;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousLocalStorageOverride === undefined) delete process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE;
      else process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE = previousLocalStorageOverride;
    }
  }
});

test('only moves a pre-submission upload to Not Submitted after READY generation succeeds', async () => {
  const originalQuery = pool.query;
  const originalGenerate = assetThumbnails.generateAssetThumbnail;
  const queries = [];
  pool.query = async (sql) => {
    queries.push(sql);
    return { rows: [] };
  };
  assetThumbnails.generateAssetThumbnail = async () => ({ status: 'generated', assetId: 73 });

  try {
    await thumbnailQueue.processJob({
      name: 'generate-asset-thumbnail',
      data: { assetId: 73 },
      attemptsMade: 0,
      opts: { attempts: 3 }
    });
    assert.ok(queries.some((sql) => /SET status = COALESCE\(NULLIF\(upload_target_status, ''\), 'not_submitted'\)/.test(sql)));
    assert.ok(queries.some((sql) => /upload_target_status = NULL/.test(sql)));
    assert.ok(queries.some((sql) => /status = 'READY' AND thumbnail_path IS NOT NULL/.test(sql)));
  } finally {
    pool.query = originalQuery;
    assetThumbnails.generateAssetThumbnail = originalGenerate;
  }
});

test('does not expose an upload as Not Submitted when thumbnail generation fails', async () => {
  const originalQuery = pool.query;
  const originalGenerate = assetThumbnails.generateAssetThumbnail;
  const queries = [];
  pool.query = async (sql) => {
    queries.push(sql);
    return { rows: [] };
  };
  assetThumbnails.generateAssetThumbnail = async () => {
    throw new Error('thumbnail failure');
  };

  try {
    await assert.rejects(
      thumbnailQueue.processJob({
        name: 'generate-asset-thumbnail',
        data: { assetId: 74 },
        attemptsMade: 0,
        opts: { attempts: 3 }
      }),
      /thumbnail failure/
    );
    assert.equal(queries.some((sql) => /SET status = 'not_submitted'/.test(sql)), false);
  } finally {
    pool.query = originalQuery;
    assetThumbnails.generateAssetThumbnail = originalGenerate;
  }
});

test('marks transient thumbnail failures as retrying without violating thumbnail metadata states', async () => {
  const originalQuery = pool.query;
  const originalGenerate = assetThumbnails.generateAssetThumbnail;
  const queries = [];
  pool.query = async (sql) => {
    queries.push(sql);
    return { rows: [] };
  };
  assetThumbnails.generateAssetThumbnail = async () => {
    throw new Error('temporary remote stream interruption');
  };

  try {
    await assert.rejects(
      thumbnailQueue.processJob({
        name: 'generate-asset-thumbnail',
        data: { assetId: 75 },
        attemptsMade: 0,
        opts: { attempts: 3 }
      }),
      /temporary remote stream interruption/
    );
    assert.ok(queries.some((sql) => /SET thumbnail_status = 'RETRYING'/.test(sql)));
    assert.ok(queries.some((sql) => /SET status = 'PROCESSING', error_message = \$1/.test(sql)));
    assert.equal(queries.some((sql) => /SET status = 'RETRYING'/.test(sql)), false);
  } finally {
    pool.query = originalQuery;
    assetThumbnails.generateAssetThumbnail = originalGenerate;
  }
});
