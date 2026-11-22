const { execFileSync } = require('node:child_process');
const { getWindowsToolPaths } = require('../services/windowsToolPaths');

function resolveImageMagickExecutable({
  configuredPath,
  environment = process.env,
  platform = process.platform,
  run = execFileSync,
} = {}) {
  const explicitPath = String(environment.IMAGEMAGICK_PATH || '').trim();
  if (explicitPath) {
    try {
      run(explicitPath, ['-version'], { stdio: 'ignore', timeout: 15000, windowsHide: true });
      return explicitPath;
    } catch (error) {
      throw new Error(`IMAGEMAGICK_PATH could not run: ${error.message}`);
    }
  }

  const candidates = platform === 'win32'
    ? [configuredPath, 'magick', ...getWindowsToolPaths('imagemagick', environment)]
    : [configuredPath, 'magick', 'convert'];
  let lastError;
  for (const candidate of [...new Set(candidates.map((value) => String(value || '').trim()).filter(Boolean))]) {
    try {
      run(candidate, ['-version'], { stdio: 'ignore', timeout: 15000, windowsHide: true });
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`ImageMagick is unavailable${lastError ? `: ${lastError.message}` : ''}`);
}

module.exports = { resolveImageMagickExecutable };
