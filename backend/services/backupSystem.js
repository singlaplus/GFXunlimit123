const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const SAFETY_RATIO = 0.9;
const ENV_HEADER = Buffer.from('GFXENV1\n', 'ascii');
const ENV_OVERHEAD_BYTES = ENV_HEADER.length + 12 + 16;
const CATEGORY_KEYS = ['database', 'websiteCode', 'assetsAndThumbnails'];
const MAX_DESTINATIONS = 8;
const STATE_DIR_NAME = 'backup-system';
const DEFAULT_WINDOWS_POSTGRES_DATA_DIRECTORY = 'D:\\GFXunlimitDatabase';
const AUTOMATIC_DIRECTORY_NAME = 'Automatic Backups';
const AUTOMATIC_RETENTION_LIMIT = 30;
const SCHEDULE_TIMEZONE = 'Asia/Kolkata';
const SCHEDULE_FREQUENCIES = new Set(['daily', 'weekly', 'monthly']);
const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EXCLUDED_CODE_NAMES = new Set([
  '.git', 'node_modules', 'build', 'dist', 'coverage', 'backup', 'backups',
  'tmp', 'temp', '.cache', 'cache', 'logs', 'log', 'uploads', '.DS_Store',
  '.upload-staging', 'dump.rdb', 'backup-system'
]);
const ROOT_CODE_FILES = [
  'package.json',
  'package-lock.json',
  '.env',
  '.gitattributes',
  '.gitignore',
  'setup.js',
  'setup.sh',
  'start-backend.sh'
];
const CODE_DIRECTORIES = ['backend', 'frontend', 'scripts', 'GFX-Aanav'];

function isEnvironmentFile(filePath) {
  return /^\.env(?:$|[.-])/i.test(path.posix.basename(String(filePath).replace(/\\/g, '/')));
}

function normalizeCategories(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error('Select at least one backup category.');
  }
  const unique = [...new Set(categories)];
  if (unique.some((category) => !CATEGORY_KEYS.includes(category))) {
    throw new Error('Backup categories must be Database, Website Code, or Assets + Thumbnails.');
  }
  return unique;
}

function getFsCapacity(directoryPath, fsSync = fs) {
  if (typeof fsSync.statfsSync !== 'function') {
    throw new Error('The server filesystem does not expose disk capacity information.');
  }
  const stats = fsSync.statfsSync(directoryPath);
  const blockSize = Number(stats.bsize);
  const blocks = Number(stats.blocks);
  const availableBlocks = Number(stats.bavail ?? stats.bfree);
  const freeBlocks = Number(stats.bfree ?? stats.bavail);
  if (![blockSize, blocks, availableBlocks, freeBlocks].every(Number.isFinite) || blockSize <= 0 || blocks <= 0) {
    throw new Error('The operating system did not return usable disk capacity information.');
  }
  const totalBytes = Math.floor(blockSize * blocks);
  const availableBytes = Math.max(0, Math.floor(blockSize * availableBlocks));
  const usedBytes = Math.max(0, totalBytes - Math.floor(blockSize * freeBlocks));
  const safetyLimitBytes = Math.floor(totalBytes * SAFETY_RATIO);
  return {
    totalBytes,
    usedBytes,
    availableBytes,
    safetyLimitBytes,
    usableBackupBytes: Math.max(0, Math.min(availableBytes, safetyLimitBytes - usedBytes))
  };
}

function pathApiFor(value) {
  const normalized = String(value || '');
  return /^[a-z]:[\\/]/i.test(normalized) || /^\\\\/.test(normalized) ? path.win32 : path;
}

function resolveComparablePath(value) {
  const api = pathApiFor(value);
  const resolved = api.resolve(String(value));
  return api === path.win32 ? resolved.toLowerCase() : resolved;
}

function pathsOverlap(first, second) {
  if (!first || !second) return false;
  const firstApi = pathApiFor(first);
  const secondApi = pathApiFor(second);
  if (firstApi !== secondApi) return false;
  const api = firstApi;
  const left = resolveComparablePath(first);
  const right = resolveComparablePath(second);
  const relative = api.relative(left, right);
  const reverse = api.relative(right, left);
  const isContained = (candidate) => candidate === '' || (
    candidate !== '..' && !candidate.startsWith(`..${api.sep}`) && !api.isAbsolute(candidate)
  );
  return isContained(relative) || isContained(reverse);
}

function isFilesystemRoot(directoryPath) {
  const api = pathApiFor(directoryPath);
  const resolved = api.resolve(directoryPath);
  return resolved === api.parse(resolved).root;
}

function getVolumeIdentity(directoryPath, fsSync = fs) {
  const api = pathApiFor(directoryPath);
  if (api === path.win32) return api.parse(api.resolve(directoryPath)).root.toLowerCase();
  return String(fsSync.statSync(directoryPath).dev);
}

function assertSafeDestination(destinationPath, protectedPaths = []) {
  if (typeof destinationPath !== 'string' || !destinationPath.trim()) {
    throw new Error('Enter a destination path.');
  }
  const trimmed = destinationPath.trim();
  const api = pathApiFor(trimmed);
  if (!api.isAbsolute(trimmed)) {
    throw new Error('Destination path must be an absolute path on the backup server.');
  }
  const resolved = api.resolve(trimmed);
  if (isFilesystemRoot(resolved)) {
    throw new Error('Choose a destination folder, not a drive or filesystem root.');
  }
  for (const protectedPath of protectedPaths.filter(Boolean)) {
    if (pathsOverlap(resolved, protectedPath)) {
      throw new Error('Destination cannot be the same as, inside, or an ancestor of a protected production source.');
    }
  }
  return resolved;
}

function planLogicalGroups(groups, drives) {
  const remaining = drives.map((drive) => Number(drive.usableBackupBytes));
  const allocations = drives.map((drive, index) => ({
    driveNumber: index + 1,
    path: drive.path,
    capacity: drive,
    requiredBytes: 0,
    groups: []
  }));
  const unplaced = [];

  const orderedGroups = groups
    .map((group, index) => ({ group, index }))
    .sort((left, right) => {
      const sizeDifference = Number(right.group.requiredBytes ?? right.group.sizeBytes ?? 0)
        - Number(left.group.requiredBytes ?? left.group.sizeBytes ?? 0);
      return sizeDifference || left.index - right.index;
    });
  for (const { group } of orderedGroups) {
    const groupBytes = Math.max(0, Math.ceil(Number(group.requiredBytes ?? group.sizeBytes ?? 0)));
    const driveIndex = remaining.findIndex((capacity) => capacity >= groupBytes);
    if (driveIndex < 0) {
      unplaced.push({
        key: group.key,
        label: group.label,
        requiredBytes: groupBytes,
        reason: 'This complete logical group does not fit in the remaining safe capacity of any selected drive.'
      });
      continue;
    }
    remaining[driveIndex] -= groupBytes;
    allocations[driveIndex].requiredBytes += groupBytes;
    allocations[driveIndex].groups.push({ ...group, requiredBytes: groupBytes });
  }

  return {
    ready: unplaced.length === 0,
    allocations: allocations.map((allocation, index) => ({
      ...allocation,
      remainingSafeBytes: remaining[index],
      status: allocation.requiredBytes > 0 ? 'READY' : 'UNUSED'
    })),
    unplaced,
    additionalSafeCapacityRequired: unplaced.reduce((sum, group) => sum + group.requiredBytes, 0)
  };
}

function getZonedDateParts(date, timeZone = SCHEDULE_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
}

