const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSitemapSettings } = require('../services/sitemapSettings');

test('sitemap settings persist an absolute directory path and normalize legacy sitemap filenames', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemap-settings-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const settingsFile = path.join(directory, 'settings.json');
  const settings = createSitemapSettings(settingsFile);

  assert.deepEqual(settings.get(), { path: '' });
  assert.deepEqual(settings.set(path.join(directory, 'sitemap.xml')), {
    path: directory,
  });
  assert.deepEqual(settings.get(), { path: directory });
  assert.deepEqual(settings.set(''), { path: '' });
  assert.deepEqual(settings.get(), { path: '' });
});

test('sitemap settings reject relative paths and allow an unset storage directory', () => {
  const settings = createSitemapSettings(path.join(os.tmpdir(), 'unused-sitemap-settings.json'));

  assert.throws(() => settings.set('sitemap.xml'), /absolute directory path/);
  assert.deepEqual(settings.set('  '), { path: '' });
});
