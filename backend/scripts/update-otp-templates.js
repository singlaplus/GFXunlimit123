const fs = require('fs');
const path = require('path');

const otpSettingsFile = path.join(__dirname, '../uploads/otp-settings.json');

const updatedSettings = {
  "default_recipient": "default-otp@example.com",
  "bcc_recipients": "admin@example.com, ops@example.com",
  "login_subject": "Your GFXunlimit Login OTP Code",
  "registration_subject": "Welcome to GFXunlimit - Account Verification OTP",
  "recovery_subject": "GFXunlimit Password Recovery OTP",
  "login_body": `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #ED2224;">GFXunlimit Login Verification</h2>
    <p>Hello {{full_name}},</p>
    <p>Your OTP code to login is:</p>
    <div style="background: #f0f0f0; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
      <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #ED2224;">{{otp}}</span>
    </div>
    <p>This code is valid for <strong>{{valid_minutes}} minutes</strong>.</p>
    <p style="color: #666; font-size: 12px;">If you didn't request this code, please ignore this email. Your account is secure.</p>
  </div>
</body>
</html>`,
  "registration_body": `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #ED2224;">Welcome to GFXunlimit!</h2>
    <p>Hello {{full_name}},</p>
    <p>Thank you for registering with GFXunlimit. To complete your account setup, please verify your email with the following code:</p>
    <div style="background: #f0f0f0; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
      <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #ED2224;">{{otp}}</span>
    </div>
    <p>This verification code is valid for <strong>{{valid_minutes}} minutes</strong>.</p>
    <p>Once verified, you'll be able to:</p>
    <ul>
      <li>Download premium creative assets</li>
      <li>Build your collections</li>
      <li>Purchase licenses securely</li>
    </ul>
    <p style="color: #666; font-size: 12px;">If you didn't create this account, please disregard this email.</p>
  </div>
</body>
</html>`,
  "recovery_body": `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #ED2224;">Reset Your GFXunlimit Password</h2>
    <p>Hello {{full_name}},</p>
    <p>We received a request to reset your password. Use the verification code below to proceed:</p>
    <div style="background: #f0f0f0; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
      <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #ED2224;">{{otp}}</span>
    </div>
    <p>This code is valid for <strong>{{valid_minutes}} minutes</strong>.</p>
    <p style="color: #666; font-size: 12px;">If you didn't request a password reset, please ignore this email and your account will remain secure.</p>
  </div>
</body>
</html>`,
  "valid_minutes": 15
};

fs.writeFileSync(otpSettingsFile, JSON.stringify(updatedSettings, null, 2));
console.log('✅ OTP email templates updated successfully');
