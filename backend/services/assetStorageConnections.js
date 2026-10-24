const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getAssetStorageRoots } = require('../config');

const DEFAULT_CONNECTIONS = Object.freeze({ assets: true, thumbnails: true });
const CONNECTIONS_FILE = path.join(__dirname, '..', 'settings', 'asset-storage-connections.json');

function normalizeLocations(locations, type, legacyPath) {
  if (locations === undefined) {
    if (!legacyPath) return [];
    const singular = type === 'assets' ? 'Asset' : 'Thumbnail';
    return [{ id: `${type}-1`, label: `${singular} 1`, path: legacyPath }];
  }
  if (!Array.isArray(locations)) throw new Error(`Stored ${type} storage locations are invalid.`);
  return locations.map((location, index) => {
    if (location === null) return null;
    if (
      !location ||
      typeof location.id !== 'string' ||
      typeof location.label !== 'string' ||
      typeof location.path !== 'string' ||
      !path.isAbsolute(location.path)
    ) {
      throw new Error(`Stored ${type} storage location ${index + 1} is invalid.`);
    }
    return { id: location.id, label: location.label, path: location.path };
  });
}

function getConfiguredStorageRoots(filePath = CONNECTIONS_FILE, environment = process.env) {
  const saved = readSavedSettings(filePath);
  const envRoots = getAssetStorageRoots(environment);
  const assetLocations = saved.assetLocations.length
    ? saved.assetLocations
    : normalizeLocations(undefined, 'assets', saved.assetRoot || envRoots.assetsRoot);
  const thumbnailLocations = saved.thumbnailLocations.length
    ? saved.thumbnailLocations
    : normalizeLocations(undefined, 'thumbnails', saved.thumbnailRoot || envRoots.thumbnailStoragePath);
  const defaultAssetLocationId = assetLocations.some((location) => location?.id === saved.defaultAssetLocationId)
    ? saved.defaultAssetLocationId
    : assetLocations.find((location) => location?.id)?.id || null;
  const defaultThumbnailLocationId = thumbnailLocations.some((location) => location?.id === saved.defaultThumbnailLocationId)
    ? saved.defaultThumbnailLocationId
    : thumbnailLocations.find((location) => location?.id)?.id || null;
  return {
    assetsRoot: assetLocations.find((location) => location?.id === defaultAssetLocationId)?.path ||
      saved.assetRoot || envRoots.assetsRoot,
    thumbnailStoragePath: thumbnailLocations.find((location) => location?.id === defaultThumbnailLocationId)?.path ||
      saved.thumbnailRoot || envRoots.thumbnailStoragePath,
    assetLocations,
    thumbnailLocations,
    defaultAssetLocationId,
    defaultThumbnailLocationId,
  };
}

function readSavedSettings(filePath) {
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
      assetLocations: normalizeLocations(stored.assetLocations, 'assets', stored.assetRoot),
      thumbnailLocations: normalizeLocations(stored.thumbnailLocations, 'thumbnails', stored.thumbnailRoot),
      defaultAssetLocationId: stored.defaultAssetLocationId || null,
      defaultThumbnailLocationId: stored.defaultThumbnailLocationId || null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        assetRoot: null,
        thumbnailRoot: null,
        assetLocations: [],
        thumbnailLocations: [],
        defaultAssetLocationId: null,
        defaultThumbnailLocationId: null,
      };
    }
    throw error;
  }
}

function getDisconnectedStorageForRequest(method, requestPath, connections, cardConnections = null) {
  const requestMethod = String(method || '').toUpperCase();
  const normalizedPath = String(requestPath || '');
  const allCardsDisconnected = (storage) => {
    const locations = storage === 'assets' ? connections.assetLocations : connections.thumbnailLocations;
    if (!Array.isArray(locations) || !locations.some(Boolean)) return false;
    const statuses = cardConnections?.[storage] || {};
    return locations.every((location, index) => !location || statuses[String(index + 1)] === false);
  };
  const isThumbnailRequest =
    normalizedPath === '/api/thumbnail' ||
    /^\/api\/assets\/\d+\/thumbnail$/.test(normalizedPath) ||
    /^\/images\/\d+\/(?:download-thumbnail|thumbnail(?:\/retry)?)$/.test(normalizedPath) ||
    /^\/admin\/thumbnail\/(?:test-full-processing|retry-job\/)/.test(normalizedPath);
  if (isThumbnailRequest && (!connections.thumbnails || allCardsDisconnected('thumbnails'))) return 'thumbnails';

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
  if (isOriginalAssetRequest && (!connections.assets || allCardsDisconnected('assets'))) return 'assets';
  return null;
}

