-- Add stable ticket IDs to existing conversations without creating a new table.
ALTER TABLE message_conversations ADD COLUMN IF NOT EXISTS ticket_id TEXT;

UPDATE message_conversations
SET ticket_id = 'GFX-' || LPAD(id::text, 3, '0')
WHERE ticket_id IS NULL OR ticket_id = '';

CREATE UNIQUE INDEX IF NOT EXISTS message_conversations_ticket_id_idx ON message_conversations(ticket_id);
