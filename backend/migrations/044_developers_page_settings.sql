CREATE TABLE IF NOT EXISTS developers_page_settings (
  id TEXT PRIMARY KEY,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT developers_page_settings_singleton CHECK (id = 'default')
);
