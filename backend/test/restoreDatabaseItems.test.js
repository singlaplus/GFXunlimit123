const assert = require('node:assert/strict');
const { test } = require('node:test');
const restoreRouter = require('../routes/restore-routes');

function makePool() {
  return {
    async query(sql, params = []) {
      const text = String(sql).toLowerCase();
      if (text.includes('from "users" where id =') || text.includes('from users where id =') || text.includes('from "users" where "id" =')) {
        const id = Number(params[0]);
        if (id === 1005) {
          return { rows: [{ id: 1005, full_name: 'Old User 1005', email: 'old@example.com' }] };
        }
        return { rows: [] };
      }
      if (text.includes('from "assets" where id =') || text.includes('from assets where id =') || text.includes('from "assets" where "id" =')) {
        const id = Number(params[0]);
        if (id === 8001) {
          return { rows: [{ id: 8001, title: 'Old Asset', status: 'draft' }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

test('backup lookup self-heals by searching snapshot rows when delta rows are missing', async () => {
  const database = {
    tables: [{
      tableName: 'earnings',
      rows: [{ id: 54, amount: 1200, status: 'paid' }]
    }],
    newRecords: [],
    updatedRecords: []
  };

  const row = restoreRouter.findDatabaseRowInBackup(database, 'earnings', '54');

  assert.ok(row, 'backup snapshot should be searched as a repair fallback');
  assert.equal(String(row.id), '54', 'snapshot row should match the missing record id');
});

test('restore repair route clears stale session state without deleting archive history', async () => {
  const jwt = require('jsonwebtoken');
  const express = require('express');

  const repairedRows = [];
  const app = express();
  app.locals = {
    JWT_SECRET: 'test-secret',
    pool: {
      async query(sql, params = []) {
        const text = String(sql).toLowerCase();
        if (text.includes('from restore_sessions') && text.includes('where status in')) {
          return { rows: [{ id: 77, status: 'in_progress', backup_filename: 'old.gfxbackup', total_items: 2, pending_items: 1, comparison_result: { status: 'stale' } }] };
        }
        if (text.includes('update restore_sessions')) {
          repairedRows.push(params[0] || 'session');
          return { rows: [{ id: 77, status: 'completed' }] };
        }
        return { rows: [] };
      }
    }
  };

  app.use('/admin/restore', restoreRouter);

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const token = jwt.sign({ user: 42 }, 'test-secret');
    const response = await fetch(`http://127.0.0.1:${port}/admin/restore/repair`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200, 'self-healing repair endpoint should clear stale restore sessions');
    assert.equal(payload.repaired, true, 'repair should indicate it healed stale restore state');
    assert.equal(repairedRows.length > 0, true, 'repair should persist the corrected session status');

    server.close();
  });
});

test('restore history sync removes orphaned logs whose files were manually deleted', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const express = require('express');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-history-sync-'));
  const restoreDir = path.join(tempDir, 'restore');
  fs.mkdirSync(restoreDir, { recursive: true });

  const keepFile = path.join(restoreDir, 'kept.gfxbackup');
  fs.writeFileSync(keepFile, 'keep');

  const dbRows = [
    { id: 1, backup_filename: 'kept.gfxbackup', backup_path: keepFile, uploaded_at: new Date().toISOString() },
    { id: 2, backup_filename: 'missing-old.gfxbackup', backup_path: path.join(restoreDir, 'missing-old.gfxbackup'), uploaded_at: new Date().toISOString() }
  ];

  const deletedRows = [];
  const app = express();
  app.locals = {
    pool: {
      async query(sql, params = []) {
        const text = String(sql).toLowerCase();
        if (text.includes('select * from restore_history')) {
          return { rows: dbRows };
        }
        if (text.includes('delete from restore_history')) {
          deletedRows.push(params[0]);
          return { rows: [] };
        }
        return { rows: [] };
      }
    }
  };

  app.use('/admin/restore', restoreRouter);

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/admin/restore/history`);
    const payload = await response.json();

    assert.equal(response.status, 200, 'history endpoint should stay available');
    assert.equal(payload.length, 1, 'orphaned history entries without backing files should be removed');
    assert.equal(payload[0].backup_filename, 'kept.gfxbackup');
    assert.equal(deletedRows.includes(2), true, 'orphaned log row should be pruned from the database');

    server.close();
  });
});

test('restore delete route removes stale log records even when file is already missing from disk', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const jwt = require('jsonwebtoken');
  const express = require('express');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-delete-orphan-'));
  const restoreDir = path.join(tempDir, 'restore');
  fs.mkdirSync(restoreDir, { recursive: true });

  const missingFileName = 'stale-log.gfxbackup';
  const missingFilePath = path.join(restoreDir, missingFileName);

  const deletedRows = [];
  const app = express();
  app.locals = {
    JWT_SECRET: 'test-secret',
    pool: {
      async query(sql, params = []) {
        const text = String(sql).toLowerCase();
        if (text.includes('from users where id =')) {
          return { rows: [{ role: 'admin', status: 'active' }] };
        }
        if (text.includes('from restore_history where id =')) {
          return { rows: [] };
        }
        if (text.includes('from restore_history where backup_filename =')) {
          return { rows: [{ id: 99, backup_filename: missingFileName, backup_path: missingFilePath }] };
        }
        if (text.includes('delete from restore_history')) {
          deletedRows.push(params[0]);
          return { rows: [] };
        }
        return { rows: [] };
      }
    }
  };

  app.use('/admin/restore', restoreRouter);

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const token = jwt.sign({ user: 42 }, 'test-secret');
    const response = await fetch(`http://127.0.0.1:${port}/admin/restore/file/${encodeURIComponent(missingFileName)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200, 'stale log should be deletable even without a file on disk');
    assert.equal(payload.message, 'File deleted');
    assert.equal(deletedRows.includes(99), true, 'log row should be force deleted by filename');

    server.close();
  });
});

test('restore delete route treats numeric-prefixed backup filenames as file names, not database ids', async () => {
  const jwt = require('jsonwebtoken');
  const express = require('express');

  const numericFileName = '1788187746852-b7d0f11d-realistic-backup.gfxbackup';
  const deletedRows = [];

  const app = express();
  app.locals = {
    JWT_SECRET: 'test-secret',
    pool: {
      async query(sql, params = []) {
        const text = String(sql).toLowerCase();

        if (text.includes('from users where id =')) {
          return { rows: [{ role: 'admin', status: 'active' }] };
        }
        if (text.includes('from restore_history where id =')) {
          return { rows: [] };
        }
        if (text.includes('from restore_history where backup_filename =')) {
          return { rows: [{ id: 42, backup_filename: numericFileName, backup_path: '/tmp/' + numericFileName }] };
        }
        if (text.includes('delete from restore_history')) {
          deletedRows.push(params[0]);
          return { rows: [] };
        }
        return { rows: [] };
      }
    }
  };

  app.use('/admin/restore', restoreRouter);

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const token = jwt.sign({ user: 42 }, 'test-secret');
    const response = await fetch(`http://127.0.0.1:${port}/admin/restore/file/${encodeURIComponent(numericFileName)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await response.json();

    assert.equal(response.status, 200, 'numeric-prefixed filenames should not be mistaken for database integer ids');
    assert.equal(payload.message, 'File deleted');
    assert.equal(deletedRows.includes(42), true, 'matching backup filename should still delete the log row');

    server.close();
  });
});

test('restore analysis includes database insert and update records without deleting destination-only rows', async () => {
  const backupData = {
    database: {
      newRecords: [
        {
          tableName: 'users',
          rows: [{ id: 1501, full_name: 'New User 1501', email: 'new1501@example.com' }]
        },
        {
          tableName: 'assets',
          rows: [{ id: 9001, title: 'New Asset 9001', status: 'active' }]
        }
      ],
      updatedRecords: [
        {
          tableName: 'users',
          rows: [{ id: 1005, full_name: 'Updated User 1005', email: 'updated1005@example.com' }]
        },
        {
          tableName: 'assets',
          rows: [{ id: 8001, title: 'Updated Asset 8001', status: 'active' }]
        }
      ]
    }
  };

  const items = await restoreRouter.analyzeBackup(backupData, makePool());

  const databaseItems = items.filter((item) => item.type === 'database');
  assert.equal(databaseItems.length, 4, 'new and updated database records should appear in the restore list');

  const newUser = databaseItems.find((item) => item.name.includes('users #1501'));
  const updatedUser = databaseItems.find((item) => item.name.includes('users #1005'));
  const newAsset = databaseItems.find((item) => item.name.includes('assets #9001'));
  const updatedAsset = databaseItems.find((item) => item.name.includes('assets #8001'));

  assert.ok(newUser && newUser.changeType === 'new');
  assert.ok(updatedUser && updatedUser.changeType === 'update');
  assert.ok(newAsset && newAsset.changeType === 'new');
  assert.ok(updatedAsset && updatedAsset.changeType === 'update');

  const destinationOnlyItems = databaseItems.filter((item) => item.name.includes('users #9999'));
  assert.equal(destinationOnlyItems.length, 0, 'destination-only records are not removed or replaced');
});

test('restore analysis detects source-only rows in complete database snapshots', async () => {
  const pool = {
    async query(sql, params = []) {
      const text = String(sql).toLowerCase();
      if (text.includes('from "users" where "id" =') || text.includes('from "images" where "id" =')) {
        return { rows: [] };
      }
      if (text.includes('select * from "users"') || text.includes('select * from "images"')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const items = await restoreRouter.analyzeBackup({
    database: {
      fullDump: true,
      tables: [
        { tableName: 'users', rows: [{ id: 2001, username: 'new-contributor', role: 'contributor' }] },
        { tableName: 'images', rows: [{ id: 3001, title: 'New Asset' }] }
      ]
    }
  }, pool);

  assert.ok(items.some((item) => item.name === 'users #2001' && item.changeType === 'new'));
  assert.ok(items.some((item) => item.name === 'images #3001' && item.changeType === 'new'));
});

test('restore analysis does not report an unchanged existing row as new', async () => {
  const existingRow = { id: 1501, full_name: 'Same User', email: 'same@example.com' };
  const pool = {
    async query(sql, params = []) {
      if (String(sql).toLowerCase().includes('from users where id =') || String(sql).toLowerCase().includes('from "users" where id =') || String(sql).toLowerCase().includes('from "users" where "id" =')) {
        return params[0] === existingRow.id ? { rows: [{ ...existingRow }] } : { rows: [] };
      }
      return { rows: [] };
    }
  };

  const items = await restoreRouter.analyzeBackup({
    database: {
      newRecords: [{
        tableName: 'users',
        rows: [{ ...existingRow, operation: 'INSERT', changedFields: ['full_name', 'email'], __recordIdentity: { tableName: 'users' } }]
      }]
    }
  }, pool);

  assert.equal(items.length, 0, 'same-system unchanged records should not be actionable');
});

test('restore analysis only lists changed files and excludes identical file copies', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const crypto = require('node:crypto');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-file-items-'));
  const projectRoot = path.join(tempRoot, 'workspace');
  fs.mkdirSync(path.join(projectRoot, 'backend', 'services'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'backend', 'helpers'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'frontend', 'src', 'pages'), { recursive: true });

  const unchangedFilePath = path.join(projectRoot, 'frontend', 'src', 'pages', 'DailyReports.jsx');
  const changedFilePath = path.join(projectRoot, 'backend', 'services', 'reportSync.js');
  const newFilePath = path.join(projectRoot, 'backend', 'helpers', 'cacheService.js');

  const sameContent = 'const same = "unchanged";\n';
  fs.writeFileSync(unchangedFilePath, sameContent, 'utf8');
  fs.writeFileSync(changedFilePath, 'const old = "before";\n', 'utf8');

  const backupData = {
    projectRoot,
    fileInventory: [
      { path: 'application/frontend/src/pages/DailyReports.jsx', checksum: crypto.createHash('sha256').update(sameContent).digest('hex') },
      { path: 'application/backend/services/reportSync.js', checksum: crypto.createHash('sha256').update('const updated = "after";\n').digest('hex') },
      { path: 'application/backend/helpers/cacheService.js', checksum: crypto.createHash('sha256').update('module.exports = {}\n').digest('hex') }
    ]
  };

  const items = await restoreRouter.analyzeBackup(backupData, makePool(), { projectRoot });
  const fileItems = items.filter((item) => item.type === 'file');

  assert.equal(fileItems.length, 2, 'only changed or new standalone files should appear');
  assert.ok(fileItems.some((item) => item.name === 'backend/services/reportSync.js' && item.changeType === 'update'));
  assert.ok(fileItems.some((item) => item.name === 'backend/helpers/cacheService.js' && item.changeType === 'new'));
  assert.ok(!fileItems.some((item) => item.name === 'frontend/src/pages/DailyReports.jsx'));
  assert.ok(!fs.existsSync(newFilePath), 'new file row should be reported without creating the file itself');
});

test('restore analysis ignores package metadata files such as metadata/device.json', async () => {
  const items = await restoreRouter.analyzeBackup({
    fileInventory: [
      { path: 'metadata/device.json', checksum: 'backup-device-checksum' },
      { path: 'application/metadata/device.json', checksum: 'backup-nested-device-checksum' },
      { path: 'database/metadata/database-summary.json', checksum: 'backup-database-checksum' },
      { path: 'application/backend/services/restore-service.js', checksum: 'backup-service-checksum' }
    ]
  }, makePool());

  const fileNames = items.filter((item) => item.type === 'file').map((item) => item.name);
  assert.deepEqual(fileNames, ['backend/services/restore-service.js']);
  assert.ok(!fileNames.includes('device.json'), 'metadata/device.json must not become a restorable project file');
});

test('restore analysis groups related files into a single feature row', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const crypto = require('node:crypto');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-feature-items-'));
  const projectRoot = path.join(tempRoot, 'workspace');
  const featureFiles = [
    'frontend/src/pages/DailyReports.jsx',
    'backend/routes/dailyReportsRoutes.js',
    'backend/controllers/dailyReportController.js',
    'frontend/src/styles/dailyReport.css'
  ];

  for (const relative of featureFiles) {
    const abs = path.join(projectRoot, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'updated feature code\n', 'utf8');
  }

  const backupData = {
    projectRoot,
    fileInventory: featureFiles.map((relative) => ({
      path: `application/${relative}`,
      checksum: crypto.createHash('sha256').update('feature backup content\n').digest('hex')
    }))
  };

  const items = await restoreRouter.analyzeBackup(backupData, makePool());
  const featureItems = items.filter((item) => item.type === 'feature');

  assert.equal(featureItems.length, 1, 'all related daily reports files should form a single feature group');
  const dailyReports = featureItems[0];
  assert.equal(dailyReports.name, 'Daily Reports', 'feature should use the logical feature name');
  assert.equal(dailyReports.relatedFiles.length, 4, 'feature row should keep all related file paths');
  assert.equal(items.filter((item) => item.type === 'file').length, 0, 'individual file rows should not remain when grouped into the feature');
});

test('restore batch update only applies safe pending items and keeps conflicts untouched', async () => {
  const express = require('express');

  let items = [
    { id: 1, session_id: 1, status: 'pending', change_type: 'new' },
    { id: 2, session_id: 1, status: 'pending', change_type: 'update' },
    { id: 3, session_id: 1, status: 'pending', change_type: 'conflict' },
    { id: 4, session_id: 1, status: 'completed', change_type: 'new' },
    { id: 5, session_id: 1, status: 'pending', change_type: 'new' }
  ];

  const session = {
    id: 1,
    status: 'analyzed',
    completed_items: 3,
    pending_items: 7,
    total_items: 10
  };

  const app = express();
  app.locals = {
    pool: {
      async query(sql, params = []) {
        const text = String(sql).toLowerCase();

        if (text.includes('from restore_sessions')) {
          return { rows: [session] };
        }

        if (text.includes('update restore_items')) {
          const sessionId = params[0];
          const changed = items.filter((item) => item.session_id === sessionId && item.status === 'pending' && item.change_type !== 'conflict' && ['new', 'update'].includes(item.change_type));

          for (const item of changed) {
            item.status = 'completed';
          }

          return { rows: changed };
        }

        if (text.includes('count(*) filter')) {
          const sessionId = params[0];
          const sessionItems = items.filter((item) => item.session_id === sessionId);
          return {
            rows: [{
              pending_count: sessionItems.filter((item) => item.status === 'pending').length,
              completed_count: sessionItems.filter((item) => item.status === 'completed').length,
              conflict_count: sessionItems.filter((item) => item.change_type === 'conflict').length
            }]
          };
        }

        if (text.includes('update restore_sessions')) {
          return { rows: [{ ...session }] };
        }

        return { rows: [] };
      }
    }
  };

  app.use('/admin/restore', restoreRouter);

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/admin/restore/all`, { method: 'POST' });
    const payload = await response.json();

    assert.equal(payload.updated, 4, 'only safe pending items should be updated');
    assert.equal(items.filter((item) => item.status === 'pending' && item.change_type === 'conflict').length, 1, 'conflict rows must remain pending');
    assert.equal(items.filter((item) => item.status === 'completed').length, 5, 'completed items should remain completed and safe updates should be marked complete');

    server.close();
  });
});

