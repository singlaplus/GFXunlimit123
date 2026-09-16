-- Per-user conversation deletion: preserve the thread for other participants and admins.
CREATE TABLE IF NOT EXISTS conversation_hidden_for_users (
  conversation_id BIGINT NOT NULL REFERENCES message_conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_hidden_for_users_user_idx
  ON conversation_hidden_for_users(user_id, hidden_at DESC);
