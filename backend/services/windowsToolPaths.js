const fs = require('node:fs');
const path = require('node:path');

const KNOWN_PATHS = {
  ghostscript: [
    'C:\\Program Files\\gs\\gs10.08.0\\bin\\gswin64c.exe',
    'C:\\Program Files\\gs\\gs10.01.2\\bin\\gswin64c.exe',
    'C:\\Program Files\\gs\\gs10.00.0\\bin\\gswin64c.exe',
    'C:\\Program Files (x86)\\gs\\gs10.01.2\\bin\\gswin64c.exe',
    'C:\\Program Files (x86)\\gs\\gs10.00.0\\bin\\gswin64c.exe',
  ],
  imagemagick: [
    'C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe',
    'C:\\Program Files\\ImageMagick-7.1.0-Q16-HDRI\\magick.exe',
    'C:\\Program Files (x86)\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe',
    'C:\\Program Files (x86)\\ImageMagick-7.1.0-Q16-HDRI\\magick.exe',
  ],
  redis: [
    'C:\\Program Files\\Redis\\redis-cli.exe',
    'C:\\Program Files\\Memurai\\bin\\redis-cli.exe',
  ],
};

function getWindowsToolPaths(toolName, environment = process.env, fileSystem = fs) {
  const programDirectories = [
    environment.ProgramFiles,
    environment['ProgramFiles(x86)'],
    environment.LOCALAPPDATA,
  ].filter(Boolean);

  if (toolName === 'ghostscript') {
    const candidates = [...KNOWN_PATHS.ghostscript];
    for (const programDirectory of programDirectories.slice(0, 2)) {
      const installRoot = path.join(programDirectory, 'gs');
      try {
        for (const versionDirectory of fileSystem.readdirSync(installRoot)) {
          candidates.push(path.join(installRoot, versionDirectory, 'bin', 'gswin64c.exe'));
          candidates.push(path.join(installRoot, versionDirectory, 'bin', 'gswin32c.exe'));
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
    }
    return candidates;
  }

  if (toolName === 'imagemagick') {
    const candidates = [...KNOWN_PATHS.imagemagick];
    for (const programDirectory of programDirectories) {
      try {
        for (const installDirectory of fileSystem.readdirSync(programDirectory)) {
          if (/^ImageMagick/i.test(installDirectory)) {
            candidates.push(path.join(programDirectory, installDirectory, 'magick.exe'));
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
    }
    return candidates;
  }

  if (toolName === 'postgresql') {
    const candidates = [];
    for (const programDirectory of programDirectories.slice(0, 2)) {
      const installRoot = path.join(programDirectory, 'PostgreSQL');
      try {
        for (const versionDirectory of fileSystem.readdirSync(installRoot)) {
          candidates.push(path.join(installRoot, versionDirectory, 'bin', 'psql.exe'));
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
    }
    return candidates;
  }

  if (toolName === 'redis') {
    return [
      ...KNOWN_PATHS.redis,
      ...programDirectories.flatMap((directory) => [
        path.join(directory, 'Redis', 'redis-cli.exe'),
        path.join(directory, 'Memurai', 'bin', 'redis-cli.exe'),
      ]),
    ];
  }

  return [];
}

function findWindowsToolExecutable(toolName, environment = process.env, fileSystem = fs) {
  return getWindowsToolPaths(toolName, environment, fileSystem)
    .find((candidate) => fileSystem.existsSync(candidate)) || null;
}

module.exports = { findWindowsToolExecutable, getWindowsToolPaths };
