const path = require('node:path');

function getAssetUploadTimeZone() {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function getUploadDateParts(date, timeZone = getAssetUploadTimeZone()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('Upload acceptance time must be a valid date.');
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    day: values.day,
    month: values.month,
    year: values.year,
    dateStamp: `${values.day}${values.month}${values.year}`,
  };
}

function sanitizeFilenameComponent(value, label) {
  const sanitized = String(value || '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*%\u0000-\u001f\u007f\u0080-\u009f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new Error(`${label} is invalid.`);
  }
  return sanitized;
}

function sanitizeUploadUsername(username) {
  return sanitizeFilenameComponent(username, 'Contributor username');
}

function sanitizeOriginalUploadFilename(originalFilename) {
  const basename = String(originalFilename || '').replace(/\\/g, '/').split('/').pop();
  const sanitized = sanitizeFilenameComponent(basename, 'Original filename');
  if (!path.extname(sanitized)) {
    throw new Error('Original filename must include a supported file extension.');
  }
  return sanitized;
}

function createFinalUploadFilename(username, originalFilename, dateParts) {
  const safeUsername = sanitizeUploadUsername(username);
  const safeOriginalFilename = sanitizeOriginalUploadFilename(originalFilename);
  const filename = `${safeUsername}_${dateParts.dateStamp}_${safeOriginalFilename}`;
  if (Buffer.byteLength(filename, 'utf8') > 255) {
    throw new Error('Final upload filename exceeds the filesystem filename limit.');
  }
  return filename;
}

module.exports = {
  createFinalUploadFilename,
  getAssetUploadTimeZone,
  getUploadDateParts,
  sanitizeOriginalUploadFilename,
  sanitizeUploadUsername,
};
