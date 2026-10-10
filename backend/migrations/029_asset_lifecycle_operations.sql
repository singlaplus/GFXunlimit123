CREATE TABLE IF NOT EXISTS asset_lifecycle_operations (
  id BIGSERIAL PRIMARY KEY,
  asset_id BIGINT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('move', 'delete')),
  state TEXT NOT NULL CHECK (state IN ('prepared', 'db_committed', 'recovery_required', 'completed', 'aborted')),
  old_filename TEXT NOT NULL,
  new_filename TEXT,
  content_sha256 TEXT,
  temporary_device TEXT,
  temporary_inode TEXT,
  thumbnail_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE asset_lifecycle_operations
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT;

ALTER TABLE asset_lifecycle_operations
  ADD COLUMN IF NOT EXISTS temporary_device TEXT,
  ADD COLUMN IF NOT EXISTS temporary_inode TEXT;

CREATE INDEX IF NOT EXISTS asset_lifecycle_operations_pending_idx
  ON asset_lifecycle_operations (id)
  WHERE state IN ('prepared', 'db_committed', 'recovery_required');
