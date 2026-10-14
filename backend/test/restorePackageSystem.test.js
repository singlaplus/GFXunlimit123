'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = fs.promises;
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const AdmZip = require('adm-zip');
const { test } = require('node:test');
const {
  createRestorePackageService,
  getDefaultRestoreTemporaryRoot
} = require('../services/restorePackageSystem');
const { createRestoreHelper, promoteStagedDirectory } = require('../../restore-wizard/helper/server');
const PACKAGE_SIGNING_KEY_PAIR = crypto.generateKeyPairSync('ed25519');
const PACKAGE_SIGNING_PRIVATE_KEY = PACKAGE_SIGNING_KEY_PAIR.privateKey.export({ type: 'pkcs8', format: 'pem' });
const PACKAGE_SIGNING_PUBLIC_KEY = PACKAGE_SIGNING_KEY_PAIR.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const UNRELATED_SIGNING_KEY_PAIR = crypto.generateKeyPairSync('ed25519');

test('Restore Package uses D:\\GFXTemp on Windows and a native temporary base on macOS', () => {
  assert.equal(getDefaultRestoreTemporaryRoot('win32'), 'D:\\GFXTemp');
  assert.equal(getDefaultRestoreTemporaryRoot('darwin'), path.join(os.tmpdir(), 'gfxunlimit-restore-temp'));
});

async function write(root, relativePath, content) {
  const file = path.join(root, ...relativePath.split('/'));
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
  return file;
}

async function waitFor(service, id) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const job = await service.getJob(id);
    if (job.status !== 'RUNNING') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Restore package preparation did not settle.');
}

