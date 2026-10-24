const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createLinksScanRouter } = require("../routes/links-scan-routes");

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(baseUrl, route, options = {}) {
  return fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { connection: "close", ...options.headers },
  });
}

test("authenticates, validates trusted scan origins, and scopes scan calls to the signed-in admin", async (context) => {
  const calls = [];
  const scanner = {
    async getStatus(userId) {
      calls.push(["status", userId]);
      return { status: "completed" };
    },
    async start(userId, options) {
      calls.push(["start", userId, options]);
      return { scanId: "scan-1", status: "running" };
    },
    async getResults(userId, options) {
      calls.push(["results", userId, options]);
      if (options.pageSize > 100) throw new TypeError("Page size must not exceed 100.");
      return {
        status: "completed",
        links: [],
        pagination: { page: Number(options.page), pageSize: Number(options.pageSize), total: 0, totalPages: 1 },
      };
    },
    async getExportLinks(userId, options) {
      calls.push(["export", userId, options]);
      return {
        status: "completed",
        links: [{
          text: '=SUM(1,2)',
          href: 'https://app.example/a,"b"',
          type: "Internal",
          pageUrl: "https://app.example/",
        }, {
          text: "Other link",
          href: "https://app.example/other",
          type: "Internal",
          pageUrl: "https://app.example/",
        }],
      };
    },
  };
  const disabledPages = new Set();
  const disabledLinkRows = new Map();
  const pool = {
    async query(sql, values) {
      if (sql.startsWith("SELECT path, disabled_at")) {
        return { rows: [...disabledPages].map((path) => ({ path, disabled_at: "2026-01-01T00:00:00Z" })) };
      }
      if (sql.startsWith("SELECT 1 FROM admin_disabled_app_pages")) {
        return { rowCount: disabledPages.has(values[0]) ? 1 : 0, rows: [] };
      }
      if (sql.startsWith("INSERT INTO admin_disabled_app_pages")) {
        disabledPages.add(values[0]);
        return { rows: [{ path: values[0], disabled_at: "2026-01-01T00:00:00Z" }] };
      }
      if (sql.startsWith("DELETE FROM admin_disabled_app_pages")) {
        disabledPages.delete(values[0]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("FROM admin_disabled_app_link_rows WHERE source_path = $1")) {
        return {
          rows: [...disabledLinkRows.values()]
            .filter((link) => link.source_path === values[0])
            .map(({ href, link_text }) => ({ href, linkText: link_text })),
          rowCount: [...disabledLinkRows.values()].filter((link) => link.source_path === values[0]).length,
        };
      }
      if (sql.includes("WHERE source_path = ANY($1::text[])")) {
        return {
          rows: [...disabledLinkRows.values()].filter((link) => values[0].includes(link.source_path)),
        };
      }
      if (sql.startsWith("SELECT source_path, href, link_text, disabled_at")) {
        const rows = [...disabledLinkRows.values()];
        return {
          rows: values?.length ? rows.filter((link) => link.source_path === values[0]) : rows,
          rowCount: rows.length,
        };
      }
      if (sql.startsWith("INSERT INTO admin_disabled_app_link_rows")) {
        const row = {
          source_path: values[0],
          href: values[1],
          link_text: values[2],
          disabled_at: "2026-01-01T00:00:00Z",
        };
        disabledLinkRows.set(JSON.stringify([row.source_path, row.href, row.link_text]), row);
        return { rows: [row], rowCount: 1 };
      }
      if (sql.startsWith("DELETE FROM admin_disabled_app_link_rows")) {
        disabledLinkRows.delete(JSON.stringify(values.slice(0, 3)));
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const verifyAdmin = (req, res, next) => {
    if (req.get("authorization") !== "Bearer test-token") return res.status(401).json({ error: "Unauthorized" });
    req.user = { id: 23 };
    return next();
  };
  const app = express();
  app.use(express.json());
  app.use(createLinksScanRouter({
    scanner,
    verifyAdmin,
    allowedOrigins: new Set(["https://app.example"]),
    pool,
  }));
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  context.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  const unauthorized = await request(baseUrl, "/admin/links/scan");
  assert.equal(unauthorized.status, 401);

  const missingOrigin = await request(baseUrl, "/admin/links/scan", {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(missingOrigin.status, 400);
  assert.equal(calls.length, 0);

  const start = await request(baseUrl, "/admin/links/scan", {
    method: "POST",
    headers: { authorization: "Bearer test-token", origin: "https://app.example" },
  });
  assert.equal(start.status, 202);
  assert.deepEqual(calls[0], [
    "start",
    23,
    { origin: "https://app.example", authorization: "Bearer test-token" },
  ]);

  const results = await request(baseUrl, "/admin/links/scan/results?page=2&pageSize=100", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(results.status, 200);
  assert.deepEqual(calls[1], ["results", 23, {
    page: "2",
    pageSize: "100",
    search: undefined,
    type: undefined,
  }]);

  const oversizedPage = await request(baseUrl, "/admin/links/scan/results?pageSize=101", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(oversizedPage.status, 400);

  disabledLinkRows.set(JSON.stringify(["/", 'https://app.example/a,"b"', "=SUM(1,2)"]), {
    source_path: "/",
    href: 'https://app.example/a,"b"',
    link_text: "=SUM(1,2)",
    disabled_at: "2026-01-01T00:00:00Z",
  });
  const exported = await request(baseUrl, "/admin/links/scan/export?search=docs&type=External", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-type"), /text\/csv/);
  assert.match(exported.headers.get("content-disposition"), /attachment; filename="app-links-\d{4}-\d{2}-\d{2}\.csv"/);
  const csvBytes = new Uint8Array(await exported.arrayBuffer());
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(
    new TextDecoder().decode(csvBytes.slice(3)),
    '"Link text","Destination","Type","Found on","Status"\r\n"\'=SUM(1,2)","https://app.example/a,""b""","Internal","https://app.example/","Disabled"\r\n"Other link","https://app.example/other","Internal","https://app.example/","Enabled"'
  );
  assert.deepEqual(calls.at(-1), ["export", 23, { search: "docs", type: "External" }]);

  const disabledAvailability = await request(baseUrl, "/pages/availability?path=%2Fpricing");
  assert.equal(disabledAvailability.status, 200);
  assert.deepEqual(await disabledAvailability.json(), {
    path: "/pricing",
    available: true,
    disabledLinks: [],
  });

  const disablePage = await request(baseUrl, "/admin/links/disabled-pages", {
    method: "PUT",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ path: "/pricing/" }),
  });
  assert.equal(disablePage.status, 200);
  assert.equal((await disablePage.json()).page.path, "/pricing");

  const unavailablePage = await request(baseUrl, "/pages/availability?path=%2Fpricing");
  assert.deepEqual(await unavailablePage.json(), { path: "/pricing", available: false, disabledLinks: [] });

  const disableOnlyUsersTab = await request(baseUrl, "/admin/links/disabled-pages", {
    method: "PUT",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ path: "/admin?tab=users" }),
  });
  assert.equal(disableOnlyUsersTab.status, 200);
  assert.equal((await disableOnlyUsersTab.json()).page.path, "/admin?tab=users");
  const usersTabAvailability = await request(baseUrl, "/pages/availability?path=%2Fadmin%3Ftab%3Dusers");
  assert.deepEqual(await usersTabAvailability.json(), { path: "/admin?tab=users", available: false, disabledLinks: [] });
  const linksTabAvailability = await request(baseUrl, "/pages/availability?path=%2Fadmin%3Ftab%3Dlinks");
  assert.deepEqual(await linksTabAvailability.json(), {
    path: "/admin?tab=links",
    available: true,
    disabledLinks: [],
  });

  const disabledList = await request(baseUrl, "/admin/links/disabled-pages", {
    headers: { authorization: "Bearer test-token" },
  });
  assert.deepEqual(
    (await disabledList.json()).pages.map((page) => page.path).sort(),
    ["/admin?tab=users", "/pricing"].sort()
  );

  const invalidDisable = await request(baseUrl, "/admin/links/disabled-pages", {
    method: "PUT",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ path: "https://outside.example/" }),
  });
  assert.equal(invalidDisable.status, 400);

  const enablePage = await request(baseUrl, "/admin/links/disabled-pages", {
    method: "DELETE",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ path: "/pricing" }),
  });
  assert.deepEqual(await enablePage.json(), { path: "/pricing", disabled: false });

  const enabledAgain = await request(baseUrl, "/pages/availability?path=%2Fpricing");
  assert.deepEqual(await enabledAgain.json(), { path: "/pricing", available: true, disabledLinks: [] });

  const enableOnlyUsersTab = await request(baseUrl, "/admin/links/disabled-pages", {
    method: "DELETE",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ path: "/admin?tab=users" }),
  });
  assert.equal(enableOnlyUsersTab.status, 200);
  const usersTabEnabled = await request(baseUrl, "/pages/availability?path=%2Fadmin%3Ftab%3Dusers");
  assert.deepEqual(await usersTabEnabled.json(), {
    path: "/admin?tab=users",
    available: true,
    disabledLinks: [],
  });

  const disabledRow = await request(baseUrl, "/admin/links/disabled-rows", {
    method: "PUT",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({
      sourcePath: "/search",
      href: "https://app.example/privacy",
      text: "Privacy Policy",
    }),
  });
  assert.equal(disabledRow.status, 200);
  assert.deepEqual(await disabledRow.json(), {
    link: {
      source_path: "/search",
      href: "https://app.example/privacy",
      link_text: "Privacy Policy",
      disabled_at: "2026-01-01T00:00:00Z",
    },
  });
  const searchAvailability = await request(baseUrl, "/pages/availability?path=%2Fsearch");
  assert.deepEqual(await searchAvailability.json(), {
    path: "/search",
    available: true,
    disabledLinks: [{ href: "https://app.example/privacy", linkText: "Privacy Policy" }],
  });
  const pricingAvailability = await request(baseUrl, "/pages/availability?path=%2Fpricing");
  assert.deepEqual(await pricingAvailability.json(), {
    path: "/pricing",
    available: true,
    disabledLinks: [],
  });

  const disableExternalLink = await request(baseUrl, "/admin/links/disabled-rows", {
    method: "PUT",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({
      sourcePath: "/search",
      href: "https://outside.example/privacy",
      text: "Privacy Policy",
    }),
  });
  assert.equal(disableExternalLink.status, 400);

  const enableRow = await request(baseUrl, "/admin/links/disabled-rows", {
    method: "DELETE",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({
      sourcePath: "/search",
      href: "https://app.example/privacy",
      text: "Privacy Policy",
    }),
  });
  assert.equal(enableRow.status, 200);
});
