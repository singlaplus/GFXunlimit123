const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  MAX_SITEMAP_URLS,
  PUBLIC_PAGE_PATHS,
  SitemapGenerationError,
  createSitemapGenerator,
  discoverPublicUrls,
  normalizeSiteOrigin,
  splitSitemapEntries,
  validateSitemapFile,
} = require("../services/sitemapGenerator");

const SITE_URL = "https://www.gfxunlimit.com";
const TEST_DATE = new Date("2026-10-24T11:00:00.000Z");

function createFakePool() {
  const images = [
    { id: 7, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-01T00:00:00.000Z" },
  ];
  const blogPosts = [
    {
      id: 8,
      title: "A & B: Published",
      category: "News & Updates",
      publish_at: "2026-02-10T00:00:00.000Z",
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-11T00:00:00.000Z",
    },
  ];
  const contributors = [{ id: 11, username: "Jane Doe" }];
  return {
    async query(sql, parameters = []) {
      if (sql.includes("COUNT(*)") && sql.includes("FROM images")) {
        return { rows: [{ total: images.length }] };
      }
      if (sql.includes("COUNT(*)") && sql.includes("FROM blog_drafts")) {
        return { rows: [{ total: blogPosts.length }] };
      }
      if (sql.includes("COUNT(*)") && sql.includes("FROM users")) {
        return { rows: [{ total: contributors.length }] };
      }
      if (sql.includes("FROM images")) {
        return { rows: images.filter((row) => Number(row.id) > Number(parameters[0])).slice(0, parameters[1]) };
      }
      if (sql.includes("FROM blog_drafts")) {
        return { rows: blogPosts.filter((row) => Number(row.id) > Number(parameters[0])).slice(0, parameters[1]) };
      }
      if (sql.includes("FROM users")) {
        return { rows: contributors.filter((row) => Number(row.id) > Number(parameters[0])).slice(0, parameters[1]) };
      }
      throw new Error(`Unexpected SQL in sitemap test: ${sql}`);
    },
  };
}

function createSettings(directory = "") {
  return { get: () => ({ path: directory }) };
}

async function waitForJob(generator, jobId) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const job = generator.getStatus(jobId);
    if (job && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Sitemap generation did not finish within the test timeout.");
}

function createTestGenerator(directory, options = {}) {
  const settingsDirectory = options.settingsDirectory || "";
  return createSitemapGenerator({
    pool: options.pool || createFakePool(),
    settings: createSettings(settingsDirectory),
    siteUrl: () => options.siteUrl ?? SITE_URL,
    defaultOutputDirectory: path.join(directory, "default"),
    manifestPath: path.join(directory, "sitemap-published.json"),
    clock: () => TEST_DATE,
  });
}

test("requires a trusted HTTPS production origin", () => {
  assert.equal(normalizeSiteOrigin("https://www.gfxunlimit.com/"), SITE_URL);
  for (const url of [
    "",
    "http://www.gfxunlimit.com",
    "https://localhost:3000",
    "https://staging.gfxunlimit.com",
    "https://192.168.1.20",
    "https://www.gfxunlimit.com/admin",
    "https://user:password@www.gfxunlimit.com",
  ]) {
    assert.throws(() => normalizeSiteOrigin(url), SitemapGenerationError, url);
  }
});

test("discovers only explicit public pages, approved assets, and published blog post URLs", async () => {
  const progress = [];
  const result = await discoverPublicUrls(createFakePool(), SITE_URL, (event) => progress.push(event));
  const discovered = new Map(result.urls.map((entry) => [entry.url, entry]));

  for (const pagePath of PUBLIC_PAGE_PATHS) {
    assert.ok(discovered.has(`${SITE_URL}${pagePath}`));
  }
  assert.ok(discovered.has(`${SITE_URL}/asset/7`));
  assert.ok(discovered.has(`${SITE_URL}/blog/news-and-updates/a-and-b-published_8`));
  assert.ok(discovered.has(`${SITE_URL}/c/c/c/c/Jane%20Doe`));
  assert.equal(discovered.get(`${SITE_URL}/asset/7`).lastModified, "2026-02-01T00:00:00.000Z");
  assert.equal(discovered.get(`${SITE_URL}/blog/news-and-updates/a-and-b-published_8`).lastModified, "2026-02-11T00:00:00.000Z");
  assert.equal([...discovered.keys()].some((url) => /\/(admin|account-settings|search|dashboard|cart)(\/|$|\?)/.test(url)), false);
  assert.equal(result.urls.length, PUBLIC_PAGE_PATHS.length + 3);
  assert.equal(progress.at(-1).stage, "Discovering approved assets, published posts, and contributors");
  assert.equal(progress.at(-1).processedUrls, result.processedUrls);
});

test("publishes validated sitemap files under the configured YYYY/MM/DD directory", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-generator-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configuredDirectory = path.join(directory, "configured");
  const generator = createTestGenerator(directory, { settingsDirectory: configuredDirectory });
  const job = generator.start();
  const completed = await waitForJob(generator, job.id);

  assert.equal(completed.status, "completed");
  assert.equal(completed.progress, 100);
  assert.equal(completed.result.totalUrls, PUBLIC_PAGE_PATHS.length + 3);
  assert.equal(completed.result.fileCount, 1);
  assert.equal(completed.result.primaryFilename, "sitemap.xml");
  assert.equal(completed.result.outputPath, path.join(configuredDirectory, "2026", "10", "24", "sitemap.xml"));
  assert.equal(await generator.getDownloadPath(job.id), completed.result.outputPath);
  assert.equal(
    await generator.getArchiveFile(job.id, "sitemap.xml"),
    completed.result.outputPath
  );
  const xml = fs.readFileSync(completed.result.outputPath, "utf8");
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /a-and-b-published_8/);
  assert.match(xml, /<lastmod>2026-02-11T00:00:00\.000Z<\/lastmod>/);
  await validateSitemapFile(completed.result.outputPath, "urlset", SITE_URL, completed.result.totalUrls);

  const secondJob = generator.start();
  const second = await waitForJob(generator, secondJob.id);
  assert.equal(second.status, "completed");
  assert.equal(second.result.primaryFilename, "sitemap1.xml");
});