test('restore package preparation consumes a verified backup set and exposes only validated artifacts', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'stocksite-restore-package-test-'));
  const outputRoot = path.join(temporary, 'private', 'GFXunlimit');
  const stateDirectory = path.join(temporary, 'state');
  const signingKeyPath = path.join(temporary, 'synthetic-signing-key.pem');
  await fsp.writeFile(signingKeyPath, PACKAGE_SIGNING_PRIVATE_KEY, { mode: 0o600 });
  const backupId = 'GFX-restore-package-test';
  const setDirectory = path.join(outputRoot, `Backup-Set-${backupId}`, 'Drive-1');
  const payloads = {
    'Database/stocksite.backup': Buffer.from('PGDMP-test-archive'),
    'Website-Code/package-lock.json': Buffer.from('{}'),
    'Website-Code/frontend/package.json': Buffer.from('{}'),
    'Website-Code/frontend/package-lock.json': Buffer.from('{}'),
    'Website-Code/frontend/.keep': Buffer.from(''),
    'Website-Code/backend/server.js': Buffer.from('module.exports = true;'),
    'Website-Code/backend/.env': Buffer.from('GFXENV1\\nencrypted'),
    'Website-Code/backend/.env.example': Buffer.from('JWT_SECRET=replace-me\n'),
    'Assets/user/original.jpg': Buffer.from('original'),
    'Thumbnails/user/2026/thumb.jpg': Buffer.from('thumbnail'),
    'manifest.json': Buffer.from(JSON.stringify({
      format: 'GFXUNLIMIT-BACKUP-SET',
      backupSetId: backupId,
      status: 'SUCCESS',
      verificationStatus: 'VERIFIED',
      environmentFilesEncrypted: true,
      completedAt: '2026-10-11T00:00:00.000Z',
      applicationVersion: '1.2.3',
      applicationCommit: 'abc123',
      database: { name: 'stocksite', serverVersion: 'PostgreSQL 18.6', pgDumpVersion: 'pg_dump 18.6', relativePath: 'Database/stocksite.backup' },
      websiteCodeExclusions: [{ path: 'backend/node_modules', reason: 'Dependencies are recreated from package-lock.json.' }]
    }))
  };
  payloads['checksums.sha256'] = Buffer.from(Object.entries(payloads)
    .filter(([relative]) => relative !== 'manifest.json')
    .map(([relative, content]) => `${crypto.createHash('sha256').update(content).digest('hex')} ${content.length} ${relative}`)
    .join('\n') + '\n');
  const sourceFiles = new Map();
  for (const [relative, content] of Object.entries(payloads)) {
    sourceFiles.set(relative, await write(setDirectory, relative, content));
  }

  let sourceVerificationCalls = 0;
  const backupService = {
    async createJob() {
      return { id: backupId, status: 'RUNNING' };
    },
    async getJob() {
      return {
        id: backupId,
        status: 'SUCCESS',
        verificationStatus: 'VERIFIED',
        progress: { categories: {}, category: 'Complete' }
      };
    },
    async getClientExportFiles() {
      return Object.entries(payloads).map(([relative, content]) => ({ path: relative, sizeBytes: content.length }));
    },
    async openClientExportFile(_id, relative) {
      const sourcePath = sourceFiles.get(relative);
      if (!sourcePath) throw new Error('Missing verified source file.');
      const stat = await fsp.stat(sourcePath);
      return { stream: fs.createReadStream(sourcePath), sizeBytes: stat.size };
    },
    async verifyClientExportFiles(_id, expectedEntries, onProgress, verificationOptions) {
      sourceVerificationCalls += 1;
      assert.deepEqual(
        new Set(verificationOptions.expectedInventory.map(({ path }) => path)),
        new Set(Object.keys(payloads)),
        'the later source check uses the original full inventory including the manifest and checksum file'
      );
      let bytesCompleted = 0;
      const bytesTotal = expectedEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
      for (let index = 0; index < expectedEntries.length; index += 1) {
        const expected = expectedEntries[index];
        const sourcePath = sourceFiles.get(expected.path);
        if (!sourcePath) throw new Error(`Missing verified source file: ${expected.path}`);
        const content = await fsp.readFile(sourcePath);
        if (
          content.length !== expected.sizeBytes ||
          crypto.createHash('sha256').update(content).digest('hex') !== expected.sha256
        ) throw new Error(`Verified source file changed while packaging: ${expected.path}`);
        bytesCompleted += content.length;
        onProgress({
          filesCompleted: index + 1,
          filesTotal: expectedEntries.length,
          bytesCompleted,
          bytesTotal,
          path: expected.path
        });
      }
    }
  };
  const spawnMock = (executable, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    if (executable === '/usr/bin/ditto') {
      const zip = new AdmZip();
      zip.addLocalFolder(args[3]);
      zip.writeZip(args[4]);
    } else if (executable === '/usr/bin/unzip' && args[0] === '-l') {
      const entries = new AdmZip(args[1]).getEntries();
      const lines = entries.map((entry) => `${String(entry.header.size).padStart(10)}  2026-10-11 00:00   ${entry.entryName}`);
      process.nextTick(() => child.stdout.emit('data', Buffer.from(`${lines.join('\n')}\n`)));
    }
    process.nextTick(() => child.emit('close', 0, null));
    return child;
  };
  const service = createRestorePackageService({
    backupService,
    outputRoot,
    stateDirectory,
    restoreWizardRoot: path.resolve(__dirname, '../../restore-wizard'),
    platform: 'darwin',
    packageSigningPrivateKeyFile: signingKeyPath,
    spawn: spawnMock,
    pollIntervalMs: 1
  });

  try {
    const started = await service.start({ includeEncryptedEnvironmentFiles: true });
    assert.equal(started.status, 'RUNNING');
    const completed = await waitFor(service, backupId);
    assert.equal(completed.status, 'READY');
    assert.equal(completed.progress.percent, 100);
    assert.deepEqual(completed.artifacts.map((item) => item.id), [
      'database', 'websiteCode', 'originalAssets', 'thumbnails', 'wizardHtml', 'helperZip',
      'softwareManifest', 'packageDocumentation', 'packageManifest', 'packageChecksums'
    ]);
    assert.equal(completed.artifacts.length, 10);
    assert.ok(completed.tasks.every((task) => task.status === 'COMPLETED'));
    assert.equal(sourceVerificationCalls, 3, 'source integrity is rechecked once per data archive');
    const packageManifest = JSON.parse(await fsp.readFile(path.join(outputRoot, `Restore-Package-${backupId}`, 'restore-package-manifest.json'), 'utf8'));
    assert.equal(Object.hasOwn(packageManifest, 'packageSigningPublicKey'), false);
    assert.equal(packageManifest.schema, 'stocksite.restore-package-manifest');
    assert.equal(packageManifest.schemaVersion, 1);
    assert.equal(packageManifest.generation.database.serverVersion, 'PostgreSQL 18.6');
    assert.equal(packageManifest.secretHandling.secretBearingConfigurationIncluded, true);
    assert.equal(packageManifest.sourceInventoryVerification.result, 'VERIFIED');
    const signedCanonical = JSON.parse(JSON.stringify(packageManifest));
    signedCanonical.manifestIntegrity.canonicalSha256 = null;
    signedCanonical.artifacts.find(({ id }) => id === 'packageManifest').sha256 = null;
    signedCanonical.artifacts.find(({ id }) => id === 'packageChecksums').sha256 = null;
    signedCanonical.packageSignature.signature = null;
    const packageCanonicalHash = crypto.createHash('sha256').update(JSON.stringify(signedCanonical, null, 2)).digest('hex');
    assert.equal(packageCanonicalHash, packageManifest.manifestIntegrity.canonicalSha256);
    assert.equal(crypto.verify(
      null,
      Buffer.from(`STOCKSITE-RESTORE-PACKAGE-V1\n${packageCanonicalHash}`, 'utf8'),
      PACKAGE_SIGNING_KEY_PAIR.publicKey,
      Buffer.from(packageManifest.packageSignature.signature, 'base64')
    ), true);
    assert.ok(packageManifest.sourceInventory.some((item) => item.secretBearing && item.encrypted));
    assert.ok(packageManifest.sourceInventory.some((item) =>
      item.destinationWithinArtifact === 'backend/.env.example' && !item.secretBearing && !item.encrypted));
    assert.ok(packageManifest.excludedSourceItems.some(({ relativePath }) => relativePath === 'backend/node_modules'));
    assert.ok(packageManifest.exclusions.some(({ pattern }) => pattern === '**/node_modules/**'));
    assert.ok(packageManifest.artifacts.every((item) => item.inclusionStatus === 'INCLUDED' && item.destination && item.sizeBytes > 0));
    const database = await service.openArtifact(backupId, 'database');
    assert.equal(database.filename, 'stocksite.backup');
    let databaseBytes = 0;
    for await (const chunk of database.stream) databaseBytes += chunk.length;
    assert.equal(databaseBytes, payloads['Database/stocksite.backup'].length);
    const helperZip = await service.openArtifact(backupId, 'helperZip');
    const helperPath = path.join(outputRoot, `Restore-Package-${backupId}`, helperZip.filename);
    const entries = new AdmZip(helperPath).getEntries().map((entry) => entry.entryName);
    assert.deepEqual(entries.sort(), [
      'README.md',
      'helper/.env.example',
      'helper/package-lock.json',
      'helper/package.json',
      'helper/server.js',
      'helper/start-macos.sh',
      'helper/start-windows.cmd',
      'restore-manifest.json',
      'restore-wizard.html'
    ]);
    assert.ok(!entries.some((entry) =>
      ['stocksite.backup', 'website-code.zip', 'original-assets.zip', 'thumbnails.zip', 'server.test.js']
        .includes(path.posix.basename(entry))
    ), 'the helper ZIP contains setup files only, not payloads or test fixtures');
    for (const archiveName of ['website-code.zip', 'original-assets.zip', 'thumbnails.zip']) {
      const archivePath = path.join(outputRoot, `Restore-Package-${backupId}`, archiveName);
      const archiveEntries = new AdmZip(archivePath).getEntries().map((entry) => entry.entryName);
      assert.ok(archiveEntries.length > 0, `${archiveName} contains payload entries`);
      if (archiveName === 'website-code.zip') {
        assert.ok(archiveEntries.some((entry) => entry.endsWith('backend/.env')), 'hidden encrypted environment files are preserved');
        assert.ok(archiveEntries.some((entry) => entry.endsWith('package-lock.json')), 'lockfiles are preserved');
        assert.ok(archiveEntries.every((entry) => !entry.includes('node_modules/')), 'regenerable dependencies are excluded');
      }
    }
    const checksumsPath = path.join(outputRoot, `Restore-Package-${backupId}`, 'checksums.sha256');
    const checksums = await fsp.readFile(checksumsPath, 'utf8');
    assert.match(checksums, /stocksite\.backup/);
    assert.match(checksums, /original-assets\.zip/);
    const recoveredService = createRestorePackageService({
      backupService,
      outputRoot,
      stateDirectory,
      restoreWizardRoot: path.resolve(__dirname, '../../restore-wizard'),
      platform: 'darwin',
      packageSigningPrivateKeyFile: signingKeyPath,
      spawn: spawnMock,
      pollIntervalMs: 1
    });
    assert.equal((await recoveredService.getJob(backupId)).status, 'READY');
    await fsp.rm(signingKeyPath);
    assert.equal(fs.existsSync(signingKeyPath), false);
    assert.ok(!JSON.stringify(completed).includes('backup-private-value'));
    assert.ok(!JSON.stringify(packageManifest).includes('backup-private-value'));
    assert.ok(!JSON.stringify(completed).includes(PACKAGE_SIGNING_PRIVATE_KEY));
    assert.ok(!JSON.stringify(packageManifest).includes(PACKAGE_SIGNING_PRIVATE_KEY));
    for (const artifact of completed.artifacts) {
      const content = await service.openArtifact(backupId, artifact.id);
      const chunks = [];
      for await (const chunk of content.stream) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).includes(Buffer.from(PACKAGE_SIGNING_PRIVATE_KEY)), false, `${artifact.id} must not contain signing private-key material`);
    }
    await assert.rejects(service.openArtifact(backupId, 'not-an-artifact'), /not available/);
    const restoreParent = path.join(temporary, 'restore-destinations');
    await fsp.mkdir(restoreParent);
    const helper = createRestoreHelper({
      manifestPath: path.resolve(__dirname, '../../restore-wizard/restore-manifest.json'),
      environment: {
        RESTORE_HELPER_TOKEN: 'test-only-token-long-enough-for-helper-validation',
        RESTORE_APP_DB_HOST: '127.0.0.1',
        RESTORE_APP_DB_USER: 'test-restore-user',
        RESTORE_APP_DB_NAME: 'stocksite_restore_test',
        RESTORE_APP_JWT_SECRET: 'test-only-jwt-secret-longer-than-32-characters',
        RESTORE_PACKAGE_SIGNING_PUBLIC_KEY: PACKAGE_SIGNING_PUBLIC_KEY
      },
      spawn: (executable, args) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        process.nextTick(() => {
          if (executable === 'psql') child.stdout.emit('data', Buffer.from('180006|127.0.0.1|5432|0|test-restore-user|test-restore-user\n'));
          child.emit('close', 0, null);
        });
        return child;
      }
    });
    const packageDirectory = path.join(outputRoot, `Restore-Package-${backupId}`);
    const validationInput = {
      sources: {
        databaseFile: path.join(packageDirectory, 'stocksite.backup'),
        websiteArchive: path.join(packageDirectory, 'website-code.zip'),
        assetsArchive: path.join(packageDirectory, 'original-assets.zip'),
        thumbnailsArchive: path.join(packageDirectory, 'thumbnails.zip')
      },
      destinations: {
        databaseName: 'stocksite_restore_test',
        websiteDestination: path.join(restoreParent, 'website'),
        assetsDestination: path.join(restoreParent, 'assets'),
        thumbnailsDestination: path.join(restoreParent, 'thumbnails')
      }
    };
    const packageManifestPath = path.join(packageDirectory, 'restore-package-manifest.json');
    const signedManifestBytes = await fsp.readFile(packageManifestPath);
    const tamperedManifest = JSON.parse(signedManifestBytes.toString('utf8'));
    tamperedManifest.packageSignature.signature = `${tamperedManifest.packageSignature.signature[0] === 'A' ? 'B' : 'A'}${tamperedManifest.packageSignature.signature.slice(1)}`;
    const tamperedManifestBytes = Buffer.from(JSON.stringify(tamperedManifest, null, 2));
    await fsp.writeFile(packageManifestPath, tamperedManifestBytes);
    const tamperedChecksums = checksums.replace(
      /^[a-f0-9]{64} \d+ restore-package-manifest\.json$/m,
      `${crypto.createHash('sha256').update(tamperedManifestBytes).digest('hex')} ${tamperedManifestBytes.length} restore-package-manifest.json`
    );
    await fsp.writeFile(checksumsPath, tamperedChecksums);
    await assert.rejects(helper.validateConfiguration(validationInput), /signature does not match/);
    await fsp.writeFile(packageManifestPath, signedManifestBytes);
    await fsp.writeFile(checksumsPath, checksums);

    const makeVerifier = (publicKey, executedCommands = []) => createRestoreHelper({
      environment: {
        RESTORE_HELPER_TOKEN: 'test-only-token-long-enough-for-helper-validation',
        RESTORE_APP_DB_HOST: '127.0.0.1',
        RESTORE_APP_DB_USER: 'test-restore-user',
        RESTORE_APP_DB_NAME: 'stocksite_restore_test',
        RESTORE_APP_JWT_SECRET: 'test-only-jwt-secret-longer-than-32-characters',
        ...(publicKey === undefined ? {} : { RESTORE_PACKAGE_SIGNING_PUBLIC_KEY: publicKey })
      },
      spawn: (executable, args) => {
        executedCommands.push({ executable, args });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        process.nextTick(() => {
          if (executable === 'psql') child.stdout.emit('data', Buffer.from('180006|127.0.0.1|5432|0|test-restore-user|test-restore-user\n'));
          child.emit('close', 0, null);
        });
        return child;
      }
    });
    const assertStartRejectedBeforeExecution = async (publicKey, expectedError) => {
      const executedCommands = [];
      const verifier = makeVerifier(publicKey, executedCommands);
      const server = http.createServer((req, res) => void verifier.handle(req, res));
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/start`, {
          method: 'POST',
          headers: {
            Authorization: ['Bearer', 'test-only-token-long-enough-for-helper-validation'].join(' '),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            configuration: validationInput,
            restoreAuthorized: true,
            confirmation: 'RESTORE stocksite_restore_test'
          })
        });
        assert.equal(response.status, 422);
        assert.match((await response.json()).error, expectedError);
        assert.equal(verifier.jobs.size, 0, 'invalid package must not create a restore job or execute restore tasks');
        assert.ok(executedCommands.every(({ executable }) => executable === 'psql'),
          `only the local read-only database preflight may run before package verification; got ${executedCommands.map(({ executable }) => executable).join(', ')}`);
        assert.equal(executedCommands.some(({ executable }) => executable === process.execPath || executable === 'pg_restore'), false);
      } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await verifier.shutdown();
      }
    };
    const unrelatedPublicKey = UNRELATED_SIGNING_KEY_PAIR.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    await assert.rejects(makeVerifier(unrelatedPublicKey).validateConfiguration(validationInput), /signature does not match/);
    await assert.rejects(makeVerifier(undefined).validateConfiguration(validationInput), /no independently trusted Ed25519 public key/);
    await assert.rejects(makeVerifier('not-a-valid-public-key').validateConfiguration(validationInput), /Trusted package public key/);
    await assertStartRejectedBeforeExecution(unrelatedPublicKey, /signature does not match/);
    await assertStartRejectedBeforeExecution(undefined, /no independently trusted Ed25519 public key/);
    await assertStartRejectedBeforeExecution('not-a-valid-public-key', /Trusted package public key/);

    const packageSuppliedKeyManifest = JSON.parse(signedManifestBytes.toString('utf8'));
    const packageSuppliedKeyBytes = UNRELATED_SIGNING_KEY_PAIR.publicKey.export({ type: 'spki', format: 'der' });
    packageSuppliedKeyManifest.packageSigningPublicKey = unrelatedPublicKey;
    packageSuppliedKeyManifest.packageSignature.publicKey = unrelatedPublicKey;
    packageSuppliedKeyManifest.packageSignature.keyId = crypto.createHash('sha256')
      .update(packageSuppliedKeyBytes)
      .digest('hex')
      .slice(0, 24);
    const suppliedKeyManifestRecord = packageSuppliedKeyManifest.artifacts.find(({ id }) => id === 'packageManifest');
    const suppliedKeyChecksumsRecord = packageSuppliedKeyManifest.artifacts.find(({ id }) => id === 'packageChecksums');
    let suppliedKeyManifestBytes;
    let suppliedKeyChecksums;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const previousManifestSize = suppliedKeyManifestRecord.sizeBytes;
      const previousChecksumsSize = suppliedKeyChecksumsRecord.sizeBytes;
      const canonical = JSON.parse(JSON.stringify(packageSuppliedKeyManifest));
      canonical.manifestIntegrity.canonicalSha256 = null;
      canonical.artifacts.find(({ id }) => id === 'packageManifest').sha256 = null;
      canonical.artifacts.find(({ id }) => id === 'packageChecksums').sha256 = null;
      canonical.packageSignature.signature = null;
      const canonicalHash = crypto.createHash('sha256').update(JSON.stringify(canonical, null, 2)).digest('hex');
      packageSuppliedKeyManifest.manifestIntegrity.canonicalSha256 = canonicalHash;
      suppliedKeyManifestRecord.sha256 = canonicalHash;
      packageSuppliedKeyManifest.packageSignature.signature = crypto.sign(
        null,
        Buffer.from(`STOCKSITE-RESTORE-PACKAGE-V1\n${canonicalHash}`, 'utf8'),
        UNRELATED_SIGNING_KEY_PAIR.privateKey
      ).toString('base64');
      suppliedKeyManifestBytes = Buffer.from(JSON.stringify(packageSuppliedKeyManifest, null, 2));
      suppliedKeyManifestRecord.sizeBytes = suppliedKeyManifestBytes.length;
      suppliedKeyChecksums = checksums.replace(
        /^[a-f0-9]{64} \d+ restore-package-manifest\.json$/m,
        `${canonicalHash} ${suppliedKeyManifestBytes.length} restore-package-manifest.json`
      );
      suppliedKeyChecksumsRecord.sizeBytes = Buffer.byteLength(suppliedKeyChecksums);
      if (previousManifestSize === suppliedKeyManifestRecord.sizeBytes &&
          previousChecksumsSize === suppliedKeyChecksumsRecord.sizeBytes) break;
    }
    await fsp.writeFile(packageManifestPath, suppliedKeyManifestBytes);
    await fsp.writeFile(checksumsPath, suppliedKeyChecksums);
    await assert.rejects(helper.validateConfiguration(validationInput), /signature does not match/);
    await assertStartRejectedBeforeExecution(PACKAGE_SIGNING_PUBLIC_KEY, /signature does not match/);
    await fsp.writeFile(packageManifestPath, signedManifestBytes);
    await fsp.writeFile(checksumsPath, checksums);

    const unsignedManifest = JSON.parse(signedManifestBytes.toString('utf8'));
    unsignedManifest.packageSignature.signature = null;
    await fsp.writeFile(packageManifestPath, JSON.stringify(unsignedManifest, null, 2));
    await assert.rejects(helper.validateConfiguration(validationInput), /signature is missing/);
    await assertStartRejectedBeforeExecution(PACKAGE_SIGNING_PUBLIC_KEY, /signature is missing/);
    await fsp.writeFile(packageManifestPath, signedManifestBytes);

    const archivePath = validationInput.sources.websiteArchive;
    const originalArchive = await fsp.readFile(archivePath);
    await fsp.appendFile(archivePath, Buffer.from('tampered'));
    await assert.rejects(helper.validateConfiguration(validationInput), /Required package artifact .* unexpected size|Package artifact checksum failed/);
    await assertStartRejectedBeforeExecution(PACKAGE_SIGNING_PUBLIC_KEY, /Required package artifact .* unexpected size|Package artifact checksum failed/);
    await fsp.writeFile(archivePath, originalArchive);
    const standaloneWizard = await fsp.readFile(path.join(packageDirectory, 'stocksite-restore-wizard.html'), 'utf8');
    assert.match(standaloneWizard, /websiteArchive/);
    assert.match(standaloneWizard, /assetsArchive/);
    assert.match(standaloneWizard, /thumbnailsArchive/);
    assert.match(standaloneWizard, /Local setup · PostgreSQL and trust/);
    assert.match(standaloneWizard, /\/api\/configure/);
    assert.match(standaloneWizard, /not written to helper\/\.env/);
    assert.doesNotMatch(standaloneWizard, /source folder/);
    const validated = await helper.validateConfiguration(validationInput);
    assert.equal(validated.destinations.databaseName, 'stocksite_restore_test');
    assert.deepEqual(validated.sources, {
      databaseFile: await fsp.realpath(validationInput.sources.databaseFile),
      websiteArchive: await fsp.realpath(validationInput.sources.websiteArchive),
      assetsArchive: await fsp.realpath(validationInput.sources.assetsArchive),
      thumbnailsArchive: await fsp.realpath(validationInput.sources.thumbnailsArchive)
    }, 'the helper accepts separately supplied payload files selected from the package folder');
    const missingArchivePath = path.join(packageDirectory, 'thumbnails.zip.missing-test');
    await fsp.rename(validationInput.sources.thumbnailsArchive, missingArchivePath);
    try {
      await assert.rejects(helper.validateConfiguration(validationInput), /Thumbnail ZIP was not found at the entered path/);
    } finally {
      await fsp.rename(missingArchivePath, validationInput.sources.thumbnailsArchive);
    }
    const wrongPortHelper = createRestoreHelper({
      environment: {
        RESTORE_HELPER_TOKEN: 'test-only-token-long-enough-for-helper-validation',
        RESTORE_APP_DB_HOST: '127.0.0.1',
        RESTORE_APP_DB_PORT: '55418',
        RESTORE_APP_DB_USER: 'test-restore-user',
        RESTORE_APP_DB_NAME: 'stocksite_restore_test',
        RESTORE_APP_JWT_SECRET: 'test-only-jwt-secret-longer-than-32-characters',
        RESTORE_PACKAGE_SIGNING_PUBLIC_KEY: PACKAGE_SIGNING_PUBLIC_KEY
      },
      spawn: (executable) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        process.nextTick(() => {
          if (executable === 'psql') child.stdout.emit('data', Buffer.from('180006|127.0.0.1|5432|0|test-restore-user|test-restore-user\n'));
          child.emit('close', 0, null);
        });
        return child;
      }
    });
    await assert.rejects(wrongPortHelper.validateConfiguration(validationInput), /configured loopback host and port/);
    const extractionRoot = path.join(restoreParent, 'extraction-stage');
    const extractionDestinations = {
      websiteCode: path.join(extractionRoot, 'website'),
      originalAssets: path.join(extractionRoot, 'assets'),
      thumbnails: path.join(extractionRoot, 'thumbnails')
    };
    for (const key of Object.keys(extractionDestinations)) {
      await fsp.mkdir(extractionDestinations[key], { recursive: true });
      extractionDestinations[key] = await fsp.realpath(extractionDestinations[key]);
    }
    const extractionTasks = ['extract-website-code', 'extract-original-assets', 'extract-thumbnails']
      .map((id) => ({ id, name: id, required: true, status: 'WAITING' }));
    const extractionJob = {
      configuration: validated,
      cancelRequested: false,
      softwareTasks: [],
      approvalHistory: [],
      tasks: extractionTasks,
      tasksById: Object.fromEntries(extractionTasks.map((task) => [task.id, task])),
      logs: []
    };
    const extractionPromise = helper.extractPackageSources(extractionJob, extractionDestinations);
    for (const task of extractionTasks) {
      const approvalDeadline = Date.now() + 5000;
      while (extractionJob.awaitingApproval?.actionId !== task.id && Date.now() < approvalDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(extractionJob.awaitingApproval?.actionId, task.id);
      extractionJob.resolveApproval(true);
    }
    await extractionPromise;
    assert.equal(await fsp.readFile(path.join(extractionDestinations.websiteCode, 'backend/server.js'), 'utf8'), 'module.exports = true;');
    assert.equal(await fsp.readFile(path.join(extractionDestinations.websiteCode, 'backend/.env.example'), 'utf8'), 'JWT_SECRET=replace-me\n');
    await assert.rejects(fsp.access(path.join(extractionDestinations.websiteCode, 'backend/.env')));
    assert.equal(await fsp.readFile(path.join(extractionDestinations.originalAssets, 'user/original.jpg'), 'utf8'), 'original');
    assert.equal(await fsp.readFile(path.join(extractionDestinations.thumbnails, 'user/2026/thumb.jpg'), 'utf8'), 'thumbnail');
    assert.ok(extractionTasks.every((task) => task.status === 'COMPLETED'));
    assert.ok(!JSON.stringify(extractionJob.logs).includes('GFXENV1\\nencrypted'));
    const websiteLink = path.join(restoreParent, 'website-source-link.zip');
    await fsp.symlink(
      validationInput.sources.websiteArchive,
      websiteLink,
      'file'
    );
    await assert.rejects(helper.validateConfiguration({
      ...validationInput,
      sources: { ...validationInput.sources, websiteArchive: websiteLink }
    }), /cannot be a symbolic link/);
    await fsp.unlink(websiteLink);

    const npmCliPath = await write(temporary, 'test-npm-cli.js', 'module.exports = true;\n');
    const restoreHelperToken = 'test-only-token-long-enough-for-helper-validation';
    const appPortProbe = net.createServer();
    await new Promise((resolve) => appPortProbe.listen(0, '127.0.0.1', resolve));
    const applicationPort = appPortProbe.address().port;
    await new Promise((resolve, reject) => appPortProbe.close((error) => error ? reject(error) : resolve()));
    let applicationHealthServer;
    let failureMode = 'database';
    let promotionCount = 0;
    const restoreHelper = createRestoreHelper({
      manifestPath: path.resolve(__dirname, '../../restore-wizard/restore-manifest.json'),
      environment: {
        RESTORE_HELPER_TOKEN: restoreHelperToken,
        RESTORE_APP_DB_HOST: '127.0.0.1',
        RESTORE_APP_DB_USER: 'test-restore-user',
        RESTORE_APP_DB_NAME: 'stocksite_restore_test',
        RESTORE_APP_PORT: String(applicationPort),
        RESTORE_APP_JWT_SECRET: 'test-only-jwt-secret-longer-than-32-characters',
        RESTORE_PACKAGE_SIGNING_PUBLIC_KEY: PACKAGE_SIGNING_PUBLIC_KEY,
        RESTORE_NPM_CLI: npmCliPath
      },
      platform: 'darwin',
      promoteDirectory: async (...args) => {
        promotionCount += 1;
        if (failureMode === 'promotion' && promotionCount === 2) {
          throw new Error('controlled synthetic promotion failure');
        }
        return promoteStagedDirectory(...args);
      },
      removeStagingDirectory: async (stagingPath) => {
        const name = path.basename(stagingPath);
        if (failureMode === 'cleanup' && name.startsWith('.stocksite-restore-') &&
            !name.endsWith('-assets') && !name.endsWith('-thumbnails')) {
          throw new Error('controlled synthetic staging cleanup failure');
        }
        await fsp.rm(stagingPath, { recursive: true, force: false });
      },
      spawn: (executable, args) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.exitCode = null;
        child.kill = () => {
          child.exitCode = 0;
          return true;
        };
        let output = '';
        let exitCode = 0;
        if (executable === '/usr/bin/unzip' && args[0] === '-Z1') {
          output = new AdmZip(args[1]).getEntries().map(({ entryName }) => entryName).join('\n');
        } else if (args[0] === npmCliPath && args[1] === '--version') {
          output = '10.8.2';
        } else if (executable === 'node' && args[0] === '--version') {
          output = 'v22.0.0';
        } else if (executable === 'pg_restore' && args[0] === '--version') {
          output = 'pg_restore (PostgreSQL) 18.0';
        } else if (executable === 'psql' && args[0] === '--version') {
          output = 'psql (PostgreSQL) 18.0';
        } else if (executable === 'git') {
          output = 'git version 2.0.0';
        } else if (executable === 'psql' && args.some((argument) => argument.includes('inet_server_addr'))) {
          output = '180000|127.0.0.1|5432|0|test-restore-user|test-restore-user';
        } else if (executable === 'psql' && args.includes('SELECT 1;')) {
          output = '1';
        } else if (executable === process.execPath && args.includes('-e') && args.some((argument) => argument.includes('checkAssetLifecycleSchema'))) {
          output = JSON.stringify({ ready: true, missing: [] });
        } else if (executable === 'psql' && args.some((argument) => argument.includes("current_setting('server_version_num')"))) {
          output = '180000|0';
        } else if (executable === 'psql' && args.includes('SELECT count(*)')) {
          output = '0';
        } else if (executable === 'pg_restore' && args[0] === '--list' && failureMode === 'cleanup') {
          exitCode = 1;
          child.stderr.emit('data', Buffer.from('controlled synthetic archive inspection failure'));
        } else if (executable === 'pg_restore' && args[0] === '--exit-on-error' && failureMode === 'database') {
          exitCode = 1;
          child.stderr.emit('data', Buffer.from('controlled synthetic database restore failure'));
        } else if (executable === 'pg_restore' && args[0] === '--exit-on-error' && failureMode === 'spawn-error') {
          process.nextTick(() => child.emit('error', new Error('controlled synthetic process spawn failure')));
        } else if (executable === process.execPath && args[0] === npmCliPath && args.includes('run') && failureMode === 'build') {
          exitCode = 1;
          child.stderr.emit('data', Buffer.from('controlled synthetic frontend build failure'));
        } else if (executable === process.execPath && args.length === 1 && args[0] === 'server.js' && failureMode === 'startup') {
          process.nextTick(() => child.emit('exit', 1, null));
        } else if (executable === process.execPath && args.length === 1 && args[0] === 'server.js' && failureMode === 'success') {
          applicationHealthServer = http.createServer((request, response) => {
            if (request.url === '/health') {
              response.writeHead(200, { 'Content-Type': 'application/json' });
              response.end(JSON.stringify([{ now: new Date().toISOString() }]));
            } else if (request.url === '/') {
              response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              response.end('<html><div id="root"></div><script src="/static/js/main.js"></script><link rel="stylesheet" href="/static/css/main.css"></html>');
            } else if (request.url === '/static/js/main.js') {
              response.writeHead(200, { 'Content-Type': 'application/javascript' });
              response.end('/* synthetic frontend bundle */');
            } else if (request.url === '/static/css/main.css') {
              response.writeHead(200, { 'Content-Type': 'text/css' });
              response.end('/* synthetic frontend styles */');
            } else {
              response.writeHead(404);
              response.end();
            }
          });
          applicationHealthServer.listen(applicationPort, '127.0.0.1');
        }
        process.nextTick(() => {
          if (executable === 'pg_restore' && args[0] === '--exit-on-error') {
            if (failureMode === 'spawn-error') return;
            child.emit('spawn');
          }
          if (output) child.stdout.emit('data', Buffer.from(`${output}\n`));
          child.emit('close', exitCode, null);
        });
        return child;
      }
    });
    const restoreServer = http.createServer((req, res) => void restoreHelper.handle(req, res));
    await new Promise((resolve) => restoreServer.listen(0, '127.0.0.1', resolve));
    try {
      const restoreResponse = await fetch(`http://127.0.0.1:${restoreServer.address().port}/api/start`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-only-token-long-enough-for-helper-validation',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          configuration: validationInput,
          restoreAuthorized: true,
          confirmation: 'RESTORE stocksite_restore_test'
        })
      });
      assert.equal(restoreResponse.status, 202);
      const { job: startedRestore } = await restoreResponse.json();
      const restoreDeadline = Date.now() + 5000;
      let failedRestore;
      while (Date.now() < restoreDeadline) {
        failedRestore = restoreHelper.jobs.get(startedRestore.id);
        if (failedRestore.status !== 'RUNNING') break;
        if (failedRestore.awaitingApproval) {
          const approvalResponse = await fetch(`http://127.0.0.1:${restoreServer.address().port}/api/jobs/${startedRestore.id}/approval`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${restoreHelperToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              actionId: failedRestore.awaitingApproval.actionId,
              approved: true
            })
          });
          assert.equal(approvalResponse.status, 202);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(failedRestore.status, 'PARTIAL', failedRestore.error);
      assert.match(failedRestore.error, /Restore PostgreSQL custom archive.*failed/);
      assert.equal(failedRestore.launchUrl, undefined);
      assert.equal(failedRestore.tasksById['restore-postgresql-custom-archive'].status, 'FAILED');
      assert.equal(failedRestore.databaseRestoreStarted, true);
      assert.ok(failedRestore.recoveryInstructions.some((instruction) =>
        instruction.includes('Do not retry using this database')));
      assert.equal(fs.existsSync(validationInput.destinations.websiteDestination), false);

      const originalWebsiteArchive = await fsp.readFile(validationInput.sources.websiteArchive);
      for (const mode of ['spawn-error', 'cancel-before-database', 'cleanup', 'extraction', 'promotion', 'build', 'startup', 'cancel', 'success']) {
        failureMode = mode;
        promotionCount = 0;
        const canonicalRestoreParent = await fsp.realpath(restoreParent);
        const scenarioConfiguration = {
          ...validationInput,
          destinations: {
            ...validationInput.destinations,
            websiteDestination: path.join(canonicalRestoreParent, `${mode}-website`),
            assetsDestination: path.join(canonicalRestoreParent, `${mode}-assets`),
            thumbnailsDestination: path.join(canonicalRestoreParent, `${mode}-thumbnails`)
          }
        };
        const response = await fetch(`http://127.0.0.1:${restoreServer.address().port}/api/start`, {
          method: 'POST',
          headers: {
            Authorization: ['Bearer', restoreHelperToken].join(' '),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            configuration: scenarioConfiguration,
            restoreAuthorized: true,
            confirmation: 'RESTORE stocksite_restore_test'
          })
        });
        assert.equal(response.status, 202, `${mode}: ${await response.clone().text()}`);
        const { job: scenarioJob } = await response.json();
        const scenarioDeadline = Date.now() + 10_000;
        let scenarioResult;
        let archiveChanged = false;
        while (Date.now() < scenarioDeadline) {
          const current = restoreHelper.jobs.get(scenarioJob.id);
          if (current.status !== 'RUNNING') {
            scenarioResult = current;
            break;
          }
          if (current.awaitingApproval) {
            if (mode === 'extraction' &&
                current.awaitingApproval.actionId === 'extract-website-code' &&
                !archiveChanged) {
              await fsp.unlink(scenarioConfiguration.sources.websiteArchive);
              archiveChanged = true;
            }
            const approveAction = !(
              (mode === 'cancel-before-database' && current.awaitingApproval.actionId === 'prepare-staging') ||
              (mode === 'cancel' && current.awaitingApproval.actionId === 'extract-website-code')
            );
            const approval = await fetch(`http://127.0.0.1:${restoreServer.address().port}/api/jobs/${scenarioJob.id}/approval`, {
              method: 'POST',
              headers: {
                Authorization: ['Bearer', restoreHelperToken].join(' '),
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                actionId: current.awaitingApproval.actionId,
                approved: approveAction
              })
            });
            assert.equal(approval.status, 202);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        }
        await fsp.writeFile(validationInput.sources.websiteArchive, originalWebsiteArchive);
        assert.ok(scenarioResult, `${mode}: restore did not reach a terminal state`);
        const expectedStatus = {
          'spawn-error': 'FAILED',
          'cancel-before-database': 'CANCELLED',
          cleanup: 'PARTIAL',
          success: 'COMPLETED'
        }[mode] || 'PARTIAL';
        const partial = expectedStatus === 'PARTIAL';
        assert.equal(scenarioResult.status, expectedStatus, `${mode}: ${scenarioResult.error}`);
        assert.equal(scenarioResult.databaseRestoreStarted, !['spawn-error', 'cancel-before-database', 'cleanup'].includes(mode));
        assert.equal(Boolean(scenarioResult.recoveryInstructions?.length), partial);
        assert.equal(Boolean(scenarioResult.launchUrl), expectedStatus === 'COMPLETED');
        assert.equal(scenarioResult.child, null);
        const cleanupDeadline = Date.now() + 1000;
        while (Date.now() < cleanupDeadline &&
               scenarioResult.stagingRoots.some((stagingPath) => fs.existsSync(stagingPath))) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        if (mode === 'cleanup') {
          assert.equal(scenarioResult.retainedStagingPaths.length, 1);
          assert.equal(scenarioResult.retainedStagingPaths[0], scenarioResult.stagingRoots[0]);
          assert.equal(fs.existsSync(scenarioResult.retainedStagingPaths[0]), true);
        } else {
          assert.ok(scenarioResult.stagingRoots.every((stagingPath) => !fs.existsSync(stagingPath)),
            `${mode}: operation-owned temporary staging directories are cleaned up`);
        }
        const terminalResponse = await fetch(`http://127.0.0.1:${restoreServer.address().port}/api/jobs/${scenarioJob.id}`, {
          headers: { Authorization: ['Bearer', restoreHelperToken].join(' ') }
        });
        assert.equal(terminalResponse.status, 200);
        const publicResult = await terminalResponse.json();
        assert.equal(publicResult.job.status, expectedStatus);
        assert.deepEqual(publicResult.job.finalReport.recoveryInstructions.length > 0, partial);
        if (mode === 'spawn-error') {
          assert.match(scenarioResult.error, /controlled synthetic process spawn failure/);
          assert.equal(scenarioResult.tasksById['restore-postgresql-custom-archive'].status, 'FAILED');
          assert.equal(publicResult.job.partialState, false);
          assert.deepEqual(scenarioResult.createdDestinations, []);
          assert.equal(fs.existsSync(scenarioConfiguration.destinations.websiteDestination), false);
        } else if (mode === 'cancel-before-database') {
          assert.equal(scenarioResult.tasksById['prepare-staging'].status, 'CANCELLED');
          assert.equal(scenarioResult.tasksById['restore-postgresql-custom-archive'].status, 'WAITING');
          assert.equal(publicResult.job.partialState, false);
          assert.deepEqual(scenarioResult.createdDestinations, []);
        } else if (mode === 'cleanup') {
          assert.equal(scenarioResult.tasksById['restore-postgresql-custom-archive'].status, 'FAILED');
          assert.match(scenarioResult.error, /controlled synthetic staging cleanup failure/);
          assert.equal(scenarioResult.databaseRestoreStarted, false);
          assert.deepEqual(scenarioResult.createdDestinations, []);
          assert.ok(scenarioResult.recoveryInstructions.some((instruction) =>
            instruction.includes(scenarioResult.retainedStagingPaths[0])));
        } else if (mode === 'success') {
          assert.equal(publicResult.job.partialState, false);
          assert.equal(scenarioResult.tasksById['health-check-backend'].status, 'COMPLETED');
          assert.equal(scenarioResult.tasksById['health-check-frontend'].status, 'COMPLETED');
          assert.equal(scenarioResult.tasksById['launch-local-website'].status, 'COMPLETED');
          assert.ok(scenarioResult.createdDestinations.length === 3);
          assert.equal(scenarioResult.launchUrl, `http://127.0.0.1:${applicationPort}/`);
        } else if (mode === 'extraction') {
          assert.match(scenarioResult.error, /ENOENT|no such file|ZIP/i);
          assert.deepEqual(scenarioResult.createdDestinations, []);
          assert.equal(fs.existsSync(scenarioConfiguration.destinations.websiteDestination), false);
        } else if (mode === 'promotion') {
          assert.match(scenarioResult.error, /controlled synthetic promotion failure/);
          assert.deepEqual(scenarioResult.createdDestinations, [scenarioConfiguration.destinations.websiteDestination]);
          assert.equal(fs.existsSync(scenarioConfiguration.destinations.websiteDestination), true);
          assert.equal(fs.existsSync(scenarioConfiguration.destinations.assetsDestination), false);
          assert.equal(
            await fsp.readFile(path.join(scenarioConfiguration.destinations.websiteDestination, 'backend/server.js'), 'utf8'),
            'module.exports = true;'
          );
          assert.ok(scenarioResult.recoveryInstructions.some((instruction) =>
            instruction.includes(scenarioConfiguration.destinations.websiteDestination)));
          const retry = await fetch(`http://127.0.0.1:${restoreServer.address().port}/api/start`, {
            method: 'POST',
            headers: {
              Authorization: ['Bearer', restoreHelperToken].join(' '),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              configuration: scenarioConfiguration,
              restoreAuthorized: true,
              confirmation: 'RESTORE stocksite_restore_test'
            })
          });
          assert.equal(retry.status, 422);
          assert.match((await retry.json()).error, /destination.*already exists|already exist/i);
          assert.equal(restoreHelper.jobs.has(scenarioJob.id), true);
          assert.equal(
            await fsp.readFile(path.join(scenarioConfiguration.destinations.websiteDestination, 'backend/server.js'), 'utf8'),
            'module.exports = true;',
            'retry must not remove or replace data promoted by the failed operation'
          );
        } else if (mode === 'build') {
          assert.match(scenarioResult.error, /Build frontend failed/);
          assert.deepEqual(scenarioResult.createdDestinations, []);
          assert.equal(fs.existsSync(scenarioConfiguration.destinations.websiteDestination), false);
        } else if (mode === 'startup') {
          assert.match(scenarioResult.error, /backend stopped before health checks passed/);
          assert.equal(scenarioResult.tasksById['launch-backend'].status, 'FAILED');
          assert.deepEqual(scenarioResult.createdDestinations, [
            scenarioConfiguration.destinations.websiteDestination,
            scenarioConfiguration.destinations.assetsDestination,
            scenarioConfiguration.destinations.thumbnailsDestination
          ]);
        } else if (mode === 'cancel') {
          assert.match(scenarioResult.error, /Action not approved/);
          assert.equal(scenarioResult.status, 'PARTIAL');
          assert.equal(scenarioResult.tasksById['extract-website-code'].status, 'CANCELLED');
          assert.deepEqual(scenarioResult.createdDestinations, []);
        }
      }
    } finally {
      await new Promise((resolve, reject) => restoreServer.close((error) => error ? reject(error) : resolve()));
      if (applicationHealthServer?.listening) {
        await new Promise((resolve, reject) => applicationHealthServer.close((error) => error ? reject(error) : resolve()));
      }
    }

    await fsp.appendFile(validationInput.sources.websiteArchive, 'changed');
    await assert.rejects(helper.validateConfiguration(validationInput), /Required package artifact|Package artifact checksum failed/);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});

