const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db');
const assetThumbnails = require('../utils/assetThumbnails');
const thumbnailQueue = require('../thumbnail-queue-worker');

test.after(async () => {
  await pool.end();
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
    assert.ok(queries.some((sql) => /SET status = 'not_submitted'/.test(sql)));
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
