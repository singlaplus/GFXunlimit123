const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStartupPlan } = require('../startup/bootstrap');

test('buildStartupPlan flags missing Windows runtime tools and package dependencies', () => {
  const plan = buildStartupPlan({
    platform: 'win32',
    nodeModulesPresent: false,
    ghostscriptDetected: false,
    imagemagickDetected: false,
    sharpDetected: false,
    psdLibraryDetected: false,
  });

  assert.equal(plan.platform, 'win32');
  assert.ok(plan.actions.some((action) => action.type === 'npm-install'));
  assert.ok(plan.actions.some((action) => action.type === 'install-ghostscript'));
  assert.ok(plan.actions.some((action) => action.type === 'install-imagemagick'));
  assert.ok(plan.actions.some((action) => action.type === 'start-server'));
});
