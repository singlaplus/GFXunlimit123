/**
 * Thumbnail Processing Queue Worker
 * Uses BullMQ to process thumbnail jobs in background
 * Keeps Node.js/Express server responsive
 */

const Queue = require('bullmq').Queue;
const Worker = require('bullmq').Worker;
const Redis = require('ioredis');
const path = require('path');
const pool = require('./db');
const processorFactory = require('./thumbnail-engine/processor-factory');
const { createAssetNotifications } = require('./messaging');

// Redis connection
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

class ThumbnailQueueManager {
  constructor() {
    this.queue = null;
    this.worker = null;
    this.isRunning = false;
  }

  /**
   * Initialize queue and worker
   */
  async initialize() {
    try {
      // Create queue
      this.queue = new Queue('thumbnail-processing', {
        connection: redisConnection,
      });

      console.log('✓ Thumbnail processing queue initialized');

      // Setup queue event listeners
      this.setupQueueListeners();

      // Initialize worker
      this.worker = new Worker(
        'thumbnail-processing',
        async (job) => this.processJob(job),
        {
          connection: redisConnection,
          concurrency: 2, // Process 2 thumbnails at a time
        }
      );

      // Setup worker event listeners
      this.setupWorkerListeners();

      this.isRunning = true;
      console.log('✓ Thumbnail processing worker started (concurrency: 2)');

      return true;
    } catch (err) {
      console.error('Failed to initialize thumbnail queue:', err);
      return false;
    }
  }

  /**
   * Setup queue event listeners
   */
  setupQueueListeners() {
    this.queue.on('waiting', (job) => {
      console.log(`[Queue] Job ${job.id} waiting in queue`);
    });

    this.queue.on('active', (job) => {
      console.log(`[Queue] Job ${job.id} started processing`);
    });

    this.queue.on('completed', (job) => {
      console.log(`[Queue] Job ${job.id} completed successfully`);
    });

    this.queue.on('failed', (job, err) => {
      console.error(`[Queue] Job ${job.id} failed:`, err.message);
    });

    this.queue.on('error', (err) => {
      console.error('[Queue] Error:', err);
    });
  }

