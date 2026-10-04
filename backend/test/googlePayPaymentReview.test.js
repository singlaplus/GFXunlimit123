const assert = require("node:assert/strict");
const { test } = require("node:test");
const { registerOrderRoutes } = require("../orders");

async function createReviewHandler({ order = {}, payment = {} } = {}) {
  const statements = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      statements.push({ text, params });
      if (text.includes("FROM orders WHERE id = $1 FOR UPDATE")) {
        return { rows: [{ id: 12, order_number: "GFX-12", customer_id: 7, payment_method: "Google Pay", payment_status: "pending", total_amount: 50, currency: "INR", ...order }] };
      }
      if (text.includes("FROM payments") && text.includes("FOR UPDATE")) {
        return { rows: [{ id: 44, status: "pending", response: { utr: "123456789012", submittedAt: "2026-10-04T10:00:00.000Z" }, ...payment }] };
      }
      return { rows: [] };
    },
    release() {
      statements.push({ text: "RELEASE", params: [] });
    },
  };
  const pool = { connect: async () => client };
  const routes = new Map();
  const app = {
    get: (path, ...handlers) => routes.set(`GET ${path}`, handlers),
    post: (path, ...handlers) => routes.set(`POST ${path}`, handlers),
    put: (path, ...handlers) => routes.set(`PUT ${path}`, handlers),
  };
  const verifyAdmin = () => {};
  await registerOrderRoutes(app, pool, verifyAdmin, () => {});
  const handlers = routes.get("PUT /admin/orders/:id/payment-status");
  assert.equal(handlers[0], verifyAdmin, "payment review route must use admin authentication");
  return { handler: handlers[1], statements };
}

function makeResponse() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("admin approval updates the order and payment and activates downloads in one transaction", async () => {
  const { handler, statements } = await createReviewHandler();
  const response = makeResponse();

  await handler({ params: { id: "12" }, body: { decision: "approved" }, ip: "127.0.0.1", headers: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.paymentStatus, "completed");
  assert.ok(statements.some(({ text }) => text.includes("payment_status = 'completed'") && text.includes("download_status = 'available'")));
  assert.ok(statements.some(({ text }) => text.includes("UPDATE payments SET status = 'paid'")));
  assert.ok(statements.some(({ text }) => text.includes("UPDATE customer_downloads SET is_active = TRUE")));
  assert.ok(statements.some(({ text }) => text.includes("INSERT INTO downloads")));
  assert.ok(statements.some(({ text }) => text.includes("INSERT INTO order_activity_logs")));
  assert.ok(statements.some(({ text }) => text.includes("INSERT INTO payment_logs")));
  assert.ok(statements.some(({ text }) => text === "COMMIT"));
});

test("admin rejection does not activate downloads and records rejected payment status", async () => {
  const { handler, statements } = await createReviewHandler();
  const response = makeResponse();

  await handler({ params: { id: "12" }, body: { decision: "rejected" }, ip: "127.0.0.1", headers: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.paymentStatus, "rejected");
  assert.ok(statements.some(({ text }) => text.includes("payment_status = 'rejected'") && text.includes("download_status = 'blocked'")));
  assert.ok(statements.some(({ text }) => text.includes("UPDATE payments SET status = 'rejected'")));
  assert.ok(statements.some(({ text }) => text.includes("UPDATE customer_downloads SET is_active = FALSE")));
  assert.ok(!statements.some(({ text }) => text.includes("INSERT INTO downloads")));
  assert.ok(statements.some(({ params }) => params.some((value) => String(value).includes("Rejected by admin during manual payment review."))));
});

test("admin review rejects already approved payments without changing their state", async () => {
  const { handler, statements } = await createReviewHandler({
    order: { payment_status: "completed" },
    payment: { status: "paid" },
  });
  const response = makeResponse();

  await handler({ params: { id: "12" }, body: { decision: "approved" }, headers: {} }, response);

  assert.equal(response.statusCode, 409);
  assert.match(response.payload.error, /already been approved/i);
  assert.ok(!statements.some(({ text }) => text.includes("UPDATE orders")));
});
