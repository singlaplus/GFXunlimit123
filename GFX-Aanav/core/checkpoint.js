const fs = require('fs');
const path = require('path');
const { git } = require('./diagnostics');
const { run, which, resolvePath, readEnv, describe } = require('./platform');

function ensureDirectories(root) {
  for (const name of ['checkpoints', 'backups', 'database', 'logs', 'reports']) fs.mkdirSync(path.join(root, name), { recursive: true });
}

function timestamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function listOfficial(root) { ensureDirectories(root); return fs.readdirSync(path.join(root, 'checkpoints')).filter(file => /^AANAV-.*\.json$/.test(file)).sort().reverse().map(file => JSON.parse(fs.readFileSync(path.join(root, 'checkpoints', file), 'utf8'))); }
function latestOfficial(root) { return listOfficial(root)[0] || null; }
function writeCheckpoint(root, data) { ensureDirectories(root); const file = path.join(root, 'checkpoints', `${data.checkpointId}.json`); fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`); return file; }

function configSnapshot(config) { return JSON.parse(JSON.stringify(config)); }

function majorVersion(version) {
  const match = String(version || '').match(/(?:PostgreSQL\s+)?(\d+)(?:\.\d+)?/i);
  return match ? Number(match[1]) : null;
}

function findPgDump(config, serverMajor) {
  const configured = config.database.pgDumpPath;
  const candidates = [];
  if (configured) candidates.push(resolvePath(process.cwd(), configured));
  if (serverMajor) {
    if (process.platform === 'darwin') candidates.push(`/opt/homebrew/opt/postgresql@${serverMajor}/bin/pg_dump`, `/usr/local/opt/postgresql@${serverMajor}/bin/pg_dump`);
    if (process.platform === 'linux') candidates.push(`/usr/lib/postgresql/${serverMajor}/bin/pg_dump`, `/usr/pgsql-${serverMajor}/bin/pg_dump`);
    if (process.platform === 'win32') candidates.push(`C:\\Program Files\\PostgreSQL\\${serverMajor}\\bin\\pg_dump.exe`, `C:\\Program Files (x86)\\PostgreSQL\\${serverMajor}\\bin\\pg_dump.exe`);
  }
  candidates.push(which(process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump'));
  for (const candidate of candidates.filter(Boolean)) {
    const version = run(candidate, ['--version'], { timeout: 30000 });
    if (version.ok && (!serverMajor || majorVersion(version.stdout) === serverMajor)) return { path: candidate, version: version.stdout };
  }
  return null;
}
function createDevelopmentStart(root, config, report) {
  const info = git(root); const id = `DEVSTART-${timestamp()}`;
  return writeCheckpoint(root, { checkpointId: id, type: 'development-start', status: 'KNOWN_GOOD', createdAt: new Date().toISOString(), platform: describe(), gitCommit: info.commit, gitBranch: info.branch, testResults: report, configuration: configSnapshot(config), storage: config.storage, version: config.version });
}

function databaseBackup(aanavRoot, projectRoot, config, id) {
  if (config.database.enabled === false) return { status: 'NOT CONFIGURED', path: null };
  const env = readEnv(projectRoot, ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']);
  const psql = which(process.platform === 'win32' ? 'psql.exe' : 'psql');
  if (!psql) return { status: 'FAILED', path: null, detail: 'psql was not found; cannot verify PostgreSQL server version.' };
  const server = run(psql, ['-w', '-h', env.DB_HOST || config.database.defaultHost, '-p', env.DB_PORT || String(config.database.defaultPort), '-U', env.DB_USER || config.database.defaultUser, '-d', env.DB_NAME || config.database.defaultName, '-tAc', 'SHOW server_version;'], { cwd: projectRoot, env: env.DB_PASSWORD ? { PGPASSWORD: env.DB_PASSWORD } : {}, timeout: 30000 });
  if (!server.ok) return { status: 'FAILED', path: null, detail: `Could not read PostgreSQL server version: ${server.stderr || server.error}` };
  const serverMajor = majorVersion(server.stdout);
  const pgDump = findPgDump(config, serverMajor);
  if (!pgDump) return { status: 'FAILED', path: null, detail: `No pg_dump matching PostgreSQL server major version ${serverMajor || 'unknown'} was found. Install PostgreSQL client ${serverMajor} or set database.pgDumpPath.` };
  const target = path.join(aanavRoot, 'database', `${id}-${env.DB_NAME || config.database.defaultName}.backup`);
  const result = run(pgDump.path, ['-w', '-Fc', '-h', env.DB_HOST || config.database.defaultHost, '-p', env.DB_PORT || String(config.database.defaultPort), '-U', env.DB_USER || config.database.defaultUser, '-d', env.DB_NAME || config.database.defaultName, '-f', target], { cwd: projectRoot, env: env.DB_PASSWORD ? { PGPASSWORD: env.DB_PASSWORD } : {}, timeout: 900000 });
  if (!result.ok || !fs.existsSync(target) || fs.statSync(target).size === 0) { fs.rmSync(target, { force: true }); return { status: 'FAILED', path: null, detail: result.stderr || result.error || 'pg_dump failed or produced an empty backup' }; }
  return { status: 'AVAILABLE', path: target, serverVersion: server.stdout, pgDumpVersion: pgDump.version };
}

function createStable(root, config, report, database) {
  const info = git(root); const sequence = listOfficial(root).length + 1; const id = `AANAV-${new Date().toISOString().slice(0, 10)}-${String(sequence).padStart(3, '0')}`;
  return { id, info, database, file: writeCheckpoint(root, { checkpointId: id, status: 'STABLE', createdAt: new Date().toISOString(), platform: describe(), gitCommit: info.commit, gitBranch: info.branch, testResults: report, configuration: configSnapshot(config), databaseBackup: database, storage: config.storage, version: config.version }) };
}

function emergencyBackup(aanavRoot, projectRoot, reason) {
  const id = `${reason}-${timestamp()}`; const target = path.join(aanavRoot, 'backups', id); fs.mkdirSync(target, { recursive: true }); const info = git(projectRoot);
  fs.writeFileSync(path.join(target, 'metadata.json'), JSON.stringify({ id, createdAt: new Date().toISOString(), platform: describe(), git: info }, null, 2));
  fs.writeFileSync(path.join(target, 'git-status.txt'), info.status || '');
  fs.writeFileSync(path.join(target, 'git-diff.patch'), run('git', ['diff', '--binary'], { cwd: projectRoot, timeout: 120000 }).stdout);
  fs.writeFileSync(path.join(target, 'git-diff-cached.patch'), run('git', ['diff', '--cached', '--binary'], { cwd: projectRoot, timeout: 120000 }).stdout);
  return { id, path: target, git: info };
}

module.exports = { ensureDirectories, listOfficial, latestOfficial, createDevelopmentStart, databaseBackup, createStable, emergencyBackup };
