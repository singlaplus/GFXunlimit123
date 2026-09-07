ALTER TABLE downloads
  ADD COLUMN IF NOT EXISTS subscription_id BIGINT REFERENCES custom_subscriptions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS downloads_subscription_id_idx
  ON downloads (subscription_id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS subscription_id BIGINT REFERENCES custom_subscriptions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_subscription_id_idx
  ON orders (subscription_id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS admin_remarks TEXT;
