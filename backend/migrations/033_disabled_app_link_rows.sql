CREATE TABLE IF NOT EXISTS admin_disabled_app_link_rows (
  source_path TEXT NOT NULL,
  href TEXT NOT NULL,
  link_text TEXT NOT NULL,
  disabled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  disabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_path, href, link_text)
);
