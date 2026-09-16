/**
 * AI Processor
 * Processes Adobe Illustrator files
 * Detects PDF content and renders server-side
 * Falls back to Adobe Illustrator worker if needed
 */

const BaseProcessor = require('./base-processor');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const pool = require('../db');

class AiProcessor extends BaseProcessor {
  constructor(options = {}) {
    super(options);
    this.name = 'AiProcessor';
    this.supportedExtensions = ['.ai'];
    this.supportedMimes = ['application/x-illustrator', 'application/pdf', 'application/postscript'];
  }

  /**
   * Detect AI file format
   * AI files are primarily PDF-based with additional Illustrator data
   */
  async detect(filePath) {
    try {
      if (!this.isSupported(filePath)) {
        return false;
      }

      // Check magic bytes
      // Modern AI files start with PDF header or PostScript
      const buffer = Buffer.alloc(50);
      const fd = fs.openSync(filePath, 'r');
      const bytesRead = fs.readSync(fd, buffer, 0, 50, 0);
      fs.closeSync(fd);

      const header = buffer.toString('ascii', 0, Math.min(bytesRead, 50));
      
      // Check for PDF signature
      const isPdf = header.includes('%PDF');
      // Check for PostScript
      const isPs = header.includes('%!PS');
      // Check for AI-specific markers
      const isAi = header.includes('%%Creator: Adobe Illustrator') || 
                   header.includes('%%BoundingBox');

      return isPdf || isPs || isAi;
    } catch (err) {
      console.error(`AI detection error: ${err.message}`);
      return false;
    }
  }

