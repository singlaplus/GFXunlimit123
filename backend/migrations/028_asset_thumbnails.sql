-- The legacy asset_thumbnails table is retained; new WebP metadata is isolated here.
CREATE TABLE IF NOT EXISTS asset_thumbnail_metadata (
  asset_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
  thumbnail_path TEXT NOT NULL,
  format VARCHAR(16) NOT NULL DEFAULT 'webp',
  width INTEGER,
  height INTEGER,
  file_size BIGINT,
  quality INTEGER,
  generated_at TIMESTAMPTZ,
  source_size BIGINT,
  source_modified_at TIMESTAMPTZ,
  processor VARCHAR(64),
  processor_version VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT asset_thumbnail_metadata_status_check
    CHECK (status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_asset_thumbnail_metadata_status
  ON asset_thumbnail_metadata(status);

CREATE TABLE IF NOT EXISTS asset_thumbnail_orphans (
  id BIGSERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL,
  thumbnail_path TEXT NOT NULL,
  error_message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE (asset_id, thumbnail_path)
);

CREATE INDEX IF NOT EXISTS idx_asset_thumbnail_orphans_created_at
  ON asset_thumbnail_orphans(created_at);
