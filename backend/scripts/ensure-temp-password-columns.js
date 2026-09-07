require('dotenv').config();
const pool = require('../db');

async function ensureTempPasswordColumns() {
  try {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS temp_password TEXT,
      ADD COLUMN IF NOT EXISTS temp_password_expires_at TIMESTAMPTZ;
    `);

    const result = await pool.query(`
      SELECT COUNT(*)::int AS total_users
      FROM users;
    `);

    console.log('Temp password migration complete. Total users:', result.rows[0].total_users);
  } catch (err) {
    console.error('Temp password migration failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

ensureTempPasswordColumns();
