CREATE TABLE IF NOT EXISTS contributor_commission_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  percentage NUMERIC NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
