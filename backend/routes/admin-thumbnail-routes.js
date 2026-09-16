/**
 * Admin Thumbnail Routes
 * API endpoints for admin panel to configure and test thumbnail processors
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const ProcessorDetector = require('../thumbnail-engine/processor-detector');
const processorFactory = require('../thumbnail-engine/processor-factory');
const thumbnailQueue = require('../thumbnail-queue-worker');

const router = express.Router();

/**
 * Middleware to verify admin
 */
const verifyAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, 'secretkey');

    const user = await pool.query('SELECT role FROM users WHERE id = $1', [decoded.user]);
    if (!user.rows[0] || user.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

/**
 * GET /admin/thumbnail/status
 * Get current processor status and configuration
 */
router.get('/admin/thumbnail/status', verifyAdmin, async (req, res) => {
  try {
    const processors = await pool.query(`
      SELECT * FROM processor_config ORDER BY processor_name
    `);

    const queueStats = await thumbnailQueue.getQueueStats();

    res.json({
      processors: processors.rows,
      queue: queueStats,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('Failed to get thumbnail status:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/thumbnail/detect
 * Run processor detection and update configuration
 */
router.post('/admin/thumbnail/detect', verifyAdmin, async (req, res) => {
  try {
    console.log('[Admin] Starting processor detection...');

    const detector = new ProcessorDetector();
    const results = await detector.runAllDetections();

    // Save results to database
    await detector.saveDetectionResults(results);

    // Get updated config
    const config = await detector.getProcessorConfig();

    res.json({
      success: true,
      detections: results,
      config: config,
      message: 'Processor detection completed',
    });
  } catch (err) {
    console.error('Detection failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/thumbnail/configure
 * Manually configure processor path
 */
router.post('/admin/thumbnail/configure', verifyAdmin, async (req, res) => {
  try {
    const { processorName, executablePath } = req.body;

    if (!processorName || !executablePath) {
      return res.status(400).json({ error: 'processorName and executablePath required' });
    }

    // Verify path exists
    if (!fs.existsSync(executablePath)) {
      return res.status(400).json({ error: 'Executable path does not exist' });
    }

    // Update configuration
    await pool.query(`
      UPDATE processor_config
      SET executable_path = $1, updated_at = NOW()
      WHERE processor_name = $2
    `, [executablePath, processorName]);

    res.json({
      success: true,
      processorName,
      executablePath,
      message: 'Processor configured successfully',
    });
  } catch (err) {
    console.error('Configuration failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/thumbnail/test-processor
 * Test a specific processor
 */
router.post('/admin/thumbnail/test-processor', verifyAdmin, async (req, res) => {
  try {
    const { processorName } = req.body;

    if (!processorName) {
      return res.status(400).json({ error: 'processorName required' });
    }

    const detector = new ProcessorDetector();
    let testResult;

    switch (processorName) {
      case 'ghostscript':
        testResult = await detector.detectGhostscript();
        break;
      case 'imagemagick':
        testResult = await detector.detectImageMagick();
        break;
      case 'sharp':
        testResult = await detector.detectSharp();
        break;
      case 'psd_processor':
        testResult = await detector.detectPsdProcessor();
        break;
      case 'illustrator_worker':
        testResult = await detector.detectIllustrator();
        break;
      case 'photoshop_worker':
        testResult = await detector.detectPhotoshop();
        break;
      default:
        return res.status(400).json({ error: 'Unknown processor' });
    }

    // Update test results in database
    await pool.query(`
      UPDATE processor_config
      SET 
        status = $1,
        version = $2,
        last_tested_at = NOW(),
        test_result = $3
      WHERE processor_name = $4
    `, [
      testResult.status,
      testResult.version || null,
      JSON.stringify(testResult),
      processorName,
    ]);

    res.json({
      success: true,
      processor: processorName,
      testResult,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('Processor test failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/thumbnail/test-full-processing
 * Test complete thumbnail processing pipeline
 */
router.post('/admin/thumbnail/test-full-processing', verifyAdmin, async (req, res) => {
  try {
    const { fileType } = req.body; // 'ai', 'eps', or 'psd'

    if (!fileType || !['ai', 'eps', 'psd'].includes(fileType)) {
      return res.status(400).json({ error: 'Invalid fileType. Must be: ai, eps, or psd' });
    }

    // Look for test file in test directory
    const testDir = path.join(__dirname, 'test', 'sample-files');
    const testFilePattern = `*.${fileType}`;

    // Try to find a test file
    let testFilePath = null;
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      const testFile = files.find((f) => f.endsWith(`.${fileType}`));
      if (testFile) {
        testFilePath = path.join(testDir, testFile);
      }
    }

    if (!testFilePath || !fs.existsSync(testFilePath)) {
      return res.status(400).json({
        error: `No test ${fileType} file found. Place a sample ${fileType} file in backend/test/sample-files/`,
      });
    }

    console.log(`[Admin Test] Testing ${fileType} processing with file: ${testFilePath}`);

    // Create temporary asset record for testing
    const assetResult = await pool.query(`
      INSERT INTO images 
      (title, filename, category, type, uploaded_by, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [
      `Test ${fileType.toUpperCase()} Asset`,
      testFilePath,
      'Testing',
      fileType,
      1, // Admin user
      'testing',
    ]);

    const testAssetId = assetResult.rows[0].id;

    // Process thumbnail
    const result = await processorFactory.process(testFilePath, testAssetId, null, {
      quality: 30,
      maxWidth: 1200,
      maxHeight: 1200,
    });

    // Clean up test asset
    await pool.query('DELETE FROM images WHERE id = $1', [testAssetId]);

    res.json({
      success: result.success,
      fileType,
      testFile: path.basename(testFilePath),
      result,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('Processing test failed:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      stage: err.stage || 'unknown',
    });
  }
});

/**
 * GET /admin/thumbnail/processing-jobs
 * Get list of processing jobs
 */
router.get('/admin/thumbnail/processing-jobs', verifyAdmin, async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM asset_processing_jobs';
    const params = [];

    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM asset_processing_jobs' + (status ? ' WHERE status = $1' : ''),
      status ? [status] : []
    );

    res.json({
      jobs: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    console.error('Failed to get processing jobs:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/thumbnail/job/:jobId
 * Get details of a specific processing job
 */
router.get('/admin/thumbnail/job/:jobId', verifyAdmin, async (req, res) => {
  try {
    const { jobId } = req.params;

    const jobResult = await pool.query(
      'SELECT * FROM asset_processing_jobs WHERE id = $1',
      [jobId]
    );

    if (!jobResult.rows[0]) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const errorsResult = await pool.query(
      'SELECT * FROM processing_error_logs WHERE job_id = $1 ORDER BY created_at DESC',
      [jobId]
    );

    res.json({
      job: jobResult.rows[0],
      errors: errorsResult.rows,
    });
  } catch (err) {
    console.error('Failed to get job details:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /admin/thumbnail/retry-job/:jobId
 * Retry a failed processing job
 */
router.post('/admin/thumbnail/retry-job/:jobId', verifyAdmin, async (req, res) => {
  try {
    const { jobId } = req.params;

    // Get job info
    const jobResult = await pool.query(
      'SELECT * FROM asset_processing_jobs WHERE id = $1',
      [jobId]
    );

    if (!jobResult.rows[0]) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = jobResult.rows[0];

    // Queue new job
    await thumbnailQueue.queueThumbnailJob(
      job.asset_id,
      job.contributor_id,
      job.file_type,
      job.file_type
    );

    res.json({
      success: true,
      message: 'Job queued for retry',
      assetId: job.asset_id,
    });
  } catch (err) {
    console.error('Failed to retry job:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/thumbnail/error-logs
 * Get processing error logs
 */
router.get('/admin/thumbnail/error-logs', verifyAdmin, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const result = await pool.query(`
      SELECT * FROM processing_error_logs
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const countResult = await pool.query('SELECT COUNT(*) as total FROM processing_error_logs');

    res.json({
      errors: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    console.error('Failed to get error logs:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /admin/thumbnail/queue-stats
 * Get current queue statistics
 */
router.get('/admin/thumbnail/queue-stats', verifyAdmin, async (req, res) => {
  try {
    const stats = await thumbnailQueue.getQueueStats();

    res.json({
      queueStats: stats,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('Failed to get queue stats:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
