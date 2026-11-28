CREATE TABLE IF NOT EXISTS cookie_policy_settings (
  id TEXT PRIMARY KEY,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cookie_policy_settings_singleton CHECK (id = 'default')
);
