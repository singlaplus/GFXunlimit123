const fs = require('node:fs/promises');
const path = require('node:path');

class AssetVideoPreviewDeletionError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'AssetVideoPreviewDeletionError';
    this.statusCode = statusCode;
  }
}

async function removePreviewFile(assetId, relativePath, assetThumbnails) {
  const safeRelativePath = assetThumbnails.normalizeThumbnailRelativePath(relativePath, assetId);
  const root = assetThumbnails.getThumbnailStorageRoot(safeRelativePath);
  const filePath = assetThumbnails.getThumbnailFilePath(assetId, root, safeRelativePath);
  const stats = await fs.lstat(filePath).catch((error) => {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
    throw error;
  });
  if (!stats) return;
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    !(await assetThumbnails.isThumbnailPathInsideRoot(filePath, root))
  ) {
    throw new AssetVideoPreviewDeletionError('Generated preview file is not safe to delete.');
  }
  await fs.unlink(filePath);
}

async function restoreMetadata(client, assetId, metadata) {
  await client.query('BEGIN');
  try {
    await client.query(
      'UPDATE asset_thumbnail_metadata SET video_preview_metadata = $1::jsonb, updated_at = NOW() WHERE asset_id = $2',
      [JSON.stringify(metadata), assetId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => {
      console.error(`Could not roll back preview metadata restoration for asset ${assetId}:`, rollbackError);
    });
    throw error;
  }
}

async function deleteAssetVideoPreview(assetId, variant, frameIndex, dependencies) {
  const id = Number(assetId);
  const { pool, assetThumbnails } = dependencies;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AssetVideoPreviewDeletionError('Invalid asset ID.', 400);
  }
  if (!['frame', 'optimized'].includes(variant)) {
    throw new AssetVideoPreviewDeletionError('Invalid video preview type.', 400);
  }
  if (variant === 'frame' && (!Number.isInteger(frameIndex) || frameIndex < 1 || frameIndex > 6)) {
    throw new AssetVideoPreviewDeletionError('Invalid video frame index.', 400);
  }

  const releaseAssetLock = await assetThumbnails.acquireAssetLifecycleLock(id);
  let client;
  let advisoryLocked = false;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('SELECT pg_advisory_lock($1)', [id]);
    advisoryLocked = true;
    await client.query('BEGIN');
    transactionStarted = true;

    const assetResult = await client.query(
      'SELECT id, filename FROM images WHERE id = $1 FOR UPDATE',
      [id]
    );
    const asset = assetResult.rows[0];
    if (!asset) throw new AssetVideoPreviewDeletionError('Video asset not found.', 404);
    if (!assetThumbnails.VIDEO_EXTENSIONS.has(path.extname(asset.filename || '').toLowerCase())) {
      throw new AssetVideoPreviewDeletionError('Asset is not a video.', 404);
    }

    const metadataResult = await client.query(
      `SELECT status, video_preview_metadata
       FROM asset_thumbnail_metadata
       WHERE asset_id = $1
       FOR UPDATE`,
      [id]
    );
    const metadataRow = metadataResult.rows[0];
    if (!metadataRow || metadataRow.status !== 'READY') {
      throw new AssetVideoPreviewDeletionError('Generated video preview not found.', 404);
    }
    let metadata = metadataRow.video_preview_metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch {
        metadata = null;
      }
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new AssetVideoPreviewDeletionError('Generated video preview metadata is invalid.');
    }

    const nextMetadata = { ...metadata };
    let relativePath;
    if (variant === 'frame') {
      const frames = Array.isArray(metadata.frames) ? [...metadata.frames] : [];
      const [frame] = frames.splice(frameIndex - 1, 1);
      relativePath = frame?.path;
      if (typeof relativePath !== 'string' || !relativePath.trim()) {
        throw new AssetVideoPreviewDeletionError('Generated video thumbnail not found.', 404);
      }
      nextMetadata.frames = frames;
    } else {
      relativePath = metadata.optimizedVideo?.path;
      if (typeof relativePath !== 'string' || !relativePath.trim()) {
        throw new AssetVideoPreviewDeletionError('Generated video preview not found.', 404);
      }
      nextMetadata.optimizedVideo = null;
    }

    assetThumbnails.normalizeThumbnailRelativePath(relativePath, id);
    await client.query(
      'UPDATE asset_thumbnail_metadata SET video_preview_metadata = $1::jsonb, updated_at = NOW() WHERE asset_id = $2',
      [JSON.stringify(nextMetadata), id]
    );
    await client.query('COMMIT');
    transactionStarted = false;

    try {
      await removePreviewFile(id, relativePath, assetThumbnails);
    } catch (cleanupError) {
      try {
        await restoreMetadata(client, id, metadata);
      } catch (restoreError) {
        console.error(`Could not restore preview metadata after failed file removal for asset ${id}:`, restoreError);
        throw new AssetVideoPreviewDeletionError(
          'Preview metadata was removed, but the file could not be deleted or restored. Contact support.'
        );
      }
      throw new AssetVideoPreviewDeletionError(
        'Could not delete the generated preview file. The preview has been restored.',
        500
      );
    }

    try {
      await pool.query(
        'DELETE FROM asset_thumbnail_orphans WHERE asset_id = $1 AND thumbnail_path = $2',
        [id, relativePath]
      );
    } catch (error) {
      console.error(`Deleted preview file but could not clear its orphan record for asset ${id}:`, error);
      return { deleted: true, cleanupPending: true };
    }

    return { deleted: true, cleanupPending: false };
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error(`Could not roll back preview deletion for asset ${id}:`, rollbackError);
      });
    }
    throw error;
  } finally {
    if (advisoryLocked) {
      await client.query('SELECT pg_advisory_unlock($1)', [id]).catch((unlockError) => {
        console.error(`Could not release preview deletion lock for asset ${id}:`, unlockError);
      });
    }
    client?.release();
    releaseAssetLock();
  }
}

module.exports = {
  AssetVideoPreviewDeletionError,
  deleteAssetVideoPreview,
};
