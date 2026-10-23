const fs = require('node:fs');
const path = require('node:path');
const { getAssetStorageRoots } = require('../config');

const DEFAULT_CONNECTIONS = Object.freeze({ assets: true, thumbnails: true });
const CONNECTIONS_FILE = path.join(__dirname, '..', 'settings', 'asset-storage-connections.json');

function getConfiguredStorageRoots(filePath = CONNECTIONS_FILE, environment = process.env) {
  const savedRoots = readSavedRoots(filePath);
  const environmentRoots = getAssetStorageRoots(environment);
  return {
    assetsRoot: savedRoots.assetRoot || environmentRoots.assetsRoot,
    thumbnailStoragePath: savedRoots.thumbnailRoot || environmentRoots.thumbnailStoragePath,
  };
}

function readSavedRoots(filePath) {
  try {
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (
      stored.assetRoot !== undefined && stored.assetRoot !== null &&
        (typeof stored.assetRoot !== 'string' || !path.isAbsolute(stored.assetRoot)) ||
      stored.thumbnailRoot !== undefined && stored.thumbnailRoot !== null &&
        (typeof stored.thumbnailRoot !== 'string' || !path.isAbsolute(stored.thumbnailRoot))
    ) {
      throw new Error('Stored asset storage roots are invalid.');
    }
    return {
      assetRoot: stored.assetRoot || null,
      thumbnailRoot: stored.thumbnailRoot || null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { assetRoot: null, thumbnailRoot: null };
    throw error;
  }
}

function getDisconnectedStorageForRequest(method, requestPath, connections) {
  const requestMethod = String(method || '').toUpperCase();
  const normalizedPath = String(requestPath || '');
  const isThumbnailRequest =
    normalizedPath === '/api/thumbnail' ||
    /^\/api\/assets\/\d+\/thumbnail$/.test(normalizedPath) ||
    /^\/images\/\d+\/(?:download-thumbnail|thumbnail(?:\/retry)?)$/.test(normalizedPath) ||
    /^\/admin\/thumbnail\/(?:test-full-processing|retry-job\/)/.test(normalizedPath);
  if (isThumbnailRequest && !connections.thumbnails) return 'thumbnails';

  const isOriginalAssetRequest =
    (normalizedPath === '/api/files' || normalizedPath.startsWith('/api/files/')) &&
      normalizedPath !== '/api/files/branding' &&
      !normalizedPath.startsWith('/api/files/branding/') ||
    /^\/api\/images\/[A-Za-z0-9_-]+$/.test(normalizedPath) ||
    /^\/api\/catalog-preview\/[A-Za-z0-9_-]+$/.test(normalizedPath) ||
    normalizedPath === '/uploads/processed' ||
    normalizedPath === '/upload' ||
    /^\/images\/\d+\/download(?:-original)?$/.test(normalizedPath) ||
    /^\/images\/\d+$/.test(normalizedPath) && ['PUT', 'PATCH', 'DELETE'].includes(requestMethod) ||
    /^\/customer-download\/[^/]+$/.test(normalizedPath);
  if (isOriginalAssetRequest && !connections.assets) return 'assets';

  return null;
}

function createAssetStorageConnections(filePath = CONNECTIONS_FILE) {
  const read = () => {
    try {
      const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (typeof stored.assets !== 'boolean' || typeof stored.thumbnails !== 'boolean') {
        throw new Error('Stored asset storage connection settings are invalid.');
      }
      return {
        assets: stored.assets,
        thumbnails: stored.thumbnails,
        ...readSavedRoots(filePath),
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { ...DEFAULT_CONNECTIONS, assetRoot: null, thumbnailRoot: null };
      }
      throw error;
    }
  };

  return {
    get: read,
    update(changes) {
      const next = { ...read(), ...changes };
      if (typeof next.assets !== 'boolean' || typeof next.thumbnails !== 'boolean') {
        throw new TypeError('Asset storage connection settings must be boolean values.');
      }
      if (
        (next.assetRoot !== null && (typeof next.assetRoot !== 'string' || !path.isAbsolute(next.assetRoot))) ||
        (next.thumbnailRoot !== null && (typeof next.thumbnailRoot !== 'string' || !path.isAbsolute(next.thumbnailRoot)))
      ) {
        throw new TypeError('Asset storage roots must be absolute paths or null.');
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporaryPath, filePath);
      return next;
    },
    isAssetsConnected: () => read().assets,
    isThumbnailsConnected: () => read().thumbnails,
    getConfiguredStorageRoots: () => getConfiguredStorageRoots(filePath),
  };
}

const connections = createAssetStorageConnections();

module.exports = { createAssetStorageConnections, getDisconnectedStorageForRequest, getConfiguredStorageRoots, ...connections };
