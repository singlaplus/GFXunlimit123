-- Per-user read state for shared messages. The legacy messages.read_at column remains for compatibility.
CREATE TABLE IF NOT EXISTS message_read_for_users (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS message_read_for_users_user_idx
  ON message_read_for_users(user_id, read_at DESC);
