'use strict';

const AdmZip = require('adm-zip');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const readline = require('node:readline');

const PACKAGE_CATEGORIES = [
  { id: 'database', name: 'Generate and validate the PostgreSQL backup', backupCategory: 'database', backupLabel: 'Database' },
  { id: 'websiteCode', name: 'Collect website source and encrypted configuration', backupCategory: 'websiteCode', backupLabel: 'Website Code' },
  { id: 'originalAssets', name: 'Collect original assets', backupCategory: 'assetsAndThumbnails', backupLabel: 'Assets' },
  { id: 'thumbnails', name: 'Collect thumbnails', backupCategory: 'assetsAndThumbnails', backupLabel: 'Thumbnails' }
];
const FINAL_TASKS = [
  { id: 'wizard', name: 'Generate the standalone HTML Restore Wizard' },
  { id: 'helper', name: 'Build the helper ZIP and documentation' },
  { id: 'verify', name: 'Verify the generated files and archives' },
  { id: 'ready', name: 'Mark the package ready for authorized download' }
];
const ARTIFACTS = [
  { id: 'database', filename: 'stocksite.backup', label: 'PostgreSQL database backup' },
  { id: 'websiteCode', filename: 'website-code.zip', label: 'Website source and encrypted configuration' },
  { id: 'originalAssets', filename: 'original-assets.zip', label: 'Original assets archive' },
  { id: 'thumbnails', filename: 'thumbnails.zip', label: 'Thumbnail archive' },
  { id: 'wizardHtml', filename: 'stocksite-restore-wizard.html', label: 'Standalone HTML Restore Wizard' },
  { id: 'helperZip', filename: 'stocksite-restore-helper.zip', label: 'Restore helper, manifest, and documentation' },
  { id: 'softwareManifest', filename: 'restore-manifest.json', label: 'Versioned software manifest' },
  { id: 'packageDocumentation', filename: 'RESTORE_PACKAGE_README.md', label: 'Restore package documentation' },
  { id: 'packageManifest', filename: 'restore-package-manifest.json', label: 'Restore package metadata' },
  { id: 'packageChecksums', filename: 'checksums.sha256', label: 'Restore package SHA-256 checksums' }
];
const HELPER_PACKAGE_FILES = [
  'README.md',
  'restore-wizard.html',
  'restore-manifest.json',
  'helper/.env.example',
  'helper/package.json',
  'helper/package-lock.json',
  'helper/server.js',
  'helper/start-macos.sh',
  'helper/start-windows.cmd'
];
const PACKAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const PACKAGE_SIGNATURE_DOMAIN = 'STOCKSITE-RESTORE-PACKAGE-V1\n';
const ACTIVE = new Set(['WAITING', 'RUNNING']);
const CODE_EXCLUSION_POLICY = [
  { pattern: '.git/**', reason: 'Local Git metadata and history are not needed to install or run the application.' },
  { pattern: '**/.vscode/**', reason: 'Editor-specific workspace configuration and personal settings are not required runtime configuration.' },
  { pattern: '**/{.ssh,.aws,.azure,.gnupg,.secrets}/**', reason: 'Private keys, cloud credentials, and unrelated secret stores are excluded.' },
  { pattern: '**/*.{pem,p12,pfx,key,jks,keystore} and common credential/key filenames', reason: 'Private key and credential files are not transferred; provision approved local secrets separately.' },
  { pattern: '**/.npmrc containing registry authentication values', reason: 'Registry tokens and passwords are excluded; configure a destination-specific package registry credential.' },
  { pattern: '**/node_modules/**', reason: 'Dependencies are regenerated from the included package manifests and lockfiles.' },
  { pattern: '**/{build,dist,coverage}/**', reason: 'Generated build output and test coverage can be recreated.' },
  { pattern: '**/{backup,backups,backup-system}/**', reason: 'Backup artifacts and backup service state are not application source.' },
  { pattern: '**/{tmp,temp,.cache,cache,logs,log,uploads,.upload-staging}/**', reason: 'Runtime, temporary, cache, log, and upload data is not source code; production assets are packaged separately.' },
  { pattern: '**/{.DS_Store,Thumbs.db,desktop.ini,dump.rdb}', reason: 'Operating-system metadata and generated database dump files are excluded.' },
  { pattern: '**/*.{log,tmp,temp}', reason: 'Generated logs and temporary files are excluded.' },
  { pattern: 'project-root entries outside the approved source roots and startup/configuration files', reason: 'Only the Stocksite project configuration, backend, frontend, scripts, and GFX-Aanav source roots are collected; unrelated root content is not included.' }
];

