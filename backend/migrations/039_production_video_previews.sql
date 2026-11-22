ALTER TABLE asset_thumbnail_metadata
  ADD COLUMN IF NOT EXISTS video_preview_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
