const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { createBackupRouter } = require('../routes/backup-routes');

function adminOnly(req, res, next) {
  if (req.headers['x-test-admin'] !== 'yes') return res.status(401).json({ error: 'Admin only' });
  next();
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('server Backup routes preserve Admin authorization', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-routes-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-routes-state-'));
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-routes-destination-'));
  const app = express();
  app.use(express.json());
  app.use('/admin/backup', createBackupRouter({
    pool: { query: async () => ({ rows: [] }) },
    projectRoot,
    serviceOptions: { stateDirectory, platform: 'win32' },
    verifyAdmin: adminOnly
  }));
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}/admin/backup`;
  const adminHeaders = { 'x-test-admin': 'yes' };

  try {
    for (const endpoint of ['/jobs/active', '/browse', '/automatic/browse', '/jobs/GFX-TEST/export/file?path=manifest.json', '/automatic']) {
      assert.equal((await fetch(`${baseUrl}${endpoint}`)).status, 401);
    }
    const authorized = await fetch(`${baseUrl}/history`, { headers: adminHeaders });
    assert.equal(authorized.status, 200);
    assert.deepEqual((await authorized.json()).jobs, []);
    const folders = await fetch(`${baseUrl}/browse?path=${encodeURIComponent(projectRoot)}`, { headers: adminHeaders });
    assert.equal(folders.status, 200);
    assert.equal((await folders.json()).currentPath, projectRoot);
    const metrics = await fetch(`${baseUrl}/sources`, { headers: adminHeaders });
    assert.equal(metrics.status, 200);
    assert.ok((await metrics.json()).sources.measuredAt);
    const testedDestination = await fetch(`${baseUrl}/test-connection`, {
      method: 'POST',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ path: destination })
    });
    assert.equal(testedDestination.status, 200);
    assert.equal((await testedDestination.json()).drives[0].path, fs.realpathSync(destination));
    assert.equal(fs.readdirSync(destination).length, 0);
    const obsolete = await fetch(`${baseUrl}/create`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'incremental' })
    });
    assert.equal(obsolete.status, 404);
  } finally {
    await close(server);
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test('automatic destination browser hides Mac export staging and backend rejects staging destinations', async () => {
  const parentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-auto-browser-'));
  const clientExportRoot = path.join(parentDirectory, 'manual-export-staging');
  const serverDestination = path.join(parentDirectory, 'server-backups');
  fs.mkdirSync(clientExportRoot);
  fs.mkdirSync(serverDestination);
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-auto-browser-state-'));
  const app = express();
  app.use(express.json());
  app.use('/admin/backup', createBackupRouter({
    pool: { query: async () => ({ rows: [] }) },
    serviceOptions: { stateDirectory, clientExportRoot, platform: 'win32' },
    verifyAdmin: adminOnly
  }));
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}/admin/backup`;
  const adminHeaders = { 'x-test-admin': 'yes' };

  try {
    const listingResponse = await fetch(`${baseUrl}/automatic/browse?path=${encodeURIComponent(parentDirectory)}`, {
      headers: adminHeaders
    });

    assert.equal(listingResponse.status, 200);
    const listing = await listingResponse.json();
    assert.deepEqual(listing.directories.map((directory) => directory.path), [serverDestination]);

    const stagingBrowse = await fetch(`${baseUrl}/automatic/browse?path=${encodeURIComponent(clientExportRoot)}`, {
      headers: adminHeaders
    });
    assert.equal(stagingBrowse.status, 422);
    assert.match((await stagingBrowse.json()).error, /not an automatic backup destination/);

    const stagingTest = await fetch(`${baseUrl}/test-connection`, {
      method: 'POST',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ path: clientExportRoot })
    });
    assert.equal(stagingTest.status, 422);
    assert.match((await stagingTest.json()).error, /protected production source/);
  } finally {
    await close(server);
    fs.rmSync(parentDirectory, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('automatic schedule API saves and returns multiple independent schedules', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-schedules-route-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-schedules-route-state-'));
  const firstDestination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-schedules-route-first-'));
  const secondDestination = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-schedules-route-second-'));
  const app = express();
  app.use(express.json());
  app.use('/admin/backup', createBackupRouter({
    pool: { query: async () => ({ rows: [] }) },
    projectRoot,
    serviceOptions: { stateDirectory, platform: 'win32' },
    verifyAdmin: adminOnly
  }));
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}/admin/backup`;
  const headers = { 'x-test-admin': 'yes', 'content-type': 'application/json' };
  const schedules = [
    { id: 'daily-db', enabled: false, destination: firstDestination, selectedTypes: ['database'], frequency: 'daily', time: '02:00' },
    { id: 'weekly-code', enabled: false, destination: secondDestination, selectedTypes: ['websiteCode'], frequency: 'weekly', time: '03:00', weeklyDay: 2 }
  ];
  try {
    const savedResponse = await fetch(`${baseUrl}/automatic`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ schedules })
    });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.deepEqual(saved.schedules.map((schedule) => schedule.id), ['daily-db', 'weekly-code']);

    const loadedResponse = await fetch(`${baseUrl}/automatic`, { headers });
    assert.equal(loadedResponse.status, 200);
    const loaded = await loadedResponse.json();
    assert.deepEqual(loaded.schedules.map((schedule) => schedule.frequency), ['daily', 'weekly']);
  } finally {
    await close(server);
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
    fs.rmSync(firstDestination, { recursive: true, force: true });
    fs.rmSync(secondDestination, { recursive: true, force: true });
  }
});

test('Mac Backup Center proxies source requests to the configured SERVER and never queries the local database', async () => {
  const upstreamRequests = [];
  let localDatabaseQueries = 0;
  const app = express();
  app.use('/admin/backup', createBackupRouter({
    pool: { query: async () => { localDatabaseQueries += 1; return { rows: [] }; } },
    serviceOptions: {
      platform: 'darwin',
      environment: { PC2_ASSET_SERVER_URL: 'http://server.example:5000' },
      httpClient: {
        async request(options) {
          upstreamRequests.push(options);
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            data: Readable.from([JSON.stringify({ sources: { database: { sourceServer: 'production-db' } } })])
          };
        }
      }
    },
    verifyAdmin: adminOnly
  }));
  const server = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/backup/sources`, {
      headers: { 'x-test-admin': 'yes' }
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sources.database.sourceServer, 'production-db');
    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0].url, 'http://server.example:5000/admin/backup/sources');
    assert.equal(upstreamRequests[0].responseType, 'stream');
    assert.equal(localDatabaseQueries, 0);
  } finally {
    await close(server);
  }
});

