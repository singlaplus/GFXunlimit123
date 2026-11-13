const express = require("express");
const axios = require("axios");
const {
  createOAuthState,
  decryptTokens,
  encryptTokens,
  verifyOAuthState,
  writeGoogleConfigToEnvFile,
} = require("./google-search-console");

const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{6,20}$/;
const GOOGLE_TAG_MANAGER_ID_PATTERN = /^GTM-[A-Z0-9]{6,20}$/;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_ANALYTICS_ADMIN_API_URL = "https://analyticsadmin.googleapis.com/v1beta";
const GOOGLE_ANALYTICS_DATA_API_URL = "https://analyticsdata.googleapis.com/v1beta";
const GOOGLE_ANALYTICS_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const GOOGLE_ANALYTICS_DATE_RANGES = new Set([
  "last30min",
  "last1hour",
  "last2hours",
  "last4hours",
  "today",
  "yesterday",
  "7daysAgo",
  "28daysAgo",
  "90daysAgo",
  "365daysAgo",
]);
const GOOGLE_ANALYTICS_RECENT_DATE_RANGES = new Map([
  ["last30min", 30],
  ["last1hour", 60],
  ["last2hours", 120],
  ["last4hours", 240],
]);

const GOOGLE_ANALYTICS_REPORTS = {
  overview: {
    dimensions: ["date"],
    metrics: ["activeUsers", "newUsers", "sessions", "screenPageViews"],
  },
  "acquisition-overview": {
    dimensions: ["sessionDefaultChannelGroup"],
    metrics: ["activeUsers", "sessions", "engagedSessions", "engagementRate"],
  },
  "user-acquisition": {
    dimensions: ["firstUserDefaultChannelGroup"],
    metrics: ["totalUsers", "newUsers", "engagedSessions"],
  },
  "traffic-acquisition": {
    dimensions: ["sessionDefaultChannelGroup"],
    metrics: ["sessions", "engagedSessions", "engagementRate", "totalRevenue"],
  },
  "engagement-overview": {
    dimensions: ["date"],
    metrics: ["activeUsers", "sessions", "engagedSessions", "userEngagementDuration"],
  },
  events: {
    dimensions: ["eventName"],
    metrics: ["eventCount", "totalUsers", "keyEvents"],
  },
  "pages-screens": {
    dimensions: ["pageTitle"],
    metrics: ["screenPageViews", "activeUsers", "userEngagementDuration"],
  },
  "landing-pages": {
    dimensions: ["landingPagePlusQueryString"],
    metrics: ["sessions", "activeUsers", "keyEvents"],
  },
  "monetization-overview": {
    dimensions: ["date"],
    metrics: ["totalRevenue", "purchaseRevenue", "ecommercePurchases"],
  },
  "ecommerce-purchases": {
    dimensions: ["itemName"],
    metrics: ["itemsViewed", "itemsAddedToCart", "itemsPurchased", "itemRevenue"],
  },
  retention: {
    dimensions: ["date"],
    metrics: ["activeUsers", "newUsers", "totalUsers"],
  },
  demographics: {
    dimensions: ["country"],
    metrics: ["activeUsers", "newUsers", "totalUsers"],
  },
  "tech-details": {
    dimensions: ["deviceCategory"],
    metrics: ["activeUsers", "sessions", "engagementRate"],
  },
};

const GOOGLE_ANALYTICS_REALTIME_REPORTS = {
  countries: { dimensions: ["country"], metrics: ["activeUsers"] },
  pages: { dimensions: ["unifiedScreenName"], metrics: ["screenPageViews"] },
  events: { dimensions: ["eventName"], metrics: ["eventCount"] },
};

const GOOGLE_ANALYTICS_LIVE_REPORTS = {
  overview: { dimensions: [], metrics: ["activeUsers", "screenPageViews", "eventCount"] },
  "engagement-overview": { dimensions: [], metrics: ["activeUsers", "screenPageViews", "eventCount"] },
  events: { dimensions: ["eventName"], metrics: ["eventCount", "keyEvents"] },
  "pages-screens": { dimensions: ["unifiedScreenName"], metrics: ["screenPageViews", "activeUsers"] },
  demographics: { dimensions: ["country"], metrics: ["activeUsers"] },
  "tech-details": { dimensions: ["deviceCategory"], metrics: ["activeUsers"] },
};

