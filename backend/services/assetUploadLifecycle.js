const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { getAssetStorageRoots } = require('../config');
const {
  assertContainedFile,
  ensureSafeParent,
  hashContainedFile,
} = require('./assetLifecycleOperations');

const UPLOAD_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeUploadRequestId(value) {
  const requestId = String(value || '').trim();
  if (!UPLOAD_REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('A valid Idempotency-Key UUID is required for asset uploads.');
  }
  return requestId.toLowerCase();
}

async function cleanupAbandonedUploadStaging({
  assetRoot,
  platform = process.platform,
  configuredAssetRoot = getAssetStorageRoots().assetsRoot,
} = {}) {
  if (platform === 'darwin' && !String(configuredAssetRoot || '').trim()) {
    return { removed: 0, pending: [] };
  }
  const root = path.resolve(assetRoot || '');
  if (!assetRoot || root === path.parse(root).root) {
    throw new Error('Cannot safely determine the asset root for upload staging cleanup.');
  }
  const stagingRoot = path.join(root, '.upload-staging');
  const result = { removed: 0, pending: [] };
  let rootStats;
  try {
    rootStats = await fs.lstat(root);
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    return { removed: 0, pending: ['configured asset root is not a real directory'] };
  }
  let stagingStats;
  try {
    stagingStats = await fs.lstat(stagingRoot);
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  if (!stagingStats.isDirectory() || stagingStats.isSymbolicLink()) {
    return { removed: 0, pending: ['upload staging root is not a real directory'] };
  }
  const realRoot = await fs.realpath(root);
  const realStagingRoot = await fs.realpath(stagingRoot);
  if (realStagingRoot !== path.join(realRoot, '.upload-staging')) {
    return { removed: 0, pending: ['upload staging root resolves outside its configured path'] };
  }

  const entries = await fs.readdir(stagingRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!UPLOAD_REQUEST_ID_PATTERN.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) {
      result.pending.push(`unrecognized staging entry: ${entry.name}`);
      continue;
    }
    const entryPath = path.join(stagingRoot, entry.name);
    try {
      const entryStats = await fs.lstat(entryPath);
      const realEntryPath = await fs.realpath(entryPath);
      if (
        !entryStats.isDirectory() ||
        entryStats.isSymbolicLink() ||
        path.dirname(realEntryPath) !== realStagingRoot
      ) {
        result.pending.push(`unsafe staging directory: ${entry.name}`);
        continue;
      }
      await fs.rm(entryPath, { recursive: true });
      result.removed += 1;
    } catch (error) {
      result.pending.push(`could not remove staging directory ${entry.name}: ${error.message}`);
    }
  }
  if (result.pending.length === 0) {
    await fs.rmdir(stagingRoot).catch((error) => {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
    });
  }
  return result;
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

function fileWitness(stats) {
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Uploaded asset is not a regular file.');
  }
  return {
    device: String(stats.dev),
    inode: String(stats.ino),
    size: Number(stats.size),
  };
}

function witnessMatches(stats, witness) {
  return String(stats.dev) === String(witness.device) &&
    String(stats.ino) === String(witness.inode);
}

async function hashStagedUpload(assetRoot, stagedPath) {
  const relativePathNative = path.relative(path.resolve(assetRoot), path.resolve(stagedPath));
  if (
    !relativePathNative ||
    relativePathNative === '..' ||
    relativePathNative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePathNative)
  ) {
    throw new Error('Upload staging file is outside the configured asset root.');
  }
  const relativePath = relativePathNative.split(path.sep).join('/');
  const stats = await assertContainedFile(assetRoot, relativePath);
  if (stats.size <= 0) throw new Error('Uploaded file is empty.');
  return {
    relativePath,
    witness: fileWitness(stats),
    sha256: await hashContainedFile(assetRoot, relativePath),
  };
}

async function verifyPublishedUpload(assetRoot, relativePath, expected) {
  const stats = await assertContainedFile(assetRoot, relativePath);
  if (!witnessMatches(stats, expected) || Number(stats.size) !== Number(expected.size)) {
    const error = new Error('Saved asset does not match the upload operation identity.');
    error.code = 'UPLOAD_IDENTITY_MISMATCH';
    error.statusCode = 409;
    throw error;
  }
  const sha256 = await hashContainedFile(assetRoot, relativePath);
  if (sha256 !== expected.sha256) {
    const error = new Error('Saved asset does not match the uploaded content hash.');
    error.code = 'UPLOAD_CONTENT_MISMATCH';
    error.statusCode = 409;
    throw error;
  }
  return { stats, sha256 };
}

async function publishStagedUpload(assetRoot, stagedPath, relativePath, expected) {
  const staged = await hashStagedUpload(assetRoot, stagedPath);
  if (!witnessMatches({ dev: staged.witness.device, ino: staged.witness.inode }, expected) ||
      staged.witness.size !== Number(expected.size) ||
      staged.sha256 !== expected.sha256) {
    const error = new Error('Staged upload does not match its persisted operation witness.');
    error.code = 'UPLOAD_STAGING_MISMATCH';
    error.statusCode = 409;
    throw error;
  }

  const destination = await ensureSafeParent(assetRoot, relativePath, true);
  if (!destination) throw new Error('Could not safely prepare the saved upload directory.');
  try {
    await fs.link(stagedPath, destination.resolvedPath);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let published;
    try {
      published = await verifyPublishedUpload(assetRoot, relativePath, expected);
    } catch (identityError) {
      identityError.code = 'UPLOAD_DESTINATION_COLLISION';
      identityError.statusCode = 409;
      throw identityError;
    }
    await fs.unlink(stagedPath);
    return { ...published, alreadyPublished: true };
  }

  try {
    const published = await verifyPublishedUpload(assetRoot, relativePath, expected);
    const stagedStats = await fs.lstat(stagedPath);
    if (!witnessMatches(stagedStats, expected) || stagedStats.isSymbolicLink() || !stagedStats.isFile()) {
      throw new Error('Upload staging file identity changed before cleanup.');
    }
    await fs.unlink(stagedPath);
    return { ...published, alreadyPublished: false };
  } catch (error) {
    error.uploadPublishedPath = destination.resolvedPath;
    throw error;
  }
}

async function inspectExistingUpload(assetRoot, relativePath, expected) {
  try {
    return await verifyPublishedUpload(assetRoot, relativePath, expected);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
    throw error;
  }
}

module.exports = {
  UPLOAD_REQUEST_ID_PATTERN,
  cleanupAbandonedUploadStaging,
  fileWitness,
  hashFile,
  hashStagedUpload,
  inspectExistingUpload,
  normalizeUploadRequestId,
  publishStagedUpload,
  verifyPublishedUpload,
};
