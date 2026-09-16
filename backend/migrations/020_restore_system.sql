-- Restore System Schema
-- Supports backup file management, restore sessions, and comparison tracking

-- Restore sessions - track active restore operations
CREATE TABLE IF NOT EXISTS restore_sessions (
  id SERIAL PRIMARY KEY,
  session_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  admin_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  backup_filename TEXT NOT NULL,
  backup_id TEXT,
  backup_path TEXT NOT NULL,
  backup_type TEXT DEFAULT 'incremental', -- 'incremental', 'complete'
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  source_device TEXT,
  
  -- Comparison state
  comparison_result JSONB,
  total_items INTEGER DEFAULT 0,
  new_items INTEGER DEFAULT 0,
  updated_items INTEGER DEFAULT 0,
  unchanged_items INTEGER DEFAULT 0,
  conflict_items INTEGER DEFAULT 0,
  
  -- Progress tracking
  completed_items INTEGER DEFAULT 0,
  pending_items INTEGER DEFAULT 0,
  
  status TEXT DEFAULT 'pending', -- 'pending', 'analyzed', 'in_progress', 'completed', 'failed'
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX idx_restore_sessions_admin ON restore_sessions(admin_user_id);
CREATE INDEX idx_restore_sessions_status ON restore_sessions(status);

-- Restore items - individual changes within a restore session
CREATE TABLE IF NOT EXISTS restore_items (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES restore_sessions(id) ON DELETE CASCADE,
  
  item_order INTEGER DEFAULT 0,
  type TEXT NOT NULL, -- 'feature', 'file', 'database', 'config'
  category TEXT, -- e.g. 'daily-reports', 'messaging', 'admin-controls'
  name TEXT NOT NULL,
  description TEXT,
  
  -- Comparison data
  current_version TEXT,
  backup_version TEXT,
  current_checksum TEXT,
  backup_checksum TEXT,
  
  change_type TEXT DEFAULT 'update', -- 'new', 'update', 'delete', 'conflict'
  status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'skipped', 'failed'
  
  -- Related files/records
  related_files JSONB DEFAULT '[]'::jsonb,
  related_records JSONB DEFAULT '[]'::jsonb,
  
  -- Restore data
  restore_action JSONB,
  restore_result JSONB,
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_restore_items_session ON restore_items(session_id);
CREATE INDEX idx_restore_items_status ON restore_items(status);

-- Restore history - completed and archived restore operations
CREATE TABLE IF NOT EXISTS restore_history (
  id SERIAL PRIMARY KEY,
  history_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  admin_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  
  backup_filename TEXT NOT NULL,
  backup_path TEXT NOT NULL,
  backup_size INTEGER,
  backup_type TEXT,
  
  uploaded_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  
  total_changes INTEGER DEFAULT 0,
  completed_changes INTEGER DEFAULT 0,
  failed_changes INTEGER DEFAULT 0,
  
  status TEXT DEFAULT 'available', -- 'available', 'partial', 'completed', 'failed', 'archived'
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_restore_history_admin ON restore_history(admin_user_id);
CREATE INDEX idx_restore_history_status ON restore_history(status);

-- Restore checkpoints - safety snapshots before restore operations
CREATE TABLE IF NOT EXISTS restore_checkpoints (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES restore_sessions(id) ON DELETE SET NULL,
  
  checkpoint_name TEXT NOT NULL,
  checkpoint_type TEXT DEFAULT 'pre_restore', -- 'pre_restore', 'pre_item', 'post_item'
  
  -- Checkpoint data
  database_dump_path TEXT,
  files_backup_path TEXT,
  config_snapshot JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_restore_checkpoints_session ON restore_checkpoints(session_id);

-- Ensure restore directory structure
-- (This is a schema, actual filesystem setup happens in backend startup)
