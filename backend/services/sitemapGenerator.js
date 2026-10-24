const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { SaxesParser } = require("saxes");

const SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9";
const MAX_SITEMAP_URLS = 50_000;
const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
const QUERY_BATCH_SIZE = 1_000;
const PUBLIC_PAGE_PATHS = [
  "/",
  "/about",
  "/pricing",
  "/careers",
  "/contact",
  "/blog",
  "/explore",
  "/photos",
  "/vectors",
  "/psd",
  "/psds",
  "/videos",
  "/templates",
];

class SitemapGenerationError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "SitemapGenerationError";
    this.statusCode = statusCode;
  }
}

function normalizeSiteOrigin(siteUrl) {
  if (typeof siteUrl !== "string" || !siteUrl.trim()) {
    throw new SitemapGenerationError("Set the production SITE_URL environment variable before generating a sitemap.", 503);
  }

  let parsed;
  try {
    parsed = new URL(siteUrl.trim());
  } catch {
    throw new SitemapGenerationError("SITE_URL must be a valid HTTPS production URL.", 503);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const hostnameLabels = hostname.split(".");
  const reservedSuffixes = [".localhost", ".local", ".internal", ".test", ".example", ".invalid", ".lan", ".home", ".corp", ".intranet", ".onion"];
  const reservedHostname = hostname === "example.com"
    || hostname === "example.net"
    || hostname === "example.org"
    || net.isIP(hostname) !== 0
    || reservedSuffixes.some((suffix) => hostname.endsWith(suffix))
    || hostnameLabels.some((label) => [
      "localhost",
      "local",
      "internal",
      "staging",
      "stage",
      "dev",
      "development",
      "preview",
      "test",
    ].includes(label));

  if (
    parsed.protocol !== "https:"
    || !hostname.includes(".")
    || hostnameLabels.some((label) => !label || label.startsWith("-") || label.endsWith("-"))
    || reservedHostname
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new SitemapGenerationError("SITE_URL must be a trusted HTTPS production origin, without a path, credentials, query, or fragment.", 503);
  }

  return parsed.origin;
}

function slugifyBlogSegment(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "blog";
}

function normalizePublicUrl(routePath, siteOrigin) {
  if (typeof routePath !== "string" || !routePath.startsWith("/") || routePath.startsWith("//")) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(routePath, siteOrigin);
  } catch {
    return null;
  }
  if (
    parsed.origin !== siteOrigin
    || parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    return null;
  }
  return parsed.href;
}

