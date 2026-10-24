const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyLink,
  createLinksScanner,
  extractRenderedLinks,
  normalizeOrigin,
} = require("../services/linksScanner");

test("classifies and extracts rendered links without unsupported protocols", () => {
  assert.equal(classifyLink("/pricing", "https://app.example"), "Internal");
  assert.equal(classifyLink("https://outside.example/docs", "https://app.example"), "External");
  assert.equal(classifyLink("mailto:help@example.com", "https://app.example"), "Email");
  assert.equal(classifyLink("javascript:void(0)", "https://app.example"), null);
  assert.deepEqual(
    extractRenderedLinks([
      { href: "/pricing", text: "  Pricing  " },
      { href: "javascript:void(0)", text: "Unsafe" },
      { href: "http://[", text: "Malformed" },
      { href: "mailto:help@example.com", ariaLabel: "Email us" },
    ], "https://app.example/about", "https://app.example"),
    [
      {
        pageUrl: "https://app.example/about",
        text: "Pricing",
        href: "https://app.example/pricing",
        type: "Internal",
      },
      {
        pageUrl: "https://app.example/about",
        text: "Email us",
        href: "mailto:help@example.com",
        type: "Email",
      },
    ]
  );
});

test("accepts only exact trusted frontend origins", () => {
  const trustedOrigins = new Set(["https://app.example"]);
  assert.equal(normalizeOrigin("https://app.example", trustedOrigins), "https://app.example");
  assert.throws(() => normalizeOrigin("https://outside.example", trustedOrigins), /trusted frontend origin/);
  assert.throws(() => normalizeOrigin("https://app.example/path", trustedOrigins), /trusted frontend origin/);
});

test("requires a valid user, trusted origin, and signed-in token before persisting a scan", async () => {
  let queryCount = 0;
  const scanner = createLinksScanner({
    pool: { query: async () => { queryCount += 1; return { rows: [] }; } },
    allowedOrigins: new Set(["https://app.example"]),
    chromium: { launch: async () => { throw new Error("Browser must not launch."); } },
    logger: { warn() {}, error() {} },
  });

  await assert.rejects(
    scanner.start(12, { origin: "https://outside.example", authorization: "Bearer token" }),
    /trusted frontend origin/
  );
  await assert.rejects(
    scanner.start(12, { origin: "https://app.example", authorization: "invalid" }),
    /signed-in admin authorization token/
  );
  await assert.rejects(
    scanner.start(0, { origin: "https://app.example", authorization: "Bearer token" }),
    /valid signed-in admin/
  );
  assert.equal(queryCount, 0);
  await scanner.close();
});

test("filters and paginates links from only the requested admin's saved scan", async () => {
  const storedRow = {
    scan_id: "scan-id",
    status: "completed",
    links: [
      { pageUrl: "https://app.example/", text: "Home", href: "https://app.example/", type: "Internal" },
      { pageUrl: "https://app.example/", text: "Docs", href: "https://docs.example/", type: "External" },
      { pageUrl: "https://app.example/about", text: "Pricing", href: "https://app.example/pricing", type: "Internal" },
    ],
    errors: [],
    pages_scanned: 10,
    total_pages: 10,
    started_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:01:00Z",
  };
  const queries = [];
  const scanner = createLinksScanner({
    pool: {
      query: async (sql, values) => {
        queries.push({ sql, values });
        return { rows: [storedRow] };
      },
    },
    allowedOrigins: new Set(["https://app.example"]),
  });

  const response = await scanner.getResults(42, { page: 2, pageSize: 1, type: "Internal" });
  const exported = await scanner.getExportLinks(42, { search: "pricing", type: "Internal" });

  assert.deepEqual(queries[0].values, ["42"]);
  assert.match(queries[0].sql, /WHERE user_id = \$1/);
  assert.deepEqual(response.links, [storedRow.links[2]]);
  assert.deepEqual(response.pagination, { page: 2, pageSize: 1, total: 2, totalPages: 2 });
  assert.deepEqual(response.summary, { total: 3, internal: 2, external: 1 });
  assert.deepEqual(exported.links, [storedRow.links[2]]);
  await assert.rejects(
    scanner.getResults(42, { type: "Unsupported" }),
    /Link type must be All, Internal, External, Email, or Phone/
  );
  await scanner.close();
});