test('restore package generation fails when required source payloads are missing', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'stocksite-restore-package-missing-'));
  const backupId = 'GFX-restore-package-missing';
  const service = createRestorePackageService({
    backupService: {
      async createJob() { return { id: backupId }; },
      async getJob() { return { id: backupId, status: 'SUCCESS', verificationStatus: 'VERIFIED', progress: {} }; },
      async getClientExportFiles() { return [{ path: 'Database/stocksite.backup', sizeBytes: 10 }, { path: 'manifest.json', sizeBytes: 2 }, { path: 'checksums.sha256', sizeBytes: 2 }]; }
    },
    outputRoot: path.join(temporary, 'GFXunlimit'),
    stateDirectory: path.join(temporary, 'state'),
    restoreWizardRoot: path.resolve(__dirname, '../../restore-wizard'),
    packageSigningPrivateKey: PACKAGE_SIGNING_PRIVATE_KEY,
    platform: 'darwin',
    pollIntervalMs: 1
  });
  try {
    await service.start({ includeEncryptedEnvironmentFiles: true });
    const job = await waitFor(service, backupId);
    assert.equal(job.status, 'FAILED');
    assert.match(job.error, /missing required Website-Code payload files/);
    assert.deepEqual(job.artifacts, []);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});

test('restore package generation fails before archive creation when server staging space is insufficient', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'stocksite-restore-package-capacity-'));
  const backupId = 'GFX-restore-package-capacity';
  const sourceFiles = {
    'Database/stocksite.backup': Buffer.from('PGDMP'),
    'Website-Code/backend/server.js': Buffer.alloc(100),
    'Assets/user/original.jpg': Buffer.alloc(200),
    'Thumbnails/user/2026/thumb.jpg': Buffer.alloc(50)
  };
  const sourceManifest = Buffer.from(JSON.stringify({
    format: 'GFXUNLIMIT-BACKUP-SET',
    backupSetId: backupId,
    status: 'SUCCESS',
    verificationStatus: 'VERIFIED',
    environmentFilesEncrypted: true
  }));
  const checksumContents = Buffer.from(Object.entries(sourceFiles)
    .map(([relative, content]) => `${crypto.createHash('sha256').update(content).digest('hex')} ${content.length} ${relative}`)
    .join('\n') + '\n');
  const metadata = { 'manifest.json': sourceManifest, 'checksums.sha256': checksumContents };
  const entries = [
    ...Object.entries(sourceFiles).map(([relative, content]) => ({ path: relative, sizeBytes: content.length })),
    ...Object.entries(metadata).map(([relative, content]) => ({ path: relative, sizeBytes: content.length }))
  ];
  const service = createRestorePackageService({
    backupService: {
      async createJob() { return { id: backupId }; },
      async getJob() { return { id: backupId, status: 'SUCCESS', verificationStatus: 'VERIFIED', progress: {} }; },
      async getClientExportFiles() { return entries; },
      async openClientExportFile(_id, relative) {
        const content = sourceFiles[relative] || metadata[relative];
        return { stream: Readable.from(content), sizeBytes: content.length };
      }
    },
    outputRoot: path.join(temporary, 'GFXunlimit'),
    stateDirectory: path.join(temporary, 'state'),
    restoreWizardRoot: path.resolve(__dirname, '../../restore-wizard'),
    packageSigningPrivateKey: PACKAGE_SIGNING_PRIVATE_KEY,
    platform: 'darwin',
    statfs: async () => ({ bavail: 1, bsize: 1 }),
    pollIntervalMs: 1
  });
  try {
    await service.start({ includeEncryptedEnvironmentFiles: true });
    const job = await waitFor(service, backupId);
    assert.equal(job.status, 'FAILED');
    assert.match(job.error, /Insufficient SERVER staging space/);
    assert.deepEqual(job.artifacts, []);
    await assert.rejects(fsp.access(path.join(temporary, 'GFXunlimit', `Restore-Package-${backupId}`)));
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});

