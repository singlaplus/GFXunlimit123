'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { writeJsonAtomically } = require('../utils/atomicJsonFile');

test('atomic JSON persistence retries transient Windows rename failures and leaves valid metadata', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'stocksite-atomic-json-'));
  const destination = path.join(temporary, 'job.json');
  const temporaryFiles = [];
  let renameAttempts = 0;
  const rename = async (source, target) => {
    renameAttempts += 1;
    temporaryFiles.push(source);
    if (renameAttempts === 1) {
      const error = new Error('sharing violation');
      error.code = 'EPERM';
      throw error;
    }
    return fs.rename(source, target);
  };

  try {
    const previous = { id: 'job-1', status: 'RUNNING' };
    const updated = { id: 'job-1', status: 'READY', artifacts: [{ id: 'manifest' }] };
    await fs.writeFile(destination, JSON.stringify(previous));
    await writeJsonAtomically(destination, updated, { platform: 'win32', rename });

    assert.equal(renameAttempts, 2);
    assert.deepEqual(JSON.parse(await fs.readFile(destination, 'utf8')), updated);
    await assert.rejects(fs.access(temporaryFiles[0]), { code: 'ENOENT' });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('atomic JSON persistence does not retry permanent errors or replace existing metadata', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'stocksite-atomic-json-'));
  const destination = path.join(temporary, 'job.json');
  let renameAttempts = 0;
  const rename = async () => {
    renameAttempts += 1;
    const error = new Error('permission denied');
    error.code = 'EIO';
    throw error;
  };

  try {
    const previous = { id: 'job-2', status: 'RUNNING' };
    await fs.writeFile(destination, JSON.stringify(previous));
    await assert.rejects(
      writeJsonAtomically(destination, { id: 'job-2', status: 'READY' }, { platform: 'win32', rename }),
      { code: 'EIO' }
    );

    assert.equal(renameAttempts, 1);
    assert.deepEqual(JSON.parse(await fs.readFile(destination, 'utf8')), previous);
    assert.deepEqual(await fs.readdir(temporary), ['job.json']);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('atomic JSON persistence bounds retries and preserves the prior file when Windows keeps the file locked', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'stocksite-atomic-json-'));
  const destination = path.join(temporary, 'job.json');
  let renameAttempts = 0;
  const rename = async () => {
    renameAttempts += 1;
    const error = new Error('sharing violation');
    error.code = 'EPERM';
    throw error;
  };

  try {
    const previous = { id: 'job-3', status: 'RUNNING' };
    await fs.writeFile(destination, JSON.stringify(previous));
    await assert.rejects(
      writeJsonAtomically(destination, { id: 'job-3', status: 'READY' }, { platform: 'win32', rename }),
      { code: 'EPERM' }
    );

    assert.equal(renameAttempts, 5);
    assert.deepEqual(JSON.parse(await fs.readFile(destination, 'utf8')), previous);
    assert.deepEqual(await fs.readdir(temporary), ['job.json']);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
