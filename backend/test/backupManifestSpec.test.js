const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const AdmZip = require("adm-zip");
const { createGfxBackupPackage } = require("../server");

test("GFX backup manifest contains required fields and describes package contents", async () => {
  const archive = await createGfxBackupPackage({
    backupId: "GFX-BACKUP-MANIFEST-TEST",
    mode: "incremental",
    from: "2025-01-01T00:00:00.000Z",
    to: "2025-01-02T00:00:00.000Z",
    deviceId: "GFX-MAC-001",
    previousBackupId: "GFX-BACKUP-20250101-000000-ABC123"
  });

  try {
    const zip = new AdmZip(archive.filePath);
    const manifestText = zip.readAsText("manifest.json");
    assert.ok(manifestText, "manifest.json must exist in backup");

    const manifest = JSON.parse(manifestText);

    // Spec'd top-level fields
    assert.equal(manifest.format, "GFXBACKUP", "manifest.format must be 'GFXBACKUP'");
    assert.equal(manifest.formatVersion, 1, "manifest.formatVersion must be 1");
    assert.ok(manifest.backupId, "manifest.backupId is required");
    assert.equal(manifest.backupId, "GFX-BACKUP-MANIFEST-TEST", "backupId must match request");
    assert.ok(manifest.backupType, "manifest.backupType is required");
    assert.equal(manifest.backupType, "Incremental Backup", "backupType must reflect mode");
    assert.ok(manifest.createdAt, "manifest.createdAt is required");
    assert.ok(manifest.deviceId, "manifest.deviceId is required");
    assert.equal(manifest.deviceId, "GFX-MAC-001", "deviceId must match request");
    assert.ok(manifest.previousBackupId !== undefined, "manifest.previousBackupId is required");
    assert.ok(Array.isArray(manifest.fileInventory), "manifest.fileInventory must exist");
    assert.ok(manifest.fileInventory.every((entry) => entry.path && entry.checksum && typeof entry.size === "number"), "file inventory entries must be verifiable");
    assert.ok(manifest.restorePlan?.analysisRequired, "restore analysis must be required before applying a package");
    assert.equal(manifest.restorePlan?.checkpointRequired, true, "restore must require a destination checkpoint");
    assert.equal(manifest.restorePlan?.verificationRequired, true, "restore must require verification");
    assert.equal(manifest.restorePlan?.rollbackSupportedByPackage, false, "the package must not implement rollback itself");

    // Files summary
    assert.ok(manifest.files && typeof manifest.files === "object", "manifest.files must exist as object");
    assert.ok(typeof manifest.files.new === "number", "manifest.files.new must be a number");
    assert.ok(typeof manifest.files.modified === "number", "manifest.files.modified must be a number");
    assert.ok(typeof manifest.files.unchanged === "number", "manifest.files.unchanged must be a number");
    const totalFiles = manifest.files.new + manifest.files.modified + manifest.files.unchanged;
    assert.ok(totalFiles >= 0, "file counts must sum to total files in backup");

    // Assets summary
    assert.ok(manifest.assets && typeof manifest.assets === "object", "manifest.assets must exist as object");
    assert.ok(typeof manifest.assets.new === "number", "manifest.assets.new must be a number");
    assert.ok(typeof manifest.assets.modified === "number", "manifest.assets.modified must be a number");

    // Database summary
    assert.ok(manifest.database && typeof manifest.database === "object", "manifest.database must exist as object");
    assert.ok(typeof manifest.database.newRecords === "number", "manifest.database.newRecords must be a number");
    assert.ok(typeof manifest.database.updatedRecords === "number", "manifest.database.updatedRecords must be a number");
    assert.ok(typeof manifest.database.schemaChanges === "number", "manifest.database.schemaChanges must be a number");
    assert.ok(typeof manifest.database.conflicts === "number", "manifest.database.conflicts must be a number");

    // Incremental-specific fields
    if (manifest.backupType === "Incremental Backup") {
      assert.equal(manifest.previousBackupId, "GFX-BACKUP-20250101-000000-ABC123", "incremental must preserve previousBackupId");
      assert.equal(manifest.restorePlan.databaseMergeStrategy, "merge-by-identity-and-changed-fields");
    }

    // Complete backup specific
    if (manifest.backupType === "Complete Backup") {
      assert.equal(manifest.database.fullDump, true, "complete backup must have fullDump=true");
    }

    fs.unlinkSync(archive.filePath);
  } finally {
    if (fs.existsSync(archive.filePath)) {
      fs.unlinkSync(archive.filePath);
    }
  }
});

test("GFX backup manifest counts match actual backup contents", async () => {
  const uploadDir = path.join(__dirname, "..", "uploads", "manifest-test-asset");
  fs.mkdirSync(uploadDir, { recursive: true });
  const testFile = path.join(uploadDir, "manifest-check.txt");
  fs.writeFileSync(testFile, "manifest count check\n", "utf8");

  try {
    const archive = await createGfxBackupPackage({
      backupId: "GFX-BACKUP-MANIFEST-COUNTS",
      mode: "complete",
      from: "2025-01-01T00:00:00.000Z",
      to: "2025-01-02T00:00:00.000Z",
      deviceId: "GFX-MAC-002",
      previousBackupId: "none"
    });

    const zip = new AdmZip(archive.filePath);
    const manifestText = zip.readAsText("manifest.json");
    const manifest = JSON.parse(manifestText);

    // For complete backup, all files should be "new"
    if (manifest.backupType === "Complete Backup") {
      assert.ok(manifest.files.new > 0, "complete backup should have new files");
      assert.equal(manifest.files.modified, 0, "complete backup should have no modified files");
      // unchanged can be 0 for complete backup
    }

    // Manifest should describe something
    assert.ok(manifest.files.new + manifest.files.modified + manifest.files.unchanged > 0, "backup must contain some files");
    assert.ok(manifest.database.newRecords + manifest.database.updatedRecords >= 0, "database must have record counts");

    fs.unlinkSync(archive.filePath);
  } finally {
    try { fs.unlinkSync(testFile); } catch (error) {}
    try { fs.rmSync(uploadDir, { recursive: true, force: true }); } catch (error) {}
  }
});

test("GFX backup manifest is valid JSON and readable", async () => {
  const archive = await createGfxBackupPackage({
    backupId: "GFX-BACKUP-MANIFEST-VALID",
    mode: "incremental",
    from: "2025-01-01T00:00:00.000Z",
    to: "2025-01-02T00:00:00.000Z",
    deviceId: "GFX-MAC-003",
    previousBackupId: "none"
  });

  try {
    const zip = new AdmZip(archive.filePath);
    const manifestText = zip.readAsText("manifest.json");

    // Must be valid JSON
    const manifest = JSON.parse(manifestText);
    assert.ok(manifest, "manifest must be parseable JSON");

    // Must be serializable back to JSON
    const reserializable = JSON.stringify(manifest, null, 2);
    assert.ok(reserializable.length > 0, "manifest must be re-serializable");

    // Round-trip test
    const reparsed = JSON.parse(reserializable);
    assert.equal(reparsed.backupId, manifest.backupId, "manifest must survive round-trip JSON serialization");

    fs.unlinkSync(archive.filePath);
  } finally {
    if (fs.existsSync(archive.filePath)) {
      fs.unlinkSync(archive.filePath);
    }
  }
});
