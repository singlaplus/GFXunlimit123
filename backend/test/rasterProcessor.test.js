const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const RasterProcessor = require('../thumbnail-engine/raster-processor');

test('raster processor creates a bounded JPEG thumbnail from supported raster input', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-raster-thumbnail-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const sourcePath = path.join(directory, 'source.png');
  await sharp({
    create: {
      width: 1600,
      height: 900,
      channels: 4,
      background: { r: 24, g: 100, b: 180, alpha: 0.8 },
    },
  }).png().toFile(sourcePath);

  const processor = new RasterProcessor();
  assert.equal(await processor.detect(sourcePath), true);
  assert.equal(await processor.validate(sourcePath), true);

  const preview = await processor.extractPreview(sourcePath);
  const thumbnail = await processor.generateThumbnail(preview, {
    quality: 65,
    maxWidth: 600,
    maxHeight: 600,
    autoTrim: false,
  });
  const metadata = await sharp(thumbnail.buffer).metadata();

  assert.equal(metadata.format, 'jpeg');
  assert.ok(metadata.width <= 600);
  assert.ok(metadata.height <= 600);
  assert.equal(processor.isSupported('asset.webp'), true);
  assert.equal(processor.isSupported('asset.gif'), true);
  assert.equal(processor.isSupported('asset.svg'), true);
  assert.equal(processor.isSupported('asset.bmp'), false);
});