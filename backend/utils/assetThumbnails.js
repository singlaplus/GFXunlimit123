const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const pool = require('../db');
const { getAssetServerOrigin } = require('../config');
const assetStorageConnections = require('../services/assetStorageConnections');
const assetStorageCardConnections = require('../services/assetStorageCardConnections');
const thumbnailGenerationSettings = require('../services/thumbnailGenerationSettings');
const { findWindowsToolExecutable } = require('../services/windowsToolPaths');
const { VIDEO_EXTENSIONS } = require('../services/videoFormats');
const processorFactory = require('../thumbnail-engine/processor-factory');
const { resolveAssetFile } = require('./assetServing');
const { getAssetSourceDimensions } = require('./assetDimensions');

const PROCESSOR_VERSION = 'webp-proportional-20pct-q37-max50kb-v2';
const PROPORTIONAL_PROCESSOR_VERSION = PROCESSOR_VERSION;
const THUMBNAIL_MIN_QUALITY = 1;
const MIN_THUMBNAIL_DIMENSION = 16;
const MIN_THUMBNAIL_SHORT_DIMENSION = 8;
const VIDEO_PREVIEW_GENERATION_ID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function getWindowsToolExecutable(toolName, fallback) {
  if (process.platform !== 'win32') return fallback;
  const configuredPath = toolName === 'ghostscript'
    ? process.env.GHOSTSCRIPT_PATH
    : process.env.IMAGEMAGICK_PATH;
  if (configuredPath) return configuredPath;
  return findWindowsToolExecutable(toolName) || fallback;
}

function hasMeaningfulThumbnailDimensions(width, height) {
  return Number.isFinite(Number(width)) &&
    Number.isFinite(Number(height)) &&
    Math.max(Number(width), Number(height)) >= MIN_THUMBNAIL_DIMENSION &&
    Math.min(Number(width), Number(height)) >= MIN_THUMBNAIL_SHORT_DIMENSION;
}
const MAX_THUMBNAIL_BYTES = 50 * 1024;
const MAX_THUMBNAIL_HARD_BYTES = 2 * 1024 * 1024;
const SETTINGS_FORMAT_BY_EXTENSION = Object.freeze({
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.png': 'png',
  '.eps': 'eps',
  '.psd': 'psd',
  ...Object.fromEntries([...VIDEO_EXTENSIONS].map((extension) => [extension, 'video'])),
});
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_THUMBNAIL_CONCURRENCY = 8;
const BACKGROUND = { r: 232, g: 234, b: 237, alpha: 1 };
const OPTIONAL_PREVIEW_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
const NON_CONTRIBUTOR_UPLOAD_DIRECTORIES = new Set([
  'approved',
  'backups',
  'branding',
  'pending',
  'payments',
  'processed',
  'rejected',
  'restore',
  'settings',
  'thumbnails',
  'unknown',
  'website',
]);
const contributorUploadLocks = new Map();
const assetLifecycleLocks = new Map();

function getGenerationSettingsFormat(filename) {
  const extension = path.extname(filename).toLowerCase();
  return extension === '.ai' ? 'eps' : SETTINGS_FORMAT_BY_EXTENSION[extension];
}

function getProcessorVersion(filename, settings = thumbnailGenerationSettings.getActiveSettings()) {
  const format = getGenerationSettingsFormat(filename);
  const normalizedSettings = format
    ? thumbnailGenerationSettings.getSettingsForFormat(settings, format)
    : thumbnailGenerationSettings.normalizeThumbnailGenerationSettings(settings);
  const defaults = thumbnailGenerationSettings.DEFAULT_THUMBNAIL_GENERATION_SETTINGS;
  const usesDefaultImageSettings =
    normalizedSettings.quality === defaults.quality &&
    normalizedSettings.maxFileSizeKb === defaults.maxFileSizeKb &&
    normalizedSettings.dimensionPercent === defaults.dimensionPercent;
  const usesDefaultVideoSettings = format !== 'video' || (
    normalizedSettings.multipleVideoThumbnails === defaults.multipleVideoThumbnails &&
    normalizedSettings.includeVideoPreview === defaults.includeVideoPreview &&
    normalizedSettings.generateOptimizedVideoPreview === defaults.generateOptimizedVideoPreview &&
    normalizedSettings.videoQuality === defaults.videoQuality &&
    normalizedSettings.videoMaxHeight === defaults.videoMaxHeight &&
    normalizedSettings.videoMaxFileSizeMb === defaults.videoMaxFileSizeMb
  );
  if (usesDefaultImageSettings && usesDefaultVideoSettings) {
    return PROCESSOR_VERSION;
  }
  const imageVersion = `-q${normalizedSettings.quality}-m${normalizedSettings.maxFileSizeKb}-s${normalizedSettings.dimensionPercent}`;
  if (format !== 'video') return `${PROCESSOR_VERSION}${imageVersion}`;
  const videoSettingsHash = crypto.createHash('sha256')
    .update(JSON.stringify([
      normalizedSettings.multipleVideoThumbnails,
      normalizedSettings.includeVideoPreview,
      normalizedSettings.generateOptimizedVideoPreview,
      normalizedSettings.videoQuality,
      normalizedSettings.videoMaxHeight,
      normalizedSettings.videoMaxFileSizeMb,
    ]))
    .digest('hex')
    .slice(0, 8);
  return `${PROCESSOR_VERSION}${imageVersion}-v${videoSettingsHash}`;
}

function getVideoPreviewPathsFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const framePaths = Array.isArray(metadata.frames)
    ? metadata.frames.map((frame) => frame?.path)
    : [];
  const paths = [...framePaths, metadata.optimizedVideo?.path]
    .filter((value) => typeof value === 'string' && value.trim());
  return [...new Set(paths)];
}

function getStagedSourceDirectory() {
  return path.resolve(__dirname, '..', 'tmp', 'asset-thumbnail-sources');
}

function resolveStagedOptionalPreview(previewPath) {
  const root = path.resolve(getStagedSourceDirectory());
  const resolvedPath = path.resolve(previewPath);
  const relativePath = path.relative(root, resolvedPath);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath) ||
    !OPTIONAL_PREVIEW_EXTENSIONS.has(path.extname(resolvedPath).toLowerCase())
  ) {
    const error = new Error('Invalid staged thumbnail preview path');
    error.permanent = true;
    throw error;
  }
  return resolvedPath;
}

async function stageOptionalThumbnail(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (!OPTIONAL_PREVIEW_EXTENSIONS.has(extension)) {
    throw new Error('Optional thumbnail must be a supported raster or SVG image');
  }
  const stats = await fsp.stat(sourcePath);
  if (!stats.isFile() || stats.size <= 0 || stats.size > 32 * 1024 * 1024) {
    throw new Error('Optional thumbnail must be a non-empty file no larger than 32 MB');
  }
  const directory = getStagedSourceDirectory();
  await fsp.mkdir(directory, { recursive: true });
  const stagedPath = path.join(directory, `${crypto.randomUUID()}${extension}`);
  await fsp.copyFile(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL);
  return stagedPath;
}

