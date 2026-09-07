CREATE TABLE IF NOT EXISTS custom_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_email TEXT,
  base_plan TEXT,
  custom_duration TEXT,
  custom_start_date DATE,
  custom_end_date DATE,
  custom_pricing JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  admin_notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  activity_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_subscriptions_customer_id_idx
  ON custom_subscriptions (customer_id);
