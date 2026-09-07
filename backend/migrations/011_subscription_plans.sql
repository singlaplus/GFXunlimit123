CREATE TABLE IF NOT EXISTS subscription_plans (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  short_description TEXT,
  icon TEXT,
  badge TEXT,
  color TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  recommended BOOLEAN NOT NULL DEFAULT FALSE,
  pricing JSONB NOT NULL DEFAULT '{}'::jsonb,
  download_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  licenses JSONB NOT NULL DEFAULT '[]'::jsonb,
  asset_access JSONB NOT NULL DEFAULT '[]'::jsonb,
  member_benefits JSONB NOT NULL DEFAULT '{}'::jsonb,
  limitations JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_plans_display_order_idx
  ON subscription_plans (display_order, id);