test("uses the backend default sitemap directory when no custom path is configured", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-default-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const generator = createTestGenerator(directory);
  const job = generator.start();
  const completed = await waitForJob(generator, job.id);

  assert.equal(completed.status, "completed");
  assert.equal(
    completed.result.outputPath,
    path.join(directory, "default", "2026", "10", "24", "sitemap.xml")
  );
});

test("publishes a validated sitemap index and retrievable child files when the URL limit is exceeded", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-index-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const images = Array.from({ length: MAX_SITEMAP_URLS }, (_, index) => ({
    id: index + 1,
    created_at: null,
    updated_at: null,
  }));
  const pool = {
    async query(sql, parameters = []) {
      if (sql.includes("COUNT(*)") && sql.includes("FROM images")) {
        return { rows: [{ total: images.length }] };
      }
      if (sql.includes("COUNT(*)") && sql.includes("FROM blog_drafts")) {
        return { rows: [{ total: 0 }] };
      }
      if (sql.includes("COUNT(*)") && sql.includes("FROM users")) {
        return { rows: [{ total: 0 }] };
      }
      if (sql.includes("FROM images")) {
        return {
          rows: images
            .filter((row) => row.id > Number(parameters[0]))
            .slice(0, parameters[1]),
        };
      }
      if (sql.includes("FROM blog_drafts")) return { rows: [] };
      if (sql.includes("FROM users")) return { rows: [] };
      throw new Error(`Unexpected SQL in sitemap index test: ${sql}`);
    },
  };
  const generator = createTestGenerator(directory, { pool });
  const job = generator.start();
  const completed = await waitForJob(generator, job.id);

  assert.equal(completed.status, "completed");
  assert.equal(completed.result.totalUrls, MAX_SITEMAP_URLS + PUBLIC_PAGE_PATHS.length);
  assert.equal(completed.result.rootElement, "sitemapindex");
  assert.equal(completed.result.fileCount, 3);
  assert.equal(completed.result.primaryFilename, "sitemap.xml");

  const indexXml = fs.readFileSync(completed.result.outputPath, "utf8");
  assert.match(indexXml, new RegExp(`/sitemap-archive/${job.id}/sitemap1\\.xml`));
  assert.match(indexXml, new RegExp(`/sitemap-archive/${job.id}/sitemap2\\.xml`));
  await validateSitemapFile(completed.result.outputPath, "sitemapindex", SITE_URL, 2);
  for (const filename of ["sitemap1.xml", "sitemap2.xml"]) {
    const childPath = await generator.getArchiveFile(job.id, filename);
    assert.ok(childPath);
    const parsed = await validateSitemapFile(childPath, "urlset", SITE_URL, filename === "sitemap1.xml" ? MAX_SITEMAP_URLS : PUBLIC_PAGE_PATHS.length);
    assert.equal(parsed.entryCount, filename === "sitemap1.xml" ? MAX_SITEMAP_URLS : PUBLIC_PAGE_PATHS.length);
  }
});

