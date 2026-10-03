const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {
  HARD_TARGET_BYTES,
  encodeThumbnail,
  getThumbnailFilename,
  getThumbnailFilePath,
  getThumbnailRelativePath,
  getDateDirectory,
  parseThumbnailAssetId,
  getThumbnailCacheControl,
  getThumbnailStorageRoot,
  isValidThumbnailFile,
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
const { planOrphanThumbnailFiles } = require('../scripts/thumbnail-cli-utils');
const pool = require('../db');
const ProcessorDetector = require('../thumbnail-engine/processor-detector');

test('encodes a square source into a 16:9 WebP canvas with neutral padding', async () => {
  const source = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ff0000"/></svg>'
  );
  const result = await encodeThumbnail(source);
  const metadata = await sharp(result.buffer).metadata();
  const corner = await sharp(result.buffer).extract({ left: 2, top: 2, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const center = await sharp(result.buffer).extract({ left: 320, top: 180, width: 1, height: 1 }).removeAlpha().raw().toBuffer();

  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 640);
  assert.equal(metadata.height, 360);
  assert.equal(result.quality, 60);
  assert.ok(Math.abs(corner[0] - 232) <= 10);
  assert.ok(Math.abs(corner[1] - 234) <= 10);
  assert.ok(Math.abs(corner[2] - 237) <= 10);
  assert.ok(center[0] > 200 && center[1] < 40 && center[2] < 40);
  assert.ok(result.buffer.length <= 75 * 1024);
});

test('does not enlarge a small portrait source and preserves its proportions', async () => {
  const source = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="160"><rect width="80" height="160" fill="#0000ff"/></svg>'
  );
  const result = await encodeThumbnail(source);
  const metadata = await sharp(result.buffer).metadata();
  const top = await sharp(result.buffer).extract({ left: 320, top: 120, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const outside = await sharp(result.buffer).extract({ left: 200, top: 180, width: 1, height: 1 }).removeAlpha().raw().toBuffer();

  assert.equal(metadata.width, 640);
  assert.equal(metadata.height, 360);
  assert.ok(top[2] > 180);
  assert.ok(outside[0] > 200 && outside[2] > 200);
});

test('fits 4:3 and extremely wide sources without cropping into a 16:9 presentation', async () => {
  const landscapeSource = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#ff0000"/></svg>'
  );
  const wideSource = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="40"><rect width="400" height="40" fill="#0000ff"/></svg>'
  );
  const landscape = await encodeThumbnail(landscapeSource);
  const wide = await encodeThumbnail(wideSource);
  const landscapeMetadata = await sharp(landscape.buffer).metadata();
  const wideMetadata = await sharp(wide.buffer).metadata();
  const landscapeEdge = await sharp(landscape.buffer).extract({ left: 2, top: 180, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const landscapeCenter = await sharp(landscape.buffer).extract({ left: 320, top: 180, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const wideCenter = await sharp(wide.buffer).extract({ left: 320, top: 180, width: 1, height: 1 }).removeAlpha().raw().toBuffer();

  assert.equal(landscapeMetadata.width / landscapeMetadata.height, 16 / 9);
  assert.equal(wideMetadata.width / wideMetadata.height, 16 / 9);
  assert.ok(landscapeEdge[0] > 210 && landscapeEdge[1] > 210, '4:3 source has neutral side padding rather than a crop');
  assert.ok(landscapeCenter[0] > 200 && landscapeCenter[1] < 40, '4:3 source content remains centered');
  assert.ok(wideCenter[0] < 40 && wideCenter[1] < 40, 'extremely wide source content remains centered in the canvas');
});

test('adapts quality and dimensions for high-entropy images within the hard size target', async () => {
  const randomPixels = crypto.randomBytes(640 * 360 * 3);
  const source = await sharp(randomPixels, {
    raw: { width: 640, height: 360, channels: 3 },
  }).png().toBuffer();
  const result = await encodeThumbnail(source);
  const metadata = await sharp(result.buffer).metadata();

  assert.ok(result.quality <= 60);
  assert.ok(result.width < 640 || result.quality < 60, 'compression adapts instead of blindly keeping quality 60');
  assert.ok(result.buffer.length <= HARD_TARGET_BYTES);
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width / metadata.height, 16 / 9);
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
  const linkPath = path.join(temporaryDirectory, 'link.webp');
  try {
    const validImage = await sharp({
      create: { width: 16, height: 9, channels: 3, background: '#8899aa' },
    }).webp().toBuffer();
    fs.writeFileSync(targetPath, validImage);
    fs.symlinkSync(targetPath, linkPath);
    assert.equal(await isValidThumbnailFile(targetPath), true);
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

test('generation skips a valid existing thumbnail instead of creating a duplicate', async () => {
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
    if (/SELECT id, title, filename, original_filename, to_char\(created_at/.test(sql)) {
      return { rows: [asset] };
    }
    if (/SELECT \* FROM asset_thumbnail_metadata/.test(sql)) return { rows: record ? [record] : [] };
    if (/INSERT INTO asset_thumbnail_metadata/.test(sql) && /'PROCESSING'/.test(sql)) {
      thumbnailUpserts += 1;
      record = {
        asset_id: asset.id,
        thumbnail_path: values[1],
        status: 'PROCESSING',
        processor_version: 'webp-16x9-v1',
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
    assert.ok(metadata.width <= 640 && metadata.height <= 360);
    assert.ok(fs.statSync(outputPath).size <= HARD_TARGET_BYTES);
  } finally {
    pool.query = originalQuery;
    if (previousAssetsRoot === undefined) delete process.env.ASSETS_ROOT;
    else process.env.ASSETS_ROOT = previousAssetsRoot;
    if (previousThumbnailRoot === undefined) delete process.env.THUMBNAIL_STORAGE_PATH;
    else process.env.THUMBNAIL_STORAGE_PATH = previousThumbnailRoot;
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
