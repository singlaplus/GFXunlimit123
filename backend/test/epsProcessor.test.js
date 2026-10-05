const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const pool = require('../db');
const EpsProcessor = require('../thumbnail-engine/eps-processor');

const ghostscriptAvailable = spawnSync('gs', ['--version'], { stdio: 'ignore' }).status === 0;

test('reports Ghostscript timeout termination and renders the intermediate at the diagnostic DPI', async (t) => {
  t.mock.method(pool, 'query', async () => ({ rows: [{ executable_path: 'gswin64c.exe' }] }));
  let invocation;
  const spawnProcess = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout = new EventEmitter();
    process.nextTick(() => child.emit('close', null, 'SIGTERM'));
    return child;
  };
  const processor = new EpsProcessor({ spawnProcess });

  await assert.rejects(
    processor.extractPreview('C:\\assets\\complex artwork.eps'),
    /Ghostscript failed with code null \(terminated by SIGTERM\)/
  );
  assert.equal(invocation.command, 'gswin64c.exe');
  assert.ok(invocation.args.includes('-r72'));
  assert.equal(invocation.options.timeout, 60000);
});

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
