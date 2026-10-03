const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const {
  getThumbnailStorageRoot,
  getThumbnailFilePath,
  normalizeThumbnailRelativePath,
  isThumbnailPathInsideRoot,
  isValidThumbnailFile,
} = require('../utils/assetThumbnails');
const { assertSchemaReady, pool } = require('./thumbnail-cli-utils');

async function listThumbnailFiles(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  const unexpected = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const nested = await listThumbnailFiles(path.join(directory, entry.name), relativePath);
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
  const [assetsResult, recordsResult, oldRefsResult, pendingOrphansResult] = await Promise.all([
    pool.query('SELECT id FROM images ORDER BY id'),
    pool.query('SELECT asset_id, thumbnail_path, format, width, height, status, file_size FROM asset_thumbnail_metadata ORDER BY asset_id'),
    pool.query(`SELECT COUNT(*)::int AS count FROM images WHERE thumbnail_url IS NOT NULL AND BTRIM(thumbnail_url) <> ''`),
    pool.query('SELECT COUNT(*)::int AS count FROM asset_thumbnail_orphans'),
  ]);
  const assetIds = new Set(assetsResult.rows.map((row) => Number(row.id)));
  const recordsById = new Map(recordsResult.rows.map((row) => [Number(row.asset_id), row]));
  const missing = [];
  const invalid = [];
  const orphanRecords = [];
  const missingRecords = [...assetIds].filter((assetId) => !recordsById.has(assetId));
  const failed = [...recordsById.values()].filter((record) => record.status === 'FAILED').length;
  const incomplete = [...recordsById.values()].filter((record) => record.status === 'PENDING' || record.status === 'PROCESSING').length;
  let bytes = 0;

  for (const [assetId, record] of recordsById) {
    if (!assetIds.has(assetId)) orphanRecords.push({ assetId, path: record.thumbnail_path });
    let filePath;
    try {
      filePath = getThumbnailFilePath(assetId, getThumbnailStorageRoot(), record.thumbnail_path);
    } catch (error) {
      invalid.push(assetId);
      continue;
    }
    let fileStats = null;
    try {
      fileStats = await fs.stat(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (record.status === 'READY' && !fileStats) missing.push(assetId);
    if (record.status === 'READY' && fileStats) bytes += fileStats.size;
    if (fileStats) {
      if (!(await isThumbnailPathInsideRoot(filePath))) {
        invalid.push(assetId);
      } else {
        const valid = await isValidThumbnailFile(filePath);
        const metadata = valid ? await sharp(filePath).metadata() : {};
        if (
          !valid ||
          fileStats.size !== Number(record.file_size) ||
          record.format !== 'webp' ||
          normalizeThumbnailRelativePath(record.thumbnail_path, assetId) !== record.thumbnail_path ||
          Number(record.width) !== metadata.width ||
          Number(record.height) !== metadata.height
        ) invalid.push(assetId);
      }
    }
  }

  const diskOrphans = [];
  const nonCanonicalFiles = [];
  const fileIds = new Map();
  let diskFiles = [];
  try {
    const listing = await listThumbnailFiles(getThumbnailStorageRoot());
    diskFiles = listing.files;
    nonCanonicalFiles.push(...listing.unexpected);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const entry of diskFiles) {
    const match = entry.relativePath.match(/_([1-9]\d*)\.webp$/);
    const assetId = Number(match?.[1]);
    try {
      normalizeThumbnailRelativePath(entry.relativePath, assetId);
    } catch (error) {
      nonCanonicalFiles.push(entry.relativePath);
      continue;
    }
    fileIds.set(assetId, (fileIds.get(assetId) || 0) + 1);
    if (!assetIds.has(assetId) || !recordsById.has(assetId)) {
      diskOrphans.push(entry.relativePath);
    }
  }
  const duplicates = [...fileIds.entries()]
    .filter(([, count]) => count > 1)
    .map(([assetId, count]) => `${assetId} (${count} files)`);

  console.log('GFXunlimit Thumbnail Check');
  console.log(`Assets:                    ${assetIds.size}`);
  console.log(`Thumbnail records:         ${recordsById.size}`);
  console.log(`Assets without a record:   ${missingRecords.length}`);
  console.log(`Failed/incomplete records: ${failed}/${incomplete}`);
  console.log(`Ready thumbnail bytes:      ${bytes}`);
  console.log(`Ready file missing/invalid: ${missing.length}${missing.length ? ` (${missing.join(', ')})` : ''}`);
  console.log(`Metadata size mismatch:     ${new Set(invalid).size}${invalid.length ? ` (${[...new Set(invalid)].join(', ')})` : ''}`);
  console.log(`Orphan records:             ${orphanRecords.length}`);
  console.log(`Orphan files:               ${diskOrphans.length}${diskOrphans.length ? ` (${diskOrphans.join(', ')})` : ''}`);
  console.log(`Duplicate asset thumbnails: ${duplicates.length}${duplicates.length ? ` (${duplicates.join(', ')})` : ''}`);
  console.log(`Unexpected storage entries: ${nonCanonicalFiles.length}${nonCanonicalFiles.length ? ` (${nonCanonicalFiles.join(', ')})` : ''}`);
  console.log(`Legacy thumbnail refs:      ${oldRefsResult.rows[0].count}`);
  console.log(`Recorded cleanup failures:  ${pendingOrphansResult.rows[0].count}`);

  if (
    missingRecords.length ||
    failed ||
    incomplete ||
    missing.length ||
    invalid.length ||
    orphanRecords.length ||
    diskOrphans.length ||
    duplicates.length ||
    nonCanonicalFiles.length
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Thumbnail check failed: ${error.stack || error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
