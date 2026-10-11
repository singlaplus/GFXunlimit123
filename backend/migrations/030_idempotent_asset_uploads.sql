ALTER TABLE images
  ADD COLUMN IF NOT EXISTS upload_request_id UUID,
  ADD COLUMN IF NOT EXISTS upload_content_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS upload_request_hash TEXT,
  ADD COLUMN IF NOT EXISTS upload_file_device TEXT,
  ADD COLUMN IF NOT EXISTS upload_file_inode TEXT,
  ADD COLUMN IF NOT EXISTS upload_target_status TEXT,
  ADD COLUMN IF NOT EXISTS upload_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS images_upload_request_owner_uidx
  ON images (uploaded_by, upload_request_id)
  WHERE upload_request_id IS NOT NULL;