test('conflict items stay pending and require explicit review before resolution', async () => {
  const express = require('express');
  const app = express();
  const conflictItem = {
    id: 42,
    session_id: 1,
    type: 'feature',
    category: 'subscription',
    name: 'Subscription System',
    description: 'Local changes detected.',
    current_version: 'v1.5',
    backup_version: 'v1.7',
    change_type: 'conflict',
    status: 'pending'
  };

  app.locals = {
    pool: {
      async query(sql, params = []) {
        const text = String(sql).toLowerCase();
        if (text.includes('select * from restore_items where id =')) {
          return { rows: [conflictItem] };
        }
        if (text.includes('select * from restore_sessions where id =')) {
          return { rows: [{ id: 1, status: 'analyzed', backup_filename: 'demo.gfxbackup' }] };
        }
        if (text.includes('select id from restore_checkpoints')) {
          return { rows: [] };
        }
        if (text.includes('insert into restore_checkpoints')) {
          return { rows: [{ id: 99 }] };
        }
        if (text.includes('update restore_items set')) {
          conflictItem.status = 'completed';
          return { rows: [conflictItem] };
        }
        return { rows: [] };
      }
    }
  };

  app.use('/admin/restore', restoreRouter);

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/admin/restore/item/42`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    assert.equal(response.status, 409, 'conflict items should be rejected instead of auto-completing');
    assert.equal(conflictItem.status, 'pending', 'conflict items must remain pending until resolved');
    server.close();
  });
});

test('batch restore updates create a single pre_restore checkpoint before the first actual update', async () => {
  const express = require('express');
  const app = express();
  const session = { id: 17, status: 'analyzed', backup_filename: 'batch-safe.gfxbackup', total_items: 2 };
  let checkpointCreated = false;

  app.locals = {
    pool: {
      async query(sql, params = []) {
        const text = String(sql).toLowerCase();
        if (text.includes('select * from restore_sessions')) {
          return { rows: [session] };
        }
        if (text.includes('select id from restore_checkpoints')) {
          return { rows: checkpointCreated ? [{ id: 88 }] : [] };
        }
        if (text.includes('insert into restore_checkpoints')) {
          checkpointCreated = true;
          return { rows: [{ id: 88 }] };
        }
        if (text.includes('update restore_items')) {
          return { rows: [{ id: 1, session_id: 17, status: 'completed' }, { id: 2, session_id: 17, status: 'completed' }] };
        }
        if (text.includes('select count(*) filter')) {
          return { rows: [{ pending_count: 0, completed_count: 2, conflict_count: 0 }] };
        }
        if (text.includes('update restore_sessions set')) {
          return { rows: [] };
        }
        return { rows: [] };
      }
    }
  };

  app.use('/admin/restore', restoreRouter);

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/admin/restore/all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const payload = await response.json();

    assert.equal(response.status, 200, 'batch restore should proceed safely');
    assert.equal(checkpointCreated, true, 'batch restore should create the one-time pre_restore checkpoint before updating');
    assert.equal(payload.updated, 2, 'batch restore should update safe items');
    server.close();
  });
});

test('admin users can delete restore backup files and physical files are removed', async () => {
  const express = require('express');
  const fs = require('fs');
  const path = require('path');
  const jwt = require('jsonwebtoken');
  const app = express();
  const restoreDir = path.join(__dirname, '..', 'backup', 'restore');
  const filename = `delete-admin-test-${Date.now()}.gfxbackup`;
  const filePath = path.join(restoreDir, filename);

  fs.mkdirSync(restoreDir, { recursive: true });
  fs.writeFileSync(filePath, 'test backup body');

  app.locals = {
    JWT_SECRET: 'secretkey',
    pool: {
      async query(sql, params = []) {
        const text = String(sql).toLowerCase();
        if (text.includes('select role, status from users')) {
          return { rows: [{ role: 'admin', status: 'active' }] };
        }
        if (text.includes('select * from restore_history where id =')) {
          return { rows: [{ id: 1, backup_path: filePath, backup_filename: filename }] };
        }
        if (text.includes('delete from restore_history where id =')) {
          return { rows: [] };
        }
        return { rows: [] };
      }
    }
  };

  app.use('/admin/restore', restoreRouter);

  const token = jwt.sign({ user: 99 }, 'secretkey');

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/admin/restore/file/${filename}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const payload = await response.json();

    assert.equal(response.status, 200, 'admin deletion should be allowed');
    assert.equal(payload.message, 'File deleted', 'delete route should confirm removal');
    assert.equal(fs.existsSync(filePath), false, 'physical backup file should be removed from disk');

    server.close();
  });
});

test('active restore session metadata is persisted with a single active session summary', async () => {
  const express = require('express');
  const app = express();

  app.locals = {
    pool: {
      async query(sql, params = []) {
        const text = String(sql).toLowerCase();
        if (text.includes('select * from restore_sessions')) {
          return {
            rows: [{
              id: 7,
              session_id: 'restore-session-uuid',
              backup_id: 'backup-7',
              backup_filename: 'GFX_BACKUP_30-08.gfxbackup',
              uploaded_at: '2026-08-30T22:10:00.000Z',
              source_device: 'macbook',
              backup_type: 'incremental',
              status: 'analyzed',
              comparison_result: {
                restore_session_id: 'restore-session-uuid',
                backup_id: 'backup-7',
                backup_filename: 'GFX_BACKUP_30-08.gfxbackup',
                uploaded_at: '2026-08-30T22:10:00.000Z',
                source_device: 'macbook',
                backup_type: 'incremental',
                completed_items: 1,
                pending_items: 3,
                conflicts: 1,
                total_items: 4
              },
              completed_items: 1,
              pending_items: 3,
              conflict_items: 1,
              total_items: 4
            }]
          };
        }
        if (text.includes('select * from restore_items')) {
          return { rows: [{ id: 1, session_id: 7, status: 'completed' }] };
        }
        return { rows: [] };
      }
    }
  };

  app.use('/admin/restore', restoreRouter);

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/admin/restore/session`);
    const payload = await response.json();

    assert.equal(response.status, 200, 'session endpoint should return the active restore session');
    assert.equal(payload.session.restore_session_id, 'restore-session-uuid', 'session should expose the restore session id');
    assert.equal(payload.session.backup_id, 'backup-7', 'session should include the backup id');
    assert.equal(payload.session.conflicts, 1, 'session should expose the conflict count');
    assert.ok(payload.session.comparison_result, 'session should persist the comparison summary data');

    server.close();
  });
});

test('clear current restore session leaves historical backup files intact', async () => {
  const express = require('express');
  const fs = require('fs');
  const path = require('path');
  const app = express();
  const restoreDir = path.join(__dirname, '..', 'backup', 'restore');
  const filename = `GFX_BACKUP_CLEAR_TEST.gfxbackup`;
  const filePath = path.join(restoreDir, filename);

  fs.mkdirSync(restoreDir, { recursive: true });
  fs.writeFileSync(filePath, 'test backup body');

  app.locals = {
    pool: {
      async query(sql, params = []) {
        const text = String(sql).toLowerCase();
        if (text.includes('update restore_sessions set')) {
          return { rows: [] };
        }
        return { rows: [] };
      }
    }
  };

  app.use('/admin/restore', restoreRouter);

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/admin/restore/clear`, { method: 'POST' });
    const payload = await response.json();

    assert.equal(response.status, 200, 'clear route should succeed');
    assert.equal(payload.message, 'Session cleared', 'clear route should confirm session-only clearing');
    assert.equal(fs.existsSync(filePath), true, 'clear route must not delete the history archive file');

    fs.unlinkSync(filePath);
    server.close();
  });
});
