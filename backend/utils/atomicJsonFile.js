'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');

const WINDOWS_RENAME_RETRY_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);
const WINDOWS_RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function renameWithRetry(source, destination, platform, rename) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (
        platform !== 'win32' ||
        !WINDOWS_RENAME_RETRY_CODES.has(error.code) ||
        attempt >= WINDOWS_RENAME_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }
      await delay(WINDOWS_RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function writeJsonAtomically(destination, value, options = {}) {
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  const rename = options.rename || fs.rename;
  const unlink = options.unlink || fs.unlink;
  let handle;
  let temporaryCreated = false;

  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    temporaryCreated = true;
    await handle.writeFile(JSON.stringify(value));
    await handle.close();
    handle = null;
    await renameWithRetry(temporary, destination, options.platform || process.platform, rename);
  } catch (error) {
    const cleanupErrors = [];
    if (handle) {
      try {
        await handle.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (temporaryCreated) {
      try {
        await unlink(temporary);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length) {
      throw new Error(
        `${error.message}; temporary JSON cleanup failed: ${cleanupErrors.map(({ message }) => message).join('; ')}`,
        { cause: error }
      );
    }
    throw error;
  }
}

module.exports = { writeJsonAtomically };