test('Mac Backup Center forwards admin credentials and fails closed without a SERVER origin', async () => {
  const forwardedAuthorization = [];
  const proxyApp = express();
  proxyApp.use('/admin/backup', createBackupRouter({
    pool: { query: async () => { throw new Error('local DB must not be queried'); } },
    serviceOptions: {
      platform: 'darwin',
      environment: { PC2_ASSET_SERVER_URL: 'http://server.example:5000' },
      httpClient: {
        async request(options) {
          forwardedAuthorization.push(options.headers.authorization);
          return { status: 200, headers: {}, data: Readable.from(['{}']) };
        }
      }
    },
    verifyAdmin(req, res, next) {
      if (req.headers.authorization !== 'Bearer test-admin') return res.status(401).json({ error: 'Admin only' });
      next();
    }
  }));
  const proxyServer = await listen(proxyApp);

  const missingConfigApp = express();
  missingConfigApp.use('/admin/backup', createBackupRouter({
    pool: { query: async () => { throw new Error('local DB must not be queried'); } },
    serviceOptions: { platform: 'darwin', environment: {} },
    verifyAdmin(req, res, next) {
      if (req.headers.authorization !== 'Bearer test-admin') return res.status(401).json({ error: 'Admin only' });
      next();
    }
  }));
  const missingConfigServer = await listen(missingConfigApp);

  try {
    const proxied = await fetch(`http://127.0.0.1:${proxyServer.address().port}/admin/backup/sources`, {
      headers: { authorization: 'Bearer test-admin' }
    });
    assert.equal(proxied.status, 200);
    assert.deepEqual(forwardedAuthorization, ['Bearer test-admin']);

    const missing = await fetch(`http://127.0.0.1:${missingConfigServer.address().port}/admin/backup/sources`, {
      headers: { authorization: 'Bearer test-admin' }
    });
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).error, /no local backup was started/);
  } finally {
    await Promise.all([close(proxyServer), close(missingConfigServer)]);
  }
});

