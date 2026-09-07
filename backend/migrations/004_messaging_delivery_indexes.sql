-- Indexes for existing messaging and delivery tables only.
CREATE INDEX IF NOT EXISTS messages_sender_created_idx ON messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_conversations_updated_idx ON message_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(username, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(username, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS activity_events_event_created_idx ON activity_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_order_idx ON activity_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_asset_idx ON activity_events(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_queue_status_created_idx ON email_queue(status, created_at DESC);
CREATE INDEX IF NOT EXISTS email_queue_job_id_idx ON email_queue(job_id);
CREATE INDEX IF NOT EXISTS email_logs_status_created_idx ON email_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS email_logs_recipient_created_idx ON email_logs(recipient, created_at DESC);
CREATE INDEX IF NOT EXISTS message_broadcasts_status_scheduled_idx ON message_broadcasts(status, scheduled_at);
