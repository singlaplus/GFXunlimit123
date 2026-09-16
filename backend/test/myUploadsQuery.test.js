const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMyUploadsQuery } = require('../server');

test('rejected view query does not limit rejected assets to the last 4 days', () => {
  const { query, params } = buildMyUploadsQuery('rejected', 42);

  assert.equal(params[0], 42);
  assert.match(query, /LOWER\(COALESCE\(status, ''\)\) = 'rejected'/);
  assert.doesNotMatch(query, /created_at >= NOW\(\) - INTERVAL '4 days'/);
});
