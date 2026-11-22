'use strict';

const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const assetStorageConnections = require('../services/assetStorageConnections');
const {
  browseStorageDirectory,
  getAllowedStorageRoots,
  resolveAllowedDirectory,
} = require('../services/storageLocationBrowser');
const thumbnailGenerationSettings = require('../services/thumbnailGenerationSettings');
const assetThumbnails = require('../utils/assetThumbnails');

const PREVIEW_UPLOAD_LIMIT_BYTES = assetThumbnails.MAX_SOURCE_BYTES;
const PREVIEW_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.eps', '.psd',
  ...assetThumbnails.VIDEO_EXTENSIONS,
]);
const PREVIEW_TEMP_ROOT = path.join(__dirname, '..', 'tmp', 'thumbnail-generation-previews');

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fsSync.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function createThumbnailGenerationSettingsRouter({
  verifyAdmin,
  settings = thumbnailGenerationSettings,
  generatePreview = assetThumbnails.generateThumbnailPreview,
  generateOptimizedVideo = assetThumbnails.generateOptimizedVideoPreview,
  normalizeSettings = thumbnailGenerationSettings.normalizeThumbnailGenerationSettings,
  previewTempRoot = PREVIEW_TEMP_ROOT,
  allowedStorageRoots = getPreviewAllowedStorageRoots,
} = {}) {
  if (typeof verifyAdmin !== 'function') {
    throw new TypeError('Thumbnail settings routes require admin verification.');
  }

  const router = express.Router();
  const previewUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, callback) => {
        try {
          fsSync.mkdirSync(previewTempRoot, { recursive: true, mode: 0o700 });
          callback(null, previewTempRoot);
        } catch (error) {
          callback(error);
        }
      },
      filename: (req, file, callback) => {
        const extension = path.extname(file.originalname || '').toLowerCase();
        callback(null, `upload-${crypto.randomUUID()}${extension}`);
      },
    }),
    limits: { fileSize: PREVIEW_UPLOAD_LIMIT_BYTES, files: 1 },
    fileFilter: (req, file, callback) => {
      if (!PREVIEW_EXTENSIONS.has(path.extname(file.originalname || '').toLowerCase())) {
        callback(new Error('Preview uploads must be JPG, PNG, EPS, PSD, or supported video files.'));
        return;
      }
      callback(null, true);
    },
  }).single('file');
  const basePath = '/admin/thumbnail-generation-settings';
  const sampleSessions = new Map();

  function resolveSampleDirectory(requestedPath) {
    const roots = typeof allowedStorageRoots === 'function'
      ? allowedStorageRoots()
      : allowedStorageRoots;
    return resolveAllowedDirectory(requestedPath, roots);
  }

  function getSampleSessionManifestPath(id) {
    if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)) return null;
    return path.join(previewTempRoot, `sample-${id}.json`);
  }

  function getUserPreviewStatePath(userId) {
    if (!/^\d+$/.test(String(userId))) {
      throw new TypeError('The authenticated admin user id is invalid.');
    }
    return path.join(previewTempRoot, `user-${userId}.json`);
  }

  function getAuthenticatedUserId(req) {
    const userId = req.user?.id;
    if (!/^\d+$/.test(String(userId ?? ''))) {
      throw new TypeError('The authenticated admin user id is missing.');
    }
    return String(userId);
  }

  async function removeTemporaryUpload(uploadedPath) {
    try {
      await fs.unlink(uploadedPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  function receivePreviewUpload(req, res, next, missingFileMessage, handler) {
    previewUpload(req, res, (uploadError) => {
      if (uploadError) {
        const status = uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ error: uploadError.message || 'Sample upload failed.' });
      }
      if (!req.file) return res.status(400).json({ error: missingFileMessage });
      Promise.resolve()
        .then(handler)
        .finally(() => removeTemporaryUpload(req.file.path))
        .catch(next);
    });
  }

  async function readUserPreviewState(userId) {
    const emptyState = {
      userId,
      destinationPath: null,
      sessionIds: [],
      currentSessionId: null,
    };
    try {
      const state = JSON.parse(await fs.readFile(getUserPreviewStatePath(userId), 'utf8'));
      if (
        String(state?.userId) !== userId ||
        typeof state.destinationPath !== 'string' && state.destinationPath !== null ||
        !Array.isArray(state.sessionIds) ||
        state.sessionIds.some((id) => !getSampleSessionManifestPath(id)) ||
        state.currentSessionId !== null && !state.sessionIds.includes(state.currentSessionId)
      ) {
        throw new Error('The saved sample preview state is invalid.');
      }
      return {
        ...emptyState,
        destinationPath: state.destinationPath,
        sessionIds: [...new Set(state.sessionIds)],
        currentSessionId: state.currentSessionId,
      };
    } catch (error) {
      if (error.code === 'ENOENT') return emptyState;
      throw new Error(`Could not read the user's sample preview state: ${error.message}`, { cause: error });
    }
  }

  async function writeUserPreviewState(state) {
    await fs.mkdir(previewTempRoot, { recursive: true, mode: 0o700 });
    const statePath = getUserPreviewStatePath(state.userId);
    const temporaryPath = `${statePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporaryPath, statePath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch((cleanupError) => {
        if (cleanupError.code !== 'ENOENT') throw cleanupError;
      });
      throw error;
    }
  }

  async function persistSampleSession(id, sample) {
    await fs.mkdir(previewTempRoot, { recursive: true, mode: 0o700 });
    const manifestPath = getSampleSessionManifestPath(id);
    const temporaryPath = `${manifestPath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(sample)}\n`, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporaryPath, manifestPath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch((cleanupError) => {
        if (cleanupError.code !== 'ENOENT') throw cleanupError;
      });
      throw error;
    }
  }

  async function getSampleSession(id, userId, { claimLegacy = false } = {}) {
    const existing = sampleSessions.get(id);
    let sample = existing;
    if (!sample) {
      const manifestPath = getSampleSessionManifestPath(id);
      if (!manifestPath) return null;
      try {
        sample = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new Error(`Could not read the sample preview session: ${error.message}`, { cause: error });
      }
    }

    const ownerUserId = sample.ownerUserId === undefined ? null : String(sample.ownerUserId);
    if (ownerUserId && ownerUserId !== userId) return null;
    if (!ownerUserId && !claimLegacy) return null;
    const destinationDirectory = resolveSampleDirectory(sample.destinationDirectory);
    const originalFilename = String(sample.originalFilename || '');
    const extension = path.extname(originalFilename).toLowerCase();
    const previewFilename = `${path.parse(originalFilename).name}-preview.webp`;
    const optimizedVideoFilename = `${path.parse(originalFilename).name}-preview.mp4`;
    const sourcePath = path.join(destinationDirectory, originalFilename);
    const outputPath = path.join(destinationDirectory, previewFilename);
    const optimizedVideoPath = path.join(destinationDirectory, optimizedVideoFilename);
    const previewEntries = sample.previewEntries || [];
    sample.optimizedVideoPath ??= optimizedVideoPath;
    sample.optimizedVideoHash ??= null;
    sample.optimizedVideoMetadata ??= null;
    if (
      destinationDirectory !== sample.destinationDirectory ||
      !originalFilename ||
      originalFilename === '.' ||
      originalFilename === '..' ||
      /[\\/]/.test(originalFilename) ||
      originalFilename.includes('\0') ||
      !PREVIEW_EXTENSIONS.has(extension) ||
      sourcePath !== sample.sourcePath ||
      outputPath !== sample.outputPath ||
      optimizedVideoPath !== sample.optimizedVideoPath ||
      !/^[\da-f]{64}$/i.test(sample.sourceHash || '') ||
      sample.previewHash !== null && !/^[\da-f]{64}$/i.test(sample.previewHash || '') ||
      sample.optimizedVideoHash !== null &&
        !/^[\da-f]{64}$/i.test(sample.optimizedVideoHash || '') ||
      !Array.isArray(previewEntries) ||
      previewEntries.some((entry, index) => (
        entry.outputPath !== path.join(
          destinationDirectory,
          `${path.parse(originalFilename).name}-preview-${index + 2}.webp`
        ) ||
        !/^[\da-f]{64}$/i.test(entry.hash || '')
      )) ||
      sample.previewAccessToken !== null &&
        sample.previewAccessToken !== undefined &&
        !/^[\da-f]{64}$/i.test(sample.previewAccessToken || '')
    ) {
      throw new Error('The saved sample preview session is invalid.');
    }
    sample.previewEntries = previewEntries;
    if (!ownerUserId) {
      sample.ownerUserId = userId;
      await persistSampleSession(id, sample);
    }
    sampleSessions.set(id, sample);
    return sample;
  }

  async function getGeneratedPreview(sample, sampleId) {
    if (!sample.previewHash) return null;
    const files = [
      {
        outputPath: sample.outputPath,
        filename: sample.previewFilename,
        hash: sample.previewHash,
        metadata: sample.previewMetadata,
      },
      ...sample.previewEntries.map((entry) => ({
        ...entry,
        metadata: entry.metadata,
      })),
    ];
    const previews = [];
    for (const file of files) {
      let buffer;
      try {
        buffer = await fs.readFile(file.outputPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        sample.previewHash = null;
        sample.previewMetadata = null;
        sample.previewEntries = [];
        await persistSampleSession(sampleId, sample);
        return null;
      }
      const currentHash = crypto.createHash('sha256').update(buffer).digest('hex');
      if (currentHash !== file.hash) {
        throw new Error('A generated preview changed after creation; clean the sample files before continuing.');
      }
      previews.push({
        ...file.metadata,
        filename: file.filename,
        outputPath: file.outputPath,
        preview: `data:image/webp;base64,${buffer.toString('base64')}`,
      });
    }
    let optimizedVideo = null;
    if (sample.optimizedVideoHash) {
      let videoStats;
      try {
        videoStats = await fs.stat(sample.optimizedVideoPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        throw new Error('The optimized video preview is missing; clean this sample before generating it again.');
      }
      const videoHash = await hashFile(sample.optimizedVideoPath);
      if (videoHash !== sample.optimizedVideoHash) {
        throw new Error('The optimized video preview changed after creation; clean the sample files before continuing.');
      }
      optimizedVideo = {
        ...sample.optimizedVideoMetadata,
        outputPath: sample.optimizedVideoPath,
        sizeBytes: videoStats.size,
      };
    }
    return {
      ...sample.previewMetadata,
      filename: sample.previewFilename,
      outputPath: sample.outputPath,
      preview: previews[0].preview,
      previews,
      videoPreview: Boolean(sample.previewMetadata?.videoPreview),
      optimizedVideo,
      optimizedVideoWarning: sample.optimizedVideoWarning || null,
      videoPreviewUrl: sample.previewMetadata?.videoPreview && sample.previewAccessToken
        ? `${basePath}/preview-samples/${sampleId}/${optimizedVideo ? 'optimized' : 'original'}?token=${sample.previewAccessToken}`
        : null,
      optimizedVideoUrl: optimizedVideo && sample.previewAccessToken
        ? `${basePath}/preview-samples/${sampleId}/optimized?token=${sample.previewAccessToken}`
        : null,
    };
  }

  function getSampleResponse(id, sample) {
    const extension = path.extname(sample.originalFilename).toLowerCase();
    return {
      id,
      originalFilename: sample.originalFilename,
      previewFilename: sample.previewFilename,
      destinationPath: sample.destinationDirectory,
      sourcePath: sample.sourcePath,
      outputPath: sample.outputPath,
      optimizedVideoPath: sample.optimizedVideoPath,
      videoPreviewUrl: sample.previewAccessToken
        ? `${basePath}/preview-samples/${id}/original?token=${sample.previewAccessToken}`
        : null,
      format: assetThumbnails.VIDEO_EXTENSIONS.has(extension)
        ? 'video'
        : extension.replace(/^\./, '').replace(/^jpeg$/, 'jpg'),
    };
  }

  async function sampleFileExists(filePath) {
    try {
      await fs.lstat(filePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async function getAvailableSampleFilename(filename, destinationDirectory) {
    const parsed = path.parse(filename);
    for (let suffix = 1; suffix <= 10000; suffix += 1) {
      const candidate = `${parsed.name}${suffix}${parsed.ext}`;
      const candidateSource = path.join(destinationDirectory, candidate);
      const candidatePreview = path.join(destinationDirectory, `${path.parse(candidate).name}-preview.webp`);
      if (!await sampleFileExists(candidateSource) && !await sampleFileExists(candidatePreview)) {
        return candidate;
      }
    }
    throw new Error('Could not find an available sample filename in the selected folder.');
  }

  async function sendSampleFilenameConflict(res, filename, destinationDirectory, conflictingFilename = filename) {
    const suggestedFilename = await getAvailableSampleFilename(filename, destinationDirectory);
    return res.status(409).json({
      code: 'SAMPLE_FILENAME_EXISTS',
      existingFilename: conflictingFilename,
      suggestedFilename,
      error: `A file named ${conflictingFilename} already exists in the selected folder.`,
    });
  }

  async function getUserPreviewStateResponse(userId, state = null) {
    const userState = state || await readUserPreviewState(userId);
    const currentSample = userState.currentSessionId
      ? await getSampleSession(userState.currentSessionId, userId)
      : null;
    return {
      destinationPath: userState.destinationPath || '',
      sessionIds: [...userState.sessionIds],
      sample: currentSample ? getSampleResponse(userState.currentSessionId, currentSample) : null,
      preview: currentSample ? await getGeneratedPreview(currentSample, userState.currentSessionId) : null,
    };
  }

  router.get(basePath, verifyAdmin, (req, res, next) => {
    try {
      return res.json(settings.get());
    } catch (error) {
      return next(error);
    }
  });

  router.put(`${basePath}/draft`, verifyAdmin, (req, res, next) => {
    try {
      return res.json(settings.saveDraft(req.body));
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return res.status(400).json({ error: error.message });
      }
      if (error.message === 'Stop the activation timer before changing thumbnail settings.') {
        return res.status(409).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.post(`${basePath}/activation`, verifyAdmin, (req, res, next) => {
    try {
      return res.json(settings.activateDraft());
    } catch (error) {
      return next(error);
    }
  });

  router.delete(`${basePath}/activation`, verifyAdmin, (req, res, next) => {
    try {
      return res.json(settings.cancelActivation());
    } catch (error) {
      return next(error);
    }
  });

  router.get(`${basePath}/preview-folders`, verifyAdmin, (req, res, next) => {
    try {
      const roots = typeof allowedStorageRoots === 'function'
        ? allowedStorageRoots()
        : allowedStorageRoots;
      if (typeof req.query.path !== 'string' || !req.query.path) {
        return res.json({
          roots: roots.map((rootPath) => ({
            path: rootPath,
            name: rootPath === path.parse(process.cwd()).root
              ? 'System root'
              : path.basename(rootPath) || rootPath,
          })),
        });
      }
      return res.json(browseStorageDirectory(req.query.path, roots));
    } catch (error) {
      if (error instanceof TypeError || /folder|path|storage/i.test(error.message)) {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.get(`${basePath}/preview-samples/state`, verifyAdmin, async (req, res, next) => {
    try {
      const userId = getAuthenticatedUserId(req);
      return res.json(await getUserPreviewStateResponse(userId));
    } catch (error) {
      return next(error);
    }
  });

  router.put(`${basePath}/preview-samples/state`, verifyAdmin, async (req, res, next) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const state = await readUserPreviewState(userId);
      const requestedPath = typeof req.body?.destinationPath === 'string'
        ? req.body.destinationPath.trim()
        : '';
      if (!requestedPath) return res.status(400).json({ error: 'Choose a destination folder first.' });
      const destinationPath = resolveSampleDirectory(requestedPath);
      if (state.sessionIds.length && destinationPath !== state.destinationPath) {
        return res.status(409).json({ error: 'Clean the previous sample tests before changing their destination folder.' });
      }
      state.destinationPath = destinationPath;
      await writeUserPreviewState(state);
      return res.json(await getUserPreviewStateResponse(userId, state));
    } catch (error) {
      if (error instanceof TypeError || /folder|path|storage/i.test(error.message)) {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.delete(`${basePath}/preview-samples/state`, verifyAdmin, async (req, res, next) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const state = await readUserPreviewState(userId);
      if (state.sessionIds.length) {
        return res.status(409).json({ error: 'Clean all sample tests before resetting their destination folder.' });
      }
      state.destinationPath = null;
      state.currentSessionId = null;
      await writeUserPreviewState(state);
      return res.json({
        destinationPath: '',
        sessionIds: [],
        sample: null,
        preview: null,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post(`${basePath}/preview-samples/import`, verifyAdmin, async (req, res, next) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const requestedIds = req.body?.sessionIds;
      const currentSessionId = req.body?.currentSessionId || null;
      if (
        !Array.isArray(requestedIds) ||
        requestedIds.length > 1000 ||
        requestedIds.some((id) => !getSampleSessionManifestPath(id)) ||
        currentSessionId && !requestedIds.includes(currentSessionId)
      ) {
        return res.status(400).json({ error: 'The legacy sample test history is invalid.' });
      }

      const state = await readUserPreviewState(userId);
      const importedIds = [...new Set(requestedIds)];
      const importedSamples = [];
      for (const id of importedIds) {
        const sample = await getSampleSession(id, userId, { claimLegacy: true });
        if (!sample) {
          return res.status(404).json({ error: 'A previous sample test could not be found or belongs to another admin user.' });
        }
        importedSamples.push(sample);
      }
      const activeSample = state.currentSessionId
        ? await getSampleSession(state.currentSessionId, userId)
        : currentSessionId
          ? importedSamples[importedIds.indexOf(currentSessionId)]
          : null;
      state.destinationPath = activeSample?.destinationDirectory
        || state.destinationPath
        || importedSamples[importedSamples.length - 1]?.destinationDirectory
        || null;
      state.sessionIds = [...new Set([...state.sessionIds, ...importedIds])];
      if (!state.currentSessionId) state.currentSessionId = currentSessionId;
      await writeUserPreviewState(state);
      return res.json(await getUserPreviewStateResponse(userId, state));
    } catch (error) {
      return next(error);
    }
  });

  async function streamSampleVideo(req, res, next, useOptimizedVideo) {
    try {
      const manifestPath = getSampleSessionManifestPath(req.params.id);
      if (!manifestPath) return res.status(404).end();
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      const requestedToken = String(req.query.token || '');
      const savedToken = String(manifest.previewAccessToken || '');
      if (
        !/^[\da-f]{64}$/i.test(savedToken) ||
        !/^[\da-f]{64}$/i.test(requestedToken) ||
        !crypto.timingSafeEqual(Buffer.from(requestedToken, 'hex'), Buffer.from(savedToken, 'hex'))
      ) {
        return res.status(404).end();
      }
      const sample = await getSampleSession(req.params.id, String(manifest.ownerUserId));
      if (!sample || !assetThumbnails.VIDEO_EXTENSIONS.has(path.extname(sample.originalFilename).toLowerCase())) {
        return res.status(404).end();
      }
      if (useOptimizedVideo && !sample.optimizedVideoHash) return res.status(404).end();
      if (req.query.download === 'true') {
        res.attachment(path.basename(useOptimizedVideo ? sample.optimizedVideoPath : sample.sourcePath));
      } else {
        res.set('Content-Disposition', 'inline');
      }
      res.set('Cache-Control', 'private, no-store');
      res.set('Referrer-Policy', 'no-referrer');
      res.set('X-Content-Type-Options', 'nosniff');
      return res.sendFile(useOptimizedVideo ? sample.optimizedVideoPath : sample.sourcePath);
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return res.status(404).end();
      return next(error);
    }
  }

  router.get(`${basePath}/preview-samples/:id/original`, (req, res, next) => (
    streamSampleVideo(req, res, next, false)
  ));
  router.get(`${basePath}/preview-samples/:id/optimized`, (req, res, next) => (
    streamSampleVideo(req, res, next, true)
  ));

  router.post(`${basePath}/preview-samples/new-test`, verifyAdmin, async (req, res, next) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const state = await readUserPreviewState(userId);
      if (!state.currentSessionId || !await getSampleSession(state.currentSessionId, userId)) {
        return res.status(409).json({ error: 'There is no active sample test to restart.' });
      }
      state.currentSessionId = null;
      await writeUserPreviewState(state);
      return res.json(await getUserPreviewStateResponse(userId, state));
    } catch (error) {
      return next(error);
    }
  });

  router.post(`${basePath}/preview`, verifyAdmin, (req, res, next) => {
    receivePreviewUpload(req, res, next, 'Choose a preview file first.', async () => {
      const extension = path.extname(req.file.originalname || '').toLowerCase();
      let result;
      let previewError;
      let previewErrorStatus = 400;
      try {
        await fs.chmod(req.file.path, 0o600);
        const previewSettings = req.body.settings
          ? normalizeSettings(JSON.parse(req.body.settings))
          : settings.get().draft;
        result = await generatePreview(req.file.path, previewSettings);
      } catch (error) {
        previewError = error;
        if (['EACCES', 'EIO', 'ENOSPC', 'EROFS'].includes(error.code)) {
          previewErrorStatus = 500;
        }
      }
      if (previewError) {
        return res.status(previewErrorStatus).json({ error: previewError.message || 'Could not generate the preview.' });
      }
      return res.json({
        format: result.format,
        width: result.width,
        height: result.height,
        quality: result.quality,
        sizeBytes: result.buffer.length,
        preview: `data:image/webp;base64,${result.buffer.toString('base64')}`,
        stagingPath: 'Temporary preview storage; removed automatically after generation.',
      });
    });
  });

  router.post(`${basePath}/preview-samples`, verifyAdmin, (req, res, next) => {
    receivePreviewUpload(req, res, next, 'Choose a sample file first.', async () => {
      const extension = path.extname(req.file.originalname || '').toLowerCase();
      if (!PREVIEW_EXTENSIONS.has(extension)) {
        return res.status(400).json({ error: 'Sample uploads must be JPG, PNG, EPS, PSD, or supported video files.' });
      }

      const uploadedFilename = String(req.file.originalname || '')
        .replace(/\\/g, '/')
        .split('/')
        .pop();
      if (!uploadedFilename || uploadedFilename === '.' || uploadedFilename === '..' || uploadedFilename.includes('\0')) {
        return res.status(400).json({ error: 'The sample file must have a valid filename.' });
      }
      const requestedFilename = req.body?.filename;
      let originalFilename = uploadedFilename;
      if (requestedFilename !== undefined) {
        if (
          typeof requestedFilename !== 'string' ||
          !requestedFilename ||
          requestedFilename === '.' ||
          requestedFilename === '..' ||
          requestedFilename.includes('\0') ||
          /[\\/]/.test(requestedFilename) ||
          path.extname(requestedFilename).toLowerCase() !== path.extname(uploadedFilename).toLowerCase()
        ) {
          return res.status(400).json({ error: 'The renamed sample filename is invalid.' });
        }
        originalFilename = requestedFilename;
      }

      let userId;
      let userState;
      let destinationDirectory;
      try {
        userId = getAuthenticatedUserId(req);
        userState = await readUserPreviewState(userId);
        destinationDirectory = resolveSampleDirectory(req.body.destinationPath);
      } catch (error) {
        if (error instanceof TypeError || /folder|path|storage/i.test(error.message)) {
          return res.status(400).json({ error: error.message });
        }
        return next(error);
      }
      if (!userState.destinationPath || destinationDirectory !== userState.destinationPath) {
        return res.status(409).json({ error: 'Set this sample destination in Step 1 before uploading.' });
      }
      if (userState.currentSessionId) {
        return res.status(409).json({ error: 'Start a new test before uploading another sample.' });
      }

      const previewFilename = `${path.parse(originalFilename).name}-preview.webp`;
      const sourcePath = path.join(destinationDirectory, originalFilename);
      const outputPath = path.join(destinationDirectory, previewFilename);
      const sampleId = crypto.randomUUID();
      let sourceCreated = false;
      let sampleManifestCreated = false;
      try {
        if (await sampleFileExists(sourcePath)) {
          return await sendSampleFilenameConflict(res, originalFilename, destinationDirectory);
        }
        if (await sampleFileExists(outputPath)) {
          return await sendSampleFilenameConflict(
            res,
            originalFilename,
            destinationDirectory,
            previewFilename
          );
        }
        await fs.copyFile(req.file.path, sourcePath, fsSync.constants.COPYFILE_EXCL);
        sourceCreated = true;
        await fs.chmod(sourcePath, 0o600);
        const sourceHash = await hashFile(sourcePath);
        const sample = {
          ownerUserId: userId,
          destinationDirectory,
          originalFilename,
          previewFilename,
          sourcePath,
          outputPath,
          optimizedVideoPath: path.join(
            destinationDirectory,
            `${path.parse(originalFilename).name}-preview.mp4`
          ),
          sourceHash,
          previewHash: null,
          previewMetadata: null,
          previewEntries: [],
          optimizedVideoHash: null,
          optimizedVideoMetadata: null,
          previewAccessToken: crypto.randomBytes(32).toString('hex'),
        };
        await persistSampleSession(sampleId, sample);
        sampleManifestCreated = true;
        sampleSessions.set(sampleId, sample);
        userState.sessionIds = [...new Set([...userState.sessionIds, sampleId])];
        userState.currentSessionId = sampleId;
        await writeUserPreviewState(userState);
      } catch (error) {
        const cleanupErrors = [];
        if (sampleManifestCreated) {
          try {
            await fs.unlink(getSampleSessionManifestPath(sampleId));
          } catch (cleanupError) {
            if (cleanupError.code !== 'ENOENT') cleanupErrors.push(cleanupError);
          }
        }
        sampleSessions.delete(sampleId);
        if (sourceCreated) {
          try {
            await fs.unlink(sourcePath);
          } catch (cleanupError) {
            if (cleanupError.code !== 'ENOENT') cleanupErrors.push(cleanupError);
          }
        }
        if (cleanupErrors.length) {
          return next(new AggregateError(
            [error, ...cleanupErrors],
            'Could not save the sample or clean up its partial upload.'
          ));
        }
        if (error.code === 'EEXIST') {
          return await sendSampleFilenameConflict(res, originalFilename, destinationDirectory);
        }
        if (['EACCES', 'EIO', 'ENOSPC', 'EROFS'].includes(error.code)) {
          return res.status(500).json({ error: `Could not save the sample file: ${error.message}` });
        }
        return next(error);
      }

      return res.status(201).json({
        ...getSampleResponse(sampleId, sampleSessions.get(sampleId)),
        sessionIds: userState.sessionIds,
      });
    });
  });

  router.get(`${basePath}/preview-samples/:id`, verifyAdmin, async (req, res, next) => {
    try {
      const userId = getAuthenticatedUserId(req);
      const userState = await readUserPreviewState(userId);
      if (!userState.sessionIds.includes(req.params.id)) {
        return res.status(404).json({ error: 'The uploaded sample is not available for this admin user.' });
      }
      const sample = await getSampleSession(req.params.id, userId);
      if (!sample) return res.status(404).json({ error: 'The uploaded sample is no longer available. Start again from Step 1.' });
      return res.json({
        sample: getSampleResponse(req.params.id, sample),
        preview: await getGeneratedPreview(sample, req.params.id),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post(`${basePath}/preview-samples/:id/generate`, verifyAdmin, async (req, res, next) => {
    let sample;
    let userId;
    try {
      userId = getAuthenticatedUserId(req);
      const userState = await readUserPreviewState(userId);
      if (!userState.sessionIds.includes(req.params.id) || userState.currentSessionId !== req.params.id) {
        return res.status(404).json({ error: 'The sample is not the active test for this admin user.' });
      }
      sample = await getSampleSession(req.params.id, userId);
    } catch (error) {
      return next(error);
    }
    if (!sample) return res.status(404).json({ error: 'The uploaded sample is no longer available. Start again from Step 1.' });
    if (sample.previewHash) return res.status(409).json({ error: 'This sample preview has already been generated.' });

    let result;
    let previewResults;
    let previewSettings;
    let optimizedVideoWarning = null;
    const outputCreated = [];
    try {
      previewSettings = req.body?.settings
        ? normalizeSettings(req.body.settings)
        : settings.get().draft;
      result = await generatePreview(sample.sourcePath, previewSettings);
      const videoSettings = thumbnailGenerationSettings.getSettingsForFormat(previewSettings, 'video');
      previewResults = Array.isArray(result.previews) && result.previews.length
        ? result.previews
        : [result];
      const additionalEntries = [];
      for (const [index, previewResult] of previewResults.entries()) {
        const outputPath = index === 0
          ? sample.outputPath
          : path.join(
            sample.destinationDirectory,
            `${path.parse(sample.originalFilename).name}-preview-${index + 1}.webp`
          );
        const filename = path.basename(outputPath);
        await fs.writeFile(outputPath, previewResult.buffer, { flag: 'wx', mode: 0o600 });
        outputCreated.push(outputPath);
        const bufferHash = crypto.createHash('sha256').update(previewResult.buffer).digest('hex');
        const metadata = {
          format: previewResult.format,
          width: previewResult.width,
          height: previewResult.height,
          quality: previewResult.quality,
          sizeBytes: previewResult.buffer.length,
          timestamp: previewResult.timestamp ?? null,
        };
        if (index > 0) {
          additionalEntries.push({
            outputPath,
            filename,
            hash: bufferHash,
            metadata,
          });
        } else {
          sample.previewHash = bufferHash;
          sample.previewMetadata = metadata;
        }
      }
      sample.previewEntries = additionalEntries;
      sample.previewMetadata.videoPreview = Boolean(result.videoPreview);
      sample.optimizedVideoHash = null;
      sample.optimizedVideoMetadata = null;
      sample.optimizedVideoWarning = null;
      if (sample.previewMetadata.videoPreview && videoSettings.generateOptimizedVideoPreview) {
        try {
          const optimizedVideo = await generateOptimizedVideo(
            sample.sourcePath,
            videoSettings,
            sample.optimizedVideoPath
          );
          outputCreated.push(sample.optimizedVideoPath);
          sample.optimizedVideoHash = await hashFile(sample.optimizedVideoPath);
          sample.optimizedVideoMetadata = {
            format: optimizedVideo.format,
            width: optimizedVideo.width,
            height: optimizedVideo.height,
            sizeBytes: optimizedVideo.sizeBytes,
            quality: optimizedVideo.quality,
            maxHeight: optimizedVideo.maxHeight,
            filename: optimizedVideo.filename,
          };
        } catch (error) {
          if (error.code !== 'VIDEO_SIZE_LIMIT_EXCEEDED') throw error;
          optimizedVideoWarning = error.message;
          sample.optimizedVideoWarning = error.message;
        }
      }
      if (!sample.previewMetadata.videoPreview) sample.previewAccessToken = null;
      await persistSampleSession(req.params.id, sample);
    } catch (error) {
      sample.previewHash = null;
      sample.previewMetadata = null;
      sample.previewEntries = [];
      sample.optimizedVideoHash = null;
      sample.optimizedVideoMetadata = null;
      sample.optimizedVideoWarning = null;
      const cleanupErrors = [];
      for (const outputPath of outputCreated) {
        try {
          await fs.unlink(outputPath);
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') {
            cleanupErrors.push(cleanupError);
          }
        }
      }
      if (cleanupErrors.length) {
        return next(new AggregateError(
          [error, ...cleanupErrors],
          'Could not save the preview session or remove its incomplete generated files.'
        ));
      }
      if (error.code === 'EEXIST') {
        return res.status(409).json({
          error: `A file named ${sample.previewFilename} already exists in the selected folder. Clean the sample or choose another folder.`,
        });
      }
      if (['EACCES', 'EIO', 'ENOSPC', 'EROFS'].includes(error.code)) {
        return res.status(500).json({ error: `Could not save the generated preview: ${error.message}` });
      }
      if (error.permanent || error instanceof TypeError || error instanceof RangeError || error.message.startsWith('Enable ')) {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    }

    return res.json({
      format: result.format,
      width: result.width,
      height: result.height,
      quality: result.quality,
      sizeBytes: result.buffer.length,
      preview: `data:image/webp;base64,${result.buffer.toString('base64')}`,
      filename: sample.previewFilename,
      outputPath: sample.outputPath,
      previews: previewResults.map((previewResult, index) => {
        const filename = index === 0
          ? sample.previewFilename
          : `${path.parse(sample.originalFilename).name}-preview-${index + 1}.webp`;
        return {
          format: previewResult.format,
          width: previewResult.width,
          height: previewResult.height,
          quality: previewResult.quality,
          sizeBytes: previewResult.buffer.length,
          timestamp: previewResult.timestamp ?? null,
          filename,
          outputPath: index === 0
            ? sample.outputPath
            : path.join(sample.destinationDirectory, filename),
          preview: `data:image/webp;base64,${previewResult.buffer.toString('base64')}`,
        };
      }),
      videoPreview: Boolean(result.videoPreview),
      optimizedVideo: sample.optimizedVideoMetadata
        ? { ...sample.optimizedVideoMetadata, outputPath: sample.optimizedVideoPath }
        : null,
      optimizedVideoWarning,
      videoPreviewUrl: result.videoPreview
        ? `${basePath}/preview-samples/${req.params.id}/${sample.optimizedVideoHash ? 'optimized' : 'original'}?token=${sample.previewAccessToken}`
        : null,
      optimizedVideoUrl: sample.optimizedVideoHash
        ? `${basePath}/preview-samples/${req.params.id}/optimized?token=${sample.previewAccessToken}`
        : null,
    });
  });

  router.delete(`${basePath}/preview-samples/:id`, verifyAdmin, async (req, res, next) => {
    let sample;
    let userState;
    try {
      const userId = getAuthenticatedUserId(req);
      userState = await readUserPreviewState(userId);
      if (!userState.sessionIds.includes(req.params.id)) {
        return res.status(404).json({ error: 'The sample is not available for this admin user.' });
      }
      sample = await getSampleSession(req.params.id, userId);
    } catch (error) {
      return next(error);
    }
    if (!sample) return res.status(404).json({ error: 'The sample session was not found or was already cleaned.' });

    const filesToRemove = [
      { filePath: sample.sourcePath, expectedHash: sample.sourceHash },
      ...(sample.previewHash ? [{ filePath: sample.outputPath, expectedHash: sample.previewHash }] : []),
      ...sample.previewEntries.map((entry) => ({
        filePath: entry.outputPath,
        expectedHash: entry.hash,
      })),
      ...(sample.optimizedVideoHash
        ? [{ filePath: sample.optimizedVideoPath, expectedHash: sample.optimizedVideoHash }]
        : []),
    ];
    try {
      for (const file of filesToRemove) {
        let current;
        try {
          current = await fs.lstat(file.filePath);
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        if (!current.isFile() || current.isSymbolicLink()) {
          return res.status(409).json({ error: 'A sample path is no longer a regular file; manual cleanup was stopped for safety.' });
        }
        const currentHash = crypto.createHash('sha256').update(await fs.readFile(file.filePath)).digest('hex');
        if (currentHash !== file.expectedHash) {
          return res.status(409).json({ error: 'A sample file changed after upload; manual cleanup was stopped to avoid deleting unrelated data.' });
        }
      }

      for (const file of filesToRemove) {
        await fs.unlink(file.filePath).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
      const manifestPath = getSampleSessionManifestPath(req.params.id);
      await fs.unlink(manifestPath).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      sampleSessions.delete(req.params.id);
      userState.sessionIds = userState.sessionIds.filter((id) => id !== req.params.id);
      if (userState.currentSessionId === req.params.id) userState.currentSessionId = null;
      await writeUserPreviewState(userState);
      return res.json({ cleaned: true });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function getPreviewAllowedStorageRoots() {
  const configured = assetStorageConnections.getConfiguredStorageRoots();
  const configuredPaths = [
    ...configured.assetLocations.filter(Boolean).map(({ path: locationPath }) => locationPath),
    ...configured.thumbnailLocations.filter(Boolean).map(({ path: locationPath }) => locationPath),
    configured.assetsRoot || assetThumbnails.getOriginalAssetStorageRoot(),
    configured.thumbnailStoragePath,
  ].filter(Boolean);
  const configuredRoots = [...new Set(configuredPaths.flatMap((configuredPath) => {
    try {
      const stats = fsSync.lstatSync(configuredPath);
      return stats.isDirectory() && !stats.isSymbolicLink()
        ? [fsSync.realpathSync(configuredPath)]
        : [];
    } catch (error) {
      if (['EACCES', 'ENOENT', 'ENOTDIR'].includes(error.code)) return [];
      throw error;
    }
  }))];
  const systemRoots = getAllowedStorageRoots({ currentRoots: configuredRoots });
  return [...new Set([path.parse(process.cwd()).root, ...systemRoots, ...configuredRoots])];
}

module.exports = {
  PREVIEW_UPLOAD_LIMIT_BYTES,
  createThumbnailGenerationSettingsRouter,
  getPreviewAllowedStorageRoots,
};
