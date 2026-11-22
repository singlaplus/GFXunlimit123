'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createThumbnailGenerationSettings,
  getSettingsForFormat,
} = require('../services/thumbnailGenerationSettings');
const SUPPORTED_FORMATS = ['jpg', 'png', 'eps', 'psd', 'video'];

function expectedSettings({
  quality = 37,
  maxFileSizeKb = 50,
  dimensionPercent = 20,
  formats = SUPPORTED_FORMATS,
  multipleVideoThumbnails = false,
  includeVideoPreview = false,
  generateOptimizedVideoPreview = false,
  videoQuality = 60,
  videoMaxHeight = 720,
  videoMaxFileSizeMb = 2,
} = {}) {
  const formatSettings = Object.fromEntries(SUPPORTED_FORMATS.map((format) => {
    const base = formats.includes(format)
      ? { quality, maxFileSizeKb, dimensionPercent }
      : { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20 };
    return [format, format === 'video'
      ? {
          ...base,
          multipleVideoThumbnails,
          includeVideoPreview,
          generateOptimizedVideoPreview,
          videoQuality,
          videoMaxHeight,
          videoMaxFileSizeMb,
        }
      : base];
  }));
  return {
    quality,
    maxFileSizeKb,
    dimensionPercent,
    multipleVideoThumbnails,
    includeVideoPreview,
    generateOptimizedVideoPreview,
    videoQuality,
    videoMaxHeight,
    videoMaxFileSizeMb,
    formats: [...formats],
    formatSettings,
  };
}

function createHarness(filePath) {
  let now = 1_000;
  const timers = [];
  const settings = createThumbnailGenerationSettings({
    filePath,
    now: () => now,
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: (timer) => { timer.cleared = true; },
    logger: { error() {} },
  });
  return {
    settings,
    timers,
    setNow(value) { now = value; },
  };
}

test('activates a saved draft immediately', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { settings, timers } = createHarness(path.join(directory, 'settings.json'));

  settings.saveDraft({ quality: 72, maxFileSizeKb: 80, dimensionPercent: 35 });
  const activated = settings.activateDraft();
  const expected = expectedSettings({
    quality: 72,
    maxFileSizeKb: 80,
    dimensionPercent: 35,
  });
  assert.deepEqual(activated.active, expected);
  assert.deepEqual(activated.draft, expected);
  assert.equal(activated.pendingActivationAt, null);
  assert.equal(timers.length, 0);
});

test('cancels a pending activation without changing active settings', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'settings.json');
  const previous = expectedSettings();
  const pending = expectedSettings({ quality: 72, maxFileSizeKb: 80, dimensionPercent: 35 });
  fs.writeFileSync(filePath, JSON.stringify({
    active: previous,
    draft: pending,
    pendingActivation: { settings: pending, activatesAt: new Date(10_000).toISOString() },
  }));
  const { settings } = createHarness(filePath);

  const cancelled = settings.cancelActivation();

  assert.equal(cancelled.pendingActivationAt, null);
  assert.deepEqual(cancelled.active, previous);
  assert.deepEqual(cancelled.draft, pending);
});

test('applies an expired persisted activation after a process restart', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'settings.json');
  const pending = expectedSettings({ quality: 72, maxFileSizeKb: 80, dimensionPercent: 35 });
  fs.writeFileSync(filePath, JSON.stringify({
    active: expectedSettings(),
    draft: pending,
    pendingActivation: { settings: pending, activatesAt: new Date(5_000).toISOString() },
  }));
  const restartedProcess = createHarness(filePath);
  restartedProcess.setNow(5_000);
  assert.deepEqual(restartedProcess.settings.getActiveSettings(), expectedSettings({
    quality: 72,
    maxFileSizeKb: 80,
    dimensionPercent: 35,
  }));
});