const GOOGLE_ANALYTICS_LIVE_REPORT_UNAVAILABLE_MESSAGES = {
  "acquisition-overview": "GA4 Realtime does not provide channel-group breakdowns. Use a longer range after historical data has been processed.",
  "user-acquisition": "GA4 Realtime does not provide first-user acquisition breakdowns. Use a longer range after historical data has been processed.",
  "traffic-acquisition": "GA4 Realtime does not provide traffic-source breakdowns. Use a longer range after historical data has been processed.",
  "landing-pages": "GA4 Realtime does not provide landing-page breakdowns. Use a longer range after historical data has been processed.",
  "monetization-overview": "GA4 Realtime does not provide these revenue metrics. Use a longer range after historical data has been processed.",
  "ecommerce-purchases": "GA4 Realtime does not provide item-purchase breakdowns. Use a longer range after historical data has been processed.",
  retention: "GA4 Realtime does not provide retention metrics. Use a longer range after historical data has been processed.",
};

const GOOGLE_ANALYTICS_HISTORICAL_REALTIME_REPORTS = {
  summary: { dimensions: [], metrics: ["activeUsers", "screenPageViews", "eventCount"] },
  countries: { dimensions: ["country"], metrics: ["activeUsers"] },
  pages: { dimensions: ["pageTitle"], metrics: ["screenPageViews"] },
  events: { dimensions: ["eventName"], metrics: ["eventCount"] },
  sources: { dimensions: ["sessionSourceMedium"], metrics: ["activeUsers"] },
};

function getGoogleAnalyticsDateRanges(dateRange) {
  if (dateRange === "today") return [{ startDate: "today", endDate: "today" }];
  if (dateRange === "yesterday") return [{ startDate: "yesterday", endDate: "yesterday" }];
  if (GOOGLE_ANALYTICS_RECENT_DATE_RANGES.has(dateRange)) {
    return [{ startDate: "yesterday", endDate: "today" }];
  }
  return [{ startDate: dateRange, endDate: "today" }];
}

function getGoogleAnalyticsMinuteFilterValues(minutes, timeZone, now = new Date()) {
  const minuteMilliseconds = 60_000;
  const start = Math.floor((now.getTime() - minutes * minuteMilliseconds) / minuteMilliseconds) * minuteMilliseconds;
  const end = Math.floor(now.getTime() / minuteMilliseconds) * minuteMilliseconds;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = new Set();

  for (let timestamp = start; timestamp <= end; timestamp += minuteMilliseconds) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(timestamp))
        .filter(({ type }) => ["year", "month", "day", "hour", "minute"].includes(type))
        .map(({ type, value }) => [type, value])
    );
    values.add(`${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`);
  }
  return [...values];
}

