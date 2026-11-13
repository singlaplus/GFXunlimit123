CREATE TABLE IF NOT EXISTS google_analytics_connections (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  encrypted_tokens TEXT NOT NULL,
  account_email TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