test('restore package requires explicit authorization before requesting a source collection', async () => {
  let createCalls = 0;
  const service = createRestorePackageService({
    backupService: { async createJob() { createCalls += 1; return { id: 'GFX-not-authorized' }; } },
    outputRoot: path.join(os.tmpdir(), 'stocksite-unused-restore-output'),
    stateDirectory: path.join(os.tmpdir(), 'stocksite-unused-restore-state')
  });
  await assert.rejects(service.start(), /Explicit administrator authorization is required/);
  assert.equal(createCalls, 0);
});

test('a confirmed failed restore package does not block starting a new package', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'stocksite-restore-package-retry-'));
  let createAttempts = 0;
  let acceptedJobs = 0;
  let activeJobReads = 0;
  const backupService = {
    async createJob() {
      createAttempts += 1;
      if (createAttempts === 2) {
        throw new Error('A backup job is already running. Wait for it to finish before starting another.');
      }
      acceptedJobs += 1;
      return { id: `GFX-restore-package-retry-${acceptedJobs}` };
    },
    async getJob(id) {
      return { id, status: 'FAILED', errors: [{ message: 'Synthetic source failure.' }] };
    },
    async getActiveJob() {
      activeJobReads += 1;
      return activeJobReads === 1 ? { id: 'GFX-restore-package-retry-1', status: 'FAILED' } : null;
    }
  };
  const service = createRestorePackageService({
    backupService,
    outputRoot: path.join(temporary, 'output'),
    stateDirectory: path.join(temporary, 'state'),
    packageSigningPrivateKey: PACKAGE_SIGNING_PRIVATE_KEY,
    pollIntervalMs: 1
  });

  try {
    const failed = await service.start({ includeEncryptedEnvironmentFiles: true });
    assert.equal((await waitFor(service, failed.id)).status, 'FAILED');

    const retry = await service.start({ includeEncryptedEnvironmentFiles: true });
    assert.equal(retry.id, 'GFX-restore-package-retry-2');
    assert.equal(retry.status, 'RUNNING');
    assert.equal(createAttempts, 3);
    assert.equal(acceptedJobs, 2);
    assert.equal(activeJobReads, 2);
    assert.equal((await waitFor(service, retry.id)).status, 'FAILED');
    assert.equal((await service.getJob(failed.id)).status, 'FAILED');
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});

