/**
 * Processor Detector System
 * Automatically detects and validates thumbnail processing dependencies
 * Runs on Windows with Ghostscript, ImageMagick, Sharp, and optional Adobe tools
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const pool = require('../db');

// Windows-specific paths for common tool installations
const WINDOWS_TOOL_PATHS = {
  ghostscript: [
    'C:\\Program Files\\gs\\gs10.01.2\\bin\\gswin64c.exe',
    'C:\\Program Files\\gs\\gs10.00.0\\bin\\gswin64c.exe',
    'C:\\Program Files (x86)\\gs\\gs10.01.2\\bin\\gswin64c.exe',
    'C:\\Program Files (x86)\\gs\\gs10.00.0\\bin\\gswin64c.exe',
  ],
  imagemagick: [
    'C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe',
    'C:\\Program Files\\ImageMagick-7.1.0-Q16-HDRI\\magick.exe',
    'C:\\Program Files (x86)\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe',
    'C:\\Program Files (x86)\\ImageMagick-7.1.0-Q16-HDRI\\magick.exe',
  ],
  illustrator: [
    'C:\\Program Files\\Adobe\\Adobe Illustrator 2024\\Support Files\\Contents\\Windows\\Illustrator.exe',
    'C:\\Program Files\\Adobe\\Adobe Illustrator 2023\\Support Files\\Contents\\Windows\\Illustrator.exe',
  ],
  photoshop: [
    'C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe',
    'C:\\Program Files\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe',
  ],
};

class ProcessorDetector {
  constructor() {
    this.detectionResults = {};
    this.isWindows = process.platform === 'win32';
  }

  /**
   * Detect Ghostscript installation
   */
  async detectGhostscript() {
    try {
      // For Unix-like systems (macOS, Linux)
      if (!this.isWindows) {
        try {
          const whichResult = execSync('which gs', { encoding: 'utf8' }).trim();
          if (whichResult) {
            const version = execSync('gs --version', { encoding: 'utf8' }).trim();
            return {
              status: 'READY',
              executablePath: whichResult,
              version: version.split('\n')[0] || 'unknown',
              message: `Found at ${whichResult}`,
            };
          }
        } catch (err) {
          // Continue - not found
        }
        
        return {
          status: 'NOT_AVAILABLE',
          message: 'Ghostscript not found. Install with: brew install ghostscript',
        };
      }

      // For Windows systems
      try {
        const version = execSync('gswin64c -version', { encoding: 'utf8', windowsHide: true });
        return {
          status: 'READY',
          executablePath: 'gswin64c',
          version: version.split('\n')[0],
          message: 'Found in PATH',
        };
      } catch (err) {
        // Not in PATH, try common installation paths
      }

      // Try common installation paths
      for (const pathCandidate of WINDOWS_TOOL_PATHS.ghostscript) {
        if (fs.existsSync(pathCandidate)) {
          try {
            const version = execSync(`"${pathCandidate}" -version`, { encoding: 'utf8', windowsHide: true });
            return {
              status: 'READY',
              executablePath: pathCandidate,
              version: version.split('\n')[0],
              message: `Found at ${pathCandidate}`,
            };
          } catch (err) {
            // Continue to next path
          }
        }
      }

      return {
        status: 'NOT_AVAILABLE',
        message: 'Ghostscript not found. Required for EPS processing.',
      };
    } catch (err) {
      return {
        status: 'ERROR',
        message: `Failed to detect Ghostscript: ${err.message}`,
      };
    }
  }

  /**
   * Detect ImageMagick installation
   */
  async detectImageMagick() {
    try {
      // For Unix-like systems (macOS, Linux)
      if (!this.isWindows) {
        try {
          const whichResult = execSync('which magick', { encoding: 'utf8' }).trim();
          if (whichResult) {
            const version = execSync('magick --version', { encoding: 'utf8' }).trim();
            return {
              status: 'READY',
              executablePath: whichResult,
              version: version.split('\n')[0] || 'unknown',
              message: `Found at ${whichResult}`,
            };
          }
        } catch (err) {
          // Continue - not found
        }
        
        return {
          status: 'NOT_AVAILABLE',
          message: 'ImageMagick not found. Install with: brew install imagemagick',
        };
      }

      // For Windows systems
      try {
        const version = execSync('magick -version', { encoding: 'utf8', windowsHide: true });
        return {
          status: 'READY',
          executablePath: 'magick',
          version: version.split('\n')[0],
          message: 'Found in PATH',
        };
      } catch (err) {
        // Not in PATH, try common installation paths
      }

      // Try common installation paths
      for (const pathCandidate of WINDOWS_TOOL_PATHS.imagemagick) {
        if (fs.existsSync(pathCandidate)) {
          try {
            const version = execSync(`"${pathCandidate}" -version`, { encoding: 'utf8', windowsHide: true });
            return {
              status: 'READY',
              executablePath: pathCandidate,
              version: version.split('\n')[0],
              message: `Found at ${pathCandidate}`,
            };
          } catch (err) {
            // Continue to next path
          }
        }
      }

      return {
        status: 'NOT_AVAILABLE',
        message: 'ImageMagick not found. Optional fallback for image processing.',
      };
    } catch (err) {
      return {
        status: 'ERROR',
        message: `Failed to detect ImageMagick: ${err.message}`,
      };
    }
  }

  /**
   * Check Sharp (Node.js library)
   */
  async detectSharp() {
    try {
      const sharp = require('sharp');
      const metadata = await sharp.cache(false).metadata();
      return {
        status: 'READY',
        version: require('sharp/package.json').version,
        message: 'Sharp is installed and working',
      };
    } catch (err) {
      return {
        status: 'NOT_AVAILABLE',
        message: `Sharp error: ${err.message}`,
      };
    }
  }

  /**
   * Detect PSD processor library
   */
  async detectPsdProcessor() {
    try {
      // Try to load psd.js (lightweight PSD parser)
      try {
        require('psd.js');
        return {
          status: 'READY',
          version: require('psd.js/package.json').version || 'unknown',
          message: 'psd.js library is installed',
        };
      } catch (err) {
        // If psd.js not available, check for psd-parser
        try {
          require('psd-parser');
          return {
            status: 'READY',
            version: 'unknown',
            message: 'psd-parser library is installed',
          };
        } catch (err2) {
          return {
            status: 'NOT_AVAILABLE',
            message: 'No PSD processing library found. Install psd.js or psd-parser',
          };
        }
      }
    } catch (err) {
      return {
        status: 'ERROR',
        message: `Failed to detect PSD processor: ${err.message}`,
      };
    }
  }

  /**
   * Detect Adobe Illustrator (optional)
   */
  async detectIllustrator() {
    if (!this.isWindows) {
      return {
        status: 'NOT_AVAILABLE',
        message: 'Illustrator detection only for Windows',
      };
    }

    try {
      for (const pathCandidate of WINDOWS_TOOL_PATHS.illustrator) {
        if (fs.existsSync(pathCandidate)) {
          return {
            status: 'AVAILABLE',
            executablePath: pathCandidate,
            message: `Found at ${pathCandidate}`,
          };
        }
      }

      return {
        status: 'NOT_AVAILABLE',
        message: 'Adobe Illustrator not found. Optional fallback for AI file processing.',
      };
    } catch (err) {
      return {
        status: 'ERROR',
        message: `Failed to detect Illustrator: ${err.message}`,
      };
    }
  }

  /**
   * Detect Adobe Photoshop (optional)
   */
  async detectPhotoshop() {
    if (!this.isWindows) {
      return {
        status: 'NOT_AVAILABLE',
        message: 'Photoshop detection only for Windows',
      };
    }

    try {
      for (const pathCandidate of WINDOWS_TOOL_PATHS.photoshop) {
        if (fs.existsSync(pathCandidate)) {
          return {
            status: 'AVAILABLE',
            executablePath: pathCandidate,
            message: `Found at ${pathCandidate}`,
          };
        }
      }

      return {
        status: 'NOT_AVAILABLE',
        message: 'Adobe Photoshop not found. Optional fallback for PSD processing.',
      };
    } catch (err) {
      return {
        status: 'ERROR',
        message: `Failed to detect Photoshop: ${err.message}`,
      };
    }
  }

  /**
   * Run all detection checks
   */
  async runAllDetections() {
    const results = {
      timestamp: new Date(),
      platform: process.platform,
      nodejs: process.version,
      detections: {},
    };

    console.log('\n========== PROCESSOR DETECTION START ==========\n');
    
    try {
      results.detections.ghostscript = await this.detectGhostscript();
      console.log(`✓ Ghostscript: ${results.detections.ghostscript.status}`);
    } catch (err) {
      console.error(`✗ Ghostscript detection failed: ${err.message}`);
      results.detections.ghostscript = { status: 'ERROR', message: err.message };
    }

    try {
      results.detections.imagemagick = await this.detectImageMagick();
      console.log(`✓ ImageMagick: ${results.detections.imagemagick.status}`);
    } catch (err) {
      console.error(`✗ ImageMagick detection failed: ${err.message}`);
      results.detections.imagemagick = { status: 'ERROR', message: err.message };
    }

    try {
      results.detections.sharp = await this.detectSharp();
      console.log(`✓ Sharp: ${results.detections.sharp.status}`);
    } catch (err) {
      console.error(`✗ Sharp detection failed: ${err.message}`);
      results.detections.sharp = { status: 'ERROR', message: err.message };
    }

    try {
      results.detections.psd_processor = await this.detectPsdProcessor();
      console.log(`✓ PSD Processor: ${results.detections.psd_processor.status}`);
    } catch (err) {
      console.error(`✗ PSD Processor detection failed: ${err.message}`);
      results.detections.psd_processor = { status: 'ERROR', message: err.message };
    }

    try {
      results.detections.illustrator = await this.detectIllustrator();
      console.log(`✓ Illustrator (Optional): ${results.detections.illustrator.status}`);
    } catch (err) {
      console.error(`✗ Illustrator detection failed: ${err.message}`);
      results.detections.illustrator = { status: 'ERROR', message: err.message };
    }

    try {
      results.detections.photoshop = await this.detectPhotoshop();
      console.log(`✓ Photoshop (Optional): ${results.detections.photoshop.status}`);
    } catch (err) {
      console.error(`✗ Photoshop detection failed: ${err.message}`);
      results.detections.photoshop = { status: 'ERROR', message: err.message };
    }

    console.log('\n========== PROCESSOR DETECTION COMPLETE ==========\n');
    
    return results;
  }

  /**
   * Update database with detection results
   */
  async saveDetectionResults(results) {
    try {
      for (const [processorName, details] of Object.entries(results.detections)) {
        const isEnabled = details.status === 'READY';
        
        await pool.query(`
          INSERT INTO processor_config 
          (processor_name, status, executable_path, version, is_enabled, last_tested_at, test_result)
          VALUES ($1, $2, $3, $4, $5, NOW(), $6)
          ON CONFLICT (processor_name) DO UPDATE SET
            status = $2,
            executable_path = $3,
            version = $4,
            is_enabled = $5,
            last_tested_at = NOW(),
            test_result = $6
        `, [
          processorName,
          details.status,
          details.executablePath || null,
          details.version || null,
          isEnabled,
          JSON.stringify(details),
        ]);
      }
      
      console.log('✓ Processor configuration saved to database');
    } catch (err) {
      console.error('Failed to save processor configuration:', err);
    }
  }

  /**
   * Get current processor configuration from database
   */
  async getProcessorConfig() {
    try {
      const result = await pool.query('SELECT * FROM processor_config ORDER BY processor_name');
      return result.rows;
    } catch (err) {
      console.error('Failed to retrieve processor config:', err);
      return [];
    }
  }

  /**
   * Print formatted status table
   */
  async printStatusTable() {
    const config = await this.getProcessorConfig();
    
    console.log('\n========== PROCESSOR STATUS ==========\n');
    console.log('Dependency                 Status             Version');
    console.log('─'.repeat(60));
    
    config.forEach(processor => {
      const status = processor.status === 'READY' ? '✓ READY' : 
                    processor.status === 'AVAILABLE' ? '◐ OPTIONAL' : '✗ NOT AVAILABLE';
      const version = processor.version || 'N/A';
      const name = processor.processor_name.padEnd(26);
      const statusPad = status.padEnd(18);
      
      console.log(`${name}${statusPad}${version}`);
    });
    
    console.log('\n========== END STATUS ==========\n');
  }
}

module.exports = ProcessorDetector;
