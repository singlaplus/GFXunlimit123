const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCatalogFilters } = require('../imageQuery');

test('filters approved assets across the full catalog by category and collection', () => {
  const images = [
    { id: 1, category: 'Images', collection: 'Summer', status: 'approved' },
    { id: 2, category: 'Templates', collection: 'Spring', status: 'approved' },
    { id: 3, category: 'Images', collection: 'Spring', status: 'pending' },
    { id: 4, category: 'Templates', collection: 'Summer', status: 'approved' },
  ];

  const filtered = applyCatalogFilters(images, {
    category: 'Templates',
    collection: 'Summer',
  });

  assert.deepEqual(filtered.map((image) => image.id), [4]);
});

test('matches assets that include a selected category inside a multi-category value', () => {
  const images = [
    { id: 1, category: 'Animals,Backgrounds', collection: 'Summer', status: 'approved' },
    { id: 2, category: 'Nature', collection: 'Spring', status: 'approved' },
    { id: 3, category: 'Abstract,Backgrounds', collection: 'Winter', status: 'approved' },
  ];

  const filtered = applyCatalogFilters(images, {
    category: 'Animals',
    collection: 'All',
  });

  assert.deepEqual(filtered.map((image) => image.id), [1]);
});

test('normalizes abstract alias queries and matches abstract assets', () => {
  const images = [
    { id: 1, category: 'Abstract,Backgrounds', collection: 'Winter', status: 'approved' },
    { id: 2, category: 'Photos', collection: 'Summer', status: 'approved' },
  ];

  const filtered = applyCatalogFilters(images, {
    category: 'abtrsct',
    collection: 'All',
  });

  assert.deepEqual(filtered.map((image) => image.id), [1]);
});
