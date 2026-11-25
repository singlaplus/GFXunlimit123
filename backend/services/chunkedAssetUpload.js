const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const CHUNK_UPLOAD_SIZE_BYTES = 8 * 1024 * 1024;
const CHUNK_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const CHUNK_UPLOAD_ID_PATTERN = /^[a-f0-9]{64}$/;
const UPLOAD_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getChunkUploadRoot(assetRoot) {
  if (typeof assetRoot !== 'string' || !assetRoot.trim()) {
    throw new Error('Cannot safely determine the asset root for chunked uploads.');
  }
  const resolvedRoot = path.resolve(assetRoot);
  if (resolvedRoot === path.parse(resolvedRoot).root) {
    throw new Error('Cannot safely determine the asset root for chunked uploads.');
  }
  return path.join(resolvedRoot, '.chunked-upload-staging');
}

function getChunkUploadId(userId, uploadRequestId) {
  return crypto.createHash('sha256')
    .update(`${Number(userId)}:${String(uploadRequestId)}`)
    .digest('hex');
}

function getChunkPath(directory, chunkIndex) {
  return path.join(directory, `part-${String(chunkIndex).padStart(6, '0')}`);
}

function getExpectedChunkSize(session, chunkIndex) {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    const error = new Error('Invalid upload chunk number.');
    error.statusCode = 400;
    throw error;
  }
  return chunkIndex === session.totalChunks - 1
    ? session.fileSize - chunkIndex * session.chunkSize
    : session.chunkSize;
}

async function ensureUploadRoot(assetRoot) {
  const root = getChunkUploadRoot(assetRoot);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const rootStats = await fs.lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('Chunk upload staging root is not a real directory.');
  }
  await fs.chmod(root, 0o700);
  const [assetRootReal, uploadRootReal] = await Promise.all([
    fs.realpath(path.resolve(assetRoot)),
    fs.realpath(root),
  ]);
  const relativeRoot = path.relative(assetRootReal, uploadRootReal);
  if (relativeRoot !== '.chunked-upload-staging') {
    throw new Error('Chunk upload staging resolves outside the configured asset root.');
  }
  return { root, realRoot: uploadRootReal };
}

async function resolveSessionDirectory(assetRoot, uploadId) {
  if (!CHUNK_UPLOAD_ID_PATTERN.test(String(uploadId || ''))) {
    const error = new Error('Invalid chunked upload ID.');
    error.statusCode = 400;
    throw error;
  }
  const { root, realRoot } = await ensureUploadRoot(assetRoot);
  const directory = path.join(root, uploadId);
  let stats;
  try {
    stats = await fs.lstat(directory);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const missing = new Error('Chunked upload session was not found or has expired.');
      missing.statusCode = 404;
      throw missing;
    }
    throw error;
  }
  const realDirectory = await fs.realpath(directory);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    path.dirname(realDirectory) !== realRoot
  ) {
    const error = new Error('Chunked upload staging directory is unsafe.');
    error.statusCode = 400;
    throw error;
  }
  return { root, directory, realRoot };
}

async function readSession(assetRoot, uploadId, userId) {
  const location = await resolveSessionDirectory(assetRoot, uploadId);
  let session;
  try {
    const manifestPath = path.join(location.directory, 'session.json');
    const manifestStats = await fs.lstat(manifestPath);
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
      const error = new Error('Chunked upload session metadata is unsafe.');
      error.statusCode = 409;
      throw error;
    }
    session = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      const invalid = new Error('Chunked upload session metadata is unavailable.');
      invalid.statusCode = 409;
      throw invalid;
    }
    throw error;
  }
  if (session && typeof session === 'object') {
    session.fieldName ??= 'image';
    session.formFields ??= {};
    session.preSubmission ??= true;
    session.parentUploadId ??= null;
  }
  if (
    !session ||
    typeof session !== 'object' ||
    session.uploadId !== uploadId ||
    Number(session.userId) !== Number(userId) ||
    !Number.isSafeInteger(session.fileSize) ||
    !Number.isSafeInteger(session.chunkSize) ||
    !Number.isSafeInteger(session.totalChunks) ||
    session.fileSize <= 0 ||
    session.chunkSize <= 0 ||
    session.totalChunks !== Math.ceil(session.fileSize / session.chunkSize) ||
    !['image', 'thumbnail'].includes(session.fieldName) ||
    !session.formFields ||
    typeof session.formFields !== 'object' ||
    Array.isArray(session.formFields) ||
    (session.fieldName === 'thumbnail' && !CHUNK_UPLOAD_ID_PATTERN.test(String(session.parentUploadId || '')))
  ) {
    const error = new Error('Chunked upload session does not match this account.');
    error.statusCode = Number(session?.userId) === Number(userId) ? 409 : 404;
    throw error;
  }
  return { ...location, session };
}

