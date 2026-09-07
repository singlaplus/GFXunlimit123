require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');

const ensureSchema = async () => {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_number TEXT UNIQUE,
      invoice_number TEXT UNIQUE,
      customer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      customer_name TEXT,
      customer_phone TEXT,
      customer_country TEXT,
      order_type TEXT,
      currency TEXT DEFAULT 'USD',
      exchange_rate NUMERIC DEFAULT 1,
      subtotal NUMERIC DEFAULT 0,
      discount NUMERIC DEFAULT 0,
      tax NUMERIC DEFAULT 0,
      total_amount NUMERIC DEFAULT 0,
      coupon_code TEXT,
      payment_gateway TEXT,
      payment_method TEXT,
      transaction_id TEXT,
      payment_status TEXT,
      order_status TEXT,
      download_status TEXT,
      refund_status TEXT DEFAULT 'none',
      support_status TEXT,
      assets_count INTEGER DEFAULT 0,
      downloads_count INTEGER DEFAULT 0,
      contributor_earnings NUMERIC DEFAULT 0,
      platform_commission NUMERIC DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      asset_id INTEGER,
      title TEXT,
      category TEXT,
      license TEXT,
      contributor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      contributor_username TEXT,
      quantity INTEGER DEFAULT 1,
      unit_price NUMERIC DEFAULT 0,
      total_price NUMERIC DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      download_status TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      amount NUMERIC DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      gateway TEXT,
      transaction_id TEXT,
      status TEXT,
      authorization_code TEXT,
      response JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS refunds (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      amount NUMERIC DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      status TEXT,
      reason TEXT,
      note TEXT,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_notes (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      visibility TEXT DEFAULT 'admin',
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_activity_logs (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      event TEXT,
      actor_role TEXT,
      details JSONB,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
};

const ensureUser = async ({ username, email, full_name, role, password, phone, country }) => {
  const existing = await pool.query(
    `SELECT id, username, email, role FROM users WHERE username = $1 OR email = $2 LIMIT 1`,
    [username, email]
  );

  if (existing.rows.length > 0) {
    const user = existing.rows[0];
    const updates = [];
    const values = [];
    if (user.role !== role) {
      values.push(role);
      updates.push(`role = $${values.length}`);
    }
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      values.push(hashed);
      updates.push(`password = $${values.length}`);
    }
    if (full_name) {
      values.push(full_name);
      updates.push(`full_name = $${values.length}`);
    }
    if (phone) {
      values.push(phone);
      updates.push(`phone = $${values.length}`);
    }
    if (country) {
      values.push(country);
      updates.push(`country = $${values.length}`);
    }

    if (updates.length > 0) {
      values.push(user.id);
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    }

    return user.id;
  }

  const hashedPassword = password ? await bcrypt.hash(password, 10) : null;
  const result = await pool.query(
    `INSERT INTO users (username, email, full_name, role, password, phone, country, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW())
     RETURNING id`,
    [username, email, full_name, role, hashedPassword, phone, country]
  );
  return result.rows[0].id;
};

const insertOrder = async ({
  order_number,
  invoice_number,
  customer_id,
  customer_name,
  customer_phone,
  customer_country,
  order_type,
  currency,
  subtotal,
  discount,
  tax,
  total_amount,
  coupon_code,
  payment_gateway,
  payment_method,
  transaction_id,
  payment_status,
  order_status,
  download_status,
  refund_status,
  assets_count,
  downloads_count,
  contributor_earnings,
  platform_commission,
  created_at,
  items,
  payments,
  refunds,
  notes,
  activity_logs
}) => {
  const orderResult = await pool.query(
    `INSERT INTO orders (order_number, invoice_number, customer_id, customer_name, customer_phone, customer_country, order_type, currency, subtotal, discount, tax, total_amount, coupon_code, payment_gateway, payment_method, transaction_id, payment_status, order_status, download_status, refund_status, assets_count, downloads_count, contributor_earnings, platform_commission, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW())
     RETURNING id`,
    [
      order_number,
      invoice_number,
      customer_id,
      customer_name,
      customer_phone,
      customer_country,
      order_type,
      currency,
      subtotal,
      discount,
      tax,
      total_amount,
      coupon_code,
      payment_gateway,
      payment_method,
      transaction_id,
      payment_status,
      order_status,
      download_status,
      refund_status,
      assets_count,
      downloads_count,
      contributor_earnings,
      platform_commission,
      created_at
    ]
  );
  const orderId = orderResult.rows[0].id;

  if (Array.isArray(items) && items.length > 0) {
    for (const item of items) {
      await pool.query(
        `INSERT INTO order_items (order_id, asset_id, title, category, license, contributor_id, contributor_username, quantity, unit_price, total_price, currency, download_status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          orderId,
          item.asset_id,
          item.title,
          item.category,
          item.license,
          item.contributor_id,
          item.contributor_username,
          item.quantity,
          item.unit_price,
          item.total_price,
          item.currency,
          item.download_status,
          item.created_at || created_at
        ]
      );
    }
  }

  if (Array.isArray(payments) && payments.length > 0) {
    for (const payment of payments) {
      await pool.query(
        `INSERT INTO payments (order_id, amount, currency, gateway, transaction_id, status, authorization_code, response, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          orderId,
          payment.amount,
          payment.currency || currency,
          payment.gateway,
          payment.transaction_id,
          payment.status,
          payment.authorization_code,
          payment.response || {},
          payment.created_at || created_at
        ]
      );
    }
  }

  if (Array.isArray(refunds) && refunds.length > 0) {
    for (const refund of refunds) {
      await pool.query(
        `INSERT INTO refunds (order_id, amount, currency, status, reason, note, approved_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          orderId,
          refund.amount,
          refund.currency || currency,
          refund.status,
          refund.reason,
          refund.note,
          refund.approved_at,
          refund.created_at || created_at
        ]
      );
    }
  }

  if (Array.isArray(notes) && notes.length > 0) {
    for (const note of notes) {
      await pool.query(
        `INSERT INTO order_notes (order_id, author_id, visibility, note, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [orderId, note.author_id || null, note.visibility || 'admin', note.note, note.created_at || created_at]
      );
    }
  }

  if (Array.isArray(activity_logs) && activity_logs.length > 0) {
    for (const log of activity_logs) {
      await pool.query(
        `INSERT INTO order_activity_logs (order_id, event, actor_role, details, ip_address, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          orderId,
          log.event,
          log.actor_role || 'system',
          log.details || {},
          log.ip_address || '127.0.0.1',
          log.created_at || created_at
        ]
      );
    }
  }

  return orderId;
};

const seed = async () => {
  try {
    await ensureSchema();
    await pool.query('BEGIN');

    const adminId = await ensureUser({
      username: 'admin_demo',
      email: 'admin_demo@example.com',
      full_name: 'Admin Demo',
      role: 'admin',
      password: 'Admin123!',
      phone: '+1-555-0100',
      country: 'United States'
    });

    const johnId = await ensureUser({
      username: 'johnsmith',
      email: 'john.smith@example.com',
      full_name: 'John Smith',
      role: 'customer',
      password: 'Customer123!',
      phone: '+1-555-0111',
      country: 'United States'
    });

    const emmaId = await ensureUser({
      username: 'emmajohnson',
      email: 'emma.johnson@example.com',
      full_name: 'Emma Johnson',
      role: 'customer',
      password: 'Customer123!',
      phone: '+44-20-7946-0958',
      country: 'United Kingdom'
    });

    const davidId = await ensureUser({
      username: 'davidbrown',
      email: 'david.brown@example.com',
      full_name: 'David Brown',
      role: 'customer',
      password: 'Customer123!',
      phone: '+91-98765-43210',
      country: 'India'
    });

    const contributorRows = await pool.query(`SELECT id, username FROM users WHERE role = 'contributor' ORDER BY id ASC`);
    const contributors = contributorRows.rows;
    if (contributors.length < 3) {
      throw new Error('At least 3 contributor accounts are required to seed realistic order items.');
    }

    const [contriA, contriB, contriC] = contributors;

    const now = new Date();
    const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    await insertOrder({
      order_number: 'GFX100826-01',
      invoice_number: 'INV-20260805-001',
      customer_id: johnId,
      customer_name: 'John Smith',
      customer_phone: '+1-555-0111',
      customer_country: 'United States',
      order_type: 'purchase',
      currency: 'USD',
      subtotal: 54.98,
      discount: 5.50,
      tax: 4.95,
      total_amount: 54.43,
      coupon_code: 'WELCOME10',
      payment_gateway: 'Stripe',
      payment_method: 'Credit Card',
      transaction_id: 'STRIPE-TX-1001',
      payment_status: 'completed',
      order_status: 'completed',
      download_status: 'fully_downloaded',
      refund_status: 'none',
      assets_count: 2,
      downloads_count: 2,
      contributor_earnings: 28.96,
      platform_commission: 25.47,
      created_at: threeDaysAgo,
      items: [
        {
          asset_id: 101,
          title: 'Premium Editorial Photo',
          category: 'Images',
          license: 'Extended',
          contributor_id: contriA.id,
          contributor_username: contriA.username,
          quantity: 1,
          unit_price: 34.99,
          total_price: 34.99,
          currency: 'USD',
          download_status: 'fully_downloaded'
        },
        {
          asset_id: 102,
          title: 'Layered PSD Website Template',
          category: 'PSD',
          license: 'Standard',
          contributor_id: contriB.id,
          contributor_username: contriB.username,
          quantity: 1,
          unit_price: 19.99,
          total_price: 19.99,
          currency: 'USD',
          download_status: 'fully_downloaded'
        }
      ],
      payments: [
        {
          amount: 54.43,
          currency: 'USD',
          gateway: 'Stripe',
          transaction_id: 'STRIPE-TX-1001',
          status: 'completed',
          authorization_code: 'AUTH-STR-7110',
          response: { approved: true, processor: 'Stripe', card_type: 'Visa', last4: '4242' }
        }
      ],
      notes: [
        {
          author_id: adminId,
          note: 'Applied welcome coupon and confirmed delivery after download.',
          visibility: 'admin'
        }
      ],
      activity_logs: [
        { event: 'Order created', actor_role: 'system', details: { stage: 'created' } },
        { event: 'Payment completed', actor_role: 'system', details: { gateway: 'Stripe' } },
        { event: 'Downloads completed', actor_role: 'system', details: { downloads: 2 } }
      ]
    });

    await insertOrder({
      order_number: 'GFX100826-02',
      invoice_number: 'INV-20260806-002',
      customer_id: emmaId,
      customer_name: 'Emma Johnson',
      customer_phone: '+44-20-7946-0958',
      customer_country: 'United Kingdom',
      order_type: 'purchase',
      currency: 'EUR',
      subtotal: 45.00,
      discount: 9.00,
      tax: 3.20,
      total_amount: 39.20,
      coupon_code: null,
      payment_gateway: 'PayPal',
      payment_method: 'PayPal Checkout',
      transaction_id: 'PAYPAL-TX-1002',
      payment_status: 'completed',
      order_status: 'completed',
      download_status: 'partially_downloaded',
      refund_status: 'none',
      assets_count: 3,
      downloads_count: 1,
      contributor_earnings: 21.65,
      platform_commission: 17.55,
      created_at: yesterday,
      items: [
        {
          asset_id: 103,
          title: 'Vector Illustration Pack',
          category: 'Vector Files',
          license: 'Standard',
          contributor_id: contriB.id,
          contributor_username: contriB.username,
          quantity: 1,
          unit_price: 15.00,
          total_price: 15.00,
          currency: 'EUR',
          download_status: 'completed'
        },
        {
          asset_id: 104,
          title: 'Minimal Line Icon Bundle',
          category: 'Icons',
          license: 'Extended',
          contributor_id: contriC.id,
          contributor_username: contriC.username,
          quantity: 1,
          unit_price: 12.00,
          total_price: 12.00,
          currency: 'EUR',
          download_status: 'pending'
        },
        {
          asset_id: 105,
          title: 'Abstract Vector Backgrounds',
          category: 'Vector Files',
          license: 'Standard',
          contributor_id: contriA.id,
          contributor_username: contriA.username,
          quantity: 1,
          unit_price: 18.00,
          total_price: 18.00,
          currency: 'EUR',
          download_status: 'pending'
        }
      ],
      payments: [
        {
          amount: 39.20,
          currency: 'EUR',
          gateway: 'PayPal',
          transaction_id: 'PAYPAL-TX-1002',
          status: 'completed',
          authorization_code: 'AUTH-PP-1902',
          response: { approved: true, payer_email: 'emma.johnson@example.com' }
        }
      ],
      notes: [
        {
          author_id: adminId,
          note: '20% discount was manually applied by support and first asset was downloaded successfully.',
          visibility: 'admin'
        }
      ],
      activity_logs: [
        { event: 'Order created', actor_role: 'system', details: { stage: 'created' } },
        { event: 'Payment completed', actor_role: 'system', details: { gateway: 'PayPal' } },
        { event: 'Download released', actor_role: 'system', details: { downloaded: 1, pending: 2 } }
      ]
    });

    await insertOrder({
      order_number: 'GFX100826-03',
      invoice_number: 'INV-20260807-003',
      customer_id: davidId,
      customer_name: 'David Brown',
      customer_phone: '+91-98765-43210',
      customer_country: 'India',
      order_type: 'purchase',
      currency: 'USD',
      subtotal: 74.00,
      discount: 0.00,
      tax: 7.40,
      total_amount: 81.40,
      coupon_code: null,
      payment_gateway: 'Razorpay',
      payment_method: 'Razorpay UPI',
      transaction_id: 'RAZOR-TX-1003',
      payment_status: 'pending',
      order_status: 'pending',
      download_status: 'not_downloaded',
      refund_status: 'none',
      assets_count: 4,
      downloads_count: 0,
      contributor_earnings: 42.10,
      platform_commission: 39.30,
      created_at: now,
      items: [
        {
          asset_id: 106,
          title: 'Premium Product Video',
          category: 'Videos',
          license: 'Extended',
          contributor_id: contriC.id,
          contributor_username: contriC.username,
          quantity: 1,
          unit_price: 35.00,
          total_price: 35.00,
          currency: 'USD',
          download_status: 'not_downloaded'
        },
        {
          asset_id: 107,
          title: 'Commercial Website Image',
          category: 'Images',
          license: 'Standard',
          contributor_id: contriA.id,
          contributor_username: contriA.username,
          quantity: 1,
          unit_price: 18.00,
          total_price: 18.00,
          currency: 'USD',
          download_status: 'not_downloaded'
        },
        {
          asset_id: 108,
          title: 'Cityscape Marketing Image',
          category: 'Images',
          license: 'Standard',
          contributor_id: contriB.id,
          contributor_username: contriB.username,
          quantity: 1,
          unit_price: 12.00,
          total_price: 12.00,
          currency: 'USD',
          download_status: 'not_downloaded'
        },
        {
          asset_id: 109,
          title: '3D Mockup Presentation Kit',
          category: 'Mockups',
          license: 'Extended',
          contributor_id: contriA.id,
          contributor_username: contriA.username,
          quantity: 1,
          unit_price: 9.00,
          total_price: 9.00,
          currency: 'USD',
          download_status: 'not_downloaded'
        }
      ],
      payments: [
        {
          amount: 0,
          currency: 'USD',
          gateway: 'Razorpay',
          transaction_id: 'RAZOR-TX-1003-INIT',
          status: 'pending',
          authorization_code: 'AUTH-RZ-1003',
          response: { status: 'pending', message: 'Awaiting Razorpay confirmation' }
        }
      ],
      notes: [
        {
          author_id: adminId,
          note: 'Customer selected Razorpay payment and the order is pending settlement.',
          visibility: 'admin'
        }
      ],
      activity_logs: [
        { event: 'Order created', actor_role: 'system', details: { stage: 'created' } },
        { event: 'Payment pending', actor_role: 'system', details: { gateway: 'Razorpay' } }
      ]
    });

    await pool.query('COMMIT');
    console.log('✅ Demo orders seeded successfully.');
    console.log('Admin login: admin_demo@example.com / Admin123!');
    console.log('Customer login: john.smith@example.com / Customer123!');
    console.log('Customer login: emma.johnson@example.com / Customer123!');
    console.log('Customer login: david.brown@example.com / Customer123!');
  } catch (err) {
    console.error('Failed to seed demo orders:', err);
    await pool.query('ROLLBACK');
  } finally {
    await pool.end();
  }
};

seed();
