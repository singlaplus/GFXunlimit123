CREATE INDEX IF NOT EXISTS activity_events_blog_analytics_type_created_idx
  ON activity_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_events_blog_id_idx
  ON activity_events((metadata->>'blog_id'));

CREATE INDEX IF NOT EXISTS activity_events_blog_visitor_idx
  ON activity_events((metadata->>'visitor_id'), created_at DESC);
