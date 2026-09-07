-- Thumbnail System Database Schema
-- Created for automatic AI, EPS, and PSD thumbnail extraction

-- Add thumbnail columns to images table
ALTER TABLE images
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
ADD COLUMN IF NOT EXISTS thumbnail_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS thumbnail_generated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS thumbnail_error TEXT;

-- Asset processing jobs table
CREATE TABLE IF NOT EXISTS asset_processing_jobs (
  id SERIAL PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  contributor_id INTEGER NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  processor VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'QUEUED',
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  error_stage VARCHAR(100),
  error_suggestion TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_asset_id ON asset_processing_jobs(asset_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON asset_processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_contributor_id ON asset_processing_jobs(contributor_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created_at ON asset_processing_jobs(created_at DESC);

-- Processor configuration table
CREATE TABLE IF NOT EXISTS processor_config (
  id SERIAL PRIMARY KEY,
  processor_name VARCHAR(50) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'NOT_AVAILABLE',
  executable_path TEXT,
  version TEXT,
  is_enabled BOOLEAN DEFAULT FALSE,
  last_tested_at TIMESTAMPTZ,
  test_result TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial processor configurations
INSERT INTO processor_config (processor_name, status, is_enabled)
VALUES 
  ('ghostscript', 'NOT_AVAILABLE', FALSE),
  ('imagemagick', 'NOT_AVAILABLE', FALSE),
  ('sharp', 'READY', TRUE),
  ('psd_processor', 'NOT_AVAILABLE', FALSE),
  ('ai_processor', 'READY', TRUE),
  ('illustrator_worker', 'NOT_AVAILABLE', FALSE),
  ('photoshop_worker', 'NOT_AVAILABLE', FALSE)
ON CONFLICT (processor_name) DO NOTHING;

-- Processing error logs table
CREATE TABLE IF NOT EXISTS processing_error_logs (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES asset_processing_jobs(id) ON DELETE SET NULL,
  asset_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
  processor VARCHAR(50),
  error_type VARCHAR(100),
  error_message TEXT,
  error_stack TEXT,
  stage VARCHAR(100),
  file_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_job_id ON processing_error_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON processing_error_logs(created_at DESC);

-- Processor health check table (for monitoring)
CREATE TABLE IF NOT EXISTS processor_health_checks (
  id SERIAL PRIMARY KEY,
  processor_name VARCHAR(50) NOT NULL,
  check_status VARCHAR(50),
  response_time_ms INTEGER,
  message TEXT,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_checks_processor ON processor_health_checks(processor_name, checked_at DESC);
