const fs = require('node:fs');
const path = require('node:path');

class AssetDeletionError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'AssetDeletionError';
    this.statusCode = statusCode;
  }
}

function resolveAssetFilePath(assetRoot, filename) {
  if (typeof filename !== 'string' || !filename.trim()) {
    throw new AssetDeletionError('Asset file path is invalid.', 500);
  }
  const root = path.resolve(assetRoot);
  const filePath = path.resolve(root, filename);
  const relativePath = path.relative(root, filePath);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new AssetDeletionError('Asset file path is invalid.', 500);
  }
  return { root, filePath };
}

async function removeAssetFile(assetRoot, filename, fileSystem = fs.promises) {
  const { root, filePath } = resolveAssetFilePath(assetRoot, filename);
  let stats;
  try {
    stats = await fileSystem.lstat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return;
    throw error;
  }
  if (!stats.isFile() && !stats.isSymbolicLink()) {
    throw new AssetDeletionError('Asset path is not a file.', 500);
  }
  const [realRoot, realFilePath] = await Promise.all([
    fileSystem.realpath(root),
    fileSystem.realpath(filePath)
  ]);
  const relativeRealPath = path.relative(realRoot, realFilePath);
  if (!relativeRealPath || relativeRealPath === '..' || relativeRealPath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRealPath)) {
    throw new AssetDeletionError('Asset file resolves outside asset storage.', 500);
  }
  await fileSystem.unlink(filePath);
}

async function deleteAssetCompletely(assetId, requesterId, dependencies, options = {}) {
  const id = Number(assetId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AssetDeletionError('Invalid asset ID.', 400);
  const { pool, assetThumbnails, thumbnailQueue } = dependencies;
  const releaseAssetLock = await assetThumbnails.acquireAssetLifecycleLock(id);
  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    const assetResult = await client.query(
      `SELECT id, filename, uploaded_by, title, status FROM images WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const asset = assetResult.rows[0];
    if (!asset) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return { deleted: false, notFound: true };
    }

    const requesterResult = await client.query('SELECT role FROM users WHERE id = $1', [requesterId]);
    const requesterRole = String(requesterResult.rows[0]?.role || '').toLowerCase();
    const requesterIsAdmin = requesterRole === 'admin';
    const requesterIsOwner = Number(asset.uploaded_by) === Number(requesterId);
    if (!options.internal && !requesterIsAdmin && !requesterIsOwner) {
      throw new AssetDeletionError('Image not found.', 404);
    }
    if (
      !options.internal &&
      requesterIsOwner &&
      !requesterIsAdmin &&
      !['not_submitted', 'draft'].includes(String(asset.status || '').toLowerCase())
    ) {
      throw new AssetDeletionError('Contributors can delete only not-submitted assets.', 403);
    }

    if (typeof thumbnailQueue?.cancelAssetThumbnailJobs === 'function') {
      await thumbnailQueue.cancelAssetThumbnailJobs(id);
    }

    const thumbnailResult = await client.query(
      'SELECT thumbnail_path FROM asset_thumbnail_metadata WHERE asset_id = $1',
      [id]
    );
    const thumbnailDeleted = await assetThumbnails.deleteAssetThumbnail(
      id,
      thumbnailResult.rows[0]?.thumbnail_path
    );
    if (!thumbnailDeleted) {
      throw new AssetDeletionError(`Thumbnail cleanup failed for asset ${id}.`, 500);
    }

    const orphanResult = await client.query(
      'SELECT thumbnail_path FROM asset_thumbnail_orphans WHERE asset_id = $1',
      [id]
    );
    for (const orphan of orphanResult.rows) {
      const orphanDeleted = await assetThumbnails.deleteAssetThumbnail(id, orphan.thumbnail_path);
      if (!orphanDeleted) {
        throw new AssetDeletionError(`Thumbnail cleanup failed for asset ${id}.`, 500);
      }
    }

    await removeAssetFile(assetThumbnails.getOriginalAssetStorageRoot(), asset.filename);
    await client.query('DELETE FROM favorites WHERE image_id = $1', [id]);
    await client.query('DELETE FROM downloads WHERE image_id = $1', [id]);
    await client.query('DELETE FROM asset_processing_jobs WHERE asset_id = $1', [id]);
    await client.query('DELETE FROM asset_thumbnail_metadata WHERE asset_id = $1', [id]);
    await client.query('DELETE FROM asset_thumbnail_orphans WHERE asset_id = $1', [id]);
    const deletedAsset = await client.query('DELETE FROM images WHERE id = $1 RETURNING id', [id]);
    if (!deletedAsset.rows[0]) throw new AssetDeletionError('Asset disappeared during deletion.', 409);
    await client.query('COMMIT');
    transactionStarted = false;
    return { deleted: true, asset };
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error(`Failed to roll back asset deletion ${id}:`, rollbackError);
      });
    }
    throw error;
  } finally {
    client?.release();
    releaseAssetLock();
  }
}

module.exports = {
  AssetDeletionError,
  deleteAssetCompletely,
  removeAssetFile,
  resolveAssetFilePath,
};
