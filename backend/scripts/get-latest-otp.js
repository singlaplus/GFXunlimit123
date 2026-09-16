const { Pool } = require('pg');
require('dotenv').config();

async function getLatestOTP() {
  const pool = new Pool({
    user: process.env.DB_USER || 'gfxunlimit',
    password: process.env.DB_PASSWORD || '',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'stocksite'
  });

  try {
    // Get the most recent user with pending status
    const result = await pool.query(
      `SELECT id, username, email, otp_code, otp_context, otp_code_expires_at, created_at 
       FROM users 
       WHERE status = 'pending' 
       ORDER BY created_at DESC 
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      console.log('No pending users found');
      process.exit(0);
    }

    const user = result.rows[0];
    console.log('\n📋 Latest Pending User:');
    console.log('  ID:', user.id);
    console.log('  Username:', user.username);
    console.log('  Email:', user.email);
    console.log('  OTP Code:', user.otp_code);
    console.log('  OTP Context:', user.otp_context);
    console.log('  Expires At:', user.otp_code_expires_at);
    console.log('  Created At:', user.created_at);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

getLatestOTP();
