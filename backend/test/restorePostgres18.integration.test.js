'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = fs.promises;
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { test } = require('node:test');
const { createRestoreHelper } = require('../../restore-wizard/helper/server');

const PG18_BIN = '/opt/homebrew/opt/postgresql@18/bin';
const PG18_HOST = '127.0.0.1';
const PG18_PORT = '55418';
const TEST_DATABASE_PREFIX = 'stocksite_pg18_restore_it_';
const TEST_PACKAGE_SIGNING_KEY_PAIR = crypto.generateKeyPairSync('ed25519');
const TEST_PACKAGE_SIGNING_PUBLIC_KEY = TEST_PACKAGE_SIGNING_KEY_PAIR.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

function requiredTestConfiguration() {
  const user = process.env.STOCKSITE_PG18_TEST_USER || '';
  const passfile = process.env.STOCKSITE_PG18_TEST_PGPASSFILE || '';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(user)) {
    throw new Error('Set STOCKSITE_PG18_TEST_USER to the dedicated local PostgreSQL test role.');
  }
  if (!path.isAbsolute(passfile)) {
    throw new Error('Set STOCKSITE_PG18_TEST_PGPASSFILE to an absolute path for a protected PostgreSQL passfile; credentials are never prompted for.');
  }
  const stat = fs.lstatSync(passfile);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) ||
      (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
    throw new Error('The PostgreSQL passfile must be a regular, non-symlink file owned by this user with no group or other permissions.');
  }
  return { user, passfile };
}

function childEnvironment({ user, passfile }) {
  return {
    HOME: os.homedir(),
    PATH: process.env.PATH || '/usr/bin:/bin',
    PGHOST: PG18_HOST,
    PGPORT: PG18_PORT,
    PGUSER: user,
    PGPASSFILE: passfile,
    PGCONNECT_TIMEOUT: '5'
  };
}

function runTool(tool, args, environment, { allowOutput = true } = {}) {
  const executable = path.join(PG18_BIN, tool);
  if (!path.isAbsolute(executable) || !fs.existsSync(executable)) {
    throw new Error(`Required PostgreSQL 18 executable is missing: ${executable}`);
  }
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    env: environment,
    timeout: 60_000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.code === 'ETIMEDOUT'
      ? ' timed out'
      : result.error
        ? ` could not start (${result.error.code || 'process error'})`
        : ` exited with status ${result.status}`;
    throw new Error(`${tool}${detail}; verify the dedicated loopback test role and protected passfile. Tool output was suppressed to prevent credential disclosure.`);
  }
  return allowOutput ? String(result.stdout || '').trim() : '';
}

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) throw new Error('Generated test database identifier is invalid.');
  return `"${identifier}"`;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function query(database, sql, environment) {
  return runTool('psql', [
    '--no-psqlrc', '--no-password', '--set', 'ON_ERROR_STOP=1',
    '--tuples-only', '--no-align', '--host', PG18_HOST, '--port', PG18_PORT,
    '--username', environment.PGUSER, '--dbname', database, '--command', sql
  ], environment);
}

function verifyPassfileMatch(passfile, user) {
  const lines = fs.readFileSync(passfile, 'utf8').split(/\r?\n/);
  const matches = lines.some((line) => {
    if (!line || line.startsWith('#')) return false;
    const fields = [];
    let field = '';
    let escaped = false;
    for (const character of line) {
      if (escaped) {
        field += character;
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === ':') {
        fields.push(field);
        field = '';
      } else {
        field += character;
      }
    }
    fields.push(field);
    return fields.length === 5 &&
      (fields[0] === '*' || fields[0] === PG18_HOST) &&
      (fields[1] === '*' || fields[1] === PG18_PORT) &&
      fields[2] === '*' &&
      fields[3] === user &&
      fields[4].length > 0;
  });
  if (!matches) {
    throw new Error('The protected passfile has no matching loopback test-role entry for port 55418; contents were not displayed.');
  }
}

function checksumFile(filePath) {
  const hash = crypto.createHash('sha256');
  const contents = fs.readFileSync(filePath);
  hash.update(contents);
  return { sha256: hash.digest('hex'), sizeBytes: contents.length };
}

function verifyArtifactInventory(archivePath, inventoryPath) {
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  if (inventory.artifact !== 'stocksite.backup' ||
      !Number.isSafeInteger(inventory.sizeBytes) ||
      !/^[a-f0-9]{64}$/.test(inventory.sha256)) {
    throw new Error('Synthetic backup inventory is malformed.');
  }
  const actual = checksumFile(archivePath);
  if (actual.sha256 !== inventory.sha256 || actual.sizeBytes !== inventory.sizeBytes) {
    throw new Error('Synthetic backup archive does not match its SHA-256 inventory.');
  }
}

