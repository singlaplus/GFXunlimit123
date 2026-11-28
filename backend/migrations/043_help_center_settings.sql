CREATE TABLE IF NOT EXISTS help_center_settings (
  id TEXT PRIMARY KEY,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT help_center_settings_singleton CHECK (id = 'default')
);
