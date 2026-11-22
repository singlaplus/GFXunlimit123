'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_THUMBNAIL_FORMATS = Object.freeze(['jpg', 'png', 'eps', 'psd', 'video']);
const DEFAULT_IMAGE_SETTINGS = Object.freeze({
  quality: 37,
  maxFileSizeKb: 50,
  dimensionPercent: 20,
});
const DEFAULT_VIDEO_SETTINGS = Object.freeze({
  ...DEFAULT_IMAGE_SETTINGS,
  multipleVideoThumbnails: false,
  includeVideoPreview: false,
  generateOptimizedVideoPreview: false,
  videoQuality: 60,
  videoMaxHeight: 720,
  videoMaxFileSizeMb: 2,
});
const DEFAULT_FORMAT_SETTINGS = Object.freeze({
  jpg: DEFAULT_IMAGE_SETTINGS,
  png: DEFAULT_IMAGE_SETTINGS,
  eps: DEFAULT_IMAGE_SETTINGS,
  psd: DEFAULT_IMAGE_SETTINGS,
  video: DEFAULT_VIDEO_SETTINGS,
});
const DEFAULT_THUMBNAIL_GENERATION_SETTINGS = Object.freeze({
  ...DEFAULT_IMAGE_SETTINGS,
  formats: SUPPORTED_THUMBNAIL_FORMATS,
  ...DEFAULT_VIDEO_SETTINGS,
  formatSettings: DEFAULT_FORMAT_SETTINGS,
});
const SETTINGS_FILE = path.join(__dirname, '..', 'uploads', 'thumbnail-generation-settings.json');

function normalizeFormatSettings(format, value, fallback) {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new TypeError(`Settings for ${format} must be an object.`);
  }
  const settings = { ...fallback, ...value };
  settings.quality = Number(settings.quality);
  settings.maxFileSizeKb = Number(settings.maxFileSizeKb);
  settings.dimensionPercent = Number(settings.dimensionPercent);
  if (!Number.isInteger(settings.quality) || settings.quality < 1 || settings.quality > 100) {
    throw new RangeError(`${format.toUpperCase()} quality must be a whole number from 1 to 100.`);
  }
  if (!Number.isInteger(settings.maxFileSizeKb) || settings.maxFileSizeKb < 10 || settings.maxFileSizeKb > 2048) {
    throw new RangeError(`${format.toUpperCase()} maximum file size must be a whole number from 10 to 2048 KB.`);
  }
  if (!Number.isInteger(settings.dimensionPercent) || settings.dimensionPercent < 1 || settings.dimensionPercent > 100) {
    throw new RangeError(`${format.toUpperCase()} dimensions must be a whole percentage from 1 to 100.`);
  }
  if (format !== 'video') {
    return {
      quality: settings.quality,
      maxFileSizeKb: settings.maxFileSizeKb,
      dimensionPercent: settings.dimensionPercent,
    };
  }
  settings.videoQuality = Number(settings.videoQuality);
  settings.videoMaxHeight = Number(settings.videoMaxHeight);
  settings.videoMaxFileSizeMb = Number(settings.videoMaxFileSizeMb);
  if (
    typeof settings.multipleVideoThumbnails !== 'boolean' ||
    typeof settings.includeVideoPreview !== 'boolean' ||
    typeof settings.generateOptimizedVideoPreview !== 'boolean'
  ) {
    throw new TypeError('Video thumbnail and preview options must be true or false.');
  }
  if (settings.generateOptimizedVideoPreview && !settings.includeVideoPreview) {
    throw new RangeError('Enable playable video preview before generating an optimized video.');
  }
  if (!Number.isInteger(settings.videoQuality) || settings.videoQuality < 1 || settings.videoQuality > 100) {
    throw new RangeError('Video quality must be a whole number from 1 to 100.');
  }
  if (![360, 480, 720, 1080].includes(settings.videoMaxHeight)) {
    throw new RangeError('Video resolution must be 360p, 480p, 720p, or 1080p.');
  }
  if (!Number.isInteger(settings.videoMaxFileSizeMb) || settings.videoMaxFileSizeMb < 1 || settings.videoMaxFileSizeMb > 2048) {
    throw new RangeError('Maximum video file size must be a whole number from 1 to 2048 MB.');
  }
  return {
    quality: settings.quality,
    maxFileSizeKb: settings.maxFileSizeKb,
    dimensionPercent: settings.dimensionPercent,
    multipleVideoThumbnails: settings.multipleVideoThumbnails,
    includeVideoPreview: settings.includeVideoPreview,
    generateOptimizedVideoPreview: settings.generateOptimizedVideoPreview,
    videoQuality: settings.videoQuality,
    videoMaxHeight: settings.videoMaxHeight,
    videoMaxFileSizeMb: settings.videoMaxFileSizeMb,
  };
}

function normalizeThumbnailGenerationSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Thumbnail settings must be an object.');
  }

  const formatsValue = value.formats === undefined
    ? SUPPORTED_THUMBNAIL_FORMATS
    : value.formats;
  if (!Array.isArray(formatsValue)) {
    throw new TypeError('Formats must be a list of supported thumbnail types.');
  }
  const selectedFormats = new Set(formatsValue.map((format) => (
    typeof format === 'string' ? format.trim().toLowerCase() : ''
  )));
  const formats = SUPPORTED_THUMBNAIL_FORMATS.filter((format) => selectedFormats.has(format));
  const legacySettings = {
    quality: Number(value.quality ?? DEFAULT_IMAGE_SETTINGS.quality),
    maxFileSizeKb: Number(value.maxFileSizeKb ?? DEFAULT_IMAGE_SETTINGS.maxFileSizeKb),
    dimensionPercent: Number(value.dimensionPercent ?? DEFAULT_IMAGE_SETTINGS.dimensionPercent),
    multipleVideoThumbnails: value.multipleVideoThumbnails ?? false,
    includeVideoPreview: value.includeVideoPreview ?? false,
    generateOptimizedVideoPreview: value.generateOptimizedVideoPreview ?? false,
    videoQuality: Number(value.videoQuality ?? DEFAULT_VIDEO_SETTINGS.videoQuality),
    videoMaxHeight: Number(value.videoMaxHeight ?? DEFAULT_VIDEO_SETTINGS.videoMaxHeight),
    videoMaxFileSizeMb: Number(value.videoMaxFileSizeMb ?? DEFAULT_VIDEO_SETTINGS.videoMaxFileSizeMb),
  };
  if (
    value.formatSettings !== undefined &&
    (!value.formatSettings || typeof value.formatSettings !== 'object' || Array.isArray(value.formatSettings))
  ) {
    throw new TypeError('Format settings must be an object keyed by supported thumbnail types.');
  }
  const formatSettings = {};
  for (const format of SUPPORTED_THUMBNAIL_FORMATS) {
    const formatValue = value.formatSettings?.[format];
    const fallback = formatValue === undefined && value.formatSettings === undefined && selectedFormats.has(format)
      ? legacySettings
      : DEFAULT_FORMAT_SETTINGS[format];
    formatSettings[format] = normalizeFormatSettings(format, formatValue, fallback);
  }
  const settings = {
    ...legacySettings,
    formats,
    formatSettings,
  };
  if (!Number.isInteger(settings.quality) || settings.quality < 1 || settings.quality > 100) {
    throw new RangeError('Quality must be a whole number from 1 to 100.');
  }
  if (!Number.isInteger(settings.maxFileSizeKb) || settings.maxFileSizeKb < 10 || settings.maxFileSizeKb > 2048) {
    throw new RangeError('Maximum file size must be a whole number from 10 to 2048 KB.');
  }
  if (!Number.isInteger(settings.dimensionPercent) || settings.dimensionPercent < 1 || settings.dimensionPercent > 100) {
    throw new RangeError('Dimensions must be a whole percentage from 1 to 100.');
  }
  if (
    formats.length === 0 ||
    formats.some((format) => !SUPPORTED_THUMBNAIL_FORMATS.includes(format))
  ) {
    throw new RangeError('Select at least one supported format: JPG, PNG, EPS, PSD, or video.');
  }
  return settings;
}

function getSettingsForFormat(value, format) {
  if (!SUPPORTED_THUMBNAIL_FORMATS.includes(format)) {
    throw new RangeError(`Unsupported thumbnail settings format: ${format}`);
  }
  const settings = normalizeThumbnailGenerationSettings(value);
  return {
    ...settings,
    ...settings.formatSettings[format],
    formats: [...settings.formats],
    formatSettings: settings.formatSettings,
  };
}

function cloneFormatSettings(formatSettings) {
  return Object.fromEntries(SUPPORTED_THUMBNAIL_FORMATS.map((format) => (
    [format, { ...formatSettings[format] }]
  )));
}

