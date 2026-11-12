const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const axios = require("axios");
const {
  decryptTokens,
  encryptTokens,
  getGoogleConfig,
  hasGoogleSearchConsoleWriteScope,
  getGooglePropertiesErrorMessage,
  getCloudflareDnsConfig,
  getCloudflareDnsRecordName,
  createOAuthState,
  verifyOAuthState,
  writeGoogleConfigToEnvFile,
  removeGoogleConfigFromEnvFile,
  createGoogleSearchConsoleRouter,
} = require("../routes/google-search-console");

const key = Buffer.alloc(32, 7);
const configuredEnvironment = {
  GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "client-id",
  GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "client-secret",
  GOOGLE_SEARCH_CONSOLE_REDIRECT_URI: "https://api.example.test/search-console/oauth/callback",
  GOOGLE_SEARCH_CONSOLE_TOKEN_KEY: key.toString("hex"),
};

test("Google Search Console config validates OAuth redirect and 32-byte encryption key", () => {
  const config = getGoogleConfig(configuredEnvironment);

  assert.equal(config.configured, true);
  assert.deepEqual(config.missing, []);
  assert.equal(getGoogleConfig({}).configured, false);
  assert.equal(
    getGoogleConfig({ ...configuredEnvironment, GOOGLE_SEARCH_CONSOLE_REDIRECT_URI: "https://evil.test/callback" }).configured,
    false
  );
});

test("Google property errors explain API, permission, and expired-authorization failures", () => {
  assert.match(
    getGooglePropertiesErrorMessage({
      response: { status: 403, data: { error: { errors: [{ reason: "accessNotConfigured" }] } } },
    }),
    /API is enabled in the same Google Cloud project/
  );
  assert.match(
    getGooglePropertiesErrorMessage({
      response: { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } },
    }),
    /does not have enough Search Console access/
  );
  assert.match(
    getGooglePropertiesErrorMessage({ response: { status: 401 } }),
    /authorization expired/
  );
});

test("Google Search Console write-scope detection distinguishes read-only and unverified connections", () => {
  assert.equal(hasGoogleSearchConsoleWriteScope("openid email https://www.googleapis.com/auth/webmasters"), true);
  assert.equal(hasGoogleSearchConsoleWriteScope("openid email https://www.googleapis.com/auth/webmasters.readonly"), false);
  assert.equal(hasGoogleSearchConsoleWriteScope(undefined), null);
});

test("Cloudflare DNS config validates scoped settings and normalizes record names", () => {
  const config = getCloudflareDnsConfig({
    CLOUDFLARE_DNS_API_TOKEN: "private-token",
    CLOUDFLARE_DNS_ZONE_ID: "a".repeat(32),
    CLOUDFLARE_DNS_ZONE_NAME: "Example.com",
  });
  assert.equal(config.configured, true);
  assert.equal(config.zoneName, "example.com");
  assert.equal(getCloudflareDnsRecordName("@", config.zoneName), "example.com");
  assert.equal(getCloudflareDnsRecordName("www", config.zoneName), "www.example.com");
  assert.equal(getCloudflareDnsRecordName("sub.example.com", config.zoneName), "sub.example.com");
  assert.throws(() => getCloudflareDnsRecordName("elsewhere.test", config.zoneName), /belong to the configured Cloudflare zone/);
  assert.equal(getCloudflareDnsConfig({ ...config, CLOUDFLARE_DNS_ZONE_ID: "invalid" }).configured, false);
});

