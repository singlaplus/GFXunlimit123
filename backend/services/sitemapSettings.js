const fs = require('node:fs');
const path = require('node:path');

const SETTINGS_FILE = path.join(__dirname, '..', 'settings', 'sitemap-settings.json');

function normalizeSitemapPath(sitemapPath) {
  if (typeof sitemapPath !== 'string') {
    throw new TypeError('Sitemap path must be an absolute directory path.');
  }
  const normalizedPath = sitemapPath.trim();
  if (!normalizedPath) return '';
  if (normalizedPath.includes('\0') || !path.isAbsolute(normalizedPath)) {
    throw new TypeError('Sitemap path must be an absolute directory path.');
  }
  const resolvedPath = path.resolve(normalizedPath);
  return path.basename(resolvedPath).toLowerCase() === 'sitemap.xml'
    ? path.dirname(resolvedPath)
    : resolvedPath;
}

function createSitemapSettings(filePath = SETTINGS_FILE) {
  return {
    get() {
      try {
        const settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { path: normalizeSitemapPath(settings.path) };
      } catch (error) {
        if (error.code === 'ENOENT') return { path: '' };
        throw error;
      }
    },
    set(sitemapPath) {
      const settings = { path: normalizeSitemapPath(sitemapPath) };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporaryPath, filePath);
      return settings;
    },
  };
}

module.exports = { createSitemapSettings, ...createSitemapSettings() };