function createZip(files) {
  const zip = new AdmZip();
  for (const [name, contents] of files) zip.addFile(name, Buffer.from(contents));
  return zip.toBuffer();
}

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function buildSyntheticPackage(packageDirectory, databaseArchive, sourceRows) {
  const projectVersion = '1.0.0';
  const minimalLock = (name) => JSON.stringify({
    name,
    version: projectVersion,
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name, version: projectVersion } }
  }, null, 2);
  const backendPackage = {
    name: 'synthetic-stocksite-backend',
    version: projectVersion,
    dependencies: { pg: 'file:./test-support/pg' }
  };
  const backendLock = JSON.stringify({
    name: backendPackage.name,
    version: projectVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: backendPackage.name, version: projectVersion, dependencies: backendPackage.dependencies },
      'node_modules/pg': { version: projectVersion, resolved: 'file:test-support/pg' },
      'test-support/pg': { name: 'pg', version: projectVersion }
    }
  }, null, 2);
  const backendSource = `
const http = require('node:http');
const { execFile } = require('node:child_process');
const psql = '/opt/homebrew/opt/postgresql@18/bin/psql';
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    execFile(psql, ['--no-psqlrc', '--no-password', '--tuples-only', '--no-align',
      '--host', process.env.DB_HOST, '--port', process.env.DB_PORT,
      '--username', process.env.DB_USER, '--dbname', process.env.DB_NAME,
      '--command', 'SELECT now()'], { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD } },
      (error, stdout) => {
        if (error) { res.writeHead(503).end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([{ now: stdout.trim() }]));
      });
    return;
  }
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(require('node:fs').readFileSync('../frontend/build/index.html'));
    return;
  }
  res.writeHead(404).end();
});
server.listen(Number(process.env.PORT), '127.0.0.1');
`;
  const frontendBuild = `
const fs = require('node:fs');
fs.mkdirSync('build', { recursive: false });
fs.writeFileSync('build/index.html', '<!doctype html><html><body><div id="root">Synthetic restored Stocksite</div></body></html>');
`;
  const websiteFiles = new Map([
    ['package.json', JSON.stringify({ name: 'synthetic-stocksite', version: projectVersion }, null, 2)],
    ['.env.example', 'DB_NAME=local-database\n'],
    ['backend/package.json', JSON.stringify(backendPackage, null, 2)],
    ['backend/package-lock.json', backendLock],
    ['backend/server.js', backendSource],
    ['backend/services/assetLifecycleSchema.js', `
exports.checkAssetLifecycleSchema = async () => ({ ready: true, missing: [] });
`],
    ['backend/test-support/pg/package.json', JSON.stringify({ name: 'pg', version: projectVersion }, null, 2)],
    ['backend/test-support/pg/index.js', `
exports.Pool = class Pool {
  async end() {}
};
`],
    ['frontend/package.json', JSON.stringify({
      name: 'synthetic-stocksite-frontend',
      version: projectVersion,
      scripts: { build: 'node build.js' }
    }, null, 2)],
    ['frontend/package-lock.json', minimalLock('synthetic-stocksite-frontend')],
    ['frontend/build.js', frontendBuild]
  ]);
  const assetFiles = new Map([
    ['synthetic/user/original.txt', 'synthetic-original-asset\n']
  ]);
  const thumbnailFiles = new Map([
    ['synthetic/user/2026/thumbnail.txt', 'synthetic-thumbnail\n']
  ]);
  const archiveEntries = new Map([
    ['website-code.zip', createZip(websiteFiles)],
    ['original-assets.zip', createZip(assetFiles)],
    ['thumbnails.zip', createZip(thumbnailFiles)]
  ]);
  const softwareManifest = fs.readFileSync(path.resolve(__dirname, '../../restore-wizard/restore-manifest.json'));
  const packageDocumentation = fs.readFileSync(path.resolve(__dirname, '../../restore-wizard/README.md'));
  const wizardHtml = fs.readFileSync(path.resolve(__dirname, '../../restore-wizard/restore-wizard.html'));
  const helperZip = createZip([
    ['helper/server.js', fs.readFileSync(path.resolve(__dirname, '../../restore-wizard/helper/server.js'))],
    ['helper/package.json', fs.readFileSync(path.resolve(__dirname, '../../restore-wizard/helper/package.json'))],
    ['restore-manifest.json', softwareManifest],
    ['restore-wizard.html', wizardHtml]
  ]);
  const payloads = [
    { id: 'database', destination: 'stocksite.backup', contents: databaseArchive },
    { id: 'websiteCode', destination: 'website-code.zip', contents: archiveEntries.get('website-code.zip') },
    { id: 'originalAssets', destination: 'original-assets.zip', contents: archiveEntries.get('original-assets.zip') },
    { id: 'thumbnails', destination: 'thumbnails.zip', contents: archiveEntries.get('thumbnails.zip') },
    { id: 'wizardHtml', destination: 'stocksite-restore-wizard.html', contents: wizardHtml },
    { id: 'helperZip', destination: 'stocksite-restore-helper.zip', contents: helperZip },
    { id: 'softwareManifest', destination: 'restore-manifest.json', contents: softwareManifest },
    { id: 'packageDocumentation', destination: 'RESTORE_PACKAGE_README.md', contents: packageDocumentation }
  ];
  const inventory = [
    {
      artifactId: 'database',
      destinationWithinArtifact: 'stocksite.backup',
      contents: databaseArchive,
      source: 'Synthetic PostgreSQL custom-format backup'
    },
    ...[...websiteFiles].map(([file, contents]) => ({
      artifactId: 'websiteCode', destinationWithinArtifact: file, contents, source: 'Synthetic website fixture'
    })),
    ...[...assetFiles].map(([file, contents]) => ({
      artifactId: 'originalAssets', destinationWithinArtifact: file, contents, source: 'Synthetic original assets'
    })),
    ...[...thumbnailFiles].map(([file, contents]) => ({
      artifactId: 'thumbnails', destinationWithinArtifact: file, contents, source: 'Synthetic thumbnails'
    }))
  ].map(({ artifactId, destinationWithinArtifact, contents, source }) => ({
    source,
    sourceRelativePath: destinationWithinArtifact,
    artifactId,
    destinationWithinArtifact,
    sizeBytes: contents.length,
    sha256: sha256(contents),
    inclusionStatus: 'INCLUDED',
    secretBearing: false,
    encrypted: false,
    verificationResult: 'VERIFIED'
  }));

  for (const artifact of payloads) {
    if (artifact.id === 'database') continue;
    fs.writeFileSync(path.join(packageDirectory, artifact.destination), artifact.contents, { flag: 'wx', mode: 0o600 });
  }
  const artifacts = payloads.map(({ id, destination, contents }) => ({
    id,
    source: `Synthetic ${id} fixture`,
    destination,
    sizeBytes: contents.length,
    sha256: sha256(contents),
    inclusionStatus: 'INCLUDED',
    verificationResult: 'VERIFIED',
    fileCount: 1,
    totalSourceBytes: contents.length
  }));
  const packageManifest = {
    format: 'STOCKSITE-RESTORE-PACKAGE',
    formatVersion: 1,
    schema: 'stocksite.restore-package-manifest',
    schemaVersion: 1,
    packageVersion: '1.0.0',
    packageJobId: `synthetic-${crypto.randomBytes(6).toString('hex')}`,
    generatedAt: new Date().toISOString(),
    generation: {
      sourceApplicationVersion: projectVersion,
      sourceGitRevision: 'synthetic-test-fixture',
      sourceBackupJobId: 'synthetic-pg18-backup',
      sourceBackupGeneratedAt: new Date().toISOString(),
      database: {
        engine: 'PostgreSQL',
        serverVersion: 'PostgreSQL 18',
        pgDumpVersion: 'pg_dump 18',
        databaseName: 'synthetic-source',
        backupTimestamp: new Date().toISOString(),
        sourceArchivePath: 'Database/stocksite.backup',
        archiveInspection: 'Validated by pg_restore --list in the PG18 integration test.'
      }
    },
    secretHandling: {
      secretBearingConfigurationIncluded: false,
      administratorAuthorization: 'Synthetic test fixture; contains no secrets.',
      environmentFilesEncrypted: true,
      encryption: 'No secret-bearing environment files are included.',
      warning: 'Synthetic test data only.'
    },
    artifacts,
    sourceInventory: inventory,
    excludedSourceItems: [],
    exclusions: [],
    sourceInventoryVerification: {
      expectedPayloadFiles: inventory.length,
      inventoriedPayloadFiles: inventory.length,
      expectedPayloadBytes: inventory.reduce((total, item) => total + item.sizeBytes, 0),
      inventoriedPayloadBytes: inventory.reduce((total, item) => total + item.sizeBytes, 0),
      result: 'VERIFIED'
    },
    checksumFile: 'checksums.sha256',
    manifestIntegrity: { algorithm: 'SHA-256', scope: 'Canonical manifest hash.', canonicalSha256: null },
    packageSignature: {
      algorithm: 'Ed25519',
      keyId: crypto.createHash('sha256')
        .update(TEST_PACKAGE_SIGNING_KEY_PAIR.publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex')
        .slice(0, 24),
      signature: 'A'.repeat(88)
    }
  };
  const selfArtifact = {
    id: 'packageManifest',
    source: 'Synthetic package metadata',
    destination: 'restore-package-manifest.json',
    sizeBytes: 0,
    sha256: null,
    inclusionStatus: 'INCLUDED',
    verificationResult: 'PENDING_CANONICAL_HASH',
    fileCount: 1,
    totalSourceBytes: null
  };
  const checksumArtifact = {
    id: 'packageChecksums',
    source: 'Synthetic detached checksums',
    destination: 'checksums.sha256',
    sizeBytes: 0,
    sha256: null,
    inclusionStatus: 'INCLUDED',
    verificationResult: 'PENDING',
    fileCount: payloads.length + 1,
    totalSourceBytes: null
  };
  packageManifest.artifacts.push(selfArtifact, checksumArtifact);
  const canonicalBytes = () => {
    const canonical = JSON.parse(JSON.stringify(packageManifest));
    canonical.manifestIntegrity.canonicalSha256 = null;
    canonical.artifacts.find(({ id }) => id === 'packageManifest').sha256 = null;
    canonical.artifacts.find(({ id }) => id === 'packageChecksums').sha256 = null;
    canonical.packageSignature.signature = null;
    return Buffer.from(JSON.stringify(canonical, null, 2));
  };
  let serialized;
  let checksums;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const oldManifestSize = selfArtifact.sizeBytes;
    const oldChecksumsSize = checksumArtifact.sizeBytes;
    const canonicalHash = sha256(canonicalBytes());
    packageManifest.manifestIntegrity.canonicalSha256 = canonicalHash;
    selfArtifact.sha256 = canonicalHash;
    selfArtifact.verificationResult = 'VERIFIED_CANONICAL_HASH';
    serialized = Buffer.from(JSON.stringify(packageManifest, null, 2));
    selfArtifact.sizeBytes = serialized.length;
    const lines = payloads.map(({ destination, contents }) => `${sha256(contents)} ${contents.length} ${destination}`);
    lines.push(`${canonicalHash} ${serialized.length} restore-package-manifest.json`);
    checksums = Buffer.from(`${lines.join('\n')}\n`);
    checksumArtifact.sizeBytes = checksums.length;
    checksumArtifact.verificationResult = 'VERIFIED_ENTRIES';
    if (serialized.length === oldManifestSize && checksums.length === oldChecksumsSize) break;
  }
  serialized = Buffer.from(JSON.stringify(packageManifest, null, 2));
  assert.equal(serialized.length, selfArtifact.sizeBytes);
  assert.equal(sha256(canonicalBytes()), selfArtifact.sha256);
  packageManifest.packageSignature.signature = crypto.sign(
    null,
    Buffer.from(`STOCKSITE-RESTORE-PACKAGE-V1\n${selfArtifact.sha256}`, 'utf8'),
    TEST_PACKAGE_SIGNING_KEY_PAIR.privateKey
  ).toString('base64');
  serialized = Buffer.from(JSON.stringify(packageManifest, null, 2));
  assert.equal(serialized.length, selfArtifact.sizeBytes);
  const finalLines = payloads.map(({ destination, contents }) => `${sha256(contents)} ${contents.length} ${destination}`);
  finalLines.push(`${selfArtifact.sha256} ${serialized.length} restore-package-manifest.json`);
  checksums = Buffer.from(`${finalLines.join('\n')}\n`);
  assert.equal(checksums.length, checksumArtifact.sizeBytes);
  fs.writeFileSync(path.join(packageDirectory, selfArtifact.destination), serialized, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(packageDirectory, checksumArtifact.destination), checksums, { flag: 'wx', mode: 0o600 });

  return {
    files: { websiteFiles, assetFiles, thumbnailFiles, sourceRows },
    manifest: packageManifest
  };
}

function getFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

test('PostgreSQL 18 custom-format database backup restores synthetic rows on the dedicated loopback cluster', async () => {
  assert.equal(PG18_BIN, '/opt/homebrew/opt/postgresql@18/bin');
  assert.equal(PG18_HOST, '127.0.0.1');
  assert.equal(PG18_PORT, '55418');
  const configuration = requiredTestConfiguration();
  verifyPassfileMatch(configuration.passfile, configuration.user);
  const environment = childEnvironment(configuration);

  for (const tool of ['pg_dump', 'pg_restore', 'psql']) {
    const version = runTool(tool, ['--version'], environment);
    assert.match(version, /\b18\./, `${tool} must be PostgreSQL 18`);
  }

  const serverIdentity = query('postgres', `
    SELECT inet_server_addr()::text || '|' || inet_server_port()::text || '|' ||
      current_setting('server_version_num') || '|' || version()
  `, environment);
  const identityParts = serverIdentity.split('|');
  assert.ok(
    identityParts[0] === PG18_HOST || identityParts[0] === `${PG18_HOST}/32`,
    `server address must be the explicit IPv4 loopback address, optionally with its /32 mask (received ${identityParts[0]})`
  );
  assert.equal(identityParts[1], PG18_PORT, 'server port must be the dedicated test port');
  assert.ok(Number(identityParts[2]) >= 180000 && Number(identityParts[2]) < 190000,
    'connected PostgreSQL server must be version 18');

  const runId = crypto.randomBytes(8).toString('hex');
  const databaseStem = `${TEST_DATABASE_PREFIX}${process.pid}_${runId}`;
  const sourceDatabase = `${databaseStem}_source`;
  const targetDatabase = `${databaseStem}_target`;
  const sourceIdentifier = quoteIdentifier(sourceDatabase);
  const targetIdentifier = quoteIdentifier(targetDatabase);
  const identityMarker = `stocksite-pg18-restore-integration:${runId}`;
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'stocksite-pg18-restore-test-'));
  await fsp.chmod(temporaryRoot, 0o700);
  const archivePath = path.join(temporaryRoot, 'stocksite.backup');
  const inventoryPath = path.join(temporaryRoot, 'inventory.json');
  let sourceCreated = false;
  let targetCreated = false;
  let primaryError = null;

  try {
    const existing = query('postgres',
      `SELECT datname FROM pg_database WHERE datname IN (${sqlLiteral(sourceDatabase)}, ${sqlLiteral(targetDatabase)})`,
      environment);
    assert.equal(existing, '', 'generated test database names must not already exist');

    runTool('psql', [
      '--no-psqlrc', '--no-password', '--set', 'ON_ERROR_STOP=1',
      '--host', PG18_HOST, '--port', PG18_PORT, '--username', configuration.user,
      '--dbname', 'postgres', '--command', `CREATE DATABASE ${sourceIdentifier}`
    ], environment, { allowOutput: false });
    sourceCreated = true;
    query('postgres', `COMMENT ON DATABASE ${sourceIdentifier} IS ${sqlLiteral(identityMarker)}`, environment);
    query(sourceDatabase, `
      CREATE TABLE public.restore_probe (
        id integer PRIMARY KEY,
        label text NOT NULL,
        created_on date NOT NULL
      );
      CREATE TABLE public.restore_test_identity (marker text PRIMARY KEY);
      INSERT INTO public.restore_test_identity (marker) VALUES (${sqlLiteral(identityMarker)});
      INSERT INTO public.restore_probe (id, label, created_on) VALUES
        (1, 'synthetic-alpha', DATE '2026-10-12'),
        (2, 'synthetic-beta', DATE '2026-10-13');
    `, environment);

    runTool('pg_dump', [
      '--no-password', '--format=custom', '--no-owner', '--no-privileges',
      '--host', PG18_HOST, '--port', PG18_PORT, '--username', configuration.user,
      '--dbname', sourceDatabase, '--file', archivePath
    ], environment, { allowOutput: false });
    assert.equal(fs.readFileSync(archivePath).subarray(0, 5).toString('ascii'), 'PGDMP',
      'pg_dump must create a PostgreSQL custom-format archive');
    const archiveChecksum = checksumFile(archivePath);
    await fsp.writeFile(inventoryPath, JSON.stringify({
      artifact: 'stocksite.backup',
      sizeBytes: archiveChecksum.sizeBytes,
      sha256: archiveChecksum.sha256
    }), { mode: 0o600, flag: 'wx' });
    verifyArtifactInventory(archivePath, inventoryPath);
    const toc = runTool('pg_restore', ['--no-password', '--list', archivePath], environment);
    assert.match(toc, /restore_probe/, 'archive TOC must include the synthetic table');
    assert.match(toc, /restore_test_identity/, 'archive TOC must include the cleanup identity marker');

    const targetExisting = query('postgres', `SELECT datname FROM pg_database WHERE datname = ${sqlLiteral(targetDatabase)}`, environment);
    assert.equal(targetExisting, '', 'restore target must not already exist');
    runTool('psql', [
      '--no-psqlrc', '--no-password', '--set', 'ON_ERROR_STOP=1',
      '--host', PG18_HOST, '--port', PG18_PORT, '--username', configuration.user,
      '--dbname', 'postgres', '--command', `CREATE DATABASE ${targetIdentifier}`
    ], environment, { allowOutput: false });
    targetCreated = true;
    query('postgres', `COMMENT ON DATABASE ${targetIdentifier} IS ${sqlLiteral(identityMarker)}`, environment);

    const publicObjects = query(targetDatabase, `
      SELECT count(*) FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
    `, environment);
    assert.equal(publicObjects, '0', 'restore target must be empty before restoring');
    verifyArtifactInventory(archivePath, inventoryPath);
    runTool('pg_restore', [
      '--no-password', '--exit-on-error', '--no-owner', '--no-privileges',
      '--host', PG18_HOST, '--port', PG18_PORT, '--username', configuration.user,
      '--dbname', targetDatabase, archivePath
    ], environment, { allowOutput: false });

    const restoredMarker = query(targetDatabase,
      `SELECT marker FROM public.restore_test_identity WHERE marker = ${sqlLiteral(identityMarker)}`,
      environment);
    assert.equal(restoredMarker, identityMarker, 'restored database must contain this run’s identity marker');
    const rows = query(targetDatabase, `
      SELECT id::text || '|' || label || '|' || created_on::text
      FROM public.restore_probe ORDER BY id
    `, environment);
    assert.deepEqual(rows.split(/\r?\n/), [
      '1|synthetic-alpha|2026-10-12',
      '2|synthetic-beta|2026-10-13'
    ]);
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = [];
    for (const [database, created] of [[targetDatabase, targetCreated], [sourceDatabase, sourceCreated]]) {
      if (!created) continue;
      try {
        const actualMarker = query('postgres', `
          SELECT COALESCE(shobj_description(oid, 'pg_database'), '')
          FROM pg_database WHERE datname = ${sqlLiteral(database)}
        `, environment);
        if (actualMarker !== identityMarker) {
          cleanupErrors.push(`Refused cleanup because database ${database} did not retain this test run's identity marker.`);
          continue;
        }
        runTool('psql', [
          '--no-psqlrc', '--no-password', '--set', 'ON_ERROR_STOP=1',
          '--host', PG18_HOST, '--port', PG18_PORT, '--username', configuration.user,
          '--dbname', 'postgres', '--command', `DROP DATABASE ${quoteIdentifier(database)} WITH (FORCE)`
        ], environment, { allowOutput: false });
      } catch {
        cleanupErrors.push(`Could not safely clean up the test-created database ${database}.`);
      }
    }
    try {
      const resolvedRoot = await fsp.realpath(temporaryRoot);
      const resolvedTempDirectory = await fsp.realpath(os.tmpdir());
      if (path.dirname(resolvedRoot) !== resolvedTempDirectory ||
          !path.basename(resolvedRoot).startsWith('stocksite-pg18-restore-test-')) {
        cleanupErrors.push('Refused to remove an unrecognized integration-test temporary directory.');
      } else {
        await fsp.rm(resolvedRoot, { recursive: true, force: false });
      }
    } catch {
      cleanupErrors.push('Could not safely remove the integration-test temporary directory.');
    }
    if (!primaryError && cleanupErrors.length) primaryError = new Error(cleanupErrors.join(' '));
  }
  if (primaryError) throw primaryError;
});