function normalizeLastModified(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function addDiscoveredUrl(urls, routePath, siteOrigin, lastModified) {
  const url = normalizePublicUrl(routePath, siteOrigin);
  if (!url) return;
  const normalizedLastModified = normalizeLastModified(lastModified);
  const existing = urls.get(url);
  if (!existing || (normalizedLastModified && normalizedLastModified > (existing.lastModified || ""))) {
    urls.set(url, { url, lastModified: normalizedLastModified });
  }
}

async function countRows(pool, table) {
  const result = await pool.query(
    table === "images"
      ? "SELECT COUNT(*)::bigint AS total FROM images WHERE LOWER(COALESCE(status, '')) = 'approved'"
      : table === "blog_drafts"
        ? "SELECT COUNT(*)::bigint AS total FROM blog_drafts WHERE status = 'published'"
        : "SELECT COUNT(*)::bigint AS total FROM users WHERE role = 'contributor' AND NULLIF(TRIM(username), '') IS NOT NULL"
  );
  return Number(result.rows[0]?.total || 0);
}

async function fetchBatch(pool, table, lastId) {
  if (table === "images") {
    return pool.query(
      `SELECT id, created_at, updated_at
       FROM images
       WHERE LOWER(COALESCE(status, '')) = 'approved' AND id > $1
       ORDER BY id
       LIMIT $2`,
      [lastId, QUERY_BATCH_SIZE]
    );
  }
  if (table === "blog_drafts") {
    return pool.query(
      `SELECT id, title, category, publish_at, created_at, updated_at
       FROM blog_drafts
       WHERE status = 'published' AND id > $1
       ORDER BY id
       LIMIT $2`,
      [lastId, QUERY_BATCH_SIZE]
    );
  }
  return pool.query(
    `SELECT id, username
     FROM users
     WHERE role = 'contributor' AND NULLIF(TRIM(username), '') IS NOT NULL AND id > $1
     ORDER BY id
     LIMIT $2`,
    [lastId, QUERY_BATCH_SIZE]
  );
}

async function discoverPublicUrls(pool, siteOrigin, onProgress = () => {}) {
  const urls = new Map();
  let completedPublicPages = 0;
  for (const pagePath of PUBLIC_PAGE_PATHS) {
    addDiscoveredUrl(urls, pagePath, siteOrigin);
    completedPublicPages += 1;
    onProgress({
      stage: "Discovering public pages",
      progress: Math.round((completedPublicPages / PUBLIC_PAGE_PATHS.length) * 20),
      processedUrls: completedPublicPages,
      totalDiscoveredUrls: PUBLIC_PAGE_PATHS.length,
    });
  }

  const [assetCount, blogCount, contributorCount] = await Promise.all([
    countRows(pool, "images"),
    countRows(pool, "blog_drafts"),
    countRows(pool, "contributors"),
  ]);
  const expectedDatabaseRows = assetCount + blogCount + contributorCount;
  let processedDatabaseRows = 0;

  for (const table of ["images", "blog_drafts", "contributors"]) {
    let lastId = "0";
    while (true) {
      const result = await fetchBatch(pool, table, lastId);
      if (result.rows.length === 0) break;

      for (const row of result.rows) {
        lastId = row.id;
        if (table === "images") {
          addDiscoveredUrl(urls, `/asset/${encodeURIComponent(String(row.id))}`, siteOrigin, row.updated_at || row.created_at);
        } else if (table === "blog_drafts") {
          const category = slugifyBlogSegment(row.category || "Blog");
          const title = slugifyBlogSegment(row.title || "Untitled Blog");
          addDiscoveredUrl(
            urls,
            `/blog/${category}/${title}_${encodeURIComponent(String(row.id))}`,
            siteOrigin,
            row.updated_at || row.publish_at || row.created_at
          );
        } else {
          addDiscoveredUrl(
            urls,
            `/c/c/c/c/${encodeURIComponent(String(row.username).trim())}`,
            siteOrigin
          );
        }
        processedDatabaseRows += 1;
      }

      const ratio = expectedDatabaseRows > 0 ? processedDatabaseRows / expectedDatabaseRows : 1;
      onProgress({
        stage: "Discovering approved assets, published posts, and contributors",
        progress: Math.min(70, 20 + Math.floor(ratio * 50)),
        processedUrls: completedPublicPages + processedDatabaseRows,
        totalDiscoveredUrls: PUBLIC_PAGE_PATHS.length + expectedDatabaseRows,
      });

      if (result.rows.length < QUERY_BATCH_SIZE) break;
    }
  }

  return {
    urls: [...urls.values()],
    processedUrls: completedPublicPages + processedDatabaseRows,
    totalDiscoveredUrls: PUBLIC_PAGE_PATHS.length + expectedDatabaseRows,
  };
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntryXml(entry) {
  const lastModified = entry.lastModified ? `<lastmod>${xmlEscape(entry.lastModified)}</lastmod>` : "";
  return `<url><loc>${xmlEscape(entry.url)}</loc>${lastModified}</url>`;
}

function sitemapXmlHeader(rootElement) {
  return `<?xml version="1.0" encoding="UTF-8"?><${rootElement} xmlns="${SITEMAP_NAMESPACE}">`;
}

function splitSitemapEntries(urls) {
  const segments = [];
  let currentSegment = [];
  const emptySitemapBytes = Buffer.byteLength(sitemapXmlHeader("urlset")) + Buffer.byteLength("</urlset>");
  let currentBytes = emptySitemapBytes;

  for (const url of urls) {
    const entry = urlEntryXml(url);
    const entryBytes = Buffer.byteLength(entry);
    if (entryBytes + emptySitemapBytes > MAX_SITEMAP_BYTES) {
      throw new SitemapGenerationError("A discovered URL is too large to fit in a valid sitemap.");
    }
    if (
      currentSegment.length > 0
      && (currentSegment.length >= MAX_SITEMAP_URLS || currentBytes + entryBytes > MAX_SITEMAP_BYTES)
    ) {
      segments.push(currentSegment);
      currentSegment = [];
      currentBytes = emptySitemapBytes;
    }
    currentSegment.push(url);
    currentBytes += entryBytes;
  }

  if (currentSegment.length > 0 || segments.length === 0) segments.push(currentSegment);
  return segments;
}

async function* createUrlsetStream(entries, onEntry) {
  yield sitemapXmlHeader("urlset");
  for (const entry of entries) {
    yield urlEntryXml(entry);
    onEntry();
  }
  yield "</urlset>";
}

async function* createIndexStream(entries, siteOrigin, archiveId, onEntry) {
  yield sitemapXmlHeader("sitemapindex");
  for (const entry of entries) {
    const childPath = `/sitemap-archive/${archiveId}/${entry.filename}`;
    const childUrl = normalizePublicUrl(childPath, siteOrigin);
    if (!childUrl) throw new SitemapGenerationError("Unable to build a valid public sitemap index URL.");
    yield `<sitemap><loc>${xmlEscape(childUrl)}</loc></sitemap>`;
    onEntry();
  }
  yield "</sitemapindex>";
}

async function validateSitemapFile(filePath, expectedRoot, siteOrigin, expectedEntries, onEntry = () => {}) {
  const parser = new SaxesParser({ xmlns: true });
  let rootName = "";
  let inLocation = false;
  let locationText = "";
  let entryCount = 0;
  let currentEntry = null;
  let parserError = null;
  const entryName = expectedRoot === "urlset" ? "url" : "sitemap";

  parser.on("error", (error) => {
    parserError = error;
  });
  parser.on("opentag", (tag) => {
    if (!rootName) {
      rootName = tag.local;
      if (tag.uri !== SITEMAP_NAMESPACE || tag.local !== expectedRoot) {
        parserError = new Error("The generated sitemap has an unexpected XML root element.");
      }
      return;
    }
    if (tag.local === entryName && tag.uri === SITEMAP_NAMESPACE) {
      entryCount += 1;
      if (entryCount > MAX_SITEMAP_URLS) {
        parserError = new Error("The generated sitemap exceeds the 50,000 entry limit.");
      }
      currentEntry = { locationCount: 0 };
      onEntry(entryCount);
    }
    if (tag.local === "loc" && tag.uri === SITEMAP_NAMESPACE) {
      if (currentEntry) currentEntry.locationCount += 1;
      inLocation = true;
      locationText = "";
    }
  });
  parser.on("text", (text) => {
    if (inLocation) locationText += text;
  });
  parser.on("closetag", (tag) => {
    if (tag.local === "loc" && tag.uri === SITEMAP_NAMESPACE) {
      inLocation = false;
      try {
        const location = new URL(locationText);
        if (
          location.protocol !== "https:"
          || location.origin !== siteOrigin
          || location.search
          || location.hash
        ) {
          parserError = new Error("The generated sitemap contains a URL outside the configured production origin.");
        }
      } catch {
        parserError = new Error("The generated sitemap contains an invalid URL.");
      }
    }
    if (tag.local === entryName && tag.uri === SITEMAP_NAMESPACE) {
      if (!currentEntry || currentEntry.locationCount !== 1) {
        parserError = new Error("Each sitemap entry must contain exactly one location.");
      }
      currentEntry = null;
    }
  });

  for await (const chunk of fs.createReadStream(filePath)) {
    parser.write(chunk.toString("utf8"));
    if (parserError) throw parserError;
  }
  parser.close();
  if (parserError) throw parserError;
  if (!rootName || entryCount !== expectedEntries) {
    throw new SitemapGenerationError("The generated sitemap failed XML validation.");
  }
  const stats = await fs.promises.stat(filePath);
  if (stats.size > MAX_SITEMAP_BYTES) {
    throw new SitemapGenerationError("The generated sitemap exceeds the 50 MB sitemap limit.");
  }
  return { entryCount, sizeBytes: stats.size };
}

function sitemapFilename(index) {
  return `sitemap${index ? index : ""}.xml`;
}

async function isPathAvailable(filePath) {
  try {
    await fs.promises.access(filePath);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

async function findAvailableSitemapNames(directory, count) {
  const names = [];
  let index = 0;
  while (names.length < count) {
    const filename = sitemapFilename(index);
    if (await isPathAvailable(path.join(directory, filename))) names.push(filename);
    index += 1;
  }
  return names;
}

async function writeStreamToFile(filePath, stream) {
  await pipeline(
    Readable.from(stream),
    fs.createWriteStream(filePath, { flags: "wx", mode: 0o644 })
  );
}

async function readPublishedManifest(filePath) {
  try {
    const manifest = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    return {
      latest: manifest.latest || null,
      archives: manifest.archives && typeof manifest.archives === "object" ? manifest.archives : {},
    };
  } catch (error) {
    if (error.code === "ENOENT") return { latest: null, archives: {} };
    throw new SitemapGenerationError("The published sitemap record could not be read.");
  }
}

async function writePublishedManifest(filePath, manifest) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fs.promises.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true });
    throw error;
  }
}