test("keeps the prior public sitemap pointer when a later database discovery fails", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-recovery-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const generator = createTestGenerator(directory);
  const original = generator.start();
  const originalResult = await waitForJob(generator, original.id);
  assert.equal(originalResult.status, "completed");
  const originalPublished = await generator.getPublished();

  const failingGenerator = createTestGenerator(directory, {
    pool: { query: async () => { throw new Error("database unavailable"); } },
  });
  const logMock = context.mock.method(console, "error", () => {});
  const failed = failingGenerator.start();
  const failedResult = await waitForJob(failingGenerator, failed.id);
  assert.equal(failedResult.status, "failed");
  assert.match(failedResult.error, /backend logs/);
  assert.equal(logMock.mock.callCount(), 1);

  const stillPublished = await failingGenerator.getPublished();
  assert.equal(stillPublished.jobId, original.id);
  assert.equal(fs.existsSync(originalPublished.primaryPath), true);
});

test("splits sitemap URL sets at the standard 50,000 URL limit", () => {
  const entries = Array.from({ length: MAX_SITEMAP_URLS + 1 }, (_, index) => ({
    url: `${SITE_URL}/asset/${index + 1}`,
  }));
  const segments = splitSitemapEntries(entries);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].length, MAX_SITEMAP_URLS);
  assert.equal(segments[1].length, 1);
});

test("splits sitemap URL sets at the standard 50 MB file-size limit", () => {
  const longPathSuffix = "x".repeat(1_900);
  const entries = Array.from({ length: 28_000 }, (_, index) => ({
    url: `${SITE_URL}/${String(index).padStart(6, "0")}${longPathSuffix}`,
  }));
  const segments = splitSitemapEntries(entries);

  assert.equal(segments.length, 2);
  for (const segment of segments) {
    const size = Buffer.byteLength('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>')
      + segment.reduce((total, entry) => total + Buffer.byteLength(`<url><loc>${entry.url}</loc></url>`), 0);
    assert.ok(size <= 50 * 1024 * 1024);
  }
});

test("rejects generated XML entries that do not contain a valid location", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-xml-validation-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const malformedSitemapPath = path.join(directory, "malformed.xml");
  fs.writeFileSync(
    malformedSitemapPath,
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url></url></urlset>'
  );

  await assert.rejects(
    validateSitemapFile(malformedSitemapPath, "urlset", SITE_URL, 1),
    /exactly one location/
  );
});

test("refuses to start without a valid SITE_URL", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-site-url-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const generator = createTestGenerator(directory, { siteUrl: "" });

  assert.throws(() => generator.start(), /SITE_URL environment variable/);
});
