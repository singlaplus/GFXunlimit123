const { isIP } = require('node:net');

function isLocalDatabaseHost(host) {
  let normalizedHost = String(host || 'localhost').trim().toLowerCase();
  if (normalizedHost.startsWith('[') && normalizedHost.endsWith(']')) {
    normalizedHost = normalizedHost.slice(1, -1);
  }
  const isLoopbackIpv4 = isIP(normalizedHost) === 4 && normalizedHost.startsWith('127.');
  return normalizedHost === 'localhost'
    || normalizedHost === '.'
    || normalizedHost === '::1'
    || normalizedHost === '0:0:0:0:0:0:0:1'
    || isLoopbackIpv4
    || (normalizedHost.startsWith('/') && isIP(normalizedHost) === 0);
}

async function resolvePostgresDataDirectory(poolRef, {
  host,
  environment = process.env,
} = {}) {
  const localDatabase = isLocalDatabaseHost(host);
  const lookupErrors = [];
  const queries = [
    `SELECT setting AS data_directory
     FROM pg_settings
     WHERE name = 'data_directory'`,
    `SELECT current_setting('data_directory', true) AS data_directory`
  ];

  for (const query of queries) {
    try {
      const result = await poolRef.query(query);
      const dataDirectory = String(result.rows?.[0]?.data_directory || '').trim();
      if (dataDirectory) {
        return {
          dataDirectory,
          source: 'postgres',
          localDatabase,
          error: localDatabase
            ? ''
            : 'PostgreSQL reported its data directory, but the database is on a different host. Filesystem size and free space must be collected on the database host.'
        };
      }
    } catch (error) {
      lookupErrors.push(error);
    }
  }

  const configuredDirectory = localDatabase
    ? String(environment.POSTGRES_DATA_DIRECTORY || environment.PGDATA || '').trim()
    : '';
  if (configuredDirectory) {
    return {
      dataDirectory: configuredDirectory,
      source: 'configured',
      localDatabase,
      error: 'PostgreSQL did not reveal its data directory; showing the configured path. Grant the application database role pg_read_all_settings to detect the active path automatically.'
    };
  }

  return {
    dataDirectory: '',
    source: 'unavailable',
    localDatabase,
    error: lookupErrors.length
      ? 'PostgreSQL hides its data directory from the application database role. Grant pg_read_all_settings to that role to detect the actual path.'
      : 'PostgreSQL did not return its data directory. Grant pg_read_all_settings to the application database role to detect the actual path.'
  };
}

module.exports = { isLocalDatabaseHost, resolvePostgresDataDirectory };
