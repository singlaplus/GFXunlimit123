-- Per-user message deletion: hide a message for one user without deleting it for participants.
CREATE TABLE IF NOT EXISTS message_hidden_for_users (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS message_hidden_for_users_user_idx
  ON message_hidden_for_users(user_id, hidden_at DESC);
