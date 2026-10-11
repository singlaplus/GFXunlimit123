const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedAssetUploadFile } = require('../services/assetUploadValidation');

test('uses supported filename extensions as authoritative for asset uploads', () => {
  for (const extension of ['.ai', '.eps', '.psd']) {
    assert.equal(isAllowedAssetUploadFile({
      fieldname: 'image',
      originalname: `design${extension}`,
      mimetype: 'application/octet-stream',
    }), true);
  }

  assert.equal(isAllowedAssetUploadFile({
    fieldname: 'image',
    originalname: 'image.jpg',
    mimetype: 'image/jpeg',
  }), true);
  assert.equal(isAllowedAssetUploadFile({
    fieldname: 'image',
    originalname: 'image.tif',
    mimetype: 'image/jpeg',
  }), false);
  assert.equal(isAllowedAssetUploadFile({
    fieldname: 'image',
    originalname: 'script.exe',
    mimetype: 'image/jpeg',
  }), false);
});

test('does not add TIFF to the existing extension policy', () => {
  for (const filename of ['image.tif', 'image.tiff']) {
    assert.equal(isAllowedAssetUploadFile({
      fieldname: 'image',
      originalname: filename,
      mimetype: 'image/jpeg',
    }), false);
  }
});

test('keeps optional thumbnail validation restricted to image MIME types', () => {
  assert.equal(isAllowedAssetUploadFile({
    fieldname: 'thumbnail',
    originalname: 'preview.jpg',
    mimetype: 'image/jpeg',
  }), true);
  assert.equal(isAllowedAssetUploadFile({
    fieldname: 'thumbnail',
    originalname: 'preview.psd',
    mimetype: 'application/octet-stream',
  }), false);
});
