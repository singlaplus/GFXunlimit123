const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  getToolCandidates,
  installMissingTools,
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

test('prefers the bundled FFmpeg binary when no explicit path is configured', () => {
  const bundledPath = path.join('backend', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
  assert.equal(
    getToolCandidates('ffmpeg', {
      platform: 'win32',
      env: {},
      bundledFfmpegPath: bundledPath,
    })[0],
    bundledPath
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

test('discovers FFmpeg installed by WinGet when its PATH entry is not loaded yet', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winget-ffmpeg-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(
    root,
    'Microsoft', 'WinGet', 'Packages',
    'Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe',
    'ffmpeg-7.1.1-full_build',
    'bin', 'ffmpeg.exe'
  );
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, '');

  const options = { platform: 'win32', env: { LOCALAPPDATA: root } };
  assert.ok(getToolCandidates('ffmpeg', options).includes(executable));

  const result = probeTool('ffmpeg', {
    ...options,
    run(command, args) {
      if (command !== executable) throw new Error('not on PATH');
      return args[0] === '-version' ? 'ffmpeg version 7.1.1' : Buffer.from('png');
    },
  });
  assert.equal(result.available, true);
  assert.equal(result.command, executable);
  assert.equal(result.version, '7.1.1');
});

test('leaves installed FFmpeg untouched when WinGet reports no upgrade', () => {
  const calls = [];
  installMissingTools(['ffmpeg'], 'win32', {
    commandExistsFn: (command) => command === 'winget',
    runInstallerFn(command, args) {
      calls.push({ command, args });
      if (calls.length === 1) {
        const error = new Error('No available upgrade found');
        error.exitCode = 2316632107;
        throw error;
      }
    },
  });

  assert.deepEqual(calls.map(({ args }) => args[0]), ['install']);
  assert.ok(calls[0].args.includes('Gyan.FFmpeg.Shared'));
  assert.ok(!calls[0].args.includes('--force'));
});

test('force-installs broken FFmpeg without uninstalling it first', () => {
  const calls = [];
  installMissingTools([], 'win32', {
    reinstall: ['ffmpeg'],
    commandExistsFn: (command) => command === 'winget',
    runInstallerFn(command, args) {
      calls.push({ command, args });
    },
  });

  assert.deepEqual(calls.map(({ args }) => args[0]), ['install']);
  assert.ok(calls[0].args.includes('Gyan.FFmpeg.Shared'));
  assert.ok(calls[0].args.includes('--force'));
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
