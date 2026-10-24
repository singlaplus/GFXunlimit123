const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { chromium: defaultChromium } = require("playwright");

const ADMIN_PATH = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
const PUBLIC_PATHS = [
  "/",
  "/explore",
  "/search",
  "/photos",
  "/vectors",
  "/psd",
  "/psds",
  "/videos",
  "/templates",
  "/favorites",
  "/downloads",
  "/upload",
  "/profile",
  "/payments",
  "/contributor",
  "/myuploads",
  "/customer",
  "/dashboard",
  "/messages",
  "/about",
  "/pricing",
  "/careers",
  "/contact",
  "/privacy",
  "/terms",
  "/cookies",
  "/help",
  "/blog",
  "/developers",
  "/partners",
];
const ADMIN_TABS = [
  "admin_dashboard",
  "controls",
  "live-assets",
  "users",
  "contributordetails",
  "taxforms",
  "controls_taxforms",
  "controls_database",
  "controls_assets",
  "links",
  "sitemap",
  "customerdetails",
  "promotions",
  "myaccount",
  "backup",
  "restore",
];
const SCAN_PATHS = [...new Set([
  ...PUBLIC_PATHS,
  ...ADMIN_TABS.map((tab) => `${ADMIN_PATH}?tab=${tab}`),
  `${ADMIN_PATH}?status=pending`,
  `${ADMIN_PATH}?status=approved`,
  `${ADMIN_PATH}?status=rejected`,
  `${ADMIN_PATH}/analytics`,
  `${ADMIN_PATH}/commerce`,
  `${ADMIN_PATH}/orders`,
  `${ADMIN_PATH}/email/daily-report-settings?tab=controls`,
  `${ADMIN_PATH}/email/daily-report-preview?tab=controls`,
  "/admin/analytics",
  "/admin/commerce",
  "/admin/orders",
  "/admin/current-plans",
  "/admin/subscribers",
  "/admin/custom-subscriptions",
])];
const PAGE_CONCURRENCY = 3;
const PAGE_TIMEOUT_MS = 20_000;
const LINKS_PER_PAGE_MAX = 100;
const MAX_RESULTS = 20_000;
const LINK_TYPES = new Set(["All", "Internal", "External", "Email", "Phone"]);

function resolveChromeExecutable(configuredPath = process.env.LINK_SCAN_CHROME_PATH) {
  const candidates = [
    configuredPath,
    process.platform === "darwin" && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    process.platform === "darwin" && "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(path.resolve(candidate))) || null;
}

function normalizeUserId(userId) {
  const normalized = String(userId ?? "");
  if (!/^\d+$/.test(normalized) || Number(normalized) <= 0) {
    throw new TypeError("A valid signed-in admin user is required.");
  }
  return normalized;
}

function normalizeOrigin(origin, allowedOrigins) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new TypeError("The app origin is invalid.");
  }
  if (
    !["https:", "http:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.origin !== origin
    || !allowedOrigins.has(parsed.origin)
  ) {
    throw new TypeError("The app origin is not in the trusted frontend origin list.");
  }
  return parsed.origin;
}

function classifyLink(href, origin) {
  let url;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") return "Email";
  if (url.protocol === "tel:") return "Phone";
  if (!["http:", "https:"].includes(url.protocol)) return null;
  return url.origin === origin ? "Internal" : "External";
}

function extractRenderedLinks(anchors, pageUrl, origin) {
  const links = new Map();
  anchors.forEach((anchor) => {
    let href;
    try {
      href = new URL(anchor.href, pageUrl).href;
    } catch {
      return;
    }
    const type = classifyLink(href, origin);
    if (!type) return;
    const text = String(anchor.text || anchor.ariaLabel || anchor.title || "").trim().replace(/\s+/g, " ")
      || "Unlabeled link";
    const key = `${pageUrl}\u0000${href}\u0000${text}`;
    links.set(key, { pageUrl, text, href, type });
  });
  return [...links.values()];
}

function getChromeLaunchOptions(configuredPath) {
  const executablePath = resolveChromeExecutable(configuredPath);
  return executablePath
    ? { executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] }
    : { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
}

function sanitizeScanRow(row) {
  return {
    scanId: row.scan_id,
    status: row.status,
    errors: Array.isArray(row.errors) ? row.errors : [],
    pagesScanned: Number(row.pages_scanned) || 0,
    totalPages: Number(row.total_pages) || 0,
    error: row.error || null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    totalLinks: Array.isArray(row.links) ? row.links.length : 0,
  };
}

