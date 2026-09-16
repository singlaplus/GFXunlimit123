CREATE TABLE IF NOT EXISTS contributor_tax_forms (
  contributor_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  form_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contributor_tax_forms_status_idx
  ON contributor_tax_forms(status);