async function removeStagedOptionalThumbnail(previewPath) {
  if (!previewPath) return;
  try {
    await fsp.unlink(resolveStagedOptionalPreview(previewPath));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function canonicalizePossiblyMissingPath(targetPath) {
  let currentPath = path.resolve(targetPath);
  const suffix = [];

  while (true) {
    try {
      const realPath = fs.realpathSync.native(currentPath);
      return path.join(realPath, ...suffix.reverse());
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) throw error;
      suffix.push(path.basename(currentPath));
      currentPath = parentPath;
    }
  }
}

function getThumbnailStorageRoots() {
  const configured = assetStorageConnections.getConfiguredStorageRoots();
  const configuredLocations = configured.thumbnailLocations || [];
  const orderedLocations = assetStorageCardConnections.getConnectedLocations('thumbnails', configuredLocations);
  const defaultLocationIndex = orderedLocations.findIndex(({ id }) => id === configured.defaultThumbnailLocationId);
  const prioritizedLocations = defaultLocationIndex > 0
    ? [orderedLocations[defaultLocationIndex], ...orderedLocations.filter((_, index) => index !== defaultLocationIndex)]
    : orderedLocations;
  const roots = prioritizedLocations.map(({ path: locationPath }) => path.resolve(locationPath));
  if (!roots.length && !configuredLocations.some(Boolean) && configured.thumbnailStoragePath) {
    roots.push(path.resolve(configured.thumbnailStoragePath));
  }
  if (!roots.length && !configuredLocations.some(Boolean) && process.platform !== 'darwin' && process.env.NODE_ENV !== 'production') {
    roots.push(path.resolve(__dirname, '..', '..', 'tmp', 'asset-thumbnails'));
  }
  return [...new Set(roots)];
}

function getThumbnailStorageRoot(relativePath) {
  const configured = assetStorageConnections.getConfiguredStorageRoots();
  const configuredRoot = configured.thumbnailStoragePath;
  if (process.platform === 'darwin' && !configuredRoot) {
    throw new Error('THUMBNAIL_STORAGE_PATH must be configured on macOS; local thumbnail storage is not an implicit fallback');
  }
  const thumbnailRoots = getThumbnailStorageRoots();
  let root = configuredRoot && thumbnailRoots.includes(path.resolve(configuredRoot))
    ? path.resolve(configuredRoot)
    : thumbnailRoots[0];
  if (process.platform === 'win32' && process.env.NODE_ENV === 'production') {
    if (!root) throw new Error('THUMBNAIL_STORAGE_PATH must be configured in Windows production');
  }
  if (!root) {
    const error = new Error('THUMBNAIL_STORAGE_DISCONNECTED');
    error.code = 'THUMBNAIL_STORAGE_DISCONNECTED';
    throw error;
  }

  const isSameOrNested = (relativePath) =>
    relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
  const availableThumbnailRoots = [...new Set(thumbnailRoots)];
  let selectedRoot = root;
  if (relativePath) {
    const normalizedPath = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
    const matches = availableThumbnailRoots.filter((candidate) =>
      fs.existsSync(path.resolve(candidate, ...normalizedPath.split('/')))
    );
    if (matches.length) selectedRoot = matches[0];
  }
  const canonicalRoot = canonicalizePossiblyMissingPath(selectedRoot);
  for (const assetRoot of getOriginalAssetStorageRoots()) {
    const canonicalOriginalRoot = canonicalizePossiblyMissingPath(assetRoot);
    const rootToOriginal = path.relative(canonicalOriginalRoot, canonicalRoot);
    const originalToRoot = path.relative(canonicalRoot, canonicalOriginalRoot);
    if (isSameOrNested(rootToOriginal) || isSameOrNested(originalToRoot)) {
      throw new Error('Thumbnail storage must be separate from the original asset storage root');
    }
  }
  if (
    process.platform === 'darwin' &&
    configuredRoot &&
    canonicalRoot.startsWith(`${path.sep}Volumes${path.sep}`) &&
    !fs.existsSync(canonicalRoot)
  ) {
    throw new Error(`Configured thumbnail volume is not mounted: ${canonicalRoot}`);
  }
  return canonicalRoot;
}

function getThumbnailCacheControl(isPublicAsset, immutable) {
  if (!isPublicAsset) return 'private, no-store';
  return immutable
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=300, must-revalidate';
}

async function finalizeThumbnailFile(temporaryPath, finalPath, fileSystem = fsp) {
  let destinationExists = false;
  try {
    await fileSystem.lstat(finalPath);
    destinationExists = true;
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
  }

  if (!destinationExists) {
    await fileSystem.rename(temporaryPath, finalPath);
    return;
  }

  const backupPath = `${finalPath}.${crypto.randomUUID()}.bak`;
  await fileSystem.rename(finalPath, backupPath);
  try {
    await fileSystem.rename(temporaryPath, finalPath);
  } catch (error) {
    try {
      let destinationWasCreated = false;
      try {
        await fileSystem.lstat(finalPath);
        destinationWasCreated = true;
      } catch (destinationError) {
        if (!['ENOENT', 'ENOTDIR'].includes(destinationError.code)) throw destinationError;
      }
      if (!destinationWasCreated) {
        await fileSystem.rename(backupPath, finalPath);
      }
    } catch (restoreError) {
      error.message = `${error.message}; failed to restore existing thumbnail from ${backupPath}: ${restoreError.message}`;
    }
    throw error;
  }

  await fileSystem.unlink(backupPath).catch((error) => {
    console.warn(`Failed to remove replaced thumbnail backup ${backupPath}: ${error.message}`);
  });
}

function normalizeStoredFilename(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^uploads\//i, '');
  const segments = normalized.split('/');
  if (
    !normalized ||
    normalized.includes('\0') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':') || segment.includes('%'))
  ) {
    throw new Error('Invalid stored asset filename');
  }
  return segments.join('/');
}

