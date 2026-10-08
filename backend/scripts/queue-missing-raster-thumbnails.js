require('dotenv').config();

const path = require('path');
const { Queue } = require('bullmq');
const pool = require('../db');
const { resolveAssetFile } = require('../utils/assetServing');

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

async function main() {
  const assetRoot = String(process.env.ASSETS_ROOT || '').trim();
  if (!assetRoot) {
    throw new Error('ASSETS_ROOT must point to the existing SERVER asset root');
  }

  const queue = new Queue('thumbnail-processing', { connection: redisConnection });
  let queuedCount = 0;
  let skippedCount = 0;

  try {
    const [assetsResult, existingJobs] = await Promise.all([
      pool.query(`
        SELECT id, filename, uploaded_by
        FROM images
        WHERE (thumbnail_url IS NULL OR BTRIM(thumbnail_url) = '')
          AND uploaded_by IS NOT NULL
          AND LOWER(COALESCE(filename, '')) ~ '\\.(jpg|jpeg|png|webp|gif|svg)$'
        ORDER BY id
      `),
      queue.getJobs(['waiting', 'active', 'delayed']),
    ]);

    const queuedAssetIds = new Set(
      existingJobs.map((job) => Number(job.data?.assetId)).filter(Number.isFinite)
    );

    for (const asset of assetsResult.rows) {
      const assetId = Number(asset.id);
      if (queuedAssetIds.has(assetId)) {
        skippedCount += 1;
        continue;
      }

      try {
        const relativePath = String(asset.filename || '')
          .replace(/\\/g, '/')
          .replace(/^\/+/, '')
          .replace(/^uploads\/+/, '');
        const filePath = await resolveAssetFile(assetRoot, relativePath);
        const fileType = path.extname(filePath).slice(1).toLowerCase();

        await queue.add('process-thumbnail', {
          assetId,
          contributorId: Number(asset.uploaded_by),
          filePath,
          fileType,
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: false,
          removeOnFailed: false,
        });

        await pool.query(
          `INSERT INTO asset_processing_jobs (asset_id, status, created_at) VALUES ($1, $2, NOW())`,
          [assetId, 'QUEUED']
        );
        queuedAssetIds.add(assetId);
        queuedCount += 1;
      } catch (error) {
        skippedCount += 1;
        console.warn(`Skipped asset ${assetId}: ${error.message}`);
      }
    }

    console.log(`Queued ${queuedCount} missing raster thumbnails; skipped ${skippedCount}.`);
  } finally {
    await queue.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Raster thumbnail backfill failed: ${error.message}`);
  process.exitCode = 1;
});