async function listReceivedChunks(directory, session) {
  const received = [];
  for (let index = 0; index < session.totalChunks; index += 1) {
    try {
      const stats = await fs.lstat(getChunkPath(directory, index));
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== getExpectedChunkSize(session, index)) {
        const error = new Error(`Stored upload chunk ${index} failed size validation.`);
        error.statusCode = 409;
        throw error;
      }
      received.push(index);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return received;
}

async function initializeChunkUpload({
  assetRoot,
  userId,
  uploadRequestId,
  filename,
  mimeType,
  fileSize,
  maxFileSize,
  fieldName = 'image',
  formFields = {},
  preSubmission = true,
  parentUploadId = null,
  now = Date.now(),
  chunkSize = CHUNK_UPLOAD_SIZE_BYTES,
}) {
  if (
    !Number.isSafeInteger(Number(userId)) ||
    Number(userId) <= 0 ||
    !Number.isSafeInteger(fileSize) ||
    fileSize <= 0 ||
    !Number.isSafeInteger(maxFileSize) ||
    maxFileSize <= 0 ||
    fileSize > maxFileSize ||
    !Number.isSafeInteger(chunkSize) ||
    chunkSize <= 0 ||
    !['image', 'thumbnail'].includes(fieldName) ||
    !formFields ||
    typeof formFields !== 'object' ||
    Array.isArray(formFields) ||
    (fieldName === 'thumbnail' && !CHUNK_UPLOAD_ID_PATTERN.test(String(parentUploadId || ''))) ||
    (fieldName === 'image' && parentUploadId !== null) ||
    (preSubmission && fieldName !== 'image') ||
    !UPLOAD_REQUEST_ID_PATTERN.test(String(uploadRequestId || ''))
  ) {
    const error = new Error('Invalid upload size or chunked upload metadata.');
    error.statusCode = fileSize > maxFileSize ? 413 : 400;
    throw error;
  }
  const uploadId = getChunkUploadId(userId, uploadRequestId);
  const { root, realRoot } = await ensureUploadRoot(assetRoot);
  const directory = path.join(root, uploadId);
  try {
    await fs.mkdir(directory, { mode: 0o700 });
    const realDirectory = await fs.realpath(directory);
    if (path.dirname(realDirectory) !== realRoot) {
      throw new Error('Chunked upload staging directory resolves outside its configured path.');
    }
    const session = {
      uploadId,
      userId: Number(userId),
      uploadRequestId,
      fieldName,
      formFields,
      preSubmission: Boolean(preSubmission),
      parentUploadId,
      filename,
      mimeType: mimeType || 'application/octet-stream',
      fileSize,
      chunkSize,
      totalChunks: Math.ceil(fileSize / chunkSize),
      createdAt: now,
    };
    await fs.writeFile(path.join(directory, 'session.json'), JSON.stringify(session), { flag: 'wx', mode: 0o600 });
    return { session, receivedChunks: [] };
  } catch (error) {
    if (error.code !== 'EEXIST') {
      try {
        await fs.rm(directory, { recursive: true, force: true });
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          console.error('Failed to remove incomplete chunk upload session:', cleanupError);
        }
      }
      throw error;
    }
  }

  const existing = await readSession(assetRoot, uploadId, userId);
  const sameRequest = existing.session.uploadRequestId === uploadRequestId;
  const sameFile = existing.session.filename === filename &&
    existing.session.mimeType === (mimeType || 'application/octet-stream') &&
    existing.session.fileSize === fileSize &&
    existing.session.chunkSize === chunkSize &&
    existing.session.fieldName === fieldName &&
    existing.session.parentUploadId === parentUploadId &&
    existing.session.preSubmission === Boolean(preSubmission) &&
    JSON.stringify(existing.session.formFields) === JSON.stringify(formFields);
  if (!sameRequest || !sameFile) {
    const error = new Error('This idempotency key is already associated with a different upload.');
    error.statusCode = 409;
    throw error;
  }
  const receivedChunks = await listReceivedChunks(existing.directory, existing.session);
  return { session: existing.session, receivedChunks };
}

