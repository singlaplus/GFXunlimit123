const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('./helpers/blockPostgres');
const pool = require('../db');
const sharp = require('sharp');
const AiProcessor = require('../thumbnail-engine/ai-processor');

const ghostscriptAvailable = spawnSync('gs', ['--version'], { stdio: 'ignore' }).status === 0;

test('AI processor renders PostScript Illustrator files server-side', async () => {
  const processor = new AiProcessor();
  const preview = Buffer.from('preview');
  let serverSideCalled = false;

  processor.extractPreviewServerSide = async () => {
    serverSideCalled = true;
    return preview;
  };
  processor.extractPreviewWithIllustrator = async () => {
    throw new Error('Illustrator fallback should not be used');
  };

  const result = await processor.extractPreview('/tmp/design.ai');

  assert.equal(serverSideCalled, true);
  assert.equal(result, preview);
});

test('AI processor falls back to ImageMagick before trying the unavailable Adobe worker', async () => {
  const processor = new AiProcessor();
  const preview = Buffer.from('imagemagick-preview');
  const attempts = [];
  processor.extractPreviewServerSide = async () => {
    attempts.push('ghostscript');
    throw new Error('Ghostscript unavailable');
  };
  processor.extractPreviewWithImageMagick = async () => {
    attempts.push('imagemagick');
    return preview;
  };
  processor.extractPreviewWithIllustrator = async () => {
    attempts.push('illustrator');
    throw new Error('Adobe worker unavailable');
  };

  const result = await processor.extractPreview('/tmp/design.ai');

  assert.equal(result, preview);
  assert.deepEqual(attempts, ['ghostscript', 'imagemagick']);
});

test('AI processor uses Ghostscript from PATH when no processor-config path is saved', {
  skip: !ghostscriptAvailable && 'Ghostscript is required to render the AI preview',
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-ai-preview-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  t.mock.method(pool, 'query', async () => ({ rows: [] }));

  const sourcePath = path.join(directory, 'artwork.ai');
  await fs.writeFile(sourcePath, [
    '%!PS-Adobe-3.0 EPSF-3.0',
    '%%BoundingBox: 0 0 200 100',
    '%%EndComments',
    '0 0 1 setrgbcolor',
    '0 0 200 100 rectfill',
    'showpage',
    '',
  ].join('\n'));

  const preview = await new AiProcessor().extractPreview(sourcePath);
  const metadata = await sharp(preview).metadata();
  assert.equal(metadata.format, 'png');
  assert.ok(metadata.width > 0);
  assert.ok(metadata.height > 0);
});