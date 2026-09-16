const DEFAULT_MAX_UPLOAD_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_UPLOAD_FILE_SIZE = DEFAULT_MAX_UPLOAD_FILE_SIZE;
const BRANDING_UPLOAD_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const resolveUploadLimitBytes = (customPermissions = {}) => {
  const safePermissions = typeof customPermissions === "object" && customPermissions !== null ? customPermissions : {};
  const rawValue = Number(safePermissions.upload_limit_value ?? 20);
  const value = [1, 5, 10, 20, 100].includes(rawValue) ? rawValue : 20;
  const unit = String(safePermissions.upload_limit_unit || "MB").toUpperCase();

  if (unit === "GB") {
    return value * 1024 * 1024 * 1024;
  }

  return value * 1024 * 1024;
};

module.exports = {
  DEFAULT_MAX_UPLOAD_FILE_SIZE,
  MAX_UPLOAD_FILE_SIZE,
  BRANDING_UPLOAD_FILE_SIZE,
  resolveUploadLimitBytes,
};
