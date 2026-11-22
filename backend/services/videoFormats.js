'use strict';

const SUPPORTED_VIDEO_EXTENSIONS = Object.freeze([
  '.mp4', '.m4v', '.mov', '.avi', '.mkv', '.webm', '.mpeg', '.mpg', '.mpe',
  '.m2v', '.m2ts', '.mts', '.ts', '.3gp', '.3g2', '.wmv', '.asf', '.flv',
  '.f4v', '.ogv', '.vob', '.mxf', '.y4m',
]);

const VIDEO_EXTENSIONS = new Set(SUPPORTED_VIDEO_EXTENSIONS);

module.exports = {
  SUPPORTED_VIDEO_EXTENSIONS,
  VIDEO_EXTENSIONS,
};
