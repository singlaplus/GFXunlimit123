const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { test } = require('node:test');
const {
  SAFETY_RATIO,
  assertSafeDestination,
  createBackupService,
  getFsCapacity,
  getLocalDateKey,
  getNextScheduleDate,
  isEnvironmentFile,
  isScheduledMinute,
  normalizeAutomaticSchedule,
  normalizeCategories,
  pathsOverlap,
  planLogicalGroups,
  selectRollingFolder
} = require('../services/backupSystem');

function makeProjectRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-project-'));
  for (const directory of ['backend', 'frontend/src', 'frontend/public', 'frontend/scripts', 'scripts', 'GFX-Aanav']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(root, 'README.md'), '# Stocksite setup\n');
  fs.writeFileSync(path.join(root, '.npmrc'), 'audit=false\n');
  fs.writeFileSync(path.join(root, '.env'), 'DATABASE_PASSWORD=backup-private-value\n');
  fs.writeFileSync(path.join(root, '.env.local'), 'LOCAL_TOKEN=another-private-value\n');
  fs.writeFileSync(path.join(root, '.env.example'), 'DATABASE_PASSWORD=replace-me\n');
  fs.writeFileSync(path.join(root, 'backend', '.env'), 'JWT_SECRET=backend-private-value\n');
  fs.writeFileSync(path.join(root, 'backend', '.env.example'), 'JWT_SECRET=replace-me\n');
  fs.writeFileSync(path.join(root, 'backend', 'server.js'), 'module.exports = true;\n');
  fs.writeFileSync(path.join(root, 'backend', 'uploads-sample.log'), 'runtime log\n');
  fs.writeFileSync(path.join(root, 'frontend', 'package.json'), '{"name":"frontend"}');
  fs.writeFileSync(path.join(root, 'frontend', 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(root, 'frontend', 'src', 'App.js'), 'export default function App() { return null; }\n');
  fs.writeFileSync(path.join(root, 'frontend', 'public', 'index.html'), '<main></main>');
  fs.writeFileSync(path.join(root, 'frontend', 'scripts', 'sync-fonts.js'), 'module.exports = true;\n');
  fs.writeFileSync(path.join(root, 'scripts', 'deploy.js'), 'module.exports = true;\n');
  fs.writeFileSync(path.join(root, 'GFX-Aanav', 'config.json'), '{}');
  fs.mkdirSync(path.join(root, 'backend', 'node_modules'));
  fs.writeFileSync(path.join(root, 'backend', 'node_modules', 'ignored.js'), 'ignored');
  fs.writeFileSync(path.join(root, 'backend', 'Thumbs.db'), 'os metadata');
  fs.writeFileSync(path.join(root, 'backend', 'desktop.ini'), 'os metadata');
  fs.writeFileSync(path.join(root, 'backend', 'credentials.json'), '{"apiToken":"do-not-package"}\n');
  fs.writeFileSync(path.join(root, 'backend', 'runtime-config.json'), '{"apiToken":"DO_NOT_PACKAGE_SECRET_VALUE"}\n');
  fs.writeFileSync(path.join(root, 'backend', '.npmrc'), '//registry.example/:_authToken=do-not-package\n');
  return root;
}

function makeFakeDatabase(dataDirectory) {
  return {
    async query(sql) {
      if (sql.includes('current_database()')) {
        return {
          rows: [{
            database_name: 'stocksite',
            server_version: 'PostgreSQL 18.6 (test)',
            data_directory: dataDirectory,
            size_bytes: '1024'
          }]
        };
      }
      if (sql.includes('FROM users')) {
        return { rows: [{ username: 'rahul', full_name: 'Rahul Sharma' }] };
      }
      throw new Error(`Unexpected database query: ${sql}`);
    }
  };
}

function successfulRestoreSpawner() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  process.nextTick(() => {
    child.stdout.end('; Archive created at 2026-10-11\n; Dump Version: 1.16-0\n; Format: CUSTOM\n; Selected TOC Entries:\n1; 0 0 DATABASE - stocksite\n');
    child.emit('close', 0, null);
  });
  return child;
}

function makeService({
  projectRoot,
  stateDirectory,
  clientExportRoot,
  environment,
  spawn,
  spawnRestore = successfulRestoreSpawner,
  spawnSync,
  pgRestoreListTimeoutMs,
  useDefaultEncryptionKey = true
} = {}) {
  const dataDirectory = path.join(projectRoot, 'postgres-data');
  fs.mkdirSync(dataDirectory, { recursive: true });
  return createBackupService({
    projectRoot,
    stateDirectory,
    clientExportRoot,
    database: makeFakeDatabase(dataDirectory),
    environment: useDefaultEncryptionKey
      ? { DB_HOST: 'test-postgres', DB_NAME: 'stocksite', ...environment, BACKUP_ENCRYPTION_KEY: environment?.BACKUP_ENCRYPTION_KEY || '11'.repeat(32) }
      : { DB_HOST: 'test-postgres', DB_NAME: 'stocksite', ...environment },
    spawnSync: spawnSync || (() => ({ status: 0, stdout: 'pg_dump (PostgreSQL) 18.6\n' })),
    spawn,
    spawnRestore,
    pgRestoreListTimeoutMs
  });
}

async function waitForTerminalJob(service, id) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const job = await service.getJob(id);
    if (job && job.status !== 'RUNNING') return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Backup job did not reach a terminal state.');
}

test('the fixed capacity safety limit is 90 percent of real filesystem capacity', () => {
  const stats = getFsCapacity('/backup', {
    statfsSync: () => ({ bsize: 1024, blocks: 1000, bavail: 500 })
  });
  assert.equal(SAFETY_RATIO, 0.9);
  assert.equal(stats.totalBytes, 1024_000);
  assert.equal(stats.availableBytes, 512_000);
  assert.equal(stats.usedBytes, 512_000);
  assert.equal(stats.safetyLimitBytes, 921_600);
  assert.equal(stats.usableBackupBytes, 409_600);
});

test('logical group planner never splits a group and reports unplaced group sizes', () => {
  const plan = planLogicalGroups(
    [
      { key: 'rahul', label: 'Rahul', sizeBytes: 80 },
      { key: 'suman', label: 'Suman', sizeBytes: 60 },
      { key: 'thumbnails', label: 'Thumbnails 2026/10', sizeBytes: 30 }
    ],
    [
      { path: 'drive-1', usableBackupBytes: 100 },
      { path: 'drive-2', usableBackupBytes: 50 }
    ]
  );
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.allocations.map((drive) => drive.groups.map((group) => group.key)), [
    ['rahul'],
    ['thumbnails']
  ]);
  assert.deepEqual(plan.unplaced.map(({ key, requiredBytes }) => [key, requiredBytes]), [['suman', 60]]);
  assert.equal(plan.additionalSafeCapacityRequired, 60);
});