function sanitizeFilenamePart(value, fallback = 'asset') {
  let sanitized = String(value || '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/gu, '-')
    .replace(/[^\p{L}\p{N}\p{M}._-]+/gu, '-')
    .replace(/[._-]{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  sanitized = Array.from(sanitized).slice(0, 80).join('').replace(/[.-]+$/g, '');
  if (!sanitized) sanitized = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }
  return sanitized;
}

function truncateFilenamePart(value, maxCodeUnits) {
  let result = '';
  for (const character of value) {
    if (result.length + character.length > maxCodeUnits) break;
    result += character;
  }
  return result.replace(/[.-]+$/g, '') || 'asset';
}

function getThumbnailFilename(assetId, originalFilename = 'asset', title = 'asset') {
  const id = Number(assetId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid asset ID');
  const basename = path.posix.basename(String(originalFilename || '').replace(/\\/g, '/'));
  const extension = path.posix.extname(basename);
  const originalStem = extension ? basename.slice(0, -extension.length) : basename;
  const suffix = `_${id}.webp`;
  const partBudget = 240 - suffix.length - 1;
  const originalBudget = Math.floor(partBudget / 2);
  const titleBudget = partBudget - originalBudget;
  const safeOriginal = truncateFilenamePart(sanitizeFilenamePart(originalStem), originalBudget);
  const safeTitle = truncateFilenamePart(sanitizeFilenamePart(title, 'untitled'), titleBudget);
  return `${safeOriginal}_${safeTitle}${suffix}`;
}

function getDateDirectory(value, fallback = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() + 1 === month &&
      parsed.getUTCDate() === day
    ) {
      return `${String(year).padStart(4, '0')}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
    }
  }
  let date = value instanceof Date ? value : value ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(date.getTime())) date = fallback;
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function getThumbnailRelativePath({ assetId, originalFilename, title, createdAt }, fallbackDate = new Date()) {
  return `${getDateDirectory(createdAt, fallbackDate)}/${getThumbnailFilename(assetId, originalFilename, title)}`;
}

function parseThumbnailAssetId(value) {
  const assetId = String(value || '');
  const numericAssetId = Number(assetId);
  if (!/^[1-9]\d*$/.test(assetId) || !Number.isSafeInteger(numericAssetId) || numericAssetId > 2147483647) {
    return null;
  }
  return numericAssetId;
}

function normalizeThumbnailRelativePath(relativePath, assetId) {
  const id = Number(assetId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid asset ID');
  const value = String(relativePath || '');
  const segments = value.split('/');
  const filename = segments[3] || '';
  const primaryOrFramePattern = new RegExp(
    `^[\\p{L}\\p{N}\\p{M}._-]+_${id}(?:-frame-[1-6]-${VIDEO_PREVIEW_GENERATION_ID_PATTERN})?\\.webp$`,
    'u'
  );
  const optimizedVideoPattern = new RegExp(
    `^[\\p{L}\\p{N}\\p{M}._-]+_${id}-preview-${VIDEO_PREVIEW_GENERATION_ID_PATTERN}\\.mp4$`,
    'u'
  );
  if (
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    segments.length !== 4 ||
    segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':')) ||
    !/^\d{4}$/.test(segments[0]) ||
    !/^(0[1-9]|1[0-2])$/.test(segments[1]) ||
    !/^(0[1-9]|[12]\d|3[01])$/.test(segments[2]) ||
    (!primaryOrFramePattern.test(filename) && !optimizedVideoPattern.test(filename)) ||
    filename.includes('..') ||
    filename.length > 200
  ) {
    throw new Error('Invalid thumbnail path');
  }
  const day = Number(segments[2]);
  const date = new Date(Date.UTC(Number(segments[0]), Number(segments[1]) - 1, day));
  if (
    date.getUTCFullYear() !== Number(segments[0]) ||
    date.getUTCMonth() + 1 !== Number(segments[1]) ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Invalid thumbnail date directory');
  }
  return segments.join('/');
}

function getThumbnailAssetIdFromRelativePath(relativePath) {
  const filename = path.posix.basename(String(relativePath || ''));
  const match = filename.match(
    new RegExp(`_([1-9]\\d*)(?:-frame-[1-6]-${VIDEO_PREVIEW_GENERATION_ID_PATTERN}|-preview-${VIDEO_PREVIEW_GENERATION_ID_PATTERN})?\\.(?:webp|mp4)$`, 'u')
  );
  return match ? parseThumbnailAssetId(match[1]) : null;
}

function getThumbnailFilePath(assetId, root = getThumbnailStorageRoot(), relativePath) {
  const safeRelativePath = normalizeThumbnailRelativePath(relativePath, assetId);
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, ...safeRelativePath.split('/'));
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Thumbnail path escapes storage root');
  }
  return resolvedPath;
}

async function ensureThumbnailDirectory(relativePath, assetId, root = getThumbnailStorageRoot()) {
  const safeRelativePath = normalizeThumbnailRelativePath(relativePath, assetId);
  const dateSegments = safeRelativePath.split('/').slice(0, 3);
  await fsp.mkdir(root, { recursive: true });
  let currentPath = root;
  for (const segment of dateSegments) {
    currentPath = path.join(currentPath, segment);
    await fsp.mkdir(currentPath, { recursive: true });
    const stats = await fsp.lstat(currentPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Thumbnail date directory is not a safe directory');
    }
  }
  return currentPath;
}

async function isThumbnailPathInsideRoot(filePath, root = getThumbnailStorageRoot()) {
  try {
    const [realRoot, realFile] = await Promise.all([fsp.realpath(root), fsp.realpath(filePath)]);
    const relative = path.relative(realRoot, realFile);
    return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false;
    throw error;
  }
}

function getRemoteAssetUrl(filename) {
  const origin = getAssetServerOrigin();
  const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
  return `${origin}/api/files/${encodedPath}`;
}

async function getRemoteAssetAuthorization(assetOwnerId) {
  const userId = Number(assetOwnerId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('Cannot authenticate remote SERVER asset request without a valid asset owner');
  }
  const sessionResult = await pool.query(
    `SELECT session_id FROM auth_sessions
     WHERE user_id = $1 AND last_activity_at >= NOW() - INTERVAL '15 minutes'
     ORDER BY last_activity_at DESC
     LIMIT 1`,
    [userId]
  );
  const sessionId = String(sessionResult.rows[0]?.session_id || '');
  if (!sessionId) {
    throw new Error('Cannot authenticate remote SERVER asset request without an active contributor session');
  }
  const token = jwt.sign(
    { user: userId, sid: sessionId },
    process.env.JWT_SECRET || 'secretkey',
    { expiresIn: '15m' }
  );
  return `Bearer ${token}`;
}

function createRemoteAssetRequestError(error) {
  const status = Number(error.response?.status);
  const originalCode = String(error.code || '');
  const message = Number.isInteger(status) && status > 0
    ? `SERVER original asset request failed with HTTP ${status}`
    : ['ECONNABORTED', 'ETIMEDOUT'].includes(originalCode)
      ? 'SERVER original asset request timed out'
      : originalCode === 'ECONNRESET'
        ? 'SERVER original asset stream was interrupted'
        : 'SERVER original asset request failed; verify SERVER availability and authorization';
  const requestError = new Error(
    message,
    { cause: error }
  );
  if (originalCode) requestError.code = originalCode;
  if (Number.isInteger(status) && status > 0) {
    requestError.response = { status };
    requestError.statusCode = status;
    if ([401, 403, 404].includes(status)) requestError.permanent = true;
  }
  return requestError;
}

async function getRemoteAssetSourceInfo(filename, assetOwnerId) {
  const authorization = await getRemoteAssetAuthorization(assetOwnerId);
  const url = getRemoteAssetUrl(filename);
  let response;
  try {
    response = await axios.head(url, {
      timeout: 30000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 300,
      headers: { authorization },
    });
  } catch (error) {
    throw createRemoteAssetRequestError(error);
  }
  const size = Number(response.headers['content-length']);
  const parsedModifiedAt = response.headers['last-modified'] ? new Date(response.headers['last-modified']) : null;
  const modifiedAt = parsedModifiedAt && Number.isFinite(parsedModifiedAt.getTime()) ? parsedModifiedAt : null;
  if (Number.isFinite(size) && size > MAX_SOURCE_BYTES) {
    throw new Error(`Source exceeds the ${MAX_SOURCE_BYTES} byte processing limit`);
  }
  return {
    kind: 'remote',
    url,
    authorization,
    size: Number.isFinite(size) ? size : null,
    modifiedAt,
  };
}

function getConfiguredAssetRoot() {
  const { assetsRoot: configured } = assetStorageConnections.getConfiguredStorageRoots();
  if (configured) return path.resolve(configured);
  if (process.platform === 'win32' && process.env.NODE_ENV === 'production') {
    throw new Error('ASSETS_ROOT must be configured in Windows production');
  }
  return '';
}

function getOriginalAssetStorageRoots() {
  const configured = assetStorageConnections.getConfiguredStorageRoots();
  const configuredLocations = configured.assetLocations || [];
  const orderedLocations = assetStorageCardConnections.getConnectedLocations('assets', configuredLocations);
  const defaultLocationIndex = orderedLocations.findIndex(({ id }) => id === configured.defaultAssetLocationId);
  const prioritizedLocations = defaultLocationIndex > 0
    ? [orderedLocations[defaultLocationIndex], ...orderedLocations.filter((_, index) => index !== defaultLocationIndex)]
    : orderedLocations;
  const roots = prioritizedLocations.map(({ path: locationPath }) => path.resolve(locationPath));
  if (!roots.length && !configuredLocations.some(Boolean) && configured.assetsRoot) {
    roots.push(path.resolve(configured.assetsRoot));
  }
  if (
    !roots.length &&
    !configuredLocations.some(Boolean) &&
    process.platform !== 'darwin' &&
    !(process.platform === 'win32' && process.env.NODE_ENV === 'production')
  ) {
    roots.push(path.resolve(__dirname, '..', 'uploads'));
  }
  return [...new Set(roots)];
}

function getOriginalAssetStorageRoot(relativePath) {
  const configured = assetStorageConnections.getConfiguredStorageRoots();
  const configuredLocations = configured.assetLocations || [];
  const roots = getOriginalAssetStorageRoots();
  if (!roots.length && configuredLocations.some(Boolean)) {
    const error = new Error('Original asset storage is disconnected');
    error.code = 'ASSET_STORAGE_DISCONNECTED';
    throw error;
  }
  if (!relativePath) return roots[0] || getConfiguredAssetRoot() || path.resolve(__dirname, '..', 'uploads');
  const normalizedPath = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
  const matches = roots.filter((root) => {
    const candidate = path.resolve(root, ...normalizedPath.split('/'));
    const relative = path.relative(path.resolve(root), candidate);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative) && fs.existsSync(candidate);
  });
  return matches[0] || roots[0] || path.resolve(__dirname, '..', 'uploads');
}

function getLifecycleRecoveryStorageRoots({ platform = process.platform } = {}) {
  const {
    assetsRoot: originalRootConfigured,
    thumbnailStoragePath: thumbnailRootConfigured,
  } = assetStorageConnections.getConfiguredStorageRoots();
  const originalRoots = getOriginalAssetStorageRoots();
  const thumbnailRoots = getThumbnailStorageRoots();
  const assetRoot = originalRoots.length
    ? getOriginalAssetStorageRoot()
    : (platform === 'darwin' || originalRootConfigured ? null : getOriginalAssetStorageRoot());
  const thumbnailRoot = thumbnailRoots.length
    ? getThumbnailStorageRoot()
    : (platform === 'darwin' || thumbnailRootConfigured ? null : getThumbnailStorageRoot());

  return { assetRoot, thumbnailRoot };
}

async function stageLocalAsset(sourcePath, extension) {
  const tempDirectory = getStagedSourceDirectory();
  await fsp.mkdir(tempDirectory, { recursive: true });
  const stagedPath = path.join(tempDirectory, `${crypto.randomUUID()}${extension}`);
  await fsp.copyFile(sourcePath, stagedPath);
  const stats = await fsp.stat(stagedPath);
  return { sourcePath: stagedPath, size: stats.size };
}

async function getAssetSourceInfo(filename, assetOwnerId) {
  for (const assetRoot of getOriginalAssetStorageRoots()) {
    try {
      const sourcePath = await resolveAssetFile(assetRoot, filename);
      const stats = await fsp.stat(sourcePath);
      if (stats.size > MAX_SOURCE_BYTES) throw new Error(`Source exceeds the ${MAX_SOURCE_BYTES} byte processing limit`);
      return {
        kind: 'local',
        sourcePath,
        size: stats.size,
        modifiedAt: stats.mtime,
      };
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'ASSET_ROOT_UNAVAILABLE'].includes(error.code)) throw error;
    }
  }

  if (process.platform === 'darwin') {
    return getRemoteAssetSourceInfo(filename, assetOwnerId);
  }

  return getRemoteAssetSourceInfo(filename, assetOwnerId);
}

async function stageRemoteAsset(assetInfo, extension) {
  const tempDirectory = getStagedSourceDirectory();
  await fsp.mkdir(tempDirectory, { recursive: true });
  const temporaryPath = path.join(tempDirectory, `${crypto.randomUUID()}${extension}`);
  let response;
  try {
    response = await axios.get(assetInfo.url, {
      responseType: 'stream',
      decompress: false,
      timeout: 120000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 300,
      headers: { authorization: assetInfo.authorization },
    });
  } catch (error) {
    if (typeof error.response?.data?.destroy === 'function') error.response.data.destroy();
    throw createRemoteAssetRequestError(error);
  }
  const responseDeclaredSize = Number(response.headers?.['content-length']);
  if (Number.isFinite(responseDeclaredSize) && responseDeclaredSize > MAX_SOURCE_BYTES) {
    response.data.destroy();
    const error = new Error(`Source exceeds the ${MAX_SOURCE_BYTES} byte processing limit`);
    error.code = 'SOURCE_TOO_LARGE';
    throw error;
  }
  if (
    Number.isFinite(responseDeclaredSize) &&
    Number.isFinite(assetInfo.size) &&
    responseDeclaredSize !== Number(assetInfo.size)
  ) {
    response.data.destroy();
    const error = new Error('SERVER original asset changed between metadata check and download');
    error.code = 'REMOTE_SOURCE_CHANGED';
    throw error;
  }
  let received = 0;
  const guard = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > MAX_SOURCE_BYTES) {
        callback(new Error(`Source exceeds the ${MAX_SOURCE_BYTES} byte processing limit`));
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(response.data, guard, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
    if (received <= 0) {
      const error = new Error('SERVER original asset response was empty');
      error.code = 'REMOTE_SOURCE_EMPTY';
      throw error;
    }
    if (
      (Number.isFinite(responseDeclaredSize) && received !== responseDeclaredSize) ||
      (Number.isFinite(assetInfo.size) && received !== Number(assetInfo.size))
    ) {
      const error = new Error(
        `SERVER original asset stream was incomplete (${received} bytes received)`
      );
      error.code = 'REMOTE_SOURCE_INCOMPLETE';
      throw error;
    }
    return { sourcePath: temporaryPath, size: received };
  } catch (error) {
    try {
      await fsp.unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        console.error(`Failed to remove incomplete remote SERVER source: ${cleanupError.message}`);
      }
    }
    const stageError = new Error(`Failed to stage remote SERVER original: ${error.message}`, { cause: error });
    if (error.code) stageError.code = error.code;
    if (error.response) stageError.response = error.response;
    if (error.permanent) stageError.permanent = true;
    throw stageError;
  }
}

function runCommand(command, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdoutSize += chunk.length;
      if (stdoutSize <= 512 * 1024 * 1024) stdout.push(chunk);
      else child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      if (stderrSize < 1024 * 1024) {
        stderr.push(chunk);
        stderrSize += chunk.length;
      }
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(Buffer.concat(stdout));
      } else {
        reject(new Error(`${command} failed (${signal || code}): ${Buffer.concat(stderr).toString().trim() || 'no diagnostic output'}`));
      }
    });
  });
}

function runCommandToFile(command, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const stderr = [];
    let stderrSize = 0;
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', (chunk) => {
      if (stderrSize < 1024 * 1024) {
        stderr.push(chunk);
        stderrSize += chunk.length;
      }
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} failed (${signal || code}): ${Buffer.concat(stderr).toString().trim() || 'no diagnostic output'}`));
      }
    });
  });
}

