const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function resetPassword(email) {
  const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'stocksite'
  });

  try {
    // Find the user
    const result = await pool.query(
      `SELECT id, username, email FROM users WHERE email ILIKE $1`,
      [email]
    );

    if (result.rows.length === 0) {
      console.log('❌ User not found:', email);
      process.exit(1);
    }

    const user = result.rows[0];
    
    // Generate a temporary password
    const tempPassword = 'TempPass123!' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    
    // Calculate expiration (24 hours from now)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // Update the user with temporary password
    await pool.query(
      `UPDATE users 
       SET password = $1,
           otp_code = NULL,
           otp_context = NULL,
           otp_code_expires_at = NULL
       WHERE id = $2`,
      [hashedPassword, user.id]
    );

    console.log('\n✅ Password reset successful!\n');
    console.log('📋 User Details:');
    console.log('  ID:', user.id);
    console.log('  Username:', user.username);
    console.log('  Email:', user.email);
    console.log('\n🔐 Temporary Password:');
    console.log('  ', tempPassword);
    console.log('\n⏰ Expires At:', expiresAt.toISOString());
    console.log('\n📝 Note: User can log in with this temporary password and change it afterward.');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

const email = process.argv[2] || 'ankit2@test.com';
resetPassword(email);