async function saveUploadChunk({ assetRoot, uploadId, userId, chunkIndex, contents }) {
  if (!Buffer.isBuffer(contents)) {
    const error = new Error('Upload chunk must be an octet-stream body.');
    error.statusCode = 415;
    throw error;
  }
  const { directory, session } = await readSession(assetRoot, uploadId, userId);
  const expectedSize = getExpectedChunkSize(session, chunkIndex);
  if (contents.length !== expectedSize) {
    const error = new Error(`Upload chunk ${chunkIndex} has an invalid size.`);
    error.statusCode = 400;
    throw error;
  }
  const finalPath = getChunkPath(directory, chunkIndex);
  const temporaryPath = `${finalPath}.tmp-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, contents, { flag: 'wx', mode: 0o600 });
    try {
      await fs.link(temporaryPath, finalPath);
      await fs.utimes(directory, new Date(), new Date());
      return { chunkIndex, received: true, alreadyReceived: false };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existingStats = await fs.lstat(finalPath);
      if (!existingStats.isFile() || existingStats.isSymbolicLink()) {
        const conflict = new Error(`Stored upload chunk ${chunkIndex} is unsafe.`);
        conflict.statusCode = 409;
        throw conflict;
      }
      const existing = await fs.readFile(finalPath);
      if (!existing.equals(contents)) {
        const conflict = new Error(`Upload chunk ${chunkIndex} was already received with different content.`);
        conflict.statusCode = 409;
        throw conflict;
      }
      await fs.utimes(directory, new Date(), new Date());
      return { chunkIndex, received: true, alreadyReceived: true };
    }
  } finally {
    await fs.unlink(temporaryPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function assembleChunkedUpload({ assetRoot, uploadId, userId, destinationPath }) {
  const { directory, session } = await readSession(assetRoot, uploadId, userId);
  const receivedChunks = new Set(await listReceivedChunks(directory, session));
  const missingChunks = [];
  for (let index = 0; index < session.totalChunks; index += 1) {
    if (!receivedChunks.has(index)) missingChunks.push(index);
  }
  if (missingChunks.length > 0) {
    const error = new Error('Upload is incomplete; some chunks have not arrived.');
    error.statusCode = 409;
    error.missingChunks = missingChunks;
    throw error;
  }

  const sources = (async function* readPartsInOrder() {
    for (let index = 0; index < session.totalChunks; index += 1) {
      for await (const chunk of createReadStream(getChunkPath(directory, index))) {
        yield chunk;
      }
    }
  })();
  try {
    await pipeline(Readable.from(sources), createWriteStream(destinationPath, { flags: 'wx' }));
    const stats = await fs.stat(destinationPath);
    if (stats.size !== session.fileSize) {
      const error = new Error('Assembled upload size does not match the original file size.');
      error.statusCode = 409;
      throw error;
    }
    return { session, size: stats.size };
  } catch (error) {
    await fs.unlink(destinationPath).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') console.error('Failed to remove invalid assembled upload:', cleanupError);
    });
    throw error;
  }
}

async function cleanupChunkUploadSession(assetRoot, uploadId) {
  const { directory } = await resolveSessionDirectory(assetRoot, uploadId);
  await fs.rm(directory, { recursive: true });
}

async function cleanupExpiredChunkUploads(assetRoot, now = Date.now()) {
  const root = getChunkUploadRoot(assetRoot);
  let rootStats;
  try {
    rootStats = await fs.lstat(root);
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('Chunked upload staging root is not a real directory.');
  }
  const { realRoot } = await ensureUploadRoot(assetRoot);
  let removed = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!CHUNK_UPLOAD_ID_PATTERN.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = path.join(root, entry.name);
    const realDirectory = await fs.realpath(directory);
    if (path.dirname(realDirectory) !== realRoot) continue;
    const stats = await fs.stat(directory);
    if (now - stats.mtimeMs <= CHUNK_UPLOAD_TTL_MS) continue;
    await fs.rm(directory, { recursive: true });
    removed += 1;
  }
  return removed;
}

module.exports = {
  CHUNK_UPLOAD_SIZE_BYTES,
  CHUNK_UPLOAD_TTL_MS,
  assembleChunkedUpload,
  cleanupChunkUploadSession,
  cleanupExpiredChunkUploads,
  getChunkUploadId,
  initializeChunkUpload,
  listReceivedChunks,
  readSession,
  saveUploadChunk,
};
