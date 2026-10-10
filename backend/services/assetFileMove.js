const {
  assertContainedFile,
  assertContainedPathAbsent,
  copyContainedFile,
  hashContainedFile,
  recordTemporaryIdentity,
  recoverPendingAssetLifecycleOperations,
  recoverLifecycleOperation,
  removeContainedFile,
  setOperationState,
  temporaryMovePath,
} = require('./assetLifecycleOperations');

function getNewAssetFilename(filename, newStatus) {
  if (!['Approved', 'Rejected'].includes(newStatus)) {
    throw new Error('Invalid asset status destination.');
  }
  if (typeof filename !== 'string' || !filename.trim()) {
    throw new Error('Asset file path is invalid.');
  }
  const normalized = filename.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const fileName = parts.pop();
  const statusFolders = ['Pending', 'Approved', 'Rejected'];
  const targetParts = statusFolders.includes(parts[parts.length - 1])
    ? [...parts.slice(0, -1), newStatus]
    : [...parts, newStatus];
  return [...targetParts, fileName].join('/');
}

async function moveAssetFileAndUpdate(pool, assetId, newStatus, assetRoot) {
  const client = await pool.connect();
  let locked = false;
  let operationId = null;
  let asset = null;
  let newFilename = null;
  let transactionStarted = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [Number(assetId)]);
    locked = true;
    await recoverPendingAssetLifecycleOperations(pool, assetId, { assetRoot });
    await client.query('BEGIN');
    transactionStarted = true;
    const selected = await client.query(
      'SELECT id, filename, status, uploaded_by FROM images WHERE id = $1 FOR UPDATE',
      [assetId]
    );
    asset = selected.rows[0];
    if (!asset) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return { notFound: true };
    }

    newFilename = getNewAssetFilename(asset.filename, newStatus);
    const contentSha256 = asset.filename === newFilename
      ? null
      : await hashContainedFile(assetRoot, asset.filename);
    if (asset.filename !== newFilename) {
      await assertContainedPathAbsent(assetRoot, newFilename);
    }
    const operation = await client.query(
      `INSERT INTO asset_lifecycle_operations
        (asset_id, operation, state, old_filename, new_filename, content_sha256)
       VALUES ($1, 'move', 'prepared', $2, $3, $4)
       RETURNING id`,
      [assetId, asset.filename, newFilename, contentSha256]
    );
    operationId = operation.rows[0]?.id;
    if (!operationId) throw new Error('Could not persist asset move recovery record.');
    await client.query('COMMIT');
    transactionStarted = false;

    if (asset.filename !== newFilename) {
      await copyContainedFile(
        assetRoot,
        asset.filename,
        newFilename,
        temporaryMovePath(newFilename, operationId),
        contentSha256,
        (stats) => recordTemporaryIdentity(pool, { id: operationId }, stats)
      );
    } else {
      await assertContainedFile(assetRoot, asset.filename);
    }

    await client.query('BEGIN');
    transactionStarted = true;
    const lockedAsset = await client.query(
      'SELECT filename FROM images WHERE id = $1 FOR UPDATE',
      [assetId]
    );
    if (lockedAsset.rows[0]?.filename !== asset.filename) {
      throw new Error('Asset filename changed during its move operation.');
    }
    const updated = await client.query(
      `UPDATE images
       SET status = $1, filename = $2, reviewed_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [newStatus.toLowerCase(), newFilename, assetId]
    );
    if (!updated.rows[0]) throw new Error('Asset disappeared during status update.');
    await client.query(
      `UPDATE asset_lifecycle_operations
       SET state = 'db_committed', error_message = NULL, updated_at = NOW()
       WHERE id = $1`,
      [operationId]
    );
    await client.query('COMMIT');
    transactionStarted = false;

    const operationResult = await pool.query(
      `SELECT id, asset_id, operation, state, old_filename, new_filename, content_sha256,
              temporary_device, temporary_inode, thumbnail_paths
       FROM asset_lifecycle_operations WHERE id = $1`,
      [operationId]
    );
    await recoverLifecycleOperation(pool, operationResult.rows[0], { assetRoot });
    return {
      asset: updated.rows[0],
      previousFilename: asset.filename,
      previousStatus: asset.status,
    };
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error(`Failed to roll back asset move ${assetId}:`, rollbackError);
      });
    }
    if (operationId) {
      const operationResult = await pool.query(
        `SELECT id, asset_id, operation, state, old_filename, new_filename, content_sha256,
                temporary_device, temporary_inode, thumbnail_paths
         FROM asset_lifecycle_operations WHERE id = $1`,
        [operationId]
      ).catch((lookupError) => {
        console.error(`Could not inspect move recovery record ${operationId}:`, lookupError);
        return { rows: [] };
      });
      if (operationResult.rows[0]) {
        try {
          await recoverLifecycleOperation(pool, operationResult.rows[0], { assetRoot });
        } catch (recoveryError) {
          await setOperationState(pool, operationId, 'recovery_required', recoveryError.message).catch((stateError) => {
            console.error(`Could not record recovery failure for move ${operationId}:`, stateError);
          });
          console.error(`Asset move ${operationId} requires recovery:`, recoveryError);
        }
      }
    }
    throw error;
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [Number(assetId)]).catch((error) => {
        console.error(`Could not release asset move lock for ${assetId}:`, error);
      });
    }
    client.release();
  }
}

module.exports = {
  getNewAssetFilename,
  moveAssetFileAndUpdate,
};