function getLocalDateKey(date, timeZone = SCHEDULE_TIMEZONE) {
  const { year, month, day } = getZonedDateParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateFromZonedParts(year, month, day, hour, minute, timeZone = SCHEDULE_TIMEZONE) {
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = targetUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getZonedDateParts(new Date(candidate), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const adjustment = targetUtc - actualAsUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate);
}

function parseScheduleTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  if (!match) throw new Error('Automatic backup time must be in HH:MM (24-hour) format.');
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function normalizeAutomaticSchedule(input) {
  const frequency = String(input?.frequency || 'daily').toLowerCase();
  if (!SCHEDULE_FREQUENCIES.has(frequency)) {
    throw new Error('Automatic backup frequency must be Daily, Weekly, or Monthly.');
  }
  const selectedTypes = normalizeCategories(input?.selectedTypes || ['database', 'websiteCode']);
  if (!selectedTypes.includes('database') && !selectedTypes.includes('websiteCode') && !selectedTypes.includes('assetsAndThumbnails')) {
    throw new Error('Select at least one automatic backup type.');
  }
  const time = String(input?.time || '02:00');
  parseScheduleTime(time);
  const weeklyDay = Number(input?.weeklyDay ?? 0);
  if (!Number.isInteger(weeklyDay) || weeklyDay < 0 || weeklyDay > 6) {
    throw new Error('Select a valid weekday for the weekly schedule.');
  }
  const monthlyDay = Number(input?.monthlyDay ?? 1);
  if (!Number.isInteger(monthlyDay) || monthlyDay < 1 || monthlyDay > 31) {
    throw new Error('Select a monthly day between 1 and 31.');
  }
  const destination = typeof input?.destination === 'string' ? input.destination.trim() : '';
  if (!destination) throw new Error('Select and test an automatic backup destination.');
  return {
    enabled: Boolean(input?.enabled),
    destination,
    selectedTypes,
    frequency,
    time,
    weeklyDay,
    monthlyDay,
    timezone: SCHEDULE_TIMEZONE,
    lastRunSlot: String(input?.lastRunSlot || ''),
    lastRun: input?.lastRun || null
  };
}

function getNextScheduleDate(schedule, fromDate = new Date()) {
  const { hour, minute } = parseScheduleTime(schedule.time);
  const { year, month, day } = getZonedDateParts(fromDate, SCHEDULE_TIMEZONE);
  for (let offset = 0; offset <= 370; offset += 1) {
    const calendarDate = new Date(Date.UTC(year, month - 1, day + offset));
    const candidateYear = calendarDate.getUTCFullYear();
    const candidateMonth = calendarDate.getUTCMonth() + 1;
    const candidateDay = calendarDate.getUTCDate();
    const candidate = dateFromZonedParts(candidateYear, candidateMonth, candidateDay, hour, minute, SCHEDULE_TIMEZONE);
    const weekday = calendarDate.getUTCDay();
    const dayMatches = schedule.frequency === 'daily'
      || (schedule.frequency === 'weekly' && weekday === Number(schedule.weeklyDay))
      || (schedule.frequency === 'monthly' && candidateDay === Math.min(Number(schedule.monthlyDay), new Date(Date.UTC(candidateYear, candidateMonth, 0)).getUTCDate()));
    if (dayMatches && candidate > fromDate) return candidate;
  }
  throw new Error('Could not calculate the next automatic backup run.');
}

function isScheduledMinute(schedule, date) {
  const { hour, minute } = parseScheduleTime(schedule.time);
  const parts = getZonedDateParts(date, SCHEDULE_TIMEZONE);
  if (parts.hour !== hour || parts.minute !== minute) return false;
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  if (schedule.frequency === 'weekly') return weekday === Number(schedule.weeklyDay);
  if (schedule.frequency === 'monthly') {
    const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
    return parts.day === Math.min(Number(schedule.monthlyDay), lastDay);
  }
  return true;
}

function scheduleSlotKey(schedule, date) {
  return `${schedule.frequency}:${getLocalDateKey(date, SCHEDULE_TIMEZONE)}:${schedule.time}`;
}

function progressCategoryKey(category) {
  if (category === 'Database') return 'database';
  if (category === 'Website Code') return 'websiteCode';
  return 'assetsAndThumbnails';
}

function updateJobProgress(job) {
  job.progress.percent = job.status === 'SUCCESS' && job.verificationStatus === 'VERIFIED'
    ? 100
    : job.totalBytes > 0
      ? Math.min(99.9, (job.completedBytes / job.totalBytes) * 100)
      : 0;
  job.progress.copyPercent = ['VERIFYING', 'FINALIZING', 'COMPLETE'].includes(job.progress.stage)
    ? 100
    : job.totalBytes > 0
      ? Math.min(99.9, (job.completedBytes / job.totalBytes) * 100)
    : 0;
  for (const category of Object.values(job.categoryProgress || {})) {
    category.percent = job.status === 'SUCCESS' && job.verificationStatus === 'VERIFIED'
      ? 100
      : category.filesTotal > 0 && category.filesCompleted === category.filesTotal
        ? 100
      : category.totalBytes > 0
        ? Math.min(99.9, (category.bytesCompleted / category.totalBytes) * 100)
        : 0;
  }
  for (const drive of job.progress.drives || []) {
    drive.percent = job.status === 'SUCCESS' && job.verificationStatus === 'VERIFIED' || drive.status === 'COMPLETE'
      ? 100
      : drive.totalBytes > 0
        ? Math.min(99.9, (drive.bytesCompleted / drive.totalBytes) * 100)
        : 0;
  }
}

function addCopiedBytes(job, bytes, categoryKey, driveNumber) {
  if (!bytes) return;
  job.completedBytes = Math.max(0, job.completedBytes + bytes);
  if (categoryKey && job.categoryProgress?.[categoryKey]) {
    job.categoryProgress[categoryKey].bytesCompleted = Math.max(0, job.categoryProgress[categoryKey].bytesCompleted + bytes);
  }
  const drive = job.progress.drives?.find((entry) => entry.driveNumber === driveNumber);
  if (drive) drive.bytesCompleted = Math.max(0, drive.bytesCompleted + bytes);
  updateJobProgress(job);
}

function selectRollingFolder(folders, frequency, currentDate) {
  const current = folders.find((folder) => folder.date === currentDate) || null;
  if (current && current.frequency !== frequency) {
    throw new Error(`Automatic backup date folder ${currentDate} already exists and does not belong to the current ${frequency} schedule.`);
  }
  const eligible = folders
    .filter((folder) => folder.frequency === frequency)
    .sort((left, right) => left.date.localeCompare(right.date));
  return {
    current,
    recycle: !current && eligible.length >= AUTOMATIC_RETENTION_LIMIT ? eligible[0] : null,
    eligibleCount: eligible.length
  };
}

function formatError(error) {
  return error && typeof error.message === 'string' ? error.message : String(error);
}

function createBackupService(options = {}) {
  const fileSystem = options.fs || fs;
  const fsp = options.fsp || fileSystem.promises;
  const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
  const stateDirectory = path.resolve(options.stateDirectory || path.join(__dirname, '..', STATE_DIR_NAME));
  const database = options.database;
  const environment = options.environment || process.env;
  const spawnProcess = options.spawn || spawn;
  const clock = options.now || (() => new Date());
  const jobs = new Map();
  let activeJobId = null;
  let historyCache = null;

  const historyFile = path.join(stateDirectory, 'history.json');
  const activeLockFile = path.join(stateDirectory, 'active-job.json');
  const scheduleFile = path.join(stateDirectory, 'automatic-schedule.json');
  let automaticScheduleCache = null;
  let scheduleTickRunning = false;
  const scheduleTimer = setInterval(() => {
    tickAutomaticSchedule().catch((error) => {
      console.error('Automatic backup scheduler failed:', formatError(error));
    });
  }, 15000);
  scheduleTimer.unref?.();

  async function loadHistory() {
    if (historyCache) return historyCache;
    try {
      const parsed = JSON.parse(await fsp.readFile(historyFile, 'utf8'));
      historyCache = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Backup history could not be read: ${formatError(error)}`);
      historyCache = [];
    }
    return historyCache;
  }

  async function persistHistory() {
    await fsp.mkdir(stateDirectory, { recursive: true });
    const temporary = `${historyFile}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify((await loadHistory()).slice(0, 200), null, 2), { mode: 0o600 });
    await fsp.rename(temporary, historyFile);
  }

  async function readAutomaticSchedule() {
    if (automaticScheduleCache) return automaticScheduleCache;
    try {
      const stored = JSON.parse(await fsp.readFile(scheduleFile, 'utf8'));
      automaticScheduleCache = normalizeAutomaticSchedule(stored);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Automatic backup schedule could not be read: ${formatError(error)}`);
      automaticScheduleCache = null;
    }
    return automaticScheduleCache;
  }

  async function persistAutomaticSchedule(schedule) {
    await fsp.mkdir(stateDirectory, { recursive: true });
    const temporary = `${scheduleFile}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(schedule, null, 2), { mode: 0o600 });
    await fsp.rename(temporary, scheduleFile);
    automaticScheduleCache = schedule;
  }

  function publicAutomaticSchedule(schedule, now = clock()) {
    if (!schedule) {
      return {
        configured: false,
        enabled: false,
        destination: '',
        selectedTypes: ['database', 'websiteCode'],
        frequency: 'daily',
        time: '02:00',
        weeklyDay: 0,
        monthlyDay: 1,
        timezone: SCHEDULE_TIMEZONE,
        nextRun: null,
        lastRun: null
      };
    }
    return {
      ...schedule,
      nextRun: schedule.enabled ? getNextScheduleDate(schedule, now).toISOString() : null
    };
  }

  async function getAutomaticSchedule() {
    return publicAutomaticSchedule(await readAutomaticSchedule());
  }

  async function saveAutomaticSchedule(input) {
    const normalized = normalizeAutomaticSchedule(input);
    const previous = await readAutomaticSchedule();
    if (normalized.enabled) {
      await testDestination(normalized.destination);
      const runDate = getNextScheduleDate(normalized, clock());
      const folder = await getAutomaticFolderSelection(normalized, runDate);
      const plan = await buildPlan({
        categories: normalized.selectedTypes,
        destinations: [normalized.destination],
        capacityReclaimBytes: [folder.reclaimBytes]
      });
      if (!plan.ready) {
        throw new Error(`Automatic backup preflight failed:\n${plan.issues.join('\n')}`);
      }
    }
    const sameTrigger = previous &&
      previous.frequency === normalized.frequency &&
      previous.time === normalized.time &&
      previous.weeklyDay === normalized.weeklyDay &&
      previous.monthlyDay === normalized.monthlyDay;
    normalized.lastRunSlot = sameTrigger ? previous.lastRunSlot : '';
    normalized.lastRun = previous?.lastRun || null;
    await persistAutomaticSchedule(normalized);
    return publicAutomaticSchedule(normalized);
  }

  async function getTreeBytes(rootPath) {
    const files = await collectTree(rootPath, '');
    return files.reduce((sum, file) => sum + file.sizeBytes, 0);
  }

  async function getAutomaticFolderSelection(schedule, runDate) {
    const root = path.join(schedule.destination, AUTOMATIC_DIRECTORY_NAME);
    await fsp.mkdir(root, { recursive: true });
    const rootStat = await fsp.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error('Automatic backup root is not a safe directory.');
    }
    const dateName = getLocalDateKey(runDate);
    const targetPath = path.join(root, dateName);
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const folders = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
      const folderPath = path.join(root, entry.name);
      const manifestPath = path.join(folderPath, 'manifest.json');
      let manifest = null;
      try {
        manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
          throw new Error(`Could not inspect automatic backup folder ${entry.name}: ${formatError(error)}`);
        }
      }
      folders.push({
        date: entry.name,
        path: folderPath,
        frequency: manifest?.backupType === 'AUTOMATIC' ? manifest.automaticFrequency : null
      });
    }
    const selection = selectRollingFolder(folders, schedule.frequency, dateName);
    const reclaimBytes = selection.current
      ? await getTreeBytes(selection.current.path)
      : selection.recycle
        ? await getTreeBytes(selection.recycle.path)
        : 0;
    if (selection.recycle && await fsp.lstat(targetPath).then(() => true, (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    })) {
      throw new Error(`Cannot rename the oldest ${schedule.frequency} backup folder because ${dateName} already exists.`);
    }
    return {
      root,
      targetPath,
      recyclePath: selection.recycle?.path || null,
      reclaimBytes
    };
  }

  async function clearAutomaticFolder(folderPath, rootPath) {
    const realRoot = await fsp.realpath(rootPath);
    const realFolder = await fsp.realpath(folderPath);
    const relative = path.relative(realRoot, realFolder);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Automatic rolling folder escaped its configured backup root.');
    }
    const stat = await fsp.lstat(folderPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Automatic rolling target is not a safe directory.');
    }
    for (const entry of await fsp.readdir(folderPath)) {
      const childPath = path.join(folderPath, entry);
      await fsp.rm(childPath, { recursive: true, force: false });
    }
  }

  async function prepareAutomaticFolder(job) {
    const { root, targetPath, recyclePath } = job.automaticFolder;
    await fsp.mkdir(root, { recursive: true });
    if (recyclePath) {
      await fsp.rename(recyclePath, targetPath);
    } else {
      try {
        await fsp.mkdir(targetPath);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    await clearAutomaticFolder(targetPath, root);
    job.drives[0].setDirectory = targetPath;
  }

  async function upsertHistory(job) {
    const history = await loadHistory();
    const safeJob = {
      id: job.id,
      backupType: job.backupType || 'MANUAL',
      automaticFrequency: job.automaticFrequency || null,
      automaticRunDate: job.automaticRunDate || null,
      status: job.status,
      selectedTypes: job.selectedTypes,
      startedAt: job.startedAt,
      completedAt: job.completedAt || null,
      durationMs: job.durationMs || null,
      totalBytes: job.totalBytes,
      completedBytes: job.completedBytes,
      filesTotal: job.filesTotal,
      filesCompleted: job.filesCompleted,
      verificationStatus: job.verificationStatus,
      progress: {
        percent: job.progress.percent,
        copyPercent: job.progress.copyPercent,
        stage: job.progress.stage,
        category: job.progress.category,
        currentPath: job.progress.currentPath,
        currentFileBytes: job.progress.currentFileBytes,
        currentFileSize: job.progress.currentFileSize,
        bytesPerSecond: job.progress.bytesPerSecond,
        etaSeconds: job.progress.etaSeconds,
        driveNumber: job.progress.driveNumber,
        drivePath: job.progress.drivePath,
        drives: job.progress.drives,
        categories: job.categoryProgress,
        verifiedFiles: job.filesCompleted,
        totalFiles: job.filesTotal
      },
      drives: job.drives.map(({ path: drivePath, driveNumber, requiredBytes, status }) => ({
        path: drivePath,
        driveNumber,
        requiredBytes,
        status
      })),
      errors: job.errors || []
    };
    const existingIndex = history.findIndex((entry) => entry.id === job.id);
    if (existingIndex >= 0) history[existingIndex] = safeJob;
    else history.unshift(safeJob);
    historyCache = history.slice(0, 200);
    await persistHistory();
  }

  function publicJob(job) {
    if (!job) return null;
    return {
      id: job.id,
      backupType: job.backupType || 'MANUAL',
      automaticFrequency: job.automaticFrequency || null,
      automaticRunDate: job.automaticRunDate || null,
      status: job.status,
      selectedTypes: job.selectedTypes,
      startedAt: job.startedAt,
      completedAt: job.completedAt || null,
      durationMs: job.durationMs || null,
      progress: {
        percent: job.progress.percent,
        copyPercent: job.progress.copyPercent,
        stage: job.progress.stage,
        category: job.progress.category,
        currentPath: job.progress.currentPath,
        drivePath: job.progress.drivePath,
        currentFileBytes: job.progress.currentFileBytes,
        currentFileSize: job.progress.currentFileSize,
        categories: job.categoryProgress,
        drives: job.progress.drives,
        verifiedFiles: job.filesCompleted,
        filesCompleted: job.filesCompleted,
        filesTotal: job.filesTotal,
        bytesCompleted: job.completedBytes,
        bytesTotal: job.totalBytes,
        bytesPerSecond: job.progress.bytesPerSecond,
        etaSeconds: job.progress.etaSeconds,
        driveNumber: job.progress.driveNumber
      },
      totalBytes: job.totalBytes,
      completedBytes: job.completedBytes,
      filesTotal: job.filesTotal,
      filesCompleted: job.filesCompleted,
      verificationStatus: job.verificationStatus,
      database: job.databaseResult ? {
        name: job.databaseResult.name,
        serverVersion: job.databaseResult.serverVersion,
        pgDumpVersion: job.databaseResult.pgDumpVersion,
        sizeBytes: job.databaseResult.sizeBytes,
        sha256: job.databaseResult.sha256,
        verified: job.databaseResult.verified
      } : null,
      drives: job.drives.map((drive) => ({
        path: drive.path,
        driveNumber: drive.driveNumber,
        actualCapacityBytes: drive.actualCapacityBytes,
        currentUsedBytes: drive.currentUsedBytes,
        currentAvailableBytes: drive.currentAvailableBytes,
        safetyLimitBytes: drive.safetyLimitBytes,
        usableBackupBytes: drive.usableBackupBytes,
        requiredBytes: drive.requiredBytes,
        remainingSafeBytes: drive.remainingSafeBytes,
        status: drive.status
      })),
      errors: job.errors
    };
  }

  async function getDatabaseInfo() {
    if (!database || typeof database.query !== 'function') {
      throw new Error('Database connection is unavailable for backup planning.');
    }
    const result = await database.query(`
      SELECT current_database() AS database_name,
             version() AS server_version,
             current_setting('data_directory', true) AS data_directory,
             pg_database_size(current_database())::text AS size_bytes
    `);
    const row = result.rows?.[0];
    if (!row?.database_name || !row?.server_version) {
      throw new Error('PostgreSQL did not return database and server version metadata.');
    }
    return {
      name: String(row.database_name),
      version: String(row.server_version),
      dataDirectory: String(row.data_directory || environment.POSTGRES_DATA_DIRECTORY || ''),
      sizeBytes: Number(row.size_bytes || 0),
      sourceServer: String(environment.DB_HOST || environment.PGHOST || 'configured PostgreSQL server')
    };
  }

  function detectPgDump(serverVersion) {
    const executable = environment.PG_DUMP_PATH || 'pg_dump';
    const result = (options.spawnSync || require('node:child_process').spawnSync)(executable, ['--version'], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (result.error || result.status !== 0) {
      return { executable, available: false, version: null, error: 'pg_dump was not found or could not be executed.' };
    }
    const versionText = String(result.stdout || result.stderr || '').trim();
    const clientMatch = versionText.match(/(?:PostgreSQL\s+)?(\d+)(?:\.\d+)?/i);
    const serverMatch = String(serverVersion).match(/PostgreSQL\s+(\d+)(?:\.\d+)?/i);
    if (!clientMatch || !serverMatch) {
      return { executable, available: false, version: versionText, error: 'Could not verify pg_dump compatibility with the PostgreSQL server.' };
    }
    const clientMajor = Number(clientMatch[1]);
    const serverMajor = Number(serverMatch[1]);
    if (clientMajor < serverMajor) {
      return {
        executable,
        available: false,
        version: versionText,
        error: `pg_dump ${clientMajor} cannot back up PostgreSQL ${serverMajor}; install pg_dump ${serverMajor} or newer.`
      };
    }
    return { executable, available: true, version: versionText, error: null };
  }

  async function getProtectedPaths(databaseInfo) {
    return [
      projectRoot,
      environment.ASSETS_ROOT,
      environment.THUMBNAIL_STORAGE_PATH,
      databaseInfo?.dataDirectory,
      environment.POSTGRES_DATA_DIRECTORY,
      environment.PGDATA
    ].filter(Boolean);
  }

  async function getOptionalDatabaseInfo(required) {
    try {
      return { ...(await getDatabaseInfo()), available: true, error: null };
    } catch (error) {
      if (required) throw error;
      return {
        name: String(environment.DB_NAME || environment.PGDATABASE || 'stocksite'),
        version: null,
        dataDirectory: String(
          environment.POSTGRES_DATA_DIRECTORY ||
          environment.PGDATA ||
          (process.platform === 'win32' ? DEFAULT_WINDOWS_POSTGRES_DATA_DIRECTORY : '')
        ),
        sizeBytes: 0,
        sourceServer: String(environment.DB_HOST || environment.PGHOST || 'configured PostgreSQL server'),
        available: false,
        error: formatError(error)
      };
    }
  }

  function getEncryptionKey() {
    const configured = String(environment.BACKUP_ENCRYPTION_KEY || '').trim();
    if (!configured) {
      throw new Error('Website Code backup requires BACKUP_ENCRYPTION_KEY so .env files are encrypted at rest.');
    }
    let key;
    if (/^[a-f0-9]{64}$/i.test(configured)) key = Buffer.from(configured, 'hex');
    else key = Buffer.from(configured, 'base64');
    if (key.length !== 32) {
      throw new Error('BACKUP_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hex characters or base64.');
    }
    return key;
  }

  async function collectTree(root, prefix, optionsForTree = {}) {
    const result = [];
    const pending = [{ absolutePath: root, relativePath: prefix }];
    while (pending.length > 0) {
      const current = pending.pop();
      const entries = await fsp.readdir(current.absolutePath, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (optionsForTree.code && EXCLUDED_CODE_NAMES.has(entry.name)) continue;
        if (optionsForTree.excludeStaging && entry.name === '.upload-staging') continue;
        const absolutePath = path.join(current.absolutePath, entry.name);
        const relativePath = path.posix.join(current.relativePath, entry.name);
        const stat = await fsp.lstat(absolutePath);
        if (stat.isSymbolicLink()) {
          throw new Error(`Backup source contains a symbolic link and cannot be copied safely: ${relativePath}`);
        }
        if (stat.isDirectory()) {
          pending.push({ absolutePath, relativePath });
        } else if (stat.isFile()) {
          if (optionsForTree.code && /(?:\.log|\.tmp|\.temp)$/i.test(entry.name)) continue;
          result.push({
            sourcePath: absolutePath,
            relativePath,
            sizeBytes: stat.size,
            encrypted: Boolean(optionsForTree.code && isEnvironmentFile(relativePath))
          });
        } else {
          throw new Error(`Backup source contains an unsupported filesystem entry: ${relativePath}`);
        }
      }
    }
    return result;
  }

  async function collectWebsiteFiles() {
    const files = [];
    const rootEntries = await fsp.readdir(projectRoot);
    const rootEnvironmentFiles = rootEntries.filter((name) => isEnvironmentFile(name));
    if (!rootEntries.includes('package.json')) {
      throw new Error('Website Code allowlist requires the project root package.json.');
    }
    const rootAllowlist = [...new Set([...ROOT_CODE_FILES, ...rootEnvironmentFiles])];
    for (const name of rootAllowlist) {
      const absolutePath = path.join(projectRoot, name);
      let stat;
      try {
        stat = await fsp.lstat(absolutePath);
      } catch (error) {
        if (error.code === 'ENOENT' && name === 'package-lock.json') continue;
        if (error.code === 'ENOENT' && name.startsWith('.env')) continue;
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`Website Code allowlisted path is not a regular file: ${name}`);
      }
      files.push({
        sourcePath: absolutePath,
        relativePath: name,
        sizeBytes: stat.size,
        encrypted: isEnvironmentFile(name)
      });
    }
    for (const name of CODE_DIRECTORIES) {
      const absolutePath = path.join(projectRoot, name);
      let stat;
      try {
        stat = await fsp.lstat(absolutePath);
      } catch (error) {
        throw new Error(`Required Website Code source is missing: ${name}`);
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Website Code source must be a regular directory: ${name}`);
      }
      if (name === 'frontend') {
        const frontendEntries = await fsp.readdir(absolutePath);
        const frontendFiles = [...new Set([
          'package.json',
          'package-lock.json',
          'babel.config.json',
          ...frontendEntries.filter((entry) => isEnvironmentFile(entry))
        ])];
        for (const frontendFile of frontendFiles) {
          const filePath = path.join(absolutePath, frontendFile);
          try {
            const fileStat = await fsp.lstat(filePath);
            if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
              throw new Error(`Website Code allowlisted path is not a regular file: frontend/${frontendFile}`);
            }
            files.push({
              sourcePath: filePath,
              relativePath: `${name}/${frontendFile}`,
              sizeBytes: fileStat.size,
              encrypted: isEnvironmentFile(frontendFile)
            });
          } catch (error) {
            if (error.code === 'ENOENT' && frontendFile !== 'package.json') continue;
            if (error.code !== 'ENOENT') throw error;
            throw new Error('Required Website Code source is missing: frontend/package.json');
          }
        }
        for (const subdirectory of ['src', 'public', 'scripts']) {
          const subdirectoryPath = path.join(absolutePath, subdirectory);
          const subStat = await fsp.lstat(subdirectoryPath);
          if (!subStat.isDirectory() || subStat.isSymbolicLink()) {
            throw new Error(`Required Website Code source is missing: frontend/${subdirectory}`);
          }
          files.push(...await collectTree(subdirectoryPath, `${name}/${subdirectory}`, { code: true }));
        }
        continue;
      }
      files.push(...await collectTree(absolutePath, name, { code: true }));
    }
    const relativePaths = new Set();
    for (const file of files) {
      if (relativePaths.has(file.relativePath)) {
        throw new Error(`Duplicate Website Code source path: ${file.relativePath}`);
      }
      relativePaths.add(file.relativePath);
    }
    if (!files.some((file) => file.encrypted)) {
      throw new Error('Website Code backup requires at least one .env file; none was found in the allowlisted project roots.');
    }
    return files;
  }

  async function collectGroupedFiles(root, optionsForTree = {}) {
    const files = await collectTree(root, '', optionsForTree);
    const groups = new Map();
    for (const file of files) {
      const segments = file.relativePath.split('/');
      const groupKey = optionsForTree.thumbnails
        ? segments.length > 1 ? segments.slice(0, 2).join('/') : '_root'
        : segments[0] || '_root';
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(file);
    }
    return [...groups.entries()].map(([key, groupedFiles]) => ({
      key,
      files: groupedFiles,
      sizeBytes: groupedFiles.reduce((sum, file) => sum + file.sizeBytes, 0)
    }));
  }

  async function getUserLabels() {
    if (!database || typeof database.query !== 'function') {
      throw new Error('Database connection is unavailable for asset user grouping.');
    }
    const result = await database.query(
      "SELECT username, full_name FROM users WHERE username IS NOT NULL AND username <> ''"
    );
    return new Map((result.rows || []).map((row) => [
      String(row.username),
      String(row.full_name || row.username)
    ]));
  }

  async function getSourceMetrics() {
    const [databaseResult, websiteResult, assetsResult] = await Promise.allSettled([
      getOptionalDatabaseInfo(false),
      collectWebsiteFiles(),
      (async () => {
        const originalRoot = String(environment.ASSETS_ROOT || '').trim();
        const thumbnailRoot = String(environment.THUMBNAIL_STORAGE_PATH || '').trim();
        if (!originalRoot) throw new Error('ASSETS_ROOT must point to the production original asset root; backend/uploads is not used.');
        if (!thumbnailRoot) throw new Error('THUMBNAIL_STORAGE_PATH must point to the centralized production thumbnail root.');
        if (!pathApiFor(originalRoot).isAbsolute(originalRoot) || !pathApiFor(thumbnailRoot).isAbsolute(thumbnailRoot)) {
          throw new Error('Production asset and thumbnail roots must be absolute server paths.');
        }
        if (pathsOverlap(originalRoot, thumbnailRoot)) {
          throw new Error('Original asset and thumbnail roots must be separate, non-overlapping directories.');
        }
        const [originalGroups, thumbnailGroups] = await Promise.all([
          collectGroupedFiles(originalRoot, { excludeStaging: true }),
          collectGroupedFiles(thumbnailRoot, { thumbnails: true })
        ]);
        return {
          originalBytes: originalGroups.reduce((sum, group) => sum + group.sizeBytes, 0),
          thumbnailBytes: thumbnailGroups.reduce((sum, group) => sum + group.sizeBytes, 0),
          originalFiles: originalGroups.reduce((sum, group) => sum + group.files.length, 0),
          thumbnailFiles: thumbnailGroups.reduce((sum, group) => sum + group.files.length, 0),
          originalRoot,
          thumbnailRoot
        };
      })()
    ]);

    let databaseMetrics;
    if (databaseResult.status === 'fulfilled') {
      const databaseInfo = databaseResult.value;
      const pgDump = databaseInfo.available ? detectPgDump(databaseInfo.version) : null;
      databaseMetrics = {
        available: databaseInfo.available,
        name: databaseInfo.name,
        version: databaseInfo.version,
        sourceServer: databaseInfo.sourceServer,
        currentBytes: databaseInfo.available ? databaseInfo.sizeBytes : null,
        pgDump: pgDump ? { available: pgDump.available, version: pgDump.version, error: pgDump.error } : null,
        error: databaseInfo.error
      };
    } else {
      databaseMetrics = { available: false, name: null, version: null, sourceServer: null, currentBytes: null, error: formatError(databaseResult.reason) };
    }

    const websiteMetrics = websiteResult.status === 'fulfilled'
      ? {
          available: true,
          currentBytes: websiteResult.value.reduce((sum, file) => sum + file.sizeBytes, 0),
          files: websiteResult.value.length,
          encryptedEnvironmentFiles: websiteResult.value.filter((file) => file.encrypted).length,
          error: null
        }
      : { available: false, currentBytes: null, files: 0, encryptedEnvironmentFiles: 0, error: formatError(websiteResult.reason) };

    const assetsMetrics = assetsResult.status === 'fulfilled'
      ? { available: true, ...assetsResult.value, totalBytes: assetsResult.value.originalBytes + assetsResult.value.thumbnailBytes, error: null }
      : {
          available: false,
          originalBytes: null,
          thumbnailBytes: null,
          originalFiles: 0,
          thumbnailFiles: 0,
          originalRoot: String(environment.ASSETS_ROOT || '') || null,
          thumbnailRoot: String(environment.THUMBNAIL_STORAGE_PATH || '') || null,
          totalBytes: null,
          error: formatError(assetsResult.reason)
        };

    return {
      measuredAt: clock().toISOString(),
      database: databaseMetrics,
      websiteCode: websiteMetrics,
      assets: assetsMetrics
    };
  }

  async function browseDestination(directoryPath = '') {
    const requestedPath = String(directoryPath || '').trim();
    const roots = [];
    if (!requestedPath) {
      if (process.platform === 'win32') {
        for (let code = 65; code <= 90; code += 1) {
          const root = `${String.fromCharCode(code)}:\\`;
          try {
            await fsp.access(root);
            roots.push({ name: root, path: root });
          } catch (error) {
            if (!['ENOENT', 'ENODEV', 'EACCES'].includes(error.code)) throw error;
          }
        }
      } else {
        const root = path.parse(projectRoot).root || path.parse(process.cwd()).root;
        roots.push({ name: root, path: root });
      }
      return { currentPath: null, parentPath: null, directories: roots };
    }
    const api = pathApiFor(requestedPath);
    if (!api.isAbsolute(requestedPath) || requestedPath.split(/[\\/]+/).includes('..')) {
      throw new Error('Browse path must be an absolute server filesystem directory without parent traversal.');
    }
    const resolved = api.resolve(requestedPath);
    let stat;
    try {
      stat = await fsp.lstat(resolved);
    } catch (error) {
      throw new Error(`PC2 cannot access the selected path: ${formatError(error)}`);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('The selected PC2 path is not a regular directory.');
    }
    const entries = await fsp.readdir(resolved, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => ({
        name: entry.name,
        path: api.join(resolved, entry.name)
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const parent = api.dirname(resolved);
    return {
      currentPath: resolved,
      parentPath: parent === resolved ? null : parent,
      directories
    };
  }

  async function validateDestination(destination, protectedPaths) {
    const resolved = assertSafeDestination(destination, protectedPaths);
    const api = pathApiFor(resolved);
    let nearestExisting = resolved;
    const missingSegments = [];
    while (true) {
      try {
        await fsp.lstat(nearestExisting);
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const parent = api.dirname(nearestExisting);
        if (parent === nearestExisting) throw error;
        missingSegments.unshift(api.basename(nearestExisting));
        nearestExisting = parent;
      }
    }
    const nearestRealPath = await fsp.realpath(nearestExisting);
    const prospectivePath = api.join(nearestRealPath, ...missingSegments);
    const canonicalProtected = [];
    for (const protectedPath of protectedPaths) {
      try {
        canonicalProtected.push(await fsp.realpath(protectedPath));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (canonicalProtected.some((protectedPath) => pathsOverlap(prospectivePath, protectedPath))) {
      throw new Error('Destination resolves to the same location as, inside, or above a protected production source.');
    }
    await fsp.mkdir(resolved, { recursive: true });
    const stat = await fsp.lstat(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Destination exists but is not a safe directory.');
    }
    const realDestination = await fsp.realpath(resolved);
    const realProtected = [];
    for (const protectedPath of protectedPaths) {
      try {
        realProtected.push(await fsp.realpath(protectedPath));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (realProtected.some((protectedPath) => pathsOverlap(realDestination, protectedPath))) {
      throw new Error('Destination resolves to the same location as, inside, or above a protected production source.');
    }
    const probePath = path.join(realDestination, `.gfx-backup-write-test-${crypto.randomUUID()}`);
    let handle;
    try {
      handle = await fsp.open(probePath, 'wx', 0o600);
      await handle.writeFile('GFX Backup write test');
      await handle.sync();
      await handle.close();
      handle = null;
      const testedContent = await fsp.readFile(probePath, 'utf8');
      if (testedContent !== 'GFX Backup write test') {
        throw new Error('Destination write test content could not be read back correctly.');
      }
      await fsp.unlink(probePath);
      await fsp.readdir(realDestination);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fsp.unlink(probePath).catch(() => {});
      throw new Error(`Destination read/write test failed: ${formatError(error)}`);
    }
    const capacity = getFsCapacity(realDestination, fileSystem);
    return { path: realDestination, ...capacity, status: 'READY' };
  }

  async function testDestination(destination) {
    const databaseInfo = await getOptionalDatabaseInfo(false);
    const protectedPaths = await getProtectedPaths(databaseInfo);
    try {
      return await validateDestination(destination, protectedPaths);
    } catch (error) {
      throw new Error(`Destination test failed: ${formatError(error)}`);
    }
  }

  async function buildPlan({ categories, destinations, capacityReclaimBytes = [] }) {
    const selectedTypes = normalizeCategories(categories);
    if (!Array.isArray(destinations) || destinations.length === 0 || destinations.length > MAX_DESTINATIONS) {
      throw new Error(`Add between 1 and ${MAX_DESTINATIONS} tested backup destinations.`);
    }
    const normalizedDestinations = destinations.map((destination) => {
      if (typeof destination !== 'string' || !destination.trim()) throw new Error('Every backup destination needs a path.');
      return destination.trim();
    });
    if (new Set(normalizedDestinations.map(resolveComparablePath)).size !== normalizedDestinations.length) {
      throw new Error('Each drive must use a different destination path.');
    }

    const databaseInfo = await getOptionalDatabaseInfo(selectedTypes.includes('database'));
    const protectedPaths = await getProtectedPaths(databaseInfo);
    const driveStats = [];
    const volumeIds = new Set();
    for (const destination of normalizedDestinations) {
      let drive = await validateDestination(destination, protectedPaths);
      const volumeId = getVolumeIdentity(drive.path, fileSystem);
      if (volumeIds.has(volumeId)) {
        throw new Error(`Destination ${drive.path} is on a filesystem already used by another selected drive.`);
      }
      volumeIds.add(volumeId);
      const reclaimBytes = Math.max(0, Number(capacityReclaimBytes[driveStats.length] || 0));
      if (reclaimBytes > 0) {
        const prospectiveUsedBytes = Math.max(0, drive.usedBytes - reclaimBytes);
        const prospectiveAvailableBytes = Math.min(drive.totalBytes - prospectiveUsedBytes, drive.availableBytes + reclaimBytes);
        drive = {
          ...drive,
          usedBytes: prospectiveUsedBytes,
          availableBytes: prospectiveAvailableBytes,
          usableBackupBytes: Math.max(0, Math.min(
            prospectiveAvailableBytes,
            drive.safetyLimitBytes - prospectiveUsedBytes
          )),
          reclaimBytes
        };
      }
      driveStats.push(drive);
    }

    const pgDump = detectPgDump(databaseInfo.version);
    const warnings = [];
    const issues = [];
    const groups = [];
    const categoryTotals = {
      database: { estimatedBytes: databaseInfo.sizeBytes, plannedBytes: 0, files: 1 },
      websiteCode: { estimatedBytes: 0, plannedBytes: 0, files: 0 },
      originalAssets: { estimatedBytes: 0, plannedBytes: 0, files: 0, users: [] },
      thumbnails: { estimatedBytes: 0, plannedBytes: 0, files: 0 }
    };
    const sourceRoots = {
      websiteCode: projectRoot,
      databaseData: databaseInfo.dataDirectory || null,
      originalAssets: environment.ASSETS_ROOT || null,
      thumbnails: environment.THUMBNAIL_STORAGE_PATH || null
    };

    if (selectedTypes.includes('database')) {
      const estimate = Math.max(databaseInfo.sizeBytes + 128 * 1024 * 1024, Math.ceil(databaseInfo.sizeBytes * 1.2));
      categoryTotals.database.plannedBytes = estimate;
      if (!databaseInfo.available) issues.push(`Database metadata could not be read: ${databaseInfo.error}`);
      else if (!pgDump.available) issues.push(pgDump.error);
      groups.push({
        key: 'database:stocksite',
        label: `Database ${databaseInfo.name}`,
        category: 'Database',
        requiredBytes: estimate,
        estimatedSourceBytes: databaseInfo.sizeBytes,
        fileCount: 1,
        files: [],
        outputRelativePath: 'Database/stocksite.dump',
        kind: 'database'
      });
    }

    if (selectedTypes.includes('websiteCode')) {
      let encryptionKey;
      try {
        encryptionKey = getEncryptionKey();
      } catch (error) {
        issues.push(formatError(error));
      }
      try {
        const websiteFiles = await collectWebsiteFiles();
        if (websiteFiles.some((file) => file.encrypted) && !encryptionKey) {
          issues.push('Website Code includes environment files but encryption is not configured.');
        }
        const sourceBytes = websiteFiles.reduce((sum, file) => sum + file.sizeBytes, 0);
        const plannedBytes = websiteFiles.reduce((sum, file) => sum + file.sizeBytes + (file.encrypted ? ENV_OVERHEAD_BYTES : 0), 0);
        categoryTotals.websiteCode = { estimatedBytes: sourceBytes, plannedBytes, files: websiteFiles.length };
        groups.push({
          key: 'website-code',
          label: 'Website Code',
          category: 'Website Code',
          requiredBytes: plannedBytes,
          estimatedSourceBytes: sourceBytes,
          fileCount: websiteFiles.length,
          files: websiteFiles.map((file) => ({
            ...file,
            outputRelativePath: path.posix.join('Website-Code', file.relativePath)
          })),
          kind: 'files'
        });
      } catch (error) {
        issues.push(`Website Code source scan failed: ${formatError(error)}`);
      }
    }

    if (selectedTypes.includes('assetsAndThumbnails')) {
      const originalRoot = String(environment.ASSETS_ROOT || '').trim();
      const thumbnailRoot = String(environment.THUMBNAIL_STORAGE_PATH || '').trim();
      if (!originalRoot) issues.push('ASSETS_ROOT must point to the production original asset root; local backend/uploads fallback is not used.');
      else if (!pathApiFor(originalRoot).isAbsolute(originalRoot)) issues.push('ASSETS_ROOT must be an absolute production storage path.');
      if (!thumbnailRoot) issues.push('THUMBNAIL_STORAGE_PATH must point to the centralized production thumbnail root.');
      else if (!pathApiFor(thumbnailRoot).isAbsolute(thumbnailRoot)) issues.push('THUMBNAIL_STORAGE_PATH must be an absolute production storage path.');
      if (originalRoot && thumbnailRoot && pathsOverlap(originalRoot, thumbnailRoot)) {
        issues.push('Original assets and centralized thumbnails must be separate, non-overlapping source roots.');
      }
      if (
        originalRoot &&
        thumbnailRoot &&
        pathApiFor(originalRoot).isAbsolute(originalRoot) &&
        pathApiFor(thumbnailRoot).isAbsolute(thumbnailRoot) &&
        !pathsOverlap(originalRoot, thumbnailRoot)
      ) {
        try {
          const realRoots = [];
          for (const rootPath of [originalRoot, thumbnailRoot]) {
            const stat = await fsp.lstat(rootPath);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Configured source is not a regular directory: ${rootPath}`);
            realRoots.push(await fsp.realpath(rootPath));
          }
          if (pathsOverlap(realRoots[0], realRoots[1])) {
            throw new Error('Original asset and thumbnail roots resolve to overlapping directories.');
          }
          let userLabels = new Map();
          try {
            userLabels = await getUserLabels();
          } catch (error) {
            warnings.push(`Contributor display-name lookup failed; filesystem usernames will be shown: ${formatError(error)}`);
          }
          const originalGroups = (await collectGroupedFiles(originalRoot, { excludeStaging: true }))
            .sort((left, right) => right.sizeBytes - left.sizeBytes || left.key.localeCompare(right.key));
          for (const group of originalGroups) {
            const plannedBytes = group.sizeBytes;
            const username = group.key;
            categoryTotals.originalAssets.estimatedBytes += group.sizeBytes;
            categoryTotals.originalAssets.plannedBytes += plannedBytes;
            categoryTotals.originalAssets.files += group.files.length;
            categoryTotals.originalAssets.users.push({
              username,
              displayName: userLabels.get(username) || username,
              sizeBytes: group.sizeBytes,
              files: group.files.length
            });
            groups.push({
              key: `asset-user:${username}`,
              label: userLabels.get(username) || username,
              category: 'Assets',
              requiredBytes: plannedBytes,
              estimatedSourceBytes: group.sizeBytes,
              fileCount: group.files.length,
              files: group.files.map((file) => ({
                ...file,
                outputRelativePath: path.posix.join('Assets', file.relativePath)
              })),
              kind: 'files'
            });
          }
          const thumbnailGroups = (await collectGroupedFiles(thumbnailRoot, { thumbnails: true }))
            .sort((left, right) => right.sizeBytes - left.sizeBytes || left.key.localeCompare(right.key));
          for (const group of thumbnailGroups) {
            categoryTotals.thumbnails.estimatedBytes += group.sizeBytes;
            categoryTotals.thumbnails.plannedBytes += group.sizeBytes;
            categoryTotals.thumbnails.files += group.files.length;
            groups.push({
              key: `thumbnail-month:${group.key}`,
              label: `Thumbnails ${group.key}`,
              category: 'Thumbnails',
              requiredBytes: group.sizeBytes,
              estimatedSourceBytes: group.sizeBytes,
              fileCount: group.files.length,
              files: group.files.map((file) => ({
                ...file,
                outputRelativePath: path.posix.join('Thumbnails', file.relativePath)
              })),
              kind: 'files'
            });
          }
        } catch (error) {
          issues.push(`Assets + Thumbnails source scan failed: ${formatError(error)}`);
        }
      }
    }

    const totalRequiredBytes = groups.reduce((sum, group) => sum + group.requiredBytes, 0);
    const assignment = planLogicalGroups(groups, driveStats);
    const drivePlans = assignment.allocations.map((drive) => ({
      driveNumber: drive.driveNumber,
      path: drive.path,
      actualCapacityBytes: drive.capacity.totalBytes,
      currentUsedBytes: drive.capacity.usedBytes,
      currentAvailableBytes: drive.capacity.availableBytes,
      safetyLimitBytes: drive.capacity.safetyLimitBytes,
      usableBackupBytes: drive.capacity.usableBackupBytes,
      requiredBytes: drive.requiredBytes,
      remainingSafeBytes: drive.remainingSafeBytes,
      status: drive.requiredBytes > 0 ? 'READY' : 'UNUSED',
      groups: drive.groups.map(({ key, label, requiredBytes, category, fileCount }) => ({
        key, label, requiredBytes, category, fileCount
      }))
    }));
    if (!assignment.ready) {
      issues.push(...assignment.unplaced.map((group) => `${group.label}: ${group.reason}`));
    }

    return {
      ready: issues.length === 0 && assignment.ready,
      selectedTypes,
      database: {
        name: databaseInfo.name,
        version: databaseInfo.version,
        sourceServer: databaseInfo.sourceServer,
        estimatedBytes: databaseInfo.sizeBytes,
        dataDirectory: databaseInfo.dataDirectory || null,
        available: databaseInfo.available,
        metadataError: databaseInfo.error,
        pgDump
      },
      sourceRoots,
      categories: categoryTotals,
      totalRequiredBytes,
      filesTotal: groups.reduce((sum, group) => sum + group.fileCount, 0),
      drives: drivePlans,
      unplacedGroups: assignment.unplaced,
      additionalSafeCapacityRequired: assignment.additionalSafeCapacityRequired,
      warnings,
      issues,
      internalGroups: groups
    };
  }

  function publicPlan(plan) {
    const { internalGroups, ...result } = plan;
    return {
      ...result,
      database: {
        ...result.database,
        pgDump: (() => {
          const { executable, ...publicPgDump } = result.database.pgDump;
          return publicPgDump;
        })()
      }
    };
  }

  async function testDriveSet(destinations) {
    if (!Array.isArray(destinations) || destinations.length === 0 || destinations.length > MAX_DESTINATIONS) {
      throw new Error(`Add between 1 and ${MAX_DESTINATIONS} destination paths.`);
    }
    const databaseInfo = await getOptionalDatabaseInfo(false);
    const protectedPaths = await getProtectedPaths(databaseInfo);
    const results = [];
    const volumeIds = new Set();
    for (const [index, destination] of destinations.entries()) {
      const drive = await validateDestination(destination, protectedPaths);
      const volumeId = getVolumeIdentity(drive.path, fileSystem);
      if (volumeIds.has(volumeId)) {
        throw new Error(`Drive ${index + 1} is on a filesystem already used by another destination.`);
      }
      volumeIds.add(volumeId);
      results.push({ ...drive, driveNumber: index + 1, status: 'READY' });
    }
    return results;
  }

  async function createJob({ categories, destinations, applicationVersion, automatic = null }) {
    if (activeJobId) throw new Error('A backup job is already running. Wait for it to finish before starting another.');
    const plan = await buildPlan({
      categories,
      destinations,
      capacityReclaimBytes: automatic ? [automatic.folder.reclaimBytes] : []
    });
    if (!plan.ready) {
      throw new Error(`Backup cannot start because preflight failed:\n${plan.issues.join('\n')}`);
    }
    const id = `GFX-${clock().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomUUID()}`;
    await fsp.mkdir(stateDirectory, { recursive: true });
    let lockHandle;
    try {
      lockHandle = await fsp.open(activeLockFile, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') {
        let existingLock = null;
        try {
          existingLock = JSON.parse(await fsp.readFile(activeLockFile, 'utf8'));
        } catch (readError) {
          throw new Error(`An unreadable backup lock exists at ${activeLockFile}; inspect it before starting another backup.`);
        }
        let processIsRunning = false;
        if (Number.isInteger(existingLock.pid) && existingLock.pid > 0) {
          try {
            process.kill(existingLock.pid, 0);
            processIsRunning = true;
          } catch (processError) {
            if (processError.code !== 'ESRCH') throw processError;
          }
        }
        if (processIsRunning) {
          throw new Error('Another backup process holds the server-side backup lock.');
        }
        await fsp.unlink(activeLockFile);
        lockHandle = await fsp.open(activeLockFile, 'wx', 0o600);
        const history = await loadHistory();
        const stale = history.find((entry) => entry.id === existingLock.jobId && entry.status === 'RUNNING');
        if (stale) {
          stale.status = 'FAILED';
          stale.completedAt = clock().toISOString();
          stale.verificationStatus = 'FAILED';
          stale.errors = [{ message: 'Backup process stopped before the job completed.', path: null }];
          historyCache = history;
          await persistHistory();
        }
      } else {
        throw error;
      }
    }

    const job = {
      id,
      status: 'RUNNING',
      backupType: automatic ? 'AUTOMATIC' : 'MANUAL',
      automaticFrequency: automatic?.frequency || null,
      automaticRunDate: automatic?.runDate ? getLocalDateKey(automatic.runDate) : null,
      selectedTypes: plan.selectedTypes,
      startedAt: clock().toISOString(),
      completedAt: null,
      totalBytes: plan.totalRequiredBytes,
      completedBytes: 0,
      filesTotal: plan.filesTotal,
      filesCompleted: 0,
      categoryProgress: Object.fromEntries(plan.selectedTypes.map((categoryKey) => {
        const totals = categoryKey === 'assetsAndThumbnails'
          ? {
              plannedBytes: plan.categories.originalAssets.plannedBytes + plan.categories.thumbnails.plannedBytes,
              files: plan.categories.originalAssets.files + plan.categories.thumbnails.files
            }
          : {
              plannedBytes: plan.categories[categoryKey].plannedBytes,
              files: plan.categories[categoryKey].files
            };
        return [categoryKey, {
          bytesCompleted: 0,
          totalBytes: totals.plannedBytes,
          filesCompleted: 0,
          filesTotal: totals.files,
          percent: 0
        }];
      })),
      verificationStatus: 'IN_PROGRESS',
      progress: {
        percent: 0,
        copyPercent: 0,
        stage: 'COPYING',
        category: 'Preparing',
        currentPath: '',
        drivePath: null,
        currentFileBytes: 0,
        currentFileSize: 0,
        bytesPerSecond: 0,
        etaSeconds: null,
        driveNumber: null,
        drives: plan.drives.map((drive) => ({
          driveNumber: drive.driveNumber,
          path: drive.path,
          totalBytes: drive.requiredBytes,
          bytesCompleted: 0,
          percent: 0,
          status: drive.requiredBytes > 0 ? 'WAITING' : 'UNUSED'
        }))
      },
      drives: plan.drives.map(({ groups, ...drive }) => ({ ...drive, groups })),
      errors: [],
      plan,
      automaticFolder: automatic?.folder || null,
      applicationVersion: String(applicationVersion || (() => {
        try {
          return JSON.parse(fileSystem.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version || 'unknown';
        } catch (error) {
          return 'unknown';
        }
      })()),
      applicationCommit: (() => {
        const result = (options.spawnSync || require('node:child_process').spawnSync)('git', ['rev-parse', 'HEAD'], {
          cwd: projectRoot,
          encoding: 'utf8',
          windowsHide: true
        });
        const commit = String(result.stdout || '').trim();
        return !result.error && result.status === 0 && /^[a-f0-9]{7,40}$/i.test(commit) ? commit : null;
      })(),
      lastProgressPersistAt: 0
    };
    activeJobId = id;
    jobs.set(id, job);
    try {
      await lockHandle.writeFile(JSON.stringify({ pid: process.pid, jobId: id, startedAt: job.startedAt }));
      await lockHandle.close();
      lockHandle = null;
      await upsertHistory(job);
    } catch (error) {
      if (lockHandle) await lockHandle.close().catch(() => {});
      activeJobId = null;
      jobs.delete(id);
      await fsp.unlink(activeLockFile).catch(() => {});
      throw error;
    }
    setImmediate(() => runJob(job).catch(async (error) => {
      job.status = 'FAILED';
      job.errors.push({ message: formatError(error), path: job.progress.currentPath || null });
      job.verificationStatus = 'FAILED';
      job.completedAt = clock().toISOString();
      job.durationMs = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
      try {
        await upsertHistory(job);
        if (job.backupType === 'AUTOMATIC') await finishAutomaticRun(job);
      } catch (persistError) {
        console.error('Could not persist failed backup job state:', formatError(persistError));
      }
      activeJobId = null;
      await fsp.unlink(activeLockFile).catch(() => {});
    }));
    return publicJob(job);
  }

  async function recordAutomaticFailure(schedule, runDate, error) {
    const now = clock();
    const job = {
      id: `GFX-AUTO-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomUUID()}`,
      status: 'FAILED',
      backupType: 'AUTOMATIC',
      automaticFrequency: schedule.frequency,
      automaticRunDate: getLocalDateKey(runDate),
      selectedTypes: schedule.selectedTypes,
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      durationMs: 0,
      totalBytes: 0,
      completedBytes: 0,
      filesTotal: 0,
      filesCompleted: 0,
      verificationStatus: 'FAILED',
      drives: [],
      errors: [{ message: formatError(error), path: null }]
    };
    const history = await loadHistory();
    history.unshift(job);
    historyCache = history.slice(0, 200);
    await persistHistory();
    const current = await readAutomaticSchedule();
    if (current) {
      current.lastRun = {
        jobId: job.id,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        status: 'FAILED',
        verificationStatus: 'FAILED',
        totalBytes: 0,
        frequency: schedule.frequency,
        error: formatError(error)
      };
      await persistAutomaticSchedule(current);
    }
  }

  async function finishAutomaticRun(job) {
    const schedule = await readAutomaticSchedule();
    if (!schedule) return;
    schedule.lastRun = {
      jobId: job.id,
      startedAt: job.startedAt,
      completedAt: job.completedAt || clock().toISOString(),
      status: job.status,
      verificationStatus: job.verificationStatus,
      totalBytes: job.completedBytes,
      frequency: job.automaticFrequency,
      error: job.errors?.map((entry) => entry.message).join('; ') || null
    };
    await persistAutomaticSchedule(schedule);
  }

  async function launchAutomaticRun(schedule, runDate) {
    let started;
    try {
      await testDestination(schedule.destination);
      const folder = await getAutomaticFolderSelection(schedule, runDate);
      started = await createJob({
        categories: schedule.selectedTypes,
        destinations: [schedule.destination],
        automatic: { frequency: schedule.frequency, runDate, folder }
      });
    } catch (error) {
      await recordAutomaticFailure(schedule, runDate, error);
      return;
    }
    const latest = await readAutomaticSchedule();
    if (latest) {
      latest.lastRun = {
        jobId: started.id,
        startedAt: started.startedAt,
        completedAt: null,
        status: 'RUNNING',
        verificationStatus: 'IN_PROGRESS',
        totalBytes: started.totalBytes,
        frequency: schedule.frequency,
        error: null
      };
      await persistAutomaticSchedule(latest);
    }
  }

  async function tickAutomaticSchedule(now = clock()) {
    if (scheduleTickRunning) return;
    scheduleTickRunning = true;
    try {
      const schedule = await readAutomaticSchedule();
      if (!schedule?.enabled || !isScheduledMinute(schedule, now)) return;
      const slot = scheduleSlotKey(schedule, now);
      if (schedule.lastRunSlot === slot) return;
      schedule.lastRunSlot = slot;
      schedule.lastRun = {
        ...(schedule.lastRun || {}),
        startedAt: now.toISOString(),
        completedAt: null,
        status: 'RUNNING',
        verificationStatus: 'IN_PROGRESS',
        frequency: schedule.frequency,
        totalBytes: 0,
        error: null
      };
      await persistAutomaticSchedule(schedule);
      void launchAutomaticRun(schedule, now);
    } finally {
      scheduleTickRunning = false;
    }
  }

  async function checkDriveCapacity(drive, remainingRequiredBytes) {
    const capacity = getFsCapacity(drive.path, fileSystem);
    if (capacity.usableBackupBytes < remainingRequiredBytes) {
      throw new Error(`Drive ${drive.driveNumber} no longer has enough safe capacity. ${remainingRequiredBytes} bytes remain planned; ${capacity.usableBackupBytes} safe bytes are available.`);
    }
    return capacity;
  }

  async function ensureSafeTarget(baseDirectory, targetPath) {
    const relative = path.relative(baseDirectory, targetPath);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Output path escaped its backup-set directory: ${targetPath}`);
    }
    const baseReal = await fsp.realpath(baseDirectory);
    const parsed = relative.split(path.sep).filter(Boolean);
    let current = baseReal;
    for (const segment of parsed.slice(0, -1)) {
      current = path.join(current, segment);
      try {
        const stat = await fsp.lstat(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe backup destination path component: ${current}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await fsp.mkdir(current);
      }
    }
    try {
      const targetStat = await fsp.lstat(targetPath);
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) throw new Error(`Unsafe existing backup target: ${targetPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async function hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    for await (const chunk of fileSystem.createReadStream(filePath)) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    return { checksum: hash.digest('hex'), bytes };
  }

  async function copyFileVerified(job, group, file, drive, baseDirectory, checksumsStream, speedState) {
    const targetPath = path.join(baseDirectory, ...file.outputRelativePath.split('/'));
    await ensureSafeTarget(baseDirectory, targetPath);
    const sourceStat = await fsp.lstat(file.sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size !== file.sizeBytes) {
      throw new Error(`Backup source changed or is not a regular file: ${file.relativePath}`);
    }
    const targetExpectedBytes = file.sizeBytes + (file.encrypted ? ENV_OVERHEAD_BYTES : 0);
    await checkDriveCapacity(drive, drive.remainingPlannedBytes);
    const sourceHash = crypto.createHash('sha256');
    let copiedBytes = 0;
    const categoryKey = progressCategoryKey(group.category);
    let lastCapacityCheck = Date.now();
    const sourceHasher = new Transform({
      transform(chunk, encoding, callback) {
        sourceHash.update(chunk);
        copiedBytes += chunk.length;
        job.progress.currentFileBytes = copiedBytes;
        addCopiedBytes(job, chunk.length, categoryKey, drive.driveNumber);
        const now = Date.now();
        const elapsed = Math.max(0.001, (now - speedState.lastSampleAt) / 1000);
        job.progress.bytesPerSecond = Math.round((job.completedBytes - speedState.lastBytes) / elapsed);
        speedState.lastBytes = job.completedBytes;
        speedState.lastSampleAt = now;
        job.progress.percent = job.totalBytes > 0
          ? Math.min(99.9, (job.completedBytes / job.totalBytes) * 100)
          : 0;
        job.progress.etaSeconds = job.progress.bytesPerSecond > 0
          ? Math.ceil((job.totalBytes - job.completedBytes) / job.progress.bytesPerSecond)
          : null;
        if (now - lastCapacityCheck >= 1000) {
          lastCapacityCheck = now;
          checkDriveCapacity(
            drive,
            Math.max(1, drive.remainingPlannedBytes - copiedBytes)
          ).catch((error) => sourceHasher.destroy(error));
        }
        callback(null, chunk);
      }
    });
    const targetHash = crypto.createHash('sha256');
    const destinationHasher = new Transform({
      transform(chunk, encoding, callback) {
        targetHash.update(chunk);
        callback(null, chunk);
      }
    });
    let cipher = null;
    let nonce = null;
    try {
      if (file.encrypted) {
        const key = getEncryptionKey();
        nonce = crypto.randomBytes(12);
        await fsp.writeFile(targetPath, Buffer.concat([ENV_HEADER, nonce]), { flag: 'w', mode: 0o600 });
        targetHash.update(ENV_HEADER);
        targetHash.update(nonce);
        cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
        const output = fileSystem.createWriteStream(targetPath, { flags: 'a' });
        await pipeline(
          fileSystem.createReadStream(file.sourcePath),
          sourceHasher,
          cipher,
          destinationHasher,
          output
        );
        const authTag = cipher.getAuthTag();
        await fsp.appendFile(targetPath, authTag);
        targetHash.update(authTag);
      } else {
        const output = fileSystem.createWriteStream(targetPath, { flags: 'w' });
        await pipeline(
          fileSystem.createReadStream(file.sourcePath),
          sourceHasher,
          destinationHasher,
          output
        );
      }
      const sourceChecksum = sourceHash.digest('hex');
      const transferredChecksum = targetHash.digest('hex');
      job.progress.stage = 'COPY_VERIFYING';
      job.verificationStatus = 'VERIFYING';
      const targetResult = await hashFile(targetPath);
      const targetSize = (await fsp.stat(targetPath)).size;
      const expectedTargetSize = file.sizeBytes + (file.encrypted ? ENV_OVERHEAD_BYTES : 0);
      if (copiedBytes !== file.sizeBytes || targetSize !== expectedTargetSize || targetResult.bytes !== targetSize || targetResult.checksum !== transferredChecksum) {
        throw new Error(`Verification failed for ${file.relativePath}: source and destination size/checksum differ.`);
      }
      if (!file.encrypted && sourceChecksum !== targetResult.checksum) {
        throw new Error(`SHA-256 verification failed for ${file.relativePath}.`);
      }
      await writeChecksum(
        checksumsStream,
        `${targetResult.checksum} ${targetSize} ${file.outputRelativePath}\n`
      );
      addCopiedBytes(job, file.encrypted ? ENV_OVERHEAD_BYTES : 0, categoryKey, drive.driveNumber);
      job.filesCompleted += 1;
      job.categoryProgress[categoryKey].filesCompleted += 1;
      job.progress.stage = 'COPYING';
      job.verificationStatus = 'IN_PROGRESS';
      updateJobProgress(job);
      drive.remainingPlannedBytes = Math.max(0, drive.remainingPlannedBytes - targetExpectedBytes);
    } catch (error) {
      addCopiedBytes(job, -copiedBytes, categoryKey, drive.driveNumber);
      await fsp.unlink(targetPath).catch(() => {});
      throw error;
    }
  }

  function writeChecksum(stream, line) {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        stream.off('drain', onDrain);
        reject(error);
      };
      const onDrain = () => {
        stream.off('error', onError);
        resolve();
      };
      stream.once('error', onError);
      if (stream.write(line)) {
        stream.off('error', onError);
        resolve();
      } else {
        stream.once('drain', onDrain);
      }
    });
  }

  async function runPgDump(job, group, drive, baseDirectory, checksumsStream, speedState) {
    const info = job.plan.database;
    const outputPath = path.join(baseDirectory, ...group.outputRelativePath.split('/'));
    const categoryKey = progressCategoryKey(group.category);
    await ensureSafeTarget(baseDirectory, outputPath);
    await checkDriveCapacity(drive, drive.remainingPlannedBytes);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    const env = { ...environment };
    if (environment.DB_HOST || environment.PGHOST) env.PGHOST = environment.DB_HOST || environment.PGHOST;
    if (environment.DB_PORT || environment.PGPORT) env.PGPORT = String(environment.DB_PORT || environment.PGPORT);
    if (environment.DB_USER || environment.PGUSER) env.PGUSER = environment.DB_USER || environment.PGUSER;
    if (environment.DB_PASSWORD || environment.PGPASSWORD) env.PGPASSWORD = environment.DB_PASSWORD || environment.PGPASSWORD;
    env.PGDATABASE = info.name;
    const args = [
      '--no-password',
      '--format=custom',
      '--create',
      '--compress=6',
      '--file', outputPath,
      '--dbname', info.name
    ];
    await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnProcess(job.plan.database.pgDump.executable, args, {
          env,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe']
        });
      } catch (error) {
        reject(new Error(`pg_dump could not be started: ${formatError(error)}`));
        return;
      }
      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-8000);
      });
      let progressCheckActive = false;
      const progressTimer = setInterval(async () => {
        if (progressCheckActive) return;
        progressCheckActive = true;
        try {
          const stat = await fsp.stat(outputPath);
          const delta = Math.max(0, stat.size - (job.progress.currentFileBytes || 0));
          job.progress.currentFileBytes = stat.size;
          addCopiedBytes(job, delta, categoryKey, drive.driveNumber);
          job.progress.bytesPerSecond = Math.round((job.completedBytes - speedState.lastBytes) / Math.max(0.001, (Date.now() - speedState.lastSampleAt) / 1000));
          speedState.lastBytes = job.completedBytes;
          speedState.lastSampleAt = Date.now();
          job.progress.percent = job.totalBytes > 0 ? Math.min(99.9, (job.completedBytes / job.totalBytes) * 100) : 0;
          job.progress.etaSeconds = job.progress.bytesPerSecond > 0 ? Math.ceil((job.totalBytes - job.completedBytes) / job.progress.bytesPerSecond) : null;
          await checkDriveCapacity(
            drive,
            Math.max(1, drive.remainingPlannedBytes - stat.size)
          );
        } catch (error) {
          if (error.code !== 'ENOENT') {
            child.kill();
            clearInterval(progressTimer);
            reject(error);
          }
        } finally {
          progressCheckActive = false;
        }
      }, 1000);
      child.once('error', (error) => {
        clearInterval(progressTimer);
        reject(new Error(`pg_dump could not be started: ${formatError(error)}`));
      });
      child.once('close', async (code, signal) => {
        clearInterval(progressTimer);
        if (code !== 0) {
          reject(new Error(`pg_dump failed${signal ? ` (${signal})` : ` with exit code ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
          return;
        }
        try {
          const stat = await fsp.stat(outputPath);
          if (!stat.isFile() || stat.size <= 0) throw new Error('pg_dump produced an empty or missing database dump.');
          await checkDriveCapacity(drive, Math.max(0, drive.remainingPlannedBytes - stat.size));
          const dumpHandle = await fsp.open(outputPath, 'r');
          let dumpHeader;
          try {
            dumpHeader = Buffer.alloc(5);
            const { bytesRead } = await dumpHandle.read(dumpHeader, 0, dumpHeader.length, 0);
            if (bytesRead !== dumpHeader.length) throw new Error('Database dump is too short to be a valid custom-format archive.');
          } finally {
            await dumpHandle.close();
          }
          if (dumpHeader.toString('ascii') !== 'PGDMP') {
            throw new Error('Database dump does not have the PostgreSQL custom-format archive signature.');
          }
          job.progress.stage = 'COPY_VERIFYING';
          job.verificationStatus = 'VERIFYING';
          const verified = await hashFile(outputPath);
          if (verified.bytes !== stat.size) throw new Error('Database dump size changed during verification.');
          await writeChecksum(
            checksumsStream,
            `${verified.checksum} ${stat.size} ${group.outputRelativePath}\n`
          );
          addCopiedBytes(job, Math.max(0, stat.size - job.progress.currentFileBytes), categoryKey, drive.driveNumber);
          const previousTotalBytes = job.totalBytes;
          job.totalBytes = Math.max(job.completedBytes, job.totalBytes - group.requiredBytes + stat.size);
          job.categoryProgress[categoryKey].totalBytes = stat.size;
          const driveProgress = job.progress.drives.find((entry) => entry.driveNumber === drive.driveNumber);
          if (driveProgress) driveProgress.totalBytes = Math.max(driveProgress.bytesCompleted, driveProgress.totalBytes - group.requiredBytes + stat.size);
          job.progress.currentFileSize = stat.size;
          job.filesCompleted += 1;
          job.categoryProgress[categoryKey].filesCompleted += 1;
          drive.remainingPlannedBytes = Math.max(0, drive.remainingPlannedBytes - stat.size);
          job.progress.stage = 'COPYING';
          job.verificationStatus = 'IN_PROGRESS';
          updateJobProgress(job);
          if (job.completedBytes > previousTotalBytes) job.progress.percent = Math.min(99.9, job.completedBytes / job.totalBytes * 100);
          job.databaseResult = {
            name: info.name,
            serverVersion: info.version,
            pgDumpVersion: info.pgDump.version,
            sizeBytes: stat.size,
            sha256: verified.checksum,
            verified: true
          };
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    }).catch(async (error) => {
      addCopiedBytes(job, -(job.progress.currentFileBytes || 0), categoryKey, drive.driveNumber);
      await fsp.unlink(outputPath).catch(() => {});
      throw error;
    });
  }

  async function writeManifest(job, statusOverride = job.status) {
    const manifest = {
      format: 'GFXUNLIMIT-BACKUP-SET',
      formatVersion: 1,
      backupSetId: job.id,
      backupType: job.backupType || 'MANUAL',
      automaticFrequency: job.automaticFrequency || null,
      automaticRunDate: job.automaticRunDate || null,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      status: statusOverride,
      selectedTypes: job.selectedTypes,
      applicationVersion: job.applicationVersion,
      applicationCommit: job.applicationCommit,
      database: job.databaseResult || {
        name: job.plan.database.name,
        serverVersion: job.plan.database.version,
        pgDumpVersion: job.plan.database.pgDump.version,
        estimatedBytes: job.plan.database.estimatedBytes,
        verified: false
      },
      sourceRoots: job.plan.sourceRoots,
      destinationDrives: job.plan.drives.map((drive) => ({
        driveNumber: drive.driveNumber,
        path: drive.path,
        actualCapacityBytes: drive.actualCapacityBytes,
        currentAvailableBytes: drive.currentAvailableBytes,
        currentUsedBytes: drive.currentUsedBytes,
        safetyLimitBytes: drive.safetyLimitBytes,
        plannedBytes: drive.requiredBytes,
        status: drive.status
      })),
      totals: {
        files: job.filesCompleted,
        plannedFiles: job.filesTotal,
        copiedBytes: job.completedBytes,
        plannedBytes: job.totalBytes,
        categories: job.plan.categories
      },
      checksumsFile: 'checksums.sha256',
      environmentFilesEncrypted: true,
      environmentEncryption: 'AES-256-GCM; key supplied through BACKUP_ENCRYPTION_KEY',
      verificationStatus: job.verificationStatus,
      errors: job.errors
    };
    for (const drive of job.drives) {
      const manifestPath = path.join(drive.setDirectory, 'manifest.json');
      await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    }
  }

  async function runJob(job) {
    const timer = setInterval(() => {
      upsertHistory(job).catch((error) => console.error('Could not persist backup history:', formatError(error)));
    }, 1000);
    const speedState = { lastBytes: 0, lastSampleAt: Date.now() };
    const checksumStreams = [];
    const checksumErrors = new Map();
    try {
      job.drives = job.plan.drives.map((drive) => {
        const setDirectory = job.automaticFolder
          ? job.automaticFolder.targetPath
          : path.join(
              drive.path,
              'GFXunlimit',
              `Backup-Set-${job.id}`,
              `Drive-${drive.driveNumber}`
            );
        return { ...drive, setDirectory, remainingPlannedBytes: drive.requiredBytes };
      });
      if (job.automaticFolder) await prepareAutomaticFolder(job);
      for (const drive of job.drives) {
        await checkDriveCapacity(drive, drive.remainingPlannedBytes);
        if (!job.automaticFolder) {
          await fsp.mkdir(path.dirname(drive.setDirectory), { recursive: true });
          try {
            await fsp.mkdir(drive.setDirectory, { recursive: false });
          } catch (error) {
            if (error.code === 'EEXIST') throw new Error(`Backup set already exists at ${drive.setDirectory}; refusing to mix files from separate jobs.`);
            throw error;
          }
        }
        const checksumsPath = path.join(drive.setDirectory, 'checksums.sha256');
        const checksumStream = fileSystem.createWriteStream(checksumsPath, { flags: 'wx', mode: 0o600 });
        checksumStream.on('error', (error) => checksumErrors.set(drive.driveNumber, error));
        checksumStreams[drive.driveNumber] = checksumStream;
      }

      const driveByNumber = new Map(job.drives.map((drive) => [drive.driveNumber, drive]));
      for (const allocation of job.plan.drives) {
        const drive = driveByNumber.get(allocation.driveNumber);
        const driveProgress = job.progress.drives.find((entry) => entry.driveNumber === drive.driveNumber);
        if (driveProgress) driveProgress.status = 'RUNNING';
        job.progress.drivePath = drive.path;
        job.progress.driveNumber = drive.driveNumber;
        job.progress.stage = 'COPYING';
        job.progress.category = allocation.groups[0]?.category || 'Preparing';
        updateJobProgress(job);
        for (const group of job.plan.internalGroups.filter((candidate) => allocation.groups.some((item) => item.key === candidate.key))) {
          job.progress.category = group.category;
          job.verificationStatus = 'IN_PROGRESS';
          job.progress.drivePath = drive.path;
          if (group.kind === 'database') {
            job.progress.currentPath = group.outputRelativePath;
            job.progress.currentFileBytes = 0;
            job.progress.currentFileSize = group.requiredBytes;
            await runPgDump(job, group, drive, drive.setDirectory, checksumStreams[drive.driveNumber], speedState);
          } else {
            for (const file of group.files) {
              job.progress.currentPath = file.outputRelativePath;
              job.progress.currentFileBytes = 0;
              job.progress.currentFileSize = file.sizeBytes + (file.encrypted ? ENV_OVERHEAD_BYTES : 0);
              await copyFileVerified(job, group, file, drive, drive.setDirectory, checksumStreams[drive.driveNumber], speedState);
            }
          }
        }
        if (driveProgress) driveProgress.status = 'COMPLETE';
        updateJobProgress(job);
      }
      job.progress.stage = 'VERIFYING';
      job.progress.category = 'Final verification';
      job.verificationStatus = 'VERIFYING';
      job.progress.copyPercent = 100;
      job.progress.currentPath = '';
      job.progress.currentFileBytes = 0;
    } catch (error) {
      job.status = 'FAILED';
      job.verificationStatus = 'FAILED';
      job.errors.push({
        message: formatError(error),
        path: job.progress.currentPath || null,
        driveNumber: job.progress.driveNumber
      });
    } finally {
      clearInterval(timer);
      for (const [driveNumber, stream] of Object.entries(checksumStreams)) {
        if (!stream) continue;
        try {
          await new Promise((resolve, reject) => {
            stream.once('error', reject);
            stream.end(resolve);
          });
          if (checksumErrors.has(Number(driveNumber))) throw checksumErrors.get(Number(driveNumber));
        } catch (error) {
          job.status = 'FAILED';
          job.verificationStatus = 'FAILED';
          job.errors.push({
            message: `Checksum inventory could not be finalized: ${formatError(error)}`,
            path: 'checksums.sha256'
          });
        }
      }
      job.completedAt = clock().toISOString();
      job.durationMs = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
      if (job.status === 'SUCCESS') job.progress.percent = 100;
      let manifestStatus = job.status;
      try {
        if (job.status === 'RUNNING') {
          job.verificationStatus = 'VERIFIED';
          job.progress.stage = 'FINALIZING';
          await writeManifest(job, 'SUCCESS');
          job.status = 'SUCCESS';
          job.progress.stage = 'COMPLETE';
          job.progress.percent = 100;
          job.progress.category = 'Complete';
          job.progress.currentPath = '';
          job.progress.currentFileBytes = 0;
          updateJobProgress(job);
        } else {
          await writeManifest(job);
        }
        manifestStatus = job.status;
      } catch (error) {
        job.status = 'FAILED';
        job.verificationStatus = 'FAILED';
        job.errors.push({ message: `Backup manifest could not be finalized: ${formatError(error)}`, path: 'manifest.json' });
        try {
          await writeManifest(job, 'FAILED');
          manifestStatus = job.status;
        } catch (retryError) {
          job.errors.push({ message: `Failed manifest could not be updated: ${formatError(retryError)}`, path: 'manifest.json' });
        }
      }
      try {
        await upsertHistory(job);
      } catch (error) {
        job.status = 'FAILED';
        job.verificationStatus = 'FAILED';
        job.errors.push({ message: `Backup job history could not be persisted: ${formatError(error)}`, path: null });
        try {
          await upsertHistory(job);
        } catch (retryError) {
          job.errors.push({ message: `Failed backup state could not be persisted after retry: ${formatError(retryError)}`, path: null });
        }
      }
      if (manifestStatus !== job.status) {
        try {
          await writeManifest(job);
        } catch (error) {
          job.errors.push({ message: `Failed manifest could not be updated after job-state persistence failed: ${formatError(error)}`, path: 'manifest.json' });
        }
      }
      activeJobId = null;
      await fsp.unlink(activeLockFile).catch((error) => {
        if (error.code !== 'ENOENT') console.error('Could not release backup job lock:', formatError(error));
      });
      if (job.backupType === 'AUTOMATIC') {
        await finishAutomaticRun(job).catch((error) => {
          console.error('Could not persist automatic backup schedule status:', formatError(error));
        });
      }
    }
  }

  async function getJob(jobId) {
    const current = jobs.get(jobId);
    if (current) return publicJob(current);
    const history = await loadHistory();
    return history.find((entry) => entry.id === jobId) || null;
  }

  async function getActiveJob() {
    return activeJobId ? getJob(activeJobId) : null;
  }

  async function getHistory() {
    const history = await loadHistory();
    if (!activeJobId) {
      try {
        const lock = JSON.parse(await fsp.readFile(activeLockFile, 'utf8'));
        let processIsRunning = false;
        if (Number.isInteger(lock.pid) && lock.pid > 0) {
          try {
            process.kill(lock.pid, 0);
            processIsRunning = true;
          } catch (error) {
            if (error.code !== 'ESRCH') throw error;
          }
        }
        if (!processIsRunning) {
          const stale = history.find((entry) => entry.id === lock.jobId && entry.status === 'RUNNING');
          if (stale) {
            stale.status = 'FAILED';
            stale.completedAt = clock().toISOString();
            stale.verificationStatus = 'FAILED';
            stale.errors = [{ message: 'Backup process stopped before the job completed.', path: null }];
            historyCache = history;
            await persistHistory();
          }
          await fsp.unlink(activeLockFile);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error(`Backup job state could not be recovered: ${formatError(error)}`);
      }
    }
    return history;
  }

  return {
    browseDestination,
    buildPlan,
    createJob,
    getActiveJob,
    getAutomaticSchedule,
    getHistory,
    getJob,
    publicPlan,
    testDestination,
    testDriveSet,
    getSourceMetrics,
    saveAutomaticSchedule,
    tickAutomaticSchedule
  };
}

module.exports = {
  CATEGORY_KEYS,
  ENV_OVERHEAD_BYTES,
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
  selectRollingFolder,
  scheduleSlotKey,
  pathsOverlap,
  planLogicalGroups
};