test('logical group planner places large complete groups first to avoid avoidable capacity failures', () => {
  const plan = planLogicalGroups(
    [
      { key: 'small-a', sizeBytes: 4 },
      { key: 'small-b', sizeBytes: 4 },
      { key: 'large-a', sizeBytes: 6 },
      { key: 'large-b', sizeBytes: 6 }
    ],
    [
      { path: 'drive-1', usableBackupBytes: 10 },
      { path: 'drive-2', usableBackupBytes: 10 }
    ]
  );
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.allocations.map((drive) => drive.groups.map((group) => group.key)), [
    ['large-a', 'small-a'],
    ['large-b', 'small-b']
  ]);
});

test('backup category validation accepts only the three complete categories', () => {
  assert.deepEqual(normalizeCategories(['database', 'websiteCode', 'assetsAndThumbnails']), [
    'database', 'websiteCode', 'assetsAndThumbnails'
  ]);
  assert.throws(() => normalizeCategories(['incremental']), /Backup categories/);
  assert.equal(isEnvironmentFile('backend/.env.production'), true);
  assert.equal(isEnvironmentFile('.env.example'), false);
  assert.equal(isEnvironmentFile('backend/.env.template.local'), false);
  assert.equal(isEnvironmentFile('backend/settings.json'), false);
});

