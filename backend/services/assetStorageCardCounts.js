const fs = require('node:fs');
const path = require('node:path');

const COUNTS_FILE = path.join(__dirname, '..', 'settings', 'asset-storage-card-counts.json');
const STORAGE_LIMITS = Object.freeze({ assets: 99, thumbnails: 9 });

function normalizeUserId(userId) {
  if (typeof userId !== 'string' && typeof userId !== 'number') {
    throw new TypeError('A valid user ID is required for storage-card counts.');
  }
  const normalized = String(userId);
  if (!normalized || normalized.length > 255) {
    throw new TypeError('A valid user ID is required for storage-card counts.');
  }
  return normalized;
}

function validateCount(storage, count, minimum = 1) {
  if (!Object.hasOwn(STORAGE_LIMITS, storage)) {
    throw new TypeError('Storage type must be assets or thumbnails.');
  }
  if (
    !Number.isInteger(count) ||
    count < Math.max(1, minimum) ||
    count > STORAGE_LIMITS[storage]
  ) {
    throw new TypeError(`Storage-card count must be between ${Math.max(1, minimum)} and ${STORAGE_LIMITS[storage]}.`);
  }
  return count;
}

function createAssetStorageCardCounts(filePath = COUNTS_FILE) {
  const read = () => {
    try {
      const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!stored || typeof stored !== 'object' || !stored.users || typeof stored.users !== 'object' || Array.isArray(stored.users)) {
        throw new Error('Stored storage-card counts are invalid.');
      }
      for (const counts of Object.values(stored.users)) {
        if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
          throw new Error('Stored storage-card counts are invalid.');
        }
        for (const storage of Object.keys(STORAGE_LIMITS)) {
          if (counts[storage] !== undefined) validateCount(storage, counts[storage]);
        }
        if (counts.confirmed !== undefined && typeof counts.confirmed !== 'boolean') {
          throw new Error('Stored storage-card counts are invalid.');
        }
      }
      return stored;
    } catch (error) {
      if (error.code === 'ENOENT') return { users: {} };
      throw error;
    }
  };

  const write = (stored) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    return stored;
  };

  const normalizeMinimums = (minimumCounts = {}) => Object.fromEntries(
    Object.keys(STORAGE_LIMITS).map((storage) => {
      const minimum = minimumCounts[storage] ?? 1;
      return [storage, validateCount(storage, minimum)];
    })
  );

  return {
    get(userId, minimumCounts = {}, initialCounts = minimumCounts) {
      const userKey = normalizeUserId(userId);
      const minimums = normalizeMinimums(minimumCounts);
      const initial = normalizeMinimums(initialCounts);
      const stored = read();
      const current = Object.hasOwn(stored.users, userKey) ? stored.users[userKey] : null;
      const counts = Object.fromEntries(
        Object.keys(STORAGE_LIMITS).map((storage) => [
          storage,
          Math.max(current?.[storage] || 1, minimums[storage], current?.confirmed ? 1 : initial[storage]),
        ])
      );
      if (
        !current ||
        Object.keys(STORAGE_LIMITS).some((storage) => current[storage] !== counts[storage]) ||
        current.confirmed !== true
      ) {
        stored.users[userKey] = { ...counts, confirmed: current?.confirmed === true };
        write(stored);
      }
      return counts;
    },
    set(userId, storage, count, minimum = 1) {
      const userKey = normalizeUserId(userId);
      validateCount(storage, count, minimum);
      const stored = read();
      const current = Object.hasOwn(stored.users, userKey)
        ? stored.users[userKey]
        : { assets: 1, thumbnails: 1 };
      const counts = { assets: current.assets || 1, thumbnails: current.thumbnails || 1, [storage]: count };
      stored.users[userKey] = { ...counts, confirmed: true };
      write(stored);
      return counts;
    },
  };
}

module.exports = { createAssetStorageCardCounts, ...createAssetStorageCardCounts() };
