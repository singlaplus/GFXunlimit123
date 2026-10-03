const fs = require('node:fs/promises');
const path = require('node:path');
const {
  getThumbnailStorageRoot,
  getThumbnailFilePath,
  normalizeThumbnailRelativePath,
  isThumbnailPathInsideRoot,
} = require('../utils/assetThumbnails');
const {
  assertSchemaReady,
  hasFlag,
  planOrphanThumbnailFiles,
  pool,
} = require('./thumbnail-cli-utils');

async function listStorageEntries(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  const unexpected = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const depth = prefix ? prefix.split('/').length : 0;
      const validDirectory = depth === 0
        ? /^\d{4}$/.test(entry.name)
        : depth === 1
          ? /^(0[1-9]|1[0-2])$/.test(entry.name)
          : depth === 2
            ? /^(0[1-9]|[12]\d|3[01])$/.test(entry.name)
            : false;
      if (!validDirectory) {
        unexpected.push(relativePath);
        continue;
      }
      const nested = await listStorageEntries(path.join(directory, entry.name), relativePath);
      files.push(...nested.files);
      unexpected.push(...nested.unexpected);
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      files.push({ name: entry.name, relativePath, isFile: () => true });
    } else {
      unexpected.push(relativePath);
    }
  }
  return { files, unexpected };
}

