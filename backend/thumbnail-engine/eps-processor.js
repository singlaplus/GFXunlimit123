/**
 * EPS Processor
 * Processes Adobe EPS files using Ghostscript
 * Falls back to ImageMagick if Ghostscript unavailable
 */

const BaseProcessor = require('./base-processor');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const pool = require('../db');

class EpsProcessor extends BaseProcessor {
  constructor(options = {}) {
    super(options);
    this.name = 'EpsProcessor';
    this.supportedExtensions = ['.eps'];
    this.supportedMimes = ['application/postscript', 'application/eps', 'image/eps'];
    this.spawnProcess = options.spawnProcess || spawn;
  }

  /**
   * Detect EPS file format
   */
  async detect(filePath) {
    try {
      if (!this.isSupported(filePath)) {
        return false;
      }

      // Check magic bytes for EPS
      // EPS files start with %!PS-Adobe or %!PS
      const buffer = Buffer.alloc(20);
      const fd = fs.openSync(filePath, 'r');
      const bytesRead = fs.readSync(fd, buffer, 0, 20, 0);
      fs.closeSync(fd);

      const header = buffer.toString('ascii', 0, bytesRead);
      const isEps = header.includes('%!PS');

      return isEps;
    } catch (err) {
      console.error(`EPS detection error: ${err.message}`);
      return false;
    }
  }

  /**
   * Validate EPS file
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

      // EPS format validation
      const detected = await this.detect(filePath);
      if (!detected) {
        throw new Error('Not a valid EPS file');
      }

      return true;
    } catch (err) {
      console.error(`EPS validation error: ${err.message}`);
      return false;
    }
  }

  /**
   * Extract preview from EPS using Ghostscript
   */
  async extractPreview(filePath) {
    return new Promise(async (resolve, reject) => {
      try {
        // Get Ghostscript path from config
        let gsConfig;
        try {
          gsConfig = await pool.query(
            'SELECT executable_path FROM processor_config WHERE processor_name = $1',
            ['ghostscript']
          );
        } catch (err) {
          console.warn(`[EpsProcessor] Processor config unavailable, using Ghostscript from PATH: ${err.message}`);
        }

        const gsPath = gsConfig?.rows[0]?.executable_path || 'gs';

        // Create temporary output file for PNG
        const tempDir = path.join(__dirname, '..', 'tmp', 'eps-processing');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempOutput = path.join(tempDir, `preview-${Date.now()}.png`);

        // Let Ghostscript size the raster from the EPS BoundingBox so portrait
        // and landscape artwork keep their original aspect ratio.
        const gsArgs = [
          '-dNOPAUSE',
          '-dBATCH',
          '-dSAFER',
          '-sDEVICE=pngalpha',
          '-r72',
          '-dTextAlphaBits=4',
          '-dGraphicsAlphaBits=4',
          '-dEPSCrop',
          `-sOutputFile=${tempOutput}`,
          filePath,
        ];

        console.log(`[EpsProcessor] Rendering EPS with Ghostscript: ${gsPath}`);

        const gs = this.spawnProcess(gsPath, gsArgs, {
          windowsHide: true,
          timeout: 60000, // 60 second timeout
        });

        let errorOutput = '';
        let outputData = '';

        gs.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });

        gs.stdout.on('data', (data) => {
          outputData += data.toString();
        });

        gs.on('close', (code, signal) => {
          if (code === 0 && fs.existsSync(tempOutput)) {
            try {
              const previewBuffer = fs.readFileSync(tempOutput);
              // Clean up temp file
              fs.unlink(tempOutput, (err) => {
                if (err) console.warn(`Failed to clean temp file: ${err.message}`);
              });
              resolve(previewBuffer);
            } catch (err) {
              reject(new Error(`Failed to read rendered output: ${err.message}`));
            }
          } else {
            const termination = signal ? ` (terminated by ${signal})` : '';
            const diagnostics = errorOutput.trim();
            reject(new Error(
              `Ghostscript failed with code ${code}${termination}${diagnostics ? `: ${diagnostics}` : ''}`
            ));
            fs.promises.unlink(tempOutput).catch((err) => {
              if (err.code !== 'ENOENT') {
                console.warn(`Failed to clean Ghostscript output ${tempOutput}: ${err.message}`);
              }
            });
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
   * Fallback: Extract preview using ImageMagick
   */
  async extractPreviewWithImageMagick(filePath) {
    return new Promise(async (resolve, reject) => {
      try {
        let imConfig;
        try {
          imConfig = await pool.query(
            'SELECT executable_path FROM processor_config WHERE processor_name = $1',
            ['imagemagick']
          );
        } catch (err) {
          console.warn(`[EpsProcessor] Processor config unavailable, using ImageMagick from PATH: ${err.message}`);
        }

        const imPath = imConfig?.rows[0]?.executable_path || 'magick';

        const tempDir = path.join(__dirname, '..', 'tmp', 'eps-processing');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempOutput = path.join(tempDir, `preview-${Date.now()}.png`);

        const imArgs = [
          `${filePath}[0]`, // Take first page/layer
          `-background`, 'white',
          `-density`, '300x300',  // Higher DPI for better quality
          `-quality`, '95',
          `-sharpen`, '0x1',  // Slight sharpening for vector content
          tempOutput,
        ];

        console.log(`[EpsProcessor] Rendering EPS with ImageMagick (fallback)`);

        const im = spawn(imPath, imArgs, {
          windowsHide: true,
          timeout: 60000,
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
}

module.exports = EpsProcessor;
