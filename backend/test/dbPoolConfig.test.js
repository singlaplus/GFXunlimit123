const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPoolConfig } = require('../db');

test('default pool config stays conservative for local PostgreSQL limits', () => {
  const config = buildPoolConfig({});
  assert.equal(config.max, 4, 'Default DB pool size should stay at 4 connections');
  assert.equal(config.idleTimeoutMillis, 15000, 'Idle timeout should match the local safe default');
});

test('environment overrides can still raise the pool size when needed', () => {
  const config = buildPoolConfig({ DB_POOL_MAX: '10' });
  assert.equal(config.max, 10, 'Explicit DB_POOL_MAX overrides should still work');
});