async function main() {
  await assertSchemaReady();
  const apply = hasFlag('apply');
  const root = getThumbnailStorageRoot();
  const [assetsResult, recordsResult, orphanRecordsResult, legacyRefsResult, listing] = await Promise.all([
    pool.query('SELECT id FROM images'),
    pool.query('SELECT asset_id, thumbnail_path, status FROM asset_thumbnail_metadata'),
    pool.query('SELECT asset_id, thumbnail_path FROM asset_thumbnail_orphans'),
    pool.query(`SELECT COUNT(*)::int AS count FROM images WHERE thumbnail_url IS NOT NULL AND BTRIM(thumbnail_url) <> ''`),
    fs.readdir(root, { withFileTypes: true }).then(() => listStorageEntries(root)).catch((error) => {
      if (error.code === 'ENOENT') return { files: [], unexpected: [] };
      throw error;
    }),
  ]);
  const assetIds = new Set(assetsResult.rows.map((row) => Number(row.id)));
  const recordsById = new Map(recordsResult.rows.map((row) => [
    Number(row.asset_id),
    { path: row.thumbnail_path, status: row.status },
  ]));
  const recordPaths = new Map([...recordsById].map(([assetId, record]) => [assetId, record.path]));
  const canonicalFiles = [];
  for (const entry of listing.files) {
    const match = entry.relativePath.match(/_([1-9]\d*)\.webp$/);
    const assetId = Number(match?.[1]);
    try {
      normalizeThumbnailRelativePath(entry.relativePath, assetId);
      canonicalFiles.push({ ...entry, assetId });
    } catch (error) {
      listing.unexpected.push(entry.relativePath);
    }
  }
  const cleanupPlan = planOrphanThumbnailFiles(canonicalFiles, assetIds, recordPaths);
  const plannedPaths = new Set(cleanupPlan.map((item) => item.relativePath));

  const fileSizes = new Map();
  for (const entry of canonicalFiles) {
    const filePath = getThumbnailFilePath(entry.assetId, root, entry.relativePath);
    if (!(await isThumbnailPathInsideRoot(filePath, root))) {
      listing.unexpected.push(entry.relativePath);
      continue;
    }
    fileSizes.set(entry.relativePath, (await fs.stat(filePath)).size);
  }
  const currentFiles = canonicalFiles.filter((entry) =>
    recordsById.get(entry.assetId)?.status === 'READY' &&
    recordsById.get(entry.assetId)?.path === entry.relativePath &&
    !plannedPaths.has(entry.relativePath)
  );
  const retainedNonReadyFiles = canonicalFiles.filter((entry) =>
    recordsById.get(entry.assetId)?.path === entry.relativePath &&
    recordsById.get(entry.assetId)?.status !== 'READY'
  );
  const currentBytes = currentFiles.reduce((total, entry) => total + (fileSizes.get(entry.relativePath) || 0), 0);
  const retainedNonReadyBytes = retainedNonReadyFiles.reduce((total, entry) => total + (fileSizes.get(entry.relativePath) || 0), 0);
  const orphanBytes = cleanupPlan.reduce((total, item) => total + (fileSizes.get(item.relativePath) || 0), 0);
  const staleOrphanRecords = [];
  const unsafeOrphanRecords = [];
  for (const record of orphanRecordsResult.rows) {
    let storageRootVerified = false;
    try {
      await fs.realpath(root);
      storageRootVerified = true;
      const safePath = normalizeThumbnailRelativePath(record.thumbnail_path, record.asset_id);
      const filePath = getThumbnailFilePath(record.asset_id, root, safePath);
      const fileStats = await fs.lstat(filePath);
      if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
        unsafeOrphanRecords.push(record);
        continue;
      }
      if (!(await isThumbnailPathInsideRoot(filePath, root))) {
        unsafeOrphanRecords.push(record);
        continue;
      }
    } catch (error) {
      if (storageRootVerified && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) staleOrphanRecords.push(record);
      else if (/Invalid thumbnail/.test(error.message)) unsafeOrphanRecords.push(record);
      else throw error;
    }
  }

  console.log(`Thumbnail cleanup ${apply ? '(apply)' : '(dry run)'}`);
  console.log(`Storage root:                          ${root}`);
  console.log(`Current new thumbnails:                ${currentFiles.length} (${currentBytes} bytes)`);
  console.log(`Non-ready files retained:               ${retainedNonReadyFiles.length} (${retainedNonReadyBytes} bytes)`);
  console.log(`Legacy thumbnail references:           ${legacyRefsResult.rows[0].count} (files/records untouched)`);
  console.log(`Orphan thumbnail files planned:         ${cleanupPlan.length} (${orphanBytes} bytes)`);
  console.log(`Unexpected files/directories untouched: ${listing.unexpected.length}`);
  console.log(`Stale cleanup records to clear:          ${staleOrphanRecords.length}`);
  console.log(`Unsafe cleanup records left untouched:  ${unsafeOrphanRecords.length}`);
  for (const item of cleanupPlan) {
    console.log(` - ${item.relativePath} (${fileSizes.get(item.relativePath) || 0} bytes): ${item.reason}`);
  }
  for (const record of unsafeOrphanRecords) {
    console.error(`Leaving unsafe cleanup record for asset ${record.asset_id}: ${record.thumbnail_path}`);
  }
  if (!apply) {
    console.log('No files or records deleted. Re-run with --apply to remove only the listed orphan WebP files.');
    return;
  }

  let failed = 0;
  for (const item of cleanupPlan) {
    const filePath = getThumbnailFilePath(item.assetId, root, item.relativePath);
    try {
      if (!(await isThumbnailPathInsideRoot(filePath, root))) {
        throw new Error('Refusing to delete a thumbnail outside the configured storage root');
      }
      await fs.unlink(filePath).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await pool.query(
        'DELETE FROM asset_thumbnail_orphans WHERE asset_id = $1 AND thumbnail_path = $2',
        [item.assetId, item.relativePath]
      );
    } catch (error) {
      failed += 1;
      console.error(`Failed to remove ${item.relativePath}: ${error.message}`);
      await pool.query(`
        INSERT INTO asset_thumbnail_orphans (asset_id, thumbnail_path, error_message, last_attempt_at, cleanup_attempts)
        VALUES ($1, $2, $3, NOW(), 1)
        ON CONFLICT (asset_id, thumbnail_path) DO UPDATE
          SET error_message = EXCLUDED.error_message, last_attempt_at = NOW(),
              cleanup_attempts = asset_thumbnail_orphans.cleanup_attempts + 1
      `, [item.assetId, item.relativePath, String(error.message || error).slice(0, 2000)]);
    }
  }
  for (const record of staleOrphanRecords) {
    await pool.query(
      'DELETE FROM asset_thumbnail_orphans WHERE asset_id = $1 AND thumbnail_path = $2',
      [record.asset_id, record.thumbnail_path]
    );
  }
  console.log(`Removed ${cleanupPlan.length - failed} orphan thumbnail files; cleared ${staleOrphanRecords.length} stale cleanup records.`);
  console.log('Original assets and legacy thumbnail files were not touched.');
  if (failed || unsafeOrphanRecords.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Thumbnail cleanup failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  }).finally(async () => {
    await pool.end();
  });
}

module.exports = { main, listStorageEntries };
