'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { once } = require('node:events');
const {
  createThumbnailGenerationSettingsRouter,
  getPreviewAllowedStorageRoots,
} = require('../routes/thumbnail-generation-settings-routes');

test('includes the system filesystem root for admin sample folder browsing', () => {
  const allowedRoots = getPreviewAllowedStorageRoots();

  assert.ok(allowedRoots.includes(path.parse(process.cwd()).root));
});

test('activates thumbnail settings immediately through the admin endpoint', async (t) => {
  const activeSettings = { formats: ['jpg'], quality: 72 };
  let activationCount = 0;
  const router = createThumbnailGenerationSettingsRouter({
    verifyAdmin: (req, res, next) => {
      req.user = { id: '1' };
      next();
    },
    settings: {
      activateDraft() {
        activationCount += 1;
        return { active: activeSettings, draft: activeSettings, pendingActivationAt: null };
      },
    },
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/activation`,
    { method: 'POST' }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    active: activeSettings,
    draft: activeSettings,
    pendingActivationAt: null,
  });
  assert.equal(activationCount, 1);
});

test('accepts video sample uploads and stores them outside the temporary upload directory', async (t) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbnail-video-sample-'));
  const destinationDirectory = path.join(temporaryDirectory, 'selected-folder');
  const previewTempRoot = path.join(temporaryDirectory, 'preview-staging');
  await fs.mkdir(destinationDirectory);
  const allowedStorageRoot = await fs.realpath(destinationDirectory);
  t.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const router = createThumbnailGenerationSettingsRouter({
    verifyAdmin: (req, res, next) => {
      req.user = { id: '1' };
      next();
    },
    settings: { get: () => ({ active: {}, draft: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20 } }) },
    allowedStorageRoots: [allowedStorageRoot],
    previewTempRoot,
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const destinationResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-samples/state`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destinationPath: destinationDirectory }),
    }
  );
  assert.equal(destinationResponse.status, 200);

  const form = new FormData();
  form.append('destinationPath', destinationDirectory);
  form.append('file', new Blob(['video-sample'], { type: 'video/mp4' }), 'clip.mp4');
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-samples`,
    { method: 'POST', body: form }
  );
  const sample = await response.json();

  assert.equal(response.status, 201, JSON.stringify(sample));
  assert.equal(sample.format, 'video');
  assert.deepEqual(await fs.readFile(sample.sourcePath), Buffer.from('video-sample'));
  const temporaryFiles = await fs.readdir(previewTempRoot);
  assert.ok(temporaryFiles.every((filename) => !filename.startsWith('upload-')));
});

test('accepts a supported preview upload, uses the supplied settings, and removes its staged source', async (t) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbnail-settings-route-'));
  t.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const previewTempRoot = path.join(temporaryDirectory, 'preview-staging');
  let receivedSettings;
  const router = createThumbnailGenerationSettingsRouter({
    verifyAdmin: (req, res, next) => {
      req.user = { id: req.get('x-user-id') || '1' };
      next();
    },
    settings: { get: () => ({ active: {}, draft: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20 } }) },
    previewTempRoot,
    generatePreview: async (sourcePath, settings) => {
      receivedSettings = settings;
      assert.deepEqual(await fs.readFile(sourcePath), Buffer.from('sample-image'));
      return {
        format: 'webp',
        width: 100,
        height: 50,
        quality: settings.quality,
        buffer: Buffer.from('webp-preview'),
      };
    },
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const form = new FormData();
  form.append('settings', JSON.stringify({
    quality: 65,
    maxFileSizeKb: 80,
    dimensionPercent: 30,
    formats: ['jpg', 'png'],
  }));
  form.append('file', new Blob(['sample-image'], { type: 'image/png' }), 'sample.png');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview`, {
    method: 'POST',
    body: form,
  });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.preview, `data:image/webp;base64,${Buffer.from('webp-preview').toString('base64')}`);
  assert.equal(data.stagingPath, 'Temporary preview storage; removed automatically after generation.');
  assert.equal(receivedSettings.quality, 65);
  assert.equal(receivedSettings.maxFileSizeKb, 80);
  assert.equal(receivedSettings.dimensionPercent, 30);
  assert.deepEqual(receivedSettings.formats, ['jpg', 'png']);
  assert.deepEqual(receivedSettings.formatSettings.jpg, {
    quality: 65,
    maxFileSizeKb: 80,
    dimensionPercent: 30,
  });
  assert.deepEqual(receivedSettings.formatSettings.png, receivedSettings.formatSettings.jpg);
  assert.equal(receivedSettings.formatSettings.video.videoQuality, 60);
  assert.deepEqual(await fs.readdir(previewTempRoot), []);
});