function safeSourcePath(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !path.posix.isAbsolute(value) &&
    value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function isSecretEnvironmentPath(value) {
  const name = path.posix.basename(String(value || '').replace(/\\/g, '/'));
  return /^\.env(?:$|[.-])/i.test(name) &&
    !/^\.env\.(?:example|sample|template)(?:$|[.-])/i.test(name);
}
function safeMessage(error) {
  return String(error?.message || error || 'Unknown restore package error')
    .replace(/(password|token|secret|authorization)\s*[=:]\s*\S+/ig, '$1=[REDACTED]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/ig, 'postgresql://[REDACTED]');
}

function makeTask({ id, name, status = 'WAITING' }) {
  return { id, name, status, operation: status === 'WAITING' ? 'Waiting' : '', percent: null, filesCompleted: null, filesTotal: null, bytesCompleted: 0, bytesTotal: null, error: null };
}

function createRestorePackageService(options = {}) {
  const backupService = options.backupService;
  if (!backupService) throw new Error('The verified backup service is required for restore package generation.');
  const platform = options.platform || process.platform;
  const stateDirectory = path.resolve(options.stateDirectory || path.join(os.tmpdir(), 'stocksite-restore-package-state'));
  const outputRoot = path.resolve(options.outputRoot || path.join(os.tmpdir(), 'gfxunlimit-manual-backup-exports', 'GFXunlimit'));
  const restoreWizardRoot = path.resolve(options.restoreWizardRoot || path.resolve(__dirname, '../../restore-wizard'));
  const spawnProcess = options.spawn || spawn;
  const getFilesystemCapacity = options.statfs || ((directory) => fsp.statfs(directory));
  async function packageSigner() {
    let privateKeyBytes = options.packageSigningPrivateKey || '';
    const configuredKeyPath = options.packageSigningPrivateKeyFile || process.env.RESTORE_PACKAGE_SIGNING_PRIVATE_KEY_FILE;
    if (!privateKeyBytes && configuredKeyPath) {
      const keyPath = path.resolve(configuredKeyPath);
      const noFollow = fs.constants.O_NOFOLLOW || 0;
      const keyHandle = await fsp.open(keyPath, fs.constants.O_RDONLY | noFollow);
      try {
        const stat = await keyHandle.stat();
        if (!stat.isFile() || (process.getuid && stat.uid !== process.getuid()) ||
            (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
          throw new Error('Restore package signing key must be a protected regular file owned by the package service account.');
        }
        privateKeyBytes = await keyHandle.readFile();
      } finally {
        await keyHandle.close();
      }
      if (!privateKeyBytes) {
        throw new Error('Restore package signing key must be a protected regular file with no group or other permissions.');
      }
    }
    if (!privateKeyBytes) {
      throw new Error('Restore package signing is not configured; refusing to generate an unauthenticated restore package.');
    }
    let privateKey;
    try {
      privateKey = crypto.createPrivateKey(privateKeyBytes);
    } catch (_error) {
      throw new Error('Restore package signing key is invalid.');
    }
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('Restore package signing requires an Ed25519 private key.');
    }
    const publicKey = crypto.createPublicKey(privateKey);
    const keyId = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 24);
    return { privateKey, keyId };
  }
  async function createBackupJobAfterFinalization(jobOptions) {
    try {
      return await backupService.createJob(jobOptions);
    } catch (error) {
      if (
        error.message !== 'A backup job is already running. Wait for it to finish before starting another.' ||
        typeof backupService.getActiveJob !== 'function'
      ) {
        throw error;
      }
      const activeBackupJob = await backupService.getActiveJob();
      if (!activeBackupJob || ACTIVE.has(activeBackupJob.status)) throw error;

      const timeoutMs = options.backupJobFinalizationTimeoutMs ?? 30_000;
      const pollIntervalMs = options.backupJobFinalizationPollMs ?? 100;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const currentBackupJob = await backupService.getActiveJob();
        if (!currentBackupJob) return backupService.createJob(jobOptions);
        if (ACTIVE.has(currentBackupJob.status)) throw error;
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      throw new Error('The previous backup job has finished with a terminal status, but the SERVER is still finalizing it. Wait briefly before starting a new restore package.');
    }
  }
  const jobs = new Map();
  let activeJobId = null;

  const jobStatePath = (id) => path.join(stateDirectory, `${id}.json`);
  const jobOutputPath = (id) => path.join(outputRoot, `Restore-Package-${id}`);
  const publicJob = (job) => ({
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    expiresAt: new Date(Date.parse(job.completedAt || job.startedAt) + PACKAGE_RETENTION_MS).toISOString(),
    elapsedMs: Math.max(0, (Date.parse(job.completedAt || new Date().toISOString()) || Date.now()) - Date.parse(job.startedAt)),
    currentOperation: job.currentOperation,
    progress: job.progress,
    sourceProgress: job.sourceProgress || null,
    tasks: job.tasks,
    artifacts: job.artifacts,
    error: job.error
  });

  async function persist(job) {
    updateOverallProgress(job);
    await fsp.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    const destination = jobStatePath(job.id);
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(job), { mode: 0o600 });
    await fsp.rename(temporary, destination);
  }

  async function pruneExpiredPackages() {
    let entries;
    try {
      entries = await fsp.readdir(stateDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const match = /^([A-Za-z0-9-]{1,120})\.json$/.exec(entry.name);
      if (!entry.isFile() || entry.isSymbolicLink() || !match) continue;
      const statePath = path.join(stateDirectory, entry.name);
      const job = JSON.parse(await fsp.readFile(statePath, 'utf8'));
      if (ACTIVE.has(job.status)) continue;
      const finishedAt = Date.parse(job.completedAt || job.startedAt);
      if (!Number.isFinite(finishedAt) || Date.now() - finishedAt < PACKAGE_RETENTION_MS) continue;
      const outputPath = jobOutputPath(match[1]);
      try {
        const stat = await fsp.lstat(outputPath);
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
          const [root, candidate] = await Promise.all([fsp.realpath(outputRoot), fsp.realpath(outputPath)]);
          const relative = path.relative(root, candidate);
          if (relative === path.basename(outputPath) && !path.isAbsolute(relative)) {
            await fsp.rm(candidate, { recursive: true, force: false });
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await fsp.unlink(statePath);
      jobs.delete(match[1]);
    }
  }

  function initializeTasks() {
    const tasks = [
      makeTask({ id: 'validate', name: 'Validate server access and configured sources', status: 'COMPLETED' }),
      ...PACKAGE_CATEGORIES.map(({ id, name }) => makeTask({ id, name })),
      ...FINAL_TASKS.map(({ id, name }) => makeTask({ id, name }))
    ];
    return tasks;
  }

  function updateOverallProgress(job) {
    const finished = job.tasks.filter(({ status }) => status === 'COMPLETED').length;
    const activeFraction = job.tasks
      .filter(({ status, percent }) => ['RUNNING', 'FAILED'].includes(status) && Number.isFinite(percent))
      .reduce((sum, task) => sum + Math.min(100, Math.max(0, task.percent)) / 100, 0);
    job.progress = {
      completed: finished,
      total: job.tasks.length,
      percent: !job.tasks.length
        ? null
        : finished === job.tasks.length
          ? 100
          : Math.min(99, Math.floor((finished + activeFraction) / job.tasks.length * 100))
    };
  }

  function updateCollectionTasks(job, backupJob) {
    job.sourceProgress = {
      bytesCompleted: Number(backupJob?.progress?.bytesCompleted || 0),
      bytesTotal: Number(backupJob?.progress?.bytesTotal || 0),
      filesCompleted: Number(backupJob?.progress?.filesCompleted || 0),
      filesTotal: Number(backupJob?.progress?.filesTotal || 0),
      bytesPerSecond: Number(backupJob?.progress?.bytesPerSecond || 0),
      etaSeconds: Number.isFinite(backupJob?.progress?.etaSeconds) ? Number(backupJob.progress.etaSeconds) : null,
      stage: backupJob?.progress?.stage || null,
      category: backupJob?.progress?.category || null
    };
    const categories = backupJob?.progress?.categories || {};
    for (const definition of PACKAGE_CATEGORIES) {
      const task = job.tasks.find(({ id }) => id === definition.id);
      if (!task || task.status === 'FAILED') continue;
      const progress = categories[definition.backupCategory];
      if (progress) {
        if (definition.backupCategory !== 'assetsAndThumbnails') {
          task.filesCompleted = Number(progress.filesCompleted || 0);
          task.filesTotal = Number(progress.filesTotal || 0);
          task.bytesCompleted = Number(progress.bytesCompleted || 0);
          task.bytesTotal = Number(progress.totalBytes || 0);
          task.percent = task.bytesTotal > 0
            ? Math.min(100, Math.round(task.bytesCompleted / task.bytesTotal * 100))
            : task.filesTotal > 0
              ? Math.min(100, Math.round(task.filesCompleted / task.filesTotal * 100))
              : null;
        }
      }
      if (
        definition.backupCategory !== 'assetsAndThumbnails' &&
        task.filesTotal > 0 && task.filesCompleted >= task.filesTotal
      ) {
        task.status = 'COMPLETED';
        task.percent = 100;
        task.operation = 'Verified by backup engine';
      } else if (backupJob?.progress?.category === definition.backupLabel) {
        task.status = 'RUNNING';
        task.operation = backupJob.progress.stage || 'Collecting';
      }
    }
    if (backupJob?.status === 'SUCCESS' && backupJob?.verificationStatus === 'VERIFIED') {
      for (const definition of PACKAGE_CATEGORIES) {
        const task = job.tasks.find(({ id }) => id === definition.id);
        if (task) {
          task.status = 'COMPLETED';
          task.percent = 100;
          task.operation = 'Verified by backup engine';
        }
      }
    }
    updateOverallProgress(job);
  }

  function setTask(job, id, status, operation, percent = null) {
    const task = job.tasks.find((item) => item.id === id);
    if (!task) throw new Error(`Unknown restore package task: ${id}`);
    task.status = status;
    task.operation = operation;
    task.percent = percent;
    job.currentOperation = operation;
    updateOverallProgress(job);
  }

  function runProcess(command, args, env, timeoutMs = 30 * 60 * 1000, onStdout = null, idleTimeoutMs = 0) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnProcess(command, args, {
          env: { ...process.env, ...env },
          windowsHide: true,
          shell: false,
          stdio: ['ignore', onStdout ? 'pipe' : 'ignore', 'pipe']
        });
      } catch (error) {
        reject(new Error(`Could not start archive utility: ${safeMessage(error)}`));
        return;
      }
      let stderr = '';
      let settled = false;
      let timer;
      let idleTimer;
      let terminationTimer;
      let escalationTimer;
      let outputDrainTimer;
      let terminationMessage = '';
      let terminationIssue = '';
      let exitObserved = false;
      const clearTimers = () => {
        clearTimeout(timer);
        clearTimeout(idleTimer);
        clearTimeout(terminationTimer);
        clearTimeout(escalationTimer);
        clearTimeout(outputDrainTimer);
      };
      const rejectProcessError = (message, processTerminated) => {
        const error = new Error(message);
        error.processTerminated = processTerminated;
        reject(error);
      };
      const requestTermination = (signal) => {
        try {
          const requested = platform === 'win32' ? child.kill() : child.kill(signal);
          if (!requested) return ' The archive process did not confirm the termination request.';
          return '';
        } catch (error) {
          return ` The archive process could not be terminated: ${safeMessage(error)}`;
        }
      };
      const destroyOutputStreams = () => {
        for (const stream of [child.stdout, child.stderr]) {
          if (stream && !stream.destroyed && typeof stream.destroy === 'function') stream.destroy();
        }
      };
      const failAndTerminate = (message) => {
        if (settled || terminationMessage) return;
        terminationMessage = message;
        clearTimeout(timer);
        clearTimeout(idleTimer);
        terminationIssue = requestTermination('SIGTERM');
        const terminationGraceMs = options.archiveTerminationGraceMs ?? 5000;
        terminationTimer = setTimeout(() => {
          if (settled) return;
          terminationIssue += requestTermination('SIGKILL');
          escalationTimer = setTimeout(() => {
            if (settled || exitObserved) return;
            settled = true;
            clearTimers();
            rejectProcessError(
              `${terminationMessage}${terminationIssue} Archive process exit could not be confirmed.`,
              false
            );
          }, terminationGraceMs);
        }, terminationGraceMs);
      };
      const resetIdleTimer = () => {
        if (!idleTimeoutMs) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          failAndTerminate(`Windows ZIP generation made no measurable progress for ${Math.ceil(idleTimeoutMs / 1000)} seconds; PowerShell was terminated. Check SERVER disk activity and source-file access before retrying.`);
        }, idleTimeoutMs);
      };
      child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-6000); });
      if (onStdout) {
        child.stdout?.on('data', (chunk) => {
          if (onStdout(chunk) === true) resetIdleTimer();
        });
      }
      timer = setTimeout(() => {
        failAndTerminate('Archive generation or validation exceeded the 30 minute time limit; the archive process was terminated.');
      }, timeoutMs);
      resetIdleTimer();
      child.once('error', (error) => {
        if (settled) return;
        if (terminationMessage) return;
        settled = true;
        clearTimers();
        rejectProcessError(`Archive utility could not be started: ${safeMessage(error)}`, !child.pid);
      });
      child.once('exit', (code, signal) => {
        exitObserved = true;
        clearTimeout(timer);
        clearTimeout(idleTimer);
        clearTimeout(terminationTimer);
        clearTimeout(escalationTimer);
        outputDrainTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          clearTimers();
          destroyOutputStreams();
          const exitDescription = signal ? `signal ${signal}` : `exit code ${code}`;
          rejectProcessError(
            `${terminationMessage || `Archive process exited with ${exitDescription}, but its output streams did not close within ${Math.ceil((options.archiveOutputDrainTimeoutMs ?? 10_000) / 1000)} seconds.`}${terminationIssue}`,
            true
          );
        }, options.archiveOutputDrainTimeoutMs ?? 10_000);
      });
      child.once('close', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (terminationMessage) {
          rejectProcessError(terminationMessage, true);
          return;
        }
        if (code !== 0 || signal) {
          rejectProcessError(`Archive utility failed${signal ? ` (${signal})` : ` with exit code ${code}`}${stderr.trim() ? `: ${safeMessage(stderr.trim())}` : ''}`, true);
        } else resolve();
      });
    });
  }

  async function createDataArchive(sourceDirectory, outputFile, expectedFileCount, expectedBytes, onProgress = () => {}, persistProgress = async () => {}) {
    if (platform === 'win32') {
      const command = options.powershellPath || 'powershell.exe';
      const script = String.raw`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src=[IO.Path]::GetFullPath($env:RESTORE_PACKAGE_SOURCE).TrimEnd('\')
$expectedCount=[int]$env:RESTORE_PACKAGE_EXPECTED_COUNT
$expectedBytes=[long]$env:RESTORE_PACKAGE_EXPECTED_BYTES
$progressBytes=4MB
$buffer=New-Object byte[] (256KB)
function Write-PackageProgress([string]$phase,[int]$files,[long]$bytes) {
  [Console]::Out.WriteLine("STOCKSITE_PROGRESS|$phase|$files|$bytes")
}
function Write-PackageVerified([int]$files,[long]$bytes) {
  [Console]::Out.WriteLine("STOCKSITE_ARCHIVE_VERIFIED|$files|$bytes")
}
$files=Get-ChildItem -LiteralPath $src -Force -Recurse -File
if($files.Count -ne $expectedCount){throw 'Source file count changed'}
Write-PackageProgress 'create' 0 0
$zip=[IO.Compression.ZipFile]::Open($env:RESTORE_PACKAGE_OUTPUT,[IO.Compression.ZipArchiveMode]::Create)
$bytes=0
$filesDone=0
$seen=@{}
try {
  foreach($f in $files) {
    $rel=$f.FullName.Substring($src.Length+1).Replace('\','/')
    if([string]::IsNullOrWhiteSpace($rel) -or $rel.StartsWith('/') -or $rel -match '^[A-Za-z]:' -or $rel.Split('/') -contains '..' -or $seen.ContainsKey($rel)){throw 'Unsafe or duplicate archive path'}
    $seen[$rel]=$true
    $entry=$zip.CreateEntry($rel,[IO.Compression.CompressionLevel]::Optimal)
    $input=[IO.File]::OpenRead($f.FullName)
    $output=$entry.Open()
    try {
      while(($read=$input.Read($buffer,0,$buffer.Length)) -gt 0) {
        $output.Write($buffer,0,$read)
        $bytes+=$read
        if($bytes -ge $progressBytes) {
          Write-PackageProgress 'create' $filesDone $bytes
          $progressBytes=$bytes+4MB
        }
      }
    } finally {$output.Dispose();$input.Dispose()}
    $filesDone++
    Write-PackageProgress 'create' $filesDone $bytes
  }
  if($bytes -ne $expectedBytes){throw 'Source byte total changed'}
} finally {$zip.Dispose()}
$check=[IO.Compression.ZipFile]::OpenRead($env:RESTORE_PACKAGE_OUTPUT)
try {
  if($check.Entries.Count -ne $expectedCount){throw 'Archive file count mismatch'}
  $sum=0
  $verifiedFiles=0
  $progressBytes=4MB
  Write-PackageProgress 'verify' 0 0
  foreach($e in $check.Entries) {
    if($e.FullName.StartsWith('/') -or $e.FullName.Contains('\') -or $e.FullName -match '^[A-Za-z]:' -or $e.FullName.Split('/') -contains '..'){throw 'Unsafe archive entry'}
    $s=$e.Open()
    try {
      while(($read=$s.Read($buffer,0,$buffer.Length)) -gt 0) {
        $sum+=$read
        if($sum -ge $progressBytes) {
          Write-PackageProgress 'verify' $verifiedFiles $sum
          $progressBytes=$sum+4MB
        }
      }
    } finally {$s.Dispose()}
    $verifiedFiles++
    Write-PackageProgress 'verify' $verifiedFiles $sum
  }
  if($sum -ne $expectedBytes){throw 'Archive byte total mismatch'}
} finally {$check.Dispose()}
Write-PackageVerified $verifiedFiles $sum`;
      let progressBuffer = '';
      let archiveVerified = false;
      let progressPersistence = Promise.resolve();
      let progressPersistenceError = null;
      let lastProgressPersistAt = 0;
      const waitForProgressPersistence = async () => {
        let timeout;
        try {
          await Promise.race([
            progressPersistence,
            new Promise((_, reject) => {
              timeout = setTimeout(() => reject(new Error('Archive progress could not be persisted within the allowed time.')), options.archiveProgressPersistTimeoutMs ?? 10_000);
            })
          ]);
        } finally {
          clearTimeout(timeout);
        }
      };
      const queueProgressPersist = (force = false) => {
        const now = Date.now();
        if (!force && now - lastProgressPersistAt < 1000) return;
        lastProgressPersistAt = now;
        progressPersistence = progressPersistence.then(persistProgress);
        progressPersistence = progressPersistence.catch((error) => {
          progressPersistenceError ||= error;
        });
      };
      let archiveError = null;
      try {
        await runProcess(command, ['-NoProfile', '-NonInteractive', '-Command', script], {
          RESTORE_PACKAGE_SOURCE: sourceDirectory,
          RESTORE_PACKAGE_OUTPUT: outputFile,
          RESTORE_PACKAGE_EXPECTED_COUNT: String(expectedFileCount),
          RESTORE_PACKAGE_EXPECTED_BYTES: String(expectedBytes)
        }, options.archiveTimeoutMs || 30 * 60 * 1000, (chunk) => {
          progressBuffer += chunk.toString('utf8');
          const lines = progressBuffer.split(/\r?\n/);
          progressBuffer = lines.pop() || '';
          let receivedProgress = false;
          for (const line of lines) {
            const match = /^STOCKSITE_PROGRESS\|(create|verify)\|(\d+)\|(\d+)$/.exec(line);
            if (match) {
              receivedProgress = true;
              onProgress({
                phase: match[1],
                filesCompleted: Number(match[2]),
                bytesCompleted: Number(match[3])
              });
              queueProgressPersist();
              continue;
            }
            const verification = /^STOCKSITE_ARCHIVE_VERIFIED\|(\d+)\|(\d+)$/.exec(line);
            if (verification) {
              archiveVerified = Number(verification[1]) === expectedFileCount &&
                Number(verification[2]) === expectedBytes;
            }
          }
          return receivedProgress;
        }, options.archiveIdleTimeoutMs || 2 * 60 * 1000);
      } catch (error) {
        archiveError = error;
      } finally {
        queueProgressPersist(true);
        try {
          await waitForProgressPersistence();
        } catch (error) {
          progressPersistenceError ||= error;
        }
      }
      if (archiveError) {
        if (progressPersistenceError) {
          archiveError.message += ` ${safeMessage(progressPersistenceError)}`;
        }
        throw archiveError;
      }
      if (progressPersistenceError) throw progressPersistenceError;
      if (!archiveVerified) {
        throw new Error('Windows ZIP process exited without confirming completed archive integrity verification.');
      }
    } else if (platform === 'darwin') {
      await runProcess(options.dittoPath || '/usr/bin/ditto', ['-c', '-k', '--norsrc', sourceDirectory, outputFile], {});
      await runProcess(options.unzipPath || '/usr/bin/unzip', ['-t', outputFile], {}, 30 * 60 * 1000);
      let listingTail = '';
      let listedFiles = 0;
      let listedBytes = 0;
      await runProcess(options.unzipPath || '/usr/bin/unzip', ['-l', outputFile], { LC_ALL: 'C' }, 60 * 1000, (chunk) => {
        const lines = `${listingTail}${chunk.toString('utf8')}`.split(/\r?\n/);
        listingTail = lines.pop() || '';
        for (const line of lines) {
          const match = /^\s*(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/.exec(line);
          if (!match || match[2].endsWith('/')) continue;
          listedFiles += 1;
          listedBytes += Number(match[1]);
        }
      });
      const finalLine = /^\s*(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(.+)$/.exec(listingTail);
      if (finalLine && !finalLine[2].endsWith('/')) {
        listedFiles += 1;
        listedBytes += Number(finalLine[1]);
      }
      if (listedFiles !== expectedFileCount || listedBytes !== expectedBytes) {
        throw new Error(`Generated ZIP inventory mismatch for ${path.basename(outputFile)}: expected ${expectedFileCount} files and ${expectedBytes} uncompressed bytes, found ${listedFiles} files and ${listedBytes} bytes.`);
      }
    } else {
      throw new Error(`Restore package ZIP generation is not configured for server platform "${platform}". Configure a trusted ZIP archiver for this platform.`);
    }
    const stat = await fsp.lstat(outputFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 22) {
      throw new Error(`Generated archive is missing, unsafe, or empty: ${path.basename(outputFile)}`);
    }
    return { path: outputFile, sizeBytes: stat.size };
  }

  async function copyVerifiedExportFile(jobId, relativePath, outputPath) {
    const source = await backupService.openClientExportFile(jobId, relativePath);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    const output = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
    const sourceHash = crypto.createHash('sha256');
    const hasher = new Transform({
      transform(chunk, encoding, callback) {
        sourceHash.update(chunk);
        callback(null, chunk);
      }
    });
    await pipeline(source.stream, hasher, output);
    const stat = await fsp.lstat(outputPath);
    const copiedHash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(outputPath)) copiedHash.update(chunk);
    if (
      !stat.isFile() || stat.isSymbolicLink() || stat.size !== source.sizeBytes ||
      copiedHash.digest('hex') !== sourceHash.digest('hex')
    ) {
      throw new Error(`Artifact transfer did not preserve the verified source size: ${relativePath}`);
    }
    return { path: outputPath, sizeBytes: stat.size };
  }

  async function verifyExportFilesUnchanged(jobId, entries, checksums, onProgress = () => {}) {
    if (typeof backupService.verifyClientExportFiles === 'function') {
      const expectedEntries = entries.map(({ path: relativePath, sizeBytes }) => ({
        path: relativePath,
        sizeBytes,
        sha256: checksums.get(relativePath)?.sha256
      }));
      return backupService.verifyClientExportFiles(
        jobId,
        expectedEntries,
        onProgress,
        {
          expectedInventory: entries,
          idleTimeoutMs: options.sourceVerificationIdleTimeoutMs ?? 2 * 60 * 1000,
          timeoutMs: options.sourceVerificationTimeoutMs ?? 30 * 60 * 1000
        }
      );
    }
    for (const entry of entries) {
      const expected = checksums.get(entry.path);
      if (!expected || expected.sizeBytes !== entry.sizeBytes) {
        throw new Error(`Verified source inventory changed while packaging: ${entry.path}`);
      }
      const source = await backupService.openClientExportFile(jobId, entry.path);
      const hash = crypto.createHash('sha256');
      let sizeBytes = 0;
      for await (const chunk of source.stream) {
        hash.update(chunk);
        sizeBytes += chunk.length;
      }
      if (sizeBytes !== expected.sizeBytes || hash.digest('hex') !== expected.sha256) {
        throw new Error(`Verified source file changed while packaging: ${entry.path}`);
      }
    }
  }

  async function buildHelperZip(outputPath) {
    const zip = new AdmZip();
    for (const relative of HELPER_PACKAGE_FILES) {
      const source = path.join(restoreWizardRoot, ...relative.split('/'));
      const stat = await fsp.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`Required Restore helper setup file is missing or unsafe: ${relative}`);
      }
      zip.addLocalFile(source, path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative));
    }
    zip.writeZip(outputPath);
    const stat = await fsp.lstat(outputPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 22) throw new Error('Restore helper ZIP is empty or unsafe.');
    const verified = new AdmZip(outputPath);
    const entries = verified.getEntries().map((entry) => entry.entryName).sort();
    if (entries.length !== HELPER_PACKAGE_FILES.length ||
        HELPER_PACKAGE_FILES.some((relative) => !entries.includes(relative))) {
      throw new Error('Restore helper ZIP does not contain exactly the required setup files.');
    }
    return { path: outputPath, sizeBytes: stat.size };
  }

  async function writeHtmlWizard(outputPath) {
    const htmlPath = path.join(restoreWizardRoot, 'restore-wizard.html');
    const input = await fsp.readFile(htmlPath);
    if (!input.length || !input.toString('utf8').includes('Stocksite Restore Wizard')) {
      throw new Error('Standalone HTML Restore Wizard is missing or invalid.');
    }
    await fsp.writeFile(outputPath, input, { flag: 'wx', mode: 0o600 });
    return { path: outputPath, sizeBytes: input.length };
  }

  async function hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    let sizeBytes = 0;
    for await (const chunk of fs.createReadStream(filePath)) {
      hash.update(chunk);
      sizeBytes += chunk.length;
    }
    return { sha256: hash.digest('hex'), sizeBytes };
  }

  async function readSourceFile(jobId, relativePath, limitBytes = 1024 * 1024) {
    const file = await backupService.openClientExportFile(jobId, relativePath);
    const chunks = [];
    let total = 0;
    for await (const chunk of file.stream) {
      total += chunk.length;
      if (total > limitBytes) throw new Error(`Verified source metadata exceeds its ${limitBytes} byte safety limit.`);
      chunks.push(chunk);
    }
    if (total !== file.sizeBytes) throw new Error(`Verified source metadata changed while reading: ${relativePath}`);
    return Buffer.concat(chunks);
  }

  async function readSourceChecksums(jobId) {
    const file = await backupService.openClientExportFile(jobId, 'checksums.sha256');
    const lines = readline.createInterface({ input: file.stream, crlfDelay: Infinity });
    const inventory = new Map();
    for await (const line of lines) {
      if (!line) continue;
      const match = /^([a-f0-9]{64}) (\d+) (.+)$/i.exec(line);
      if (!match || !safeSourcePath(match[3]) || inventory.has(match[3])) {
        throw new Error('Verified backup source checksum inventory is malformed or contains an unsafe path.');
      }
      const sizeBytes = Number(match[2]);
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error('Verified backup source checksum inventory contains an invalid file size.');
      inventory.set(match[3], { sha256: match[1].toLowerCase(), sizeBytes });
    }
    return inventory;
  }

  async function generateArtifacts(job, signer) {
    const destination = jobOutputPath(job.id);
    const entries = await backupService.getClientExportFiles(job.backupJobId);
    const filePaths = new Set(entries.map(({ path: relativePath }) => relativePath));
    const requiredPaths = ['Database/stocksite.backup', 'manifest.json', 'checksums.sha256'];
    for (const requiredPath of requiredPaths) {
      if (!filePaths.has(requiredPath)) throw new Error(`Verified backup set is missing required file ${requiredPath}.`);
    }
    for (const category of ['Website-Code', 'Assets', 'Thumbnails']) {
      if (!entries.some(({ path: relativePath }) => relativePath.startsWith(`${category}/`))) {
        throw new Error(`Verified backup set is missing required ${category} payload files.`);
      }
    }
    for (const { path: relativePath } of entries) {
      if (relativePath !== 'manifest.json' && relativePath !== 'checksums.sha256' && !safeSourcePath(relativePath)) {
        throw new Error('Verified backup source contains an unsafe package-relative path.');
      }
    }
    const sourceManifest = JSON.parse((await readSourceFile(job.backupJobId, 'manifest.json')).toString('utf8'));
    if (
      sourceManifest.format !== 'GFXUNLIMIT-BACKUP-SET' ||
      sourceManifest.status !== 'SUCCESS' ||
      sourceManifest.verificationStatus !== 'VERIFIED' ||
      sourceManifest.environmentFilesEncrypted !== true
    ) throw new Error('Source backup manifest is incomplete, unverified, or does not confirm encrypted environment files.');
    const sourceChecksums = await readSourceChecksums(job.backupJobId);
    const sourcePayloadEntries = entries.filter(({ path: relativePath }) => !['manifest.json', 'checksums.sha256'].includes(relativePath));
    if (
      sourcePayloadEntries.length !== sourceChecksums.size ||
      sourcePayloadEntries.some(({ path: relativePath, sizeBytes }) => sourceChecksums.get(relativePath)?.sizeBytes !== sizeBytes) ||
      [...sourceChecksums.keys()].some((relativePath) => !filePaths.has(relativePath))
    ) throw new Error('Verified source inventory does not match the payload file list and byte totals.');
    if (typeof fsp.statfs !== 'function') {
      throw new Error('The SERVER filesystem does not expose capacity information needed to safely create restore archives.');
    }
    const archiveSourceBytes = entries
      .filter(({ path: relativePath }) => ['Website-Code/', 'Assets/', 'Thumbnails/'].some((prefix) => relativePath.startsWith(prefix)))
      .reduce((sum, entry) => sum + Number(entry.sizeBytes || 0), 0);
    const databaseBytes = entries.find(({ path: relativePath }) => relativePath === 'Database/stocksite.backup').sizeBytes;
    const requiredArchiveBytes = archiveSourceBytes + databaseBytes + Math.max(16 * 1024 * 1024, Math.ceil(archiveSourceBytes * 0.05));
    const capacity = await getFilesystemCapacity(outputRoot);
    const availableBytes = Number(capacity.bavail ?? capacity.bfree) * Number(capacity.bsize);
    if (!Number.isFinite(availableBytes) || availableBytes < requiredArchiveBytes) {
      throw new Error(`Insufficient SERVER staging space for package generation: approximately ${Math.ceil(requiredArchiveBytes)} bytes are required for archives and verification, but ${Math.max(0, Math.floor(availableBytes || 0))} bytes are available.`);
    }

    await fsp.mkdir(destination, { recursive: false, mode: 0o700 });
    job.outputCreated = true;
    await persist(job);
    const database = await copyVerifiedExportFile(job.backupJobId, 'Database/stocksite.backup', path.join(destination, 'stocksite.backup'));
    const databaseHandle = await fsp.open(database.path, 'r');
    try {
      const signature = Buffer.alloc(5);
      const { bytesRead } = await databaseHandle.read(signature, 0, signature.length, 0);
      if (bytesRead !== 5 || signature.toString('ascii') !== 'PGDMP') {
        throw new Error('Copied database artifact is not a PostgreSQL custom-format archive.');
      }
    } finally {
      await databaseHandle.close();
    }
    const artifactMap = new Map([['database', database]]);
    for (const definition of [
      { id: 'websiteCode', source: 'Website-Code', filename: 'website-code.zip' },
      { id: 'originalAssets', source: 'Assets', filename: 'original-assets.zip' },
      { id: 'thumbnails', source: 'Thumbnails', filename: 'thumbnails.zip' }
    ]) {
      setTask(job, definition.id, 'RUNNING', `Creating ${definition.filename}; archive size is not yet known`);
      await persist(job);
      const archiveEntries = sourcePayloadEntries.filter(({ path: item }) => item.startsWith(`${definition.source}/`));
      const archiveBytes = archiveEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
      const archive = await createDataArchive(
        path.join(outputRoot, `Backup-Set-${job.backupJobId}`, 'Drive-1', definition.source),
        path.join(destination, definition.filename),
        archiveEntries.length,
        archiveBytes,
        ({ phase, filesCompleted, bytesCompleted }) => {
          const task = job.tasks.find(({ id }) => id === definition.id);
          task.filesCompleted = filesCompleted;
          task.filesTotal = archiveEntries.length;
          task.bytesCompleted = bytesCompleted;
          task.bytesTotal = archiveBytes;
          const phaseLabel = phase === 'verify' ? 'Verifying archive' : 'Compressing files';
          task.percent = Math.min(99, Math.floor((phase === 'verify' ? 50 : 0) + (archiveBytes ? bytesCompleted / archiveBytes * 50 : 50)));
          task.operation = `${phaseLabel}: ${filesCompleted}/${archiveEntries.length} files, ${bytesCompleted}/${archiveBytes} bytes`;
          job.currentOperation = `${definition.filename}: ${task.operation}`;
          updateOverallProgress(job);
        },
        () => persist(job)
      );
      const task = job.tasks.find(({ id }) => id === definition.id);
      setTask(job, definition.id, 'RUNNING', `Archive structure verified; checking ${archiveEntries.length} source checksums`, 99);
      await persist(job);
      let lastVerificationPersistAt = 0;
      let verificationPersistence = Promise.resolve();
      let verificationPersistenceError = null;
      await verifyExportFilesUnchanged(
        job.backupJobId,
        sourcePayloadEntries.filter(({ path: item }) => item.startsWith(`${definition.source}/`)),
        sourceChecksums,
        ({ filesCompleted, filesTotal, bytesCompleted, bytesTotal, path: relativePath }) => {
          task.filesCompleted = filesCompleted;
          task.filesTotal = filesTotal;
          task.bytesCompleted = bytesCompleted;
          task.bytesTotal = bytesTotal;
          task.percent = 99;
          task.operation = `Rechecking source checksums: ${filesCompleted}/${filesTotal} files, ${bytesCompleted}/${bytesTotal} bytes`;
          task.currentPath = relativePath;
          job.currentOperation = `${definition.filename}: ${task.operation}`;
          updateOverallProgress(job);
          if (Date.now() - lastVerificationPersistAt >= 1000) {
            lastVerificationPersistAt = Date.now();
            verificationPersistence = verificationPersistence.then(() => persist(job));
            verificationPersistence = verificationPersistence.catch((error) => {
              verificationPersistenceError ||= error;
            });
          }
        }
      );
      let verificationPersistTimer;
      try {
        await Promise.race([
          verificationPersistence,
          new Promise((_, reject) => {
            verificationPersistTimer = setTimeout(
              () => reject(new Error('Source checksum progress could not be persisted within the allowed time.')),
              options.sourceVerificationPersistTimeoutMs ?? 10_000
            );
          })
        ]);
      } finally {
        clearTimeout(verificationPersistTimer);
      }
      if (verificationPersistenceError) throw verificationPersistenceError;
      artifactMap.set(definition.id, archive);
      task.status = 'COMPLETED';
      task.percent = 100;
      task.currentPath = null;
      task.operation = 'Archive and source checksums verified';
      updateOverallProgress(job);
    }
    setTask(job, 'wizard', 'RUNNING', 'Writing standalone HTML wizard');
    await persist(job);
    artifactMap.set('wizardHtml', await writeHtmlWizard(path.join(destination, 'stocksite-restore-wizard.html')));
    setTask(job, 'wizard', 'COMPLETED', 'HTML wizard generated and checked', 100);
    setTask(job, 'helper', 'RUNNING', 'Building helper ZIP and documentation');
    await persist(job);
    artifactMap.set('helperZip', await buildHelperZip(path.join(destination, 'stocksite-restore-helper.zip')));
    setTask(job, 'helper', 'COMPLETED', 'Helper, dynamic manifest, and documentation included', 100);
    const softwareManifestPath = path.join(restoreWizardRoot, 'restore-manifest.json');
    const softwareManifestBytes = await fsp.readFile(softwareManifestPath);
    const softwareManifest = JSON.parse(softwareManifestBytes.toString('utf8'));
    if (
      softwareManifest.schema !== 'stocksite.restore-manifest' ||
      softwareManifest.schemaVersion !== 1 ||
      !Array.isArray(softwareManifest.software)
    ) throw new Error('Bundled dynamic software manifest is invalid.');
    const softwareManifestOutput = path.join(destination, 'restore-manifest.json');
    await fsp.writeFile(softwareManifestOutput, softwareManifestBytes, { flag: 'wx', mode: 0o600 });
    artifactMap.set('softwareManifest', { path: softwareManifestOutput, sizeBytes: softwareManifestBytes.length });
    const documentationPath = path.join(restoreWizardRoot, 'README.md');
    const documentationBytes = await fsp.readFile(documentationPath);
    if (!documentationBytes.length) throw new Error('Restore package documentation is missing or empty.');
    const documentationOutput = path.join(destination, 'RESTORE_PACKAGE_README.md');
    await fsp.writeFile(documentationOutput, documentationBytes, { flag: 'wx', mode: 0o600 });
    artifactMap.set('packageDocumentation', { path: documentationOutput, sizeBytes: documentationBytes.length });
    setTask(job, 'verify', 'RUNNING', 'Checking required artifacts and archive structure');
    await persist(job);
    const manifestArtifacts = [];
    const checksumLines = [];
    const packagePayloadDefinitions = ARTIFACTS.filter(({ id }) => !['packageManifest', 'packageChecksums'].includes(id));
    for (const definition of packagePayloadDefinitions) {
      const artifact = artifactMap.get(definition.id);
      if (!artifact) throw new Error(`Required restore package artifact was not generated: ${definition.id}`);
      const hash = await hashFile(artifact.path);
      if (hash.sizeBytes !== artifact.sizeBytes) throw new Error(`Generated artifact changed during hashing: ${definition.filename}`);
      manifestArtifacts.push({
        id: definition.id,
        source: definition.id === 'database'
          ? 'Configured PostgreSQL database; generated custom-format dump'
          : definition.id === 'websiteCode'
            ? 'Approved Stocksite project source; environment files encrypted after explicit administrator authorization'
            : definition.id === 'originalAssets'
              ? 'Configured original-assets root'
              : definition.id === 'thumbnails'
                ? 'Configured thumbnail root'
                : definition.id === 'wizardHtml'
                  ? 'Bundled standalone HTML Restore Wizard'
                  : definition.id === 'helperZip'
                    ? 'Bundled local helper source, manifest, and documentation'
                    : definition.id === 'softwareManifest'
                      ? 'Bundled versioned dynamic software manifest'
                      : 'Bundled restore package documentation',
        destination: definition.filename,
        sizeBytes: hash.sizeBytes,
        sha256: hash.sha256,
        inclusionStatus: 'INCLUDED',
        verificationResult: 'VERIFIED',
        fileCount: definition.id === 'websiteCode' ? sourcePayloadEntries.filter(({ path: item }) => item.startsWith('Website-Code/')).length
          : definition.id === 'originalAssets' ? sourcePayloadEntries.filter(({ path: item }) => item.startsWith('Assets/')).length
            : definition.id === 'thumbnails' ? sourcePayloadEntries.filter(({ path: item }) => item.startsWith('Thumbnails/')).length
              : 1,
        totalSourceBytes: definition.id === 'websiteCode' || definition.id === 'originalAssets' || definition.id === 'thumbnails'
          ? sourcePayloadEntries.filter(({ path: item }) => item.startsWith(`${definition.id === 'websiteCode' ? 'Website-Code' : definition.id === 'originalAssets' ? 'Assets' : 'Thumbnails'}/`))
            .reduce((sum, entry) => sum + entry.sizeBytes, 0)
          : hash.sizeBytes
      });
      checksumLines.push(`${hash.sha256} ${hash.sizeBytes} ${definition.filename}`);
    }
    const sourceInventory = sourcePayloadEntries.map(({ path: relativePath, sizeBytes }) => {
      const category = relativePath.split('/')[0];
      const artifactId = category === 'Database' ? 'database'
        : category === 'Website-Code' ? 'websiteCode'
          : category === 'Assets' ? 'originalAssets'
            : category === 'Thumbnails' ? 'thumbnails' : null;
      if (!artifactId) throw new Error(`Unexpected source payload category: ${category}`);
      const checksum = sourceChecksums.get(relativePath);
      if (!checksum || checksum.sizeBytes !== sizeBytes) throw new Error(`Source inventory verification failed for ${relativePath}.`);
      return {
        source: category === 'Database' ? 'Configured PostgreSQL database' : `${category} source root`,
        sourceRelativePath: relativePath.slice(category.length + 1),
        artifactId,
        destinationWithinArtifact: relativePath.slice(category.length + 1),
        sizeBytes,
        sha256: checksum.sha256,
        inclusionStatus: 'INCLUDED',
        secretBearing: category === 'Website-Code' && isSecretEnvironmentPath(relativePath),
        encrypted: category === 'Website-Code' && isSecretEnvironmentPath(relativePath),
        verificationResult: 'VERIFIED_BY_SOURCE_BACKUP'
      };
    });
    const generatedAt = new Date().toISOString();
    const packageManifest = {
      format: 'STOCKSITE-RESTORE-PACKAGE',
      formatVersion: 1,
      schema: 'stocksite.restore-package-manifest',
      schemaVersion: 1,
      packageVersion: '1.0.0',
      packageJobId: job.id,
      generatedAt,
      generation: {
        sourceApplicationVersion: sourceManifest.applicationVersion || null,
        sourceGitRevision: sourceManifest.applicationCommit || null,
        sourceBackupJobId: sourceManifest.backupSetId,
        sourceBackupGeneratedAt: sourceManifest.completedAt,
        database: {
          engine: 'PostgreSQL',
          serverVersion: sourceManifest.database?.serverVersion || null,
          pgDumpVersion: sourceManifest.database?.pgDumpVersion || null,
          databaseName: sourceManifest.database?.name || null,
          backupTimestamp: sourceManifest.completedAt,
          sourceArchivePath: sourceManifest.database?.relativePath || 'Database/stocksite.backup',
          archiveInspection: 'Passed compatible pg_restore --list validation in the source backup pipeline.'
        }
      },
      secretHandling: {
        secretBearingConfigurationIncluded: true,
        administratorAuthorization: 'Explicit consent required by the authenticated START endpoint.',
        environmentFilesEncrypted: true,
        encryption: 'AES-256-GCM; decryption key is not packaged.',
        warning: 'Encrypted environment files may contain production credentials. Do not decrypt or reuse production credentials on a new computer without authorization.'
      },
      artifacts: manifestArtifacts,
      sourceInventory,
      excludedSourceItems: (sourceManifest.websiteCodeExclusions || []).map(({ path: relativePath, reason }) => {
        if (!safeSourcePath(relativePath)) throw new Error('Source backup exclusion inventory contains an unsafe path.');
        return { source: 'Approved Stocksite project root', relativePath, inclusionStatus: 'EXCLUDED', reason: String(reason || 'Excluded by source collection policy.') };
      }),
      exclusions: CODE_EXCLUSION_POLICY.map((item) => ({ ...item, inclusionStatus: 'EXCLUDED' })),
      sourceInventoryVerification: {
        expectedPayloadFiles: sourcePayloadEntries.length,
        inventoriedPayloadFiles: sourceInventory.length,
        expectedPayloadBytes: sourcePayloadEntries.reduce((sum, item) => sum + item.sizeBytes, 0),
        inventoriedPayloadBytes: sourceInventory.reduce((sum, item) => sum + item.sizeBytes, 0),
        result: sourceInventory.length === sourcePayloadEntries.length ? 'VERIFIED' : 'FAILED'
      },
      checksumFile: 'checksums.sha256',
      manifestIntegrity: {
        algorithm: 'SHA-256',
        scope: 'Canonical JSON with this field value set to null; checksum-file entry excludes checksums.sha256 itself.',
        canonicalSha256: null
      },
      packageSignature: {
        algorithm: 'Ed25519',
        keyId: signer.keyId,
        signature: 'A'.repeat(88)
      }
    };
    const packageManifestPath = path.join(destination, 'restore-package-manifest.json');
    const selfArtifact = {
      id: 'packageManifest',
      source: 'Generated package metadata',
      destination: 'restore-package-manifest.json',
      sizeBytes: 0,
      sha256: null,
      checksumScope: 'Canonical JSON with artifacts[packageManifest].sha256 and manifestIntegrity.canonicalSha256 set to null.',
      inclusionStatus: 'INCLUDED',
      verificationResult: 'PENDING_CANONICAL_HASH',
      fileCount: 1,
      totalSourceBytes: null
    };
    packageManifest.artifacts.push(selfArtifact, {
      id: 'packageChecksums',
      source: 'Generated detached SHA-256 inventory',
      destination: 'checksums.sha256',
      sizeBytes: 0,
      sha256: null,
      checksumScope: 'Self-checksum is omitted to avoid a circular checksum dependency.',
      inclusionStatus: 'INCLUDED',
      verificationResult: 'PENDING',
      fileCount: packagePayloadDefinitions.length + 1,
      totalSourceBytes: null
    });
    const canonicalManifestBytes = () => {
      const clone = JSON.parse(JSON.stringify(packageManifest));
      clone.manifestIntegrity.canonicalSha256 = null;
      clone.artifacts.find(({ id }) => id === 'packageManifest').sha256 = null;
      clone.artifacts.find(({ id }) => id === 'packageChecksums').sha256 = null;
      clone.packageSignature.signature = null;
      return Buffer.from(JSON.stringify(clone, null, 2));
    };
    const checksumPath = path.join(destination, 'checksums.sha256');
    const checksumsArtifact = packageManifest.artifacts.find(({ id }) => id === 'packageChecksums');
    let packageManifestBytes;
    let checksumBytes;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const previousManifestSize = selfArtifact.sizeBytes;
      const previousChecksumsSize = checksumsArtifact.sizeBytes;
      const canonicalBytes = canonicalManifestBytes();
      const canonicalHash = crypto.createHash('sha256').update(canonicalBytes).digest('hex');
      packageManifest.manifestIntegrity.canonicalSha256 = canonicalHash;
      selfArtifact.sha256 = canonicalHash;
      selfArtifact.verificationResult = 'VERIFIED_CANONICAL_HASH';
      const serialized = Buffer.from(JSON.stringify(packageManifest, null, 2));
      selfArtifact.sizeBytes = serialized.length;
      checksumBytes = Buffer.from(`${checksumLines.join('\n')}\n${canonicalHash} ${serialized.length} restore-package-manifest.json\n`);
      checksumsArtifact.sizeBytes = checksumBytes.length;
      checksumsArtifact.verificationResult = 'VERIFIED_ENTRIES';
      packageManifestBytes = serialized;
      if (serialized.length === previousManifestSize && checksumBytes.length === previousChecksumsSize) break;
    }
    packageManifestBytes = Buffer.from(JSON.stringify(packageManifest, null, 2));
    const finalCanonicalHash = crypto.createHash('sha256').update(canonicalManifestBytes()).digest('hex');
    if (
      packageManifestBytes.length !== selfArtifact.sizeBytes ||
      checksumBytes.length !== checksumsArtifact.sizeBytes ||
      finalCanonicalHash !== selfArtifact.sha256
    ) throw new Error('Package manifest canonical integrity check failed.');
    packageManifest.packageSignature.signature = crypto.sign(
      null,
      Buffer.from(`${PACKAGE_SIGNATURE_DOMAIN}${finalCanonicalHash}`, 'utf8'),
      signer.privateKey
    ).toString('base64');
    packageManifestBytes = Buffer.from(JSON.stringify(packageManifest, null, 2));
    checksumBytes = Buffer.from(`${checksumLines.join('\n')}\n${selfArtifact.sha256} ${packageManifestBytes.length} restore-package-manifest.json\n`);
    if (checksumBytes.length !== checksumsArtifact.sizeBytes) throw new Error('Package checksum inventory size changed during finalization.');
    await fsp.writeFile(checksumPath, checksumBytes, { flag: 'wx', mode: 0o600 });
    await fsp.writeFile(packageManifestPath, packageManifestBytes, { flag: 'wx', mode: 0o600 });
    artifactMap.set('packageManifest', { path: packageManifestPath, sizeBytes: packageManifestBytes.length });
    artifactMap.set('packageChecksums', { path: checksumPath, sizeBytes: checksumBytes.length });
    for (const artifact of artifactMap.values()) {
      const stat = await fsp.lstat(artifact.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== artifact.sizeBytes || stat.size <= 0) {
        throw new Error(`Generated artifact failed final file validation: ${path.basename(artifact.path)}`);
      }
      if (platform !== 'win32') await fsp.chmod(artifact.path, 0o600);
    }
    const checksumEntries = new Map(
      (await fsp.readFile(checksumPath, 'utf8')).trim().split(/\r?\n/).map((line) => {
        const match = /^([a-f0-9]{64}) (\d+) (.+)$/.exec(line);
        if (!match) throw new Error('Restore package checksum inventory is malformed.');
        return [match[3], { sha256: match[1], sizeBytes: Number(match[2]) }];
      })
    );
    const manifest = JSON.parse(await fsp.readFile(packageManifestPath, 'utf8'));
    if (manifest.format !== 'STOCKSITE-RESTORE-PACKAGE' || manifest.formatVersion !== 1 || manifest.schemaVersion !== 1 || manifest.artifacts.length !== ARTIFACTS.length) {
      throw new Error('Restore package manifest is incomplete or invalid.');
    }
    for (const definition of ARTIFACTS.filter(({ id }) => !['packageChecksums', 'packageManifest'].includes(id))) {
      const artifact = artifactMap.get(definition.id);
      const item = manifest.artifacts.find(({ id }) => id === definition.id);
      const inventory = checksumEntries.get(definition.filename);
      const hash = await hashFile(artifact.path);
      if (!item || !inventory || inventory.sha256 !== hash.sha256 || inventory.sizeBytes !== hash.sizeBytes ||
        item.sha256 !== hash.sha256 || item.sizeBytes !== hash.sizeBytes || item.inclusionStatus !== 'INCLUDED' ||
        item.verificationResult !== 'VERIFIED') throw new Error(`Restore package checksum or inclusion verification failed: ${definition.filename}`);
    }
    const verifiedManifest = manifest.artifacts.find(({ id }) => id === 'packageManifest');
    const canonicalManifest = JSON.parse(JSON.stringify(manifest));
    canonicalManifest.manifestIntegrity.canonicalSha256 = null;
    canonicalManifest.packageSignature.signature = null;
    canonicalManifest.artifacts.find(({ id }) => id === 'packageManifest').sha256 = null;
    canonicalManifest.artifacts.find(({ id }) => id === 'packageChecksums').sha256 = null;
    const calculatedCanonicalHash = crypto.createHash('sha256').update(JSON.stringify(canonicalManifest, null, 2)).digest('hex');
    if (
      checksumEntries.get(verifiedManifest.destination)?.sha256 !== verifiedManifest.sha256 ||
      calculatedCanonicalHash !== verifiedManifest.sha256 ||
      verifiedManifest.sizeBytes !== packageManifestBytes.length
    ) {
      throw new Error('Restore package manifest checksum inventory verification failed.');
    }
    const checksumArtifact = manifest.artifacts.find(({ id }) => id === 'packageChecksums');
    if (!checksumArtifact || checksumArtifact.sizeBytes !== checksumBytes.length || checksumArtifact.verificationResult !== 'VERIFIED_ENTRIES') {
      throw new Error('Restore package checksum artifact metadata is incomplete.');
    }
    if (manifest.sourceInventoryVerification.result !== 'VERIFIED' ||
      manifest.sourceInventoryVerification.expectedPayloadFiles !== manifest.sourceInventoryVerification.inventoriedPayloadFiles ||
      manifest.sourceInventoryVerification.expectedPayloadBytes !== manifest.sourceInventoryVerification.inventoriedPayloadBytes) {
      throw new Error('Restore package source inventory is incomplete.');
    }
    setTask(job, 'verify', 'COMPLETED', 'All required artifacts passed file and archive validation', 100);
    job.artifacts = ARTIFACTS.map(({ id, filename, label }) => {
      const artifact = artifactMap.get(id);
      if (!artifact) throw new Error(`Required restore package artifact was not generated: ${id}`);
      return { id, filename, label, sizeBytes: artifact.sizeBytes, ready: true, downloadUrl: `/admin/backup/restore-package/jobs/${encodeURIComponent(job.id)}/artifacts/${encodeURIComponent(id)}` };
    });
    setTask(job, 'ready', 'COMPLETED', 'All verified artifacts are available to authorized administrators', 100);
    job.status = 'READY';
    job.completedAt = new Date().toISOString();
    job.currentOperation = 'Restore package is ready for authorized download.';
    job.progress = { completed: job.tasks.length, total: job.tasks.length, percent: 100 };
  }

  async function run(job, signer) {
    try {
      const categoryTasks = PACKAGE_CATEGORIES.map(({ id }) => id);
      while (true) {
        const backupJob = await backupService.getJob(job.backupJobId);
        if (!backupJob) throw new Error('The underlying verified backup job is unavailable.');
        updateCollectionTasks(job, backupJob);
        const inProgress = job.tasks.find(({ id, status }) => categoryTasks.includes(id) && status === 'RUNNING');
        if (!inProgress && backupJob.status === 'RUNNING') {
          const next = job.tasks.find(({ id, status }) => categoryTasks.includes(id) && status === 'WAITING');
          if (next) {
            next.status = 'RUNNING';
            next.operation = `Collecting ${next.name}`;
            job.currentOperation = next.operation;
          }
        }
        await persist(job);
        if (backupJob.status === 'FAILED') {
          throw new Error(backupJob.errors?.map(({ message }) => message).filter(Boolean).join('; ') || 'Configured server source validation or collection failed.');
        }
        if (backupJob.status === 'SUCCESS') {
          if (backupJob.verificationStatus !== 'VERIFIED') throw new Error('Backup source collection did not complete verification.');
          break;
        }
        if (backupJob.status !== 'RUNNING') throw new Error(`Backup source collection stopped in ${backupJob.status || 'an unknown state'}.`);
        await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs || 1000));
      }
      await generateArtifacts(job, signer);
      await persist(job);
    } catch (error) {
      const failedJob = {
        ...job,
        status: 'FAILED',
        error: safeMessage(error),
        completedAt: new Date().toISOString(),
        currentOperation: 'Restore package generation failed.',
        tasks: job.tasks.map((task) => ({ ...task }))
      };
      const running = failedJob.tasks.find(({ status }) => status === 'RUNNING');
      if (running) {
        running.status = 'FAILED';
        running.error = failedJob.error;
        running.operation = 'Failed';
      }
      if (error.processTerminated === false) {
        failedJob.error += ' Partial package output was retained because PowerShell termination could not be confirmed.';
      } else if (job.outputCreated) {
        const outputPath = jobOutputPath(job.id);
        try {
          const stat = await fsp.lstat(outputPath);
          if (stat.isDirectory() && !stat.isSymbolicLink()) await fsp.rm(outputPath, { recursive: true, force: false });
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') {
            failedJob.error += ` Temporary package cleanup failed: ${safeMessage(cleanupError)}`;
          }
        }
      }
      Object.assign(job, failedJob);
      let persistenceTimer;
      try {
        await Promise.race([
          persist(failedJob),
          new Promise((_, reject) => {
            persistenceTimer = setTimeout(
              () => reject(new Error('Failed restore package status could not be persisted within the allowed time.')),
              options.failedJobPersistTimeoutMs ?? 10_000
            );
          })
        ]);
      } catch (persistError) {
        failedJob.error += ` ${safeMessage(persistError)}`;
        job.error = failedJob.error;
        console.error('Could not persist failed restore package status:', safeMessage(persistError));
      } finally {
        clearTimeout(persistenceTimer);
      }
    } finally {
      if (activeJobId === job.id) activeJobId = null;
    }
  }

  async function start({ includeEncryptedEnvironmentFiles } = {}) {
    if (includeEncryptedEnvironmentFiles !== true) {
      throw new Error('Explicit administrator authorization is required to include encrypted .env configuration in the access-controlled restore package.');
    }
    if (activeJobId) {
      const activeJob = jobs.get(activeJobId);
      if (!activeJob || ACTIVE.has(activeJob.status)) {
        throw new Error('A restore package is already being prepared. Wait for it to finish.');
      }
      activeJobId = null;
    }
    const signer = await packageSigner();
    await pruneExpiredPackages();
    const backupJob = await createBackupJobAfterFinalization({
      categories: ['database', 'websiteCode', 'assetsAndThumbnails'],
      destinationMode: 'mac-local'
    });
    const job = {
      id: backupJob.id,
      backupJobId: backupJob.id,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentOperation: 'Configured server sources validated; beginning collection.',
      progress: { completed: 0, total: 9, percent: 0 },
      tasks: initializeTasks(),
      artifacts: [],
      includeEncryptedEnvironmentFiles: true,
      error: null
    };
    activeJobId = job.id;
    jobs.set(job.id, job);
    await persist(job);
    setImmediate(() => run(job, signer));
    return publicJob(job);
  }

  async function getJob(id) {
    await pruneExpiredPackages();
    const inMemory = jobs.get(id);
    if (inMemory) return publicJob(inMemory);
    if (!/^[A-Za-z0-9-]{1,120}$/.test(String(id))) return null;
    try {
      const saved = JSON.parse(await fsp.readFile(jobStatePath(id), 'utf8'));
      if (ACTIVE.has(saved.status)) {
        saved.status = 'FAILED';
        saved.error = 'The SERVER restarted before package generation finished. Start a new package job.';
        saved.completedAt = new Date().toISOString();
        saved.currentOperation = 'Package job was marked failed after a SERVER restart.';
        const activeTask = saved.tasks?.find(({ status }) => status === 'RUNNING');
        if (activeTask) {
          activeTask.status = 'FAILED';
          activeTask.operation = saved.error;
          activeTask.error = saved.error;
        }
        if (saved.outputCreated === true) {
          const outputPath = jobOutputPath(id);
          try {
            const stat = await fsp.lstat(outputPath);
            if (stat.isDirectory() && !stat.isSymbolicLink()) {
              const [root, candidate] = await Promise.all([fsp.realpath(outputRoot), fsp.realpath(outputPath)]);
              if (path.relative(root, candidate) === path.basename(outputPath)) {
                await fsp.rm(candidate, { recursive: true, force: false });
              }
            }
          } catch (cleanupError) {
            if (cleanupError.code !== 'ENOENT') saved.error += ` Partial package cleanup failed: ${safeMessage(cleanupError)}`;
          }
        }
        await persist(saved);
      }
      return publicJob(saved);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error(`Restore package status could not be read: ${safeMessage(error)}`);
    }
  }

  async function openArtifact(id, artifactId) {
    const job = await getJob(id);
    if (!job || job.status !== 'READY') throw new Error('Only artifacts from a verified, ready restore package are downloadable.');
    const definition = ARTIFACTS.find((item) => item.id === artifactId);
    const artifact = job.artifacts.find((item) => item.id === artifactId && item.ready);
    if (!definition || !artifact) throw new Error('Restore package artifact is not available.');
    const filePath = path.join(jobOutputPath(id), definition.filename);
    const root = await fsp.realpath(jobOutputPath(id));
    const canonical = await fsp.realpath(filePath);
    const relative = path.relative(root, canonical);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative !== definition.filename) {
      throw new Error('Restore package artifact is outside its private output directory.');
    }
    const handle = await fsp.open(canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== artifact.sizeBytes) {
      await handle.close();
      throw new Error('Restore package artifact changed after verification.');
    }
    return { filename: definition.filename, sizeBytes: stat.size, stream: handle.createReadStream() };
  }

  return { start, getJob, openArtifact };
}

module.exports = { createRestorePackageService };
