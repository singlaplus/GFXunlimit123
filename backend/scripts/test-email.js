const { createTransportFromSettings } = require('../email/mailer');
const { Pool } = require('pg');
require('dotenv').config();

async function testEmail() {
  let pool;
  try {
    console.log('🔍 Testing email configuration...\n');
    
    // Create a fresh connection to database
    pool = new Pool({
      user: process.env.DB_USER || 'gfxunlimit',
      password: process.env.DB_PASSWORD || '',
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'stocksite'
    });
    
    // Get email settings from database
    const settingsRes = await pool.query('SELECT * FROM email_settings ORDER BY id DESC LIMIT 1');
    const settings = settingsRes.rows[0];
    
    if (!settings) {
      console.error('❌ No email settings found in database');
      process.exit(1);
    }
    
    console.log('📧 Email Settings:');
    console.log('  Sender Name:', settings.sender_name);
    console.log('  Sender Email:', settings.sender_email);
    console.log('  SMTP Host:', settings.smtp_host);
    console.log('  SMTP Port:', settings.smtp_port);
    console.log('  SMTP User:', settings.smtp_user);
    console.log('  SMTP Secure:', settings.smtp_secure);
    
    // Create transporter
    console.log('\n🔗 Creating email transporter...');
    const transporter = await createTransportFromSettings(settings);
    
    // Verify connection
    console.log('🔌 Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP connection verified!');
    
    // Send test email
    console.log('\n📤 Sending test email...');
    const testResult = await transporter.sendMail({
      from: `${settings.sender_name} <${settings.sender_email}>`,
      to: 'as.asira@outlook.com',
      subject: 'Test Email from GFXunlimit OTP System',
      html: `<h1>This is a test email</h1><p>If you received this, the email system is working properly!</p>`,
      text: 'This is a test email. If you received this, the email system is working properly!'
    });
    
    console.log('✅ Email sent successfully!');
    console.log('  Message ID:', testResult.messageId);
    console.log('  Response:', testResult.response);
    
  } catch (err) {
    console.error('❌ Error:', err.message || err);
    process.exit(1);
  } finally {
    if (pool) await pool.end();
    process.exit(0);
  }
}

testEmail();
