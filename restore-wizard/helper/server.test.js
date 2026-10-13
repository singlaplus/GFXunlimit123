'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { test } = require('node:test');
const {
  createRestoreHelper,
  assertMinimumVersion,
  validateArchiveEntryPath,
  safeLog,
  getLocalPostgresSettings,
  dotenvValue,
  compareArchiveInventory,
  promoteStagedDirectory,
  assertRequiredRestoreTasksComplete,
  resolveNpmCli,
  parseWindowsPostgresServices,
  parseWindowsSystem,
  isSupportedNodeRuntime,
  terminateChildProcess,
  isTcpPortAvailable,
  isLoopbackAddress,
  assertEmptyOwnedDatabasePreflight,
  assertLifecycleSchemaReady,
  getFrontendAssetUrls
} = require('./server');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, content = '', mode = 0o100644 } of entries) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(3 << 8 | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((((mode >>> 0) << 16) >>> 0), 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function inventoryItem(relativePath, content) {
  const data = Buffer.from(content);
  return {
    destinationWithinArtifact: relativePath,
    sizeBytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex')
  };
}

async function withExtractionFixture(entries, run, platform = process.platform) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stocksite-restore-zip-'));
  const archivePath = path.join(root, 'fixture.zip');
  let destination = path.join(root, 'destination');
  await fs.promises.mkdir(destination);
  destination = await fs.promises.realpath(destination);
  await fs.promises.writeFile(archivePath, makeZip(entries));
  const helper = createRestoreHelper({ platform, environment: { RESTORE_HELPER_TOKEN: 'test-only-restore-token-that-is-long-enough' } });
  const task = { id: 'extract-test', name: 'Extract fixture', status: 'WAITING' };
  const job = { softwareTasks: [], tasks: [task], logs: [], cancelRequested: false };
  try {
    await run({ helper, archivePath, destination, task, job, root });
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

test('restore helper rejects unsafe archive paths for cross-platform restoration', () => {
  for (const unsafe of ['../escape', 'folder/../../escape', '/absolute/path', '\\\\server\\share', 'C:\\outside', 'folder\\..\\escape', '']) {
    assert.throws(() => validateArchiveEntryPath(unsafe), /Unsafe archive entry path/);
  }
  assert.equal(validateArchiveEntryPath('backend/migrations/029_asset_lifecycle_operations.sql'), 'backend/migrations/029_asset_lifecycle_operations.sql');
});

test('restore helper log redaction removes credential values', () => {
  const output = safeLog('DB_PASSWORD=secret-value RESTORE_HELPER_TOKEN=private-token Authorization: Bearer bearer-value postgres://user:pw@localhost/db');
  for (const secret of ['secret-value', 'private-token', 'bearer-value', 'user:pw']) assert.ok(!output.includes(secret));
});

test('restore helper rejects unsupported PostgreSQL client versions with actionable requirements', () => {
  assert.throws(
    () => assertMinimumVersion('pg_restore (PostgreSQL) 17.10', 18, 'PostgreSQL Client Tools', 'https://www.postgresql.org/download/'),
    /PostgreSQL Client Tools version 17\.10 is unsupported; 18\.x or newer is required.*https:\/\/www\.postgresql\.org\/download/
  );
  assert.equal(
    assertMinimumVersion('psql (PostgreSQL) 18.1', 18, 'PostgreSQL Client Tools', 'https://www.postgresql.org/download/'),
    true
  );
});

test('Windows PostgreSQL service detection distinguishes missing, stopped, and running services', () => {
  assert.equal(parseWindowsPostgresServices('[]').status, 'missing');
  assert.equal(parseWindowsPostgresServices(JSON.stringify([
    { Name: 'postgresql-x64-18', Status: 'Stopped' }
  ])).status, 'stopped');
  const running = parseWindowsPostgresServices(JSON.stringify([
    { Name: 'postgresql-x64-18', Status: 'Running' },
    { Name: 'unrelated-service', Status: 'Stopped' }
  ]));
  assert.equal(running.status, 'running');
  assert.deepEqual(running.services, [{ name: 'postgresql-x64-18', status: 'Running' }]);
  assert.equal(parseWindowsPostgresServices('not-json').status, 'unknown');
});

test('Windows readiness supports Windows 11 desktop builds and x64 Node on 64-bit Windows', () => {
  const windows11 = parseWindowsSystem(JSON.stringify({
    Caption: 'Microsoft Windows 11 Pro',
    Version: '10.0.26200',
    OSArchitecture: '64-bit'
  }), 'x64');
  assert.equal(windows11.versionStatus, 'ready');
  assert.equal(windows11.architectureStatus, 'ready');
  const olderWindows11 = parseWindowsSystem(JSON.stringify({
    Caption: 'Microsoft Windows 11 Pro',
    Version: '10.0.26100',
    OSArchitecture: '64-bit'
  }), 'x64');
  assert.equal(olderWindows11.versionStatus, 'unsupported');
  assert.match(olderWindows11.versionMessage, /build 26200 or newer/);

  const windows10 = parseWindowsSystem(JSON.stringify({
    Caption: 'Microsoft Windows 10 Pro',
    Version: '10.0.19045',
    OSArchitecture: '64-bit'
  }), 'x64');
  assert.equal(windows10.versionStatus, 'unsupported');
  assert.match(windows10.versionMessage, /Windows 10 Home\/Pro is out of support/);

  const windowsArm = parseWindowsSystem(JSON.stringify({
    Caption: 'Microsoft Windows 11 Home',
    Version: '10.0.26200',
    OSArchitecture: 'ARM 64-bit'
  }), 'arm64');
  assert.equal(windowsArm.versionStatus, 'ready');
  assert.equal(windowsArm.architectureStatus, 'unsupported');
  assert.match(windowsArm.architectureMessage, /64-bit Windows and x64 Node\.js/);

  const server = parseWindowsSystem(JSON.stringify({
    Caption: 'Microsoft Windows Server 2022 Datacenter',
    Version: '10.0.20348',
    OSArchitecture: '64-bit'
  }), 'x64');
  assert.equal(server.versionStatus, 'unsupported');
  assert.equal(parseWindowsSystem('not-json').versionStatus, 'unknown');
});

test('restore helper requires a supported Node.js LTS line', () => {
  assert.equal(isSupportedNodeRuntime('v20.20.2', 'Iron'), false);
  assert.equal(isSupportedNodeRuntime('v22.23.3', 'Jod'), true);
  assert.equal(isSupportedNodeRuntime('v24.21.0', 'Krypton'), true);
  assert.equal(isSupportedNodeRuntime('v26.0.0', undefined), false);
  assert.equal(isSupportedNodeRuntime('not-a-version', 'LTS'), false);
});

test('frontend readiness requires same-origin built JavaScript and stylesheet assets', () => {
  const assets = getFrontendAssetUrls(
    '<div id="root"></div><script defer src="/static/js/main.abc123.js"></script><link rel="stylesheet" href="/static/css/main.def456.css">',
    'http://127.0.0.1:5001'
  );
  assert.deepEqual(assets, [
    { url: 'http://127.0.0.1:5001/static/js/main.abc123.js', kind: 'javascript' },
    { url: 'http://127.0.0.1:5001/static/css/main.def456.css', kind: 'stylesheet' }
  ]);
  assert.throws(
    () => getFrontendAssetUrls('<div id="root"></div><script src="https://example.invalid/app.js"></script>', 'http://127.0.0.1:5001'),
    /outside its local static asset directory/
  );
  assert.throws(
    () => getFrontendAssetUrls('<div id="root"></div>', 'http://127.0.0.1:5001'),
    /does not reference its JavaScript application bundle/
  );
});

test('Windows process termination targets only the owned child handle and skips exited children', async () => {
  let killedSignal = null;
  const child = { pid: 4321, exitCode: null, kill(signal) { killedSignal = signal; return true; } };
  const terminated = await terminateChildProcess(child, { platform: 'win32' });
  assert.equal(terminated, true);
  assert.equal(killedSignal, 'SIGTERM');
  assert.equal(await terminateChildProcess({ pid: 4321, exitCode: 0, kill() {
    throw new Error('an exited process must not be signalled');
  } }, { platform: 'win32' }), true);

  let helperOwnedProcessStopped = false;
  const helper = createRestoreHelper({
    platform: 'win32',
    environment: { RESTORE_HELPER_TOKEN: 'test-only-restore-token-that-is-long-enough' }
  });
  const ownedProcess = { pid: 7654, exitCode: null, kill() { helperOwnedProcessStopped = true; return true; } };
  helper.jobs.set('owned-job', { status: 'COMPLETED', child: null, serviceProcess: ownedProcess });
  assert.equal(await helper.shutdown(), true);
  assert.equal(helperOwnedProcessStopped, true);
});

test('Windows prerequisite report detects tool versions and treats pg_dump as optional for restore', async () => {
  const helper = createRestoreHelper({
    platform: 'win32',
    windowsArchitecture: 'x64',
    environment: { RESTORE_HELPER_TOKEN: 'test-only-restore-token-that-is-long-enough' },
    spawn(executable, args) {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      let output = '';
      if (executable === 'powershell.exe') {
        const command = args.at(-1);
        output = command.includes('Win32_OperatingSystem')
          ? JSON.stringify({ Caption: 'Microsoft Windows 11 Pro', Version: '10.0.26200', OSArchitecture: '64-bit' })
          : JSON.stringify([{ Name: 'postgresql-x64-18', Status: 'Running' }]);
      } else if (executable === process.execPath) {
        output = '10.8.2';
      } else {
        output = {
          pg_restore: 'pg_restore (PostgreSQL) 18.1',
          psql: 'psql (PostgreSQL) 18.1',
          pg_dump: ''
        }[executable] || '';
      }
      process.nextTick(() => {
        if (output) child.stdout.write(output);
        child.stdout.end();
        child.stderr.end();
        child.emit('close', executable === 'pg_dump' ? 1 : 0, null);
      });
      return child;
    }
  });

  const prerequisites = await helper.getPrerequisites();
  const byName = new Map(prerequisites.checks.map((check) => [check.name, check]));
  assert.equal(byName.get('Windows version').status, 'ready');
  assert.equal(byName.get('Windows architecture').status, 'ready');
  assert.equal(byName.get('PostgreSQL pg_restore').status, 'ready');
  assert.equal(byName.get('PostgreSQL psql').status, 'ready');
  assert.equal(byName.get('PostgreSQL pg_dump').status, 'optional');
  assert.match(byName.get('PostgreSQL pg_dump').message, /not required to restore/);
  assert.equal(byName.get('Windows PostgreSQL service').status, 'running');
  assert.equal(byName.get('Local PostgreSQL server').status, 'not-configured');
  assert.equal(prerequisites.requiredReady, false);
});

test('restore helper generates a private local application secret when none is configured', async () => {
  const environment = {
    RESTORE_HELPER_TOKEN: 'test-only-restore-token-that-is-long-enough'
  };
  const helper = createRestoreHelper({
    environment,
    spawn() {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      process.nextTick(() => child.emit('close', 1, null));
      return child;
    }
  });

  const prerequisites = await helper.getPrerequisites();
  const secretCheck = prerequisites.checks.find(({ name }) => name === 'Local application secret');
  assert.equal(secretCheck.status, 'ready');
  assert.match(secretCheck.message, /generated by the helper/);
  assert.equal(Object.hasOwn(environment, 'RESTORE_APP_JWT_SECRET'), false);
  assert.equal(JSON.stringify(prerequisites).includes(environment.RESTORE_HELPER_TOKEN), false);
});

test('local port readiness identifies a port conflict without occupying other addresses', async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    assert.equal(await isTcpPortAvailable(port), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  assert.equal(await isTcpPortAvailable(port), true);
});

test('PostgreSQL server addresses accept only strict IPv4 or IPv6 loopback', () => {
  for (const address of ['127.0.0.1', '127.0.0.1/32', '127.255.4.9', '::1', '::1/128']) {
    assert.equal(isLoopbackAddress(address), true, `${address} must be recognized as loopback`);
  }
  for (const address of ['localhost', '192.168.1.10', '0.0.0.0', '::', '::ffff:127.0.0.1', '']) {
    assert.equal(isLoopbackAddress(address), false, `${address} must not be accepted as loopback`);
  }
});

test('restore application database settings accept only loopback hosts and redact no values into config output', () => {
  assert.throws(() => getLocalPostgresSettings({
    RESTORE_APP_DB_HOST: 'db.example.com',
    RESTORE_APP_DB_USER: 'user',
    RESTORE_APP_JWT_SECRET: 'j'.repeat(40)
  }), /must be local/);
  assert.throws(() => getLocalPostgresSettings({
    RESTORE_APP_DB_HOST: 'localhost',
    RESTORE_APP_DB_USER: 'user',
    RESTORE_APP_JWT_SECRET: 'short'
  }), /at least 32 characters/);
  assert.deepEqual(getLocalPostgresSettings({
    RESTORE_APP_DB_HOST: '127.0.0.1',
    RESTORE_APP_DB_PORT: '55432',
    RESTORE_APP_DB_USER: 'restore_user',
    RESTORE_APP_DB_PASSWORD: 'local-only',
    RESTORE_APP_DB_NAME: 'stocksite_local',
    RESTORE_APP_JWT_SECRET: 'j'.repeat(40),
    RESTORE_APP_PORT: '5001'
  }), {
    host: '127.0.0.1',
    port: 55432,
    user: 'restore_user',
    password: 'local-only',
    databaseName: 'stocksite_local',
    jwtSecret: 'j'.repeat(40),
    backendPort: 5001
  });
  assert.equal(getLocalPostgresSettings({
    RESTORE_APP_DB_HOST: 'localhost',
    RESTORE_APP_DB_USER: 'restore_user',
    RESTORE_APP_JWT_SECRET: 'j'.repeat(40)
  }).host, '127.0.0.1');
  assert.equal(dotenvValue('a"b\\c'), '"a\\"b\\\\c"');
});

test('database preflight requires PostgreSQL 18+, a loopback server, matching role ownership, and an empty target', () => {
  const settings = { port: 5432, user: 'stocksite_local' };
  assert.equal(assertEmptyOwnedDatabasePreflight('180000|127.0.0.1|5432|0|stocksite_local|stocksite_local', settings), true);
  assert.throws(() => assertEmptyOwnedDatabasePreflight(
    '180000|192.168.1.10|5432|0|stocksite_local|stocksite_local',
    settings
  ), /loopback host and port/);
  assert.throws(() => assertEmptyOwnedDatabasePreflight(
    '180000|127.0.0.1|5432|0|stocksite_local|another_role',
    settings
  ), /must be owned by the configured dedicated local application role/);
  assert.throws(() => assertEmptyOwnedDatabasePreflight(
    '180000|127.0.0.1|5432|1|stocksite_local|stocksite_local',
    settings
  ), /not empty/);
});

test('restore helper discovers npm-cli.js beside Node or in the sibling global lib directory', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stocksite-restore-npm-'));
  try {
    const nodeExecutable = path.join(root, 'bin', 'node');
    const npmCli = path.join(root, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    await fs.promises.mkdir(path.dirname(npmCli), { recursive: true });
    await fs.promises.writeFile(npmCli, 'module.exports = true;\n');
    assert.equal(resolveNpmCli({}, nodeExecutable), npmCli);

    const configuredCli = path.join(root, 'configured', 'npm-cli.js');
    await fs.promises.mkdir(path.dirname(configuredCli), { recursive: true });
    await fs.promises.writeFile(configuredCli, 'module.exports = true;\n');
    assert.equal(resolveNpmCli({ RESTORE_NPM_CLI: configuredCli }, nodeExecutable), configuredCli);
    assert.equal(resolveNpmCli({}, path.join(root, 'unrelated', 'other', 'node')), null);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('restore archive inventory comparison requires exact file paths and rejects mismatches', () => {
  assert.equal(compareArchiveInventory(
    new Set(['backend/server.js', '.env']),
    new Set(['backend/server.js', '.env']),
    'Website'
  ), true);
  assert.throws(() => compareArchiveInventory(
    new Set(['backend/server.js', 'backend/extra.js']),
    new Set(['backend/server.js', '.env']),
    'Website'
  ), /do not match the verified source inventory/);
});

test('restore promotion refuses an appeared destination and never replaces existing files', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stocksite-restore-promote-'));
  try {
    const stage = path.join(root, 'staging');
    const parent = path.join(root, 'destinations');
    const destination = path.join(parent, 'website');
    await fs.promises.mkdir(path.join(stage, 'nested'), { recursive: true });
    await fs.promises.mkdir(parent);
    await fs.promises.writeFile(path.join(stage, 'nested', 'file.txt'), 'staged');
    await fs.promises.mkdir(destination);
    await fs.promises.writeFile(path.join(destination, 'existing.txt'), 'keep');
    const created = [];
    await assert.rejects(
      promoteStagedDirectory(stage, destination, undefined, (createdPath) => created.push(createdPath)),
      /no existing path was replaced/
    );
    assert.deepEqual(created, []);
    assert.equal(await fs.promises.readFile(path.join(destination, 'existing.txt'), 'utf8'), 'keep');

    await fs.promises.rm(destination, { recursive: true });
    await promoteStagedDirectory(stage, destination, undefined, (createdPath) => created.push(createdPath));
    assert.deepEqual(created, [path.join(await fs.promises.realpath(parent), 'website')]);
    assert.equal(await fs.promises.readFile(path.join(destination, 'nested', 'file.txt'), 'utf8'), 'staged');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('restore cannot report success when a required health or launch task is incomplete', () => {
  const requiredTasks = [
    { name: 'Backend health check', required: true, status: 'COMPLETED' },
    { name: 'Website launch', required: true, status: 'SKIPPED' },
    { name: 'Optional Git install', required: false, status: 'SKIPPED' }
  ];
  assert.throws(() => assertRequiredRestoreTasksComplete(requiredTasks), /Website launch/);
  requiredTasks[1].status = 'COMPLETED';
  assert.doesNotThrow(() => assertRequiredRestoreTasksComplete(requiredTasks));
});

test('lifecycle schema readiness fails closed and never applies migrations', () => {
  assert.equal(assertLifecycleSchemaReady({ ready: true, missing: [] }), true);
  assert.throws(
    () => assertLifecycleSchemaReady({ ready: false, missing: ['table asset_lifecycle_operations'] }),
    /table asset_lifecycle_operations.*migration\(s\): 029.*No migrations were applied/
  );
  assert.throws(
    () => assertLifecycleSchemaReady({ ready: false, missing: ['column asset_thumbnail_metadata.status'] }),
    /migration\(s\): 028/
  );
  assert.throws(
    () => assertLifecycleSchemaReady(null),
    /schema readiness query failed/
  );
});

test('backend startup approval discloses migration and authentication-session effects', async () => {
  const helper = createRestoreHelper({
    environment: {
      RESTORE_HELPER_TOKEN: 'startup-disclosure-test-token-long-enough',
      RESTORE_APP_DB_HOST: '127.0.0.1',
      RESTORE_APP_DB_USER: 'restore_test',
      RESTORE_APP_JWT_SECRET: 'j'.repeat(40)
    }
  });
  const task = { id: 'launch-backend', name: 'Start backend', status: 'WAITING', required: true };
  const job = {
    id: 'startup-disclosure',
    status: 'RUNNING',
    cancelRequested: false,
    approvalHistory: [],
    softwareTasks: [],
    tasks: [task],
    configuration: {
      sources: {
        databaseFile: '/package/stocksite.backup',
        websiteArchive: '/package/website-code.zip',
        assetsArchive: '/package/original-assets.zip',
        thumbnailsArchive: '/package/thumbnails.zip'
      },
      destinations: {
        databaseName: 'restore_test',
        websiteDestination: '/restore/site',
        assetsDestination: '/restore/assets',
        thumbnailsDestination: '/restore/thumbnails'
      }
    },
    tasksById: { 'launch-backend': task }
  };
  const approval = helper.requestApproval(job, 'launch-backend');
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(job.awaitingApproval.impact, /migrations.*002–027/i);
  assert.match(job.awaitingApproval.impact, /clears auth_sessions, signing out restored sessions/i);
  job.cancelRequested = true;
  job.resolveApproval(false);
  await assert.rejects(approval, /Restore was cancelled before the action started/);
});

test('restore helper lists macOS and Windows ZIP file entries while ignoring directory entries', async () => {
  for (const platform of ['darwin', 'win32']) {
    await withExtractionFixture([
      { name: 'backend/', mode: 0o040755 },
      { name: 'backend/migrations/', mode: 0o040755 },
      { name: 'backend/migrations/029.sql', content: 'migration' }
    ], async ({ helper, archivePath }) => {
      assert.deepEqual(await helper.listArchiveFiles(archivePath), new Set(['backend/migrations/029.sql']));
    }, platform);
  }
});

test('restore ZIP listing turns unsafe entries and process failures into rejected promises', async () => {
  await withExtractionFixture([{ name: '../outside', content: '' }], async ({ helper, archivePath }) => {
    await assert.rejects(helper.listArchiveFiles(archivePath), /Unsafe archive entry path|invalid relative path/);
  });
  await withExtractionFixture([
    { name: 'folder/', mode: 0o040755 },
    { name: 'folder/', mode: 0o040755 }
  ], async ({ helper, archivePath }) => {
    await assert.rejects(helper.listArchiveFiles(archivePath), /duplicate entry path/);
  });
  await withExtractionFixture([{ name: 'link', content: '', mode: 0o120777 }], async ({ helper, archivePath }) => {
    await assert.rejects(helper.listArchiveFiles(archivePath), /unsafe symbolic link or special file/);
  });
  const helper = createRestoreHelper({ environment: { RESTORE_HELPER_TOKEN: 'test-only-restore-token-that-is-long-enough' } });
  await assert.rejects(helper.listArchiveFiles(path.join(os.tmpdir(), 'missing-stocksite-fixture.zip')));
});

test('restore helper streams ZIP contents and verifies inventory before reporting extraction complete', async () => {
  const content = 'safe application source';
  await withExtractionFixture([
    { name: 'backend/', mode: 0o040755 },
    { name: 'backend/server.js', content }
  ], async ({ helper, archivePath, destination, task, job }) => {
    await helper.extractArchive({
      archivePath,
      destination,
      expectedFiles: [inventoryItem('backend/server.js', content)],
      job,
      task
    });
    assert.equal(await fs.promises.readFile(path.join(destination, 'backend', 'server.js'), 'utf8'), content);
    assert.equal(task.status, 'COMPLETED');
    assert.equal(task.filesCompleted, 1);
    assert.equal(task.bytesCompleted, Buffer.byteLength(content));
  });
});

test('restore extraction supports source and destination paths containing spaces', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stocksite restore paths with spaces-'));
  const archivePath = path.join(root, 'package files', 'website-code.zip');
  const destination = path.join(root, 'restored site with spaces');
  const content = 'module.exports = true;\n';
  const task = { id: 'extract-spaces', name: 'Extract spaced path', status: 'WAITING' };
  const job = { softwareTasks: [], tasks: [task], logs: [], cancelRequested: false };
  const helper = createRestoreHelper({
    environment: { RESTORE_HELPER_TOKEN: 'path-with-spaces-test-token-at-least-32' },
    platform: 'win32'
  });
  try {
    await fs.promises.mkdir(path.dirname(archivePath), { recursive: true });
    await fs.promises.mkdir(destination);
    await fs.promises.writeFile(archivePath, makeZip([{ name: 'backend/server.js', content }]));
    const canonicalArchivePath = await fs.promises.realpath(archivePath);
    const canonicalDestination = await fs.promises.realpath(destination);
    await helper.extractArchive({
      archivePath: canonicalArchivePath,
      destination: canonicalDestination,
      expectedFiles: [inventoryItem('backend/server.js', content)],
      job,
      task
    });
    assert.equal(await fs.promises.readFile(path.join(canonicalDestination, 'backend', 'server.js'), 'utf8'), content);
    assert.equal(task.status, 'COMPLETED');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('restore extraction rejects checksum mismatch, duplicate paths, traversal, and symlinks', async () => {
  const content = 'expected content';
  await withExtractionFixture([{ name: 'file.txt', content }], async ({ helper, archivePath, destination, task, job }) => {
    await assert.rejects(helper.extractArchive({
      archivePath,
      destination,
      expectedFiles: [inventoryItem('file.txt', 'different content')],
      job,
      task
    }), /size or uniqueness|checksum/);
    assert.notEqual(task.status, 'COMPLETED');
    assert.deepEqual(await fs.promises.readdir(destination), []);
  });

  await withExtractionFixture([
    { name: 'duplicate.txt', content },
    { name: 'duplicate.txt', content }
  ], async ({ helper, archivePath, destination, task, job }) => {
    await assert.rejects(helper.extractArchive({
      archivePath,
      destination,
      expectedFiles: [inventoryItem('duplicate.txt', content)],
      job,
      task
    }), /duplicate entry path/);
  });

  await withExtractionFixture([
    { name: 'first.txt', content: 'first' },
    { name: 'second.txt', content: 'second' }
  ], async ({ helper, archivePath, destination, task, job }) => {
    await assert.rejects(helper.extractArchive({
      archivePath,
      destination,
      expectedFiles: [inventoryItem('first.txt', 'first'), inventoryItem('second.txt', 'tamper')],
      job,
      task
    }), /checksum/);
    assert.equal(await fs.promises.readFile(path.join(destination, 'first.txt'), 'utf8'), 'first');
    assert.notEqual(task.status, 'COMPLETED');
  });

  await withExtractionFixture([{ name: '../escape.txt', content }], async ({ helper, archivePath, destination, task, job }) => {
    await assert.rejects(helper.extractArchive({
      archivePath,
      destination,
      expectedFiles: [inventoryItem('../escape.txt', content)],
      job,
      task
    }), /Unsafe archive entry path/);
  });

  await withExtractionFixture([{ name: 'link', content, mode: 0o120777 }], async ({ helper, archivePath, destination, task, job }) => {
    await assert.rejects(helper.extractArchive({
      archivePath,
      destination,
      expectedFiles: [inventoryItem('link', content)],
      job,
      task
    }), /unsafe symbolic link or special file/);
  });

  await withExtractionFixture([
    { name: 'A.txt', content },
    { name: 'a.txt', content }
  ], async ({ helper, archivePath, destination, task, job }) => {
    await assert.rejects(helper.extractArchive({
      archivePath,
      destination,
      expectedFiles: [inventoryItem('A.txt', content), inventoryItem('a.txt', content)],
      job,
      task
    }), /colliding paths for this platform/);
  }, 'win32');
});

test('restore extraction verifies but never installs encrypted environment files', async () => {
  const encryptedPayload = 'GFXENV1\\nprivate encrypted payload';
  await withExtractionFixture([{ name: 'backend/.env', content: encryptedPayload }], async ({ helper, archivePath, destination, task, job }) => {
    await helper.extractArchive({
      archivePath,
      destination,
      expectedFiles: [inventoryItem('backend/.env', encryptedPayload)],
      protectedPaths: new Set(['backend/.env']),
      job,
      task
    });
    await assert.rejects(fs.promises.access(path.join(destination, 'backend', '.env')));
    assert.equal(task.status, 'COMPLETED');
    assert.ok(!JSON.stringify(job.logs).includes('private encrypted payload'));
  });
});

test('restore extraction refuses overwrites, destination symlink races, cancellation, and corrupt archives', async () => {
  const content = 'safe';
  await withExtractionFixture([{ name: 'file.txt', content }], async ({ helper, archivePath, destination, task, job }) => {
    await fs.promises.writeFile(path.join(destination, 'file.txt'), 'keep existing');
    await assert.rejects(helper.extractArchive({
      archivePath,
      destination,
      expectedFiles: [inventoryItem('file.txt', content)],
      job,
      task
    }), /refusing to overwrite/);
    assert.equal(await fs.promises.readFile(path.join(destination, 'file.txt'), 'utf8'), 'keep existing');
  });

  await withExtractionFixture([{ name: 'nested/file.txt', content }], async ({ helper, archivePath, destination, task, job, root }) => {
    const outside = path.join(root, 'outside');
    await fs.promises.mkdir(outside);
    await fs.promises.symlink(outside, path.join(destination, 'nested'));
    await assert.rejects(helper.extractArchive({
      archivePath,
      destination,
      expectedFiles: [inventoryItem('nested/file.txt', content)],
      job,
      task
    }), /safe, real directory/);
    assert.deepEqual(await fs.promises.readdir(outside), []);
  });

  await withExtractionFixture([{ name: 'file.txt', content }], async ({ helper, archivePath, destination, task, job }) => {
    job.cancelRequested = true;
    await assert.rejects(helper.extractArchive({
      archivePath,
      destination,
      expectedFiles: [inventoryItem('file.txt', content)],
      job,
      task
    }), /cancelled by administrator/);
    assert.notEqual(task.status, 'COMPLETED');
  });

  await withExtractionFixture([{ name: 'file.txt', content }], async ({ helper, archivePath, destination, task, job }) => {
    const bytes = await fs.promises.readFile(archivePath);
    bytes[38] ^= 0xff;
    await fs.promises.writeFile(archivePath, bytes);
    await assert.rejects(helper.extractArchive({
      archivePath,
      destination,
      expectedFiles: [inventoryItem('file.txt', content)],
      job,
      task
    }));
    assert.notEqual(task.status, 'COMPLETED');
  });
});

test('authenticated local configuration accepts only loopback settings and never returns supplied secrets', async () => {
  const token = 'local-configuration-test-token-at-least-32';
  const keyPair = crypto.generateKeyPairSync('ed25519');
  const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const password = 'synthetic-local-database-password';
  const helper = createRestoreHelper({
    environment: { RESTORE_HELPER_TOKEN: token },
    platform: 'win32',
    windowsArchitecture: 'x64',
    spawn(executable, args) {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      let output = '';
      let exitCode = 0;
      if (executable === 'powershell.exe') {
        output = args.at(-1).includes('Win32_OperatingSystem')
          ? JSON.stringify({ Caption: 'Microsoft Windows 11 Pro', Version: '10.0.26200', OSArchitecture: '64-bit' })
          : JSON.stringify([{ Name: 'postgresql-x64-18', Status: 'Running' }]);
      } else if (executable === process.execPath) {
        output = '10.8.2';
      } else if (executable === 'pg_restore') {
        output = 'pg_restore (PostgreSQL) 18.1';
      } else if (executable === 'psql' && args[0] === '--version') {
        output = 'psql (PostgreSQL) 18.1';
      } else if (executable === 'psql') {
        output = '180000|127.0.0.1|5432|0|stocksite_local|stocksite_local';
      } else if (executable === 'pg_dump') {
        exitCode = 1;
      }
      process.nextTick(() => {
        if (output) child.stdout.write(output);
        child.stdout.end();
        child.stderr.end();
        child.emit('close', exitCode, null);
      });
      return child;
    }
  });
  const server = http.createServer((req, res) => void helper.handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const configure = (body) => fetch(`${baseUrl}/api/configure`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  try {
    const unauthorized = await fetch(`${baseUrl}/api/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(unauthorized.status, 401);

    const rejectedOrigin = await fetch(`${baseUrl}/api/configure`, {
      method: 'POST',
      headers: {
        Authorization: `******`,
        Origin: 'http://untrusted.example',
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    assert.equal(rejectedOrigin.status, 403);

    const missingTrustResponse = await configure({
      databaseHost: '127.0.0.1',
      databasePort: '5432',
      databaseUser: 'stocksite_local',
      databasePassword: password,
      databaseName: 'stocksite_local',
      applicationPort: '5018'
    });
    assert.equal(missingTrustResponse.status, 422);
    const missingTrustText = await missingTrustResponse.text();
    assert.match(missingTrustText, /trusted Ed25519 public key is required/);
    assert.doesNotMatch(missingTrustText, new RegExp(password));

    const validResponse = await configure({
      databaseHost: '127.0.0.1',
      databasePort: '5432',
      databaseUser: 'stocksite_local',
      databasePassword: password,
      databaseName: 'stocksite_local',
      applicationPort: '5018',
      packageSigningPublicKey: publicKey
    });
    assert.equal(validResponse.status, 200);
    const responseText = await validResponse.text();
    assert.doesNotMatch(responseText, new RegExp(password));
    assert.doesNotMatch(responseText, new RegExp(publicKey));
    assert.match(responseText, /generated-local-only/);
    assert.match(responseText, /"trustedPackageKeyConfigured":true/);
    const prerequisites = await helper.getPrerequisites();
    assert.equal(prerequisites.checks.find(({ name }) => name === 'Local PostgreSQL server').status, 'ready');
    assert.equal(prerequisites.checks.find(({ name }) => name === 'Package signing trust key').status, 'ready');

    const remoteResponse = await configure({
      databaseHost: 'db.example.invalid',
      databasePort: '5432',
      databaseUser: 'stocksite_local',
      databasePassword: password,
      databaseName: 'stocksite_local',
      applicationPort: '5018',
      packageSigningPublicKey: publicKey
    });
    assert.equal(remoteResponse.status, 422);
    assert.doesNotMatch(await remoteResponse.text(), new RegExp(password));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await helper.shutdown();
  }
});

test('configuration and restore start locks cover asynchronous request bodies', async () => {
  const token = 'configuration-lock-test-token-at-least-32';
  const helper = createRestoreHelper({ environment: { RESTORE_HELPER_TOKEN: token } });
  const server = http.createServer((req, res) => void helper.handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const startPending = (endpoint, body) => {
    const bytes = Buffer.from(body);
    let resolveResponse;
    const response = new Promise((resolve) => { resolveResponse = resolve; });
    const request = http.request(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: ['Bearer', token].join(' '),
        'Content-Type': 'application/json',
        'Content-Length': bytes.length
      }
    }, (res) => {
      res.resume();
      res.on('end', () => resolveResponse(res.statusCode));
    });
    request.write(bytes.subarray(0, 1));
    return {
      response,
      finish() { request.end(bytes.subarray(1)); }
    };
  };
  const waitForRequestHandling = () => new Promise((resolve) => setTimeout(resolve, 20));

  try {
    const pendingConfiguration = startPending('/api/configure', '{}');
    await waitForRequestHandling();
    const competingStart = await fetch(`${baseUrl}/api/start`, {
      method: 'POST',
      headers: { Authorization: ['Bearer', token].join(' '), 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(competingStart.status, 409);
    pendingConfiguration.finish();
    assert.equal(await pendingConfiguration.response, 422);

    const pendingStart = startPending('/api/start', '{}');
    await waitForRequestHandling();
    const competingConfiguration = await fetch(`${baseUrl}/api/configure`, {
      method: 'POST',
      headers: { Authorization: ['Bearer', token].join(' '), 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(competingConfiguration.status, 409);
    pendingStart.finish();
    assert.equal(await pendingStart.response, 422);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await helper.shutdown();
  }
});

test('local helper serves the wizard and enforces authenticated restore actions', async () => {
  const manifestPath = path.resolve(__dirname, '..', 'restore-manifest.json');
  const token = 'test-only-restore-token-that-is-long-enough';
  const helper = createRestoreHelper({
    manifestPath,
    environment: {
      RESTORE_HELPER_TOKEN: token,
      RESTORE_UI_ORIGIN: 'http://localhost:3000',
      RESTORE_HELPER_PORT: '43127'
    }
  });

  test('restore actions require individual explicit approval and stop when approval is denied', async () => {
    const token = 'approval-test-token-that-is-long-enough';
    const helper = createRestoreHelper({
      environment: {
        RESTORE_HELPER_TOKEN: token,
        RESTORE_APP_DB_HOST: '127.0.0.1',
        RESTORE_APP_DB_PORT: '55418',
        RESTORE_APP_DB_USER: 'restore_test',
        RESTORE_APP_JWT_SECRET: 'j'.repeat(40),
        RESTORE_APP_PORT: '55101'
      }
    });
    const server = http.createServer((req, res) => void helper.handle(req, res));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const call = async (jobId, body) => fetch(`${baseUrl}/api/jobs/${jobId}/approval`, {
      method: 'POST',
      headers: {
        Authorization: `******`,
        'Content-Type': 'application/json',
        ...{ Authorization: ['Bearer', token].join(' ') }
      },
      body: JSON.stringify(body)
    });
    const makeJob = (id, taskId) => {
      const task = { id: taskId, name: taskId, status: 'WAITING', required: true };
      const job = {
        id,
        status: 'RUNNING',
        startedAt: new Date().toISOString(),
        completedAt: null,
        elapsedMs: null,
        error: null,
        logs: [],
        launchUrl: null,
        configuration: {
          sources: { databaseFile: '/package/stocksite.backup', websiteArchive: '/package/website-code.zip', assetsArchive: '/package/original-assets.zip', thumbnailsArchive: '/package/thumbnails.zip' },
          destinations: { databaseName: 'restore_test', websiteDestination: '/restore/site', assetsDestination: '/restore/assets', thumbnailsDestination: '/restore/thumbs' }
        },
        softwareTasks: [],
        tasks: [task],
        tasksById: { [taskId]: task },
        cancelRequested: false,
        approvalHistory: [],
        awaitingApproval: null,
        resolveApproval: null
      };
      helper.jobs.set(id, job);
      return { job, task };
    };

    try {
      const approvedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const approved = makeJob(approvedId, 'build-frontend');
      const approvedOperation = helper.requestApproval(approved.job, 'build-frontend');
      const wrongAction = await call(approvedId, { actionId: 'restore-postgresql-custom-archive', approved: true });
      assert.equal(wrongAction.status, 422);
      const approvedResponse = await call(approvedId, { actionId: 'build-frontend', approved: true });
      assert.equal(approvedResponse.status, 202);
      await approvedOperation;
      assert.equal(approved.job.approvalHistory[0].decision, 'approved');
      assert.equal(approved.job.awaitingApproval, null);

      const deniedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const denied = makeJob(deniedId, 'restore-postgresql-custom-archive');
      const deniedOperation = helper.requestApproval(denied.job, 'restore-postgresql-custom-archive');
      const deniedAssertion = assert.rejects(deniedOperation, /Action not approved.*Completed database or destination work is not deleted/);
      const deniedResponse = await call(deniedId, { actionId: 'restore-postgresql-custom-archive', approved: false });
      assert.equal(deniedResponse.status, 202);
      await deniedAssertion;
      assert.equal(denied.job.cancelRequested, true);
      assert.equal(denied.task.status, 'CANCELLED');
      assert.equal(denied.job.approvalHistory[0].decision, 'declined');

      const cancelledId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const cancelled = makeJob(cancelledId, 'install-backend-dependencies');
      const cancelledOperation = helper.requestApproval(cancelled.job, 'install-backend-dependencies');
      const cancellationAssertion = assert.rejects(cancelledOperation, /Restore was cancelled before the action started/);
      const cancellationResponse = await fetch(`${baseUrl}/api/jobs/${cancelledId}/cancel`, {
        method: 'POST',
        headers: { Authorization: ['Bearer', token].join(' ') }
      });
      assert.equal(cancellationResponse.status, 202);
      await cancellationAssertion;
      assert.equal(cancelled.task.status, 'CANCELLED');
      assert.equal(cancelled.job.approvalHistory[0].decision, 'cancelled');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  const server = http.createServer((req, res) => void helper.handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await fetch(`${baseUrl}/`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Stocksite Restore Wizard/);

    const unauthorized = await fetch(`${baseUrl}/api/manifest`);
    assert.equal(unauthorized.status, 401);

    const manifestResponse = await fetch(`${baseUrl}/api/manifest`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(manifestResponse.status, 200);
    const { manifest, source } = await manifestResponse.json();
    assert.equal(source, 'bundled-fallback');
    assert.ok(Array.isArray(manifest.software));
    assert.ok(manifest.software.some(({ id }) => id === 'vscode'));
    assert.ok(manifest.software.some(({ id }) => id === 'pgadmin'));

    const prerequisitesResponse = await fetch(`${baseUrl}/api/prerequisites`, {
      headers: { Authorization: ['Bearer', token].join(' ') }
    });
    assert.equal(prerequisitesResponse.status, 200);
    const prerequisitePayload = await prerequisitesResponse.json();
    assert.ok(prerequisitePayload.prerequisites.checks.some(({ name }) => name === 'Local PostgreSQL server'));
    assert.ok(prerequisitePayload.prerequisites.checks.some(({ name }) => name === 'Local application port'));
    assert.equal(JSON.stringify(prerequisitePayload).includes(token), false);

    const completedId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    helper.jobs.set(completedId, {
      id: completedId,
      status: 'COMPLETED',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      softwareTasks: [],
      tasks: [],
      approvalHistory: [],
      logs: [],
      launchUrl: 'http://127.0.0.1:5001/'
    });
    const completedResponse = await fetch(`${baseUrl}/api/jobs/${completedId}`, {
      headers: { Authorization: ['Bearer', token].join(' ') }
    });
    assert.equal(completedResponse.status, 200);
    const completedPayload = await completedResponse.json();
    assert.ok(completedPayload.job.finalReport.notVerified.includes(
      'Redis-backed thumbnail queue readiness and background processing'
    ));

    const cancellationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    let childKilled = false;
    helper.jobs.set(cancellationId, {
      id: cancellationId,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      completedAt: null,
      elapsedMs: null,
      error: null,
      logs: [],
      softwareTasks: [],
      tasks: [],
      child: { kill(signal) { assert.equal(signal, 'SIGTERM'); childKilled = true; } },
      cancelRequested: false
    });
    const cancellation = await fetch(`${baseUrl}/api/jobs/${cancellationId}/cancel`, {
      method: 'POST',
      headers: { Authorization: ['Bearer', token].join(' ') }
    });
    assert.equal(cancellation.status, 202);
    assert.equal(childKilled, true);
    assert.equal(helper.jobs.get(cancellationId).cancelRequested, true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