test('stores the uploaded sample and generated preview in the selected folder and cleans both files', async (t) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbnail-sample-flow-'));
  const destinationDirectory = path.join(temporaryDirectory, 'selected-folder');
  const outsideDirectory = path.join(temporaryDirectory, 'outside-folder');
  const previewTempRoot = path.join(temporaryDirectory, 'preview-staging');
  let finishPreviewGeneration;
  let reportPreviewProgress;
  await fs.mkdir(destinationDirectory);
  await fs.mkdir(outsideDirectory);
  const allowedStorageRoot = await fs.realpath(destinationDirectory);
  t.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const router = createThumbnailGenerationSettingsRouter({
    verifyAdmin: (req, res, next) => {
      req.user = { id: req.get('x-user-id') || '1' };
      next();
    },
    settings: { get: () => ({ active: {}, draft: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20 } }) },
    allowedStorageRoots: [allowedStorageRoot],
    previewTempRoot,
    generatePreview: async (sourcePath, suppliedSettings, onProgress) => {
      reportPreviewProgress = onProgress;
      assert.equal(path.dirname(sourcePath), allowedStorageRoot);
      assert.deepEqual(await fs.readFile(sourcePath), Buffer.from('sample-image'));
      assert.equal(suppliedSettings.quality, 65);
      await new Promise((resolve) => {
        finishPreviewGeneration = resolve;
      });
      return {
        format: 'webp',
        width: 100,
        height: 50,
        quality: suppliedSettings.quality,
        buffer: Buffer.from('generated-webp'),
      };
    },
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const validFolderResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-folders?path=${encodeURIComponent(destinationDirectory)}`
  );
  assert.equal(validFolderResponse.status, 200);
  assert.equal((await validFolderResponse.json()).path, allowedStorageRoot);
  const outsideFolderResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-folders?path=${encodeURIComponent(outsideDirectory)}`
  );
  assert.equal(outsideFolderResponse.status, 400);

  const destinationResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-samples/state`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destinationPath: destinationDirectory }),
    }
  );
  assert.equal(destinationResponse.status, 200);
  assert.equal((await destinationResponse.json()).destinationPath, allowedStorageRoot);

  const rejectedUpload = new FormData();
  rejectedUpload.append('destinationPath', outsideDirectory);
  rejectedUpload.append('file', new Blob(['sample-image']), 'outside.png');
  const rejectedResponse = await fetch(`http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-samples`, {
    method: 'POST',
    body: rejectedUpload,
  });
  assert.equal(rejectedResponse.status, 400);

  const form = new FormData();
  form.append('destinationPath', destinationDirectory);
  form.append('file', new Blob(['sample-image'], { type: 'image/png' }), 'sample.png');
  const uploadResponse = await fetch(`http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-samples`, {
    method: 'POST',
    body: form,
  });
  const sample = await uploadResponse.json();
  assert.equal(uploadResponse.status, 201, JSON.stringify(sample));
  assert.equal(sample.sourcePath, path.join(allowedStorageRoot, 'sample.png'));
  assert.equal(sample.outputPath, path.join(allowedStorageRoot, 'sample-preview.webp'));
  assert.deepEqual(await fs.readFile(sample.sourcePath), Buffer.from('sample-image'));

  const otherUserStateResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-samples/state`,
    { headers: { 'x-user-id': '2' } }
  );
  const otherUserState = await otherUserStateResponse.json();
  assert.equal(otherUserStateResponse.status, 200);
  assert.deepEqual(otherUserState.sessionIds, []);
  const otherUserSampleResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-samples/${sample.id}`,
    { headers: { 'x-user-id': '2' } }
  );
  assert.equal(otherUserSampleResponse.status, 404);
  const otherUserDeleteResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-samples/${sample.id}`,
    { method: 'DELETE', headers: { 'x-user-id': '2' } }
  );
  assert.equal(otherUserDeleteResponse.status, 404);

  const generationResponsePromise = fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-samples/${sample.id}/generate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        settings: {
          quality: 65,
          maxFileSizeKb: 80,
          dimensionPercent: 30,
          formats: ['png'],
        },
      }),
    }
  );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview generation did not start.')), 1000);
    const waitForGenerator = () => {
      if (typeof reportPreviewProgress === 'function') {
        clearTimeout(timeout);
        resolve();
        return;
      }
      setImmediate(waitForGenerator);
    };
    waitForGenerator();
  });
  reportPreviewProgress(50);
  const progressResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-samples/${sample.id}/progress`
  );
  assert.equal(progressResponse.status, 200);
  assert.deepEqual(await progressResponse.json(), { percent: 40, status: 'processing' });
  const unauthorizedProgressResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-samples/${sample.id}/progress`,
    { headers: { 'x-user-id': '2' } }
  );
  assert.equal(unauthorizedProgressResponse.status, 404);
  finishPreviewGeneration();
  const generationResponse = await generationResponsePromise;
  const generated = await generationResponse.json();
  assert.equal(generationResponse.status, 200);
  assert.equal(generated.filename, 'sample-preview.webp');
  assert.equal(generated.outputPath, sample.outputPath);
  assert.deepEqual(await fs.readFile(sample.outputPath), Buffer.from('generated-webp'));
  const completedProgressResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings/preview-samples/${sample.id}/progress`
  );
  assert.deepEqual(await completedProgressResponse.json(), { percent: 100, status: 'complete' });

  const restartedRouter = createThumbnailGenerationSettingsRouter({
    verifyAdmin: (req, res, next) => {
      req.user = { id: req.get('x-user-id') || '1' };
      next();
    },
    settings: { get: () => ({ active: {}, draft: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20 } }) },
    allowedStorageRoots: [allowedStorageRoot],
    previewTempRoot,
    generatePreview: async (sourcePath, suppliedSettings) => ({
      format: 'webp',
      width: 100,
      height: 50,
      quality: suppliedSettings.quality,
      buffer: Buffer.from('regenerated-webp'),
    }),
  });
  const restartedApp = express();
  restartedApp.use(express.json());
  restartedApp.use(restartedRouter);
  const restartedServer = restartedApp.listen(0);
  await once(restartedServer, 'listening');
  t.after(() => {
    restartedServer.closeAllConnections();
    restartedServer.close();
  });
  const restoredResponse = await fetch(
    `http://127.0.0.1:${restartedServer.address().port}/admin/thumbnail-generation-settings/preview-samples/${sample.id}`
  );
  const restored = await restoredResponse.json();
  assert.equal(restoredResponse.status, 200);
  assert.equal(restored.sample.sourcePath, sample.sourcePath);
  assert.equal(restored.preview.filename, 'sample-preview.webp');
  const restoredUserStateResponse = await fetch(
    `http://127.0.0.1:${restartedServer.address().port}/admin/thumbnail-generation-settings/preview-samples/state`
  );
  const restoredUserState = await restoredUserStateResponse.json();
  assert.equal(restoredUserState.destinationPath, allowedStorageRoot);
  assert.deepEqual(restoredUserState.sessionIds, [sample.id]);
  assert.equal(restoredUserState.sample.id, sample.id);
  assert.equal(restoredUserState.preview.filename, 'sample-preview.webp');

  await fs.unlink(sample.outputPath);
  const resaveDestinationResponse = await fetch(
    `http://127.0.0.1:${restartedServer.address().port}/admin/thumbnail-generation-settings/preview-samples/state`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destinationPath: allowedStorageRoot }),
    }
  );
  const resavedDestinationState = await resaveDestinationResponse.json();
  assert.equal(resaveDestinationResponse.status, 200);
  assert.equal(resavedDestinationState.destinationPath, allowedStorageRoot);
  assert.equal(resavedDestinationState.sample.id, sample.id);
  assert.equal(resavedDestinationState.preview, null);

  const missingPreviewStateResponse = await fetch(
    `http://127.0.0.1:${restartedServer.address().port}/admin/thumbnail-generation-settings/preview-samples/state`
  );
  const missingPreviewState = await missingPreviewStateResponse.json();
  assert.equal(missingPreviewStateResponse.status, 200);
  assert.equal(missingPreviewState.sample.id, sample.id);
  assert.equal(missingPreviewState.preview, null);
  const regenerateResponse = await fetch(
    `http://127.0.0.1:${restartedServer.address().port}/admin/thumbnail-generation-settings/preview-samples/${sample.id}/generate`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
  );
  assert.equal(regenerateResponse.status, 200);
  assert.deepEqual(await fs.readFile(sample.outputPath), Buffer.from('regenerated-webp'));

  const newTestResponse = await fetch(
    `http://127.0.0.1:${restartedServer.address().port}/admin/thumbnail-generation-settings/preview-samples/new-test`,
    { method: 'POST' }
  );
  const newTest = await newTestResponse.json();
  assert.equal(newTestResponse.status, 200);
  assert.equal(newTest.sample, null);
  assert.deepEqual(newTest.sessionIds, [sample.id]);

  const duplicateUpload = new FormData();
  duplicateUpload.append('destinationPath', destinationDirectory);
  duplicateUpload.append('file', new Blob(['sample-image'], { type: 'image/png' }), 'sample.png');
  const duplicateResponse = await fetch(
    `http://127.0.0.1:${restartedServer.address().port}/admin/thumbnail-generation-settings/preview-samples`,
    { method: 'POST', body: duplicateUpload }
  );
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 409);
  assert.equal(duplicate.code, 'SAMPLE_FILENAME_EXISTS');
  assert.equal(duplicate.existingFilename, 'sample.png');
  assert.equal(duplicate.suggestedFilename, 'sample1.png');

  const renamedUpload = new FormData();
  renamedUpload.append('destinationPath', destinationDirectory);
  renamedUpload.append('filename', duplicate.suggestedFilename);
  renamedUpload.append('file', new Blob(['sample-image'], { type: 'image/png' }), 'sample.png');
  const renamedResponse = await fetch(
    `http://127.0.0.1:${restartedServer.address().port}/admin/thumbnail-generation-settings/preview-samples`,
    { method: 'POST', body: renamedUpload }
  );
  const renamedSample = await renamedResponse.json();
  assert.equal(renamedResponse.status, 201);
  assert.equal(renamedSample.originalFilename, 'sample1.png');
  assert.equal(renamedSample.sourcePath, path.join(allowedStorageRoot, 'sample1.png'));

  const archiveRenamedTestResponse = await fetch(
    `http://127.0.0.1:${restartedServer.address().port}/admin/thumbnail-generation-settings/preview-samples/new-test`,
    { method: 'POST' }
  );
  assert.equal(archiveRenamedTestResponse.status, 200);

  const cleanupResponse = await fetch(
    `http://127.0.0.1:${restartedServer.address().port}/admin/thumbnail-generation-settings/preview-samples/${sample.id}`,
    { method: 'DELETE' }
  );
  assert.equal(cleanupResponse.status, 200);
  assert.deepEqual(await cleanupResponse.json(), { cleaned: true });
  const renamedCleanupResponse = await fetch(
    `http://127.0.0.1:${restartedServer.address().port}/admin/thumbnail-generation-settings/preview-samples/${renamedSample.id}`,
    { method: 'DELETE' }
  );
  assert.equal(renamedCleanupResponse.status, 200);
  assert.deepEqual(await fs.readdir(destinationDirectory), []);
  const resetStateResponse = await fetch(
    `http://127.0.0.1:${restartedServer.address().port}/admin/thumbnail-generation-settings/preview-samples/state`,
    { method: 'DELETE' }
  );
  assert.equal(resetStateResponse.status, 200);
  assert.equal((await resetStateResponse.json()).destinationPath, '');
});

