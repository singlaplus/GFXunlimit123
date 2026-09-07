const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const AdmZip = require("adm-zip");
const pool = require("../db");
const { createGfxBackupPackage, validateBackupArchive, normalizeDeviceId } = require("../server");

function makeProjectRoot() {
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "gfx-backup-scenario-"));
  fs.mkdirSync(path.join(root, "backend", "uploads"), { recursive: true });
  fs.mkdirSync(path.join(root, "frontend", "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "backend", "backup"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "gfx-backup-scenario", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(root, "backend", "server.js"), "module.exports = {};\n");
  fs.writeFileSync(path.join(root, "backend", "db.js"), "module.exports = {};\n");
  return root;
}

function makeTempAssetFile(projectRoot, relativeName, content) {
  const filePath = path.join(projectRoot, "backend", "uploads", relativeName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function removeIfExists(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    // ignore cleanup failures
  }
}

test("Scenario 1 — no changes: incremental backup is rejected with a clear no-changes message", async () => {
  const projectRoot = makeProjectRoot();

  try {
    const archive = await createGfxBackupPackage({
      projectRoot,
      backupId: "GFX-BACKUP-SCENARIO-1",
      mode: "Incremental Backup",
      from: new Date(Date.now() + 60 * 1000).toISOString(),
      to: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      deviceId: "GFX-MAC-001",
      previousBackupId: "none"
    });

    assert.equal(archive.shouldCreatePackage, false);
    assert.equal(archive.summary.message, "No changes found.");
    assert.equal(archive.filePath, undefined);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("Scenario 2 — new user: backup counts a new database record", async () => {
  const tableName = "gfx_backup_scenario_new_user";
  await pool.query(`DROP TABLE IF EXISTS public.${tableName};`);
  await pool.query(`CREATE TABLE public.${tableName} (id SERIAL PRIMARY KEY, full_name TEXT, email TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

  try {
    const now = new Date();
    await pool.query(`INSERT INTO public.${tableName}(full_name, email, created_at, updated_at) VALUES ($1, $2, $3, $3)`, ["Scenario New User", "new-user@example.com", now.toISOString()]);

    const archive = await createGfxBackupPackage({
      backupId: "GFX-BACKUP-SCENARIO-2",
      mode: "Incremental Backup",
      from: new Date(now.getTime() - 60000).toISOString(),
      to: new Date(now.getTime() + 60000).toISOString(),
      deviceId: "GFX-MAC-001",
      previousBackupId: "none"
    });

    const tableEntry = (archive.database.newRecords || []).find((entry) => entry.tableName === tableName);
    assert.ok(tableEntry, "new user record should be captured in newRecords");
    assert.equal(tableEntry.recordCount, 1);
    assert.equal(archive.summary.newDatabaseRecords, 1);
  } finally {
    await pool.query(`DROP TABLE IF EXISTS public.${tableName};`);
  }
});

test("Scenario 3 — existing user updated: backup captures updated record and changed fields", async () => {
  const tableName = "gfx_backup_scenario_updated_user";
  await pool.query(`DROP TABLE IF EXISTS public.${tableName};`);
  await pool.query(`CREATE TABLE public.${tableName} (id SERIAL PRIMARY KEY, full_name TEXT, email TEXT, status TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

  try {
    const now = new Date();
    await pool.query(`INSERT INTO public.${tableName}(full_name, email, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`, ["Old Name", "old@example.com", "pending", now.toISOString()]);

    await pool.query(`UPDATE public.${tableName} SET full_name = $1, status = $2, updated_at = $3 WHERE email = $4`, ["New Name", "active", new Date(now.getTime() + 60000).toISOString(), "old@example.com"]);

    const archive = await createGfxBackupPackage({
      backupId: "GFX-BACKUP-SCENARIO-3",
      mode: "Incremental Backup",
      from: new Date(now.getTime() - 60000).toISOString(),
      to: new Date(now.getTime() + 120000).toISOString(),
      deviceId: "GFX-MAC-001",
      previousBackupId: "none"
    });

    const tableEntry = (archive.database.updatedRecords || []).find((entry) => entry.tableName === tableName);
    assert.ok(tableEntry, "updated record should be captured in updatedRecords");
    assert.equal(tableEntry.recordCount, 1);
    assert.equal(archive.summary.updatedDatabaseRecords, 1);
    const changedFields = tableEntry.rows?.[0]?.changedFields || [];
    assert.ok(changedFields.includes("full_name") || changedFields.includes("status") || changedFields.includes("updated_at"));
  } finally {
    await pool.query(`DROP TABLE IF EXISTS public.${tableName};`);
  }
});

test("Scenario 4 — new asset: backup marks the new asset and generated files", async () => {
  const projectRoot = makeProjectRoot();
  const assetFile = makeTempAssetFile(projectRoot, "asset-scenario-new/original.png", "original asset\n");
  const thumbFile = makeTempAssetFile(projectRoot, "asset-scenario-new/thumbnails/original-thumb.jpg", "thumb\n");
  const previewFile = makeTempAssetFile(projectRoot, "asset-scenario-new/previews/original-preview.jpg", "preview\n");

  try {
    const archive = await createGfxBackupPackage({
      projectRoot,
      backupId: "GFX-BACKUP-SCENARIO-4",
      mode: "Incremental Backup",
      from: new Date(Date.now() - 60 * 1000).toISOString(),
      to: new Date(Date.now() + 60 * 1000).toISOString(),
      deviceId: "GFX-MAC-001",
      previousBackupId: "none"
    });

    assert.equal(archive.summary.newAssets, 1);
    assert.ok(archive.summary.newFiles >= 1);
    assert.ok(archive.fileInventory.some((entry) => entry.path.includes("asset-scenario-new/original.png") || entry.path.includes("asset-scenario-new/thumbnails/original-thumb.jpg") || entry.path.includes("asset-scenario-new/previews/original-preview.jpg")));
  } finally {
    removeIfExists(assetFile);
    removeIfExists(thumbFile);
    removeIfExists(previewFile);
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("Scenario 5 — modified asset: backup marks it as modified without deleting source files", async () => {
  const projectRoot = makeProjectRoot();
  const assetPath = makeTempAssetFile(projectRoot, "asset-scenario-modified/original.png", "before update\n");
  const baselineTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  fs.utimesSync(assetPath, baselineTime, baselineTime);

  try {
    const beforeWindowFrom = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString();
    const beforeWindowTo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const before = await createGfxBackupPackage({
      projectRoot,
      backupId: "GFX-BACKUP-SCENARIO-5-BEFORE",
      mode: "Incremental Backup",
      from: beforeWindowFrom,
      to: beforeWindowTo,
      deviceId: "GFX-MAC-001",
      previousBackupId: "none"
    });
    assert.equal(before.shouldCreatePackage, false);

    fs.writeFileSync(assetPath, "after update\n", "utf8");
    fs.utimesSync(assetPath, new Date(), new Date());
    const after = await createGfxBackupPackage({
      projectRoot,
      backupId: "GFX-BACKUP-SCENARIO-5-AFTER",
      mode: "Incremental Backup",
      from: new Date(Date.now() - 60 * 1000).toISOString(),
      to: new Date(Date.now() + 60 * 1000).toISOString(),
      deviceId: "GFX-MAC-001",
      previousBackupId: "none"
    });

    assert.equal(after.summary.modifiedAssets, 1);
    assert.ok(fs.existsSync(assetPath));
  } finally {
    removeIfExists(assetPath);
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("Scenario 6 — PC1-only data is preserved and not deleted by backup generation", async () => {
  const projectRoot = makeProjectRoot();
  const filePath = makeTempAssetFile(projectRoot, "pc1-only-data/keep-me.txt", "pc1 data\n");
  const deviceId = "GFX-PC1-001";
  try {
    const archive = await createGfxBackupPackage({
      projectRoot,
      backupId: "GFX-BACKUP-SCENARIO-6",
      mode: "Incremental Backup",
      from: new Date(Date.now() - 60000).toISOString(),
      to: new Date(Date.now() + 60000).toISOString(),
      deviceId,
      previousBackupId: "none"
    });

    assert.equal(normalizeDeviceId(deviceId), deviceId);
    assert.equal(archive.deviceId, deviceId);
    assert.ok(fs.existsSync(filePath));
    assert.ok(archive.fileInventory.some((entry) => entry.path.includes("pc1-only-data/keep-me.txt")) || archive.summary.newFiles >= 1);
  } finally {
    removeIfExists(filePath);
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("Scenario 7 — source metadata is valid for MAC and PC1 devices", async () => {
  const mac = await createGfxBackupPackage({
    backupId: "GFX-BACKUP-SCENARIO-7-MAC",
    mode: "Incremental Backup",
    from: new Date(Date.now() - 60000).toISOString(),
    to: new Date(Date.now() + 60000).toISOString(),
    deviceId: "GFX-MAC-001",
    previousBackupId: "none"
  });

  const pc1 = await createGfxBackupPackage({
    backupId: "GFX-BACKUP-SCENARIO-7-PC1",
    mode: "Incremental Backup",
    from: new Date(Date.now() - 60000).toISOString(),
    to: new Date(Date.now() + 60000).toISOString(),
    deviceId: "GFX-PC1-001",
    previousBackupId: "none"
  });

  assert.equal(mac.deviceId, "GFX-MAC-001");
  assert.equal(pc1.deviceId, "GFX-PC1-001");
  assert.equal(normalizeDeviceId("GFX-MAC-001"), "GFX-MAC-001");
  assert.equal(normalizeDeviceId("GFX-PC1-001"), "GFX-PC1-001");
});

test("Scenario 8 — corrupted or incomplete package is rejected by backup validation", async () => {
  const tempZip = path.join(__dirname, "..", "tmp", "corrupted-backup.gfxbackup");
  fs.mkdirSync(path.dirname(tempZip), { recursive: true });
  fs.writeFileSync(tempZip, "not a valid zip\n", "utf8");

  try {
    const result = await validateBackupArchive(tempZip);
    assert.equal(result.valid, false);
    assert.ok(Array.isArray(result.errors));
    assert.ok(result.errors.length > 0);
  } finally {
    removeIfExists(tempZip);
  }
});
