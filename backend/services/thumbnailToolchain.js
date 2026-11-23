const fs = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const { getWindowsToolPaths } = require('./windowsToolPaths');

const TOOL_DEFINITIONS = {
  ffmpeg: {
    envKey: 'FFMPEG_PATH',
    commands: ['ffmpeg'],
    versionArgs: ['-version'],
    smokeArgs: [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=0.1',
      '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-',
    ],
    packages: { darwin: 'ffmpeg', linux: 'ffmpeg' },
    wingetId: 'Gyan.FFmpeg.Shared',
    chocoId: 'ffmpeg-shared',
  },
  ghostscript: {
    envKey: 'GHOSTSCRIPT_PATH',
    commands: ['gs'],
    versionArgs: ['--version'],
    smokeArgs: ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=nullpage', '-c', 'quit'],
    packages: { darwin: 'ghostscript', linux: 'ghostscript' },
    wingetId: 'ArtifexSoftware.GhostScript',
    chocoId: 'ghostscript',
  },
  imagemagick: {
    envKey: 'IMAGEMAGICK_PATH',
    commands: ['magick', 'convert'],
    versionArgs: ['-version'],
    smokeArgs: ['-size', '1x1', 'xc:black', 'png:-'],
    packages: { darwin: 'imagemagick', linux: 'imagemagick' },
    wingetId: 'ImageMagick.ImageMagick',
    chocoId: 'imagemagick',
  },
};

function getToolCandidates(toolName, {
  platform = process.platform,
  env = process.env,
  bundledFfmpegPath,
} = {}) {
  const definition = TOOL_DEFINITIONS[toolName];
  if (!definition) throw new Error(`Unknown thumbnail tool: ${toolName}`);

  const configuredPath = String(env[definition.envKey] || '').trim();
  if (configuredPath) return [configuredPath];

  const resolvedBundledFfmpegPath = toolName === 'ffmpeg'
    ? bundledFfmpegPath === undefined
      ? getBundledFfmpegPath()
      : bundledFfmpegPath
    : null;
  if (platform === 'win32' && toolName === 'ghostscript') {
    return [...new Set([
      'gswin64c',
      'gswin32c',
      ...getWindowsToolPaths('ghostscript', env),
    ])];
  }
  if (platform === 'win32' && toolName === 'imagemagick') {
    return [...new Set(['magick', ...getWindowsToolPaths('imagemagick', env)])];
  }
  if (platform === 'win32' && toolName === 'ffmpeg') {
    return [...new Set([
      resolvedBundledFfmpegPath,
      'ffmpeg',
      ...getWindowsToolPaths('ffmpeg', env),
    ].filter(Boolean))];
  }
  return [...new Set([
    resolvedBundledFfmpegPath,
    ...definition.commands,
  ].filter(Boolean))];
}

