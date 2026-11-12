CREATE TABLE IF NOT EXISTS google_search_console_connections (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  encrypted_tokens TEXT NOT NULL,
  account_email TEXT,
  connected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
