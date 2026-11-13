const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const axios = require("axios");
const {
  createGoogleAnalyticsRouter,
  getGoogleAnalyticsOAuthConfig,
  normalizeGoogleAnalyticsMeasurementId,
  normalizeGoogleTagManagerId,
} = require("../routes/google-analytics");
const { encryptTokens, verifyOAuthState } = require("../routes/google-search-console");

test("Google Analytics OAuth config validates its callback and persistent encryption key", () => {
  const key = Buffer.alloc(32, 9);
  const searchConsoleFallbackConfig = getGoogleAnalyticsOAuthConfig({
    GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "search-console-client",
    GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "search-console-secret",
    GOOGLE_ANALYTICS_REDIRECT_URI: "https://api.example.test/google-analytics/oauth/callback",
    GOOGLE_ANALYTICS_TOKEN_KEY: key.toString("hex"),
  });
  assert.equal(searchConsoleFallbackConfig.configured, true);
  assert.equal(searchConsoleFallbackConfig.clientCredentialsSource, "google-search-console");
  assert.equal(searchConsoleFallbackConfig.clientId, "search-console-client");
  assert.equal(searchConsoleFallbackConfig.clientSecret, "search-console-secret");

  const config = getGoogleAnalyticsOAuthConfig({
    GOOGLE_ANALYTICS_CLIENT_ID: "analytics-client",
    GOOGLE_ANALYTICS_CLIENT_SECRET: "analytics-secret",
    GOOGLE_ANALYTICS_REDIRECT_URI: "https://api.example.test/google-analytics/oauth/callback",
    GOOGLE_ANALYTICS_TOKEN_KEY: key.toString("hex"),
  });

  assert.equal(config.configured, true);
  assert.equal(config.clientCredentialsSource, "google-analytics");
  assert.deepEqual(config.missing, []);
  assert.equal(getGoogleAnalyticsOAuthConfig({}).configured, false);
  assert.equal(getGoogleAnalyticsOAuthConfig({
    GOOGLE_ANALYTICS_CLIENT_ID: "analytics-client",
    GOOGLE_ANALYTICS_CLIENT_SECRET: "analytics-secret",
    GOOGLE_ANALYTICS_REDIRECT_URI: "https://api.example.test/other/callback",
    GOOGLE_ANALYTICS_TOKEN_KEY: key.toString("hex"),
  }).configured, false);
});

