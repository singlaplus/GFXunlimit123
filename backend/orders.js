const express = require("express");

function formatValue(value) {
  return value === null || value === undefined ? null : value;
}

function buildOrderFilters(query) {
  const filters = ["1=1"];
  const values = [];

  const addFilter = (condition) => {
    filters.push(condition);
  };

  const search = query.search ? String(query.search).trim() : "";
  const orderStatus = query.orderStatus ? String(query.orderStatus).trim() : "";
  const paymentStatus = query.paymentStatus ? String(query.paymentStatus).trim() : "";
  const refundStatus = query.refundStatus ? String(query.refundStatus).trim() : "";
  const downloadStatus = query.downloadStatus ? String(query.downloadStatus).trim() : "";
  const customerId = query.customerId ? String(query.customerId).trim() : "";
  const contributorId = query.contributorId ? String(query.contributorId).trim() : "";
  const assetId = query.assetId ? String(query.assetId).trim() : "";
  const category = query.category ? String(query.category).trim() : "";
  const gateway = query.paymentGateway ? String(query.paymentGateway).trim() : "";
  const couponCode = query.couponCode ? String(query.couponCode).trim() : "";
  const invoiceNumber = query.invoiceNumber ? String(query.invoiceNumber).trim() : "";
  const transactionId = query.transactionId ? String(query.transactionId).trim() : "";
  const dateFrom = query.dateFrom ? String(query.dateFrom).trim() : "";
  const dateTo = query.dateTo ? String(query.dateTo).trim() : "";
  const currency = query.currency ? String(query.currency).trim() : "";
  const orderType = query.orderType ? String(query.orderType).trim() : "";
  const country = query.country ? String(query.country).trim() : "";

  if (orderStatus) {
    values.push(orderStatus);
    addFilter(`o.order_status = $${values.length}`);
  }

  if (paymentStatus) {
    values.push(paymentStatus);
    addFilter(`o.payment_status = $${values.length}`);
  }

  if (refundStatus) {
    values.push(refundStatus);
    addFilter(`o.refund_status = $${values.length}`);
  }

  if (downloadStatus) {
    values.push(downloadStatus);
    addFilter(`o.download_status = $${values.length}`);
  }

  if (customerId) {
    values.push(customerId);
    addFilter(`o.customer_id::text = $${values.length}`);
  }

  if (gateway) {
    values.push(gateway);
    addFilter(`o.payment_gateway ILIKE $${values.length}`);
  }

  if (couponCode) {
    values.push(`%${couponCode}%`);
    addFilter(`o.coupon_code ILIKE $${values.length}`);
  }

  if (invoiceNumber) {
    values.push(`%${invoiceNumber}%`);
    addFilter(`o.invoice_number ILIKE $${values.length}`);
  }

  if (transactionId) {
    values.push(`%${transactionId}%`);
    addFilter(`o.transaction_id ILIKE $${values.length}`);
  }

  if (country) {
    values.push(`%${country}%`);
    addFilter(`o.customer_country ILIKE $${values.length}`);
  }

  if (currency) {
    values.push(currency);
    addFilter(`o.currency = $${values.length}`);
  }

  if (orderType) {
    values.push(orderType);
    addFilter(`o.order_type = $${values.length}`);
  }

  if (category) {
    values.push(`%${category}%`);
    addFilter(`EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.category ILIKE $${values.length})`);
  }

  if (assetId) {
    values.push(assetId);
    addFilter(`EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.asset_id::text = $${values.length})`);
  }

  if (contributorId) {
    values.push(contributorId);
    addFilter(`EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.contributor_id::text = $${values.length})`);
  }

  if (search) {
    values.push(`%${search}%`);
    values.push(`%${search}%`);
    values.push(`%${search}%`);
    values.push(`%${search}%`);
    values.push(`%${search}%`);
    values.push(`%${search}%`);
    addFilter(`(
      o.order_number ILIKE $${values.length - 5} OR
      o.invoice_number ILIKE $${values.length - 4} OR
      u.username ILIKE $${values.length - 3} OR
      u.email ILIKE $${values.length - 2} OR
      o.transaction_id ILIKE $${values.length - 1} OR
      o.coupon_code ILIKE $${values.length}
    )`);
  }

  if (dateFrom) {
    values.push(dateFrom);
    addFilter(`o.created_at >= $${values.length}`);
  }

  if (dateTo) {
    values.push(dateTo);
    addFilter(`o.created_at <= $${values.length}`);
  }

  return {
    filterSql: filters.join(" AND "),
    values,
  };
}

