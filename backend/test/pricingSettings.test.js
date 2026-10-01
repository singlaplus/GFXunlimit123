const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { app } = require('../server');
const pool = require('../db');

const PORT = 57655;
let server;
let adminUserId;
const adminUsername = `pricing_admin_${Date.now()}`;
const adminEmail = `${adminUsername}@example.com`;
const adminPassword = 'TempPass123!';

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
  const commissionMigration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '027_contributor_commission_settings.sql'),
    'utf8'
  );
  await pool.query(commissionMigration);

  server = app.listen(PORT, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  const insertResult = await pool.query(
    `INSERT INTO users (username, email, full_name, role, password, status, custom_permissions, is_super_admin, created_at)
     VALUES ($1, $2, $3, 'admin', $4, 'active', $5, true, now())
     RETURNING id`,
    [adminUsername, adminEmail, adminUsername, hashedPassword, JSON.stringify({ bulk_upload: true })]
  );
  adminUserId = insertResult.rows[0].id;
});

test.after(async () => {
  if (adminUserId) {
    await pool.query('DELETE FROM users WHERE id = $1', [adminUserId]);
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

test('pricing settings endpoint stores fixed currency amounts', async () => {
  const token = jwt.sign({ user: adminUserId }, 'secretkey');
  const payload = JSON.stringify({
    enable_global_minimum_pricing: true,
    default_currency: 'INR',
    exchange_rate: 1,
    auto_update_exchange_rate: false,
    prevent_pricing_below_minimum: true,
    automatically_increase_lower_priced_assets: false,
    display_warning_during_contributor_upload: false,
    allow_admins_bypass_minimum_pricing: false,
    minimum_price_inr: 2,
    minimum_price_usd: 3,
    inr_amount: 2,
    usd_amount: 3,
    eur_amount: 4,
    tax_settings: [{ id: 1, enabled: true, rate: 0, label: 'GST' }]
  });

  const res = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/admin/settings/pricing',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      Authorization: `Bearer ${token}`
    }
  }, payload);

  assert.equal(res.status, 200, `Expected 200 but got ${res.status}: ${res.body}`);

  let body;
  try {
    body = JSON.parse(res.body);
  } catch (err) {
    assert.fail(`Response body is not valid JSON: ${res.body}`);
  }

  assert.equal(String(body.inr_amount), '2');
  assert.equal(String(body.usd_amount), '3');
  assert.equal(String(body.eur_amount), '4');
});

test('contributor commission endpoint stores a valid percentage', async () => {
  const token = jwt.sign({ user: adminUserId }, 'secretkey');
  const payload = JSON.stringify({ percentage: 5 });

  const res = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/admin/settings/contributor-commission',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      Authorization: `Bearer ${token}`
    }
  }, payload);

  assert.equal(res.status, 200, `Expected 200 but got ${res.status}: ${res.body}`);

  let body;
  try {
    body = JSON.parse(res.body);
  } catch (err) {
    assert.fail(`Response body is not valid JSON: ${res.body}`);
  }

  assert.equal(Number(body.percentage), 5);

  const savedRes = await request({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/admin/settings/contributor-commission',
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });

  assert.equal(savedRes.status, 200, `Expected 200 but got ${savedRes.status}: ${savedRes.body}`);
  assert.equal(Number(JSON.parse(savedRes.body).percentage), 5);
});
