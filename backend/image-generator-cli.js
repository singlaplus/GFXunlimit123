#!/usr/bin/env node

/**
 * Image Generator CLI
 * 
 * Usage:
 *   node image-generator-cli.js generate <filepath> [--format=png] [--quality=90]
 *   node image-generator-cli.js check <filepath>
 *   node image-generator-cli.js status
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const pool = require('./db');

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[36m',
};

function colorize(text, color) {
  return `${color}${text}${COLORS.reset}`;
}

function log(message, color = COLORS.reset) {
  console.log(colorize(message, color));
}

function logError(message) {
  console.error(colorize(`ERROR: ${message}`, COLORS.red));
}

function logSuccess(message) {
  console.log(colorize(`✓ ${message}`, COLORS.green));
}

function logInfo(message) {
  console.log(colorize(`ℹ ${message}`, COLORS.blue));
}

function logWarning(message) {
  console.log(colorize(`⚠ ${message}`, COLORS.yellow));
}

function showHelp() {
  console.log(`
${colorize('Image Generator CLI', COLORS.bright)}

Usage:
  node image-generator-cli.js generate <filepath> [options]
  node image-generator-cli.js check <filepath>
  node image-generator-cli.js status

Commands:
  ${colorize('generate <filepath>', COLORS.blue)}  Generate thumbnail for image file
    Options:
      --format=<format>    Output format (png, jpg, webp) - default: png
      --quality=<quality>  Quality 1-100 - default: 90
      --width=<width>      Thumbnail width - default: 300
      --height=<height>    Thumbnail height - default: 300

  ${colorize('check <filepath>', COLORS.blue)}     Check if file can be processed
    Shows file type, detected processor, and status

  ${colorize('status', COLORS.blue)}               Show system dependency status
    Displays versions of all required tools

Examples:
  node image-generator-cli.js generate ./uploads/image.psd
  node image-generator-cli.js generate ./uploads/file.eps --format=jpg --quality=85
  node image-generator-cli.js check ./uploads/file.ai
  node image-generator-cli.js status
  `);
}

function checkSystemDependencies() {
  const dependencies = {
    'Node.js': () => process.version,
    'Sharp': () => {
      try {
        return require('sharp/package.json').version;
      } catch {
        return null;
      }
    },
    'Ghostscript': () => {
      try {
        const result = spawnSync('gs', ['--version'], { encoding: 'utf8' });
        if (result.status === 0) {
          return result.stdout.split('\n')[0];
        }
      } catch {}
      return null;
    },
    'ImageMagick': () => {
      try {
        const result = spawnSync('magick', ['-version'], { encoding: 'utf8' });
        if (result.status === 0) {
          return result.stdout.split('\n')[0];
        }
      } catch {}
      return null;
    },
  };

  console.log(colorize('\nSystem Dependencies:', COLORS.bright));
  let allOk = true;
  for (const [tool, checker] of Object.entries(dependencies)) {
    const version = checker();
    if (version) {
      logSuccess(`${tool}: ${version}`);
    } else {
      if (tool !== 'ImageMagick') { // ImageMagick is optional
        logWarning(`${tool}: Not found`);
        allOk = false;
      } else {
        logWarning(`${tool}: Not found (optional)`);
      }
    }
  }

  return allOk;
}

function detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  const typeMap = {
    '.psd': 'PSD',
    '.ai': 'AI/EPS',
    '.eps': 'EPS',
    '.pdf': 'PDF',
    '.png': 'PNG',
    '.jpg': 'JPG',
    '.jpeg': 'JPG',
    '.gif': 'GIF',
    '.webp': 'WebP',
  };

  return typeMap[ext] || 'UNKNOWN';
}

async function checkFile(filePath) {
  if (!fs.existsSync(filePath)) {
    logError(`File not found: ${filePath}`);
    process.exit(1);
  }

  const stats = fs.statSync(filePath);
  const fileType = detectFileType(filePath);
  const fileName = path.basename(filePath);
  const fileSize = (stats.size / 1024).toFixed(2);

  console.log(colorize('\nFile Analysis:', COLORS.bright));
  logInfo(`Name: ${fileName}`);
  logInfo(`Type: ${fileType}`);
  logInfo(`Size: ${fileSize} KB`);
  logInfo(`Path: ${filePath}`);

  // Check if this is a supported format
  const supportedFormats = ['.psd', '.ai', '.eps', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];
  if (!supportedFormats.includes(path.extname(filePath).toLowerCase())) {
    logWarning(`File type ${fileType} may not be supported`);
  } else {
    logSuccess(`File type ${fileType} is supported`);
  }
}

async function generateThumbnail(filePath, options = {}) {
  const {
    format = 'png',
    quality = 90,
    width = 300,
    height = 300,
  } = options;

  if (!fs.existsSync(filePath)) {
    logError(`File not found: ${filePath}`);
    process.exit(1);
  }

  try {
    const sharp = require('sharp');
    const fileName = path.basename(filePath, path.extname(filePath));
    const outputDir = path.dirname(filePath);
    const outputPath = path.join(outputDir, `${fileName}-thumbnail.${format}`);

    logInfo(`Generating thumbnail for: ${path.basename(filePath)}`);
    logInfo(`Output: ${outputPath}`);
    logInfo(`Format: ${format}, Quality: ${quality}, Size: ${width}x${height}`);

    // Read file and process
    let image = sharp(filePath);

    // Resize
    image = image.resize(width, height, {
      fit: 'cover',
      position: 'center',
    });

    // Save with appropriate format
    if (format === 'jpg') {
      image = image.jpeg({ quality: parseInt(quality), progressive: true });
    } else if (format === 'webp') {
      image = image.webp({ quality: parseInt(quality) });
    } else {
      image = image.png({ compression: 9 });
    }

    await image.toFile(outputPath);
    logSuccess(`Thumbnail generated successfully`);
    logInfo(`Output file size: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);

  } catch (error) {
    logError(`Failed to generate thumbnail: ${error.message}`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  const command = args[0];
  const filePath = args[1];

  switch (command) {
    case 'status':
      checkSystemDependencies();
      break;

    case 'check':
      if (!filePath) {
        logError('Please provide a file path');
        showHelp();
        process.exit(1);
      }
      await checkFile(filePath);
      break;

    case 'generate':
      if (!filePath) {
        logError('Please provide a file path');
        showHelp();
        process.exit(1);
      }
      
      const options = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i].startsWith('--')) {
          const [key, value] = args[i].substring(2).split('=');
          options[key] = value;
        }
      }

      await generateThumbnail(filePath, options);
      break;

    default:
      logError(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    logError(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  checkSystemDependencies,
  detectFileType,
  checkFile,
  generateThumbnail,
};