  /**
   * Validate AI file
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

      if (stats.size > 500 * 1024 * 1024) {
        throw new Error('File exceeds maximum size (500MB)');
      }

      // AI format validation
      const detected = await this.detect(filePath);
      if (!detected) {
        throw new Error('Not a valid AI file');
      }

      return true;
    } catch (err) {
      console.error(`AI validation error: ${err.message}`);
      return false;
    }
  }

  /**
   * Check if AI file contains PDF-compatible content
   */
  async hasPdfContent(filePath) {
    try {
      const buffer = Buffer.alloc(200);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 200, 0);
      fs.closeSync(fd);

      const header = buffer.toString('ascii');
      return header.includes('%PDF');
    } catch (err) {
      return false;
    }
  }

  /**
   * Extract preview from AI file
   * First tries server-side rendering (PDF content)
   * Falls back to Adobe Illustrator worker if needed
   */
  async extractPreview(filePath) {
    try {
      // Ghostscript can render both PDF-compatible and PostScript Illustrator files.
      // Try it first so files without an embedded PDF preview do not require Illustrator.
      console.log('[AiProcessor] Attempting server-side rendering');
      try {
        return await this.extractPreviewServerSide(filePath);
      } catch (err) {
        console.warn(`[AiProcessor] Server-side rendering failed: ${err.message}`);
        console.log('[AiProcessor] Attempting Adobe Illustrator fallback');
        return await this.extractPreviewWithIllustrator(filePath);
      }
    } catch (err) {
      throw new Error(`AI preview extraction failed: ${err.message}`);
    }
  }

  /**
   * Server-side rendering for PDF content in AI files
   * Uses Ghostscript or ImageMagick
   */
  async extractPreviewServerSide(filePath) {
    return new Promise(async (resolve, reject) => {
      try {
        const gsConfig = await pool.query(
          'SELECT executable_path FROM processor_config WHERE processor_name = $1',
          ['ghostscript']
        );

        if (!gsConfig.rows[0] || !gsConfig.rows[0].executable_path) {
          // Try ImageMagick
          return this.extractPreviewWithImageMagick(filePath)
            .then(resolve)
            .catch(reject);
        }

        const gsPath = gsConfig.rows[0].executable_path;

        const tempDir = path.join(__dirname, '..', 'tmp', 'ai-processing');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempOutput = path.join(tempDir, `preview-${Date.now()}.png`);

        // Ghostscript command to render AI to PNG
        // Same high-quality settings as EPS: 200 DPI with BoundingBox-aware rendering
        const gsArgs = [
          '-dNOPAUSE',
          '-dBATCH',
          '-dSAFER',
          '-sDEVICE=pngalpha',
          '-r200',  // 200 DPI for 20% better quality
          '-dTextAlphaBits=4',
          '-dGraphicsAlphaBits=4',
          '-dEPSCrop',  // Respect BoundingBox
          '-dFitPage',  // Fit to page
          '-g1200x720',  // Output dimensions 16:9
          `-sOutputFile=${tempOutput}`,
          filePath,
        ];

        console.log('[AiProcessor] Rendering AI with Ghostscript');

        const gs = spawn(gsPath, gsArgs, {
          windowsHide: true,
          timeout: 120000, // 120 second timeout
        });

        let errorOutput = '';

        gs.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        gs.on('close', (code) => {
          if (code === 0 && fs.existsSync(tempOutput)) {
            try {
              const previewBuffer = fs.readFileSync(tempOutput);
              fs.unlink(tempOutput, (err) => {
                if (err) console.warn(`Failed to clean temp file: ${err.message}`);
              });
              resolve(previewBuffer);
            } catch (err) {
              reject(new Error(`Failed to read rendered output: ${err.message}`));
            }
          } else {
            reject(new Error(`Ghostscript failed: ${errorOutput || code}`));
          }
        });

        gs.on('error', (err) => {
          reject(new Error(`Failed to spawn Ghostscript: ${err.message}`));
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Fallback: Render using ImageMagick
   */
  async extractPreviewWithImageMagick(filePath) {
    return new Promise(async (resolve, reject) => {
      try {
        const imConfig = await pool.query(
          'SELECT executable_path FROM processor_config WHERE processor_name = $1',
          ['imagemagick']
        );

        if (!imConfig.rows[0] || !imConfig.rows[0].executable_path) {
          return reject(new Error('ImageMagick not available'));
        }

        const imPath = imConfig.rows[0].executable_path;

        const tempDir = path.join(__dirname, '..', 'tmp', 'ai-processing');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempOutput = path.join(tempDir, `preview-${Date.now()}.png`);

        const imArgs = [
          `${filePath}[0]`,
          `-background`, 'white',
          `-density`, '150',
          `-quality`, '90',
          tempOutput,
        ];

        console.log('[AiProcessor] Rendering AI with ImageMagick (fallback)');

        const im = spawn(imPath, imArgs, {
          windowsHide: true,
          timeout: 120000,
        });

        let errorOutput = '';

        im.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        im.on('close', (code) => {
          if (code === 0 && fs.existsSync(tempOutput)) {
            try {
              const previewBuffer = fs.readFileSync(tempOutput);
              fs.unlink(tempOutput, (err) => {
                if (err) console.warn(`Failed to clean temp file: ${err.message}`);
              });
              resolve(previewBuffer);
            } catch (err) {
              reject(new Error(`Failed to read rendered output: ${err.message}`));
            }
          } else {
            reject(new Error(`ImageMagick failed: ${errorOutput}`));
          }
        });

        im.on('error', (err) => {
          reject(new Error(`Failed to spawn ImageMagick: ${err.message}`));
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Optional fallback: Use Adobe Illustrator
   * This requires Adobe Illustrator to be installed and running
   * Uses scripting interface, not GUI automation
   */
  async extractPreviewWithIllustrator(filePath) {
    return new Promise(async (resolve, reject) => {
      try {
        // Check if Illustrator is configured
        const aiConfig = await pool.query(
          'SELECT * FROM processor_config WHERE processor_name = $1',
          ['illustrator_worker']
        );

        if (!aiConfig.rows[0] || aiConfig.rows[0].status !== 'AVAILABLE' || !aiConfig.rows[0].is_enabled) {
          return reject(new Error('Adobe Illustrator worker not available'));
        }

        // Queue job for Adobe worker
        console.log('[AiProcessor] Queuing Adobe Illustrator worker');
        // This would be handled by a separate Adobe worker process
        // For now, reject to force fallback
        return reject(new Error('Adobe Illustrator worker not implemented'));
      } catch (err) {
        reject(err);
      }
    });
  }
}

module.exports = AiProcessor;
