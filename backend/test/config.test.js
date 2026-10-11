const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getAssetServerOrigin,
  getAssetServerHttpOrigin,
  getAssetStorageRoots,
  getCorsAllowedOrigins,
} = require('../config');

test('validates the configured asset service origin without pinning a machine address', () => {
  assert.equal(getAssetServerHttpOrigin('http://asset-server.example:5000'), 'http://asset-server.example:5000');
  assert.equal(getAssetServerOrigin('https://asset-server.example'), 'https://asset-server.example');
});

test('rejects missing, invalid, non-origin, and disallowed-protocol asset service URLs', () => {
  for (const value of ['', 'not a URL', 'ftp://asset-server.example', 'http://user:pass@asset-server.example', 'http://asset-server.example/proxy']) {
    assert.throws(() => getAssetServerHttpOrigin(value));
  }
  assert.throws(() => getAssetServerOrigin(''));
});

test('reads configured filesystem roots without inventing local fallbacks', () => {
  assert.deepEqual(getAssetStorageRoots({}), {
    assetsRoot: null,
    thumbnailStoragePath: null,
  });
  assert.deepEqual(getAssetStorageRoots({
    ASSETS_ROOT: ' /srv/assets ',
    THUMBNAIL_STORAGE_PATH: ' /srv/thumbnails ',
  }), {
    assetsRoot: '/srv/assets',
    thumbnailStoragePath: '/srv/thumbnails',
  });
});

test('uses the default CORS allowlist or a validated explicit replacement', () => {
  const defaults = getCorsAllowedOrigins({});
  assert.ok(defaults.has('https://gfxunlimit.com'));
  assert.ok(defaults.has('http://localhost:3000'));
  const configured = getCorsAllowedOrigins({ CORS_ALLOWED_ORIGINS: 'https://admin.example' });
  assert.ok(configured.has('https://admin.example'));
  assert.equal(configured.has('http://100.102.63.63:3000'), false);
  assert.throws(() => getCorsAllowedOrigins({ CORS_ALLOWED_ORIGINS: 'https://admin.example/path' }));
});