function getGoogleAnalyticsOAuthConfig(environment = process.env) {
  const analyticsClientId = String(environment.GOOGLE_ANALYTICS_CLIENT_ID || "").trim();
  const analyticsClientSecret = String(environment.GOOGLE_ANALYTICS_CLIENT_SECRET || "").trim();
  const searchConsoleClientId = String(environment.GOOGLE_SEARCH_CONSOLE_CLIENT_ID || "").trim();
  const searchConsoleClientSecret = String(environment.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET || "").trim();
  const hasAnalyticsCredentials = Boolean(analyticsClientId && analyticsClientSecret);
  const hasSearchConsoleCredentials = Boolean(searchConsoleClientId && searchConsoleClientSecret);
  const clientCredentialsSource = hasAnalyticsCredentials
    ? "google-analytics"
    : hasSearchConsoleCredentials ? "google-search-console" : null;
  const clientId = hasAnalyticsCredentials
    ? analyticsClientId
    : hasSearchConsoleCredentials ? searchConsoleClientId : "";
  const clientSecret = hasAnalyticsCredentials
    ? analyticsClientSecret
    : hasSearchConsoleCredentials ? searchConsoleClientSecret : "";
  const encryptionKeyValue = String(environment.GOOGLE_ANALYTICS_TOKEN_KEY || "").trim();
  let encryptionKey = null;
  if (/^[a-f0-9]{64}$/i.test(encryptionKeyValue)) {
    encryptionKey = Buffer.from(encryptionKeyValue, "hex");
  } else {
    const decoded = Buffer.from(encryptionKeyValue, "base64");
    if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === encryptionKeyValue.replace(/=+$/, "")) {
      encryptionKey = decoded;
    }
  }

  const redirectUri = String(environment.GOOGLE_ANALYTICS_REDIRECT_URI || "").trim();
  let validRedirectUri = false;
  try {
    const redirect = new URL(redirectUri);
    validRedirectUri = ["http:", "https:"].includes(redirect.protocol)
      && !redirect.username
      && !redirect.password
      && redirect.pathname === "/google-analytics/oauth/callback"
      && !redirect.search
      && !redirect.hash;
  } catch {
    validRedirectUri = false;
  }

  const missing = [
    ...(!clientId ? ["GOOGLE_ANALYTICS_CLIENT_ID"] : []),
    ...(!clientSecret ? ["GOOGLE_ANALYTICS_CLIENT_SECRET"] : []),
    ...(!validRedirectUri ? ["GOOGLE_ANALYTICS_REDIRECT_URI"] : []),
    ...(!encryptionKey ? ["GOOGLE_ANALYTICS_TOKEN_KEY (32-byte hex or base64 key)"] : []),
  ];
  return {
    configured: missing.length === 0,
    clientId,
    clientSecret,
    clientCredentialsSource,
    redirectUri,
    encryptionKey,
    missing,
  };
}

function normalizeGoogleAnalyticsMeasurementId(value) {
  if (typeof value !== "string") return null;
  const measurementId = value.trim().toUpperCase();
  if (!measurementId) return "";
  return GA4_MEASUREMENT_ID_PATTERN.test(measurementId) ? measurementId : null;
}

function normalizeGoogleTagManagerId(value) {
  if (typeof value !== "string") return null;
  const tagManagerId = value.trim().toUpperCase();
  if (!tagManagerId) return "";
  return GOOGLE_TAG_MANAGER_ID_PATTERN.test(tagManagerId) ? tagManagerId : null;
}

async function getGoogleAnalyticsAccessToken(pool, config) {
  const connection = await pool.query(
    "SELECT encrypted_tokens FROM google_analytics_connections WHERE id = 1"
  );
  if (!connection.rows.length) {
    const error = new Error("Connect a Google account to view Analytics reports.");
    error.status = 409;
    throw error;
  }

  let tokens = decryptTokens(connection.rows[0].encrypted_tokens, config.encryptionKey);
  if (!tokens.refresh_token) {
    const error = new Error("Reconnect the Google account to restore Analytics access.");
    error.status = 409;
    throw error;
  }
  if (!tokens.access_token || Number(tokens.expires_at || 0) <= Date.now() + 60_000) {
    const refreshed = await axios.post(
      GOOGLE_TOKEN_URL,
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15_000 }
    );
    tokens = {
      ...tokens,
      access_token: refreshed.data.access_token,
      expires_at: Date.now() + Number(refreshed.data.expires_in || 3600) * 1000,
    };
    await pool.query(
      `UPDATE google_analytics_connections
       SET encrypted_tokens = $1, updated_at = now()
       WHERE id = 1`,
      [encryptTokens(tokens, config.encryptionKey)]
    );
  }
  return tokens.access_token;
}

function googleAnalyticsApiError(error) {
  if (error.status && !error.response) return { status: error.status, message: error.message };
  const status = error.response?.status || 502;
  if (status === 401) {
    return { status: 401, message: "Google authorization expired. Reconnect the Google Analytics account." };
  }
  if (status === 403) {
    return {
      status: 403,
      message: "Google denied report access. Enable the Google Analytics Admin API and Data API in Google Cloud, and confirm this account can access the selected GA4 property.",
    };
  }
  if (status === 404) {
    return {
      status: 404,
      message: "The GA4 property was not found. Refresh the property list and select an available property.",
    };
  }
  return {
    status,
    message: error.response?.data?.error?.message || "Unable to load Google Analytics reports. Please try again.",
  };
}