async function extractVideoPreview(sourcePath, run = runCommand) {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const extractFrame = async (seekTime) => {
    const output = await run(ffmpeg, [
      '-v', 'error', '-ss', String(seekTime), '-i', sourcePath,
      '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-',
    ], 180000);
    if (output.length === 0) {
      throw new Error(`FFmpeg produced no frame at ${seekTime} seconds`);
    }
    return output;
  };

  try {
    return await extractFrame(1);
  } catch (oneSecondError) {
    try {
      return await extractFrame(0);
    } catch (startError) {
      const error = new Error(
        `Video preview unavailable (1-second seek: ${oneSecondError.message}; start of video: ${startError.message})`,
        { cause: oneSecondError }
      );
      if (oneSecondError.code !== 'ENOENT' && startError.code !== 'ENOENT') {
        error.permanent = true;
      }
      throw error;
    }
  }
}

async function getVideoDimensions(sourcePath, run = runCommand) {
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const output = await run(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json',
    sourcePath,
  ], 30000);
  let probeResult;
  try {
    probeResult = JSON.parse(output.toString());
  } catch (error) {
    throw new Error(`FFprobe returned invalid video dimensions: ${error.message}`, { cause: error });
  }
  const stream = probeResult?.streams?.[0];
  if (!Number.isInteger(stream?.width) || !Number.isInteger(stream?.height)) {
    throw new Error('FFprobe could not determine valid video dimensions.');
  }
  return { width: stream.width, height: stream.height };
}

function createVideoSizeLimitError(message) {
  const error = new RangeError(message);
  error.code = 'VIDEO_SIZE_LIMIT_EXCEEDED';
  return error;
}

async function generateOptimizedVideoPreview(sourcePath, settings, outputPath) {
  const previewSettings = thumbnailGenerationSettings.normalizeThumbnailGenerationSettings(settings);
  if (!previewSettings.generateOptimizedVideoPreview) {
    throw new Error('Enable optimized video preview generation before encoding.');
  }
  if (!VIDEO_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) {
    throw new Error('Optimized video previews require a supported video source.');
  }
  if (typeof outputPath !== 'string' || !outputPath || path.extname(outputPath).toLowerCase() !== '.mp4') {
    throw new TypeError('Optimized video output must use an MP4 file path.');
  }

  const duration = await getVideoDuration(sourcePath);
  const sourceDimensions = await getVideoDimensions(sourcePath);
  const targetBytes = previewSettings.videoMaxFileSizeMb * 1024 * 1024;
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath, '.mp4')}-${crypto.randomUUID()}.tmp.mp4`
  );
  const maxHeight = previewSettings.videoMaxHeight;
  const scaleFilter = `scale=-2:min(ih\\,${maxHeight})`;
  const startingCrf = Math.round(35 - ((previewSettings.videoQuality - 1) * 17) / 99);
  const encode = async ({ crf, videoBitrate }) => {
    await fsp.unlink(temporaryPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const args = [
      '-hide_banner', '-v', 'error', '-i', sourcePath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', scaleFilter,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      ...(videoBitrate
        ? ['-b:v', String(videoBitrate), '-maxrate', String(videoBitrate), '-bufsize', String(videoBitrate * 2)]
        : ['-crf', String(crf)]),
      '-c:a', 'aac', '-ac', '1', '-b:a', '32k',
      '-movflags', '+faststart', '-f', 'mp4', '-y', temporaryPath,
    ];
    await runCommandToFile(process.env.FFMPEG_PATH || 'ffmpeg', args, 30 * 60 * 1000);
    return (await fsp.stat(temporaryPath)).size;
  };

  try {
    let sizeBytes = await encode({ crf: startingCrf, videoBitrate: null });
    if (sizeBytes > targetBytes) {
      const totalBitsPerSecond = (targetBytes * 8) / duration;
      let videoBitrate = Math.floor(Math.max(0, totalBitsPerSecond - 32000) * 0.88);
      for (let attempt = 0; attempt < 4 && sizeBytes > targetBytes; attempt += 1) {
        if (videoBitrate < 16000) {
          throw createVideoSizeLimitError(
            `The ${previewSettings.videoMaxFileSizeMb} MB limit is too small for this video's duration. Increase the size limit or lower the video resolution.`
          );
        }
        sizeBytes = await encode({ crf: null, videoBitrate });
        if (sizeBytes > targetBytes) {
          videoBitrate = Math.floor(videoBitrate * (targetBytes / sizeBytes) * 0.9);
        }
      }
    }
    if (sizeBytes > targetBytes) {
      throw createVideoSizeLimitError(
        `Could not encode the video below the ${previewSettings.videoMaxFileSizeMb} MB limit. Increase the limit or lower the video resolution.`
      );
    }
    await finalizeThumbnailFile(temporaryPath, outputPath);
    return {
      path: outputPath,
      width: Math.min(sourceDimensions.width, Math.round((sourceDimensions.width * maxHeight) / sourceDimensions.height)),
      height: Math.min(sourceDimensions.height, maxHeight),
      sizeBytes,
      format: 'mp4',
      quality: previewSettings.videoQuality,
      maxHeight,
      filename: path.basename(outputPath),
    };
  } finally {
    await fsp.unlink(temporaryPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function getVideoDuration(sourcePath, run = runCommand) {
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const output = await run(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1',
    sourcePath,
  ], 30000);
  const duration = Number(output.toString().trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('FFprobe could not determine a valid video duration.');
  }
  return duration;
}

function getVideoPreviewFrameCount(duration) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError('Video duration must be a positive number.');
  }
  if (duration <= 10) return 3;
  if (duration <= 20) return 4;
  return Math.min(6, Math.ceil(duration / 5));
}

async function extractVideoPreviewFrames(sourcePath, run = runCommand) {
  const duration = await getVideoDuration(sourcePath, run);
  const count = getVideoPreviewFrameCount(duration);
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const timestamp = Math.min((duration * index) / count, Math.max(0, duration - 0.05));
    const frame = await run(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-v', 'error', '-ss', timestamp.toFixed(3), '-i', sourcePath,
      '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-',
    ], 180000);
    if (frame.length === 0) {
      throw new Error(`FFmpeg produced no preview frame at ${timestamp.toFixed(3)} seconds.`);
    }
    frames.push({ timestamp, buffer: frame });
  }
  return frames;
}

async function extractPreview(sourcePath, extension) {
  const ext = extension.toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.tif', '.tiff'].includes(ext)) {
    return sharp(sourcePath, { animated: false, page: 0, failOn: 'none' }).rotate().toBuffer();
  }

  if (VIDEO_EXTENSIONS.has(ext)) {
    return extractVideoPreview(sourcePath);
  }

  if (ext === '.pdf') {
    const gs = getWindowsToolExecutable(
      'ghostscript',
      process.env.GHOSTSCRIPT_PATH || (process.platform === 'win32' ? 'gswin64c' : 'gs')
    );
    try {
      return await runCommand(gs, [
        '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dFirstPage=1', '-dLastPage=1',
        '-sDEVICE=pngalpha', '-r120', '-sOutputFile=-', sourcePath,
      ]);
    } catch (ghostscriptError) {
      const imageMagick = getWindowsToolExecutable(
        'imagemagick',
        process.env.IMAGEMAGICK_PATH || (process.platform === 'win32' ? 'magick' : 'convert')
      );
      try {
        const input = process.platform === 'win32' ? `${sourcePath}[0]` : `${sourcePath}[0]`;
        return await runCommand(imageMagick, [input, '-thumbnail', '640x360', 'png:-']);
      } catch (imageMagickError) {
        throw new Error(`PDF preview unavailable (Ghostscript: ${ghostscriptError.message}; ImageMagick: ${imageMagickError.message})`);
      }
    }
  }

  if (ext === '.zip') {
    const AdmZip = require('adm-zip');
    const archive = new AdmZip(sourcePath);
    const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
    const entries = archive.getEntries()
      .filter((entry) => !entry.isDirectory && imageExtensions.has(path.extname(entry.entryName).toLowerCase()))
      .filter((entry) => Number(entry.header?.size || 0) <= 32 * 1024 * 1024)
      .sort((left, right) => {
        const leftPreview = /(?:cover|preview|thumbnail)/i.test(path.basename(left.entryName)) ? 0 : 1;
        const rightPreview = /(?:cover|preview|thumbnail)/i.test(path.basename(right.entryName)) ? 0 : 1;
        return leftPreview - rightPreview || left.entryName.localeCompare(right.entryName);
      });
    if (!entries.length) {
      const error = new Error('ZIP asset contains no supported image preview');
      error.permanent = true;
      throw error;
    }
    return entries[0].getData();
  }

  if (['.ai', '.eps', '.psd', '.psb'].includes(ext)) {
    const processor = processorFactory.getProcessor(sourcePath);
    if (!processor) throw new Error(`No existing processor for ${ext}`);
    return processor.extractPreview(sourcePath);
  }

  if (['.aep', '.prproj'].includes(ext)) {
    const error = new Error(`No installed project renderer is configured for ${ext}`);
    error.permanent = true;
    throw error;
  }

  const error = new Error(`Unsupported thumbnail format: ${ext || '(no extension)'}`);
  error.permanent = true;
  throw error;
}

