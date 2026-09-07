/**
 * Base Processor Class
 * Abstract class for all asset thumbnail processors
 */

const fs = require('fs');
const path = require('path');
const pool = require('../db');
const {
  getThumbnailStorageDirectory,
  buildGeneratedThumbnailPath,
} = require('../utils/assetThumbnail');

class BaseProcessor {
  constructor(options = {}) {
    this.name = 'BaseProcessor';
    this.supportedExtensions = [];
    this.processorConfig = options.processorConfig || {};
    this.maxRetries = options.maxRetries || 3;
  }

  /**
   * Validate if file is supported by this processor
   */
  isSupported(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedExtensions.includes(ext);
  }

  /**
   * Validate MIME type
   */
  validateMimeType(mimeType, supportedMimes) {
    return supportedMimes.includes(mimeType);
  }

  /**
   * Validate magic bytes (file signature)
   */
  async validateMagicBytes(filePath, expectedMagic) {
    try {
      const buffer = Buffer.alloc(expectedMagic.length);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, expectedMagic.length, 0);
      fs.closeSync(fd);
      
      return buffer.equals(expectedMagic);
    } catch (err) {
      throw new Error(`Magic byte validation failed: ${err.message}`);
    }
  }

  /**
   * Detect file format (override in subclasses)
   */
  async detect(filePath) {
    throw new Error('detect() must be implemented by subclass');
  }

  /**
   * Validate file structure (override in subclasses)
   */
  async validate(filePath) {
    throw new Error('validate() must be implemented by subclass');
  }

  /**
   * Extract preview/composite from file (override in subclasses)
   */
  async extractPreview(filePath) {
    throw new Error('extractPreview() must be implemented by subclass');
  }

  /**
   * Generate JPEG thumbnail from preview
   */
  async generateThumbnail(previewBuffer, options = {}) {
    try {
      const sharp = require('sharp');
      const quality = options.quality || 30;
      const maxWidth = options.maxWidth || 1200;
      const maxHeight = options.maxHeight || 1200;
      const autoTrim = options.autoTrim !== false; // Enabled by default

      let transformer = sharp(previewBuffer);

      // Auto-trim image to remove uniform borders (black bars, etc.)
      // Disabled for EPS/AI/PSD as black bars are often part of page rendering
      if (autoTrim && this.name !== 'EpsProcessor' && this.name !== 'AiProcessor') {
        console.log(`[${this.name}] Auto-trimming image to remove borders...`);
        try {
          transformer = transformer.trim({
            background: '#000000',
            threshold: 50,
          });
        } catch (trimErr) {
          console.warn(`[${this.name}] Trim failed, continuing without trim: ${trimErr.message}`);
        }
      }

      // Get metadata to maintain aspect ratio
      const metadata = await transformer.metadata();
      const width = metadata.width;
      const height = metadata.height;

      // Calculate new dimensions while maintaining aspect ratio
      let newWidth = width;
      let newHeight = height;

      if (width > maxWidth || height > maxHeight) {
        const widthRatio = maxWidth / width;
        const heightRatio = maxHeight / height;
        const ratio = Math.min(widthRatio, heightRatio);

        newWidth = Math.round(width * ratio);
        newHeight = Math.round(height * ratio);
      }

      // Generate JPEG with specified quality
      // Boost quality for EPS/AI files for better detail preservation
      const boostQuality = this.name === 'EpsProcessor' || this.name === 'AiProcessor' ? Math.min(quality + 20, 95) : quality;
      const jpeg = await transformer
        .resize(newWidth, newHeight, {
          withoutEnlargement: true,
          fit: 'inside',
        })
        .jpeg({ quality: boostQuality, progressive: true })
        .toBuffer();

      return {
        buffer: jpeg,
        width: newWidth,
        height: newHeight,
        quality,
        format: 'jpeg',
      };
    } catch (err) {
      throw new Error(`Thumbnail generation failed: ${err.message}`);
    }
  }

  /**
   * Save thumbnail to filesystem
   */
  async saveThumbnail(thumbnailBuffer, outputPath) {
    try {
      const outputDir = path.dirname(outputPath);
      
      // Ensure directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write thumbnail file
      fs.writeFileSync(outputPath, thumbnailBuffer);

      return {
        path: outputPath,
        size: thumbnailBuffer.length,
        savedAt: new Date(),
      };
    } catch (err) {
      throw new Error(`Failed to save thumbnail: ${err.message}`);
    }
  }

  /**
   * Get thumbnail URL from file path
   */
  getThumbnailUrl(thumbnailPath) {
    try {
      const path = require('path');
      // Extract relative path from uploads folder
      // thumbnailPath format: /full/path/backend/uploads/user/year/month/status/filename-thumb.jpg
      // We want: contri1/2026/08/Pending/filename-thumb.jpg (without /uploads/ prefix)
      
      const uploadsIndex = thumbnailPath.indexOf('/uploads/');
      if (uploadsIndex !== -1) {
        // Get path after /uploads/
        const afterUploads = thumbnailPath.substring(uploadsIndex + '/uploads/'.length);
        return `/api/thumbnail?file=${encodeURIComponent(afterUploads)}`;
      }
      
      // Fallback: use as-is
      const normalizedPath = thumbnailPath.replace(/\\/g, '/');
      return `/api/thumbnail?file=${encodeURIComponent(normalizedPath)}`;
    } catch (err) {
      return null;
    }
  }

  /**
   * Update database with thumbnail information
   */
  async updateDatabaseWithThumbnail(assetId, thumbnailPath, processingJobId) {
    try {
      const thumbnailUrl = this.getThumbnailUrl(thumbnailPath);

      await pool.query(`
        UPDATE images 
        SET 
          thumbnail_url = $1,
          thumbnail_status = $2,
          thumbnail_generated_at = NOW()
        WHERE id = $3
      `, [thumbnailUrl, 'COMPLETED', assetId]);

      // Also update the processing job
      if (processingJobId) {
        await pool.query(`
          UPDATE asset_processing_jobs
          SET status = $1, completed_at = NOW()
          WHERE id = $2
        `, ['COMPLETED', processingJobId]);
      }

      return { success: true, thumbnailUrl };
    } catch (err) {
      throw new Error(`Database update failed: ${err.message}`);
    }
  }

  /**
   * Record processing error
   */
  async recordError(jobId, assetId, errorType, errorMessage, stage, filePath = null) {
    try {
      await pool.query(`
        INSERT INTO processing_error_logs (job_id, asset_id, processor, error_type, error_message, stage, file_path)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [jobId, assetId, this.name, errorType, errorMessage, stage, filePath]);

      // Update job status to FAILED
      if (jobId) {
        await pool.query(`
          UPDATE asset_processing_jobs
          SET status = $1, error = $2, error_stage = $3, completed_at = NOW()
          WHERE id = $4
        `, ['FAILED', errorMessage, stage, jobId]);
      }

      // Update asset status
      if (assetId) {
        await pool.query(`
          UPDATE images
          SET thumbnail_status = $1, thumbnail_error = $2
          WHERE id = $3
        `, ['FAILED', errorMessage, assetId]);
      }
    } catch (err) {
      console.error('Error recording processing error:', err);
    }
  }

  /**
   * Get processor status
   */
  async getStatus() {
    try {
      const result = await pool.query(
        'SELECT * FROM processor_config WHERE processor_name = $1',
        [this.name.toLowerCase()]
      );
      return result.rows[0] || null;
    } catch (err) {
      console.error('Failed to get processor status:', err);
      return null;
    }
  }

  /**
   * Complete processing pipeline
   */
  async process(filePath, assetId, processingJobId, options = {}) {
    const startTime = Date.now();

    try {
      console.log(`\n[${this.name}] Processing started for asset ${assetId}`);
      console.log(`[${this.name}] File: ${filePath}`);

      // Step 1: Detect
      console.log(`[${this.name}] Step 1/5: Detecting file format...`);
      const detected = await this.detect(filePath);
      if (!detected) {
        throw new Error('File format detection failed');
      }

      // Step 2: Validate
      console.log(`[${this.name}] Step 2/5: Validating file...`);
      const validated = await this.validate(filePath);
      if (!validated) {
        throw new Error('File validation failed');
      }

      // Step 3: Extract preview
      console.log(`[${this.name}] Step 3/5: Extracting preview...`);
      const previewBuffer = await this.extractPreview(filePath);
      if (!previewBuffer) {
        throw new Error('Preview extraction failed');
      }

      // Step 4: Generate thumbnail
      console.log(`[${this.name}] Step 4/6: Generating JPEG thumbnail...`);
      const thumbnail = await this.generateThumbnail(previewBuffer, {
        quality: options.quality || 30,
        maxWidth: options.maxWidth || 1200,
        maxHeight: options.maxHeight || 1200,
      });

      // Step 5: Save thumbnail
      console.log(`[${this.name}] Step 5/5: Saving thumbnail...`);
      const outputPath = options.outputPath || this.generateOutputPath(filePath);
      const saved = await this.saveThumbnail(thumbnail.buffer, outputPath);

      // Update database
      await this.updateDatabaseWithThumbnail(assetId, outputPath, processingJobId);

      const processingTime = Date.now() - startTime;
      console.log(`[${this.name}] ✓ Processing completed in ${processingTime}ms`);

      return {
        success: true,
        assetId,
        thumbnailPath: outputPath,
        thumbnailSize: saved.size,
        processingTimeMs: processingTime,
        dimensions: {
          width: thumbnail.width,
          height: thumbnail.height,
        },
        quality: thumbnail.quality,
      };
    } catch (err) {
      const processingTime = Date.now() - startTime;
      console.error(`[${this.name}] ✗ Processing failed: ${err.message}`);
      
      await this.recordError(
        processingJobId,
        assetId,
        err.constructor.name,
        err.message,
        'processing',
        filePath
      );

      return {
        success: false,
        assetId,
        error: err.message,
        processingTimeMs: processingTime,
      };
    }
  }

  /**
   * Generate output path for thumbnail
   */
  generateOutputPath(originalFilePath) {
    return buildGeneratedThumbnailPath(originalFilePath, '.jpg');
  }
}

module.exports = BaseProcessor;
