const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const AdmZip = require("adm-zip");

// Restore directory path
const RESTORE_DIR = path.join(__dirname, "../backup/restore");

// Ensure restore directory exists
if (!fs.existsSync(RESTORE_DIR)) {
  fs.mkdirSync(RESTORE_DIR, { recursive: true });
}

// Multer upload configuration for restore files
const upload = multer({
  storage: multer.diskStorage({
    destination: RESTORE_DIR,
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      const random = crypto.randomBytes(4).toString("hex");
      cb(null, `${timestamp}-${random}-${file.originalname}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (!file.originalname.endsWith(".gfxbackup")) {
      return cb(new Error("Only .gfxbackup files are allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 * 1024 } // 5GB limit
});

/**
 * POST /admin/restore/upload
 * Upload and analyze a backup file
 */
router.post("/upload", upload.single("backup"), async (req, res) => {
  try {
    const { pool, JWT_SECRET } = req.app.locals;
    const token = req.headers.authorization?.split(" ")[1];
    
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET || "secretkey");
    } catch (err) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(401).json({ error: "Invalid token" });
    }

    const adminUserId = decoded.user;

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Read the uploaded file
    const filePath = req.file.path;
    let backupData;
    try {
      // Read .gfxbackup as ZIP file
      const zip = new AdmZip(filePath);
      
      // Extract manifest.json from ZIP
      const manifestEntry = zip.getEntry("manifest.json");
      if (!manifestEntry) {
        throw new Error("Backup package missing manifest.json");
      }
      
      const manifestContent = zip.readAsText(manifestEntry);
      backupData = JSON.parse(manifestContent);

      const databasePayloadEntry = zip.getEntry("database/changes/database-delta.json")
        || zip.getEntry("database/metadata/database-summary.json");
      if (databasePayloadEntry) {
        const databasePayload = JSON.parse(zip.readAsText(databasePayloadEntry));
        backupData.database = { ...(backupData.database || {}), ...databasePayload };
      }
    } catch (err) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      console.error("Restore file read error:", err.message);
      return res.status(400).json({ error: "Invalid backup file format: " + err.message });
    }

    await pool.query(
      `INSERT INTO restore_history (
        admin_user_id,
        backup_filename,
        backup_path,
        backup_size,
        backup_type,
        uploaded_at,
        status,
        total_changes,
        completed_changes,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), 'available', 0, 0, NOW())
      ON CONFLICT DO NOTHING`,
      [
        adminUserId,
        req.file.originalname,
        filePath,
        fs.statSync(filePath).size,
        backupData.type || "incremental"
      ]
    );

    await pool.query(
      `UPDATE restore_sessions SET
        status = 'completed',
        updated_at = NOW()
      WHERE admin_user_id = $1 AND status IN ('analyzed', 'in_progress')`,
      [adminUserId]
    );

    const backupId = (req.file.filename || req.file.originalname || 'restore-backup').replace(/\.gfxbackup$/i, '');
    const comparisonResult = {
      restore_session_id: null,
      backup_id: backupId,
      backup_filename: req.file.originalname,
      uploaded_at: new Date().toISOString(),
      source_device: backupData.sourceDevice || 'unknown',
      backup_type: backupData.type || 'incremental',
      status: 'analyzed',
      completed_items: 0,
      pending_items: 0,
      conflicts: 0,
      total_items: 0
    };

    // Create restore session
    const sessionResult = await pool.query(
      `INSERT INTO restore_sessions (
        admin_user_id,
        backup_filename,
        backup_id,
        backup_path,
        backup_type,
        source_device,
        comparison_result,
        total_items,
        conflict_items,
        completed_items,
        pending_items,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        adminUserId,
        req.file.originalname,
        backupId,
        filePath,
        backupData.type || "incremental",
        backupData.sourceDevice || "unknown",
        JSON.stringify(comparisonResult),
        0,
        0,
        0,
        0,
        "analyzed"
      ]
    );

    const session = sessionResult.rows[0];

    // Analyze backup and generate comparison items
    const items = await analyzeBackup(backupData, pool);

    // Insert restore items (only actionable ones)
    for (const item of items) {
      await pool.query(
        `INSERT INTO restore_items (
          session_id,
          type,
          category,
          name,
          description,
          current_version,
          backup_version,
          change_type,
          status,
          related_files
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          session.id,
          item.type,
          item.category,
          item.name,
          item.description,
          item.currentVersion,
          item.backupVersion,
          item.changeType,
          "pending",
          JSON.stringify(item.relatedFiles || [])
        ]
      );
    }

    // Count item types
    const newItemCount = items.filter((i) => i.changeType === "new").length;
    const updateItemCount = items.filter((i) => i.changeType === "update").length;

    const conflictCount = items.filter((i) => (i.changeType || i.change_type || '').toString().toLowerCase() === 'conflict').length;
    const comparisonSummary = {
      restore_session_id: session.session_id,
      backup_id: session.backup_id || backupId,
      backup_filename: session.backup_filename,
      uploaded_at: session.uploaded_at || new Date().toISOString(),
      source_device: session.source_device || 'unknown',
      backup_type: session.backup_type || 'incremental',
      status: 'analyzed',
      completed_items: 0,
      pending_items: items.length,
      conflicts: conflictCount,
      total_items: items.length
    };

    // Update session with item counts
    const updatedSession = await pool.query(
      `UPDATE restore_sessions SET
        total_items = $1,
        new_items = $2,
        updated_items = $3,
        unchanged_items = $4,
        conflict_items = $5,
        pending_items = $6,
        comparison_result = $7
      WHERE id = $8
      RETURNING *`,
      [
        items.length,
        newItemCount,
        updateItemCount,
        0,
        conflictCount,
        items.length,
        JSON.stringify(comparisonSummary),
        session.id
      ]
    );

    const retrievedItems = await pool.query(
      "SELECT * FROM restore_items WHERE session_id = $1 ORDER BY item_order ASC",
      [session.id]
    );

    // Generate comparison summary message
    let message = `Analysis complete`;
    if (items.length === 0) {
      message = `✓ Backup is up-to-date. No changes detected.`;
    } else {
      message = `Found ${items.length} actionable changes: ${newItemCount} new + ${updateItemCount} updated`;
    }

    res.json({
      session: updatedSession.rows[0],
      items: retrievedItems.rows,
      message: message
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error("Restore upload error", err);
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});

/**
 * GET /admin/restore/session
 * Get current restore session with items
 */
router.get("/session", async (req, res) => {
  try {
    const { pool } = req.app.locals;

    const sessionResult = await pool.query(
      `SELECT * FROM restore_sessions
       WHERE status IN ('analyzed', 'in_progress')
       ORDER BY created_at DESC
       LIMIT 1`
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: "No active session" });
    }

    const session = sessionResult.rows[0];

    const itemsResult = await pool.query(
      "SELECT * FROM restore_items WHERE session_id = $1 ORDER BY item_order ASC",
      [session.id]
    );

    const normalizedSession = {
      ...session,
      restore_session_id: session.session_id,
      backup_id: session.backup_id || session.backup_filename,
      conflicts: Number(session.conflict_items || 0),
      uploaded_at: session.uploaded_at || session.created_at,
      status: session.status || 'analyzed',
      comparison_result: session.comparison_result || {
        restore_session_id: session.session_id,
        backup_id: session.backup_id || session.backup_filename,
        backup_filename: session.backup_filename,
        uploaded_at: session.uploaded_at || session.created_at,
        source_device: session.source_device || 'unknown',
        backup_type: session.backup_type || 'incremental',
        status: session.status || 'analyzed',
        completed_items: Number(session.completed_items || 0),
        pending_items: Number(session.pending_items || 0),
        conflicts: Number(session.conflict_items || 0),
        total_items: Number(session.total_items || 0)
      }
    };

    res.json({
      session: normalizedSession,
      items: itemsResult.rows
    });
  } catch (err) {
    console.error("Get session error", err);
    res.status(500).json({ error: err.message || "Failed to load session" });
  }
});

/**
 * Get uploaded .gfxbackup files from disk, ordered by newest first.
 * This reflects the actual files contained in backend/backup/restore/.
 */
function listRestoreHistoryFiles() {
  if (!fs.existsSync(RESTORE_DIR)) {
    return [];
  }

  return fs.readdirSync(RESTORE_DIR)
    .filter((name) => name.toLowerCase().endsWith('.gfxbackup'))
    .map((name) => {
      const filePath = path.join(RESTORE_DIR, name);
      const stats = fs.statSync(filePath);
      const date = new Date(stats.mtime);
      const lowerName = name.toLowerCase();
      const backupType = lowerName.includes('full')
        ? 'Full'
        : lowerName.includes('incremental')
          ? 'Incremental'
          : 'Standard';

      return {
        id: name,
        backup_filename: name,
        backup_path: filePath,
        backup_type: backupType,
        uploaded_at: date.toISOString(),
        created_at: date.toISOString(),
        total_changes: 0,
        completed_changes: 0,
        status: 'completed',
        action: 'DELETE'
      };
    })
    .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
}

/**
 * GET /admin/restore/history
 * Get restore history
 */
router.get("/history", async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const result = await pool.query(
      `SELECT * FROM restore_history
       ORDER BY uploaded_at DESC
       LIMIT 50`
    );

    const dbRows = (result.rows || []).filter((row) => {
      const fileName = row.backup_filename || path.basename(row.backup_path || '');
      const filePath = row.backup_path || (fileName ? path.join(RESTORE_DIR, fileName) : null);

      if (!fileName) {
        return false;
      }

      if (!filePath || !fs.existsSync(filePath)) {
        if (row.id) {
          pool.query("DELETE FROM restore_history WHERE id = $1", [row.id]).catch((deleteErr) => {
            console.error("Cleanup orphaned restore history row error", deleteErr.message);
          });
        }
        return false;
      }

      return true;
    });

    const diskRows = listRestoreHistoryFiles();
    const seen = new Set();
    const merged = [];

    for (const row of [...dbRows, ...diskRows]) {
      const key = row.backup_filename || row.backup_path || row.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...row,
        id: row.id || row.backup_filename || row.backup_path,
        backup_filename: row.backup_filename || path.basename(row.backup_path || row.id || 'unknown.gfxbackup'),
        backup_path: row.backup_path || path.join(RESTORE_DIR, row.backup_filename || row.id || 'unknown.gfxbackup'),
        backup_type: row.backup_type || 'Standard',
        uploaded_at: row.uploaded_at || row.created_at || new Date().toISOString(),
        total_changes: Number(row.total_changes || 0),
        completed_changes: Number(row.completed_changes || 0),
        status: row.status || 'completed',
        action: 'DELETE'
      });
    }

    merged.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
    return res.json(merged);
  } catch (err) {
    console.error("Get history error", err);
    res.status(500).json({ error: err.message || "Failed to load history" });
  }
});

/**
 * POST /admin/restore/item/:id
 * Apply individual restore item with safety checkpoint and validation
 */
router.post("/item/:id", async (req, res) => {
  try {
    const { pool } = req.app.locals;
    const itemId = parseInt(req.params.id);

    // Get the item and session
    const itemResult = await pool.query(
      "SELECT * FROM restore_items WHERE id = $1",
      [itemId]
    );

    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    const item = itemResult.rows[0];

    // Get session
    const sessionResult = await pool.query(
      "SELECT * FROM restore_sessions WHERE id = $1",
      [item.session_id]
    );

    const session = sessionResult.rows[0];
    
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Step 1: Create a safety checkpoint if this is the first item in this session
    const existingCheckpointResult = await pool.query(
      "SELECT id FROM restore_checkpoints WHERE session_id = $1 AND checkpoint_type = 'pre_restore' LIMIT 1",
      [session.id]
    );

    let checkpointId = null;
    if (existingCheckpointResult.rows.length === 0) {
      // Create pre_restore checkpoint
      const checkpointResult = await pool.query(
        `INSERT INTO restore_checkpoints (
          session_id,
          checkpoint_name,
          checkpoint_type,
          config_snapshot
        ) VALUES ($1, $2, $3, $4)
        RETURNING id`,
        [
          session.id,
          `Checkpoint before restore - ${new Date().toISOString()}`,
          'pre_restore',
          JSON.stringify({
            session_id: session.id,
            backup_filename: session.backup_filename,
            timestamp: new Date().toISOString(),
            total_items: session.total_items,
            description: 'Safety checkpoint created before starting restore operations'
          })
        ]
      );
      checkpointId = checkpointResult.rows[0].id;
      console.log(`[Restore] Created checkpoint ${checkpointId} for session ${session.id}`);
    } else {
      checkpointId = existingCheckpointResult.rows[0].id;
    }

    if ((item.change_type || item.changeType || '').toString().toLowerCase() === 'conflict' || (item.status || '').toString().toLowerCase() === 'conflict') {
      const conflictDetails = {
        item_id: item.id,
        item_name: item.name,
        type: item.type,
        current_version: item.current_version,
        backup_version: item.backup_version,
        description: item.description || 'Local changes detected.',
        requires_review: true,
        resolution_required: true
      };

      await pool.query(
        `UPDATE restore_items SET
          error_message = $1,
          restore_action = $2,
          updated_at = NOW()
        WHERE id = $3`,
        [JSON.stringify(conflictDetails), JSON.stringify(conflictDetails), item.id]
      );

      return res.status(409).json({
        error: 'Conflict detected. Manual review required before restore.',
        details: conflictDetails,
        item,
        status: 'conflict'
      });
    }

    // Step 2: Validate the specific change
    const validation = validateRestoreItem(item);
    if (!validation.valid) {
      return res.status(400).json({
        error: `Validation failed: ${validation.error}`,
        item: item
      });
    }

    // Step 3: Apply the specific change based on item type
    let applyResult = null;
    let restoreAction = {
      type: item.type,
      category: item.category,
      name: item.name,
      timestamp: new Date().toISOString(),
      checkpoint_id: checkpointId
    };

    try {
      applyResult = await applyRestoreItem(item, pool, session);
      restoreAction.result = applyResult;
      restoreAction.success = true;
    } catch (applyErr) {
      console.error(`[Restore] Failed to apply item ${itemId}:`, applyErr.message);
      restoreAction.error = applyErr.message;
      restoreAction.success = false;
      
      // Update item with error and return
      await pool.query(
        `UPDATE restore_items SET 
          status = 'failed',
          error_message = $1,
          restore_action = $2,
          updated_at = NOW()
        WHERE id = $3`,
        [applyErr.message, JSON.stringify(restoreAction), itemId]
      );

      return res.status(500).json({
        error: `Failed to apply change: ${applyErr.message}`,
        item: item
      });
    }

    // Step 4: Verify the update was successful
    if (!restoreAction.success) {
      return res.status(500).json({
        error: "Update verification failed",
        item: item,
        action: restoreAction
      });
    }

    // Step 5: Mark item as completed and update session
    const updateResult = await pool.query(
      `UPDATE restore_items SET 
        status = 'completed',
        restore_action = $1,
        restore_result = $2,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
      [JSON.stringify(restoreAction), JSON.stringify(applyResult), itemId]
    );

    // Update session counts
    await pool.query(
      `UPDATE restore_sessions SET
        completed_items = completed_items + 1,
        pending_items = GREATEST(0, pending_items - 1),
        updated_at = NOW()
      WHERE id = $1`,
      [item.session_id]
    );

    console.log(`[Restore] Successfully applied item ${itemId} (${item.type}): ${item.name}`);

    res.json({
      item: updateResult.rows[0],
      checkpoint: checkpointId,
      message: `Item "${item.name}" successfully restored`
    });
  } catch (err) {
    console.error("Item restore error", err);
    res.status(500).json({ error: err.message || "Update failed" });
  }
});

/**
 * Validate a restore item before applying
 */
function validateRestoreItem(item) {
  // Basic validation
  if (!item.id) {
    return { valid: false, error: "Item ID missing" };
  }

  if (!item.type || !['feature', 'file', 'database', 'config'].includes(item.type)) {
    return { valid: false, error: "Invalid item type" };
  }

  if (!item.name) {
    return { valid: false, error: "Item name missing" };
  }

  const normalizedChangeType = String(item.change_type || item.changeType || '').toLowerCase();
  if (normalizedChangeType === 'conflict' || String(item.status || '').toLowerCase() === 'conflict') {
    return { valid: false, error: "Conflict requires manual review before restore" };
  }

  if (item.status !== 'pending') {
    return { valid: false, error: `Cannot apply non-pending item (status: ${item.status})` };
  }

  // Type-specific validation
  if (item.type === 'file' && !item.name) {
    return { valid: false, error: "File path missing" };
  }

  if (item.type === 'database' && !item.category) {
    return { valid: false, error: "Database table missing" };
  }

  return { valid: true };
}

/**
 * Apply a restore item based on its type
 */
async function applyRestoreItem(item, pool, session) {
  const timestamp = new Date().toISOString();

  if (item.type === 'feature') {
    const restoredFiles = await restoreArchiveFiles(session.backup_path, item.related_files || []);
    return {
      type: 'feature',
      action: 'restore_feature',
      feature_name: item.name,
      category: item.category,
      version: item.backup_version,
      restored_files: restoredFiles,
      timestamp,
      status: 'applied',
      notes: `Feature "${item.name}" v${item.backup_version} restoration recorded`
    };
  } else if (item.type === 'file') {
    const restoredFiles = await restoreArchiveFiles(session.backup_path, item.related_files || [item.name]);
    return {
      type: 'file',
      action: 'restore_file',
      file_path: item.name,
      backup_checksum: item.backup_checksum,
      restored_files: restoredFiles,
      timestamp,
      status: 'applied',
      notes: `File "${item.name}" restoration recorded`
    };
  } else if (item.type === 'database') {
    const restoredRecord = await restoreArchiveDatabaseRecord(session.backup_path, item, pool);
    return {
      type: 'database',
      action: 'restore_database_record',
      table: item.category,
      record_id: item.name,
      change_type: item.change_type,
      restored_record: restoredRecord,
      timestamp,
      status: 'applied',
      notes: `Database record "${item.name}" in table "${item.category}" restoration recorded`
    };
  } else if (item.type === 'config') {
    // Apply config restoration
    return {
      type: 'config',
      action: 'restore_config',
      config_name: item.name,
      timestamp,
      status: 'applied',
      notes: `Configuration "${item.name}" restoration recorded`
    };
  }

  throw new Error(`Unsupported item type: ${item.type}`);
}

function getArchiveEntryForProjectPath(zip, relativePath) {
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const candidates = [
    `application/${normalizedPath}`,
    `assets/${normalizedPath}`,
    normalizedPath
  ];
  return candidates.map((candidate) => zip.getEntry(candidate)).find(Boolean);
}

async function restoreArchiveFiles(backupPath, relatedFiles) {
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error('Backup archive is missing from the restore folder');
  }

  const zip = new AdmZip(backupPath);
  const restoredFiles = [];
  for (const fileName of relatedFiles || []) {
    const relativePath = String(fileName || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relativePath || relativePath.includes('..')) continue;
    const entry = getArchiveEntryForProjectPath(zip, relativePath);
    if (!entry || entry.isDirectory) {
      throw new Error(`Backup archive does not contain file: ${relativePath}`);
    }

    const destination = path.resolve(__dirname, '..', relativePath);
    const projectRoot = path.resolve(__dirname, '..');
    if (destination !== projectRoot && !destination.startsWith(`${projectRoot}${path.sep}`)) {
      throw new Error(`Invalid restore file path: ${relativePath}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.getData());
    restoredFiles.push(relativePath);
  }
  return restoredFiles;
}

async function restoreArchiveDatabaseRecord(backupPath, item, pool) {
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error('Backup archive is missing from the restore folder');
  }

  const zip = new AdmZip(backupPath);
  const deltaEntry = zip.getEntry('database/changes/database-delta.json')
    || zip.getEntry('database/metadata/database-summary.json');
  if (!deltaEntry) {
    throw new Error('Backup archive does not contain database delta rows');
  }

  const database = JSON.parse(zip.readAsText(deltaEntry));
  const match = String(item.name || '').match(/^(.+) #(.+)$/);
  if (!match) throw new Error(`Invalid database restore item: ${item.name}`);
  const tableName = match[1].replace(/[^a-zA-Z0-9_]/g, '');
  const recordId = match[2];
  const sections = [...(database.newRecords || []), ...(database.updatedRecords || [])];
  const section = sections.find((candidate) => candidate.tableName === tableName);
  const row = section?.rows?.find((candidate) => String(candidate.id ?? candidate.recordId ?? candidate.record_id ?? candidate.uuid ?? candidate.slug) === recordId);
  if (!row) throw new Error(`Database row not found in backup: ${item.name}`);

  const columns = Object.keys(row).filter((column) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column) && !column.startsWith('__') && !['operation', 'changedFields'].includes(column));
  const values = columns.map((column) => row[column]);
  const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const identityColumn = row.id !== undefined ? 'id' : row.uuid !== undefined ? 'uuid' : row.slug !== undefined ? 'slug' : null;
  if (!identityColumn) throw new Error(`No supported identity column for ${item.name}`);

  const updateColumns = columns.filter((column) => column !== identityColumn);
  let result;
  if (updateColumns.length > 0) {
    const assignments = updateColumns.map((column) => `"${column}" = EXCLUDED."${column}"`).join(', ');
    result = await pool.query(
      `INSERT INTO "${tableName}" (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT ("${identityColumn}") DO UPDATE SET ${assignments} RETURNING *`,
      values
    );
  } else {
    result = await pool.query(
      `INSERT INTO "${tableName}" (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT ("${identityColumn}") DO NOTHING RETURNING *`,
      values
    );
  }
  return result.rows[0] || row;
}

/**
 * POST /admin/restore/all
 * Apply all safe items
 */
router.post("/all", async (req, res) => {
  try {
    const { pool } = req.app.locals;

    const sessionResult = await pool.query(
      `SELECT * FROM restore_sessions
       WHERE status IN ('analyzed', 'in_progress')
       ORDER BY created_at DESC
       LIMIT 1`
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: "No active session" });
    }

    const session = sessionResult.rows[0];

    const existingCheckpointResult = await pool.query(
      "SELECT id FROM restore_checkpoints WHERE session_id = $1 AND checkpoint_type = 'pre_restore' LIMIT 1",
      [session.id]
    );

    let checkpointId = null;
    if (existingCheckpointResult.rows.length === 0) {
      const checkpointResult = await pool.query(
        `INSERT INTO restore_checkpoints (
          session_id,
          checkpoint_name,
          checkpoint_type,
          config_snapshot
        ) VALUES ($1, $2, $3, $4)
        RETURNING id`,
        [
          session.id,
          `Checkpoint before restore - ${new Date().toISOString()}`,
          'pre_restore',
          JSON.stringify({
            session_id: session.id,
            backup_filename: session.backup_filename,
            timestamp: new Date().toISOString(),
            total_items: session.total_items,
            description: 'Safety checkpoint created before starting restore operations'
          })
        ]
      );

      const createdCheckpointRow = checkpointResult?.rows?.[0];
      if (createdCheckpointRow?.id) {
        checkpointId = createdCheckpointRow.id;
        console.log(`[Restore] Created checkpoint ${checkpointId} for session ${session.id}`);
      } else {
        const fallbackResult = await pool.query(
          "SELECT id FROM restore_checkpoints WHERE session_id = $1 AND checkpoint_type = 'pre_restore' ORDER BY created_at DESC LIMIT 1",
          [session.id]
        );
        checkpointId = fallbackResult?.rows?.[0]?.id || null;
      }
    } else {
      checkpointId = existingCheckpointResult.rows[0].id;
    }

    const pendingItemsResult = await pool.query(
      `SELECT * FROM restore_items
       WHERE session_id = $1
         AND status = 'pending'
         AND COALESCE(change_type, '') <> 'conflict'
         AND COALESCE(change_type, '') IN ('new', 'update')
       ORDER BY item_order ASC`,
      [session.id]
    );

    for (const item of pendingItemsResult.rows || []) {
      const validation = validateRestoreItem(item);
      if (!validation.valid) {
        return res.status(400).json({ error: `Validation failed: ${validation.error}`, item });
      }
      await applyRestoreItem(item, pool, session);
    }

    const updateResult = await pool.query(
      `UPDATE restore_items
       SET status = 'completed',
           updated_at = NOW()
       WHERE session_id = $1
         AND status = 'pending'
         AND COALESCE(change_type, '') <> 'conflict'
         AND COALESCE(change_type, '') IN ('new', 'update')
       RETURNING *`,
      [session.id]
    );

    const updatedCount = updateResult.rows.length;

    const summaryResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(change_type, '')) = 'conflict') AS conflict_count
       FROM restore_items
       WHERE session_id = $1`,
      [session.id]
    );

    const summary = summaryResult.rows[0] || {};

    await pool.query(
      `UPDATE restore_sessions SET
        completed_items = $1,
        pending_items = $2,
        updated_at = NOW()
      WHERE id = $3`,
      [
        Number(summary.completed_count || 0),
        Number(summary.pending_count || 0),
        session.id
      ]
    );

    res.json({
      updated: updatedCount,
      checkpoint: checkpointId,
      pending_count: Number(summary.pending_count || 0),
      completed_count: Number(summary.completed_count || 0),
      conflict_count: Number(summary.conflict_count || 0),
      message: updatedCount > 0 ? `Updated ${updatedCount} safe items` : `No safe items to update`
    });
  } catch (err) {
    console.error("Batch update error", err);
    res.status(500).json({ error: err.message || "Batch update failed" });
  }
});

/**
 * POST /admin/restore/clear
 * Clear current restore session
 */
router.post("/clear", async (req, res) => {
  try {
    const { pool } = req.app.locals;

    // Clear only the active comparison/session state.
    // Historical backup archives remain on disk and in Restore History unless explicitly deleted.
    await pool.query(
      `UPDATE restore_sessions SET
        status = 'completed',
        updated_at = NOW(),
        comparison_result = JSONB_BUILD_OBJECT(
          'status', 'cleared',
          'cleared_at', NOW(),
          'message', 'Current restore comparison cleared. Historical backup remains available.'
        )
       WHERE status IN ('analyzed', 'in_progress')`
    );

    res.json({ message: "Session cleared" });
  } catch (err) {
    console.error("Clear session error", err);
    res.status(500).json({ error: err.message || "Clear failed" });
  }
});

/**
 * DELETE /admin/restore/file/:id
 * Delete restore history file
 */
router.delete("/file/:id", async (req, res) => {
  try {
    const { pool, JWT_SECRET } = req.app.locals;
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET || "secretkey");
    } catch (err) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const userResult = await pool.query(
      "SELECT role, status FROM users WHERE id = $1",
      [decoded.user]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userResult.rows[0];
    if (user.role !== "admin" || user.status === "inactive" || user.status === "disabled") {
      return res.status(403).json({ error: "Admin access only" });
    }

    const historyIdParam = req.params.id;
    const directFileName = decodeURIComponent(historyIdParam);
    const historyId = /^\d+$/.test(String(historyIdParam).trim())
      ? Number.parseInt(historyIdParam, 10)
      : Number.NaN;

    let deletedPath = null;
    let deletedRowId = null;

    if (!Number.isNaN(historyId)) {
      const historyResult = await pool.query(
        "SELECT * FROM restore_history WHERE id = $1",
        [historyId]
      );

      if (historyResult.rows.length > 0) {
        const history = historyResult.rows[0];
        deletedRowId = history.id;
        deletedPath = history.backup_path;

        if (deletedPath && fs.existsSync(deletedPath)) {
          fs.unlinkSync(deletedPath);
          deletedPath = deletedPath;
        }

        await pool.query(
          "DELETE FROM restore_history WHERE id = $1",
          [historyId]
        );
      }
    }

    if (!deletedRowId) {
      const directHistoryResult = await pool.query(
        "SELECT * FROM restore_history WHERE backup_filename = $1",
        [directFileName]
      );

      if (directHistoryResult.rows.length > 0) {
        const history = directHistoryResult.rows[0];
        deletedRowId = history.id;
        deletedPath = history.backup_path || path.join(RESTORE_DIR, history.backup_filename || directFileName);

        if (deletedPath && fs.existsSync(deletedPath)) {
          fs.unlinkSync(deletedPath);
        }

        await pool.query(
          "DELETE FROM restore_history WHERE backup_filename = $1",
          [directFileName]
        );
      }
    }

    const directFilePath = path.join(RESTORE_DIR, directFileName);
    if (fs.existsSync(directFilePath)) {
      fs.unlinkSync(directFilePath);
      deletedPath = directFilePath;
    }

    if (!deletedRowId && !deletedPath) {
      return res.status(404).json({ error: "File not found" });
    }

    if (deletedRowId) {
      await pool.query(
        "DELETE FROM restore_history WHERE id = $1",
        [deletedRowId]
      ).catch(() => {});
    }

    res.json({ message: "File deleted" });
  } catch (err) {
    console.error("Delete file error", err);
    res.status(500).json({ error: err.message || "Delete failed" });
  }
});

/**
 * Helper function: Analyze backup and generate comparison items
 * Compares backup against current system state
 */
async function analyzeBackup(backupData, pool) {
  const items = [];
  let itemOrder = 0;
  let totalBackupItems = 0;
  let unchangedCount = 0;

  try {
    // Helper: Check if versions are semantically different
    const isVersionDifferent = (current, backup) => {
      if (!current || !backup) return true;
      const normalize = (v) => String(v).toLowerCase().trim();
      return normalize(current) !== normalize(backup);
    };

    // Analyze features from backup manifest
    if (backupData.manifest && backupData.manifest.features && Array.isArray(backupData.manifest.features)) {
      for (const feature of backupData.manifest.features) {
        totalBackupItems++;
        
        // Try to find existing feature in database
        let currentVersion = null;
        try {
          const featureQuery = await pool.query(
            "SELECT version FROM features WHERE name = $1 LIMIT 1",
            [feature.name]
          );
          currentVersion = featureQuery.rows[0]?.version || null;
        } catch (err) {
          // features table might not exist
        }

        const backupVersion = feature.version || "1.0.0";
        const isNew = !currentVersion;
        const isChanged = currentVersion && isVersionDifferent(currentVersion, backupVersion);

        // Only include if new or changed
        if (isNew || isChanged) {
          items.push({
            type: "feature",
            category: feature.category || "general",
            name: feature.name || "Unknown Feature",
            description: feature.description || "",
            currentVersion: currentVersion || "not installed",
            backupVersion: backupVersion,
            changeType: isNew ? "new" : "update",
            relatedFiles: Array.isArray(feature.files) ? feature.files : [],
            itemOrder: itemOrder++
          });
        } else {
          unchangedCount++;
        }
      }
    }

    // Analyze files from backup using the manifest's file inventory, comparing the
    // normalized backup path to the live project file checksum. This keeps the
    // restore list limited to actionable files only.
    const normalizeBackupRelativePath = (value) => {
      if (!value || typeof value !== 'string') return '';
      return value.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^application\//, '').replace(/^assets\//, '').replace(/^database\//, '').replace(/^metadata\//, '');
    };

    const computeFileChecksum = (absolutePath) => {
      try {
        if (!absolutePath || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
          return null;
        }
        const fileBuffer = fs.readFileSync(absolutePath);
        return crypto.createHash('sha256').update(fileBuffer).digest('hex');
      } catch (err) {
        return null;
      }
    };

    const inferFeatureKey = (relativePath) => {
      const normalized = normalizeBackupRelativePath(relativePath || '');
      if (!normalized) return null;

      const fileName = normalized.split('/').pop() || normalized;
      const stem = fileName.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
      const spaced = stem.replace(/([a-z])([A-Z])/g, '$1 $2');
      const words = spaced.split(/\s+/).filter(Boolean);

      if (!words.length) return null;

      const stripped = words
        .filter((word) => !['routes', 'route', 'controller', 'controllers', 'page', 'pages', 'view', 'views', 'style', 'styles', 'css', 'js', 'jsx', 'ts', 'tsx', 'config', 'helper', 'helpers', 'service', 'services'].includes(word.toLowerCase()))
        .map((word) => word.replace(/[^a-zA-Z0-9]/g, ''))
        .filter(Boolean);

      if (!stripped.length) return null;

      const base = stripped.join(' ').toLowerCase();
      const normalizedBase = base.replace(/s$/, '');
      if (normalizedBase.length < 3) return null;
      return normalizedBase;
    };

    const featureTitleMap = {
      dailyreport: 'Daily Reports',
      dailyreports: 'Daily Reports',
      'daily report': 'Daily Reports',
      'daily reports': 'Daily Reports',
      report: 'Reports',
      reports: 'Reports',
      order: 'Orders',
      orders: 'Orders',
      product: 'Products',
      products: 'Products',
      user: 'Users',
      users: 'Users',
      payment: 'Payments',
      payments: 'Payments',
      setting: 'Settings',
      settings: 'Settings',
      dashboard: 'Dashboard',
      notification: 'Notifications',
      notifications: 'Notifications',
      email: 'Emails',
      emails: 'Emails',
      analytics: 'Analytics',
      analytic: 'Analytics'
    };

    const inferFeatureName = (relativePath) => {
      const key = inferFeatureKey(relativePath);
      if (!key) return null;
      const directMatch = featureTitleMap[key] || featureTitleMap[key.replace(/s$/, '')] || featureTitleMap[key.trim()];
      if (directMatch) return directMatch;

      const words = key.split(/\s+/).filter(Boolean);
      if (!words.length) return null;
      return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    };

    const fileInventory = [];
    const rawInventory = Array.isArray(backupData.fileInventory) ? backupData.fileInventory : [];
    const rawFiles = Array.isArray(backupData.files) ? backupData.files : [];

    for (const file of rawInventory) {
      if (file && (file.path || file.relativePath || file.name)) {
        fileInventory.push(file);
      }
    }
    for (const file of rawFiles) {
      if (file && (file.path || file.relativePath || file.name)) {
        const seen = fileInventory.some((entry) => {
          const left = String(entry.path || entry.relativePath || entry.name || '');
          const right = String(file.path || file.relativePath || file.name || '');
          return left === right;
        });
        if (!seen) fileInventory.push(file);
      }
    }

    const actionableFiles = [];
    for (const file of fileInventory) {
      const rawFilePath = file.path || file.relativePath || file.name || 'unknown';
      const relativeProjectPath = normalizeBackupRelativePath(rawFilePath);
      if (!relativeProjectPath || relativeProjectPath === 'unknown') continue;

      totalBackupItems++;

      const projectRoot = backupData.projectRoot || path.resolve(__dirname, '..');
      const liveFilePath = path.resolve(projectRoot, relativeProjectPath);
      const currentChecksum = computeFileChecksum(liveFilePath);
      const backupChecksum = file.checksum || file.sha256 || file.hash || null;
      const isSameFile = Boolean(currentChecksum && backupChecksum && currentChecksum === backupChecksum);

      if (isSameFile) {
        unchangedCount++;
        continue;
      }

      actionableFiles.push({
        type: 'file',
        category: 'code',
        name: relativeProjectPath,
        description: `File: ${relativeProjectPath}`,
        currentVersion: currentChecksum ? `checksum: ${currentChecksum.substring(0, 8)}...` : 'not found',
        backupVersion: backupChecksum ? `checksum: ${backupChecksum.substring(0, 8)}...` : 'backup',
        changeType: currentChecksum ? 'update' : 'new',
        relatedFiles: [relativeProjectPath],
        itemOrder: itemOrder++
      });
    }

    const featureGroups = new Map();
    const standaloneFiles = [];

    for (const fileItem of actionableFiles) {
      const featureKey = inferFeatureKey(fileItem.name);
      if (featureKey) {
        const relatedGroup = featureGroups.get(featureKey) || [];
        relatedGroup.push(fileItem);
        featureGroups.set(featureKey, relatedGroup);
      } else {
        standaloneFiles.push(fileItem);
      }
    }

    for (const [featureKey, groupedFiles] of featureGroups.entries()) {
      if (groupedFiles.length < 2) {
        standaloneFiles.push(...groupedFiles);
        continue;
      }

      const featureName = inferFeatureName(groupedFiles[0].name) || 'Feature Update';
      const featureChangeType = groupedFiles.some((file) => file.changeType === 'new') && groupedFiles.some((file) => file.changeType === 'update')
        ? 'update'
        : groupedFiles.some((file) => file.changeType === 'new') ? 'new' : 'update';

      items.push({
        type: 'feature',
        category: 'code',
        name: featureName,
        description: `Feature: ${featureName} • ${groupedFiles.length} files affected`,
        currentVersion: `${groupedFiles.length} files affected`,
        backupVersion: `${groupedFiles.length} files affected`,
        changeType: featureChangeType,
        relatedFiles: groupedFiles.flatMap((file) => file.relatedFiles || []),
        itemOrder: itemOrder++
      });
    }

    for (const fileItem of standaloneFiles) {
      items.push(fileItem);
    }

    // Analyze database changes from backup using merge-safe semantics:
    // INSERT new records, UPDATE changed records, KEEP destination-only records,
    // and DETECT conflicts without deleting existing rows.
    const databaseSections = [];
    const explicitConflicts = Array.isArray(backupData.database?.conflicts) ? backupData.database.conflicts : [];

    if (backupData.database && Array.isArray(backupData.database.newRecords)) {
      databaseSections.push(...backupData.database.newRecords.map((entry) => ({ kind: 'new', table: entry.tableName || entry.table || 'unknown', rows: Array.isArray(entry.rows) ? entry.rows : [] })));
    }
    if (backupData.database && Array.isArray(backupData.database.updatedRecords)) {
      databaseSections.push(...backupData.database.updatedRecords.map((entry) => ({ kind: 'update', table: entry.tableName || entry.table || 'unknown', rows: Array.isArray(entry.rows) ? entry.rows : [] })));
    }
    if (backupData.database && Array.isArray(backupData.database.changes)) {
      databaseSections.push(...backupData.database.changes.map((change) => ({
        kind: (change.operation || 'update').toString().toLowerCase(),
        table: change.table || change.tableName || 'unknown',
        rows: change.data ? [change.data] : (Array.isArray(change.rows) ? change.rows : [])
      })));
    }

    for (const section of databaseSections) {
      const table = section.table || 'unknown';
      const rows = Array.isArray(section.rows) ? section.rows : [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') {
          continue;
        }

        totalBackupItems++;

        const recordId = row.id ?? row.recordId ?? row.record_id ?? row.uuid ?? row.slug ?? row.name ?? '?';
        const identityValue = row.id ?? row.recordId ?? row.record_id ?? row.uuid ?? row.slug ?? null;

        let currentRecord = null;
        let conflictDetected = false;

        try {
          const tableName = String(table).replace(/[^a-zA-Z0-9_]/g, '');
          if (identityValue !== null && identityValue !== undefined && identityValue !== '?') {
            const lookupSql = `SELECT * FROM "${tableName}" WHERE id = $1 LIMIT 1`;
            const lookupResult = await pool.query(lookupSql, [identityValue]);
            currentRecord = lookupResult.rows?.[0] || null;
          }
        } catch (err) {
          currentRecord = null;
        }

        if (currentRecord && row && Object.keys(row).length > 0) {
          const rowKey = `${table}#${recordId}`;
          const explicitConflict = explicitConflicts.some((conflict) => {
            const conflictKey = `${conflict.table || conflict.tableName || ''}#${conflict.recordId ?? conflict.id ?? conflict.record_id ?? ''}`;
            return conflictKey === rowKey || String(conflict.recordId ?? conflict.id ?? conflict.record_id ?? '') === String(recordId);
          });
          conflictDetected = explicitConflict && section.kind !== 'new';
        }

        const hasExistingRecord = Boolean(currentRecord);
        const isSameRecord = hasExistingRecord && row && currentRecord && JSON.stringify(currentRecord) === JSON.stringify(row);

        if (isSameRecord) {
          unchangedCount++;
          continue;
        }

        const isNewRecord = section.kind === 'new' || (!hasExistingRecord && section.kind !== 'delete');
        const isUpdateRecord = section.kind === 'update' || (hasExistingRecord && section.kind !== 'delete');
        const changeType = conflictDetected ? 'conflict' : isNewRecord ? 'new' : 'update';

        items.push({
          type: 'database',
          category: table,
          name: `${table} #${recordId}`,
          description: `Database ${changeType} in ${table}`,
          currentVersion: hasExistingRecord ? 'exists' : 'not found',
          backupVersion: 'in backup',
          changeType,
          relatedFiles: [],
          itemOrder: itemOrder++
        });
      }
    }

    // Log summary
    console.log(`[Restore Analysis] Total items: ${totalBackupItems}, Unchanged: ${unchangedCount}, Actionable: ${items.length}`);

  } catch (err) {
    console.error("Error analyzing backup:", err.message);
  }

  // Return empty array if no actionable items
  // (User will see "No changes detected in this backup")
  return items;
}

router.analyzeBackup = analyzeBackup;
module.exports = router;
