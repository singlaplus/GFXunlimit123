const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const axios = require("axios");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";
const GOOGLE_SEARCH_ANALYTICS_URL = "https://www.googleapis.com/webmasters/v3/sites";
const GOOGLE_SITEMAPS_URL = "https://www.googleapis.com/webmasters/v3/sites";
const GOOGLE_SEARCH_CONSOLE_WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

function hasGoogleSearchConsoleWriteScope(scope) {
  if (typeof scope !== "string" || !scope.trim()) return null;
  return scope.split(/\s+/).includes(GOOGLE_SEARCH_CONSOLE_WRITE_SCOPE);
}

function getGoogleConfig(environment = process.env) {
  const encryptionKeyValue = String(environment.GOOGLE_SEARCH_CONSOLE_TOKEN_KEY || "").trim();
  let encryptionKey = null;
  if (/^[a-f0-9]{64}$/i.test(encryptionKeyValue)) {
    encryptionKey = Buffer.from(encryptionKeyValue, "hex");
  } else {
    const decoded = Buffer.from(encryptionKeyValue, "base64");
    if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === encryptionKeyValue.replace(/=+$/, "")) {
      encryptionKey = decoded;
    }
  }

  const clientId = String(environment.GOOGLE_SEARCH_CONSOLE_CLIENT_ID || "").trim();
  const clientSecret = String(environment.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET || "").trim();
  const redirectUri = String(environment.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI || "").trim();
  let validRedirectUri = false;
  try {
    const redirect = new URL(redirectUri);
    validRedirectUri = ["http:", "https:"].includes(redirect.protocol)
      && !redirect.username
      && !redirect.password
      && redirect.pathname === "/search-console/oauth/callback"
      && !redirect.search
      && !redirect.hash;
  } catch {
    validRedirectUri = false;
  }

  const configured = Boolean(clientId && clientSecret && validRedirectUri && encryptionKey);
  return {
    configured,
    clientId,
    clientSecret,
    redirectUri,
    encryptionKey,
    missing: [
      ...(!clientId ? ["GOOGLE_SEARCH_CONSOLE_CLIENT_ID"] : []),
      ...(!clientSecret ? ["GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET"] : []),
      ...(!validRedirectUri ? ["GOOGLE_SEARCH_CONSOLE_REDIRECT_URI"] : []),
      ...(!encryptionKey ? ["GOOGLE_SEARCH_CONSOLE_TOKEN_KEY (32-byte hex or base64 key)"] : []),
    ],
  };
}

function writeGoogleConfigToEnvFile(values, envFilePath = path.resolve(__dirname, "..", ".env")) {
  const existingLines = fs.existsSync(envFilePath)
    ? fs.readFileSync(envFilePath, "utf8").split(/\r?\n/)
    : [];
  const updatedKeys = new Set();
  const nextLines = existingLines.flatMap((line) => {
    const key = line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1];
    if (!key || !Object.prototype.hasOwnProperty.call(values, key)) return [line];
    if (updatedKeys.has(key)) return [];
    updatedKeys.add(key);
    return [`${key}=${JSON.stringify(values[key])}`];
  });

  for (const [key, value] of Object.entries(values)) {
    if (!updatedKeys.has(key)) nextLines.push(`${key}=${JSON.stringify(value)}`);
  }

  const temporaryPath = `${envFilePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${nextLines.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, envFilePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
}

function removeGoogleConfigFromEnvFile(envFilePath = path.resolve(__dirname, "..", ".env")) {
  if (!fs.existsSync(envFilePath)) return;
  const googleConfigKeys = new Set([
    "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
    "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
    "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI",
    "GOOGLE_SEARCH_CONSOLE_TOKEN_KEY",
  ]);
  const existingLines = fs.readFileSync(envFilePath, "utf8").split(/\r?\n/);
  const nextLines = existingLines.filter((line) => {
    const key = line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1];
    return !key || !googleConfigKeys.has(key);
  });
  const temporaryPath = `${envFilePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${nextLines.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, envFilePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
}

function encryptTokens(tokens, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decryptTokens(value, key) {
  const [ivValue, tagValue, ciphertextValue] = String(value || "").split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Stored Search Console credentials are invalid.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext);
}

function createOAuthState(origin, key, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    origin,
    expiresAt: Math.floor(now / 1000) + OAUTH_STATE_MAX_AGE_SECONDS,
    nonce: crypto.randomBytes(24).toString("base64url"),
  })).toString("base64url");
  const signingKey = crypto.createHmac("sha256", key).update("gsc-oauth-state").digest();
  const signature = crypto.createHmac("sha256", signingKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyOAuthState(state, key, allowedOrigins, now = Date.now()) {
  const [payload, signature, ...extra] = String(state || "").split(".");
  if (!payload || !signature || extra.length) throw new Error("Invalid OAuth state.");
  const signingKey = crypto.createHmac("sha256", key).update("gsc-oauth-state").digest();
  const expected = crypto.createHmac("sha256", signingKey).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    throw new Error("Invalid OAuth state.");
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error("Invalid OAuth state.");
  }
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (
    !Number.isInteger(decoded.expiresAt)
    || decoded.expiresAt < Math.floor(now / 1000)
    || !allowedOrigins.has(decoded.origin)
    || typeof decoded.nonce !== "string"
  ) {
    throw new Error("Expired or invalid OAuth state.");
  }
  return decoded;
}