async function generateThumbnailPreview(sourcePath, settings) {
  const extension = path.extname(sourcePath).toLowerCase();
  const format = SETTINGS_FORMAT_BY_EXTENSION[extension];
  if (!format) {
    throw new Error('Preview uploads must be JPG, PNG, EPS, PSD, or supported video files.');
  }
  const normalizedSettings = thumbnailGenerationSettings.normalizeThumbnailGenerationSettings(
    settings || thumbnailGenerationSettings.getActiveSettings()
  );
  const previewSettings = thumbnailGenerationSettings.getSettingsForFormat(normalizedSettings, format);
  if (!previewSettings.formats.includes(format)) {
    throw new Error(`Enable ${format.toUpperCase()} in the selected formats before previewing it.`);
  }
  if (!VIDEO_EXTENSIONS.has(extension)) {
    const processor = processorFactory.getProcessor(sourcePath);
    if (!processor || !(await processor.validate(sourcePath))) {
      throw new Error('The preview upload is not a valid supported file.');
    }
  }
  const sourceDimensions = await getAssetSourceDimensions(sourcePath, extension);
  if (VIDEO_EXTENSIONS.has(extension) && previewSettings.multipleVideoThumbnails) {
    const frames = await extractVideoPreviewFrames(sourcePath);
    const previews = [];
    for (const frame of frames) {
      previews.push({
        ...await encodeThumbnail(frame.buffer, { sourceDimensions, settings: previewSettings }),
        timestamp: frame.timestamp,
      });
    }
    return {
      ...previews[0],
      previews,
      videoPreview: previewSettings.includeVideoPreview,
    };
  }

  const previewBuffer = await extractPreview(sourcePath, extension);
  const thumbnail = await encodeThumbnail(previewBuffer, { sourceDimensions, settings: previewSettings });
  return {
    ...thumbnail,
    previews: [{ ...thumbnail, timestamp: null }],
    videoPreview: VIDEO_EXTENSIONS.has(extension) && previewSettings.includeVideoPreview,
  };
}

async function encodeThumbnail(previewBuffer, { sourceDimensions = null, settings = null } = {}) {
  const activeSettings = thumbnailGenerationSettings.normalizeThumbnailGenerationSettings(
    settings || thumbnailGenerationSettings.getActiveSettings()
  );
  const targetQuality = activeSettings.quality;
  const maxThumbnailBytes = activeSettings.maxFileSizeKb * 1024;
  const thumbnailScale = activeSettings.dimensionPercent / 100;
  const metadata = await sharp(previewBuffer, { failOn: 'none' }).metadata();
  const swapsOrientation = [5, 6, 7, 8].includes(metadata.orientation);
  const sourceWidth = sourceDimensions?.width ||
    metadata.autoOrient?.width ||
    (swapsOrientation ? metadata.height : metadata.width);
  const sourceHeight = sourceDimensions?.height ||
    metadata.autoOrient?.height ||
    (swapsOrientation ? metadata.width : metadata.height);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Thumbnail source has invalid dimensions');
  }

  const scaledWidth = Math.round(sourceWidth * thumbnailScale);
  const scaledHeight = Math.round(sourceHeight * thumbnailScale);
  // If either scaled axis would be under 2px, retain source dimensions to avoid distorting tiny assets.
  let targetWidth = scaledWidth < 2 || scaledHeight < 2
    ? Math.max(1, Math.round(sourceWidth))
    : scaledWidth;
  let targetHeight = scaledWidth < 2 || scaledHeight < 2
    ? Math.max(1, Math.round(sourceHeight))
    : scaledHeight;
  const encodeAt = async (width, height, quality) => {
    const thumbnail = await sharp(previewBuffer, { failOn: 'none' })
      .rotate()
      .flatten({ background: BACKGROUND })
      .resize({
        width,
        height,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: thumbnail.data,
      width: thumbnail.info.width,
      height: thumbnail.info.height,
      quality,
      format: 'webp',
    };
  };

  while (targetWidth > 0 && targetHeight > 0) {
    const initial = await encodeAt(targetWidth, targetHeight, targetQuality);
    if (initial.buffer.length <= maxThumbnailBytes) return initial;

    const lowestQuality = await encodeAt(targetWidth, targetHeight, THUMBNAIL_MIN_QUALITY);
    if (lowestQuality.buffer.length <= maxThumbnailBytes) {
      let best = lowestQuality;
      let low = THUMBNAIL_MIN_QUALITY + 1;
      let high = targetQuality - 1;
      while (low <= high) {
        const quality = Math.floor((low + high) / 2);
        const candidate = await encodeAt(targetWidth, targetHeight, quality);
        if (candidate.buffer.length <= maxThumbnailBytes) {
          best = candidate;
          low = quality + 1;
        } else {
          high = quality - 1;
        }
      }
      return best;
    }

    if (targetWidth === 1 && targetHeight === 1) {
      throw new Error(`Unable to encode thumbnail below the ${maxThumbnailBytes} byte size limit`);
    }

    const reduction = Math.min(
      0.9,
      Math.sqrt(maxThumbnailBytes / lowestQuality.buffer.length) * 0.9
    );
    let nextWidth = Math.max(1, Math.floor(targetWidth * reduction));
    let nextHeight = Math.max(1, Math.floor(targetHeight * reduction));
    if (nextWidth === targetWidth && nextHeight === targetHeight) {
      if (targetWidth >= targetHeight && targetWidth > 1) nextWidth -= 1;
      else if (targetHeight > 1) nextHeight -= 1;
      else nextWidth -= 1;
    }
    targetWidth = nextWidth;
    targetHeight = nextHeight;
  }

  throw new Error(`Unable to encode thumbnail below the ${maxThumbnailBytes} byte size limit`);
}

async function isValidThumbnailFile(filePath, maxBytes = MAX_THUMBNAIL_HARD_BYTES) {
  try {
    const stats = await fsp.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > maxBytes) return false;
    const metadata = await sharp(filePath).metadata();
    if (
      metadata.format !== 'webp' ||
      !hasMeaningfulThumbnailDimensions(metadata.width, metadata.height)
    ) return false;
    const decoded = await sharp(filePath).webp().toBuffer({ resolveWithObject: true });
    if (!hasMeaningfulThumbnailDimensions(decoded.info.width, decoded.info.height)) return false;
    return true;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false;
    return false;
  }
}

async function markThumbnailFailure(assetId, error, processor = null, attemptAlreadyCounted = false, thumbnailPath = null) {
  await pool.query(`
    INSERT INTO asset_thumbnail_metadata
      (asset_id, thumbnail_path, processor, processor_version, status, error_message, attempt_count, last_attempt_at, updated_at)
    VALUES ($1, $2, $3, $4, 'FAILED', $5, 1, NOW(), NOW())
    ON CONFLICT (asset_id) DO UPDATE
      SET processor = COALESCE(EXCLUDED.processor, asset_thumbnail_metadata.processor),
          status = 'FAILED', error_message = EXCLUDED.error_message,
          attempt_count = asset_thumbnail_metadata.attempt_count + CASE WHEN $6 THEN 0 ELSE 1 END,
          last_attempt_at = NOW(), updated_at = NOW()
  `, [
    assetId,
    thumbnailPath || getThumbnailRelativePath({ assetId, originalFilename: 'asset', title: 'untitled' }),
    processor,
    PROCESSOR_VERSION,
    String(error.message || error).slice(0, 4000),
    attemptAlreadyCounted,
  ]);
}

