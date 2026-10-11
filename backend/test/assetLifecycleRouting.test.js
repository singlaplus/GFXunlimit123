const test = require('node:test');
const assert = require('node:assert/strict');
const { assertLocalAssetLifecycleSupported } = require('../services/assetLifecycleRouting');

test('blocks local lifecycle filesystem operations on macOS before they can reach the services', () => {
  assert.throws(
    () => assertLocalAssetLifecycleSupported('darwin'),
    {
      message: 'Asset moves and deletion are unavailable from macOS until SERVER-side lifecycle operations are configured.',
      statusCode: 503,
    }
  );
});

test('preserves SERVER-local lifecycle operations on Windows', () => {
  assert.doesNotThrow(() => assertLocalAssetLifecycleSupported('win32'));
});