test('stores and cleans multiple video frames and serves the original through a capability URL', async (t) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbnail-video-output-'));
  const destinationDirectory = path.join(temporaryDirectory, 'selected-folder');
  const previewTempRoot = path.join(temporaryDirectory, 'preview-staging');
  await fs.mkdir(destinationDirectory);
  const allowedStorageRoot = await fs.realpath(destinationDirectory);
  t.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const router = createThumbnailGenerationSettingsRouter({
    verifyAdmin: (req, res, next) => {
      req.user = { id: req.get('x-user-id') || '1' };
      next();
    },
    settings: { get: () => ({ active: {}, draft: {} }) },
    allowedStorageRoots: [allowedStorageRoot],
    previewTempRoot,
    generatePreview: async () => ({
      format: 'webp',
      width: 100,
      height: 50,
      quality: 60,
      buffer: Buffer.from('frame-one'),
      previews: [
        { format: 'webp', width: 100, height: 50, quality: 60, timestamp: 0, buffer: Buffer.from('frame-one') },
        { format: 'webp', width: 100, height: 50, quality: 60, timestamp: 3.3, buffer: Buffer.from('frame-two') },
      ],
      videoPreview: true,
    }),
    generateOptimizedVideo: async (sourcePath, suppliedSettings, outputPath) => {
      assert.equal(path.extname(sourcePath), '.mp4');
      assert.equal(suppliedSettings.videoQuality, 72);
      assert.equal(suppliedSettings.videoMaxHeight, 480);
      await fs.writeFile(outputPath, 'optimized-video', { flag: 'wx' });
      return {
        path: outputPath,
        width: 640,
        height: 360,
        sizeBytes: Buffer.byteLength('optimized-video'),
        format: 'mp4',
        quality: suppliedSettings.videoQuality,
        maxHeight: suppliedSettings.videoMaxHeight,
        filename: path.basename(outputPath),
      };
    },
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings`;

  const destinationResponse = await fetch(`${baseUrl}/preview-samples/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ destinationPath: destinationDirectory }),
  });
  assert.equal(destinationResponse.status, 200);
  const upload = new FormData();
  upload.append('destinationPath', destinationDirectory);
  upload.append('file', new Blob(['sample-video'], { type: 'video/mp4' }), 'clip.mp4');
  const uploadResponse = await fetch(`${baseUrl}/preview-samples`, { method: 'POST', body: upload });
  const sample = await uploadResponse.json();
  assert.equal(uploadResponse.status, 201);

  const generateResponse = await fetch(`${baseUrl}/preview-samples/${sample.id}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      settings: {
        quality: 60,
        maxFileSizeKb: 50,
        dimensionPercent: 20,
        formats: ['video'],
        multipleVideoThumbnails: false,
        includeVideoPreview: false,
        generateOptimizedVideoPreview: false,
        videoQuality: 60,
        videoMaxHeight: 720,
        videoMaxFileSizeMb: 2,
        formatSettings: {
          video: {
            quality: 60,
            maxFileSizeKb: 50,
            dimensionPercent: 20,
            multipleVideoThumbnails: true,
            includeVideoPreview: true,
            generateOptimizedVideoPreview: true,
            videoQuality: 72,
            videoMaxHeight: 480,
            videoMaxFileSizeMb: 1,
          },
        },
      },
    }),
  });
  const generated = await generateResponse.json();
  assert.equal(generateResponse.status, 200, JSON.stringify(generated));
  assert.equal(generated.previews.length, 2);
  assert.equal(generated.videoPreview, true);
  assert.equal(generated.optimizedVideo.format, 'mp4');
  assert.equal(generated.optimizedVideo.width, 640);
  assert.equal(generated.optimizedVideo.outputPath, path.join(allowedStorageRoot, 'clip-preview.mp4'));
  assert.equal(await fs.readFile(generated.previews[1].outputPath, 'utf8'), 'frame-two');

  const invalidVideoResponse = await fetch(`http://127.0.0.1:${server.address().port}${generated.optimizedVideoUrl.replace(/token=[^&]+/, 'token=invalid')}`);
  assert.equal(invalidVideoResponse.status, 404);
  const videoResponse = await fetch(`http://127.0.0.1:${server.address().port}${generated.optimizedVideoUrl}`);
  assert.equal(videoResponse.status, 200);
  assert.match(videoResponse.headers.get('content-type'), /video\/mp4/);
  assert.equal(await videoResponse.text(), 'optimized-video');
  const downloadUrl = `${generated.optimizedVideoUrl}&download=true`;
  const downloadResponse = await fetch(`http://127.0.0.1:${server.address().port}${downloadUrl}`);
  assert.equal(downloadResponse.status, 200);
  assert.match(downloadResponse.headers.get('content-disposition'), /attachment/);
  assert.equal(await downloadResponse.text(), 'optimized-video');
  const originalResponse = await fetch(
    `http://127.0.0.1:${server.address().port}${generated.videoPreviewUrl.replace('/optimized?', '/original?')}`
  );
  assert.equal(originalResponse.status, 200);
  assert.equal(await originalResponse.text(), 'sample-video');

  const cleanupResponse = await fetch(`${baseUrl}/preview-samples/${sample.id}`, { method: 'DELETE' });
  assert.equal(cleanupResponse.status, 200);
  assert.deepEqual(await fs.readdir(destinationDirectory), []);
});

