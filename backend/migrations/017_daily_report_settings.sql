ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_report_settings JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_daily_report_settings ON users(id) 
WHERE daily_report_settings IS NOT NULL;