function getGooglePropertiesErrorMessage(error) {
  const status = error?.response?.status;
  const googleError = error?.response?.data?.error;
  const reason = Array.isArray(googleError?.errors) ? googleError.errors[0]?.reason : "";

  if (status === 401) return "Google authorization expired. Disconnect and reconnect the Google account.";
  if (status === 403 && ["accessNotConfigured", "serviceDisabled"].includes(reason)) {
    return "Google denied Search Console API access. Confirm the Search Console API is enabled in the same Google Cloud project as this OAuth client, then reconnect.";
  }
  if (status === 403 && ["insufficientPermissions", "forbidden"].includes(reason)) {
    return "This Google account does not have enough Search Console access for this property or action. Confirm it has owner access, then reconnect and approve full Search Console access.";
  }
  if (status === 403) {
    return `Google denied access to Search Console properties${reason ? ` (${reason})` : ""}. Confirm this account has access to a Search Console property and reconnect.`;
  }
  return "Unable to load Search Console properties from Google. Please try again.";
}

function getCloudflareDnsConfig(environment = process.env) {
  const apiToken = String(environment.CLOUDFLARE_DNS_API_TOKEN || "").trim();
  const zoneId = String(environment.CLOUDFLARE_DNS_ZONE_ID || "").trim();
  const zoneName = String(environment.CLOUDFLARE_DNS_ZONE_NAME || "").trim().toLowerCase();
  return {
    apiToken,
    zoneId,
    zoneName,
    configured: Boolean(apiToken && /^[a-f0-9]{32}$/i.test(zoneId) && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(zoneName)),
  };
}

function getCloudflareDnsRecordName(recordName, zoneName) {
  const input = String(recordName || "@").trim().toLowerCase().replace(/\.$/, "");
  if (!input || input === "@") return zoneName;
  const normalized = input.replace(/^\*\./, "");
  const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
  if (!normalized.includes(".")) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(normalized)) {
      throw new Error("Enter @ or a valid DNS hostname for this zone.");
    }
    return `${normalized}.${zoneName}`;
  }
  if (!hostnamePattern.test(normalized)) {
    throw new Error("Enter @ or a valid DNS hostname for this zone.");
  }
  if (normalized !== zoneName && !normalized.endsWith(`.${zoneName}`)) {
    throw new Error("The TXT record name must belong to the configured Cloudflare zone.");
  }
  return normalized;
}

async function getGoogleAccessToken(pool, config) {
  const connection = await pool.query(
    `SELECT encrypted_tokens FROM google_search_console_connections WHERE id = 1`
  );
  if (!connection.rows.length) {
    const error = new Error("Connect a Google account first.");
    error.status = 409;
    throw error;
  }
  let tokens = decryptTokens(connection.rows[0].encrypted_tokens, config.encryptionKey);
  if (!tokens.refresh_token) {
    const error = new Error("Reconnect the Google account to restore Search Console access.");
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
      `UPDATE google_search_console_connections
       SET encrypted_tokens = $1, updated_at = now()
       WHERE id = 1`,
      [encryptTokens(tokens, config.encryptionKey)]
    );
  }

  return tokens.access_token;
}

async function fetchGoogleProperties(pool, config) {
  const accessToken = await getGoogleAccessToken(pool, config);
  const result = await axios.get(GOOGLE_SITES_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 15_000,
  });
  return Array.isArray(result.data?.siteEntry) ? result.data.siteEntry : [];
}

