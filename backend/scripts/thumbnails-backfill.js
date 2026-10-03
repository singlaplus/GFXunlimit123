const { generateAssetThumbnail, MAX_THUMBNAIL_CONCURRENCY } = require('../utils/assetThumbnails');
const { assertSchemaReady, getOption, hasFlag, pool, positiveInteger } = require('./thumbnail-cli-utils');

async function main() {
  await assertSchemaReady();
  const all = hasFlag('all');
  const testMode = hasFlag('test');
  if (all && testMode) throw new Error('--test cannot be combined with --all');
  const requestedLimit = getOption('limit', all ? '' : '20');
  if (all && requestedLimit) throw new Error('--all cannot be combined with --limit');
  const limit = all ? '' : positiveInteger(requestedLimit, 'limit', { max: testMode ? 20 : 1000 });
  const offset = positiveInteger(getOption('offset', '0'), 'offset', { allowZero: true });
  const concurrency = positiveInteger(
    getOption('concurrency', process.env.THUMBNAIL_CONCURRENCY || '2'),
    'concurrency',
    { max: MAX_THUMBNAIL_CONCURRENCY }
  );
  const retries = positiveInteger(getOption('retry', '0'), 'retry', { allowZero: true });
  const totalResult = await pool.query('SELECT COUNT(*)::int AS total FROM images');
  const total = Number(totalResult.rows[0]?.total || 0);
  let assets;
  if (testMode) {
    const candidateResult = await pool.query(`
      SELECT DISTINCT ON (lower(reverse(split_part(reverse(filename), '.', 1))))
        id,
        lower(reverse(split_part(reverse(filename), '.', 1))) AS asset_format
      FROM images
      WHERE filename IS NOT NULL AND BTRIM(filename) <> ''
      ORDER BY lower(reverse(split_part(reverse(filename), '.', 1))), id
    `);
    assets = candidateResult.rows
      .sort((left, right) => Number(left.id) - Number(right.id))
      .slice(offset, offset + limit)
      .map(({ id }) => ({ id }));
  } else {
    const values = [offset];
    let query = 'SELECT id FROM images ORDER BY id OFFSET $1';
    if (limit) {
      values.push(limit);
      query = 'SELECT id FROM images ORDER BY id OFFSET $1 LIMIT $2';
    }
    assets = (await pool.query(query, values)).rows;
  }
  const summary = { total, selected: assets.length, alreadyValid: 0, generated: 0, regenerated: 0, failed: 0 };
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < assets.length) {
      const asset = assets[nextIndex];
      nextIndex += 1;
      const assetId = Number(asset.id);
      let result;
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          result = await generateAssetThumbnail(assetId);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (error.permanent || attempt === retries) break;
          console.warn(`Retrying asset ${assetId} (${attempt + 1}/${retries}): ${error.message}`);
        }
      }
      if (lastError) {
        summary.failed += 1;
        console.error(`Failed asset ${assetId}: ${lastError.message}`);
      } else if (result.status === 'already-valid') {
        summary.alreadyValid += 1;
      } else if (result.status === 'regenerated') {
        summary.regenerated += 1;
      } else {
        summary.generated += 1;
      }
      const completed = summary.alreadyValid + summary.generated + summary.regenerated + summary.failed;
      if (completed % 25 === 0 || completed === assets.length) {
        console.log(`Processed ${completed}/${assets.length} (asset ${assetId})`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, assets.length || 1) }, runWorker));

  const storageTotals = await pool.query(`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(file_size), 0)::bigint AS bytes
    FROM asset_thumbnail_metadata
    WHERE status = 'READY'
  `);
  const oldRefs = await pool.query(`
    SELECT COUNT(*)::int AS count FROM images
    WHERE thumbnail_url IS NOT NULL AND BTRIM(thumbnail_url) <> ''
  `);
  console.log('\nGFXunlimit Thumbnail Backfill');
  console.log(`Total assets:       ${summary.total}`);
  console.log(`Selected:           ${summary.selected} (${testMode ? 'representative formats, ' : ''}offset ${offset}${limit ? `, limit ${limit}` : ', all'})`);
  console.log(`Already valid:      ${summary.alreadyValid}`);
  console.log(`Generated:          ${summary.generated}`);
  console.log(`Regenerated:        ${summary.regenerated}`);
  console.log(`Failed:             ${summary.failed}`);
  console.log(`Skipped:            ${summary.alreadyValid}`);
  console.log(`Current thumbnails: ${storageTotals.rows[0].count}`);
  console.log(`Current size:       ${Number(storageTotals.rows[0].bytes)} bytes`);
  const thumbnailCount = Number(storageTotals.rows[0].count);
  const thumbnailBytes = Number(storageTotals.rows[0].bytes);
  console.log(`Average thumbnail:  ${thumbnailCount ? `${Math.round(thumbnailBytes / thumbnailCount / 1024)} KB` : '0 KB'}`);
  console.log(`Legacy thumbnail refs still retained: ${oldRefs.rows[0].count}`);

  if (summary.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Thumbnail backfill failed: ${error.stack || error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