function defaultRun(command, args, options = {}) {
  return execFileSync(command, args, {
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
}

function probeTool(toolName, options = {}) {
  const { run = defaultRun } = options;
  const definition = TOOL_DEFINITIONS[toolName];
  if (!definition) throw new Error(`Unknown thumbnail tool: ${toolName}`);

  let lastError = null;
  const candidates = getToolCandidates(toolName, options);
  for (const command of candidates) {
    let versionOutput;
    try {
      versionOutput = run(command, definition.versionArgs, { encoding: 'utf8' });
    } catch (error) {
      lastError = error;
      continue;
    }

    try {
      const versionText = String(versionOutput || '').trim();
      const smokeOutput = run(command, definition.smokeArgs);
      if (toolName === 'ffmpeg' || toolName === 'imagemagick') {
        if (!Buffer.isBuffer(smokeOutput) || smokeOutput.length === 0) {
          throw new Error('Smoke test produced no image output');
        }
      }
      return {
        available: true,
        command,
        version: toolName === 'ffmpeg'
          ? versionText.match(/ffmpeg version ([^\s]+)/i)?.[1] || 'unknown'
          : versionText.split(/\r?\n/)[0] || 'unknown',
        broken: false,
      };
    } catch (error) {
      return {
        available: false,
        command,
        version: String(versionOutput || '').trim().split(/\r?\n/)[0] || 'unknown',
        broken: true,
        error: error.message,
      };
    }
  }
  return {
    available: false,
    command: null,
    version: null,
    broken: false,
    error: lastError?.message || 'Executable not found',
  };
}

function commandExists(command, platform = process.platform) {
  const lookup = platform === 'win32' ? 'where.exe' : 'which';
  return spawnSync(lookup, [command], { stdio: 'ignore', windowsHide: true }).status === 0;
}

function getBundledFfmpegPath() {
  const bundledPath = require('ffmpeg-static');
  return typeof bundledPath === 'string' && bundledPath.trim() && fs.existsSync(bundledPath)
    ? bundledPath
    : null;
}

function runInstaller(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) {
    const error = new Error(
      `${command} ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ` with exit code ${result.status}`}`
    );
    error.exitCode = result.status;
    throw error;
  }
}

function installMissingTools(toolNames, platform = process.platform, {
  reinstall = [],
  runInstallerFn = runInstaller,
  commandExistsFn = commandExists,
} = {}) {
  if (toolNames.length === 0 && reinstall.length === 0) return;

  if (platform === 'darwin') {
    if (!commandExists('brew', platform)) {
      throw new Error('Homebrew is required to install missing thumbnail tools. Install Homebrew, then rerun npm install.');
    }
    if (toolNames.length) {
      runInstallerFn('brew', ['install', ...toolNames.map((name) => TOOL_DEFINITIONS[name].packages.darwin)]);
    }
    if (reinstall.length) {
      runInstallerFn('brew', ['reinstall', ...reinstall.map((name) => TOOL_DEFINITIONS[name].packages.darwin)]);
    }
    return;
  }

  if (platform === 'linux') {
    const packageManagers = ['apt-get', 'dnf', 'yum'];
    const manager = packageManagers.find((candidate) => commandExistsFn(candidate, platform));
    if (!manager) {
      throw new Error('No supported Linux package manager (apt-get, dnf, or yum) was found.');
    }
    const needsSudo = typeof process.getuid === 'function' && process.getuid() !== 0;
    const command = needsSudo ? 'sudo' : manager;
    const prefix = needsSudo ? ['-A', manager] : [];
    if (manager === 'apt-get') runInstallerFn(command, [...prefix, 'update']);
    if (toolNames.length) {
      runInstallerFn(command, [
        ...prefix,
        'install',
        '-y',
        ...toolNames.map((name) => TOOL_DEFINITIONS[name].packages.linux),
      ]);
    }
    if (reinstall.length) {
      runInstallerFn(command, [
        ...prefix,
        manager === 'apt-get' ? 'install' : 'reinstall',
        ...(manager === 'apt-get' ? ['--reinstall'] : []),
        '-y',
        ...reinstall.map((name) => TOOL_DEFINITIONS[name].packages.linux),
      ]);
    }
    return;
  }

  if (platform === 'win32') {
    const manager = commandExistsFn('winget', platform)
      ? 'winget'
      : commandExistsFn('choco', platform)
        ? 'choco'
        : null;
    if (!manager) {
      throw new Error('winget or Chocolatey is required to install missing thumbnail tools.');
    }
    const installWithManager = (toolName, repair) => {
      const definition = TOOL_DEFINITIONS[toolName];
      if (manager === 'winget') {
        const installArgs = [
          'install',
          '--id', definition.wingetId,
          '--exact',
          '--accept-source-agreements',
          '--accept-package-agreements',
          '--silent',
        ];
        const forceInstallWithWinget = () => {
          runInstallerFn('winget', [...installArgs, '--force']);
        };
        if (toolName === 'ffmpeg' && repair) {
          forceInstallWithWinget();
          return;
        }
        try {
          runInstallerFn('winget', installArgs);
        } catch (error) {
          const noUpgradeAvailable = (Number(error.exitCode) >>> 0) === 2316632107;
          if (toolName !== 'ffmpeg' || !noUpgradeAvailable) throw error;
        }
      } else {
        runInstallerFn('choco', [
          repair ? 'upgrade' : 'install',
          definition.chocoId,
          '-y',
          '--no-progress',
          ...(repair ? ['--force'] : []),
        ]);
      }
    };
    for (const toolName of toolNames) installWithManager(toolName, false);
    for (const toolName of reinstall) installWithManager(toolName, true);
    return;
  }

  throw new Error(`Automatic thumbnail-tool installation is unsupported on ${platform}.`);
}

async function verifyNodeProcessors() {
  const sharp = require('sharp');
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: '#000000' },
  }).png().toBuffer();
  const metadata = await sharp(png).metadata();
  if (metadata.width !== 1 || metadata.height !== 1) {
    throw new Error('Sharp smoke test returned an unexpected image size');
  }

  const PSD = require('psd.js');
  if (typeof PSD.open !== 'function') {
    throw new Error('The installed psd.js library does not expose PSD.open()');
  }

  return {
    sharp: require('sharp/package.json').version,
    psd_processor: require('psd.js/package.json').version || 'unknown',
    ai_processor: 'built-in',
  };
}

async function verifyThumbnailToolchain({
  platform = process.platform,
  env = process.env,
  run = defaultRun,
  installer = installMissingTools,
} = {}) {
  let tools = Object.fromEntries(
    Object.keys(TOOL_DEFINITIONS).map((name) => [
      name,
      probeTool(name, { platform, env, run }),
    ])
  );
  const configuredButUnavailable = Object.entries(tools)
    .filter(([name, result]) => !result.available && env[TOOL_DEFINITIONS[name].envKey])
    .map(([name, result]) => `${name} (${TOOL_DEFINITIONS[name].envKey}): ${result.error}`);
  if (configuredButUnavailable.length) {
    throw new Error(`Configured thumbnail tools are not working:\n${configuredButUnavailable.join('\n')}`);
  }

  const unavailable = Object.entries(tools)
    .filter(([, result]) => !result.available && !result.broken)
    .map(([name]) => name);
  const broken = Object.entries(tools)
    .filter(([, result]) => !result.available && result.broken)
    .map(([name]) => name);

  if (unavailable.length || broken.length) {
    installer(unavailable, platform, { reinstall: broken });
    tools = Object.fromEntries(
      Object.keys(TOOL_DEFINITIONS).map((name) => [
        name,
        probeTool(name, { platform, env, run }),
      ])
    );
  }

  const stillUnavailable = Object.entries(tools)
    .filter(([, result]) => !result.available)
    .map(([name, result]) => `${name}: ${result.error}`);
  if (stillUnavailable.length) {
    throw new Error(`Thumbnail tools failed their version/smoke checks:\n${stillUnavailable.join('\n')}`);
  }

  const processors = await verifyNodeProcessors();
  return { tools, processors };
}

module.exports = {
  TOOL_DEFINITIONS,
  getToolCandidates,
  probeTool,
  verifyNodeProcessors,
  verifyThumbnailToolchain,
  installMissingTools,
};
