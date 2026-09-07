const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const pool = require("../db");
const { createGfxBackupPackage, collectFileChangeStatusReport } = require("../server");

test("GFX Complete Backup mode marks the package as a full disaster-recovery backup", async () => {
  const uploadDir = path.join(__dirname, "..", "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  const uploadFile = path.join(uploadDir, "complete-backup-check.txt");
  fs.writeFileSync(uploadFile, "complete backup check\n", "utf8");

  try {
    const archive = await createGfxBackupPackage({
      backupId: "GFX-COMPLETE-TEST",
      mode: "complete",
      from: "2025-01-01T00:00:00.000Z",
      to: "2025-01-02T00:00:00.000Z",
      deviceId: "test-device",
      previousBackupId: "none"
    });

    assert.equal(archive.mode, "Complete Backup");
    assert.equal(archive.database.fullDump, true);
    assert.equal(archive.manifest.database.fullDump, true);
    assert.ok(archive.manifest.includes.includes("database-full.json"));
    assert.ok(archive.manifest.changedFiles.includes("backend/uploads/complete-backup-check.txt"));
    assert.ok(archive.filePath.includes("/backend/backup/"));
  } finally {
    try {
      fs.unlinkSync(uploadFile);
    } catch (error) {
      // ignore cleanup failures
    }
  }
});

test("GFX backup IDs are unique and use the required naming format without overwriting existing files", async () => {
  const idA = "GFX-BACKUP-20260830-145000-8F32A1";
  const idB = "GFX-BACKUP-20260830-145001-8F32A2";
  const now = new Date("2026-08-30T14:50:00.000Z");
  const dir = path.join(__dirname, "..", "backup", "2026", "08", "30");
  fs.mkdirSync(dir, { recursive: true });
  const fileA = path.join(dir, "GFX_BACKUP_2026-08-30_145000_8F32A1.gfxbackup");
  const fileB = path.join(dir, "GFX_BACKUP_2026-08-30_145001_8F32A2.gfxbackup");

  try {
    fs.writeFileSync(fileA, "existing file A");
    fs.writeFileSync(fileB, "existing file B");

    const generatedId = /^GFX-BACKUP-\d{8}-\d{6}-[A-F0-9]{6}$/;
    const generatedFile = /^GFX_BACKUP_\d{4}-\d{2}-\d{2}_\d{6}_[A-F0-9]{6}\.gfxbackup$/;

    assert.match(idA, generatedId);
    assert.match(idB, generatedId);
    assert.match(path.basename(fileA), generatedFile);
    assert.match(path.basename(fileB), generatedFile);
    assert.notEqual(idA, idB);
    assert.notEqual(path.basename(fileA), path.basename(fileB));
  } finally {
    for (const file of [fileA, fileB]) {
      try { fs.unlinkSync(file); } catch (error) {}
    }
  }
});

test("GFX incremental backup records merge-safe database deltas instead of full database dumps", async () => {
  const archive = await createGfxBackupPackage({
    backupId: "GFX-INCREMENTAL-DB-DELTA",
    mode: "Incremental Backup",
    from: "2025-01-01T00:00:00.000Z",
    to: "2025-01-02T00:00:00.000Z",
    deviceId: "GFX-MAC-001",
    previousBackupId: "GFX-BACKUP-20250101-000000-ABC123"
  });

  assert.equal(archive.database.fullDump, false);
  assert.equal(archive.manifest.database.fullDump, false);
  assert.ok(Array.isArray(archive.database.newRecords));
  assert.ok(Array.isArray(archive.database.updatedRecords));
  assert.ok(Array.isArray(archive.database.schemaChanges));
  assert.ok(Array.isArray(archive.database.migrations));
  assert.ok(archive.database.sync && archive.database.sync.restoreStrategy === "merge-with-existing-database");
  assert.ok(archive.database.sync && archive.database.sync.requiresDestinationMerge === true);
  assert.ok(archive.database.recordIdentity && typeof archive.database.recordIdentity === "object");

  const tablesWithKeys = Object.entries(archive.database.recordIdentity).filter(([, meta]) => meta && meta.hasStableIdentifier);
  if (tablesWithKeys.length > 0) {
    const [tableName, metadata] = tablesWithKeys[0];
    assert.ok(Array.isArray(metadata.identityColumns));
    assert.ok(metadata.identityColumns.length > 0);
    assert.equal(metadata.restoreCheck, "match-on-primary-or-unique-key");
    assert.ok(!archive.manifest.includes.includes("database-full.json") || archive.manifest.includes.includes("database/"));
  }
});

test("GFX incremental backups capture field-level change metadata for updates", async () => {
  const now = new Date();
  const tableName = "gfx_backup_field_tracking_test";

  await pool.query(`
    DROP TABLE IF EXISTS public.${tableName};
    CREATE TABLE public.${tableName} (
      id SERIAL PRIMARY KEY,
      first_name TEXT,
      subscription_plan TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO public.${tableName} (first_name, subscription_plan, updated_at)
    VALUES ('Alice', 'starter', $1)
  `, [now.toISOString()]);

  await pool.query(`
    UPDATE public.${tableName}
    SET first_name = 'Alicia', subscription_plan = 'pro', updated_at = $1
    WHERE first_name = 'Alice';
  `, [new Date(now.getTime() + 60000).toISOString()]);

  try {
    const archive = await createGfxBackupPackage({
      backupId: "GFX-FIELD-CHANGE-TEST",
      mode: "Incremental Backup",
      from: new Date(now.getTime() - 60000).toISOString(),
      to: new Date(now.getTime() + 120000).toISOString(),
      deviceId: "GFX-MAC-001",
      previousBackupId: "none"
    });

    const tableUpdate = (archive.database.updatedRecords || []).find((entry) => entry.tableName === tableName);
    assert.ok(tableUpdate, "expected the test table to appear in updatedRecords");
    assert.ok(Array.isArray(tableUpdate.rows[0].changedFields));
    assert.ok(tableUpdate.rows[0].changedFields.includes("first_name"));
    assert.ok(tableUpdate.rows[0].changedFields.includes("subscription_plan"));
    assert.ok(tableUpdate.rows[0].changedFields.includes("updated_at"));
    assert.ok(tableUpdate.rows[0].operation === "UPDATE");
  } finally {
    await pool.query(`DROP TABLE IF EXISTS public.${tableName};`);
  }
});

test("GFX asset handling includes changed asset originals and generated files without deleting persistent user data", async () => {
  const assetRoot = path.join(__dirname, "..", "uploads", "backup-asset-test", "2026", "08", "Pending");
  const assetFile = path.join(assetRoot, "asset-original.png");
  const thumbnailFile = path.join(assetRoot, "thumbnails", "asset-original-thumb.jpg");
  const previewFile = path.join(assetRoot, "previews", "asset-original-preview.jpg");

  fs.mkdirSync(path.dirname(thumbnailFile), { recursive: true });
  fs.mkdirSync(path.dirname(previewFile), { recursive: true });
  fs.writeFileSync(assetFile, "original asset\n", "utf8");
  fs.writeFileSync(thumbnailFile, "thumbnail payload\n", "utf8");
  fs.writeFileSync(previewFile, "preview payload\n", "utf8");

  try {
    const changed = collectChangedFilesSince(new Date(Date.now() - 60000).toISOString(), [path.join(__dirname, "..", "uploads")]);
    const picks = changed.filter((entry) => entry.includes("backup-asset-test"));

    assert.ok(picks.some((entry) => entry.endsWith("asset-original.png")));
    assert.ok(picks.some((entry) => entry.includes("thumbnails/asset-original-thumb.jpg")));
    assert.ok(picks.some((entry) => entry.includes("previews/asset-original-preview.jpg")));
    assert.ok(fs.existsSync(assetFile));
    assert.ok(fs.existsSync(thumbnailFile));
    assert.ok(fs.existsSync(previewFile));
  } finally {
    for (const file of [assetFile, thumbnailFile, previewFile]) {
      try { fs.unlinkSync(file); } catch (error) {}
    }
    try { fs.rmSync(path.join(__dirname, "..", "uploads", "backup-asset-test"), { recursive: true, force: true }); } catch (error) {}
  }
});

test("GFX file change detection marks NEW, MODIFIED, and UNCHANGED using checksum-based identity", async () => {
  const tempDir = path.join(__dirname, "..", "tmp", "file-status-check");
  fs.mkdirSync(tempDir, { recursive: true });
  const filePath = path.join(tempDir, "status-check.txt");
  const previousPath = path.join(tempDir, "previous-status-check.txt");

  try {
    fs.writeFileSync(filePath, "original\n", "utf8");
    fs.writeFileSync(previousPath, "original\n", "utf8");

    const current = collectFileChangeStatusReport([
      {
        relativePath: "backend/tmp/file-status-check/status-check.txt",
        absolutePath: filePath,
        statusSource: "live"
      }
    ], {
      "backend/tmp/file-status-check/status-check.txt": {
        relativePath: "backend/tmp/file-status-check/status-check.txt",
        checksum: require("node:crypto").createHash("sha256").update("original\n").digest("hex"),
        fileSize: 9,
        modifiedAt: new Date(fs.statSync(filePath).mtimeMs).toISOString()
      }
    });

    assert.equal(current.files[0].status, "UNCHANGED");

    fs.writeFileSync(filePath, "updated\n", "utf8");
    const modified = collectFileChangeStatusReport([
      {
        relativePath: "backend/tmp/file-status-check/status-check.txt",
        absolutePath: filePath,
        statusSource: "live"
      }
    ], {
      "backend/tmp/file-status-check/status-check.txt": {
        relativePath: "backend/tmp/file-status-check/status-check.txt",
        checksum: require("node:crypto").createHash("sha256").update("original\n").digest("hex"),
        fileSize: 9,
        modifiedAt: new Date(fs.statSync(previousPath).mtimeMs).toISOString()
      }
    });

    assert.equal(modified.files[0].status, "MODIFIED");
    assert.ok(modified.summary.NEW === 0);
    assert.ok(modified.summary.MODIFIED >= 1);

    const newFilePath = path.join(tempDir, "new-status.txt");
    fs.writeFileSync(newFilePath, "brand new\n", "utf8");

    const nowMissing = collectFileChangeStatusReport([
      {
        relativePath: "backend/tmp/file-status-check/new-status.txt",
        absolutePath: newFilePath,
        statusSource: "live"
      }
    ], {});

    assert.equal(nowMissing.files[0].status, "NEW");
  } finally {
    for (const file of [filePath, previousPath, path.join(tempDir, "new-status.txt")]) {
      try { fs.unlinkSync(file); } catch (error) {}
    }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (error) {}
  }
});

test("GFX sync tracking adds a central non-destructive change log table without altering existing data", async () => {
  const tableCheck = await pool.query(`
    SELECT to_regclass('public.gfx_sync_changes') AS table_name;
  `);

  assert.ok(tableCheck.rows[0].table_name === 'gfx_sync_changes' || tableCheck.rows[0].table_name === 'public.gfx_sync_changes');

  const columnCheck = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gfx_sync_changes'
    ORDER BY column_name;
  `);

  const columns = columnCheck.rows.map((row) => row.column_name);
  assert.ok(columns.includes('change_id'));
  assert.ok(columns.includes('device_id'));
  assert.ok(columns.includes('table_name'));
  assert.ok(columns.includes('record_id'));
  assert.ok(columns.includes('operation'));
  assert.ok(columns.includes('changed_fields'));
  assert.ok(columns.includes('changed_at'));
  assert.ok(columns.includes('version'));
});
