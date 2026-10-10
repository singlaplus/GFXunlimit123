const fs = require('node:fs');
const {
  recoverPendingAssetLifecycleOperations,
  recoverLifecycleOperation,
  removeContainedFile,
  setOperationState,
} = require('./assetLifecycleOperations');

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
  try {
    const { resolvedRoot, resolvedPath } = require('./assetLifecycleOperations').resolveRelativePath(assetRoot, filename);
    return { root: resolvedRoot, filePath: resolvedPath };
  } catch (error) {
    throw new AssetDeletionError(error.message, 500);
  }
}

async function removeAssetFile(assetRoot, filename, fileSystem = fs.promises) {
  if (fileSystem !== fs.promises) throw new Error('Custom filesystems are not supported by asset cleanup.');
  await removeContainedFile(assetRoot, filename);
}

async function deleteAssetCompletely(assetId, requesterId, dependencies, options = {}) {
  const id = Number(assetId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AssetDeletionError('Invalid asset ID.', 400);
  const { pool, assetThumbnails, thumbnailQueue } = dependencies;
  const releaseAssetLock = await assetThumbnails.acquireAssetLifecycleLock(id);
  let client;
  let transactionStarted = false;
  let advisoryLocked = false;
  let operationId = null;

  try {
    client = await pool.connect();
    await client.query('SELECT pg_advisory_lock($1)', [id]);
    advisoryLocked = true;
    await recoverPendingAssetLifecycleOperations(pool, id, {
      assetRoot: assetThumbnails.getOriginalAssetStorageRoot(),
      thumbnailRoot: assetThumbnails.getThumbnailStorageRoot(),
    });
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

    const thumbnailResult = await client.query(
      'SELECT thumbnail_path FROM asset_thumbnail_metadata WHERE asset_id = $1',
      [id]
    );
    const orphanResult = await client.query(
      'SELECT thumbnail_path FROM asset_thumbnail_orphans WHERE asset_id = $1',
      [id]
    );
    const thumbnailPaths = [
      thumbnailResult.rows[0]?.thumbnail_path,
      ...orphanResult.rows.map((row) => row.thumbnail_path),
    ].filter((thumbnailPath, index, paths) => thumbnailPath && paths.indexOf(thumbnailPath) === index);
    for (const thumbnailPath of thumbnailPaths) {
      assetThumbnails.normalizeThumbnailRelativePath(thumbnailPath, id);
    }
    const operationResult = await client.query(
      `INSERT INTO asset_lifecycle_operations
        (asset_id, operation, state, old_filename, thumbnail_paths)
       VALUES ($1, 'delete', 'prepared', $2, $3::jsonb)
       RETURNING id`,
      [id, asset.filename, JSON.stringify(thumbnailPaths)]
    );
    operationId = operationResult.rows[0]?.id;
    if (!operationId) throw new Error('Could not persist asset deletion recovery record.');
    await client.query('COMMIT');
    transactionStarted = false;

    if (typeof thumbnailQueue?.cancelAssetThumbnailJobs === 'function') {
      await thumbnailQueue.cancelAssetThumbnailJobs(id);
    }

    await client.query('BEGIN');
    transactionStarted = true;
    const lockedAsset = await client.query(
      'SELECT id FROM images WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!lockedAsset.rows[0]) {
      throw new AssetDeletionError('Asset disappeared before deletion was finalized.', 409);
    }

    await client.query('DELETE FROM favorites WHERE image_id = $1', [id]);
    await client.query('DELETE FROM downloads WHERE image_id = $1', [id]);
    await client.query('DELETE FROM asset_processing_jobs WHERE asset_id = $1', [id]);
    await client.query('DELETE FROM asset_thumbnail_metadata WHERE asset_id = $1', [id]);
    await client.query('DELETE FROM asset_thumbnail_orphans WHERE asset_id = $1', [id]);
    const deletedAsset = await client.query('DELETE FROM images WHERE id = $1 RETURNING id', [id]);
    if (!deletedAsset.rows[0]) throw new AssetDeletionError('Asset disappeared during deletion.', 409);
    await client.query(
      `UPDATE asset_lifecycle_operations
       SET state = 'db_committed', error_message = NULL, updated_at = NOW()
       WHERE id = $1`,
      [operationId]
    );
    await client.query('COMMIT');
    transactionStarted = false;
    try {
      const operation = (await pool.query(
        `SELECT id, asset_id, operation, state, old_filename, new_filename, thumbnail_paths
         FROM asset_lifecycle_operations WHERE id = $1`,
        [operationId]
      )).rows[0];
      await recoverLifecycleOperation(pool, operation, {
        assetRoot: assetThumbnails.getOriginalAssetStorageRoot(),
        thumbnailRoot: assetThumbnails.getThumbnailStorageRoot(),
      });
      return { deleted: true, asset, cleanupPending: false };
    } catch (cleanupError) {
      await setOperationState(pool, operationId, 'recovery_required', cleanupError.message).catch((stateError) => {
        console.error(`Could not record deletion cleanup failure for asset ${id}:`, stateError);
      });
      console.error(`Asset ${id} was deleted from the database; durable file cleanup remains pending:`, cleanupError);
      return { deleted: true, asset, cleanupPending: true, cleanupError: cleanupError.message };
    }
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error(`Failed to roll back asset deletion ${id}:`, rollbackError);
      });
    }
    if (operationId) {
      const operation = await pool.query(
        `SELECT id, asset_id, operation, state, old_filename, new_filename, thumbnail_paths
         FROM asset_lifecycle_operations WHERE id = $1`,
        [operationId]
      ).catch((lookupError) => {
        console.error(`Could not inspect deletion recovery record ${operationId}:`, lookupError);
        return { rows: [] };
      });
      if (operation.rows[0]) {
        try {
          await recoverLifecycleOperation(pool, operation.rows[0], {
            assetRoot: assetThumbnails.getOriginalAssetStorageRoot(),
            thumbnailRoot: assetThumbnails.getThumbnailStorageRoot(),
          });
        } catch (recoveryError) {
          await setOperationState(pool, operationId, 'recovery_required', recoveryError.message).catch((stateError) => {
            console.error(`Could not record recovery failure for deletion ${operationId}:`, stateError);
          });
          console.error(`Asset deletion ${operationId} requires recovery:`, recoveryError);
        }
      }
    }
    throw error;
  } finally {
    if (advisoryLocked) {
      await client.query('SELECT pg_advisory_unlock($1)', [id]).catch((unlockError) => {
        console.error(`Could not release asset deletion lock ${id}:`, unlockError);
      });
    }
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
