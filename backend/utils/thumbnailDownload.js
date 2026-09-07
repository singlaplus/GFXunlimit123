function normalizeThumbnailDownloadValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  let nextValue = String(value).trim();
  if (!nextValue || nextValue === 'null' || nextValue === 'undefined') {
    return '';
  }

  try {
    nextValue = decodeURIComponent(nextValue);
  } catch (err) {
    // Leave it as-is when it is not URL-encoded.
  }

  const fileParamMatch = nextValue.match(/[?&]file=([^&]+)/i);
  if (fileParamMatch && fileParamMatch[1]) {
    nextValue = fileParamMatch[1];
  }

  nextValue = nextValue
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/+/, '')
    .replace(/^api\/files\/+/, '')
    .replace(/^uploads[\\/]+/, '')
    .replace(/^api\/thumbnail[\\/]+/, '')
    .replace(/^file=/i, '')
    .replace(/\\/g, '/');

  try {
    nextValue = decodeURIComponent(nextValue);
  } catch (err) {
    // Leave it as-is if it is already decoded.
  }

  return nextValue
    .replace(/^\/+/, '')
    .replace(/^uploads[\\/]+/, '')
    .replace(/^api\/files\/+/, '');
}

module.exports = {
  normalizeThumbnailDownloadValue,
};