function createThumbnailGenerationSettings({
  filePath = SETTINGS_FILE,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  logger = console,
} = {}) {
  let activationTimer = null;

  function clearActivationTimer() {
    if (activationTimer !== null) {
      clearTimeoutFn(activationTimer);
      activationTimer = null;
    }
  }

  function readState() {
    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
            active: normalizeThumbnailGenerationSettings(DEFAULT_THUMBNAIL_GENERATION_SETTINGS),
            draft: normalizeThumbnailGenerationSettings(DEFAULT_THUMBNAIL_GENERATION_SETTINGS),
          pendingActivation: null,
        };
      }
      throw new Error(`Could not read thumbnail generation settings: ${error.message}`, { cause: error });
    }

    const active = normalizeThumbnailGenerationSettings(stored?.active);
    const draft = normalizeThumbnailGenerationSettings(stored?.draft);
    let pendingActivation = null;
    if (stored?.pendingActivation !== null && stored?.pendingActivation !== undefined) {
      const activatesAt = new Date(stored.pendingActivation.activatesAt);
      if (Number.isNaN(activatesAt.getTime())) {
        throw new Error('Stored thumbnail activation time is invalid.');
      }
      pendingActivation = {
        settings: normalizeThumbnailGenerationSettings(stored.pendingActivation.settings),
        activatesAt: activatesAt.toISOString(),
      };
    }
    return { active, draft, pendingActivation };
  }

  function writeState(state) {
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          throw new Error(`${error.message}; temporary settings cleanup failed: ${cleanupError.message}`, { cause: error });
        }
      }
      throw error;
    }
  }

  function scheduleTimer(activatesAt) {
    clearActivationTimer();
    const delay = Math.max(0, new Date(activatesAt).getTime() - now());
    activationTimer = setTimeoutFn(() => {
      activationTimer = null;
      try {
        get();
      } catch (error) {
        logger.error('Failed to activate scheduled thumbnail settings:', error);
      }
    }, delay);
    activationTimer.unref?.();
  }

  function get() {
    const state = readState();
    if (state.pendingActivation) {
      if (new Date(state.pendingActivation.activatesAt).getTime() <= now()) {
        state.active = state.pendingActivation.settings;
        state.draft = state.pendingActivation.settings;
        state.pendingActivation = null;
        writeState(state);
        clearActivationTimer();
      } else {
        scheduleTimer(state.pendingActivation.activatesAt);
      }
    } else {
      clearActivationTimer();
    }

    return {
      active: {
        ...state.active,
        formats: [...state.active.formats],
        formatSettings: cloneFormatSettings(state.active.formatSettings),
      },
      draft: {
        ...state.draft,
        formats: [...state.draft.formats],
        formatSettings: cloneFormatSettings(state.draft.formatSettings),
      },
      pendingActivationAt: state.pendingActivation?.activatesAt || null,
    };
  }

  function saveDraft(value) {
    get();
    const state = readState();
    if (state.pendingActivation) {
      throw new Error('Stop the activation timer before changing thumbnail settings.');
    }
    state.draft = normalizeThumbnailGenerationSettings(value);
    writeState(state);
    return get();
  }

  function activateDraft() {
    const state = readState();
    state.active = normalizeThumbnailGenerationSettings(state.draft);
    state.draft = normalizeThumbnailGenerationSettings(state.draft);
    state.pendingActivation = null;
    writeState(state);
    clearActivationTimer();
    return get();
  }

  function cancelActivation() {
    const state = readState();
    if (state.pendingActivation && new Date(state.pendingActivation.activatesAt).getTime() <= now()) {
      return get();
    }
    state.pendingActivation = null;
    writeState(state);
    clearActivationTimer();
    return get();
  }

  function getActiveSettings() {
    return get().active;
  }

  return {
    get,
    getActiveSettings,
    saveDraft,
    activateDraft,
    cancelActivation,
  };
}

const thumbnailGenerationSettings = createThumbnailGenerationSettings();

module.exports = {
  DEFAULT_THUMBNAIL_GENERATION_SETTINGS,
  DEFAULT_FORMAT_SETTINGS,
  SUPPORTED_THUMBNAIL_FORMATS,
  getSettingsForFormat,
  normalizeThumbnailGenerationSettings,
  createThumbnailGenerationSettings,
  ...thumbnailGenerationSettings,
};
