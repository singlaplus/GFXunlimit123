const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getAutomaticAssetCollection,
  isThumbnailRequiredForCollection,
  isAllowedAssetUploadFile,
  resolveAssetCollection,
} = require('../services/assetUploadValidation');
const { SUPPORTED_VIDEO_EXTENSIONS } = require('../services/videoFormats');

test('maps supported asset extensions to their automatic collections', () => {
  for (const [filename, collection] of [
    ['folder/PHOTO.JPG', 'Photos'],
    ['image.jpeg', 'Photos'],
    ['image.png', 'Photos'],
    ['illustration.ai', 'Vectors'],
    ['illustration.eps', 'Vectors'],
    ['layered.psd', 'Psd'],
    ['layered.psb', 'Psd'],
  ]) {
    assert.equal(getAutomaticAssetCollection(filename), collection);
  }

  for (const extension of SUPPORTED_VIDEO_EXTENSIONS) {
    assert.equal(getAutomaticAssetCollection(`clip${extension.toUpperCase()}`), 'Videos');
  }
});

test('leaves template and otherwise unmapped extensions for the user to choose', () => {
  for (const filename of ['template.zip', 'motion.aep', 'project.prproj', 'image.webp']) {
    assert.equal(getAutomaticAssetCollection(filename), null);
  }

  assert.equal(resolveAssetCollection('template.zip', 'Templates'), 'Templates');
  assert.equal(resolveAssetCollection('cover.JPG', 'Templates'), 'Photos');
  assert.equal(resolveAssetCollection('illustration.AI', 'Photos'), 'Vectors');
});

test('requires a thumbnail only for the Templates collection', () => {
  assert.equal(isThumbnailRequiredForCollection('Templates'), true);
  assert.equal(isThumbnailRequiredForCollection(' templates '), true);
  assert.equal(isThumbnailRequiredForCollection('Photos'), false);
});

test('uses supported filename extensions as authoritative for asset uploads', () => {
  for (const extension of ['.ai', '.eps', '.psd', '.mxf', '.m2ts']) {
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
