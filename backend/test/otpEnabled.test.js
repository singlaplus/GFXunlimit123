const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { app } = require('../server');
const pool = require('../db');

const PORT = 57655;
let server;
let otpUserId;
let bypassUserId;
let adminUserId;
const testPassword = 'TestPass123!';
const adminUsername = `test_admin_${Date.now()}`;
const adminEmail = `${adminUsername}@example.com`;
const otpUserUsername = `test_otp_enabled_${Date.now()}`;
const bypassUserUsername = `test_otp_disabled_${Date.now()}`;
const otpUserEmail = `${otpUserUsername}@example.com`;
const bypassUserEmail = `${bypassUserUsername}@example.com`;

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

test.before(async () => {
  server = app.listen(PORT, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  const hashedPassword = await bcrypt.hash(testPassword, 10);
  const result1 = await pool.query(
    `INSERT INTO users (username, email, full_name, role, password, status, otp_enabled, custom_permissions, created_at)
     VALUES ($1, $2, $3, 'customer', $4, 'active', true, $5, now())
     RETURNING id`,
    [otpUserUsername, otpUserEmail, otpUserUsername, hashedPassword, JSON.stringify({})]
  );
  otpUserId = result1.rows[0].id;

  const result2 = await pool.query(
    `INSERT INTO users (username, email, full_name, role, password, status, otp_enabled, custom_permissions, created_at)
     VALUES ($1, $2, $3, 'customer', $4, 'active', false, $5, now())
     RETURNING id`,
    [bypassUserUsername, bypassUserEmail, bypassUserUsername, hashedPassword, JSON.stringify({})]
  );
  bypassUserId = result2.rows[0].id;

  const adminResult = await pool.query(
    `INSERT INTO users (username, email, full_name, role, password, status, otp_enabled, custom_permissions, created_at)
     VALUES ($1, $2, $3, 'admin', $4, 'active', true, $5, now())
     RETURNING id`,
    [adminUsername, adminEmail, adminUsername, hashedPassword, JSON.stringify({})]
  );
  adminUserId = adminResult.rows[0].id;
});

test.after(async () => {
  if (otpUserId) {
    await pool.query('DELETE FROM users WHERE id = $1', [otpUserId]);
  }
  if (bypassUserId) {
    await pool.query('DELETE FROM users WHERE id = $1', [bypassUserId]);
  }
  if (adminUserId) {
    await pool.query('DELETE FROM users WHERE id = $1', [adminUserId]);
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

test('login requires OTP when otp_enabled is true and authenticates after OTP verification', async () => {
  const loginPayload = JSON.stringify({
    identifier: otpUserUsername,
    password: testPassword,
  });

  const initialRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginPayload),
    },
  }, loginPayload);

  assert.equal(initialRes.status, 202, `Expected 202 for OTP request but got ${initialRes.status}`);
  const otpRow = await pool.query(
    'SELECT otp_code, otp_context, otp_code_expires_at FROM users WHERE id = $1',
    [otpUserId]
  );
  assert.equal(otpRow.rows.length, 1);
  assert.ok(otpRow.rows[0].otp_code, 'Expected an OTP code to be stored for the user');
  assert.equal(otpRow.rows[0].otp_context, 'login', 'Expected otp_context to be login');
  const otpCode = otpRow.rows[0].otp_code;

  const verifyPayload = JSON.stringify({
    identifier: otpUserUsername,
    password: testPassword,
    otp: otpCode,
  });

  const verifyRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(verifyPayload),
    },
  }, verifyPayload);

  assert.equal(verifyRes.status, 200, `Expected 200 after OTP verification but got ${verifyRes.status}`);
  const verifyBody = JSON.parse(verifyRes.body);
  assert.ok(verifyBody.token, 'Expected a JWT token after successful OTP login');
});

test('admin can toggle otp_enabled for a user and the login flow follows the saved value', async () => {
  const adminToken = jwt.sign({ user: adminUserId }, 'secretkey');
  const targetPayload = JSON.stringify({
    full_name: otpUserUsername,
    username: otpUserUsername,
    email: otpUserEmail,
    role: 'customer',
    status: 'active',
    otp_enabled: false,
    custom_permissions: {}
  });

  const disableRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: `/admin/users/${otpUserId}`,
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(targetPayload),
    },
  }, targetPayload);

  assert.equal(disableRes.status, 200, `Expected admin update to succeed but got ${disableRes.status}`);
  const disableBody = JSON.parse(disableRes.body);
  assert.equal(disableBody.otp_enabled, false, 'Expected otp_enabled to be disabled after admin update');

  const bypassLoginPayload = JSON.stringify({
    identifier: otpUserUsername,
    password: testPassword,
  });

  const bypassRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bypassLoginPayload),
    },
  }, bypassLoginPayload);

  assert.equal(bypassRes.status, 200, `Expected immediate login success when OTP is disabled but got ${bypassRes.status}`);
  const bypassBody = JSON.parse(bypassRes.body);
  assert.ok(bypassBody.token, 'Expected a JWT token when OTP is disabled');

  const reenablePayload = JSON.stringify({
    full_name: otpUserUsername,
    username: otpUserUsername,
    email: otpUserEmail,
    role: 'customer',
    status: 'active',
    otp_enabled: true,
    custom_permissions: {}
  });

  const enableRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: `/admin/users/${otpUserId}`,
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(reenablePayload),
    },
  }, reenablePayload);

  assert.equal(enableRes.status, 200, `Expected admin re-enable to succeed but got ${enableRes.status}`);
  const enableBody = JSON.parse(enableRes.body);
  assert.equal(enableBody.otp_enabled, true, 'Expected otp_enabled to be re-enabled after admin update');

  const otpLoginPayload = JSON.stringify({
    identifier: otpUserUsername,
    password: testPassword,
  });

  const otpRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(otpLoginPayload),
    },
  }, otpLoginPayload);

  assert.equal(otpRes.status, 202, `Expected OTP challenge when OTP is re-enabled but got ${otpRes.status}`);
});

