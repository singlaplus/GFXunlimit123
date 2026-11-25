export const SYSTEM_MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
export const DEFAULT_UPLOAD_LIMIT_BYTES = 20 * 1024 ** 2;
const ALLOWED_UPLOAD_LIMIT_VALUES = [1, 5, 10, 20, 100];

export function formatUploadLimit(bytes) {
  if (bytes >= 1024 ** 3 && bytes % (1024 ** 3) === 0) {
    return `${bytes / (1024 ** 3)} GB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function getUploadLimitConfig(permissions = {}, role = "") {
  const safePermissions = typeof permissions === "object" && permissions !== null
    ? permissions
    : {};
  const defaultValue = DEFAULT_UPLOAD_LIMIT_BYTES / (1024 ** 2);
  const value = Number(safePermissions.upload_limit_value ?? defaultValue);
  const safeValue = ALLOWED_UPLOAD_LIMIT_VALUES.includes(value) ? value : defaultValue;
  const unit = String(safePermissions.upload_limit_unit || "MB").toUpperCase();
  const safeUnit = ["MB", "GB"].includes(unit) ? unit : "MB";
  const configuredBytes = safeValue * (safeUnit === "GB" ? 1024 ** 3 : 1024 ** 2);
  const configuredLimitBytes = String(role || "").toLowerCase() === "contributor"
    ? configuredBytes
    : SYSTEM_MAX_UPLOAD_BYTES;
  const bytes = Math.min(configuredLimitBytes, SYSTEM_MAX_UPLOAD_BYTES);

  return {
    bytes,
    label: bytes < configuredLimitBytes
      ? `${formatUploadLimit(bytes)} (system maximum; admin setting: ${safeValue} ${safeUnit})`
      : formatUploadLimit(bytes)
  };
}
