const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseUploadLocks } = require('../services/uploadLockCleanup');

test('destroys the dedicated client and releases the contributor lock when advisory unlock rejects', async () => {
  const events = [];
  const errors = [];
  const unlockError = new Error('unlock failed');
  const client = {
    query: async (sql, values) => {
      events.push(['unlock', sql, values]);
      throw unlockError;
    },
    release: (error) => events.push(['client release', error]),
  };

  await releaseUploadLocks({
    client,
    advisoryLockAcquired: true,
    lockKey: 'upload-lock-key',
    requestId: 'request-1',
    releaseContributorLock: () => events.push(['contributor release']),
    logger: { error: (...args) => errors.push(args) },
  });

  assert.deepEqual(events, [
    ['unlock', 'SELECT pg_advisory_unlock(hashtext($1))', ['upload-lock-key']],
    ['client release', unlockError],
    ['contributor release'],
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /upload idempotency lock request-1/);
});

test('releases both locks when advisory unlock throws synchronously', async () => {
  const events = [];
  const errors = [];
  const client = {
    query: () => {
      events.push('unlock');
      throw new Error('synchronous unlock failure');
    },
    release: (error) => events.push(['client release with error', error]),
  };

  await releaseUploadLocks({
    client,
    advisoryLockAcquired: true,
    lockKey: 'upload-lock-key',
    requestId: 'request-sync',
    releaseContributorLock: () => events.push('contributor release'),
    logger: { error: (...args) => errors.push(args) },
  });

  assert.equal(events[0], 'unlock');
  assert.equal(events[1][0], 'client release with error');
  assert.equal(events[1][1].message, 'synchronous unlock failure');
  assert.equal(events[2], 'contributor release');
  assert.equal(errors.length, 1);
});

test('releases the dedicated client normally after successful advisory unlock', async () => {
  const events = [];
  const client = {
    query: async (sql, values) => events.push(['unlock', sql, values]),
    release: (...args) => events.push(['client release', ...args]),
  };

  await releaseUploadLocks({
    client,
    advisoryLockAcquired: true,
    lockKey: 'upload-lock-key',
    requestId: 'request-success',
    releaseContributorLock: () => events.push(['contributor release']),
    logger: { error: assert.fail },
  });

  assert.deepEqual(events, [
    ['unlock', 'SELECT pg_advisory_unlock(hashtext($1))', ['upload-lock-key']],
    ['client release'],
    ['contributor release'],
  ]);
});

test('releases the contributor lock even when dedicated client release throws', async () => {
  const events = [];
  const errors = [];
  const client = {
    query: () => events.push(['unlock']),
    release: () => {
      events.push(['client release']);
      throw new Error('client release failed');
    },
  };

  await releaseUploadLocks({
    client,
    advisoryLockAcquired: true,
    lockKey: 'upload-lock-key',
    requestId: 'request-2',
    releaseContributorLock: () => events.push(['contributor release']),
    logger: { error: (...args) => errors.push(args) },
  });

  assert.deepEqual(events, [['unlock'], ['client release'], ['contributor release']]);
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /upload database client request-2/);
});

test('releases a connected client without attempting unlock if lock acquisition failed', async () => {
  const events = [];
  await releaseUploadLocks({
    client: { release: () => events.push('client release') },
    advisoryLockAcquired: false,
    lockKey: 'upload-lock-key',
    requestId: 'request-3',
    releaseContributorLock: () => events.push('contributor release'),
    logger: { error: assert.fail },
  });
  assert.deepEqual(events, ['client release', 'contributor release']);
});
