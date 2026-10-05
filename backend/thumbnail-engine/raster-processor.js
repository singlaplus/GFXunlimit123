const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const BaseProcessor = require('./base-processor');
const { applyWatermarkToBuffer } = require('../utils/watermarkEngine');

class RasterProcessor extends BaseProcessor {
  constructor(options = {}) {
    super(options);
    this.name = 'RasterProcessor';
    this.supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.tif', '.tiff'];
  }

  async detect(filePath) {
    if (!this.isSupported(filePath)) return false;

    try {
      const metadata = await sharp(filePath).metadata();
      return ['jpeg', 'png', 'webp', 'gif', 'svg', 'tiff'].includes(metadata.format);
    } catch (error) {
      return false;
    }
  }

  async validate(filePath) {
    try {
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile() || stats.size === 0 || stats.size > 500 * 1024 * 1024) {
        return false;
      }
      return this.detect(filePath);
    } catch (error) {
      return false;
    }
  }

  async extractPreview(filePath) {
    return sharp(filePath)
      .rotate()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer();
  }

  async generateThumbnail(previewBuffer, options = {}) {
    const thumbnail = await super.generateThumbnail(previewBuffer, options);
    thumbnail.buffer = await applyWatermarkToBuffer(thumbnail.buffer, {
      quality: options.quality || 65,
    });
    return thumbnail;
  }
}

module.exports = RasterProcessor;