  /**
   * Setup worker event listeners
   */
  setupWorkerListeners() {
    this.worker.on('ready', () => {
      console.log('[Worker] Ready to process jobs');
    });

    this.worker.on('completed', (job) => {
      console.log(`[Worker] Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`[Worker] Job ${job.id} failed:`, err.message);
    });

    this.worker.on('error', (err) => {
      console.error('[Worker] Error:', err);
    });

    this.worker.on('progress', (job, progress) => {
      console.log(`[Worker] Job ${job.id} progress: ${progress}`);
    });
  }

  /**
   * Queue a thumbnail processing job
   */
  async queueThumbnailJob(assetId, contributorId, filePath, fileType) {
    try {
      // Check if job already queued for this asset
      const existingJobs = await this.queue.getJobs(['waiting', 'active']);
      const duplicate = existingJobs.find(
        (job) => job.data.assetId === assetId && job.data.fileType === fileType
      );

      if (duplicate) {
        console.log(`[Queue] Job already exists for asset ${assetId}, skipping duplicate`);
        return duplicate.id;
      }

      // Create job
      const job = await this.queue.add(
        'process-thumbnail',
        {
          assetId,
          contributorId,
          filePath,
          fileType,
        },
        {
          attempts: 3, // Retry up to 3 times
          backoff: {
            type: 'exponential',
            delay: 2000, // Start with 2 second delay
          },
          removeOnComplete: false, // Keep completed jobs for history
          removeOnFailed: false, // Keep failed jobs for debugging
        }
      );

      console.log(`[Queue] Thumbnail processing job queued: ${job.id}`);

      // Record in database
      const dbResult = await pool.query(`
        INSERT INTO asset_processing_jobs 
        (asset_id, status, created_at)
        VALUES ($1, $2, NOW())
        RETURNING id
      `, [assetId, 'QUEUED']);

      const jobId = dbResult.rows[0]?.id;

      return jobId || job.id;
    } catch (err) {
      console.error('Failed to queue thumbnail job:', err);
      throw err;
    }
  }

  /**
   * Process a single thumbnail job
   */
  async processJob(job) {
    const { assetId, contributorId, filePath, fileType } = job.data;
    const startTime = Date.now();

    try {
      console.log(`\n[Processing] Starting job ${job.id} for asset ${assetId}`);
      console.log(`[Processing] File type: ${fileType}, Path: ${filePath}`);

      // Update job status in database
      await pool.query(`
        UPDATE asset_processing_jobs
        SET status = $1, started_at = NOW()
        WHERE asset_id = $2
      `, ['PROCESSING', assetId]);

      // Update asset status
      await pool.query(`
        UPDATE images
        SET thumbnail_status = $1
        WHERE id = $2
      `, ['PROCESSING', assetId]);

      // Get processor
      const processor = processorFactory.getProcessor(filePath);
      if (!processor) {
        throw new Error(`No processor available for ${fileType}`);
      }

      // Check processor is ready
      const status = await processor.getStatus();
      if (status && status.status !== 'READY' && fileType !== 'psd') {
        throw new Error(`Processor not ready: ${status.status}`);
      }

      // Process with timeout
      const processingTimeout = 120000; // 2 minutes
      const processPromise = processorFactory.process(filePath, assetId, job.id, {
        quality: 30,
        maxWidth: 1200,
        maxHeight: 1200,
      });

      const result = await Promise.race([
        processPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Processing timeout')), processingTimeout)
        ),
      ]);

      if (result.success) {
        console.log(`[Processing] ✓ Job ${job.id} completed successfully`);
        const processingTime = Date.now() - startTime;
        const asset = (await pool.query('SELECT title FROM images WHERE id = $1', [assetId])).rows[0];
        await createAssetNotifications(pool, {
          userIds: [contributorId],
          eventType: 'THUMBNAIL_GENERATION_COMPLETED',
          assetTitle: asset?.title,
          ownerId: contributorId,
          actorId: contributorId
        });
        
        return {
          success: true,
          assetId,
          thumbnailPath: result.thumbnailPath,
          processingTimeMs: processingTime,
        };
      } else {
        throw new Error(result.error || 'Processing failed');
      }
    } catch (err) {
      console.error(`[Processing] ✗ Job ${job.id} failed: ${err.message}`);

      try {
        const retryCount = job.attemptsMade || 0;
        const willRetry = retryCount < 3;

        // Update database with error
        await pool.query(`
          UPDATE asset_processing_jobs
          SET 
            status = $1,
            attempt = $2,
            error_message = $3,
            completed_at = NOW()
          WHERE asset_id = $4
        `, [
          willRetry ? 'RETRYING' : 'FAILED',
          retryCount,
          err.message,
          assetId,
        ]);

        // Update asset status
        await pool.query(`
          UPDATE images
          SET thumbnail_status = $1, thumbnail_error = $2
          WHERE id = $3
        `, [willRetry ? 'RETRYING' : 'FAILED', err.message, assetId]);

        if (!willRetry) {
          const asset = (await pool.query('SELECT title FROM images WHERE id = $1', [assetId])).rows[0];
          await createAssetNotifications(pool, {
            userIds: [contributorId],
            eventType: 'THUMBNAIL_GENERATION_FAILED',
            assetTitle: asset?.title,
            ownerId: contributorId,
            actorId: contributorId,
            status: 'failed'
          });
        }

        if (willRetry) {
          // Will be retried by BullMQ
          throw err;
        }
      } catch (dbErr) {
        console.error('Failed to update error status:', dbErr);
      }

      throw err;
    }
  }

  /**
   * Get job status
   */
  async getJobStatus(assetId) {
    try {
      const result = await pool.query(`
        SELECT * FROM asset_processing_jobs
        WHERE asset_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [assetId]);

      return result.rows[0] || null;
    } catch (err) {
      console.error('Failed to get job status:', err);
      return null;
    }
  }

  /**
   * Retry failed job
   */
  async retryJob(assetId) {
    try {
      const jobStatus = await this.getJobStatus(assetId);
      if (!jobStatus) {
        throw new Error('Job not found');
      }

      // Reset job for retry
      await pool.query(`
        UPDATE asset_processing_jobs
        SET status = $1, retry_count = 0
        WHERE id = $2
      `, ['QUEUED', jobStatus.id]);

      // Queue new job
      return await this.queueThumbnailJob(
        jobStatus.asset_id,
        jobStatus.contributor_id,
        jobStatus.file_type,
        jobStatus.file_type
      );
    } catch (err) {
      console.error('Failed to retry job:', err);
      throw err;
    }
  }

  /**
   * Get queue stats
   */
  async getQueueStats() {
    try {
      const counts = await this.queue.getJobCounts();
      return {
        queued: counts.waiting || 0,
        processing: counts.active || 0,
        completed: counts.completed || 0,
        failed: counts.failed || 0,
        delayed: counts.delayed || 0,
      };
    } catch (err) {
      console.error('Failed to get queue stats:', err);
      return {};
    }
  }

  /**
   * Shutdown queue and worker
   */
  async shutdown() {
    try {
      if (this.worker) {
        await this.worker.close();
        console.log('✓ Thumbnail worker shut down');
      }

      if (this.queue) {
        await this.queue.close();
        console.log('✓ Thumbnail queue shut down');
      }

      this.isRunning = false;
    } catch (err) {
      console.error('Error shutting down queue:', err);
    }
  }
}

module.exports = new ThumbnailQueueManager();
