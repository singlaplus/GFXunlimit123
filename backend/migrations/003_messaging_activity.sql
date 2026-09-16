CREATE TABLE IF NOT EXISTS message_conversations (
  id BIGSERIAL PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'OPEN',
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  related_order_id BIGINT,
  related_asset_id BIGINT,
  related_payment_id BIGINT,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_types (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO message_types(code, label, category) VALUES
  ('DIRECT_MESSAGE', 'Direct message', 'communication'),
  ('SYSTEM_NOTIFICATION', 'System notification', 'system'),
  ('ORDER_NOTIFICATION', 'Order notification', 'commerce'),
  ('PAYMENT_NOTIFICATION', 'Payment notification', 'commerce'),
  ('DOWNLOAD_NOTIFICATION', 'Download notification', 'commerce'),
  ('ASSET_NOTIFICATION', 'Asset notification', 'asset'),
  ('CONTRIBUTOR_NOTIFICATION', 'Contributor notification', 'contributor'),
  ('ACCOUNT_NOTIFICATION', 'Account notification', 'account'),
  ('SECURITY_NOTIFICATION', 'Security notification', 'security'),
  ('SUBSCRIPTION_NOTIFICATION', 'Subscription notification', 'subscription'),
  ('COUPON_NOTIFICATION', 'Coupon notification', 'promotion'),
  ('PROMOTION', 'Promotion', 'promotion'),
  ('ANNOUNCEMENT', 'Announcement', 'communication'),
  ('ADMIN_MESSAGE', 'Admin message', 'communication'),
  ('SUPPORT_MESSAGE', 'Support message', 'support')
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_rules(event_key, enable_internal, enable_email, enable_dashboard)
SELECT code,
  CASE WHEN code IN ('ASSET_VIEWED', 'ASSET_DOWNLOADED', 'USER_LOGIN', 'USER_LOGOUT') THEN FALSE ELSE TRUE END,
  CASE WHEN code IN ('ORDER_COMPLETED', 'ASSET_APPROVED', 'PASSWORD_CHANGED') THEN TRUE ELSE FALSE END,
  TRUE
FROM message_types
ON CONFLICT (event_key) DO NOTHING;

ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS recipient_roles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE notification_rules SET recipient_roles = CASE
  WHEN event_key IN ('ASSET_UPLOADED', 'ORDER_CREATED', 'ORDER_COMPLETED', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED') THEN ARRAY['CUSTOMER', 'CONTRIBUTOR', 'ADMIN']::TEXT[]
  WHEN event_key IN ('ASSET_APPROVED', 'ASSET_REJECTED', 'EARNING_CREATED', 'PAYOUT_REQUESTED') THEN ARRAY['CONTRIBUTOR']::TEXT[]
  ELSE ARRAY[]::TEXT[]
END
WHERE COALESCE(array_length(recipient_roles, 1), 0) = 0;

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES message_conversations(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL DEFAULT 'DIRECT_MESSAGE',
  body TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  related_order_id BIGINT,
  related_asset_id BIGINT,
  related_payment_id BIGINT,
  reference_id TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_role TEXT,
  ip_address INET,
  asset_id BIGINT,
  order_id BIGINT,
  payment_id BIGINT,
  subscription_id BIGINT,
  coupon_id BIGINT,
  description TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS enable_internal BOOLEAN DEFAULT TRUE;
ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'SYSTEM_NOTIFICATION';
ALTER TABLE notification_rules ADD COLUMN IF NOT EXISTS template_id INTEGER;

CREATE TABLE IF NOT EXISTS message_broadcasts (
  id BIGSERIAL PRIMARY KEY,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'everyone',
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  send_internal BOOLEAN NOT NULL DEFAULT TRUE,
  send_email BOOLEAN NOT NULL DEFAULT FALSE,
  scheduled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_recipient_created_idx ON messages(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS messages_unread_idx ON messages(recipient_id, read_at) WHERE read_at IS NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS related_order_id BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS related_asset_id BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS related_payment_id BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reference_id TEXT;
CREATE INDEX IF NOT EXISTS activity_events_user_created_idx ON activity_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_type_created_idx ON activity_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_related_idx ON activity_events(asset_id, order_id, payment_id);

INSERT INTO activity_events(event_type, user_id, user_role, asset_id, order_id, description, metadata, created_at)
SELECT 'ASSET_DOWNLOADED', d.user_id, COALESCE(u.role, 'customer'), d.image_id, entitlement.order_id,
  'Asset downloaded: ' || COALESCE(i.title, 'Asset #' || d.image_id::text),
  jsonb_build_object('source', 'downloads', 'downloadId', d.id, 'backfilled', true),
  d.downloaded_at
FROM downloads d
LEFT JOIN users u ON u.id = d.user_id
LEFT JOIN images i ON i.id = d.image_id
LEFT JOIN LATERAL (
  SELECT cd.order_id
  FROM customer_downloads cd
  WHERE cd.user_id = d.user_id AND cd.image_id = d.image_id
  ORDER BY cd.created_at DESC
  LIMIT 1
) entitlement ON TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM activity_events existing
  WHERE existing.event_type = 'ASSET_DOWNLOADED'
    AND existing.metadata->>'source' = 'downloads'
    AND existing.metadata->>'downloadId' = d.id::text
);

INSERT INTO activity_events(event_type, user_id, user_role, ip_address, order_id, description, metadata, created_at)
SELECT 'ADMIN_ACTION', pal.actor_id, 'admin', NULL, NULL, pal.details,
  jsonb_build_object('source', 'promotion_activity_logs', 'legacy_id', pal.id, 'action', pal.action, 'legacy_metadata', COALESCE(pal.metadata, '{}'::jsonb)), pal.created_at
FROM promotion_activity_logs pal
WHERE NOT EXISTS (
  SELECT 1 FROM activity_events ae
  WHERE ae.metadata->>'source' = 'promotion_activity_logs' AND ae.metadata->>'legacy_id' = pal.id::text
);

INSERT INTO activity_events(event_type, user_id, user_role, ip_address, order_id, description, metadata, created_at)
SELECT 'ORDER_UPDATED', NULL, oal.actor_role, oal.ip_address::inet, oal.order_id, oal.details,
  jsonb_build_object('source', 'order_activity_logs', 'legacy_id', oal.id, 'event', oal.event), oal.created_at
FROM order_activity_logs oal
WHERE NOT EXISTS (
  SELECT 1 FROM activity_events ae
  WHERE ae.metadata->>'source' = 'order_activity_logs' AND ae.metadata->>'legacy_id' = oal.id::text
);