test('admin can save otp settings and load them back', async () => {
  const adminToken = jwt.sign({ user: adminUserId }, 'secretkey');
  const payload = JSON.stringify({
    default_recipient: 'default-otp@example.com',
    bcc_recipients: 'admin@example.com, ops@example.com',
    login_subject: 'Custom Login OTP',
    registration_subject: 'Custom Registration OTP',
    recovery_subject: 'Custom Recovery OTP',
    login_body: 'Your login OTP is {{otp}}',
    registration_body: 'Your registration OTP is {{otp}}',
    recovery_body: 'Your recovery OTP is {{otp}}',
    valid_minutes: 15
  });

  const saveRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/admin/otp-settings',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, payload);

  assert.equal(saveRes.status, 200, `Expected admin OTP settings save to succeed but got ${saveRes.status}`);
  const saved = JSON.parse(saveRes.body);
  assert.equal(saved.default_recipient, 'default-otp@example.com');
  assert.equal(saved.valid_minutes, 15);

  const getRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/admin/otp-settings',
    method: 'GET',
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(getRes.status, 200, `Expected admin OTP settings fetch to succeed but got ${getRes.status}`);
  const loaded = JSON.parse(getRes.body);
  assert.equal(loaded.default_recipient, 'default-otp@example.com');
  assert.equal(loaded.valid_minutes, 15);
});

test('forgot password flow uses OTP and accepts a new password after successful verification', async () => {
  const userEmail = `recover_${Date.now()}@example.com`;
  const userPassword = 'RecoverPass123!';
  const hashedPassword = await bcrypt.hash(userPassword, 10);
  const userInsert = await pool.query(
    `INSERT INTO users (username, email, full_name, role, password, status, otp_enabled, custom_permissions, created_at)
     VALUES ($1, $2, $3, 'customer', $4, 'active', true, $5, now())
     RETURNING id`,
    [`recover_user_${Date.now()}`, userEmail, 'Recover User', hashedPassword, JSON.stringify({})]
  );
  const targetUserId = userInsert.rows[0].id;

  try {
    const requestPayload = JSON.stringify({ identifier: userEmail });
    const requestRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/forgot-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestPayload),
      },
    }, requestPayload);

    assert.equal(requestRes.status, 200, `Expected forgot-password to send OTP but got ${requestRes.status}`);

    const otpRow = await pool.query(
      'SELECT otp_code, otp_context, otp_code_expires_at FROM users WHERE id = $1',
      [targetUserId]
    );
    assert.equal(otpRow.rows.length, 1);
    assert.equal(otpRow.rows[0].otp_context, 'recovery', 'Expected recovery OTP context to be stored');
    assert.ok(otpRow.rows[0].otp_code, 'Expected a recovery OTP to be generated');

    const verifyPayload = JSON.stringify({
      identifier: userEmail,
      otp: otpRow.rows[0].otp_code,
      newPassword: 'NewPassword456!',
      confirmPassword: 'NewPassword456!'
    });

    const verifyRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/forgot-password/confirm-otp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(verifyPayload),
      },
    }, verifyPayload);

    assert.equal(verifyRes.status, 200, `Expected recovery reset success but got ${verifyRes.status}`);
    const verifyBody = JSON.parse(verifyRes.body);
    assert.ok(verifyBody.message, 'Expected a success message after recovery reset');

    const updatedUser = await pool.query('SELECT password FROM users WHERE id = $1', [targetUserId]);
    assert.ok(updatedUser.rows[0].password && updatedUser.rows[0].password !== hashedPassword, 'Expected password to be updated on OTP recovery');

    const loginPayload = JSON.stringify({
      identifier: userEmail,
      password: 'NewPassword456!',
    });

    const loginRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginPayload),
      },
    }, loginPayload);

    assert.equal(loginRes.status, 202, `Expected OTP challenge on login after password reset when OTP is enabled but got ${loginRes.status}`);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [targetUserId]);
  }
});

test('login succeeds immediately when otp_enabled is false', async () => {
  const loginPayload = JSON.stringify({
    identifier: bypassUserUsername,
    password: testPassword,
  });

  const res = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginPayload),
    },
  }, loginPayload);

  assert.equal(res.status, 200, `Expected 200 for bypass login but got ${res.status}`);
  const body = JSON.parse(res.body);
  assert.ok(body.token, 'Expected a JWT token when OTP is disabled');
});
