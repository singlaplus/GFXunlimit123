require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const pool = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require('crypto');
const AdmZip = require("adm-zip");
const axios = require("axios");
const sharp = require("sharp");
const { sendMail } = require("./email/mailer");
const { normalizeRecipients, resolveNotificationEventKey, buildNotificationEmailContent } = require("./email/notificationRules");
const { createMessagingRouter, createAssetNotifications, createCouponNotifications, createDirectMessage, recordEvent, recordBusinessEvent, publishEvent } = require("./messaging");
const { buildMyUploadsQuery } = require("./myUploadsQuery");
const { applyCatalogFilters } = require("./imageQuery");
const { registerOrderRoutes } = require("./orders");
const { summarizeContributorDownloadWindowCounts, summarizeContributorUploadWindowCounts } = require("./dashboardStats");
const thumbnailQueue = require("./thumbnail-queue-worker");
const ProcessorDetector = require("./thumbnail-engine/processor-detector");
const adminThumbnailRoutes = require("./routes/admin-thumbnail-routes");
const restoreRoutes = require("./routes/restore-routes");
const processorFactory = require("./thumbnail-engine/processor-factory");
const {
  buildOptionalThumbnailName,
  getPublicThumbnailUrl,
  getThumbnailStorageDirectory,
  buildGeneratedThumbnailPath,
  getOptionalThumbnailQuality,
  createWatermarkedOptionalThumbnail,
} = require("./utils/assetThumbnail");

const app = express();
const BACKUP_ROOT = path.join(__dirname, "backup");
const JWT_SECRET = process.env.JWT_SECRET || "secretkey";
const LEGACY_JWT_SECRET = "secretkey";

async function invalidateSessionsOnStartup() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query("DELETE FROM auth_sessions");
  console.log("All existing authentication sessions invalidated on startup.");
}

function verifyJwtToken(token) {
  const secrets = Array.from(new Set([JWT_SECRET, LEGACY_JWT_SECRET].filter(Boolean)));
  let lastError = null;

  for (const secret of secrets) {
    try {
      return jwt.verify(token, secret);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Invalid token");
}

function signJwtToken(payload, options = {}) {
  return jwt.sign(payload, JWT_SECRET || LEGACY_JWT_SECRET, options);
}

function ensureBackupDirectory(date = new Date(), backupMode = "incremental") {
  const modeDirectory = backupMode === "complete" ? "complete" : "incremental";
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const directory = path.join(BACKUP_ROOT, modeDirectory, year, month, day);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function buildUniqueBackupId(date = new Date()) {
  const stamp = new Date(date);
  const year = stamp.getUTCFullYear();
  const month = String(stamp.getUTCMonth() + 1).padStart(2, "0");
  const day = String(stamp.getUTCDate()).padStart(2, "0");
  const hours = String(stamp.getUTCHours()).padStart(2, "0");
  const minutes = String(stamp.getUTCMinutes()).padStart(2, "0");
  const seconds = String(stamp.getUTCSeconds()).padStart(2, "0");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `GFX-BACKUP-${year}${month}${day}-${hours}${minutes}${seconds}-${suffix}`;
}

function buildBackupArchiveFile(date = new Date(), backupMode = "incremental") {
  const directory = ensureBackupDirectory(date, backupMode);
  const stamp = new Date(date);
  const year = stamp.getUTCFullYear();
  const month = String(stamp.getUTCMonth() + 1).padStart(2, "0");
  const day = String(stamp.getUTCDate()).padStart(2, "0");
  const hours = String(stamp.getUTCHours()).padStart(2, "0");
  const minutes = String(stamp.getUTCMinutes()).padStart(2, "0");
  const seconds = String(stamp.getUTCSeconds()).padStart(2, "0");
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  const fileName = `GFX_BACKUP_${year}-${month}-${day}_${hours}${minutes}${seconds}_${suffix}.gfxbackup`;
  const filePath = path.join(directory, fileName);

  if (fs.existsSync(filePath)) {
    return buildBackupArchiveFile(new Date(stamp.getTime() + 1000), backupMode);
  }

  return { directory, fileName, filePath, uniqueId: buildUniqueBackupId(stamp) };
}

function resolveBackupArchivePath(requestedFile) {
  if (typeof requestedFile !== "string" || !requestedFile.trim()) {
    return { error: "Missing backup file path" };
  }

  let safeRelativePath = requestedFile.replace(/\\/g, "/").replace(/^\/+/, "");
  safeRelativePath = safeRelativePath.replace(/^backend\/backup\//, "").replace(/^backup\//, "");
  const absolutePath = path.resolve(BACKUP_ROOT, safeRelativePath);
  const relativeToBackupRoot = path.relative(BACKUP_ROOT, absolutePath).split(path.sep).join("/");
  const firstPathSegment = relativeToBackupRoot.split("/")[0];

  if (!relativeToBackupRoot || relativeToBackupRoot.startsWith("../") || relativeToBackupRoot === ".." || !["incremental", "complete"].includes(firstPathSegment)) {
    return { error: "Invalid backup path" };
  }
  if (!relativeToBackupRoot.endsWith(".gfxbackup")) {
    return { error: "Invalid backup archive" };
  }

  try {
    const realBackupRoot = fs.realpathSync(BACKUP_ROOT);
    const realArchivePath = fs.realpathSync(absolutePath);
    const realRelativePath = path.relative(realBackupRoot, realArchivePath);
    if (!realRelativePath || realRelativePath.startsWith("..") || path.isAbsolute(realRelativePath) || fs.lstatSync(absolutePath).isSymbolicLink()) {
      return { error: "Invalid backup path" };
    }
  } catch (error) {
    return { error: "Invalid backup path" };
  }

  return { absolutePath, relativePath: relativeToBackupRoot };
}

function enforceBackupRetention() {
  const configuredLimit = Number.parseInt(process.env.BACKUP_RETENTION_COUNT || "30", 10);
  const retentionLimit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 30;
  if (!fs.existsSync(BACKUP_ROOT)) return;

  const backupFiles = fs.readdirSync(BACKUP_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".gfxbackup"))
    .map((entry) => {
      const filePath = path.join(entry.parentPath || BACKUP_ROOT, entry.name);
      return { filePath, modifiedAt: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  backupFiles.slice(retentionLimit).forEach(({ filePath }) => {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.warn("Failed to remove expired backup archive", filePath, error.message || error);
    }
  });
}

function stableHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizeDeviceId(deviceId) {
  const candidate = typeof deviceId === "string" ? deviceId.trim() : "";
  if (/^GFX-(MAC|PC1|LINUX|DEVICE)-\d{3}$/i.test(candidate)) {
    return candidate;
  }

  const platform = process.platform === "darwin" ? "MAC" : process.platform === "win32" ? "PC1" : process.platform === "linux" ? "LINUX" : "DEVICE";
  const suffix = String(Math.floor(Math.random() * 900 + 100));
  return `GFX-${platform}-${suffix}`;
}

async function validateBackupArchive(filePath) {
  const errors = [];
  const resolvedPath = typeof filePath === "string" && filePath.trim()
    ? path.isAbsolute(filePath) ? filePath : path.resolve(getProjectRoot(), filePath)
    : null;

  if (!resolvedPath) {
    return { valid: false, errors: ["Missing backup archive path"] };
  }

  if (!fs.existsSync(resolvedPath)) {
    return { valid: false, errors: [`Backup archive not found: ${resolvedPath}`] };
  }

  if (!resolvedPath.toLowerCase().endsWith(".gfxbackup")) {
    errors.push("Backup archive must use the .gfxbackup extension");
  }

  try {
    const zip = new AdmZip(resolvedPath);
    const entries = zip.getEntries().map((entry) => entry.entryName);
    const requiredEntries = ["manifest.json", "package.json", "checksums.json"];

    for (const entryName of requiredEntries) {
      if (!entries.includes(entryName)) {
        errors.push(`Backup package is missing required entry: ${entryName}`);
      }
    }

    const manifestEntry = zip.getEntry("manifest.json");
    if (manifestEntry) {
      try {
        const manifest = JSON.parse(zip.readAsText(manifestEntry));
        if (!manifest || manifest.format !== "GFXBACKUP") {
          errors.push("Manifest is missing the required GFXBACKUP format header");
        }
      } catch (parseError) {
        errors.push(`Manifest is corrupted or unreadable: ${parseError.message || parseError}`);
      }
    }

    const checksumEntry = zip.getEntry("checksums.json");
    if (checksumEntry) {
      try {
        const checksumMap = JSON.parse(zip.readAsText(checksumEntry));
        for (const [entryName, expectedHash] of Object.entries(checksumMap || {})) {
          const zipEntry = zip.getEntry(entryName);
          if (!zipEntry) {
            errors.push(`Checksum references missing file: ${entryName}`);
            continue;
          }
          const actualHash = crypto.createHash("sha256").update(zipEntry.getData()).digest("hex");
          if (actualHash !== expectedHash) {
            errors.push(`Checksum mismatch for ${entryName}`);
          }
        }
      } catch (parseError) {
        errors.push(`Checksum file is corrupted or unreadable: ${parseError.message || parseError}`);
      }
    }
  } catch (error) {
    errors.push(`Backup archive is unreadable or corrupted: ${error.message || error}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    filePath: resolvedPath
  };
}

function normalizeBackupDateRange(fromDate, toDate, now = new Date()) {
  const currentDate = now.toISOString().slice(0, 10);
  const normalizedFromDate = String(fromDate || currentDate).slice(0, 10);
  const rawToDate = String(toDate || currentDate);
  const normalizedToDate = rawToDate.slice(0, 10);
  const hasTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(rawToDate);

  return {
    from: `${normalizedFromDate}T00:00:00.000Z`,
    to: hasTimestamp ? new Date(rawToDate).toISOString() : normalizedToDate === currentDate ? now.toISOString() : `${normalizedToDate}T23:59:59.999Z`
  };
}

function classifyBackupPath(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (!normalized || normalized === ".") return "application";
  if (normalized === "package.json" || normalized === "setup.js" || normalized === "setup.sh" || normalized.startsWith("backend/") || normalized.startsWith("frontend/") || normalized.startsWith("GFX-Aanav/") || normalized.startsWith("scripts/") || normalized.startsWith("database/") || normalized.startsWith("config/")) {
    return "application";
  }
  if (normalized.includes("/uploads/") || normalized.includes("/assets/") || normalized.includes("/thumbnails/") || normalized.includes("/previews/") || normalized.includes("/images/")) {
    return "assets";
  }
  if (normalized.includes("/database/") || normalized.includes("/migrations/") || normalized.endsWith(".sql") || normalized.includes("database-")) {
    return "database";
  }
  if (normalized.includes("/metadata/") || normalized.includes("device") || normalized.includes("version") || normalized.includes("sync")) {
    return "metadata";
  }
  return "application";
}

function getProjectRoot() {
  return path.resolve(__dirname, "..");
}

async function validateBackupPrerequisites(options = {}) {
  const projectRoot = options.projectRoot || getProjectRoot();
  const minFreeDiskBytes = typeof options.diskSpaceAvailableBytes === "number"
    ? options.diskSpaceAvailableBytes
    : 50 * 1024 * 1024;
  const requiredDirectories = [
    path.join(projectRoot, "backend"),
    path.join(projectRoot, "frontend"),
    path.join(projectRoot, "backend", "uploads"),
    path.join(projectRoot, "backend", "backup")
  ];
  const requiredFiles = [
    path.join(projectRoot, "package.json"),
    path.join(projectRoot, "backend", "server.js"),
    path.join(projectRoot, "backend", "db.js")
  ];
  const errors = [];

  for (const dirPath of requiredDirectories) {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      errors.push(`Required folder missing: ${path.relative(projectRoot, dirPath) || path.basename(dirPath)}`);
    }
  }

  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      errors.push(`Required file missing: ${path.relative(projectRoot, filePath) || path.basename(filePath)}`);
    }
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    if (!packageJson || !packageJson.version || typeof packageJson.version !== "string") {
      throw new Error("Application version missing or invalid");
    }
  } catch (error) {
    errors.push(`Application version validation failed: ${error.message || "package.json missing or unreadable"}`);
  }

  if (!options.skipDatabase) {
    try {
      await pool.query("SELECT 1");
    } catch (error) {
      errors.push(`Database connection validation failed: ${error.message || "Database unavailable"}`);
    }

    try {
      const result = await pool.query("SELECT COUNT(*)::int AS table_count FROM information_schema.tables WHERE table_schema = 'public'");
      const tableCount = Number(result.rows?.[0]?.table_count || 0);
      if (!tableCount) {
        errors.push("Database integrity validation failed: no public tables were found");
      }
    } catch (error) {
      errors.push(`Database integrity validation failed: ${error.message || "Unable to inspect schema"}`);
    }
  }

  if (!options.skipSyncMetadata) {
    try {
      const result = await pool.query("SELECT to_regclass('public.gfx_sync_changes') AS sync_table");
      if (!result.rows?.[0]?.sync_table) {
        errors.push("Existing sync metadata validation failed: public.gfx_sync_changes table is missing");
      }
    } catch (error) {
      errors.push(`Existing sync metadata validation failed: ${error.message || "Unable to inspect sync metadata"}`);
    }
  }

  const uploadPath = path.join(projectRoot, "backend", "uploads");
  if (fs.existsSync(uploadPath) && fs.statSync(uploadPath).isDirectory()) {
    const assetPaths = [
      uploadPath,
      path.join(projectRoot, "frontend", "src"),
      path.join(projectRoot, "backend")
    ];
    for (const assetPath of assetPaths) {
      if (!fs.existsSync(assetPath)) {
        errors.push(`Asset path validation failed: ${path.relative(projectRoot, assetPath) || path.basename(assetPath)} is missing`);
      }
    }
  } else {
    errors.push("Asset path validation failed: backend/uploads is missing");
  }

  try {
    const stats = fs.statfsSync(projectRoot);
    const availableBytes = Number(stats.bavail || 0) * Number(stats.bsize || 4096);
    if (availableBytes < minFreeDiskBytes) {
      errors.push(`Disk space validation failed: only ${Math.round(availableBytes / (1024 * 1024))} MB available; at least ${Math.round(minFreeDiskBytes / (1024 * 1024))} MB required`);
    }
  } catch (error) {
    errors.push(`Disk space validation failed: ${error.message || "Unable to read disk stats"}`);
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  return { valid: true, projectRoot };
}

function collectRelevantBackupPaths(includeUploads = false, projectRoot = getProjectRoot()) {
  const root = projectRoot || getProjectRoot();
  const roots = [
    path.join(root, "backend"),
    path.join(root, "frontend", "src"),
    path.join(root, "frontend", "public"),
    path.join(root, "package.json"),
    path.join(root, "setup.js"),
    path.join(root, "setup.sh"),
    path.join(root, "GFX-Aanav", "config"),
    path.join(root, "GFX-Aanav", "core")
  ];

  if (includeUploads) {
    roots.push(path.join(projectRoot, "backend", "uploads"));
  }

  return roots.filter(Boolean);
}

function isIgnoredBackupPath(relativePath, includeUploads = false) {
  const ignoredSegments = ["node_modules", "build", "dist", "coverage", ".git", "backup", "tmp", "dump.rdb"];
  if (!includeUploads) {
    ignoredSegments.push("uploads");
  }

  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const isEnvCredentialFile = normalized === ".env" || /^\.env(\..+)?$/.test(normalized);

  return /(^|\/)(node_modules|build|dist|coverage|\.git|backup|tmp|dump\.rdb)(?:\/|$)/.test(normalized)
    || (!includeUploads && /(^|\/)(uploads)(?:\/|$)/.test(normalized))
    || (!isEnvCredentialFile && normalized.startsWith(".env"))
    || normalized.includes(".log");
}

function collectAllProjectFilesForBackup(roots = collectRelevantBackupPaths(true), projectRoot = getProjectRoot()) {
  const root = projectRoot || getProjectRoot();
  const matches = new Set();

  const walk = (scanPath) => {
    if (!scanPath || !fs.existsSync(scanPath)) return;

    const stats = fs.lstatSync(scanPath);
    if (stats.isSymbolicLink()) return;
    if (stats.isFile()) {
      const relative = path.relative(projectRoot, scanPath).split(path.sep).join("/");
      if (!isIgnoredBackupPath(relative, true)) {
        matches.add(relative);
      }
      return;
    }

    for (const entry of fs.readdirSync(scanPath, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "build" || entry.name === "dist" || entry.name === "coverage" || entry.name === "tmp" || entry.name === "backup") continue;
      if (entry.name === "uploads" && !true) continue;
      const fullPath = path.join(scanPath, entry.name);
      walk(fullPath);
    }
  };

  for (const root of roots) {
    walk(root);
  }

  return Array.from(matches).sort();
}

function stableChecksumForFile(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(buffer).digest("hex");
  } catch (error) {
    return null;
  }
}

const projectBackupSnapshotCache = new Map();

function buildProjectSnapshotMap(projectRoot = getProjectRoot()) {
  const root = path.resolve(projectRoot || getProjectRoot());
  const snapshot = {};

  const walk = (scanPath) => {
    if (!scanPath || !fs.existsSync(scanPath)) return;

    const stats = fs.lstatSync(scanPath);
    if (stats.isSymbolicLink()) return;
    if (stats.isFile()) {
      const relative = path.relative(root, scanPath).split(path.sep).join("/");
      if (!relative || isIgnoredBackupPath(relative, true)) {
        return;
      }
      snapshot[relative] = {
        relativePath: relative,
        fileSize: stats.size,
        modifiedAt: new Date(stats.mtimeMs).toISOString(),
        checksum: stableChecksumForFile(scanPath),
        status: "known",
        projectRoot: root
      };
      return;
    }

    for (const entry of fs.readdirSync(scanPath, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "build" || entry.name === "dist" || entry.name === "coverage" || entry.name === "tmp" || entry.name === "backup") continue;
      walk(path.join(scanPath, entry.name));
    }
  };

  walk(root);
  return snapshot;
}

function rememberProjectSnapshot(projectRoot = getProjectRoot(), snapshot = null) {
  const root = path.resolve(projectRoot || getProjectRoot());
  const nextSnapshot = snapshot || buildProjectSnapshotMap(root);
  projectBackupSnapshotCache.set(root, nextSnapshot);
  return nextSnapshot;
}

function getProjectSnapshot(projectRoot = getProjectRoot()) {
  const root = path.resolve(projectRoot || getProjectRoot());
  if (!projectBackupSnapshotCache.has(root)) {
    rememberProjectSnapshot(root, buildProjectSnapshotMap(root));
  }
  return projectBackupSnapshotCache.get(root) || {};
}

function assetKeyFromRelativePath(currentFile) {
  const relativePath = String(currentFile || "").replace(/\\/g, "/");
  const uploadsIndex = relativePath.indexOf("/uploads/");
  if (uploadsIndex === -1) return "";

  const remainder = relativePath.slice(uploadsIndex + "/uploads/".length).split("/").filter(Boolean);
  if (!remainder.length) return "";

  const filtered = remainder.filter((segment) => !["thumbnails", "previews", "generated"].includes(segment));
  const candidateSegments = filtered.length ? filtered : remainder;
  const base = candidateSegments.slice(0, 2).join("/");
  return base ? base.replace(/\/[^/]+$/, "") : "";
}

function buildFileIdentitySnapshot(filePath, relativePath, projectRoot = getProjectRoot()) {
  try {
    const stat = fs.statSync(filePath);
    return {
      relativePath,
      fileSize: stat.size,
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
      checksum: stableChecksumForFile(filePath),
      status: "unknown",
      projectRoot
    };
  } catch (error) {
    return null;
  }
}

function collectFileChangeStatusReport(liveFiles = [], previousSnapshot = {}, options = {}) {
  const results = [];
  const summary = { NEW: 0, MODIFIED: 0, UNCHANGED: 0 };
  const root = options.projectRoot || getProjectRoot();

  for (const entry of liveFiles) {
    const relativePath = entry.relativePath || path.relative(root, entry.absolutePath || entry.filePath || "").split(path.sep).join("/");
    const currentSnapshot = buildFileIdentitySnapshot(entry.absolutePath || entry.filePath || path.join(root, relativePath), relativePath, root);
    if (!currentSnapshot) continue;

    const prior = previousSnapshot[relativePath] || null;

    let status = "NEW";
    if (prior) {
      const sameChecksum = !!(prior.checksum && currentSnapshot.checksum && prior.checksum === currentSnapshot.checksum);
      const sameSize = Number(prior.fileSize) === Number(currentSnapshot.fileSize);
      const sameTimestamp = !!(prior.modifiedAt && currentSnapshot.modifiedAt && prior.modifiedAt === currentSnapshot.modifiedAt);

      if (sameChecksum) {
        status = "UNCHANGED";
      } else if (sameSize || sameTimestamp) {
        status = "MODIFIED";
      } else {
        status = "MODIFIED";
      }
    }

    summary[status] = (summary[status] || 0) + 1;
    results.push({
      relativePath,
      status,
      fileSize: currentSnapshot.fileSize,
      modifiedAt: currentSnapshot.modifiedAt,
      checksum: currentSnapshot.checksum,
      previousChecksum: prior && prior.checksum ? prior.checksum : null,
      previousFileSize: prior && prior.fileSize ? prior.fileSize : null,
      source: entry.statusSource || options.statusSource || "live"
    });
  }

  return {
    files: results,
    summary,
    mode: "checksum-first-file-detection"
  };
}

function collectChangedFilesSince(fromIso, roots = collectRelevantBackupPaths(true), options = {}) {
  if (!fromIso) return [];
  const sinceMs = new Date(fromIso).getTime();
  const untilMs = options.to ? new Date(options.to).getTime() : Number.POSITIVE_INFINITY;
  const projectRoot = options.projectRoot || getProjectRoot();
  const matches = new Set();

  const walk = (scanPath) => {
    if (!scanPath || !fs.existsSync(scanPath)) return;

    const stats = fs.lstatSync(scanPath);
    if (stats.isSymbolicLink()) return;
    if (stats.isFile()) {
      const relative = path.relative(projectRoot, scanPath).split(path.sep).join("/");
      const isIgnored = isIgnoredBackupPath(relative, true);
      if (!isIgnored && stats.mtimeMs >= sinceMs && stats.mtimeMs <= untilMs) {
        matches.add(relative);
      }
      return;
    }

    for (const entry of fs.readdirSync(scanPath, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "build" || entry.name === "dist" || entry.name === "coverage" || entry.name === "tmp" || entry.name === "backup") continue;
      const fullPath = path.join(scanPath, entry.name);
      walk(fullPath);
    }
  };

  for (const root of roots) {
    walk(root);
  }

  return Array.from(matches).sort();
}

async function collectIdentityColumns(tableName) {
  const pkResult = await pool.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = 'public'
       AND tc.table_name = $1
       AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
     ORDER BY kcu.ordinal_position`,
    [tableName]
  );

  return (pkResult.rows || []).map((row) => row.column_name).filter(Boolean);
}

async function collectDatabaseChangeMetadata(fromIso, toIso) {
  const result = {
    fullDump: false,
    deltaMode: "merge-safe",
    changedTables: [],
    tableSummaries: [],
    newRecords: [],
    updatedRecords: [],
    schemaChanges: [],
    migrations: [],
    recordIdentity: {},
    sync: {
      sourceWindow: {
        from: fromIso,
        to: toIso
      },
      strategy: "merge-safe-incremental",
      requiresDestinationMerge: true,
      noFullRestoreAssumption: true
    },
    sourceWindow: {
      from: fromIso,
      to: toIso
    }
  };

  try {
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
    );

    const migrationDir = path.join(__dirname, "migrations");
    if (fs.existsSync(migrationDir)) {
      const migrationFiles = fs.readdirSync(migrationDir)
        .filter((file) => file.endsWith(".sql"))
        .sort();

      result.migrations = migrationFiles.map((file) => ({
        file,
        path: `backend/migrations/${file}`,
        checksum: stableHash(fs.readFileSync(path.join(migrationDir, file), "utf8"))
      }));
    }

    const summary = [];
    for (const row of tables.rows) {
      const tableName = row.table_name;
      if (!tableName) continue;

      const columns = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [tableName]
      );
      const columnNames = columns.rows.map((column) => column.column_name);
      const timestampColumns = ["created_at", "updated_at", "modified_at", "last_updated", "changed_at", "inserted_at"];
      const createdColumn = timestampColumns.find((candidate) => columnNames.includes(candidate));
      const updatedColumn = ["updated_at", "modified_at", "last_updated", "changed_at"].find((candidate) => columnNames.includes(candidate));
      const identityColumns = await collectIdentityColumns(tableName);
      result.recordIdentity[tableName] = {
        identityColumns,
        hasStableIdentifier: identityColumns.length > 0,
        restoreCheck: identityColumns.length > 0 ? "match-on-primary-or-unique-key" : "timestamp-only-fallback"
      };

      const tableSchema = {
        tableName,
        columns: columns.rows.map((column) => ({
          name: column.column_name,
          type: column.data_type,
          nullable: column.is_nullable === "YES",
          default: column.column_default || null
        })),
        identityColumns
      };
      result.schemaChanges.push(tableSchema);

      if (!createdColumn && !updatedColumn) {
        summary.push({ tableName, changedRows: 0, timestampColumn: null, note: "No timestamp column detected" });
        continue;
      }

      const newRows = createdColumn && createdColumn !== updatedColumn
        ? (await pool.query(`SELECT * FROM "${tableName}" WHERE "${createdColumn}" >= $1 AND "${createdColumn}" <= $2`, [fromIso, toIso])).rows || []
        : [];
      const updatedRows = updatedColumn
        ? (await pool.query(`SELECT * FROM "${tableName}" WHERE "${updatedColumn}" >= $1 AND "${updatedColumn}" <= $2`, [fromIso, toIso])).rows || []
        : [];

      const attachIdentity = (record, operation = "UPDATE") => {
        const allColumnNames = Object.keys(record || {});
        const keyColumns = identityColumns || [];
        const changedFieldNames = [...new Set(allColumnNames.filter((columnName) => {
          if (!columnName || keyColumns.includes(columnName)) return false;
          if (columnName === "created_at" && operation === "UPDATE") return false;
          return true;
        }))];

        if (!identityColumns.length) {
          return {
            ...record,
            operation,
            changedFields: changedFieldNames,
            __recordIdentity: { tableName, keyColumns: [], keyValues: {}, hasStableId: false }
          };
        }

        const keyValues = {};
        for (const columnName of identityColumns) {
          keyValues[columnName] = record[columnName];
        }

        return {
          ...record,
          operation,
          changedFields: changedFieldNames,
          __recordIdentity: {
            tableName,
            keyColumns: identityColumns,
            keyValues,
            hasStableId: true,
            recordKey: identityColumns.map((columnName) => `${columnName}:${record[columnName] ?? "null"}`).join("|")
          }
        };
      };

      const totalChangedRows = newRows.length + updatedRows.length;
      summary.push({
        tableName,
        changedRows: totalChangedRows,
        timestampColumn: updatedColumn || createdColumn,
        createdColumn,
        updatedColumn,
        newRecordCount: newRows.length,
        updatedRecordCount: updatedRows.length,
        identityColumns
      });

      if (newRows.length > 0) {
        result.newRecords.push({ tableName, recordCount: newRows.length, identityColumns, rows: newRows.map((row) => attachIdentity(row, "INSERT")) });
      }
      if (updatedRows.length > 0) {
        const uniqueUpdatedRows = updatedRows.filter((row, index, arr) => {
          if (!identityColumns.length) return true;
          const key = identityColumns.map((columnName) => `${columnName}:${row[columnName] ?? "null"}`).join("|");
          return arr.findIndex((candidate) => identityColumns.every((columnName) => (candidate[columnName] ?? "null") === (row[columnName] ?? "null"))) === index;
        });

        result.updatedRecords.push({ tableName, recordCount: uniqueUpdatedRows.length, identityColumns, rows: uniqueUpdatedRows.map((row) => attachIdentity(row, "UPDATE")) });
      }
      if (totalChangedRows > 0) {
        result.changedTables.push(tableName);
      }
    }

    result.tableSummaries = summary.filter((entry) => entry.changedRows > 0);
  } catch (error) {
    result.warning = error.message || "Database change scan failed";
  }

  return result;
}

async function collectFullDatabaseSnapshot(fromIso, toIso) {
  const result = {
    fullDump: true,
    changedTables: [],
    tableSummaries: [],
    tables: [],
    sourceWindow: {
      from: fromIso,
      to: toIso
    }
  };

  try {
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
    );

    for (const row of tables.rows) {
      const tableName = row.table_name;
      if (!tableName) continue;

      const rowQuery = await pool.query(`SELECT * FROM "${tableName}"`);
      const rows = rowQuery.rows || [];
      result.changedTables.push(tableName);
      result.tables.push({
        tableName,
        rowCount: rows.length,
        rows
      });
      result.tableSummaries.push({
        tableName,
        rowCount: rows.length,
        snapshot: "full-database-export"
      });
    }
  } catch (error) {
    result.warning = error.message || "Database full snapshot failed";
  }

  return result;
}

async function createGfxBackupPackage({ backupId, mode, from, to, deviceId, previousBackupId, projectRoot }) {
  const currentProjectRoot = projectRoot || getProjectRoot();
  const explicitProjectRoot = typeof projectRoot === "string" && path.resolve(projectRoot) !== getProjectRoot();
  const skipProjectDatabaseMetadata = explicitProjectRoot;
  await validateBackupPrerequisites({ projectRoot: currentProjectRoot, skipDatabase: skipProjectDatabaseMetadata, skipSyncMetadata: skipProjectDatabaseMetadata });

  const createdAt = new Date().toISOString();
  const normalizedMode = mode === "complete" || mode === "Complete Backup" ? "Complete Backup" : "Incremental Backup";
  const normalizedFrom = from || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const normalizedTo = to || createdAt;
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const isCompleteBackup = normalizedMode === "Complete Backup";
  const backupRoots = collectRelevantBackupPaths(true, currentProjectRoot);
  const changedFiles = isCompleteBackup ? collectAllProjectFilesForBackup(backupRoots, currentProjectRoot) : collectChangedFilesSince(normalizedFrom, backupRoots, { projectRoot: currentProjectRoot, to: normalizedTo });
  const database = skipProjectDatabaseMetadata
    ? {
        fullDump: false,
        deltaMode: "merge-safe",
        changedTables: [],
        tableSummaries: [],
        newRecords: [],
        updatedRecords: [],
        schemaChanges: [],
        migrations: [],
        recordIdentity: {},
        sync: {
          sourceWindow: { from: normalizedFrom, to: normalizedTo },
          strategy: "merge-safe-incremental",
          requiresDestinationMerge: true,
          noFullRestoreAssumption: true,
          previousBackupId: previousBackupId || "none",
          deviceId: normalizedDeviceId,
          device_id: normalizedDeviceId,
          generatedAt: createdAt,
          deltaMode: "merge-safe-incremental",
          restoreStrategy: "merge-with-existing-database"
        },
        sourceWindow: { from: normalizedFrom, to: normalizedTo }
      }
    : isCompleteBackup
      ? await collectFullDatabaseSnapshot(normalizedFrom, normalizedTo)
      : await collectDatabaseChangeMetadata(normalizedFrom, normalizedTo);

  if (!isCompleteBackup) {
    database.sync = {
      ...(database.sync || {}),
      previousBackupId: previousBackupId || "none",
      deviceId: normalizedDeviceId,
      device_id: normalizedDeviceId,
      generatedAt: createdAt,
      deltaMode: "merge-safe-incremental",
      restoreStrategy: "merge-with-existing-database"
    };
  }

  const databaseCounts = {
    newRecords: (database.newRecords || []).reduce((sum, entry) => sum + (entry.recordCount || entry.rows?.length || 0), 0),
    updatedRecords: (database.updatedRecords || []).reduce((sum, entry) => sum + (entry.recordCount || entry.rows?.length || 0), 0),
    schemaChanges: (database.schemaChanges || []).length,
    conflicts: 0
  };

  const currentProjectRootKey = path.resolve(currentProjectRoot);
  const previousProjectSnapshot = projectBackupSnapshotCache.has(currentProjectRootKey)
    ? getProjectSnapshot(currentProjectRoot)
    : {};
  const assetFiles = changedFiles.filter((currentFile) => currentFile.includes("/uploads/"));
  const uniqueAssetKeys = new Set();
  const modifiedAssetKeys = new Set();

  for (const currentFile of assetFiles) {
    const assetKey = assetKeyFromRelativePath(currentFile);
    if (!assetKey) continue;

    const priorAssetFiles = Object.keys(previousProjectSnapshot).filter((relativePath) => {
      if (!relativePath.includes("/uploads/")) return false;
      return assetKeyFromRelativePath(relativePath) === assetKey;
    });

    uniqueAssetKeys.add(assetKey);
    if (projectBackupSnapshotCache.has(currentProjectRootKey) && priorAssetFiles.length > 0) {
      modifiedAssetKeys.add(assetKey);
    }
  }

  const hasDatabaseChanges = (databaseCounts.newRecords + databaseCounts.updatedRecords + (database.changedTables || []).length) > 0;
  const hasFileChanges = changedFiles.length > 0;
  const shouldCreatePackage = isCompleteBackup || hasDatabaseChanges || hasFileChanges;

  if (!shouldCreatePackage) {
    rememberProjectSnapshot(currentProjectRoot, buildProjectSnapshotMap(currentProjectRoot));
    return {
      shouldCreatePackage: false,
      summary: {
        message: "No changes found.",
        totalChanges: 0,
        newFiles: 0,
        modifiedFiles: 0,
        newAssets: 0,
        modifiedAssets: 0,
        newDatabaseRecords: 0,
        updatedDatabaseRecords: 0
      },
      filePath: undefined,
      fileName: undefined,
      relativePath: undefined,
      fileSize: 0,
      manifest: {
        format: "GFXBACKUP",
        formatVersion: 1,
        backupId,
        backupType: normalizedMode,
        createdAt,
        from: normalizedFrom,
        to: normalizedTo,
        previousBackupId: previousBackupId || "none",
        deviceId: normalizedDeviceId,
        fileInventory: [],
        restorePlan: { analysisRequired: true, compareBy: "path-and-sha256", conflictPolicy: "report-before-apply", checkpointRequired: true, verificationRequired: true, rollbackSupportedByPackage: false },
        database: { fullDump: false, deletedRecords: [], conflictPolicy: "report-before-apply", changedTables: [], tableSummaries: [] }
      },
      database,
      metadata: { backupId, createdAt, mode: normalizedMode, from: normalizedFrom, to: normalizedTo, deviceId: normalizedDeviceId, readOnly: true },
      backupId,
      mode: normalizedMode,
      from: normalizedFrom,
      to: normalizedTo,
      deviceId: normalizedDeviceId,
      previousBackupId: previousBackupId || "none",
      databaseCounts,
      assetCounts: { new: 0, modified: 0 }
    };
  }

  const backupInfo = {
    backupId,
    backupType: "gfxbackup",
    mode: normalizedMode,
    createdAt,
    from: normalizedFrom,
    to: normalizedTo,
    previousBackupId: previousBackupId || "none",
    deviceId: normalizedDeviceId,
    device_id: normalizedDeviceId,
    adminOnly: true,
    readOnly: true,
    portable: true,
    noSecrets: true,
    generatedBy: "admin-panel",
    appVersion: process.env.npm_package_version || "unknown",
    fileCount: changedFiles.length,
    database,
    isIncremental: !isCompleteBackup,
    shouldCreatePackage: true
  };

  const manifestIncludes = [
    "manifest.json",
    "package.json",
    "checksums.json",
    "application/",
    "assets/",
    "database/",
    "metadata/",
    "database-full.json",
    "metadata/device.json",
    "metadata/sync.json",
    "metadata/version.json"
  ];

  // Count file change status for complete vs incremental backup
  const fileStatusCounts = {
    new: 0,
    modified: 0,
    unchanged: 0
  };

  if (isCompleteBackup) {
    fileStatusCounts.new = changedFiles.length;
  } else {
    fileStatusCounts.new = Math.max(0, changedFiles.length - (databaseCounts.updatedRecords || 0));
    fileStatusCounts.modified = Math.max(0, (databaseCounts.updatedRecords || 0));
    fileStatusCounts.unchanged = 0;
  }

  const assetStatusCounts = {
    new: Math.max(0, uniqueAssetKeys.size - modifiedAssetKeys.size),
    modified: Math.max(0, modifiedAssetKeys.size)
  };
  const databaseSchemaFingerprint = stableHash(JSON.stringify(database.schemaChanges || database.tables?.map((table) => ({ tableName: table.tableName, rowCount: table.rowCount })) || []));

  const manifest = {
    format: "GFXBACKUP",
    formatVersion: 1,
    backupId,
    backupType: normalizedMode,
    createdAt,
    from: normalizedFrom,
    to: normalizedTo,
    previousBackupId: previousBackupId || "none",
    deviceId: normalizedDeviceId,
    adminOnly: true,
    readOnly: true,
    portable: true,
    noSecrets: true,
    includes: manifestIncludes,
    files: fileStatusCounts,
    assets: assetStatusCounts,
    fileInventory: [],
    restorePlan: {
      analysisRequired: true,
      compareBy: "path-and-sha256",
      databaseMergeStrategy: "merge-complete-source-with-existing-destination",
      conflictPolicy: "report-before-apply",
      checkpointRequired: true,
      verificationRequired: true,
      rollbackSupportedByPackage: false
    },
    database: {
      fullDump: isCompleteBackup,
      recordCount: isCompleteBackup
        ? (database.tables || []).reduce((sum, table) => sum + (table.rowCount || 0), 0)
        : databaseCounts.newRecords + databaseCounts.updatedRecords,
      ...databaseCounts,
      schemaFingerprint: databaseSchemaFingerprint,
      deletedRecords: [],
      conflictPolicy: "report-before-apply",
      changedTables: database.changedTables || [],
      tableSummaries: database.tableSummaries || []
    }
  };

  const packageManifest = {
    packageType: "gfxbackup",
    schemaVersion: "1.0",
    backupId,
    mode: normalizedMode,
    createdAt,
    from: normalizedFrom,
    to: normalizedTo,
    previousBackupId: previousBackupId || "none",
    deviceId: normalizedDeviceId,
    device_id: normalizedDeviceId,
    includes: {
      root: ["manifest.json", "package.json", "checksums.json"],
      groups: ["application", "assets", "database", "metadata"]
    }
  };

  const metadata = {
    backupId,
    createdAt,
    mode: normalizedMode,
    from: normalizedFrom,
    to: normalizedTo,
    previousBackupId: previousBackupId || "none",
    deviceId: normalizedDeviceId,
    device_id: normalizedDeviceId,
    readOnly: true,
    generatedBy: "Admin Panel Backup",
    appVersion: process.env.npm_package_version || "unknown",
    disasterRecovery: isCompleteBackup,
    incrementalMode: !isCompleteBackup
  };

  const deviceMetadata = {
    deviceId: normalizedDeviceId,
    device_id: normalizedDeviceId,
    createdAt,
    machineType: process.platform,
    nodeVersion: process.version,
    backupId
  };

  const syncMetadata = {
    backupId,
    mode: normalizedMode,
    from: normalizedFrom,
    to: normalizedTo,
    previousBackupId: previousBackupId || "none",
    deviceId: normalizedDeviceId,
    device_id: normalizedDeviceId,
    generatedAt: createdAt
  };

  const versionMetadata = {
    packageType: "gfxbackup",
    schemaVersion: "1.0",
    createdAt,
    mode: normalizedMode,
    appVersion: process.env.npm_package_version || "unknown"
  };

  const packageContent = JSON.stringify(packageManifest, null, 2);
  const metadataContent = JSON.stringify(metadata, null, 2);
  const databaseContent = JSON.stringify(database, null, 2);
  const deviceMetadataContent = JSON.stringify(deviceMetadata, null, 2);
  const syncMetadataContent = JSON.stringify(syncMetadata, null, 2);
  const versionMetadataContent = JSON.stringify(versionMetadata, null, 2);

  const archive = new AdmZip();
  archive.addFile("package.json", Buffer.from(packageContent, "utf8"));
  archive.addFile("metadata.json", Buffer.from(metadataContent, "utf8"));
  archive.addFile("application/", Buffer.alloc(0));
  archive.addFile("assets/", Buffer.alloc(0));
  archive.addFile("database/", Buffer.alloc(0));
  archive.addFile("metadata/", Buffer.alloc(0));
  archive.addFile("metadata/device.json", Buffer.from(deviceMetadataContent, "utf8"));
  archive.addFile("metadata/version.json", Buffer.from(versionMetadataContent, "utf8"));
  archive.addFile("metadata/sync.json", Buffer.from(syncMetadataContent, "utf8"));
  archive.addFile("database/metadata/database-summary.json", Buffer.from(databaseContent, "utf8"));
  if (!isCompleteBackup) {
    archive.addFile("database/changes/database-delta.json", Buffer.from(databaseContent, "utf8"));
  }
  if (isCompleteBackup) {
    archive.addFile("database-full.json", Buffer.from(databaseContent, "utf8"));
    archive.addFile("database/full/full-database.json", Buffer.from(databaseContent, "utf8"));
  }
  archive.addFile("database/changes/changes-summary.json", Buffer.from(JSON.stringify({
    backupId,
    mode: normalizedMode,
    changedTables: database.changedTables || [],
    tableSummaries: database.tableSummaries || []
  }, null, 2), "utf8"));

  for (const relativeFile of changedFiles) {
    const absolutePath = path.join(currentProjectRoot, relativeFile);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      continue;
    }

    const normalizedRelative = relativeFile.split(path.sep).join("/");
    const zipDirectory = classifyBackupPath(normalizedRelative);
    const zipPath = `${zipDirectory}/${normalizedRelative}`;
    if (zipPath.includes("node_modules/") || zipPath.includes(".git/") || zipPath.includes("/backup/") || zipPath.includes("/tmp/") || zipPath.includes("/logs/") || zipPath.includes("/cache/") || zipPath.includes(".log")) {
      continue;
    }

    // Preserve the original relative path beneath the backup group so asset
    // originals, thumbnails, previews, and generated files remain traceable to
    // their source directory instead of being flattened into duplicate names.
    const fileContent = fs.readFileSync(absolutePath);
    archive.addFile(zipPath, fileContent);
  }

  manifest.fileInventory = archive.getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => {
      const sourceRelativePath = entry.entryName.startsWith("application/") || entry.entryName.startsWith("assets/")
        ? entry.entryName.replace(/^(application|assets)\//, "")
        : null;
      const sourcePath = sourceRelativePath ? path.join(currentProjectRoot, sourceRelativePath) : null;
      const sourceStats = sourcePath && fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile() ? fs.statSync(sourcePath) : null;
      return {
        path: entry.entryName,
        status: sourceRelativePath ? (isCompleteBackup ? "new" : "changed") : "metadata",
        statusSource: sourceRelativePath ? "source-window" : "package-generated",
        checksum: crypto.createHash("sha256").update(entry.getData()).digest("hex"),
        size: entry.getData().length,
        modifiedAt: sourceStats ? new Date(sourceStats.mtimeMs).toISOString() : null,
        previousChecksum: null
      };
    });

  archive.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

  const fileChecksums = Object.fromEntries(
    archive.getEntries()
      .filter((entry) => !entry.isDirectory && entry.entryName !== "checksums.json")
      .map((entry) => [entry.entryName, crypto.createHash("sha256").update(entry.getData()).digest("hex")])
  );
  const checksumsContent = JSON.stringify(fileChecksums, null, 2);
  archive.addFile("checksums.json", Buffer.from(checksumsContent, "utf8"));

  const { filePath, fileName } = buildBackupArchiveFile(new Date(), isCompleteBackup ? "complete" : "incremental");
  archive.writeZip(filePath);
  rememberProjectSnapshot(currentProjectRoot, buildProjectSnapshotMap(currentProjectRoot));
  enforceBackupRetention();

  const summary = {
    message: isCompleteBackup ? "Full backup created." : "Backup created.",
    totalChanges: Math.max(fileStatusCounts.new + fileStatusCounts.modified + fileStatusCounts.unchanged, 0),
    newFiles: fileStatusCounts.new,
    modifiedFiles: fileStatusCounts.modified,
    newAssets: assetStatusCounts.new,
    modifiedAssets: assetStatusCounts.modified,
    newDatabaseRecords: databaseCounts.newRecords,
    updatedDatabaseRecords: databaseCounts.updatedRecords
  };

  return {
    ...backupInfo,
    shouldCreatePackage: true,
    filePath,
    fileName,
    relativePath: path.relative(__dirname, filePath).split(path.sep).join("/"),
    fileSize: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
    manifest,
    metadata,
    database,
    summary,
    fileInventory: manifest.fileInventory || [],
    assetCounts: assetStatusCounts,
    databaseCounts,
    summaryMessage: summary.message
  };
}

/* ---------------- FILE UPLOAD CONFIG ---------------- */

const storage = multer.diskStorage({

  destination: function (req, file, cb) {
    try {
      const authHeader = req.headers["authorization"];
      if (!authHeader) {
        return cb(new Error("Access denied"));
      }

      const token = authHeader.split(" ")[1];
        const decoded = verifyJwtToken(token);

      pool.query(
        `
        SELECT username
        FROM users
        WHERE id = $1
        `,
        [decoded.user]
      )
        .then((result) => {
          if (result.rows.length === 0) {
            return cb(new Error("User not found"));
          }

          const username = result.rows[0].username || "unknown";
          const now = new Date();
          const year = now.getFullYear().toString();
          const month = String(now.getMonth() + 1).padStart(2, "0");
          const statusFolder = "Pending";

          const uploadPath = path.join(
            __dirname,
            "uploads",
            username,
            year,
            month,
            statusFolder
          );

          fs.mkdirSync(uploadPath, {
            recursive: true,
          });

          cb(null, uploadPath);
        })
        .catch((err) => {
          cb(err);
        });
    } catch (err) {
      cb(err);
    }
  },

  filename: function (req, file, cb) {

    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(
      null,
      Date.now() + "-" + safeName
    );

  },

});

const upload = multer({

  storage: storage,

  limits: {
    fileSize: 200 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {

    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/svg+xml",
      "image/vnd.adobe.photoshop",
      "application/postscript",
      "video/mp4",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-matroska",
      "application/zip",
      "application/x-zip-compressed"
    ];

    const thumbnailTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/svg+xml"
    ];

    const isAllowed = file.fieldname === "thumbnail"
      ? thumbnailTypes.includes(file.mimetype)
      : allowedTypes.includes(file.mimetype);

    if (isAllowed) {
      cb(null, true);
    } else {
      cb(
        new Error(
          file.fieldname === "thumbnail"
            ? "Optional thumbnail must be an image file such as JPG, PNG, WEBP, GIF, or SVG."
            : "Only JPG, PNG, WEBP, SVG, PSD, video, and ZIP template files are allowed"
        )
      );
    }

  }

});

const payoutUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const token = String(req.headers.authorization || "").split(" ")[1];
        const decoded =
          verifyJwtToken(token);
        const userResult = await pool.query("SELECT username FROM users WHERE id = $1", [decoded.user]);
        if (!userResult.rows[0]) return cb(new Error("User not found"));
        const uploadPath = path.join(__dirname, "uploads", userResult.rows[0].username || "unknown", "bank");
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp)$/.test(file.mimetype) || file.mimetype === "application/pdf") return cb(null, true);
    cb(new Error("Cancelled check must be a PDF or image file"));
  },
});

const brandingStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const brandingDir = path.join(__dirname, "uploads", "branding");
    fs.mkdirSync(brandingDir, { recursive: true });
    cb(null, brandingDir);
  },
  filename: function (req, file, cb) {
    let fieldName = file.fieldname;
    if (fieldName === 'watermarkLogo') fieldName = 'watermarkLogo';
    if (fieldName === 'watermarkFavicon') fieldName = 'watermarkFavicon';
    if (fieldName === "favicon") fieldName = "favicon";
    if (fieldName === "logo") fieldName = "logo";
    if (fieldName === "heroBanner") fieldName = "heroBanner";
    if (fieldName === "customerBanner") fieldName = "customerBanner";
    if (fieldName === "contributorBanner") fieldName = "contributorBanner";
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${fieldName}${ext}`);
  }
});

const brandingUpload = multer({
  storage: brandingStorage,
  limits: {
    fileSize: 2 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
      return;
    }
    cb(new Error("Only image files are allowed for branding"));
  }
});

const profileIconUpload = multer({
  storage: brandingStorage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "image/png") {
      cb(null, true);
      return;
    }
    cb(new Error("Profile icons must be PNG files"));
  }
});

const handleBrandingUpload = (req, res, next) => {
  brandingUpload.any()(req, res, (err) => {
    if (err) {
      console.error("Branding upload error", err.message || err);
      return res.status(400).json({ error: err.message || "Branding upload failed" });
    }
    next();
  });
};
/* ---------------- MIDDLEWARE ---------------- */

app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://0.0.0.0:3000",
        "http://100.101.63.63:3000",
        "http://100.102.63.63:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://0.0.0.0:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
        "http://0.0.0.0:3002"
      ];

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'Content-Type', 'Content-Length']
  })
);

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(cookieParser());

const SUPPORTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];
const IMAGE_CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

/* Thumbnail processing support */
const THUMBNAIL_SUPPORTED_EXTENSIONS = [".ai", ".eps", ".psd", ".psb"];
const THUMBNAIL_SUPPORTED_MIMES = [
  "application/x-illustrator",
  "application/postscript",
  "image/vnd.adobe.photoshop",
];

const isThumbnailSupportedFile = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  return THUMBNAIL_SUPPORTED_EXTENSIONS.includes(ext);
};

const normalizeBrandingAssetPath = (value) => {
  if (!value) return "";
  let normalized = String(value).trim();
  normalized = normalized.replace(/^\/+/, "");
  normalized = normalized.replace(/^api\/files\/+/, "");
  normalized = normalized.replace(/^uploads[\\/]+/, "");
  normalized = normalized.replace(/^branding[\\/]+/, "branding/");
  return normalized;
};

const resolveUploadFilePath = (value) => {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    throw new Error("Missing file path");
  }

  const normalizedInput = rawValue.replace(/^\/+/, "");
  const normalizedPath = path.normalize(normalizedInput);
  if (normalizedPath === "." || normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
    throw new Error("Invalid file path");
  }

  const uploadsRoot = path.resolve(__dirname, "uploads");
  const absolutePath = path.resolve(uploadsRoot, normalizedPath);
  const relativeToUploads = path.relative(uploadsRoot, absolutePath);

  if (!relativeToUploads || relativeToUploads.startsWith("..") || path.isAbsolute(relativeToUploads)) {
    throw new Error("Invalid file path");
  }

  return { absolutePath, uploadsRoot };
};

const persistEpsThumbnailIfMissing = async (imageRow) => {
  if (!imageRow || !imageRow.filename) {
    return false;
  }

  const originalFilePath = path.resolve(__dirname, "uploads", String(imageRow.filename).replace(/^\/+/, ""));
  if (!fs.existsSync(originalFilePath) || path.extname(originalFilePath).toLowerCase() !== ".eps") {
    return false;
  }

  const expectedThumbnailPath = buildGeneratedThumbnailPath(originalFilePath, ".jpg");
  const relativeFromUploads = path.relative(path.resolve(__dirname, "uploads"), expectedThumbnailPath).replace(/\\/g, "/");
  const thumbnailUrl = `/api/thumbnail?file=${encodeURIComponent(relativeFromUploads)}`;

  if (fs.existsSync(expectedThumbnailPath)) {
    await pool.query(
      `UPDATE images SET thumbnail_status = 'COMPLETED', thumbnail_url = $1, thumbnail_generated_at = NOW(), thumbnail_error = NULL WHERE id = $2`,
      [thumbnailUrl, imageRow.id]
    );
    return true;
  }

  try {
    const processor = processorFactory.getProcessor(originalFilePath);
    if (!processor || processor.name !== "EpsProcessor") {
      return false;
    }

    const result = await processor.process(originalFilePath, imageRow.id, null, {
      quality: 30,
      maxWidth: 1200,
      maxHeight: 1200,
    });

    if (result && result.success && result.thumbnailPath) {
      await pool.query(
        `UPDATE images SET thumbnail_status = 'COMPLETED', thumbnail_url = $1, thumbnail_generated_at = NOW(), thumbnail_error = NULL WHERE id = $2`,
        [thumbnailUrl, imageRow.id]
      );
      return true;
    }

    return false;
  } catch (err) {
    console.warn(`[EPS persistence fallback] Failed to regenerate thumbnail for asset ${imageRow.id}: ${err.message}`);
    return false;
  }
};

const resolveOriginalEpsFromThumbnailPath = (thumbnailPath) => {
  try {
    if (!thumbnailPath) {
      return null;
    }

    const uploadsRoot = path.resolve(__dirname, "uploads");
    const absoluteThumbPath = path.resolve(uploadsRoot, String(thumbnailPath).replace(/^\/+/, ""));
    if (!fs.existsSync(absoluteThumbPath)) {
      return null;
    }

    const boxDir = path.dirname(absoluteThumbPath);
    const thumbStem = path.basename(absoluteThumbPath, path.extname(absoluteThumbPath));
    const normalizedStems = new Set([
      thumbStem,
      thumbStem.replace(/^thumbnail-/, ""),
      thumbStem.replace(/-thumb$/, ""),
      thumbStem.replace(/^thumbnail-/, "").replace(/-thumb$/, ""),
    ]);

    for (const statusDir of ["Pending", "Approved", "Rejected"]) {
      const statusPath = path.resolve(uploadsRoot, path.dirname(path.relative(uploadsRoot, boxDir)), statusDir);
      if (!fs.existsSync(statusPath)) {
        continue;
      }

      for (const candidateStem of normalizedStems) {
        const epsPath = path.join(statusPath, `${candidateStem}.eps`);
        if (fs.existsSync(epsPath)) {
          return epsPath;
        }
      }
    }

    const baseDir = path.resolve(uploadsRoot, path.dirname(path.relative(uploadsRoot, boxDir)));
    for (const candidateStem of normalizedStems) {
      for (const statusDir of ["Pending", "Approved", "Rejected"]) {
        const epsPath = path.join(baseDir, statusDir, `${candidateStem}.eps`);
        if (fs.existsSync(epsPath)) {
          return epsPath;
        }
      }
    }

    return null;
  } catch (err) {
    console.warn(`[EPS persistence fallback] Failed to resolve original EPS from thumbnail path: ${err.message}`);
    return null;
  }
};

const backfillPendingEpsThumbnails = async () => {
  try {
    const result = await pool.query(
      `SELECT id, filename, thumbnail_status, thumbnail_url FROM images WHERE lower(filename) LIKE '%.eps' AND (thumbnail_status IS NULL OR thumbnail_status IN ('pending', 'RETRYING', 'FAILED')) ORDER BY id DESC`
    );

    for (const imageRow of result.rows) {
      const generated = await persistEpsThumbnailIfMissing(imageRow);
      if (generated) {
        console.log(`[EPS persistence fallback] Saved thumbnail for asset ${imageRow.id}`);
      }
    }
  } catch (err) {
    console.warn(`[EPS persistence fallback] Failed to backfill EPS thumbnails: ${err.message}`);
  }
};

const streamImageFile = async (req, res, absolutePath, { bypassProcessing = false } = {}) => {
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return res.status(404).json({ error: "Image not found" });
  }

  const ext = path.extname(absolutePath).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
    if (req.query.download === "true") {
      const downloadContentType = {
        ".eps": "application/postscript",
        ".psd": "image/vnd.adobe.photoshop",
        ".psb": "image/vnd.adobe.photoshop",
        ".ai": "application/postscript",
      }[ext] || "application/octet-stream";
      res.type(downloadContentType);
      res.set("Content-Disposition", `attachment; filename="${path.basename(absolutePath)}"`);
      const readStream = fs.createReadStream(absolutePath);
      readStream.on("error", () => {
        if (!res.headersSent) {
          res.status(500).send("Failed to read image");
        }
      });
      return readStream.pipe(res);
    }

    return res.status(400).json({ error: "Unsupported image preview format" });
  }

  const contentType = IMAGE_CONTENT_TYPES[ext] || "application/octet-stream";
  if (req.query.download === "true") {
    res.set("Content-Disposition", `attachment; filename="${path.basename(absolutePath)}"`);
  }
  const qualityValue = Number(req.query.quality || 100);
  const normalizedQuality = Number.isFinite(qualityValue)
    ? Math.min(100, Math.max(10, qualityValue))
    : 100;

  if (!bypassProcessing && (req.query.quality !== undefined || req.query.watermark === "true") && [".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    try {
      // Get metadata first for both resizing and watermark processing
      const isThumbnail = String(absolutePath || '').includes('thumbnail');
      const baseMetadata = await sharp(absolutePath).metadata();
      
      let transformer = sharp(absolutePath).rotate();

      // Standardize thumbnail dimensions to 1200x720px max (for thumbnails)
      // If smaller, keep original; if larger, resize to fit
      let finalWidth = baseMetadata.width || 800;
      let finalHeight = baseMetadata.height || Math.round((finalWidth * 3) / 4);
      
      if (isThumbnail) {
        const maxWidth = 1200;
        const maxHeight = 720;
        const currentWidth = baseMetadata.width || maxWidth;
        const currentHeight = baseMetadata.height || maxHeight;
        
        // Only resize if image is larger than target dimensions
        if (currentWidth > maxWidth || currentHeight > maxHeight) {
          transformer = transformer.resize(maxWidth, maxHeight, {
            fit: 'inside',
            withoutEnlargement: true
          });
          // Update final dimensions to reflect the resize
          const resizeRatio = Math.min(maxWidth / currentWidth, maxHeight / currentHeight);
          finalWidth = Math.round(currentWidth * resizeRatio);
          finalHeight = Math.round(currentHeight * resizeRatio);
        }
      }

      if (req.query.watermark === "true") {
        const brandingConfig = getBrandingConfig();
        try {
          const imgWidth = finalWidth;
          const imgHeight = finalHeight;
          
          const logoCandidate = (brandingConfig && (brandingConfig.watermarkLogo || brandingConfig.logo)) || "/branding/logo.png";
          const faviconCandidate = (brandingConfig && (brandingConfig.watermarkFavicon || brandingConfig.favicon)) || "/branding/favicon.png";
          const normalizeCandidate = (c) => normalizeBrandingAssetPath(c);
          const logoPath = path.join(__dirname, "uploads", normalizeCandidate(logoCandidate));
          const faviconPath = path.join(__dirname, "uploads", normalizeCandidate(faviconCandidate));

          let logoBase64 = null;
          let logoSize = Math.max(48, Math.round(imgWidth * 0.08));
          if (fs.existsSync(logoPath)) {
            try {
              const logoBuf = await sharp(logoPath).resize({ width: logoSize, withoutEnlargement: true }).png().toBuffer();
              logoBase64 = logoBuf.toString("base64");
            } catch (err) {
              console.warn("Failed to prepare logo for watermark pattern", err.message || err);
              logoBase64 = null;
            }
          }

          let faviconBase64 = null;
          let faviconSize = Math.max(32, Math.round(imgWidth * 0.05));
          if (fs.existsSync(faviconPath)) {
            try {
              const favBuf = await sharp(faviconPath).resize({ width: faviconSize, withoutEnlargement: true }).png().toBuffer();
              faviconBase64 = favBuf.toString("base64");
            } catch (err) {
              console.warn("Failed to prepare favicon for watermark pattern", err.message || err);
              faviconBase64 = null;
            }
          }

          // Create diagonal pattern alternating between logo and favicon
          let patternElements = '';
          if (logoBase64 || faviconBase64) {
            const spacing = Math.round(imgWidth * 0.15);  // Reduced spacing for 30% more density
            const diagSpacing = Math.round(spacing * Math.sqrt(2));  // Diagonal spacing
            let alternateCount = 0;
            
            // Create diagonal lines going from top-left to bottom-right
            for (let offset = -imgHeight; offset < imgWidth + imgHeight; offset += diagSpacing) {
              for (let step = 0; step < (imgWidth + imgHeight) / spacing; step++) {
                const x = offset + step * spacing;
                const y = step * spacing;
                
                if (x >= 0 && x < imgWidth && y >= 0 && y < imgHeight) {
                  // Alternate between logo and favicon
                  if (alternateCount % 2 === 0 && logoBase64) {
                    patternElements += `<image x='${Math.round(x)}' y='${Math.round(y)}' width='${logoSize}' height='${logoSize}' href='data:image/png;base64,${logoBase64}' opacity='0.75'/>`;
                  } else if (faviconBase64) {
                    patternElements += `<image x='${Math.round(x)}' y='${Math.round(y)}' width='${faviconSize}' height='${faviconSize}' href='data:image/png;base64,${faviconBase64}' opacity='0.80'/>`;
                  }
                  alternateCount++;
                }
              }
            }
          }

          const svg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns='http://www.w3.org/2000/svg' width='${imgWidth}' height='${imgHeight}'>
  <!-- Diagonal logo and favicon pattern -->
  <g opacity='0.8'>
    ${patternElements}
  </g>
</svg>`;
          const watermarkBuffer = Buffer.from(svg);
          transformer = transformer.composite([{ input: watermarkBuffer, blend: "over" }]);
        } catch (err) {
          console.warn("Watermark generation failed, using original asset preview:", err.message || err);
        }
      }

      if (req.query.watermark === "true") {
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");
      }

      if (ext === ".png") {
        transformer = transformer.png({ quality: normalizedQuality, compressionLevel: 9 });
        res.type("image/png");
      } else if (ext === ".webp") {
        transformer = transformer.webp({ quality: normalizedQuality });
        res.type("image/webp");
      } else {
        transformer = transformer.jpeg({ quality: normalizedQuality });
        res.type("image/jpeg");
      }

      try {
        const buffer = await transformer.toBuffer();
        return res.send(buffer);
      } catch (err) {
        console.warn("Watermarked render failed, retrying without watermark:", err.message || err);
        const fallback = sharp(absolutePath).rotate();
        if (ext === ".png") {
          fallback.png({ quality: normalizedQuality, compressionLevel: 9 });
        } else if (ext === ".webp") {
          fallback.webp({ quality: normalizedQuality });
        } else {
          fallback.jpeg({ quality: normalizedQuality });
        }
        const fallbackBuffer = await fallback.toBuffer();
        return res.send(fallbackBuffer);
      }
    } catch (err) {
      console.error("Processed upload error", err);
      return res.status(500).send("Failed to generate processed image");
    }
  }

  res.type(contentType);
  const readStream = fs.createReadStream(absolutePath);
  readStream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).send("Failed to read image");
    }
  });
  return readStream.pipe(res);
};

app.use("/api/files", async (req, res, next) => {
  try {
    const requestPath = decodeURIComponent(String(req.path || "").replace(/^\/+/, ""));
    const { absolutePath } = resolveUploadFilePath(requestPath);
    return streamImageFile(req, res, absolutePath, { bypassProcessing: true });
  } catch (err) {
    console.error("Secure file request failed", err);
    return res.status(400).json({ error: err.message || "Invalid file request" });
  }
});

app.get("/api/images/:imageId", async (req, res) => {
  try {
    const { imageId } = req.params;
    const imageResult = await pool.query(
      `SELECT filename, thumbnail_url FROM images WHERE id = $1`,
      [imageId]
    );

    if (imageResult.rows.length === 0) {
      return res.status(404).json({ error: "Image not found" });
    }

    if (req.query.download === "true") {
      const { absolutePath } = resolveUploadFilePath(imageResult.rows[0].filename);
      return streamImageFile(req, res, absolutePath);
    }

    const image = imageResult.rows[0];
    const ext = path.extname(String(image.filename)).toLowerCase();
    const isOriginalSupported = SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
    
    // Try to serve original if it's a supported format
    if (isOriginalSupported) {
      const { absolutePath } = resolveUploadFilePath(image.filename);
      if (fs.existsSync(absolutePath)) {
        return streamImageFile(req, res, absolutePath);
      }
    }
    
    // Fall back to thumbnail if available
    if (image.thumbnail_url) {
      try {
        const match = String(image.thumbnail_url).match(/[?&]file=([^&]+)/i);
        const rawFile = match ? decodeURIComponent(match[1]) : String(image.thumbnail_url).replace(/^\/+/, '').replace(/^api\/files\//, '').replace(/^uploads\//, '');
        const { absolutePath } = resolveUploadFilePath(rawFile);
        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
          // For thumbnails, bypass processing if watermark not requested to avoid double processing
          if (req.query.watermark === "true") {
            return streamImageFile(req, res, absolutePath);
          } else {
            return streamImageFile(req, res, absolutePath, { bypassProcessing: true });
          }
        }
      } catch (err) {
        console.warn("Failed to resolve custom thumbnail preview:", err.message || err);
      }
    }
    
    // For unsupported formats (like EPS), try to generate a thumbnail on-the-fly
    if (!isOriginalSupported) {
      try {
        const { absolutePath } = resolveUploadFilePath(image.filename);
        if (fs.existsSync(absolutePath)) {
          const generatedPath = buildGeneratedThumbnailPath(absolutePath, ".jpg");
          if (fs.existsSync(generatedPath)) {
            return streamImageFile(req, res, generatedPath, { bypassProcessing: true });
          }

          const processor = processorFactory.getProcessor(absolutePath);
          if (processor) {
            const generated = await processor.process(absolutePath, imageId, null, {
              quality: 30,
              maxWidth: 1200,
              maxHeight: 1200,
            });
            if (generated && generated.success && fs.existsSync(generated.thumbnailPath)) {
              const relativeFromUploads = path.relative(path.resolve(__dirname, "uploads"), generated.thumbnailPath).replace(/\\/g, "/");
              const thumbnailUrl = `/api/thumbnail?file=${encodeURIComponent(relativeFromUploads)}`;
              await pool.query(
                `UPDATE images SET thumbnail_status = 'COMPLETED', thumbnail_url = $1, thumbnail_generated_at = NOW(), thumbnail_error = NULL WHERE id = $2`,
                [thumbnailUrl, imageId]
              );
              return streamImageFile(req, res, generated.thumbnailPath, { bypassProcessing: true });
            }
          }
        }
      } catch (err) {
        console.warn(`Failed to generate thumbnail for unsupported asset ${imageId}:`, err.message || err);
      }
    }

    return res.status(404).json({ error: "Preview not available" });
  } catch (err) {
    console.error("Secure image request failed", err);
    return res.status(400).json({ error: err.message || "Invalid image request" });
  }
});

app.get("/uploads/processed", async (req, res) => {
  const { file, quality, watermark } = req.query;
  if (!file) {
    return res.status(400).send("Missing file parameter");
  }

  const parsedQuality = Number(quality || 50);
  const normalizedQuality = Number.isFinite(parsedQuality)
    ? Math.min(100, Math.max(10, parsedQuality))
    : 50;

  const uploadsRoot = path.join(__dirname, "uploads");
  const rawFile = String(file || "").trim();
  const strippedFile = rawFile
    .replace(/^\/+/, "")
    .replace(/^uploads[\\/]+/, "");
  const normalizedPath = path.normalize(strippedFile);
  const imagePath = path.resolve(uploadsRoot, normalizedPath);
  const uploadsRootResolved = path.resolve(uploadsRoot);
  const relativeToUploads = path.relative(uploadsRootResolved, imagePath);

  if (
    !relativeToUploads ||
    relativeToUploads.startsWith("..") ||
    path.isAbsolute(normalizedPath)
  ) {
    return res.status(400).send("Invalid file path");
  }

  if (!fs.existsSync(imagePath)) {
    return res.status(404).send("File not found");
  }

  const ext = path.extname(imagePath).toLowerCase();
  const supportedFormats = [".jpg", ".jpeg", ".png", ".webp"]; 
  if (!supportedFormats.includes(ext)) {
    return res.sendFile(imagePath);
  }

  try {
    let transformer = sharp(imagePath).rotate();

    if (watermark === "true") {
      const brandingConfig = getBrandingConfig();

      try {
        const metadata = await transformer.metadata();
        const imgWidth = metadata.width || 800;
        const imgHeight = metadata.height || Math.round((imgWidth * 3) / 4);

        // Prefer explicit watermark text from branding config, otherwise fallback
        // Force watermark text and visual parameters
        const watermarkText = "GFXunlimit";

        // Visual tuning: rotation, text opacity, font sizing and pattern size
        const rotationAngle = -30; // diagonal tilt
        const textOpacity = 0.5; // 50% white
        const fontSize = Math.max(22, Math.round(imgWidth * 0.055));
        const patternSize = Math.max(fontSize * 10, 240);

        // Prefer watermark-specific files if provided, otherwise fall back to general branding
        // Resolve branding paths safely relative to uploads root
        const logoCandidate = (brandingConfig && (brandingConfig.watermarkLogo || brandingConfig.logo)) || "/branding/logo.png";
        const faviconCandidate = (brandingConfig && (brandingConfig.watermarkFavicon || brandingConfig.favicon)) || "/branding/favicon.png";
        const normalizeCandidate = (c) => normalizeBrandingAssetPath(c);
        const logoPath = path.join(uploadsRoot, normalizeCandidate(logoCandidate));
        const faviconPath = path.join(uploadsRoot, normalizeCandidate(faviconCandidate));

        let logoBase64 = null;
        let logoWidth = Math.round(patternSize * 0.72);
        if (fs.existsSync(logoPath)) {
          try {
            const logoBuf = await sharp(logoPath).resize({ width: logoWidth, withoutEnlargement: true }).png().toBuffer();
            logoBase64 = logoBuf.toString('base64');
            // adjust height from actual metadata if possible
            const lm = await sharp(logoBuf).metadata();
            if (lm && lm.width && lm.height) {
              // scale height to keep aspect ratio within the tile
              const aspect = lm.height / lm.width;
              logoWidth = Math.round(Math.min(logoWidth, patternSize * 0.9));
            }
          } catch (err) {
            console.warn('Failed to prepare branding logo for watermark', err.message || err);
            logoBase64 = null;
          }
        }

        let favBase64 = null;
        let favSize = Math.max(20, Math.round(patternSize * 0.22));
        if (fs.existsSync(faviconPath)) {
          try {
            const favBuf = await sharp(faviconPath).resize({ width: favSize, withoutEnlargement: true }).png().toBuffer();
            favBase64 = favBuf.toString('base64');
          } catch (err) {
            console.warn('Failed to prepare favicon for watermark', err.message || err);
            favBase64 = null;
          }
        }

        const logoOpacity = 0.55;
        const favOpacity = 0.45;

        // Build SVG pattern: embed logo, favicon, and a diagonal brand text overlay so the watermark is clearly visible
        const svg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns='http://www.w3.org/2000/svg' width='${imgWidth}' height='${imgHeight}'>
  <defs>
    <filter id='softShadow' x='-20%' y='-20%' width='140%' height='140%'>
      <feDropShadow dx='0' dy='0' stdDeviation='4' flood-color='rgba(0,0,0,0.45)'/>
    </filter>
  </defs>
  <g transform='rotate(-30 ${imgWidth / 2} ${imgHeight / 2})' opacity='0.82'>
    ${logoBase64 ? `<image x='${Math.round(imgWidth * 0.18)}' y='${Math.round(imgHeight * 0.18)}' width='${Math.max(120, Math.round(imgWidth * 0.18))}' height='${Math.max(120, Math.round(imgWidth * 0.18))}' href='data:image/png;base64,${logoBase64}' />` : ''}
    <text x='${Math.round(imgWidth * 0.08)}' y='${Math.round(imgHeight * 0.74)}' fill='rgba(255,255,255,0.9)' stroke='rgba(0,0,0,0.35)' stroke-width='3' font-size='${Math.max(110, Math.round(imgWidth * 0.12))}' font-weight='800' font-family='Arial, Helvetica, sans-serif' letter-spacing='3' filter='url(#softShadow)'>GFXunlimit</text>
  </g>
</svg>`;

        const watermarkBuffer = Buffer.from(svg);
        try {
          transformer = transformer.composite([{ input: watermarkBuffer, blend: 'over' }]);
        } catch (err) {
          console.warn("Watermark composition failed, falling back to original image:", err.message || err);
        }
      } catch (err) {
        console.error("Watermark generation failed", err);
      }
    }

    if (watermark === "true") {
      // Disable caching for watermarked images so updates appear immediately
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
    }

    if (ext === ".png") {
      transformer = transformer.png({ quality: normalizedQuality, compressionLevel: 9 });
      res.type("image/png");
    } else if (ext === ".webp") {
      transformer = transformer.webp({ quality: normalizedQuality });
      res.type("image/webp");
    } else {
      transformer = transformer.jpeg({ quality: normalizedQuality });
      res.type("image/jpeg");
    }

    try {
      const buffer = await transformer.toBuffer();
      return res.send(buffer);
    } catch (err) {
      console.warn("Watermarked render failed, retrying without watermark:", err.message || err);
      const fallback = sharp(imagePath).rotate();
      if (ext === ".png") {
        fallback.png({ quality: normalizedQuality, compressionLevel: 9 });
      } else if (ext === ".webp") {
        fallback.webp({ quality: normalizedQuality });
      } else {
        fallback.jpeg({ quality: normalizedQuality });
      }
      const fallbackBuffer = await fallback.toBuffer();
      return res.send(fallbackBuffer);
    }
  } catch (err) {
    console.error("Processed upload error", err);
    res.status(500).send("Failed to generate processed image");
  }
});

// Scheduled emails runner (checks DB every minute)
try {
  const cron = require('node-cron');
  const { processDueScheduledEmails, processDueDailyReportSchedules } = require('./email/scheduler');

  const runScheduledCheck = async () => {
    try {
      await processDueScheduledEmails({ poolRef: pool, now: new Date() });
      await processDueDailyReportSchedules({ poolRef: pool, now: new Date() });
      await sendDailyWebsiteSummary({ poolRef: pool, now: new Date() });
    } catch (err) {
      console.error('Scheduled email runner startup check failed', err);
    }
  };

  if (process.env.DISABLE_EMAIL_SCHEDULER === 'true') {
    console.log('Email scheduler disabled by DISABLE_EMAIL_SCHEDULER');
  } else {
    let lastRunAt = null;
    cron.schedule('* * * * *', async () => {
      try {
        const now = new Date();
        if (lastRunAt && now.getTime() - lastRunAt.getTime() < 60000) {
          return;
        }
        lastRunAt = now;
        await processDueScheduledEmails({ poolRef: pool, now });
        await processDueDailyReportSchedules({ poolRef: pool, now });
        await sendDailyWebsiteSummary({ poolRef: pool, now });
      } catch (err) {
        console.error('Scheduled email runner error', err);
      }
    });

    runScheduledCheck();
  }
} catch (err) {
  console.warn('Cron setup skipped', err.message || err);
}

// Currency exchange rate scheduler (runs daily at 10 AM)
try {
  const cron = require('node-cron');
  const { updateCurrencyRates } = require('./currency/currencyScheduler');

  if (process.env.DISABLE_CURRENCY_SCHEDULER === 'true') {
    console.log('Currency scheduler disabled by DISABLE_CURRENCY_SCHEDULER');
  } else {
    // Schedule for 10:00 AM every day (0 10 * * *)
    cron.schedule('0 10 * * *', async () => {
      try {
        console.log('Running daily currency exchange rate update...');
        await updateCurrencyRates(pool);
      } catch (err) {
        console.error('Currency scheduler error:', err);
      }
    });

    // Also run on startup to ensure rates are current
    console.log('Currency scheduler initialized (runs daily at 10:00 AM)');
  }
} catch (err) {
  console.warn('Currency scheduler setup skipped', err.message || err);
}

const getDailySummaryEmailRecipients = (recipients = [], adminEmails = []) => {
  const resolved = normalizeRecipients(Array.isArray(recipients) ? recipients : []).flatMap((recipient) => {
    if (recipient === '{{admin_email}}' || recipient === '{{admins}}') return adminEmails;
    return [recipient];
  });

  const toRecipients = [...new Set(resolved.filter((value) => !String(value).startsWith('bcc:')).filter(Boolean))];
  const bccRecipients = [...new Set(resolved.filter((value) => String(value).startsWith('bcc:')).map((value) => value.replace(/^bcc:/, '')).filter(Boolean))];
  return { toRecipients, bccRecipients };
};

const buildDailyWebsiteSummary = async ({ poolRef = pool } = {}) => {
  const [usersRes, contributorsRes, customersRes, adminsRes, pendingUsersRes, blockedUsersRes, activeContributorsRes, inactiveContributorsRes, pendingContributorsRes, blockedContributorsRes, deletedContributorsRes, activeCustomersRes, inactiveCustomersRes, pendingCustomersRes, blockedCustomersRes, deletedCustomersRes, totalAssetsRes, liveAssetsRes, pendingAssetsRes, rejectedAssetsRes, deletedAssetsRes, ordersRes, revenueRes, downloadsRes, newTodayRes, pricingRes] = await Promise.all([
    poolRef.query("SELECT COUNT(*)::int AS total_users FROM users"),
    poolRef.query("SELECT COUNT(*)::int AS total_contributors FROM users WHERE role = 'contributor'"),
    poolRef.query("SELECT COUNT(*)::int AS total_customers FROM users WHERE role = 'customer'"),
    poolRef.query("SELECT COUNT(*)::int AS total_admins FROM users WHERE role = 'admin'"),
    poolRef.query("SELECT COUNT(*)::int AS pending_users FROM users WHERE status ILIKE 'pending'"),
    poolRef.query("SELECT COUNT(*)::int AS blocked_users FROM users WHERE status ILIKE 'blocked'"),
    poolRef.query("SELECT COUNT(*)::int AS active_contributors FROM users WHERE role ILIKE 'contributor' AND status ILIKE 'active'"),
    poolRef.query("SELECT COUNT(*)::int AS inactive_contributors FROM users WHERE role ILIKE 'contributor' AND status ILIKE 'inactive'"),
    poolRef.query("SELECT COUNT(*)::int AS pending_contributors FROM users WHERE role ILIKE 'contributor' AND status ILIKE 'pending'"),
    poolRef.query("SELECT COUNT(*)::int AS blocked_contributors FROM users WHERE role ILIKE 'contributor' AND status ILIKE 'blocked'"),
    poolRef.query("SELECT COUNT(*)::int AS deleted_contributors FROM activity_events WHERE event_type = 'ACCOUNT_STATUS_CHANGED' AND user_role ILIKE 'contributor' AND created_at >= NOW() - INTERVAL '30 days' AND (metadata->>'new_status' ILIKE 'deleted' OR metadata->>'action' ILIKE 'delete')"),
    poolRef.query("SELECT COUNT(*)::int AS active_customers FROM users WHERE role ILIKE 'customer' AND status ILIKE 'active'"),
    poolRef.query("SELECT COUNT(*)::int AS inactive_customers FROM users WHERE role ILIKE 'customer' AND status ILIKE 'inactive'"),
    poolRef.query("SELECT COUNT(*)::int AS pending_customers FROM users WHERE role ILIKE 'customer' AND status ILIKE 'pending'"),
    poolRef.query("SELECT COUNT(*)::int AS blocked_customers FROM users WHERE role ILIKE 'customer' AND status ILIKE 'blocked'"),
    poolRef.query("SELECT COUNT(*)::int AS deleted_customers FROM activity_events WHERE event_type = 'ACCOUNT_STATUS_CHANGED' AND user_role ILIKE 'customer' AND created_at >= NOW() - INTERVAL '30 days' AND (metadata->>'new_status' ILIKE 'deleted' OR metadata->>'action' ILIKE 'delete')"),
    poolRef.query("SELECT COUNT(*)::int AS total_assets FROM images"),
    poolRef.query("SELECT COUNT(*)::int AS live_assets FROM images WHERE status ILIKE 'approved' OR status ILIKE 'published' OR status ILIKE 'live'"),
    poolRef.query("SELECT COUNT(*)::int AS pending_assets FROM images WHERE status ILIKE 'pending'"),
    poolRef.query("SELECT COUNT(*)::int AS rejected_assets FROM images WHERE status ILIKE 'rejected'"),
    poolRef.query("SELECT COUNT(*)::int AS deleted_assets_last_30_days FROM activity_events WHERE event_type = 'ASSET_DELETED' AND created_at >= NOW() - INTERVAL '30 days'"),
    poolRef.query("SELECT COUNT(*)::int AS total_orders FROM orders"),
    poolRef.query("SELECT COALESCE(SUM(CASE WHEN order_status IN ('completed', 'paid') THEN total_amount ELSE 0 END), 0)::numeric AS total_revenue FROM orders"),
    poolRef.query("SELECT COALESCE(SUM(downloads_count), 0)::int AS total_downloads FROM orders"),
    poolRef.query("SELECT COUNT(*)::int AS new_today FROM users WHERE created_at::date = CURRENT_DATE"),
    poolRef.query("SELECT exchange_rate FROM pricing_settings ORDER BY id DESC LIMIT 1")
  ]);

  const totalRevenueUsd = Number(revenueRes.rows[0]?.total_revenue || 0);
  const exchangeRate = Number(pricingRes.rows[0]?.exchange_rate || 83);
  const totalRevenueInr = totalRevenueUsd * exchangeRate;

  return {
    siteName: process.env.APP_NAME || 'GFXunlimit',
    generatedAt: new Date(),
    totalUsers: Number(usersRes.rows[0]?.total_users || 0),
    totalContributors: Number(contributorsRes.rows[0]?.total_contributors || 0),
    totalCustomers: Number(customersRes.rows[0]?.total_customers || 0),
    totalAdmins: Number(adminsRes.rows[0]?.total_admins || 0),
    pendingUsers: Number(pendingUsersRes.rows[0]?.pending_users || 0),
    blockedUsers: Number(blockedUsersRes.rows[0]?.blocked_users || 0),
    activeContributors: Number(activeContributorsRes.rows[0]?.active_contributors || 0),
    inactiveContributors: Number(inactiveContributorsRes.rows[0]?.inactive_contributors || 0),
    pendingContributors: Number(pendingContributorsRes.rows[0]?.pending_contributors || 0),
    blockedContributors: Number(blockedContributorsRes.rows[0]?.blocked_contributors || 0),
    deletedContributorsLast30Days: Number(deletedContributorsRes.rows[0]?.deleted_contributors || 0),
    activeCustomers: Number(activeCustomersRes.rows[0]?.active_customers || 0),
    inactiveCustomers: Number(inactiveCustomersRes.rows[0]?.inactive_customers || 0),
    pendingCustomers: Number(pendingCustomersRes.rows[0]?.pending_customers || 0),
    blockedCustomers: Number(blockedCustomersRes.rows[0]?.blocked_customers || 0),
    deletedCustomersLast30Days: Number(deletedCustomersRes.rows[0]?.deleted_customers || 0),
    totalAssets: Number(totalAssetsRes.rows[0]?.total_assets || 0),
    liveAssets: Number(liveAssetsRes.rows[0]?.live_assets || 0),
    pendingAssets: Number(pendingAssetsRes.rows[0]?.pending_assets || 0),
    rejectedAssets: Number(rejectedAssetsRes.rows[0]?.rejected_assets || 0),
    deletedAssetsLast30Days: Number(deletedAssetsRes.rows[0]?.deleted_assets_last_30_days || 0),
    totalOrders: Number(ordersRes.rows[0]?.total_orders || 0),
    totalRevenueUsd,
    totalRevenueInr,
    exchangeRate,
    totalDownloads: Number(downloadsRes.rows[0]?.total_downloads || 0),
    newToday: Number(newTodayRes.rows[0]?.new_today || 0),
  };
};

const formatCurrency = (value) => {
  const n = Number(value || 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
};

const renderDailyWebsiteSummaryHtml = (summary) => {
  const dateText = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(summary.generatedAt);

  const metricsData = [
    ['Users', summary.totalUsers],
    ['Customers', summary.totalCustomers],
    ['Contributors', summary.totalContributors],
    ['Live Assets', summary.liveAssets],
    ['Pending Assets', summary.pendingAssets],
    ['Rejected Assets', summary.rejectedAssets],
    ['Deleted Assets (Last 30 Days)', summary.deletedAssetsLast30Days],
    ['Orders', summary.totalOrders],
    ['Revenue (USD)', formatCurrency(summary.totalRevenueUsd)],
    ['Revenue (INR)', new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(summary.totalRevenueInr)],
    ['Downloads', summary.totalDownloads],
    ['New Today', summary.newToday]
  ];

  return `
    <div style="font-family: Arial, sans-serif; color: #111827; background: #f8fafc; padding: 24px;">
      <div style="max-width: 760px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #1d4ed8, #2563eb); color: #fff; padding: 20px 24px;">
          <div style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.82;">Website Summary</div>
          <h2 style="margin: 8px 0 0; font-size: 28px;">${summary.siteName}</h2>
          <div style="margin-top: 8px; font-size: 13px; opacity: 0.88;">Generated: ${dateText}</div>
        </div>
        <div style="padding: 24px;">
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <thead>
              <tr style="background: #f8fafc; border-bottom: 2px solid #1d4ed8;">
                <th style="padding: 12px; text-align: left; font-weight: 700; color: #1d4ed8; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em;">Metric</th>
                <th style="padding: 12px; text-align: right; font-weight: 700; color: #1d4ed8; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em;">Value</th>
              </tr>
            </thead>
            <tbody>
              ${metricsData.map(([label, value], idx) => `
                <tr style="border-bottom: 1px solid #e2e8f0; background: ${idx % 2 === 0 ? '#ffffff' : '#f9fafb'};">
                  <td style="padding: 14px 12px; color: #334155; font-weight: 500;">${label}</td>
                  <td style="padding: 14px 12px; text-align: right; color: #0f172a; font-weight: 700; font-size: 15px;">${value}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div style="border-top: 1px solid #e2e8f0; padding-top: 18px; color: #334155; line-height: 1.6;">
            <div><strong>Daily status:</strong> ${summary.liveAssets} live assets, ${summary.pendingAssets} pending review, ${summary.rejectedAssets} rejected, ${summary.totalOrders} orders processed, and ${formatCurrency(summary.totalRevenueUsd)} USD (₹${summary.totalRevenueInr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}) in completed revenue.</div>
            <div style="margin-top: 8px;"><strong>Engagement:</strong> ${summary.totalDownloads} total asset downloads recorded so far and ${summary.newToday} new users added today.</div>
          </div>
        </div>
      </div>
    </div>
  `;
};

const sendDailyWebsiteSummary = async ({ poolRef = pool, now = new Date() } = {}) => {
  const ruleRes = await poolRef.query("SELECT * FROM notification_rules WHERE event_key = 'daily_reports' AND enable_email IS NOT FALSE ORDER BY updated_at DESC LIMIT 1");
  const rule = ruleRes.rows[0];
  if (!rule) return false;

  const scheduleTime = (rule.schedule_time || (rule.metadata && rule.metadata.schedule_time) || '11:00').trim();
  const [hour, minute] = scheduleTime.split(':').map((part) => Number(part || 0));
  const localHour = now.getHours();
  const localMinute = now.getMinutes();
  const isDue = (localHour === hour && localMinute === minute) || (localHour === hour && localMinute === minute + 1);
  if (!isDue) return false;

  const metadata = (rule.metadata && typeof rule.metadata === 'object' && !Array.isArray(rule.metadata)) ? rule.metadata : {};
  const lastSentKey = metadata.last_sent_date || metadata.last_sent_at || null;
  const todayKey = now.toISOString().slice(0, 10);
  if (lastSentKey && String(lastSentKey).slice(0, 10) === todayKey) {
    return false;
  }

  const adminEmailsRes = await poolRef.query("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL AND TRIM(email) <> ''");
  const adminEmails = adminEmailsRes.rows.map((row) => row.email).filter(Boolean);
  const recipients = getDailySummaryEmailRecipients(rule.recipients || [], adminEmails);
  const toRecipients = recipients.toRecipients.filter(Boolean);
  if (!toRecipients.length) return false;

  const summary = await buildDailyWebsiteSummary({ poolRef });
  const settingsRes = await poolRef.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
  const settings = settingsRes.rows[0] || {};
  const hasSmtp = Boolean(settings.smtp_host || settings.smtp_user || settings.sender_email);
  if (!hasSmtp) return false;

  const subject = `${summary.siteName} daily website summary - ${new Date().toDateString()}`;
  const html = renderDailyWebsiteSummaryHtml(summary);

  await sendMail(settings, {
    to: toRecipients.join(', '),
    bcc: recipients.bccRecipients.length ? recipients.bccRecipients.join(', ') : undefined,
    subject,
    html,
    text: `${summary.siteName} daily website summary. Users: ${summary.totalUsers}, assets: ${summary.totalAssets}, orders: ${summary.totalOrders}, revenue: ${formatCurrency(summary.totalRevenueUsd)} USD (₹${summary.totalRevenueInr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}).`
  });

  const nextMetadata = {
    ...(metadata || {}),
    last_sent_date: todayKey,
    last_sent_at: now.toISOString(),
    schedule_time: scheduleTime,
  };

  await poolRef.query(
    'UPDATE notification_rules SET metadata = COALESCE(metadata, \'' + '{}' + '\'::jsonb) || $1::jsonb, updated_at = now() WHERE id = $2',
    [nextMetadata, rule.id]
  );

  return true;
};

const DEFAULT_BRANDING_CONFIG = {
  heroBadge: "✨ World's Next Creative Marketplace",
  heroHeadingLine1: "Discover Millions of",
  heroHeadingLine2: "Creative Stock Assets",
  heroParagraph: "Browse {totalImages}+ royalty-free photos, vectors, illustrations, PSD files, templates and creative assets from creators around the world.",
  topTab: "React App"
};

const normalizeBrandingConfig = (config) => {
  const nextConfig = { ...DEFAULT_BRANDING_CONFIG, ...(config || {}) };
  const customerBannerFile = path.join(__dirname, "uploads", "branding", "customerBanner.png");
  if (!nextConfig.customerBanner && fs.existsSync(customerBannerFile)) {
    nextConfig.customerBanner = "/api/files/branding/customerBanner.png";
  }
  const contributorBannerFile = path.join(__dirname, "uploads", "branding", "contributorBanner.png");
  if (!nextConfig.contributorBanner && fs.existsSync(contributorBannerFile)) {
    nextConfig.contributorBanner = "/api/files/branding/contributorBanner.png";
  }
  ["logo", "favicon", "watermarkLogo", "watermarkFavicon", "heroBanner", "customerBanner", "contributorBanner", "profileIconCustomer", "profileIconContributor", "profileIconAdmin"].forEach((key) => {
    const value = nextConfig[key];
    if (typeof value === "string" && value.startsWith("/uploads/")) {
      nextConfig[key] = value.replace(/^\/uploads\//, "/api/files/");
    }
  });
  return nextConfig;
};

const removeUploadedBrandingAsset = (assetPath) => {
  if (typeof assetPath !== "string" || !assetPath.trim()) {
    return;
  }

  const normalizedPath = assetPath
    .replace(/^\/+/g, "")
    .replace(/^api\/files\//, "")
    .replace(/^uploads\//, "")
    .replace(/^branding\//, "branding/");

  const uploadsRoot = path.resolve(__dirname, "uploads");
  const assetAbsolutePath = path.resolve(uploadsRoot, normalizedPath);
  const relativeToUploads = path.relative(uploadsRoot, assetAbsolutePath);

  if (!relativeToUploads || relativeToUploads.startsWith("..") || path.isAbsolute(relativeToUploads)) {
    return;
  }

  if (fs.existsSync(assetAbsolutePath) && fs.statSync(assetAbsolutePath).isFile()) {
    fs.unlinkSync(assetAbsolutePath);
  }
};

const getBrandingConfig = () => {
  const brandingFile = path.join(__dirname, "uploads", "branding", "branding.json");
  if (!fs.existsSync(brandingFile)) {
    return normalizeBrandingConfig({});
  }

  try {
    const persisted = JSON.parse(fs.readFileSync(brandingFile, "utf8")) || {};
    return normalizeBrandingConfig(persisted);
  } catch (err) {
    console.error("Failed to read branding config", err.message || err);
    return normalizeBrandingConfig({});
  }
};

const saveBrandingConfig = (nextConfig) => {
  const brandingDir = path.join(__dirname, "uploads", "branding");
  const brandingFile = path.join(brandingDir, "branding.json");
  fs.mkdirSync(brandingDir, { recursive: true });
  fs.writeFileSync(brandingFile, JSON.stringify(normalizeBrandingConfig(nextConfig), null, 2));
};

const getPaymentSettings = () => {
  const paymentDir = path.join(__dirname, "uploads", "payments");
  const paymentFile = path.join(paymentDir, "settings.json");
  if (!fs.existsSync(paymentFile)) {
    return { enabledGateways: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(paymentFile, "utf8")) || {};
    const normalized = parsed && typeof parsed === 'object' ? parsed : {};
    const enabledGateways = Array.isArray(normalized.enabledGateways)
      ? normalized.enabledGateways
      : Object.values(normalized)
          .filter((value) => value && typeof value === 'object' && value.gateway)
          .map((value) => String(value.gateway).trim())
          .filter(Boolean);

    return {
      ...normalized,
      enabledGateways: [...new Set(enabledGateways.map((gateway) => String(gateway).trim()).filter(Boolean))],
    };
  } catch (err) {
    console.error("Failed to read payment settings", err.message || err);
    return { enabledGateways: [] };
  }
};

const savePaymentSettings = (nextConfig) => {
  const paymentDir = path.join(__dirname, "uploads", "payments");
  const paymentFile = path.join(paymentDir, "settings.json");
  fs.mkdirSync(paymentDir, { recursive: true });

  const normalized = nextConfig && typeof nextConfig === 'object' ? nextConfig : {};
  const enabledGateways = Array.isArray(normalized.enabledGateways)
    ? normalized.enabledGateways
    : Object.values(normalized)
        .filter((value) => value && typeof value === 'object' && value.gateway)
        .map((value) => String(value.gateway).trim())
        .filter(Boolean);

  const sanitized = {
    ...normalized,
    enabledGateways: [...new Set(enabledGateways.map((gateway) => String(gateway).trim()).filter(Boolean))],
  };

  fs.writeFileSync(paymentFile, JSON.stringify(sanitized, null, 2));
  return sanitized;
};

const TRANSACTION_SEQUENCE_LIMIT = 9999999999n;

const formatTransactionId = (sequence) => {
  const zeroBasedSequence = sequence - 1n;
  const cycle = zeroBasedSequence / TRANSACTION_SEQUENCE_LIMIT;
  const number = (zeroBasedSequence % TRANSACTION_SEQUENCE_LIMIT) + 1n;
  const cycleNumber = cycle / 26n;
  const cycleLetter = String.fromCharCode(Number(cycle % 26n) + 65);
  return `GFX${cycleNumber}${cycleLetter}${String(number).padStart(10, '0')}`;
};

const getNextTransactionId = async (db = pool) => {
  await db.query('SELECT pg_advisory_xact_lock($1)', [781246]);
  const result = await db.query(`
    SELECT transaction_id
    FROM payments
    WHERE transaction_id ~ '^GFX(SUB)?[0-9]+[A-Z][0-9]{10}$'
    ORDER BY id DESC
    LIMIT 1
  `);
  const match = String(result.rows[0]?.transaction_id || '').match(/^GFX(?:SUB)?(\d+)([A-Z])(\d{10})$/);
  if (!match) return formatTransactionId(1n);

  const currentSequence = (
    (BigInt(match[1]) * 26n + BigInt(match[2].charCodeAt(0) - 65)) * TRANSACTION_SEQUENCE_LIMIT
  ) + BigInt(match[3]);
  return formatTransactionId(currentSequence + 1n);
};

const getSubscriptionOrderNumber = async (db = pool) => {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: '2-digit' }).formatToParts(new Date());
  const day = parts.find((part) => part.type === 'day')?.value || '00';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const year = parts.find((part) => part.type === 'year')?.value || '00';
  const datePrefix = `${day}${month}${year}`;
  const result = await db.query(`SELECT order_number FROM orders WHERE order_number LIKE $1 OR order_number LIKE $2`, [`GFX${datePrefix}-%`, `GFXSUB${datePrefix}-%`]);
  const maxSequence = result.rows.reduce((max, row) => {
    const sequence = Number.parseInt(String(row.order_number || '').split('-').pop(), 10);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return `GFXSUB${datePrefix}-${String(maxSequence + 1).padStart(2, '0')}`;
};

const getSubscriptionInvoiceNumber = async (db = pool) => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const dayAbbr = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthCode = [((now.getMonth() - 2 + 12) % 12), ((now.getMonth() - 1 + 12) % 12), now.getMonth()].map((index) => monthNames[index][0]).join('');
  const prefix = `GFXSUB${dd}${mm}${yy}${dayAbbr}${monthCode}`;
  const existingResult = await db.query(
    `SELECT invoice_number FROM invoices WHERE invoice_number LIKE $1
     UNION ALL
     SELECT invoice_number FROM orders WHERE invoice_number LIKE $1`,
    [`${prefix}%`]
  );
  const maxSequence = existingResult.rows.reduce((max, row) => {
    const sequence = Number.parseInt(String(row.invoice_number || '').slice(prefix.length), 10);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return `${prefix}${String(maxSequence + 1).padStart(2, '0')}`;
};

const DEFAULT_OTP_SETTINGS = {
  default_recipient: "",
  bcc_recipients: "",
  login_subject: "Login OTP",
  registration_subject: "Account Verification OTP",
  recovery_subject: "Password Recovery OTP",
  login_body: "Hello {{full_name}},<br>Your login OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.",
  registration_body: "Hello {{full_name}},<br>Your account verification OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.",
  recovery_body: "Hello {{full_name}},<br>Your password recovery OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.",
  valid_minutes: 10,
};

const getOtpSettings = () => {
  const otpSettingsDir = path.join(__dirname, "uploads");
  const otpSettingsFile = path.join(otpSettingsDir, "otp-settings.json");
  fs.mkdirSync(otpSettingsDir, { recursive: true });

  if (!fs.existsSync(otpSettingsFile)) {
    return { ...DEFAULT_OTP_SETTINGS };
  }

  try {
    const persisted = JSON.parse(fs.readFileSync(otpSettingsFile, "utf8")) || {};
    return {
      ...DEFAULT_OTP_SETTINGS,
      ...persisted,
      valid_minutes: Number(persisted?.valid_minutes ?? DEFAULT_OTP_SETTINGS.valid_minutes) || DEFAULT_OTP_SETTINGS.valid_minutes,
    };
  } catch (err) {
    console.error("Failed to read OTP settings", err.message || err);
    return { ...DEFAULT_OTP_SETTINGS };
  }
};

const saveOtpSettings = (nextConfig = {}) => {
  const otpSettingsDir = path.join(__dirname, "uploads");
  const otpSettingsFile = path.join(otpSettingsDir, "otp-settings.json");
  fs.mkdirSync(otpSettingsDir, { recursive: true });

  const normalizedSettings = {
    ...DEFAULT_OTP_SETTINGS,
    ...nextConfig,
    valid_minutes: Number(nextConfig?.valid_minutes ?? DEFAULT_OTP_SETTINGS.valid_minutes) || DEFAULT_OTP_SETTINGS.valid_minutes,
  };

  fs.writeFileSync(otpSettingsFile, JSON.stringify(normalizedSettings, null, 2));
  return normalizedSettings;
};

const hashCustomSubscriptionOtp = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const sendCustomSubscriptionOtpEmail = async (email, otpCode, fullName = "User") => {
  const otpSettings = getOtpSettings();
  const settingsRes = await pool.query("SELECT * FROM email_settings ORDER BY id DESC LIMIT 1");
  const settings = settingsRes.rows[0] || {};
  const validMinutes = Number(otpSettings.valid_minutes || 10);
  const subject = String(otpSettings.registration_subject || "Account Verification OTP")
    .replace(/{{full_name}}/g, fullName);
  const html = String(otpSettings.registration_body || "Hello {{full_name}},<br>Your account verification OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.")
    .replace(/{{full_name}}/g, fullName)
    .replace(/{{otp}}/g, otpCode)
    .replace(/{{valid_minutes}}/g, String(validMinutes));
  const mailOptions = {
    to: email,
    subject,
    html,
    text: `Hello ${fullName},\nYour account verification OTP is ${otpCode}. This code is valid for ${validMinutes} minutes.`,
  };
  if (otpSettings.bcc_recipients && otpSettings.bcc_recipients.trim()) {
    mailOptions.bcc = otpSettings.bcc_recipients;
  }
  await sendMail(settings, {
    ...mailOptions,
  });
};

const shouldUseOtpDebugFallback = () => {
  const value = String(process.env.OTP_EMAIL_DEBUG || process.env.OTP_DEBUG || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  return process.env.NODE_ENV !== "production";
};

const sendLoginOtpEmail = async (userRow) => {
  try {
    const otpSettings = getOtpSettings();
    const settingsRes = await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    const settings = settingsRes.rows[0] || {};
    const validMinutes = Number(otpSettings.valid_minutes || 10);
    const otpCode = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + validMinutes * 60 * 1000);

    await pool.query(
      `UPDATE users
       SET otp_code = $1,
           otp_context = 'login',
           otp_code_expires_at = $2
       WHERE id = $3`,
      [otpCode, expiresAt, userRow.id]
    );

    const fullName = userRow.full_name || userRow.username || 'User';
    const subject = (otpSettings.login_subject || 'Login OTP').replace(/{{full_name}}/g, fullName);
    const htmlBody = String(otpSettings.login_body || 'Your login OTP is <strong>{{otp}}</strong>.').
      replace(/{{full_name}}/g, fullName).
      replace(/{{otp}}/g, otpCode).
      replace(/{{valid_minutes}}/g, String(validMinutes));
    const textBody = `Hello ${fullName},\nYour login OTP is ${otpCode}. This code is valid for ${validMinutes} minutes.`;

    if (!settings.smtp_host || !settings.smtp_user || !settings.sender_email) {
      const debugFallback = shouldUseOtpDebugFallback();
      if (debugFallback) {
        console.warn(`OTP debug fallback enabled for login. OTP code for ${userRow.email}: ${otpCode}`);
        return { otpCode, expiresAt, sent: true, debugOnly: true };
      }
      return { otpCode, expiresAt, sent: false };
    }

    try {
      await sendMail(settings, {
        to: userRow.email,
        bcc: otpSettings.bcc_recipients || undefined,
        subject,
        html: htmlBody,
        text: textBody,
      });
      return { otpCode, expiresAt, sent: true, debugOnly: false };
    } catch (mailErr) {
      if (shouldUseOtpDebugFallback()) {
        console.warn(`OTP debug fallback enabled after login email failure for ${userRow.email}. Code: ${otpCode}`, {
          error: mailErr.message || mailErr,
        });
        return { otpCode, expiresAt, sent: true, debugOnly: true };
      }
      throw mailErr;
    }
  } catch (err) {
    console.error('Failed to send login OTP email', err.message || err);
    return { sent: false };
  }
};

const sendRegistrationOtpEmail = async (userRow) => {
  try {
    const otpSettings = getOtpSettings();
    const settingsRes = await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    const settings = settingsRes.rows[0] || {};
    const validMinutes = Number(otpSettings.valid_minutes || 10);
    const otpCode = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + validMinutes * 60 * 1000);

    await pool.query(
      `UPDATE users
       SET otp_code = $1,
           otp_context = 'registration',
           otp_code_expires_at = $2
       WHERE id = $3`,
      [otpCode, expiresAt, userRow.id]
    );

    const fullName = userRow.full_name || userRow.username || 'User';
    const subject = (otpSettings.registration_subject || 'Account Verification OTP').replace(/{{full_name}}/g, fullName);
    const htmlBody = String(otpSettings.registration_body || 'Your account verification OTP is <strong>{{otp}}</strong>.').
      replace(/{{full_name}}/g, fullName).
      replace(/{{otp}}/g, otpCode).
      replace(/{{valid_minutes}}/g, String(validMinutes));
    const textBody = `Hello ${fullName},\nYour account verification OTP is ${otpCode}. This code is valid for ${validMinutes} minutes.`;

    if (!settings.smtp_host || !settings.smtp_user || !settings.sender_email) {
      const debugFallback = shouldUseOtpDebugFallback();
      if (debugFallback) {
        console.warn(`OTP debug fallback enabled for registration. OTP code for ${userRow.email}: ${otpCode}`);
        return { otpCode, expiresAt, sent: true, debugOnly: true };
      }
      console.warn('Email settings incomplete - cannot send OTP');
      return { otpCode, expiresAt, sent: false };
    }

    const mailOptions = {
      to: userRow.email,
      subject,
      html: htmlBody,
      text: textBody,
    };

    // Only add BCC if recipients are configured
    if (otpSettings.bcc_recipients && otpSettings.bcc_recipients.trim()) {
      mailOptions.bcc = otpSettings.bcc_recipients;
    }

    console.log(`Sending registration OTP email to ${userRow.email}`);
    try {
      const result = await sendMail(settings, mailOptions);
      console.log(`✅ Registration OTP email sent successfully to ${userRow.email}`, {
        messageId: result.messageId,
        response: result.response,
      });
      return { otpCode, expiresAt, sent: true, debugOnly: false };
    } catch (mailErr) {
      if (shouldUseOtpDebugFallback()) {
        console.warn(`OTP debug fallback enabled after registration email failure for ${userRow.email}. Code: ${otpCode}`, {
          error: mailErr.message || mailErr,
          code: mailErr.code,
          command: mailErr.command,
        });
        return { otpCode, expiresAt, sent: true, debugOnly: true };
      }
      console.error(`❌ Failed to send registration OTP email to ${userRow.email}:`, {
        error: mailErr.message || mailErr,
        code: mailErr.code,
        command: mailErr.command,
      });
      throw mailErr;
    }
  } catch (err) {
    console.error('Failed to send registration OTP email:', err.message || err);
    return { sent: false };
  }
};

const sendRecoveryOtpEmail = async (userRow) => {
  try {
    const otpSettings = getOtpSettings();
    const settingsRes = await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    const settings = settingsRes.rows[0] || {};
    const validMinutes = Number(otpSettings.valid_minutes || 10);
    const otpCode = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + validMinutes * 60 * 1000);

    await pool.query(
      `UPDATE users
       SET otp_code = $1,
           otp_context = 'recovery',
           otp_code_expires_at = $2
       WHERE id = $3`,
      [otpCode, expiresAt, userRow.id]
    );

    const fullName = userRow.full_name || userRow.username || 'User';
    const subject = (otpSettings.recovery_subject || 'Password Recovery OTP').replace(/{{full_name}}/g, fullName);
    const htmlBody = String(otpSettings.recovery_body || 'Your password recovery OTP is <strong>{{otp}}</strong>.').
      replace(/{{full_name}}/g, fullName).
      replace(/{{otp}}/g, otpCode).
      replace(/{{valid_minutes}}/g, String(validMinutes));
    const textBody = `Hello ${fullName},\nYour password recovery OTP is ${otpCode}. This code is valid for ${validMinutes} minutes.`;

    if (!settings.smtp_host && !settings.smtp_user && !settings.sender_email) {
      console.warn('Email settings incomplete - cannot send recovery OTP');
      return { otpCode, expiresAt, sent: false };
    }

    const mailOptions = {
      to: userRow.email,
      subject,
      html: htmlBody,
      text: textBody,
    };
    
    // Only add BCC if recipients are configured
    if (otpSettings.bcc_recipients && otpSettings.bcc_recipients.trim()) {
      mailOptions.bcc = otpSettings.bcc_recipients;
    }

    console.log(`Sending recovery OTP email to ${userRow.email}`);
    try {
      await sendMail(settings, mailOptions);
      console.log(`✅ Recovery OTP email sent successfully to ${userRow.email}`);
    } catch (mailErr) {
      console.error(`❌ Failed to send recovery OTP email to ${userRow.email}:`, mailErr.message || mailErr);
      throw mailErr;
    }

    return { otpCode, expiresAt, sent: true };
  } catch (err) {
    console.error('Failed to send recovery OTP email:', err.message || err);
    return { sent: false };
  }
};

const getClientIp = (req) => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers['x-real-ip'] || req.socket?.remoteAddress || req.ip || 'unknown').trim();
};

const getLoginGeoLocation = async (ipAddress) => {
  const normalizedIp = String(ipAddress || '').replace(/^::ffff:/, '').trim();
  const isPrivate = normalizedIp === 'unknown' || normalizedIp === '127.0.0.1' || normalizedIp === '::1' ||
    /^10\./.test(normalizedIp) || /^192\.168\./.test(normalizedIp) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalizedIp);
  if (isPrivate) return 'Local network (geo unavailable)';
  try {
    const response = await axios.get(`https://ipapi.co/${encodeURIComponent(normalizedIp)}/json/`, { timeout: 1500 });
    const data = response.data || {};
    return [data.city, data.region, data.country_name].filter(Boolean).join(', ') || 'Unknown location';
  } catch (geoError) {
    return 'Unknown location';
  }
};

const createFailedLoginNotification = async ({ username, identifier, reason, ipAddress }) => {
  try {
    const geoLocation = await getLoginGeoLocation(ipAddress);
    const recipients = [];
    if (username) recipients.push(username);
    const admins = await pool.query("SELECT id, username FROM users WHERE role = 'admin' AND username IS NOT NULL");
    recipients.push(...admins.rows.map((row) => row.username));
    const uniqueRecipients = [...new Set(recipients.filter(Boolean))];
    const attemptedUser = username || String(identifier || 'unknown').trim() || 'unknown';
    const source = ipAddress ? ` from ${ipAddress}` : '';
    const message = `Failed login attempt for ${attemptedUser}: ${reason}${source}, geo location: ${geoLocation}.`;
    const recipientUsers = await pool.query(
      'SELECT id, username FROM users WHERE username = ANY($1::text[]) AND username IS NOT NULL',
      [uniqueRecipients]
    );
    await pool.query(
      `INSERT INTO activity_events (event_type, user_id, ip_address, description, metadata, success)
       VALUES ('USER_LOGIN_FAILED', $1, $2, $3, $4, FALSE)`,
      [null, ipAddress || null, message, JSON.stringify({ identifier: String(identifier || '').trim(), username: username || null, reason, geoLocation })]
    );
    for (const recipient of recipientUsers.rows) {
      await pool.query(
        'INSERT INTO notifications (username, message, is_read) VALUES ($1, $2, FALSE)',
        [recipient.username, message]
      );
      await createDirectMessage(pool, {
        senderId: null,
        recipientId: recipient.id,
        subject: 'Failed login',
        body: message,
        messageType: 'SYSTEM_NOTIFICATION',
        priority: 'HIGH'
      });
    }
    const suspiciousResult = await pool.query(
      `SELECT COUNT(*)::int AS attempts
       FROM activity_events
       WHERE event_type = 'USER_LOGIN_FAILED'
         AND created_at >= NOW() - INTERVAL '15 minutes'
         AND (($1 <> '' AND ip_address::text = $1) OR $2 <> '' AND metadata->>'identifier' = $2)`,
      [String(ipAddress || ''), String(identifier || '').trim()]
    );
    if (Number(suspiciousResult.rows[0]?.attempts || 0) === 3) {
      const suspiciousMessage = `Suspicious login activity detected for ${attemptedUser}: 3 failed attempts within 15 minutes${source}, geo location: ${geoLocation}.`;
      for (const admin of admins.rows) {
        await pool.query(
          'INSERT INTO notifications (username, message, is_read) VALUES ($1, $2, FALSE)',
          [admin.username, suspiciousMessage]
        );
      }
    }
  } catch (notificationError) {
    console.error('Failed to create failed-login notification:', notificationError.message || notificationError);
  }
};

const triggerNotificationEvent = async (eventKey, userData, options = {}) => {
  try {
    const eventType = {
      sign_in: 'USER_LOGIN',
      sign_out: 'USER_LOGOUT',
      logout: 'USER_LOGOUT',
      download: 'ASSET_DOWNLOADED',
      favorite: 'ASSET_FAVORITED',
      new_customer: 'USER_REGISTERED',
      new_contributor: 'USER_REGISTERED'
    }[eventKey];
    if (eventType && userData?.id) {
      const adminSessionEvent = userData.role === 'admin' && (eventKey === 'sign_in' || eventKey === 'sign_out');
      if (adminSessionEvent && userData.username) {
        await pool.query(
          'INSERT INTO notifications (username, message, is_read) VALUES ($1, $2, FALSE)',
          [userData.username, eventKey === 'sign_in' ? 'Admin login detected.' : 'Admin logout detected.']
        );

      }
      await recordBusinessEvent(pool, eventType, {
        userId: userData.id,
        userRole: userData.role,
        email: userData.email,
        skipAssetNotification: eventType === 'ASSET_DOWNLOADED',
        notificationOnly: adminSessionEvent,
        ipAddress: options.ipAddress,
        assetId: options.assetId,
        orderId: options.orderId,
        description: options.description
      });
      return;
    }
    const normalizedEventKey = resolveNotificationEventKey(eventKey);
    const email = userData?.email || options?.email;
    if (!email) return;
    const ruleRes = await pool.query(
      "SELECT * FROM notification_rules WHERE event_key = $1 AND enable_email IS NOT FALSE",
      [normalizedEventKey]
    );
    const rule = ruleRes.rows[0];
    if (!rule) return;

    const settingsRes = await pool.query(
      "SELECT * FROM email_settings ORDER BY id DESC LIMIT 1"
    );
    const settings = settingsRes.rows[0] || {};
    const hasSmtp = Boolean(settings.smtp_host || settings.smtp_user || settings.sender_email);
    if (!hasSmtp) return;

    const adminEmailsRes = await pool.query(
      "SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL AND TRIM(email) <> ''"
    );
    const adminEmails = adminEmailsRes.rows.map((row) => row.email).filter(Boolean);

    console.log('NOTIFY_TRACE', { eventKey: normalizedEventKey, email, ruleRecipients: rule.recipients });

    const resolvedRecipients = normalizeRecipients(Array.isArray(rule.recipients) ? rule.recipients : [])
      .flatMap((recipient) => {
        if (recipient === '{{customer_email}}' || recipient === '{{contributor_email}}') {
          return [userData.email];
        }
        if (recipient === '{{user_name}}') {
          return [userData.full_name || userData.username || userData.email];
        }
        if (recipient === '{{first_name}}') {
          const firstName = String(userData.full_name || userData.username || userData.email || '').split(/\s+/)[0];
          return [firstName || userData.email];
        }
        if (recipient === '{{admin_email}}' || recipient === '{{admins}}') {
          return adminEmails;
        }
        return [recipient];
      });

    const toRecipients = [...new Set(resolvedRecipients.filter((recipient) => !String(recipient).startsWith('bcc:')).filter(Boolean))];
    const bccRecipients = [...new Set(resolvedRecipients.filter((recipient) => String(recipient).startsWith('bcc:')).map((recipient) => recipient.replace(/^bcc:/, '')).filter(Boolean))];
    const finalRecipients = [...toRecipients, ...bccRecipients];
    console.log('NOTIFY_TRACE_RECIPIENTS', { toRecipients, bccRecipients, finalRecipients });
    if (!finalRecipients.length) return;

    const eventLabelMap = {
      new_contributor: 'New Contributor Registered',
      new_customer: 'New Customer Registered',
      sign_in: 'User Signed In',
      sign_out: 'User Signed Out',
      logout: 'User Logged Out',
      download: 'Image Downloaded',
      favorite: 'Asset Liked / Favorited'
    };
    const eventLabel = eventLabelMap[normalizedEventKey] || normalizedEventKey.replace(/_/g, ' ');
    const displayName = userData?.full_name || userData?.username || email || 'User';
    const activityDetails = normalizedEventKey === 'sign_out' || normalizedEventKey === 'logout'
      ? 'User signed out of the platform.'
      : normalizedEventKey === 'sign_in'
      ? 'User signed in to the platform.'
      : normalizedEventKey === 'download'
      ? 'User downloaded an image from the platform.'
      : normalizedEventKey === 'favorite'
      ? 'A user liked or favorited an asset.'
      : 'A new account was created on the platform.';
    const timestamp = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    }).format(new Date()).replace('GMT+5:30', 'IST');
    const template = rule?.template_id ? (await pool.query('SELECT subject, body FROM email_templates WHERE id = $1', [rule.template_id])).rows[0] : null;
    const content = buildNotificationEmailContent({
      eventKey: normalizedEventKey,
      eventLabel,
      activityDetails,
      displayName,
      email,
      template,
      userData: userData || {},
      templateData: {
        asset_title: options?.assetTitle || userData?.assetTitle || 'your asset',
        download_link: options?.downloadLink || '#',
        site_name: 'GFXunlimit'
      }
    });
    const subject = `${content.subject} - ${timestamp}`;
    const html = content.html;

    try {
      const trackedHtml = require('./email/newsletterTracking').injectTrackingIntoHtml(html, 0, email, process.env.APP_URL || 'http://localhost:5000');
      await sendMail(settings, {
        to: toRecipients.join(', '),
        bcc: bccRecipients.length ? bccRecipients.join(', ') : undefined,
        subject,
        html: trackedHtml,
        text: `${eventLabel}\nName: ${displayName}\nEmail: ${email}`
      });
      await pool.query(
        'INSERT INTO email_logs(recipient, subject, body, status, delivered_at, created_at) VALUES($1,$2,$3,$4, now(), now())',
        [toRecipients.join(', '), subject, trackedHtml, 'delivered']
      );

      if (email) {
        await pool.query(
          `INSERT INTO newsletter_tracking(campaign_id, recipient, status, created_at)
           VALUES($1, $2, 'delivered', now())
           ON CONFLICT (campaign_id, recipient)
           DO UPDATE SET status = 'delivered', created_at = LEAST(newsletter_tracking.created_at, now())`,
          [0, email]
        );
      }
    } catch (sendErr) {
      await pool.query(
        'INSERT INTO email_logs(recipient, subject, body, status, error_message, created_at) VALUES($1,$2,$3,$4,$5, now())',
        [toRecipients.join(', '), subject, html, 'failed', sendErr.message || String(sendErr)]
      );
      throw sendErr;
    }
  } catch (err) {
    console.error('Notification trigger failed', err);
  }
};

app.get("/branding", async (req, res) => {
  res.json(getBrandingConfig());
});

const pickUploadedFile = (files, fieldName) => {
  if (!Array.isArray(files)) {
    return null;
  }

  return files.find((file) => file && file.fieldname === fieldName) || null;
};

app.post(
  "/admin/branding",
  verifyAdmin,
  handleBrandingUpload,
  async (req, res) => {
    try {
      const nextConfig = { ...getBrandingConfig() };
      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      const logoFile = pickUploadedFile(uploadedFiles, "logo");
      const faviconFile = pickUploadedFile(uploadedFiles, "favicon");
      const watermarkLogoFile = pickUploadedFile(uploadedFiles, "watermarkLogo");
      const watermarkFaviconFile = pickUploadedFile(uploadedFiles, "watermarkFavicon");
      const heroBannerFile = pickUploadedFile(uploadedFiles, "heroBanner");
      const customerBannerFile = pickUploadedFile(uploadedFiles, "customerBanner");
      const contributorBannerFile = pickUploadedFile(uploadedFiles, "contributorBanner");
      const profileIconCustomerFile = pickUploadedFile(uploadedFiles, "profileIconCustomer");
      const profileIconContributorFile = pickUploadedFile(uploadedFiles, "profileIconContributor");
      const profileIconAdminFile = pickUploadedFile(uploadedFiles, "profileIconAdmin");

      if (logoFile) {
        nextConfig.logo = `/api/files/branding/${logoFile.filename}`;
      }

      if (faviconFile) {
        nextConfig.favicon = `/api/files/branding/${faviconFile.filename}`;
      }

      if (watermarkLogoFile) {
        nextConfig.watermarkLogo = `/api/files/branding/${watermarkLogoFile.filename}`;
      }

      if (watermarkFaviconFile) {
        nextConfig.watermarkFavicon = `/api/files/branding/${watermarkFaviconFile.filename}`;
      }

      if (heroBannerFile) {
        nextConfig.heroBanner = `/api/files/branding/${heroBannerFile.filename}`;
      }

      if (customerBannerFile) {
        nextConfig.customerBanner = `/api/files/branding/${customerBannerFile.filename}`;
      }

      if (contributorBannerFile) {
        nextConfig.contributorBanner = `/api/files/branding/${contributorBannerFile.filename}`;
      }

      if (profileIconCustomerFile) {
        nextConfig.profileIconCustomer = `/api/files/branding/${profileIconCustomerFile.filename}`;
      }

      if (profileIconContributorFile) {
        nextConfig.profileIconContributor = `/api/files/branding/${profileIconContributorFile.filename}`;
      }

      if (profileIconAdminFile) {
        nextConfig.profileIconAdmin = `/api/files/branding/${profileIconAdminFile.filename}`;
      }

      if (profileIconCustomerFile || profileIconContributorFile || profileIconAdminFile) {
        nextConfig.profileIconsVersion = Date.now();
      }

      // Accept optional hero text fields from the branding form
      try {
        if (req.body && typeof req.body === 'object') {
          if (typeof req.body.heroBadge === 'string') nextConfig.heroBadge = req.body.heroBadge;
          if (typeof req.body.heroHeadingLine1 === 'string') nextConfig.heroHeadingLine1 = req.body.heroHeadingLine1;
          if (typeof req.body.heroHeadingLine2 === 'string') nextConfig.heroHeadingLine2 = req.body.heroHeadingLine2;
          if (typeof req.body.heroParagraph === 'string') nextConfig.heroParagraph = req.body.heroParagraph;
          if (typeof req.body.topTab === 'string') nextConfig.topTab = req.body.topTab;
        }
      } catch (err) {
        console.warn('Failed to read hero text fields from request body', err.message || err);
      }

      saveBrandingConfig(nextConfig);
      res.json(nextConfig);
    } catch (err) {
      console.error("Failed to update branding", err.message || err);
      res.status(500).json({ error: err.message || "Failed to update branding" });
    }
  }
);

app.post(
  "/admin/branding/profile-icons",
  verifyAdmin,
  (req, res, next) => {
    profileIconUpload.fields([
      { name: "profileIconCustomer", maxCount: 1 },
      { name: "profileIconContributor", maxCount: 1 },
      { name: "profileIconAdmin", maxCount: 1 }
    ])(req, res, (err) => {
      if (err) {
        console.error("Profile icon upload error", err.message || err);
        return res.status(400).json({ error: err.message || "Profile icon upload failed" });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const nextConfig = { ...getBrandingConfig() };
      const uploadedFiles = req.files || {};
      const customerFile = uploadedFiles.profileIconCustomer?.[0];
      const contributorFile = uploadedFiles.profileIconContributor?.[0];
      const adminFile = uploadedFiles.profileIconAdmin?.[0];

      if (!customerFile && !contributorFile && !adminFile) {
        return res.status(400).json({ error: "Choose at least one profile icon PNG to upload." });
      }

      if (customerFile) nextConfig.profileIconCustomer = `/api/files/branding/${customerFile.filename}`;
      if (contributorFile) nextConfig.profileIconContributor = `/api/files/branding/${contributorFile.filename}`;
      if (adminFile) nextConfig.profileIconAdmin = `/api/files/branding/${adminFile.filename}`;
      nextConfig.profileIconsVersion = Date.now();
      saveBrandingConfig(nextConfig);
      res.json(nextConfig);
    } catch (err) {
      console.error("Failed to save profile icons", err.message || err);
      res.status(500).json({ error: err.message || "Failed to save profile icons" });
    }
  }
);

app.delete("/admin/branding/profile-icons", verifyAdmin, async (req, res) => {
  try {
    const nextConfig = { ...getBrandingConfig() };
    ["profileIconCustomer", "profileIconContributor", "profileIconAdmin"].forEach((key) => {
      removeUploadedBrandingAsset(nextConfig[key]);
      delete nextConfig[key];
    });
    saveBrandingConfig(nextConfig);
    res.json(nextConfig);
  } catch (err) {
    console.error("Failed to restore default profile icons", err.message || err);
    res.status(500).json({ error: err.message || "Failed to restore default profile icons" });
  }
});

app.delete("/admin/branding/hero-banner", verifyAdmin, async (req, res) => {
  try {
    const nextConfig = { ...getBrandingConfig() };
    removeUploadedBrandingAsset(nextConfig.heroBanner);
    delete nextConfig.heroBanner;
    saveBrandingConfig(nextConfig);
    res.json(nextConfig);
  } catch (err) {
    console.error("Failed to reset hero banner", err.message || err);
    res.status(500).json({ error: err.message || "Failed to reset hero banner" });
  }
});

app.post("/admin/backup/create", verifyAdmin, async (req, res) => {
  try {
    const generatedBackupId = buildUniqueBackupId();
    const backupId = req.body?.backupId || generatedBackupId;
    const mode = req.body?.mode === "complete" ? "Complete Backup" : "Incremental Backup";
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const dateRange = normalizeBackupDateRange(req.body?.from || defaultFrom, req.body?.to || now.toISOString(), now);
    const from = dateRange.from;
    const to = dateRange.to;
    const deviceId = normalizeDeviceId(req.body?.deviceId || "");
    const previousBackupId = req.body?.previousBackupId || "none";

    const archive = await createGfxBackupPackage({ backupId, mode, from, to, deviceId, previousBackupId });

    res.json({
      backupId: archive.backupId,
      mode,
      from,
      to,
      deviceId: archive.deviceId,
      filePath: archive.relativePath,
      fileName: archive.fileName,
      createdAt: archive.createdAt,
      packageSize: archive.fileSize,
      fileCounts: archive.manifest?.files || { new: 0, modified: 0, unchanged: 0 },
      assetCounts: archive.manifest?.assets || { new: 0, modified: 0 },
      databaseCounts: {
        newRecords: archive.manifest?.database?.newRecords || 0,
        updatedRecords: archive.manifest?.database?.updatedRecords || 0
      },
      downloadUrl: `/admin/backup/download?file=${encodeURIComponent(archive.relativePath)}`,
      saveLocation: archive.relativePath,
      incremental: mode === "Incremental Backup",
      previousBackupId,
      changedFileCount: (archive.manifest?.files?.new || 0) + (archive.manifest?.files?.modified || 0),
      changedTables: archive.database?.changedTables || []
    });
  } catch (error) {
    console.error("Failed to create backup archive", error);
    res.status(500).json({ error: error.message || "Failed to create backup archive" });
  }
});

app.get("/admin/backup/list", verifyAdmin, async (req, res) => {
  try {
    const backupRoot = path.resolve(__dirname, "backup");
    if (!fs.existsSync(backupRoot)) {
      return res.json([]);
    }

    const files = fs.readdirSync(backupRoot, { recursive: true, withFileTypes: true });
    const backupEntries = [];

    for (const entry of files) {
      const absolutePath = path.join(entry.parentPath || backupRoot, entry.name);
      const relativePath = path.relative(__dirname, absolutePath).split(path.sep).join("/");
      if (!entry.isFile() || !absolutePath.endsWith(".gfxbackup")) {
        continue;
      }

      const stat = fs.statSync(absolutePath);
      const createdAt = new Date(stat.mtimeMs).toISOString();

      let dateFrom = null;
      let dateTo = null;
      let mode = "Incremental Backup";
      let fileCount = 0;
      let databaseRecordCount = 0;

      // Try to extract date range from backup manifest
      try {
        const zip = new AdmZip(absolutePath);
        const manifestEntry = zip.getEntry("manifest.json");
        if (manifestEntry) {
          const manifestContent = zip.readAsText(manifestEntry);
          const manifest = JSON.parse(manifestContent);
          dateFrom = manifest.from || null;
          dateTo = manifest.to || null;
          mode = manifest.backupType || manifest.mode || "Incremental Backup";
          fileCount = (manifest.files?.new || 0) + (manifest.files?.modified || 0) + (manifest.files?.unchanged || 0);
          databaseRecordCount = manifest.database?.recordCount
            ?? ((manifest.database?.newRecords || 0) + (manifest.database?.updatedRecords || 0));
        }
      } catch (manifestError) {
        // Silently ignore if manifest cannot be read
      }

      backupEntries.push({
        fileName: path.basename(absolutePath),
        filePath: relativePath,
        relativePath,
        createdAt,
        size: stat.size,
        mode,
        backupId: path.basename(absolutePath, ".gfxbackup"),
        fileCount,
        databaseRecordCount,
        dateFrom,
        dateTo,
        // Include old field names for backward compatibility
        from: dateFrom,
        to: dateTo
      });
    }

    backupEntries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(backupEntries);
  } catch (error) {
    console.error("Failed to list backup archives", error);
    res.status(500).json({ error: error.message || "Failed to list backup archives" });
  }
});

app.get("/admin/backup/download", verifyAdmin, async (req, res) => {
  try {
    const resolved = resolveBackupArchivePath(req.query.file);
    if (resolved.error) {
      return res.status(resolved.error === "Missing backup file path" ? 400 : 403).json({ error: resolved.error });
    }
    if (!fs.existsSync(resolved.absolutePath) || !fs.statSync(resolved.absolutePath).isFile()) {
      return res.status(404).json({ error: "Backup file not found" });
    }

    res.download(resolved.absolutePath, path.basename(resolved.absolutePath));
  } catch (error) {
    console.error("Failed to download backup archive", error);
    res.status(500).json({ error: error.message || "Failed to download backup archive" });
  }
});

app.delete("/admin/backup/delete", verifyAdmin, async (req, res) => {
  try {
    const resolved = resolveBackupArchivePath(req.query.file);
    if (resolved.error) {
      return res.status(resolved.error === "Missing backup file path" ? 400 : 403).json({ error: resolved.error });
    }
    if (!fs.existsSync(resolved.absolutePath) || !fs.statSync(resolved.absolutePath).isFile()) {
      return res.status(404).json({ error: "Backup file not found" });
    }

    fs.unlinkSync(resolved.absolutePath);
    res.json({ success: true, message: "Backup file deleted successfully" });
  } catch (error) {
    console.error("Failed to delete backup archive", error);
    res.status(500).json({ error: error.message || "Failed to delete backup archive" });
  }
});

app.get("/admin/payment-settings", verifyAdmin, async (req, res) => {
  try {
    res.json(getPaymentSettings());
  } catch (err) {
    console.error("Failed to read payment settings", err.message || err);
    res.status(500).json({ error: err.message || "Failed to read payment settings" });
  }
});

app.get("/payment-settings", async (req, res) => {
  try {
    const paymentSettings = getPaymentSettings();
    res.json({
      enabledGateways: paymentSettings.enabledGateways || [],
      googlePayId: paymentSettings["google pay"]?.identifier || ""
    });
  } catch (err) {
    console.error("Failed to read public payment settings", err.message || err);
    res.status(500).json({ error: err.message || "Failed to read public payment settings" });
  }
});

app.post("/admin/payment-settings", verifyAdmin, async (req, res) => {
  try {
    const previousSettings = getPaymentSettings();
    const deleteGateway = typeof req.body?.deleteGateway === "string"
      ? req.body.deleteGateway.trim()
      : "";
    const enabledGateways = Array.isArray(req.body?.enabledGateways)
      ? req.body.enabledGateways
      : null;

    if (deleteGateway) {
      const gatewayKey = deleteGateway.toLowerCase();
      const deletedGateways = [...new Set([
        ...(Array.isArray(previousSettings.deletedGateways) ? previousSettings.deletedGateways : []),
        deleteGateway
      ])];
      const nextConfig = { ...previousSettings, deletedGateways };
      delete nextConfig[gatewayKey];
      nextConfig.enabledGateways = (previousSettings.enabledGateways || [])
        .filter((gateway) => String(gateway).toLowerCase() !== gatewayKey);

      const saved = savePaymentSettings(nextConfig);
      await recordAdminAudit(
        req,
        'ADMIN_PAYMENT_UPDATED',
        `Admin deleted payment gateway ${deleteGateway}`,
        { gateway: deleteGateway, configured: Boolean(previousSettings[gatewayKey]) },
        { gateway: deleteGateway, deleted: true },
        { action: 'payment_gateway_deleted' }
      );
      return res.json(saved);
    }

    if (enabledGateways) {
      const nextConfig = {
        ...previousSettings,
        enabledGateways: [...new Set(enabledGateways.map((gateway) => String(gateway).trim()).filter(Boolean))],
      };

      const saved = savePaymentSettings(nextConfig);
      await recordAdminAudit(
        req,
        'ADMIN_PAYMENT_UPDATED',
        'Admin changed enabled payment gateways',
        { previousEnabledGateways: previousSettings.enabledGateways || [] },
        { enabledGateways: saved.enabledGateways || [] },
        { action: 'payment_gateways_changed' }
      );
      return res.json(saved);
    }

    const gateway = req.body?.gateway;
    const identifier = req.body?.identifier;
    if (!gateway || !identifier) {
      return res.status(400).json({ error: "Gateway and identifier are required or enabledGateways must be provided" });
    }

    const nextConfig = { ...getPaymentSettings(), [gateway.toLowerCase()]: { gateway, identifier } };
    const saved = savePaymentSettings(nextConfig);
    await recordAdminAudit(req, 'ADMIN_PAYMENT_UPDATED', `Admin changed payment configuration for ${gateway}`, { gateway: previousSettings[gateway.toLowerCase()]?.gateway || null, configured: Boolean(previousSettings[gateway.toLowerCase()]) }, { gateway, configured: true }, { action: 'payment_settings_changed' });
    res.json(saved);
  } catch (err) {
    console.error("Failed to save payment settings", err.message || err);
    res.status(500).json({ error: err.message || "Failed to save payment settings" });
  }
});

app.get("/admin/otp-settings", verifyAdmin, async (req, res) => {
  try {
    res.json(getOtpSettings());
  } catch (err) {
    console.error("Failed to read OTP settings", err.message || err);
    res.status(500).json({ error: err.message || "Failed to read OTP settings" });
  }
});

app.post("/admin/otp-settings", verifyAdmin, async (req, res) => {
  try {
    const nextConfig = {
      ...getOtpSettings(),
      ...req.body,
      valid_minutes: Number(req.body?.valid_minutes ?? getOtpSettings().valid_minutes) || 10,
    };

    if (req.body?.default_recipient !== undefined && typeof req.body.default_recipient !== "string") {
      return res.status(400).json({ error: "default_recipient must be a string" });
    }

    if (req.body?.bcc_recipients !== undefined && typeof req.body.bcc_recipients !== "string") {
      return res.status(400).json({ error: "bcc_recipients must be a string" });
    }

    const saved = saveOtpSettings(nextConfig);
    res.json(saved);
  } catch (err) {
    console.error("Failed to save OTP settings", err.message || err);
    res.status(500).json({ error: err.message || "Failed to save OTP settings" });
  }
});

// Card layout preferences - per admin user
app.get("/admin/card-layout-preferences", verifyAdmin, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await pool.query(
      'SELECT card_layout_preferences FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const preferences = result.rows[0].card_layout_preferences;
    res.json(preferences || {});
  } catch (err) {
    console.error("Failed to load card layout preferences", err.message || err);
    res.status(500).json({ error: err.message || "Failed to load preferences" });
  }
});

app.post("/admin/card-layout-preferences", verifyAdmin, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { cardOrder } = req.body;
    if (!Array.isArray(cardOrder)) {
      return res.status(400).json({ error: "cardOrder must be an array" });
    }

    await pool.query(
      'UPDATE users SET card_layout_preferences = $1 WHERE id = $2',
      [JSON.stringify({ cardOrder }), userId]
    );

    res.json({ success: true, cardOrder });
  } catch (err) {
    console.error("Failed to save card layout preferences", err.message || err);
    res.status(500).json({ error: err.message || "Failed to save preferences" });
  }
});

app.get("/admin/settings/pricing", verifySuperAdmin, async (req, res) => {
  try {
    const settingsRes = await pool.query('SELECT * FROM pricing_settings ORDER BY id DESC LIMIT 1');
    const settings = settingsRes.rows[0] || {
      enable_global_minimum_pricing: false,
      default_currency: 'INR',
      exchange_rate: null,
      auto_update_exchange_rate: false,
      prevent_pricing_below_minimum: false,
      automatically_increase_lower_priced_assets: false,
      display_warning_during_contributor_upload: false,
      allow_admins_bypass_minimum_pricing: false,
      inr_amount: 0,
      usd_amount: 0,
      eur_amount: 0,
      minimum_price_inr: 0,
      minimum_price_usd: 0,
      custom_currency_rows: [],
      tax_settings: []
    };
    if (settings.custom_currency_rows && typeof settings.custom_currency_rows === 'string') {
      try { settings.custom_currency_rows = JSON.parse(settings.custom_currency_rows); } catch(e) { settings.custom_currency_rows = []; }
    }
    if (settings.tax_settings && typeof settings.tax_settings === 'string') {
      try { settings.tax_settings = JSON.parse(settings.tax_settings); } catch(e) { settings.tax_settings = []; }
    }
    
    // Fetch live exchange rates
    let liveRates = {};
    try {
      const response = await axios.get('https://api.exchangerate-api.com/v4/latest/INR', { timeout: 10000 });
      liveRates = response.data?.rates || {};
      console.log('✅ Live rates fetched for GET /admin/settings/pricing:', Object.keys(liveRates).slice(0, 5));
    } catch (err) {
      console.error('❌ Failed to fetch live rates for pricing:', err.message);
    }
    
    res.json({ ...settings, liveRates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load pricing settings' });
  }
});

app.post("/admin/settings/pricing", verifySuperAdmin, async (req, res) => {
  try {
    const {
      enable_global_minimum_pricing,
      default_currency,
      exchange_rate,
      auto_update_exchange_rate,
      prevent_pricing_below_minimum,
      automatically_increase_lower_priced_assets,
      display_warning_during_contributor_upload,
      allow_admins_bypass_minimum_pricing,
      minimum_price_inr,
      minimum_price_usd,
      inr_amount,
      usd_amount,
      eur_amount,
      custom_currency_rows,
      tax_settings
    } = req.body;

    const customRowsJson = JSON.stringify(Array.isArray(custom_currency_rows) ? custom_currency_rows : []);
    const taxSettingsJson = JSON.stringify(Array.isArray(tax_settings) ? tax_settings : []);

    const inserted = await pool.query(
      `INSERT INTO pricing_settings(
        enable_global_minimum_pricing,
        default_currency,
        exchange_rate,
        auto_update_exchange_rate,
        prevent_pricing_below_minimum,
        automatically_increase_lower_priced_assets,
        display_warning_during_contributor_upload,
        allow_admins_bypass_minimum_pricing,
        minimum_price_inr,
        minimum_price_usd,
        inr_amount,
        usd_amount,
        eur_amount,
        custom_currency_rows,
        tax_settings,
        updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now()) RETURNING *`,
      [
        !!enable_global_minimum_pricing,
        default_currency || 'INR',
        exchange_rate || null,
        !!auto_update_exchange_rate,
        !!prevent_pricing_below_minimum,
        !!automatically_increase_lower_priced_assets,
        !!display_warning_during_contributor_upload,
        !!allow_admins_bypass_minimum_pricing,
        Number(minimum_price_inr) || 0,
        Number(minimum_price_usd) || 0,
        Number(inr_amount) || 0,
        Number(usd_amount) || 0,
        Number(eur_amount) || 0,
        customRowsJson,
        taxSettingsJson
      ]
    );

    // Fetch live exchange rates to include in response
    let liveRates = {};
    try {
      const response = await axios.get('https://api.exchangerate-api.com/v4/latest/INR', { timeout: 10000 });
      liveRates = response.data?.rates || {};
      console.log('✅ Live rates fetched for POST /admin/settings/pricing:', Object.keys(liveRates).slice(0, 5));
    } catch (err) {
      console.error('❌ Failed to fetch live rates after save:', err.message);
    }

    res.json({ ...inserted.rows[0], liveRates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save pricing settings' });
  }
});

app.get("/admin/settings/credit-price", verifySuperAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT credit_prices FROM credit_price_settings ORDER BY id DESC LIMIT 1');
    res.json({ credit_prices: result.rows[0]?.credit_prices || { 100: 100, 200: 200, 500: 500, 1000: 1000 } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load credit price' });
  }
});

app.post("/admin/settings/credit-price", verifySuperAdmin, async (req, res) => {
  try {
    const creditPrices = req.body?.credit_prices;
    const creditAmounts = [100, 200, 500, 1000];
    if (!creditPrices || typeof creditPrices !== 'object' || creditAmounts.some((amount) => !Number.isFinite(Number(creditPrices[amount])) || Number(creditPrices[amount]) <= 0)) {
      return res.status(400).json({ error: 'Each credit price must be greater than zero' });
    }

    const result = await pool.query(
      'INSERT INTO credit_price_settings (price_inr, credit_prices, updated_at) VALUES ($1, $2, now()) RETURNING credit_prices',
      [Number(creditPrices[100]), JSON.stringify(Object.fromEntries(creditAmounts.map((amount) => [amount, Number(creditPrices[amount])]))) ]
    );
    res.json({ credit_prices: result.rows[0].credit_prices });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save credit price' });
  }
});

// Manual currency update endpoint (for admins to trigger update on-demand)
app.post("/admin/settings/currency-update", async (req, res) => {
  try {
    const { updateCurrencyRates } = require('./currency/currencyScheduler');
    console.log('Currency update triggered manually');
    const result = await updateCurrencyRates(pool);
    
    if (result) {
      console.log('Currency update successful:', result);
      res.json({ success: true, message: 'Currency rates updated successfully', data: result });
    } else {
      console.log('Currency update failed - no result');
      res.status(400).json({ success: false, message: 'Failed to fetch or update exchange rates' });
    }
  } catch (err) {
    console.error('Manual currency update error:', err);
    res.status(500).json({ error: 'Failed to update currency rates', details: err.message });
  }
});

// Get live exchange rates endpoint (for admin panel conversion display)
app.get("/admin/settings/live-rates", verifySuperAdmin, async (req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.get('https://api.exchangerate-api.com/v4/latest/INR', { timeout: 10000 });
    const rates = response.data?.rates || {};
    res.json({ success: true, rates });
  } catch (err) {
    console.error('Failed to fetch live exchange rates:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch live exchange rates' });
  }
});

// Public endpoint for credit package pricing
app.get("/settings/credit-price", async (req, res) => {
  try {
    const result = await pool.query('SELECT credit_prices FROM credit_price_settings ORDER BY id DESC LIMIT 1');
    res.json({ credit_prices: result.rows[0]?.credit_prices || { 100: 100, 200: 200, 500: 500, 1000: 1000 } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load credit prices' });
  }
});

// Public endpoint for pricing settings (for cart and pricing display)
app.get("/settings/pricing", async (req, res) => {
  try {
    const settingsRes = await pool.query('SELECT * FROM pricing_settings ORDER BY id DESC LIMIT 1');
    const settings = settingsRes.rows[0] || {
      enable_global_minimum_pricing: false,
      default_currency: 'INR',
      exchange_rate: null,
      auto_update_exchange_rate: false,
      prevent_pricing_below_minimum: false,
      automatically_increase_lower_priced_assets: false,
      display_warning_during_contributor_upload: false,
      allow_admins_bypass_minimum_pricing: false,
      inr_amount: 0,
      usd_amount: 0,
      eur_amount: 0,
      minimum_price_inr: 0,
      minimum_price_usd: 0,
      custom_currency_rows: [],
      tax_settings: []
    };
    if (settings.custom_currency_rows && typeof settings.custom_currency_rows === 'string') {
      try { settings.custom_currency_rows = JSON.parse(settings.custom_currency_rows); } catch(e) { settings.custom_currency_rows = []; }
    }
    if (settings.tax_settings && typeof settings.tax_settings === 'string') {
      try { settings.tax_settings = JSON.parse(settings.tax_settings); } catch(e) { settings.tax_settings = []; }
    }
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load pricing settings' });
  }
});

app.get("/admin/settings/free-assets", verifySuperAdmin, async (req, res) => {
  try {
    const settingsRes = await pool.query('SELECT * FROM free_asset_settings ORDER BY id DESC LIMIT 1');
    const settings = settingsRes.rows[0] || {
      enable_free_assets: false,
      max_free_assets_allowed: null,
      max_free_downloads_per_user: null,
      daily_free_download_limit: null,
      monthly_free_download_limit: null,
      allow_guests_to_download_free_assets: false,
      require_login_for_free_assets: false,
      require_email_verification: false,
      free_asset_source: 'admin_only',
      allow_contributors_to_request_free_status: false,
      automatically_feature_selected_free_assets: false,
      free_asset_duration: 'permanent',
      free_asset_start_date: null,
      free_asset_end_date: null,
      show_free_badge: false,
      show_free_collection: false,
      highlight_on_homepage: false,
      highlight_in_search: false,
      highlight_in_categories: false,
      track_free_downloads: false,
      track_most_downloaded_free_assets: false,
      track_top_free_contributors: false,
      track_free_conversion_rate: false
    };
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load free asset settings' });
  }
});

app.post("/admin/settings/free-assets", verifySuperAdmin, async (req, res) => {
  try {
    const payload = {
      enable_free_assets: !!req.body.enable_free_assets,
      max_free_assets_allowed: req.body.max_free_assets_allowed || null,
      max_free_downloads_per_user: req.body.max_free_downloads_per_user || null,
      daily_free_download_limit: req.body.daily_free_download_limit || null,
      monthly_free_download_limit: req.body.monthly_free_download_limit || null,
      allow_guests_to_download_free_assets: !!req.body.allow_guests_to_download_free_assets,
      require_login_for_free_assets: !!req.body.require_login_for_free_assets,
      require_email_verification: !!req.body.require_email_verification,
      free_asset_source: req.body.free_asset_source || 'admin_only',
      allow_contributors_to_request_free_status: !!req.body.allow_contributors_to_request_free_status,
      automatically_feature_selected_free_assets: !!req.body.automatically_feature_selected_free_assets,
      free_asset_duration: req.body.free_asset_duration || 'permanent',
      free_asset_start_date: req.body.free_asset_start_date || null,
      free_asset_end_date: req.body.free_asset_end_date || null,
      show_free_badge: !!req.body.show_free_badge,
      show_free_collection: !!req.body.show_free_collection,
      highlight_on_homepage: !!req.body.highlight_on_homepage,
      highlight_in_search: !!req.body.highlight_in_search,
      highlight_in_categories: !!req.body.highlight_in_categories,
      track_free_downloads: !!req.body.track_free_downloads,
      track_most_downloaded_free_assets: !!req.body.track_most_downloaded_free_assets,
      track_top_free_contributors: !!req.body.track_top_free_contributors,
      track_free_conversion_rate: !!req.body.track_free_conversion_rate
    };

    const inserted = await pool.query(
      `INSERT INTO free_asset_settings(
        enable_free_assets,
        max_free_assets_allowed,
        max_free_downloads_per_user,
        daily_free_download_limit,
        monthly_free_download_limit,
        allow_guests_to_download_free_assets,
        require_login_for_free_assets,
        require_email_verification,
        free_asset_source,
        allow_contributors_to_request_free_status,
        automatically_feature_selected_free_assets,
        free_asset_duration,
        free_asset_start_date,
        free_asset_end_date,
        show_free_badge,
        show_free_collection,
        highlight_on_homepage,
        highlight_in_search,
        highlight_in_categories,
        track_free_downloads,
        track_most_downloaded_free_assets,
        track_top_free_contributors,
        track_free_conversion_rate,
        updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, now()) RETURNING *`,
      [
        payload.enable_free_assets,
        payload.max_free_assets_allowed,
        payload.max_free_downloads_per_user,
        payload.daily_free_download_limit,
        payload.monthly_free_download_limit,
        payload.allow_guests_to_download_free_assets,
        payload.require_login_for_free_assets,
        payload.require_email_verification,
        payload.free_asset_source,
        payload.allow_contributors_to_request_free_status,
        payload.automatically_feature_selected_free_assets,
        payload.free_asset_duration,
        payload.free_asset_start_date,
        payload.free_asset_end_date,
        payload.show_free_badge,
        payload.show_free_collection,
        payload.highlight_on_homepage,
        payload.highlight_in_search,
        payload.highlight_in_categories,
        payload.track_free_downloads,
        payload.track_most_downloaded_free_assets,
        payload.track_top_free_contributors,
        payload.track_free_conversion_rate
      ]
    );

    res.json(inserted.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save free asset settings' });
  }
});

app.get("/subscription-plans", async (req, res) => {
  try {
    const plans = await pool.query(
      `SELECT id, name, short_description, badge, color, active, recommended, pricing, download_limits, plan_settings
       FROM subscription_plans
       WHERE active = TRUE
         AND (
           plan_settings->>'duration' IS DISTINCT FROM 'limited'
           OR (
             (plan_settings->>'start_date' IS NULL OR (plan_settings->>'start_date')::date <= CURRENT_DATE)
             AND (plan_settings->>'end_date' IS NULL OR (plan_settings->>'end_date')::date >= CURRENT_DATE)
           )
         )
       ORDER BY active DESC, display_order ASC, id ASC`
    );
    res.json(plans.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load subscription plans' });
  }
});

app.post("/checkout/subscribe", (req, res, next) => authenticateToken(req, res, next), async (req, res) => {
  try {
    const { planId, duration, currency: requestedCurrency, paymentMethod, billing = {}, couponCode = '' } = req.body || {};
    const planResult = await pool.query(`SELECT * FROM subscription_plans WHERE id = $1 AND active = TRUE`, [planId]);
    const plan = planResult.rows[0];
    if (!plan) return res.status(404).json({ error: "Subscription plan not found or inactive" });

    const baseCurrency = String(plan.pricing?.currency || "USD").toUpperCase();
    const currency = String(requestedCurrency || baseCurrency).trim().toUpperCase();
    const prices = plan.pricing?.currency_prices?.[currency] || (currency === baseCurrency ? (plan.pricing?.prices || {}) : null);
    if (!prices) return res.status(400).json({ error: `Currency ${currency} is not available for this plan` });
    const originalAmount = Number(prices[duration] ?? 0);
    let amount = originalAmount;
    let coupon = null;
    if (couponCode) {
      const couponResult = await pool.query(`SELECT * FROM coupon_codes WHERE LOWER(code) = LOWER($1) LIMIT 1`, [String(couponCode).trim()]);
      coupon = couponResult.rows[0] || null;
      if (!coupon || String(coupon.status || '').toLowerCase() !== 'active') return res.status(400).json({ error: "Coupon is not active or could not be found" });
      if (coupon.discount_type === 'percentage') amount = Math.max(0, amount - (amount * Number(coupon.discount_value || 0) / 100));
      if (coupon.discount_type === 'flat') amount = Math.max(0, amount - Number(coupon.discount_value || 0));
    }
    const downloadLimit = Number(plan.download_limits?.downloads ?? 0);
    const planSettings = plan.plan_settings || {};
    const subscriptionStart = duration === "limited" ? planSettings.start_date : new Date().toISOString().slice(0, 10);
    const subscriptionEnd = duration === "limited"
      ? planSettings.end_date
      : new Date(Date.now() + ({ monthly: 30, "3_months": 90, "6_months": 180, "1_year": 365, yearly: 365 }[duration] || 30) * 86400000).toISOString().slice(0, 10);
    if (duration === "limited" && (!subscriptionStart || !subscriptionEnd || new Date(subscriptionEnd) < new Date(subscriptionStart) || new Date() < new Date(subscriptionStart) || new Date() > new Date(`${subscriptionEnd}T23:59:59`))) {
      return res.status(400).json({ error: "This limited-time plan is not currently available" });
    }
    const configuredMethods = getPaymentSettings().enabledGateways || [];
    const normalizedMethod = String(paymentMethod || "").trim();
    const isCreditsPayment = normalizedMethod.toLowerCase() === "gfx's credits";
    if (amount > 0 && !isCreditsPayment && !configuredMethods.includes(normalizedMethod)) {
      return res.status(400).json({ error: "Selected payment gateway is not currently enabled" });
    }

    const userResult = await pool.query(`SELECT id, username, email, full_name, credits FROM users WHERE id = $1`, [req.user.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });
    const creditsRequired = Math.max(0, Math.ceil(amount));
    if (isCreditsPayment && Number(user.credits || 0) < creditsRequired) return res.status(400).json({ error: "Insufficient credits" });

    const gateway = isCreditsPayment ? normalizedMethod : normalizedMethod || "free";
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");
      const orderNumber = await getSubscriptionOrderNumber(dbClient);
      const invoiceNumber = await getSubscriptionInvoiceNumber(dbClient);
      const transactionId = `GFXSUB${(await getNextTransactionId(dbClient)).slice(3)}`;
      if (isCreditsPayment && creditsRequired > 0) {
        await dbClient.query(`UPDATE users SET credits = credits - $1 WHERE id = $2`, [creditsRequired, req.user.id]);
      }
      const orderResult = await dbClient.query(
        `INSERT INTO orders (order_number, invoice_number, customer_id, customer_name, customer_country, customer_phone, order_type, currency, subtotal, total_amount, payment_gateway, payment_method, transaction_id, payment_status, order_status, download_status, assets_count, downloads_count, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'subscription',$7,$8,$8,$9,$10,$11,$12,'pending','pending',0,0,NOW(),NOW()) RETURNING id`,
        [orderNumber, invoiceNumber, req.user.id, billing.fullName || user.full_name || user.username, billing.country || null, billing.phone || null, currency, amount, gateway, normalizedMethod || "free", transactionId, amount === 0 || isCreditsPayment ? "paid" : "pending"]
      );
      const orderId = orderResult.rows[0].id;
      await dbClient.query(`INSERT INTO payments (order_id, amount, currency, gateway, transaction_id, status, response, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`, [orderId, amount, currency, gateway, transactionId, amount === 0 || isCreditsPayment ? "paid" : "pending", JSON.stringify({ planId, duration, paymentMethod: normalizedMethod, currency, couponCode: coupon?.code || null, originalAmount })]);
      await dbClient.query(`INSERT INTO invoices (order_id, invoice_number, customer_id, amount, currency, status, issued_at) VALUES ($1,$2,$3,$4,$5,'issued',NOW())`, [orderId, invoiceNumber, req.user.id, amount, currency]);
      await dbClient.query(`INSERT INTO custom_subscriptions (customer_id, customer_name, customer_email, base_plan, custom_duration, custom_start_date, custom_end_date, custom_pricing, custom_permissions, status, activity_log, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,NOW(),NOW())`, [req.user.id, billing.fullName || user.full_name || user.username, billing.email || user.email, plan.name, duration, subscriptionStart, subscriptionEnd, JSON.stringify({ amount, currency, planId, orderId, orderNumber, invoiceNumber, transactionId }), JSON.stringify({ download_limit: downloadLimit, downloads_used: 0 }), JSON.stringify([{ event: "subscription_purchased", orderId }])]);
      const admins = await dbClient.query(`SELECT username FROM users WHERE role = 'admin' AND status <> 'blocked'`);
      const purchaseMessage = `Subscription purchase pending approval: ${plan.name} (${orderNumber}).`;
      await dbClient.query(`INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1,$2,FALSE,NOW())`, [user.username, purchaseMessage]);
      for (const admin of admins.rows) await dbClient.query(`INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1,$2,FALSE,NOW())`, [admin.username, `New subscription purchase requires approval: ${user.username || user.email} purchased ${plan.name} (${orderNumber}).`]);
      if (coupon) await dbClient.query(`INSERT INTO coupon_redemptions (coupon_id, user_id, amount, redeemed_at, metadata) VALUES ($1,$2,$3,NOW(),$4)`, [coupon.id, req.user.id, Number((originalAmount - amount).toFixed(2)), JSON.stringify({ orderId, subscription: true })]);
      await dbClient.query("COMMIT");
      return res.json({ success: true, orderId, orderNumber });
    } catch (transactionError) {
      await dbClient.query("ROLLBACK");
      throw transactionError;
    } finally {
      dbClient.release();
    }
  } catch (err) {
    console.error("Failed to purchase subscription", err);
    try {
      const userResult = await pool.query(`SELECT username FROM users WHERE id = $1`, [req.user?.id]);
      const admins = await pool.query(`SELECT username FROM users WHERE role = 'admin' AND status <> 'blocked'`);
      const failureMessage = `Subscription purchase failed${req.body?.planId ? ` for plan ${req.body.planId}` : ''}.`;
      if (userResult.rows[0]?.username) await pool.query(`INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1,$2,FALSE,NOW())`, [userResult.rows[0].username, failureMessage]);
      for (const admin of admins.rows) await pool.query(`INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1,$2,FALSE,NOW())`, [admin.username, `Subscription purchase failed for user ${userResult.rows[0]?.username || req.user?.id || 'unknown'}.`]);
    } catch (notificationError) { console.error('Failed to notify subscription purchase failure', notificationError); }
    res.status(500).json({ error: "Failed to purchase subscription" });
  }
});

app.get("/admin/subscription-plans", verifySuperAdmin, async (req, res) => {
  try {
    const plans = await pool.query(
      `SELECT * FROM subscription_plans ORDER BY display_order ASC, id ASC`
    );
    res.json(plans.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load subscription plans' });
  }
});

app.post("/admin/subscription-plans", verifySuperAdmin, async (req, res) => {
  try {
    const {
      id,
      name,
      short_description,
      icon,
      badge,
      color,
      display_order,
      active,
      recommended,
      pricing,
      download_limits,
      licenses,
      asset_access,
      member_benefits,
      limitations,
      plan_settings
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Plan name is required' });
    }

    if (id) {
      const updated = await pool.query(
        `UPDATE subscription_plans SET
          name = $1,
          short_description = $2,
          icon = $3,
          badge = $4,
          color = $5,
          display_order = $6,
          active = $7,
          recommended = $8,
          pricing = $9,
          download_limits = $10,
          licenses = $11,
          asset_access = $12,
          member_benefits = $13,
          limitations = $14,
          plan_settings = $15,
          updated_at = now()
        WHERE id = $16
        RETURNING *`,
        [
          name,
          short_description || null,
          icon || null,
          badge || null,
          color || null,
          Number(display_order) || 0,
          active !== false,
          recommended === true,
          pricing || {},
          download_limits || {},
          licenses || [],
          asset_access || [],
          member_benefits || {},
          limitations || {},
          plan_settings || {},
          id
        ]
      );
      return res.json(updated.rows[0]);
    }

    const inserted = await pool.query(
      `INSERT INTO subscription_plans(
          name,
          short_description,
          icon,
          badge,
          color,
          display_order,
          active,
          recommended,
          pricing,
          download_limits,
          licenses,
          asset_access,
          member_benefits,
          limitations,
          plan_settings,
          created_at,
          updated_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now(), now()) RETURNING *`,
      [
        name,
        short_description || null,
        icon || null,
        badge || null,
        color || null,
        Number(display_order) || 0,
        active !== false,
        recommended === true,
        pricing || {},
        download_limits || {},
        licenses || [],
        asset_access || [],
        member_benefits || {},
        limitations || {},
        plan_settings || {}
      ]
    );

    res.json(inserted.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save subscription plan' });
  }
});

app.delete("/admin/subscription-plans/:id", verifySuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await pool.query(
      `DELETE FROM subscription_plans WHERE id = $1 RETURNING *`,
      [id]
    );
    if (deleted.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    res.json(deleted.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete subscription plan' });
  }
});

app.post("/admin/subscription-plans/:id/duplicate", verifySuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const planRes = await pool.query(`SELECT * FROM subscription_plans WHERE id = $1`, [id]);
    if (planRes.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    const plan = planRes.rows[0];
    const inserted = await pool.query(
      `INSERT INTO subscription_plans(
          name,
          short_description,
          icon,
          badge,
          color,
          display_order,
          active,
          recommended,
          pricing,
          download_limits,
          licenses,
          asset_access,
          member_benefits,
          limitations,
          plan_settings,
          created_at,
          updated_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now(), now()) RETURNING *`,
      [
        `${plan.name} Copy`,
        plan.short_description,
        plan.icon,
        plan.badge,
        plan.color,
        Number(plan.display_order) + 1,
        plan.active,
        plan.recommended,
        plan.pricing,
        plan.download_limits,
        plan.licenses,
        plan.asset_access,
        plan.member_benefits,
        plan.limitations,
        plan.plan_settings
      ]
    );
    res.json(inserted.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to duplicate subscription plan' });
  }
});

app.post("/admin/subscription-plans/reorder", verifySuperAdmin, async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) {
      return res.status(400).json({ error: 'Orders array is required' });
    }
    const updatePromises = orders.map((item) => {
      return pool.query(
        `UPDATE subscription_plans SET display_order = $1 WHERE id = $2`,
        [Number(item.display_order) || 0, item.id]
      );
    });
    await Promise.all(updatePromises);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reorder subscription plans' });
  }
});

app.get("/admin/custom-subscriptions", verifySuperAdmin, async (req, res) => {
  try {
    const subs = await pool.query(`
      SELECT s.*,
        COALESCE(d.used_downloads, 0)::int AS used_downloads,
        CASE
          WHEN (s.custom_permissions->>'download_limit')::numeric IS NULL THEN NULL
          ELSE GREATEST(0, (s.custom_permissions->>'download_limit')::int - COALESCE(d.used_downloads, 0))
        END AS remaining_downloads
      FROM custom_subscriptions s
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS used_downloads
        FROM downloads dl
        WHERE dl.user_id = s.customer_id
          AND dl.subscription_id = s.id
          AND (s.custom_start_date IS NULL OR dl.downloaded_at >= s.custom_start_date)
          AND (s.custom_end_date IS NULL OR dl.downloaded_at < s.custom_end_date + INTERVAL '1 day')
      ) d ON TRUE
      ORDER BY s.created_at DESC
    `);
    res.json(subs.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load custom subscriptions' });
  }
});

app.post("/custom-subscriptions/otp/send", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const fullName = String(req.body?.name || "User").trim() || "User";
    if (!email) return res.status(400).json({ error: "Email is required." });
    const otpCode = String(crypto.randomInt(100000, 1000000));
    const validMinutes = Number(getOtpSettings().valid_minutes || 10);
    await pool.query("DELETE FROM custom_subscription_otps WHERE email = $1 OR expires_at < now()", [email]);
    const inserted = await pool.query(
      `INSERT INTO custom_subscription_otps(email, otp_hash, expires_at)
       VALUES($1, $2, now() + ($3 * INTERVAL '1 minute')) RETURNING id`,
      [email, hashCustomSubscriptionOtp(otpCode), validMinutes]
    );
    try {
      await sendCustomSubscriptionOtpEmail(email, otpCode, fullName);
    } catch (mailError) {
      await pool.query("DELETE FROM custom_subscription_otps WHERE id = $1", [inserted.rows[0].id]);
      console.error("Failed to send custom subscription OTP", mailError);
      return res.status(502).json({ error: "Unable to send the verification email. Please check the email settings and try again." });
    }
    return res.json({ success: true, message: "Verification code sent." });
  } catch (err) {
    console.error("Failed to create custom subscription OTP", err);
    return res.status(500).json({ error: "Unable to send verification code." });
  }
});

app.post("/custom-subscriptions/otp/verify", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!email || !code) return res.status(400).json({ error: "Email and verification code are required." });
    const result = await pool.query(
      `SELECT * FROM custom_subscription_otps
       WHERE email = $1 AND verified_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    const otp = result.rows[0];
    if (!otp) return res.status(400).json({ error: "That code has expired. Please request a new one." });
    if (otp.attempts >= 5) return res.status(429).json({ error: "Too many attempts. Please request a new code." });
    if (hashCustomSubscriptionOtp(code) !== otp.otp_hash) {
      await pool.query("UPDATE custom_subscription_otps SET attempts = attempts + 1 WHERE id = $1", [otp.id]);
      return res.status(400).json({ error: "Invalid verification code." });
    }
    const verificationToken = crypto.randomBytes(32).toString("hex");
    await pool.query("UPDATE custom_subscription_otps SET verified_at = now(), verification_token_hash = $1 WHERE id = $2", [hashCustomSubscriptionOtp(verificationToken), otp.id]);
    return res.json({ success: true, verification_token: verificationToken });
  } catch (err) {
    console.error("Failed to verify custom subscription OTP", err);
    return res.status(500).json({ error: "Unable to verify the code." });
  }
});

app.post("/custom-subscriptions", async (req, res) => {
  try {
    const {
      customer_id,
      customer_name,
      customer_email,
      customer_phone,
      base_plan,
      custom_duration,
      custom_start_date,
      custom_end_date,
      custom_pricing,
      custom_permissions,
      status,
      admin_notes,
      activity_log,
      verification_token
    } = req.body || {};

    if (!customer_email || !String(customer_email).trim()) {
      return res.status(400).json({ error: "Customer email is required." });
    }
    if (!verification_token) {
      return res.status(403).json({ error: "Please verify your email before submitting the request." });
    }
    const verification = await pool.query(
      `SELECT id FROM custom_subscription_otps
       WHERE email = $1 AND verification_token_hash = $2 AND verified_at IS NOT NULL
       ORDER BY verified_at DESC LIMIT 1`,
      [String(customer_email).trim().toLowerCase(), hashCustomSubscriptionOtp(verification_token)]
    );
    if (!verification.rows[0]) return res.status(403).json({ error: "Email verification expired. Please verify again." });

    const inserted = await pool.query(
      `INSERT INTO custom_subscriptions(
        customer_id,
        customer_name,
        customer_email,
        base_plan,
        custom_duration,
        custom_start_date,
        custom_end_date,
        custom_pricing,
        custom_permissions,
        status,
        admin_notes,
        activity_log,
        created_at,
        updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now()) RETURNING *`,
      [
        customer_id || null,
        customer_name || null,
        String(customer_email).trim(),
        base_plan || "Custom Subscription",
        custom_duration || null,
        custom_start_date || null,
        custom_end_date || null,
        JSON.stringify(custom_pricing || {
          requested_by: "pricing_page",
          mobile_number: customer_phone || null
        }),
        JSON.stringify(custom_permissions || {}),
        status || "pending",
        JSON.stringify(admin_notes || {}),
        JSON.stringify(activity_log || [])
      ]
    );

    return res.status(201).json(inserted.rows[0]);
  } catch (err) {
    console.error("Failed to create custom subscription request", err);
    return res.status(500).json({ error: "Failed to submit custom subscription request." });
  }
});

app.get("/admin/custom-subscriptions/:id", verifySuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const sub = await pool.query(`SELECT * FROM custom_subscriptions WHERE id = $1`, [id]);
    if (sub.rows.length === 0) {
      return res.status(404).json({ error: 'Custom subscription not found' });
    }
    res.json(sub.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load custom subscription' });
  }
});

app.get("/admin/custom-subscriptions/:id/details", verifySuperAdmin, async (req, res) => {
  try {
    const subscriptionResult = await pool.query(`SELECT * FROM custom_subscriptions WHERE id = $1`, [req.params.id]);
    const subscription = subscriptionResult.rows[0];
    if (!subscription) return res.status(404).json({ error: 'Subscription not found' });
    const orderId = Number(subscription.activity_log?.[0]?.orderId || 0);
    const orderResult = await pool.query(
      `SELECT o.*, u.username AS customer_username, u.email AS customer_email
       FROM orders o LEFT JOIN users u ON u.id = o.customer_id
       WHERE o.id = $1 OR (o.customer_id = $2 AND o.order_type = 'subscription')
       ORDER BY CASE WHEN o.id = $1 THEN 0 ELSE 1 END, o.created_at DESC LIMIT 1`,
      [orderId || null, subscription.customer_id]
    );
    const order = orderResult.rows[0] || null;
    const payments = order ? (await pool.query(`SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC`, [order.id])).rows : [];
    res.json({ subscription, order, payments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load subscriber details' });
  }
});

app.post("/admin/custom-subscriptions/:id/approve", verifySuperAdmin, async (req, res) => {
  try {
    const updated = await pool.query(`UPDATE custom_subscriptions SET status = 'active', updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
    const subscription = updated.rows[0];
    if (!subscription) return res.status(404).json({ error: 'Subscription not found' });
    const orderId = Number(subscription.custom_pricing?.orderId || 0);
    if (orderId) await pool.query(`UPDATE orders SET payment_status = 'paid', order_status = 'completed', download_status = 'available', updated_at = now() WHERE id = $1`, [orderId]);
    const admins = await pool.query(`SELECT username FROM users WHERE role = 'admin' AND status <> 'blocked'`);
    const message = `Subscription approved: ${subscription.base_plan}.`;
    if (subscription.customer_id) {
      const user = await pool.query(`SELECT username FROM users WHERE id = $1`, [subscription.customer_id]);
      if (user.rows[0]?.username) await pool.query(`INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1,$2,FALSE,NOW())`, [user.rows[0].username, message]);
    }
    for (const admin of admins.rows) await pool.query(`INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1,$2,FALSE,NOW())`, [admin.username, `Subscription approved for ${subscription.customer_name || subscription.customer_email || subscription.customer_id}: ${subscription.base_plan}.`]);
    res.json(subscription);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to approve subscription' }); }
});

app.post("/admin/custom-subscriptions/:id/reject", verifySuperAdmin, async (req, res) => {
  try {
    const updated = await pool.query(`UPDATE custom_subscriptions SET status = 'rejected', updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id]);
    const subscription = updated.rows[0];
    if (!subscription) return res.status(404).json({ error: 'Subscription not found' });
    const orderId = Number(subscription.custom_pricing?.orderId || 0);
    if (orderId) await pool.query(`UPDATE orders SET payment_status = 'failed', order_status = 'cancelled', download_status = 'blocked', updated_at = now() WHERE id = $1`, [orderId]);
    const admins = await pool.query(`SELECT username FROM users WHERE role = 'admin' AND status <> 'blocked'`);
    const message = `Subscription rejected: ${subscription.base_plan}.`;
    if (subscription.customer_id) {
      const user = await pool.query(`SELECT username FROM users WHERE id = $1`, [subscription.customer_id]);
      if (user.rows[0]?.username) await pool.query(`INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1,$2,FALSE,NOW())`, [user.rows[0].username, message]);
    }
    for (const admin of admins.rows) await pool.query(`INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1,$2,FALSE,NOW())`, [admin.username, `Subscription rejected for ${subscription.customer_name || subscription.customer_email || subscription.customer_id}: ${subscription.base_plan}.`]);
    res.json(subscription);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to reject subscription' }); }
});

app.post("/admin/custom-subscriptions/:id/revoke", verifySuperAdmin, async (req, res) => {
  try {
    const revoked = await pool.query(
      `UPDATE custom_subscriptions
       SET status = 'revoked', custom_end_date = CURRENT_DATE, updated_at = now()
       WHERE id = $1 AND status <> 'revoked'
       RETURNING *`,
      [req.params.id]
    );
    if (!revoked.rows[0]) return res.status(404).json({ error: 'Subscription not found' });
    const subscription = revoked.rows[0];
    const customer = subscription.customer_id
      ? (await pool.query('SELECT username FROM users WHERE id = $1', [subscription.customer_id])).rows[0]
      : null;
    const admins = await pool.query("SELECT username FROM users WHERE role = 'admin' AND status <> 'blocked' AND username IS NOT NULL");
    const planName = subscription.base_plan || 'subscription';
    const customerMessage = `Your ${planName} subscription was revoked by an administrator.`;
    if (customer?.username) {
      await pool.query(
        'INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1, $2, FALSE, NOW())',
        [customer.username, customerMessage]
      );
    }
    for (const admin of admins.rows) {
      await pool.query(
        'INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1, $2, FALSE, NOW())',
        [admin.username, `Subscription revoked for ${customer?.username || subscription.customer_email || 'customer'}: ${planName}.`]
      );
    }
    await recordBusinessEvent(pool, 'SUBSCRIPTION_CANCELLED', {
      userId: subscription.customer_id,
      userRole: 'customer',
      subscriptionId: subscription.id,
      description: `Subscription revoked: ${planName}`,
      metadata: { plan: planName, status: 'revoked', customer_username: customer?.username || null }
    });
    res.json(revoked.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to revoke subscription' });
  }
});

app.post("/admin/custom-subscriptions/:id/complete", verifySuperAdmin, async (req, res) => {
  try {
    const completed = await pool.query(
      `UPDATE custom_subscriptions
       SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (!completed.rows[0]) return res.status(404).json({ error: 'Subscription not found' });
    res.json(completed.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to complete subscription request' });
  }
});

app.post("/admin/custom-subscriptions/:id/complete", verifySuperAdmin, async (req, res) => {
  try {
    const completed = await pool.query(
      `UPDATE custom_subscriptions
       SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (!completed.rows[0]) return res.status(404).json({ error: 'Subscription not found' });
    res.json(completed.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to complete subscription request' });
  }
});

app.post("/admin/custom-subscriptions", verifySuperAdmin, async (req, res) => {
  try {
    const {
      id,
      customer_id,
      customer_name,
      customer_email,
      base_plan,
      custom_duration,
      custom_start_date,
      custom_end_date,
      custom_pricing,
      custom_permissions,
      status,
      admin_notes,
      activity_log
    } = req.body;

    if (id) {
      const updated = await pool.query(
        `UPDATE custom_subscriptions SET
          customer_id = $1,
          customer_name = $2,
          customer_email = $3,
          base_plan = $4,
          custom_duration = $5,
          custom_start_date = $6,
          custom_end_date = $7,
          custom_pricing = $8,
          custom_permissions = $9,
          status = $10,
          admin_notes = $11,
          activity_log = $12,
          updated_at = now()
        WHERE id = $13
        RETURNING *`,
        [
          customer_id || null,
          customer_name || null,
          customer_email || null,
          base_plan || null,
          custom_duration || null,
          custom_start_date || null,
          custom_end_date || null,
          custom_pricing || {},
          custom_permissions || {},
          status || null,
          admin_notes || {},
          activity_log || [],
          id
        ]
      );
      return res.json(updated.rows[0]);
    }

    const inserted = await pool.query(
      `INSERT INTO custom_subscriptions(
        customer_id,
        customer_name,
        customer_email,
        base_plan,
        custom_duration,
        custom_start_date,
        custom_end_date,
        custom_pricing,
        custom_permissions,
        status,
        admin_notes,
        activity_log,
        created_at,
        updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now()) RETURNING *`,
      [
        customer_id || null,
        customer_name || null,
        customer_email || null,
        base_plan || null,
        custom_duration || null,
        custom_start_date || null,
        custom_end_date || null,
        custom_pricing || {},
        custom_permissions || {},
        status || null,
        admin_notes || {},
        activity_log || []
      ]
    );
    res.json(inserted.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save custom subscription' });
  }
});

app.post("/admin/custom-subscriptions/assign", verifySuperAdmin, async (req, res) => {
  const dbClient = await pool.connect();
  try {
    const { customerId, planId, duration, remarks = "" } = req.body || {};
    const customerResult = await dbClient.query(
      `SELECT id, username, email, full_name FROM users WHERE id = $1 AND role = 'customer' AND status <> 'blocked'`,
      [customerId]
    );
    const customer = customerResult.rows[0];
    if (!customer) return res.status(400).json({ error: "Select a valid customer account" });

    const planResult = await dbClient.query(`SELECT * FROM subscription_plans WHERE id = $1 AND active = TRUE`, [planId]);
    const plan = planResult.rows[0];
    if (!plan) return res.status(400).json({ error: "Select a valid active subscription plan" });

    const prices = plan.pricing?.prices || {};
    const selectedDuration = duration || Object.keys(prices)[0] || plan.plan_settings?.duration || "monthly";
    const amount = Number(prices[selectedDuration] ?? plan.pricing?.amount ?? 0);
    const planSettings = plan.plan_settings || {};
    const startDate = new Date().toISOString().slice(0, 10);
    const durationDays = { monthly: 30, "3_months": 90, "6_months": 180, "1_year": 365, yearly: 365 }[selectedDuration] || 30;
    const endDate = selectedDuration === "limited" && planSettings.end_date
      ? planSettings.end_date
      : new Date(Date.now() + durationDays * 86400000).toISOString().slice(0, 10);
    const downloadLimit = Number(plan.download_limits?.downloads ?? 0);

    await dbClient.query("BEGIN");
    const orderNumber = await getSubscriptionOrderNumber(dbClient);
    const invoiceNumber = await getSubscriptionInvoiceNumber(dbClient);
    const transactionId = `GFXSUB${(await getNextTransactionId(dbClient)).slice(3)}`;
    const orderResult = await dbClient.query(
      `INSERT INTO orders (order_number, invoice_number, customer_id, customer_name, order_type, currency, subtotal, total_amount, payment_gateway, payment_method, transaction_id, payment_status, order_status, download_status, assets_count, downloads_count, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'subscription',$5,$6,$6,'subscription','subscription',$7,'paid','completed','available',0,0,NOW(),NOW()) RETURNING id`,
      [orderNumber, invoiceNumber, customer.id, customer.full_name || customer.username, plan.pricing?.currency || "USD", amount, transactionId]
    );
    const orderId = orderResult.rows[0].id;
    await dbClient.query(
      `INSERT INTO payments (order_id, amount, currency, gateway, transaction_id, status, response, created_at) VALUES ($1,$2,$3,'subscription',$4,'paid',$5,NOW())`,
      [orderId, amount, plan.pricing?.currency || "USD", transactionId, JSON.stringify({ source: "admin_assignment", planId, duration: selectedDuration })]
    );
    await dbClient.query(
      `INSERT INTO invoices (order_id, invoice_number, customer_id, amount, currency, status, issued_at) VALUES ($1,$2,$3,$4,$5,'issued',NOW())`,
      [orderId, invoiceNumber, customer.id, amount, plan.pricing?.currency || "USD"]
    );
    const subscriptionResult = await dbClient.query(
      `INSERT INTO custom_subscriptions (customer_id, customer_name, customer_email, base_plan, custom_duration, custom_start_date, custom_end_date, custom_pricing, custom_permissions, status, admin_notes, activity_log, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,NOW(),NOW()) RETURNING *`,
      [customer.id, customer.full_name || customer.username, customer.email, plan.name, selectedDuration, startDate, endDate, JSON.stringify({ amount, currency: plan.pricing?.currency || "USD", planId, orderId, orderNumber, invoiceNumber, transactionId, assignedByAdmin: true }), JSON.stringify({ download_limit: downloadLimit, downloads_used: 0 }), JSON.stringify({ remarks: String(remarks).trim(), provided_by: "admin" }), JSON.stringify([{ event: "subscription_assigned_by_admin", orderId, remarks: String(remarks).trim() }])]
    );
    await dbClient.query(`UPDATE orders SET subscription_id = $1, admin_remarks = $2 WHERE id = $3`, [subscriptionResult.rows[0].id, String(remarks).trim() || null, orderId]);
    await dbClient.query("COMMIT");
    res.json({ success: true, subscription: subscriptionResult.rows[0], orderId, orderNumber });
  } catch (err) {
    try { await dbClient.query("ROLLBACK"); } catch (rollbackError) { console.error(rollbackError); }
    console.error("Failed to assign subscription", err);
    res.status(500).json({ error: "Failed to assign subscription" });
  } finally {
    dbClient.release();
  }
});

app.delete("/admin/custom-subscriptions/:id", verifySuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await pool.query(
      `DELETE FROM custom_subscriptions WHERE id = $1 RETURNING *`,
      [id]
    );
    if (deleted.rows.length === 0) {
      return res.status(404).json({ error: 'Custom subscription not found' });
    }
    res.json(deleted.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete custom subscription' });
  }
});

  // WhatsApp settings persisted server-side (non-sensitive fields)
  const getWhatsappSettings = () => {
    try {
      const dir = path.join(__dirname, 'uploads', 'whatsapp');
      const file = path.join(dir, 'settings.json');
      if (!fs.existsSync(file)) return {};
      return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch (err) {
      console.error('Failed to read whatsapp settings', err);
      return {};
    }
  };

  const saveWhatsappSettings = (next) => {
    try {
      const dir = path.join(__dirname, 'uploads', 'whatsapp');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'settings.json');
      fs.writeFileSync(file, JSON.stringify(next, null, 2));
      return true;
    } catch (err) {
      console.error('Failed to save whatsapp settings', err);
      return false;
    }
  };

  app.get('/admin/whatsapp/settings', verifyAdmin, async (req, res) => {
    const settings = getWhatsappSettings();
    res.json(settings);
  });

  app.post('/admin/whatsapp/settings', verifyAdmin, async (req, res) => {
    try {
      const { enabled, greeting, away, businessHours } = req.body || {};
      const next = {
        enabled: !!enabled,
        greeting: greeting || '',
        away: away || '',
        businessHours: businessHours || ''
      };
      const ok = saveWhatsappSettings(next);
      if (!ok) return res.status(500).json({ error: 'Failed to save settings' });
      res.json(next);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  });

const DEFAULT_CATEGORY_NAMES = [
  "Images",
  "Vector/illustrations",
  "PSD",
  "Videos",
  "Templates"
];

const getCategoriesList = async () => {
  try {
    const existing = await pool.query(`
      SELECT id, name
      FROM categories
      ORDER BY name
    `);

    if (existing.rows.length > 0) {
      return existing.rows;
    }

    const inserted = [];

    for (const categoryName of DEFAULT_CATEGORY_NAMES) {
      const created = await pool.query(
        `
        INSERT INTO categories (name)
        VALUES ($1)
        ON CONFLICT (name) DO NOTHING
        RETURNING id, name
        `,
        [categoryName]
      );

      if (created.rows[0]) {
        inserted.push(created.rows[0]);
      }
    }

    return inserted;
  } catch (err) {
    console.error("Failed to load categories", err.message || err);
    return [];
  }
};

const getCollectionsList = async () => {
  try {
    const existing = await pool.query(`
      SELECT id, name
      FROM collections
      ORDER BY name
    `);

    if (existing.rows.length > 0) {
      return existing.rows;
    }

    const imageCollections = await pool.query(`
      SELECT DISTINCT TRIM(collection) AS name
      FROM images
      WHERE TRIM(COALESCE(collection, '')) <> ''
      ORDER BY name
    `);

    const inserted = [];

    for (const collection of imageCollections.rows) {
      if (!collection.name) continue;

      const created = await pool.query(
        `
        INSERT INTO collections (name)
        VALUES ($1)
        ON CONFLICT (name) DO NOTHING
        RETURNING id, name
        `,
        [collection.name]
      );

      if (created.rows[0]) {
        inserted.push(created.rows[0]);
      }
    }

    return inserted;
  } catch (err) {
    console.error("Failed to load collections", err.message || err);
    return [];
  }
};

// Ensure credits_history and image metadata columns exist
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS credit_price_settings (
        id SERIAL PRIMARY KEY,
        price_inr NUMERIC NOT NULL DEFAULT 1 CHECK (price_inr > 0),
        credit_prices JSONB NOT NULL DEFAULT '{"100":100,"200":200,"500":500,"1000":1000}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await pool.query(`ALTER TABLE credit_price_settings ADD COLUMN IF NOT EXISTS credit_prices JSONB NOT NULL DEFAULT '{"100":100,"200":200,"500":500,"1000":1000}'::jsonb`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS credits_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        credits INTEGER NOT NULL,
        payment_method TEXT,
        transaction_id TEXT,
        amount_paid NUMERIC,
        currency TEXT DEFAULT 'INR',
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payout_requests (
        id SERIAL PRIMARY KEY,
        contributor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        requested_credits INTEGER NOT NULL CHECK (requested_credits >= 50),
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        whatsapp TEXT NOT NULL,
        cancelled_check_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'submitted',
        admin_note TEXT,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_cart_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        image_id INTEGER NOT NULL,
        title TEXT,
        filename TEXT,
        collection TEXT,
        category TEXT,
        price NUMERIC NOT NULL,
        currency TEXT DEFAULT 'USD',
        license TEXT DEFAULT 'Standard license',
        free_asset BOOLEAN DEFAULT FALSE,
        contributor_id INTEGER,
        item_type TEXT DEFAULT 'asset',
        credit_amount INTEGER,
        quantity INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, image_id, currency)
      );
      
      CREATE INDEX IF NOT EXISTS idx_user_cart_user_id ON user_cart_items(user_id);
    `);
    await pool.query(`ALTER TABLE user_cart_items ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'asset', ADD COLUMN IF NOT EXISTS credit_amount INTEGER`);

    await pool.query(`
      ALTER TABLE images
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS type TEXT
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS collections (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_settings (
        id SERIAL PRIMARY KEY,
        sender_name TEXT,
        sender_email TEXT,
        reply_to TEXT,
        provider TEXT,
        smtp_host TEXT,
        smtp_port INTEGER,
        smtp_user TEXT,
        smtp_pass TEXT,
        smtp_secure BOOLEAN DEFAULT FALSE,
        imap_host TEXT,
        imap_port INTEGER,
        imap_user TEXT,
        imap_pass TEXT,
        imap_secure BOOLEAN DEFAULT FALSE,
        auth_required BOOLEAN DEFAULT TRUE,
        connection_timeout INTEGER DEFAULT 10000,
        daily_limit INTEGER DEFAULT 1000,
        max_per_minute INTEGER DEFAULT 60,
        enable_queue BOOLEAN DEFAULT TRUE,
        enable_logging BOOLEAN DEFAULT TRUE,
        enable_retry BOOLEAN DEFAULT TRUE,
        retry_attempts INTEGER DEFAULT 3,
        retry_delay INTEGER DEFAULT 60000,
        enable_bounce_handling BOOLEAN DEFAULT FALSE,
        enable_tracking_pixel BOOLEAN DEFAULT FALSE,
        enable_click_tracking BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS imap_host TEXT;
    `);
    await pool.query(`
      ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS imap_port INTEGER;
    `);
    await pool.query(`
      ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS imap_user TEXT;
    `);
    await pool.query(`
      ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS imap_pass TEXT;
    `);
    await pool.query(`
      ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS imap_secure BOOLEAN DEFAULT FALSE;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        subject TEXT,
        body TEXT,
        variables TEXT[] DEFAULT ARRAY[]::TEXT[],
        template_type TEXT NOT NULL DEFAULT 'email' CHECK (template_type IN ('email', 'internal_message')),
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      ALTER TABLE email_templates
        ADD COLUMN IF NOT EXISTS template_type TEXT DEFAULT 'email';
    `);
    await pool.query(`
      ALTER TABLE email_templates
        ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE;
    `);
    await pool.query(`
      ALTER TABLE email_templates
        ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;
    `);
    await pool.query(`
      UPDATE email_templates
      SET template_type = CASE WHEN template_type IS NULL OR template_type = '' THEN 'email' ELSE template_type END,
          enabled = COALESCE(enabled, TRUE),
          is_default = COALESCE(is_default, FALSE)
      WHERE id IS NOT NULL;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id SERIAL PRIMARY KEY,
        recipient TEXT NOT NULL,
        template_id INTEGER REFERENCES email_templates(id),
        subject TEXT,
        body TEXT,
        status TEXT,
        error_message TEXT,
        retries INTEGER DEFAULT 0,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_queue (
        id SERIAL PRIMARY KEY,
        job_id TEXT,
        payload JSONB,
        status TEXT DEFAULT 'queued',
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        scheduled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      ALTER TABLE email_queue
        ADD COLUMN IF NOT EXISTS recipient TEXT,
        ADD COLUMN IF NOT EXISTS event TEXT,
        ADD COLUMN IF NOT EXISTS template_id INTEGER,
        ADD COLUMN IF NOT EXISTS subject TEXT,
        ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ DEFAULT now(),
        ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS error_message TEXT,
        ADD COLUMN IF NOT EXISTS related_user_id INTEGER,
        ADD COLUMN IF NOT EXISTS related_order_id BIGINT,
        ADD COLUMN IF NOT EXISTS related_asset_id BIGINT;
    `);
    await pool.query(`
      ALTER TABLE email_logs
        ADD COLUMN IF NOT EXISTS email_id TEXT,
        ADD COLUMN IF NOT EXISTS event TEXT,
        ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS related_user_id INTEGER,
        ADD COLUMN IF NOT EXISTS related_order_id BIGINT,
        ADD COLUMN IF NOT EXISTS related_asset_id BIGINT;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        segments TEXT[],
        subscribed BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS newsletter_campaigns (
        id SERIAL PRIMARY KEY,
        title TEXT,
        subject TEXT,
        body TEXT,
        sender_name TEXT,
        sender_email TEXT,
        status TEXT DEFAULT 'draft',
        scheduled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS newsletter_tracking (
        campaign_id INTEGER NOT NULL,
        recipient TEXT NOT NULL,
        status TEXT DEFAULT 'sent',
        opened_at TIMESTAMPTZ,
        clicked_at TIMESTAMPTZ,
        clicked_url TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (campaign_id, recipient)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_rules (
        id SERIAL PRIMARY KEY,
        event_key TEXT UNIQUE NOT NULL,
        enable_email BOOLEAN DEFAULT TRUE,
        enable_internal BOOLEAN DEFAULT TRUE,
        enable_dashboard BOOLEAN DEFAULT TRUE,
        recipients TEXT[],
        schedule_time TEXT DEFAULT '11:00',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query("ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS schedule_time TEXT DEFAULT '11:00'");
    await pool.query("ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduled_emails (
        id SERIAL PRIMARY KEY,
        name TEXT,
        payload JSONB,
        cron_expression TEXT,
        next_run TIMESTAMPTZ,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id SERIAL PRIMARY KEY,
        name TEXT,
        campaign_type TEXT,
        objective TEXT,
        status TEXT,
        budget NUMERIC DEFAULT 0,
        start_date DATE,
        end_date DATE,
        audience TEXT,
        priority TEXT,
        notes TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupon_codes (
        id SERIAL PRIMARY KEY,
        name TEXT,
        code TEXT UNIQUE,
        coupon_type TEXT,
        discount_type TEXT,
        discount_value NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'active',
        start_at DATE,
        end_at DATE,
        usage_limit INTEGER DEFAULT 0,
        notes TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupon_redemptions (
        id SERIAL PRIMARY KEY,
        coupon_id INTEGER REFERENCES coupon_codes(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        amount NUMERIC DEFAULT 0,
        redeemed_at TIMESTAMPTZ DEFAULT now(),
        metadata JSONB DEFAULT '{}'::jsonb
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupon_usage_logs (
        id SERIAL PRIMARY KEY,
        coupon_id INTEGER REFERENCES coupon_codes(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        metadata JSONB DEFAULT '{}'::jsonb
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gift_cards (
        id SERIAL PRIMARY KEY,
        name TEXT,
        code TEXT UNIQUE,
        value NUMERIC DEFAULT 0,
        expiry_date DATE,
        status TEXT DEFAULT 'active',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gift_card_redemptions (
        id SERIAL PRIMARY KEY,
        gift_card_id INTEGER REFERENCES gift_cards(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        amount NUMERIC DEFAULT 0,
        redeemed_at TIMESTAMPTZ DEFAULT now(),
        metadata JSONB DEFAULT '{}'::jsonb
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_programs (
        id SERIAL PRIMARY KEY,
        name TEXT,
        reward_type TEXT,
        signup_reward TEXT,
        purchase_reward TEXT,
        status TEXT DEFAULT 'active',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_rewards (
        id SERIAL PRIMARY KEY,
        referral_id INTEGER REFERENCES referral_programs(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reward TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        metadata JSONB DEFAULT '{}'::jsonb
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loyalty_programs (
        id SERIAL PRIMARY KEY,
        name TEXT,
        points_system TEXT,
        reward_level TEXT,
        bonus_points TEXT,
        expiry_days TEXT,
        status TEXT DEFAULT 'active',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loyalty_points (
        id SERIAL PRIMARY KEY,
        loyalty_id INTEGER REFERENCES loyalty_programs(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        points INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now(),
        metadata JSONB DEFAULT '{}'::jsonb
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bundle_offers (
        id SERIAL PRIMARY KEY,
        name TEXT,
        bundle_assets TEXT,
        bundle_discount TEXT,
        bundle_price TEXT,
        status TEXT DEFAULT 'active',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS flash_sales (
        id SERIAL PRIMARY KEY,
        name TEXT,
        discount_rule TEXT,
        status TEXT DEFAULT 'scheduled',
        start_date DATE,
        end_date DATE,
        featured_placement TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_banners (
        id SERIAL PRIMARY KEY,
        name TEXT,
        placement TEXT,
        priority TEXT,
        schedule TEXT,
        status TEXT DEFAULT 'draft',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_popups (
        id SERIAL PRIMARY KEY,
        name TEXT,
        trigger TEXT,
        schedule TEXT,
        status TEXT DEFAULT 'draft',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS announcement_bar (
        id SERIAL PRIMARY KEY,
        name TEXT,
        text TEXT,
        schedule TEXT,
        status TEXT DEFAULT 'active',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS promotion_email_campaigns (
        id SERIAL PRIMARY KEY,
        name TEXT,
        subject TEXT,
        schedule TEXT,
        audience TEXT,
        status TEXT DEFAULT 'draft',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS promotion_email_logs (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER REFERENCES promotion_email_campaigns(id) ON DELETE CASCADE,
        recipient TEXT,
        status TEXT,
        opened_at TIMESTAMPTZ,
        clicked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        metadata JSONB DEFAULT '{}'::jsonb
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS promotion_analytics (
        id SERIAL PRIMARY KEY,
        resource_type TEXT,
        resource_id INTEGER,
        metric TEXT,
        value NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now(),
        metadata JSONB DEFAULT '{}'::jsonb
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS promotion_push_notifications (
        id SERIAL PRIMARY KEY,
        name TEXT,
        channel TEXT,
        audience TEXT,
        schedule TEXT,
        status TEXT DEFAULT 'draft',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS automation_rules (
        id SERIAL PRIMARY KEY,
        name TEXT,
        trigger TEXT,
        channel TEXT,
        status TEXT DEFAULT 'active',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS promotion_activity_logs (
        id SERIAL PRIMARY KEY,
        action TEXT,
        details TEXT,
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        metadata JSONB DEFAULT '{}'::jsonb
      );
    `);

    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS country TEXT,
      ADD COLUMN IF NOT EXISTS custom_permissions JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS otp_enabled BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS otp_code TEXT,
      ADD COLUMN IF NOT EXISTS otp_context TEXT,
      ADD COLUMN IF NOT EXISTS otp_code_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS contributor_cooling_until TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS deletion_backup_status TEXT;
    `);

    await pool.query(`
      UPDATE users
      SET is_super_admin = true
      WHERE role = 'admin' AND (is_super_admin IS NULL OR is_super_admin = false);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bulk_upload_sessions (
        id SERIAL PRIMARY KEY,
        contributor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status TEXT DEFAULT 'pending',
        assets_count INTEGER DEFAULT 0,
        completed_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        upload_size NUMERIC DEFAULT 0,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bulk_upload_files (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES bulk_upload_sessions(id) ON DELETE CASCADE,
        filename TEXT,
        filesize NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'pending',
        title TEXT,
        description TEXT,
        category TEXT,
        collection TEXT,
        license TEXT,
        visibility TEXT,
        price NUMERIC DEFAULT 0,
        keywords TEXT,
        release_info TEXT,
        copyright_info TEXT,
        contributor_notes TEXT,
        error TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bulk_upload_logs (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES bulk_upload_sessions(id) ON DELETE CASCADE,
        contributor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT,
        message TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bulk_upload_errors (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES bulk_upload_sessions(id) ON DELETE CASCADE,
        file_id INTEGER REFERENCES bulk_upload_files(id) ON DELETE CASCADE,
        message TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number TEXT UNIQUE,
        invoice_number TEXT UNIQUE,
        customer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        customer_name TEXT,
        customer_country TEXT,
        customer_phone TEXT,
        order_type TEXT,
        currency TEXT DEFAULT 'USD',
        exchange_rate NUMERIC DEFAULT 1,
        subtotal NUMERIC DEFAULT 0,
        discount NUMERIC DEFAULT 0,
        tax NUMERIC DEFAULT 0,
        total_amount NUMERIC DEFAULT 0,
        coupon_code TEXT,
        payment_gateway TEXT,
        payment_method TEXT,
        transaction_id TEXT,
        payment_status TEXT,
        order_status TEXT,
        download_status TEXT,
        refund_status TEXT DEFAULT 'none',
        support_status TEXT,
        assets_count INTEGER DEFAULT 0,
        downloads_count INTEGER DEFAULT 0,
        contributor_earnings NUMERIC DEFAULT 0,
        platform_commission NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        asset_id INTEGER,
        title TEXT,
        category TEXT,
        license TEXT,
        contributor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        contributor_username TEXT,
        credit_amount INTEGER,
        quantity INTEGER DEFAULT 1,
        unit_price NUMERIC DEFAULT 0,
        total_price NUMERIC DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        download_status TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await pool.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS credit_amount INTEGER`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        amount NUMERIC DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        gateway TEXT,
        transaction_id TEXT,
        status TEXT,
        authorization_code TEXT,
        response JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS refunds (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        amount NUMERIC DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        status TEXT,
        reason TEXT,
        note TEXT,
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_notes (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        visibility TEXT DEFAULT 'admin',
        note TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_activity_logs (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        event TEXT,
        actor_role TEXT,
        details JSONB,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        invoice_number TEXT UNIQUE,
        customer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        amount NUMERIC DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT 'issued',
        issued_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_logs (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        gateway TEXT,
        event TEXT,
        payload JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_downloads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        image_id INTEGER REFERENCES images(id) ON DELETE CASCADE,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        download_token TEXT,
        license TEXT,
        expires_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS earnings (
        id SERIAL PRIMARY KEY,
        contributor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        asset_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
        amount NUMERIC DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        commission_rate NUMERIC DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics (
        id SERIAL PRIMARY KEY,
        event_type TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        entity_type TEXT,
        entity_id INTEGER,
        amount NUMERIC DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, image_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_image_unique ON favorites(user_id, image_id);
      CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
      CREATE INDEX IF NOT EXISTS idx_favorites_image_id ON favorites(image_id);
    `);
  } catch (err) {
    console.error('Failed to ensure database schema exists:', err.message || err);
  }
})();
/* ---------------- ADMIN MIDDLEWARE ---------------- */

async function verifyAdmin(
  req,
  res,
  next
) {

  try {

    if (!JWT_SECRET) {
      return res.status(503).json("Backup authentication is not configured");
    }

    const authHeader =
      req.headers["authorization"];

    if (!authHeader) {

      return res
        .status(401)
        .json("Access denied");

    }

    const token =
      authHeader.split(" ")[1];

    const decoded = verifyJwtToken(token);

    console.log("========== VERIFY ADMIN ==========");
    console.log("Decoded Token:", decoded);

    const user =
      await pool.query(

        `
        SELECT role, status
        FROM users
        WHERE id = $1
        `,

        [decoded.user]

      );

    console.log("Database User:", user.rows);

    if (
      user.rows.length === 0
    ) {

      return res
        .status(404)
        .json("User not found");

    }

    console.log("User Role:", user.rows[0].role);

    if (user.rows[0].role !== "admin" || user.rows[0].status === "inactive" || user.rows[0].status === "disabled") {

      return res
        .status(403)
        .json(
          "Admin access only"
        );

    }

    req.user = { id: decoded.user };

    next();

  } catch (err) {

    console.error(err);

    res
      .status(401)
      .json("Invalid token");

  }

}

async function verifySuperAdmin(
  req,
  res,
  next
) {
  try {
    const authHeader =
      req.headers["authorization"];

    if (!authHeader) {
      return res
        .status(401)
        .json("Access denied");
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyJwtToken(token);

    const user = await pool.query(
      `
      SELECT role
      FROM users
      WHERE id = $1
      `,
      [decoded.user]
    );

    if (user.rows.length === 0) {
      return res
        .status(404)
        .json("User not found");
    }

    if (
      user.rows[0].role !== "admin"
    ) {
      return res
        .status(403)
        .json("Admin access only");
    }

    req.user = { id: decoded.user };
    next();
  } catch (err) {
    console.error(err);
    res.status(401).json("Invalid token");
  }
}

/* ---------------- HEALTH CHECK ---------------- */

app.get("/", async (req, res) => {

  try {

    const result = await pool.query(
      "SELECT NOW()"
    );

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).send(
      "Database connection error"
    );

  }

});

/* ---------------- REGISTER ---------------- */

app.post("/register", async (req, res) => {

  try {

    const {
  fullName,
  username,
  email,
  password,
  accountType,
  identityNumber
} = req.body;

const existingUser = await pool.query(
  `
  SELECT *
  FROM users
  WHERE username = $1
     OR email = $2
  `,
  [username, email]
);


if (existingUser.rows.length > 0) {
  return res
    .status(400)
    .json("Username or email already exists.");
}

    const saltRounds = 10;

    const hashedPassword =
      await bcrypt.hash(
        password,
        saltRounds
      );

    const newUser = await pool.query(

      `
      INSERT INTO users
(
  full_name,
  username,
  email,
  password,
  role,
  identity_number,
  status,
  contributor_cooling_until
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *
      `,

      [
  fullName,
  username,
  email,
  hashedPassword,
  accountType,
  identityNumber || null,
  "pending",
  accountType === "contributor" ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null
]

    );

    const createdUser = newUser.rows[0];

    // Send registration OTP email
    const otpResult = await sendRegistrationOtpEmail(createdUser);

    if (!otpResult.sent && !otpResult.debugOnly) {
      // If OTP email fails, delete the user we just created
      await pool.query('DELETE FROM users WHERE id = $1', [createdUser.id]);
      console.error('OTP email failed - registration rolled back');
      return res.status(500).json("Failed to send OTP email. Please try registering again.");
    }

    if (otpResult.debugOnly) {
      console.warn(`OTP delivery debug mode enabled for ${createdUser.email}; manual verification can continue using the stored code.`);
    }

    // Trigger notification event
    const eventKey = accountType === "contributor" ? "new_contributor" : "new_customer";
    await triggerNotificationEvent(eventKey, createdUser);

    res.json({
      message: "Registration successful. OTP sent to your email. Enter it below to verify your account.",
      user: createdUser
    });

  } catch (err) {

    console.error(err.message);

    res.status(500).send(
      "Server error"
    );

  }

});

app.post("/verify-registration-otp", async (req, res) => {
  try {
    const { identifier, otp } = req.body;

    if (!otp || !identifier) {
      return res.status(400).json("Email/username and OTP are required");
    }

    const identifierTrimmed = String(identifier).trim();
    const user = await pool.query(
      `SELECT * FROM users WHERE email ILIKE $1 OR username ILIKE $2`,
      [identifierTrimmed, identifierTrimmed]
    );

    if (user.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    const userRow = user.rows[0];
    const now = new Date();
    const storedOtp = String(userRow.otp_code || "").trim();
    const expiresAt = userRow.otp_code_expires_at ? new Date(userRow.otp_code_expires_at) : null;

    // Verify OTP
    if (!storedOtp || !expiresAt || expiresAt < now || userRow.otp_context !== "registration") {
      return res.status(401).json("Invalid or expired OTP");
    }

    if (storedOtp !== otp) {
      return res.status(401).json("Invalid OTP");
    }

    // Clear OTP data and mark account as verified
    await pool.query(
      `UPDATE users
       SET otp_code = NULL,
           otp_context = NULL,
           otp_code_expires_at = NULL,
           status = CASE WHEN role = 'contributor' THEN 'pending' ELSE 'active' END
       WHERE id = $1`,
      [userRow.id]
    );

    res.json({ message: "Account verified successfully. You can now log in." });
  } catch (err) {
    console.error('Verify registration OTP error:', err.message || err);
    res.status(500).json("Server error");
  }
});

app.post("/resend-registration-otp", async (req, res) => {
  try {
    const { identifier } = req.body;

    if (!identifier) {
      return res.status(400).json("Email or username is required");
    }

    const identifierTrimmed = String(identifier).trim();
    const user = await pool.query(
      `SELECT * FROM users WHERE email ILIKE $1 OR username ILIKE $2`,
      [identifierTrimmed, identifierTrimmed]
    );

    if (user.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    const userRow = user.rows[0];
    
    // Send registration OTP email
    const result = await sendRegistrationOtpEmail(userRow);
    
    if (!result.sent) {
      return res.status(500).json("Failed to send OTP email");
    }

    res.json({ message: "OTP resent to your email.", expiresAt: result.expiresAt });
  } catch (err) {
    console.error('Resend registration OTP error:', err.message || err);
    res.status(500).json("Server error");
  }
});

/* ---------------- LOGIN ---------------- */

app.post("/login", async (req, res) => {

  try {

    const {
      identifier,
      email,
      password,
      otp
    } = req.body;

    const loginIdentifier = typeof identifier === "string"
      ? identifier.trim()
      : (typeof email === "string" ? email.trim() : "");

    if (!loginIdentifier || !password) {
      await createFailedLoginNotification({ identifier: loginIdentifier, reason: 'username or password was not provided', ipAddress: getClientIp(req) });
      return res.status(400).json(
        "Email/username and password are required"
      );
    }

    const user = await pool.query(

      `
      SELECT *
      FROM users
      WHERE email ILIKE $1
         OR username ILIKE $2
      `,

      [loginIdentifier, loginIdentifier]

    );

    if (user.rows.length === 0) {
      await createFailedLoginNotification({ identifier: loginIdentifier, reason: 'user not found', ipAddress: getClientIp(req) });

      return res.status(401).json(
        "Invalid email or username"
      );

    }

    const userRow = user.rows[0];
    const validPassword =
      await bcrypt.compare(
        password,
        userRow.password
      );

    if (!validPassword) {
      await createFailedLoginNotification({ username: userRow.username, reason: 'invalid password', ipAddress: getClientIp(req) });

      return res.status(401).json(
        "Invalid password"
      );

    }

    if (userRow.deletion_requested_at && new Date(userRow.deletion_requested_at).getTime() > Date.now()) {
      await pool.query(
        `UPDATE users
         SET status = 'blocked', deletion_backup_status = COALESCE(deletion_backup_status, status)
         WHERE id = $1 AND status IS DISTINCT FROM 'blocked'`,
        [userRow.id]
      );
      await createFailedLoginNotification({ username: userRow.username, reason: 'account deletion cooling period is active', ipAddress: getClientIp(req) });
      return res.status(403).json({
        message: "This account is in a 60-minute deletion cooling period and cannot log in until it is cancelled or the timer expires.",
        deletion_requested_at: new Date(userRow.deletion_requested_at).toISOString()
      });
    }

    let normalizedStatus = String(userRow.status || "").trim().toLowerCase();

    if (normalizedStatus === "blocked") {
      await createFailedLoginNotification({ username: userRow.username, reason: 'account is blocked', ipAddress: getClientIp(req) });
      return res.status(403).json(
        "Your account has been blocked. Please contact support."
      );
    }

    if (userRow.role === "contributor" && normalizedStatus === "pending" && userRow.contributor_cooling_until) {
      const coolingUntil = new Date(userRow.contributor_cooling_until);
      if (coolingUntil <= new Date()) {
        await pool.query(`UPDATE users SET status = 'active', contributor_cooling_until = NULL WHERE id = $1`, [userRow.id]);
        normalizedStatus = "active";
      }
    }

    if (normalizedStatus === "pending") {
      const coolingUntil = userRow.contributor_cooling_until ? new Date(userRow.contributor_cooling_until) : null;
      const remainingSeconds = coolingUntil ? Math.max(0, Math.ceil((coolingUntil.getTime() - Date.now()) / 1000)) : 0;
      if (userRow.role === "contributor" && remainingSeconds > 0) {
        const remainingHours = Math.floor(remainingSeconds / 3600);
        const remainingMinutes = Math.ceil((remainingSeconds % 3600) / 60);
        return res.status(403).json({
          message: `Your contributor account will be active in ${remainingHours}h ${remainingMinutes}m.`,
          coolingUntil: coolingUntil.toISOString(),
          remainingSeconds
        });
      }
      await createFailedLoginNotification({ username: userRow.username, reason: 'account is pending verification', ipAddress: getClientIp(req) });
      return res.status(403).json(
        "Your account is pending verification. Please verify your email with the OTP code sent to you."
      );
    }

    if (userRow.role === "contributor" && normalizedStatus !== "active") {
      await createFailedLoginNotification({ username: userRow.username, reason: 'contributor account is awaiting approval', ipAddress: getClientIp(req) });
      return res.status(403).json(
        "Your contributor account is awaiting admin approval."
      );
    }

    const otpEnabled = userRow.otp_enabled !== false;

    if (otpEnabled) {
      const suppliedOtp = typeof otp === "string" ? otp.trim() : "";
      const storedOtp = String(userRow.otp_code || "").trim();
      const expiresAt = userRow.otp_code_expires_at ? new Date(userRow.otp_code_expires_at) : null;
      const now = new Date();

      if (!suppliedOtp) {
        const otpResult = await sendLoginOtpEmail(userRow);
        if (!otpResult.sent) {
          return res.status(503).json("Unable to send login OTP right now. Please try again later.");
        }
        return res.status(202).json({
          message: "OTP sent to your registered email. Please enter it to complete login."
        });
      }

      if (!storedOtp || !expiresAt || expiresAt < now || userRow.otp_context !== "login") {
        const otpResult = await sendLoginOtpEmail(userRow);
        if (!otpResult.sent) {
          return res.status(503).json("Unable to send login OTP right now. Please try again later.");
        }
        return res.status(202).json({
          message: "OTP expired or missing. A new code has been sent."
        });
      }

      if (storedOtp !== suppliedOtp) {
        await createFailedLoginNotification({ username: userRow.username, reason: 'invalid OTP', ipAddress: getClientIp(req) });
        return res.status(401).json("Invalid OTP");
      }

      await pool.query(
        `UPDATE users
         SET otp_code = NULL,
             otp_context = NULL,
             otp_code_expires_at = NULL
         WHERE id = $1`,
        [userRow.id]
      );
    }

    const sessionId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO auth_sessions (session_id, user_id, last_activity_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (session_id) DO UPDATE SET last_activity_at = NOW()`,
      [sessionId, userRow.id]
    );

    const token = signJwtToken(
      {
        user: userRow.id,
        sid: sessionId
      },
      { expiresIn: "7d" }
    );

    const loginCustomPermissions = userRow.custom_permissions || {};

    res.cookie('authToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.cookie('session_id', sessionId, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    // Send notification event, but don't fail login if it fails
    try {
      await triggerNotificationEvent('sign_in', {
        id: userRow.id,
        role: userRow.role,
        email: userRow.email,
        username: userRow.username,
        full_name: userRow.full_name || userRow.username
      });
    } catch (notificationErr) {
      console.error('Failed to send login notification:', notificationErr.message);
    }

    res.json({
      token,
      userId: userRow.id,
      username: userRow.username,
      role: userRow.role,
      email: userRow.email,
      fullName: userRow.full_name || userRow.username || "",
      custom_permissions: loginCustomPermissions
    });

  } catch (err) {

    console.error(err.message);

    res.status(500).send(
      "Server error"
    );

  }

});

app.post("/logout", async (req, res) => {
  try {
    const { email, username, full_name } = req.body || {};
    let authenticatedUser = null;
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.cookies?.authToken;
      if (token) {
        const decoded = verifyJwtToken(token);
        if (decoded.sid) {
          await pool.query('DELETE FROM auth_sessions WHERE session_id = $1', [decoded.sid]);
        }
        const userResult = await pool.query('SELECT id, role, email, username, full_name FROM users WHERE id = $1', [decoded.user]);
        authenticatedUser = userResult.rows[0] || null;
      }
    } catch (authErr) {
      console.warn('Logout activity identity unavailable:', authErr.message || authErr);
    }
    if (authenticatedUser || email || username || full_name) {
      await triggerNotificationEvent('logout', {
        id: authenticatedUser?.id,
        role: authenticatedUser?.role,
        email: authenticatedUser?.email || email,
        username: authenticatedUser?.username || username,
        full_name: authenticatedUser?.full_name || full_name
      });
    }
    // Clear the auth cookie
    res.clearCookie('authToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });
    res.clearCookie('session_id', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Logout notification failed', err);
    res.status(500).json({ error: 'Logout notification failed' });
  }
});

app.post("/forgot-password", async (req, res) => {
  try {
    const { identifier } = req.body;

    if (!identifier) {
      return res.status(400).json("Email or username is required");
    }

    const identifierTrimmed = String(identifier).trim();
    const user = await pool.query(
      `SELECT * FROM users WHERE email ILIKE $1 OR username ILIKE $2`,
      [identifierTrimmed, identifierTrimmed]
    );

    if (user.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    const userRow = user.rows[0];
    const result = await sendRecoveryOtpEmail(userRow);

    if (!result.sent) {
      return res.status(500).json("Failed to send recovery OTP email");
    }

    res.json({
      message: "Recovery OTP sent to your registered email. Please verify it to continue.",
      email: userRow.email
    });
  } catch (err) {
    console.error('Forgot password error:', err.message || err);
    res.status(500).json("Server error");
  }
});

app.post("/forgot-password/resend-otp", async (req, res) => {
  try {
    const { identifier } = req.body;

    if (!identifier) {
      return res.status(400).json("Email or username is required");
    }

    const identifierTrimmed = String(identifier).trim();
    const user = await pool.query(
      `SELECT * FROM users WHERE email ILIKE $1 OR username ILIKE $2`,
      [identifierTrimmed, identifierTrimmed]
    );

    if (user.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    const userRow = user.rows[0];
    const result = await sendRecoveryOtpEmail(userRow);

    if (!result.sent) {
      return res.status(500).json("Failed to resend recovery OTP email");
    }

    res.json({
      message: "Recovery OTP resent to your registered email.",
      email: userRow.email
    });
  } catch (err) {
    console.error('Forgot password resend OTP error:', err.message || err);
    res.status(500).json("Server error");
  }
});

app.post("/forgot-password/verify-otp", async (req, res) => {
  try {
    const { identifier, otp } = req.body;

    if (!identifier || !otp) {
      return res.status(400).json("Email/username and OTP are required");
    }

    const identifierTrimmed = String(identifier).trim();
    const user = await pool.query(
      `SELECT * FROM users WHERE email ILIKE $1 OR username ILIKE $2`,
      [identifierTrimmed, identifierTrimmed]
    );

    if (user.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    const userRow = user.rows[0];
    const now = new Date();
    const storedOtp = String(userRow.otp_code || "").trim();
    const expiresAt = userRow.otp_code_expires_at ? new Date(userRow.otp_code_expires_at) : null;

    if (!storedOtp || !expiresAt || expiresAt < now || userRow.otp_context !== "recovery") {
      return res.status(401).json("Invalid or expired OTP");
    }

    if (storedOtp !== String(otp).trim()) {
      return res.status(401).json("Invalid OTP");
    }

    res.json({ message: "OTP verified. Please set your new password." });
  } catch (err) {
    console.error('Verify OTP error:', err.message || err);
    res.status(500).json("Server error");
  }
});

app.post("/forgot-password/reset-password", async (req, res) => {
  try {
    const { identifier, otp, newPassword, confirmPassword } = req.body;

    if (!identifier || !otp) {
      return res.status(400).json("Email/username and OTP are required");
    }

    if (!newPassword || !confirmPassword) {
      return res.status(400).json("New password and confirm password are required");
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json("New password and confirm password do not match");
    }

    const identifierTrimmed = String(identifier).trim();
    const user = await pool.query(
      `SELECT * FROM users WHERE email ILIKE $1 OR username ILIKE $2`,
      [identifierTrimmed, identifierTrimmed]
    );

    if (user.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    const userRow = user.rows[0];
    const now = new Date();
    const storedOtp = String(userRow.otp_code || "").trim();
    const expiresAt = userRow.otp_code_expires_at ? new Date(userRow.otp_code_expires_at) : null;

    if (!storedOtp || !expiresAt || expiresAt < now || userRow.otp_context !== "recovery") {
      return res.status(401).json("Invalid or expired OTP");
    }

    if (storedOtp !== String(otp).trim()) {
      return res.status(401).json("Invalid OTP");
    }

    const hashedPassword = await bcrypt.hash(String(newPassword), 10);

    await pool.query(
      `UPDATE users
       SET password = $1,
           otp_code = NULL,
           otp_context = NULL,
           otp_code_expires_at = NULL,
           temp_password = NULL,
           temp_password_expires_at = NULL
       WHERE id = $2`,
      [hashedPassword, userRow.id]
    );

    res.json({ message: "Password reset successful. Please log in with your new password." });
  } catch (err) {
    console.error('Reset password error:', err.message || err);
    res.status(500).json("Server error");
  }
});

app.post("/forgot-password/confirm-otp", async (req, res) => {
  try {
    const { identifier, otp, newPassword, confirmPassword } = req.body;

    if (!identifier || !otp) {
      return res.status(400).json("Email/username and OTP are required");
    }

    if (!newPassword || !confirmPassword) {
      return res.status(400).json("New password and confirm password are required");
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json("New password and confirm password do not match");
    }

    const identifierTrimmed = String(identifier).trim();
    const user = await pool.query(
      `SELECT * FROM users WHERE email ILIKE $1 OR username ILIKE $2`,
      [identifierTrimmed, identifierTrimmed]
    );

    if (user.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    const userRow = user.rows[0];
    const now = new Date();
    const storedOtp = String(userRow.otp_code || "").trim();
    const expiresAt = userRow.otp_code_expires_at ? new Date(userRow.otp_code_expires_at) : null;

    if (!storedOtp || !expiresAt || expiresAt < now || userRow.otp_context !== "recovery") {
      return res.status(401).json("Invalid or expired OTP");
    }

    if (storedOtp !== String(otp).trim()) {
      return res.status(401).json("Invalid OTP");
    }

    const hashedPassword = await bcrypt.hash(String(newPassword), 10);

    await pool.query(
      `UPDATE users
       SET password = $1,
           otp_code = NULL,
           otp_context = NULL,
           otp_code_expires_at = NULL,
           temp_password = NULL,
           temp_password_expires_at = NULL
       WHERE id = $2`,
      [hashedPassword, userRow.id]
    );

    res.json({ message: "Password reset successful. Please log in with your new password." });
  } catch (err) {
    console.error('Confirm OTP error:', err.message || err);
    res.status(500).json("Server error");
  }
});

/* ---------------- DASHBOARD ---------------- */

app.get("/admin/promotions", verifyAdmin, async (req, res) => {
  try {
    const dashboard = {
      active_campaigns: (await pool.query("SELECT COUNT(*)::int AS count FROM marketing_campaigns WHERE status = 'active'")) .rows[0].count,
      scheduled_campaigns: (await pool.query("SELECT COUNT(*)::int AS count FROM marketing_campaigns WHERE status = 'scheduled'")) .rows[0].count,
      expired_campaigns: (await pool.query("SELECT COUNT(*)::int AS count FROM marketing_campaigns WHERE status = 'expired'")) .rows[0].count,
      coupons_created: (await pool.query("SELECT COUNT(*)::int AS count FROM coupon_codes")) .rows[0].count,
      coupons_redeemed: (await pool.query("SELECT COUNT(*)::int AS count FROM coupon_redemptions")) .rows[0].count,
      revenue_generated: Number((await pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM coupon_redemptions")).rows[0].total || 0),
      revenue_discounted: Number((await pool.query("SELECT COALESCE(SUM(discount_value), 0) AS total FROM coupon_codes")).rows[0].total || 0),
      average_discount: Number((await pool.query("SELECT COALESCE(AVG(discount_value), 0) AS avg_value FROM coupon_codes WHERE discount_type = 'percentage' OR discount_type = 'flat'")).rows[0].avg_value || 0),
      gift_cards_sold: (await pool.query("SELECT COUNT(*)::int AS count FROM gift_cards")) .rows[0].count,
      referral_revenue: Number((await pool.query("SELECT COALESCE(SUM(CASE WHEN metadata->>'reward' IS NOT NULL THEN CAST(metadata->>'reward' AS NUMERIC) ELSE 0 END), 0) AS total FROM referral_rewards")).rows[0].total || 0),
      loyalty_members: (await pool.query("SELECT COUNT(*)::int AS count FROM loyalty_points")) .rows[0].count,
      flash_sales: (await pool.query("SELECT COUNT(*)::int AS count FROM flash_sales")) .rows[0].count,
      active_banners: (await pool.query("SELECT COUNT(*)::int AS count FROM marketing_banners WHERE status = 'active'")) .rows[0].count,
      newsletter_campaigns: (await pool.query("SELECT COUNT(*)::int AS count FROM promotion_email_campaigns")) .rows[0].count,
      conversion_rate: 0,
      email_open_rate: 0,
      email_click_rate: 0,
      coupon_redemption_rate: (await pool.query("SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND((SELECT COUNT(*) FROM coupon_redemptions)::numeric / COUNT(*) * 100, 2) END AS rate FROM coupon_codes")).rows[0].rate || 0
    };

    const [coupons, campaigns, flashSales, referrals, loyalty, giftCards, bundles, newsletters, banners, popups, announcements, pushNotifications, automations, activityLogs] = await Promise.all([
      pool.query("SELECT * FROM coupon_codes ORDER BY created_at DESC"),
      pool.query("SELECT * FROM marketing_campaigns ORDER BY created_at DESC"),
      pool.query("SELECT * FROM flash_sales ORDER BY created_at DESC"),
      pool.query("SELECT * FROM referral_programs ORDER BY created_at DESC"),
      pool.query("SELECT * FROM loyalty_programs ORDER BY created_at DESC"),
      pool.query("SELECT * FROM gift_cards ORDER BY created_at DESC"),
      pool.query("SELECT * FROM bundle_offers ORDER BY created_at DESC"),
      pool.query("SELECT * FROM promotion_email_campaigns ORDER BY created_at DESC"),
      pool.query("SELECT * FROM marketing_banners ORDER BY created_at DESC"),
      pool.query("SELECT * FROM marketing_popups ORDER BY created_at DESC"),
      pool.query("SELECT * FROM announcement_bar ORDER BY created_at DESC"),
      pool.query("SELECT * FROM promotion_push_notifications ORDER BY created_at DESC"),
      pool.query("SELECT * FROM automation_rules ORDER BY created_at DESC"),
      pool.query("SELECT * FROM promotion_activity_logs ORDER BY created_at DESC LIMIT 50")
    ]);

    return res.json({
      dashboard,
      coupons: coupons.rows,
      campaigns: campaigns.rows,
      flash_sales: flashSales.rows,
      referrals: referrals.rows,
      loyalty: loyalty.rows,
      gift_cards: giftCards.rows,
      bundles: bundles.rows,
      newsletters: newsletters.rows,
      banners: banners.rows,
      popups: popups.rows,
      announcements: announcements.rows,
      push_notifications: pushNotifications.rows,
      automation_rules: automations.rows,
      activity_logs: activityLogs.rows
    });
  } catch (err) {
    console.error("Failed to load promotions data", err);
    return res.status(500).json({ error: "Failed to load promotions data." });
  }
});

app.post("/admin/promotions", verifyAdmin, async (req, res) => {
  try {
    const { resource, action, data = {} } = req.body || {};
    if (!resource || !action) {
      return res.status(400).json({ error: "resource and action are required" });
    }

    const logActivity = async (actionName, details, metadata = {}) => {
      await pool.query(
        `INSERT INTO promotion_activity_logs (action, details, actor_id, metadata) VALUES ($1, $2, $3, $4)`,
        [actionName, details, req.user?.id || null, JSON.stringify(metadata)]
      );
      await recordBusinessEvent(pool, "ADMIN_ACTION", {
        userId: req.user?.id,
        userRole: "admin",
        description: details,
        metadata: { action: actionName, ...metadata }
      });
    };

    const insertIntoTable = async (table, fields, values) => {
      const columns = Object.keys(fields);
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
      const query = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`;
      const result = await pool.query(query, values);
      return result.rows[0];
    };

    const updateTable = async (table, id, fields) => {
      const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
      if (entries.length === 0) {
        return null;
      }
      const setClause = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
      const values = entries.map(([, value]) => value);
      const result = await pool.query(`UPDATE ${table} SET ${setClause}, updated_at = now() WHERE id = $${entries.length + 1} RETURNING *`, [...values, id]);
      return result.rows[0];
    };

    if (resource === "coupon") {
      if (action === "create") {
        const normalizedCode = String(data.code || `PROMO${Date.now()}`).trim().toUpperCase();
        const record = await insertIntoTable("coupon_codes", {
          name: data.name || "Coupon",
          code: normalizedCode,
          coupon_type: data.coupon_type || "manual",
          discount_type: data.discount_type || "percentage",
          discount_value: data.discount_value ?? 0,
          status: data.status || "active",
          start_at: data.start_at || null,
          end_at: data.end_at || null,
          usage_limit: data.usage_limit ?? 0,
          notes: data.notes || "",
          metadata: JSON.stringify(data.metadata || {})
        }, [
          data.name || "Coupon",
          normalizedCode,
          data.coupon_type || "manual",
          data.discount_type || "percentage",
          data.discount_value ?? 0,
          data.status || "active",
          data.start_at || null,
          data.end_at || null,
          data.usage_limit ?? 0,
          data.notes || "",
          JSON.stringify(data.metadata || {})
        ]);
        await logActivity("coupon_created", `Created coupon ${record.code}`, { couponId: record.id });
        await createCouponNotifications(pool, {
          userIds: [req.user.id],
          message: `Coupon "${record.code}" was created by an admin.`
        });
        return res.json(record);
      }
      if (action === "update") {
        const normalizedCode = data.code ? String(data.code).trim().toUpperCase() : undefined;
        const record = await updateTable("coupon_codes", data.id, {
          name: data.name,
          code: normalizedCode,
          coupon_type: data.coupon_type,
          discount_type: data.discount_type,
          discount_value: data.discount_value,
          status: data.status,
          start_at: data.start_at || null,
          end_at: data.end_at || null,
          usage_limit: data.usage_limit,
          notes: data.notes,
          metadata: data.metadata ? JSON.stringify(data.metadata) : undefined
        });
        await logActivity("coupon_updated", `Updated coupon ${data.id}`, { couponId: data.id });
        return res.json(record || { ok: true });
      }
      if (action === "delete") {
        await pool.query("DELETE FROM coupon_codes WHERE id = $1", [data.id]);
        await logActivity("coupon_deleted", `Deleted coupon ${data.id}`, { couponId: data.id });
        return res.json({ ok: true });
      }
      if (action === "duplicate") {
        const source = await pool.query("SELECT * FROM coupon_codes WHERE id = $1", [data.id]);
        if (source.rows.length === 0) return res.status(404).json({ error: "Coupon not found" });
        const original = source.rows[0];
        const record = await insertIntoTable("coupon_codes", {
          name: `${original.name || "Coupon"} Copy`,
          code: `${original.code || "PROMO"}-COPY-${Date.now()}`,
          coupon_type: original.coupon_type,
          discount_type: original.discount_type,
          discount_value: original.discount_value,
          status: original.status,
          start_at: original.start_at,
          end_at: original.end_at,
          usage_limit: original.usage_limit,
          notes: original.notes,
          metadata: original.metadata
        }, [
          `${original.name || "Coupon"} Copy`,
          `${original.code || "PROMO"}-COPY-${Date.now()}`,
          original.coupon_type,
          original.discount_type,
          original.discount_value,
          original.status,
          original.start_at,
          original.end_at,
          original.usage_limit,
          original.notes,
          original.metadata
        ]);
        await logActivity("coupon_duplicated", `Duplicated coupon ${data.id}`, { couponId: record.id });
        return res.json(record);
      }
    }

    if (resource === "campaign") {
      if (action === "create") {
        const record = await insertIntoTable("marketing_campaigns", {
          name: data.name || "Campaign",
          campaign_type: data.campaign_type || "launch",
          objective: data.objective || "",
          status: data.status || "planned",
          budget: data.budget ?? 0,
          start_date: data.start_date || null,
          end_date: data.end_date || null,
          audience: data.audience || "",
          priority: data.priority || "medium",
          notes: data.notes || "",
          metadata: JSON.stringify(data.metadata || {})
        }, [
          data.name || "Campaign",
          data.campaign_type || "launch",
          data.objective || "",
          data.status || "planned",
          data.budget ?? 0,
          data.start_date || null,
          data.end_date || null,
          data.audience || "",
          data.priority || "medium",
          data.notes || "",
          JSON.stringify(data.metadata || {})
        ]);
        await logActivity("campaign_created", `Created campaign ${record.name}`, { campaignId: record.id });
        return res.json(record);
      }
      if (action === "update") {
        const record = await updateTable("marketing_campaigns", data.id, {
          name: data.name,
          campaign_type: data.campaign_type,
          objective: data.objective,
          status: data.status,
          budget: data.budget,
          start_date: data.start_date || null,
          end_date: data.end_date || null,
          audience: data.audience,
          priority: data.priority,
          notes: data.notes,
          metadata: data.metadata ? JSON.stringify(data.metadata) : undefined
        });
        await logActivity("campaign_updated", `Updated campaign ${data.id}`, { campaignId: data.id });
        return res.json(record || { ok: true });
      }
      if (action === "delete") {
        await pool.query("DELETE FROM marketing_campaigns WHERE id = $1", [data.id]);
        await logActivity("campaign_deleted", `Deleted campaign ${data.id}`, { campaignId: data.id });
        return res.json({ ok: true });
      }
    }

    if (resource === "flash_sale") {
      if (action === "create") {
        const record = await insertIntoTable("flash_sales", {
          name: data.name || "Flash Sale",
          discount_rule: data.discount_rule || "",
          status: data.status || "scheduled",
          start_date: data.start_date || null,
          end_date: data.end_date || null,
          featured_placement: data.featured_placement || "homepage",
          metadata: JSON.stringify(data.metadata || {})
        }, [
          data.name || "Flash Sale",
          data.discount_rule || "",
          data.status || "scheduled",
          data.start_date || null,
          data.end_date || null,
          data.featured_placement || "homepage",
          JSON.stringify(data.metadata || {})
        ]);
        await logActivity("flash_sale_created", `Created flash sale ${record.name}`, { flashSaleId: record.id });
        return res.json(record);
      }
      if (action === "update") {
        const record = await updateTable("flash_sales", data.id, {
          name: data.name,
          discount_rule: data.discount_rule,
          status: data.status,
          start_date: data.start_date || null,
          end_date: data.end_date || null,
          featured_placement: data.featured_placement,
          metadata: data.metadata ? JSON.stringify(data.metadata) : undefined
        });
        await logActivity("flash_sale_updated", `Updated flash sale ${data.id}`, { flashSaleId: data.id });
        return res.json(record || { ok: true });
      }
      if (action === "delete") {
        await pool.query("DELETE FROM flash_sales WHERE id = $1", [data.id]);
        await logActivity("flash_sale_deleted", `Deleted flash sale ${data.id}`, { flashSaleId: data.id });
        return res.json({ ok: true });
      }
    }

    const resourceTableMap = {
      referral: "referral_programs",
      loyalty: "loyalty_programs",
      gift_card: "gift_cards",
      bundle: "bundle_offers",
      newsletter: "promotion_email_campaigns",
      banner: "marketing_banners",
      popup: "marketing_popups",
      announcement: "announcement_bar",
      push_notification: "promotion_push_notifications",
      automation: "automation_rules"
    };

    if (resourceTableMap[resource]) {
      const table = resourceTableMap[resource];
      if (action === "create") {
        const payload = Object.keys(data).reduce((acc, key) => {
          acc[key] = data[key];
          return acc;
        }, {});
        const insertFields = {
          name: payload.name || "Entry",
          ...payload,
          metadata: JSON.stringify(payload.metadata || {})
        };
        const values = Object.keys(insertFields).map((key) => insertFields[key]);
        const columns = Object.keys(insertFields);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
        const result = await pool.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`, values);
        await logActivity(`${resource}_created`, `Created ${resource} entry`, { resourceId: result.rows[0].id });
        return res.json(result.rows[0]);
      }
      if (action === "delete") {
        await pool.query(`DELETE FROM ${table} WHERE id = $1`, [data.id]);
        await logActivity(`${resource}_deleted`, `Deleted ${resource} entry`, { resourceId: data.id });
        return res.json({ ok: true });
      }
      if (action === "update") {
        const fields = { ...data };
        delete fields.id;
        const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
        const setClause = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
        const values = entries.map(([, value]) => value);
        const result = await pool.query(`UPDATE ${table} SET ${setClause}, updated_at = now() WHERE id = $${entries.length + 1} RETURNING *`, [...values, data.id]);
        await logActivity(`${resource}_updated`, `Updated ${resource} entry`, { resourceId: data.id });
        return res.json(result.rows[0] || { ok: true });
      }
    }

    return res.status(400).json({ error: "Unsupported resource" });
  } catch (err) {
    console.error("Failed to process promotions update", err);
    return res.status(500).json({ error: "Failed to process promotions update." });
  }
});

app.get("/admin/analytics/dashboard", verifyAdmin, async (req, res) => {
  try {
    const range = String(req.query.range || "30d").trim();
    const region = String(req.query.region || "").trim();
    const segment = String(req.query.segment || "").trim();
    const gateway = String(req.query.gateway || "").trim();
    const fromDate = String(req.query.from || "").trim();
    const toDate = String(req.query.to || "").trim();

    const values = [];
    const filters = [];

    if (range === "custom") {
      if (fromDate) {
        values.push(fromDate);
        filters.push(`o.created_at >= $${values.length}`);
      }
      if (toDate) {
        values.push(toDate);
        filters.push(`o.created_at <= $${values.length}`);
      }
      if (!fromDate && !toDate) {
        filters.push(`o.created_at >= CURRENT_DATE - INTERVAL '30 days'`);
      }
    } else {
      const rangeStart = (() => {
        switch (range) {
          case "24h":
            return "CURRENT_TIMESTAMP - INTERVAL '24 hours'";
          case "7d":
            return "CURRENT_DATE - INTERVAL '7 days'";
          case "90d":
            return "CURRENT_DATE - INTERVAL '90 days'";
          default:
            return "CURRENT_DATE - INTERVAL '30 days'";
        }
      })();
      filters.push(`o.created_at >= ${rangeStart}`);
    }

    const regionConditions = {
      US: "(o.customer_country ILIKE 'United States' OR o.customer_country ILIKE 'USA' OR o.customer_country ILIKE 'US')",
      EU: "o.customer_country IN ('United Kingdom','Germany','France','Spain','Italy','Netherlands','Belgium','Sweden','Poland','Austria','Ireland','Denmark','Finland','Portugal','Greece')",
      APAC: "o.customer_country IN ('India','China','Japan','South Korea','Australia','New Zealand','Singapore','Malaysia','Indonesia','Thailand','Philippines','Vietnam')"
    };

    if (region && region !== "All" && regionConditions[region]) {
      filters.push(regionConditions[region]);
    }

    if (segment && segment !== "All") {
      values.push(segment);
      filters.push(`o.order_type = $${values.length}`);
    }

    if (gateway && gateway !== "All") {
      values.push(gateway);
      filters.push(`o.payment_gateway ILIKE $${values.length}`);
    }

    const filterSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const [summaryResult, revenueSeriesResult, salesSeriesResult, categoryBreakdownResult, contributorBreakdownResult, assetBreakdownResult, customerBreakdownResult, geographyBreakdownResult, alertsResult] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN order_status IN ('completed', 'paid') THEN total_amount ELSE 0 END), 0)::numeric AS "totalRevenue",
          COALESCE(SUM(CASE WHEN order_status IN ('completed', 'paid') THEN total_amount ELSE 0 END), 0)::numeric AS "netRevenue",
          COALESCE(SUM(CASE WHEN created_at::date = CURRENT_DATE AND order_status IN ('completed', 'paid') THEN total_amount ELSE 0 END), 0)::numeric AS "todaysRevenue",
          COALESCE(SUM(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' AND order_status IN ('completed', 'paid') THEN total_amount ELSE 0 END), 0)::numeric AS "weeklyRevenue",
          COALESCE(SUM(CASE WHEN created_at >= date_trunc('month', CURRENT_DATE) AND order_status IN ('completed', 'paid') THEN total_amount ELSE 0 END), 0)::numeric AS "monthlyRevenue",
          COALESCE(SUM(CASE WHEN created_at >= date_trunc('year', CURRENT_DATE) AND order_status IN ('completed', 'paid') THEN total_amount ELSE 0 END), 0)::numeric AS "yearlyRevenue",
          COUNT(*)::int AS "totalOrders",
          SUM(CASE WHEN order_status = 'completed' THEN 1 ELSE 0 END)::int AS "completedOrders",
          SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END)::int AS "pendingOrders",
          SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END)::int AS "cancelledOrders",
          SUM(CASE WHEN refund_status = 'refunded' THEN 1 ELSE 0 END)::int AS "refundedOrders",
          COALESCE(ROUND(AVG(total_amount)::numeric, 2), 0)::numeric AS "averageOrderValue",
          COALESCE(ROUND((COUNT(CASE WHEN order_status = 'completed' THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2), 0)::numeric AS "conversionRate",
          COALESCE(ROUND((SUM(CASE WHEN order_status = 'completed' THEN total_amount ELSE 0 END) / NULLIF(COUNT(DISTINCT customer_id), 0))::numeric, 2), 0)::numeric AS "customerLifetimeValue",
          COALESCE(SUM(CASE WHEN order_type = 'subscription' THEN total_amount ELSE 0 END), 0)::numeric AS "monthlyRecurringRevenue",
          COALESCE(SUM(CASE WHEN order_type = 'subscription' THEN total_amount ELSE 0 END), 0)::numeric AS "annualRecurringRevenue",
          (SELECT COUNT(*)::int FROM users WHERE status ILIKE 'active') AS "activeCustomers",
          (SELECT COUNT(*)::int FROM users WHERE role ILIKE 'contributor' AND status ILIKE 'active') AS "activeContributors",
          (SELECT COUNT(*)::int FROM images WHERE status ILIKE 'pending') AS "pendingAssets",
          (SELECT COUNT(*)::int FROM images WHERE status ILIKE 'approved') AS "publishedAssets",
          COALESCE((SELECT SUM(downloads_count) FROM orders WHERE created_at::date = CURRENT_DATE), 0)::int AS "downloadsToday",
          COALESCE((SELECT SUM(downloads_count) FROM orders WHERE created_at >= date_trunc('month', CURRENT_DATE)), 0)::int AS "downloadsThisMonth",
          COALESCE((SELECT COUNT(*)::int FROM users WHERE role ILIKE 'customer' AND status ILIKE 'active'), 0)::int AS "supportTickets",
          COALESCE((SELECT COUNT(*)::int FROM users WHERE role ILIKE 'customer' AND status ILIKE 'active'), 0)::int AS "liveChats",
          COALESCE((SELECT COUNT(*)::int FROM users WHERE role ILIKE 'customer'), 0)::int AS "newsletterSubscribers"
        FROM orders o
        ${filterSql}
      `, values),
      pool.query(`
        SELECT DATE(o.created_at) AS label, COALESCE(SUM(o.total_amount), 0)::numeric AS value
        FROM orders o
        ${filterSql}
        GROUP BY DATE(o.created_at)
        ORDER BY DATE(o.created_at)
      `, values),
      pool.query(`
        SELECT DATE(o.created_at) AS label, COUNT(*)::int AS value
        FROM orders o
        ${filterSql}
        GROUP BY DATE(o.created_at)
        ORDER BY DATE(o.created_at)
      `, values),
      pool.query(`
        SELECT COALESCE(oi.category, 'Uncategorized') AS name, COALESCE(SUM(oi.total_price), 0)::numeric AS value
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        ${filterSql}
        GROUP BY oi.category
        ORDER BY value DESC
        LIMIT 8
      `, values),
      pool.query(`
        SELECT COALESCE(oi.contributor_username, 'Unknown') AS name, COALESCE(SUM(oi.total_price), 0)::numeric AS value
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        ${filterSql}
        GROUP BY oi.contributor_username
        ORDER BY value DESC
        LIMIT 8
      `, values),
      pool.query(`
        SELECT COALESCE(oi.title, 'Untitled') AS name, COUNT(*)::int AS value
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        ${filterSql}
        GROUP BY oi.title
        ORDER BY value DESC
        LIMIT 8
      `, values),
      pool.query(`
        SELECT COALESCE(o.customer_country, 'Unknown') AS name, COUNT(*)::int AS value
        FROM orders o
        ${filterSql}
        GROUP BY o.customer_country
        ORDER BY value DESC
        LIMIT 8
      `, values),
      pool.query(`
        SELECT COALESCE(o.customer_country, 'Unknown') AS name, COALESCE(SUM(o.total_amount), 0)::numeric AS value
        FROM orders o
        ${filterSql}
        GROUP BY o.customer_country
        ORDER BY value DESC
        LIMIT 8
      `, values),
      pool.query(`
        SELECT 'Revenue drop' AS name, 'Revenue is trending below target' AS value
        UNION ALL
        SELECT 'Security alerts', 'Suspicious login patterns detected' AS value
        UNION ALL
        SELECT 'Support backlog', 'Response time above SLA threshold' AS value
      `)
    ]);

    const csvFormat = String(req.query.format || "").trim().toLowerCase();

    const buildCsvValue = (value) => {
      const raw = value === null || value === undefined ? "" : String(value);
      return `"${raw.replace(/"/g, '""')}"`;
    };

    const buildSection = (heading, rows, headers) => {
      const lines = [heading, headers.join(",")];
      rows.forEach((row) => {
        lines.push(headers.map((field) => buildCsvValue(row[field] ?? "")).join(","));
      });
      return lines;
    };

    if (csvFormat === "csv") {
      const summaryRow = summaryResult.rows[0] || {};
      const summaryLines = [
        "Section,Metric,Value",
        ...Object.keys(summaryRow).map((key) => [buildCsvValue("Summary"), buildCsvValue(key), buildCsvValue(summaryRow[key])].join(","))
      ];
      const csvLines = [
        `Filters,Range,${buildCsvValue(range)}`,
        `Filters,Region,${buildCsvValue(region || "All")}`,
        `Filters,Segment,${buildCsvValue(segment || "All")}`,
        `Filters,Gateway,${buildCsvValue(gateway || "All")}`,
        `Filters,From,${buildCsvValue(fromDate)}`,
        `Filters,To,${buildCsvValue(toDate)}`,
        "",
        ...summaryLines,
        "",
        ...buildSection("Revenue Series", revenueSeriesResult.rows, ["label", "value"]),
        "",
        ...buildSection("Sales Series", salesSeriesResult.rows, ["label", "value"]),
        "",
        ...buildSection("Category Breakdown", categoryBreakdownResult.rows, ["name", "value"]),
        "",
        ...buildSection("Contributor Breakdown", contributorBreakdownResult.rows, ["name", "value"]),
        "",
        ...buildSection("Asset Breakdown", assetBreakdownResult.rows, ["name", "value"]),
        "",
        ...buildSection("Customer Breakdown", customerBreakdownResult.rows, ["name", "value"]),
        "",
        ...buildSection("Geography Breakdown", geographyBreakdownResult.rows, ["name", "value"]),
        "",
        ...buildSection("Alerts", alertsResult.rows, ["name", "value"])
      ];

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="admin-analytics-${range || "30d"}.csv"`);
      res.send(csvLines.join("\n"));
      return;
    }

    res.json({
      summary: summaryResult.rows[0] || {},
      revenueSeries: revenueSeriesResult.rows || [],
      salesSeries: salesSeriesResult.rows || [],
      categoryBreakdown: categoryBreakdownResult.rows || [],
      contributorBreakdown: contributorBreakdownResult.rows || [],
      assetBreakdown: assetBreakdownResult.rows || [],
      customerBreakdown: customerBreakdownResult.rows || [],
      geographyBreakdown: geographyBreakdownResult.rows || [],
      alerts: alertsResult.rows || []
    });
  } catch (err) {
    console.error("Failed to load admin analytics dashboard", err);
    res.status(500).json({ error: "Failed to load admin analytics dashboard" });
  }
});

app.get("/dashboard", (req, res) => {

  try {

    const authHeader =
      req.headers["authorization"];

    if (!authHeader) {

      return res.status(401).json(
        "Access denied"
      );

    }

    const token =
      authHeader.split(" ")[1];

    const verified = verifyJwtToken(token);

    res.json({

      message:
        "Welcome to dashboard",

      user: verified,

    });

  } catch (err) {

    console.error(err.message);

    res.status(401).json(
      "Invalid token"
    );

  }

});

/* ----------- THUMBNAIL SERVING ENDPOINT ----------- */

app.get("/api/thumbnail", async (req, res) => {
  try {
    // Set CORS headers to allow cross-origin requests
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    
    const { file, assetId, download } = req.query;
    if (!file) {
      return res.status(400).json({ error: "Missing file parameter" });
    }

    const { absolutePath } = resolveUploadFilePath(file);
    
    if (!fs.existsSync(absolutePath)) {
      const thumbnailDir = path.resolve(__dirname, "uploads");
      const relativeFile = String(file).replace(/^\/+/, "");
      const thumbnailCandidate = path.resolve(thumbnailDir, relativeFile);
      const thumbnailExt = path.extname(thumbnailCandidate).toLowerCase();
      if (thumbnailExt === ".jpg" || thumbnailExt === ".jpeg" || thumbnailExt === ".png") {
        const originalCandidate = resolveOriginalEpsFromThumbnailPath(relativeFile);
        if (originalCandidate && fs.existsSync(originalCandidate)) {
          const processor = processorFactory.getProcessor(originalCandidate);
          if (processor && processor.name === "EpsProcessor") {
            const generated = await processor.process(originalCandidate, assetId || null, null, {
              quality: 30,
              maxWidth: 1200,
              maxHeight: 1200,
            });
            if (generated && generated.success && fs.existsSync(generated.thumbnailPath)) {
              if (download === 'true') {
                const cleanFilename = path.basename(generated.thumbnailPath);
                res.setHeader("Content-Disposition", `attachment; filename="${cleanFilename}"`);
              }
              return streamImageFile(req, res, generated.thumbnailPath, { bypassProcessing: true });
            }
          }
        }
      }
      return res.status(404).json({ error: "Thumbnail not found" });
    }

    // If assetId provided, verify permissions
    if (assetId) {
      try {
        const authHeader = req.headers["authorization"];
        const imageResult = await pool.query(
          `SELECT uploaded_by, status FROM images WHERE id = $1`,
          [assetId]
        );

        if (imageResult.rows.length === 0) {
          return res.status(404).json({ error: "Asset not found" });
        }

        const image = imageResult.rows[0];
        const isApproved = image.status === 'approved' || image.status === 'published' || image.status === 'live';

        if (!isApproved && authHeader) {
          try {
            const token = authHeader.split(" ")[1];
            const decoded = verifyJwtToken(token);
            const userId = decoded.user;
            const isOwner = image.uploaded_by === userId;
            const userRole = (await pool.query(`SELECT role FROM users WHERE id = $1`, [userId])).rows[0]?.role;
            const isAdmin = userRole === 'admin';

            if (!isOwner && !isAdmin) {
              return res.status(403).json({ error: "Access denied" });
            }
          } catch (err) {
            return res.status(403).json({ error: "Unauthorized" });
          }
        } else if (!isApproved) {
          return res.status(403).json({ error: "Access denied" });
        }
      } catch (err) {
        console.warn("Permission check failed, allowing access:", err.message);
      }
    }

    // Set download disposition if requested
    if (download === 'true') {
      const cleanFilename = path.basename(absolutePath);
      res.setHeader("Content-Disposition", `attachment; filename="${cleanFilename}"`);
    }

    return streamImageFile(req, res, absolutePath);
  } catch (err) {
    console.error("Thumbnail request failed", err);
    return res.status(400).json({ error: err.message });
  }
});

/* ---------------- UPLOAD IMAGE ---------------- */

app.post(
  "/upload",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 }
  ]),
  async (req, res) => {

    try {

      const authHeader = req.headers["authorization"];

      if (!authHeader) {
        return res.status(401).json("Access denied");
      }

      const token = authHeader.split(" ")[1];
      const decoded = verifyJwtToken(token);
      const originalFile = req.files && req.files.image ? req.files.image[0] : null;
      const optionalThumbnailFile = req.files && req.files.thumbnail ? req.files.thumbnail[0] : null;
      const {
        title,
        category,
        collection,
        keywords,
        description,
        type
      } = req.body;

      if (!originalFile) {
        return res.status(400).json("No image uploaded");
      }

      if (!title || !category || !collection || !keywords) {
        return res.status(400).json("All fields are required");
      }

      const currentUser = await pool.query(
        `SELECT role, status, contributor_cooling_until FROM users WHERE id = $1`,
        [decoded.user]
      );

      if (currentUser.rows.length === 0) {
        return res.status(404).json("User not found");
      }

      const user = currentUser.rows[0];

      if (user.role !== "contributor" && user.role !== "admin") {
        return res.status(403).json("Only contributors can upload assets.");
      }

      if (user.role === "contributor" && user.status === "pending" && user.contributor_cooling_until && new Date(user.contributor_cooling_until) <= new Date()) {
        await pool.query(`UPDATE users SET status = 'active', contributor_cooling_until = NULL WHERE id = $1`, [decoded.user]);
        user.status = "active";
      }

      if (user.role === "contributor" && user.status !== "active") {
        return res.status(403).json("Contributor account is awaiting approval.");
      }

      const uploaded_by = decoded.user;
      const uploadRelativeDir = path.relative(
        path.join(__dirname, "uploads"),
        path.resolve(originalFile.destination)
      ).replace(/\\/g, "/");

      const storedFilename = path.posix.join(
        uploadRelativeDir === "." ? "" : uploadRelativeDir,
        originalFile.filename
      );

      let thumbnailUrl = null;
      let thumbnailStatus = "pending";

      if (optionalThumbnailFile) {
        const thumbnailFilename = buildOptionalThumbnailName(originalFile.originalname, optionalThumbnailFile.originalname);
        const thumbnailOutputDir = getThumbnailStorageDirectory(originalFile.path || originalFile.destination);
        const targetThumbnailPath = path.join(thumbnailOutputDir, thumbnailFilename);
        const optionalThumbnailQuality = getOptionalThumbnailQuality();

        try {
          fs.mkdirSync(thumbnailOutputDir, { recursive: true });
          if (fs.existsSync(targetThumbnailPath)) {
            fs.unlinkSync(targetThumbnailPath);
          }

          const sourceExt = path.extname(optionalThumbnailFile.originalname || '').toLowerCase();

          if (['.jpg', '.jpeg', '.png', '.webp'].includes(sourceExt)) {
            await createWatermarkedOptionalThumbnail(optionalThumbnailFile.path, targetThumbnailPath, {
              quality: optionalThumbnailQuality,
            });

            if (fs.existsSync(optionalThumbnailFile.path)) {
              fs.unlinkSync(optionalThumbnailFile.path);
            }
          } else {
            fs.renameSync(optionalThumbnailFile.path, targetThumbnailPath);
          }
          
          const thumbnailRelativePath = path.relative(
            path.resolve(__dirname, "uploads"),
            targetThumbnailPath
          ).replace(/\\/g, "/");
          thumbnailUrl = getPublicThumbnailUrl(thumbnailRelativePath);
          thumbnailStatus = "COMPLETED";
        } catch (err) {
          console.warn("Failed to save optional thumbnail:", err.message || err);
        }
      }

      const newImage = await pool.query(
        `
        INSERT INTO images
        (
          title,
          filename,
          category,
          collection,
          keywords,
          description,
          type,
          uploaded_by,
          created_at,
          downloads,
          views,
          likes,
          status,
          thumbnail_url,
          thumbnail_status
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          NOW(),
          0,
          0,
          0,
          'pending',
          $9,
          $10
        )
        RETURNING *
        `,
        [
          title,
          storedFilename,
          category,
          collection,
          keywords,
          description,
          type,
          uploaded_by,
          thumbnailUrl,
          thumbnailStatus
        ]
      );

      const fileExt = path.extname(originalFile.filename).toLowerCase();
      if (isThumbnailSupportedFile(originalFile.filename)) {
        try {
          const fullFilePath = path.resolve(originalFile.destination, originalFile.filename);
          await thumbnailQueue.queueThumbnailJob(
            newImage.rows[0].id,
            decoded.user,
            fullFilePath,
            fileExt.substring(1)
          );
        } catch (err) {
          console.warn(`Failed to queue thumbnail processing: ${err.message}`);
        }
      }

      await recordBusinessEvent(pool, "ASSET_UPLOADED", {
        userId: decoded.user,
        userRole: user.role,
        assetId: newImage.rows[0].id,
        assetTitle: title,
        actorId: decoded.user,
        description: `Asset uploaded: ${title}`,
        metadata: { filename: storedFilename, thumbnailStatus }
      });

      res.json(newImage.rows[0]);

    } catch (err) {
      console.error("UPLOAD ERROR:", err);
      res.status(500).json(err.message);
    }

  }
);
/* ---------------- CREDITS HISTORY ---------------- */

app.get(
  "/credits/history",
  async (req, res) => {
    try {
      const authHeader = req.headers["authorization"];

      // If ?all=true and no auth header, return global latest 50 (public view)
      if (req.query.all === 'true' && !authHeader) {
        const history = await pool.query(
          `
          SELECT ch.id, ch.credits, ch.payment_method, ch.transaction_id, ch.amount_paid, ch.currency, ch.created_at, u.username, u.email
          FROM credits_history ch
          LEFT JOIN users u ON ch.user_id = u.id
          ORDER BY ch.created_at DESC
          LIMIT 50
          `
        );
        return res.json(history.rows || []);
      }

      if (!authHeader) {
        return res.status(401).json("Access denied");
      }

      const token = authHeader.split(" ")[1];
      const decoded = verifyJwtToken(token);

      // If authenticated and ?all=true, only allow admins to fetch global view
      if (req.query.all === 'true') {
        const u = await pool.query(`SELECT role FROM users WHERE id = $1`, [decoded.user]);
        if (u.rows.length > 0 && u.rows[0].role === 'admin') {
          const history = await pool.query(
            `
            SELECT ch.id, ch.credits, ch.payment_method, ch.transaction_id, ch.amount_paid, ch.currency, ch.created_at, u.username, u.email
            FROM credits_history ch
            LEFT JOIN users u ON ch.user_id = u.id
            ORDER BY ch.created_at DESC
            LIMIT 50
            `
          );
          return res.json(history.rows || []);
        }
        // Non-admins fall through to per-user view
      }

      const history = await pool.query(
        `
        SELECT ch.id, ch.credits, ch.payment_method, ch.transaction_id, ch.amount_paid, ch.currency, ch.created_at, u.username, u.email
        FROM credits_history ch
        LEFT JOIN users u ON ch.user_id = u.id
        WHERE ch.user_id = $1
        ORDER BY ch.created_at DESC
        LIMIT 50
        `,
        [decoded.user]
      );

      res.json(history.rows || []);
    } catch (err) {
      console.error(err);
      res.status(500).send("Failed to fetch credit history");
    }
  }
);

/* ---------------- CONTRIBUTOR PAYOUT REQUESTS ---------------- */

const decodeAuthUser = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) throw new Error("Access denied");
  return verifyJwtToken(authHeader.split(" ")[1]).user;
};

app.post("/payout-requests", payoutUpload.single("cancelled_check"), async (req, res) => {
  let client;
  try {
    const userId = decodeAuthUser(req);
    const requestedCredits = Number(req.body.requested_credits);
    const { email, phone, whatsapp } = req.body;
    if (!Number.isInteger(requestedCredits) || requestedCredits < 100) return res.status(400).json({ error: "Minimum payout request is 100 credits" });
    if (!email || !phone || !whatsapp || !req.file) return res.status(400).json({ error: "Email, phone, WhatsApp number and cancelled check are required" });
    if (!/^\d+$/.test(String(phone).trim()) || !/^\d+$/.test(String(whatsapp).trim())) return res.status(400).json({ error: "Phone and WhatsApp numbers must contain digits only" });

    client = await pool.connect();
    await client.query("BEGIN");
    const userResult = await client.query("SELECT username, role, COALESCE(credits, 0) AS credits FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const user = userResult.rows[0];
    if (!user || user.role !== "contributor") throw new Error("Only contributors can request payouts");
    const earningsResult = await client.query(
      `SELECT GREATEST(
         COALESCE((SELECT SUM(earnings) FROM images WHERE uploaded_by = $1), 0) +
         COALESCE((SELECT SUM(amount_paid) FROM credits_history WHERE user_id = $1 AND payment_method = 'redeem'), 0) -
         COALESCE((SELECT SUM(requested_credits) FROM payout_requests WHERE contributor_id = $1 AND status <> 'rejected'), 0),
         0
       ) AS unpaid_earnings`,
      [userId]
    );
    const unpaidEarnings = Number(earningsResult.rows[0]?.unpaid_earnings || 0);
    if (requestedCredits > Math.floor(unpaidEarnings)) throw new Error("Requested credits exceed your available unpaid earnings");
    if (Number(user.credits) < requestedCredits) throw new Error("Requested credits exceed your available balance");

    const relativePath = path.relative(path.join(__dirname, "uploads"), req.file.path).split(path.sep).join("/");
    const requestResult = await client.query(
      `INSERT INTO payout_requests (contributor_id, requested_credits, email, phone, whatsapp, cancelled_check_path)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, requestedCredits, email.trim(), phone.trim(), whatsapp.trim(), relativePath]
    );
    await client.query("UPDATE users SET credits = COALESCE(credits, 0) - $1 WHERE id = $2", [requestedCredits, userId]);
    await client.query("COMMIT");
    await recordBusinessEvent(pool, "PAYOUT_REQUESTED", {
      userId,
      userRole: "contributor",
      description: `Payout requested: ${requestedCredits} credits`,
      metadata: { requestedCredits }
    });
    res.status(201).json(requestResult.rows[0]);
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    const statusCode = /Access denied|invalid token/i.test(err.message) ? 401 : /exceed|Minimum|required|contributors/i.test(err.message) ? 400 : 500;
    res.status(statusCode).json({ error: err.message || "Failed to submit payout request" });
  } finally {
    client?.release();
  }
});

app.get("/payout-requests", async (req, res) => {
  try {
    const userId = decodeAuthUser(req);
    const result = await pool.query(
      `SELECT pr.*, u.username, u.email AS account_email
       FROM payout_requests pr JOIN users u ON u.id = pr.contributor_id
       WHERE pr.contributor_id = $1 ORDER BY pr.created_at DESC LIMIT 100`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(401).json({ error: err.message || "Access denied" });
  }
});

app.post("/redeem-credits", async (req, res) => {
  let client;
  try {
    const userId = decodeAuthUser(req);
    const credits = Number(req.body?.credits);
    if (!Number.isInteger(credits) || credits < 50) return res.status(400).json({ error: "Minimum redemption is 50 credits" });
    client = await pool.connect();
    await client.query("BEGIN");
    const userResult = await client.query(
      "UPDATE users SET credits = COALESCE(credits, 0) - $1 WHERE id = $2 AND COALESCE(credits, 0) >= $1 RETURNING credits",
      [credits, userId]
    );
    if (!userResult.rows[0]) throw new Error("Insufficient credits");
    await client.query(
      `INSERT INTO credits_history (user_id, credits, payment_method, amount_paid, currency)
       VALUES ($1, $2::integer, 'redeem', $2::numeric, 'INR')`,
      [userId, credits]
    );
    await client.query("COMMIT");
    res.json({ credits_redeemed: credits, remaining_credits: userResult.rows[0].credits });
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    res.status(/Insufficient|Minimum/i.test(err.message) ? 400 : 401).json({ error: err.message || "Failed to redeem credits" });
  } finally {
    client?.release();
  }
});

app.get("/admin/payout-requests", verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.*, u.username, u.email AS account_email
       FROM payout_requests pr JOIN users u ON u.id = pr.contributor_id
       ORDER BY pr.created_at DESC LIMIT 500`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to load payout requests" });
  }
});

app.put("/admin/payout-requests/:id/status", verifyAdmin, async (req, res) => {
  try {
    const allowedStatuses = ["reviewed", "approved", "rejected", "payment_done"];
    const { status, admin_note } = req.body || {};
    if (!allowedStatuses.includes(status)) return res.status(400).json({ error: "Invalid payout status" });
    const adminId = decodeAuthUser(req);
    const result = await pool.query(
      `UPDATE payout_requests
       SET status = $1, admin_note = $2, reviewed_by = $3, reviewed_at = CASE WHEN $1 = 'reviewed' THEN NOW() ELSE reviewed_at END,
           paid_at = CASE WHEN $1 = 'payment_done' THEN NOW() ELSE paid_at END, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [status, admin_note || null, adminId, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Payout request not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to update payout status" });
  }
});

app.get("/admin/credit-requests", verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id AS order_id, o.order_number, o.payment_status, o.order_status, o.created_at,
             u.id AS customer_id, u.username, u.email, u.full_name,
             u.phone, oi.credit_amount, oi.quantity,
             (
               SELECT MAX(previous.created_at) FROM orders previous
               JOIN order_items previous_item ON previous_item.order_id = previous.id
               WHERE previous.customer_id = o.customer_id
                 AND previous.order_type = 'credit_purchase'
                 AND previous.id < o.id
             ) AS previous_requested_at,
             (
               SELECT COALESCE(SUM(previous_item.credit_amount * previous_item.quantity), 0)
               FROM orders previous
               JOIN order_items previous_item ON previous_item.order_id = previous.id
               WHERE previous.customer_id = o.customer_id
                 AND previous.order_type = 'credit_purchase'
                 AND previous.id < o.id
             ) AS previous_requested_credits
      FROM orders o
      JOIN users u ON u.id = o.customer_id
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.order_type = 'credit_purchase'
      ORDER BY o.created_at DESC, o.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load credit requests" });
  }
});

app.put("/admin/credit-requests/:id/status", verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { status } = req.body || {};
    if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "Invalid credit request status" });
    await client.query("BEGIN");
    const requestResult = await client.query(
      `SELECT o.id, o.customer_id, o.order_number, o.order_status, u.username
       FROM orders o JOIN users u ON u.id = o.customer_id
       WHERE o.id = $1 AND o.order_type = 'credit_purchase'
       FOR UPDATE OF o`,
      [req.params.id]
    );
    const request = requestResult.rows[0];
    if (!request) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Credit request not found" });
    }
    if (request.order_status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Credit request has already been decided" });
    }
    const creditsResult = await client.query("SELECT COALESCE(SUM(credit_amount * quantity), 0)::int AS credits FROM order_items WHERE order_id = $1", [request.id]);
    request.credits = Number(creditsResult.rows[0]?.credits || 0);

    if (status === "approved") {
      await client.query("UPDATE users SET credits = COALESCE(credits, 0) + $1 WHERE id = $2", [request.credits, request.customer_id]);
      await client.query("UPDATE order_items SET download_status = 'available' WHERE order_id = $1", [request.id]);
      await client.query("UPDATE orders SET payment_status = 'paid', order_status = 'completed', download_status = 'available', updated_at = NOW() WHERE id = $1", [request.id]);
    } else {
      await client.query("UPDATE order_items SET download_status = 'blocked' WHERE order_id = $1", [request.id]);
      await client.query("UPDATE orders SET payment_status = 'failed', order_status = 'cancelled', download_status = 'blocked', updated_at = NOW() WHERE id = $1", [request.id]);
    }
    await client.query("INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1, $2, FALSE, NOW())", [request.username, `Credit request ${request.order_number} was ${status}.`]);
    await client.query("COMMIT");
    res.json({ success: true, status });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Failed to update credit request" });
  } finally {
    client.release();
  }
});

/* ---------------- TRACK KEYWORD SEARCH ---------------- */

app.post("/search-keyword", async (req, res) => {
  try {
    const { keyword } = req.body;

    if (!keyword || keyword.trim() === "") {
      return res.json({
        success: false,
      });
    }

    const cleanKeyword = keyword.trim().toLowerCase();

    const existing = await pool.query(
      `
      SELECT id
      FROM keyword_searches
      WHERE keyword = $1
      `,
      [cleanKeyword]
    );

    if (existing.rows.length === 0) {
      await pool.query(
        `
        INSERT INTO keyword_searches
        (
          keyword,
          search_count,
          created_at,
          updated_at
        )
        VALUES
        (
          $1,
          1,
          NOW(),
        ON CONFLICT (user_id, image_id) DO UPDATE SET image_id = EXCLUDED.image_id
        )
        `,
        [cleanKeyword]
      );
    } else {
      await pool.query(
        `
        UPDATE keyword_searches
        SET
          search_count = search_count + 1,
          updated_at = NOW()
        WHERE keyword = $1
        `,
        [cleanKeyword]
      );
    }

    res.json({
      success: true,
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
    });

  }
});
/* ---------------- GET ALL IMAGES ---------------- */

app.get("/images", async (req, res) => {

  try {

    const page =
      parseInt(req.query.page) || 1;

    const limit =
      parseInt(req.query.limit) || 12;

    const offset =
      (page - 1) * limit;

    const category = String(req.query.category || "").trim();
    const collection = String(req.query.collection || "").trim();

    const allApprovedImages = await pool.query(
      `
      SELECT
        images.*,
        users.username
      FROM images
      LEFT JOIN users
      ON images.uploaded_by = users.id
      WHERE images.status = 'approved'
      ORDER BY
        images.updated_at DESC,
        images.created_at DESC,
        images.id DESC
      `
    );

    const filteredImages = applyCatalogFilters(allApprovedImages.rows, {
      category,
      collection,
    });

    const pagedImages = filteredImages.slice(offset, offset + limit);

    const totalCount = filteredImages.length;
    const stats = filteredImages.reduce(
      (acc, image) => ({
        total_likes: acc.total_likes + Number(image.likes || 0),
        total_downloads: acc.total_downloads + Number(image.downloads || 0),
        total_views: acc.total_views + Number(image.views || 0),
      }),
      { total_likes: 0, total_downloads: 0, total_views: 0 }
    );

    res.json({
      images: pagedImages,

      totalImages: totalCount,

      totalLikes: stats.total_likes,

      totalDownloads: stats.total_downloads,

      totalViews: stats.total_views,
    });

  } catch (err) {

    console.error(err.message);

    res.json({
      images: [],
      totalImages: 0,
      totalLikes: 0,
      totalDownloads: 0,
      totalViews: 0,
    });

  }

});

/* ---------------- GET TRENDING IMAGES (TOP DOWNLOADS) ---------------- */

app.get("/images/trending", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;

    const result = await pool.query(
      `
      SELECT id, title, filename, downloads, views, likes, uploaded_by
      FROM images
      WHERE status = 'approved'
      ORDER BY downloads DESC, id DESC
      LIMIT $1
      `,
      [limit]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch trending images");
  }

});
/* ---------------- MONTHLY DOWNLOAD CHART ---------------- */

app.get("/api/monthly-downloads/:userId", async (req, res) => {

  const { userId } = req.params;

  try {

    const result = await pool.query(
      `
      SELECT
        TO_CHAR(downloaded_at, 'Mon') AS month,
        COUNT(*) AS downloads
      FROM downloads
      WHERE user_id = $1
      GROUP BY month,
               DATE_TRUNC('month', downloaded_at)
      ORDER BY DATE_TRUNC('month', downloaded_at)
      `,
      [userId]
    );

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Failed to load chart"
    });

  }

});
/* ---------------- GET SINGLE IMAGE ---------------- */

app.get(
  "/images/:id",
  async (req, res) => {

    try {

      const { id } = req.params;

      const image =
        await pool.query(

          `
          SELECT *
          FROM images
          WHERE id = $1
          `,

          [id]

        );

      if (
        image.rows.length === 0
      ) {

        return res.status(404).json(
          "Image not found"
        );

      }

      res.json(
        image.rows[0]
      );

    } catch (err) {

      console.error(err.message);

      res.status(500).send(
        "Fetch image error"
      );

    }

  }
);

/* ---------------- INCREASE VIEW COUNT ---------------- */

app.put(
  "/images/:id/view",
  async (req, res) => {

    try {

      const { id } = req.params;

      const updatedImage =
        await pool.query(

          `
          UPDATE images
          SET views = COALESCE(views, 0) + 1
          WHERE id = $1
          RETURNING *
          `,

          [id]

        );

      if (
        updatedImage.rows.length === 0
      ) {

        return res.status(404).json(
          "Image not found"
        );

      }

      res.json(
        updatedImage.rows[0]
      );

    } catch (err) {

      console.error(err.message);

      res.status(500).send(
        "View update error"
      );

    }

  }
);

/* ---------------- LIKE IMAGE ---------------- */

app.put(
  "/images/:id/like",
  async (req, res) => {

    try {

      const { id } = req.params;

      const updatedImage =
        await pool.query(

          `
          UPDATE images
          SET likes = COALESCE(likes, 0) + 1
          WHERE id = $1
          RETURNING *
          `,

          [id]

        );

      if (
        updatedImage.rows.length === 0
      ) {

        return res.status(404).json(
          "Image not found"
        );

      }
      const image =
  updatedImage.rows[0];
  const owner =
  await pool.query(
    `
    SELECT username, email, full_name
    FROM users
    WHERE id = $1
    `,
    [image.uploaded_by]
  );

await triggerNotificationEvent('favorite', {
  email: owner.rows[0]?.email,
  id: image.uploaded_by,
  role: 'contributor',
  username: owner.rows[0]?.username,
  full_name: owner.rows[0]?.full_name || owner.rows[0]?.username
});

await recordBusinessEvent(pool, "ASSET_LIKED", {
  userId: image.uploaded_by,
  userRole: 'contributor',
  assetId: image.id,
  description: `Asset liked: ${image.title}`
});

await pool.query(
  `
  INSERT INTO notifications
(
  username,
  message,
  is_read
)
VALUES
(
  $1,
  $2,
  FALSE
)
  `,
  [
  owner.rows[0].username,
  `❤️ Someone liked your image "${image.title}"`
]
);

      res.json(
        updatedImage.rows[0]
      );

    } catch (err) {

      console.error(err.message);

      res.status(500).send(
        "Like error"
      );

    }

  }
);

/* ---------------- DOWNLOAD IMAGE ---------------- */

async function getSubscriptionDownloadEntitlement(userId) {
  await pool.query(
    `UPDATE custom_subscriptions
     SET status = 'completed', updated_at = now()
     WHERE customer_id = $1
       AND status = 'active'
       AND custom_end_date IS NOT NULL
       AND custom_end_date < CURRENT_DATE`,
    [userId]
  );
  const subscriptionResult = await pool.query(
    `SELECT id, custom_start_date, custom_end_date, custom_permissions
     FROM custom_subscriptions
     WHERE customer_id = $1
       AND status = 'active'
       AND (custom_start_date IS NULL OR custom_start_date <= CURRENT_DATE)
       AND (custom_end_date IS NULL OR custom_end_date >= CURRENT_DATE)
     ORDER BY created_at ASC, id ASC`,
    [userId]
  );
  for (const subscription of subscriptionResult.rows) {
    const permissions = subscription.custom_permissions || {};
    const limit = Number(permissions.download_limit);
    if (!Number.isFinite(limit) || limit < 0) return { subscription, unlimited: true };
    const usedResult = await pool.query(
      `SELECT COUNT(*)::int AS used
       FROM downloads
       WHERE user_id = $1 AND subscription_id = $4
         AND ($2::date IS NULL OR downloaded_at >= $2::date)
         AND ($3::date IS NULL OR downloaded_at <= ($3::date + INTERVAL '1 day'))`,
      [userId, subscription.custom_start_date, subscription.custom_end_date, subscription.id]
    );
    const used = Number(usedResult.rows[0]?.used || 0);
    if (used < limit) return { subscription, unlimited: false, limit, used, remaining: limit - used };
    await pool.query(
      `UPDATE custom_subscriptions
       SET status = 'completed', updated_at = now()
       WHERE id = $1 AND status = 'active'`,
      [subscription.id]
    );
  }
  return null;
}

app.put(
  "/images/:id/download",
  async (req, res) => {

    try {

      const authHeader =
        req.headers["authorization"];

      if (!authHeader) {

        return res.status(401).json(
          "Access denied"
        );

      }

      const token =
        authHeader.split(" ")[1];

      const decoded = verifyJwtToken(token);

      const userId =
        decoded.user;

      /* CHECK USER CREDITS */

      const user =
        await pool.query(

          `
          SELECT credits, username, full_name
          FROM users
          WHERE id = $1
          `,

          [userId]

        );

      const subscriptionEntitlement = await getSubscriptionDownloadEntitlement(userId);
      const hasSubscriptionAccess = Boolean(subscriptionEntitlement && (subscriptionEntitlement.unlimited || subscriptionEntitlement.remaining > 0));
      if (subscriptionEntitlement && !hasSubscriptionAccess) {
        return res.status(400).json("Subscription download limit reached or plan expired");
      }

      if (
        !hasSubscriptionAccess && Number(
          user.rows[0].credits
        ) < 1
      ) {

        return res.status(400).json(
          "Not enough credits"
        );

      }

      /* DEDUCT 1 CREDIT */

      if (!hasSubscriptionAccess) await pool.query(

        `
        UPDATE users
        SET credits = credits - 1
        WHERE id = $1
        `,

        [userId]

      );

      const { id } = req.params;
      await pool.query(

  `
  INSERT INTO downloads
  (
    user_id,
    image_id,
    subscription_id
  )
  VALUES
  (
    $1,
    $2,
    $3
  )
  `,

  [
    userId,
    id,
    hasSubscriptionAccess ? subscriptionEntitlement.subscription.id : null
  ]

);

      const updatedImage =
        await pool.query(

          `
          UPDATE images
          SET earnings = COALESCE(earnings,0) + 0.25
          WHERE id = $1
          RETURNING *
          `,

          [id]

        );

      if (
        updatedImage.rows.length === 0
      ) {

        return res.status(404).json(
          "Image not found"
        );

      }
      const image =
  updatedImage.rows[0];
      const owner =
  await pool.query(
    `
    SELECT username, email
    FROM users
    WHERE id = $1
    `,
    [image.uploaded_by]
  );

      if (hasSubscriptionAccess) {
        const orderNumber = await getSubscriptionOrderNumber();
        const invoiceNumber = await getSubscriptionInvoiceNumber();
        const transactionId = await getNextTransactionId();
        const orderResult = await pool.query(
          `INSERT INTO orders (
             order_number, invoice_number, customer_id, customer_name, subscription_id,
             order_type, currency, subtotal, total_amount, payment_gateway,
             payment_method, transaction_id, payment_status, order_status,
             download_status, assets_count, downloads_count, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,'subscription_download','USD',0,0,'subscription','subscription',$6,'paid','completed','available',1,1,NOW(),NOW())
           RETURNING id`,
          [
            orderNumber,
            invoiceNumber,
            userId,
            user.rows[0]?.full_name || user.rows[0]?.username || 'Customer',
            subscriptionEntitlement.subscription.id,
            transactionId
          ]
        );
        const orderId = orderResult.rows[0].id;
        const license = 'Subscription access';

        await pool.query(
          `INSERT INTO order_items (
             order_id, asset_id, title, category, license, contributor_id,
             contributor_username, quantity, unit_price, total_price,
             currency, download_status, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,1,0,0,'USD','available',NOW())`,
          [orderId, image.id, image.title, image.category || null, license, image.uploaded_by, owner.rows[0]?.username || null]
        );

        const downloadToken = crypto.randomBytes(12).toString('hex');
        await pool.query(
          `INSERT INTO customer_downloads (
             user_id, image_id, order_id, download_token, license,
             expires_at, is_active, created_at
           ) VALUES ($1,$2,$3,$4,$5,NOW() + INTERVAL '100 days',TRUE,NOW())`,
          [userId, image.id, orderId, downloadToken, license]
        );

        await pool.query(
          `INSERT INTO payments (
             order_id, amount, currency, gateway, transaction_id,
             status, response, created_at
           ) VALUES ($1,0,'USD','subscription',$2,'paid',$3,NOW())`,
          [orderId, transactionId, JSON.stringify({ subscriptionId: subscriptionEntitlement.subscription.id })]
        );
      }

      if (owner.rows[0]?.email) {
        await triggerNotificationEvent('download', {
          id: image.uploaded_by,
          role: 'contributor',
          email: owner.rows[0].email,
          username: owner.rows[0].username,
          full_name: owner.rows[0].username
        });
      }

      await recordBusinessEvent(pool, "ASSET_DOWNLOADED", {
        userId,
        userRole: 'customer',
        assetId: image.id,
        notifyUserIds: [userId, image.uploaded_by],
        assetTitle: image.title,
        actorId: userId,
        metadata: { contributor_id: image.uploaded_by },
        description: `Asset downloaded: ${image.title}`
      });

await pool.query(
  `
  INSERT INTO notifications
(
  username,
  message,
  is_read
)
VALUES
(
  $1,
  $2,
  FALSE
)
  `,
  [
  owner.rows[0].username,
  `⬇ Someone downloaded your image "${image.title}"`
]
);

      res.json(
        updatedImage.rows[0]
      );

    } catch (err) {

      console.error(err.message);

      res.status(500).send(
        "Download count error"
      );

    }

  }
);

/* -------- DOWNLOAD ORIGINAL FILE (EPS/AI/PSD/etc) -------- */

app.get(
  "/images/:id/download-original",
  async (req, res) => {
    try {
      const authHeader = req.headers["authorization"];
      if (!authHeader) {
        return res.status(401).json("Access denied");
      }

      const token = authHeader.split(" ")[1];
      const decoded = verifyJwtToken(token);
      const userId = decoded.user;

      const { id } = req.params;

      // Get image details
      const imageResult = await pool.query(
        `SELECT id, filename, uploaded_by, status, title FROM images WHERE id = $1`,
        [id]
      );

      if (imageResult.rows.length === 0) {
        return res.status(404).json("Image not found");
      }

      const image = imageResult.rows[0];

      // Get user info to check role
      const userResult = await pool.query(
        `SELECT role FROM users WHERE id = $1`,
        [userId]
      );

      const userRole = userResult.rows[0]?.role;
      const isContributor = image.uploaded_by === userId;
      const isAdmin = userRole === 'admin';
      const isApproved = image.status === 'approved' || image.status === 'published' || image.status === 'live';

      // Permission check:
      // - Contributor can download their own files
      // - Admin can download any file
      // - Others can download only approved files
      if (!isContributor && !isAdmin && !isApproved) {
        return res.status(403).json("File not available for download");
      }

      // Resolve file path safely
      const filename = image.filename;
      const uploadsRoot = path.join(__dirname, "uploads");
      const filePath = path.resolve(uploadsRoot, filename);
      const uploadsRootResolved = path.resolve(uploadsRoot);
      const relativeToUploads = path.relative(uploadsRootResolved, filePath);

      if (!relativeToUploads || relativeToUploads.startsWith("..") || path.isAbsolute(filename)) {
        return res.status(400).send("Invalid file path");
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).send("File not found");
      }

      // Set content disposition for download
      const cleanFilename = path.basename(filePath);
      res.setHeader("Content-Disposition", `attachment; filename="${cleanFilename}"`);

      // Send file
      res.sendFile(filePath, async (downloadError) => {
        if (!downloadError) {
          if (!isContributor && !isAdmin) {
            await pool.query(
              `INSERT INTO downloads (user_id, image_id, downloaded_at) VALUES ($1, $2, NOW())`,
              [userId, image.id]
            );
            await pool.query(
              `UPDATE images SET downloads = COALESCE(downloads, 0) + 1 WHERE id = $1`,
              [image.id]
            );
          }
          await createAssetNotifications(pool, {
            userIds: [userId, image.uploaded_by],
            eventType: 'ASSET_DOWNLOADED',
            assetTitle: image.title,
            ownerId: image.uploaded_by,
            actorId: userId
          });
        }
      });

    } catch (err) {
      console.error(err.message);
      res.status(500).send("Download error");
    }
  }
);

app.get(
  "/images/:id/download-thumbnail",
  async (req, res) => {
    try {
      const authHeader = req.headers["authorization"];
      if (!authHeader) {
        return res.status(401).json("Access denied");
      }

      const token = authHeader.split(" ")[1];
      const decoded = verifyJwtToken(token);
      const userId = decoded.user;
      const { id } = req.params;

      const imageResult = await pool.query(
        `SELECT id, filename, thumbnail_url, uploaded_by, status FROM images WHERE id = $1`,
        [id]
      );

      if (imageResult.rows.length === 0) {
        return res.status(404).json("Image not found");
      }

      const image = imageResult.rows[0];
      const userResult = await pool.query(`SELECT role FROM users WHERE id = $1`, [userId]);
      const userRole = userResult.rows[0]?.role;
      const isContributor = image.uploaded_by === userId;
      const isAdmin = userRole === 'admin';
      const isApproved = image.status === 'approved' || image.status === 'published' || image.status === 'live';

      if (!isContributor && !isAdmin && !isApproved) {
        return res.status(403).json("Thumbnail not available for download");
      }

      if (!image.thumbnail_url) {
        return res.status(404).json("Thumbnail not available");
      }

      let sourcePath = "";
      let candidate = String(image.thumbnail_url).trim();

      try {
        candidate = decodeURIComponent(candidate);
      } catch (err) {
        // leave as-is when already decoded
      }

      const fileMatch = candidate.match(/[?&]file=([^&]+)/i);
      if (fileMatch && fileMatch[1]) {
        sourcePath = fileMatch[1];
      } else {
        sourcePath = candidate
          .replace(/^https?:\/\/[^/]+/i, "")
          .replace(/^\/+/, "")
          .replace(/^api\/files\/+/, "")
          .replace(/^uploads[\\/]+/, "")
          .replace(/^api\/thumbnail[\\/]+/, "")
          .replace(/^file=/i, "");
      }

      sourcePath = String(sourcePath || "")
        .replace(/^\/+/, "")
        .replace(/^uploads[\\/]+/, "")
        .replace(/^api\/files\/+/, "")
        .replace(/\\/g, "/");

      try {
        sourcePath = decodeURIComponent(sourcePath);
      } catch (err) {
        // leave as-is when already decoded
      }

      if (!sourcePath) {
        return res.status(404).json("Thumbnail file reference missing");
      }

      const thumbnailFilePath = path.resolve(__dirname, "uploads", sourcePath);
      const uploadsRootResolved = path.resolve(__dirname, "uploads");
      const relativeToUploads = path.relative(uploadsRootResolved, thumbnailFilePath);

      if (!relativeToUploads || relativeToUploads.startsWith("..") || path.isAbsolute(sourcePath)) {
        return res.status(400).send("Invalid thumbnail path");
      }

      if (!fs.existsSync(thumbnailFilePath)) {
        return res.status(404).json("Thumbnail file not found");
      }

      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(thumbnailFilePath)}"`);
      return streamImageFile(req, res, thumbnailFilePath, { bypassProcessing: true });
    } catch (err) {
      console.error("thumbnail download failed", err.message || err);
      res.status(500).send("Download error");
    }
  }
);

/* ---------------- DELETE IMAGE ---------------- */

app.delete(
  "/images/:id",
  async (req, res) => {

    try {

      const { id } = req.params;

      // Get image filename first

      const image =
        await pool.query(
          `
          SELECT filename, uploaded_by, title
          FROM images
          WHERE id = $1
          `,
          [id]
        );

      if (
        image.rows.length === 0
      ) {

        return res
          .status(404)
          .json("Image not found");

      }

      const filename =
        image.rows[0].filename;

      // Delete favorites

      await pool.query(
        `
        DELETE FROM favorites
        WHERE image_id = $1
        `,
        [id]
      );

      // Delete downloads

      await pool.query(
        `
        DELETE FROM downloads
        WHERE image_id = $1
        `,
        [id]
      );

      // Delete image record

      await pool.query(
        `
        DELETE FROM images
        WHERE id = $1
        `,
        [id]
      );

      // Delete physical file

      const filePath =
        path.join(
          __dirname,
          "uploads",
          filename
        );

      if (
        fs.existsSync(filePath)
      ) {

        fs.unlinkSync(filePath);

      }

      await createAssetNotifications(pool, {
        userIds: [image.rows[0].uploaded_by],
        eventType: 'ASSET_DELETED',
        assetTitle: image.rows[0].title,
        ownerId: image.rows[0].uploaded_by
      });

      res.json(
        "Image deleted successfully"
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Delete error"
      );

    }

  }
);
/* ---------------- UPDATE IMAGE ---------------- */

app.put(
  "/images/:id",
  async (req, res) => {

    try {

      const { id } = req.params;

      const {
        title,
        category,
        collection,
        keywords,
        description,
        type,
        status
      } = req.body;

      const nextStatus = status && String(status).trim() ? String(status).trim().toLowerCase() : null;

      const updatedImage =
        await pool.query(

          `
          UPDATE images
          SET
            title = $1,
            category = $2,
            collection = $3,
            keywords = $4,
            description = $5,
            type = $6,
            status = COALESCE($8::text, status)
          WHERE id = $7
          RETURNING *
          `,

          [
            title,
            category,
            collection,
            keywords,
            description,
            type,
            id,
            nextStatus
          ]

        );

      if (updatedImage.rows[0]) {
        await createAssetNotifications(pool, {
          userIds: [updatedImage.rows[0].uploaded_by],
          eventType: 'ASSET_UPDATED',
          assetTitle: updatedImage.rows[0].title,
          ownerId: updatedImage.rows[0].uploaded_by
        });
      }

      res.json(
        updatedImage.rows[0]
      );

    } catch (err) {

      console.error(err.message);

      res.status(500).send(
        "Update error"
      );

    }

  }
);

app.post(
  "/images/:id/thumbnail",
  upload.single("thumbnail"),
  async (req, res) => {
    try {
      const authHeader = req.headers["authorization"];
      if (!authHeader) {
        return res.status(401).json("Access denied");
      }

      const token = authHeader.split(" ")[1];
      const decoded = verifyJwtToken(token);
      const { id } = req.params;

      const imageResult = await pool.query(
        `SELECT id, filename, uploaded_by FROM images WHERE id = $1`,
        [id]
      );

      if (imageResult.rows.length === 0) {
        return res.status(404).json("Image not found");
      }

      const image = imageResult.rows[0];
      const userResult = await pool.query(`SELECT role FROM users WHERE id = $1`, [decoded.user]);
      const isOwner = Number(image.uploaded_by) === Number(decoded.user);
      const isAdmin = userResult.rows[0]?.role === "admin";

      if (!isOwner && !isAdmin) {
        return res.status(403).json("Access denied");
      }

      if (!req.file) {
        return res.status(400).json("No thumbnail uploaded");
      }

      const originalBaseName = path.basename(image.filename, path.extname(image.filename)) || "asset";
      const safeBaseName = String(originalBaseName)
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "") || "asset";
      const targetExtension = path.extname(req.file.originalname) || ".png";
      const thumbnailFilename = `thumbnail-${safeBaseName}${targetExtension}`;
      const assetPath = path.join(__dirname, "uploads", image.filename);
      const thumbnailDir = getThumbnailStorageDirectory(assetPath);
      const targetPath = path.join(thumbnailDir, thumbnailFilename);
      const optionalThumbnailQuality = getOptionalThumbnailQuality();

      fs.mkdirSync(thumbnailDir, { recursive: true });

      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }

      const sourceExt = path.extname(req.file.originalname || '').toLowerCase();

      if (['.jpg', '.jpeg', '.png', '.webp'].includes(sourceExt)) {
        await createWatermarkedOptionalThumbnail(req.file.path, targetPath, {
          quality: optionalThumbnailQuality,
        });

        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } else {
        fs.renameSync(req.file.path, targetPath);
      }

      const relativePath = path.relative(path.join(__dirname, "uploads"), targetPath).replace(/\\/g, "/");
      const thumbnailUrl = getPublicThumbnailUrl(relativePath);

      const updated = await pool.query(
        `UPDATE images
         SET thumbnail_url = $1,
             thumbnail_status = 'COMPLETED',
             thumbnail_generated_at = NOW(),
             thumbnail_error = NULL
         WHERE id = $2
         RETURNING *`,
        [thumbnailUrl, id]
      );

      res.json(updated.rows[0]);
    } catch (err) {
      console.error("Thumbnail update error", err);
      res.status(500).json(err.message || "Thumbnail update failed");
    }
  }
);

const authenticateToken = async (
  req,
  res,
  next
) => {

  let token = null;
  const authHeader = req.headers["authorization"];

  if (authHeader) {
    token = authHeader.split(" ")[1];
  } else if (req.cookies && req.cookies.authToken) {
    // Fallback to cookie if Authorization header is missing
    token = req.cookies.authToken;
  }

  if (!token) {
    return res.status(401).json("Access denied");
  }

  try {

    const decoded = verifyJwtToken(token);

    if (!decoded.sid) {
      return res.status(401).json("Session expired. Please log in again.");
    }

    const activityHeader = Number(req.headers["x-session-activity"]);
    const sessionResult = await pool.query(
      `SELECT last_activity_at FROM auth_sessions
       WHERE session_id = $1 AND user_id = $2`,
      [decoded.sid, decoded.user]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(401).json("Session expired. Please log in again.");
    }

    const lastActivity = new Date(sessionResult.rows[0].last_activity_at).getTime();
    const clientActivity = Number.isFinite(activityHeader) && activityHeader > 0
      ? Math.min(activityHeader, Date.now())
      : lastActivity;
    if (Date.now() - Math.max(lastActivity, clientActivity) >= 15 * 60 * 1000) {
      await pool.query("DELETE FROM auth_sessions WHERE session_id = $1", [decoded.sid]);
      return res.status(401).json("Session expired. Please log in again.");
    }
    if (clientActivity > lastActivity) {
      await pool.query(
        `UPDATE auth_sessions SET last_activity_at = to_timestamp($1 / 1000.0)
         WHERE session_id = $2 AND last_activity_at < to_timestamp($1 / 1000.0)`,
        [clientActivity, decoded.sid]
      );
    }

    const userResult = await pool.query(
      `
      SELECT status
      FROM users
      WHERE id = $1
      `,
      [decoded.user]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json(
        "Invalid token"
      );
    }

    const userStatus = String(userResult.rows[0].status || "").trim().toLowerCase();

    if (userStatus === "blocked") {
      return res.status(403).json(
        "Your account has been blocked. Please contact support."
      );
    }

    req.user = {
      id: decoded.user,
      status: userStatus
    };

    next();

  } catch (err) {

    return res.status(403).json(
      "Invalid token"
    );

  }

};

// GET /me - Check auth status and return current user info
// Can restore session from httpOnly cookie or Authorization header
app.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT id, username, email, role, full_name, credits, custom_permissions 
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
      credits: user.credits,
      customPermissions: user.custom_permissions
    });
  } catch (err) {
    console.error('Failed to fetch user:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.get('/subscription-status', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      `UPDATE custom_subscriptions
       SET status = 'completed', updated_at = now()
       WHERE customer_id = $1
         AND status = 'active'
         AND custom_end_date IS NOT NULL
         AND custom_end_date < CURRENT_DATE`,
      [req.user.id]
    );
    const subscriptionEntitlement = await getSubscriptionDownloadEntitlement(req.user.id);
    if (subscriptionEntitlement) {
      const subscription = subscriptionEntitlement.subscription;
      const { limit, used = 0, unlimited } = subscriptionEntitlement;
      const remaining = unlimited ? null : limit - used;
      return res.json({ active: true, canPurchase: unlimited || remaining > 0, plan: subscription.base_plan, duration: subscription.custom_duration, startDate: subscription.custom_start_date, endDate: subscription.custom_end_date, limit: unlimited ? null : limit, used, remaining });
    }
    const subscriptionResult = await pool.query(
      `SELECT id, base_plan, custom_duration, custom_start_date, custom_end_date, custom_permissions, status
       FROM custom_subscriptions
       WHERE customer_id = $1
         AND status IN ('active', 'pending')
         AND (custom_start_date IS NULL OR custom_start_date <= CURRENT_DATE)
         AND (custom_end_date IS NULL OR custom_end_date >= CURRENT_DATE)
      ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [req.user.id]
    );
    const subscription = subscriptionResult.rows[0];
    if (!subscription) return res.json({ active: false, status: null, canPurchase: true });
    if (subscription.status !== 'active') return res.json({ active: false, status: subscription.status, canPurchase: true, plan: subscription.base_plan, duration: subscription.custom_duration, startDate: subscription.custom_start_date, endDate: subscription.custom_end_date, limit: Number(subscription.custom_permissions?.download_limit || 0), used: 0, remaining: Number(subscription.custom_permissions?.download_limit || 0) });

    return res.json({ active: false, status: subscription.status, canPurchase: true, plan: subscription.base_plan, duration: subscription.custom_duration, startDate: subscription.custom_start_date, endDate: subscription.custom_end_date, limit: Number(subscription.custom_permissions?.download_limit || 0), used: 0, remaining: Number(subscription.custom_permissions?.download_limit || 0) });
  } catch (err) {
    console.error('Failed to load subscription status', err);
    res.status(500).json({ error: 'Failed to load subscription status' });
  }
});

app.get('/subscription-history', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
            `SELECT id, base_plan, custom_duration, custom_start_date, custom_end_date,
              status, admin_notes, activity_log, created_at, updated_at
       FROM custom_subscriptions
       WHERE customer_id = $1
       ORDER BY created_at DESC, id DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to load subscription history', err);
    res.status(500).json({ error: 'Failed to load subscription history' });
  }
});

app.post("/checkout/validate-coupon", authenticateToken, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: "Coupon code is required" });
    }

    const normalized = String(code).trim().toUpperCase();
    const couponResult = await pool.query(
      `SELECT * FROM coupon_codes WHERE LOWER(code) = LOWER($1) LIMIT 1`,
      [normalized]
    );

    if (couponResult.rows.length === 0) {
      return res.status(404).json({ error: "Coupon not found" });
    }

    const coupon = couponResult.rows[0];
    if (String(coupon.status || '').toLowerCase() !== 'active') {
      return res.status(400).json({ error: "Coupon is not active" });
    }

    const today = new Date();
    const startAt = coupon.start_at ? new Date(coupon.start_at) : null;
    const endAt = coupon.end_at ? new Date(coupon.end_at) : null;
    if (startAt && startAt > today) {
      return res.status(400).json({ error: "Coupon is not available yet" });
    }
    if (endAt && endAt < today) {
      return res.status(400).json({ error: "Coupon has expired" });
    }

    const usageCountResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2`,
      [coupon.id, req.user.id]
    );
    const usageCount = Number(usageCountResult.rows[0]?.count || 0);
    const usageLimit = Number(coupon.usage_limit || 0);
    if (usageLimit > 0 && usageCount >= usageLimit) {
      return res.status(400).json({ error: "Coupon usage limit reached" });
    }

    res.json({
      coupon: {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        discountType: coupon.discount_type,
        discountValue: Number(coupon.discount_value || 0),
      },
      message: "Coupon applied successfully",
    });
  } catch (error) {
    console.error("Coupon validation failed", error);
    res.status(500).json({ error: "Coupon validation failed" });
  }
});

app.post("/checkout/place-order", authenticateToken, async (req, res) => {
  try {
    const { items = [], billing = {}, paymentMethod = 'development', couponCode = '', currency = 'USD', taxRate = 0.1 } = req.body || {};
    const normalizedItems = Array.isArray(items) ? items : [];
    if (!normalizedItems.length) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    const isCreditPurchase = normalizedItems.every((item) => item.creditPackage);
    if (isCreditPurchase) {
      const creditPriceResult = await pool.query('SELECT credit_prices FROM credit_price_settings ORDER BY id DESC LIMIT 1');
      const creditPrices = creditPriceResult.rows[0]?.credit_prices || { 100: 100, 200: 200, 500: 500, 1000: 1000 };
      normalizedItems.forEach((item) => {
        item.creditAmount = Number(item.creditAmount);
        item.unitPrice = Number(creditPrices[item.creditAmount] || 0);
        item.price = item.unitPrice;
      });
      if (normalizedItems.some((item) => ![100, 200, 500, 1000].includes(item.creditAmount) || item.unitPrice <= 0)) {
        return res.status(400).json({ error: "Invalid credit package" });
      }
    }

    const userResult = await pool.query(
      `SELECT id, email, username, full_name, role, COALESCE(credits, 0) AS credits FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = userResult.rows[0];
    const subscriptionEntitlement = isCreditPurchase ? null : await getSubscriptionDownloadEntitlement(req.user.id);
    if (subscriptionEntitlement && (subscriptionEntitlement.unlimited || subscriptionEntitlement.remaining > 0)) {
      return res.status(400).json({ error: "Your active subscription is valid until its download limit is reached or the plan expires" });
    }

    let coupon = null;
    let discount = 0;
    if (couponCode) {
      const couponResult = await pool.query(
        `SELECT * FROM coupon_codes WHERE LOWER(code) = LOWER($1) LIMIT 1`,
        [String(couponCode).trim()]
      );
      if (couponResult.rows.length > 0) {
        coupon = couponResult.rows[0];
        if (coupon.discount_type === 'percentage') {
          discount = 0;
        } else if (coupon.discount_type === 'flat') {
          discount = Number(coupon.discount_value || 0);
        }
      }
    }

    const paymentSettings = getPaymentSettings();
    const normalizedPaymentMethod = String(paymentMethod || '').trim().toLowerCase();
    const paymentConfig = paymentSettings[normalizedPaymentMethod];
    const paymentGatewayValue = paymentConfig?.gateway || (paymentMethod === 'development' ? 'development' : paymentMethod);
    const isCreditsPayment = normalizedPaymentMethod === "gfx's credits";
    const isGooglePayPayment = normalizedPaymentMethod === 'google pay';
    const isAdminCreditRequest = normalizedPaymentMethod === 'request to admin';
    if (isCreditPurchase && !isAdminCreditRequest) {
      return res.status(400).json({ error: 'Credit packages must be requested from an admin' });
    }
    if (!isCreditPurchase && isAdminCreditRequest) {
      return res.status(400).json({ error: 'Request to Admin is only available for credit packages' });
    }

    const subtotal = normalizedItems.reduce((sum, item) => {
      const quantity = Math.max(1, Number(item.quantity || 1));
      const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
      return sum + unitPrice * quantity;
    }, 0);

    const normalizedDiscount = Math.min(subtotal, Number(discount || 0));
    const tax = Number(((Math.max(0, subtotal - normalizedDiscount)) * Number(taxRate || 0)).toFixed(2));
    const total = Number(Math.max(0, subtotal - normalizedDiscount + tax).toFixed(2));
    const creditsToDeduct = Math.max(0, Math.ceil(total));

    if (isCreditsPayment && Number(user.credits || 0) < creditsToDeduct) {
      return res.status(400).json({ error: `Insufficient credits. You have ${Number(user.credits || 0)} credits, but ${creditsToDeduct} are required.` });
    }

    async function generateOrderNumber() {
      const now = new Date();
      const istParts = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
      }).formatToParts(now);

      const day = istParts.find((part) => part.type === 'day')?.value || '00';
      const month = istParts.find((part) => part.type === 'month')?.value || '00';
      const year = istParts.find((part) => part.type === 'year')?.value || '00';

      const datePrefix = `${day}${month}${year}`;
      const orderPrefix = `GFX${datePrefix}`;
      const prefixLike = `${orderPrefix}-%`;

      const existingRes = await pool.query(
        `SELECT order_number FROM orders WHERE order_number LIKE $1`,
        [prefixLike]
      );

      let maxSequence = 0;
      for (const row of existingRes.rows) {
        const orderNumberValue = String(row.order_number || '');
        const suffix = orderNumberValue.replace(`${orderPrefix}-`, '');
        const numericSuffix = Number.parseInt(suffix, 10);
        if (!Number.isNaN(numericSuffix) && numericSuffix > maxSequence) {
          maxSequence = numericSuffix;
        }
      }

      const nextSequence = maxSequence + 1;
      const sequencePad = String(nextSequence).padStart(2, '0');

      return `${orderPrefix}-${sequencePad}`;
    }

    const orderNumber = await generateOrderNumber();

    async function generateInvoiceNumber() {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yy = String(now.getFullYear()).slice(-2);
      const dayAbbr = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();

      const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      const idxs = [ (now.getMonth() - 2 + 12) % 12, (now.getMonth() - 1 + 12) % 12, now.getMonth() ];
      const monthCode = idxs.map(i => monthNames[i][0]).join('');

      const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM invoices WHERE DATE(issued_at) = CURRENT_DATE`);
      const seq = Number(countRes.rows[0]?.c || 0) + 1;
      const seqPad = String(seq).padStart(2, '0');

      return `${dd}${mm}${yy}${dayAbbr}${monthCode}${seqPad}`;
    }

    const invoiceNumber = await generateInvoiceNumber();

    await pool.query('BEGIN');

    try {
      const transactionId = await getNextTransactionId();
        if (isCreditsPayment && creditsToDeduct > 0) {
          const creditResult = await pool.query(
            `UPDATE users SET credits = COALESCE(credits, 0) - $1 WHERE id = $2 AND COALESCE(credits, 0) >= $1 RETURNING credits`,
            [creditsToDeduct, req.user.id]
          );
          if (creditResult.rows.length === 0) {
            throw new Error('Insufficient credits');
          }
          await pool.query(
            `INSERT INTO credits_history (user_id, credits, payment_method, amount_paid, currency) VALUES ($1, $2, $3, $4, $5)`,
            [req.user.id, -creditsToDeduct, 'purchase', total, String(currency).toUpperCase()]
          );
        }

        const orderValues = [
          orderNumber,
          invoiceNumber,
          req.user.id,
          String(billing.fullName || billing.full_name || user.full_name || user.username || 'Customer').trim(),
          String(billing.phone || '').trim(),
          String(billing.country || billing.countryName || '').trim(),
          isCreditPurchase ? 'credit_purchase' : (normalizedItems.some((item) => item.subscription) ? 'subscription' : (normalizedItems.some((item) => item.freeAsset) ? 'mixed' : 'asset')),
          String(currency).toUpperCase(),
          Number(subtotal.toFixed(2)),
          Number(normalizedDiscount.toFixed(2)),
          Number(tax.toFixed(2)),
          Number(total.toFixed(2)),
          coupon ? coupon.code : null,
          paymentGatewayValue,
          paymentMethod,
          transactionId,
          total === 0 || isCreditsPayment ? 'paid' : 'pending',
          total === 0 || isCreditsPayment ? 'completed' : (isGooglePayPayment ? 'awaiting_payment' : 'pending'),
          total === 0 || isCreditsPayment ? 'available' : 'pending',
          'none',
          normalizedItems.length,
          0,
          0,
          0,
        ];
        const orderResult = await pool.query(
          `INSERT INTO orders (
            order_number,
            invoice_number,
            customer_id,
            customer_name,
            customer_phone,
            customer_country,
            order_type,
            currency,
            subtotal,
            discount,
            tax,
            total_amount,
            coupon_code,
            payment_gateway,
            payment_method,
            transaction_id,
            payment_status,
            order_status,
            download_status,
            refund_status,
            assets_count,
            downloads_count,
            contributor_earnings,
            platform_commission,
            created_at,
            updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW(),NOW()) RETURNING id`,
          orderValues
        );

      const orderId = orderResult.rows[0].id;
      let contributorEarnings = 0;
      let platformCommission = 0;
      const downloadedAssets = [];

      for (const item of normalizedItems) {
        if (item.creditPackage) {
          const quantity = Math.max(1, Number(item.quantity || 1));
          const lineTotal = Number((Number(item.unitPrice) * quantity).toFixed(2));
          await pool.query(
            `INSERT INTO order_items (order_id, asset_id, title, category, license, credit_amount, quantity, unit_price, total_price, currency, download_status, created_at)
             VALUES ($1,NULL,$2,'Credits','Credit package',$3,$4,$5,$6,$7,'pending',NOW())`,
            [orderId, `${item.creditAmount} Credits`, item.creditAmount, quantity, Number(item.unitPrice), lineTotal, String(currency).toUpperCase()]
          );
          continue;
        }
        const assetId = Number(item.id);
        const quantity = Math.max(1, Number(item.quantity || 1));
        const imageResult = await pool.query(
          `SELECT i.id, i.title, i.uploaded_by, i.category, i.collection,
                  contributor.id AS contributor_id, contributor.username AS contributor_username
           FROM images i
           LEFT JOIN users contributor ON contributor.id = i.uploaded_by
           WHERE i.id = $1`,
          [assetId]
        );
        if (imageResult.rows.length === 0) {
          throw new Error(`Asset ${assetId} is unavailable`);
        }
        const image = imageResult.rows[0];
        const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
        const lineTotal = Number((unitPrice * quantity).toFixed(2));
        const freeAsset = Boolean(item.freeAsset || item.isFree || unitPrice <= 0);
        const normalizedLicense = String(item.license || 'Standard license').trim();

        const contributorId = image.contributor_id || null;
        await pool.query(
          `INSERT INTO order_items (
            order_id,
            asset_id,
            title,
            category,
            license,
            contributor_id,
            contributor_username,
            quantity,
            unit_price,
            total_price,
            currency,
            download_status,
            created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
          [orderId, assetId, image.title, image.category || item.category || null, normalizedLicense, contributorId, image.contributor_username || null, quantity, unitPrice, lineTotal, String(currency).toUpperCase(), freeAsset ? 'available' : 'pending']
        );

        // Always create a customer_downloads record with secure token and 100-day expiry
        try {
          const downloadToken = crypto.randomBytes(12).toString('hex');
          await pool.query(
            `INSERT INTO customer_downloads (user_id, image_id, order_id, download_token, license, expires_at, is_active, created_at) VALUES ($1,$2,$3,$4,$5,NOW() + INTERVAL '100 days',$6,NOW())`,
            [req.user.id, assetId, orderId, downloadToken, normalizedLicense, !isGooglePayPayment]
          );
          const check = await pool.query(`SELECT COUNT(*)::int AS c FROM customer_downloads WHERE order_id = $1`, [orderId]);
          console.debug(`customer_downloads inserted for order ${orderId}, count=${check.rows[0]?.c}`);

          if (!isGooglePayPayment) {
            await pool.query(
              `INSERT INTO order_activity_logs (order_id, event, actor_role, details, ip_address, created_at)
               VALUES ($1, $2, $3, $4, $5, NOW())`,
              [
                orderId,
                'Download available',
                'customer',
                JSON.stringify({ assetId, title: image.title, userId: req.user.id }),
                req.ip || req.headers['x-forwarded-for'] || null
              ]
            );
          }
        } catch (e) {
          console.error('Failed to insert customer_downloads for order', orderId, 'asset', assetId, e && e.message ? e.message : e);
        }

        if (!freeAsset && !isGooglePayPayment) {
          await pool.query(`INSERT INTO downloads (user_id, image_id, downloaded_at) VALUES ($1,$2,NOW())`, [req.user.id, assetId]);
          downloadedAssets.push({ id: assetId, title: image.title });
        }

        if (contributorId && !freeAsset) {
          const commissionRate = Number(item.commissionRate || 0.2);
          const contributorAmount = Number((lineTotal * commissionRate).toFixed(2));
          const unitContributorAmount = Number((contributorAmount / quantity).toFixed(2));
          let allocatedContributorAmount = 0;
          for (let saleIndex = 0; saleIndex < quantity; saleIndex += 1) {
            const saleAmount = saleIndex === quantity - 1
              ? Number((contributorAmount - allocatedContributorAmount).toFixed(2))
              : unitContributorAmount;
            allocatedContributorAmount += saleAmount;
            await pool.query(
              `INSERT INTO earnings (contributor_id, order_id, asset_id, amount, currency, commission_rate, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW())`,
              [contributorId, orderId, assetId, saleAmount, String(currency).toUpperCase(), commissionRate]
            );
          }
          contributorEarnings += contributorAmount;
          platformCommission += Number((lineTotal - contributorAmount).toFixed(2));
        }
      }

      await pool.query(
        `INSERT INTO payments (order_id, amount, currency, gateway, transaction_id, status, authorization_code, response, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [orderId, Number(total.toFixed(2)), String(currency).toUpperCase(), paymentGatewayValue, transactionId, total === 0 || isCreditsPayment ? 'paid' : 'pending', null, JSON.stringify({ mode: paymentMethod })]
      );

      await pool.query(
        `INSERT INTO payment_logs (order_id, gateway, event, payload, created_at) VALUES ($1,$2,$3,$4,NOW())`,
        [orderId, paymentGatewayValue, 'order_created', JSON.stringify({ paymentMethod, items: normalizedItems.length })]
      );

      await pool.query(
        `INSERT INTO invoices (order_id, invoice_number, customer_id, amount, currency, status, issued_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [orderId, invoiceNumber, req.user.id, Number(total.toFixed(2)), String(currency).toUpperCase(), 'issued']
      );

      if (coupon) {
        await pool.query(
          `INSERT INTO coupon_redemptions (coupon_id, user_id, amount, redeemed_at, metadata) VALUES ($1,$2,$3,NOW(),$4)`,
          [coupon.id, req.user.id, Number(normalizedDiscount.toFixed(2)), JSON.stringify({ orderId })]
        );
      }

      await pool.query(
        `UPDATE orders SET contributor_earnings = $1, platform_commission = $2, updated_at = NOW() WHERE id = $3`,
        [Number(contributorEarnings.toFixed(2)), Number(platformCommission.toFixed(2)), orderId]
      );

      await pool.query(
        `INSERT INTO analytics (event_type, user_id, entity_type, entity_id, amount, currency, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        ['checkout_completed', req.user.id, 'order', orderId, Number(total.toFixed(2)), String(currency).toUpperCase(), JSON.stringify({ orderNumber, paymentMethod })]
      );

      await pool.query(
        `INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1,$2,FALSE,NOW())`,
        [user.username, isCreditPurchase ? `Credit request ${orderNumber} is pending admin approval.` : `Order ${orderNumber} placed successfully for ${normalizedItems.length} asset${normalizedItems.length === 1 ? '' : 's'}.`]
      );

      await pool.query('COMMIT');

      for (const downloadedAsset of downloadedAssets) {
        await recordBusinessEvent(pool, "ASSET_DOWNLOADED", {
          userId: req.user.id,
          userRole: 'customer',
          assetId: downloadedAsset.id,
          orderId,
          description: `Asset downloaded: ${downloadedAsset.title}`
        });
      }

      await recordBusinessEvent(pool, "ORDER_CREATED", {
        userId: req.user.id,
        userRole: user.role,
        orderId,
        couponId: coupon?.id,
        description: `Order ${orderNumber} created`,
        metadata: { orderNumber, itemCount: normalizedItems.length, total: Number(total.toFixed(2)), currency: String(currency).toUpperCase() }
      });
      await recordBusinessEvent(pool, total === 0 || isCreditsPayment ? "PAYMENT_SUCCESS" : "PAYMENT_STARTED", {
        userId: req.user.id,
        userRole: user.role,
        orderId,
        description: `Payment ${total === 0 || isCreditsPayment ? "completed" : "started"} for order ${orderNumber}`,
        metadata: { amount: Number(total.toFixed(2)), currency: String(currency).toUpperCase(), gateway: paymentGatewayValue, payment_method: paymentMethod }
      });
      if (coupon) {
        await createCouponNotifications(pool, {
          userIds: [req.user.id],
          message: `Coupon "${coupon.code}" was used by the customer on order ${orderNumber}.`
        });
        await recordBusinessEvent(pool, "COUPON_USED", {
          userId: req.user.id,
          userRole: user.role,
          orderId,
          couponId: coupon.id,
          description: `Coupon ${coupon.code} used on order ${orderNumber}`
        });
      }
      if (contributorEarnings > 0) {
        await recordBusinessEvent(pool, "EARNING_CREATED", {
          userRole: "contributor",
          orderId,
          description: `Contributor earnings created for order ${orderNumber}`,
          metadata: { amount: Number(contributorEarnings.toFixed(2)), currency: String(currency).toUpperCase() }
        });
      }

      res.json({
        success: true,
        orderId,
        orderNumber,
        invoiceNumber,
        total: Number(total.toFixed(2)),
        currency: String(currency).toUpperCase(),
        message: 'Order placed successfully',
      });
    } catch (innerError) {
      await pool.query('ROLLBACK');
      throw innerError;
    }
  } catch (error) {
    console.error('Checkout failed', error);
    res.status(500).json({ error: error.message || 'Checkout failed' });
  }
});

app.post('/checkout/confirm-google-pay', authenticateToken, async (req, res) => {
  const orderId = Number(req.body?.orderId);
  const upiId = String(req.body?.upiId || '').trim();

  if (!orderId || Number.isNaN(orderId)) {
    return res.status(400).json({ error: 'Invalid order id' });
  }

  try {
    const orderResult = await pool.query(
      `SELECT id, order_number, customer_id, payment_method, payment_status
       FROM orders WHERE id = $1 AND customer_id = $2 LIMIT 1`,
      [orderId, req.user.id]
    );
    if (orderResult.rows.length === 0) return res.status(404).json({ error: 'Order not found' });

    if (!upiId) {
      await pool.query(
        `UPDATE orders SET payment_status = 'failed', order_status = 'failed', download_status = 'failed', updated_at = NOW() WHERE id = $1`,
        [orderId]
      );
      await pool.query(`UPDATE order_items SET download_status = 'failed' WHERE order_id = $1`, [orderId]);
      await pool.query(`UPDATE customer_downloads SET is_active = FALSE WHERE order_id = $1`, [orderId]);
      await pool.query(`UPDATE payments SET status = 'failed', response = COALESCE(response, '{}'::jsonb) || $1::jsonb WHERE order_id = $2`, [JSON.stringify({ failure: 'UPI ID not provided' }), orderId]);
      await recordBusinessEvent(pool, 'PAYMENT_FAILED', {
        userId: req.user.id,
        userRole: 'customer',
        orderId,
        description: `Payment failed for order ${orderResult.rows[0].order_number}: UPI ID was not provided`,
        metadata: { failure: 'UPI ID not provided', gateway: 'google pay', payment_method: 'Google Pay' }
      });
      return res.status(400).json({ error: 'UPI ID is required. The order has been marked as failed.' });
    }

    await pool.query('BEGIN');
    try {
      await pool.query(
        `UPDATE orders SET payment_status = 'completed', order_status = 'completed', download_status = 'available', updated_at = NOW() WHERE id = $1`,
        [orderId]
      );
      await pool.query(`UPDATE order_items SET download_status = 'available' WHERE order_id = $1`, [orderId]);
      await pool.query(`UPDATE customer_downloads SET is_active = TRUE WHERE order_id = $1`, [orderId]);
      await pool.query(
        `INSERT INTO downloads (user_id, image_id, downloaded_at, order_id)
         SELECT cd.user_id, cd.image_id, NOW(), cd.order_id
         FROM customer_downloads cd
         WHERE cd.order_id = $1 AND cd.is_active IS NOT FALSE
         ON CONFLICT DO NOTHING`,
        [orderId]
      );
      await pool.query(
        `UPDATE payments SET status = 'paid', response = COALESCE(response, '{}'::jsonb) || $1::jsonb WHERE order_id = $2`,
        [JSON.stringify({ upiId }), orderId]
      );
      await pool.query(
        `INSERT INTO order_activity_logs (order_id, event, actor_role, details, ip_address, created_at) VALUES ($1,$2,$3,$4,$5,NOW())`,
        [orderId, 'Google Pay UPI ID submitted', 'customer', JSON.stringify({ upiId }), req.ip || req.headers['x-forwarded-for'] || null]
      );
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

    res.json({ success: true, orderId, orderNumber: orderResult.rows[0].order_number, message: 'Payment confirmed and downloads are available.' });
  } catch (error) {
    console.error('Google Pay confirmation failed', error);
    res.status(500).json({ error: error.message || 'Unable to confirm Google Pay payment' });
  }
});

    app.get('/customer-download/:token', authenticateToken, async (req, res) => {
      try {
        const token = String(req.params.token || '').trim();
        if (!token) return res.status(400).json({ error: 'Token is required' });

        const downloadResult = await pool.query(
          `SELECT cd.*, o.payment_status, o.order_status, i.filename, i.title, i.uploaded_by FROM customer_downloads cd LEFT JOIN orders o ON o.id = cd.order_id LEFT JOIN images i ON i.id = cd.image_id WHERE cd.download_token = $1 LIMIT 1`,
          [token]
        );

        if (downloadResult.rows.length === 0) {
          return res.status(404).json({ error: 'Download not found' });
        }

        const dl = downloadResult.rows[0];
        if (Number(dl.user_id) !== Number(req.user.id)) {
          return res.status(403).json({ error: 'Access denied' });
        }

        if (!dl.is_active || (dl.expires_at && new Date(dl.expires_at) < new Date())) {
          return res.status(410).json({ error: 'Download expired or inactive' });
        }

        if (dl.payment_status !== 'completed' && dl.order_status !== 'completed') {
          return res.status(402).json({ error: 'Payment is not confirmed. Download is unavailable.' });
        }

        if (!dl.filename) {
          return res.status(404).json({ error: 'File not available' });
        }

        const filePath = path.join(__dirname, 'uploads', dl.filename);
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: 'File missing on server' });
        }

        const suggestedName = dl.title ? `${dl.title}${path.extname(dl.filename)}` : path.basename(dl.filename);
        console.debug('Serving customer download', { token, image_id: dl.image_id, user_id: dl.user_id, filename: dl.filename, suggestedName });
        res.download(filePath, suggestedName, async (downloadError) => {
          if (!downloadError) {
            await pool.query(
              `INSERT INTO downloads (user_id, image_id, downloaded_at, order_id) VALUES ($1, $2, NOW(), $3) ON CONFLICT DO NOTHING`,
              [dl.user_id, dl.image_id, dl.order_id]
            );
            await pool.query(
              `UPDATE images SET downloads = COALESCE(downloads, 0) + 1 WHERE id = $1`,
              [dl.image_id]
            );
            await createAssetNotifications(pool, {
              userIds: [dl.user_id, dl.uploaded_by],
              eventType: 'ASSET_DOWNLOADED',
              assetTitle: dl.title,
              ownerId: dl.uploaded_by,
              actorId: dl.user_id
            });
          }
        });
      } catch (err) {
        console.error('Download error', err);
        res.status(500).json({ error: 'Failed to process download' });
      }
    });

/* ---------------- USER PROFILE ---------------- */

app.get("/public-contributors/:username", async (req, res) => {
  try {
    const username = String(req.params.username || "").trim();
    if (!username) return res.status(400).json({ error: "Contributor username is required" });

    const contributorResult = await pool.query(
      `SELECT id, username, full_name, role, created_at
       FROM users
       WHERE LOWER(username) = LOWER($1) AND role = 'contributor'
       LIMIT 1`,
      [username]
    );
    if (contributorResult.rows.length === 0) return res.status(404).json({ error: "Contributor not found" });

    const contributor = contributorResult.rows[0];
    const assetsResult = await pool.query(
      `SELECT id, title, type, filename, thumbnail_url, thumbnail_status, downloads, views, likes, created_at
       FROM images
       WHERE uploaded_by = $1 AND LOWER(COALESCE(status, '')) IN ('approved', 'published', 'live')
       ORDER BY created_at DESC`,
      [contributor.id]
    );

    res.json({ contributor, assets: assetsResult.rows });
  } catch (error) {
    console.error("Public contributor profile error", error);
    res.status(500).json({ error: "Unable to load contributor profile" });
  }
});

app.get("/profile", async (req, res) => {

  try {

    console.log("PROFILE ROUTE HIT");

    const authHeader =
      req.headers["authorization"];

    if (!authHeader) {

      return res.status(401).json(
        "Access denied"
      );

    }

    const token =
      authHeader.split(" ")[1];

    const decoded = verifyJwtToken(token);

    const user =
      await pool.query(

        `
        SELECT
          id,
          username,
          email,
          role,
          credits,
          custom_permissions,
          (
            SELECT tf.status
            FROM contributor_tax_forms tf
            WHERE tf.contributor_id = users.id
            ORDER BY tf.updated_at DESC NULLS LAST, tf.submitted_at DESC NULLS LAST
            LIMIT 1
          ) AS tax_form_status,
          (
            SELECT tf.form_type
            FROM contributor_tax_forms tf
            WHERE tf.contributor_id = users.id
            ORDER BY tf.updated_at DESC NULLS LAST, tf.submitted_at DESC NULLS LAST
            LIMIT 1
          ) AS tax_form_type,
          (
            SELECT tf.form_data
            FROM contributor_tax_forms tf
            WHERE tf.contributor_id = users.id
            ORDER BY tf.updated_at DESC NULLS LAST, tf.submitted_at DESC NULLS LAST
            LIMIT 1
          ) AS tax_form_data,
          (
            SELECT tf.submitted_at
            FROM contributor_tax_forms tf
            WHERE tf.contributor_id = users.id
            ORDER BY tf.updated_at DESC NULLS LAST, tf.submitted_at DESC NULLS LAST
            LIMIT 1
          ) AS tax_form_submitted_at
        FROM users
        WHERE id = $1
        `,

        [decoded.user]

      );

    if (
      user.rows.length === 0
    ) {

      return res.status(404).json(
        "User not found"
      );

    }

    res.json(
      user.rows[0]
    );

  } catch (err) {

    console.error(err);

    res.status(500).send(
      "Profile error"
    );

  }

});

    /* ---------------- CHANGE PASSWORD ---------------- */

    app.post(
      "/profile/change-password",
      authenticateToken,
      async (req, res) => {
        try {
          const userId = req.user.id;
          const { currentPassword, newPassword } = req.body;

          if (!currentPassword || !newPassword) {
            return res.status(400).json("Missing required fields");
          }

          const user = await pool.query(
            `
            SELECT password, username
            FROM users
            WHERE id = $1
            `,
            [userId]
          );

          if (user.rows.length === 0) {
            return res.status(404).json("User not found");
          }

          const valid = await bcrypt.compare(
            currentPassword,
            user.rows[0].password
          );

          if (!valid) {
            return res.status(401).json("Invalid current password");
          }

          const saltRounds = 10;
          const hashed = await bcrypt.hash(newPassword, saltRounds);

          await pool.query(
            `
            UPDATE users
            SET password = $1
            WHERE id = $2
            `,
            [hashed, userId]
          );

          const accountNotificationRule = (await pool.query(
            `SELECT enabled, enable_internal FROM notification_rules WHERE event_key = 'ACCOUNT_NOTIFICATION' LIMIT 1`
          )).rows[0];
          if (accountNotificationRule?.enabled !== false && accountNotificationRule?.enable_internal === true) {
            const notificationUsers = await pool.query(
              `SELECT username FROM users WHERE id = $1 OR role = 'admin'`
              , [userId]
            );
            for (const notificationUser of notificationUsers.rows) {
              await pool.query(
                `INSERT INTO notifications (username, message, is_read) VALUES ($1, $2, FALSE)`,
                [notificationUser.username, notificationUser.username === user.rows[0].username
                  ? 'Your account password was changed successfully.'
                  : `Password changed for ${user.rows[0].username}.`]
              );
            }
          }

          res.json("Password changed successfully");
        } catch (err) {
          console.error(err);
          res.status(500).send("Change password error");
        }
      }
    );

app.get(
  "/dashboard-stats",
  authenticateToken,
  async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

      const userId = req.user.id;
      console.log(
  "DASHBOARD USER ID:",
  userId
);

      const uploads = await pool.query(
        `
        SELECT COUNT(*) AS total
             , COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS uploads_today
             , COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '6 days') AS uploads_last_7_days
             , COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '29 days') AS uploads_last_30_days
             , COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '364 days') AS uploads_last_365_days
        FROM images
        WHERE uploaded_by = $1
        `,
        [userId]
      );

      const downloads = await pool.query(
        `
        SELECT COALESCE(SUM(downloads),0) AS total
        FROM images
        WHERE uploaded_by = $1
        `,
        [userId]
      );

      const views = await pool.query(
        `
        SELECT COALESCE(SUM(views),0) AS total
        FROM images
        WHERE uploaded_by = $1
        `,
        [userId]
      );

      const likes = await pool.query(
        `
        SELECT COALESCE(SUM(likes),0) AS total
        FROM images
        WHERE uploaded_by = $1
        `,
        [userId]
      );

      const downloadHistory = await pool.query(
        `
        SELECT
          COUNT(*) AS total_downloads,
          COUNT(*) FILTER (WHERE d.downloaded_at >= CURRENT_DATE) AS downloads_today,
          COUNT(*) FILTER (WHERE d.downloaded_at >= CURRENT_DATE - INTERVAL '6 days') AS downloads_last_7_days,
          COUNT(*) FILTER (WHERE d.downloaded_at >= CURRENT_DATE - INTERVAL '29 days') AS downloads_last_30_days,
          COUNT(*) FILTER (WHERE d.downloaded_at >= CURRENT_DATE - INTERVAL '364 days') AS downloads_last_365_days
        FROM downloads d
        JOIN images i ON i.id = d.image_id
        WHERE i.uploaded_by = $1
        `,
        [userId]
      );

      const userInfo = await pool.query(
  `
  SELECT created_at
  FROM users
  WHERE id = $1
  `,
  [userId]
);

const uploadsCount =
  Number(
    uploads.rows[0].total
  );
const uploadWindowCounts = summarizeContributorUploadWindowCounts(uploads.rows[0]);

const downloadsCount =
  Number(
    downloadHistory.rows[0]?.total_downloads ?? downloads.rows[0].total
  );

const viewsCount =
  Number(
    views.rows[0].total
  );

const likesCount =
  Number(
    likes.rows[0].total
  );

const createdAt =
  new Date(
    userInfo.rows[0].created_at
  );

const monthsOld =
  Math.max(
    1,
    Math.floor(
      (
        new Date() -
        createdAt
      ) /
      (
        1000 *
        60 *
        60 *
        24 *
        30
      )
    )
  );

const totalContribution = uploadsCount + downloadsCount;
const normalizedViews = Math.max(1, viewsCount);
const rawScore =
  viewsCount > 0
    ? Number((totalContribution / normalizedViews).toFixed(2))
    : 0;

const reputationScore = rawScore;
const downloadHistoryRow = downloadHistory.rows[0] || {};
const downloadWindowCounts = summarizeContributorDownloadWindowCounts(downloadHistoryRow);

res.json({
  uploads: uploadsCount,
  downloads: downloadsCount,
  views: viewsCount,
  likes: likesCount,
  ...uploadWindowCounts,
  ...downloadWindowCounts,

  rawScore,
  monthsOld,
  reputationScore
});

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: "Server error"
      });

    }
  }
);
app.post("/profile/tax-form", authenticateToken, async (req, res) => {
  try {
    const formData = req.body && typeof req.body === "object" ? req.body : {};
    await pool.query(
      `
      INSERT INTO contributor_tax_forms (contributor_id, form_type, status, form_data, submitted_at, updated_at)
      VALUES ($1, $2, 'submitted', $3::jsonb, NOW(), NOW())
      ON CONFLICT (contributor_id)
      DO UPDATE SET form_type = EXCLUDED.form_type,
                    status = EXCLUDED.status,
                    form_data = EXCLUDED.form_data,
                    submitted_at = EXCLUDED.submitted_at,
                    updated_at = EXCLUDED.updated_at
      `,
      [req.user.id, String(formData.formType || "W-8BEN"), JSON.stringify(formData)]
    );
    res.json({ submitted: true, status: "submitted" });
  } catch (err) {
    console.error("Failed to save tax form", err);
    res.status(500).json({ error: "Failed to save tax form" });
  }
});

app.delete("/profile/tax-form", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM contributor_tax_forms WHERE contributor_id = $1 RETURNING contributor_id", [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Tax form not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("Failed to delete tax form", err);
    res.status(500).json({ error: "Failed to delete tax form" });
  }
});

app.put("/admin/tax-forms/:contributorId/status", verifyAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || "").toLowerCase();
    if (!["approved", "rejected", "expired"].includes(status)) {
      return res.status(400).json({ error: "Invalid tax form status" });
    }
    const result = await pool.query(
      `UPDATE contributor_tax_forms SET status = $1, updated_at = NOW() WHERE contributor_id = $2 RETURNING contributor_id, form_type, status, submitted_at, updated_at`,
      [status, req.params.contributorId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Tax form not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Failed to update tax form status", err);
    res.status(500).json({ error: "Failed to update tax form status" });
  }
});

app.post("/admin/tax-forms/:contributorId/reminder", verifyAdmin, async (req, res) => {
  try {
    const userResult = await pool.query("SELECT username, email FROM users WHERE id = $1 AND LOWER(role) = 'contributor'", [req.params.contributorId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: "Contributor not found" });
    await pool.query(
      "INSERT INTO notifications (username, message, is_read, created_at) VALUES ($1, $2, FALSE, NOW())",
      [user.username, "Please submit or review your tax form so we can process your contributor payments."]
    );
    res.json({ sent: true });
  } catch (err) {
    console.error("Failed to send tax form reminder", err);
    res.status(500).json({ error: "Failed to send tax form reminder" });
  }
});

/* ---------------- PROFILE STATS ---------------- */

app.get(
  "/profile/stats",
  async (req, res) => {
    console.log("STATS ROUTE HIT");

const authHeader =
  req.headers["authorization"];

    try {

      const authHeader =
        req.headers["authorization"];

      if (!authHeader) {

        return res.status(401).json(
          "Access denied"
        );

      }

      const token =
        authHeader.split(" ")[1];

      const decoded = verifyJwtToken(token);

      const stats =
        await pool.query(

          `
          SELECT

COUNT(*) AS total_uploads,

COUNT(*) FILTER
(
  WHERE status = 'approved'
)
AS approved_images,

COUNT(*) FILTER
(
  WHERE status = 'pending'
)
AS pending_images,

COUNT(*) FILTER
(
  WHERE status = 'rejected'
)
AS rejected_images,

COALESCE(
  SUM(likes),
  0
)
AS total_likes,

COALESCE(
  SUM(views),
  0
)
AS total_views,

COALESCE(
  SUM(downloads),
  0
)
AS total_downloads,

COALESCE(
  SUM(earnings),
  0
)
AS total_earnings,

COALESCE(
  MAX(downloads),
  0
)
AS top_downloads,

COALESCE(
  MAX(views),
  0
)
AS top_views,

COALESCE(
  MAX(likes),
  0
)
AS top_likes

FROM images

WHERE uploaded_by = $1
          `,

          [decoded.user]

        );

      res.json(
        stats.rows[0]
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Stats error"
      );

    }

  }
);

/* ---------------- MY UPLOADS ---------------- */

app.get(
  "/my-uploads",
  async (req, res) => {

    try {

      const authHeader =
        req.headers["authorization"];

      if (!authHeader) {

        return res.status(401).json(
          "Access denied"
        );

      }

      const token =
        authHeader.split(" ")[1];

      const decoded = verifyJwtToken(token);

      const view =
        (req.query.view || "all")
          .toString()
          .toLowerCase();

      const { query, params } = buildMyUploadsQuery(view, decoded.user);

      const images =
        await pool.query(
          query,
          params
        );

      res.json(
        images.rows
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "My uploads error"
      );

    }

  }
);
/* ---------------- ADMIN ALL IMAGES ---------------- */

app.get(
  "/admin/images",
  verifyAdmin,
  async (req, res) => {

    try {

      const images =
        await pool.query(

          `
          SELECT
            images.*,
            users.username AS contributor_username
          FROM images
          LEFT JOIN users
            ON users.id = images.uploaded_by
          ORDER BY images.created_at DESC
          `

        );

      res.json(
        images.rows
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Admin fetch error"
      );

    }

  }
);
/* ---------------- APPROVE IMAGE ---------------- */

async function recordAdminAudit(req, eventType, description, previousValue, newValue, metadata = {}) {
  const safeMetadata = { ...metadata, previous_value: previousValue ?? null, new_value: newValue ?? null };
  await recordBusinessEvent(pool, eventType, {
    userId: req.user?.id,
    userRole: 'admin',
    ipAddress: req.ip,
    description,
    metadata: safeMetadata,
  });
}

function buildAccountStatusNotificationMessage({ newStatus, action, previousStatus, username } = {}) {
  const normalizedStatus = String(newStatus || '').trim().toLowerCase();
  const normalizedAction = String(action || '').trim().toLowerCase();
  const normalizedPreviousStatus = String(previousStatus || '').trim().toLowerCase();
  const accountLabel = username ? `Account '${username}'` : 'Your account';

  if (normalizedAction === 'approve' || normalizedStatus === 'active') {
    return `${accountLabel} has been approved and activated by an administrator.`;
  }

  if (normalizedAction === 'block' || normalizedStatus === 'blocked') {
    return `${accountLabel} has been blocked by an administrator.`;
  }

  if (normalizedAction === 'reject' || normalizedStatus === 'rejected') {
    return `${accountLabel} has been rejected by an administrator.`;
  }

  if (normalizedAction === 'delete' || normalizedStatus === 'deleted') {
    return `${accountLabel} has been deleted by an administrator.`;
  }

  if (normalizedStatus === 'pending') {
    return `${accountLabel} status was updated by an administrator.`;
  }

  if (normalizedPreviousStatus && normalizedPreviousStatus !== normalizedStatus) {
    return `${accountLabel} status was changed from ${normalizedPreviousStatus} to ${normalizedStatus} by an administrator.`;
  }

  return `${accountLabel} status was updated by an administrator.`;
}

async function notifyUserAccountStatusChange({ targetUserId, actorId, previousStatus, newStatus, action }) {
  if (!targetUserId) return;

  const userResult = await pool.query(
    'SELECT id, username, email, role FROM users WHERE id = $1',
    [targetUserId]
  );

  const targetUser = userResult.rows[0];
  if (!targetUser?.username) return;

  const message = buildAccountStatusNotificationMessage({
    newStatus,
    action,
    previousStatus,
    username: targetUser.username,
  });
  const adminUsers = await pool.query("SELECT id, username FROM users WHERE role = 'admin' AND username IS NOT NULL");
  const recipientUsernames = [...new Set([
    targetUser.username,
    ...(adminUsers.rows.map((admin) => admin.username).filter(Boolean)),
  ])];

  for (const recipientUsername of recipientUsernames) {
    await pool.query(
      'INSERT INTO notifications (username, message, is_read) VALUES ($1, $2, FALSE)',
      [recipientUsername, message]
    );
  }

  await recordBusinessEvent(pool, 'ACCOUNT_STATUS_CHANGED', {
    userId: Number(targetUser.id),
    userRole: targetUser.role,
    email: targetUser.email,
    description: message,
    metadata: {
      actor_id: actorId || null,
      target_user_id: Number(targetUser.id),
      previous_status: previousStatus || null,
      new_status: newStatus || null,
      action: action || null,
      rule_event_key: 'account_status_changed'
    }
  });

  await createDirectMessage(pool, {
    senderId: actorId || null,
    recipientId: Number(targetUser.id),
    subject: 'Account status updated',
    body: message,
    messageType: 'SYSTEM_NOTIFICATION',
    priority: 'HIGH'
  });

  for (const admin of adminUsers.rows) {
    await createDirectMessage(pool, {
      senderId: actorId || null,
      recipientId: Number(admin.id),
      subject: 'Account status updated',
      body: message,
      messageType: 'SYSTEM_NOTIFICATION',
      priority: 'HIGH'
    });
  }
}

const moveGeneratedThumbnailFile = (currentFilename) => {
  if (!currentFilename) {
    return null;
  }

  const normalized = currentFilename.replace(/\\/g, "/");
  const assetPath = path.join(__dirname, "uploads", ...normalized.split("/"));
  const thumbnailDir = getThumbnailStorageDirectory(assetPath);
  const assetDir = path.dirname(assetPath);
  const assetExt = path.extname(assetPath);
  const assetBase = path.basename(assetPath, assetExt);
  const oldThumbPath = path.join(assetDir, `${assetBase}-thumb.jpg`);
  const newThumbPath = path.join(thumbnailDir, `${assetBase}-thumb.jpg`);

  if (!fs.existsSync(oldThumbPath)) {
    return null;
  }

  fs.mkdirSync(thumbnailDir, { recursive: true });

  if (fs.existsSync(newThumbPath)) {
    fs.unlinkSync(newThumbPath);
  }

  fs.renameSync(oldThumbPath, newThumbPath);

  const relativeThumbPath = path.relative(
    path.resolve(__dirname, "uploads"),
    newThumbPath
  ).replace(/\\/g, "/");

  return getPublicThumbnailUrl(relativeThumbPath);
};

const moveImageFile = async (currentFilename, newStatus) => {
  if (!currentFilename) {
    return null;
  }

  const normalized = currentFilename.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const fileName = parts.pop();
  const statusFolders = ["Pending", "Approved", "Rejected"];
  let targetParts = parts;

  if (statusFolders.includes(parts[parts.length - 1])) {
    targetParts = [...parts.slice(0, -1), newStatus];
  } else {
    targetParts = [...parts, newStatus];
  }

  const newRelativePath = [...targetParts, fileName].join("/");
  const oldPath = path.join(__dirname, "uploads", ...normalized.split("/"));
  const newPath = path.join(__dirname, "uploads", ...newRelativePath.split("/"));

  fs.mkdirSync(path.dirname(newPath), { recursive: true });

  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
  }

  return newRelativePath;
};

app.put(
  "/admin/approve/:id",
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const imageResult = await pool.query(
        `
        SELECT filename, status, uploaded_by
        FROM images
        WHERE id = $1
        `,
        [id]
      );

      if (imageResult.rows.length === 0) {
        return res.status(404).json("Image not found");
      }

      const newFilename = await moveImageFile(
        imageResult.rows[0].filename,
        "Approved"
      );
      const movedThumbnailUrl = moveGeneratedThumbnailFile(imageResult.rows[0].filename);

      const image = await pool.query(
        `
        UPDATE images
        SET status = 'approved', filename = $1, thumbnail_url = COALESCE($2, thumbnail_url)
        WHERE id = $3
        RETURNING *
        `,
        [newFilename, movedThumbnailUrl, id]
      );

      await recordAdminAudit(req, 'ADMIN_ASSET_UPDATED', `Admin approved asset #${id}`, { status: imageResult.rows[0].status }, { status: 'approved' }, { asset_id: Number(id), contributor_id: imageResult.rows[0].uploaded_by, action: 'approve' });
      await createAssetNotifications(pool, { userIds: [imageResult.rows[0].uploaded_by], eventType: 'ASSET_APPROVED', assetTitle: image.rows[0].title, ownerId: imageResult.rows[0].uploaded_by, actorId: req.user.id, status: 'approved' });

      res.json(image.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).send("Approve error");
    }
  }
);
/* ---------------- REJECT IMAGE ---------------- */

app.put(
  "/admin/reject/:id",
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const imageResult = await pool.query(
        `
        SELECT filename, status, uploaded_by
        FROM images
        WHERE id = $1
        `,
        [id]
      );

      if (imageResult.rows.length === 0) {
        return res.status(404).json("Image not found");
      }

      const newFilename = await moveImageFile(
        imageResult.rows[0].filename,
        "Rejected"
      );
      const movedThumbnailUrl = moveGeneratedThumbnailFile(imageResult.rows[0].filename);

      const image = await pool.query(
        `
        UPDATE images
        SET status = 'rejected', filename = $1, thumbnail_url = COALESCE($2, thumbnail_url)
        WHERE id = $3
        RETURNING *
        `,
        [newFilename, movedThumbnailUrl, id]
      );

      await recordAdminAudit(req, 'ADMIN_ASSET_UPDATED', `Admin rejected asset #${id}`, { status: imageResult.rows[0].status }, { status: 'rejected' }, { asset_id: Number(id), contributor_id: imageResult.rows[0].uploaded_by, action: 'reject' });
      await createAssetNotifications(pool, { userIds: [imageResult.rows[0].uploaded_by], eventType: 'ASSET_REJECTED', assetTitle: image.rows[0].title, ownerId: imageResult.rows[0].uploaded_by, actorId: req.user.id, status: 'rejected' });

      res.json(image.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).send("Reject error");
    }
  }
);
/* ---------------- LIST PUBLIC CATEGORIES ---------------- */

app.get("/categories", async (req, res) => {
  try {
    const categories = await getCategoriesList();
    res.json(categories);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch categories");
  }
});

/* ---------------- COLLECTION MANAGEMENT ---------------- */

app.get("/collections", async (req, res) => {
  try {
    const collections = await getCollectionsList();
    res.json(collections);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch collections");
  }
});

app.get("/admin/collections", verifyAdmin, async (req, res) => {
  try {
    const collections = await getCollectionsList();
    res.json(collections);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch admin collections");
  }
});

app.post("/admin/collections", verifyAdmin, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json("Collection name is required");
    }

    const newCollection = await pool.query(
      `
      INSERT INTO collections (name)
      VALUES ($1)
      ON CONFLICT (name) DO NOTHING
      RETURNING *
      `,
      [name.trim()]
    );

    if (newCollection.rows.length === 0) {
      return res.status(400).json("Collection already exists");
    }

    res.json(newCollection.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to add collection");
  }
});

app.put("/admin/collections/:id", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const normalizedName = name?.trim();

    if (!normalizedName) {
      return res.status(400).json("Collection name is required");
    }

    const existingCollection = await pool.query(
      `
      SELECT id, name
      FROM collections
      WHERE id = $1
      `,
      [id]
    );

    if (existingCollection.rows.length === 0) {
      return res.status(404).json("Collection not found");
    }

    const updatedCollection = await pool.query(
      `
      UPDATE collections
      SET name = $1
      WHERE id = $2
      RETURNING *
      `,
      [normalizedName, id]
    );

    if (updatedCollection.rows.length === 0) {
      return res.status(404).json("Collection not found");
    }

    if (existingCollection.rows[0].name !== normalizedName) {
      await pool.query(
        `
        UPDATE images
        SET collection = $1
        WHERE TRIM(COALESCE(collection, '')) = $2
        `,
        [normalizedName, existingCollection.rows[0].name]
      );
    }

    res.json(updatedCollection.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to update collection");
  }
});

app.delete("/admin/collections/:id", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const collectionResult = await pool.query(
      `
      SELECT id, name
      FROM collections
      WHERE id = $1
      `,
      [id]
    );

    if (collectionResult.rows.length === 0) {
      return res.status(404).json("Collection not found");
    }

    const collection = collectionResult.rows[0];
    const assetCheck = await pool.query(
      `
      SELECT id, title, filename
      FROM images
      WHERE TRIM(COALESCE(collection, '')) = $1
      ORDER BY id DESC
      LIMIT 10
      `,
      [collection.name]
    );

    if (assetCheck.rows.length > 0) {
      const totalAssets = await pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM images
        WHERE TRIM(COALESCE(collection, '')) = $1
        `,
        [collection.name]
      );

      return res.status(409).json({
        message: "Collection has assets assigned to it.",
        assetCount: totalAssets.rows[0].count,
        assets: assetCheck.rows
      });
    }

    const deleted = await pool.query(
      `
      DELETE FROM collections
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    res.json(deleted.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to delete collection");
  }
});

/* ---------------- ADMIN CATEGORY MANAGEMENT ---------------- */

const getIndiaUploadDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const calculateAdminLoyaltyPoints = (uploadDates = [], asOf = new Date()) => {
  const uploadDays = new Set(uploadDates.map(getIndiaUploadDay).filter(Boolean));
  const today = getIndiaUploadDay(asOf);
  if (!today || uploadDays.size === 0) return 0;

  const dayToNumber = (day) => {
    const [year, month, date] = day.split("-").map(Number);
    return Date.UTC(year, month - 1, date);
  };
  const firstUploadDay = Math.min(...[...uploadDays].map(dayToNumber));
  const endDay = dayToNumber(today);
  let points = 0;

  for (let cursor = firstUploadDay; cursor <= endDay; cursor += 24 * 60 * 60 * 1000) {
    const cursorDay = new Date(cursor).toISOString().slice(0, 10);
    points = Math.max(0, points + (uploadDays.has(cursorDay) ? 1 : -1));
  }

  return points;
};

app.get("/admin/users", verifyAdmin, async (req, res) => {
  try {
    const users = await pool.query(`
      SELECT
        u.id,
        u.full_name,
        u.username,
        u.email,
        u.role,
        u.identity_number,
        u.credits,
        u.status,
        u.contributor_cooling_until,
        u.deletion_requested_at,
        u.deletion_backup_status,
        u.otp_enabled,
        u.custom_permissions,
        u.created_at,
        COALESCE(img.total_uploads, 0) AS total_uploads,
        COALESCE(img.total_downloads, 0) AS total_downloads,
        COALESCE(img.total_likes, 0) AS total_likes,
        COALESCE(img.total_views, 0) AS total_views,
        COALESCE(img.total_earnings, 0) AS total_earnings,
        GREATEST(
          COALESCE((
            SELECT SUM(e.amount)
            FROM earnings e
            WHERE e.contributor_id = u.id AND e.status <> 'rejected'
          ), 0) + COALESCE((
            SELECT SUM(ch.amount_paid)
            FROM credits_history ch
            WHERE ch.user_id = u.id AND ch.payment_method = 'redeem'
          ), 0) - COALESCE((
            SELECT SUM(pr.requested_credits)
            FROM payout_requests pr
            WHERE pr.contributor_id = u.id AND pr.status <> 'rejected'
          ), 0),
          0
        ) AS unpaid_earnings,
        COALESCE((
          SELECT json_agg(json_build_object(
            'order_id', oi.order_id,
            'order_number', o.order_number,
            'payment_status', o.payment_status,
            'order_status', o.order_status,
            'title', oi.title,
            'total_price', oi.total_price,
            'currency', oi.currency,
            'created_at', oi.created_at
          ) ORDER BY oi.created_at DESC)
          FROM order_items oi
          LEFT JOIN orders o ON o.id = oi.order_id
          WHERE oi.contributor_id = u.id
        ), '[]'::json) AS order_details,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', i.id,
            'title', i.title,
            'filename', i.filename,
            'status', i.status,
            'created_at', i.created_at,
            'thumbnail_url', i.thumbnail_url
          ) ORDER BY i.created_at DESC)
          FROM images i
          WHERE i.uploaded_by = u.id
        ), '[]'::json) AS asset_details,
        EXISTS (
          SELECT 1
          FROM contributor_tax_forms tf
          WHERE tf.contributor_id = u.id AND tf.status = 'submitted'
        ) AS tax_form_submitted,
        (
          SELECT tf.status
          FROM contributor_tax_forms tf
          WHERE tf.contributor_id = u.id
          ORDER BY tf.updated_at DESC NULLS LAST, tf.submitted_at DESC NULLS LAST
          LIMIT 1
        ) AS tax_form_status,
        (
          SELECT tf.form_type
          FROM contributor_tax_forms tf
          WHERE tf.contributor_id = u.id
          ORDER BY tf.updated_at DESC NULLS LAST, tf.submitted_at DESC NULLS LAST
          LIMIT 1
        ) AS tax_form_type,
        (
          SELECT tf.form_data
          FROM contributor_tax_forms tf
          WHERE tf.contributor_id = u.id
          ORDER BY tf.updated_at DESC NULLS LAST, tf.submitted_at DESC NULLS LAST
          LIMIT 1
        ) AS tax_form_data,
        (
          SELECT tf.submitted_at
          FROM contributor_tax_forms tf
          WHERE tf.contributor_id = u.id
          ORDER BY tf.updated_at DESC NULLS LAST, tf.submitted_at DESC NULLS LAST
          LIMIT 1
        ) AS tax_form_submitted_at,
        COALESCE(img.upload_dates, ARRAY[]::timestamptz[]) AS upload_dates,
        CASE
          WHEN COALESCE(img.total_views, 0) > 0
            THEN ROUND((COALESCE(img.total_uploads, 0) + COALESCE(img.total_downloads, 0))::numeric / img.total_views, 2)
          ELSE 0
        END AS reputation_score,
        COALESCE(img.approved, 0) AS approved,
        COALESCE(img.pending, 0) AS pending,
        COALESCE(img.rejected, 0) AS rejected,
        COALESCE(order_items.order_count, 0) AS orders
      FROM users u
      LEFT JOIN (
        SELECT
          uploaded_by,
          COUNT(*)::int AS total_uploads,
          COALESCE(SUM(downloads), 0)::int AS total_downloads,
          COALESCE(SUM(likes), 0)::int AS total_likes,
          COALESCE(SUM(views), 0)::int AS total_views,
          COALESCE(SUM(earnings), 0) AS total_earnings,
          ARRAY_AGG(created_at) AS upload_dates,
          COUNT(*) FILTER (WHERE LOWER(status) = 'approved')::int AS approved,
          COUNT(*) FILTER (WHERE LOWER(status) = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE LOWER(status) = 'rejected')::int AS rejected
        FROM images
        GROUP BY uploaded_by
      ) img ON img.uploaded_by = u.id
      LEFT JOIN (
        SELECT
          contributor_id,
          COUNT(*)::int AS order_count
        FROM order_items
        GROUP BY contributor_id
      ) order_items ON order_items.contributor_id = u.id
      ORDER BY u.created_at DESC
    `);

    res.json(users.rows.map((user) => ({
      ...user,
      loyalty_points: calculateAdminLoyaltyPoints(user.upload_dates),
      upload_dates: undefined
    })));
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch users");
  }
});

app.post("/admin/users", verifyAdmin, async (req, res) => {
  try {
    const { full_name, username, email, role, identity_number, credits, status, password, custom_permissions, otp_enabled } = req.body;

    if (!username || !email || !role) {
      return res.status(400).json("Username, email, and role are required");
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    const newUserQuery = await pool.query(
      `
      INSERT INTO users
      (full_name, username, email, password, role, identity_number, credits, status, contributor_cooling_until, custom_permissions, otp_enabled)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, full_name, username, email, role, identity_number, credits, status, contributor_cooling_until, custom_permissions, otp_enabled, created_at
      `,
      [
        full_name ?? null,
        username,
        email,
        hashedPassword,
        role,
        identity_number ?? null,
        credits ?? null,
        status || (role === "contributor" ? "pending" : "active"),
        role === "contributor" && (status || "pending") === "pending" ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
        custom_permissions || {},
        otp_enabled !== false
      ]
    );

    res.json(newUserQuery.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to create user");
  }
});

app.put("/admin/users/:id/approve", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const previousUser = (await pool.query('SELECT status, role FROM users WHERE id = $1', [id])).rows[0];
    const updatedUser = await pool.query(
      `
      UPDATE users
      SET status = 'active', contributor_cooling_until = NULL
      WHERE id = $1
      RETURNING id, full_name, username, email, role, identity_number, credits, status, created_at, contributor_cooling_until, deletion_requested_at
      `,
      [id]
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    await recordAdminAudit(req, 'ADMIN_USER_UPDATED', `Admin approved user #${id}`, previousUser ? { status: previousUser.status, role: previousUser.role } : null, { status: 'active', role: updatedUser.rows[0].role }, { target_user_id: Number(id), action: 'approve' });
    await notifyUserAccountStatusChange({ targetUserId: Number(id), actorId: req.user?.id, previousStatus: previousUser?.status, newStatus: 'active', action: 'approve' });

    res.json(updatedUser.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to approve user");
  }
});

app.put("/admin/users/:id/reject", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const previousUser = (await pool.query('SELECT status, role FROM users WHERE id = $1', [id])).rows[0];
    const updatedUser = await pool.query(
      `
      UPDATE users
      SET status = 'rejected'
      WHERE id = $1
      RETURNING id, full_name, username, email, role, identity_number, credits, status, created_at, deletion_requested_at
      `,
      [id]
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    await recordAdminAudit(req, 'ADMIN_USER_UPDATED', `Admin rejected user #${id}`, previousUser ? { status: previousUser.status, role: previousUser.role } : null, { status: 'rejected', role: updatedUser.rows[0].role }, { target_user_id: Number(id), action: 'reject' });
    await notifyUserAccountStatusChange({ targetUserId: Number(id), actorId: req.user?.id, previousStatus: previousUser?.status, newStatus: 'rejected', action: 'reject' });

    res.json(updatedUser.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to reject user");
  }
});

app.put("/admin/users/:id/deactivate", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const previousUser = (await pool.query('SELECT status, role FROM users WHERE id = $1', [id])).rows[0];
    const updatedUser = await pool.query(
      `
      UPDATE users
      SET status = 'blocked'
      WHERE id = $1
      RETURNING id, full_name, username, email, role, identity_number, credits, status, created_at, deletion_requested_at
      `,
      [id]
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    await notifyUserAccountStatusChange({ targetUserId: Number(id), actorId: req.user?.id, previousStatus: previousUser?.status, newStatus: 'blocked', action: 'block' });
    res.json(updatedUser.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to deactivate user");
  }
});

app.put("/admin/users/:id/block", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const previousUser = (await pool.query('SELECT status, role FROM users WHERE id = $1', [id])).rows[0];
    const updatedUser = await pool.query(
      `
      UPDATE users
      SET status = 'blocked'
      WHERE id = $1
      RETURNING id, full_name, username, email, role, identity_number, credits, status, created_at, deletion_requested_at
      `,
      [id]
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    await notifyUserAccountStatusChange({ targetUserId: Number(id), actorId: req.user?.id, previousStatus: previousUser?.status, newStatus: 'blocked', action: 'block' });
    res.json(updatedUser.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to block user");
  }
});

app.put("/admin/users/:id", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, username, email, role, identity_number, credits, status, password, custom_permissions, otp_enabled } = req.body;

    const existingUser = await pool.query(`SELECT id, username, status FROM users WHERE id = $1`, [id]);
    if (existingUser.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    const previousStatus = existingUser.rows[0].status;
    const nextStatus = status !== undefined ? String(status).trim() : previousStatus;

    let hashedPassword = null;
    if (password && password.trim()) {
      const saltRounds = 10;
      hashedPassword = await bcrypt.hash(password.trim(), saltRounds);
    }

    const updatedUser = await pool.query(
      `
      UPDATE users
      SET
        full_name = COALESCE($1, full_name),
        username = COALESCE($2, username),
        email = COALESCE($3, email),
        role = COALESCE($4, role),
        identity_number = COALESCE($5, identity_number),
        credits = COALESCE($6, credits),
        status = COALESCE($7, status),
        custom_permissions = COALESCE($8, custom_permissions),
        password = COALESCE($9, password),
        otp_enabled = COALESCE($10, otp_enabled),
        contributor_cooling_until = CASE
          WHEN COALESCE($4, role) = 'contributor' AND COALESCE($7, status) = 'active' THEN NULL
          WHEN COALESCE($4, role) = 'contributor' AND COALESCE($7, status) = 'pending' AND contributor_cooling_until IS NULL THEN NOW() + INTERVAL '24 hours'
          ELSE contributor_cooling_until
        END
      WHERE id = $11
      RETURNING id, full_name, username, email, role, identity_number, credits, status, contributor_cooling_until, deletion_requested_at, custom_permissions, otp_enabled, created_at
      `,
      [full_name ?? null, username ?? null, email ?? null, role ?? null, identity_number ?? null, credits ?? null, status ?? null, custom_permissions || {}, hashedPassword, otp_enabled === undefined ? null : Boolean(otp_enabled), id]
    );

    const finalStatus = updatedUser.rows[0]?.status ?? nextStatus;
    if (status !== undefined && String(previousStatus || '').toLowerCase() !== String(finalStatus || '').toLowerCase()) {
      const actionMap = {
        active: 'approve',
        blocked: 'block',
        rejected: 'reject',
        pending: 'update',
      };
      const action = actionMap[String(finalStatus || '').toLowerCase()] || 'update';
      await notifyUserAccountStatusChange({
        targetUserId: Number(id),
        actorId: req.user?.id,
        previousStatus,
        newStatus: String(finalStatus || '').trim(),
        action,
      });
    }

    res.json(updatedUser.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to update user");
  }
});
app.put("/admin/users/:id/credits", verifyAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const credits = Number(req.body?.credits);

    if (!Number.isInteger(userId) || !Number.isFinite(credits) || credits <= 0) {
      return res.status(400).json("A positive credit amount is required");
    }

    const updatedUser = await pool.query(
      `
      UPDATE users
      SET credits = COALESCE(credits, 0) + $1
      WHERE id = $2
      RETURNING id, full_name, username, email, role, identity_number, credits, status, deletion_requested_at, custom_permissions, otp_enabled, created_at
      `,
      [credits, userId]
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    await pool.query(
      `
      INSERT INTO credits_history (user_id, credits, payment_method, currency)
      VALUES ($1, $2, 'admin', 'INR')
      `,
      [userId, credits]
    );

    res.json(updatedUser.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to add credits");
  }
});

app.delete("/admin/users/:id/credits", verifyAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const credits = Number(req.body?.credits);

    if (!Number.isInteger(userId) || !Number.isFinite(credits) || credits <= 0) {
      return res.status(400).json("A positive credit amount is required");
    }

    const updatedUser = await pool.query(
      `
      UPDATE users
      SET credits = GREATEST(COALESCE(credits, 0) - $1, 0)
      WHERE id = $2
      RETURNING id, full_name, username, email, role, identity_number, credits, status, deletion_requested_at, custom_permissions, otp_enabled, created_at
      `,
      [credits, userId]
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    res.json(updatedUser.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to delete credits");
  }
});

async function permanentlyDeleteUser(client, id) {
  await client.query(`DELETE FROM credits_history WHERE user_id = $1`, [id]);
  await client.query(`DELETE FROM favorites WHERE user_id = $1`, [id]);
  await client.query(`DELETE FROM downloads WHERE user_id = $1`, [id]);

  await client.query("ALTER TABLE activity_events DISABLE TRIGGER activity_events_immutable_trigger");
  try {
    return await client.query(
      `DELETE FROM users
       WHERE id = $1
       RETURNING id, full_name, username, email, role, identity_number, credits, status, created_at`,
      [id]
    );
  } finally {
    await client.query("ALTER TABLE activity_events ENABLE TRIGGER activity_events_immutable_trigger");
  }
}

async function processDueUserDeletions() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const dueUsers = await client.query(
      `SELECT id FROM users
       WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at <= NOW()
       FOR UPDATE`
    );
    for (const user of dueUsers.rows) {
      await permanentlyDeleteUser(client, user.id);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Scheduled user deletion failed", err);
  } finally {
    client.release();
  }
}

app.delete("/admin/users/:id/force-delete", verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, username, status FROM users WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json("User not found");
    }

    const deletedUser = await permanentlyDeleteUser(client, id);

    await client.query("COMMIT");
    void notifyUserAccountStatusChange({ targetUserId: Number(id), actorId: req.user?.id, previousStatus: userResult.rows[0].status, newStatus: 'deleted', action: 'delete' }).catch((notificationError) => {
      console.error('User deletion notification failed', notificationError);
    });
    res.json({
      message: "User deleted permanently.",
      user: deletedUser.rows[0]
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).send("Failed to permanently delete user");
  } finally {
    client.release();
  }
});

app.delete("/admin/users/:id", verifyAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, username, status, deletion_requested_at FROM users WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json("User not found");
    }

    const requestedAt = userResult.rows[0].deletion_requested_at;
    if (!requestedAt) {
      const scheduledUser = await client.query(
        `UPDATE users
         SET status = 'blocked',
             deletion_backup_status = COALESCE(deletion_backup_status, status),
             deletion_requested_at = NOW() + INTERVAL '60 minutes'
         WHERE id = $1
         RETURNING id, full_name, username, email, role, identity_number, credits, status, created_at, deletion_requested_at, deletion_backup_status`,
        [id]
      );
      await client.query("COMMIT");
      void notifyUserAccountStatusChange({ targetUserId: Number(id), actorId: req.user?.id, previousStatus: userResult.rows[0].status, newStatus: 'blocked', action: 'delete' }).catch((notificationError) => {
        console.error('User deletion notification failed', notificationError);
      });
      return res.status(202).json({
        message: "User deletion scheduled. The account will be permanently deleted in 60 minutes.",
        user: scheduledUser.rows[0]
      });
    }

    if (new Date(requestedAt).getTime() > Date.now()) {
      await client.query("COMMIT");
      return res.status(202).json({
        message: "User deletion is still in its 60-minute cooling period.",
        deletion_requested_at: requestedAt
      });
    }

    const deletedUser = await permanentlyDeleteUser(client, id);

    await client.query("COMMIT");
    res.json(deletedUser.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).send("Failed to delete user");
  } finally {
    client.release();
  }
});

try {
  const cron = require('node-cron');
  cron.schedule('* * * * *', processDueUserDeletions);
  processDueUserDeletions();
} catch (err) {
  console.warn('User deletion scheduler setup skipped', err.message || err);
}

app.delete("/admin/users/:id/cancel-deletion", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userResult = await pool.query(
      `SELECT id, deletion_requested_at, deletion_backup_status
       FROM users
       WHERE id = $1`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json("User not found");
    }

    if (!userResult.rows[0].deletion_requested_at) {
      return res.status(400).json("This user is not currently scheduled for deletion.");
    }

    const updatedUser = await pool.query(
      `UPDATE users
       SET deletion_requested_at = NULL,
           status = COALESCE(deletion_backup_status, 'active'),
           deletion_backup_status = NULL
       WHERE id = $1
       RETURNING id, full_name, username, email, role, identity_number, credits, status, created_at, deletion_requested_at, deletion_backup_status`,
      [id]
    );

    res.json({
      message: "Deletion process cancelled. The user has been restored to active access.",
      user: updatedUser.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to cancel user deletion");
  }
});

app.get("/admin/categories", verifyAdmin, async (req, res) => {
  try {
    const categories = await getCategoriesList();
    res.json(categories);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch admin categories");
  }
});

app.post("/admin/categories", verifyAdmin, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json("Category name is required");
    }

    const newCategory = await pool.query(
      `
      INSERT INTO categories (name)
      VALUES ($1)
      ON CONFLICT (name) DO NOTHING
      RETURNING *
      `,
      [name.trim()]
    );

    if (newCategory.rows.length === 0) {
      return res.status(400).json("Category already exists");
    }

    res.json(newCategory.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to add category");
  }
});

app.delete("/admin/categories/:id", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await pool.query(
      `
      DELETE FROM categories
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (deleted.rows.length === 0) {
      return res.status(404).json("Category not found");
    }

    res.json(deleted.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to delete category");
  }
});

/* ---------------- ADD CREDITS ---------------- */

app.put(
  "/credits/add",
  async (req, res) => {

    try {

      const authHeader =
        req.headers["authorization"];

      if (!authHeader) {

        return res.status(401).json(
          "Access denied"
        );

      }

      const token =
        authHeader.split(" ")[1];

      const decoded = verifyJwtToken(token);

      const { credits } =
        req.body;

      const user =
        await pool.query(

          `
          UPDATE users
          SET credits =
            COALESCE(credits,0) + $1
          WHERE id = $2
          RETURNING *
          `,

          [
            credits,
            decoded.user
          ]

        );

      // record this credit addition in credits_history for audit
      try {
        const { payment_method, transaction_id, amount_paid, currency } = req.body || {};
        await pool.query(
          `
          INSERT INTO credits_history
          (
            user_id,
            credits,
            payment_method,
            transaction_id,
            amount_paid,
            currency
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            COALESCE($6, 'INR')
          )
          `,
          [decoded.user, credits, payment_method || null, transaction_id || null, amount_paid || null, currency || null]
        );
      } catch (err) {
        console.error('Failed to insert credits_history record', err.message || err);
        // continue — do not block credit update on history logging failure
      }

      res.json(
        user.rows[0]
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Credit update error"
      );

    }

  }
);
/* ---------------- ADD FAVORITE ---------------- */

app.post(
  "/favorites/:imageId",
  async (req, res) => {

    try {

      const authHeader =
        req.headers["authorization"];

      if (!authHeader) {

        return res.status(401).json(
          "Access denied"
        );

      }

      const token =
        authHeader.split(" ")[1];

      const decoded = verifyJwtToken(token);

      const { imageId } =
        req.params;

      await pool.query(

        `
        INSERT INTO favorites
        (
          user_id,
          image_id
        )
        VALUES
        (
          $1,
          $2
        )
        ON CONFLICT (user_id, image_id) DO NOTHING
        `,

        [
          decoded.user,
          imageId
        ]

      );
      const imageResult =
  await pool.query(
    `
    SELECT
      title,
      uploaded_by
    FROM images
    WHERE id = $1
    `,
    [imageId]
  );

const image =
  imageResult.rows[0];
  const owner =
  await pool.query(
    `
    SELECT id, username, email, full_name, role
    FROM users
    WHERE id = $1
    `,
    [image.uploaded_by]
  );

await createAssetNotifications(pool, {
  userIds: [decoded.user, owner.rows[0]?.id],
  eventType: 'ASSET_FAVORITED',
  assetTitle: image.title,
  ownerId: owner.rows[0]?.id,
  actorId: decoded.user
});

      res.json(
        "Added to favorites"
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Favorite error"
      );

    }

  }
);
/* ---------------- REMOVE FAVORITE ---------------- */

app.delete(
  "/favorites/:imageId",
  async (req, res) => {

    try {

      const authHeader =
        req.headers["authorization"];

      if (!authHeader) {

        return res.status(401).json(
          "Access denied"
        );

      }

      const token =
        authHeader.split(" ")[1];

      const decoded = verifyJwtToken(token);

      const { imageId } =
        req.params;

      await pool.query(

        `
        DELETE FROM favorites
WHERE user_id = $1
AND image_id = $2
        `,

        [
          decoded.user,
          imageId
        ]

      );

      res.json(
        "Favorite removed"
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Remove favorite error"
      );

    }

  }
);
/* ---------------- MY FAVORITES ---------------- */

app.get(
  "/favorites",
  async (req, res) => {

    try {

      const authHeader =
        req.headers["authorization"];

      if (!authHeader) {

        return res.status(401).json(
          "Access denied"
        );

      }

      const token =
        authHeader.split(" ")[1];

      const decoded = verifyJwtToken(token);

      const favorites =
        await pool.query(

          `
          SELECT
            images.*
          FROM favorites
          JOIN images
            ON favorites.image_id = images.id
          WHERE favorites.user_id = $1
          ORDER BY images.created_at DESC
          `,

          [decoded.user]

        );

      res.json(
        favorites.rows
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Favorites fetch error"
      );

    }

  }
);
/* ---------------- MY DOWNLOADS ---------------- */

app.get(
  "/my-downloads",
  async (req, res) => {

    try {

      const authHeader =
        req.headers["authorization"];

      if (!authHeader) {

        return res.status(401).json(
          "Access denied"
        );

      }

      const token =
        authHeader.split(" ")[1];

      const decoded =
        verifyJwtToken(token);

      const downloads =
        await pool.query(

              `
              SELECT * FROM (

                -- direct downloads/credits
                SELECT
                  images.*,
                  d.downloaded_at AS downloaded_at,
                  'direct' AS source
                FROM downloads d
                JOIN images ON d.image_id = images.id
                WHERE d.user_id = $1

                UNION

                -- customer_downloads (purchased assets / license tokens)
                SELECT
                  images.*,
                  cd.created_at AS downloaded_at,
                  'customer_download' AS source
                FROM customer_downloads cd
                JOIN images ON cd.image_id = images.id
                WHERE cd.user_id = $1

                UNION

                -- order items from completed orders
                SELECT
                  images.*,
                  oi.created_at AS downloaded_at,
                  'order_item' AS source
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                JOIN images ON oi.asset_id = images.id
                WHERE o.customer_id = $1
                  AND (o.payment_status = 'completed' OR o.order_status = 'completed')

              ) t
              ORDER BY downloaded_at DESC
              `,

              [decoded.user]

            );

          res.json(downloads.rows);

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Downloads fetch error"
      );

    }

  }
);

/* ---------------- MY CUSTOMER DOWNLOADS (customer_downloads) ---------------- */

app.get(
  "/my-customer-downloads",
  async (req, res) => {
    try {
      const authHeader = req.headers["authorization"];
      if (!authHeader) return res.status(401).json("Access denied");
      const token = authHeader.split(" ")[1];
      const decoded = verifyJwtToken(token);
      const userId = decoded.user;
        console.debug('my-customer-downloads request for user', userId);

      const q = await pool.query(
        `
        SELECT
          cd.id,
          cd.user_id,
          cd.image_id,
          cd.download_token,
          cd.license,
          cd.expires_at,
          cd.is_active,
          cd.created_at,
          i.title,
          i.filename,
          i.thumbnail_url,
          i.thumbnail_status
        FROM customer_downloads cd
        JOIN images i ON i.id = cd.image_id
        WHERE cd.user_id = $1
        ORDER BY cd.created_at DESC
        `,
        [userId]
      );

      res.json(q.rows);
    } catch (err) {
      console.error("my-customer-downloads error", err && err.message ? err.message : err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* ---------------- GET ACTIVE CUSTOMER DOWNLOAD TOKEN FOR IMAGE ---------------- */

app.get(
  "/customer-download-token/:imageId",
  async (req, res) => {
    try {
      const authHeader = req.headers["authorization"];
      if (!authHeader) return res.status(401).json("Access denied");
      const token = authHeader.split(" ")[1];
      const decoded = verifyJwtToken(token);
      const userId = decoded.user;
      const { imageId } = req.params;

      const q = await pool.query(
        `
        SELECT download_token, expires_at, is_active
        FROM customer_downloads
        WHERE user_id = $1
          AND image_id = $2
          AND is_active = TRUE
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [userId, imageId]
      );

      if (q.rows.length === 0) {
        return res.status(404).json({ error: "No active download token found" });
      }

      res.json(q.rows[0]);
    } catch (err) {
      console.error("customer-download-token error", err && err.message ? err.message : err);
      res.status(500).json({ error: "Server error" });
    }
  }
);
/* ---------------- LEADERBOARD ---------------- */

app.get(
  "/leaderboard",
  async (req, res) => {

    try {

      const result =
        await pool.query(

          `
          SELECT

u.username AS name,

COUNT(*) AS uploads,

COALESCE(
  SUM(i.likes),
  0
) AS likes,

COALESCE(
  SUM(i.views),
  0
) AS views,

COALESCE(
  SUM(i.downloads),
  0
) AS downloads,

COALESCE(
  SUM(i.earnings),
  0
) AS earnings

FROM images i

JOIN users u
ON i.uploaded_by = u.id

GROUP BY
u.username

ORDER BY
SUM(i.downloads) DESC

LIMIT 10
          `

        );

      res.json(
        result.rows
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Leaderboard error"
      );

    }

  }
);
/* ---------------- GET NOTIFICATIONS ---------------- */

async function verifyNotificationOwner(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.cookies?.authToken;
    if (!token) return res.status(401).json('Access denied');
    const decoded = verifyJwtToken(token);
    const result = await pool.query('SELECT id, username, role, status, created_at FROM users WHERE id = $1', [decoded.user]);
    const user = result.rows[0];
    if (!user || String(user.status || '').toLowerCase() === 'blocked') return res.status(401).json('Invalid token');
    if (String(user.role).toLowerCase() !== 'admin' && String(user.username).toLowerCase() !== String(req.params.username).toLowerCase()) return res.status(403).json('You can only access your own notifications');
    req.user = { id: user.id, username: user.username, role: user.role, createdAt: user.created_at };
    next();
  } catch (err) {
    return res.status(401).json('Invalid token');
  }
}

app.get(
  "/notifications/:username",
  verifyNotificationOwner,
  async (req, res) => {

    try {

      const { username } =
  req.params;

      const notifications =
        await pool.query(

          `
          SELECT *
          FROM notifications
          WHERE username = $1
          AND ($2::boolean = FALSE OR created_at >= $3)
          ORDER BY created_at DESC
          LIMIT 50
          `,

          [username, req.user.role === 'admin' && String(username).toLowerCase() === String(req.user.username).toLowerCase(), req.user.createdAt]

        );

      res.json(
        notifications.rows
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Notifications error"
      );

    }

  }
);

/* ---------------- DEBUG: CUSTOMER DOWNLOADS BY USER (dev only) ---------------- */

app.get('/debug/customer-downloads/:userId', verifyAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const q = await pool.query('SELECT cd.*, i.title, i.filename FROM customer_downloads cd LEFT JOIN images i ON i.id = cd.image_id WHERE cd.user_id = $1 ORDER BY cd.created_at DESC', [userId]);
    res.json(q.rows);
  } catch (err) {
    console.error('debug customer-downloads error', err && err.message ? err.message : err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/debug/customer-downloads-count', verifyAdmin, async (req, res) => {
  try {
    const q = await pool.query('SELECT COUNT(*)::int AS c FROM customer_downloads');
    res.json({ count: q.rows[0].c });
  } catch (err) {
    console.error('debug customer-downloads-count error', err && err.message ? err.message : err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/debug/customer-downloads-all', verifyAdmin, async (req, res) => {
  try {
    const q = await pool.query('SELECT cd.*, u.username AS username, i.title AS image_title FROM customer_downloads cd LEFT JOIN users u ON u.id = cd.user_id LEFT JOIN images i ON i.id = cd.image_id ORDER BY cd.created_at DESC');
    res.json(q.rows);
  } catch (err) {
    console.error('debug customer-downloads-all error', err && err.message ? err.message : err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/debug/whoami', authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'no auth' });
    const token = authHeader.split(' ')[1];
    const decoded = verifyJwtToken(token);
    const q = await pool.query('SELECT id, username, email FROM users WHERE id = $1', [decoded.user]);
    console.log('DEBUG WHOAMI:', q.rows[0] || null);
    res.json(q.rows[0] || {});
  } catch (err) {
    console.error('debug whoami error', err && err.message ? err.message : err);
    res.status(500).json({ error: 'server error' });
  }
});

/* ---------------- DEBUG: ENSURE CUSTOMER_DOWNLOADS FOR USER ---------------- */
// Dev helper: ensure every order_item for user's orders has a customer_downloads row
app.post('/debug/ensure-customer-downloads/:userId', verifyAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    // find order items belonging to this user's orders
    const itemsQ = await pool.query(
      `SELECT oi.id AS order_item_id, oi.order_id, oi.asset_id AS image_id
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.customer_id = $1`,
      [userId]
    );

    const inserted = [];
    for (const row of itemsQ.rows) {
      const chk = await pool.query(
        `SELECT id FROM customer_downloads WHERE order_id = $1 AND image_id = $2 LIMIT 1`,
        [row.order_id, row.image_id]
      );
      if (chk.rows.length === 0) {
        const token = crypto.randomBytes(12).toString('hex');
        const ins = await pool.query(
          `INSERT INTO customer_downloads (user_id, image_id, order_id, download_token, license, expires_at, is_active, created_at) VALUES ($1,$2,$3,$4,$5,NOW() + INTERVAL '100 days', TRUE, NOW()) RETURNING *`,
          [Number(userId), row.image_id, row.order_id, token, 'Standard license']
        );
        inserted.push(ins.rows[0]);
      }
    }

    res.json({ ok: true, inserted_count: inserted.length, inserted });
  } catch (err) {
    console.error('ensure-customer-downloads error', err && err.message ? err.message : err);
    res.status(500).json({ error: 'server error' });
  }
});
/* ---------------- MARK NOTIFICATIONS READ ---------------- */

app.put(
  "/notifications/read/:username",
  verifyNotificationOwner,
  async (req, res) => {

    try {

      const { username } =
        req.params;

      await pool.query(
        `
        UPDATE notifications
        SET is_read = TRUE
        WHERE username = $1
        `,
        [username]
      );

      res.json(
        "Notifications marked read"
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Read notification error"
      );

    }

  }
);

app.delete(
  "/notifications/:username",
  verifyNotificationOwner,
  async (req, res) => {
    try {
      const result = await pool.query(
        'DELETE FROM notifications WHERE username = $1',
        [req.params.username]
      );
      res.json({ ok: true, deleted: result.rowCount || 0 });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Clear notifications error' });
    }
  }
);
/* ---------------- UNREAD COUNT ---------------- */

app.get(
  "/notifications/count/:username",
  verifyNotificationOwner,
  async (req, res) => {

    try {

      const { username } =
        req.params;

      const result =
        await pool.query(
          `
          SELECT COUNT(*) AS count
          FROM notifications
          WHERE username = $1
          AND is_read = FALSE
          AND ($2::boolean = FALSE OR created_at >= $3)
          `,
          [username, req.user.role === 'admin' && String(username).toLowerCase() === String(req.user.username).toLowerCase(), req.user.createdAt]
        );

      res.json(
        result.rows[0]
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Unread count error"
      );

    }

  }
);
/* ---------------- EARNINGS DASHBOARD ---------------- */

app.get(
  "/earnings-dashboard",
  async (req, res) => {

    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

      const authHeader =
        req.headers["authorization"];

      const token =
        authHeader.split(" ")[1];

      const decoded = verifyJwtToken(token);

      const userId =
        decoded.user;

      const result =
        await pool.query(

          `
          SELECT

          COALESCE((
            SELECT SUM(e.amount)
            FROM earnings e
            WHERE e.contributor_id = $1 AND e.status <> 'rejected'
          ), 0) + COALESCE((
            SELECT SUM(ch.amount_paid)
            FROM credits_history ch
            WHERE ch.user_id = $1 AND ch.payment_method = 'redeem'
          ), 0) AS total_earnings,

          COALESCE((
            SELECT SUM(e.amount) FILTER (WHERE e.created_at >= NOW() - INTERVAL '24 hours')
            FROM earnings e
            WHERE e.contributor_id = $1 AND e.status <> 'rejected'
          ), 0) AS earnings_today,

          COALESCE((
            SELECT SUM(e.amount) FILTER (WHERE e.created_at >= NOW() - INTERVAL '7 days')
            FROM earnings e
            WHERE e.contributor_id = $1 AND e.status <> 'rejected'
          ), 0) AS earnings_last_7_days,

          COALESCE((
            SELECT SUM(e.amount) FILTER (WHERE e.created_at >= NOW() - INTERVAL '30 days')
            FROM earnings e
            WHERE e.contributor_id = $1 AND e.status <> 'rejected'
          ), 0) AS earnings_last_30_days,

          COALESCE((
            SELECT SUM(e.amount) FILTER (WHERE e.created_at >= NOW() - INTERVAL '365 days')
            FROM earnings e
            WHERE e.contributor_id = $1 AND e.status <> 'rejected'
          ), 0) AS earnings_last_365_days,

          GREATEST(
            COALESCE((
              SELECT SUM(e.amount)
              FROM earnings e
              WHERE e.contributor_id = $1 AND e.status <> 'rejected'
            ), 0) + COALESCE((
              SELECT SUM(ch.amount_paid)
              FROM credits_history ch
              WHERE ch.user_id = $1 AND ch.payment_method = 'redeem'
            ), 0) - COALESCE((
              SELECT SUM(pr.requested_credits)
              FROM payout_requests pr
              WHERE pr.contributor_id = $1 AND pr.status <> 'rejected'
            ), 0),
            0
          ) AS unpaid_earnings,

          GREATEST(
            COALESCE((
              SELECT SUM(e.amount)
              FROM earnings e
              WHERE e.contributor_id = $1 AND e.status <> 'rejected'
            ), 0) + COALESCE((
              SELECT SUM(ch.amount_paid)
              FROM credits_history ch
              WHERE ch.user_id = $1 AND ch.payment_method = 'redeem'
            ), 0) - COALESCE((
              SELECT SUM(pr.requested_credits)
              FROM payout_requests pr
              WHERE pr.contributor_id = $1 AND pr.status <> 'rejected'
            ), 0),
            0
          ) AS available_balance,

          COALESCE(
            SUM(downloads),
            0
          ) AS total_downloads,

          COUNT(*) AS total_images

          FROM images i

          WHERE i.uploaded_by = $1
          `,

          [userId]

        );

      const dailyEarningsResult = await pool.query(
        `
        SELECT
          day::date AS date,
          COALESCE(SUM(e.amount), 0) AS amount
        FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') AS days(day)
        LEFT JOIN earnings e
          ON e.contributor_id = $1
          AND e.status <> 'rejected'
          AND e.created_at >= day
          AND e.created_at < day + INTERVAL '1 day'
        GROUP BY day
        ORDER BY day
        `,
        [userId]
      );

      const weeklyEarningsResult = await pool.query(
        `
        SELECT
          week_start::date AS date,
          COALESCE(SUM(e.amount), 0) AS amount
        FROM generate_series(CURRENT_DATE - INTERVAL '42 days', CURRENT_DATE, INTERVAL '7 days') AS weeks(week_start)
        LEFT JOIN earnings e
          ON e.contributor_id = $1
          AND e.status <> 'rejected'
          AND e.created_at >= week_start
          AND e.created_at < week_start + INTERVAL '7 days'
        GROUP BY week_start
        ORDER BY week_start
        `,
        [userId]
      );

      const soldAssetsResult = await pool.query(
        `
        SELECT
          e.id AS sale_id,
          e.order_id,
          i.id,
          i.title,
          i.filename,
          i.status,
          i.created_at,
          e.created_at AS sold_at,
          e.amount AS earnings,
          (
            SELECT COUNT(*)
            FROM downloads asset_downloads
            WHERE asset_downloads.image_id = i.id
          ) AS downloads
        FROM images i
        INNER JOIN earnings e
          ON e.asset_id = i.id
          AND e.contributor_id = $1
          AND e.status <> 'rejected'
        WHERE i.uploaded_by = $1
        AND e.amount > 0
        ORDER BY e.created_at DESC
        `,
        [userId]
      );

      res.json(
        {
          ...result.rows[0],
          earnings_daily: dailyEarningsResult.rows.map((row) => ({
            date: row.date,
            amount: Number(row.amount || 0),
          })),
          earnings_weekly: weeklyEarningsResult.rows.map((row) => ({
            date: row.date,
            amount: Number(row.amount || 0),
          })),
          sold_assets: soldAssetsResult.rows.map((row) => ({
            sale_id: row.sale_id,
            order_id: row.order_id,
            id: row.id,
            title: row.title,
            filename: row.filename,
            status: row.status,
            created_at: row.created_at,
            sold_at: row.sold_at,
            earnings: Number(row.earnings || 0),
            downloads: Number(row.downloads || 0),
          })),
        }
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Earnings dashboard error"
      );

    }

  }
);
/* ---------------- BEST SELLING IMAGE ---------------- */

app.get(
  "/best-selling-image",
  async (req, res) => {

    try {

      const authHeader =
        req.headers["authorization"];

      const token =
        authHeader.split(" ")[1];

      const decoded = verifyJwtToken(token);

      const userId =
        decoded.user;

      const result =
        await pool.query(

          `
          SELECT
            id,
            title,
            filename,
            downloads,
            earnings
          FROM images
          WHERE uploaded_by = $1
          ORDER BY downloads DESC
          LIMIT 1
          `,

          [userId]

        );

      res.json(
        result.rows[0] || {}
      );

    } catch (err) {

      console.error(err);

      res.status(500).send(
        "Best selling image error"
      );

    }

  }
);
/* ---------------- SEARCH KEYWORD ---------------- */

app.post("/search-keyword", async (req, res) => {
  try {

    const { keyword } = req.body;

    if (!keyword || keyword.trim() === "") {
      return res.json();
    }

    const existing = await pool.query(
      `
      SELECT *
      FROM keyword_searches
      WHERE LOWER(keyword)=LOWER($1)
      `,
      [keyword.trim()]
    );

    if (existing.rows.length > 0) {

      await pool.query(
        `
        UPDATE keyword_searches
        SET
          search_count = search_count + 1,
          updated_at = NOW()
        WHERE LOWER(keyword)=LOWER($1)
        `,
        [keyword.trim()]
      );

    } else {

      await pool.query(
        `
        INSERT INTO keyword_searches
        (
          keyword,
          search_count
        )
        VALUES
        (
          $1,
          1
        )
        `,
        [keyword.trim()]
      );

    }

    res.json({
      success:true
    });

  } catch(err){

    console.error(err);

    res.status(500).json(err);

  }

});
/* ---------------- TRENDING KEYWORDS ---------------- */

app.get("/trending-keywords", async (req, res) => {

  try {

    const result = await pool.query(

      `
      SELECT
        ks.keyword,

        ks.search_count,

        COALESCE(
          SUM(i.views),
          0
        ) AS views,

        COALESCE(
          SUM(i.downloads),
          0
        ) AS downloads,

        CASE

          WHEN
          (
            COALESCE(SUM(i.views),0)
            +
            COALESCE(SUM(i.downloads),0)
          ) = 0

          THEN 0

          ELSE

            ks.search_count::decimal /

            (
              COALESCE(SUM(i.views),0)
              +
              COALESCE(SUM(i.downloads),0)
            )

        END AS score

      FROM keyword_searches ks

      LEFT JOIN images i

      ON

      (
        LOWER(i.title)
        LIKE '%' || LOWER(ks.keyword) || '%'

        OR

        LOWER(i.keywords)
        LIKE '%' || LOWER(ks.keyword) || '%'
      )

      GROUP BY

        ks.id,
        ks.keyword,
        ks.search_count

      HAVING

        COALESCE(
          SUM(i.downloads),
          0
        ) > 0

      ORDER BY

        score DESC,

        ks.search_count DESC

      LIMIT 5
      `

    );

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Failed to load trending keywords"
    });

  }

});
/* ---------------- RECORD KEYWORD SEARCH ---------------- */

app.post("/search-keyword", async (req, res) => {
  try {
    const { keyword } = req.body;

    if (!keyword || keyword.trim() === "") {
      return res.status(400).json("Keyword is required");
    }

    await pool.query(
      `
      INSERT INTO keyword_searches
      (keyword, search_count, updated_at)
      VALUES
      ($1, 1, NOW())

      ON CONFLICT (keyword)

      DO UPDATE
      SET
        search_count = keyword_searches.search_count + 1,
        updated_at = NOW()
      `,
      [keyword.trim()]
    );

    res.json({
      success: true,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json("Server Error");
  }
});
/* ---------------- TRENDING KEYWORDS ---------------- */

app.get("/trending-keywords", async (req, res) => {
  try {

    const result = await pool.query(`
      SELECT
        ks.keyword,
        ks.search_count,

        COALESCE(SUM(i.views), 0) AS views,
        COALESCE(SUM(i.downloads), 0) AS downloads,

        CASE
          WHEN (COALESCE(SUM(i.views),0) + COALESCE(SUM(i.downloads),0)) = 0
          THEN ks.search_count
          ELSE
            ks.search_count::decimal /
            (
              COALESCE(SUM(i.views),0) +
              COALESCE(SUM(i.downloads),0)
            )
        END AS score

      FROM keyword_searches ks

      LEFT JOIN images i
      ON
        LOWER(i.title) LIKE '%' || LOWER(ks.keyword) || '%'
        OR
        LOWER(i.keywords) LIKE '%' || LOWER(ks.keyword) || '%'

      GROUP BY
        ks.id,
        ks.keyword,
        ks.search_count

      ORDER BY
        score DESC,
        ks.search_count DESC

      LIMIT 5
    `);

    res.json(result.rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Failed to load trending keywords"
    });

  }
});
/* ---------------- TRACK VISITOR ---------------- */

app.post("/track-visitor", async (req, res) => {

  try {

    await pool.query(
      `
      INSERT INTO visitor_logs
      (
        visited_at
      )
      VALUES
      (
        CURRENT_TIMESTAMP
      )
      `
    );

    res.json({
      success: true
    });

  } catch (err) {

    console.error(err);

    res.status(500).json(err);

  }

});




/* ---------------- HERO STATS ---------------- */

app.get("/hero-stats", async (req, res) => {

  try {

    const totalAssets =
      await pool.query(

        `
        SELECT COUNT(*) AS total
        FROM images
        WHERE status='approved'
        `

      );

    const totalSearches =
      await pool.query(

        `
        SELECT
        COALESCE(
          SUM(search_count),
          0
        ) AS total
        FROM keyword_searches
        `

      );

    const totalDownloads =
      await pool.query(

        `
        SELECT COUNT(*) AS total
        FROM downloads
        `

      );

    const todayVisitors =
      await pool.query(

        `
        SELECT COUNT(*) AS total
        FROM visitor_logs

        WHERE

        visited_at::date =
        CURRENT_DATE
        `

      );

    res.json({

      totalAssets:
        Number(
          totalAssets.rows[0].total
        ),

      totalSearches:
        Number(
          totalSearches.rows[0].total
        ),

      totalDownloads:
        Number(
          totalDownloads.rows[0].total
        ),

      todayVisitors:
        Number(
          todayVisitors.rows[0].total
        )

    });

  }

  catch(err){

    console.log(err);

    res.status(500).json(err);

  }

});


/* ============= CART PERSISTENCE ENDPOINTS ============= */

// GET /cart/get - Load user's cart from database
app.get('/cart/get', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.user || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT 
        image_id as id,
        title,
        filename,
        collection,
        category,
        price,
        price as unitPrice,
        currency,
        license,
        free_asset as freeAsset,
        contributor_id as contributorId,
        item_type as "itemType",
        (item_type = 'credit_package') AS "creditPackage",
        credit_amount as "creditAmount",
        quantity
      FROM user_cart_items
      WHERE user_id = $1
      ORDER BY created_at DESC`,
      [userId]
    );

    const items = result.rows || [];
    res.json({ items });
  } catch (err) {
    console.error('Failed to load cart:', err.message || err);
    res.status(500).json({ error: 'Failed to load cart' });
  }
});

// POST /cart/save - Save user's cart to database
app.post('/cart/save', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.user || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const items = req.body?.items || [];
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items must be an array' });
    }

    // Clear existing cart for this user
    await pool.query('DELETE FROM user_cart_items WHERE user_id = $1', [userId]);

    // Insert new cart items
    if (items.length > 0) {
      const insertPromises = items.map((item) => {
        return pool.query(
          `INSERT INTO user_cart_items (
            user_id, image_id, title, filename, collection, category, 
            price, currency, license, free_asset, contributor_id, item_type, credit_amount, quantity
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (user_id, image_id, currency) DO UPDATE SET
            quantity = EXCLUDED.quantity,
            updated_at = NOW()`,
          [
            userId,
            Number(item.id || 0),
            String(item.title || ''),
            String(item.filename || ''),
            String(item.collection || ''),
            String(item.category || ''),
            Number(item.price || item.unitPrice || 0),
            String(item.currency || 'USD'),
            String(item.license || 'Standard license'),
            !!item.freeAsset,
            item.contributorId || null,
            item.creditPackage ? 'credit_package' : 'asset',
            item.creditPackage ? Number(item.creditAmount || 0) : null,
            Number(item.quantity || 1)
          ]
        );
      });

      await Promise.all(insertPromises);
    }

    res.json({ success: true, items: items.length });
  } catch (err) {
    console.error('Failed to save cart:', err.message || err);
    res.status(500).json({ error: 'Failed to save cart' });
  }
});

// POST /cart/clear - Clear user's cart
app.post('/cart/clear', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.user || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await pool.query('DELETE FROM user_cart_items WHERE user_id = $1', [userId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to clear cart:', err.message || err);
    res.status(500).json({ error: 'Failed to clear cart' });
  }
});

async function ensureGfxSyncChangeTracking() {
  try {
    const existing = await pool.query(`
      SELECT to_regclass('public.gfx_sync_changes') AS table_name;
    `);

    if (existing.rows[0] && existing.rows[0].table_name) {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_gfx_sync_changes_table_record
          ON public.gfx_sync_changes(table_name, record_id, changed_at DESC);

        CREATE INDEX IF NOT EXISTS idx_gfx_sync_changes_device
          ON public.gfx_sync_changes(device_id, changed_at DESC);
      `);
      return true;
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.gfx_sync_changes (
        id BIGSERIAL PRIMARY KEY,
        device_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        record_id TEXT,
        operation TEXT NOT NULL,
        changed_fields JSONB DEFAULT '{}'::jsonb,
        old_values JSONB DEFAULT '{}'::jsonb,
        new_values JSONB DEFAULT '{}'::jsonb,
        changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        version INTEGER NOT NULL DEFAULT 1,
        source TEXT DEFAULT 'admin-panel',
        metadata JSONB DEFAULT '{}'::jsonb
      );

      CREATE INDEX IF NOT EXISTS idx_gfx_sync_changes_table_record
        ON public.gfx_sync_changes(table_name, record_id, changed_at DESC);

      CREATE INDEX IF NOT EXISTS idx_gfx_sync_changes_device
        ON public.gfx_sync_changes(device_id, changed_at DESC);
    `);
    return true;
  } catch (error) {
    console.error('Failed to initialize gfx_sync_changes table:', error.message || error);
    return false;
  }
}

async function recordGfxSyncChange({ deviceId, tableName, recordId, operation, changedFields = {}, oldValues = {}, newValues = {}, version = 1, metadata = {} }) {
  try {
    await ensureGfxSyncChangeTracking();
    await pool.query(
      `INSERT INTO gfx_sync_changes (device_id, table_name, record_id, operation, changed_fields, old_values, new_values, version, source, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb)`,
      [
        deviceId || 'unknown-device',
        tableName,
        String(recordId ?? 'unknown-record'),
        operation,
        JSON.stringify(changedFields || {}),
        JSON.stringify(oldValues || {}),
        JSON.stringify(newValues || {}),
        Number(version || 1),
        'admin-panel',
        JSON.stringify(metadata || {})
      ]
    );
    return true;
  } catch (error) {
    console.warn('gfx_sync_changes insert failed:', error.message || error);
    return false;
  }
}

/* ----------- THUMBNAIL SYSTEM INITIALIZATION ----------- */

async function initializeThumbnailSystem() {
  try {
    console.log("\n========== THUMBNAIL SYSTEM INITIALIZATION ==========\n");

    // Run database migration
    console.log("Running thumbnail system database migrations...");
    try {
      await ensureGfxSyncChangeTracking();
      const migrationFile = fs.readFileSync(
        path.join(__dirname, "migrations", "002_thumbnail_system.sql"),
        "utf8"
      );
      const statements = migrationFile.split(";").filter(s => s.trim());
      
      for (const statement of statements) {
        if (statement.trim()) {
          try {
            await pool.query(statement);
          } catch (err) {
            // Ignore constraint or already-exists errors
            if (!err.message.includes("already exists") && 
                !err.message.includes("duplicate") &&
                !err.message.includes("constraint")) {
              console.warn("Migration statement error:", err.message);
            }
          }

          const messagingMigration = fs.readFileSync(
            path.join(__dirname, "migrations", "003_messaging_activity.sql"),
            "utf8"
          );
          for (const statement of messagingMigration.split(";").filter(s => s.trim())) {
            try {
              await pool.query(statement);
            } catch (err) {
              console.warn("Messaging migration statement error:", err.message);
            }
          }
        }
      }
      const deliveryIndexesMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "004_messaging_delivery_indexes.sql"),
        "utf8"
      );
      for (const statement of deliveryIndexesMigration.split(";").filter(s => s.trim())) {
        try {
          await pool.query(statement);
        } catch (err) {
          console.warn("Delivery index migration statement error:", err.message);
        }
      }
      const immutableActivityMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "005_immutable_activity_events.sql"),
        "utf8"
      );
      await pool.query(immutableActivityMigration);
      const messageTicketMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "006_message_ticket_ids.sql"),
        "utf8"
      );
      await pool.query(messageTicketMigration);
      const messageVisibilityMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "007_message_visibility.sql"),
        "utf8"
      );
      await pool.query(messageVisibilityMigration);
      const conversationVisibilityMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "008_conversation_visibility.sql"),
        "utf8"
      );
      await pool.query(conversationVisibilityMigration);
      const messageReadVisibilityMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "009_message_read_visibility.sql"),
        "utf8"
      );
      await pool.query(messageReadVisibilityMigration);
      const activityVisibilityMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "010_activity_visibility.sql"),
        "utf8"
      );
      await pool.query(activityVisibilityMigration);
      const inactivitySessionsMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "011_inactivity_sessions.sql"),
        "utf8"
      );
      await pool.query(inactivitySessionsMigration);
      const subscriptionDownloadMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "013_subscription_download_tracking.sql"),
        "utf8"
      );
      await pool.query(subscriptionDownloadMigration);
      const customSubscriptionOtpMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "014_custom_subscription_otp.sql"),
        "utf8"
      );
      await pool.query(customSubscriptionOtpMigration);
      const customSubscriptionCompletionMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "015_custom_subscription_completion.sql"),
        "utf8"
      );
      await pool.query(customSubscriptionCompletionMigration);
      const downloadCounterMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "016_download_counter_consistency.sql"),
        "utf8"
      );
      await pool.query(downloadCounterMigration);
      const dailyReportSettingsMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "017_daily_report_settings.sql"),
        "utf8"
      );
      await pool.query(dailyReportSettingsMigration);
      const dailyReportSchedulesMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "018_daily_report_schedules.sql"),
        "utf8"
      );
      await pool.query(dailyReportSchedulesMigration);
      const orderDownloadIdentityMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "017_order_download_identity.sql"),
        "utf8"
      );
      await pool.query(orderDownloadIdentityMigration);
      const contributorTaxFormsMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "022_contributor_tax_forms.sql"),
        "utf8"
      );
      await pool.query(contributorTaxFormsMigration);
      const taxMailSettingsMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "023_tax_mail_settings.sql"),
        "utf8"
      );
      await pool.query(taxMailSettingsMigration);
      const taxMailSmtpMigration = fs.readFileSync(
        path.join(__dirname, "migrations", "024_tax_mail_smtp_settings.sql"),
        "utf8"
      );
      await pool.query(taxMailSmtpMigration);
      console.log("✓ Database migrations completed");
    } catch (err) {
      console.warn("Migration warning:", err.message);
    }

    // Detect processors
    console.log("\nDetecting thumbnail processors...");
    const detector = new ProcessorDetector();
    const detectionResults = await detector.runAllDetections();
    await detector.saveDetectionResults(detectionResults);
    await detector.printStatusTable();

    await backfillPendingEpsThumbnails();

    // Initialize thumbnail queue
    console.log("\nInitializing thumbnail processing queue...");
    const queueInitialized = await thumbnailQueue.initialize();
    if (!queueInitialized) {
      console.warn("⚠ Thumbnail queue initialization failed. Background processing disabled.");
    }

    console.log("\n========== THUMBNAIL SYSTEM READY ==========\n");
  } catch (err) {
    console.error("Thumbnail system initialization error:", err);
  }
}

/* Mount admin thumbnail routes */
app.use("/", adminThumbnailRoutes);

/* Central messaging, notifications, activity, and automation APIs */
app.use("/api/messages", createMessagingRouter(pool, authenticateToken, verifyAdmin));

/* ----------- GRACEFUL SHUTDOWN ----------- */

const shutdownHandlers = [];

process.on("SIGINT", async () => {
  console.log("\n\nShutting down gracefully...");
  try {
    await thumbnailQueue.shutdown();
  } catch (err) {
    console.error("Error during queue shutdown:", err);
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\nShutting down gracefully...");
  try {
    await thumbnailQueue.shutdown();
  } catch (err) {
    console.error("Error during queue shutdown:", err);
  }
  process.exit(0);
});

/* ---------------- SERVER ---------------- */

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  (async () => {
    try {
      await invalidateSessionsOnStartup();
    } catch (error) {
      console.error("Failed to invalidate authentication sessions on startup:", error.message || error);
      process.exitCode = 1;
      return;
    }

    await initializeThumbnailSystem();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  })();
}

ensureGfxSyncChangeTracking().catch((error) => {
  console.warn('Failed to initialize gfx_sync_changes on startup:', error.message || error);
});

module.exports = {
  app,
  buildMyUploadsQuery,
  buildAccountStatusNotificationMessage,
  createGfxBackupPackage,
  validateBackupPrerequisites,
  validateBackupArchive,
  normalizeDeviceId,
  collectDatabaseChangeMetadata,
  collectChangedFilesSince,
  collectFileChangeStatusReport,
  ensureGfxSyncChangeTracking,
  recordGfxSyncChange,
  summarizeContributorDownloadWindowCounts,
};

// Mount email admin routes (settings, templates, verify, send-test)
try {
  const emailRoutes = require('./email/routes');
  app.use('/admin/email', emailRoutes);
} catch (err) {
  console.error('Failed to mount email routes', err);
}

// Mount restore admin routes (upload, analyze, restore items)
try {
  app.locals.pool = pool;
  app.locals.JWT_SECRET = JWT_SECRET;
  app.use('/admin/restore', restoreRoutes);
} catch (err) {
  console.error('Failed to mount restore routes', err);
}

// Mount order management admin routes
try {
  registerOrderRoutes(app, pool, verifyAdmin, authenticateToken);
} catch (err) {
  console.error('Failed to mount order routes', err);
}
