const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const { app, buildAccountStatusNotificationMessage } = require('../server');
const pool = require('../db');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

test('buildAccountStatusNotificationMessage covers active, blocked, rejected, and deleted states', () => {
  assert.equal(
    buildAccountStatusNotificationMessage({ newStatus: 'active', action: 'approve', username: 'johndoe' }),
    "Account 'johndoe' has been approved and activated by an administrator."
  );

  assert.equal(
    buildAccountStatusNotificationMessage({ newStatus: 'blocked', action: 'block', username: 'johndoe' }),
    "Account 'johndoe' has been blocked by an administrator."
  );

  assert.equal(
    buildAccountStatusNotificationMessage({ newStatus: 'rejected', action: 'reject', username: 'johndoe' }),
    "Account 'johndoe' has been rejected by an administrator."
  );

  assert.equal(
    buildAccountStatusNotificationMessage({ newStatus: 'deleted', action: 'delete', username: 'johndoe' }),
    "Account 'johndoe' has been deleted by an administrator."
  );
});

test('admin update status route inserts a notification row for the user and admin', async () => {
  const port = 57755;
  const server = app.listen(port, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const uniqueSuffix = String(Date.now());
    const adminUsername = `admin_notify_${uniqueSuffix}`;
    const customerUsername = `customer_notify_${uniqueSuffix}`;
    const customerEmail = `${customerUsername}@example.com`;
    const adminEmail = `${adminUsername}@example.com`;
    const passwordHash = await bcrypt.hash('Pass1234!', 10);

    const adminRes = await pool.query(
      `INSERT INTO users (username, email, full_name, role, password, status, otp_enabled, custom_permissions, created_at)
       VALUES ($1, $2, $3, 'admin', $4, 'active', true, '{}', NOW())
       RETURNING id`,
      [adminUsername, adminEmail, adminUsername, passwordHash]
    );
    const adminId = adminRes.rows[0].id;

    const userRes = await pool.query(
      `INSERT INTO users (username, email, full_name, role, password, status, otp_enabled, custom_permissions, created_at)
       VALUES ($1, $2, $3, 'customer', $4, 'active', true, '{}', NOW())
       RETURNING id`,
      [customerUsername, customerEmail, customerUsername, passwordHash]
    );
    const userId = userRes.rows[0].id;

    const adminToken = jwt.sign({ user: adminId }, 'secretkey');
    const payload = JSON.stringify({ status: 'blocked', custom_permissions: {} });

    const updateRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/admin/users/${userId}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, payload);

    assert.equal(updateRes.status, 200, `Expected 200 but got ${updateRes.status}; body=${updateRes.body}`);

    const notifications = await pool.query(
      `SELECT username, message FROM notifications WHERE username IN ($1, $2) ORDER BY created_at DESC`,
      [customerUsername, adminUsername]
    );

    assert.ok(notifications.rows.length >= 2, 'Expected at least one notification for customer and one for admin');
    assert.ok(notifications.rows.some((row) => row.username === customerUsername && row.message.includes(customerUsername) && row.message.includes('blocked by an administrator')));
    assert.ok(notifications.rows.some((row) => row.username === adminUsername && row.message.includes(customerUsername) && row.message.includes('blocked by an administrator')));

    await pool.query('DELETE FROM notifications WHERE username IN ($1, $2)', [customerUsername, adminUsername]);
    await pool.query('ALTER TABLE activity_events DISABLE TRIGGER activity_events_immutable_trigger');
    try {
      await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [userId, adminId]);
    } finally {
      await pool.query('ALTER TABLE activity_events ENABLE TRIGGER activity_events_immutable_trigger');
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
