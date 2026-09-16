-- Create daily_report_schedules table for storing scheduled daily report delivery
CREATE TABLE IF NOT EXISTS daily_report_schedules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  time TIME NOT NULL DEFAULT '09:00',
  frequency VARCHAR(50) NOT NULL DEFAULT 'daily',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_daily_report_schedules_created_at ON daily_report_schedules(created_at);