function createGoogleSearchConsoleRouter({ pool, verifyAdmin, allowedOrigins, envFilePath }) {
  const router = express.Router();

  router.get("/admin/search-console/ownership/cloudflare-status", verifyAdmin, (_req, res) => {
    const config = getCloudflareDnsConfig();
    return res.json({
      configured: config.configured,
      tokenConfigured: Boolean(config.apiToken),
      zoneId: config.zoneId,
      zoneName: config.zoneName,
    });
  });

  router.post("/admin/search-console/ownership/cloudflare-config", verifyAdmin, async (req, res) => {
    const current = getCloudflareDnsConfig();
    const values = {
      CLOUDFLARE_DNS_API_TOKEN: String(req.body?.apiToken || "").trim() || current.apiToken,
      CLOUDFLARE_DNS_ZONE_ID: String(req.body?.zoneId || "").trim() || current.zoneId,
      CLOUDFLARE_DNS_ZONE_NAME: String(req.body?.zoneName || "").trim().toLowerCase() || current.zoneName,
    };
    const config = getCloudflareDnsConfig(values);
    if (!config.configured) {
      return res.status(400).json({
        error: "Enter a Cloudflare API token, a 32-character zone ID, and a valid zone name.",
      });
    }

    try {
      writeGoogleConfigToEnvFile(values, envFilePath);
      Object.entries(values).forEach(([key, value]) => { process.env[key] = value; });
      return res.json({
        configured: true,
        tokenConfigured: true,
        zoneId: config.zoneId,
        zoneName: config.zoneName,
        message: "Cloudflare DNS settings saved securely.",
      });
    } catch (error) {
      console.error("Unable to save Cloudflare DNS settings", error);
      return res.status(500).json({ error: "Unable to save Cloudflare DNS settings." });
    }
  });

  router.post("/admin/search-console/ownership/dns-record", verifyAdmin, async (req, res) => {
    const config = getCloudflareDnsConfig();
    if (!config.configured) {
      return res.status(503).json({ error: "Configure Cloudflare DNS access before publishing a TXT record." });
    }
    const recordContent = String(req.body?.content || "").trim();
    if (!/^google-site-verification=[A-Za-z0-9_-]+$/.test(recordContent)) {
      return res.status(400).json({ error: "Enter Google's complete google-site-verification TXT value." });
    }

    let recordName;
    try {
      recordName = getCloudflareDnsRecordName(req.body?.name, config.zoneName);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const endpoint = `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/dns_records`;
    const headers = { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" };
    try {
      const existing = await axios.get(endpoint, {
        headers,
        params: { type: "TXT", name: recordName, content: recordContent },
        timeout: 15_000,
      });
      if (existing.data?.success === false) {
        throw new Error("Cloudflare did not confirm the DNS record lookup.");
      }
      if (Array.isArray(existing.data?.result) && existing.data.result.length > 0) {
        return res.json({ created: false, recordName, message: "This Google verification TXT record already exists in Cloudflare." });
      }

      const created = await axios.post(endpoint, {
        type: "TXT",
        name: recordName,
        content: recordContent,
        ttl: 1,
      }, { headers, timeout: 15_000 });
      if (!created.data?.success) {
        const apiError = created.data?.errors?.[0]?.message;
        throw new Error(apiError || "Cloudflare did not confirm the TXT record creation.");
      }
      return res.json({
        created: true,
        recordName,
        message: "Google verification TXT record added to Cloudflare. Return to Search Console and click Verify.",
      });
    } catch (error) {
      const status = error.response?.status;
      console.error("Unable to publish Google verification TXT record to Cloudflare", { status });
      if (status === 401 || status === 403) {
        return res.status(502).json({ error: "Cloudflare rejected the API token. Check it has DNS Edit permission for this zone." });
      }
      if (status === 404) {
        return res.status(502).json({ error: "Cloudflare could not find this zone. Check the zone ID and domain name." });
      }
      if (status) return res.status(502).json({ error: "Cloudflare could not publish the TXT record. Check the zone settings and try again." });
      console.error("Cloudflare DNS request failed", error.message || error);
      return res.status(502).json({ error: "Unable to reach Cloudflare to publish the TXT record." });
    }
  });

  router.delete("/admin/search-console/config", verifyAdmin, async (_req, res) => {
    try {
      await pool.query("DELETE FROM google_search_console_connections WHERE id = 1");
      removeGoogleConfigFromEnvFile(envFilePath);
      for (const key of [
        "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
        "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
        "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI",
        "GOOGLE_SEARCH_CONSOLE_TOKEN_KEY",
      ]) {
        delete process.env[key];
      }
      return res.json({
        configured: false,
        connected: false,
        message: "Search Console configuration and saved account connection were reset.",
      });
    } catch (error) {
      console.error("Unable to reset Google Search Console configuration", error);
      return res.status(500).json({ error: "Unable to reset Google Search Console configuration." });
    }
  });

  router.post("/admin/search-console/config", verifyAdmin, async (req, res) => {
    const payload = req.body || {};
    const providedValues = {
      GOOGLE_SEARCH_CONSOLE_CLIENT_ID: payload.GOOGLE_SEARCH_CONSOLE_CLIENT_ID ?? payload.clientId,
      GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: payload.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET ?? payload.clientSecret,
      GOOGLE_SEARCH_CONSOLE_REDIRECT_URI: payload.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI ?? payload.redirectUri,
      GOOGLE_SEARCH_CONSOLE_TOKEN_KEY: payload.GOOGLE_SEARCH_CONSOLE_TOKEN_KEY ?? payload.tokenKey,
    };
    const values = Object.fromEntries(
      Object.entries(providedValues).map(([key, value]) => [
        key,
        String(value ?? "").trim() || String(process.env[key] ?? "").trim(),
      ])
    );
    const config = getGoogleConfig({ ...process.env, ...values });

    if (config.missing.length) {
      return res.status(400).json({
        error: "Google Search Console OAuth is not fully configured.",
        missingConfiguration: config.missing,
      });
    }

    try {
      writeGoogleConfigToEnvFile(values);
      Object.entries(values).forEach(([key, value]) => {
        process.env[key] = value;
      });
      return res.json({
        configured: true,
        message: "Google OAuth settings saved successfully.",
      });
    } catch (error) {
      console.error("Unable to save Google Search Console configuration", error);
      return res.status(500).json({ error: "Unable to save Google OAuth settings." });
    }
  });

  router.get("/admin/search-console/status", verifyAdmin, async (_req, res) => {
    try {
      const config = getGoogleConfig();
      const result = await pool.query(
        `SELECT account_email, connected_at, selected_property, encrypted_tokens
         FROM google_search_console_connections
         WHERE id = 1`
      );
      let writeScopeGranted = null;
      if (config.configured && result.rows[0]?.encrypted_tokens) {
        const tokens = decryptTokens(result.rows[0].encrypted_tokens, config.encryptionKey);
        writeScopeGranted = hasGoogleSearchConsoleWriteScope(tokens.scope);
      }
      return res.json({
        configured: config.configured,
        missingConfiguration: config.missing,
        connected: config.configured && result.rows.length > 0,
        accountEmail: result.rows[0]?.account_email || null,
        connectedAt: result.rows[0]?.connected_at || null,
        selectedProperty: result.rows[0]?.selected_property || "",
        writeScopeGranted,
        values: {
          clientId: config.clientId,
          redirectUri: config.redirectUri,
          clientSecretConfigured: Boolean(config.clientSecret),
          tokenKeyConfigured: Boolean(config.encryptionKey),
        },
      });
    } catch (error) {
      console.error("Unable to load Google Search Console connection status", error);
      return res.status(500).json({ error: "Unable to load Search Console connection status." });
    }
  });

  router.post("/admin/search-console/connect", verifyAdmin, async (req, res) => {
    const config = getGoogleConfig();
    if (!config.configured) {
      return res.status(503).json({
        error: "Google Search Console OAuth is not configured on the server.",
        missingConfiguration: config.missing,
      });
    }
    const origin = req.get("origin");
    if (!origin || !allowedOrigins.has(origin)) {
      return res.status(400).json({ error: "The Search Console connection must be started from an approved website origin." });
    }

    try {
      const state = createOAuthState(origin, config.encryptionKey);
      const authorizationUrl = new URL(GOOGLE_AUTH_URL);
      authorizationUrl.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: `openid email ${GOOGLE_SEARCH_CONSOLE_WRITE_SCOPE}`,
        access_type: "offline",
        prompt: "consent",
        state,
      }).toString();
      return res.json({ authorizationUrl: authorizationUrl.toString() });
    } catch (error) {
      console.error("Unable to start Google Search Console authorization", error);
      return res.status(500).json({ error: "Unable to start Google authorization." });
    }
  });

  router.get("/admin/search-console/properties", verifyAdmin, async (_req, res) => {
    const config = getGoogleConfig();
    if (!config.configured) return res.status(503).json({ error: "Google Search Console OAuth is not configured." });
    try {
      return res.json({ properties: await fetchGoogleProperties(pool, config) });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ error: error.message });
      const status = error.response?.status;
      const reason = error.response?.data?.error?.errors?.[0]?.reason;
      console.error("Unable to load Google Search Console properties", { status, reason });
      return res.status(status === 401 ? 401 : 502).json({
        error: getGooglePropertiesErrorMessage(error),
      });
    }
  });

  router.put("/admin/search-console/property", verifyAdmin, async (req, res) => {
    const config = getGoogleConfig();
    if (!config.configured) return res.status(503).json({ error: "Google Search Console OAuth is not configured." });
    const siteUrl = typeof req.body?.siteUrl === "string" ? req.body.siteUrl.trim() : "";
    if (!siteUrl) return res.status(400).json({ error: "Choose a Search Console property to save." });

    try {
      const properties = await fetchGoogleProperties(pool, config);
      if (!properties.some((property) => property.siteUrl === siteUrl)) {
        return res.status(400).json({ error: "The selected property is not available to the connected Google account." });
      }
      await pool.query(
        `UPDATE google_search_console_connections
         SET selected_property = $1, updated_at = now()
         WHERE id = 1`,
        [siteUrl]
      );
      return res.json({ selectedProperty: siteUrl, message: "Search Console property saved." });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ error: error.message });
      const status = error.response?.status;
      const reason = error.response?.data?.error?.errors?.[0]?.reason;
      console.error("Unable to save Google Search Console property", { status, reason });
      return res.status(status === 401 ? 401 : 502).json({ error: getGooglePropertiesErrorMessage(error) });
    }
  });

  router.delete("/admin/search-console/property", verifyAdmin, async (_req, res) => {
    try {
      await pool.query(
        `UPDATE google_search_console_connections
         SET selected_property = NULL, updated_at = now()
         WHERE id = 1`
      );
      return res.json({ selectedProperty: "", message: "Saved Search Console property reset." });
    } catch (error) {
      console.error("Unable to reset saved Search Console property", error);
      return res.status(500).json({ error: "Unable to reset the saved Search Console property." });
    }
  });

  router.post("/admin/search-console/performance", verifyAdmin, async (req, res) => {
    const config = getGoogleConfig();
    if (!config.configured) return res.status(503).json({ error: "Google Search Console OAuth is not configured." });
    const { startDate, endDate, dimension } = req.body || {};
    const validDate = (value) => (
      typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    );
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      return res.status(400).json({ error: "Choose a valid date range with the start date on or before the end date." });
    }
    if (!["query", "page", "country", "device", "searchAppearance", "date"].includes(dimension)) {
      return res.status(400).json({ error: "Choose a supported Search Console report breakdown." });
    }

    try {
      const saved = await pool.query(
        `SELECT selected_property FROM google_search_console_connections WHERE id = 1`
      );
      const siteUrl = saved.rows[0]?.selected_property;
      if (!siteUrl) {
        return res.status(409).json({ error: "Save a Search Console property before loading performance data." });
      }

      const accessToken = await getGoogleAccessToken(pool, config);
      const endpoint = `${GOOGLE_SEARCH_ANALYTICS_URL}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
      const headers = { Authorization: `Bearer ${accessToken}` };
      const queryBase = { startDate, endDate, searchType: "web" };
      const [totalsResponse, rowsResponse, trendResponse] = await Promise.all([
        axios.post(endpoint, queryBase, { headers, timeout: 20_000 }),
        axios.post(endpoint, { ...queryBase, dimensions: [dimension], rowLimit: 100 }, { headers, timeout: 20_000 }),
        axios.post(endpoint, { ...queryBase, dimensions: ["date"], rowLimit: 1000 }, { headers, timeout: 20_000 }),
      ]);
      const totals = totalsResponse.data?.rows?.[0] || {};
      return res.json({
        siteUrl,
        startDate,
        endDate,
        dimension,
        totals: {
          clicks: Number(totals.clicks || 0),
          impressions: Number(totals.impressions || 0),
          ctr: Number(totals.ctr || 0),
          position: Number(totals.position || 0),
        },
        rows: Array.isArray(rowsResponse.data?.rows) ? rowsResponse.data.rows : [],
        trend: Array.isArray(trendResponse.data?.rows) ? trendResponse.data.rows : [],
      });
    } catch (error) {
      const status = error.response?.status;
      const reason = error.response?.data?.error?.errors?.[0]?.reason;
      console.error("Unable to load Google Search Console performance data", { status, reason });
      return res.status(status === 401 ? 401 : 502).json({ error: getGooglePropertiesErrorMessage(error) });
    }
  });

  router.post("/admin/search-console/url-inspection", verifyAdmin, async (req, res) => {
    const config = getGoogleConfig();
    if (!config.configured) return res.status(503).json({ error: "Google Search Console OAuth is not configured." });
    const inspectionUrl = typeof req.body?.inspectionUrl === "string" ? req.body.inspectionUrl.trim() : "";
    let parsedInspectionUrl;
    try {
      parsedInspectionUrl = new URL(inspectionUrl);
    } catch {
      return res.status(400).json({ error: "Enter a valid page URL to inspect." });
    }
    if (
      !["http:", "https:"].includes(parsedInspectionUrl.protocol)
      || !parsedInspectionUrl.hostname
      || parsedInspectionUrl.username
      || parsedInspectionUrl.password
      || parsedInspectionUrl.hash
    ) {
      return res.status(400).json({ error: "Enter a valid HTTP or HTTPS page URL without credentials or a fragment." });
    }

    try {
      const saved = await pool.query(
        `SELECT selected_property FROM google_search_console_connections WHERE id = 1`
      );
      const siteUrl = saved.rows[0]?.selected_property;
      if (!siteUrl) {
        return res.status(409).json({ error: "Save a Search Console property before inspecting a page." });
      }

      let matchesProperty = false;
      if (siteUrl.startsWith("sc-domain:")) {
        const domain = siteUrl.slice("sc-domain:".length).toLowerCase();
        const hostname = parsedInspectionUrl.hostname.toLowerCase();
        matchesProperty = hostname === domain || hostname.endsWith(`.${domain}`);
      } else {
        try {
          const parsedPropertyUrl = new URL(siteUrl);
          const pathPrefix = parsedPropertyUrl.pathname.endsWith("/")
            ? parsedPropertyUrl.pathname
            : `${parsedPropertyUrl.pathname}/`;
          matchesProperty = parsedInspectionUrl.origin === parsedPropertyUrl.origin
            && (parsedPropertyUrl.pathname === "/" || parsedInspectionUrl.pathname === parsedPropertyUrl.pathname
              || parsedInspectionUrl.pathname.startsWith(pathPrefix));
        } catch {
          matchesProperty = false;
        }
      }
      if (!matchesProperty) {
        return res.status(400).json({ error: "The page URL must belong to the saved Search Console property." });
      }

      const accessToken = await getGoogleAccessToken(pool, config);
      const response = await axios.post(
        "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
        { inspectionUrl, siteUrl, languageCode: "en-US" },
        { headers: { Authorization: ["Bearer", accessToken].join(" ") }, timeout: 20_000 }
      );
      const result = response.data?.inspectionResult || {};
      const indexStatus = result.indexStatusResult || {};
      return res.json({
        inspectionUrl,
        siteUrl,
        indexStatus: {
          verdict: indexStatus.verdict || null,
          coverageState: indexStatus.coverageState || null,
          indexingState: indexStatus.indexingState || null,
          robotsTxtState: indexStatus.robotsTxtState || null,
          pageFetchState: indexStatus.pageFetchState || null,
          lastCrawlTime: indexStatus.lastCrawlTime || null,
          googleCanonical: indexStatus.googleCanonical || null,
          userCanonical: indexStatus.userCanonical || null,
          referringUrls: Array.isArray(indexStatus.referringUrls) ? indexStatus.referringUrls : [],
          sitemap: Array.isArray(indexStatus.sitemap) ? indexStatus.sitemap : [],
        },
      });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ error: error.message });
      const status = error.response?.status;
      const reason = error.response?.data?.error?.errors?.[0]?.reason;
      console.error("Unable to inspect Google Search Console URL", { status, reason });
      return res.status(status === 401 ? 401 : 502).json({ error: getGooglePropertiesErrorMessage(error) });
    }
  });

  router.post("/admin/search-console/overview", verifyAdmin, async (req, res) => {
    const config = getGoogleConfig();
    if (!config.configured) return res.status(503).json({ error: "Google Search Console OAuth is not configured." });
    const { startDate, endDate } = req.body || {};
    const validDate = (value) => (
      typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    );
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      return res.status(400).json({ error: "Choose a valid date range with the start date on or before the end date." });
    }

    try {
      const saved = await pool.query(
        `SELECT selected_property FROM google_search_console_connections WHERE id = 1`
      );
      const siteUrl = saved.rows[0]?.selected_property;
      if (!siteUrl) {
        return res.status(409).json({ error: "Save a Search Console property before loading its overview." });
      }

      const accessToken = await getGoogleAccessToken(pool, config);
      const endpoint = `${GOOGLE_SEARCH_ANALYTICS_URL}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
      const headers = { Authorization: `Bearer ${accessToken}` };
      const queryBase = { startDate, endDate, searchType: "web" };
      const [totalsResponse, trendResponse, queriesResponse, pagesResponse, sitemapsResponse] = await Promise.all([
        axios.post(endpoint, queryBase, { headers, timeout: 20_000 }),
        axios.post(endpoint, { ...queryBase, dimensions: ["date"], rowLimit: 1000 }, { headers, timeout: 20_000 }),
        axios.post(endpoint, { ...queryBase, dimensions: ["query"], rowLimit: 10, startRow: 0 }, { headers, timeout: 20_000 }),
        axios.post(endpoint, { ...queryBase, dimensions: ["page"], rowLimit: 10, startRow: 0 }, { headers, timeout: 20_000 }),
        axios.get(`${GOOGLE_SITEMAPS_URL}/${encodeURIComponent(siteUrl)}/sitemaps`, {
          headers,
          timeout: 20_000,
        }),
      ]);
      const totals = totalsResponse.data?.rows?.[0] || {};
      const sitemaps = Array.isArray(sitemapsResponse.data?.sitemap) ? sitemapsResponse.data.sitemap : [];
      return res.json({
        siteUrl,
        startDate,
        endDate,
        totals: {
          clicks: Number(totals.clicks || 0),
          impressions: Number(totals.impressions || 0),
          ctr: Number(totals.ctr || 0),
          position: Number(totals.position || 0),
        },
        trend: Array.isArray(trendResponse.data?.rows) ? trendResponse.data.rows : [],
        topQueries: Array.isArray(queriesResponse.data?.rows) ? queriesResponse.data.rows : [],
        topPages: Array.isArray(pagesResponse.data?.rows) ? pagesResponse.data.rows : [],
        sitemaps: sitemaps.map((sitemap) => ({
          path: sitemap.path,
          isPending: Boolean(sitemap.isPending),
          errors: Number(sitemap.errors || 0),
          warnings: Number(sitemap.warnings || 0),
          lastSubmitted: sitemap.lastSubmitted || null,
        })),
      });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ error: error.message });
      const status = error.response?.status;
      const reason = error.response?.data?.error?.errors?.[0]?.reason;
      console.error("Unable to load Google Search Console overview", { status, reason });
      return res.status(status === 401 ? 401 : 502).json({ error: getGooglePropertiesErrorMessage(error) });
    }
  });

  router.get("/admin/search-console/sitemaps", verifyAdmin, async (_req, res) => {
    const config = getGoogleConfig();
    if (!config.configured) return res.status(503).json({ error: "Google Search Console OAuth is not configured." });
    try {
      const saved = await pool.query(
        `SELECT selected_property FROM google_search_console_connections WHERE id = 1`
      );
      const siteUrl = saved.rows[0]?.selected_property;
      if (!siteUrl) {
        return res.status(409).json({ error: "Save a Search Console property before loading sitemaps." });
      }

      const accessToken = await getGoogleAccessToken(pool, config);
      const endpoint = `${GOOGLE_SITEMAPS_URL}/${encodeURIComponent(siteUrl)}/sitemaps`;
      const response = await axios.get(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 20_000,
      });
      return res.json({
        siteUrl,
        sitemaps: Array.isArray(response.data?.sitemap) ? response.data.sitemap : [],
      });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ error: error.message });
      const status = error.response?.status;
      const reason = error.response?.data?.error?.errors?.[0]?.reason;
      console.error("Unable to load Google Search Console sitemaps", { status, reason });
      return res.status(status === 401 ? 401 : 502).json({ error: getGooglePropertiesErrorMessage(error) });
    }
  });

  router.post("/admin/search-console/sitemaps", verifyAdmin, async (req, res) => {
    const config = getGoogleConfig();
    if (!config.configured) return res.status(503).json({ error: "Google Search Console OAuth is not configured." });
    const sitemapUrl = typeof req.body?.sitemapUrl === "string" ? req.body.sitemapUrl.trim() : "";
    let parsedSitemapUrl;
    try {
      parsedSitemapUrl = new URL(sitemapUrl);
    } catch {
      return res.status(400).json({ error: "Enter a valid sitemap URL, such as https://gfxunlimit.com/sitemap.xml." });
    }
    if (
      !["http:", "https:"].includes(parsedSitemapUrl.protocol)
      || !parsedSitemapUrl.hostname
      || parsedSitemapUrl.username
      || parsedSitemapUrl.password
      || parsedSitemapUrl.hash
    ) {
      return res.status(400).json({ error: "Enter a valid HTTP or HTTPS sitemap URL without credentials or a fragment." });
    }

    let writeScopeGranted = null;
    try {
      const saved = await pool.query(
        `SELECT selected_property, encrypted_tokens FROM google_search_console_connections WHERE id = 1`
      );
      const siteUrl = saved.rows[0]?.selected_property;
      if (!siteUrl) {
        return res.status(409).json({ error: "Save a Search Console property before submitting a sitemap." });
      }
      const tokens = saved.rows[0]?.encrypted_tokens
        ? decryptTokens(saved.rows[0].encrypted_tokens, config.encryptionKey)
        : null;
      writeScopeGranted = hasGoogleSearchConsoleWriteScope(tokens?.scope);

      let matchesProperty = false;
      if (siteUrl.startsWith("sc-domain:")) {
        const domain = siteUrl.slice("sc-domain:".length).toLowerCase();
        const hostname = parsedSitemapUrl.hostname.toLowerCase();
        matchesProperty = hostname === domain || hostname.endsWith(`.${domain}`);
      } else {
        try {
          const parsedPropertyUrl = new URL(siteUrl);
          matchesProperty = parsedSitemapUrl.origin === parsedPropertyUrl.origin
            && parsedSitemapUrl.pathname.startsWith(parsedPropertyUrl.pathname);
        } catch {
          matchesProperty = false;
        }
      }
      if (!matchesProperty) {
        return res.status(400).json({ error: "The sitemap URL must belong to the saved Search Console property." });
      }

      const accessToken = await getGoogleAccessToken(pool, config);
      const endpoint = `${GOOGLE_SITEMAPS_URL}/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`;
      await axios.put(endpoint, null, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 20_000,
      });
      return res.json({ siteUrl, sitemapUrl, message: "Sitemap submitted to Google Search Console." });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ error: error.message });
      const status = error.response?.status;
      const reason = error.response?.data?.error?.errors?.[0]?.reason;
      console.error("Unable to submit Google Search Console sitemap", { status, reason });
      if (status === 403 && reason === "insufficientPermissions") {
        const message = writeScopeGranted === false
          ? "This Google connection has read-only Search Console access. Disconnect it, remove this app from your Google Account's third-party connections, then reconnect and grant Search Console manage access."
          : "Google reports insufficient permission to submit this sitemap. The selected property shows siteOwner access; reconnect this Google account and approve Search Console manage access. The sitemap is already listed, so resubmission may not be needed.";
        return res.status(502).json({ error: message });
      }
      return res.status(status === 401 ? 401 : 502).json({ error: getGooglePropertiesErrorMessage(error) });
    }
  });

  router.delete("/admin/search-console/connection", verifyAdmin, async (_req, res) => {
    try {
      await pool.query("DELETE FROM google_search_console_connections WHERE id = 1");
      return res.json({ connected: false });
    } catch (error) {
      console.error("Unable to disconnect Google Search Console", error);
      return res.status(500).json({ error: "Unable to disconnect Google Search Console." });
    }
  });

  router.get("/search-console/oauth/callback", async (req, res) => {
    const config = getGoogleConfig();
    if (!config.configured) return res.status(503).send("Google Search Console OAuth is not configured.");

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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Search Console</title></head>
<body><p>Google sign-in finished. You can close this window.</p>
<script>if(window.opener){window.opener.postMessage({type:"google-search-console-oauth",result:${resultValue}},${targetOrigin});window.close();}</script></body></html>`);
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
        `INSERT INTO google_search_console_connections
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
      console.error("Google Search Console OAuth callback failed", error.message || error);
      return finishPopup("error");
    }
  });

  return router;
}

module.exports = {
  createGoogleSearchConsoleRouter,
  createOAuthState,
  decryptTokens,
  encryptTokens,
  getGoogleConfig,
  hasGoogleSearchConsoleWriteScope,
  getGooglePropertiesErrorMessage,
  getCloudflareDnsConfig,
  getCloudflareDnsRecordName,
  getGoogleAccessToken,
  fetchGoogleProperties,
  writeGoogleConfigToEnvFile,
  removeGoogleConfigFromEnvFile,
  verifyOAuthState,
};
