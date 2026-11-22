const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getToolCandidates,
  probeTool,
  verifyThumbnailToolchain,
} = require('../services/thumbnailToolchain');
const { resolveImageMagickExecutable } = require('../thumbnail-engine/imagemagick-path');

test('ImageMagick detection supports both magick and convert on Unix-like systems', () => {
  assert.deepEqual(
    getToolCandidates('imagemagick', { platform: 'darwin', env: {} }),
    ['magick', 'convert']
  );
});

test('thumbnail toolchain installs missing open-source tools and verifies them again', async () => {
  const installed = [];
  const available = new Set(['ghostscript']);
  const run = (command, args) => {
    if (!available.has(command)) throw new Error(`${command} not found`);
    if (args[0] === '--version' || args[0] === '-version') {
      return command === 'ffmpeg' ? 'ffmpeg version test' : `${command} test version`;
    }
    return Buffer.from('png');
  };
  const installer = (toolNames, platform) => {
    assert.equal(platform, 'darwin');
    installed.push(...toolNames);
    toolNames.forEach((name) => {
      available.add(name === 'imagemagick' ? 'magick' : name === 'ghostscript' ? 'gs' : name);
    });
  };
  const result = await verifyThumbnailToolchain({
    platform: 'darwin',
    env: {},
    run: (command, args, options) => {
      const normalizedCommand = command === 'gs' ? 'ghostscript' : command;
      return run(normalizedCommand, args, options);
    },
    installer,
  });

  assert.deepEqual(installed, ['ffmpeg', 'imagemagick']);
  assert.equal(result.tools.ffmpeg.available, true);
  assert.equal(result.tools.ghostscript.available, true);
  assert.equal(result.tools.imagemagick.available, true);
  assert.equal(result.processors.ai_processor, 'built-in');
});

test('configured executable paths are checked instead of silently ignored', () => {
  const result = probeTool('ffmpeg', {
    platform: 'darwin',
    env: { FFMPEG_PATH: '/custom/ffmpeg' },
    run: () => {
      throw new Error('configured executable failed');
    },
  });
  assert.deepEqual(getToolCandidates('ffmpeg', {
    platform: 'darwin',
    env: { FFMPEG_PATH: '/custom/ffmpeg' },
  }), ['/custom/ffmpeg']);
  assert.equal(result.available, false);
  assert.match(result.error, /configured executable failed/);
});

test('ImageMagick runtime resolution falls back from magick to ImageMagick 6 convert', () => {
  const calls = [];
  const executable = resolveImageMagickExecutable({
    platform: 'darwin',
    environment: {},
    run(command) {
      calls.push(command);
      if (command === 'magick') throw new Error('not found');
    },
  });

  assert.equal(executable, 'convert');
  assert.deepEqual(calls, ['magick', 'convert']);
});
