const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function hashContainedFile(root, relativePath) {
  const target = await ensureSafeParent(root, relativePath, false);
  if (!target) throw new Error('Asset directory is unavailable.');
  const stats = await fs.lstat(target.resolvedPath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error('Asset path is not a regular file.');
  }
  const realPath = await fs.realpath(target.resolvedPath);
  const relative = path.relative(target.realRoot, realPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Asset path resolves outside its storage root.');
  }
  return hashFile(target.resolvedPath);
}

async function filesHaveSameContent(firstPath, secondPath) {
  const [firstStats, secondStats] = await Promise.all([fs.stat(firstPath), fs.stat(secondPath)]);
  if (firstStats.size !== secondStats.size) return false;
  const [firstHash, secondHash] = await Promise.all([hashFile(firstPath), hashFile(secondPath)]);
  return firstHash === secondHash;
}

function hasSameFileIdentity(firstStats, secondStats) {
  return firstStats.dev === secondStats.dev && firstStats.ino === secondStats.ino;
}

function hasJournaledTemporaryIdentity(operation, stats) {
  return operation.temporary_device !== null && operation.temporary_device !== undefined &&
    operation.temporary_inode !== null && operation.temporary_inode !== undefined &&
    String(stats.dev) === String(operation.temporary_device) &&
    String(stats.ino) === String(operation.temporary_inode);
}

function resolveRelativePath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('Asset lifecycle path is invalid.');
  }
  const segments = relativePath.replace(/\\/g, '/').split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':') || segment.includes('\0'))) {
    throw new Error('Asset lifecycle path is invalid.');
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Asset lifecycle path escapes its storage root.');
  }
  return { resolvedRoot, resolvedPath, segments };
}

async function ensureSafeParent(root, relativePath, create) {
  const { resolvedRoot, segments } = resolveRelativePath(root, relativePath);
  const realRoot = await fs.realpath(resolvedRoot);
  let current = resolvedRoot;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    if (create) await fs.mkdir(current).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    let stats;
    try {
      stats = await fs.lstat(current);
    } catch (error) {
      if (!create && ['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
      throw error;
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Asset lifecycle path contains an unsafe directory.');
    }
    const realCurrent = await fs.realpath(current);
    const relative = path.relative(realRoot, realCurrent);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Asset lifecycle path resolves outside its storage root.');
    }
  }
  return { ...resolveRelativePath(root, relativePath), realRoot };
}

async function copyContainedFile(root, sourceRelativePath, destinationRelativePath, temporaryRelativePath, expectedSha256 = null, onTemporaryCreated = null) {
  const source = await ensureSafeParent(root, sourceRelativePath, false);
  if (!source) throw new Error('Asset source directory is unavailable.');
  const sourceStats = await fs.lstat(source.resolvedPath);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
    throw new Error('Asset source is not a regular file.');
  }
  const realSource = await fs.realpath(source.resolvedPath);
  const sourceRelative = path.relative(source.realRoot, realSource);
  if (!sourceRelative || sourceRelative === '..' || sourceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(sourceRelative)) {
    throw new Error('Asset source resolves outside its storage root.');
  }

  const destination = await ensureSafeParent(root, destinationRelativePath, true);
  const temporary = await ensureSafeParent(root, temporaryRelativePath, true);
  const temporaryStats = await fs.lstat(temporary.resolvedPath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (temporaryStats) throw new Error('Asset lifecycle temporary path already exists.');

  await fs.copyFile(source.resolvedPath, temporary.resolvedPath, require('node:fs').constants.COPYFILE_EXCL);
  let copiedStats;
  try {
    copiedStats = await fs.lstat(temporary.resolvedPath);
    if (!copiedStats.isFile() || copiedStats.size !== sourceStats.size) {
      throw new Error('Copied asset failed file verification.');
    }
    if (!(await filesHaveSameContent(source.resolvedPath, temporary.resolvedPath))) {
      throw new Error('Copied asset failed content verification.');
    }
    if (expectedSha256 && await hashFile(temporary.resolvedPath) !== expectedSha256) {
      throw new Error('Copied asset does not match its journaled content hash.');
    }
    if (onTemporaryCreated) await onTemporaryCreated(copiedStats);
    await fs.link(temporary.resolvedPath, destination.resolvedPath);
  } catch (error) {
    if (copiedStats) {
      const currentStats = await fs.lstat(temporary.resolvedPath).catch((cleanupError) => {
        if (cleanupError.code === 'ENOENT') return null;
        console.error(`Failed to inspect incomplete asset lifecycle copy: ${cleanupError.message}`);
        return null;
      });
      if (currentStats && !currentStats.isSymbolicLink() && currentStats.isFile() &&
          hasSameFileIdentity(copiedStats, currentStats)) {
        await fs.unlink(temporary.resolvedPath).catch((cleanupError) => {
          if (cleanupError.code !== 'ENOENT') {
            console.error(`Failed to remove incomplete asset lifecycle copy: ${cleanupError.message}`);
          }
        });
      }
    }
    throw error;
  }
}