async function recordThumbnailQueueFailure(assetId, error) {
  const message = String(error.message || error).slice(0, 4000);
  const assetResult = await pool.query(
    "SELECT id, title, filename, original_filename, to_char(created_at, 'YYYY-MM-DD') AS created_date FROM images WHERE id = $1",
    [assetId]
  );
  const asset = assetResult.rows[0];
  if (!asset) throw new Error(`Cannot record thumbnail failure for missing asset ${assetId}`);
  const thumbnailPath = getThumbnailRelativePath({
    assetId,
    originalFilename: asset.original_filename || asset.filename,
    title: asset.title,
    createdAt: asset.created_date,
  });
  await pool.query(`
    INSERT INTO asset_thumbnail_metadata
      (asset_id, thumbnail_path, processor_version, status, error_message, updated_at)
    VALUES ($1, $2, $3, 'FAILED', $4, NOW())
    ON CONFLICT (asset_id) DO UPDATE
      SET status = 'FAILED', error_message = EXCLUDED.error_message, updated_at = NOW()
  `, [assetId, thumbnailPath, PROCESSOR_VERSION, message]);
  await pool.query(
    'UPDATE images SET thumbnail_status = $1, thumbnail_error = $2 WHERE id = $3',
    ['FAILED', message, assetId]
  );
}

