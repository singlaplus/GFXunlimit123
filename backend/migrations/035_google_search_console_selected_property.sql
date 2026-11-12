ALTER TABLE google_search_console_connections
ADD COLUMN IF NOT EXISTS selected_property TEXT;