async function assertContainedFile(root, relativePath) {
  const target = await ensureSafeParent(root, relativePath, false);
  if (!target) throw new Error('Asset directory is unavailable.');
  const stats = await fs.lstat(target.resolvedPath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error('Asset path is not a regular file.');
  }
  const realPath = await fs.realpath(target.resolvedPath);
  const relative = path.relative(target.realRoot, realPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Asset path resolves outside its storage root.');
  }
  return stats;
}

async function assertContainedPathAbsent(root, relativePath) {
  const target = await ensureSafeParent(root, relativePath, false);
  if (!target) return;
  const stats = await fs.lstat(target.resolvedPath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stats) throw new Error('Asset destination already exists.');
}

async function removeContainedFile(root, relativePath) {
  const target = await ensureSafeParent(root, relativePath, false);
  if (!target) return;
  let stats;
  try {
    stats = await fs.lstat(target.resolvedPath);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return;
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error('Refusing to remove a non-regular asset lifecycle path.');
  }
  const realFile = await fs.realpath(target.resolvedPath);
  const relative = path.relative(target.realRoot, realFile);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Refusing to remove a file outside its storage root.');
  }
  await fs.unlink(target.resolvedPath);
}

function temporaryMovePath(filename, operationId) {
  return `${filename}.asset-lifecycle-${operationId}.tmp`;
}

async function setOperationState(pool, operationId, state, errorMessage = null) {
  await pool.query(
    `UPDATE asset_lifecycle_operations
     SET state = $1, error_message = $2, updated_at = NOW()
     WHERE id = $3`,
    [state, errorMessage ? String(errorMessage).slice(0, 4000) : null, operationId]
  );
}

async function recordTemporaryIdentity(pool, operation, stats) {
  const temporaryDevice = String(stats.dev);
  const temporaryInode = String(stats.ino);
  const result = await pool.query(
    `UPDATE asset_lifecycle_operations
     SET temporary_device = $1, temporary_inode = $2, updated_at = NOW()
     WHERE id = $3 AND state IN ('prepared', 'db_committed', 'recovery_required')`,
    [temporaryDevice, temporaryInode, operation.id]
  );
  if (result.rowCount !== 1) {
    throw new Error(`Could not persist temporary file identity for lifecycle operation ${operation.id}.`);
  }
  operation.temporary_device = temporaryDevice;
  operation.temporary_inode = temporaryInode;
}