test('Restore Wizard validates and restores a complete synthetic PostgreSQL 18 package through health-checked launch', async () => {
  const configuration = requiredTestConfiguration();
  verifyPassfileMatch(configuration.passfile, configuration.user);
  const pgEnvironment = childEnvironment(configuration);
  const passwordLine = fs.readFileSync(configuration.passfile, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${PG18_HOST}:${PG18_PORT}:*:${configuration.user}:`));
  assert.ok(passwordLine, 'dedicated test passfile entry must be available');
  const databasePassword = passwordLine.slice(passwordLine.lastIndexOf(':') + 1);
  assert.ok(databasePassword.length > 0, 'dedicated test password must not be empty');

  const runId = crypto.randomBytes(8).toString('hex');
  const databaseStem = `${TEST_DATABASE_PREFIX}${process.pid}_${runId}`;
  const sourceDatabase = `${databaseStem}_source`;
  const targetDatabase = `${databaseStem}_wizard`;
  const sourceIdentifier = quoteIdentifier(sourceDatabase);
  const targetIdentifier = quoteIdentifier(targetDatabase);
  const identityMarker = `stocksite-pg18-wizard-e2e:${runId}`;
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'stocksite-pg18-wizard-e2e-'));
  await fsp.chmod(workspace, 0o700);
  const packageDirectory = path.join(workspace, 'package');
  const destinationParent = path.join(workspace, 'restored');
  await fsp.mkdir(packageDirectory, { mode: 0o700 });
  await fsp.mkdir(destinationParent, { mode: 0o700 });
  const archivePath = path.join(packageDirectory, 'stocksite.backup');
  const identityPath = path.join(workspace, 'cleanup-identity.txt');
  const previousPath = process.env.PATH;
  process.env.PATH = `${PG18_BIN}:${previousPath || '/usr/bin:/bin'}`;
  let sourceCreated = false;
  let targetCreated = false;
  let helperServer;
  let helper;
  let helperJob;
  let restoreError = null;

  try {
    const tcpIdentity = query('postgres', `
      SELECT inet_server_addr()::text || '|' || inet_server_port()::text || '|' ||
        current_setting('server_version_num')
    `, pgEnvironment).split('|');
    assert.ok(tcpIdentity[0] === PG18_HOST || tcpIdentity[0] === `${PG18_HOST}/32`,
      'database connection must resolve to IPv4 loopback');
    assert.equal(tcpIdentity[1], PG18_PORT);
    assert.ok(Number(tcpIdentity[2]) >= 180000 && Number(tcpIdentity[2]) < 190000);

    for (const tool of ['pg_dump', 'pg_restore', 'psql']) {
      assert.match(runTool(tool, ['--version'], pgEnvironment), /\b18\./);
    }

    const existingNames = query('postgres',
      `SELECT datname FROM pg_database WHERE datname IN (${sqlLiteral(sourceDatabase)}, ${sqlLiteral(targetDatabase)})`,
      pgEnvironment);
    assert.equal(existingNames, '', 'unique synthetic source and target databases must not exist');
    runTool('psql', [
      '--no-psqlrc', '--no-password', '--set', 'ON_ERROR_STOP=1',
      '--host', PG18_HOST, '--port', PG18_PORT, '--username', configuration.user,
      '--dbname', 'postgres', '--command', `CREATE DATABASE ${sourceIdentifier}`
    ], pgEnvironment, { allowOutput: false });
    sourceCreated = true;
    query('postgres', `COMMENT ON DATABASE ${sourceIdentifier} IS ${sqlLiteral(identityMarker)}`, pgEnvironment);
    await fsp.writeFile(identityPath, identityMarker, { flag: 'wx', mode: 0o600 });
    query(sourceDatabase, `
      CREATE TABLE public.restore_probe (
        id integer PRIMARY KEY,
        label text NOT NULL,
        created_on date NOT NULL
      );
      INSERT INTO public.restore_probe (id, label, created_on) VALUES
        (1, 'synthetic-alpha', DATE '2026-10-12'),
        (2, 'synthetic-beta', DATE '2026-10-13');
    `, pgEnvironment);
    runTool('pg_dump', [
      '--no-password', '--format=custom', '--no-owner', '--no-privileges',
      '--host', PG18_HOST, '--port', PG18_PORT, '--username', configuration.user,
      '--dbname', sourceDatabase, '--file', archivePath
    ], pgEnvironment, { allowOutput: false });
    assert.equal(fs.readFileSync(archivePath).subarray(0, 5).toString('ascii'), 'PGDMP');

    const sourceRows = [
      '1|synthetic-alpha|2026-10-12',
      '2|synthetic-beta|2026-10-13'
    ];
    const synthetic = buildSyntheticPackage(packageDirectory, fs.readFileSync(archivePath), sourceRows);

    runTool('psql', [
      '--no-psqlrc', '--no-password', '--set', 'ON_ERROR_STOP=1',
      '--host', PG18_HOST, '--port', PG18_PORT, '--username', configuration.user,
      '--dbname', 'postgres', '--command', `CREATE DATABASE ${targetIdentifier}`
    ], pgEnvironment, { allowOutput: false });
    targetCreated = true;
    query('postgres', `COMMENT ON DATABASE ${targetIdentifier} IS ${sqlLiteral(identityMarker)}`, pgEnvironment);
    assert.equal(query(targetDatabase, `
      SELECT count(*) FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
    `, pgEnvironment), '0');

    const appPort = await getFreeLoopbackPort();
    const helperToken = crypto.randomBytes(32).toString('hex');
    helper = createRestoreHelper({
      environment: {
        RESTORE_HELPER_TOKEN: helperToken,
        RESTORE_UI_ORIGIN: 'http://127.0.0.1',
        RESTORE_APP_DB_HOST: PG18_HOST,
        RESTORE_APP_DB_PORT: PG18_PORT,
        RESTORE_APP_DB_USER: configuration.user,
        RESTORE_APP_DB_PASSWORD: databasePassword,
        RESTORE_APP_JWT_SECRET: crypto.randomBytes(48).toString('hex'),
        RESTORE_PACKAGE_SIGNING_PUBLIC_KEY: TEST_PACKAGE_SIGNING_PUBLIC_KEY,
        RESTORE_APP_PORT: String(appPort)
      }
    });
    helperServer = http.createServer((req, res) => void helper.handle(req, res));
    await new Promise((resolve, reject) => {
      helperServer.once('error', reject);
      helperServer.listen(0, '127.0.0.1', resolve);
    });
    const helperUrl = `http://127.0.0.1:${helperServer.address().port}`;
    const api = async (pathname, method = 'GET', body) => {
      const response = await fetch(`${helperUrl}${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${helperToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const payload = await response.json();
      assert.ok(response.ok, payload.error || `${method} ${pathname} failed with HTTP ${response.status}`);
      return payload;
    };
    const destinations = {
      databaseName: targetDatabase,
      websiteDestination: path.join(destinationParent, 'code'),
      assetsDestination: path.join(destinationParent, 'originals'),
      thumbnailsDestination: path.join(destinationParent, 'thumbnails')
    };
    const sources = {
      databaseFile: archivePath,
      websiteArchive: path.join(packageDirectory, 'website-code.zip'),
      assetsArchive: path.join(packageDirectory, 'original-assets.zip'),
      thumbnailsArchive: path.join(packageDirectory, 'thumbnails.zip')
    };
    const configurationForHelper = { sources, destinations };
    const manifestResponse = await api('/api/manifest');
    assert.equal(manifestResponse.manifest.schema, 'stocksite.restore-manifest');
    const validated = await api('/api/validate', 'POST', configurationForHelper);
    assert.equal(validated.validation.destinations.databaseName, targetDatabase);
    assert.equal(validated.validation.databaseTarget.host, PG18_HOST);
    assert.equal(validated.validation.databaseTarget.port, Number(PG18_PORT));
    assert.equal(validated.validation.databaseTarget.empty, true);
    assert.ok(validated.validation.databaseTarget.serverAddress === PG18_HOST ||
      validated.validation.databaseTarget.serverAddress === `${PG18_HOST}/32`);
    await assert.rejects(
      api('/api/validate', 'POST', {
        sources,
        destinations: {
          ...destinations,
          databaseName: sourceDatabase,
          websiteDestination: path.join(destinationParent, 'nonempty-code'),
          assetsDestination: path.join(destinationParent, 'nonempty-originals'),
          thumbnailsDestination: path.join(destinationParent, 'nonempty-thumbnails')
        }
      }),
      /selected database is not empty/
    );

    const start = await api('/api/start', 'POST', {
      configuration: configurationForHelper,
      restoreAuthorized: true,
      confirmation: `RESTORE ${targetDatabase}`
    });
    helperJob = helper.jobs.get(start.job.id);
    assert.equal(start.job.status, 'WAITING');
    assert.equal(start.job.launchAvailable, false, 'launch must not be exposed before health checks');
    const deadline = Date.now() + 180_000;
    let publicJob = start.job;
    const approvedActions = new Set();
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      publicJob = (await api(`/api/jobs/${start.job.id}`)).job;
      if (publicJob.awaitingApproval && !approvedActions.has(publicJob.awaitingApproval.actionId)) {
        const actionId = publicJob.awaitingApproval.actionId;
        approvedActions.add(actionId);
        await api(`/api/jobs/${start.job.id}/approval`, 'POST', { actionId, approved: true });
      }
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(publicJob.status)) break;
    }
    assert.equal(publicJob.status, 'COMPLETED', publicJob.error || 'synthetic restore job did not complete');
    assert.equal(publicJob.launchAvailable, true);
    assert.equal(publicJob.finalReport.notVerified.length, 4);
    assert.ok(publicJob.finalReport.notVerified.includes(
      'Redis-backed thumbnail queue readiness and background processing'
    ));
    assert.equal(publicJob.launchUrl, `http://127.0.0.1:${appPort}/`);
    assert.ok(publicJob.tasks.find(({ id }) => id === 'check-source-compatibility').status === 'SKIPPED');
    assert.match(publicJob.tasks.find(({ id }) => id === 'check-source-compatibility').operation,
      /Full application schema compatibility is not verified.*backend startup may run/);
    for (const taskId of [
      'validate-package', 'prepare-staging', 'restore-postgresql-custom-archive', 'extract-website-code',
      'extract-original-assets', 'extract-thumbnails', 'configure-local-environment',
      'install-backend-dependencies', 'install-frontend-dependencies', 'build-frontend',
      'validate-database', 'validate-application-schema', 'promote-destinations', 'validate-storage', 'launch-backend', 'health-check-backend',
      'health-check-frontend', 'launch-local-website'
    ]) {
      assert.equal(publicJob.tasks.find(({ id }) => id === taskId)?.status, 'COMPLETED', `${taskId} must complete`);
    }
    assert.equal(approvedActions.size, 11, 'each consequential operation must receive its own approval');

    const healthResponse = await fetch(`${publicJob.launchUrl}health`);
    assert.equal(healthResponse.status, 200);
    const healthPayload = await healthResponse.json();
    assert.ok(healthPayload[0]?.now);
    const siteResponse = await fetch(publicJob.launchUrl);
    assert.equal(siteResponse.status, 200);
    assert.match(await siteResponse.text(), /Synthetic restored Stocksite/);
    assert.equal(await fsp.readFile(path.join(destinations.websiteDestination, '.env.example'), 'utf8'),
      synthetic.files.websiteFiles.get('.env.example').toString());
    for (const [relative, contents] of synthetic.files.websiteFiles) {
      assert.deepEqual(
        await fsp.readFile(path.join(destinations.websiteDestination, ...relative.split('/'))),
        Buffer.from(contents)
      );
    }
    for (const [relative, contents] of synthetic.files.assetFiles) {
      assert.deepEqual(await fsp.readFile(path.join(destinations.assetsDestination, ...relative.split('/'))), Buffer.from(contents));
    }
    for (const [relative, contents] of synthetic.files.thumbnailFiles) {
      assert.deepEqual(await fsp.readFile(path.join(destinations.thumbnailsDestination, ...relative.split('/'))), Buffer.from(contents));
    }
    const targetRows = query(targetDatabase, `
      SELECT id::text || '|' || label || '|' || created_on::text
      FROM public.restore_probe ORDER BY id
    `, pgEnvironment);
    assert.deepEqual(targetRows.split(/\r?\n/), sourceRows);

    console.log(JSON.stringify({
      pgVersion: '18.x',
      endpoint: `${PG18_HOST}:${PG18_PORT}`,
      packageManifestChecksumsInventoryAndArchives: 'PASS synthetic STOCKSITE-RESTORE-PACKAGE',
      customFormatArchiveAndRows: 'PASS',
      automaticCodeAssetsAndThumbnailExtraction: 'PASS',
      dependencyInstallationAndBuild: 'PASS synthetic package lockfiles and npm build command',
      backendDatabaseHealth: 'PASS',
      frontendHealthAndLaunchAfterChecks: 'PASS',
      lifecycleSchemaGate: 'PASS synthetic fixture validator; full Stocksite schema compatibility is unverified',
      migrations: 'Not applied by helper validation; real Stocksite startup migration effects are not exercised',
      launchUrl: publicJob.launchUrl
    }, null, 2));
  } catch (error) {
    restoreError = error;
  } finally {
    const service = helperJob || [...(helper?.jobs?.values?.() || [])].find((job) => job.serviceProcess);
    if (service?.serviceProcess && service.serviceProcess.exitCode == null) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        service.serviceProcess.once('exit', () => { clearTimeout(timer); resolve(); });
        service.serviceProcess.kill('SIGTERM');
      });
    }
    if (helperServer) {
      await new Promise((resolve) => helperServer.close(resolve));
    }
    for (const [database, created] of [[targetDatabase, targetCreated], [sourceDatabase, sourceCreated]]) {
      if (!created) continue;
      try {
        const actualMarker = query('postgres', `
          SELECT COALESCE(shobj_description(oid, 'pg_database'), '')
          FROM pg_database WHERE datname = ${sqlLiteral(database)}
        `, pgEnvironment);
        if (actualMarker !== identityMarker) {
          throw new Error(`Refused cleanup because ${database} did not retain the run identity marker.`);
        }
        runTool('psql', [
          '--no-psqlrc', '--no-password', '--set', 'ON_ERROR_STOP=1',
          '--host', PG18_HOST, '--port', PG18_PORT, '--username', configuration.user,
          '--dbname', 'postgres', '--command', `DROP DATABASE ${quoteIdentifier(database)} WITH (FORCE)`
        ], pgEnvironment, { allowOutput: false });
      } catch (cleanupError) {
        restoreError ||= cleanupError;
      }
    }
    try {
      const resolvedWorkspace = await fsp.realpath(workspace);
      const resolvedTemp = await fsp.realpath(os.tmpdir());
      if (path.dirname(resolvedWorkspace) !== resolvedTemp ||
          !path.basename(resolvedWorkspace).startsWith('stocksite-pg18-wizard-e2e-')) {
        throw new Error('Refused to remove an unrecognized synthetic Restore Wizard workspace.');
      }
      await fsp.rm(resolvedWorkspace, { recursive: true, force: false });
    } catch (cleanupError) {
      restoreError ||= cleanupError;
    }
    process.env.PATH = previousPath;
  }
  if (restoreError) throw restoreError;
});
