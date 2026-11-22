const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/blockPostgres');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {
  extractVideoPreview,
  generateThumbnailPreview,
  generateOptimizedVideoPreview,
  generateProductionVideoPreviews,
  generateAssetThumbnail,
  getVideoPreviewFrameCount,
} = require('../utils/assetThumbnails');
const assetStorageConnections = require('../services/assetStorageConnections');
const assetStorageCardConnections = require('../services/assetStorageCardConnections');
const thumbnailGenerationSettings = require('../services/thumbnailGenerationSettings');
const pool = require('../db');

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffmpegAvailable = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0;
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const ffprobeAvailable = spawnSync(ffprobe, ['-version'], { stdio: 'ignore' }).status === 0;
const libx264Available = ffmpegAvailable &&
  spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout.includes('libx264');

test('chooses 3 frames up to 10 seconds, 4 up to 20, and caps long videos at 6', () => {
  assert.equal(getVideoPreviewFrameCount(10), 3);
  assert.equal(getVideoPreviewFrameCount(20), 4);
  assert.equal(getVideoPreviewFrameCount(40), 6);
});

test('extracts a frame from a video shorter than one second', {
  skip: !ffmpegAvailable && 'FFmpeg is required to extract video frames',
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-video-thumbnail-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'short.mp4');
  const createVideo = spawnSync(ffmpeg, [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', 'color=c=red:s=64x48:d=0.25',
    '-frames:v', '8',
    '-c:v', 'mpeg4',
    '-threads', '1',
    '-y', sourcePath,
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(createVideo.status, 0, createVideo.stderr);

  const preview = await extractVideoPreview(sourcePath);
  const metadata = await sharp(preview).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 48);
});

test('generates a WebP thumbnail for a video sample using video settings', {
  skip: !ffmpegAvailable && 'FFmpeg is required to generate video previews',
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-video-preview-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'sample.mov');
  const createVideo = spawnSync(ffmpeg, [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', 'color=c=blue:s=64x48:d=1',
    '-frames:v', '8',
    '-c:v', 'mpeg4',
    '-threads', '1',
    '-y', sourcePath,
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(createVideo.status, 0, createVideo.stderr);

  const result = await generateThumbnailPreview(sourcePath, {
    quality: 65,
    maxFileSizeKb: 50,
    dimensionPercent: 50,
    formats: ['video'],
  });
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 32);
  assert.equal(metadata.height, 24);
  assert.equal(result.quality, 65);
});

