const path = require('node:path');

const ALLOWED_ASSET_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.psd', '.psb', '.ai', '.eps', '.pdf',
  '.zip', '.mp4', '.avi', '.mkv', '.mov', '.webm', '.aep', '.prproj',
]);

const ALLOWED_THUMBNAIL_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

function isAllowedAssetUploadFile(file) {
  if (file.fieldname === 'thumbnail') {
    return ALLOWED_THUMBNAIL_MIME_TYPES.has(file.mimetype);
  }
  return ALLOWED_ASSET_EXTENSIONS.has(path.extname(file.originalname || '').toLowerCase());
}

module.exports = {
  isAllowedAssetUploadFile,
};
