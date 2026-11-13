const express = require("express");
const axios = require("axios");
const {
  createOAuthState,
  encryptTokens,
  verifyOAuthState,
  writeGoogleConfigToEnvFile,
} = require("./google-search-console");

const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{6,20}$/;
const GOOGLE_TAG_MANAGER_ID_PATTERN = /^GTM-[A-Z0-9]{6,20}$/;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_ANALYTICS_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

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
