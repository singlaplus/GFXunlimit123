const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveGhostscriptExecutable } = require('../thumbnail-engine/ghostscript-path');

function createEnvironment(overrides = {}) {
  return {
    PATH: '',
    ...overrides,
  };
}

function createExecutable(directory, name) {
  const executablePath = path.join(directory, name);
  fs.writeFileSync(executablePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return executablePath;
}

test('Ghostscript resolution falls back from a stale Windows database path to gs on PATH', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-ghostscript-path-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const localGhostscript = createExecutable(directory, 'gs');

  assert.equal(resolveGhostscriptExecutable({
    configuredPath: 'C:\\Program Files\\gs\\gs10.08.0\\bin\\gswin64c.exe',
    environment: createEnvironment(),
    platform: 'darwin',
    pathValue: directory,
  }), localGhostscript);
});

test('Ghostscript resolution prefers an explicit valid override, then a valid configured executable', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-ghostscript-preferred-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configuredExecutable = createExecutable(directory, 'configured-gs');
  const pathFallback = createExecutable(directory, 'gs');

  assert.equal(resolveGhostscriptExecutable({
    configuredPath: configuredExecutable,
    environment: createEnvironment({ GHOSTSCRIPT_PATH: pathFallback }),
    platform: 'darwin',
    pathValue: directory,
  }), pathFallback);
  assert.equal(resolveGhostscriptExecutable({
    configuredPath: configuredExecutable,
    environment: createEnvironment(),
    platform: 'darwin',
    pathValue: directory,
  }), configuredExecutable);
});

test('invalid configured Ghostscript locations fail instead of being passed to the process', () => {
  const staleConfiguredPath = 'C:\\Program Files\\gs\\gs10.08.0\\bin\\gswin64c.exe';
  assert.throws(() => resolveGhostscriptExecutable({
    configuredPath: staleConfiguredPath,
    environment: createEnvironment(),
    platform: 'darwin',
  }), /Ghostscript is unavailable/);
});

test('Ghostscript resolution reports an actionable error when no executable is available', () => {
  assert.throws(
    () => resolveGhostscriptExecutable({
      configuredPath: 'C:\\missing\\gswin64c.exe',
      environment: createEnvironment(),
      platform: 'darwin',
      pathValue: '',
    }),
    /Ghostscript is unavailable.*brew install ghostscript.*GHOSTSCRIPT_PATH/
  );
});

test('Ghostscript resolution rejects an invalid explicit override clearly', () => {
  assert.throws(
    () => resolveGhostscriptExecutable({
      configuredPath: 'C:\\missing\\gswin64c.exe',
      environment: createEnvironment({ GHOSTSCRIPT_PATH: '/missing/gs' }),
      platform: 'darwin',
      pathValue: '',
    }),
    /GHOSTSCRIPT_PATH is set but is not an executable file/
  );
});
