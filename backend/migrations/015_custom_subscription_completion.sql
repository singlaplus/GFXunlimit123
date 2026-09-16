ALTER TABLE custom_subscriptions
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
