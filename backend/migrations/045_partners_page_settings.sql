CREATE TABLE IF NOT EXISTS partners_page_settings (
  id TEXT PRIMARY KEY,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partners_page_settings_singleton CHECK (id = 'default')
);