function createLinksScanner({
  pool,
  chromium = defaultChromium,
  allowedOrigins,
  chromePath = process.env.LINK_SCAN_CHROME_PATH,
  logger = console,
  paths = SCAN_PATHS,
  concurrency = PAGE_CONCURRENCY,
  pageTimeout = PAGE_TIMEOUT_MS,
}) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("Link scanner requires a database pool.");
  }
  if (!(allowedOrigins instanceof Set) || allowedOrigins.size === 0) {
    throw new TypeError("Link scanner requires a trusted frontend origin allowlist.");
  }

  const jobs = new Map();
  let browserPromise = null;

  const getBrowser = () => {
    if (!browserPromise) {
      browserPromise = chromium.launch(getChromeLaunchOptions(chromePath)).catch((error) => {
        browserPromise = null;
        throw error;
      });
    }
    return browserPromise;
  };

  const persistJob = async (userId, job, links = [], errors = []) => {
    await pool.query(
      `INSERT INTO admin_link_scans (
         user_id, scan_id, status, links, errors, pages_scanned, total_pages, error, started_at, completed_at
       )
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)
       ON CONFLICT (user_id) DO UPDATE SET
         scan_id = EXCLUDED.scan_id,
         status = EXCLUDED.status,
         links = EXCLUDED.links,
         errors = EXCLUDED.errors,
         pages_scanned = EXCLUDED.pages_scanned,
         total_pages = EXCLUDED.total_pages,
         error = EXCLUDED.error,
         started_at = EXCLUDED.started_at,
         completed_at = EXCLUDED.completed_at`,
      [
        userId,
        job.scanId,
        job.status,
        JSON.stringify(links),
        JSON.stringify(errors),
        job.pagesScanned,
        job.totalPages,
        job.error,
        job.startedAt,
        job.completedAt,
      ]
    );
  };

  const getFilteredScan = async (userId, options = {}) => {
    const search = String(options.search || "").trim().slice(0, 200).toLowerCase();
    const type = options.type ?? "All";
    if (!LINK_TYPES.has(type)) throw new TypeError("Link type must be All, Internal, External, Email, or Phone.");

    const result = await pool.query(
      `SELECT scan_id, status, links, errors, pages_scanned, total_pages, error, started_at, completed_at
       FROM admin_link_scans WHERE user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) return null;
    const allLinks = Array.isArray(row.links) ? row.links : JSON.parse(row.links || "[]");
    const links = allLinks.filter((link) => (
      (type === "All" || link.type === type)
      && (!search || `${link.text} ${link.href} ${link.pageUrl}`.toLowerCase().includes(search))
    ));
    return { row, links };
  };

  const scanPage = async (context, pageUrl, origin, authorization) => {
    const page = await context.newPage();
    try {
      await page.route("**/*", async (route) => {
        const requestUrl = new URL(route.request().url());
        const headers = { ...route.request().headers() };
        delete headers.authorization;
        if (requestUrl.origin === origin) headers.authorization = authorization;
        await route.continue({ headers });
      });
      await page.addInitScript(({ expectedOrigin, token }) => {
        if (window.location.origin === expectedOrigin) localStorage.setItem("token", token);
      }, { expectedOrigin: origin, token: authorization.replace(/^Bearer\s+/i, "") });
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: pageTimeout });
      await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(500);
      const anchors = await page.locator("a[href]").evaluateAll((elements) => elements.map((anchor) => ({
        href: anchor.href,
        text: anchor.innerText || anchor.textContent || "",
        ariaLabel: anchor.getAttribute("aria-label") || "",
        title: anchor.title || "",
      })));
      return extractRenderedLinks(anchors, pageUrl, origin);
    } finally {
      await page.close();
    }
  };

  const runScan = async (userId, job, origin, authorization) => {
    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const links = new Map();
    const errors = [];
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < paths.length) {
        const index = nextIndex;
        nextIndex += 1;
        const pageUrl = new URL(paths[index], origin).href;
        try {
          const pageLinks = await scanPage(context, pageUrl, origin, authorization);
          for (const link of pageLinks) {
            const key = `${link.pageUrl}\u0000${link.href}\u0000${link.text}`;
            if (links.size < MAX_RESULTS || links.has(key)) links.set(key, link);
          }
        } catch (error) {
          errors.push({ pageUrl, message: error.message || "Unable to scan this page." });
          logger.warn(`Unable to scan app page ${pageUrl}`, error.message || error);
        }
        job.pagesScanned += 1;
      }
    };

    try {
      await Promise.all(Array.from(
        { length: Math.min(concurrency, paths.length) },
        () => worker()
      ));
    } finally {
      await context.close();
    }

    job.status = "completed";
    job.pagesScanned = paths.length;
    job.completedAt = new Date().toISOString();
    const discoveredLinks = [...links.values()];
    await persistJob(userId, job, discoveredLinks, errors);
    return { links: discoveredLinks, errors };
  };

  return {
    async start(userIdValue, { origin, authorization }) {
      const userId = normalizeUserId(userIdValue);
      const trustedOrigin = normalizeOrigin(origin, allowedOrigins);
      if (typeof authorization !== "string" || !/^Bearer\s+\S+$/i.test(authorization)) {
        throw new TypeError("A valid signed-in admin authorization token is required.");
      }
      const current = jobs.get(userId);
      if (current?.status === "running") return { ...current, alreadyRunning: true };

      const job = {
        scanId: crypto.randomUUID(),
        status: "running",
        pagesScanned: 0,
        totalPages: paths.length,
        error: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
      };
      jobs.set(userId, job);
      try {
        await persistJob(userId, job);
      } catch (error) {
        if (jobs.get(userId) === job) jobs.delete(userId);
        throw error;
      }
      void runScan(userId, job, trustedOrigin, authorization).catch(async (error) => {
        logger.error("Backend app link scan failed", error);
        job.status = "failed";
        job.error = "The backend could not complete the app link scan.";
        job.completedAt = new Date().toISOString();
        try {
          await persistJob(userId, job);
        } catch (persistError) {
          logger.error("Unable to save the failed app link scan state", persistError);
        }
      });
      return { ...job };
    },
    async getStatus(userIdValue) {
      const userId = normalizeUserId(userIdValue);
      const current = jobs.get(userId);
      if (current?.status === "running") return { ...current };
      const result = await pool.query(
        `SELECT scan_id, status, errors, pages_scanned, total_pages, error, started_at, completed_at, links
         FROM admin_link_scans WHERE user_id = $1`,
        [userId]
      );
      return result.rows[0] ? sanitizeScanRow(result.rows[0]) : null;
    },
    async getResults(userIdValue, options = {}) {
      const userId = normalizeUserId(userIdValue);
      const page = Number(options.page ?? 1);
      const pageSize = Number(options.pageSize ?? 100);
      if (!Number.isInteger(page) || page < 1) throw new TypeError("Page must be a positive integer.");
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > LINKS_PER_PAGE_MAX) {
        throw new TypeError(`Page size must be between 1 and ${LINKS_PER_PAGE_MAX}.`);
      }

      const scan = await getFilteredScan(userId, options);
      if (!scan) return null;
      const { row, links: filtered } = scan;
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      const normalizedPage = Math.min(page, totalPages);
      const allLinks = Array.isArray(row.links) ? row.links : JSON.parse(row.links || "[]");
      const summary = allLinks.reduce((counts, link) => {
        counts.total += 1;
        if (link.type === "Internal") counts.internal += 1;
        else if (link.type === "External") counts.external += 1;
        return counts;
      }, { total: 0, internal: 0, external: 0 });
      return {
        scanId: row.scan_id,
        status: row.status,
        errors: Array.isArray(row.errors) ? row.errors : JSON.parse(row.errors || "[]"),
        pagesScanned: Number(row.pages_scanned) || 0,
        totalPagesScanned: Number(row.total_pages) || 0,
        error: row.error || null,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        summary,
        links: filtered.slice((normalizedPage - 1) * pageSize, normalizedPage * pageSize),
        pagination: {
          page: normalizedPage,
          pageSize,
          total: filtered.length,
          totalPages,
        },
      };
    },
    async getExportLinks(userIdValue, options = {}) {
      const userId = normalizeUserId(userIdValue);
      const scan = await getFilteredScan(userId, options);
      return scan ? { scanId: scan.row.scan_id, status: scan.row.status, links: scan.links } : null;
    },
    async close() {
      if (!browserPromise) return;
      const browser = await browserPromise.catch(() => null);
      browserPromise = null;
      await browser?.close();
    },
  };
}

module.exports = {
  ADMIN_PATH,
  SCAN_PATHS,
  classifyLink,
  createLinksScanner,
  extractRenderedLinks,
  normalizeOrigin,
  resolveChromeExecutable,
};
