/**
 * EPS Processor
 * Processes Adobe EPS files using Ghostscript
 * Falls back to ImageMagick if Ghostscript unavailable
 */

const BaseProcessor = require('./base-processor');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const pool = require('../db');
const { resolveGhostscriptExecutable } = require('./ghostscript-path');

class EpsProcessor extends BaseProcessor {
  constructor(options = {}) {
    super(options);
    this.name = 'EpsProcessor';
    this.supportedExtensions = ['.eps'];
    this.supportedMimes = ['application/postscript', 'application/eps', 'image/eps'];
    this.spawnProcess = options.spawnProcess || spawn;
    this.spawnImageMagick = options.spawnImageMagick || spawn;
  }

  /**
   * Detect EPS file format
   */
  async detect(filePath) {
    try {
      if (!this.isSupported(filePath)) {
        return false;
      }

      const buffer = Buffer.alloc(32);
      const fd = fs.openSync(filePath, 'r');
      let bytesRead;
      let fileSize;
      try {
        bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
        fileSize = fs.fstatSync(fd).size;
        if (bytesRead >= 30 && buffer.subarray(0, 4).equals(Buffer.from([0xc5, 0xd0, 0xd3, 0xc6]))) {
          const postScriptOffset = buffer.readUInt32LE(4);
          const postScriptLength = buffer.readUInt32LE(8);
          if (
            postScriptOffset < 30 ||
            postScriptLength === 0 ||
            postScriptOffset + postScriptLength > fileSize
          ) {
            return false;
          }
          const postScriptHeader = Buffer.alloc(4);
          return fs.readSync(fd, postScriptHeader, 0, postScriptHeader.length, postScriptOffset) === 4 &&
            postScriptHeader.toString('ascii') === '%!PS';
        }
      } finally {
        fs.closeSync(fd);
      }

      return buffer.toString('ascii', 0, bytesRead).includes('%!PS');
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
   * Extract preview from EPS, falling back to ImageMagick if Ghostscript fails.
   */
  async extractPreview(filePath) {
    try {
      return await this.extractPreviewWithGhostscript(filePath);
    } catch (ghostscriptError) {
      try {
        return await this.extractPreviewWithImageMagick(filePath);
      } catch (imageMagickError) {
        throw new Error(
          `EPS preview unavailable (Ghostscript: ${ghostscriptError.message}; ImageMagick: ${imageMagickError.message})`,
          { cause: ghostscriptError }
        );
      }
    }
  }

  async extractPreviewWithGhostscript(filePath) {
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

        const gsPath = resolveGhostscriptExecutable({
          configuredPath: gsConfig?.rows[0]?.executable_path,
        });

        // Create temporary output file for PNG
        const tempDir = path.join(__dirname, '..', 'tmp', 'eps-processing');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempOutput = path.join(tempDir, `preview-${crypto.randomUUID()}.png`);

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
        gs.stderr.on('data', (data) => {
          errorOutput += data.toString();
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

        const imPath = process.env.IMAGEMAGICK_PATH
          || imConfig?.rows[0]?.executable_path
          || (process.platform === 'win32' ? 'magick' : 'convert');

        const tempDir = path.join(__dirname, '..', 'tmp', 'eps-processing');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempOutput = path.join(tempDir, `preview-${crypto.randomUUID()}.png`);

        const imArgs = [
          `${filePath}[0]`, // Take first page/layer
          `-background`, 'white',
          `-density`, '300x300',  // Higher DPI for better quality
          `-quality`, '95',
          `-sharpen`, '0x1',  // Slight sharpening for vector content
          tempOutput,
        ];

        console.log(`[EpsProcessor] Rendering EPS with ImageMagick (fallback)`);

        const im = this.spawnImageMagick(imPath, imArgs, {
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
