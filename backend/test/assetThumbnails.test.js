const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const axios = require('axios');
const sharp = require('sharp');
const {
  MAX_THUMBNAIL_BYTES,
  PROCESSOR_VERSION,
  encodeThumbnail,
  getThumbnailFilename,
  getThumbnailFilePath,
  getThumbnailRelativePath,
  getDateDirectory,
  parseThumbnailAssetId,
  getThumbnailCacheControl,
  getProcessorVersion,
  getThumbnailStorageRoot,
  getLifecycleRecoveryStorageRoots,
  getAssetSourceInfo,
  isValidThumbnailFile,
  finalizeThumbnailFile,
  normalizeThumbnailRelativePath,
  normalizeStoredFilename,
  sanitizeFilenamePart,
  deleteAssetThumbnail,
  acquireContributorUploadLock,
  deleteContributorUploadFolderIfUnused,
  generateAssetThumbnail,
  removeStagedOptionalThumbnail,
  stageOptionalThumbnail,
} = require('../utils/assetThumbnails');
const fsp = require('node:fs/promises');
const { planOrphanThumbnailFiles } = require('../scripts/thumbnail-cli-utils');
const pool = require('../db');
const ProcessorDetector = require('../thumbnail-engine/processor-detector');
const { getAssetSourceDimensions } = require('../utils/assetDimensions');

function setPlatform(platform) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...originalDescriptor, value: platform });
  return () => Object.defineProperty(process, 'platform', originalDescriptor);
}

