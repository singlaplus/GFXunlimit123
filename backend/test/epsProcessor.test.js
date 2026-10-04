const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const pool = require('../db');
const EpsProcessor = require('../thumbnail-engine/eps-processor');

const ghostscriptAvailable = spawnSync('gs', ['--version'], { stdio: 'ignore' }).status === 0;

test('EPS previews preserve the portrait BoundingBox aspect ratio', {
  skip: !ghostscriptAvailable && 'Ghostscript is required to render EPS previews',
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-eps-thumbnail-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  t.mock.method(pool, 'query', async () => ({ rows: [] }));

  const sourcePath = path.join(directory, 'portrait.eps');
  await fs.writeFile(sourcePath, [
    '%!PS-Adobe-3.0 EPSF-3.0',
    '%%BoundingBox: 0 0 200 500',
    '%%HiResBoundingBox: 0 0 200 500',
    '%%EndComments',
    '0 0 1 setrgbcolor',
    '0 0 200 500 rectfill',
    'showpage',
    '',
  ].join('\n'));

  const processor = new EpsProcessor();
  const preview = await processor.extractPreview(sourcePath);
  const previewMetadata = await sharp(preview).metadata();
  assert.ok(previewMetadata.height > previewMetadata.width);

  const thumbnail = await processor.generateThumbnail(preview, {
    maxWidth: 1200,
    maxHeight: 1200,
    autoTrim: false,
  });
  const thumbnailMetadata = await sharp(thumbnail.buffer).metadata();
  assert.ok(thumbnailMetadata.height > thumbnailMetadata.width);
});
