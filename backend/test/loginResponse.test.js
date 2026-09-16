const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const { app } = require('../server');
const pool = require('../db');

const PORT = 57654;
let server;
let testUserId;
const testUsername = `test_contributor_login_${Date.now()}`;
const testPassword = 'TestPass123!';
const testEmail = `${testUsername}@example.com`;

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

test.before(async (t) => {
  server = app.listen(PORT, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  const hashedPassword = await bcrypt.hash(testPassword, 10);
  const insertResult = await pool.query(
    `INSERT INTO users (username, email, full_name, role, password, status, custom_permissions, created_at)
     VALUES ($1, $2, $3, 'contributor', $4, 'active', $5, now())
     RETURNING id`,
    [testUsername, testEmail, testUsername, hashedPassword, JSON.stringify({ bulk_upload: true })]
  );
  testUserId = insertResult.rows[0].id;
});

test.after(async (t) => {
  if (testUserId) {
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

test('login endpoint returns custom_permissions for contributor users', async (t) => {
  const loginPayload = JSON.stringify({
    identifier: testUsername,
    password: testPassword
  });

  const res = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginPayload)
    }
  }, loginPayload);

  assert.equal(res.status, 200, `Expected 200 but got ${res.status}`);

  let body;
  try {
    body = JSON.parse(res.body);
  } catch (err) {
    assert.fail(`Response body is not valid JSON: ${res.body}`);
  }

  assert.ok(body.custom_permissions, 'custom_permissions is missing from login response');
  assert.equal(typeof body.custom_permissions, 'object');
});

test('login endpoint sets a readable session cookie for frontend session restoration', async (t) => {
  const loginPayload = JSON.stringify({
    identifier: testUsername,
    password: testPassword
  });

  const res = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginPayload)
    }
  }, loginPayload);

  assert.equal(res.status, 200, `Expected 200 but got ${res.status}`);
  const setCookieHeader = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'].join('; ') : String(res.headers['set-cookie'] || '');
  assert.match(setCookieHeader, /session_id=/, 'session_id cookie is missing');
  assert.match(setCookieHeader, /authToken=/, 'authToken cookie is missing');
});

test('login-issued JWT remains valid for authenticated session checks', async (t) => {
  const loginPayload = JSON.stringify({
    identifier: testUsername,
    password: testPassword
  });

  const loginRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginPayload)
    }
  }, loginPayload);

  assert.equal(loginRes.status, 200, `Expected login status 200 but got ${loginRes.status}`);

  const loginBody = JSON.parse(loginRes.body);
  assert.ok(loginBody.token, 'Login did not return a JWT');

  const meRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/me',
    method: 'GET',
    headers: {
      Authorization: `Bearer ${loginBody.token}`
    }
  });

  assert.equal(meRes.status, 200, `Expected /me to accept the login token but got ${meRes.status}: ${meRes.body}`);
  const meBody = JSON.parse(meRes.body);
  assert.equal(meBody.id, testUserId, 'Returned user does not match the logged-in user');
});
