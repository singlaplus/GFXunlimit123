const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STORAGE_ROOT_KEYS = ['ASSETS_ROOT', 'THUMBNAIL_STORAGE_PATH'];

function quoteEnvironmentValue(value) {
  if (/[\r\n]/.test(value)) {
    throw new TypeError('Storage paths must not contain line breaks.');
  }
  return `'${value}'`;
}

function updateStorageEnvironment(values, envPath) {
  for (const [key, value] of Object.entries(values)) {
    if (!STORAGE_ROOT_KEYS.includes(key)) throw new TypeError('Storage environment key is invalid.');
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
      throw new TypeError(`${key} must be an absolute path.`);
    }
  }

  const stats = fs.lstatSync(envPath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error('The backend .env path must be a regular file.');
  }
  const fileMode = stats.mode & 0o777;
  const content = fs.readFileSync(envPath, 'utf8');

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const hasTrailingNewline = content.endsWith('\n');
  const lines = content ? content.split(/\r?\n/) : [];
  if (hasTrailingNewline) lines.pop();
  const foundKeys = new Set();
  const updatedLines = [];

  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?(ASSETS_ROOT|THUMBNAIL_STORAGE_PATH)\s*=/);
    if (!match) {
      updatedLines.push(line);
      continue;
    }
    const key = match[1];
    if (!Object.hasOwn(values, key)) {
      updatedLines.push(line);
      continue;
    }
    if (foundKeys.has(key)) continue;
    foundKeys.add(key);
    updatedLines.push(`${key}=${quoteEnvironmentValue(values[key])}`);
  }

  for (const key of Object.keys(values)) {
    if (!foundKeys.has(key)) updatedLines.push(`${key}=${quoteEnvironmentValue(values[key])}`);
  }

  let updatedContent = updatedLines.join(newline);
  if (hasTrailingNewline || content.length === 0) updatedContent += newline;

  const temporaryPath = `${envPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, updatedContent, { mode: fileMode });
    fs.chmodSync(temporaryPath, fileMode);
    fs.renameSync(temporaryPath, envPath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }

  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function updateStorageRootsInEnv(assetRoot, thumbnailRoot, envPath = path.join(__dirname, '..', '.env')) {
  updateStorageEnvironment({
    ASSETS_ROOT: assetRoot,
    THUMBNAIL_STORAGE_PATH: thumbnailRoot,
  }, envPath);
}

function updateStorageRootInEnv(type, root, envPath = path.join(__dirname, '..', '.env')) {
  const key = type === 'assets'
    ? 'ASSETS_ROOT'
    : type === 'thumbnails'
      ? 'THUMBNAIL_STORAGE_PATH'
      : null;
  if (!key) throw new TypeError('Storage type must be assets or thumbnails.');
  updateStorageEnvironment({ [key]: root }, envPath);
}

module.exports = { updateStorageRootInEnv, updateStorageRootsInEnv };
