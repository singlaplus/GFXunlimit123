const fs = require('node:fs/promises');
const path = require('node:path');

function normalizeAssetPath(value) {
  const assetPath = String(value || '').trim();
  const segments = assetPath.split('/');

  if (
    !assetPath ||
    assetPath.startsWith('/') ||
    assetPath.includes('\\') ||
    /[\0-\x1f\x7f]/.test(assetPath) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('%') || segment.includes(':'))
  ) {
    const error = new Error('Invalid asset path');
    error.code = 'INVALID_ASSET_PATH';
    throw error;
  }

  return segments.join('/');
}

function isPathInside(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath);
}

function getProductionAssetRoot(nodeEnv, assetRoot) {
  if (nodeEnv !== 'production' || typeof assetRoot !== 'string' || !assetRoot.trim()) return null;
  return assetRoot.trim();
}

async function resolveAssetFile(assetRoot, requestedPath) {
  const relativePath = normalizeAssetPath(requestedPath);
  let realRoot;

  try {
    realRoot = await fs.realpath(path.resolve(assetRoot));
  } catch (error) {
    error.code = 'ASSET_ROOT_UNAVAILABLE';
    throw error;
  }

  const candidatePath = path.resolve(realRoot, ...relativePath.split('/'));
  if (!isPathInside(realRoot, candidatePath)) {
    const error = new Error('Invalid asset path');
    error.code = 'INVALID_ASSET_PATH';
    throw error;
  }

  const realFilePath = await fs.realpath(candidatePath);
  if (!isPathInside(realRoot, realFilePath)) {
    const error = new Error('Invalid asset path');
    error.code = 'INVALID_ASSET_PATH';
    throw error;
  }

  const stats = await fs.stat(realFilePath);
  if (!stats.isFile()) {
    const error = new Error('Asset not found');
    error.code = 'ENOENT';
    throw error;
  }

  return realFilePath;
}

async function sendAssetFile(req, res, assetRoot, requestedPath) {
  try {
    const filePath = await resolveAssetFile(assetRoot, requestedPath);
    return res.sendFile(filePath, (error) => {
      if (!error) return;
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        res.status(404).json({ error: 'Asset not found' });
        return;
      }
      res.status(500).json({ error: 'Unable to serve asset' });
    });
  } catch (error) {
    if (error.code === 'INVALID_ASSET_PATH') {
      return res.status(400).json({ error: 'Invalid asset path' });
    }
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return res.status(404).json({ error: 'Asset not found' });
    }
    return res.status(500).json({ error: 'Asset storage unavailable' });
  }
}

function createAssetServingHandler({ getAssetRoot, getAssetPath, getRemotePath, proxyHandler, missingAssetMessage = 'Invalid asset path' }) {
  return async (req, res) => {
    if (!/^(GET|HEAD)$/i.test(req.method)) {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    let assetPath;
    try {
      const requestedPath = getAssetPath(req);
      if (requestedPath === undefined || requestedPath === null || String(requestedPath).trim() === '') {
        return res.status(400).json({ error: missingAssetMessage });
      }
      assetPath = normalizeAssetPath(requestedPath);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid asset path' });
    }

    const assetRoot = getAssetRoot();
    if (assetRoot) {
      return sendAssetFile(req, res, assetRoot, assetPath);
    }

    return proxyHandler(req, res, getRemotePath(assetPath, req));
  };
}

function encodeAssetPath(value) {
  return normalizeAssetPath(value).split('/').map(encodeURIComponent).join('/');
}

module.exports = {
  createAssetServingHandler,
  encodeAssetPath,
  getProductionAssetRoot,
  normalizeAssetPath,
  resolveAssetFile,
  sendAssetFile,
};