test("Google OAuth config persists updates in a private env file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "google-search-console-"));
  const envFilePath = path.join(directory, ".env");
  try {
    fs.writeFileSync(envFilePath, "OTHER_SETTING=value\nGOOGLE_SEARCH_CONSOLE_CLIENT_ID=old-id\n");
    writeGoogleConfigToEnvFile({
      GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "new-id",
      GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "client-secret",
    }, envFilePath);
    writeGoogleConfigToEnvFile({
      GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "updated-id",
      GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "client-secret",
    }, envFilePath);

    const savedConfig = fs.readFileSync(envFilePath, "utf8");
    assert.match(savedConfig, /OTHER_SETTING=value/);
    assert.match(savedConfig, /GOOGLE_SEARCH_CONSOLE_CLIENT_ID="updated-id"/);
    assert.equal((savedConfig.match(/GOOGLE_SEARCH_CONSOLE_CLIENT_ID=/g) || []).length, 1);
    assert.equal(fs.statSync(envFilePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Google OAuth config reset removes only its keys from the env file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "google-search-console-"));
  const envFilePath = path.join(directory, ".env");
  try {
    fs.writeFileSync(
      envFilePath,
      [
        "OTHER_SETTING=value",
        "GOOGLE_SEARCH_CONSOLE_CLIENT_ID=client-id",
        " GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET = client-secret",
        "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI=https://api.example.test/callback",
        "GOOGLE_SEARCH_CONSOLE_TOKEN_KEY=token-key",
        "ANOTHER_SETTING=keep-me",
      ].join("\n")
    );

    removeGoogleConfigFromEnvFile(envFilePath);

    const savedConfig = fs.readFileSync(envFilePath, "utf8");
    assert.match(savedConfig, /OTHER_SETTING=value/);
    assert.match(savedConfig, /ANOTHER_SETTING=keep-me/);
    assert.doesNotMatch(savedConfig, /GOOGLE_SEARCH_CONSOLE_/);
    assert.equal(fs.statSync(envFilePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("admin reset endpoint deletes the connection and clears OAuth settings", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "google-search-console-"));
  const envFilePath = path.join(directory, ".env");
  const configKeys = [
    "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
    "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
    "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI",
    "GOOGLE_SEARCH_CONSOLE_TOKEN_KEY",
  ];
  const previousEnvironment = Object.fromEntries(configKeys.map((key) => [key, process.env[key]]));
  fs.writeFileSync(envFilePath, "OTHER_SETTING=keep-me\nGOOGLE_SEARCH_CONSOLE_CLIENT_ID=client-id\n");
  configKeys.forEach((key) => { process.env[key] = "configured"; });

  const queries = [];
  const app = express();
  app.use(createGoogleSearchConsoleRouter({
    pool: { query: async (...args) => { queries.push(args); return { rows: [] }; } },
    verifyAdmin: (_req, _res, next) => next(),
    allowedOrigins: new Set(),
    envFilePath,
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/search-console/config`, {
      method: "DELETE",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.configured, false);
    assert.equal(body.connected, false);
    assert.match(queries[0][0], /DELETE FROM google_search_console_connections/);
    assert.ok(configKeys.every((key) => process.env[key] === undefined));
    assert.equal(fs.readFileSync(envFilePath, "utf8").trim(), "OTHER_SETTING=keep-me");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("admin can save a property available to the connected Google account and reset it", async () => {
  const configKeys = [
    "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
    "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
    "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI",
    "GOOGLE_SEARCH_CONSOLE_TOKEN_KEY",
  ];
  const previousEnvironment = Object.fromEntries(configKeys.map((key) => [key, process.env[key]]));
  const originalAxiosGet = axios.get;
  Object.assign(process.env, configuredEnvironment);
  const savedQueries = [];
  const selectedSiteUrl = "https://example.com/";
  const accessToken = "test-access-token";
  const encryptedTokens = encryptTokens({
    access_token: accessToken,
    refresh_token: "test-refresh-token",
    expires_at: Date.now() + 60 * 60 * 1000,
  }, key);
  axios.get = async () => ({
    data: { siteEntry: [{ siteUrl: selectedSiteUrl, permissionLevel: "siteOwner" }] },
  });

  const app = express();
  app.use(express.json());
  app.use(createGoogleSearchConsoleRouter({
    pool: {
      query: async (sql, params = []) => {
        savedQueries.push({ sql, params });
        if (/SELECT encrypted_tokens/.test(sql)) {
          return { rows: [{ encrypted_tokens: encryptedTokens }] };
        }
        return { rows: [], rowCount: 1 };
      },
    },
    verifyAdmin: (_req, _res, next) => next(),
    allowedOrigins: new Set(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/admin/search-console/property`;
    const saveResponse = await fetch(baseUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteUrl: selectedSiteUrl }),
    });
    const saveBody = await saveResponse.json();

    assert.equal(saveResponse.status, 200);
    assert.equal(saveBody.selectedProperty, selectedSiteUrl);
    assert.match(savedQueries.at(-1).sql, /SET selected_property = \$1/);
    assert.deepEqual(savedQueries.at(-1).params, [selectedSiteUrl]);

    const invalidResponse = await fetch(baseUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteUrl: "https://not-available.example/" }),
    });
    assert.equal(invalidResponse.status, 400);

    const resetResponse = await fetch(baseUrl, { method: "DELETE" });
    const resetBody = await resetResponse.json();
    assert.equal(resetResponse.status, 200);
    assert.equal(resetBody.selectedProperty, "");
    assert.match(savedQueries.at(-1).sql, /SET selected_property = NULL/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    axios.get = originalAxiosGet;
    for (const [keyName, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[keyName];
      else process.env[keyName] = value;
    }
  }
});