function createSitemapGenerator({
  pool,
  settings,
  siteUrl = () => process.env.SITE_URL,
  defaultOutputDirectory = path.join(__dirname, "..", "generated", "sitemaps"),
  manifestPath = path.join(__dirname, "..", "settings", "sitemap-published.json"),
  clock = () => new Date(),
}) {
  const jobs = new Map();
  let activeJobId = null;
  let latestCompletedJob = null;

  const updateJob = (job, updates) => {
    Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  };

  const runGeneration = async (job) => {
    const temporaryPaths = [];
    const publishedPaths = [];
    try {
      const siteOrigin = normalizeSiteOrigin(siteUrl());
      const configuredPath = settings.get().path;
      const storageRoot = configuredPath || defaultOutputDirectory;
      const generatedAt = clock();
      if (Number.isNaN(generatedAt.getTime())) {
        throw new SitemapGenerationError("The sitemap generation clock returned an invalid date.");
      }
      const year = String(generatedAt.getUTCFullYear());
      const month = String(generatedAt.getUTCMonth() + 1).padStart(2, "0");
      const day = String(generatedAt.getUTCDate()).padStart(2, "0");
      const dateDirectory = path.join(storageRoot, year, month, day);
      await fs.promises.mkdir(dateDirectory, { recursive: true });
      const archiveId = job.id;

      const discovery = await discoverPublicUrls(pool, siteOrigin, (progress) => updateJob(job, progress));
      const uniqueUrls = discovery.urls;
      updateJob(job, {
        stage: "Preparing sitemap files",
        progress: 72,
        processedUrls: discovery.processedUrls,
        totalDiscoveredUrls: discovery.totalDiscoveredUrls,
        totalUrls: uniqueUrls.length,
      });
      const segments = splitSitemapEntries(uniqueUrls);
      if (segments.length > MAX_SITEMAP_URLS) {
        throw new SitemapGenerationError("The generated sitemap index would exceed the 50,000-file sitemap limit.");
      }
      const filenames = await findAvailableSitemapNames(dateDirectory, segments.length + (segments.length > 1 ? 1 : 0));
      const primaryFilename = filenames[0];
      const childFilenames = segments.length > 1 ? filenames.slice(1) : [];
      const filePlans = segments.map((entries, index) => ({
        filename: segments.length > 1 ? childFilenames[index] : primaryFilename,
        entries,
        temporaryPath: path.join(dateDirectory, `.${job.id}-${index}.tmp`),
      }));
      const primaryTemporaryPath = path.join(dateDirectory, `.${job.id}-primary.tmp`);
      temporaryPaths.push(primaryTemporaryPath, ...filePlans.map(({ temporaryPath: filePath }) => filePath));

      let writtenEntries = 0;
      for (const [index, plan] of filePlans.entries()) {
        updateJob(job, {
          stage: `Writing sitemap file ${index + 1} of ${filePlans.length}`,
          progress: 74 + Math.floor((writtenEntries / Math.max(1, uniqueUrls.length)) * 14),
        });
        await writeStreamToFile(
          plan.temporaryPath,
          createUrlsetStream(plan.entries, () => {
            writtenEntries += 1;
            if (writtenEntries % 100 === 0 || writtenEntries === uniqueUrls.length) {
              updateJob(job, {
                stage: `Writing sitemap file ${index + 1} of ${filePlans.length}`,
                progress: 74 + Math.floor((writtenEntries / Math.max(1, uniqueUrls.length)) * 14),
                processedUrls: discovery.processedUrls,
                totalDiscoveredUrls: discovery.totalDiscoveredUrls,
                totalUrls: uniqueUrls.length,
              });
            }
          })
        );
        updateJob(job, { stage: `Validating sitemap file ${index + 1} of ${filePlans.length}`, progress: 88 });
        await validateSitemapFile(
          plan.temporaryPath,
          "urlset",
          siteOrigin,
          plan.entries.length,
          (validatedCount) => {
            if (validatedCount % 1_000 === 0 || validatedCount === plan.entries.length) {
              const validatedBefore = filePlans
                .slice(0, index)
                .reduce((total, previousPlan) => total + previousPlan.entries.length, 0);
              updateJob(job, {
                stage: `Validating sitemap file ${index + 1} of ${filePlans.length}`,
                progress: 88 + Math.floor(((validatedBefore + validatedCount) / Math.max(1, uniqueUrls.length)) * 2),
                processedUrls: discovery.processedUrls,
                totalDiscoveredUrls: discovery.totalDiscoveredUrls,
                totalUrls: uniqueUrls.length,
              });
            }
          }
        );
      }

      let primaryRoot = "urlset";
      if (segments.length > 1) {
        primaryRoot = "sitemapindex";
        await writeStreamToFile(
          primaryTemporaryPath,
          createIndexStream(
            filePlans.map((plan) => ({ filename: plan.filename })),
            siteOrigin,
            archiveId,
            () => {}
          )
        );
        await validateSitemapFile(primaryTemporaryPath, "sitemapindex", siteOrigin, filePlans.length);
      } else {
        await fs.promises.rename(filePlans[0].temporaryPath, primaryTemporaryPath);
        temporaryPaths.splice(temporaryPaths.indexOf(filePlans[0].temporaryPath), 1);
      }

      updateJob(job, { stage: "Publishing sitemap", progress: 90 });
      const publishedFilePlans = segments.length > 1
        ? [...filePlans, {
          filename: primaryFilename,
          temporaryPath: primaryTemporaryPath,
        }]
        : [{
          filename: primaryFilename,
          temporaryPath: primaryTemporaryPath,
        }];

      for (const [index, plan] of publishedFilePlans.entries()) {
        const finalPath = path.join(dateDirectory, plan.filename);
        await fs.promises.link(plan.temporaryPath, finalPath);
        await fs.promises.unlink(plan.temporaryPath);
        publishedPaths.push(finalPath);
        temporaryPaths.splice(temporaryPaths.indexOf(plan.temporaryPath), 1);
        updateJob(job, {
          stage: "Publishing sitemap",
          progress: 90 + Math.floor(((index + 1) / publishedFilePlans.length) * 8),
        });
      }

      const primaryPath = path.join(dateDirectory, primaryFilename);
      const primaryStats = await fs.promises.stat(primaryPath);
      const totalSizeBytes = (await Promise.all(publishedPaths.map((filePath) => fs.promises.stat(filePath))))
        .reduce((total, stats) => total + stats.size, 0);
      const priorManifest = await readPublishedManifest(manifestPath);
      const latest = {
        jobId: job.id,
        siteOrigin,
        primaryPath,
        primaryFilename,
        archiveId,
        archiveDirectory: dateDirectory,
        childFilenames: segments.length > 1 ? childFilenames : [],
        generatedAt: generatedAt.toISOString(),
        totalUrls: uniqueUrls.length,
        fileCount: publishedPaths.length,
        fileSizeBytes: primaryStats.size,
        totalSizeBytes,
        rootElement: primaryRoot,
      };
      priorManifest.latest = latest;
      priorManifest.archives[archiveId] = {
        directory: dateDirectory,
        filenames: publishedPaths.map((filePath) => path.basename(filePath)),
      };
      await writePublishedManifest(manifestPath, priorManifest);

      const result = {
        generatedAt: latest.generatedAt,
        totalUrls: latest.totalUrls,
        fileCount: latest.fileCount,
        fileSizeBytes: latest.fileSizeBytes,
        totalSizeBytes: latest.totalSizeBytes,
        primaryFilename,
        outputPath: primaryPath,
        rootElement: primaryRoot,
        publicUrl: `${siteOrigin}/sitemap.xml`,
      };
      updateJob(job, {
        status: "completed",
        stage: "Complete",
        progress: 100,
        processedUrls: discovery.processedUrls,
        totalDiscoveredUrls: discovery.totalDiscoveredUrls,
        totalUrls: uniqueUrls.length,
        result,
        completedAt: new Date().toISOString(),
      });
      latestCompletedJob = job;
    } catch (error) {
      for (const temporaryPath of temporaryPaths) {
        await fs.promises.rm(temporaryPath, { force: true }).catch((cleanupError) => {
          console.error("Unable to remove temporary sitemap file", cleanupError);
        });
      }
      updateJob(job, {
        status: "failed",
        stage: "Failed",
        error: error instanceof SitemapGenerationError
          ? error.message
          : "Sitemap generation failed. Check the backend logs for details.",
        completedAt: new Date().toISOString(),
      });
      if (!(error instanceof SitemapGenerationError)) {
        console.error("Sitemap generation failed", error);
      }
    } finally {
      if (activeJobId === job.id) activeJobId = null;
    }
  };

  return {
    start() {
      if (activeJobId) {
        throw new SitemapGenerationError("A sitemap generation is already in progress.", 409);
      }
      normalizeSiteOrigin(siteUrl());
      const job = {
        id: crypto.randomUUID(),
        status: "running",
        stage: "Starting sitemap generation",
        progress: 0,
        processedUrls: 0,
        totalDiscoveredUrls: 0,
        totalUrls: 0,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      jobs.set(job.id, job);
      activeJobId = job.id;
      setImmediate(() => {
        runGeneration(job);
      });
      return { ...job };
    },
    getStatus(jobId) {
      const job = jobs.get(jobId);
      return job ? { ...job } : null;
    },
    async getCurrent() {
      if (activeJobId) return { ...jobs.get(activeJobId) };
      if (latestCompletedJob) return { ...latestCompletedJob };
      const published = await this.getPublished();
      if (!published) return null;
      return {
        id: published.jobId,
        status: "completed",
        stage: "Complete",
        progress: 100,
        processedUrls: published.totalUrls,
        totalDiscoveredUrls: published.totalUrls,
        totalUrls: published.totalUrls,
        completedAt: published.generatedAt,
        result: {
          generatedAt: published.generatedAt,
          totalUrls: published.totalUrls,
          fileCount: published.fileCount,
          fileSizeBytes: published.fileSizeBytes,
          totalSizeBytes: published.totalSizeBytes,
          primaryFilename: published.primaryFilename,
          outputPath: published.primaryPath,
          rootElement: published.rootElement,
          publicUrl: `${published.siteOrigin}/sitemap.xml`,
        },
      };
    },
    async getPublished() {
      const manifest = await readPublishedManifest(manifestPath);
      return manifest.latest;
    },
    async getArchiveFile(archiveId, filename) {
      if (!/^[0-9a-f-]{36}$/i.test(archiveId) || !/^sitemap\d*\.xml$/.test(filename)) return null;
      const manifest = await readPublishedManifest(manifestPath);
      const archive = manifest.archives[archiveId];
      if (!archive || !archive.filenames.includes(filename)) return null;
      const filePath = path.join(archive.directory, filename);
      try {
        const stats = await fs.promises.stat(filePath);
        return stats.isFile() ? filePath : null;
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async getDownloadPath(jobId) {
      if (jobId) {
        const job = jobs.get(jobId);
        if (job?.status === "completed") {
          const published = await this.getPublished();
          if (published?.jobId === jobId) return published.primaryPath;
        }
        return null;
      }
      const published = await this.getPublished();
      return published?.primaryPath || null;
    },
  };
}

module.exports = {
  MAX_SITEMAP_BYTES,
  MAX_SITEMAP_URLS,
  PUBLIC_PAGE_PATHS,
  SitemapGenerationError,
  createSitemapGenerator,
  discoverPublicUrls,
  normalizePublicUrl,
  normalizeSiteOrigin,
  splitSitemapEntries,
  validateSitemapFile,
};