test("scans rendered pages and forwards authorization only to the trusted app origin", async () => {
  const routedRequests = [];
  let storedRow = null;
  let completePersistence;
  const persisted = new Promise((resolve) => { completePersistence = resolve; });
  const pool = {
    async query(_sql, values) {
      storedRow = {
        user_id: values[0],
        scan_id: values[1],
        status: values[2],
        links: JSON.parse(values[3]),
        errors: JSON.parse(values[4]),
        pages_scanned: values[5],
        total_pages: values[6],
        error: values[7],
        started_at: values[8],
        completed_at: values[9],
      };
      if (storedRow.status === "completed") completePersistence();
      return { rows: [] };
    },
  };
  const chromium = {
    async launch() {
      return {
        async newContext() {
          return {
            async newPage() {
              let routeHandler;
              return {
                async route(_pattern, handler) { routeHandler = handler; },
                async addInitScript() {},
                async goto(url) {
                  for (const requestUrl of [url, "https://outside.example/asset.js"]) {
                    await routeHandler({
                      request: () => ({
                        url: () => requestUrl,
                        headers: () => ({ authorization: "Bearer stale", accept: "text/html" }),
                      }),
                      continue: async ({ headers }) => routedRequests.push({ url: requestUrl, headers }),
                    });
                  }
                },
                async waitForLoadState() {},
                async waitForTimeout() {},
                locator() {
                  return {
                    evaluateAll: async () => [
                      { href: "https://app.example/pricing", text: "Pricing" },
                      { href: "https://outside.example/", text: "External" },
                    ],
                  };
                },
                async close() {},
              };
            },
            async close() {},
          };
        },
        async close() {},
      };
    },
  };
  const scanner = createLinksScanner({
    pool,
    chromium,
    allowedOrigins: new Set(["https://app.example"]),
    paths: ["/"],
    concurrency: 1,
    pageTimeout: 50,
    logger: { warn() {}, error() {} },
  });

  const job = await scanner.start(42, {
    origin: "https://app.example",
    authorization: "Bearer signed-in-token",
  });
  await persisted;
  assert.equal(job.status, "running");
  assert.equal(storedRow.status, "completed");
  assert.deepEqual(storedRow.links.map(({ type }) => type), ["Internal", "External"]);

  const internalRequest = routedRequests.find(({ url }) => url === "https://app.example/");
  const externalRequest = routedRequests.find(({ url }) => url === "https://outside.example/asset.js");
  assert.equal(internalRequest.headers.authorization, "Bearer signed-in-token");
  assert.equal("authorization" in externalRequest.headers, false);
  assert.equal(externalRequest.headers.accept, "text/html");
  await scanner.close();
});

test("persists backend browser launch failures for the signed-in admin", async () => {
  let storedRow = null;
  let reportFailure;
  const failureSaved = new Promise((resolve) => { reportFailure = resolve; });
  const scanner = createLinksScanner({
    pool: {
      async query(sql, values) {
        if (sql.startsWith("SELECT")) return { rows: [storedRow] };
        storedRow = {
          scan_id: values[1],
          status: values[2],
          links: JSON.parse(values[3]),
          errors: JSON.parse(values[4]),
          pages_scanned: values[5],
          total_pages: values[6],
          error: values[7],
          started_at: values[8],
          completed_at: values[9],
        };
        if (storedRow.status === "failed") reportFailure();
        return { rows: [] };
      },
    },
    chromium: { launch: async () => { throw new Error("Chrome is unavailable."); } },
    allowedOrigins: new Set(["https://app.example"]),
    logger: { warn() {}, error() {} },
    paths: ["/"],
  });

  await scanner.start(42, {
    origin: "https://app.example",
    authorization: "Bearer signed-in-token",
  });
  await failureSaved;

  const status = await scanner.getStatus(42);
  assert.equal(status.status, "failed");
  assert.equal(status.error, "The backend could not complete the app link scan.");
  await scanner.close();
});