test("admin can load performance metrics for the saved Search Console property", async () => {
  const configKeys = [
    "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
    "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
    "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI",
    "GOOGLE_SEARCH_CONSOLE_TOKEN_KEY",
  ];
  const previousEnvironment = Object.fromEntries(configKeys.map((keyName) => [keyName, process.env[keyName]]));
  const originalAxiosPost = axios.post;
  Object.assign(process.env, configuredEnvironment);
  const selectedSiteUrl = "https://example.com/";
  const encryptedTokens = encryptTokens({
    access_token: "performance-access-token",
    refresh_token: "performance-refresh-token",
    expires_at: Date.now() + 60 * 60 * 1000,
  }, key);
  const requests = [];
  axios.post = async (...args) => {
    requests.push(args);
    if (args[1].dimensions?.[0] === "date") {
      return { data: { rows: [{ keys: ["2026-10-28"], clicks: 4, impressions: 120 }] } };
    }
    return requests.length === 1
      ? { data: { rows: [{ clicks: 42, impressions: 1200, ctr: 0.035, position: 4.2 }] } }
      : { data: { rows: [{ keys: ["best query"], clicks: 12, impressions: 300, ctr: 0.04, position: 2.5 }] } };
  };
  const app = express();
  app.use(express.json());
  app.use(createGoogleSearchConsoleRouter({
    pool: {
      query: async (sql) => {
        if (/SELECT selected_property/.test(sql)) return { rows: [{ selected_property: selectedSiteUrl }] };
        if (/SELECT encrypted_tokens/.test(sql)) return { rows: [{ encrypted_tokens: encryptedTokens }] };
        return { rows: [] };
      },
    },
    verifyAdmin: (_req, _res, next) => next(),
    allowedOrigins: new Set(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/admin/search-console/performance`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: "2026-10-01", endDate: "2026-10-28", dimension: "query" }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.siteUrl, selectedSiteUrl);
    assert.deepEqual(body.totals, { clicks: 42, impressions: 1200, ctr: 0.035, position: 4.2 });
    assert.deepEqual(body.rows[0].keys, ["best query"]);
    assert.deepEqual(body.trend[0].keys, ["2026-10-28"]);
    assert.match(requests[0][0], /https%3A%2F%2Fexample\.com%2F\/searchAnalytics\/query/);
    assert.deepEqual(requests[1][1].dimensions, ["query"]);
    assert.equal(requests[1][1].rowLimit, 100);
    assert.deepEqual(requests[2][1].dimensions, ["date"]);

    const invalidResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: "2026-02-30", endDate: "2026-03-01", dimension: "query" }),
    });
    assert.equal(invalidResponse.status, 400);
    assert.equal(requests.length, 3);

    for (const dimension of ["searchAppearance", "date"]) {
      const dimensionResponse = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: "2026-10-01", endDate: "2026-10-28", dimension }),
      });
      const dimensionBody = await dimensionResponse.json();
      assert.equal(dimensionResponse.status, 200);
      assert.equal(dimensionBody.dimension, dimension);
      assert.deepEqual(requests.at(-2)[1].dimensions, [dimension]);
    }
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    axios.post = originalAxiosPost;
    for (const [keyName, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[keyName];
      else process.env[keyName] = value;
    }
  }
});

test("admin can inspect a URL only within the saved Search Console property", async () => {
  const configKeys = [
    "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
    "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
    "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI",
    "GOOGLE_SEARCH_CONSOLE_TOKEN_KEY",
  ];
  const previousEnvironment = Object.fromEntries(configKeys.map((keyName) => [keyName, process.env[keyName]]));
  const originalAxiosPost = axios.post;
  Object.assign(process.env, configuredEnvironment);
  const selectedSiteUrl = "sc-domain:gfxunlimit.com";
  const encryptedTokens = encryptTokens({
    access_token: "inspection-access-token",
    refresh_token: "inspection-refresh-token",
    expires_at: Date.now() + 60 * 60 * 1000,
  }, key);
  const requests = [];
  axios.post = async (...args) => {
    requests.push(args);
    return {
      data: {
        inspectionResult: {
          indexStatusResult: {
            verdict: "PASS",
            coverageState: "Submitted and indexed",
            indexingState: "INDEXING_ALLOWED",
            pageFetchState: "SUCCESSFUL",
            sitemap: ["https://gfxunlimit.com/sitemap.xml"],
          },
        },
      },
    };
  };
  const app = express();
  app.use(express.json());
  app.use(createGoogleSearchConsoleRouter({
    pool: {
      query: async (sql) => {
        if (/SELECT selected_property/.test(sql)) return { rows: [{ selected_property: selectedSiteUrl }] };
        if (/SELECT encrypted_tokens/.test(sql)) return { rows: [{ encrypted_tokens: encryptedTokens }] };
        return { rows: [] };
      },
    },
    verifyAdmin: (_req, _res, next) => next(),
    allowedOrigins: new Set(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/admin/search-console/url-inspection`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inspectionUrl: "https://www.gfxunlimit.com/gallery" }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.siteUrl, selectedSiteUrl);
    assert.equal(body.indexStatus.verdict, "PASS");
    assert.equal(body.indexStatus.coverageState, "Submitted and indexed");
    assert.deepEqual(body.indexStatus.sitemap, ["https://gfxunlimit.com/sitemap.xml"]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect");
    assert.deepEqual(requests[0][1], {
      inspectionUrl: "https://www.gfxunlimit.com/gallery",
      siteUrl: selectedSiteUrl,
      languageCode: "en-US",
    });

    const outsidePropertyResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inspectionUrl: "https://gfxunlimit.com.evil.test/gallery" }),
    });
    assert.equal(outsidePropertyResponse.status, 400);
    assert.equal(requests.length, 1);

    const invalidUrlResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inspectionUrl: "javascript:alert(1)" }),
    });
    assert.equal(invalidUrlResponse.status, 400);
    assert.equal(requests.length, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    axios.post = originalAxiosPost;
    for (const [keyName, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[keyName];
      else process.env[keyName] = value;
    }
  }
});

