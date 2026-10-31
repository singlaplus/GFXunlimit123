const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  isLocalDatabaseHost,
  resolvePostgresDataDirectory,
} = require('../services/postgresDataDirectory');

test('identifies loopback and local socket database hosts', () => {
  assert.equal(isLocalDatabaseHost('localhost'), true);
  assert.equal(isLocalDatabaseHost('127.0.0.1'), true);
  assert.equal(isLocalDatabaseHost('127.4.5.6'), true);
  assert.equal(isLocalDatabaseHost('::1'), true);
  assert.equal(isLocalDatabaseHost('/var/run/postgresql'), true);
  assert.equal(isLocalDatabaseHost('127.999.0.1'), false);
  assert.equal(isLocalDatabaseHost('db.example.com'), false);
});

test('prefers the data directory reported by PostgreSQL', async () => {
  const pool = {
    query: async () => ({ rows: [{ data_directory: '/var/lib/postgresql/data' }] }),
  };

  const info = await resolvePostgresDataDirectory(pool, { host: 'localhost' });

  assert.equal(info.dataDirectory, '/var/lib/postgresql/data');
  assert.equal(info.source, 'postgres');
  assert.equal(info.localDatabase, true);
  assert.equal(info.error, '');
});

test('retries current_setting if pg_settings cannot be queried', async () => {
  let callCount = 0;
  const pool = {
    query: async () => {
      callCount += 1;
      if (callCount === 1) throw new Error('permission denied');
      return { rows: [{ data_directory: '/srv/postgres/data' }] };
    },
  };

  const info = await resolvePostgresDataDirectory(pool, { host: '127.0.0.1' });

  assert.equal(callCount, 2);
  assert.equal(info.dataDirectory, '/srv/postgres/data');
  assert.equal(info.source, 'postgres');
});

test('marks a PostgreSQL-reported path on a remote database as non-local', async () => {
  const pool = {
    query: async () => ({ rows: [{ data_directory: '/var/lib/postgresql/data' }] }),
  };

  const info = await resolvePostgresDataDirectory(pool, { host: 'db.example.com' });

  assert.equal(info.dataDirectory, '/var/lib/postgresql/data');
  assert.equal(info.source, 'postgres');
  assert.equal(info.localDatabase, false);
  assert.match(info.error, /different host/);
});

test('does not use the backend PGDATA path for a remote database', async () => {
  const pool = { query: async () => ({ rows: [] }) };

  const info = await resolvePostgresDataDirectory(pool, {
    host: 'db.example.com',
    environment: { PGDATA: '/var/lib/postgresql/data' },
  });

  assert.equal(info.dataDirectory, '');
  assert.equal(info.source, 'unavailable');
  assert.equal(info.localDatabase, false);
  assert.match(info.error, /pg_read_all_settings/);
});

test('uses configured local path only as a clearly labeled fallback', async () => {
  const pool = { query: async () => ({ rows: [] }) };

  const info = await resolvePostgresDataDirectory(pool, {
    host: 'localhost',
    environment: { POSTGRES_DATA_DIRECTORY: '/configured/postgres/data' },
  });

  assert.equal(info.dataDirectory, '/configured/postgres/data');
  assert.equal(info.source, 'configured');
  assert.match(info.error, /configured path/);
});
