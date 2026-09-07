const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createWatermarkedOptionalThumbnail } = require('../utils/assetThumbnail');

test('createWatermarkedOptionalThumbnail writes a visibly modified thumbnail file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-watermark-'));
  const sourcePath = path.join(dir, 'source.png');
  const targetPath = path.join(dir, 'watermarked-thumbnail.png');

  await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toFile(sourcePath);

  const original = fs.readFileSync(sourcePath);
  await createWatermarkedOptionalThumbnail(sourcePath, targetPath, { quality: 60 });

  assert.ok(fs.existsSync(targetPath));
  const output = fs.readFileSync(targetPath);
  assert.notEqual(Buffer.compare(original, output), 0, 'Watermarked output should differ from the original source image');
});