async function cleanupCompletedMoveTemporaryFile(pool, operation, assetRoot) {
  const temporary = temporaryMovePath(operation.new_filename, operation.id);
  let destinationPath;
  let temporaryPath;
  let destinationStats;
  let temporaryStats;
  try {
    const recoveryAssetRoot = requireRecoveryStorageRoot(assetRoot, 'original asset');
    destinationPath = await ensureSafeParent(recoveryAssetRoot, operation.new_filename, false);
    temporaryPath = await ensureSafeParent(recoveryAssetRoot, temporary, false);
    if (!destinationPath || !temporaryPath) {
      throw new Error(`Completed move ${operation.id} cannot verify its temporary cleanup paths.`);
    }
    destinationStats = await fs.lstat(destinationPath.resolvedPath);
    if (destinationStats.isSymbolicLink() || !destinationStats.isFile() ||
        !hasJournaledTemporaryIdentity(operation, destinationStats)) {
      throw new Error(`Completed move ${operation.id} destination does not match its journaled temporary identity.`);
    }
    if (operation.content_sha256 && await hashFile(destinationPath.resolvedPath) !== operation.content_sha256) {
      throw new Error(`Completed move ${operation.id} destination does not match its journaled content.`);
    }
    temporaryStats = await fs.lstat(temporaryPath.resolvedPath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (temporaryStats && (temporaryStats.isSymbolicLink() || !temporaryStats.isFile() ||
        !hasJournaledTemporaryIdentity(operation, temporaryStats) ||
        !hasSameFileIdentity(destinationStats, temporaryStats))) {
      throw new Error(`Completed move ${operation.id} temporary file does not match its journaled identity.`);
    }
  } catch (error) {
    error.recoveryRequired = true;
    throw error;
  }
  if (temporaryStats) {
    const currentTemporaryStats = await fs.lstat(temporaryPath.resolvedPath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (currentTemporaryStats &&
        hasJournaledTemporaryIdentity(operation, currentTemporaryStats) &&
        hasSameFileIdentity(destinationStats, currentTemporaryStats) &&
        !currentTemporaryStats.isSymbolicLink() && currentTemporaryStats.isFile()) {
      await fs.unlink(temporaryPath.resolvedPath);
    } else if (currentTemporaryStats) {
      const error = new Error(`Completed move ${operation.id} temporary identity changed before cleanup.`);
      error.recoveryRequired = true;
      throw error;
    }
  }

  const cleared = await pool.query(
    `UPDATE asset_lifecycle_operations
     SET temporary_device = NULL, temporary_inode = NULL, updated_at = NOW()
     WHERE id = $1 AND state = 'completed' AND temporary_device = $2 AND temporary_inode = $3`,
    [operation.id, operation.temporary_device, operation.temporary_inode]
  );
  if (cleared.rowCount !== 1) {
    throw new Error(`Could not clear temporary identity for completed move ${operation.id}.`);
  }
  operation.temporary_device = null;
  operation.temporary_inode = null;
}

async function getAssetFilename(pool, assetId) {
  const result = await pool.query('SELECT filename FROM images WHERE id = $1', [assetId]);
  return result.rows[0]?.filename ?? null;
}

function requireRecoveryStorageRoot(root, description) {
  if (typeof root !== 'string' || !root.trim()) {
    throw new Error(`Local ${description} storage is unavailable; lifecycle operation remains pending.`);
  }
  return root;
}

async function recoverLifecycleOperation(pool, operation, options) {
  const { assetRoot, thumbnailRoot } = options;
  const currentFilename = await getAssetFilename(pool, operation.asset_id);

  if (operation.operation === 'move') {
    if (operation.old_filename === operation.new_filename) {
      if (operation.state === 'db_committed') {
        if (currentFilename !== operation.new_filename) {
          throw new Error(`Committed same-path move ${operation.id} has an unexpected database filename.`);
        }
        await setOperationState(pool, operation.id, 'completed');
        return 'completed';
      }
      if (operation.state === 'prepared') {
        if (currentFilename !== operation.old_filename) {
          throw new Error(`Prepared same-path move ${operation.id} has an unexpected database filename.`);
        }
        await setOperationState(pool, operation.id, 'aborted');
        return 'aborted';
      }
      throw new Error(`Same-path move ${operation.id} has an ambiguous journal state and remains pending.`);
    }

    const temporary = temporaryMovePath(operation.new_filename, operation.id);
    if (currentFilename === operation.old_filename) {
      const recoveryAssetRoot = requireRecoveryStorageRoot(assetRoot, 'original asset');
      const oldPath = await ensureSafeParent(recoveryAssetRoot, operation.old_filename, false);
      const newPath = await ensureSafeParent(recoveryAssetRoot, operation.new_filename, false);
      const temporaryPath = await ensureSafeParent(recoveryAssetRoot, temporary, false);
      if (newPath) {
        const oldStats = oldPath && await fs.lstat(oldPath.resolvedPath).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        const newStats = await fs.lstat(newPath.resolvedPath).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        const temporaryStats = temporaryPath && await fs.lstat(temporaryPath.resolvedPath).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (newStats) {
          if (newStats.isSymbolicLink() || !newStats.isFile() || !oldStats?.isFile() ||
              !(await filesHaveSameContent(oldPath.resolvedPath, newPath.resolvedPath))) {
            throw new Error(`Uncommitted destination for asset ${operation.asset_id} is not a verified duplicate.`);
          }
          if (!temporaryStats?.isFile() || temporaryStats.isSymbolicLink() ||
              !hasJournaledTemporaryIdentity(operation, temporaryStats) ||
              !hasSameFileIdentity(temporaryStats, newStats)) {
            throw new Error(`Uncommitted destination for asset ${operation.asset_id} cannot be attributed to its operation.`);
          }
          await removeContainedFile(recoveryAssetRoot, operation.new_filename);
          await removeContainedFile(recoveryAssetRoot, temporary);
        } else if (temporaryStats) {
          if (temporaryStats.isSymbolicLink() || !temporaryStats.isFile() ||
              !hasJournaledTemporaryIdentity(operation, temporaryStats) ||
              !oldStats?.isFile() || oldStats.isSymbolicLink() ||
              !(await filesHaveSameContent(oldPath.resolvedPath, temporaryPath.resolvedPath)) ||
              (operation.content_sha256 && await hashFile(temporaryPath.resolvedPath) !== operation.content_sha256)) {
            throw new Error(`Temporary asset for operation ${operation.id} cannot be safely attributed; recovery remains pending.`);
          }
          await removeContainedFile(recoveryAssetRoot, temporary);
        }
      }
      await setOperationState(pool, operation.id, 'aborted');
      return 'aborted';
    }
    if (currentFilename !== operation.new_filename) {
      throw new Error(`Asset ${operation.asset_id} is missing or has an unexpected database filename.`);
    }

    const recoveryAssetRoot = requireRecoveryStorageRoot(assetRoot, 'original asset');
    try {
      await ensureSafeParent(recoveryAssetRoot, operation.new_filename, false).then(async (target) => {
        const stats = target && await fs.lstat(target.resolvedPath).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        const temporaryPath = await ensureSafeParent(recoveryAssetRoot, temporary, false);
        const temporaryStats = temporaryPath && await fs.lstat(temporaryPath.resolvedPath).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (!stats) {
          const source = await ensureSafeParent(recoveryAssetRoot, operation.old_filename, false);
          const sourceHash = await hashContainedFile(recoveryAssetRoot, operation.old_filename);
          if (operation.content_sha256 && sourceHash !== operation.content_sha256) {
            throw new Error('Committed asset source does not match its journaled content hash.');
          }
          if (temporaryStats) {
            if (temporaryStats.isSymbolicLink() || !temporaryStats.isFile() ||
                !hasJournaledTemporaryIdentity(operation, temporaryStats) ||
                !(await filesHaveSameContent(source.resolvedPath, temporaryPath.resolvedPath)) ||
                (operation.content_sha256 && await hashFile(temporaryPath.resolvedPath) !== operation.content_sha256)) {
              throw new Error('Committed asset temporary file cannot be verified against its source.');
            }
            await fs.link(temporaryPath.resolvedPath, target.resolvedPath);
          } else {
            await copyContainedFile(
              recoveryAssetRoot,
              operation.old_filename,
              operation.new_filename,
              temporary,
              operation.content_sha256,
              (stats) => recordTemporaryIdentity(pool, operation, stats)
            );
          }
        } else {
          if (stats.isSymbolicLink() || !stats.isFile()) {
            throw new Error('Committed asset destination is not a regular file.');
          }
          if (!temporaryStats?.isFile() || temporaryStats.isSymbolicLink() ||
              !hasJournaledTemporaryIdentity(operation, temporaryStats) ||
              !hasSameFileIdentity(temporaryStats, stats)) {
            throw new Error('Committed asset destination cannot be attributed to its operation.');
          }
          const destinationHash = await hashContainedFile(recoveryAssetRoot, operation.new_filename);
          if (operation.content_sha256) {
            if (destinationHash !== operation.content_sha256) {
              throw new Error('Committed asset destination does not match its journaled content hash.');
            }
          } else {
            const sourcePath = await ensureSafeParent(recoveryAssetRoot, operation.old_filename, false);
            const sourceStats = sourcePath && await fs.lstat(sourcePath.resolvedPath).catch((error) => {
              if (error.code === 'ENOENT') return null;
              throw error;
            });
            if (!sourceStats?.isFile() || sourceStats.isSymbolicLink() ||
                !(await filesHaveSameContent(sourcePath.resolvedPath, target.resolvedPath))) {
              throw new Error('Committed asset destination cannot be verified against its source.');
            }
          }
        }
      });
      const destinationPath = await ensureSafeParent(recoveryAssetRoot, operation.new_filename, false);
      const temporaryPath = await ensureSafeParent(recoveryAssetRoot, temporary, false);
      const [destinationStats, temporaryStats] = await Promise.all([
        fs.lstat(destinationPath.resolvedPath),
        fs.lstat(temporaryPath.resolvedPath),
      ]);
      if (destinationStats.isSymbolicLink() || !destinationStats.isFile() ||
          temporaryStats.isSymbolicLink() || !temporaryStats.isFile() ||
          !hasJournaledTemporaryIdentity(operation, temporaryStats) ||
          !hasSameFileIdentity(destinationStats, temporaryStats)) {
        throw new Error('Committed asset destination is not linked to its operation-owned temporary file.');
      }
      const sourcePath = await ensureSafeParent(recoveryAssetRoot, operation.old_filename, false);
      const sourceStats = sourcePath && await fs.lstat(sourcePath.resolvedPath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (sourceStats) {
        if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) {
          throw new Error('Committed asset source is not a regular file.');
        }
        if (operation.content_sha256) {
          if (await hashFile(sourcePath.resolvedPath) !== operation.content_sha256) {
            throw new Error('Committed asset source does not match its journaled content hash.');
          }
        } else if (!(await filesHaveSameContent(sourcePath.resolvedPath, path.resolve(recoveryAssetRoot, operation.new_filename)))) {
          throw new Error('Committed asset source does not match its destination.');
        }
      }
      await removeContainedFile(recoveryAssetRoot, operation.old_filename);
      await setOperationState(pool, operation.id, 'completed');
      await cleanupCompletedMoveTemporaryFile(pool, operation, recoveryAssetRoot);
      return 'completed';
    } catch (error) {
      throw new Error(`Could not recover move for asset ${operation.asset_id}: ${error.message}`, { cause: error });
    }
  }

  if (currentFilename) {
    await setOperationState(pool, operation.id, 'aborted');
    return 'aborted';
  }
  const thumbnailPaths = Array.isArray(operation.thumbnail_paths) ? operation.thumbnail_paths : [];
  const recoveryAssetRoot = requireRecoveryStorageRoot(assetRoot, 'original asset');
  const recoveryThumbnailRoot = thumbnailPaths.length
    ? requireRecoveryStorageRoot(thumbnailRoot, 'thumbnail')
    : null;
  await removeContainedFile(recoveryAssetRoot, operation.old_filename);
  for (const thumbnailPath of thumbnailPaths) {
    await removeContainedFile(recoveryThumbnailRoot, thumbnailPath);
  }
  await setOperationState(pool, operation.id, 'completed');
  return 'completed';
}

async function recoverAssetLifecycleOperations(pool, options) {
  const pending = await pool.query(
    `SELECT id, asset_id, operation, state, old_filename, new_filename, content_sha256,
            temporary_device, temporary_inode, thumbnail_paths
     FROM asset_lifecycle_operations
     WHERE state IN ('prepared', 'db_committed', 'recovery_required')
        OR (operation = 'move' AND state = 'completed' AND
            (temporary_device IS NOT NULL OR temporary_inode IS NOT NULL))
     ORDER BY id`
  );
  let recovered = 0;
  let failed = 0;
  for (const operation of pending.rows) {
    let client;
    try {
      client = await pool.connect();
      await client.query('SELECT pg_advisory_lock($1)', [Number(operation.asset_id)]);
      const outcome = operation.state === 'completed'
        ? await cleanupCompletedMoveTemporaryFile(pool, operation, options.assetRoot)
          .then(() => 'completed')
        : await recoverLifecycleOperation(pool, operation, options);
      if (outcome === 'completed' || outcome === 'aborted') recovered += 1;
    } catch (error) {
      failed += 1;
      console.error(`Asset lifecycle recovery failed for operation ${operation.id}:`, error);
      if (operation.state === 'completed' && !error.recoveryRequired) {
        continue;
      }
      if (
        operation.operation === 'move' &&
        operation.old_filename === operation.new_filename &&
        operation.state === 'db_committed'
      ) {
        continue;
      }
      await setOperationState(pool, operation.id, 'recovery_required', error.message).catch((stateError) => {
        console.error(`Could not record recovery failure for operation ${operation.id}:`, stateError);
      });
    } finally {
      if (client) {
        await client.query('SELECT pg_advisory_unlock($1)', [Number(operation.asset_id)]).catch((error) => {
          console.error(`Could not release lifecycle lock for operation ${operation.id}:`, error);
        });
        client.release();
      }
    }
  }
  return { recovered, failed };
}

async function recoverPendingAssetLifecycleOperations(pool, assetId, options) {
  const pending = await pool.query(
    `SELECT id, asset_id, operation, state, old_filename, new_filename, content_sha256,
            temporary_device, temporary_inode, thumbnail_paths
     FROM asset_lifecycle_operations
     WHERE asset_id = $1
       AND state IN ('prepared', 'db_committed', 'recovery_required')
     ORDER BY id`,
    [assetId]
  );
  for (const operation of pending.rows) {
    try {
      await recoverLifecycleOperation(pool, operation, options);
    } catch (error) {
      await setOperationState(pool, operation.id, 'recovery_required', error.message);
      throw error;
    }
  }
}

module.exports = {
  copyContainedFile,
  cleanupCompletedMoveTemporaryFile,
  hashContainedFile,
  assertContainedFile,
  assertContainedPathAbsent,
  recoverAssetLifecycleOperations,
  recoverLifecycleOperation,
  recoverPendingAssetLifecycleOperations,
  recordTemporaryIdentity,
  removeContainedFile,
  resolveRelativePath,
  setOperationState,
  temporaryMovePath,
};
