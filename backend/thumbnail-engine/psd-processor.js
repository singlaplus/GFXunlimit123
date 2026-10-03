/**
 * PSD Processor
 * Processes Adobe Photoshop PSD/PSB files
 * Extracts composite/preview layer using multiple methods:
 * 1. psd.js library (for files with embedded previews)
 * 2. ImageMagick/convert (for all PSD files)
 */

const BaseProcessor = require('./base-processor');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const pool = require('../db');

const execFileAsync = promisify(execFile);

class PsdProcessor extends BaseProcessor {
  constructor(options = {}) {
    super(options);
    this.name = 'PsdProcessor';
    this.supportedExtensions = ['.psd', '.psb'];
    this.supportedMimes = ['image/vnd.adobe.photoshop', 'image/x-photoshop'];
  }

  /**
   * Detect PSD file format
   */
  async detect(filePath) {
    try {
      if (!this.isSupported(filePath)) {
        return false;
      }

      // Check PSD magic bytes
      // PSD files start with 8BPS (0x3842504B)
      const buffer = Buffer.alloc(4);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 4, 0);
      fs.closeSync(fd);

      const magic = buffer.toString('ascii', 0, 4);
      return magic === '8BPS';
    } catch (err) {
      console.error(`PSD detection error: ${err.message}`);
      return false;
    }
  }

  /**
   * Validate PSD file
   */
  async validate(filePath) {
    try {
      // Check file exists and is readable
      if (!fs.existsSync(filePath)) {
        throw new Error('File does not exist');
      }

      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        throw new Error('File is empty');
      }

      if (stats.size > 2 * 1024 * 1024 * 1024) {
        throw new Error('File exceeds maximum size (2GB)');
      }

      // PSD format validation
      const detected = await this.detect(filePath);
      if (!detected) {
        throw new Error('Not a valid PSD/PSB file');
      }

      return true;
    } catch (err) {
      console.error(`PSD validation error: ${err.message}`);
      return false;
    }
  }

  /**
   * Extract preview from PSD file
   * Uses multiple methods:
   * 1. psd.js library for files with embedded previews
   * 2. ImageMagick/convert command for all PSD files
   */
  async extractPreview(filePath) {
    try {
      console.log('[PsdProcessor] Attempting server-side PSD processing with psd.js');
      return await this.extractPreviewServerSide(filePath);
    } catch (err) {
      console.warn(`[PsdProcessor] psd.js extraction failed: ${err.message}`);
      console.log('[PsdProcessor] Falling back to ImageMagick conversion');
      return await this.extractPreviewWithImageMagick(filePath);
    }
  }

  /**
   * Server-side PSD processing using psd.js library
   */
  async extractPreviewServerSide(filePath) {
    try {
      // Try to load psd.js
      let PSD;
      try {
        PSD = require('psd.js');
      } catch (err) {
        // Try alternative library
        try {
          const PsdParser = require('psd-parser');
          return await this.extractPreviewWithPsdParser(filePath);
        } catch (err2) {
          throw new Error('No PSD processing library available');
        }
      }

      let psd;
      try {
        psd = await PSD.open(filePath);
      } catch (parseErr) {
        throw new Error(`Failed to parse PSD file: ${parseErr.message}`);
      }

      if (!psd?.image || typeof psd.image.toPng !== 'function') {
        throw new Error('No composite/preview data found in PSD');
      }

      const pngStream = psd.image.toPng().pack();
      const chunks = [];
      await new Promise((resolve, reject) => {
        pngStream.on('data', (chunk) => chunks.push(chunk));
        pngStream.on('end', resolve);
        pngStream.on('error', reject);
      });

      return Buffer.concat(chunks);
    } catch (err) {
      throw new Error(`Server-side PSD extraction failed: ${err.message}`);
    }
  }

  /**
   * Alternative server-side processing with psd-parser
   */
  async extractPreviewWithPsdParser(filePath) {
    try {
      const PsdParser = require('psd-parser');
      const psdParser = new PsdParser(fs.readFileSync(filePath));
      const psd = psdParser.parse();

      if (!psd || !psd.compositeData) {
        throw new Error('Unable to extract composite data from PSD');
      }

      const sharp = require('sharp');
      
      // Create PNG from composite data
      const previewBuffer = await sharp({
        raw: {
          width: psd.width || 1200,
          height: psd.height || 1200,
          channels: 4,
        },
      })
        .png()
        .toBuffer();

      return previewBuffer;
    } catch (err) {
      throw new Error(`psd-parser extraction failed: ${err.message}`);
    }
  }

  /**
   * Extract preview from PSD using ImageMagick
   * Converts PSD to PNG using ImageMagick's convert command
   * This method works for all PSD files regardless of embedded preview
   */
  async extractPreviewWithImageMagick(filePath) {
    let imageMagickPath = process.env.IMAGEMAGICK_PATH;
    if (!imageMagickPath) {
      try {
        const config = await pool.query(
          'SELECT executable_path FROM processor_config WHERE processor_name = $1',
          ['imagemagick']
        );
        imageMagickPath = config.rows[0]?.executable_path;
      } catch (error) {
        console.warn(`[PsdProcessor] Processor config unavailable: ${error.message}`);
      }
    }
    imageMagickPath ||= process.platform === 'win32' ? 'magick' : 'convert';

    const tempPngPath = path.join(path.dirname(filePath), `thumbnail-${crypto.randomUUID()}.png`);
    try {
      const { stderr } = await execFileAsync(
        imageMagickPath,
        [`${filePath}[0]`, '-flatten', '-quality', '90', tempPngPath],
        { timeout: 60000, maxBuffer: 10 * 1024 * 1024, windowsHide: true }
      );
      if (stderr) console.warn(`[PsdProcessor] ImageMagick warning: ${stderr}`);
      const previewBuffer = await fs.promises.readFile(tempPngPath);
      console.log(`[PsdProcessor] Successfully converted PSD using ImageMagick (${previewBuffer.length} bytes)`);
      return previewBuffer;
    } catch (error) {
      console.error(`[PsdProcessor] ImageMagick extraction failed: ${error.message}`);
      throw new Error(`ImageMagick PSD extraction failed: ${error.message}`);
    } finally {
      await fs.promises.unlink(tempPngPath).catch((error) => {
        if (error.code !== 'ENOENT') console.warn(`[PsdProcessor] Could not delete temp file: ${error.message}`);
      });
    }
  }

  /**
   * Extract dimensions from PSD without fully parsing
   */
  async getPsdDimensions(filePath) {
    try {
      const buffer = Buffer.alloc(26);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 26, 0);
      fs.closeSync(fd);

      // Read dimensions from PSD header
      // Offset 14: 2 bytes for height, 18: 2 bytes for width
      const height = buffer.readUInt32BE(14);
      const width = buffer.readUInt32BE(18);

      return { width, height };
    } catch (err) {
      return { width: 1200, height: 1200 };
    }
  }
}

module.exports = PsdProcessor;
