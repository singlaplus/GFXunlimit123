const test = require("node:test");
const assert = require("node:assert/strict");
const { createRedirectRulesService, normalizeRedirectFrom, normalizeRedirectTo } = require("../services/redirectRules");

test("normalizes safe redirect paths and targets", () => {
  assert.equal(normalizeRedirectFrom("/old-page/"), "/old-page");
  assert.equal(normalizeRedirectFrom("/old-page?source=email"), "/old-page?source=email");
  assert.equal(normalizeRedirectTo("/new-page/"), "/new-page");
  assert.equal(normalizeRedirectTo("https://example.com/new"), "https://example.com/new");
});

test("rejects unsafe or invalid redirect values", () => {
  assert.throws(() => normalizeRedirectFrom("https://other.example/old"), /internal path/);
  assert.throws(() => normalizeRedirectTo("javascript:alert(1)"), /safe HTTP/);
  assert.throws(() => normalizeRedirectTo("//other.example"), /safe HTTP/);
});

test("prefers an exact query match before a path-only rule", async () => {
  const queries = [];
  const service = createRedirectRulesService({
    query: async (text, params) => {
      queries.push({ text, params });
      return { rows: [{ id: 2, redirect_from: "/old?campaign=summer", redirect_to: "/summer" }] };
    },
  });

  const rule = await service.find("/old?campaign=summer");

  assert.equal(rule.redirect_to, "/summer");
  assert.match(queries[0].text, /enabled IS TRUE/);
  assert.deepEqual(queries[0].params, ["/old?campaign=summer", "/old"]);
});

test("updates and returns a redirect rule's enabled state", async () => {
  const queries = [];
  const service = createRedirectRulesService({
    query: async (text, params) => {
      queries.push({ text, params });
      return {
        rows: [{
          id: 7,
          redirect_from: "/old-page",
          redirect_to: "/new-page",
          enabled: false
        }]
      };
    },
  });

  const rule = await service.setEnabled(7, false);

  assert.equal(rule.enabled, false);
  assert.deepEqual(queries[0].params, [7, false]);
  assert.match(queries[0].text, /UPDATE redirect_rules/);
});
