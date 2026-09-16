const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOptionalThumbnailName,
  getPublicThumbnailUrl,
  getThumbnailStorageDirectory,
  buildGeneratedThumbnailPath,
  getOptionalThumbnailQuality,
} = require('../utils/assetThumbnail');

test('buildOptionalThumbnailName keeps the asset base name and thumbnail extension', () => {
  assert.equal(buildOptionalThumbnailName('summer-sale.ai', 'cover.png'), 'thumbnail-summer-sale.png');
  assert.equal(buildOptionalThumbnailName('summer-sale.ai', 'cover.jpg'), 'thumbnail-summer-sale.jpg');
  assert.equal(buildOptionalThumbnailName('summer sale.ai', 'cover.webp'), 'thumbnail-summer-sale.webp');
});

test('optional thumbnails are compressed to half the uploaded quality', () => {
  assert.equal(getOptionalThumbnailQuality(), 50);
});

test('getPublicThumbnailUrl returns a safe public URL for the saved thumbnail', () => {
  assert.equal(
    getPublicThumbnailUrl('user/2026/08/thumbnails/thumbnail-summer-sale.png'),
    '/api/thumbnail?file=user%2F2026%2F08%2Fthumbnails%2Fthumbnail-summer-sale.png'
  );
  assert.equal(
    getPublicThumbnailUrl('/uploads/user/2026/08/thumbnails/thumbnail-summer-sale.png'),
    '/api/thumbnail?file=user%2F2026%2F08%2Fthumbnails%2Fthumbnail-summer-sale.png'
  );
});

test('thumbnail storage stays in a sibling thumbnails folder next to status folders', () => {
  const assetPath = '/workspace/backend/uploads/contri1/2026/08/Pending/hero-sale.ai';

  assert.equal(
    getThumbnailStorageDirectory(assetPath),
    '/workspace/backend/uploads/contri1/2026/08/thumbnails'
  );
  assert.equal(
    buildGeneratedThumbnailPath(assetPath),
    '/workspace/backend/uploads/contri1/2026/08/thumbnails/hero-sale-thumb.jpg'
  );
});
