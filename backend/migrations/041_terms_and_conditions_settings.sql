CREATE TABLE IF NOT EXISTS terms_and_conditions_settings (
  id TEXT PRIMARY KEY,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT terms_and_conditions_settings_singleton CHECK (id = 'default')
);
