const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMyUploadsQuery } = require('../myUploadsQuery');

test('not-submitted view returns only draft and not-submitted assets for the contributor', () => {
  const { query, params } = buildMyUploadsQuery('not-submitted', 42);

  assert.equal(params[0], 42);
  assert.match(query, /images\.uploaded_by = \$1/);
  assert.match(query, /LOWER\(REPLACE\(REPLACE\(COALESCE\(images\.status, ''\), '_', ' '\), '-', ' '\)\) IN \('draft', 'not submitted'\)/);
  assert.match(query, /thumbnails\.status = 'READY'/);
  assert.match(query, /thumbnails\.thumbnail_path IS NOT NULL/);
});

test('bulk status query includes uploads processing thumbnails without exposing them as ready drafts', () => {
  const { query, params } = buildMyUploadsQuery('bulk-status', 42);

  assert.equal(params[0], 42);
  assert.match(query, /images\.uploaded_by = \$1/);
  assert.match(query, /IN \('draft', 'not submitted', 'upload_processing'\)/);
  assert.doesNotMatch(query, /thumbnails\.status = 'READY'/);
});

test('pending view remains restricted to pending assets and excludes pre-submission assets', () => {
  const { query } = buildMyUploadsQuery('pending', 42);

  assert.match(query, /LOWER\(COALESCE\(images\.status, ''\)\) = 'pending'/);
  assert.doesNotMatch(query, /'not submitted'/);
});

test('rejected view query does not limit rejected assets to the last 4 days', () => {
  const { query, params } = buildMyUploadsQuery('rejected', 42);

  assert.equal(params[0], 42);
  assert.match(query, /LOWER\(COALESCE\(images\.status, ''\)\) = 'rejected'/);
  assert.doesNotMatch(query, /created_at >= NOW\(\) - INTERVAL '4 days'/);
});