test('a still-active backup job keeps the backup duplicate-job guard in force', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'stocksite-restore-package-active-backup-'));
  let createCalls = 0;
  const service = createRestorePackageService({
    backupService: {
      async createJob() {
        createCalls += 1;
        throw new Error('A backup job is already running. Wait for it to finish before starting another.');
      },
      async getActiveJob() {
        return { id: 'GFX-backup-still-running', status: 'RUNNING' };
      }
    },
    outputRoot: path.join(temporary, 'output'),
    stateDirectory: path.join(temporary, 'state'),
    packageSigningPrivateKey: PACKAGE_SIGNING_PRIVATE_KEY
  });

  try {
    await assert.rejects(
      service.start({ includeEncryptedEnvironmentFiles: true }),
      /A backup job is already running/
    );
    assert.equal(createCalls, 1);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});

test('a genuinely active restore package rejects a duplicate start', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'stocksite-restore-package-duplicate-'));
  const backupId = 'GFX-restore-package-active-guard';
  let statusReads = 0;
  const service = createRestorePackageService({
    backupService: {
      async createJob() { return { id: backupId }; },
      async getJob() {
        statusReads += 1;
        return { id: backupId, status: statusReads === 1 ? 'RUNNING' : 'FAILED', progress: {} };
      }
    },
    outputRoot: path.join(temporary, 'output'),
    stateDirectory: path.join(temporary, 'state'),
    packageSigningPrivateKey: PACKAGE_SIGNING_PRIVATE_KEY,
    pollIntervalMs: 1
  });

  try {
    const active = await service.start({ includeEncryptedEnvironmentFiles: true });
    assert.equal(active.status, 'RUNNING');
    await assert.rejects(
      service.start({ includeEncryptedEnvironmentFiles: true }),
      /A restore package is already being prepared/
    );
    assert.equal((await waitFor(service, backupId)).status, 'FAILED');
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});

