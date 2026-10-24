const express = require("express");

function escapeCsvCell(value) {
  let cell = String(value ?? "");
  if (/^[\u0000-\u0020]*[=+\-@]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

function getDisabledLinkKey(sourcePath, href, linkText) {
  return JSON.stringify([sourcePath, href, linkText]);
}

function createLinksCsv(links, disabledLinkKeys) {
  const rows = [
    ["Link text", "Destination", "Type", "Found on", "Status"],
    ...links.map((link) => {
      const pageUrl = new URL(link.pageUrl);
      const sourcePath = normalizePagePath(`${pageUrl.pathname}${pageUrl.search}`);
      const status = disabledLinkKeys.has(getDisabledLinkKey(sourcePath, link.href, normalizeLinkText(link.text)))
        ? "Disabled"
        : "Enabled";
      return [link.text, link.href, link.type, link.pageUrl, status];
    }),
  ];
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

function normalizePagePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[#\\\u0000-\u001f]/.test(value)) {
    throw new TypeError("A valid app page path is required.");
  }
  const pathPart = value.split("?", 1)[0];
  const segments = pathPart.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new TypeError("The app page path cannot contain relative segments.");
  }
  const parsed = new URL(value, "https://app.invalid");
  if (parsed.origin !== "https://app.invalid") throw new TypeError("The app page path must be local.");
  const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
  const params = new URLSearchParams(parsed.search);
  params.sort();
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ""}`;
}

function normalizeInternalHref(value, allowedOrigins) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("A valid internal link destination is required.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || !allowedOrigins.has(parsed.origin)
  ) {
    throw new TypeError("Only links to this app can be disabled.");
  }
  return parsed.href;
}

function normalizeLinkText(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) {
    throw new TypeError("A valid link label is required.");
  }
  return value.trim().replace(/\s+/g, " ");
}

function createLinksScanRouter({ scanner, verifyAdmin, allowedOrigins, pool }) {
  const router = express.Router();

  const getUserId = (req) => req.user?.id;

  router.get("/admin/links/scan", verifyAdmin, async (req, res) => {
    try {
      const job = await scanner.getStatus(getUserId(req));
      return res.json({ job });
    } catch (error) {
      console.error("Unable to load app link scan status", error);
      return res.status(500).json({ error: "Unable to load app link scan status." });
    }
  });

  router.post("/admin/links/scan", verifyAdmin, async (req, res) => {
    try {
      const origin = req.get("origin");
      if (!origin || !allowedOrigins.has(origin)) {
        return res.status(400).json({ error: "The app origin is not in the trusted frontend origin list." });
      }
      const job = await scanner.start(getUserId(req), {
        origin,
        authorization: req.get("authorization"),
      });
      return res.status(job.alreadyRunning ? 200 : 202).json({ job });
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      console.error("Unable to start backend app link scan", error);
      return res.status(500).json({ error: "Unable to start backend app link scan." });
    }
  });

  router.get("/admin/links/scan/results", verifyAdmin, async (req, res) => {
    try {
      const results = await scanner.getResults(getUserId(req), {
        page: req.query.page,
        pageSize: req.query.pageSize,
        search: req.query.search,
        type: req.query.type,
      });
      if (!results) return res.status(404).json({ error: "No app link scan results are available yet." });
      if (results.status === "running") return res.status(409).json({ error: "App link scan is still running." });
      return res.json(results);
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      console.error("Unable to load backend app link scan results", error);
      return res.status(500).json({ error: "Unable to load app link scan results." });
    }
  });

  router.get("/admin/links/scan/export", verifyAdmin, async (req, res) => {
    try {
      const results = await scanner.getExportLinks(getUserId(req), {
        search: req.query.search,
        type: req.query.type,
      });
      if (!results) return res.status(404).json({ error: "No app link scan results are available yet." });
      if (results.status === "running") return res.status(409).json({ error: "App link scan is still running." });
      if (results.status !== "completed") return res.status(409).json({ error: "The app link scan did not complete successfully." });

      const sourcePaths = [...new Set(results.links.map((link) => {
        const pageUrl = new URL(link.pageUrl);
        return normalizePagePath(`${pageUrl.pathname}${pageUrl.search}`);
      }))];
      const disabledRows = sourcePaths.length
        ? await pool.query(
          `SELECT source_path, href, link_text
           FROM admin_disabled_app_link_rows
           WHERE source_path = ANY($1::text[])`,
          [sourcePaths]
        )
        : { rows: [] };
      const disabledLinkKeys = new Set(disabledRows.rows.map((link) => (
        getDisabledLinkKey(link.source_path, link.href, link.link_text)
      )));
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="app-links-${date}.csv"`);
      return res.send(`\uFEFF${createLinksCsv(results.links, disabledLinkKeys)}`);
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      console.error("Unable to export backend app link scan results", error);
      return res.status(500).json({ error: "Unable to export app link scan results." });
    }
  });

  router.get("/admin/links/disabled-pages", verifyAdmin, async (_req, res) => {
    try {
      const result = await pool.query(
        "SELECT path, disabled_at FROM admin_disabled_app_pages ORDER BY path"
      );
      return res.json({ pages: result.rows });
    } catch (error) {
      console.error("Unable to load disabled app pages", error);
      return res.status(500).json({ error: "Unable to load disabled app pages." });
    }
  });

  router.put("/admin/links/disabled-pages", verifyAdmin, async (req, res) => {
    try {
      const pagePath = normalizePagePath(req.body?.path);
      const result = await pool.query(
        `INSERT INTO admin_disabled_app_pages (path, disabled_by)
         VALUES ($1, $2)
         ON CONFLICT (path) DO UPDATE SET disabled_by = EXCLUDED.disabled_by, disabled_at = NOW()
         RETURNING path, disabled_at`,
        [pagePath, getUserId(req)]
      );
      return res.json({ page: result.rows[0] });
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      console.error("Unable to disable app page", error);
      return res.status(500).json({ error: "Unable to disable app page." });
    }
  });

  router.delete("/admin/links/disabled-pages", verifyAdmin, async (req, res) => {
    try {
      const pagePath = normalizePagePath(req.body?.path);
      await pool.query("DELETE FROM admin_disabled_app_pages WHERE path = $1", [pagePath]);
      return res.json({ path: pagePath, disabled: false });
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      console.error("Unable to re-enable app page", error);
      return res.status(500).json({ error: "Unable to re-enable app page." });
    }
  });

  router.get("/pages/availability", async (req, res) => {
    try {
      const pagePath = normalizePagePath(req.query.path);
      const [availability, disabledLinks] = await Promise.all([
        pool.query(
        "SELECT 1 FROM admin_disabled_app_pages WHERE path = $1",
        [pagePath]
        ),
        pool.query(
          "SELECT href, link_text AS \"linkText\" FROM admin_disabled_app_link_rows WHERE source_path = $1",
          [pagePath]
        ),
      ]);
      return res.json({
        path: pagePath,
        available: availability.rowCount === 0,
        disabledLinks: disabledLinks.rows,
      });
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      console.error("Unable to verify app page availability", error);
      return res.status(500).json({ error: "Unable to verify app page availability." });
    }
  });

  router.get("/admin/links/disabled-rows", verifyAdmin, async (req, res) => {
    try {
      const sourcePath = req.query.sourcePath ? normalizePagePath(req.query.sourcePath) : null;
      const result = sourcePath
        ? await pool.query(
          `SELECT source_path, href, link_text, disabled_at
           FROM admin_disabled_app_link_rows
           WHERE source_path = $1
           ORDER BY href, link_text`,
          [sourcePath]
        )
        : await pool.query(
          `SELECT source_path, href, link_text, disabled_at
           FROM admin_disabled_app_link_rows
           ORDER BY source_path, href, link_text`
        );
      return res.json({ links: result.rows });
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      console.error("Unable to load disabled links for app page", error);
      return res.status(500).json({ error: "Unable to load disabled links for app page." });
    }
  });

  router.put("/admin/links/disabled-rows", verifyAdmin, async (req, res) => {
    try {
      const sourcePath = normalizePagePath(req.body?.sourcePath);
      const href = normalizeInternalHref(req.body?.href, allowedOrigins);
      const linkText = normalizeLinkText(req.body?.text);
      const result = await pool.query(
        `INSERT INTO admin_disabled_app_link_rows (source_path, href, link_text, disabled_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source_path, href, link_text)
         DO UPDATE SET disabled_by = EXCLUDED.disabled_by, disabled_at = NOW()
         RETURNING source_path, href, link_text, disabled_at`,
        [sourcePath, href, linkText, getUserId(req)]
      );
      return res.json({ link: result.rows[0] });
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      console.error("Unable to disable scanned app link", error);
      return res.status(500).json({ error: "Unable to disable scanned app link." });
    }
  });

  router.delete("/admin/links/disabled-rows", verifyAdmin, async (req, res) => {
    try {
      const sourcePath = normalizePagePath(req.body?.sourcePath);
      const href = normalizeInternalHref(req.body?.href, allowedOrigins);
      const linkText = normalizeLinkText(req.body?.text);
      await pool.query(
        `DELETE FROM admin_disabled_app_link_rows
         WHERE source_path = $1 AND href = $2 AND link_text = $3`,
        [sourcePath, href, linkText]
      );
      return res.json({ sourcePath, href, text: linkText, disabled: false });
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      console.error("Unable to re-enable scanned app link", error);
      return res.status(500).json({ error: "Unable to re-enable scanned app link." });
    }
  });

  router.get("/pages/disabled-links", async (req, res) => {
    try {
      const sourcePath = normalizePagePath(req.query.path);
      const result = await pool.query(
        `SELECT href, link_text FROM admin_disabled_app_link_rows WHERE source_path = $1`,
        [sourcePath]
      );
      return res.json({ links: result.rows });
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message });
      console.error("Unable to verify disabled links for app page", error);
      return res.status(500).json({ error: "Unable to verify disabled links for app page." });
    }
  });

  return router;
}

module.exports = {
  createLinksScanRouter,
  normalizeInternalHref,
  normalizeLinkText,
  normalizePagePath,
};