test('keeps generated thumbnail frames when the optimized video exceeds its size limit', async (t) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbnail-video-size-limit-'));
  const destinationDirectory = path.join(temporaryDirectory, 'selected-folder');
  await fs.mkdir(destinationDirectory);
  const allowedStorageRoot = await fs.realpath(destinationDirectory);
  t.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const router = createThumbnailGenerationSettingsRouter({
    verifyAdmin: (req, res, next) => {
      req.user = { id: '1' };
      next();
    },
    settings: { get: () => ({ active: {}, draft: {} }) },
    allowedStorageRoots: [allowedStorageRoot],
    previewTempRoot: path.join(temporaryDirectory, 'preview-staging'),
    generatePreview: async () => ({
      format: 'webp',
      width: 100,
      height: 50,
      quality: 60,
      buffer: Buffer.from('frame-one'),
      previews: ['frame-one', 'frame-two', 'frame-three'].map((frame, index) => ({
        format: 'webp',
        width: 100,
        height: 50,
        quality: 60,
        timestamp: index * 3,
        buffer: Buffer.from(frame),
      })),
      videoPreview: true,
    }),
    generateOptimizedVideo: async () => {
      const error = new RangeError('The 1 MB limit is too small for this video.');
      error.code = 'VIDEO_SIZE_LIMIT_EXCEEDED';
      throw error;
    },
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/admin/thumbnail-generation-settings`;

  const destinationResponse = await fetch(`${baseUrl}/preview-samples/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ destinationPath: destinationDirectory }),
  });
  assert.equal(destinationResponse.status, 200);
  const upload = new FormData();
  upload.append('destinationPath', destinationDirectory);
  upload.append('file', new Blob(['sample-video'], { type: 'video/mp4' }), 'clip.mp4');
  const uploadResponse = await fetch(`${baseUrl}/preview-samples`, { method: 'POST', body: upload });
  const sample = await uploadResponse.json();
  assert.equal(uploadResponse.status, 201);

  const generateResponse = await fetch(`${baseUrl}/preview-samples/${sample.id}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      settings: {
        quality: 60,
        maxFileSizeKb: 50,
        dimensionPercent: 20,
        formats: ['video'],
        multipleVideoThumbnails: true,
        includeVideoPreview: true,
        generateOptimizedVideoPreview: true,
        videoQuality: 60,
        videoMaxHeight: 720,
        videoMaxFileSizeMb: 1,
      },
    }),
  });
  const generated = await generateResponse.json();
  assert.equal(generateResponse.status, 200, JSON.stringify(generated));
  assert.equal(generated.previews.length, 3);
  assert.equal(generated.optimizedVideo, null);
  assert.equal(generated.optimizedVideoWarning, 'The 1 MB limit is too small for this video.');
  assert.match(generated.videoPreviewUrl, /\/original\?token=/);
  assert.deepEqual(await fs.readFile(generated.previews[0].outputPath), Buffer.from('frame-one'));
  assert.deepEqual(await fs.readFile(generated.previews[1].outputPath), Buffer.from('frame-two'));
  assert.deepEqual(await fs.readFile(generated.previews[2].outputPath), Buffer.from('frame-three'));

  const stateResponse = await fetch(`${baseUrl}/preview-samples/state`);
  const state = await stateResponse.json();
  assert.equal(state.preview.optimizedVideoWarning, generated.optimizedVideoWarning);
  assert.equal(state.preview.previews.length, 3);
});
