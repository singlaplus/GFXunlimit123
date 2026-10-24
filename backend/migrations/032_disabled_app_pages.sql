CREATE TABLE IF NOT EXISTS admin_disabled_app_pages (
  path TEXT PRIMARY KEY,
  disabled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  disabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
