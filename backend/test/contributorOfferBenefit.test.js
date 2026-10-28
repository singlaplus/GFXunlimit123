const assert = require("node:assert/strict");
const { test } = require("node:test");
const { registerContributorOfferBenefitRoutes } = require("../routes/contributor-offer-benefit");

function createApprovalHandler(application) {
  const statements = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      statements.push({ text, params });
      if (text.includes("SELECT applications.id")) return { rows: application ? [application] : [] };
      if (text.includes("INSERT INTO earnings")) {
        return {
          rows: [{
            id: 99,
            amount: params[1],
            currency: "INR",
            status: "pending",
            created_at: "2026-10-28T10:00:00.000Z",
          }],
        };
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
    post: (path, ...handlers) => routes.set(`POST ${path}`, handlers),
  };
  const verifyAdmin = () => {};
  registerContributorOfferBenefitRoutes(app, pool, verifyAdmin);
  const handlers = routes.get("POST /admin/promotions/applications/:applicationId/approve-benefit");
  assert.equal(handlers[0], verifyAdmin);
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

const completedBonusApplication = {
  id: 8,
  contributor_id: 2,
  status: "completed",
  benefit_earning_id: null,
  benefit_approved_at: null,
  benefit_type: "bonus_payout",
  benefit_value: "500",
};

test("approving a completed bonus adds one pending INR earning in a transaction", async () => {
  const { handler, statements } = createApprovalHandler(completedBonusApplication);
  const response = makeResponse();

  await handler({ params: { applicationId: "8" } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.application.benefit_amount, 500);
  assert.equal(response.payload.alreadyApproved, false);
  assert.ok(statements.some(({ text }) => text.includes("INSERT INTO earnings") && text.includes("'INR'") && text.includes("'pending'")));
  assert.ok(statements.some(({ text, params }) => (
    text.includes("UPDATE contributor_offer_applications")
    && text.includes("status = 'ended'")
    && params[0] === 99
  )));
  assert.equal(statements.filter(({ text }) => text.includes("INSERT INTO earnings")).length, 1);
  assert.ok(statements.some(({ text }) => text === "COMMIT"));
  assert.equal(statements.at(-1).text, "RELEASE");
});

test("repeated bonus approval does not insert a second earning", async () => {
  const { handler, statements } = createApprovalHandler({
    ...completedBonusApplication,
    status: "ended",
    benefit_earning_id: 99,
    benefit_approved_at: "2026-10-28T10:00:00.000Z",
  });
  const response = makeResponse();

  await handler({ params: { applicationId: "8" } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.alreadyApproved, true);
  assert.equal(response.payload.application.benefit_earning_id, 99);
  assert.equal(statements.filter(({ text }) => text.includes("INSERT INTO earnings")).length, 0);
  assert.ok(statements.some(({ text }) => text === "COMMIT"));
});

test("only completed bonus applications can be approved", async () => {
  const { handler, statements } = createApprovalHandler({
    ...completedBonusApplication,
    status: "pending",
  });
  const response = makeResponse();

  await handler({ params: { applicationId: "8" } }, response);

  assert.equal(response.statusCode, 409);
  assert.equal(statements.filter(({ text }) => text.includes("INSERT INTO earnings")).length, 0);
  assert.ok(statements.some(({ text }) => text === "ROLLBACK"));
});

test("rejects non-bonus and invalid-amount benefits without crediting earnings", async () => {
  for (const application of [
    { ...completedBonusApplication, benefit_type: "commission_increase" },
    { ...completedBonusApplication, benefit_value: "invalid" },
  ]) {
    const { handler, statements } = createApprovalHandler(application);
    const response = makeResponse();

    await handler({ params: { applicationId: "8" } }, response);

    assert.ok(response.statusCode === 400);
    assert.equal(statements.filter(({ text }) => text.includes("INSERT INTO earnings")).length, 0);
    assert.ok(statements.some(({ text }) => text === "ROLLBACK"));
  }
});
