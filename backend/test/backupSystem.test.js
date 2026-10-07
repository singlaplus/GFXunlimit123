const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
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
  fs.writeFileSync(path.join(root, '.env'), 'DATABASE_PASSWORD=backup-private-value\n');
  fs.writeFileSync(path.join(root, 'backend', '.env'), 'JWT_SECRET=backend-private-value\n');
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

function makeService({ projectRoot, stateDirectory, environment, spawn } = {}) {
  const dataDirectory = path.join(projectRoot, 'postgres-data');
  fs.mkdirSync(dataDirectory, { recursive: true });
  return createBackupService({
    projectRoot,
    stateDirectory,
    database: makeFakeDatabase(dataDirectory),
    environment: {
      ...environment,
      BACKUP_ENCRYPTION_KEY: environment?.BACKUP_ENCRYPTION_KEY || '11'.repeat(32)
    },
    spawnSync: () => ({ status: 0, stdout: 'pg_dump (PostgreSQL) 18.6\n' }),
    spawn
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
  assert.equal(isEnvironmentFile('backend/settings.json'), false);
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
    assert.equal(sources.websiteCode.available, true);
    const codePlan = await service.buildPlan({ categories: ['websiteCode'], destinations: [destination] });
    assert.equal(sources.websiteCode.currentBytes, codePlan.categories.websiteCode.estimatedBytes);
    assert.equal(sources.websiteCode.encryptedEnvironmentFiles, 2);
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

test('complete Website Code plan preserves paths and encrypts .env files', async () => {
  const projectRoot = makeProjectRoot();
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-destination-'));
  const service = makeService({ projectRoot, stateDirectory: path.join(os.tmpdir(), `gfx-backup-state-${Date.now()}`) });
  try {
    const plan = await service.buildPlan({ categories: ['websiteCode'], destinations: [destination] });
    assert.equal(plan.ready, true);
    assert.equal(plan.categories.websiteCode.files > 0, true);
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/backend/server.js'));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/frontend/src/App.js'));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/frontend/scripts/sync-fonts.js'));
    assert.ok(plan.internalGroups[0].files.some((file) => file.outputRelativePath === 'Website-Code/GFX-Aanav/config.json'));
    assert.ok(plan.internalGroups[0].files.every((file) => !file.sourcePath.includes(`${path.sep}node_modules${path.sep}`)));
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
    environment: { BACKUP_ENCRYPTION_KEY: '11'.repeat(32) },
    spawnSync: () => ({ status: 0, stdout: 'pg_dump (PostgreSQL) 18.6\n' }),
    spawn: successfulDumpSpawner,
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
    assert.equal(fs.existsSync(path.join(runFolder, 'Database', 'stocksite.dump')), true);
    assert.equal(fs.existsSync(path.join(runFolder, 'Website-Code', 'backend', 'server.js')), true);
    assert.equal(fs.existsSync(oldFolderPaths[oldFolderPaths.length - 1]), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(runFolder, 'manifest.json'), 'utf8'));
    assert.equal(manifest.backupType, 'AUTOMATIC');
    assert.equal(manifest.automaticFrequency, 'weekly');
    assert.equal(fs.readdirSync(automaticRoot).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).length, 30);
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
  const successfulDumpSpawner = (executable, args) => {
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
    const setRoot = path.join(destination, 'GFXunlimit', `Backup-Set-${started.id}`, 'Drive-1');
    const manifest = JSON.parse(fs.readFileSync(path.join(setRoot, 'manifest.json'), 'utf8'));
    assert.equal(manifest.database.verified, true);
    assert.equal(manifest.database.serverVersion, 'PostgreSQL 18.6 (test)');
    assert.match(fs.readFileSync(path.join(setRoot, 'checksums.sha256'), 'utf8'), /Database\/stocksite\.dump/);
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
    const dumpPath = path.join(destination, 'GFXunlimit', `Backup-Set-${started.id}`, 'Drive-1', 'Database', 'stocksite.dump');
    assert.equal(fs.existsSync(dumpPath), false);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});