test('restore package generation refuses to create a backup when signing is not configured', async () => {
  let createCalls = 0;
  const service = createRestorePackageService({
    backupService: { async createJob() { createCalls += 1; return { id: 'unsigned-package' }; } },
    outputRoot: path.join(os.tmpdir(), 'stocksite-unsigned-restore-output'),
    stateDirectory: path.join(os.tmpdir(), 'stocksite-unsigned-restore-state')
  });
  await assert.rejects(
    service.start({ includeEncryptedEnvironmentFiles: true }),
    /signing is not configured; refusing to generate an unauthenticated restore package/
  );
  assert.equal(createCalls, 0);
});

test('restore package generation rejects malformed and broadly readable signing keys before source collection', async (context) => {
  let createCalls = 0;
  const makeService = (options) => createRestorePackageService({
    backupService: { async createJob() { createCalls += 1; return { id: 'invalid-signing-key' }; } },
    outputRoot: path.join(os.tmpdir(), 'stocksite-invalid-restore-output'),
    stateDirectory: path.join(os.tmpdir(), 'stocksite-invalid-restore-state'),
    ...options
  });
  await assert.rejects(
    makeService({ packageSigningPrivateKey: 'not a private key' }).start({ includeEncryptedEnvironmentFiles: true }),
    /Restore package signing key is invalid/
  );
  assert.equal(createCalls, 0);

  if (process.platform === 'win32') {
    context.skip('POSIX mode-bit validation is not available on Windows; Windows ACL must be checked by the operator.');
    return;
  }
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'stocksite-signing-key-test-'));
  try {
    const keyPath = path.join(temporary, 'signing-key.pem');
    await fsp.writeFile(keyPath, PACKAGE_SIGNING_PRIVATE_KEY, { mode: 0o600 });
    await fsp.chmod(keyPath, 0o644);
    await assert.rejects(
      makeService({ packageSigningPrivateKeyFile: keyPath }).start({ includeEncryptedEnvironmentFiles: true }),
      /protected regular file owned by the package service account/
    );
    assert.equal(createCalls, 0);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});

