const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function isInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath));
}

function getExistingDirectory(directoryPath) {
  try {
    const stats = fs.lstatSync(directoryPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) return null;
    return fs.realpathSync(directoryPath);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return null;
    throw error;
  }
}

function getMountForDirectory(directoryPath) {
  try {
    const output = execFileSync('df', ['-P', directoryPath], { encoding: 'utf8', timeout: 3000 });
    const mountPath = output.trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/).at(-1);
    return mountPath ? mountPath.replace(/\\040/g, ' ') : null;
  } catch (error) {
    if (['ENOENT', 'ETIMEDOUT', 'EACCES'].includes(error.code)) return null;
    throw error;
  }
}

function getAllowedStorageRoots({ currentRoots = [], platform = process.platform } = {}) {
  const candidates = new Set();
  if (platform === 'win32') {
    for (let drive = 65; drive <= 90; drive += 1) {
      candidates.add(`${String.fromCharCode(drive)}:\\`);
    }
  } else {
    if (platform === 'darwin') candidates.add(path.parse(process.cwd()).root);
    for (const currentRoot of currentRoots) {
      if (!currentRoot) continue;
      const canonicalCurrentRoot = getExistingDirectory(currentRoot);
      if (!canonicalCurrentRoot) continue;
      const mountPath = getMountForDirectory(canonicalCurrentRoot);
      if (mountPath && mountPath !== '/') candidates.add(mountPath);
      candidates.add(canonicalCurrentRoot);
    }
    const volumeDirectory = platform === 'darwin' ? '/Volumes' : ['/mnt', '/media', '/run/media'];
    const volumeDirectories = Array.isArray(volumeDirectory) ? volumeDirectory : [volumeDirectory];
    for (const volumePath of volumeDirectories) {
      const existingVolumePath = getExistingDirectory(volumePath);
      if (!existingVolumePath) continue;
      for (const entry of fs.readdirSync(existingVolumePath, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          candidates.add(path.join(existingVolumePath, entry.name));
        }
      }
    }
  }

  const roots = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const canonicalRoot = getExistingDirectory(candidate);
    if (!canonicalRoot || seen.has(canonicalRoot)) continue;
    seen.add(canonicalRoot);
    roots.push(canonicalRoot);
  }
  return roots.sort((left, right) => left.localeCompare(right));
}

function resolveAllowedDirectory(directoryPath, allowedRoots) {
  if (typeof directoryPath !== 'string' || !path.isAbsolute(directoryPath)) {
    throw new TypeError('Choose an absolute folder path.');
  }
  let canonicalPath;
  try {
    const stats = fs.lstatSync(directoryPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('The selected path must be a real folder.');
    }
    canonicalPath = fs.realpathSync(directoryPath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new Error('The selected folder does not exist.');
    }
    throw error;
  }
  if (!allowedRoots.some((rootPath) => isInside(rootPath, canonicalPath))) {
    throw new Error('The selected folder must be on a configured or mounted storage location.');
  }
  return canonicalPath;
}

function browseStorageDirectory(directoryPath, allowedRoots) {
  const canonicalPath = resolveAllowedDirectory(directoryPath, allowedRoots);
  const entries = fs.readdirSync(canonicalPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => {
      const childPath = path.join(canonicalPath, entry.name);
      const canonicalChild = getExistingDirectory(childPath);
      return canonicalChild && allowedRoots.some((rootPath) => isInside(rootPath, canonicalChild))
        ? { name: entry.name, path: canonicalChild }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
  const parentPath = path.dirname(canonicalPath);
  const canGoUp = parentPath !== canonicalPath && allowedRoots.some((rootPath) => isInside(rootPath, parentPath));
  return { path: canonicalPath, parentPath: canGoUp ? parentPath : null, directories: entries };
}

function validateStorageRootPair(assetRoot, thumbnailRoot, allowedRoots) {
  const canonicalAssetRoot = resolveAllowedDirectory(assetRoot, allowedRoots);
  const canonicalThumbnailRoot = resolveAllowedDirectory(thumbnailRoot, allowedRoots);
  if (isInside(canonicalAssetRoot, canonicalThumbnailRoot) || isInside(canonicalThumbnailRoot, canonicalAssetRoot)) {
    throw new Error('Assets and thumbnails must use separate, non-overlapping folders.');
  }
  return { assetRoot: canonicalAssetRoot, thumbnailRoot: canonicalThumbnailRoot };
}

module.exports = {
  browseStorageDirectory,
  getAllowedStorageRoots,
  resolveAllowedDirectory,
  validateStorageRootPair,
};