test("admin can load an overview of Search Console metrics, trends, top rows, and sitemaps", async () => {
  const configKeys = [
    "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
    "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
    "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI",
    "GOOGLE_SEARCH_CONSOLE_TOKEN_KEY",
  ];
  const previousEnvironment = Object.fromEntries(configKeys.map((keyName) => [keyName, process.env[keyName]]));
  const originalAxiosGet = axios.get;
  const originalAxiosPost = axios.post;
  Object.assign(process.env, configuredEnvironment);
  const selectedSiteUrl = "sc-domain:gfxunlimit.com";
  const encryptedTokens = encryptTokens({
    access_token: "overview-access-token",
    refresh_token: "overview-refresh-token",
    expires_at: Date.now() + 60 * 60 * 1000,
  }, key);
  const requests = [];
  axios.post = async (...args) => {
    requests.push(args);
    const dimensions = args[1].dimensions || [];
    if (dimensions.includes("date")) {
      return { data: { rows: [{ keys: ["2026-11-01"], clicks: 12, impressions: 300, ctr: 0.04, position: 3.2 }] } };
    }
    if (dimensions.includes("query")) {
      return { data: { rows: [{ keys: ["gfx graphics"], clicks: 24, impressions: 500, ctr: 0.048, position: 2.4 }] } };
    }
    if (dimensions.includes("page")) {
      return { data: { rows: [{ keys: ["https://gfxunlimit.com/photos"], clicks: 60, impressions: 1000, ctr: 0.06, position: 1.8 }] } };
    }
    return { data: { rows: [{ clicks: 120, impressions: 4200, ctr: 0.0286, position: 5.4 }] } };
  };
  axios.get = async (...args) => {
    assert.match(args[0], /sitemaps$/);
    return { data: { sitemap: [{ path: "https://gfxunlimit.com/sitemap.xml", isPending: false, errors: 0, warnings: 0 }] } };
  };
  const app = express();
  app.use(express.json());
  app.use(createGoogleSearchConsoleRouter({
    pool: {
      query: async (sql) => {
        if (/SELECT selected_property/.test(sql)) return { rows: [{ selected_property: selectedSiteUrl }] };
        if (/SELECT encrypted_tokens/.test(sql)) return { rows: [{ encrypted_tokens: encryptedTokens }] };
        return { rows: [] };
      },
    },
    verifyAdmin: (_req, _res, next) => next(),
    allowedOrigins: new Set(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/admin/search-console/overview`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: "2026-10-10", endDate: "2026-11-06" }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.siteUrl, selectedSiteUrl);
    assert.deepEqual(body.totals, { clicks: 120, impressions: 4200, ctr: 0.0286, position: 5.4 });
    assert.deepEqual(body.trend[0].keys, ["2026-11-01"]);
    assert.deepEqual(body.topQueries[0].keys, ["gfx graphics"]);
    assert.deepEqual(body.topPages[0].keys, ["https://gfxunlimit.com/photos"]);
    assert.deepEqual(body.sitemaps[0], {
      path: "https://gfxunlimit.com/sitemap.xml",
      isPending: false,
      errors: 0,
      warnings: 0,
      lastSubmitted: null,
    });
    assert.equal(requests.length, 4);

    const invalidResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: "2026-02-30", endDate: "2026-03-01" }),
    });
    assert.equal(invalidResponse.status, 400);
    assert.equal(requests.length, 4);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    axios.get = originalAxiosGet;
    axios.post = originalAxiosPost;
    for (const [keyName, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[keyName];
      else process.env[keyName] = value;
    }
  }
});

test("admin can submit and list sitemaps for the saved Search Console property", async () => {
  const configKeys = [
    "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
    "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
    "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI",
    "GOOGLE_SEARCH_CONSOLE_TOKEN_KEY",
  ];
  const previousEnvironment = Object.fromEntries(configKeys.map((keyName) => [keyName, process.env[keyName]]));
  const originalAxiosGet = axios.get;
  const originalAxiosPut = axios.put;
  Object.assign(process.env, configuredEnvironment);
  const selectedSiteUrl = "https://gfxunlimit.com/";
  const sitemapUrl = "https://gfxunlimit.com/sitemap.xml";
  const encryptedTokens = encryptTokens({
    access_token: "sitemap-access-token",
    refresh_token: "sitemap-refresh-token",
    expires_at: Date.now() + 60 * 60 * 1000,
  }, key);
  const listedSitemaps = [{ path: sitemapUrl, isPending: false, errors: 0, warnings: 0 }];
  const requests = [];
  axios.get = async (...args) => {
    requests.push({ method: "GET", args });
    return { data: { sitemap: listedSitemaps } };
  };
  axios.put = async (...args) => {
    requests.push({ method: "PUT", args });
    return { status: 204 };
  };
  const app = express();
  app.use(express.json());
  app.use(createGoogleSearchConsoleRouter({
    pool: {
      query: async (sql) => {
        if (/SELECT selected_property/.test(sql)) return { rows: [{ selected_property: selectedSiteUrl }] };
        if (/SELECT encrypted_tokens/.test(sql)) return { rows: [{ encrypted_tokens: encryptedTokens }] };
        return { rows: [] };
      },
    },
    verifyAdmin: (_req, _res, next) => next(),
    allowedOrigins: new Set(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/admin/search-console/sitemaps`;
    const submitResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sitemapUrl: ` ${sitemapUrl} ` }),
    });
    const submitBody = await submitResponse.json();
    assert.equal(submitResponse.status, 200);
    assert.equal(submitBody.sitemapUrl, sitemapUrl);
    assert.match(requests[0].args[0], /sitemaps\/https%3A%2F%2Fgfxunlimit\.com%2Fsitemap\.xml$/);

    const listResponse = await fetch(endpoint);
    const listBody = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.deepEqual(listBody.sitemaps, listedSitemaps);

    const invalidResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sitemapUrl: "https://other.example/sitemap.xml" }),
    });
    assert.equal(invalidResponse.status, 400);
    assert.equal(requests.filter((request) => request.method === "PUT").length, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    axios.get = originalAxiosGet;
    axios.put = originalAxiosPut;
    for (const [keyName, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[keyName];
      else process.env[keyName] = value;
    }
  }
});