test('Windows ZIP generation loads both compression assemblies and verifies archive inventory and paths', async () => {
  const source = await fsp.readFile(path.resolve(__dirname, '../services/restorePackageSystem.js'), 'utf8');
  const scriptStart = source.indexOf('const script = String.raw`');
  const scriptEnd = source.indexOf('`;', scriptStart);
  const script = source.slice(scriptStart, scriptEnd);

  assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, 'Windows PowerShell ZIP script is present');
  const zipApi = script.indexOf('[IO.Compression.ZipFile]');
  assert.ok(zipApi > 0, 'PowerShell script uses ZipFile APIs');
  assert.ok(script.indexOf('Add-Type -AssemblyName System.IO.Compression;') < zipApi);
  assert.ok(script.indexOf('Add-Type -AssemblyName System.IO.Compression.FileSystem;') < zipApi);
  assert.match(script, /Source file count changed/);
  assert.match(script, /Source byte total changed/);
  assert.match(script, /Archive file count mismatch/);
  assert.match(script, /Archive byte total mismatch/);
  assert.match(script, /Unsafe or duplicate archive path/);
  assert.match(script, /Unsafe archive entry/);
  assert.match(script, /Write-PackageProgress 'create'/);
  assert.match(script, /Write-PackageProgress 'verify'/);
  assert.match(script, /Write-PackageVerified \$verifiedFiles \$sum/);
  assert.match(script, /\$input\.Read\(\$buffer/);
  assert.match(script, /\$s\.Read\(\$buffer/);
  assert.match(source, /archiveTimeoutMs \|\| 30 \* 60 \* 1000/);
  assert.match(source, /archiveIdleTimeoutMs \|\| 2 \* 60 \* 1000/);
  assert.match(source, /archiveOutputDrainTimeoutMs \?\? 10_000/);
  assert.match(source, /requestTermination\('SIGKILL'\)/);
  assert.match(source, /archiveProgressPersistTimeoutMs \?\? 10_000/);
});

test('stalled Windows ZIP verification terminates PowerShell and persists FAILED state', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'stocksite-restore-package-zip-timeout-'));
  const backupId = 'GFX-restore-package-zip-timeout';
  const outputRoot = path.join(temporary, 'exports', 'GFXunlimit');
  const stateDirectory = path.join(temporary, 'state');
  const sourceRoot = path.join(outputRoot, `Backup-Set-${backupId}`, 'Drive-1');
  const payloads = {
    'Database/stocksite.backup': Buffer.from('PGDMP-test'),
    'Website-Code/site.js': Buffer.from('module.exports = true;'),
    'Assets/user/original.dat': Buffer.from('asset'),
    'Thumbnails/user/thumb.dat': Buffer.from('thumb')
  };
  const manifest = Buffer.from(JSON.stringify({
    format: 'GFXUNLIMIT-BACKUP-SET',
    backupSetId: backupId,
    status: 'SUCCESS',
    verificationStatus: 'VERIFIED',
    environmentFilesEncrypted: true
  }));
  const checksums = Buffer.from(Object.entries(payloads)
    .map(([relativePath, content]) =>
      `${crypto.createHash('sha256').update(content).digest('hex')} ${content.length} ${relativePath}`)
    .join('\n') + '\n');
  const sourceFiles = new Map();
  for (const [relativePath, content] of Object.entries({
    ...payloads,
    'manifest.json': manifest,
    'checksums.sha256': checksums
  })) {
    sourceFiles.set(relativePath, await write(sourceRoot, relativePath, content));
  }
  let child;
  const terminationSignals = [];
  const service = createRestorePackageService({
    backupService: {
      async createJob() { return { id: backupId }; },
      async getJob() { return { id: backupId, status: 'SUCCESS', verificationStatus: 'VERIFIED', progress: {} }; },
      async getClientExportFiles() {
        return [...sourceFiles].map(([relativePath, filePath]) => ({
          path: relativePath,
          sizeBytes: fs.statSync(filePath).size
        }));
      },
      async openClientExportFile(_id, relativePath) {
        const filePath = sourceFiles.get(relativePath);
        const stat = await fsp.stat(filePath);
        return { stream: fs.createReadStream(filePath), sizeBytes: stat.size };
      }
    },
    outputRoot,
    temporaryRoot: path.join(temporary, 'GFX Temp Root'),
    stateDirectory,
    restoreWizardRoot: path.resolve(__dirname, '../../restore-wizard'),
    packageSigningPrivateKey: PACKAGE_SIGNING_PRIVATE_KEY,
    platform: 'win32',
    archiveIdleTimeoutMs: 25,
    archiveTerminationGraceMs: 10,
    statfs: async () => ({ bavail: 1024 * 1024, bsize: 1024 }),
    spawn: () => {
      child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = (signal) => {
        terminationSignals.push(signal || 'default');
        if (terminationSignals.length === 2) process.nextTick(() => child.emit('close', null, null));
        return true;
      };
      setTimeout(() => child.stdout.emit('data', Buffer.from('STOCKSITE_PROGRESS|verify|1|20\n')), 10);
      return child;
    },
    pollIntervalMs: 1
  });

  try {
    await service.start({ includeEncryptedEnvironmentFiles: true });
    const job = await waitFor(service, backupId);
    assert.equal(job.status, 'FAILED');
    assert.match(job.error, /Windows ZIP generation made no measurable progress/);
    assert.deepEqual(terminationSignals, ['default', 'default']);
    const websiteTask = job.tasks.find(({ id }) => id === 'websiteCode');
    assert.equal(websiteTask.bytesCompleted, 20);
    assert.equal(websiteTask.filesTotal, 1);
    assert.ok(job.progress.percent > 44, `measured archive work advances overall workflow progress beyond completed stages; got ${job.progress.percent}`);
    const persistedJob = JSON.parse(await fsp.readFile(path.join(stateDirectory, `${backupId}.json`), 'utf8'));
    assert.equal(persistedJob.status, 'FAILED');
    assert.equal(persistedJob.tasks.find(({ id }) => id === 'websiteCode').filesCompleted, 1);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});