function createGoogleAnalyticsRouter({ pool, verifyAdmin, allowedOrigins = new Set(), envFilePath }) {
  const router = express.Router();

  router.get("/admin/google-analytics/connection", verifyAdmin, async (_req, res) => {
    try {
      const config = getGoogleAnalyticsOAuthConfig();
      const result = await pool.query(
        `SELECT account_email, connected_at
         FROM google_analytics_connections
         WHERE id = 1`
      );
      return res.json({
        configured: config.configured,
        missingConfiguration: config.missing,
        redirectUri: config.redirectUri,
        tokenKeyConfigured: Boolean(config.encryptionKey),
        usingSearchConsoleOAuthCredentials: config.clientCredentialsSource === "google-search-console",
        connected: config.configured && result.rows.length > 0,
        accountEmail: result.rows[0]?.account_email || null,
        connectedAt: result.rows[0]?.connected_at || null,
      });
    } catch (error) {
      console.error("Unable to load Google Analytics connection status", error);
      return res.status(500).json({ error: "Unable to load Google Analytics connection status." });
    }
  });

  router.put("/admin/google-analytics/config", verifyAdmin, async (req, res) => {
    const redirectUri = String(req.body?.redirectUri ?? "").trim()
      || String(process.env.GOOGLE_ANALYTICS_REDIRECT_URI || "").trim();
    const tokenKey = String(req.body?.tokenKey ?? "").trim()
      || String(process.env.GOOGLE_ANALYTICS_TOKEN_KEY || "").trim();
    const values = {
      GOOGLE_ANALYTICS_REDIRECT_URI: redirectUri,
      GOOGLE_ANALYTICS_TOKEN_KEY: tokenKey,
    };
    const config = getGoogleAnalyticsOAuthConfig({ ...process.env, ...values });
    if (config.missing.length) {
      return res.status(400).json({
        error: "Google Analytics OAuth settings are incomplete.",
        missingConfiguration: config.missing,
      });
    }

    try {
      writeGoogleConfigToEnvFile(values, envFilePath);
      Object.entries(values).forEach(([key, value]) => {
        process.env[key] = value;
      });
      return res.json({
        configured: true,
        redirectUri: config.redirectUri,
        tokenKeyConfigured: true,
        usingSearchConsoleOAuthCredentials: config.clientCredentialsSource === "google-search-console",
        message: "Google Analytics settings saved. Add the redirect URI to your Google OAuth client before connecting.",
      });
    } catch (error) {
      console.error("Unable to save Google Analytics OAuth settings", error);
      return res.status(500).json({ error: "Unable to save Google Analytics OAuth settings." });
    }
  });

  router.post("/admin/google-analytics/connect", verifyAdmin, async (req, res) => {
    const config = getGoogleAnalyticsOAuthConfig();
    if (!config.configured) {
      return res.status(503).json({
        error: "Google Analytics OAuth is not configured on the server.",
        missingConfiguration: config.missing,
      });
    }

    const origin = req.get("origin");
    if (!origin || !allowedOrigins.has(origin)) {
      return res.status(400).json({ error: "The Google Analytics connection must start from an approved website origin." });
    }

    try {
      const state = createOAuthState(origin, config.encryptionKey);
      const authorizationUrl = new URL(GOOGLE_AUTH_URL);
      authorizationUrl.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: `openid email ${GOOGLE_ANALYTICS_READONLY_SCOPE}`,
        access_type: "offline",
        prompt: "consent",
        state,
      }).toString();
      return res.json({ authorizationUrl: authorizationUrl.toString() });
    } catch (error) {
      console.error("Unable to start Google Analytics authorization", error);
      return res.status(500).json({ error: "Unable to start Google Analytics authorization." });
    }
  });

  router.delete("/admin/google-analytics/connection", verifyAdmin, async (_req, res) => {
    try {
      await pool.query("DELETE FROM google_analytics_connections WHERE id = 1");
      return res.json({ connected: false });
    } catch (error) {
      console.error("Unable to disconnect Google Analytics", error);
      return res.status(500).json({ error: "Unable to disconnect Google Analytics." });
    }
  });

  router.get("/admin/google-analytics/properties", verifyAdmin, async (_req, res) => {
    const config = getGoogleAnalyticsOAuthConfig();
    if (!config.configured) {
      return res.status(503).json({
        error: "Google Analytics OAuth is not configured on the server.",
        missingConfiguration: config.missing,
      });
    }

    try {
      const accessToken = await getGoogleAnalyticsAccessToken(pool, config);
      const properties = [];
      let pageToken = "";
      do {
        const { data } = await axios.get(`${GOOGLE_ANALYTICS_ADMIN_API_URL}/accountSummaries`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { pageSize: 200, ...(pageToken ? { pageToken } : {}) },
          timeout: 15_000,
        });
        for (const account of data?.accountSummaries || []) {
          for (const property of account?.propertySummaries || []) {
            if (typeof property?.property === "string" && /^properties\/\d+$/.test(property.property)) {
              properties.push({
                id: property.property,
                displayName: String(property.displayName || property.property),
                accountName: String(account.displayName || ""),
              });
            }
          }
        }
        pageToken = data?.nextPageToken || "";
      } while (pageToken);

      return res.json({ properties });
    } catch (error) {
      console.error("Unable to load Google Analytics properties", { status: error.response?.status });
      const apiError = googleAnalyticsApiError(error);
      return res.status(apiError.status).json({ error: apiError.message });
    }
  });

  router.post("/admin/google-analytics/reports", verifyAdmin, async (req, res) => {
    const propertyId = String(req.body?.propertyId || "").trim();
    const reportId = String(req.body?.reportId || "").trim();
    const dateRange = String(req.body?.dateRange || "28daysAgo").trim();
    const isRealtime = reportId === "realtime";
    const isLiveRealtime = isRealtime && dateRange === "last30min";

    if (!/^properties\/\d+$/.test(propertyId)) {
      return res.status(400).json({ error: "Select a valid Google Analytics property." });
    }
    if (!isRealtime && !GOOGLE_ANALYTICS_REPORTS[reportId]) {
      return res.status(400).json({ error: "Select a supported Google Analytics report." });
    }
    if (!GOOGLE_ANALYTICS_DATE_RANGES.has(dateRange)) {
      return res.status(400).json({ error: "Select a supported report date range." });
    }

    const config = getGoogleAnalyticsOAuthConfig();
    if (!config.configured) {
      return res.status(503).json({
        error: "Google Analytics OAuth is not configured on the server.",
        missingConfiguration: config.missing,
      });
    }

    try {
      const accessToken = await getGoogleAnalyticsAccessToken(pool, config);
      const headers = { Authorization: `Bearer ${accessToken}` };
      const runRealtimeReport = async (definition) => {
        const { data } = await axios.post(
          `${GOOGLE_ANALYTICS_DATA_API_URL}/${propertyId}:runRealtimeReport`,
          {
            ...(definition.dimensions.length
              ? { dimensions: definition.dimensions.map((name) => ({ name })) }
              : {}),
            metrics: definition.metrics.map((name) => ({ name })),
            limit: 10,
          },
          { headers, timeout: 15_000 }
        );
        return data;
      };

      if (isLiveRealtime) {
        const realtimeReports = [
          ["summary", { dimensions: [], metrics: ["activeUsers", "screenPageViews", "eventCount"] }],
          ...Object.entries(GOOGLE_ANALYTICS_REALTIME_REPORTS),
        ];
        const reports = await Promise.all(realtimeReports.map(
          async ([key, definition]) => {
            return [key, await runRealtimeReport(definition)];
          }
        ));
        return res.json({
          reportId,
          generatedAt: new Date().toISOString(),
          reports: Object.fromEntries(reports),
        });
      }

      if (dateRange === "last30min") {
        const definition = GOOGLE_ANALYTICS_LIVE_REPORTS[reportId];
        if (!definition) {
          return res.json({
            reportId,
            generatedAt: new Date().toISOString(),
            unavailableReason: GOOGLE_ANALYTICS_LIVE_REPORT_UNAVAILABLE_MESSAGES[reportId],
          });
        }

        const data = await runRealtimeReport(definition);
        const rows = data?.rows || [];
        return res.json({
          reportId,
          generatedAt: new Date().toISOString(),
          isRealtime: true,
          dimensionHeaders: data?.dimensionHeaders || [],
          metricHeaders: data?.metricHeaders || [],
          rows,
          totals: data?.totals?.length
            ? data.totals
            : definition.dimensions.length ? [] : rows,
        });
      }

      let dimensionFilter;
      const recentRangeMinutes = GOOGLE_ANALYTICS_RECENT_DATE_RANGES.get(dateRange);
      if (recentRangeMinutes) {
        const { data: property } = await axios.get(
          `${GOOGLE_ANALYTICS_ADMIN_API_URL}/${propertyId}`,
          { headers, timeout: 15_000 }
        );
        if (typeof property?.timeZone !== "string" || !property.timeZone) {
          const error = new Error("Google Analytics did not return the property's time zone.");
          error.status = 502;
          throw error;
        }
        dimensionFilter = {
          filter: {
            fieldName: "dateHourMinute",
            inListFilter: {
              values: getGoogleAnalyticsMinuteFilterValues(recentRangeMinutes, property.timeZone),
            },
          },
        };
      }

      const dateRanges = getGoogleAnalyticsDateRanges(dateRange);
      const runHistoricalReport = async (definition) => {
        const { data } = await axios.post(
          `${GOOGLE_ANALYTICS_DATA_API_URL}/${propertyId}:runReport`,
          {
            dateRanges,
            ...(dimensionFilter ? { dimensionFilter } : {}),
            ...(definition.dimensions.length
              ? { dimensions: definition.dimensions.map((name) => ({ name })) }
              : {}),
            metrics: definition.metrics.map((name) => ({ name })),
            metricAggregations: ["TOTAL"],
            limit: 100,
          },
          { headers, timeout: 15_000 }
        );
        return {
          dimensionHeaders: data?.dimensionHeaders || [],
          metricHeaders: data?.metricHeaders || [],
          rows: data?.rows?.length
            ? data.rows
            : definition.dimensions.length ? [] : data?.totals || [],
          totals: data?.totals || [],
        };
      };

      if (isRealtime) {
        const reports = await Promise.all(
          Object.entries(GOOGLE_ANALYTICS_HISTORICAL_REALTIME_REPORTS).map(
            async ([key, definition]) => [key, await runHistoricalReport(definition)]
          )
        );
        return res.json({
          reportId,
          generatedAt: new Date().toISOString(),
          reports: Object.fromEntries(reports),
        });
      }

      const definition = GOOGLE_ANALYTICS_REPORTS[reportId];
      const report = await runHistoricalReport(definition);
      return res.json({
        reportId,
        generatedAt: new Date().toISOString(),
        ...report,
      });
    } catch (error) {
      console.error("Unable to load Google Analytics report", {
        reportId,
        status: error.response?.status,
      });
      const apiError = googleAnalyticsApiError(error);
      return res.status(apiError.status).json({ error: apiError.message });
    }
  });

  router.get("/google-analytics/oauth/callback", async (req, res) => {
    const config = getGoogleAnalyticsOAuthConfig();
    if (!config.configured) return res.status(503).send("Google Analytics OAuth is not configured.");

    let callbackOrigin;
    try {
      callbackOrigin = verifyOAuthState(req.query.state, config.encryptionKey, allowedOrigins).origin;
    } catch {
      return res.status(400).send("Invalid or expired Google authorization state. Start the connection again.");
    }

    const finishPopup = (result) => {
      const targetOrigin = JSON.stringify(callbackOrigin);
      const resultValue = JSON.stringify(result);
      res.set({
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      });
      return res.status(200).type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Analytics</title></head>
<body><p>Google sign-in finished. You can close this window.</p>
<script>if(window.opener){window.opener.postMessage({type:"google-analytics-oauth",result:${resultValue}},${targetOrigin});window.close();}</script></body></html>`);
    };

    if (req.query.error) return finishPopup("denied");
    if (typeof req.query.code !== "string" || !req.query.code) return finishPopup("error");

    try {
      const tokenResponse = await axios.post(
        GOOGLE_TOKEN_URL,
        new URLSearchParams({
          code: req.query.code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: "authorization_code",
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15_000 }
      );
      if (!tokenResponse.data?.refresh_token || !tokenResponse.data?.access_token) {
        throw new Error("Google did not return the required offline access tokens.");
      }

      const userInfo = await axios.get(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` },
        timeout: 15_000,
      });
      const tokens = {
        access_token: tokenResponse.data.access_token,
        refresh_token: tokenResponse.data.refresh_token,
        expires_at: Date.now() + Number(tokenResponse.data.expires_in || 3600) * 1000,
        scope: typeof tokenResponse.data.scope === "string" ? tokenResponse.data.scope : "",
      };
      await pool.query(
        `INSERT INTO google_analytics_connections
           (id, encrypted_tokens, account_email, connected_at, updated_at)
         VALUES (1, $1, $2, now(), now())
         ON CONFLICT (id) DO UPDATE SET
           encrypted_tokens = EXCLUDED.encrypted_tokens,
           account_email = EXCLUDED.account_email,
           connected_at = now(),
           updated_at = now()`,
        [encryptTokens(tokens, config.encryptionKey), userInfo.data?.email || null]
      );
      return finishPopup("connected");
    } catch (error) {
      console.error("Google Analytics OAuth callback failed", { status: error.response?.status });
      return finishPopup("error");
    }
  });

  router.get("/google-analytics/tag", async (_req, res) => {
    try {
      const result = await pool.query(
        "SELECT measurement_id, tag_manager_id FROM google_analytics_settings WHERE id = 1"
      );
      return res.json({
        measurementId: result.rows[0]?.measurement_id || "",
        tagManagerId: result.rows[0]?.tag_manager_id || "",
      });
    } catch (error) {
      console.error("Unable to load Google Analytics tag setting", error);
      return res.status(500).json({ error: "Unable to load Google Analytics tag setting." });
    }
  });

  router.get("/admin/google-analytics/tag", verifyAdmin, async (_req, res) => {
    try {
      const result = await pool.query(
        "SELECT measurement_id, tag_manager_id FROM google_analytics_settings WHERE id = 1"
      );
      return res.json({
        measurementId: result.rows[0]?.measurement_id || "",
        tagManagerId: result.rows[0]?.tag_manager_id || "",
      });
    } catch (error) {
      console.error("Unable to load Google Analytics tag setting", error);
      return res.status(500).json({ error: "Unable to load Google Analytics tag setting." });
    }
  });

  router.put("/admin/google-analytics/tag", verifyAdmin, async (req, res) => {
    const measurementId = normalizeGoogleAnalyticsMeasurementId(req.body?.measurementId ?? "");
    const tagManagerId = normalizeGoogleTagManagerId(req.body?.tagManagerId ?? "");
    if (measurementId === null || tagManagerId === null) {
      return res.status(400).json({
        error: "Enter a valid GA4 Measurement ID (G-...) and/or Google Tag Manager container ID (GTM-...).",
      });
    }

    try {
      const result = await pool.query(
        `INSERT INTO google_analytics_settings (id, measurement_id, tag_manager_id, updated_at)
         VALUES (1, $1, $2, now())
         ON CONFLICT (id) DO UPDATE
         SET measurement_id = EXCLUDED.measurement_id,
             tag_manager_id = EXCLUDED.tag_manager_id,
             updated_at = now()
         RETURNING measurement_id, tag_manager_id`,
        [measurementId, tagManagerId]
      );
      return res.json({
        measurementId: result.rows[0].measurement_id,
        tagManagerId: result.rows[0].tag_manager_id,
      });
    } catch (error) {
      console.error("Unable to save Google Analytics tag setting", error);
      return res.status(500).json({ error: "Unable to save Google Analytics tag setting." });
    }
  });

  return router;
}

module.exports = {
  createGoogleAnalyticsRouter,
  getGoogleAnalyticsOAuthConfig,
  normalizeGoogleAnalyticsMeasurementId,
  normalizeGoogleTagManagerId,
};