test("admin can securely save Cloudflare settings and publish a Google TXT record", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cloudflare-search-console-"));
  const envFilePath = path.join(directory, ".env");
  const configKeys = ["CLOUDFLARE_DNS_API_TOKEN", "CLOUDFLARE_DNS_ZONE_ID", "CLOUDFLARE_DNS_ZONE_NAME"];
  const previousEnvironment = Object.fromEntries(configKeys.map((keyName) => [keyName, process.env[keyName]]));
  configKeys.forEach((keyName) => { delete process.env[keyName]; });
  const originalAxiosGet = axios.get;
  const originalAxiosPost = axios.post;
  const cloudflareRequests = [];
  axios.get = async (...args) => {
    cloudflareRequests.push({ method: "GET", args });
    return { data: { success: true, result: [] } };
  };
  axios.post = async (...args) => {
    cloudflareRequests.push({ method: "POST", args });
    return { data: { success: true, result: { id: "created-record" } } };
  };

  const app = express();
  app.use(express.json());
  app.use(createGoogleSearchConsoleRouter({
    pool: { query: async () => ({ rows: [] }) },
    verifyAdmin: (_req, _res, next) => next(),
    allowedOrigins: new Set(),
    envFilePath,
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/admin/search-console/ownership`;
    const token = "private-cloudflare-token";
    const zoneId = "b".repeat(32);
    const settingsResponse = await fetch(`${baseUrl}/cloudflare-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiToken: token, zoneId, zoneName: "example.com" }),
    });
    assert.equal(settingsResponse.status, 200);
    assert.equal((await settingsResponse.json()).configured, true);
    assert.match(fs.readFileSync(envFilePath, "utf8"), /CLOUDFLARE_DNS_API_TOKEN="private-cloudflare-token"/);

    const statusResponse = await fetch(`${baseUrl}/cloudflare-status`);
    const status = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(status.tokenConfigured, true);
    assert.equal(Object.hasOwn(status, "apiToken"), false);

    const publishResponse = await fetch(`${baseUrl}/dns-record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "@", content: "google-site-verification=abc123" }),
    });
    const publishBody = await publishResponse.json();
    assert.equal(publishResponse.status, 200);
    assert.equal(publishBody.created, true);
    assert.equal(publishBody.recordName, "example.com");
    assert.match(cloudflareRequests[0].args[0], new RegExp(zoneId));
    assert.equal(cloudflareRequests[0].args[1].headers.Authorization, `Bearer ${token}`);
    assert.equal(cloudflareRequests[1].args[1].content, "google-site-verification=abc123");
    assert.equal(cloudflareRequests[1].args[1].type, "TXT");

    const invalidResponse = await fetch(`${baseUrl}/dns-record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "elsewhere.test", content: "google-site-verification=abc123" }),
    });
    assert.equal(invalidResponse.status, 400);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    axios.get = originalAxiosGet;
    axios.post = originalAxiosPost;
    for (const [keyName, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[keyName];
      else process.env[keyName] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Google OAuth tokens are encrypted and can be decrypted with the configured key", () => {
  const tokens = { access_token: "access", refresh_token: "refresh", expires_at: 123 };
  const encrypted = encryptTokens(tokens, key);

  assert.equal(encrypted.includes(tokens.refresh_token), false);
  assert.deepEqual(decryptTokens(encrypted, key), tokens);
  assert.throws(() => decryptTokens(encrypted, Buffer.alloc(32, 8)));
});

test("Google OAuth state is origin-bound, signed, and expires", () => {
  const origin = "https://admin.example.test";
  const allowedOrigins = new Set([origin]);
  const createdAt = 1_800_000_000_000;
  const state = createOAuthState(origin, key, createdAt);

  assert.equal(verifyOAuthState(state, key, allowedOrigins, createdAt).origin, origin);
  assert.throws(() => verifyOAuthState(state, Buffer.alloc(32, 8), allowedOrigins, createdAt));
  assert.throws(() => verifyOAuthState(state, key, new Set(["https://other.example.test"]), createdAt));
  assert.throws(() => verifyOAuthState(state, key, allowedOrigins, createdAt + 11 * 60 * 1000));
});