test('Windows ZIP verification cannot remain RUNNING after process exit without stream close and retry remains available', async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'stocksite-restore-package-zip-drain-'));
  const ids = [
    'GFX-restore-package-drain-1',
    'GFX-restore-package-drain-2',
    'GFX-restore-package-drain-3'
  ];
  const temporaryRoot = path.join(temporary, 'GFX Temp Root');
  const outputRoot = path.join(temporaryRoot, 'GFXunlimit');
  const stateDirectory = path.join(temporary, 'state');
  const byJob = new Map();
  const basePayloads = {
    'Database/stocksite.backup': Buffer.from('PGDMP-test'),
    'Website-Code/site.js': Buffer.from('module.exports = true;'),
    'Assets/user/original.dat': Buffer.from('asset'),
    'Thumbnails/user/thumb.dat': Buffer.from('thumb')
  };

  for (const id of ids) {
    const root = path.join(outputRoot, `Backup-Set-${id}`, 'Drive-1');
    const payloads = {
      ...basePayloads,
      'manifest.json': Buffer.from(JSON.stringify({
        format: 'GFXUNLIMIT-BACKUP-SET',
        backupSetId: id,
        status: 'SUCCESS',
        verificationStatus: 'VERIFIED',
        environmentFilesEncrypted: true
      }))
    };
    payloads['checksums.sha256'] = Buffer.from(Object.entries(payloads)
      .filter(([relativePath]) => relativePath !== 'manifest.json')
      .map(([relativePath, content]) =>
        `${crypto.createHash('sha256').update(content).digest('hex')} ${content.length} ${relativePath}`)
      .join('\n') + '\n');
    const files = new Map();
    for (const [relativePath, content] of Object.entries(payloads)) {
      files.set(relativePath, await write(root, relativePath, content));
    }
    byJob.set(id, files);
  }

  const children = [];
  const processPaths = [];
  const deletedSourceJobs = [];
  let createCalls = 0;
  const service = createRestorePackageService({
    backupService: {
      async createJob() {
        const id = ids[createCalls];
        createCalls += 1;
        return { id };
      },
      async getJob(id) {
        return { id, status: 'SUCCESS', verificationStatus: 'VERIFIED', progress: {} };
      },
      async getClientExportFiles(id) {
        return [...byJob.get(id)].map(([relativePath, filePath]) => ({
          path: relativePath,
          sizeBytes: fs.statSync(filePath).size
        }));
      },
      async openClientExportFile(id, relativePath) {
        const filePath = byJob.get(id).get(relativePath);
        const stat = await fsp.stat(filePath);
        return { stream: fs.createReadStream(filePath), sizeBytes: stat.size };
      },
      async deleteClientExport(id) {
        deletedSourceJobs.push(id);
        await fsp.rm(path.join(outputRoot, `Backup-Set-${id}`), { recursive: true, force: false });
      }
    },
    outputRoot,
    temporaryRoot,
    clientExportRoot: temporaryRoot,
    stateDirectory,
    restoreWizardRoot: path.resolve(__dirname, '../../restore-wizard'),
    packageSigningPrivateKey: PACKAGE_SIGNING_PRIVATE_KEY,
    platform: 'win32',
    archiveIdleTimeoutMs: 5000,
    archiveOutputDrainTimeoutMs: 20,
    archiveTerminationGraceMs: 10,
    statfs: async () => ({ bavail: 1024 * 1024, bsize: 1024 }),
    spawn: (_command, _args, spawnOptions) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdout.destroyed = false;
      child.stderr.destroyed = false;
      child.stdout.destroy = function destroy() { this.destroyed = true; };
      child.stderr.destroy = function destroy() { this.destroyed = true; };
      child.kill = () => {
        child.wasKilled = true;
        return true;
      };
      children.push(child);
      processPaths.push({
        source: spawnOptions.env.RESTORE_PACKAGE_SOURCE,
        output: spawnOptions.env.RESTORE_PACKAGE_OUTPUT
      });
      const fileCount = spawnOptions.env.RESTORE_PACKAGE_EXPECTED_COUNT;
      const byteCount = spawnOptions.env.RESTORE_PACKAGE_EXPECTED_BYTES;
      if (children.length >= 3) {
        const zip = new AdmZip();
        zip.addLocalFolder(spawnOptions.env.RESTORE_PACKAGE_SOURCE);
        zip.writeZip(spawnOptions.env.RESTORE_PACKAGE_OUTPUT);
      }
      process.nextTick(() => {
        const output =
          `STOCKSITE_PROGRESS|create|${fileCount}|${byteCount}\n` +
          `STOCKSITE_PROGRESS|verify|${fileCount}|${byteCount}\n`;
        const verified = children.length !== 2
          ? `${output}STOCKSITE_ARCHIVE_VERIFIED|${fileCount}|${byteCount}\n`
          : output;
        child.stdout.emit('data', Buffer.from(verified));
        if (children.length === 1) child.emit('exit', 0, null);
        else child.emit('close', 0, null);
      });
      return child;
    },
    pollIntervalMs: 1
  });

  try {
    const first = await service.start({ includeEncryptedEnvironmentFiles: true });
    const failed = await waitFor(service, first.id);
    assert.equal(failed.status, 'FAILED');
    assert.match(failed.error, /output streams did not close/);
    assert.equal(failed.tasks.find(({ id }) => id === 'websiteCode').filesCompleted, 1);
    assert.equal(children[0].wasKilled, undefined, 'an already-exited child must not be killed again');
    assert.equal(children[0].stdout.destroyed, true);
    assert.equal(children[0].stderr.destroyed, true);
    const saved = JSON.parse(await fsp.readFile(path.join(stateDirectory, `${first.id}.json`), 'utf8'));
    assert.equal(saved.status, 'FAILED');

    const retry = await service.start({ includeEncryptedEnvironmentFiles: true });
    assert.equal(retry.id, ids[1]);
    assert.equal(retry.status, 'RUNNING');
    assert.equal(createCalls, 2);
    const retryResult = await waitFor(service, retry.id);
    assert.equal(retryResult.status, 'FAILED');
    assert.match(retryResult.error, /without confirming completed archive integrity verification/);

    const verifiedRetry = await service.start({ includeEncryptedEnvironmentFiles: true });
    assert.equal(verifiedRetry.id, ids[2]);
    const ready = await waitFor(service, verifiedRetry.id);
    assert.equal(ready.status, 'READY', ready.error);
    assert.equal(ready.progress.percent, 100);
    assert.ok(processPaths.every(({ source, output }) =>
      source.includes('GFX Temp Root') && output.includes('GFX Temp Root')),
    'source and PowerShell archive paths preserve spaces through environment arguments');
    assert.equal(new Set(processPaths.map(({ output }) => output)).size, processPaths.length,
      'every archive process gets a job-specific output path');
    assert.deepEqual(deletedSourceJobs, ids, 'only the completed package jobs source snapshots are cleaned');
    assert.equal(fs.existsSync(temporaryRoot), true, 'job cleanup never removes the configured base directory');
    for (const id of ids) {
      assert.equal(fs.existsSync(path.join(temporaryRoot, `Restore-Package-Work-${id}`)), false);
      assert.equal(fs.existsSync(path.join(outputRoot, `Backup-Set-${id}`)), false);
    }
    assert.equal(fs.existsSync(path.join(outputRoot, `Restore-Package-${ids[2]}`)), true,
      'the completed package remains available outside the temporary work directory');
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
});
