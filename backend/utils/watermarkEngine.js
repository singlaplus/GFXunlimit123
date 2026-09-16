/**
 * Watermark Engine
 * Applies watermark to images using Sharp
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

/**
 * Get branding configuration
 */
function getBrandingConfig() {
  try {
    const configPath = path.join(__dirname, '../uploads/branding/branding.json');
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('Failed to load branding config:', err.message);
  }
  return {};
}

/**
 * Normalize path candidate
 */
function normalizeCandidate(c) {
  let s = String(c || "").trim();
  if (!s) return "";
  s = s.replace(/^\/+/, "");
  s = s.replace(/^api\/files\//, "");
  s = s.replace(/^uploads[\\/]+/, "");
  s = s.replace(/^branding[\\/]+/, "branding/");
  return s;
}

/**
 * Generate watermark SVG
 */
async function generateWatermarkSvg(imgWidth, imgHeight, brandingConfig = null) {
  if (!brandingConfig) {
    brandingConfig = getBrandingConfig();
  }

  const watermarkText = "GFXunlimit";
  const rotationAngle = -30;
  const textOpacity = 0.5;
  const fontSize = Math.max(22, Math.round(imgWidth * 0.055));
  const patternSize = Math.max(fontSize * 10, 240);
  
  const logoCandidate = (brandingConfig && (brandingConfig.watermarkLogo || brandingConfig.logo)) || "/branding/logo.png";
  const faviconCandidate = (brandingConfig && (brandingConfig.watermarkFavicon || brandingConfig.favicon)) || "/branding/favicon.png";
  
  const logoPath = path.join(__dirname, '../uploads', normalizeCandidate(logoCandidate));
  const faviconPath = path.join(__dirname, '../uploads', normalizeCandidate(faviconCandidate));

  let logoBase64 = null;
  let logoWidth = Math.round(patternSize * 0.72);
  if (fs.existsSync(logoPath)) {
    try {
      const logoBuf = await sharp(logoPath).resize({ width: logoWidth, withoutEnlargement: true }).png().toBuffer();
      logoBase64 = logoBuf.toString("base64");
    } catch (err) {
      console.warn("Failed to prepare branding logo for watermark", err.message || err);
      logoBase64 = null;
    }
  }

  let favBase64 = null;
  let favSize = Math.max(20, Math.round(patternSize * 0.22));
  if (fs.existsSync(faviconPath)) {
    try {
      const favBuf = await sharp(faviconPath).resize({ width: favSize, withoutEnlargement: true }).png().toBuffer();
      favBase64 = favBuf.toString("base64");
    } catch (err) {
      console.warn("Failed to prepare favicon for watermark", err.message || err);
      favBase64 = null;
    }
  }

  const logoOpacity = 0.28;
  const favOpacity = 0.28;
  
  const svg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns='http://www.w3.org/2000/svg' width='${imgWidth}' height='${imgHeight}'>
  <defs>
    <pattern id='p' patternUnits='userSpaceOnUse' width='${patternSize}' height='${patternSize}' patternTransform='rotate(${rotationAngle})'>
      ${logoBase64 ? `<image x='${Math.round((patternSize - logoWidth) / 2)}' y='${Math.round((patternSize - logoWidth) / 2)}' width='${logoWidth}' height='${logoWidth}' href='data:image/png;base64,${logoBase64}' opacity='${logoOpacity}' />` : ""}
      ${favBase64 ? `
        <image x='6' y='6' width='${favSize}' height='${favSize}' href='data:image/png;base64,${favBase64}' opacity='${favOpacity}' />
        <image x='${Math.max(6, Math.round(patternSize - favSize - 6))}' y='6' width='${favSize}' height='${favSize}' href='data:image/png;base64,${favBase64}' opacity='${favOpacity}' />
        <image x='6' y='${Math.max(6, Math.round(patternSize - favSize - 6))}' width='${favSize}' height='${favSize}' href='data:image/png;base64,${favBase64}' opacity='${favOpacity}' />
        <image x='${Math.max(6, Math.round(patternSize - favSize - 6))}' y='${Math.max(6, Math.round(patternSize - favSize - 6))}' width='${favSize}' height='${favSize}' href='data:image/png;base64,${favBase64}' opacity='${favOpacity}' />
      ` : ""}
    </pattern>
  </defs>
  <rect width='100%' height='100%' fill='url(#p)' />
</svg>`;

  return Buffer.from(svg);
}

/**
 * Apply watermark to image buffer
 */
async function applyWatermarkToBuffer(imageBuffer, options = {}) {
  try {
    const brandingConfig = options.brandingConfig || getBrandingConfig();
    
    // Get image metadata
    let transformer = sharp(imageBuffer);
    const metadata = await transformer.metadata();
    const imgWidth = metadata.width || 800;
    const imgHeight = metadata.height || Math.round((imgWidth * 3) / 4);

    // Generate watermark SVG
    const watermarkBuffer = await generateWatermarkSvg(imgWidth, imgHeight, brandingConfig);

    // Apply watermark
    transformer = sharp(imageBuffer)
      .rotate()
      .composite([{ input: watermarkBuffer, blend: "over" }]);

    // Return as JPEG with quality
    const quality = options.quality || 30;
    const result = await transformer
      .jpeg({ quality, progressive: true })
      .toBuffer();

    return result;
  } catch (err) {
    console.error("Watermark application failed", err);
    throw err;
  }
}

/**
 * Apply watermark to file
 */
async function applyWatermarkToFile(inputPath, outputPath, options = {}) {
  try {
    const imageBuffer = fs.readFileSync(inputPath);
    const watermarkedBuffer = await applyWatermarkToBuffer(imageBuffer, options);
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, watermarkedBuffer);
    return true;
  } catch (err) {
    console.error("Failed to apply watermark to file", err);
    throw err;
  }
}

module.exports = {
  applyWatermarkToBuffer,
  applyWatermarkToFile,
  generateWatermarkSvg,
  getBrandingConfig,
  normalizeCandidate,
};
