CREATE TABLE IF NOT EXISTS activity_hidden_for_users (
  event_id BIGINT NOT NULL REFERENCES activity_events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS activity_hidden_for_users_user_idx
  ON activity_hidden_for_users(user_id, hidden_at DESC);
