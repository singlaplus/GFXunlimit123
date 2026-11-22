const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/blockPostgres');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const pool = require('../db');
const EpsProcessor = require('../thumbnail-engine/eps-processor');
const { generateThumbnailPreview } = require('../utils/assetThumbnails');

const ghostscriptAvailable = spawnSync('gs', ['--version'], { stdio: 'ignore' }).status === 0;

test('reports Ghostscript timeout termination and renders the intermediate at the diagnostic DPI', async (t) => {
  t.mock.method(pool, 'query', async (_sql, values) => ({
    rows: values?.[0] === 'ghostscript' ? [{ executable_path: process.execPath }] : [],
  }));
  let ghostscriptInvocation;
  let imageMagickInvocation;
  const spawnProcess = (command, args, options) => {
    ghostscriptInvocation = { command, args, options };
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout = new EventEmitter();
    process.nextTick(() => child.emit('close', null, 'SIGTERM'));
    return child;
  };
  const spawnImageMagick = (command, args, options) => {
    imageMagickInvocation = { command, args, options };
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => child.emit('close', 1));
    return child;
  };
  const processor = new EpsProcessor({ spawnProcess, spawnImageMagick });

  await assert.rejects(
    processor.extractPreview('C:\\assets\\complex artwork.eps'),
    /Ghostscript failed with code null \(terminated by SIGTERM\)/
  );
  assert.equal(ghostscriptInvocation.command, process.execPath);
  assert.ok(ghostscriptInvocation.args.includes('-r72'));
  assert.equal(ghostscriptInvocation.options.timeout, 60000);
  assert.equal(imageMagickInvocation.command, 'convert');
});

test('falls back to ImageMagick when Ghostscript cannot render an EPS file', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-eps-fallback-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  t.mock.method(pool, 'query', async () => ({ rows: [] }));

  const sourcePath = path.join(directory, 'artwork.eps');
  await fs.writeFile(sourcePath, [
    '%!PS-Adobe-3.0 EPSF-3.0',
    '%%BoundingBox: 0 0 200 100',
    '%%EndComments',
    'showpage',
    '',
  ].join('\n'));

  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout = new EventEmitter();
    process.nextTick(() => child.emit('close', 1));
    return child;
  };
  const spawnImageMagick = (_command, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(async () => {
      await sharp({ create: { width: 80, height: 40, channels: 3, background: '#ff0000' } })
        .png()
        .toFile(args.at(-1));
      child.emit('close', 0);
    });
    return child;
  };
  const processor = new EpsProcessor({ spawnProcess, spawnImageMagick });

  const preview = await processor.extractPreview(sourcePath);
  const metadata = await sharp(preview).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 80);
  assert.equal(metadata.height, 40);
});

test('detects and renders DOS EPS files with a binary header', {
  skip: !ghostscriptAvailable && 'Ghostscript is required to render DOS EPS files',
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-eps-dos-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  t.mock.method(pool, 'query', async () => ({ rows: [] }));

  const postScript = Buffer.from([
    '%!PS-Adobe-3.0 EPSF-3.0',
    '%%BoundingBox: 0 0 64 32',
    '%%EndComments',
    '0 0 1 setrgbcolor',
    '0 0 64 32 rectfill',
    'showpage',
    '',
  ].join('\n'));
  const dosHeader = Buffer.alloc(32);
  Buffer.from([0xc5, 0xd0, 0xd3, 0xc6]).copy(dosHeader);
  dosHeader.writeUInt32LE(dosHeader.length, 4);
  dosHeader.writeUInt32LE(postScript.length, 8);
  const sourcePath = path.join(directory, 'dos-binary.eps');
  await fs.writeFile(sourcePath, Buffer.concat([dosHeader, postScript]));

  const processor = new EpsProcessor();
  assert.equal(await processor.validate(sourcePath), true);

  const preview = await processor.extractPreview(sourcePath);
  const metadata = await sharp(preview).metadata();
  assert.equal(metadata.format, 'png');
  assert.ok(metadata.width > 0);
  assert.ok(metadata.height > 0);
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

test('generates the configured WebP preview for an EPS sample', {
  skip: !ghostscriptAvailable && 'Ghostscript is required to render EPS previews',
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-eps-webp-preview-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  t.mock.method(pool, 'query', async () => ({ rows: [] }));

  const sourcePath = path.join(directory, 'artwork.eps');
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

  const result = await generateThumbnailPreview(sourcePath, {
    quality: 65,
    maxFileSizeKb: 50,
    dimensionPercent: 50,
    formats: ['eps'],
  });
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, 'webp');
  assert.ok(metadata.height > metadata.width);
  assert.equal(result.quality, 65);
});