test("Google Analytics settings reuse Search Console OAuth credentials and save only GA-specific settings", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "google-analytics-config-"));
  const envFilePath = path.join(directory, ".env");
  const environmentKeys = [
    "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
    "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
    "GOOGLE_ANALYTICS_CLIENT_ID",
    "GOOGLE_ANALYTICS_CLIENT_SECRET",
    "GOOGLE_ANALYTICS_REDIRECT_URI",
    "GOOGLE_ANALYTICS_TOKEN_KEY",
  ];
  const previousEnvironment = Object.fromEntries(environmentKeys.map((name) => [name, process.env[name]]));
  const searchConsoleEnvironment = {
    GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "shared-client-id",
    GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "shared-client-secret",
  };
  const tokenKey = Buffer.alloc(32, 4).toString("hex");
  environmentKeys.forEach((name) => { delete process.env[name]; });
  Object.entries(searchConsoleEnvironment).forEach(([name, value]) => { process.env[name] = value; });
  fs.writeFileSync(envFilePath, "OTHER_SETTING=keep-me\n");

  const app = express();
  app.use(express.json());
  app.use(createGoogleAnalyticsRouter({
    pool: { query: async () => ({ rows: [] }) },
    verifyAdmin: (_req, _res, next) => next(),
    envFilePath,
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const missingResponse = await fetch(`${baseUrl}/admin/google-analytics/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missingResponse.status, 400);
    assert.deepEqual((await missingResponse.json()).missingConfiguration, [
      "GOOGLE_ANALYTICS_REDIRECT_URI",
      "GOOGLE_ANALYTICS_TOKEN_KEY (32-byte hex or base64 key)",
    ]);

    const saveResponse = await fetch(`${baseUrl}/admin/google-analytics/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirectUri: "http://localhost:5000/google-analytics/oauth/callback",
        tokenKey,
      }),
    });
    assert.equal(saveResponse.status, 200);
    const savedConfig = await saveResponse.json();
    assert.equal(savedConfig.configured, true);
    assert.equal(savedConfig.usingSearchConsoleOAuthCredentials, true);
    assert.equal(JSON.stringify(savedConfig).includes(tokenKey), false);
    assert.equal(process.env.GOOGLE_ANALYTICS_REDIRECT_URI, "http://localhost:5000/google-analytics/oauth/callback");
    assert.equal(process.env.GOOGLE_ANALYTICS_TOKEN_KEY, tokenKey);

    const connectionResponse = await fetch(`${baseUrl}/admin/google-analytics/connection`);
    const connection = await connectionResponse.json();
    assert.equal(connection.configured, true);
    assert.equal(connection.redirectUri, "http://localhost:5000/google-analytics/oauth/callback");
    assert.equal(connection.tokenKeyConfigured, true);
    assert.equal(connection.usingSearchConsoleOAuthCredentials, true);
    assert.equal(connection.connected, false);

    const envContents = fs.readFileSync(envFilePath, "utf8");
    assert.match(envContents, /OTHER_SETTING=keep-me/);
    assert.match(envContents, /GOOGLE_ANALYTICS_REDIRECT_URI=/);
    assert.match(envContents, /GOOGLE_ANALYTICS_TOKEN_KEY=/);
    assert.doesNotMatch(envContents, /GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("GA4 and Google Tag Manager IDs are normalized and validated independently", () => {
  assert.equal(normalizeGoogleAnalyticsMeasurementId(" g-abc1234567 "), "G-ABC1234567");
  assert.equal(normalizeGoogleAnalyticsMeasurementId("GTM-T2NG27X8"), null);
  assert.equal(normalizeGoogleTagManagerId(" gtm-t2ng27x8 "), "GTM-T2NG27X8");
  assert.equal(normalizeGoogleTagManagerId("G-ABC1234567"), null);
  assert.equal(normalizeGoogleAnalyticsMeasurementId(""), "");
  assert.equal(normalizeGoogleTagManagerId(""), "");
});

test("Google Analytics OAuth opens a signed consent flow and stores encrypted tokens", async () => {
  const key = Buffer.alloc(32, 6);
  const origin = "http://localhost:3000";
  const previousEnvironment = {};
  const environment = {
    GOOGLE_ANALYTICS_CLIENT_ID: "analytics-client",
    GOOGLE_ANALYTICS_CLIENT_SECRET: "analytics-secret",
    GOOGLE_ANALYTICS_REDIRECT_URI: "https://api.example.test/google-analytics/oauth/callback",
    GOOGLE_ANALYTICS_TOKEN_KEY: key.toString("hex"),
  };
  for (const [name, value] of Object.entries(environment)) {
    previousEnvironment[name] = process.env[name];
    process.env[name] = value;
  }

  const originalAxiosPost = axios.post;
  const originalAxiosGet = axios.get;
  axios.post = async (url, body) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.match(body, /client_secret=analytics-secret/);
    return {
      data: {
        access_token: "google-access-token",
        refresh_token: "google-refresh-token",
        expires_in: 3600,
        scope: "openid email https://www.googleapis.com/auth/analytics.readonly",
      },
    };
  };
  axios.get = async (url, options) => {
    assert.equal(url, "https://openidconnect.googleapis.com/v1/userinfo");
    assert.equal(options.headers.Authorization, "Bearer google-access-token");
    return { data: { email: "analytics@example.test" } };
  };

  let encryptedTokens = "";
  let accountEmail = null;
  let connected = false;
  const pool = {
    query: async (sql, params = []) => {
      if (/INSERT INTO google_analytics_connections/.test(sql)) {
        encryptedTokens = params[0];
        accountEmail = params[1];
        connected = true;
        return { rows: [] };
      }
      if (/SELECT account_email, connected_at/.test(sql)) {
        return { rows: connected ? [{ account_email: accountEmail, connected_at: "now" }] : [] };
      }
      if (/DELETE FROM google_analytics_connections/.test(sql)) {
        connected = false;
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const app = express();
  app.use(createGoogleAnalyticsRouter({
    pool,
    verifyAdmin: (_req, _res, next) => next(),
    allowedOrigins: new Set([origin]),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const connectResponse = await fetch(`${baseUrl}/admin/google-analytics/connect`, {
      method: "POST",
      headers: { Origin: origin },
    });
    assert.equal(connectResponse.status, 200);
    const { authorizationUrl } = await connectResponse.json();
    const googleUrl = new URL(authorizationUrl);
    assert.equal(googleUrl.origin, "https://accounts.google.com");
    assert.equal(googleUrl.searchParams.get("client_id"), "analytics-client");
    assert.equal(googleUrl.searchParams.get("redirect_uri"), environment.GOOGLE_ANALYTICS_REDIRECT_URI);
    assert.match(googleUrl.searchParams.get("scope"), /analytics\.readonly/);
    assert.equal(verifyOAuthState(googleUrl.searchParams.get("state"), key, new Set([origin])).origin, origin);

    const callbackResponse = await fetch(
      `${baseUrl}/google-analytics/oauth/callback?code=auth-code&state=${encodeURIComponent(googleUrl.searchParams.get("state"))}`
    );
    assert.equal(callbackResponse.status, 200);
    assert.match(await callbackResponse.text(), /google-analytics-oauth/);
    assert.equal(accountEmail, "analytics@example.test");
    assert.ok(encryptedTokens);
    assert.equal(encryptedTokens.includes("google-refresh-token"), false);

    const statusResponse = await fetch(`${baseUrl}/admin/google-analytics/connection`);
    assert.deepEqual(await statusResponse.json(), {
      configured: true,
      missingConfiguration: [],
      redirectUri: environment.GOOGLE_ANALYTICS_REDIRECT_URI,
      tokenKeyConfigured: true,
      usingSearchConsoleOAuthCredentials: false,
      connected: true,
      accountEmail: "analytics@example.test",
      connectedAt: "now",
    });

    const disconnectResponse = await fetch(`${baseUrl}/admin/google-analytics/connection`, { method: "DELETE" });
    assert.deepEqual(await disconnectResponse.json(), { connected: false });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    axios.post = originalAxiosPost;
    axios.get = originalAxiosGet;
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("separate Google tag IDs are validated, saved, and publicly readable", async () => {
  let savedMeasurementId = "";
  let savedTagManagerId = "";
  const queries = [];
  const pool = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (/INSERT INTO google_analytics_settings/.test(sql)) {
        savedMeasurementId = params[0];
        savedTagManagerId = params[1];
        return { rows: [{ measurement_id: savedMeasurementId, tag_manager_id: savedTagManagerId }] };
      }
      return { rows: savedMeasurementId || savedTagManagerId
        ? [{ measurement_id: savedMeasurementId, tag_manager_id: savedTagManagerId }]
        : [] };
    },
  };
  const app = express();
  app.use(express.json());
  app.use(createGoogleAnalyticsRouter({
    pool,
    verifyAdmin: (_req, _res, next) => next(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const adminUrl = `http://127.0.0.1:${server.address().port}/admin/google-analytics/tag`;
    const invalidResponse = await fetch(adminUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ measurementId: "<script>bad()</script>", tagManagerId: "" }),
    });
    assert.equal(invalidResponse.status, 400);
    assert.equal(queries.length, 0);

    const gaOnlyResponse = await fetch(adminUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ measurementId: "g-abc1234567" }),
    });
    assert.equal(gaOnlyResponse.status, 200);
    assert.deepEqual(await gaOnlyResponse.json(), {
      measurementId: "G-ABC1234567",
      tagManagerId: "",
    });

    const saveResponse = await fetch(adminUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ measurementId: "g-abc1234567", tagManagerId: "gtm-t2ng27x8" }),
    });
    assert.equal(saveResponse.status, 200);
    assert.deepEqual(await saveResponse.json(), {
      measurementId: "G-ABC1234567",
      tagManagerId: "GTM-T2NG27X8",
    });

    const publicResponse = await fetch(`http://127.0.0.1:${server.address().port}/google-analytics/tag`);
    assert.equal(publicResponse.status, 200);
    assert.deepEqual(await publicResponse.json(), {
      measurementId: "G-ABC1234567",
      tagManagerId: "GTM-T2NG27X8",
    });
    assert.match(queries[0].sql, /ON CONFLICT \(id\) DO UPDATE/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("Google Analytics report API lists authorized properties and returns protected GA4 reports", async () => {
  const key = Buffer.alloc(32, 7);
  const environment = {
    GOOGLE_ANALYTICS_CLIENT_ID: "analytics-client",
    GOOGLE_ANALYTICS_CLIENT_SECRET: "analytics-secret",
    GOOGLE_ANALYTICS_REDIRECT_URI: "https://api.example.test/google-analytics/oauth/callback",
    GOOGLE_ANALYTICS_TOKEN_KEY: key.toString("hex"),
  };
  const previousEnvironment = Object.fromEntries(
    Object.keys(environment).map((name) => [name, process.env[name]])
  );
  Object.entries(environment).forEach(([name, value]) => { process.env[name] = value; });

  const originalAxiosGet = axios.get;
  const originalAxiosPost = axios.post;
  const encryptedTokens = encryptTokens({
    access_token: "valid-access-token",
    refresh_token: "valid-refresh-token",
    expires_at: Date.now() + 60 * 60 * 1000,
  }, key);
  const apiCalls = [];
  const propertyTimeZoneLookups = [];
  let nextApiError = null;
  axios.get = async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer valid-access-token");
    if (url === "https://analyticsadmin.googleapis.com/v1beta/accountSummaries") {
      return {
        data: {
          accountSummaries: [{
            displayName: "Example account",
            propertySummaries: [
              { property: "properties/123456", displayName: "Main website" },
              { property: "properties/987654", displayName: "Shop" },
            ],
          }],
        },
      };
    }
    if (url === "https://analyticsadmin.googleapis.com/v1beta/properties/123456") {
      propertyTimeZoneLookups.push(url);
      return { data: { timeZone: "Asia/Kolkata" } };
    }
    assert.fail(`Unexpected Google Analytics GET: ${url}`);
  };
  axios.post = async (url, body, options) => {
    apiCalls.push({ url, body });
    assert.equal(options.headers.Authorization, "Bearer valid-access-token");
    if (nextApiError) {
      const error = nextApiError;
      nextApiError = null;
      throw error;
    }
    if (url.endsWith(":runReport")) {
      return {
        data: {
          dimensionHeaders: [{ name: "date" }],
          metricHeaders: [{ name: "activeUsers", type: "TYPE_INTEGER" }],
          totals: [{ metricValues: [{ value: "12" }] }],
          rows: [{
            dimensionValues: [{ value: "20261113" }],
            metricValues: [{ value: "12" }],
          }],
        },
      };
    }
    return {
      data: {
        dimensionHeaders: (body.dimensions || []).map(({ name }) => ({ name })),
        metricHeaders: body.metrics.map(({ name }) => ({ name, type: "TYPE_INTEGER" })),
        rows: [{
          dimensionValues: (body.dimensions || []).map(() => ({ value: "Example" })),
          metricValues: body.metrics.map(() => ({ value: "3" })),
        }],
      },
    };
  };

  const app = express();
  app.use(express.json());
  app.use(createGoogleAnalyticsRouter({
    pool: {
      query: async (sql) => {
        if (/SELECT encrypted_tokens FROM google_analytics_connections/.test(sql)) {
          return { rows: [{ encrypted_tokens: encryptedTokens }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    verifyAdmin: (_req, _res, next) => next(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/admin/google-analytics`;
    const propertiesResponse = await fetch(`${baseUrl}/properties`);
    assert.equal(propertiesResponse.status, 200);
    assert.deepEqual((await propertiesResponse.json()).properties, [
      { id: "properties/123456", displayName: "Main website", accountName: "Example account" },
      { id: "properties/987654", displayName: "Shop", accountName: "Example account" },
    ]);

    const invalidReportResponse = await fetch(`${baseUrl}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: "123456", reportId: "overview" }),
    });
    assert.equal(invalidReportResponse.status, 400);
    assert.equal(apiCalls.length, 0);

    const reportResponse = await fetch(`${baseUrl}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: "properties/123456",
        reportId: "overview",
        dateRange: "7daysAgo",
      }),
    });
    assert.equal(reportResponse.status, 200);
    const report = await reportResponse.json();
    assert.equal(report.reportId, "overview");
    assert.equal(report.totals[0].metricValues[0].value, "12");
    assert.equal(apiCalls[0].body.dateRanges[0].startDate, "7daysAgo");
    assert.deepEqual(apiCalls[0].body.metricAggregations, ["TOTAL"]);

    const realtimeResponse = await fetch(`${baseUrl}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: "properties/123456", reportId: "realtime", dateRange: "last30min" }),
    });
    assert.equal(realtimeResponse.status, 200);
    const realtime = await realtimeResponse.json();
    assert.ok(realtime.reports.summary);
    assert.deepEqual(Object.keys(realtime.reports).sort(), ["countries", "events", "pages", "summary"]);
    assert.equal(apiCalls.some(({ body }) => (
      body.dimensions?.some(({ name }) => name === "sessionSourceMedium")
    )), false);

    const liveOverviewResponse = await fetch(`${baseUrl}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: "properties/123456",
        reportId: "overview",
        dateRange: "last30min",
      }),
    });
    assert.equal(liveOverviewResponse.status, 200);
    const liveOverview = await liveOverviewResponse.json();
    assert.equal(liveOverview.isRealtime, true);
    assert.deepEqual(liveOverview.metricHeaders.map(({ name }) => name), [
      "activeUsers",
      "screenPageViews",
      "eventCount",
    ]);
    assert.deepEqual(liveOverview.totals[0].metricValues.map(({ value }) => value), ["3", "3", "3"]);
    assert.ok(apiCalls.at(-1).url.endsWith(":runRealtimeReport"));

    const unsupportedLiveReportResponse = await fetch(`${baseUrl}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: "properties/123456",
        reportId: "acquisition-overview",
        dateRange: "last30min",
      }),
    });
    assert.equal(unsupportedLiveReportResponse.status, 200);
    assert.match((await unsupportedLiveReportResponse.json()).unavailableReason, /channel-group breakdowns/);

    const lastFourHoursResponse = await fetch(`${baseUrl}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: "properties/123456",
        reportId: "overview",
        dateRange: "last4hours",
      }),
    });
    assert.equal(lastFourHoursResponse.status, 200);
    const lastFourHoursCall = apiCalls.at(-1);
    assert.deepEqual(lastFourHoursCall.body.dateRanges, [
      { startDate: "yesterday", endDate: "today" },
    ]);
    assert.equal(lastFourHoursCall.body.dimensionFilter.filter.fieldName, "dateHourMinute");
    assert.ok(lastFourHoursCall.body.dimensionFilter.filter.inListFilter.values.length >= 240);
    assert.ok(lastFourHoursCall.body.dimensionFilter.filter.inListFilter.values
      .every((value) => /^\d{12}$/.test(value)));
    assert.equal(propertyTimeZoneLookups.length, 1);

    const historicalRealtimeCallStart = apiCalls.length;
    const historicalRealtimeResponse = await fetch(`${baseUrl}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: "properties/123456",
        reportId: "realtime",
        dateRange: "last1hour",
      }),
    });
    assert.equal(historicalRealtimeResponse.status, 200);
    const historicalRealtime = await historicalRealtimeResponse.json();
    assert.deepEqual(Object.keys(historicalRealtime.reports).sort(), [
      "countries",
      "events",
      "pages",
      "sources",
      "summary",
    ]);
    const historicalRealtimeCalls = apiCalls.slice(historicalRealtimeCallStart);
    assert.equal(historicalRealtimeCalls.length, 5);
    assert.ok(historicalRealtimeCalls.every(({ url }) => url.endsWith(":runReport")));
    assert.deepEqual(
      historicalRealtimeCalls.find(({ body }) => body.dimensions?.[0]?.name === "sessionSourceMedium")
        ?.body.metrics,
      [{ name: "activeUsers" }]
    );
    assert.equal(propertyTimeZoneLookups.length, 2);

    for (const [dateRange, expectedDate] of [["today", "today"], ["yesterday", "yesterday"]]) {
      const dateResponse = await fetch(`${baseUrl}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: "properties/123456",
          reportId: "overview",
          dateRange,
        }),
      });
      assert.equal(dateResponse.status, 200);
      assert.deepEqual(apiCalls.at(-1).body.dateRanges, [
        { startDate: expectedDate, endDate: expectedDate },
      ]);
    }

    const retentionResponse = await fetch(`${baseUrl}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: "properties/123456",
        reportId: "retention",
        dateRange: "7daysAgo",
      }),
    });
    assert.equal(retentionResponse.status, 200);
    assert.deepEqual(apiCalls.at(-1).body.metrics, [
      { name: "activeUsers" },
      { name: "newUsers" },
      { name: "totalUsers" },
    ]);

    nextApiError = Object.assign(new Error("Request failed with status code 400"), {
      status: 400,
      response: {
        status: 400,
        data: { error: { message: "Invalid Google Analytics dimension." } },
      },
    });
    const invalidGoogleQueryResponse = await fetch(`${baseUrl}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: "properties/123456", reportId: "overview" }),
    });
    assert.equal(invalidGoogleQueryResponse.status, 400);
    assert.deepEqual(await invalidGoogleQueryResponse.json(), {
      error: "Invalid Google Analytics dimension.",
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    axios.get = originalAxiosGet;
    axios.post = originalAxiosPost;
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
