const DEFAULT_CORS_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://0.0.0.0:3000',
  'http://100.101.63.63:3000',
  'http://100.102.63.63:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://0.0.0.0:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'http://0.0.0.0:3002',
  'https://gfxunlimit.com',
  'https://www.gfxunlimit.com',
];

function getAssetServerOrigin(value = process.env.PC2_ASSET_SERVER_URL, protocols = ['http:', 'https:']) {
  const configured = String(value || '').trim();
  let url;
  try {
    url = new URL(configured);
  } catch (_error) {
    throw new Error('PC2_ASSET_SERVER_URL must be a valid HTTP(S) origin');
  }

  if (
    !protocols.includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('PC2_ASSET_SERVER_URL must be a valid HTTP(S) origin');
  }
  return url.origin;
}

function getAssetServerHttpOrigin(value = process.env.PC2_ASSET_SERVER_URL) {
  return getAssetServerOrigin(value, ['http:']);
}

function getAssetStorageRoots(environment = process.env) {
  return {
    assetsRoot: String(environment.ASSETS_ROOT || '').trim() || null,
    thumbnailStoragePath: String(environment.THUMBNAIL_STORAGE_PATH || '').trim() || null,
  };
}

function getCorsAllowedOrigins(environment = process.env) {
  const configuredOrigins = String(environment.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of configuredOrigins) {
    let url;
    try {
      url = new URL(origin);
    } catch (_error) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.origin !== origin
    ) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins');
    }
  }
  return new Set(configuredOrigins.length ? configuredOrigins : DEFAULT_CORS_ALLOWED_ORIGINS);
}

module.exports = {
  getAssetServerOrigin,
  getAssetServerHttpOrigin,
  getAssetStorageRoots,
  getCorsAllowedOrigins,
};
