const path = require('node:path');
const { SUPPORTED_VIDEO_EXTENSIONS } = require('./videoFormats');

const ALLOWED_ASSET_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.psd', '.psb', '.ai', '.eps', '.pdf',
  '.zip', ...SUPPORTED_VIDEO_EXTENSIONS, '.aep', '.prproj',
]);

const ALLOWED_THUMBNAIL_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

const AUTOMATIC_COLLECTION_BY_EXTENSION = Object.freeze({
  '.jpg': 'Photos',
  '.jpeg': 'Photos',
  '.png': 'Photos',
  '.ai': 'Vectors',
  '.eps': 'Vectors',
  '.psd': 'Psd',
  '.psb': 'Psd',
});

function getAutomaticAssetCollection(filename) {
  const extension = path.extname(String(filename || '').replace(/\\/g, '/')).toLowerCase();
  return AUTOMATIC_COLLECTION_BY_EXTENSION[extension] ||
    (SUPPORTED_VIDEO_EXTENSIONS.includes(extension) ? 'Videos' : null);
}

function resolveAssetCollection(filename, requestedCollection) {
  return getAutomaticAssetCollection(filename) || String(requestedCollection || '').trim();
}

function isThumbnailRequiredForCollection(collection) {
  return String(collection || '').trim().toLowerCase() === 'templates';
}

function isAllowedAssetUploadFile(file) {
  if (file.fieldname === 'thumbnail') {
    return ALLOWED_THUMBNAIL_MIME_TYPES.has(file.mimetype);
  }
  return ALLOWED_ASSET_EXTENSIONS.has(path.extname(file.originalname || '').toLowerCase());
}

module.exports = {
  getAutomaticAssetCollection,
  isThumbnailRequiredForCollection,
  isAllowedAssetUploadFile,
  resolveAssetCollection,
};
