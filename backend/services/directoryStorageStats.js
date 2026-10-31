const fs = require('node:fs');
const path = require('node:path');

async function getDirectoryStorageStats(directoryPath, fileSystem = fs) {
  let directoryExists = false;
  let folderSizeBytes = null;
  const resolvedPath = String(directoryPath || '').trim();

  if (resolvedPath) {
    try {
      const directoryStat = await fileSystem.promises.stat(resolvedPath);
      directoryExists = directoryStat.isDirectory();
      if (directoryExists) {
        folderSizeBytes = 0;
        const pendingDirectories = [resolvedPath];
        while (pendingDirectories.length > 0) {
          const currentDirectory = pendingDirectories.pop();
          const entries = await fileSystem.promises.readdir(currentDirectory, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = path.join(currentDirectory, entry.name);
            if (entry.isDirectory()) {
              pendingDirectories.push(entryPath);
            } else if (entry.isFile()) {
              folderSizeBytes += (await fileSystem.promises.stat(entryPath)).size;
            }
          }
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        directoryExists = false;
        folderSizeBytes = 0;
      } else {
        folderSizeBytes = null;
      }
    }
  }

  let driveFreeBytes = null;
  if (resolvedPath && typeof fileSystem.statfsSync === 'function') {
    let capacityPath = resolvedPath;
    while (capacityPath) {
      try {
        if ((await fileSystem.promises.stat(capacityPath)).isDirectory()) break;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') break;
      }
      const parentPath = path.dirname(capacityPath);
      if (parentPath === capacityPath) {
        capacityPath = '';
        break;
      }
      capacityPath = parentPath;
    }

    if (capacityPath) {
      try {
        const capacity = fileSystem.statfsSync(capacityPath);
        const blockSize = Number(capacity.bsize);
        const availableBlocks = Number(capacity.bavail ?? capacity.bfree);
        const availableBytes = blockSize * availableBlocks;
        if (Number.isFinite(availableBytes) && availableBytes >= 0) {
          driveFreeBytes = availableBytes;
        }
      } catch (error) {
        driveFreeBytes = null;
      }
    }
  }

  return { directoryExists, folderSizeBytes, driveFreeBytes };
}

module.exports = { getDirectoryStorageStats };
