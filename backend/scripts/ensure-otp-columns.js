require('dotenv').config();
const pool = require('../db');

async function ensureOtpColumns() {
  try {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS otp_enabled BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS otp_code TEXT,
      ADD COLUMN IF NOT EXISTS otp_context TEXT,
      ADD COLUMN IF NOT EXISTS otp_code_expires_at TIMESTAMPTZ;
    `);

    await pool.query(`
      UPDATE users
      SET otp_enabled = true
      WHERE otp_enabled IS DISTINCT FROM true;
    `);

    const result = await pool.query(`
      SELECT COUNT(*)::int AS total_users,
             COUNT(*) FILTER (WHERE otp_enabled IS TRUE) AS otp_enabled_users
      FROM users;
    `);

    console.log('OTP migration complete:', result.rows[0]);
  } catch (err) {
    console.error('OTP migration failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

ensureOtpColumns();
