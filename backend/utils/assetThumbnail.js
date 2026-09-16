const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function sanitizeAssetBaseName(fileName) {
  const baseName = path.basename(fileName || '', path.extname(fileName || '')) || 'asset';
  return String(baseName)
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-zA-Z0-9.-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'asset';
}

function getThumbnailStorageDirectory(assetFilePath) {
  const normalizedPath = String(assetFilePath || '').replace(/\\/g, '/');
  const uploadsRoot = /(?:^|\/)uploads\//i;
  const matches = normalizedPath.match(/^(.*?\/uploads\/[^/]+\/\d{4}\/\d{2})\/(?:Pending|Approved|Rejected)\//i);

  if (matches && matches[1]) {
    return path.join(matches[1], 'thumbnails');
  }

  const uploadsMatch = normalizedPath.match(/^(.*?\/uploads\/.*?\/\d{4}\/\d{2})\//i);
  if (uploadsMatch && uploadsMatch[1]) {
    return path.join(uploadsMatch[1], 'thumbnails');
  }

  const statusDirMatch = normalizedPath.match(/^(.*?\/\d{4}\/\d{2})\/(?:Pending|Approved|Rejected)\//i);
  if (statusDirMatch && statusDirMatch[1]) {
    return path.join(statusDirMatch[1], 'thumbnails');
  }

  return path.join(path.dirname(normalizedPath), 'thumbnails');
}

function buildGeneratedThumbnailPath(assetFilePath, extension = '.jpg') {
  const normalizedPath = String(assetFilePath || '').replace(/\\/g, '/');
  const directory = getThumbnailStorageDirectory(normalizedPath);
  const ext = String(extension || '.jpg').startsWith('.') ? String(extension || '.jpg') : `.${String(extension || 'jpg').replace(/^\./, '')}`;
  const baseName = path.basename(normalizedPath, path.extname(normalizedPath)) || 'asset';
  return path.join(directory, `${baseName}-thumb${ext}`);
}

function getOptionalThumbnailQuality() {
  return 50;
}

function buildOptionalThumbnailName(originalAssetName, uploadedThumbnailName) {
  const assetBase = sanitizeAssetBaseName(originalAssetName);
  const ext = path.extname(uploadedThumbnailName || '').toLowerCase() || '.png';
  return `thumbnail-${assetBase}${ext}`;
}

function getPublicThumbnailUrl(relativeThumbnailPath) {
  const normalized = String(relativeThumbnailPath || '').trim();
  if (!normalized) return '';
  const withoutLeadingSlash = normalized.replace(/^\/+/, '');
  const withoutUploadsPrefix = withoutLeadingSlash.replace(/^uploads\/+/, '');
  return `/api/thumbnail?file=${encodeURIComponent(withoutUploadsPrefix)}`;
}

function normalizeBrandingAssetPath(value) {
  if (!value) return '';
  let normalized = String(value).trim();
  normalized = normalized.replace(/^\/+/, '');
  normalized = normalized.replace(/^api\/files\/+/, '');
  normalized = normalized.replace(/^uploads[\\/]+/, '');
  normalized = normalized.replace(/^branding[\\/]+/, 'branding/');
  return normalized;
}

async function createWatermarkedOptionalThumbnail(inputPath, outputPath, options = {}) {
  const source = String(inputPath || '').trim();
  const target = String(outputPath || '').trim();
  const quality = Number.isFinite(Number(options.quality)) ? Number(options.quality) : 50;

  if (!source || !target) {
    throw new Error('A valid input and output path are required for watermarking the optional thumbnail');
  }

  const outputDir = path.dirname(target);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const sourceExt = path.extname(source).toLowerCase();
  const targetExt = path.extname(target).toLowerCase() || sourceExt || '.png';
  const image = sharp(source).rotate();
  const metadata = await image.metadata();
  const imgWidth = metadata.width || 1200;
  const imgHeight = metadata.height || Math.round((imgWidth * 3) / 4);

  // Read branding config from file (similar to getBrandingConfig in server.js)
  let brandingConfig = {};
  const brandingFile = path.join(path.resolve(__dirname, '../uploads'), 'branding', 'branding.json');
  if (fs.existsSync(brandingFile)) {
    try {
      brandingConfig = JSON.parse(fs.readFileSync(brandingFile, 'utf8')) || {};
    } catch (err) {
      console.warn('Failed to read branding config for optional thumbnail watermark:', err.message || err);
    }
  }

  const logoCandidate = (brandingConfig && (brandingConfig.watermarkLogo || brandingConfig.logo)) || '/branding/logo.png';
  const faviconCandidate = (brandingConfig && (brandingConfig.watermarkFavicon || brandingConfig.favicon)) || '/branding/favicon.png';
  const uploadsRoot = path.resolve(__dirname, '../uploads');
  const logoPath = path.join(uploadsRoot, normalizeBrandingAssetPath(logoCandidate));
  const faviconPath = path.join(uploadsRoot, normalizeBrandingAssetPath(faviconCandidate));

  let logoBase64 = null;
  let logoSize = Math.max(48, Math.round(imgWidth * 0.08));
  if (fs.existsSync(logoPath)) {
    try {
      const logoBuf = await sharp(logoPath).resize({ width: logoSize, withoutEnlargement: true }).png().toBuffer();
      logoBase64 = logoBuf.toString('base64');
    } catch (err) {
      console.warn('Optional thumbnail watermark logo failed:', err.message || err);
    }
  }

  let faviconBase64 = null;
  let faviconSize = Math.max(32, Math.round(imgWidth * 0.05));
  if (fs.existsSync(faviconPath)) {
    try {
      const favBuf = await sharp(faviconPath).resize({ width: faviconSize, withoutEnlargement: true }).png().toBuffer();
      faviconBase64 = favBuf.toString('base64');
    } catch (err) {
      console.warn('Optional thumbnail watermark favicon failed:', err.message || err);
    }
  }

  // Create diagonal pattern alternating between logo and favicon
  let patternElements = '';
  if (logoBase64 || faviconBase64) {
    const spacing = Math.round(imgWidth * 0.15);  // 15% spacing for density
    const diagSpacing = Math.round(spacing * Math.sqrt(2));  // Diagonal spacing
    let alternateCount = 0;
    
    // Create diagonal lines going from top-left to bottom-right
    for (let offset = -imgHeight; offset < imgWidth + imgHeight; offset += diagSpacing) {
      for (let step = 0; step < (imgWidth + imgHeight) / spacing; step++) {
        const x = offset + step * spacing;
        const y = step * spacing;
        
        if (x >= 0 && x < imgWidth && y >= 0 && y < imgHeight) {
          // Alternate between logo and favicon
          if (alternateCount % 2 === 0 && logoBase64) {
            patternElements += `<image x='${Math.round(x)}' y='${Math.round(y)}' width='${logoSize}' height='${logoSize}' href='data:image/png;base64,${logoBase64}' opacity='0.75'/>`;
          } else if (faviconBase64) {
            patternElements += `<image x='${Math.round(x)}' y='${Math.round(y)}' width='${faviconSize}' height='${faviconSize}' href='data:image/png;base64,${faviconBase64}' opacity='0.80'/>`;
          }
          alternateCount++;
        }
      }
    }
  }

  const svg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns='http://www.w3.org/2000/svg' width='${imgWidth}' height='${imgHeight}'>
  <!-- Diagonal logo and favicon pattern -->
  <g opacity='0.8'>
    ${patternElements}
  </g>
</svg>`;

  const watermarkBuffer = Buffer.from(svg);

  const finalTransform = sharp(source).rotate().composite([{ input: watermarkBuffer, blend: 'over' }]);

  if (targetExt === '.png') {
    await finalTransform.png({ quality, compressionLevel: 9 }).toFile(target);
  } else if (targetExt === '.webp') {
    await finalTransform.webp({ quality }).toFile(target);
  } else {
    await finalTransform.jpeg({ quality, progressive: true }).toFile(target);
  }

  return target;
}

module.exports = {
  sanitizeAssetBaseName,
  getThumbnailStorageDirectory,
  buildGeneratedThumbnailPath,
  getOptionalThumbnailQuality,
  buildOptionalThumbnailName,
  getPublicThumbnailUrl,
  normalizeBrandingAssetPath,
  createWatermarkedOptionalThumbnail,
};