function preserveEnvironment(names) {
  const values = new Map(names.map((name) => [name, process.env[name]]));
  return () => {
    for (const [name, value] of values) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

test('macOS lifecycle recovery does not require local asset or thumbnail roots', () => {
  const restoreEnvironment = preserveEnvironment(['ASSETS_ROOT', 'THUMBNAIL_STORAGE_PATH']);
  delete process.env.ASSETS_ROOT;
  delete process.env.THUMBNAIL_STORAGE_PATH;

  try {
    assert.deepEqual(
      getLifecycleRecoveryStorageRoots({ platform: 'darwin' }),
      { assetRoot: null, thumbnailRoot: null }
    );
  } finally {
    restoreEnvironment();
  }
});

function createThumbnailDatabaseMock(asset, observed = {}) {
  let record = null;
  return async (sql, values = []) => {
    if (/SELECT id, title, filename, original_filename, uploaded_by, to_char\(created_at/.test(sql)) {
      observed.assetLookupSelect = sql;
      return { rows: [asset] };
    }
    if (/SELECT session_id FROM auth_sessions/.test(sql)) {
      return { rows: [{ session_id: 'active-contributor-session' }] };
    }
    if (/SELECT \* FROM asset_thumbnail_metadata/.test(sql)) {
      return { rows: record ? [record] : [] };
    }
    if (/INSERT INTO asset_thumbnail_metadata/.test(sql)) {
      if (/'FAILED'/.test(sql)) observed.failureMessage = values[4];
      record = {
        asset_id: asset.id,
        thumbnail_path: values[1],
        status: /'READY'/.test(sql) ? 'READY' : /'FAILED'/.test(sql) ? 'FAILED' : 'PROCESSING',
        processor_version: PROCESSOR_VERSION,
      };
      return { rows: [] };
    }
    if (/UPDATE images/.test(sql)) return { rows: [] };
    throw new Error(`Unexpected test database query: ${sql}`);
  };
}

function listStagedSourceFiles() {
  const directory = path.join(__dirname, '..', 'tmp', 'asset-thumbnail-sources');
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

test('encodes a proportional WebP thumbnail at 20% dimensions with quality 37', async () => {
  for (const [width, height, expectedWidth, expectedHeight] of [
    [1000, 2000, 200, 400],
    [2000, 1000, 400, 200],
    [1000, 1000, 200, 200],
    [4000, 1000, 800, 200],
  ]) {
    const source = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#ff0000"/></svg>`
    );
    const result = await encodeThumbnail(source);
    const metadata = await sharp(result.buffer).metadata();

    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, expectedWidth);
    assert.equal(metadata.height, expectedHeight);
    assert.equal(result.quality, 37);
    assert.ok(result.buffer.length <= MAX_THUMBNAIL_BYTES);
    assert.equal(result.width / result.height, width / height);
  }
});

test('does not upscale tiny originals and keeps both output dimensions nonzero', async () => {
  const source = await sharp({
    create: { width: 3, height: 2, channels: 3, background: '#0000ff' },
  }).png().toBuffer();
  const result = await encodeThumbnail(source);
  const metadata = await sharp(result.buffer).metadata();

  assert.equal(metadata.width, 3);
  assert.equal(metadata.height, 2);
  assert.equal(metadata.width / metadata.height, 3 / 2);
  assert.equal(result.quality, 37);
});

test('reduces WebP quality below 37 when needed while keeping the target dimensions', async () => {
  const randomPixels = require('node:crypto').randomBytes(400 * 400 * 3);
  const source = await sharp(randomPixels, {
    raw: { width: 400, height: 400, channels: 3 },
  }).png().toBuffer();
  const result = await encodeThumbnail(source, {
    sourceDimensions: { width: 2000, height: 2000 },
  });
  const metadata = await sharp(result.buffer).metadata();

  assert.equal(metadata.width, 400);
  assert.equal(metadata.height, 400);
  assert.ok(result.quality < 37);
  assert.ok(result.quality >= 1);
  assert.ok(result.buffer.length <= MAX_THUMBNAIL_BYTES);
});

test('proportionally reduces dimensions if quality 1 still exceeds the byte cap', async () => {
  const randomPixels = require('node:crypto').randomBytes(800 * 800 * 3);
  const source = await sharp(randomPixels, {
    raw: { width: 800, height: 800, channels: 3 },
  }).png().toBuffer();
  const result = await encodeThumbnail(source, {
    sourceDimensions: { width: 4000, height: 4000 },
  });
  const metadata = await sharp(result.buffer).metadata();

  assert.ok(metadata.width < 800);
  assert.ok(metadata.height < 800);
  assert.equal(metadata.width, metadata.height);
  assert.ok(result.quality <= 37);
  assert.ok(result.buffer.length <= MAX_THUMBNAIL_BYTES);
});

test('uses source-document dimensions when processors return a higher-DPI raster preview', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-vector-dimensions-'));
  const epsPath = path.join(temporaryDirectory, 'artwork.eps');
  const rasterPreview = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="4000"><rect width="2000" height="4000" fill="#ff0000"/></svg>'
  );
  fs.writeFileSync(epsPath, '%!PS-Adobe-3.0 EPSF-3.0\n%%HiResBoundingBox: 0 0 1000 2000\n');

  try {
    const sourceDimensions = await getAssetSourceDimensions(epsPath, '.eps');
    const result = await encodeThumbnail(rasterPreview, { sourceDimensions });
    const metadata = await sharp(result.buffer).metadata();
    assert.deepEqual(sourceDimensions, { width: 1000, height: 2000 });
    assert.equal(metadata.width, 200);
    assert.equal(metadata.height, 400);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('uses the unified proportional thumbnail processor version for every format', () => {
  const version = getProcessorVersion('asset.jpg');
  for (const filename of ['asset.jpg', 'asset.eps', 'asset.ai', 'asset.psd', 'asset.psb']) {
    assert.equal(getProcessorVersion(filename), version);
  }
});

test('uses readable unique ID filenames and rejects unsafe stored source paths', () => {
  const relativePath = '2026/10/02/summer-flowers-final_Beautiful-Summer-Flowers_12345.webp';
  assert.equal(
    getThumbnailFilename(12345, 'summer flowers final.jpg', 'Beautiful Summer Flowers'),
    'summer-flowers-final_Beautiful-Summer-Flowers_12345.webp'
  );
  assert.equal(
    getThumbnailFilePath(12345, '/tmp/thumbnails', relativePath),
    path.join('/tmp/thumbnails', ...relativePath.split('/'))
  );
  assert.equal(normalizeStoredFilename('uploads/user/2026/08/Approved/file.psd'), 'user/2026/08/Approved/file.psd');
  assert.throws(() => getThumbnailFilename('../123'));
  assert.throws(() => normalizeStoredFilename('../secret.psd'));
  assert.throws(() => normalizeStoredFilename('user/%2e%2e/file.psd'));
});

test('sanitizes Windows-invalid and reserved names while retaining Unicode', () => {
  assert.equal(sanitizeFilenamePart('CON'), '_CON');
  assert.equal(sanitizeFilenamePart('summer <flowers>: "final"/?*'), 'summer-flowers-final');
  assert.equal(sanitizeFilenamePart('你好 世界 & Café'), '你好-世界-Café');
  assert.equal(getThumbnailFilename(44, '你好/花朵.png', '夏日 花园'), '花朵_夏日-花园_44.webp');
  assert.equal(sanitizeFilenamePart('...'), 'asset');
  assert.ok(sanitizeFilenamePart('x'.repeat(1000)).length <= 80);
  assert.ok(getThumbnailFilename(45, `${'🌻'.repeat(200)}.png`, '🌸'.repeat(200)).length <= 240);
});

test('uses the stored asset date for its directory and falls back for invalid dates', () => {
  const date = new Date('2026-10-02T12:00:00Z');
  const now = new Date();
  assert.equal(getDateDirectory(date), '2026/10/02');
  assert.equal(getDateDirectory(null, date), '2026/10/02');
  assert.equal(getDateDirectory(null), getDateDirectory(now));
  assert.equal(getDateDirectory('2026-10-02T23:00:00-05:00'), '2026/10/03');
  assert.equal(
    getThumbnailRelativePath({
      assetId: 12345,
      originalFilename: 'summer flowers final.jpg',
      title: 'Beautiful Summer Flowers',
      createdAt: date,
    }),
    '2026/10/02/summer-flowers-final_Beautiful-Summer-Flowers_12345.webp'
  );
});

test('finalizes a thumbnail when the destination does not exist', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-thumbnail-finalize-new-'));
  const temporaryPath = path.join(temporaryDirectory, 'output.webp.tmp');
  const finalPath = path.join(temporaryDirectory, 'output.webp');
  fs.writeFileSync(temporaryPath, 'new thumbnail');

  try {
    await finalizeThumbnailFile(temporaryPath, finalPath);
    assert.equal(fs.readFileSync(finalPath, 'utf8'), 'new thumbnail');
    assert.equal(fs.existsSync(temporaryPath), false);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('replaces an existing destination without renaming over it', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-thumbnail-finalize-replace-'));
  const temporaryPath = path.join(temporaryDirectory, 'output.webp.tmp');
  const finalPath = path.join(temporaryDirectory, 'output.webp');
  const renameCalls = [];
  fs.writeFileSync(temporaryPath, 'new thumbnail');
  fs.writeFileSync(finalPath, 'existing thumbnail');
  const fileSystem = Object.create(fsp);
  fileSystem.rename = async (source, destination) => {
    renameCalls.push([source, destination]);
    return fsp.rename(source, destination);
  };

  try {
    await finalizeThumbnailFile(temporaryPath, finalPath, fileSystem);
    assert.equal(fs.readFileSync(finalPath, 'utf8'), 'new thumbnail');
    assert.equal(fs.existsSync(temporaryPath), false);
    assert.equal(renameCalls.length, 2);
    assert.equal(renameCalls[0][0], finalPath);
    assert.match(renameCalls[0][1], /\.bak$/);
    assert.equal(renameCalls[1][0], temporaryPath);
    assert.equal(renameCalls[1][1], finalPath);
    assert.deepEqual(fs.readdirSync(temporaryDirectory), ['output.webp']);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('restores the existing destination when replacement fails', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-thumbnail-finalize-rollback-'));
  const temporaryPath = path.join(temporaryDirectory, 'output.webp.tmp');
  const finalPath = path.join(temporaryDirectory, 'output.webp');
  fs.writeFileSync(temporaryPath, 'new thumbnail');
  fs.writeFileSync(finalPath, 'existing thumbnail');
  const fileSystem = Object.create(fsp);
  fileSystem.rename = async (source, destination) => {
    if (source === temporaryPath && destination === finalPath) {
      const error = new Error('operation not permitted');
      error.code = 'EPERM';
      throw error;
    }
    return fsp.rename(source, destination);
  };

  try {
    await assert.rejects(finalizeThumbnailFile(temporaryPath, finalPath, fileSystem), /operation not permitted/);
    assert.equal(fs.readFileSync(finalPath, 'utf8'), 'existing thumbnail');
    assert.equal(fs.readFileSync(temporaryPath, 'utf8'), 'new thumbnail');
    assert.deepEqual(fs.readdirSync(temporaryDirectory).sort(), ['output.webp', 'output.webp.tmp']);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('detects Sharp by encoding a real test image', async () => {
  const result = await new ProcessorDetector().detectSharp();
  assert.equal(result.status, 'READY');
});

test('rejects unsafe and mismatched thumbnail paths', () => {
  assert.equal(parseThumbnailAssetId('12345'), 12345);
  for (const invalidId of ['0', '-1', '1.5', '../1', '2147483648', '']) {
    assert.equal(parseThumbnailAssetId(invalidId), null);
  }
  assert.throws(() => normalizeThumbnailRelativePath('../image_123.webp', 123));
  assert.throws(() => normalizeThumbnailRelativePath('2026/10/02/image_124.webp', 123));
  assert.throws(() => normalizeThumbnailRelativePath('2026/02/31/image_123.webp', 123));
  assert.throws(() => normalizeThumbnailRelativePath('2026/10/02/C:evil_123.webp', 123));
});

test('does not accept symlinked thumbnail outputs and keeps private assets out of shared caches', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-thumbnail-audit-'));
  const targetPath = path.join(temporaryDirectory, 'target.webp');
  const proportionalPath = path.join(temporaryDirectory, 'proportional.webp');
  const linkPath = path.join(temporaryDirectory, 'link.webp');
  try {
    const validImage = await sharp({
      create: { width: 16, height: 9, channels: 3, background: '#8899aa' },
    }).webp().toBuffer();
    const proportionalImage = await sharp({
      create: { width: 450, height: 360, channels: 3, background: '#8899aa' },
    }).webp().toBuffer();
    fs.writeFileSync(targetPath, validImage);
    fs.writeFileSync(proportionalPath, proportionalImage);
    fs.symlinkSync(targetPath, linkPath);
    assert.equal(await isValidThumbnailFile(targetPath), true);
    assert.equal(await isValidThumbnailFile(proportionalPath), true);
    assert.equal(await isValidThumbnailFile(linkPath), false);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  assert.equal(getThumbnailCacheControl(false, true), 'private, no-store');
  assert.equal(getThumbnailCacheControl(true, true), 'public, max-age=31536000, immutable');
});

test('cleanup planning only classifies unreferenced canonical WebP files as orphans', () => {
  const entries = [
    { relativePath: '2026/10/02/file-title_1.webp', isFile: () => true },
    { relativePath: '2026/10/02/file-title_2.webp', isFile: () => true },
    { relativePath: '2026/10/02/file-title_3.webp', isFile: () => true },
    { relativePath: '2026/10/02/not-an-asset.webp', isFile: () => true },
    { relativePath: '2026/10/02/file-title_4.WEBP', isFile: () => true },
  ];
  const plan = planOrphanThumbnailFiles(
    entries,
    new Set([1, 2]),
    new Map([[1, '2026/10/02/file-title_1.webp']])
  );
  assert.deepEqual(plan, [
    { relativePath: '2026/10/02/file-title_2.webp', assetId: 2, reason: 'thumbnail metadata record missing' },
    { relativePath: '2026/10/02/file-title_3.webp', assetId: 3, reason: 'asset and thumbnail record missing' },
  ]);
});

test('stages an optional preview outside asset storage and removes only the staged copy', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-optional-preview-'));
  const sourcePath = path.join(temporaryDirectory, 'preview.png');
  try {
    const source = await sharp({
      create: { width: 16, height: 9, channels: 3, background: '#123456' },
    }).png().toBuffer();
    fs.writeFileSync(sourcePath, source);
    const stagedPath = await stageOptionalThumbnail(sourcePath);

    assert.notEqual(stagedPath, sourcePath);
    assert.equal(fs.existsSync(stagedPath), true);
    await removeStagedOptionalThumbnail(stagedPath);
    assert.equal(fs.existsSync(stagedPath), false);
    assert.equal(fs.existsSync(sourcePath), true);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('rejects thumbnail storage roots that overlap original asset storage', () => {
  const oldAssetRoot = process.env.ASSETS_ROOT;
  const oldThumbnailRoot = process.env.THUMBNAIL_STORAGE_PATH;
  process.env.ASSETS_ROOT = '/tmp/gfx-assets';
  process.env.THUMBNAIL_STORAGE_PATH = '/tmp/gfx-assets/thumbnails';
  try {
    assert.throws(() => getThumbnailStorageRoot(), /separate from the original asset storage root/);
  } finally {
    if (oldAssetRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = oldAssetRoot;
    if (oldThumbnailRoot === undefined) delete process.env.THUMBNAIL_STORAGE_PATH;
    else process.env.THUMBNAIL_STORAGE_PATH = oldThumbnailRoot;
  }
});

test('rejects thumbnail roots that resolve through symlinks into original storage', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-thumbnail-roots-'));
  const originalRoot = path.join(temporaryDirectory, 'assets');
  const thumbnailAlias = path.join(temporaryDirectory, 'thumbnail-alias');
  fs.mkdirSync(originalRoot, { recursive: true });
  fs.symlinkSync(originalRoot, thumbnailAlias);
  const oldAssetRoot = process.env.ASSETS_ROOT;
  const oldThumbnailRoot = process.env.THUMBNAIL_STORAGE_PATH;
  process.env.ASSETS_ROOT = originalRoot;
  process.env.THUMBNAIL_STORAGE_PATH = thumbnailAlias;
  try {
    assert.throws(() => getThumbnailStorageRoot(), /separate from the original asset storage root/);
  } finally {
    if (oldAssetRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = oldAssetRoot;
    if (oldThumbnailRoot === undefined) delete process.env.THUMBNAIL_STORAGE_PATH;
    else process.env.THUMBNAIL_STORAGE_PATH = oldThumbnailRoot;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('generation skips valid thumbnails and repairs missing files', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-thumbnail-generation-'));
  const assetsRoot = path.join(temporaryDirectory, 'assets');
  const thumbnailsRoot = path.join(temporaryDirectory, 'thumbnails');
  fs.mkdirSync(assetsRoot, { recursive: true });
  const sourcePath = path.join(assetsRoot, 'summer flowers final.png');
  fs.writeFileSync(sourcePath, await sharp({
    create: { width: 100, height: 60, channels: 3, background: '#2479bd' },
  }).png().toBuffer());
  const asset = {
    id: 90817,
    title: 'Beautiful Summer Flowers',
    filename: 'summer flowers final.png',
    uploaded_by: 227,
    created_date: '2026-10-02',
  };
  const previousAssetsRoot = process.env.ASSETS_ROOT;
  const previousThumbnailRoot = process.env.THUMBNAIL_STORAGE_PATH;
  const originalQuery = pool.query;
  let record = null;
  let thumbnailUpserts = 0;
  process.env.ASSETS_ROOT = assetsRoot;
  process.env.THUMBNAIL_STORAGE_PATH = thumbnailsRoot;
  pool.query = async (sql, values = []) => {
    if (/SELECT id, title, filename, original_filename, uploaded_by, to_char\(created_at/.test(sql)) {
      return { rows: [asset] };
    }
    if (/SELECT \* FROM asset_thumbnail_metadata/.test(sql)) return { rows: record ? [record] : [] };
    if (/INSERT INTO asset_thumbnail_metadata/.test(sql) && /'PROCESSING'/.test(sql)) {
      thumbnailUpserts += 1;
      record = {
        asset_id: asset.id,
        thumbnail_path: values[1],
        status: 'PROCESSING',
        processor_version: 'webp-proportional-20pct-q37-max50kb-v2',
      };
      return { rows: [] };
    }
    if (/INSERT INTO asset_thumbnail_metadata/.test(sql) && /'READY'/.test(sql)) {
      thumbnailUpserts += 1;
      record = {
        asset_id: asset.id,
        thumbnail_path: values[1],
        format: 'webp',
        width: values[2],
        height: values[3],
        file_size: values[4],
        quality: values[5],
        processor: values[7],
        generated_at: values[6],
        source_size: values[8],
        source_modified_at: values[9],
        processor_version: values[10],
        status: 'READY',
      };
      return { rows: [] };
    }
    if (/UPDATE images/.test(sql)) return { rows: [] };
    throw new Error(`Unexpected test database query: ${sql}`);
  };

  try {
    const first = await generateAssetThumbnail(asset.id);
    const second = await generateAssetThumbnail(asset.id);
    assert.equal(first.status, 'generated');
    assert.equal(second.status, 'already-valid');
    assert.equal(thumbnailUpserts, 2);
    const relativePath = getThumbnailRelativePath({
      assetId: asset.id,
      originalFilename: asset.filename,
      title: asset.title,
      createdAt: asset.created_date,
    });
    const outputPath = path.join(thumbnailsRoot, ...relativePath.split('/'));
    assert.equal(fs.existsSync(outputPath), true);
    fs.unlinkSync(outputPath);
    const regenerated = await generateAssetThumbnail(asset.id);
    const repaired = await generateAssetThumbnail(asset.id);
    assert.equal(regenerated.status, 'regenerated');
    assert.equal(repaired.status, 'already-valid');
    assert.equal(thumbnailUpserts, 4);
    assert.equal(fs.existsSync(outputPath), true);
    const generatedFiles = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else generatedFiles.push(fullPath);
      }
    };
    walk(thumbnailsRoot);
    assert.deepEqual(generatedFiles, [outputPath]);
    const metadata = await sharp(outputPath).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 20);
    assert.equal(metadata.height, 12);
    assert.equal(metadata.width / metadata.height, 100 / 60);
    assert.equal(record.width, metadata.width);
    assert.equal(record.height, metadata.height);
    assert.equal(record.quality, 37);
    assert.equal(record.file_size, fs.statSync(outputPath).size);
    assert.ok(record.file_size <= MAX_THUMBNAIL_BYTES);
    assert.equal(record.processor, 'sharp');
    assert.equal(record.processor_version, PROCESSOR_VERSION);

    const center = await sharp(outputPath).extract({ left: 10, top: 6, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.ok(center[2] > center[0], 'generated thumbnail remains unwatermarked source imagery');
  } finally {
    pool.query = originalQuery;
    if (previousAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = previousAssetsRoot;
    if (previousThumbnailRoot === undefined) delete process.env.THUMBNAIL_STORAGE_PATH;
    else process.env.THUMBNAIL_STORAGE_PATH = previousThumbnailRoot;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('macOS resolves and processes a remote SERVER original with an authenticated staged local source', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-thumbnail-remote-'));
  const thumbnailRoot = path.join(temporaryDirectory, 'thumbnails');
  const source = await sharp({
    create: { width: 100, height: 60, channels: 3, background: '#2479bd' },
  }).png().toBuffer();
  const asset = {
    id: 91801,
    title: 'Remote Original',
    filename: 'contributors/remote image.png',
    original_filename: 'remote image.png',
    created_date: '2026-10-02',
    uploaded_by: 71,
  };
  const restoreEnvironment = preserveEnvironment(['ASSETS_ROOT', 'THUMBNAIL_STORAGE_PATH', 'PC2_ASSET_SERVER_URL', 'JWT_SECRET']);
  const restorePlatform = setPlatform('darwin');
  const originalQuery = pool.query;
  const originalHead = axios.head;
  const originalGet = axios.get;
  const stagedFilesBefore = listStagedSourceFiles();
  process.env.ASSETS_ROOT = '';
  process.env.THUMBNAIL_STORAGE_PATH = thumbnailRoot;
  process.env.PC2_ASSET_SERVER_URL = 'http://100.102.63.63:5000';
  process.env.JWT_SECRET = 'thumbnail-test-secret';
  const observed = {};
  const databaseMock = createThumbnailDatabaseMock(asset, observed);
  pool.query = databaseMock;
  let requestedAuthorization;
  axios.head = async (url, options) => {
    assert.equal(url, 'http://100.102.63.63:5000/api/files/contributors/remote%20image.png');
    requestedAuthorization = options.headers.authorization;
    assert.equal(options.maxRedirects, 0);
    return {
      headers: {
        'content-length': String(source.length),
        'last-modified': 'Fri, 02 Oct 2026 12:00:00 GMT',
      },
    };
  };
  axios.get = async (url, options) => {
    assert.equal(url, 'http://100.102.63.63:5000/api/files/contributors/remote%20image.png');
    assert.equal(options.headers.authorization, requestedAuthorization);
    assert.equal(options.responseType, 'stream');
    return { data: Readable.from([source]) };
  };

  try {
    const sourceInfo = await getAssetSourceInfo(asset.filename, asset.uploaded_by);
    assert.equal(sourceInfo.kind, 'remote');
    assert.equal(sourceInfo.size, source.length);
    const result = await generateAssetThumbnail(asset.id);
    assert.equal(result.status, 'generated');
    assert.match(observed.assetLookupSelect, /\buploaded_by\b/);
    assert.match(requestedAuthorization, /^Bearer /);
    const generatedToken = require('jsonwebtoken').verify(
      requestedAuthorization.slice('Bearer '.length),
      process.env.JWT_SECRET
    );
    assert.equal(generatedToken.user, asset.uploaded_by);
    assert.equal(generatedToken.sid, 'active-contributor-session');
    assert.deepEqual(listStagedSourceFiles(), stagedFilesBefore);
    assert.equal(fs.existsSync(result.thumbnailPath), true);
  } finally {
    pool.query = originalQuery;
    axios.head = originalHead;
    axios.get = originalGet;
    restorePlatform();
    restoreEnvironment();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('macOS keeps using a configured local asset when it exists', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-thumbnail-local-'));
  const assetsRoot = path.join(temporaryDirectory, 'assets');
  const sourcePath = path.join(assetsRoot, 'local.png');
  const restoreEnvironment = preserveEnvironment(['ASSETS_ROOT']);
  const restorePlatform = setPlatform('darwin');
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.writeFileSync(sourcePath, 'local source');
  process.env.ASSETS_ROOT = assetsRoot;

  try {
    const sourceInfo = await getAssetSourceInfo('local.png', 71);
    assert.equal(sourceInfo.kind, 'local');
    assert.equal(sourceInfo.sourcePath, fs.realpathSync(sourcePath));
    assert.equal(sourceInfo.size, Buffer.byteLength('local source'));
  } finally {
    restorePlatform();
    restoreEnvironment();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('Windows production still requires ASSETS_ROOT', async () => {
  const restoreEnvironment = preserveEnvironment(['ASSETS_ROOT', 'NODE_ENV']);
  const restorePlatform = setPlatform('win32');
  delete process.env.ASSETS_ROOT;
  process.env.NODE_ENV = 'production';

  try {
    await assert.rejects(
      getAssetSourceInfo('asset.png', 71),
      /ASSETS_ROOT must be configured in Windows production/
    );
  } finally {
    restorePlatform();
    restoreEnvironment();
  }
});

test('remote SERVER stream failure is clear and removes a partially staged source', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-thumbnail-remote-failure-'));
  const thumbnailRoot = path.join(temporaryDirectory, 'thumbnails');
  const source = Buffer.from('partial source content');
  const asset = {
    id: 91802,
    title: 'Remote Failure',
    filename: 'contributors/broken.png',
    original_filename: 'broken.png',
    created_date: '2026-10-02',
    uploaded_by: 72,
  };
  const restoreEnvironment = preserveEnvironment(['ASSETS_ROOT', 'THUMBNAIL_STORAGE_PATH', 'PC2_ASSET_SERVER_URL', 'JWT_SECRET']);
  const restorePlatform = setPlatform('darwin');
  const originalQuery = pool.query;
  const originalHead = axios.head;
  const originalGet = axios.get;
  const stagedFilesBefore = listStagedSourceFiles();
  const observed = {};
  process.env.ASSETS_ROOT = '';
  process.env.THUMBNAIL_STORAGE_PATH = thumbnailRoot;
  process.env.PC2_ASSET_SERVER_URL = 'http://100.102.63.63:5000';
  process.env.JWT_SECRET = 'thumbnail-test-secret';
  pool.query = createThumbnailDatabaseMock(asset, observed);
  axios.head = async () => ({ headers: { 'content-length': String(source.length) } });
  axios.get = async () => ({
    data: Readable.from((async function* streamSource() {
      yield source;
      throw new Error('connection interrupted');
    }())),
  });

  try {
    await assert.rejects(
      generateAssetThumbnail(asset.id),
      /Failed to stage remote SERVER original: connection interrupted/
    );
    assert.match(observed.failureMessage, /Failed to stage remote SERVER original: connection interrupted/);
    assert.deepEqual(listStagedSourceFiles(), stagedFilesBefore);
  } finally {
    pool.query = originalQuery;
    axios.head = originalHead;
    axios.get = originalGet;
    restorePlatform();
    restoreEnvironment();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('deletion removes the recorded thumbnail without touching originals', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-thumbnail-delete-'));
  const thumbnailsRoot = path.join(temporaryDirectory, 'thumbnails');
  const relativePath = '2026/10/02/source-title_asset-title_775.webp';
  const thumbnailPath = path.join(thumbnailsRoot, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
  fs.writeFileSync(thumbnailPath, 'thumbnail bytes');
  const originalThumbnailRoot = process.env.THUMBNAIL_STORAGE_PATH;
  const originalQuery = pool.query;
  let orphanCleanupCalled = false;
  process.env.THUMBNAIL_STORAGE_PATH = thumbnailsRoot;
  pool.query = async (sql) => {
    if (/SELECT thumbnail_path FROM asset_thumbnail_metadata/.test(sql)) return { rows: [{ thumbnail_path: relativePath }] };
    if (/DELETE FROM asset_thumbnail_orphans/.test(sql)) {
      orphanCleanupCalled = true;
      return { rows: [] };
    }
    throw new Error(`Unexpected test database query: ${sql}`);
  };
  try {
    assert.equal(await deleteAssetThumbnail(775), true);
    assert.equal(fs.existsSync(thumbnailPath), false);
    assert.equal(fs.existsSync(path.join(temporaryDirectory, 'assets')), false);
    assert.equal(orphanCleanupCalled, true);
  } finally {
    pool.query = originalQuery;
    if (originalThumbnailRoot === undefined) delete process.env.THUMBNAIL_STORAGE_PATH;
    else process.env.THUMBNAIL_STORAGE_PATH = originalThumbnailRoot;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('keeps a contributor upload folder when another asset remains', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-contributor-folder-retained-'));
  const contributorDirectory = path.join(temporaryDirectory, 'contributor-a');
  fs.mkdirSync(path.join(contributorDirectory, '2026', '10', 'Approved'), { recursive: true });
  fs.writeFileSync(path.join(contributorDirectory, '2026', '10', 'Approved', 'remaining.jpg'), 'asset');
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  const originalQuery = pool.query;
  process.env.ASSETS_ROOT = temporaryDirectory;
  pool.query = async (sql, values) => {
    assert.match(sql, /COUNT\(i\.id\)::int AS remaining_asset_count/);
    assert.deepEqual(values, [81]);
    return { rows: [{ username: 'contributor-a', role: 'contributor', remaining_asset_count: 1, username_user_count: 1 }] };
  };

  try {
    assert.equal(await deleteContributorUploadFolderIfUnused(81), false);
    assert.equal(fs.existsSync(path.join(contributorDirectory, '2026', '10', 'Approved', 'remaining.jpg')), true);
  } finally {
    pool.query = originalQuery;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('removes only an empty contributor upload folder and preserves other and system folders', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-contributor-folder-delete-'));
  const contributorDirectory = path.join(temporaryDirectory, 'contributor-a');
  fs.mkdirSync(path.join(contributorDirectory, '2026', '10', 'Approved'), { recursive: true });
  fs.writeFileSync(path.join(contributorDirectory, '2026', '10', 'Approved', 'deleted.jpg'), 'asset');
  const otherContributorDirectory = path.join(temporaryDirectory, 'contributor-b');
  const brandingDirectory = path.join(temporaryDirectory, 'branding');
  fs.mkdirSync(otherContributorDirectory);
  fs.mkdirSync(brandingDirectory);
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  const originalQuery = pool.query;
  process.env.ASSETS_ROOT = temporaryDirectory;
  pool.query = async (sql, values) => {
    assert.match(sql, /COUNT\(i\.id\)::int AS remaining_asset_count/);
    assert.deepEqual(values, [82]);
    return { rows: [{ username: 'contributor-a', role: 'contributor', remaining_asset_count: 0, username_user_count: 1 }] };
  };

  try {
    assert.equal(await deleteContributorUploadFolderIfUnused(82), true);
    assert.equal(fs.existsSync(contributorDirectory), false);
    assert.equal(fs.existsSync(otherContributorDirectory), true);
    assert.equal(fs.existsSync(brandingDirectory), true);
  } finally {
    pool.query = originalQuery;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('treats a missing empty contributor upload folder as already cleaned', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-contributor-folder-missing-'));
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  const originalQuery = pool.query;
  process.env.ASSETS_ROOT = temporaryDirectory;
  pool.query = async (sql, values) => {
    assert.match(sql, /COUNT\(i\.id\)::int AS remaining_asset_count/);
    assert.deepEqual(values, [83]);
    return { rows: [{ username: 'contributor-a', role: 'contributor', remaining_asset_count: 0, username_user_count: 1 }] };
  };

  try {
    assert.equal(await deleteContributorUploadFolderIfUnused(83), false);
  } finally {
    pool.query = originalQuery;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('refuses to remove a shared system directory as a contributor folder', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-contributor-folder-system-'));
  const brandingDirectory = path.join(temporaryDirectory, 'branding');
  fs.mkdirSync(brandingDirectory);
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  const originalQuery = pool.query;
  process.env.ASSETS_ROOT = temporaryDirectory;
  pool.query = async () => ({
    rows: [{ username: 'branding', role: 'contributor', remaining_asset_count: 0, username_user_count: 1 }],
  });

  try {
    await assert.rejects(deleteContributorUploadFolderIfUnused(84), /Invalid contributor upload directory name/);
    assert.equal(fs.existsSync(brandingDirectory), true);
  } finally {
    pool.query = originalQuery;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

for (const username of ['branding.', 'website', 'Rejected.', 'settings', 'contributor-a ']) {
  test(`refuses Windows alias or reserved contributor folder name ${username}`, async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-contributor-folder-alias-'));
    const protectedDirectoryName = username.replace(/[.\s]+$/, '');
    const protectedDirectory = path.join(temporaryDirectory, protectedDirectoryName);
    fs.mkdirSync(protectedDirectory);
    const originalAssetsRoot = process.env.ASSETS_ROOT;
    const originalQuery = pool.query;
    process.env.ASSETS_ROOT = temporaryDirectory;
    pool.query = async () => ({
      rows: [{ username, role: 'contributor', remaining_asset_count: 0, username_user_count: 1 }],
    });

    try {
      await assert.rejects(deleteContributorUploadFolderIfUnused(86), /Invalid contributor upload directory name/);
      assert.equal(fs.existsSync(protectedDirectory), true);
    } finally {
      pool.query = originalQuery;
      if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
      else process.env.ASSETS_ROOT = originalAssetsRoot;
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
}

test('keeps a folder when the username maps to more than one user', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-contributor-folder-collision-'));
  const contributorDirectory = path.join(temporaryDirectory, 'contributor-a');
  fs.mkdirSync(contributorDirectory);
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  const originalQuery = pool.query;
  process.env.ASSETS_ROOT = temporaryDirectory;
  pool.query = async () => ({
    rows: [{ username: 'contributor-a', role: 'contributor', remaining_asset_count: 0, username_user_count: 2 }],
  });

  try {
    assert.equal(await deleteContributorUploadFolderIfUnused(85), false);
    assert.equal(fs.existsSync(contributorDirectory), true);
  } finally {
    pool.query = originalQuery;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('serializes same-contributor uploads and cleanup while allowing another contributor concurrently', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-contributor-folder-lock-'));
  const contributorDirectory = path.join(temporaryDirectory, 'contributor-a');
  fs.mkdirSync(contributorDirectory);
  const originalAssetsRoot = process.env.ASSETS_ROOT;
  const originalQuery = pool.query;
  process.env.ASSETS_ROOT = temporaryDirectory;
  let cleanupQueryStarted = false;
  let notifyCleanupQueryStarted;
  const cleanupQueryStartedPromise = new Promise((resolve) => {
    notifyCleanupQueryStarted = resolve;
  });
  pool.query = async () => {
    cleanupQueryStarted = true;
    notifyCleanupQueryStarted();
    return {
      rows: [{ username: 'contributor-a', role: 'contributor', remaining_asset_count: 0, username_user_count: 1 }],
    };
  };

  let releaseUpload;
  let releaseWaitingUpload;
  let releaseOtherContributor;
  try {
    releaseUpload = await acquireContributorUploadLock(87);
    const cleanup = deleteContributorUploadFolderIfUnused(87);
    let waitingUploadAcquired = false;
    const waitingUpload = acquireContributorUploadLock(87).then((releaseLock) => {
      waitingUploadAcquired = true;
      releaseWaitingUpload = releaseLock;
    });
    assert.equal(cleanupQueryStarted, false);

    releaseOtherContributor = await acquireContributorUploadLock(88);
    assert.equal(cleanupQueryStarted, false);
    assert.equal(waitingUploadAcquired, false);
    releaseUpload();
    await cleanupQueryStartedPromise;
    assert.equal(await cleanup, true);
    await waitingUpload;
    assert.equal(waitingUploadAcquired, true);
    assert.equal(fs.existsSync(contributorDirectory), false);
  } finally {
    releaseUpload?.();
    releaseWaitingUpload?.();
    releaseOtherContributor?.();
    pool.query = originalQuery;
    if (originalAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetsRoot;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('records a retryable orphan when thumbnail storage is unavailable during deletion', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-thumbnail-delete-failure-'));
  const unavailableRoot = path.join(temporaryDirectory, 'unmounted-thumbnails');
  const relativePath = '2026/10/02/source-title_asset-title_776.webp';
  const originalThumbnailRoot = process.env.THUMBNAIL_STORAGE_PATH;
  const originalAssetRoot = process.env.ASSETS_ROOT;
  const originalQuery = pool.query;
  let orphanRecorded = false;
  process.env.THUMBNAIL_STORAGE_PATH = unavailableRoot;
  process.env.ASSETS_ROOT = path.join(temporaryDirectory, 'assets');
  pool.query = async (sql) => {
    if (/SELECT thumbnail_path FROM asset_thumbnail_metadata/.test(sql)) return { rows: [{ thumbnail_path: relativePath }] };
    if (/INSERT INTO asset_thumbnail_orphans/.test(sql)) {
      orphanRecorded = true;
      return { rows: [] };
    }
    throw new Error(`Unexpected test database query: ${sql}`);
  };

  try {
    assert.equal(await deleteAssetThumbnail(776), false);
    assert.equal(orphanRecorded, true);
    assert.equal(fs.existsSync(unavailableRoot), false);
  } finally {
    pool.query = originalQuery;
    if (originalThumbnailRoot === undefined) delete process.env.THUMBNAIL_STORAGE_PATH;
    else process.env.THUMBNAIL_STORAGE_PATH = originalThumbnailRoot;
    if (originalAssetRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = originalAssetRoot;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('records failed thumbnail deletion for orphan retry', async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-thumbnail-delete-failure-'));
  const thumbnailsRoot = path.join(temporaryDirectory, 'thumbnails');
  const relativePath = '2026/10/02/source-title_asset-title_776.webp';
  const thumbnailDirectory = path.join(thumbnailsRoot, ...relativePath.split('/'));
  fs.mkdirSync(thumbnailDirectory, { recursive: true });
  const previousThumbnailRoot = process.env.THUMBNAIL_STORAGE_PATH;
  const originalQuery = pool.query;
  let orphanRecord = null;
  process.env.THUMBNAIL_STORAGE_PATH = thumbnailsRoot;
  pool.query = async (sql, values = []) => {
    if (/SELECT thumbnail_path FROM asset_thumbnail_metadata/.test(sql)) return { rows: [{ thumbnail_path: relativePath }] };
    if (/INSERT INTO asset_thumbnail_orphans/.test(sql)) {
      orphanRecord = values;
      return { rows: [] };
    }
    throw new Error(`Unexpected test database query: ${sql}`);
  };
  try {
    assert.equal(await deleteAssetThumbnail(776), false);
    assert.equal(orphanRecord?.[0], 776);
    assert.equal(orphanRecord?.[1], relativePath);
    assert.equal(fs.existsSync(thumbnailDirectory), true);
  } finally {
    pool.query = originalQuery;
    if (previousThumbnailRoot === undefined) delete process.env.THUMBNAIL_STORAGE_PATH;
    else process.env.THUMBNAIL_STORAGE_PATH = previousThumbnailRoot;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