function buildOrderAnalyticsSummary() {
  return `
    WITH customer_counts AS (
      SELECT customer_id, COUNT(*) AS total_orders
      FROM orders
      GROUP BY customer_id
    )
    SELECT
      COUNT(*)::int AS total_orders,
      SUM(CASE WHEN o.created_at::date = CURRENT_DATE THEN 1 ELSE 0 END)::int AS today_orders,
      SUM(CASE WHEN o.created_at::date = CURRENT_DATE - INTERVAL '1 day' THEN 1 ELSE 0 END)::int AS yesterday_orders,
      SUM(CASE WHEN o.created_at >= CURRENT_DATE - INTERVAL '6 days' THEN 1 ELSE 0 END)::int AS weekly_orders,
      SUM(CASE WHEN o.created_at >= date_trunc('month', CURRENT_DATE) THEN 1 ELSE 0 END)::int AS monthly_orders,
      SUM(CASE WHEN o.created_at >= date_trunc('year', CURRENT_DATE) THEN 1 ELSE 0 END)::int AS yearly_orders,
      SUM(CASE WHEN o.order_status = 'pending' THEN 1 ELSE 0 END)::int AS pending_orders,
      SUM(CASE WHEN o.order_status = 'completed' THEN 1 ELSE 0 END)::int AS completed_orders,
      SUM(CASE WHEN o.order_status = 'failed' THEN 1 ELSE 0 END)::int AS failed_orders,
      SUM(CASE WHEN o.order_status = 'cancelled' THEN 1 ELSE 0 END)::int AS cancelled_orders,
      SUM(CASE WHEN o.refund_status = 'refunded' THEN 1 ELSE 0 END)::int AS refunded_orders,
      SUM(CASE WHEN o.refund_status = 'partially_refunded' THEN 1 ELSE 0 END)::int AS partially_refunded_orders,
      COALESCE(ROUND(AVG(o.total_amount)::numeric, 2), 0)::numeric AS average_order_value,
      COALESCE(SUM(o.total_amount), 0)::numeric AS total_revenue,
      COALESCE(SUM(CASE WHEN o.created_at::date = CURRENT_DATE THEN o.total_amount ELSE 0 END), 0)::numeric AS todays_revenue,
      COALESCE(SUM(CASE WHEN o.created_at >= date_trunc('month', CURRENT_DATE) THEN o.total_amount ELSE 0 END), 0)::numeric AS monthly_revenue,
      COALESCE(SUM(o.assets_count), 0)::int AS assets_sold,
      COALESCE(SUM(o.downloads_count), 0)::int AS assets_downloaded,
      COUNT(DISTINCT o.customer_id)::int AS total_customers,
      COUNT(DISTINCT CASE WHEN cc.total_orders > 1 THEN o.customer_id END)::int AS returning_customers,
      SUM(CASE WHEN o.order_type = 'subscription' THEN 1 ELSE 0 END)::int AS subscription_orders
    FROM orders o
    LEFT JOIN customer_counts cc ON cc.customer_id = o.customer_id
  `;
}

