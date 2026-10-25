const test = require("node:test");
const assert = require("node:assert/strict");
const { updateCurrencyRates } = require("../currency/currencyScheduler");

test("manual currency updates preserve fixed prices when automatic updates are disabled", async () => {
  const queries = [];
  const settings = {
    id: 7,
    auto_update_exchange_rate: false,
    inr_amount: 100,
    usd_amount: 3,
    eur_amount: 4,
  };
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.startsWith("SELECT")) {
        return { rows: [settings] };
      }
      return { rows: [{ ...settings, exchange_rate: values[0] }] };
    },
  };

  const result = await updateCurrencyRates(pool, {
    force: true,
    fetchRates: async () => ({ USD: 0.012, EUR: 0.011 }),
  });

  assert.deepEqual(result, { ...settings, exchange_rate: "83.3333" });
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1].values, ["83.3333", 7]);
  assert.doesNotMatch(queries[1].sql, /usd_amount|eur_amount/i);
});

test("scheduled currency updates still respect the automatic update setting", async () => {
  let queryCount = 0;
  const pool = {
    async query() {
      queryCount += 1;
      return { rows: [{ id: 7, auto_update_exchange_rate: false }] };
    },
  };

  const result = await updateCurrencyRates(pool, {
    fetchRates: async () => {
      assert.fail("Rates should not be fetched when automatic updates are disabled.");
    },
  });

  assert.equal(result, null);
  assert.equal(queryCount, 1);
});