test('generates multiple WebP frames and enables original video playback when selected', {
  skip: (!ffmpegAvailable || !ffprobeAvailable) && 'FFmpeg and FFprobe are required for video frame previews',
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-video-multiple-preview-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'sample.mp4');
  const createVideo = spawnSync(ffmpeg, [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', 'color=c=green:s=64x48:d=1',
    '-frames:v', '8',
    '-c:v', 'mpeg4',
    '-threads', '1',
    '-y', sourcePath,
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(createVideo.status, 0, createVideo.stderr);

  const result = await generateThumbnailPreview(sourcePath, {
    quality: 65,
    maxFileSizeKb: 50,
    dimensionPercent: 50,
    formats: ['video'],
    multipleVideoThumbnails: true,
    includeVideoPreview: true,
  });

  assert.equal(result.previews.length, 3);
  assert.equal(result.videoPreview, true);
  assert.ok(result.previews.every((preview) => preview.format === 'webp'));
});

test('generates a smaller MP4 preview within the configured size and resolution limits', {
  skip: (!ffmpegAvailable || !ffprobeAvailable || !libx264Available) &&
    'FFmpeg with libx264 and FFprobe are required for optimized video previews',
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-video-optimized-preview-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'source.mp4');
  const outputPath = path.join(directory, 'source-preview.mp4');
  const createVideo = spawnSync(ffmpeg, [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', 'color=c=purple:s=1280x720:d=1',
    '-frames:v', '24',
    '-c:v', 'mpeg4',
    '-threads', '1',
    '-y', sourcePath,
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(createVideo.status, 0, createVideo.stderr);

  const settings = {
    quality: 65,
    maxFileSizeKb: 50,
    dimensionPercent: 50,
    formats: ['video'],
    includeVideoPreview: true,
    generateOptimizedVideoPreview: true,
    videoQuality: 60,
    videoMaxHeight: 480,
    videoMaxFileSizeMb: 1,
  };
  const result = await generateOptimizedVideoPreview(sourcePath, settings, outputPath);
  const probe = spawnSync(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height',
    '-of', 'json', outputPath,
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(probe.status, 0, probe.stderr);
  const stream = JSON.parse(probe.stdout).streams[0];
  assert.equal(stream.codec_name, 'h264');
  assert.equal(stream.height, 480);
  assert.ok(result.sizeBytes <= 1024 * 1024);
  assert.equal(result.format, 'mp4');
  assert.notEqual((await fs.stat(sourcePath)).size, result.sizeBytes);
});

test('persists production video frame and MP4 derivatives with metadata paths', {
  skip: (!ffmpegAvailable || !ffprobeAvailable || !libx264Available) &&
    'FFmpeg with libx264 and FFprobe are required for production video previews',
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-production-video-preview-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'source.mp4');
  const createVideo = spawnSync(ffmpeg, [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', 'color=c=orange:s=1280x720:d=1',
    '-frames:v', '24',
    '-c:v', 'mpeg4',
    '-threads', '1',
    '-y', sourcePath,
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(createVideo.status, 0, createVideo.stderr);

  const getConfiguredStorageRoots = assetStorageConnections.getConfiguredStorageRoots;
  const getConnectedLocations = assetStorageCardConnections.getConnectedLocations;
  assetStorageConnections.getConfiguredStorageRoots = () => ({
    thumbnailStoragePath: directory,
    thumbnailLocations: [{ id: 'test-thumbnail-root', path: directory }],
    defaultThumbnailLocationId: 'test-thumbnail-root',
  });
  assetStorageCardConnections.getConnectedLocations = (_storage, locations) => locations;
  t.after(() => {
    assetStorageConnections.getConfiguredStorageRoots = getConfiguredStorageRoots;
    assetStorageCardConnections.getConnectedLocations = getConnectedLocations;
  });

  const result = await generateProductionVideoPreviews({
    assetId: 123,
    sourcePath,
    sourceDimensions: { width: 1280, height: 720 },
    thumbnailPath: '2026/10/02/clip_123.webp',
    settings: {
      quality: 65,
      maxFileSizeKb: 50,
      dimensionPercent: 50,
      multipleVideoThumbnails: true,
      includeVideoPreview: true,
      generateOptimizedVideoPreview: true,
      videoQuality: 60,
      videoMaxHeight: 480,
      videoMaxFileSizeMb: 1,
    },
  });

  assert.equal(result.metadata.frames.length, 3);
  assert.ok(result.metadata.optimizedVideo);
  assert.equal(result.createdPaths.length, 4);
  for (const relativePath of result.createdPaths) {
    const filePath = path.join(directory, ...relativePath.split('/'));
    assert.ok((await fs.stat(filePath)).isFile());
  }
  assert.equal(result.metadata.warning, null);
});

test('production thumbnail generation stores active video derivative metadata', {
  skip: (!ffmpegAvailable || !ffprobeAvailable || !libx264Available) &&
    'FFmpeg with libx264 and FFprobe are required for production video previews',
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-production-video-job-'));
  const assetsRoot = path.join(directory, 'assets');
  const thumbnailsRoot = path.join(directory, 'thumbnails');
  await fs.mkdir(assetsRoot, { recursive: true });
  await fs.mkdir(thumbnailsRoot, { recursive: true });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(assetsRoot, 'source.mp4');
  const createVideo = spawnSync(ffmpeg, [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', 'color=c=teal:s=1280x720:d=1',
    '-frames:v', '24',
    '-c:v', 'mpeg4',
    '-threads', '1',
    '-y', sourcePath,
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(createVideo.status, 0, createVideo.stderr);

  const originals = {
    configuredRoots: assetStorageConnections.getConfiguredStorageRoots,
    assetsConnected: assetStorageConnections.isAssetsConnected,
    thumbnailsConnected: assetStorageConnections.isThumbnailsConnected,
    connectedLocations: assetStorageCardConnections.getConnectedLocations,
    activeSettings: thumbnailGenerationSettings.getActiveSettings,
    query: pool.query,
  };
  const asset = {
    id: 12345,
    title: 'Production clip',
    filename: 'source.mp4',
    original_filename: 'source.mp4',
    uploaded_by: 1,
    created_date: '2026-10-02',
  };
  const settings = {
    formats: ['video'],
    formatSettings: {
      video: {
        quality: 65,
        maxFileSizeKb: 50,
        dimensionPercent: 50,
        multipleVideoThumbnails: true,
        includeVideoPreview: true,
        generateOptimizedVideoPreview: true,
        videoQuality: 60,
        videoMaxHeight: 480,
        videoMaxFileSizeMb: 1,
      },
    },
  };
  let savedMetadata = null;
  assetStorageConnections.getConfiguredStorageRoots = () => ({
    assetsRoot,
    thumbnailStoragePath: thumbnailsRoot,
    assetLocations: [{ id: 'test-assets', path: assetsRoot }],
    thumbnailLocations: [{ id: 'test-thumbnails', path: thumbnailsRoot }],
    defaultAssetLocationId: 'test-assets',
    defaultThumbnailLocationId: 'test-thumbnails',
  });
  assetStorageConnections.isAssetsConnected = () => true;
  assetStorageConnections.isThumbnailsConnected = () => true;
  assetStorageCardConnections.getConnectedLocations = (_storage, locations) => locations;
  thumbnailGenerationSettings.getActiveSettings = () => settings;
  pool.query = async (sql, values = []) => {
    if (/SELECT id, title, filename, original_filename, uploaded_by, to_char\(created_at/.test(sql)) {
      return { rows: [asset] };
    }
    if (/SELECT \* FROM asset_thumbnail_metadata/.test(sql)) return { rows: [] };
    if (/INSERT INTO asset_thumbnail_metadata/.test(sql) && /'PROCESSING'/.test(sql)) return { rows: [] };
    if (/INSERT INTO asset_thumbnail_metadata/.test(sql) && /'READY'/.test(sql)) {
      savedMetadata = JSON.parse(values[8]);
      return { rows: [] };
    }
    if (/UPDATE images/.test(sql)) return { rows: [] };
    throw new Error(`Unexpected production video test query: ${sql}`);
  };
  t.after(() => {
    assetStorageConnections.getConfiguredStorageRoots = originals.configuredRoots;
    assetStorageConnections.isAssetsConnected = originals.assetsConnected;
    assetStorageConnections.isThumbnailsConnected = originals.thumbnailsConnected;
    assetStorageCardConnections.getConnectedLocations = originals.connectedLocations;
    thumbnailGenerationSettings.getActiveSettings = originals.activeSettings;
    pool.query = originals.query;
  });

  const result = await generateAssetThumbnail(asset.id);
  assert.equal(result.status, 'generated');
  assert.equal(result.videoPreviewMetadata.frames.length, 3);
  assert.ok(result.videoPreviewMetadata.optimizedVideo);
  assert.deepEqual(savedMetadata, result.videoPreviewMetadata);
  assert.equal(result.videoPreviewMetadata.warning, null);
});
