const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { test } = require('node:test');
const { createBackupRouter } = require('../routes/backup-routes');

test('all Backup routes require the provided Admin authorization middleware', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-routes-'));
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-backup-routes-state-'));
  const app = express();
  app.use(express.json());
  app.use('/admin/backup', createBackupRouter({
    pool: { query: async () => ({ rows: [] }) },
    projectRoot,
    serviceOptions: { stateDirectory },
    verifyAdmin(req, res, next) {
      if (req.headers.authorization !== 'Bearer admin-test' && req.headers['x-test-admin'] !== 'yes') {
        return res.status(401).json({ error: 'Admin only' });
      }
      next();
    }
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/admin/backup`;

  try {
    const denied = await fetch(`${baseUrl}/jobs/active`);
    assert.equal(denied.status, 401);
    const deniedBrowse = await fetch(`${baseUrl}/browse`);
    assert.equal(deniedBrowse.status, 401);
    const deniedSchedule = await fetch(`${baseUrl}/automatic`);
    assert.equal(deniedSchedule.status, 401);
    const authorized = await fetch(`${baseUrl}/history`, {
      headers: { Authorization: 'Bearer admin-test' }
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual((await authorized.json()).jobs, []);
    const folders = await fetch(`${baseUrl}/browse?path=${encodeURIComponent(projectRoot)}`, {
      headers: { 'x-test-admin': 'yes' }
    });
    assert.equal(folders.status, 200);
    assert.equal((await folders.json()).currentPath, projectRoot);
    const metrics = await fetch(`${baseUrl}/sources`, {
      headers: { 'x-test-admin': 'yes' }
    });
    assert.equal(metrics.status, 200);
    assert.ok((await metrics.json()).sources.measuredAt);
    const obsolete = await fetch(`${baseUrl}/create`, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'incremental' })
    });
    assert.equal(obsolete.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  }
});