function createAssetStorageConnections(filePath = CONNECTIONS_FILE, environment = process.env) {
  const read = () => {
    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      stored = {};
    }
    if (
      stored.assets !== undefined && typeof stored.assets !== 'boolean' ||
      stored.thumbnails !== undefined && typeof stored.thumbnails !== 'boolean'
    ) {
      throw new Error('Stored asset storage connection settings are invalid.');
    }
    const roots = getConfiguredStorageRoots(filePath, environment);
    return {
      ...DEFAULT_CONNECTIONS,
      ...stored,
      assetRoot: roots.assetsRoot || null,
      thumbnailRoot: roots.thumbnailStoragePath || null,
      assetLocations: roots.assetLocations,
      thumbnailLocations: roots.thumbnailLocations,
      defaultAssetLocationId: roots.defaultAssetLocationId,
      defaultThumbnailLocationId: roots.defaultThumbnailLocationId,
    };
  };

  const write = (state) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    return read();
  };

  return {
    get: read,
    update(changes) {
      const next = { ...read(), ...changes };
      if (Object.hasOwn(changes, 'assetRoot') && !Object.hasOwn(changes, 'assetLocations')) {
        const active = next.assetLocations.find((location) => location?.id === next.defaultAssetLocationId);
        if (active) {
          next.assetLocations = next.assetLocations.map((location) =>
            location?.id === active.id ? { ...location, path: changes.assetRoot } : location
          );
        }
      }
      if (Object.hasOwn(changes, 'thumbnailRoot') && !Object.hasOwn(changes, 'thumbnailLocations')) {
        const active = next.thumbnailLocations.find((location) => location?.id === next.defaultThumbnailLocationId);
        if (active) {
          next.thumbnailLocations = next.thumbnailLocations.map((location) =>
            location?.id === active.id ? { ...location, path: changes.thumbnailRoot } : location
          );
        }
      }
      if (typeof next.assets !== 'boolean' || typeof next.thumbnails !== 'boolean') {
        throw new TypeError('Asset storage connection settings must be boolean values.');
      }
      if (
        (next.assetRoot !== null && (typeof next.assetRoot !== 'string' || !path.isAbsolute(next.assetRoot))) ||
        (next.thumbnailRoot !== null && (typeof next.thumbnailRoot !== 'string' || !path.isAbsolute(next.thumbnailRoot)))
      ) {
        throw new TypeError('Asset storage roots must be absolute paths or null.');
      }
      if (!Array.isArray(next.assetLocations) || next.assetLocations.length > 99) {
        throw new TypeError('There may be no more than 99 asset storage locations.');
      }
      if (!Array.isArray(next.thumbnailLocations) || next.thumbnailLocations.length > 9) {
        throw new TypeError('There may be no more than 9 thumbnail storage locations.');
      }
      return write(next);
    },
    addLocation(type, locationPath) {
      if (!['assets', 'thumbnails'].includes(type)) {
        throw new TypeError('Storage location type must be assets or thumbnails.');
      }
      if (typeof locationPath !== 'string' || !path.isAbsolute(locationPath)) {
        throw new TypeError('Storage location path must be absolute.');
      }
      const current = read();
      const key = type === 'assets' ? 'assetLocations' : 'thumbnailLocations';
      const limit = type === 'assets' ? 99 : 9;
      const locations = current[key];
      if (locations.length >= limit) {
        const error = new RangeError(`A maximum of ${limit} ${type} locations is allowed.`);
        error.code = 'STORAGE_LOCATION_LIMIT';
        throw error;
      }
      if (locations.some((location) => location && path.resolve(location.path) === path.resolve(locationPath))) {
        const error = new Error('This folder has already been added.');
        error.code = 'STORAGE_LOCATION_DUPLICATE';
        throw error;
      }
      const label = `${type === 'assets' ? 'Asset' : 'Thumbnail'} ${locations.length + 1}`;
      return write({
        ...current,
        [key]: [...locations, { id: `${type}-${randomUUID()}`, label, path: locationPath }],
      });
    },
    setLocation(type, locationNumber, locationPath) {
      if (!['assets', 'thumbnails'].includes(type)) {
        throw new TypeError('Storage location type must be assets or thumbnails.');
      }
      const limit = type === 'assets' ? 99 : 9;
      if (!Number.isInteger(locationNumber) || locationNumber < 1 || locationNumber > limit) {
        throw new TypeError('Storage location number is invalid.');
      }
      if (typeof locationPath !== 'string' || !path.isAbsolute(locationPath)) {
        throw new TypeError('Storage location path must be absolute.');
      }
      const current = read();
      const isAssets = type === 'assets';
      const key = isAssets ? 'assetLocations' : 'thumbnailLocations';
      const locations = [...current[key]];
      const index = locationNumber - 1;
      if (locations.length < index) locations.length = index;
      for (let slot = 0; slot < index; slot += 1) {
        if (locations[slot] === undefined) locations[slot] = null;
      }
      if (locations.some((location, locationIndex) =>
        locationIndex !== index && location && path.resolve(location.path) === path.resolve(locationPath)
      )) {
        const error = new Error('This folder has already been added.');
        error.code = 'STORAGE_LOCATION_DUPLICATE';
        throw error;
      }
      const existing = locations[index];
      const singular = isAssets ? 'Asset' : 'Thumbnail';
      const location = {
        id: existing?.id || `${type}-${randomUUID()}`,
        label: `${singular} ${locationNumber}`,
        path: locationPath,
      };
      locations[index] = location;
      const defaultId = isAssets ? current.defaultAssetLocationId : current.defaultThumbnailLocationId;
      const nextDefaultId = defaultId || (locationNumber === 1 ? location.id : null);
      const defaultLocation = locations.find((item) => item?.id === nextDefaultId);
      return write({
        ...current,
        [key]: locations,
        ...(isAssets
          ? {
            assetRoot: defaultLocation?.path || current.assetRoot,
            defaultAssetLocationId: nextDefaultId,
          }
          : {
            thumbnailRoot: defaultLocation?.path || current.thumbnailRoot,
            defaultThumbnailLocationId: nextDefaultId,
          }),
      });
    },
    removeLocation(type, locationId) {
      if (!['assets', 'thumbnails'].includes(type)) {
        throw new TypeError('Storage location type must be assets or thumbnails.');
      }
      if (typeof locationId !== 'string' || !locationId) {
        throw new TypeError('Storage location ID is required.');
      }
      const current = read();
      const isAssets = type === 'assets';
      const key = isAssets ? 'assetLocations' : 'thumbnailLocations';
      const locations = current[key];
      const locationIndex = locations.findIndex((location) => location?.id === locationId);
      if (locationIndex < 0) {
        const error = new Error('The selected storage location does not exist.');
        error.code = 'STORAGE_LOCATION_NOT_FOUND';
        throw error;
      }
      if (locationIndex === 0) {
        const error = new Error('The primary storage location cannot be deleted.');
        error.code = 'STORAGE_LOCATION_PRIMARY';
        throw error;
      }
      const remainingLocations = locations.filter(({ id }) => id !== locationId);
      const isDefault = (isAssets ? current.defaultAssetLocationId : current.defaultThumbnailLocationId) === locationId;
      const nextDefault = isDefault
        ? remainingLocations[0]
        : remainingLocations.find((location) => location?.id === (isAssets ? current.defaultAssetLocationId : current.defaultThumbnailLocationId));
      return write({
        ...current,
        [key]: remainingLocations,
        ...(isAssets
          ? { assetRoot: nextDefault?.path || current.assetRoot, defaultAssetLocationId: nextDefault?.id || null }
          : { thumbnailRoot: nextDefault?.path || current.thumbnailRoot, defaultThumbnailLocationId: nextDefault?.id || null }),
      });
    },
    removeLocationAt(type, locationNumber) {
      if (!['assets', 'thumbnails'].includes(type)) {
        throw new TypeError('Storage location type must be assets or thumbnails.');
      }
      const limit = type === 'assets' ? 99 : 9;
      if (!Number.isInteger(locationNumber) || locationNumber < 2 || locationNumber > limit) {
        throw new TypeError('Storage location number is invalid.');
      }
      const current = read();
      const isAssets = type === 'assets';
      const key = isAssets ? 'assetLocations' : 'thumbnailLocations';
      const locations = [...current[key]];
      const index = locationNumber - 1;
      if (index < locations.length) locations.splice(index, 1);
      const defaultId = isAssets ? current.defaultAssetLocationId : current.defaultThumbnailLocationId;
      const defaultStillExists = locations.some((location) => location?.id === defaultId);
      const nextDefault = defaultStillExists
        ? locations.find((location) => location?.id === defaultId)
        : locations.find((location) => location?.id);
      return write({
        ...current,
        [key]: locations,
        ...(isAssets
          ? { assetRoot: nextDefault?.path || current.assetRoot, defaultAssetLocationId: nextDefault?.id || null }
          : { thumbnailRoot: nextDefault?.path || current.thumbnailRoot, defaultThumbnailLocationId: nextDefault?.id || null }),
      });
    },
    setDefault(type, locationId) {
      if (!['assets', 'thumbnails'].includes(type)) {
        throw new TypeError('Storage location type must be assets or thumbnails.');
      }
      const current = read();
      const isAssets = type === 'assets';
      const locations = isAssets ? current.assetLocations : current.thumbnailLocations;
      const selected = locations.find((location) => location?.id === locationId);
      if (!selected) throw new Error('The selected storage location does not exist.');
      return write({
        ...current,
        ...(isAssets
          ? { assetRoot: selected.path, defaultAssetLocationId: selected.id }
          : { thumbnailRoot: selected.path, defaultThumbnailLocationId: selected.id }),
      });
    },
    isAssetsConnected: () => read().assets,
    isThumbnailsConnected: () => read().thumbnails,
    getConfiguredStorageRoots: () => getConfiguredStorageRoots(filePath, environment),
  };
}

const connections = createAssetStorageConnections();

module.exports = {
  createAssetStorageConnections,
  getDisconnectedStorageForRequest,
  getConfiguredStorageRoots,
  ...connections,
};
