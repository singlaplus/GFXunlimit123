ALTER TABLE tax_mail_settings
  ADD COLUMN IF NOT EXISTS smtp_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