test('PostgreSQL 18 backups require pg_dump 18 or newer', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-pgdump-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-pgdump-state-'));
  try {
    for (const [version, available] of [['17.6', false], ['18.0', true], ['19.1', true]]) {
      const resolvedExecutables = [];
      const service = makeService({
        projectRoot,
        stateDirectory: path.join(stateDirectory, version),
        environment: { PG_DUMP_PATH: 'C:\\configured\\postgres\\bin\\pg_dump.exe' },
        spawnSync: (executable) => {
          resolvedExecutables.push(executable);
          return { status: 0, stdout: `pg_dump (PostgreSQL) ${version}\n` };
        }
      });
      const plan = await service.buildPlan({ categories: ['database'], destinations: [destination] });
      assert.ok(resolvedExecutables.includes('C:\\configured\\postgres\\bin\\pg_dump.exe'));
      assert.ok(resolvedExecutables.includes('C:\\configured\\postgres\\bin\\pg_restore.exe'));
      assert.equal(plan.database.pgDump.available, available);
      assert.equal(plan.database.pgRestore.available, available);
      if (!available) assert.match(plan.issues.join(' '), /install pg_dump 18 or newer/);
    }
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('pg_restore must be compatible with the archive-producing pg_dump version', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-restore-version-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  const service = makeService({
    projectRoot,
    stateDirectory,
    environment: { PG_DUMP_PATH: '/opt/postgresql/bin/pg_dump', PG_RESTORE_PATH: '/opt/postgresql-18/bin/pg_restore' },
    spawnSync: (executable) => ({
      status: 0,
      stdout: executable.endsWith('pg_dump')
        ? 'pg_dump (PostgreSQL) 19.1\n'
        : 'pg_restore (PostgreSQL) 18.6\n'
    })
  });
  try {
    const plan = await service.buildPlan({ categories: ['database'], destinations: [destination] });
    assert.equal(plan.database.pgDump.available, true);
    assert.equal(plan.database.pgRestore.available, false);
    assert.match(plan.database.pgRestore.error, /pg_restore 18 cannot validate PostgreSQL 18 backups created by pg_dump 19/);
    assert.equal(plan.ready, false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('backup planning refuses implicit local database defaults', async () => {
  const projectRoot = makeProjectRoot();
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-no-db-target-'));
  let queryCount = 0;
  const service = createBackupService({
    projectRoot,
    stateDirectory,
    database: {
      async query() {
        queryCount += 1;
        return { rows: [] };
      }
    },
    environment: {}
  });
  try {
    const sources = await service.getSourceMetrics();
    assert.equal(sources.database.available, false);
    assert.match(sources.database.error, /DB_HOST \(or PGHOST\) and DB_NAME \(or PGDATABASE\) must be explicitly configured/);
    assert.equal(queryCount, 0);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('assets and thumbnails planning never falls back locally and rejects missing storage roots', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-missing-assets-destination-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-missing-assets-state-'));
  const inaccessibleRoot = path.join(stateDirectory, 'not-a-directory');
  const thumbnailRoot = path.join(stateDirectory, 'thumbnails');
  fs.writeFileSync(inaccessibleRoot, 'not a directory');
  fs.mkdirSync(thumbnailRoot);
  try {
    const missingService = makeService({
      projectRoot,
      stateDirectory: path.join(stateDirectory, 'missing'),
      environment: {}
    });
    const missingPlan = await missingService.buildPlan({
      categories: ['assetsAndThumbnails'],
      destinations: [destination]
    });
    assert.equal(missingPlan.ready, false);
    assert.equal(missingPlan.sourceRoots.originalAssets, null);
    assert.equal(missingPlan.sourceRoots.thumbnails, null);
    assert.match(missingPlan.issues.join(' '), /ASSETS_ROOT must point to the production original asset root/);
    assert.match(missingPlan.issues.join(' '), /THUMBNAIL_STORAGE_PATH must point to the centralized production thumbnail root/);
    assert.match(missingPlan.issues.join(' '), /backend\/uploads fallback is not used/i);

    const inaccessibleService = makeService({
      projectRoot,
      stateDirectory: path.join(stateDirectory, 'inaccessible'),
      environment: { ASSETS_ROOT: inaccessibleRoot, THUMBNAIL_STORAGE_PATH: thumbnailRoot }
    });
    const inaccessiblePlan = await inaccessibleService.buildPlan({
      categories: ['assetsAndThumbnails'],
      destinations: [destination]
    }).catch((error) => ({ error: error.message }));
    assert.match(inaccessiblePlan.error || inaccessiblePlan.issues.join(' '), /destination|not a directory|source/i);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('Website Code planning fails clearly when environment-file encryption key is missing', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-encryption-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-encryption-state-'));
  const service = makeService({
    projectRoot,
    stateDirectory,
    environment: {},
    useDefaultEncryptionKey: false
  });
  try {
    const plan = await service.buildPlan({ categories: ['websiteCode'], destinations: [destination] });
    assert.equal(plan.ready, false);
    assert.equal(
      plan.issues.filter((issue) => issue.includes('BACKUP_ENCRYPTION_KEY')).length,
      1
    );
    assert.match(plan.issues.join(' '), /requires BACKUP_ENCRYPTION_KEY/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('automatic daily, weekly, and monthly schedules calculate dynamic dates in server local time', () => {
  const now = new Date(2026, 9, 7, 21, 30, 0);
  const base = {
    enabled: true,
    destination: '/tmp/automatic-backups',
    selectedTypes: ['database', 'websiteCode'],
    time: '02:00',
    weeklyDay: 2,
    monthlyDay: 15
  };
  const daily = normalizeAutomaticSchedule({ ...base, frequency: 'daily' });
  const weekly = normalizeAutomaticSchedule({ ...base, frequency: 'weekly' });
  const monthly = normalizeAutomaticSchedule({ ...base, frequency: 'monthly' });
  assert.equal(getLocalDateKey(getNextScheduleDate(daily, now)), '2026-10-08');
  assert.equal(getLocalDateKey(getNextScheduleDate(weekly, now)), '2026-10-13');
  assert.equal(getLocalDateKey(getNextScheduleDate(monthly, now)), '2026-10-15');
  assert.equal(isScheduledMinute(weekly, new Date(2026, 9, 13, 2, 0)), true);
  assert.equal(isScheduledMinute(weekly, new Date(2026, 9, 14, 2, 0)), false);
  assert.throws(() => normalizeAutomaticSchedule({ ...base, frequency: 'yearly' }), /frequency/);
});

test('multiple automatic schedules persist independently and retain the legacy primary schedule fields', async () => {
  const projectRoot = makeProjectRoot();
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-schedules-state-'));
  const firstDestination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-schedule-first-'));
  const secondDestination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-schedule-second-'));
  const service = makeService({ projectRoot, stateDirectory });
  try {
    const saved = await service.saveAutomaticSchedules([
      {
        id: 'daily-database',
        enabled: false,
        destination: firstDestination,
        selectedTypes: ['database'],
        frequency: 'daily',
        time: '02:00'
      },
      {
        id: 'weekly-code',
        enabled: false,
        destination: secondDestination,
        selectedTypes: ['websiteCode'],
        frequency: 'weekly',
        time: '03:00',
        weeklyDay: 2
      }
    ]);
    assert.equal(saved.schedules.length, 2);
    assert.equal(saved.schedules[0].id, 'daily-database');
    assert.equal(saved.schedules[1].id, 'weekly-code');
    assert.equal(saved.frequency, 'daily');
    assert.equal(saved.schedules[0].nextRun, null);
    assert.equal(saved.schedules[1].nextRun, null);

    const restartedService = makeService({ projectRoot, stateDirectory });
    const loaded = await restartedService.getAutomaticSchedule();
    assert.deepEqual(loaded.schedules.map((schedule) => schedule.id), ['daily-database', 'weekly-code']);
    assert.equal(loaded.schedules[1].frequency, 'weekly');
    const afterDelete = await restartedService.deleteAutomaticSchedule('daily-database');
    assert.deepEqual(afterDelete.schedules.map((schedule) => schedule.id), ['weekly-code']);
    await assert.rejects(restartedService.deleteAutomaticSchedule('missing-schedule'), /not found/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
    fs.rmSync(firstDestination, { recursive: true, force: true });
    fs.rmSync(secondDestination, { recursive: true, force: true });
  }
});

test('multiple schedules due at once queue and launch as separate automatic jobs', async () => {
  const projectRoot = makeProjectRoot();
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-schedule-queue-state-'));
  const firstDestination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-schedule-queue-first-'));
  const secondDestination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-schedule-queue-second-'));
  const runDate = new Date('2026-10-12T02:00:00+05:30');
  const service = makeService({
    projectRoot,
    stateDirectory,
    now: () => new Date(runDate),
    spawnSync: (executable) => ({
      status: 0,
      stdout: executable.includes('restore') ? 'pg_restore (PostgreSQL) 18.6\n' : 'pg_dump (PostgreSQL) 18.6\n'
    }),
    spawn: () => {
      throw new Error('Mocked pg_dump failure; no process is started.');
    }
  });
  try {
    await service.saveAutomaticSchedules([
      { id: 'queue-first', enabled: true, destination: firstDestination, selectedTypes: ['database'], frequency: 'daily', time: '02:00' },
      { id: 'queue-second', enabled: true, destination: secondDestination, selectedTypes: ['database'], frequency: 'daily', time: '02:00' }
    ]);

    await service.tickAutomaticSchedule(runDate);
    const deadline = Date.now() + 5000;
    let history = [];
    while (Date.now() < deadline) {
      await service.tickAutomaticSchedule(runDate);
      history = await service.getHistory();
      if (history.filter((entry) => entry.backupType === 'AUTOMATIC').length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const automaticJobs = history.filter((entry) => entry.backupType === 'AUTOMATIC');
    assert.equal(automaticJobs.length, 2);
    assert.ok(automaticJobs.every((job) => job.status === 'FAILED'));
    const saved = await service.getAutomaticSchedule();
    assert.deepEqual(saved.schedules.map((schedule) => schedule.lastRun.status), ['FAILED', 'FAILED']);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
    fs.rmSync(firstDestination, { recursive: true, force: true });
    fs.rmSync(secondDestination, { recursive: true, force: true });
  }
});

test('daily, weekly, and monthly rolling retention reuses the oldest eligible run at 30 folders', () => {
  for (const frequency of ['daily', 'weekly', 'monthly']) {
    const folders = Array.from({ length: 30 }, (_, index) => ({
      date: `2026-09-${String(index + 1).padStart(2, '0')}`,
      path: `/backup/${frequency}-${index + 1}`,
      frequency
    }));
    folders.push({ date: '2026-09-30', path: '/backup/other-frequency', frequency: 'daily' === frequency ? 'weekly' : 'daily' });
    const selected = selectRollingFolder(folders, frequency, '2026-10-21');
    assert.equal(selected.eligibleCount, 30);
    assert.equal(selected.recycle.path, `/backup/${frequency}-1`);
    assert.equal(selected.current, null);
    const currentRun = selectRollingFolder([...folders, { date: '2026-10-21', path: '/backup/today', frequency }], frequency, '2026-10-21');
    assert.equal(currentRun.current.path, '/backup/today');
    assert.equal(currentRun.recycle, null);
  }
  assert.throws(() => selectRollingFolder([{ date: '2026-10-21', frequency: 'monthly' }], 'weekly', '2026-10-21'), /does not belong/);
});

test('source metrics measure database metadata, Website Code including .env, and separate asset roots', async () => {
  const projectRoot = makeProjectRoot();
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-metrics-'));
  const originalRoot = path.join(sourceRoot, 'originals');
  const thumbnailRoot = path.join(sourceRoot, 'thumbnails');
  const destination = path.join(sourceRoot, 'destination');
  fs.mkdirSync(path.join(originalRoot, 'suman', '2026', '10', 'Approved'), { recursive: true });
  fs.mkdirSync(path.join(thumbnailRoot, '2026', '10', '08'), { recursive: true });
  fs.writeFileSync(path.join(originalRoot, 'suman', '2026', '10', 'Approved', 'asset.psd'), 'asset-size');
  fs.writeFileSync(path.join(thumbnailRoot, '2026', '10', '08', 'asset.webp'), 'thumb');
  const service = makeService({
    projectRoot,
    stateDirectory: path.join(sourceRoot, 'state'),
    environment: { ASSETS_ROOT: originalRoot, THUMBNAIL_STORAGE_PATH: thumbnailRoot }
  });
  try {
    const sources = await service.getSourceMetrics();
    assert.equal(sources.database.currentBytes, 1024);
    assert.equal(sources.websiteCode.available, true, sources.websiteCode.error);
    const codePlan = await service.buildPlan({ categories: ['websiteCode'], destinations: [destination] });
    assert.equal(sources.websiteCode.currentBytes, codePlan.categories.websiteCode.estimatedBytes);
    assert.equal(sources.websiteCode.encryptedEnvironmentFiles, 3);
    assert.ok(sources.websiteCode.currentBytes >= fs.statSync(path.join(projectRoot, '.env')).size);
    assert.equal(sources.assets.originalBytes, Buffer.byteLength('asset-size'));
    assert.equal(sources.assets.thumbnailBytes, Buffer.byteLength('thumb'));
    assert.equal(sources.assets.totalBytes, Buffer.byteLength('asset-size') + Buffer.byteLength('thumb'));
    assert.equal(sources.assets.originalRoot, originalRoot);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test('destination checks reject a protected source and nested destinations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-safe-path-'));
  try {
    assert.throws(() => assertSafeDestination(path.join(root, 'backup'), [root]), /protected production source/);
    assert.throws(() => assertSafeDestination(root, [path.join(root, 'assets')]), /protected production source/);
    assert.equal(pathsOverlap('C:\\GFX\\Assets', 'c:\\gfx\\assets\\user'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('automatic destination browsing hides Mac export staging and automatic settings reject it', async () => {
  const projectRoot = makeProjectRoot();
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  const browseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-auto-browse-'));
  const clientExportRoot = path.join(browseRoot, 'manual-export-staging');
  const destination = path.join(browseRoot, 'server-backups');
  fs.mkdirSync(clientExportRoot);
  fs.mkdirSync(destination);
  const service = makeService({ projectRoot, stateDirectory, clientExportRoot });
  try {
    const listing = await service.browseAutomaticDestination(browseRoot);
    assert.deepEqual(listing.directories.map((entry) => entry.path), [destination]);
    assert.equal((await service.testDestination(destination)).status, 'READY');
    await assert.rejects(service.browseAutomaticDestination(clientExportRoot), /not an automatic backup destination/);
    await assert.rejects(service.testDestination(clientExportRoot), /protected production source/);
    await assert.rejects(service.saveAutomaticSchedule({
      enabled: false,
      destination: clientExportRoot,
      selectedTypes: ['database', 'websiteCode'],
      frequency: 'daily',
      time: '02:00',
      weeklyDay: 0,
      monthlyDay: 1
    }), /protected production source/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
    fs.rmSync(browseRoot, { recursive: true, force: true });
  }
});

test('automatic destination browsing and schedules reject symlink aliases of Mac export staging', async (t) => {
  const projectRoot = makeProjectRoot();
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  const browseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-auto-alias-'));
  const clientExportRoot = path.join(browseRoot, 'manual-export-staging');
  const alias = path.join(os.tmpdir(), `gfx-backup-auto-alias-link-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(clientExportRoot, 'private-export'), { recursive: true });
  const service = makeService({ projectRoot, stateDirectory, clientExportRoot });
  try {
    try {
      fs.symlinkSync(browseRoot, alias, 'dir');
    } catch (error) {
      if (['EACCES', 'ENOTSUP', 'EPERM'].includes(error.code)) {
        t.skip('Directory symlinks are unavailable in this environment.');
        return;
      }
      throw error;
    }

    const aliasedStagingPath = path.join(alias, 'manual-export-staging');
    await assert.rejects(service.browseAutomaticDestination(aliasedStagingPath), /not an automatic backup destination/);
    await assert.rejects(service.saveAutomaticSchedule({
      enabled: false,
      destination: aliasedStagingPath,
      selectedTypes: ['database', 'websiteCode'],
      frequency: 'daily',
      time: '02:00',
      weeklyDay: 0,
      monthlyDay: 1
    }), /overlap the server-managed Mac export staging location/);
  } finally {
    try {
      fs.unlinkSync(alias);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
    fs.rmSync(browseRoot, { recursive: true, force: true });
  }
});

test('automatic execution rejects a server destination replaced by an alias of Mac export staging', async (t) => {
  const projectRoot = makeProjectRoot();
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-auto-runtime-alias-'));
  const destination = path.join(root, 'server-backups');
  const movedDestination = path.join(root, 'server-backups-original');
  const clientExportRoot = path.join(root, 'manual-export-staging');
  fs.mkdirSync(destination);
  fs.mkdirSync(clientExportRoot);
  const runDate = new Date(Date.UTC(2026, 9, 7, 15, 30));
  let currentTime = new Date(runDate.getTime() - 60 * 1000);
  const service = makeService({
    projectRoot,
    stateDirectory,
    clientExportRoot,
    environment: { TZ: 'Asia/Kolkata' },
    spawn: () => {
      throw new Error('The backup process must not start after destination validation fails.');
    },
    now: () => new Date(currentTime)
  });
  try {
    try {
      await service.saveAutomaticSchedule({
        enabled: true,
        destination,
        selectedTypes: ['database'],
        frequency: 'daily',
        time: '21:00',
        weeklyDay: 0,
        monthlyDay: 1
      });
      fs.renameSync(destination, movedDestination);
      fs.symlinkSync(clientExportRoot, destination, 'dir');
    } catch (error) {
      if (['EACCES', 'ENOTSUP', 'EPERM'].includes(error.code)) {
        t.skip('Directory symlinks are unavailable in this environment.');
        return;
      }
      throw error;
    }
    currentTime = runDate;
    await service.tickAutomaticSchedule(runDate);
    const deadline = Date.now() + 3000;
    let schedule;
    while (Date.now() < deadline) {
      schedule = await service.getAutomaticSchedule();
      if (schedule.lastRun?.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(schedule.lastRun.status, 'FAILED');
    assert.match(schedule.lastRun.error, /protected production source/i);
    assert.deepEqual(fs.readdirSync(clientExportRoot), []);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('complete Website Code plan preserves paths and encrypts .env files', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-destination-'));
  const service = makeService({ projectRoot, stateDirectory: path.join(os.tmpdir(), `gfx-backup-state-${Date.now()}`) });
  try {
    const plan = await service.buildPlan({ categories: ['websiteCode'], destinations: [destination] });
    assert.equal(plan.ready, true, plan.issues.join('\n'));
    assert.equal(plan.categories.websiteCode.files > 0, true);
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/backend/server.js'));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/frontend/src/App.js'));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/frontend/scripts/sync-fonts.js'));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/GFX-Aanav/config.json'));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/README.md'));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/.npmrc'));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/.env.local' && file.encrypted));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/.env.example' && !file.encrypted));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/backend/.env.example' && !file.encrypted));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/frontend/package-lock.json'));
    assert.ok(plan.internalGroups[0].files.every((file) => !file.sourcePath.includes(`${path.sep}node_modules${path.sep}`)));
    assert.ok(plan.internalGroups[0].files.every((file) => !['Thumbs.db', 'desktop.ini'].includes(path.basename(file.sourcePath))));
    assert.ok(plan.internalGroups[0].files.every((file) => ![
      'Website-Code/backend/credentials.json',
      'Website-Code/backend/runtime-config.json',
      'Website-Code/backend/.npmrc'
    ].includes(file.outputRelativePath)));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/.npmrc'));
    assert.ok(plan.internalGroups[0].files.filter((file) => file.encrypted).length >= 2);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test('Assets + Thumbnails plan measures production roots and keeps user and date paths intact', async () => {
  const projectRoot = makeProjectRoot();
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-assets-'));
  const originalRoot = path.join(sourceRoot, 'originals');
  const thumbnailRoot = path.join(sourceRoot, 'thumbnails');
  const destination = path.join(sourceRoot, 'destination');
  fs.mkdirSync(path.join(originalRoot, 'rahul', '2026', '10', 'Pending'), { recursive: true });
  fs.mkdirSync(path.join(thumbnailRoot, '2026', '10', '07'), { recursive: true });
  fs.writeFileSync(path.join(originalRoot, 'rahul', '2026', '10', 'Pending', 'design.psd'), 'original-asset');
  fs.writeFileSync(path.join(thumbnailRoot, '2026', '10', '07', 'design.webp'), 'thumbnail');
  const service = makeService({
    projectRoot,
    stateDirectory: path.join(sourceRoot, 'state'),
    environment: { ASSETS_ROOT: originalRoot, THUMBNAIL_STORAGE_PATH: thumbnailRoot }
  });
  try {
    const plan = await service.buildPlan({ categories: ['assetsAndThumbnails'], destinations: [destination] });
    assert.equal(plan.ready, true);
    assert.equal(plan.categories.originalAssets.estimatedBytes, Buffer.byteLength('original-asset'));
    assert.equal(plan.categories.thumbnails.estimatedBytes, Buffer.byteLength('thumbnail'));
    assert.equal(plan.categories.originalAssets.users[0].displayName, 'Rahul Sharma');
    assert.ok(plan.internalGroups.some((group) => group.files.some((file) => (
      file.outputRelativePath === 'Assets/rahul/2026/10/Pending/design.psd'
    ))));
    assert.ok(plan.internalGroups.some((group) => group.files.some((file) => (
      file.outputRelativePath === 'Thumbnails/2026/10/07/design.webp'
    ))));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test('Website Code job copies and verifies files without writing .env plaintext', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-destination-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  const service = makeService({ projectRoot, stateDirectory });
  try {
    const accepted = await service.testDriveSet([destination]);
    assert.equal(accepted[0].status, 'READY');
    const started = await service.createJob({
      categories: ['websiteCode'],
      destinations: [destination],
      applicationVersion: '1.2.3'
    });

    const finished = await waitForTerminalJob(service, started.id);
    assert.equal(finished.status, 'SUCCESS');
    assert.equal(finished.verificationStatus, 'VERIFIED');

    const setRoot = path.join(destination, 'GFXunlimit', `Backup-Set-${started.id}`, 'Drive-1');
    const copiedSource = path.join(setRoot, 'Website-Code', 'backend', 'server.js');
    assert.equal(fs.readFileSync(copiedSource, 'utf8'), 'module.exports = true;\n');
    const encryptedEnv = fs.readFileSync(path.join(setRoot, 'Website-Code', '.env'));
    assert.ok(!encryptedEnv.includes(Buffer.from('backup-private-value')));
    assert.ok(encryptedEnv.subarray(0, 8).equals(Buffer.from('GFXENV1\n')));
    const manifest = JSON.parse(fs.readFileSync(path.join(setRoot, 'manifest.json'), 'utf8'));
    assert.equal(manifest.status, 'SUCCESS');
    assert.equal(manifest.environmentFilesEncrypted, true);
    assert.equal(manifest.destinationDrives[0].safetyLimitBytes > 0, true);
    assert.ok(fs.readFileSync(path.join(setRoot, 'checksums.sha256'), 'utf8').includes('Website-Code/backend/server.js'));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('Mac-local manual export stages only a verified backup set and automatic jobs cannot select it', async () => {
  const projectRoot = makeProjectRoot();
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  const clientExportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-client-export-'));
  const service = makeService({ projectRoot, stateDirectory, clientExportRoot });
  try {
    await assert.rejects(
      service.buildPlan({ categories: ['websiteCode'], destinations: [clientExportRoot] }),
      /protected production source/
    );
    await assert.rejects(
      service.createJob({
        categories: ['websiteCode'],
        automatic: { frequency: 'daily', folder: { reclaimBytes: 0 } },
        destinationMode: 'mac-local'
      }),
      /Automatic backups must use their configured server destination/
    );

    const started = await service.createJob({
      categories: ['websiteCode'],
      destinations: ['/this-client-path-is-never-a-server-path'],
      destinationMode: 'mac-local',
      applicationVersion: '1.2.3'
    });
    const finished = await waitForTerminalJob(service, started.id);
    assert.equal(finished.status, 'SUCCESS');
    assert.equal(finished.verificationStatus, 'VERIFIED');
    assert.equal(finished.backupType, 'MANUAL');
    assert.equal(finished.clientExport, true);
    assert.equal(finished.drives[0].path, 'Mac-local export staging');
    assert.equal(finished.progress.drivePath, 'Mac-local export staging');

    const exportResult = await service.getClientExportFiles(started.id);
    assert.ok(exportResult.some((file) => file.path === 'manifest.json'));
    assert.ok(exportResult.some((file) => file.path === 'checksums.sha256'));
    assert.ok(exportResult.some((file) => file.path === 'Website-Code/backend/server.js'));
    const manifest = JSON.parse(fs.readFileSync(
      path.join(clientExportRoot, 'GFXunlimit', `Backup-Set-${started.id}`, 'Drive-1', 'manifest.json'),
      'utf8'
    ));
    assert.equal(manifest.backupSetId, started.id);
    assert.equal(manifest.status, 'SUCCESS');
    assert.equal(manifest.verificationStatus, 'VERIFIED');
    assert.equal(manifest.destinationDrives[0].path, 'Mac-local export');
    assert.ok(!JSON.stringify(manifest).includes(clientExportRoot));

    const file = await service.openClientExportFile(started.id, 'Website-Code/backend/server.js');
    let body = '';
    for await (const chunk of file.stream) body += chunk.toString();
    assert.equal(body, 'module.exports = true;\n');
    const expectedSource = Buffer.from(body);
    const verificationProgress = [];
    const verification = await service.verifyClientExportFiles(started.id, [{
      path: 'Website-Code/backend/server.js',
      sizeBytes: expectedSource.length,
      sha256: crypto.createHash('sha256').update(expectedSource).digest('hex')
    }], (progress) => verificationProgress.push(progress), { expectedInventory: exportResult });
    assert.deepEqual(verification, {
      filesVerified: 1,
      bytesVerified: expectedSource.length,
      totalBytes: expectedSource.length
    });
    assert.equal(verificationProgress[0].filesCompleted, 1);
    assert.equal(verificationProgress[0].path, 'Website-Code/backend/server.js');
    await assert.rejects(service.openClientExportFile(started.id, '../../package.json'), /Invalid manual export file path/);
    const transientPath = path.join(
      clientExportRoot,
      'GFXunlimit',
      `Backup-Set-${started.id}`,
      'Drive-1',
      'Website-Code/backend/generated.tmp'
    );
    fs.writeFileSync(transientPath, 'generated');
    await assert.rejects(
      service.verifyClientExportFiles(started.id, [{
        path: 'Website-Code/backend/server.js',
        sizeBytes: expectedSource.length,
        sha256: crypto.createHash('sha256').update(expectedSource).digest('hex')
      }], () => {}, { expectedInventory: exportResult }),
      /Added since initial inventory: Website-Code\/backend\/generated\.tmp \(9 bytes\)/
    );
    fs.unlinkSync(transientPath);
    fs.writeFileSync(
      path.join(clientExportRoot, 'GFXunlimit', `Backup-Set-${started.id}`, 'Drive-1', 'Website-Code/backend/server.js'),
      body.replace('true', 'fals')
    );
    await assert.rejects(
      service.verifyClientExportFiles(started.id, [{
        path: 'Website-Code/backend/server.js',
        sizeBytes: expectedSource.length,
        sha256: crypto.createHash('sha256').update(expectedSource).digest('hex')
      }], () => {}, { expectedInventory: exportResult }),
      /changed while packaging/
    );

    await service.deleteClientExport(started.id);
    await assert.rejects(service.getClientExportFiles(started.id), /no longer available/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
    fs.rmSync(clientExportRoot, { recursive: true, force: true });
  }
});

test('Mac-local database export uses stocksite.backup and requires its finalized manifest', async () => {
  const projectRoot = makeProjectRoot();
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  const clientExportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-client-export-'));
  const databaseDump = Buffer.concat([Buffer.from('PGDMP'), Buffer.from('complete-test-dump')]);
  let dumpArgs;
  const service = makeService({
    projectRoot,
    stateDirectory,
    clientExportRoot,
    spawn: (_executable, args) => {
      dumpArgs = args;
      const child = new EventEmitter();
      child.stderr = new PassThrough();
      child.kill = () => {};
      process.nextTick(() => {
        const outputPath = args[args.indexOf('--file') + 1];
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, databaseDump);
        child.emit('close', 0, null);
      });
      return child;
    }
  });
  try {
    const plan = await service.buildClientExportPlan({ categories: ['database'] });
    assert.equal(plan.internalGroups.find((group) => group.kind === 'database').outputRelativePath, 'Database/stocksite.backup');

    const started = await service.createJob({
      categories: ['database'],
      destinationMode: 'mac-local'
    });
    const finished = await waitForTerminalJob(service, started.id);
    assert.equal(finished.status, 'SUCCESS');
    assert.equal(finished.verificationStatus, 'VERIFIED');
    assert.ok(dumpArgs.includes('--format=custom'));
    assert.ok(dumpArgs.includes('--create'));

    const exportFiles = await service.getClientExportFiles(started.id);
    assert.deepEqual(exportFiles.map((file) => file.path).sort(), [
      'Database/stocksite.backup',
      'checksums.sha256',
      'manifest.json'
    ]);
    assert.equal(exportFiles.find((file) => file.path === 'Database/stocksite.backup').sizeBytes, databaseDump.length);
    const exportedDump = await service.openClientExportFile(started.id, 'Database/stocksite.backup');
    const receivedDump = [];
    for await (const chunk of exportedDump.stream) receivedDump.push(chunk);
    assert.deepEqual(Buffer.concat(receivedDump), databaseDump);

    const setDirectory = path.join(clientExportRoot, 'GFXunlimit', `Backup-Set-${started.id}`, 'Drive-1');
    const manifestPath = path.join(setDirectory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.status, 'SUCCESS');
    assert.equal(manifest.verificationStatus, 'VERIFIED');
    assert.equal(manifest.database.relativePath, 'Database/stocksite.backup');
    assert.match(fs.readFileSync(path.join(setDirectory, 'checksums.sha256'), 'utf8'), /Database\/stocksite\.backup/);

    fs.writeFileSync(
      path.join(setDirectory, 'Database', 'stocksite.backup'),
      Buffer.alloc(databaseDump.length, 0x41)
    );
    await assert.rejects(service.getClientExportFiles(started.id), /checksum verification failed/);
    fs.writeFileSync(path.join(setDirectory, 'Database', 'stocksite.backup'), databaseDump);
    fs.unlinkSync(manifestPath);
    await assert.rejects(service.getClientExportFiles(started.id), /manifest is missing/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
    fs.rmSync(clientExportRoot, { recursive: true, force: true });
  }
});

test('server-side automatic weekly run reuses the oldest folder and completely overwrites its contents', async () => {
  const projectRoot = makeProjectRoot();
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-automatic-'));
  const destination = path.join(sourceRoot, 'destination');
  const automaticRoot = path.join(destination, 'Automatic Backups');
  const stateDirectory = path.join(sourceRoot, 'state');
  const runDate = new Date(2026, 9, 7, 21, 0, 0);
  const formattedRunDate = getLocalDateKey(runDate);
  const oldFolderPaths = [];
  for (let index = 1; index <= 30; index += 1) {
    const oldDate = new Date(runDate.getFullYear(), runDate.getMonth(), runDate.getDate() - index * 7);
    const folder = path.join(automaticRoot, getLocalDateKey(oldDate));
    fs.mkdirSync(path.join(folder, 'Database'), { recursive: true });
    fs.mkdirSync(path.join(folder, 'Website-Code'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'Database', 'obsolete.dump'), 'old database contents');
    fs.writeFileSync(path.join(folder, 'Website-Code', 'obsolete.txt'), 'old code contents');
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({
      backupType: 'AUTOMATIC',
      automaticFrequency: 'weekly',
      status: 'SUCCESS'
    }));
    oldFolderPaths.push(folder);
  }
  let currentTime = new Date(runDate.getTime() - 60 * 1000);
  const successfulDumpSpawner = (executable, args) => {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.kill = () => {};
    process.nextTick(() => {
      const outputPath = args[args.indexOf('--file') + 1];
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.concat([Buffer.from('PGDMP'), Buffer.from('automatic-db')]));
      child.emit('close', 0, null);
    });
    return child;
  };
  const service = createBackupService({
    projectRoot,
    stateDirectory,
    database: makeFakeDatabase(path.join(projectRoot, 'postgres-data')),
    environment: { DB_HOST: 'test-postgres', DB_NAME: 'stocksite', BACKUP_ENCRYPTION_KEY: '11'.repeat(32) },
    spawnSync: () => ({ status: 0, stdout: 'pg_dump (PostgreSQL) 18.6\n' }),
    spawn: successfulDumpSpawner,
    spawnRestore: successfulRestoreSpawner,
    now: () => new Date(currentTime)
  });
  try {
    await service.saveAutomaticSchedule({
      enabled: true,
      destination,
      selectedTypes: ['database', 'websiteCode'],
      frequency: 'weekly',
      time: '21:00',
      weeklyDay: runDate.getDay(),
      monthlyDay: 7
    });
    currentTime = runDate;
    await service.tickAutomaticSchedule(runDate);
    const deadline = Date.now() + 10000;
    let completed;
    while (Date.now() < deadline) {
      const history = await service.getHistory();
      completed = history.find((entry) => entry.backupType === 'AUTOMATIC' && entry.automaticRunDate === formattedRunDate);
      if (completed && completed.status !== 'RUNNING') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(completed, 'scheduled job should be recorded');
    assert.equal(completed.status, 'SUCCESS');
    assert.equal(completed.automaticFrequency, 'weekly');
    const runFolder = path.join(automaticRoot, formattedRunDate);
    assert.equal(fs.existsSync(path.join(runFolder, 'Database', 'obsolete.dump')), false);
    assert.equal(fs.existsSync(path.join(runFolder, 'Website-Code', 'obsolete.txt')), false);
    assert.equal(fs.existsSync(path.join(runFolder, 'Database', 'stocksite.backup')), true);
    assert.equal(fs.existsSync(path.join(runFolder, 'Website-Code', 'backend', 'server.js')), true);
    assert.equal(fs.existsSync(oldFolderPaths[oldFolderPaths.length - 1]), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(runFolder, 'manifest.json'), 'utf8'));
    assert.equal(manifest.backupType, 'AUTOMATIC');
    assert.equal(manifest.automaticFrequency, 'weekly');
    assert.equal(manifest.database.relativePath, 'Database/stocksite.backup');
    assert.equal(fs.readdirSync(automaticRoot).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).length, 30);
    await assert.rejects(service.getClientExportFiles(completed.id), /completed, verified manual Mac export/);
    const schedule = await service.getAutomaticSchedule();
    assert.equal(schedule.lastRun.status, 'SUCCESS');
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test('successful native database dumps are measured, checksummed, and recorded in the manifest', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-destination-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  let dumpArgs;
  const successfulDumpSpawner = (executable, args) => {
    dumpArgs = args;
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.kill = () => {};
    process.nextTick(() => {
      const outputPath = args[args.indexOf('--file') + 1];
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.concat([Buffer.from('PGDMP'), Buffer.from('verified-native-postgres-dump')]));
      child.emit('close', 0, null);
    });
    return child;
  };
  const service = makeService({ projectRoot, stateDirectory, spawn: successfulDumpSpawner });
  try {
    const started = await service.createJob({ categories: ['database'], destinations: [destination] });
    const finished = await waitForTerminalJob(service, started.id);
    assert.equal(finished.status, 'SUCCESS');
    assert.equal(finished.verificationStatus, 'VERIFIED');
    assert.equal(finished.completedBytes, Buffer.byteLength('PGDMPverified-native-postgres-dump'));
    assert.equal(finished.database.verified, true);
    assert.equal((await service.getHistory())[0].status, 'SUCCESS');
    assert.ok(dumpArgs.includes('--format=custom'));
    const setRoot = path.join(destination, 'GFXunlimit', `Backup-Set-${started.id}`, 'Drive-1');
    const manifest = JSON.parse(fs.readFileSync(path.join(setRoot, 'manifest.json'), 'utf8'));
    assert.equal(manifest.database.verified, true);
    assert.equal(manifest.database.serverVersion, 'PostgreSQL 18.6 (test)');
    assert.equal(manifest.database.relativePath, 'Database/stocksite.backup');
    assert.equal(fs.existsSync(path.join(setRoot, 'Database', 'stocksite.backup')), true);
    assert.equal(fs.existsSync(path.join(setRoot, 'Database', 'stocksite.dump')), false);
    assert.match(fs.readFileSync(path.join(setRoot, 'checksums.sha256'), 'utf8'), /Database\/stocksite\.backup/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('native database dump failure fails the job and removes its partial dump', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-destination-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  const failedDumpSpawner = (executable, args) => {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.kill = () => {};
    process.nextTick(() => {
      const outputPath = args[args.indexOf('--file') + 1];
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, 'partial');
      child.stderr.write('native dump error');
      child.emit('close', 1, null);
    });
    return child;
  };
  const service = makeService({ projectRoot, stateDirectory, spawn: failedDumpSpawner });
  try {
    const started = await service.createJob({
      categories: ['database'],
      destinations: [destination]
    });
    const finished = await waitForTerminalJob(service, started.id);
    assert.equal(finished.status, 'FAILED');
    assert.match(finished.errors[0].message, /pg_dump failed/);
    const dumpPath = path.join(destination, 'GFXunlimit', `Backup-Set-${started.id}`, 'Drive-1', 'Database', 'stocksite.backup');
    assert.equal(fs.existsSync(dumpPath), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('Mac-local export rejects an incomplete custom-format dump even when pg_dump exits successfully', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-client-destination-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  const incompleteDumpSpawner = (_executable, args) => {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    child.kill = () => {};
    process.nextTick(() => {
      const outputPath = args[args.indexOf('--file') + 1];
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, 'PGDMP');
      child.emit('close', 0, null);
    });
    return child;
  };
  const service = makeService({
    projectRoot,
    stateDirectory,
    clientExportRoot: destination,
    spawn: incompleteDumpSpawner
  });
  try {
    const started = await service.createJob({ categories: ['database'], destinationMode: 'mac-local' });
    const finished = await waitForTerminalJob(service, started.id);
    assert.equal(finished.status, 'FAILED');
    assert.equal(finished.verificationStatus, 'FAILED');
    assert.match(finished.errors[0].message, /incomplete custom-format database dump/);
    await assert.rejects(service.getClientExportFiles(started.id), /completed, verified manual Mac export/);
    assert.equal(fs.existsSync(path.join(destination, 'GFXunlimit', `Backup-Set-${started.id}`, 'Drive-1')), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('database backup rejects a missing dump and an invalid custom-format signature', async () => {
  for (const [label, dumpContents, expectedError] of [
    ['missing', null, /ENOENT|no such file/i],
    ['invalid', Buffer.from('not-a-postgres-archive'), /custom-format archive signature/]
  ]) {
    const projectRoot = makeProjectRoot();
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), `gfx-backup-${label}-destination-`));
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
    const spawner = (_executable, args) => {
      const child = new EventEmitter();
      child.stderr = new PassThrough();
      child.kill = () => {};
      process.nextTick(() => {
        if (dumpContents) {
          const outputPath = args[args.indexOf('--file') + 1];
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.writeFileSync(outputPath, dumpContents);
        }
        child.emit('close', 0, null);
      });
      return child;
    };
    const service = makeService({ projectRoot, stateDirectory, spawn: spawner });
    try {
      const started = await service.createJob({ categories: ['database'], destinations: [destination] });
      const finished = await waitForTerminalJob(service, started.id);
      assert.equal(finished.status, 'FAILED', `${label} dump must fail`);
      assert.equal(finished.verificationStatus, 'FAILED', `${label} dump must not be verified`);
      assert.match(finished.errors[0].message, expectedError);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      fs.rmSync(destination, { recursive: true, force: true });
      fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
  }
});

test('database planning fails closed when a compatible pg_restore is unavailable', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-no-pg-restore-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  const service = makeService({
    projectRoot,
    stateDirectory,
    environment: { PG_DUMP_PATH: '/opt/postgresql/bin/pg_dump' },
    spawnSync: (executable) => executable.endsWith('/pg_restore')
      ? { status: null, error: Object.assign(new Error('not found'), { code: 'ENOENT' }) }
      : { status: 0, stdout: 'pg_dump (PostgreSQL) 18.6\n' }
  });
  try {
    const plan = await service.buildPlan({ categories: ['database'], destinations: [destination] });
    assert.equal(plan.ready, false);
    assert.equal(plan.database.pgRestore.available, false);
    assert.ok(plan.issues.some((issue) => /pg_restore was not found/.test(issue)));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('database dump with a PGDMP prefix fails when pg_restore rejects its truncated archive', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-truncated-archive-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  const dumpBytes = Buffer.from('PGDMP-truncated-archive');
  let restoreExecutable;
  let restoreArguments;
  const service = makeService({
    projectRoot,
    stateDirectory,
    spawn: (_executable, args) => {
      const child = new EventEmitter();
      child.stderr = new PassThrough();
      child.kill = () => {};
      process.nextTick(() => {
        const outputPath = args[args.indexOf('--file') + 1];
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, dumpBytes);
        child.emit('close', 0, null);
      });
      return child;
    },
    spawnRestore: (executable, args) => {
      restoreExecutable = executable;
      restoreArguments = args;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      process.nextTick(() => {
        child.stderr.end('could not read archive TOC: unexpected end of file');
        child.emit('close', 1, null);
      });
      return child;
    }
  });
  try {
    const started = await service.createJob({ categories: ['database'], destinations: [destination] });
    const finished = await waitForTerminalJob(service, started.id);
    assert.equal(finished.status, 'FAILED');
    assert.equal(finished.verificationStatus, 'FAILED');
    assert.match(finished.errors[0].message, /pg_restore --list failed with exit code 1.*unexpected end of file/);
    assert.equal(restoreExecutable, 'pg_restore');
    assert.equal(restoreArguments[0], '--list');
    assert.ok(restoreArguments[1].endsWith('Database/stocksite.backup'));
    assert.equal(fs.existsSync(restoreArguments[1]), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('database archive TOC validation rejects empty output and times out', async () => {
  for (const scenario of ['empty-output', 'timeout']) {
    const projectRoot = makeProjectRoot();
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), `gfx-backup-pg-restore-${scenario}-`));
    const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
    let killed = false;
    const service = makeService({
      projectRoot,
      stateDirectory,
      pgRestoreListTimeoutMs: 20,
      spawn: (_executable, args) => {
        const child = new EventEmitter();
        child.stderr = new PassThrough();
        child.kill = () => {};
        process.nextTick(() => {
          const outputPath = args[args.indexOf('--file') + 1];
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.writeFileSync(outputPath, Buffer.from('PGDMP-a-fixture-archive'));
          child.emit('close', 0, null);
        });
        return child;
      },
      spawnRestore: () => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => {
          killed = true;
          process.nextTick(() => child.emit('close', null, 'SIGTERM'));
        };
        if (scenario === 'empty-output') {
          process.nextTick(() => child.emit('close', 0, null));
        }
        return child;
      }
    });
    try {
      const started = await service.createJob({ categories: ['database'], destinations: [destination] });
      const finished = await waitForTerminalJob(service, started.id);
      assert.equal(finished.status, 'FAILED');
      assert.equal(finished.verificationStatus, 'FAILED');
      if (scenario === 'empty-output') {
        assert.match(finished.errors[0].message, /did not return a valid custom-format archive table-of-contents header/);
        assert.equal(killed, false);
      } else {
        assert.match(finished.errors[0].message, /pg_restore --list timed out after 20 ms/);
        assert.equal(killed, true);
      }
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      fs.rmSync(destination, { recursive: true, force: true });
      fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
  }
});

test('backup fails closed when checksum generation fails', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-checksum-failure-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-state-'));
  const failingFileSystem = Object.create(fs);
  failingFileSystem.createWriteStream = (filePath, options) => (
    path.basename(filePath) === 'checksums.sha256'
      ? new Writable({
          write(_chunk, _encoding, callback) {
            callback(new Error('injected checksum write failure'));
          }
        })
      : fs.createWriteStream(filePath, options)
  );
  const service = createBackupService({
    fs: failingFileSystem,
    projectRoot,
    stateDirectory,
    database: makeFakeDatabase(path.join(projectRoot, 'postgres-data')),
    environment: { DB_HOST: 'test-postgres', DB_NAME: 'stocksite', BACKUP_ENCRYPTION_KEY: '11'.repeat(32) },
    spawnSync: () => ({ status: 0, stdout: 'pg_dump (PostgreSQL) 18.6\n' }),
    spawnRestore: successfulRestoreSpawner,
    spawn: (_executable, args) => {
      const child = new EventEmitter();
      child.stderr = new PassThrough();
      child.kill = () => {};
      process.nextTick(() => {
        const outputPath = args[args.indexOf('--file') + 1];
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, Buffer.concat([Buffer.from('PGDMP'), Buffer.from('valid test archive')]));
        child.emit('close', 0, null);
      });
      return child;
    }
  });
  try {
    const started = await service.createJob({ categories: ['database'], destinations: [destination] });
    const finished = await waitForTerminalJob(service, started.id);
    assert.equal(finished.status, 'FAILED');
    assert.equal(finished.verificationStatus, 'FAILED');
    assert.match(finished.errors.map((error) => error.message).join(' '), /checksum/i);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});
