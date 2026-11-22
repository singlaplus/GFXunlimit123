const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assetThumbnails = require('../utils/assetThumbnails');
const { deleteAssetVideoPreview } = require('../services/assetVideoPreviewDeletion');

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gfx-video-preview-delete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const generationId = 'c0a80123-4567-489a-bcde-123456789abc';
  const framePaths = [1, 2].map((index) =>
    `2026/10/02/clip_42-frame-${index}-${generationId}.webp`
  );
  const optimizedPath = `2026/10/02/clip_42-preview-${generationId}.mp4`;
  for (const relativePath of [...framePaths, optimizedPath]) {
    const filePath = assetThumbnails.getThumbnailFilePath(42, root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, relativePath);
  }

  const state = {
    metadata: {
      frames: framePaths.map((previewPath, index) => ({
        path: previewPath,
        timestamp: index * 3,
      })),
      optimizedVideo: { path: optimizedPath, format: 'mp4' },
    },
  };
  const client = {
    async query(sql, values = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (/^SELECT pg_advisory_(lock|unlock)/.test(sql)) return { rows: [{}] };
      if (/SELECT id, filename FROM images/.test(sql)) {
        return { rows: [{ id: 42, filename: 'clip.mp4' }] };
      }
      if (/SELECT status, video_preview_metadata/.test(sql)) {
        return { rows: [{ status: 'READY', video_preview_metadata: state.metadata }] };
      }
      if (/UPDATE asset_thumbnail_metadata SET video_preview_metadata/.test(sql)) {
        state.metadata = JSON.parse(values[0]);
        return { rows: [] };
      }
      throw new Error(`Unexpected client query: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
    async query(sql) {
      if (/DELETE FROM asset_thumbnail_orphans/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };
  const thumbnails = {
    VIDEO_EXTENSIONS: assetThumbnails.VIDEO_EXTENSIONS,
    acquireAssetLifecycleLock: async () => () => {},
    normalizeThumbnailRelativePath: assetThumbnails.normalizeThumbnailRelativePath,
    getThumbnailStorageRoot: () => root,
    getThumbnailFilePath: assetThumbnails.getThumbnailFilePath,
    isThumbnailPathInsideRoot: assetThumbnails.isThumbnailPathInsideRoot,
  };
  return {
    root,
    framePaths,
    optimizedPath,
    state,
    dependencies: { pool, assetThumbnails: thumbnails },
  };
}

test('removes only the selected generated frame and updates its metadata', async (t) => {
  const fixture = await createFixture(t);
  const result = await deleteAssetVideoPreview(42, 'frame', 1, fixture.dependencies);

  assert.deepEqual(result, { deleted: true, cleanupPending: false });
  assert.deepEqual(fixture.state.metadata.frames.map((frame) => frame.path), [fixture.framePaths[1]]);
  await assert.rejects(fs.access(path.join(fixture.root, fixture.framePaths[0])), { code: 'ENOENT' });
  await fs.access(path.join(fixture.root, fixture.framePaths[1]));
  await fs.access(path.join(fixture.root, fixture.optimizedPath));
});

test('removes the optimized video while preserving all generated frames', async (t) => {
  const fixture = await createFixture(t);
  const result = await deleteAssetVideoPreview(42, 'optimized', null, fixture.dependencies);

  assert.deepEqual(result, { deleted: true, cleanupPending: false });
  assert.equal(fixture.state.metadata.optimizedVideo, null);
  assert.equal(fixture.state.metadata.frames.length, 2);
  await assert.rejects(fs.access(path.join(fixture.root, fixture.optimizedPath)), { code: 'ENOENT' });
  for (const framePath of fixture.framePaths) {
    await fs.access(path.join(fixture.root, framePath));
  }
});