test('allows a selected subset but rejects an empty or unsupported format list', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { settings } = createHarness(path.join(directory, 'settings.json'));

  const saved = settings.saveDraft({
    quality: 70,
    maxFileSizeKb: 60,
    dimensionPercent: 30,
    formats: ['psd', 'jpg', 'video'],
  });
  assert.deepEqual(saved.draft.formats, ['jpg', 'psd', 'video']);
  assert.equal(saved.draft.multipleVideoThumbnails, false);
  assert.equal(saved.draft.includeVideoPreview, false);
  assert.equal(saved.draft.videoMaxFileSizeMb, 2);
  assert.throws(() => settings.saveDraft({
    quality: 70,
    maxFileSizeKb: 60,
    dimensionPercent: 30,
    formats: [],
  }), /Select at least one supported format/);
  assert.throws(() => settings.saveDraft({
    quality: 70,
    maxFileSizeKb: 60,
    dimensionPercent: 30,
    formats: ['svg'],
  }), /Select at least one supported format/);
});

test('stores selected formats in a stable order', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { settings } = createHarness(path.join(directory, 'settings.json'));

  const saved = settings.saveDraft({
    quality: 70,
    maxFileSizeKb: 60,
    dimensionPercent: 30,
    formats: ['psd', 'png', 'jpg', 'video'],
  });
  assert.deepEqual(saved.draft.formats, ['jpg', 'png', 'psd', 'video']);
});

test('persists optional video thumbnail and original video preview settings', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'settings.json');
  const { settings } = createHarness(filePath);

  const saved = settings.saveDraft({
    quality: 70,
    maxFileSizeKb: 60,
    dimensionPercent: 30,
    formats: ['video'],
    multipleVideoThumbnails: true,
    includeVideoPreview: true,
    generateOptimizedVideoPreview: true,
    videoQuality: 72,
    videoMaxHeight: 480,
    videoMaxFileSizeMb: 1,
  });

  assert.equal(saved.draft.multipleVideoThumbnails, true);
  assert.equal(saved.draft.includeVideoPreview, true);
  assert.equal(saved.draft.generateOptimizedVideoPreview, true);
  assert.equal(saved.draft.videoQuality, 72);
  assert.equal(saved.draft.videoMaxHeight, 480);
  assert.equal(saved.draft.videoMaxFileSizeMb, 1);
  assert.deepEqual(createHarness(filePath).settings.get().draft, saved.draft);
  assert.throws(() => settings.saveDraft({
    quality: 70,
    maxFileSizeKb: 60,
    dimensionPercent: 30,
    formats: ['video'],
    multipleVideoThumbnails: 'yes',
  }), /must be true or false/);
  assert.throws(() => settings.saveDraft({
    quality: 70,
    maxFileSizeKb: 60,
    dimensionPercent: 30,
    formats: ['video'],
    generateOptimizedVideoPreview: true,
    includeVideoPreview: false,
  }), /Enable playable video preview/);
});

test('stores independent settings for each format and restores them after restart', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbnail-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'settings.json');
  const { settings } = createHarness(filePath);
  const draft = settings.saveDraft({
    quality: 72,
    maxFileSizeKb: 80,
    dimensionPercent: 35,
    formats: ['jpg', 'png', 'video'],
    formatSettings: {
      jpg: { quality: 72, maxFileSizeKb: 80, dimensionPercent: 35 },
      png: { quality: 48, maxFileSizeKb: 120, dimensionPercent: 60 },
      video: {
        quality: 65,
        maxFileSizeKb: 180,
        dimensionPercent: 50,
        multipleVideoThumbnails: true,
        includeVideoPreview: true,
        generateOptimizedVideoPreview: true,
        videoQuality: 84,
        videoMaxHeight: 480,
        videoMaxFileSizeMb: 3,
      },
    },
  }).draft;

  const restored = createHarness(filePath).settings.get().draft;
  assert.deepEqual(restored, draft);
  assert.equal(getSettingsForFormat(restored, 'jpg').quality, 72);
  assert.equal(getSettingsForFormat(restored, 'png').quality, 48);
  assert.equal(getSettingsForFormat(restored, 'video').videoMaxHeight, 480);
  assert.equal(restored.formatSettings.eps.quality, 37);
});
