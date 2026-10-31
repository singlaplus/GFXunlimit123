const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildStartupPlan } = require('../startup/bootstrap');
const {
  findWindowsToolExecutable,
  getWindowsToolPaths,
} = require('../services/windowsToolPaths');

test('buildStartupPlan installs missing Windows image tools but does not install DB or cache services', () => {
  const plan = buildStartupPlan({
    platform: 'win32',
    nodeModulesPresent: true,
    ghostscriptDetected: false,
    imagemagickDetected: false,
    postgresqlDetected: false,
    redisDetected: false,
    sharpDetected: true,
    psdLibraryDetected: true,
  });

  assert.equal(plan.platform, 'win32');
  assert.deepEqual(plan.missingSystemTools, [
    'Ghostscript',
    'ImageMagick',
  ]);
  assert.ok(plan.actions.some((action) => action.type === 'install-ghostscript'));
  assert.ok(plan.actions.some((action) => action.type === 'install-imagemagick'));
  assert.equal(plan.actions.some((action) => action.type === 'install-postgresql'), false);
  assert.equal(plan.actions.some((action) => action.type === 'install-redis'), false);
  assert.ok(plan.actions.some((action) => action.type === 'start-server'));
});

test('buildStartupPlan does not reinstall detected Windows image tools', () => {
  const plan = buildStartupPlan({
    platform: 'win32',
    nodeModulesPresent: true,
    ghostscriptDetected: true,
    imagemagickDetected: true,
    postgresqlDetected: false,
    redisDetected: false,
    sharpDetected: true,
    psdLibraryDetected: true,
  });

  assert.equal(plan.actions.some((action) => action.type === 'install-ghostscript'), false);
  assert.equal(plan.actions.some((action) => action.type === 'install-imagemagick'), false);
  assert.equal(plan.actions.some((action) => action.type === 'install-redis'), false);
});

test('buildStartupPlan still installs missing backend npm packages', () => {
  const plan = buildStartupPlan({
    platform: 'win32',
    nodeModulesPresent: false,
    ghostscriptDetected: true,
    imagemagickDetected: true,
    postgresqlDetected: true,
    redisDetected: true,
    sharpDetected: true,
    psdLibraryDetected: true,
  });

  assert.ok(plan.actions.some((action) => action.type === 'npm-install'));
});

test('Windows tool detection searches versioned install directories', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-tool-paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const programFiles = path.join(root, 'Program Files');
  fs.mkdirSync(path.join(programFiles, 'gs', 'gs10.08.0'), { recursive: true });
  fs.mkdirSync(path.join(programFiles, 'ImageMagick-7.1.2-Q16'), { recursive: true });
  fs.mkdirSync(path.join(programFiles, 'PostgreSQL', '18'), { recursive: true });

  assert.ok(getWindowsToolPaths('ghostscript', { ProgramFiles: programFiles })
    .includes(path.join(programFiles, 'gs', 'gs10.08.0', 'bin', 'gswin64c.exe')));
  assert.ok(getWindowsToolPaths('imagemagick', { ProgramFiles: programFiles })
    .includes(path.join(programFiles, 'ImageMagick-7.1.2-Q16', 'magick.exe')));
  assert.ok(getWindowsToolPaths('postgresql', { ProgramFiles: programFiles })
    .includes(path.join(programFiles, 'PostgreSQL', '18', 'bin', 'psql.exe')));
});

test('Windows tool detection selects an installed versioned executable', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-installed-tool-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, 'gs', 'gs10.08.0', 'bin', 'gswin64c.exe');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, '');

  assert.equal(
    findWindowsToolExecutable('ghostscript', { ProgramFiles: root }),
    executable
  );
});
