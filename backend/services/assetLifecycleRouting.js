function assertLocalAssetLifecycleSupported(platform = process.platform) {
  if (platform === 'darwin') {
    const error = new Error(
      'Asset moves and deletion are unavailable from macOS until SERVER-side lifecycle operations are configured.'
    );
    error.statusCode = 503;
    throw error;
  }
}

module.exports = { assertLocalAssetLifecycleSupported };
