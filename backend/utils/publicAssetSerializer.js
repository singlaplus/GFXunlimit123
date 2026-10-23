const path = require("node:path");

const PRIVATE_ASSET_FIELDS = new Set([
  "upload_file_device",
  "upload_file_inode",
  "upload_content_sha256",
  "upload_request_hash",
  "upload_error",
  "processing_error",
  "thumbnail_error",
]);

const getSafeFilename = (value) => {
  if (typeof value !== "string") return value;
  const normalized = value.replace(/\\/g, "/");
  return path.posix.basename(normalized);
};

const sanitizePublicAsset = (asset) => {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) return asset;

  const sanitized = {};
  for (const [key, value] of Object.entries(asset)) {
    if (PRIVATE_ASSET_FIELDS.has(key) || /(?:^|_)(?:path|paths|location)(?:_|$)/i.test(key)) {
      continue;
    }
    if (key === "filename" || key === "original_filename") {
      sanitized[key] = getSafeFilename(value);
      continue;
    }
    if (key === "thumbnail_url") {
      sanitized[key] = value && asset.id
        ? `/api/assets/${encodeURIComponent(String(asset.id))}/thumbnail`
        : null;
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
};

const sanitizePublicAssets = (assets) => assets.map(sanitizePublicAsset);

module.exports = {
  sanitizePublicAsset,
  sanitizePublicAssets,
};