async function registerOrderRoutes(app, pool, verifyAdmin, authenticateToken) {
  app.get("/admin/orders/summary", verifyAdmin, async (req, res) => {
    try {
      const summary = await pool.query(buildOrderAnalyticsSummary());
      res.json(summary.rows[0] || {});
    } catch (err) {
      console.error("Failed to load order summary", err);
      res.status(500).json({ error: "Failed to load order summary" });
    }
  });

  app.get("/admin/orders/recent", verifyAdmin, async (req, res) => {
    try {
      const recentResult = await pool.query(`
        SELECT
          o.id,
          o.order_number,
          o.invoice_number,
          o.created_at,
          o.currency,
          o.total_amount,
          o.order_status,
          o.refund_status,
          o.customer_id,
          o.customer_name,
          u.username AS customer_username,
          u.email AS customer_email
        FROM orders o
        LEFT JOIN users u ON o.customer_id = u.id
        ORDER BY o.created_at DESC
        LIMIT 12
      `);
      res.json(recentResult.rows || []);
    } catch (err) {
      console.error("Failed to load recent orders", err);
      res.status(500).json({ error: "Failed to load recent orders" });
    }
  });

  app.get("/admin/orders", verifyAdmin, async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 25));
      const offset = (page - 1) * limit;
      const { filterSql, values } = buildOrderFilters(req.query);

      const totalQuery = `SELECT COUNT(*)::int AS total FROM orders o LEFT JOIN users u ON o.customer_id = u.id WHERE ${filterSql}`;
      const totalResult = await pool.query(totalQuery, values);
      const total = totalResult.rows[0]?.total || 0;

      const ordersQuery = `
        SELECT
          o.id,
          o.order_number,
          o.invoice_number,
          o.created_at,
          o.order_type,
          o.currency,
          o.exchange_rate,
          o.subtotal,
          o.discount,
          o.tax,
          o.total_amount,
          o.coupon_code,
          o.payment_gateway,
          o.payment_method,
          o.transaction_id,
          o.payment_status,
          o.order_status,
          o.download_status,
          o.refund_status,
          o.support_status,
          o.assets_count,
          o.downloads_count,
          o.contributor_earnings,
          o.platform_commission,
          o.customer_id,
          u.username AS customer_username,
          u.email AS customer_email,
          o.customer_country
        FROM orders o
        LEFT JOIN users u ON o.customer_id = u.id
        WHERE ${filterSql}
        ORDER BY o.created_at DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `;

      const ordersResult = await pool.query(ordersQuery, [...values, limit, offset]);
      res.json({ orders: ordersResult.rows, total, page, limit });
    } catch (err) {
      console.error("Failed to load orders", err);
      res.status(500).json({ error: "Failed to load orders" });
    }
  });

  app.get("/admin/orders/analytics", verifyAdmin, async (req, res) => {
    try {
      const [revenueTrend, orderTrend, salesByCategory, salesByContributor, topSellingAssets, topCustomers, paymentGatewayDistribution, refundTrend, countryWiseRevenue, hourlySales, downloadTrend] = await Promise.all([
        pool.query(`
          SELECT DATE(created_at) AS label, COALESCE(SUM(total_amount), 0) AS value
          FROM orders
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(created_at)
          ORDER BY DATE(created_at)
        `),
        pool.query(`
          SELECT DATE(created_at) AS label, COUNT(*)::int AS value
          FROM orders
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(created_at)
          ORDER BY DATE(created_at)
        `),
        pool.query(`
          SELECT category AS name, SUM(total_price) AS value, SUM(quantity)::int AS sold
          FROM order_items
          GROUP BY category
          ORDER BY value DESC
          LIMIT 8
        `),
        pool.query(`
          SELECT contributor_id, contributor_username AS name, SUM(total_price) AS gross_revenue, SUM(total_price) AS contributor_earnings
          FROM order_items
          GROUP BY contributor_id, contributor_username
          ORDER BY gross_revenue DESC
          LIMIT 8
        `),
        pool.query(`
          SELECT asset_id, title AS name, COUNT(*)::int AS sold, SUM(total_price) AS revenue
          FROM order_items
          GROUP BY asset_id, title
          ORDER BY revenue DESC
          LIMIT 8
        `),
        pool.query(`
          SELECT u.id, u.username AS name, u.email, COUNT(*)::int AS orders, SUM(o.total_amount) AS revenue
          FROM orders o
          LEFT JOIN users u ON o.customer_id = u.id
          GROUP BY u.id, u.username, u.email
          ORDER BY revenue DESC
          LIMIT 8
        `),
        pool.query(`
          SELECT COALESCE(payment_gateway, 'Unknown') AS name, COUNT(*)::int AS value
          FROM orders
          GROUP BY payment_gateway
          ORDER BY value DESC
          LIMIT 8
        `),
        pool.query(`
          SELECT DATE(created_at) AS label, COALESCE(SUM(amount), 0) AS value
          FROM refunds
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(created_at)
          ORDER BY DATE(created_at)
        `),
        pool.query(`
          SELECT COALESCE(customer_country, 'Unknown') AS name, SUM(total_amount) AS value
          FROM orders
          GROUP BY customer_country
          ORDER BY value DESC
          LIMIT 10
        `),
        pool.query(`
          SELECT TO_CHAR(DATE_TRUNC('hour', created_at), 'YYYY-MM-DD HH24:00') AS label, COALESCE(SUM(total_amount), 0) AS value
          FROM orders
          WHERE created_at >= NOW() - INTERVAL '24 hours'
          GROUP BY DATE_TRUNC('hour', created_at)
          ORDER BY DATE_TRUNC('hour', created_at)
        `),
        pool.query(`
          SELECT DATE(created_at) AS label, SUM(downloads_count) AS value
          FROM orders
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(created_at)
          ORDER BY DATE(created_at)
        `)
      ]);

      res.json({
        revenueTrend: revenueTrend.rows,
        orderTrend: orderTrend.rows,
        salesByCategory: salesByCategory.rows,
        salesByContributor: salesByContributor.rows,
        topSellingAssets: topSellingAssets.rows,
        topCustomers: topCustomers.rows,
        paymentGatewayDistribution: paymentGatewayDistribution.rows,
        refundTrend: refundTrend.rows,
        countryWiseRevenue: countryWiseRevenue.rows,
        hourlySales: hourlySales.rows,
        downloadTrend: downloadTrend.rows
      });
    } catch (err) {
      console.error("Failed to load analytics data", err);
      res.status(500).json({ error: "Failed to load analytics data" });
    }
  });

  app.post("/admin/orders/reset", verifyAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("DELETE FROM orders");
      await client.query("COMMIT");
      res.json({ deleted: result.rowCount || 0 });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Failed to reset order statistics", err);
      res.status(500).json({ error: "Failed to reset order statistics" });
    } finally {
      client.release();
    }
  });

  app.get("/orders", authenticateToken, async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(5, Number(req.query.limit) || 20));
      const offset = (page - 1) * limit;
      const customerId = Number(req.user.id);

      const totalResult = await pool.query(`SELECT COUNT(*)::int AS total FROM orders WHERE customer_id = $1`, [customerId]);
      const ordersResult = await pool.query(`
        SELECT
          id,
          order_number,
          invoice_number,
          created_at,
          order_status,
          payment_status,
          refund_status,
          total_amount,
          currency,
          order_type,
          assets_count,
          downloads_count
        FROM orders
        WHERE customer_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        OFFSET $3
      `, [customerId, limit, offset]);

      res.json({ orders: ordersResult.rows, total: totalResult.rows[0]?.total || 0, page, limit });
    } catch (err) {
      console.error("Failed to load customer orders", err);
      res.status(500).json({ error: "Failed to load customer orders" });
    }
  });

  app.get("/orders/:id", authenticateToken, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      if (!orderId || Number.isNaN(orderId)) {
        return res.status(400).json({ error: "Invalid order id" });
      }

      const orderDetail = await fetchOrderDetail(orderId);
      if (!orderDetail) {
        return res.status(404).json({ error: "Order not found" });
      }

      if (Number(orderDetail.order.customer_id) !== Number(req.user.id)) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(orderDetail);
    } catch (err) {
      console.error("Failed to load customer order detail", err);
      res.status(500).json({ error: "Failed to load order detail" });
    }
  });

  async function fetchOrderDetail(orderId) {
    const orderResult = await pool.query(`
      SELECT
        o.*, u.full_name AS customer_full_name, u.username AS customer_username, u.email AS customer_email, u.phone AS customer_phone, u.country AS customer_country, u.created_at AS customer_registered_at,
        (SELECT p.response->>'upiId' FROM payments p WHERE p.order_id = o.id AND p.response->>'upiId' IS NOT NULL ORDER BY p.created_at DESC LIMIT 1) AS payer_upi_id
      FROM orders o
      LEFT JOIN users u ON o.customer_id = u.id
      WHERE o.id = $1
    `, [orderId]);

    if (orderResult.rows.length === 0) {
      return null;
    }

    const [
      itemsResult,
      customerDownloadsResult,
      paymentsResult,
      refundsResult,
      notesResult,
      activityResult,
      customerHistoryResult
    ] = await Promise.all([
      pool.query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC`, [orderId]),
      pool.query(`SELECT id, user_id, image_id, download_token, license, expires_at, is_active, created_at FROM customer_downloads WHERE order_id = $1`, [orderId]),
      pool.query(`SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC`, [orderId]),
      pool.query(`SELECT * FROM refunds WHERE order_id = $1 ORDER BY created_at DESC`, [orderId]),
      pool.query(`SELECT n.*, u.username AS author_username FROM order_notes n LEFT JOIN users u ON n.author_id = u.id WHERE n.order_id = $1 ORDER BY created_at DESC`, [orderId]),
      pool.query(`SELECT * FROM order_activity_logs WHERE order_id = $1 ORDER BY created_at DESC`, [orderId]),
      pool.query(`
        SELECT id, order_number, invoice_number, total_amount, order_status, created_at
        FROM orders
        WHERE customer_id = $1
        ORDER BY created_at DESC
        LIMIT 10
      `, [orderResult.rows[0].customer_id])
    ]);

    return {
      order: orderResult.rows[0],
      items: itemsResult.rows,
      customerDownloads: customerDownloadsResult.rows,
      payments: paymentsResult.rows,
      refunds: refundsResult.rows,
      notes: notesResult.rows,
      activity: activityResult.rows,
      customerHistory: customerHistoryResult.rows
    };
  }

  app.get("/admin/orders/:id", verifyAdmin, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      if (!orderId || Number.isNaN(orderId)) {
        return res.status(400).json({ error: "Invalid order id" });
      }

      const orderDetail = await fetchOrderDetail(orderId);
      if (!orderDetail) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.json(orderDetail);
    } catch (err) {
      console.error("Failed to load order details", err);
      res.status(500).json({ error: "Failed to load order details" });
    }
  });

  app.get("/admin/orders/:id/detail", verifyAdmin, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      if (!orderId || Number.isNaN(orderId)) {
        return res.status(400).json({ error: "Invalid order id" });
      }

      const orderDetail = await fetchOrderDetail(orderId);
      if (!orderDetail) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.json(orderDetail);
    } catch (err) {
      console.error("Failed to load order detail alias", err);
      res.status(500).json({ error: "Failed to load order detail" });
    }
  });

  app.put("/admin/orders/:id/status", verifyAdmin, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const { status, supportStatus, paymentStatus, refundStatus } = req.body;

      if (!orderId || Number.isNaN(orderId)) {
        return res.status(400).json({ error: "Invalid order id" });
      }

      const fields = [];
      const values = [];

      if (status) {
        values.push(status);
        fields.push(`order_status = $${values.length}`);
      }
      if (supportStatus) {
        values.push(supportStatus);
        fields.push(`support_status = $${values.length}`);
      }
      if (paymentStatus) {
        values.push(paymentStatus);
        fields.push(`payment_status = $${values.length}`);
      }
      if (refundStatus) {
        values.push(refundStatus);
        fields.push(`refund_status = $${values.length}`);
      }

      if (fields.length === 0) {
        return res.status(400).json({ error: "No status fields provided" });
      }

      values.push(orderId);
      const updateQuery = `UPDATE orders SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`;
      const updateResult = await pool.query(updateQuery, values);

      if (updateResult.rows.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      await pool.query(`
        INSERT INTO order_activity_logs (order_id, event, actor_role, details, ip_address, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [
        orderId,
        "Order status updated",
        "admin",
        JSON.stringify({ status, supportStatus, paymentStatus, refundStatus }),
        req.ip || req.headers["x-forwarded-for"] || null
      ]);

      res.json(updateResult.rows[0]);
    } catch (err) {
      console.error("Failed to update order status", err);
      res.status(500).json({ error: "Failed to update order status" });
    }
  });

  app.post("/admin/orders/:id/notes", verifyAdmin, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const { note, visibility = "admin" } = req.body;
      const authorId = req.user || null;

      if (!orderId || Number.isNaN(orderId)) {
        return res.status(400).json({ error: "Invalid order id" });
      }
      if (!note || !String(note).trim()) {
        return res.status(400).json({ error: "Note text is required" });
      }

      const insertResult = await pool.query(`
        INSERT INTO order_notes (order_id, author_id, visibility, note, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
      `, [orderId, authorId, visibility, String(note).trim()]);

      res.json(insertResult.rows[0]);
    } catch (err) {
      console.error("Failed to save order note", err);
      res.status(500).json({ error: "Failed to save order note" });
    }
  });

  app.post("/admin/orders/:id/refund", verifyAdmin, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const amount = Number(req.body.amount || 0);
      const reason = String(req.body.reason || "").trim();
      const note = String(req.body.note || "").trim();
      const approved = req.body.approved === true || req.body.approved === "true";

      if (!orderId || Number.isNaN(orderId)) {
        return res.status(400).json({ error: "Invalid order id" });
      }
      if (!amount || Number.isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Refund amount must be greater than zero" });
      }

      const orderResult = await pool.query(`SELECT total_amount, refund_status FROM orders WHERE id = $1`, [orderId]);
      if (orderResult.rows.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      const totalAmount = Number(orderResult.rows[0].total_amount || 0);
      const refundStatus = approved
        ? amount >= totalAmount ? "refunded" : "partially_refunded"
        : "refund_requested";
      const approvalStatus = approved ? "approved" : "requested";

      const refundResult = await pool.query(`
        INSERT INTO refunds (order_id, amount, currency, status, reason, note, approved_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING *
      `, [orderId, amount, "USD", approvalStatus, reason, note, approved ? new Date() : null]);

      await pool.query(`
        UPDATE orders
        SET refund_status = $1,
            updated_at = NOW()
        WHERE id = $2
      `, [refundStatus, orderId]);

      await pool.query(`
        INSERT INTO order_activity_logs (order_id, event, actor_role, details, ip_address, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [
        orderId,
        approved ? "Refund approved" : "Refund requested",
        "admin",
        JSON.stringify({ amount, reason, note, refundStatus }),
        req.ip || req.headers["x-forwarded-for"] || null
      ]);

      res.json(refundResult.rows[0]);
    } catch (err) {
      console.error("Failed to create refund record", err);
      res.status(500).json({ error: "Failed to create refund record" });
    }
  });

  app.get("/admin/orders/customers/:customerId/history", verifyAdmin, async (req, res) => {
    try {
      const customerId = Number(req.params.customerId);
      if (!customerId || Number.isNaN(customerId)) {
        return res.status(400).json({ error: "Invalid customer id" });
      }

      const history = await pool.query(`
        SELECT id, order_number, invoice_number, total_amount, order_status, payment_status, created_at
        FROM orders
        WHERE customer_id = $1
        ORDER BY created_at DESC
        LIMIT 10
      `, [customerId]);

      res.json(history.rows);
    } catch (err) {
      console.error("Failed to load customer history", err);
      res.status(500).json({ error: "Failed to load customer history" });
    }
  });

  app.get("/admin/orders/contributors/:contributorId/sales", verifyAdmin, async (req, res) => {
    try {
      const contributorId = Number(req.params.contributorId);
      if (!contributorId || Number.isNaN(contributorId)) {
        return res.status(400).json({ error: "Invalid contributor id" });
      }

      const sales = await pool.query(`
        SELECT
          contributor_id,
          contributor_username,
          COUNT(DISTINCT order_id)::int AS orders,
          SUM(total_price)::numeric AS gross_revenue,
          SUM(total_price)::numeric AS contributor_earnings,
          SUM(commission_amount)::numeric AS commission_amount,
          SUM(quantity)::int AS assets_sold
        FROM order_items
        WHERE contributor_id = $1
        GROUP BY contributor_id, contributor_username
      `, [contributorId]);

      res.json(sales.rows[0] || {});
    } catch (err) {
      console.error("Failed to load contributor sales", err);
      res.status(500).json({ error: "Failed to load contributor sales" });
    }
  });
}

module.exports = {
  registerOrderRoutes,
};
