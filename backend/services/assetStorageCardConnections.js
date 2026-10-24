const fs = require('node:fs');
const path = require('node:path');

const CONNECTIONS_FILE = path.join(__dirname, '..', 'settings', 'asset-storage-card-connections.json');
const STORAGE_LIMITS = Object.freeze({ assets: 99, thumbnails: 9 });

function getConnectedStorageLocations(storage, locations, connectionStatuses) {
  if (!Object.hasOwn(STORAGE_LIMITS, storage)) {
    throw new TypeError('Storage type must be assets or thumbnails.');
  }
  if (!Array.isArray(locations)) throw new TypeError('Storage locations must be an array.');
  const statuses = connectionStatuses?.[storage] || {};
  return locations.filter((location, index) => (
    location !== null &&
    location !== undefined &&
    statuses[String(index + 1)] !== false
  ));
}

function createAssetStorageCardConnections(filePath = CONNECTIONS_FILE) {
  const read = () => {
    try {
      const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const connections = { assets: {}, thumbnails: {} };
      for (const storage of Object.keys(STORAGE_LIMITS)) {
        const locations = stored[storage] || {};
        if (!locations || typeof locations !== 'object' || Array.isArray(locations)) {
          throw new Error('Stored storage-card connection settings are invalid.');
        }
        for (const [locationNumber, connected] of Object.entries(locations)) {
          const number = Number(locationNumber);
          if (
            !Number.isInteger(number) ||
            number < 1 ||
            number > STORAGE_LIMITS[storage] ||
            typeof connected !== 'boolean'
          ) {
            throw new Error('Stored storage-card connection settings are invalid.');
          }
          connections[storage][String(number)] = connected;
        }
      }
      return connections;
    } catch (error) {
      if (error.code === 'ENOENT') return { assets: {}, thumbnails: {} };
      throw error;
    }
  };

  return {
    get: read,
    getConnectedLocations(storage, locations) {
      return getConnectedStorageLocations(storage, locations, read());
    },
    update(storage, locationNumber, connected) {
      if (!Object.hasOwn(STORAGE_LIMITS, storage)) {
        throw new TypeError('Storage type must be assets or thumbnails.');
      }
      if (
        !Number.isInteger(locationNumber) ||
        locationNumber < 1 ||
        locationNumber > STORAGE_LIMITS[storage] ||
        typeof connected !== 'boolean'
      ) {
        throw new TypeError('Storage-card connection settings are invalid.');
      }

      const next = read();
      next[storage][String(locationNumber)] = connected;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporaryPath, filePath);
      return next;
    },
    remove(storage, locationNumber) {
      if (!Object.hasOwn(STORAGE_LIMITS, storage)) {
        throw new TypeError('Storage type must be assets or thumbnails.');
      }
      if (!Number.isInteger(locationNumber) || locationNumber < 2 || locationNumber > STORAGE_LIMITS[storage]) {
        throw new TypeError('Storage-card location number is invalid.');
      }

      const next = read();
      const shifted = {};
      for (const [number, connected] of Object.entries(next[storage])) {
        const currentNumber = Number(number);
        if (currentNumber < locationNumber) shifted[number] = connected;
        if (currentNumber > locationNumber) shifted[String(currentNumber - 1)] = connected;
      }
      next[storage] = shifted;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporaryPath, filePath);
      return next;
    },
  };
}

const connections = createAssetStorageCardConnections();

module.exports = { createAssetStorageCardConnections, getConnectedStorageLocations, ...connections };
