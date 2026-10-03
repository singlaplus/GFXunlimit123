const pool = require('../db');

async function assertSchemaReady() {
  const result = await pool.query(`
    SELECT
      to_regclass('public.asset_thumbnail_metadata') AS thumbnail_table,
      to_regclass('public.asset_thumbnail_orphans') AS orphan_table
  `);
  if (!result.rows[0]?.thumbnail_table || !result.rows[0]?.orphan_table) {
    throw new Error('Thumbnail metadata schema is missing; start the backend or run migration 028 before this command.');
  }
}

function planOrphanThumbnailFiles(entries, assetIds, recordIds) {
  return entries
    .filter((entry) => entry.isFile() && /^\d{4}\/\d{2}\/\d{2}\/.+_[1-9]\d*\.webp$/.test(entry.relativePath || ''))
    .map((entry) => {
      const assetId = Number(entry.relativePath.match(/_([1-9]\d*)\.webp$/)?.[1]);
      if (!Number.isSafeInteger(assetId)) return null;
      const hasAsset = assetIds.has(assetId);
      const recordPath = recordIds instanceof Map ? recordIds.get(assetId) : null;
      const hasRecord = recordIds instanceof Map ? recordPath === entry.relativePath : recordIds.has(assetId);
      if (hasAsset && hasRecord) return null;
      return {
        relativePath: entry.relativePath,
        assetId,
        reason: !hasAsset && !hasRecord
          ? 'asset and thumbnail record missing'
          : !hasAsset
            ? 'asset record missing'
            : !recordPath
              ? 'thumbnail metadata record missing'
              : 'thumbnail metadata points to a different file',
      };
    })
    .filter(Boolean);
}

function getOption(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function positiveInteger(value, optionName, { allowZero = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > max) {
    throw new Error(`--${optionName} must be an integer between ${minimum} and ${max}`);
  }
  return parsed;
}

module.exports = {
  assertSchemaReady,
  getOption,
  hasFlag,
  planOrphanThumbnailFiles,
  positiveInteger,
  pool,
};