async function generateAssetThumbnailUnlocked(assetId, options = {}) {
  if (!assetStorageConnections.isAssetsConnected()) {
    const error = new Error('Original asset storage is disconnected');
    error.code = 'ASSET_STORAGE_DISCONNECTED';
    throw error;
  }
  if (!assetStorageConnections.isThumbnailsConnected()) {
    const error = new Error('Thumbnail storage is disconnected');
    error.code = 'THUMBNAIL_STORAGE_DISCONNECTED';
    throw error;
  }
  const id = Number(assetId);
  const assetResult = await pool.query(
    "SELECT id, title, filename, original_filename, uploaded_by, to_char(created_at, 'YYYY-MM-DD') AS created_date FROM images WHERE id = $1",
    [id]
  );
  const asset = assetResult.rows[0];
  if (!asset || !asset.filename) {
    const error = new Error(`Asset ${id} does not exist or has no source filename`);
    error.permanent = true;
    if (asset) await markThumbnailFailure(id, error);
    throw error;
  }
  const settingsFormat = getGenerationSettingsFormat(asset.filename);
  const configuredSettings = thumbnailGenerationSettings.getActiveSettings();
  const activeSettings = thumbnailGenerationSettings.getSettingsForFormat(
    settingsFormat && configuredSettings.formats.includes(settingsFormat)
      ? configuredSettings
      : thumbnailGenerationSettings.DEFAULT_THUMBNAIL_GENERATION_SETTINGS,
    settingsFormat || 'jpg'
  );
  const processorVersion = getProcessorVersion(asset.filename, activeSettings);
  const maxThumbnailBytes = activeSettings.maxFileSizeKb * 1024;
  const thumbnailPath = getThumbnailRelativePath({
    assetId: id,
    originalFilename: asset.original_filename || asset.filename,
    title: asset.title,
    createdAt: asset.created_date,
  });

  let storedFilename;
  let sourceInfo;
  try {
    storedFilename = normalizeStoredFilename(asset.filename);
    sourceInfo = await getAssetSourceInfo(storedFilename, asset.uploaded_by);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'INVALID_ASSET_PATH'].includes(error.code) || error.response?.status === 404) {
      error.permanent = true;
    }
    await markThumbnailFailure(id, error, null, false, thumbnailPath);
    await pool.query(
      'UPDATE images SET thumbnail_status = $1, thumbnail_error = $2 WHERE id = $3',
      ['FAILED', String(error.message || error).slice(0, 4000), id]
    );
    throw error;
  }
  const thumbnailRoot = getThumbnailStorageRoot();
  const outputPath = getThumbnailFilePath(id, thumbnailRoot, thumbnailPath);
  const current = await pool.query(
    'SELECT * FROM asset_thumbnail_metadata WHERE asset_id = $1',
    [id]
  );
  const record = current.rows[0];
  const sourceSize = sourceInfo.size;
  const sourceModifiedAt = sourceInfo.modifiedAt;
  const hasComparableSourceMetadata =
    Number.isFinite(sourceSize) &&
    sourceSize >= 0 &&
    sourceModifiedAt instanceof Date &&
    Number.isFinite(sourceModifiedAt.getTime());
  const existingFileIsValid = record ? await isValidThumbnailFile(outputPath, maxThumbnailBytes) : false;
  const existingFileStats = existingFileIsValid ? await fsp.stat(outputPath) : null;
  const existingFileMetadata = existingFileIsValid ? await sharp(outputPath).metadata() : null;
  if (!options.force && record?.status === 'READY' && record.processor_version === processorVersion &&
    record.format === 'webp' && record.thumbnail_path === thumbnailPath &&
    Number(record.file_size) === Number(existingFileStats?.size) &&
    Number(record.width) === existingFileMetadata.width &&
    Number(record.height) === existingFileMetadata.height &&
    hasComparableSourceMetadata &&
    Number(record.source_size) === Number(sourceSize) &&
    new Date(record.source_modified_at || 0).getTime() === new Date(sourceModifiedAt || 0).getTime() &&
    existingFileIsValid) {
    return { status: 'already-valid', assetId: id, thumbnailPath: outputPath };
  }

  let stagedSource = null;
  let temporaryOutput = null;
  let createdVideoPreviewPaths = [];
  try {
    await ensureThumbnailDirectory(thumbnailPath, id, thumbnailRoot);
    await pool.query(`
      INSERT INTO asset_thumbnail_metadata
        (asset_id, thumbnail_path, processor, processor_version, status, error_message, attempt_count, last_attempt_at, updated_at)
      VALUES ($1, $2, NULL, $3, 'PROCESSING', NULL, 1, NOW(), NOW())
      ON CONFLICT (asset_id) DO UPDATE
        SET thumbnail_path = EXCLUDED.thumbnail_path, processor_version = EXCLUDED.processor_version,
            status = 'PROCESSING', error_message = NULL,
            attempt_count = asset_thumbnail_metadata.attempt_count + 1,
            last_attempt_at = NOW(), updated_at = NOW()
    `, [id, thumbnailPath, processorVersion]);

    let sourcePath = sourceInfo.sourcePath;
    if (sourceInfo.kind === 'remote') {
      stagedSource = await stageRemoteAsset(sourceInfo, path.extname(storedFilename).toLowerCase());
      sourcePath = stagedSource.sourcePath;
    } else if (['.ai', '.eps', '.psd', '.psb'].includes(path.extname(storedFilename).toLowerCase())) {
      stagedSource = await stageLocalAsset(sourceInfo.sourcePath, path.extname(storedFilename).toLowerCase());
      sourcePath = stagedSource.sourcePath;
    }
    const extension = path.extname(storedFilename).toLowerCase();
    let previewBuffer;
    let processorName = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.tif', '.tiff'].includes(extension)
      ? 'sharp'
      : VIDEO_EXTENSIONS.has(extension)
        ? (process.env.FFMPEG_PATH || 'ffmpeg')
        : extension === '.pdf'
          ? (process.env.GHOSTSCRIPT_PATH || 'ghostscript-or-imagemagick')
          : extension === '.zip'
            ? 'adm-zip+sharp'
            : processorFactory.getProcessor(sourcePath)?.name || 'unknown';
    if (options.previewPath) {
      const suppliedPreviewPath = resolveStagedOptionalPreview(options.previewPath);
      previewBuffer = await extractPreview(suppliedPreviewPath, path.extname(suppliedPreviewPath));
      processorName = 'uploaded-preview+sharp';
    } else {
      previewBuffer = await extractPreview(sourcePath, extension);
    }
    if (!Buffer.isBuffer(previewBuffer) || previewBuffer.length === 0) throw new Error('Processor returned an empty preview');
    const sourceDimensions = options.previewPath && !VIDEO_EXTENSIONS.has(extension)
      ? null
      : await getAssetSourceDimensions(sourcePath, extension);
    const thumbnail = await encodeThumbnail(previewBuffer, { sourceDimensions, settings: activeSettings });
    if (!hasMeaningfulThumbnailDimensions(thumbnail.width, thumbnail.height)) {
      throw new Error(
        `Generated preview is too small to be a valid stock thumbnail (minimum ${MIN_THUMBNAIL_DIMENSION} px on the long side and ${MIN_THUMBNAIL_SHORT_DIMENSION} px on the short side)`
      );
    }
    if (thumbnail.buffer.length > maxThumbnailBytes) {
      throw new Error(`Generated thumbnail exceeds the ${maxThumbnailBytes} byte configured limit`);
    }

    temporaryOutput = `${outputPath}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(temporaryOutput, thumbnail.buffer, { flag: 'wx' });
    const temporaryStats = await fsp.stat(temporaryOutput);
    if (temporaryStats.size > maxThumbnailBytes) {
      throw new Error(`Generated thumbnail exceeds the ${maxThumbnailBytes} byte configured limit`);
    }
    await finalizeThumbnailFile(temporaryOutput, outputPath);
    temporaryOutput = null;
    if (!(await isThumbnailPathInsideRoot(outputPath, thumbnailRoot))) {
      throw new Error('Generated thumbnail resolved outside the configured thumbnail root');
    }
    const finalStats = await fsp.stat(outputPath);
    if (finalStats.size > maxThumbnailBytes) {
      await fsp.unlink(outputPath);
      throw new Error(`Generated thumbnail exceeds the ${maxThumbnailBytes} byte configured limit`);
    }
    let videoPreviewMetadata = { frames: [], optimizedVideo: null, warning: null };
    if (VIDEO_EXTENSIONS.has(extension)) {
      const generatedVideoPreviews = await generateProductionVideoPreviews({
        assetId: id,
        sourcePath,
        sourceDimensions,
        thumbnailPath,
        settings: activeSettings,
        thumbnailRoot,
      });
      videoPreviewMetadata = generatedVideoPreviews.metadata;
      createdVideoPreviewPaths = generatedVideoPreviews.createdPaths;
    }
    const updatedAt = new Date();
    await pool.query(`
      INSERT INTO asset_thumbnail_metadata
        (asset_id, thumbnail_path, format, width, height, file_size, quality, generated_at,
         processor, video_preview_metadata,
         source_size, source_modified_at, processor_version, status, error_message, updated_at)
      VALUES ($1, $2, 'webp', $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, 'READY', NULL, NOW())
      ON CONFLICT (asset_id) DO UPDATE SET
        thumbnail_path = EXCLUDED.thumbnail_path, format = EXCLUDED.format,
        width = EXCLUDED.width, height = EXCLUDED.height, file_size = EXCLUDED.file_size,
        quality = EXCLUDED.quality, generated_at = EXCLUDED.generated_at,
        video_preview_metadata = EXCLUDED.video_preview_metadata,
        source_size = EXCLUDED.source_size, source_modified_at = EXCLUDED.source_modified_at,
        processor = EXCLUDED.processor,
        processor_version = EXCLUDED.processor_version, status = 'READY',
        error_message = NULL, updated_at = NOW()
    `, [
      id, thumbnailPath, thumbnail.width, thumbnail.height, finalStats.size, thumbnail.quality,
      updatedAt, processorName, JSON.stringify(videoPreviewMetadata), sourceSize,
      sourceModifiedAt, processorVersion,
    ]);
    await pool.query(
      `UPDATE images SET thumbnail_status = 'COMPLETED', thumbnail_error = NULL,
         thumbnail_generated_at = $1 WHERE id = $2`,
      [updatedAt, id]
    );
    if (record?.thumbnail_path && record.thumbnail_path !== thumbnailPath) {
      const previousPath = normalizeThumbnailRelativePath(record.thumbnail_path, id);
      const previousFilePath = getThumbnailFilePath(id, getThumbnailStorageRoot(previousPath), previousPath);
      try {
        await fsp.unlink(previousFilePath);
        await pool.query(
          'DELETE FROM asset_thumbnail_orphans WHERE asset_id = $1 AND thumbnail_path = $2',
          [id, previousPath]
        );
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          await pool.query(`
            INSERT INTO asset_thumbnail_orphans (asset_id, thumbnail_path, error_message)
            VALUES ($1, $2, $3)
            ON CONFLICT (asset_id, thumbnail_path) DO UPDATE
              SET error_message = EXCLUDED.error_message, last_attempt_at = NOW(),
                  cleanup_attempts = asset_thumbnail_orphans.cleanup_attempts + 1
          `, [id, previousPath, String(cleanupError.message || cleanupError).slice(0, 2000)]);
        }
      }
    }
    const previousVideoPaths = getVideoPreviewPathsFromMetadata(record?.video_preview_metadata);
    const nextVideoPaths = new Set(createdVideoPreviewPaths);
    await removeVideoPreviewFiles(
      id,
      previousVideoPaths.filter((relativePath) => !nextVideoPaths.has(relativePath))
    );
    return {
      status: record?.status === 'READY' ? 'regenerated' : 'generated',
      assetId: id,
      thumbnailPath: outputPath,
      width: thumbnail.width,
      height: thumbnail.height,
      quality: thumbnail.quality,
      fileSize: finalStats.size,
      videoPreviewMetadata,
    };
  } catch (error) {
    await removeVideoPreviewFiles(id, createdVideoPreviewPaths);
    if (['ENOENT', 'ENOTDIR', 'INVALID_ASSET_PATH'].includes(error.code) || error.response?.status === 404) {
      error.permanent = true;
    }
    await markThumbnailFailure(id, error, processorFactory.getProcessor(storedFilename)?.name || null, true, thumbnailPath);
    await pool.query(
      'UPDATE images SET thumbnail_status = $1, thumbnail_error = $2 WHERE id = $3',
      ['FAILED', String(error.message || error).slice(0, 4000), id]
    );
    throw error;
  } finally {
    if (temporaryOutput) await fsp.unlink(temporaryOutput).catch(() => {});
    if (stagedSource?.sourcePath) await fsp.unlink(stagedSource.sourcePath).catch((error) => {
      console.error(`Failed to remove staged source for asset ${id}: ${error.message}`);
    });
  }
}

async function acquireAssetLifecycleLock(assetId) {
  const id = Number(assetId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid asset ID');

  const previousLock = assetLifecycleLocks.get(id) || Promise.resolve();
  let releaseLock;
  const currentLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  assetLifecycleLocks.set(id, currentLock);
  await previousLock;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (assetLifecycleLocks.get(id) === currentLock) assetLifecycleLocks.delete(id);
    releaseLock();
  };
}

async function writeVideoFramePreview(frame, frameIndex, generationId, sourceDimensions, settings, assetId, thumbnailPath, thumbnailRoot) {
  const thumbnailBase = path.posix.basename(thumbnailPath, '.webp');
  const relativePath = normalizeThumbnailRelativePath(
    path.posix.join(
      path.posix.dirname(thumbnailPath),
      `${thumbnailBase}-frame-${frameIndex + 1}-${generationId}.webp`
    ),
    assetId
  );
  const outputPath = getThumbnailFilePath(assetId, thumbnailRoot, relativePath);
  const encoded = await encodeThumbnail(frame.buffer, { sourceDimensions, settings });
  if (!hasMeaningfulThumbnailDimensions(encoded.width, encoded.height)) {
    throw new Error(`Video frame ${frameIndex + 1} is too small to be a valid preview.`);
  }
  const maxBytes = settings.maxFileSizeKb * 1024;
  if (encoded.buffer.length > maxBytes) {
    throw new Error(`Video frame ${frameIndex + 1} exceeds the ${maxBytes} byte configured limit.`);
  }

  await ensureThumbnailDirectory(relativePath, assetId, thumbnailRoot);
  const temporaryPath = `${outputPath}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, encoded.buffer, { flag: 'wx' });
    const stats = await fsp.stat(temporaryPath);
    if (stats.size > maxBytes) {
      throw new Error(`Video frame ${frameIndex + 1} exceeds the ${maxBytes} byte configured limit.`);
    }
    await finalizeThumbnailFile(temporaryPath, outputPath);
    if (!(await isThumbnailPathInsideRoot(outputPath, thumbnailRoot))) {
      throw new Error(`Video frame ${frameIndex + 1} resolved outside the configured thumbnail root.`);
    }
    return {
      path: relativePath,
      timestamp: frame.timestamp,
      width: encoded.width,
      height: encoded.height,
      sizeBytes: stats.size,
    };
  } catch (error) {
    await fsp.unlink(outputPath).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') {
        console.error(`Failed to remove incomplete video frame for asset ${assetId}: ${cleanupError.message}`);
      }
    });
    throw error;
  } finally {
    await fsp.unlink(temporaryPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function generateProductionVideoPreviews({
  assetId,
  sourcePath,
  sourceDimensions,
  thumbnailPath,
  settings,
  thumbnailRoot = getThumbnailStorageRoot(thumbnailPath),
}) {
  const metadata = { frames: [], optimizedVideo: null, warning: null };
  const createdPaths = [];
  const warnings = [];
  const generationId = crypto.randomUUID();
  const thumbnailBase = path.posix.basename(thumbnailPath, '.webp');

  if (settings.multipleVideoThumbnails) {
    try {
      const frames = await extractVideoPreviewFrames(sourcePath);
      for (let index = 0; index < frames.length; index += 1) {
        const preview = await writeVideoFramePreview(
          frames[index],
          index,
          generationId,
          sourceDimensions,
          settings,
          assetId,
          thumbnailPath,
          thumbnailRoot
        );
        metadata.frames.push(preview);
        createdPaths.push(preview.path);
      }
    } catch (error) {
      await Promise.all(createdPaths.map(async (relativePath) => {
        const fullPath = getThumbnailFilePath(assetId, thumbnailRoot, relativePath);
        await fsp.unlink(fullPath).catch((cleanupError) => {
          if (cleanupError.code !== 'ENOENT') {
            console.error(`Failed to remove incomplete video frame for asset ${assetId}: ${cleanupError.message}`);
          }
        });
      }));
      metadata.frames = [];
      createdPaths.length = 0;
      warnings.push(`Multiple video thumbnails were not generated: ${error.message}`);
    }
  }

  if (settings.includeVideoPreview && settings.generateOptimizedVideoPreview) {
    const relativePath = normalizeThumbnailRelativePath(
      path.posix.join(
        path.posix.dirname(thumbnailPath),
        `${thumbnailBase}-preview-${generationId}.mp4`
      ),
      assetId
    );
    const outputPath = getThumbnailFilePath(assetId, thumbnailRoot, relativePath);
    try {
      await ensureThumbnailDirectory(relativePath, assetId, thumbnailRoot);
      const preview = await generateOptimizedVideoPreview(sourcePath, settings, outputPath);
      metadata.optimizedVideo = {
        path: relativePath,
        width: preview.width,
        height: preview.height,
        sizeBytes: preview.sizeBytes,
      };
      createdPaths.push(relativePath);
    } catch (error) {
      warnings.push(`Optimized video preview was not generated: ${error.message}`);
    }
  }

  metadata.warning = warnings.length ? warnings.join(' ') : null;
  if (metadata.warning) {
    console.warn(`Optional video preview generation for asset ${assetId}: ${metadata.warning}`);
  }
  return { metadata, createdPaths };
}

async function removeVideoPreviewFiles(assetId, paths) {
  for (const candidate of paths) {
    let relativePath;
    try {
      relativePath = normalizeThumbnailRelativePath(candidate, assetId);
      const filePath = getThumbnailFilePath(assetId, getThumbnailStorageRoot(relativePath), relativePath);
      await fsp.unlink(filePath).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await pool.query(
        'DELETE FROM asset_thumbnail_orphans WHERE asset_id = $1 AND thumbnail_path = $2',
        [assetId, relativePath]
      );
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      await pool.query(`
        INSERT INTO asset_thumbnail_orphans (asset_id, thumbnail_path, error_message)
        VALUES ($1, $2, $3)
        ON CONFLICT (asset_id, thumbnail_path) DO UPDATE
          SET error_message = EXCLUDED.error_message, last_attempt_at = NOW(),
              cleanup_attempts = asset_thumbnail_orphans.cleanup_attempts + 1
      `, [
        assetId,
        typeof candidate === 'string' ? candidate : '(invalid video preview path)',
        String(error.message || error).slice(0, 2000),
      ]);
      console.error(`Could not clean video preview for asset ${assetId}: ${error.message}`);
    }
  }
}

async function generateAssetThumbnail(assetId, options = {}) {
  const releaseLock = await acquireAssetLifecycleLock(assetId);
  try {
    return await generateAssetThumbnailUnlocked(assetId, options);
  } finally {
    releaseLock();
  }
}

async function deleteAssetThumbnail(assetId, thumbnailPathOverride) {
  const id = Number(assetId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid asset ID');
  let thumbnailPath = thumbnailPathOverride;
  if (thumbnailPathOverride === undefined) {
    const result = await pool.query(
      'SELECT thumbnail_path FROM asset_thumbnail_metadata WHERE asset_id = $1',
      [id]
    );
    thumbnailPath = result.rows[0]?.thumbnail_path;
  }
  if (!thumbnailPath) return true;
  let safePath = String(thumbnailPath);
  try {
    safePath = normalizeThumbnailRelativePath(thumbnailPath, id);
    const root = getThumbnailStorageRoot(safePath);
    const filePath = getThumbnailFilePath(id, root, safePath);
    const realRoot = await fsp.realpath(root);
    let fileStats;
    try {
      fileStats = await fsp.lstat(filePath);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') fileStats = null;
      else throw error;
    }
    if (!fileStats) {
      try {
        await pool.query('DELETE FROM asset_thumbnail_orphans WHERE asset_id = $1 AND thumbnail_path = $2', [id, safePath]);
      } catch (error) {
        console.error(`Removed thumbnail file but could not clear its orphan record for asset ${id}: ${error.message}`);
        return false;
      }
      return true;
    }
    const realFile = await fsp.realpath(filePath);
    const relative = path.relative(realRoot, realFile);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      const error = new Error('Thumbnail path resolves outside the configured storage root');
      error.code = 'UNSAFE_THUMBNAIL_PATH';
      throw error;
    }
    await fsp.unlink(filePath);
  } catch (error) {
    console.error(`Failed to remove thumbnail for deleted asset ${id}: ${error.message}`);
    try {
      await pool.query(`
        INSERT INTO asset_thumbnail_orphans (asset_id, thumbnail_path, error_message)
        VALUES ($1, $2, $3)
        ON CONFLICT (asset_id, thumbnail_path) DO UPDATE
          SET error_message = EXCLUDED.error_message, last_attempt_at = NOW(),
              cleanup_attempts = asset_thumbnail_orphans.cleanup_attempts + 1
      `, [id, safePath, String(error.message || error).slice(0, 2000)]);
    } catch (recordError) {
      console.error(`Failed to record thumbnail cleanup failure for asset ${id}: ${recordError.message}`);
      throw new Error(`Thumbnail deletion failed and retry could not be recorded for asset ${id}`, { cause: recordError });
    }
    return false;
  }
  await pool.query('DELETE FROM asset_thumbnail_orphans WHERE asset_id = $1 AND thumbnail_path = $2', [id, safePath]);
  return true;
}

function resolveContributorUploadDirectory(username) {
  if (
    typeof username !== 'string' ||
    !username ||
    username !== username.trim() ||
    /[.\s]$/u.test(username) ||
    username === '.' ||
    username === '..' ||
    /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(username) ||
    path.basename(username) !== username ||
    path.win32.basename(username) !== username ||
    NON_CONTRIBUTOR_UPLOAD_DIRECTORIES.has(username.toLowerCase())
  ) {
    throw new Error('Invalid contributor upload directory name');
  }

  const assetRoot = path.resolve(getOriginalAssetStorageRoot());
  const contributorDirectory = path.resolve(assetRoot, username);
  const relativePath = path.relative(assetRoot, contributorDirectory);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('Contributor upload directory resolves outside asset storage');
  }

  return { assetRoot, contributorDirectory };
}

async function acquireContributorUploadLock(contributorId) {
  const id = Number(contributorId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid contributor ID');

  const previousLock = contributorUploadLocks.get(id) || Promise.resolve();
  let releaseLock;
  const currentLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  contributorUploadLocks.set(id, currentLock);
  await previousLock;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (contributorUploadLocks.get(id) === currentLock) {
      contributorUploadLocks.delete(id);
    }
    releaseLock();
  };
}

async function deleteContributorUploadFolderIfUnused(contributorId) {
  const releaseLock = await acquireContributorUploadLock(contributorId);
  try {
    return await deleteContributorUploadFolderIfUnusedLocked(contributorId);
  } finally {
    releaseLock();
  }
}

async function deleteContributorUploadFolderIfUnusedLocked(contributorId) {
  const id = Number(contributorId);

  const contributorResult = await pool.query(
    `SELECT u.username, u.role, COUNT(i.id)::int AS remaining_asset_count,
            (SELECT COUNT(*)::int FROM users u2 WHERE lower(u2.username) = lower(u.username)) AS username_user_count
     FROM users u
     LEFT JOIN images i ON i.uploaded_by = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [id]
  );
  const contributor = contributorResult.rows[0];
  if (!contributor || String(contributor.role || '').toLowerCase() !== 'contributor') {
    return false;
  }
  if (
    Number(contributor.remaining_asset_count) !== 0 ||
    Number(contributor.username_user_count) !== 1
  ) {
    return false;
  }

  const { assetRoot, contributorDirectory } = resolveContributorUploadDirectory(contributor.username);
  let rootRealPath;
  try {
    rootRealPath = fs.realpathSync(assetRoot);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    return false;
  }

  let directoryStats;
  try {
    directoryStats = fs.lstatSync(contributorDirectory);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error('Contributor upload path is not a dedicated directory');
  }

  const directoryRealPath = fs.realpathSync(contributorDirectory);
  const relativeRealPath = path.relative(rootRealPath, directoryRealPath);
  if (
    !relativeRealPath ||
    relativeRealPath === '..' ||
    relativeRealPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeRealPath)
  ) {
    throw new Error('Contributor upload directory resolves outside asset storage');
  }

  try {
    fs.rmSync(contributorDirectory, { recursive: true, force: false });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

module.exports = {
  BACKGROUND,
  MAX_THUMBNAIL_BYTES,
  MAX_THUMBNAIL_CONCURRENCY,
  MAX_SOURCE_BYTES,
  PROCESSOR_VERSION,
  PROPORTIONAL_PROCESSOR_VERSION,
  VIDEO_EXTENSIONS,
  encodeThumbnail,
  extractVideoPreview,
  extractVideoPreviewFrames,
  generateOptimizedVideoPreview,
  getVideoDuration,
  getVideoPreviewFrameCount,
  generateAssetThumbnail,
  generateProductionVideoPreviews,
  generateThumbnailPreview,
  getProcessorVersion,
  getVideoPreviewPathsFromMetadata,
  getThumbnailAssetIdFromRelativePath,
  getDateDirectory,
  getThumbnailRelativePath,
  parseThumbnailAssetId,
  normalizeThumbnailRelativePath,
  sanitizeFilenamePart,
  ensureThumbnailDirectory,
  isThumbnailPathInsideRoot,
  getAssetSourceInfo,
  getRemoteAssetAuthorization,
  stageRemoteAsset,
  getThumbnailFilePath,
  getThumbnailFilename,
  getThumbnailStorageRoot,
  getThumbnailStorageRoots,
  getOriginalAssetStorageRoot,
  getOriginalAssetStorageRoots,
  getLifecycleRecoveryStorageRoots,
  getThumbnailCacheControl,
  finalizeThumbnailFile,
  isValidThumbnailFile,
  normalizeStoredFilename,
  deleteAssetThumbnail,
  acquireAssetLifecycleLock,
  acquireContributorUploadLock,
  deleteContributorUploadFolderIfUnused,
  recordThumbnailQueueFailure,
  stageOptionalThumbnail,
  removeStagedOptionalThumbnail,
};
