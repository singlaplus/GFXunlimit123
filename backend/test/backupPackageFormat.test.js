const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const AdmZip = require("adm-zip");
const os = require("node:os");
const { createGfxBackupPackage, validateBackupPrerequisites } = require("../server");

test("GFX backup packages use a structured ZIP layout and omit junk paths", async () => {
  const archive = await createGfxBackupPackage({
    backupId: "GFX-BACKUP-PACKAGE-FORMAT",
    mode: "Incremental Backup",
    from: "2025-01-01T00:00:00.000Z",
    to: "2025-01-02T00:00:00.000Z",
    deviceId: "GFX-MAC-001",
    previousBackupId: "none"
  });

  assert.ok(archive.filePath.endsWith(".gfxbackup"));

  const zip = new AdmZip(archive.filePath);
  const entries = zip.getEntries().map((entry) => entry.entryName);

  assert.ok(entries.includes("manifest.json"));
  assert.ok(entries.includes("package.json"));
  assert.ok(entries.includes("checksums.json"));
  assert.ok(entries.some((entry) => entry.startsWith("application/")));
  assert.ok(entries.some((entry) => entry.startsWith("metadata/")));
  assert.ok(entries.some((entry) => entry.startsWith("database/")));
  assert.ok(entries.some((entry) => entry.startsWith("assets/")));

  const assetPath = path.join(__dirname, "..", "uploads", "backup-asset-test", "2026", "08", "Pending", "asset-original.png");
  const thumbnailPath = path.join(__dirname, "..", "uploads", "backup-asset-test", "2026", "08", "Pending", "thumbnails", "asset-original-thumb.jpg");
  const previewPath = path.join(__dirname, "..", "uploads", "backup-asset-test", "2026", "08", "Pending", "previews", "asset-original-preview.jpg");

  fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
  fs.mkdirSync(path.dirname(previewPath), { recursive: true });
  fs.writeFileSync(assetPath, "asset package check\n", "utf8");
  fs.writeFileSync(thumbnailPath, "thumb package check\n", "utf8");
  fs.writeFileSync(previewPath, "preview package check\n", "utf8");

  const archive2 = await createGfxBackupPackage({
    backupId: "GFX-BACKUP-ASSET-PATHS",
    mode: "Incremental Backup",
    from: "2025-01-01T00:00:00.000Z",
    to: "2025-01-02T00:00:00.000Z",
    deviceId: "GFX-MAC-001",
    previousBackupId: "none"
  });
  const zip2 = new AdmZip(archive2.filePath);
  const assetEntries = zip2.getEntries().map((entry) => entry.entryName);
  assert.ok(assetEntries.some((entry) => entry.includes("assets/backend/uploads/backup-asset-test/2026/08/Pending/asset-original.png")));
  assert.ok(assetEntries.some((entry) => entry.includes("assets/backend/uploads/backup-asset-test/2026/08/Pending/thumbnails/asset-original-thumb.jpg")));
  assert.ok(assetEntries.some((entry) => entry.includes("assets/backend/uploads/backup-asset-test/2026/08/Pending/previews/asset-original-preview.jpg")));

  fs.unlinkSync(assetPath);
  fs.unlinkSync(thumbnailPath);
  fs.unlinkSync(previewPath);
  fs.rmSync(path.join(__dirname, "..", "uploads", "backup-asset-test"), { recursive: true, force: true });
  fs.unlinkSync(archive2.filePath);

  assert.ok(!entries.some((entry) => entry.includes("node_modules")));
  assert.ok(!entries.some((entry) => entry.includes(".git")));
  assert.ok(!entries.some((entry) => entry.includes("tmp/") || entry.includes("/tmp/")));
  assert.ok(!entries.some((entry) => entry.includes("backup/")));
  assert.ok(!entries.some((entry) => entry.includes("logs") || entry.includes("cache")));

  const packageManifest = JSON.parse(zip.readAsText("package.json"));
  assert.equal(packageManifest.packageType, "gfxbackup");
  assert.equal(packageManifest.schemaVersion, "1.0");
  assert.equal(packageManifest.mode, "Incremental Backup");

  fs.unlinkSync(archive.filePath);
});

test("GFX backup packages exclude .env credentials when present", async () => {
  const projectRoot = path.join(__dirname, "..", "..");
  const envPath = path.join(projectRoot, ".env");
  const backupEnv = "JWT_SECRET=backup-secret\nDATABASE_PASSWORD=backup-pass\nSMTP_PASSWORD=smtp-secret\n";
  const original = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : null;

  try {
    fs.writeFileSync(envPath, backupEnv, "utf8");

    const archive = await createGfxBackupPackage({
      backupId: "GFX-BACKUP-ENV-TEST",
      mode: "complete",
      from: "2025-01-01T00:00:00.000Z",
      to: "2025-01-02T00:00:00.000Z",
      deviceId: "GFX-MAC-001",
      previousBackupId: "none"
    });

    const zip = new AdmZip(archive.filePath);
    const entries = zip.getEntries().map((entry) => entry.entryName);
    assert.ok(!entries.includes(".env"), "backup package must not include the root .env file");

    fs.unlinkSync(archive.filePath);
  } finally {
    if (original === null) {
      try { fs.unlinkSync(envPath); } catch (error) {}
    } else {
      fs.writeFileSync(envPath, original, "utf8");
    }
  }
});

test("GFX backup packages generate real SHA-256 checksums for packaged files", async () => {
  const archive = await createGfxBackupPackage({
    backupId: "GFX-BACKUP-CHECKSUM-TEST",
    mode: "Incremental Backup",
    from: "2025-01-01T00:00:00.000Z",
    to: "2025-01-02T00:00:00.000Z",
    deviceId: "GFX-MAC-001",
    previousBackupId: "none"
  });

  const zip = new AdmZip(archive.filePath);
  const checksums = JSON.parse(zip.readAsText("checksums.json"));
  assert.ok(checksums && Object.keys(checksums).length > 0, "checksums.json should contain entries");
  assert.ok(typeof checksums["manifest.json"] === "string", "manifest checksum should exist");
  assert.match(checksums["manifest.json"], /^[a-f0-9]{64}$/i, "manifest checksum should be a real SHA-256 hash");
  assert.equal(checksums["manifest.json"], crypto.createHash("sha256").update(zip.readAsText("manifest.json")).digest("hex"));
  assert.ok(!Object.values(checksums).includes("generated-at-runtime"), "placeholder checksum values should be replaced with real hashes");

  fs.unlinkSync(archive.filePath);
});

test("GFX backup validation fails fast with an exact error before creating a backup", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gfx-backup-validation-"));
  try {
    await assert.rejects(
      () => validateBackupPrerequisites({
        projectRoot: tempRoot,
        skipDatabase: true,
        skipSyncMetadata: true,
        diskSpaceAvailableBytes: 1024
      }),
      /Required folder missing: backend|Disk space validation failed:/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
