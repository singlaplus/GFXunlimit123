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
const { exec } = require('child_process');
const { promisify } = require('util');
const pool = require('../db');

const execAsync = promisify(exec);

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

      // Read PSD file
      const fileBuffer = fs.readFileSync(filePath);

      let psd;
      try {
        // Parse PSD - wrap in try-catch to catch any async errors
        psd = await PSD.open(fileBuffer);
      } catch (parseErr) {
        // If PSD.open fails, throw with clear message
        throw new Error(`Failed to parse PSD file: ${parseErr.message}`);
      }

      // Get composite image (merged preview)
      const composite = psd.compositeData;

      if (!composite || !composite.data) {
        throw new Error('No composite/preview data found in PSD');
      }

      // Convert composite data to buffer
      // The composite data should already be in a format we can work with
      let previewBuffer = composite.data;

      // If it's raw pixel data, we need to create an image
      if (Buffer.isBuffer(previewBuffer)) {
        const sharp = require('sharp');
        
        // Create PNG from raw pixel data
        previewBuffer = await sharp({
          raw: {
            width: psd.width,
            height: psd.height,
            channels: 4, // RGBA
          },
        })
          .png()
          .toBuffer();
      }

      return previewBuffer;
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
    return new Promise(async (resolve, reject) => {
      try {
        // Use ImageMagick to convert PSD to PNG
        // [0] means first page (for multi-page PSD)
        console.log('[PsdProcessor] Converting PSD to PNG using ImageMagick...');
        
        const tempPngPath = path.join(path.dirname(filePath), `temp-${Date.now()}.png`);
        
        // Use convert command with specific settings for PSD
        const command = `convert "${filePath}"[0] -flatten -quality 90 "${tempPngPath}" 2>&1`;
        
        const { stdout, stderr } = await execAsync(command, { 
          timeout: 60000, // 60 second timeout
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        });

        if (stderr) {
          console.warn(`[PsdProcessor] ImageMagick warning: ${stderr}`);
        }

        // Read the converted PNG
        if (!fs.existsSync(tempPngPath)) {
          throw new Error('ImageMagick conversion failed to create output file');
        }

        const previewBuffer = fs.readFileSync(tempPngPath);
        
        // Clean up temp file
        try {
          fs.unlinkSync(tempPngPath);
        } catch (e) {
          console.warn(`[PsdProcessor] Could not delete temp file: ${e.message}`);
        }

        console.log(`[PsdProcessor] Successfully converted PSD using ImageMagick (${previewBuffer.length} bytes)`);
        resolve(previewBuffer);
      } catch (err) {
        console.error(`[PsdProcessor] ImageMagick extraction failed: ${err.message}`);
        reject(new Error(`ImageMagick PSD extraction failed: ${err.message}`));
      }
    });
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