test('Mac Backup Center preserves the manual-local plan request and streams export files from the SERVER', async () => {
  const upstreamRequests = [];
  const app = express();
  app.use(express.json());
  app.use('/admin/backup', createBackupRouter({
    pool: { query: async () => { throw new Error('local DB must not be queried'); } },
    serviceOptions: {
      platform: 'darwin',
      environment: { PC2_ASSET_SERVER_URL: 'http://server.example:5000' },
      httpClient: {
        async request(options) {
          upstreamRequests.push(options);
          if (options.url.endsWith('/plan')) {
            return {
              status: 200,
              headers: { 'content-type': 'application/json' },
              data: Readable.from([JSON.stringify({ ready: true, sourceRoots: { originalAssets: 'F:\\GFXunlimitAssets' } })])
            };
          }
          if (options.url.endsWith('/jobs/GFX-test/export')) {
            return {
              status: 200,
              headers: { 'content-type': 'application/json' },
              data: Readable.from([JSON.stringify({ files: [
                { path: 'Database/stocksite.backup', sizeBytes: 64 },
                { path: 'checksums.sha256', sizeBytes: 128 },
                { path: 'manifest.json', sizeBytes: 512 }
              ] })])
            };
          }
          return {
            status: 200,
            headers: { 'content-type': 'application/octet-stream', 'content-length': '13' },
            data: Readable.from(['verified-data'])
          };
        }
      }
    },
    verifyAdmin: adminOnly
  }));
  const server = await listen(app);

  try {
    const planResponse = await fetch(`http://127.0.0.1:${server.address().port}/admin/backup/plan`, {
      method: 'POST',
      headers: { 'x-test-admin': 'yes', 'content-type': 'application/json' },
      body: JSON.stringify({ destinationMode: 'mac-local', categories: ['database'] })
    });
    assert.equal(planResponse.status, 200);
    const plan = await planResponse.json();
    assert.equal(plan.ready, true);
    assert.equal(plan.sourceRoots.originalAssets, 'F:\\GFXunlimitAssets');
    assert.deepEqual(upstreamRequests[0].data, { destinationMode: 'mac-local', categories: ['database'] });
    assert.equal(upstreamRequests[0].url, 'http://server.example:5000/admin/backup/plan');

    const fileListResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/admin/backup/jobs/GFX-test/export`,
      { headers: { 'x-test-admin': 'yes' } }
    );
    assert.equal(fileListResponse.status, 200);
    assert.ok((await fileListResponse.json()).files.some((file) => file.path === 'manifest.json'));

    const exportResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/admin/backup/jobs/GFX-test/export/file?path=manifest.json`,
      { headers: { 'x-test-admin': 'yes' } }
    );
    assert.equal(exportResponse.status, 200);
    assert.equal(exportResponse.headers.get('content-length'), '13');
    assert.equal(await exportResponse.text(), 'verified-data');
    assert.match(upstreamRequests[2].url, /\/jobs\/GFX-test\/export\/file\?path=manifest\.json$/);
  } finally {
    await close(server);
  }
});
