const fs = require('node:fs');
const path = require('node:path');

function isExecutable(filePath, platform, fileSystem) {
  try {
    if (!fileSystem.statSync(filePath).isFile()) return false;
    if (platform === 'win32') return true;
    fileSystem.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

function resolveCommand(command, pathValue, platform, fileSystem) {
  if (!command) return null;

  const hasPathSeparator = command.includes('/') || command.includes('\\');
  if (path.isAbsolute(command) || path.win32.isAbsolute(command) || hasPathSeparator) {
    return isExecutable(command, platform, fileSystem) ? command : null;
  }

  for (const directory of String(pathValue || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    if (isExecutable(candidate, platform, fileSystem)) return candidate;
  }
  return null;
}

function resolveGhostscriptExecutable({
  configuredPath,
  environment = process.env,
  platform = process.platform,
  pathValue = environment.PATH,
  fileSystem = fs,
} = {}) {
  const explicitPath = String(environment.GHOSTSCRIPT_PATH || '').trim();
  if (explicitPath) {
    const resolvedExplicitPath = resolveCommand(explicitPath, pathValue, platform, fileSystem);
    if (!resolvedExplicitPath) {
      throw new Error(
        'GHOSTSCRIPT_PATH is set but is not an executable file. Set it to a valid Ghostscript executable.'
      );
    }
    return resolvedExplicitPath;
  }

  const resolvedConfiguredPath = resolveCommand(
    String(configuredPath || '').trim(),
    pathValue,
    platform,
    fileSystem
  );
  if (resolvedConfiguredPath) return resolvedConfiguredPath;

  const fallbackNames = platform === 'win32'
    ? ['gswin64c.exe', 'gswin32c.exe', 'gs.exe']
    : ['gs'];
  for (const name of fallbackNames) {
    const fallbackPath = resolveCommand(name, pathValue, platform, fileSystem);
    if (fallbackPath) return fallbackPath;
  }

  throw new Error(
    'Ghostscript is unavailable. Install it (on macOS, run `brew install ghostscript`) or set GHOSTSCRIPT_PATH to a valid executable.'
  );
}

module.exports = { resolveGhostscriptExecutable };
