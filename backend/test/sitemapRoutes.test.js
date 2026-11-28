const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { createSitemapRouter } = require("../routes/sitemap-routes");

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(baseUrl, route, options = {}) {
  return fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { connection: "close", ...options.headers },
  });
}

test("protects generation, status, and download routes while serving published sitemap files publicly", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-routes-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const primaryPath = path.join(directory, "sitemap.xml");
  const archivePath = path.join(directory, "sitemap1.xml");
  fs.writeFileSync(
    primaryPath,
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.example.test/</loc></url><url><loc>https://www.example.test/photos</loc></url><url><loc>https://www.example.test/blog/a&amp;b</loc><lastmod>2026-11-12</lastmod></url><url><loc>https://www.example.test/blog/creative/bright-ideas_42</loc></url><url><loc>https://www.example.test/asset/42</loc></url><url><loc>https://www.example.test/c/artist</loc></url></urlset>`
  );
  fs.writeFileSync(archivePath, "<urlset />");
  const archiveId = "11111111-1111-4111-8111-111111111111";
  const generator = {
    start: () => ({ id: "job-1", status: "running" }),
    getCurrent: async () => ({ id: "job-1", status: "running" }),
    getStatus: () => ({ id: "job-1", status: "running" }),
    getDownloadPath: async () => primaryPath,
    getPublished: async () => ({
      primaryPath,
      siteOrigin: "https://www.example.test",
      rootElement: "urlset",
      generatedAt: "2026-11-12T10:00:00.000Z",
    }),
    getArchiveFile: async () => archivePath,
  };
  let savedSchedule = { enabled: false, frequency: "daily", time: "02:00" };
  const schedule = {
    getSettings: () => savedSchedule,
    save(value) {
      savedSchedule = value;
      return savedSchedule;
    },
  };
  const verifyAdmin = (req, res, next) => (
    req.get("authorization") === "Bearer admin"
      ? next()
      : res.status(401).json({ error: "Unauthorized" })
  );
  const pool = {
    async query(sql, values) {
      assert.deepEqual(values, [["42"]]);
      return {
        rows: [{
          id: "42",
          title: sql.includes("blog_drafts") ? "A Better & Brighter Idea" : "Golden Hour Sunset",
        }],
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use(createSitemapRouter({ generator, schedule, verifyAdmin, pool }));
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  context.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  for (const [method, route] of [
    ["POST", "/admin/sitemap/generation"],
    ["GET", "/admin/sitemap/generation"],
    ["GET", "/admin/sitemap/generation/job-1"],
    ["GET", "/admin/sitemap-schedule"],
    ["GET", "/admin/sitemap/download"],
  ]) {
    const response = await request(baseUrl, route, { method });
    assert.equal(response.status, 401, `${method} ${route} must require administrator authentication`);
  }

  const startResponse = await request(baseUrl, "/admin/sitemap/generation", {
    method: "POST",
    headers: { authorization: "Bearer admin" },
  });
  assert.equal(startResponse.status, 202);
  assert.equal((await startResponse.json()).job.id, "job-1");

  const statusResponse = await request(baseUrl, "/admin/sitemap/generation", {
    headers: { authorization: "Bearer admin" },
  });
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).job.status, "running");

  const saveScheduleResponse = await request(baseUrl, "/admin/sitemap-schedule", {
    method: "PUT",
    headers: {
      authorization: "Bearer admin",
      "content-type": "application/json",
    },
    body: JSON.stringify({ enabled: true, frequency: "weekly", time: "21:30", weekday: "monday" }),
  });
  assert.equal(saveScheduleResponse.status, 200);
  assert.deepEqual(await saveScheduleResponse.json(), {
    enabled: true,
    frequency: "weekly",
    time: "21:30",
    weekday: "monday",
  });

  const downloadResponse = await request(baseUrl, "/admin/sitemap/download", {
    headers: { authorization: "Bearer admin" },
  });
  assert.equal(downloadResponse.status, 200);
  assert.equal(downloadResponse.headers.get("content-type"), "application/xml");
  assert.match(await downloadResponse.text(), /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);

  const publicResponse = await request(baseUrl, "/sitemap.xml");
  assert.equal(publicResponse.status, 200);
  const publicSitemap = await publicResponse.text();
  assert.match(publicSitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(publicSitemap, /https:\/\/www\.example\.test\/c\/artist/);

  const sitemapDataResponse = await request(baseUrl, "/sitemap-page-data");
  assert.equal(sitemapDataResponse.status, 200);
  const sitemapData = await sitemapDataResponse.json();
  assert.equal(sitemapData.totalUrls, 6);
  assert.deepEqual(sitemapData.groups.map(({ id }) => id), ["main", "browse", "blog", "assets"]);
  assert.equal(sitemapData.groups.some(({ id }) => id === "contributors"), false);
  assert.equal(sitemapData.groups.find(({ id }) => id === "blog").entries
    .find(({ href }) => href.endsWith("/bright-ideas_42")).label, "A Better & Brighter Idea");
  assert.equal(sitemapData.groups.find(({ id }) => id === "assets").entries[0].label, "Golden Hour Sunset");

  const siteMapPageResponse = await request(baseUrl, "/sitemap/");
  const siteMapPage = await siteMapPageResponse.text();
  assert.equal(siteMapPageResponse.status, 200);
  assert.match(siteMapPageResponse.headers.get("content-type"), /text\/html/);
  assert.match(siteMapPage, /<title>Site Map \| GFXunlimit<\/title>/);
  assert.match(siteMapPage, /<nav class="header-nav" aria-label="Main navigation">/);
  assert.match(siteMapPage, /<a href="\/explore">Explore<\/a>/);
  assert.match(siteMapPage, /Main pages/);
  assert.match(siteMapPage, /Explore and browse/);
  assert.match(siteMapPage, /Creative assets/);
  assert.match(siteMapPage, /Golden Hour Sunset/);
  assert.match(siteMapPage, /A Better &amp; Brighter Idea/);
  assert.match(siteMapPage, /https:\/\/www\.example\.test\/blog\/a&amp;b/);
  assert.doesNotMatch(siteMapPage, /https:\/\/www\.example\.test\/c\/artist/);
  assert.match(siteMapPage, /View XML sitemap/);
  assert.match(siteMapPage, /<footer class="site-footer">/);
  assert.match(siteMapPage, /We provide high-quality stock images for creators, designers and teams\./);
  assert.match(siteMapPage, /<a href="\/privacy-policy">Privacy Policy<\/a>/);
  assert.match(siteMapPage, /<a href="\/terms-and-conditions">Terms &amp; Conditions<\/a>/);
  assert.match(siteMapPage, /<a href="\/cookie-policy">Cookie Policy<\/a>/);
  assert.match(siteMapPage, /<a href="\/help-center">Help Center<\/a>/);
  assert.doesNotMatch(siteMapPage, /href="\/privacy">Privacy Policy/);
  assert.match(siteMapPage, /<a href="\/sitemap">Sitemap<\/a>/);

  const stylesheetResponse = await request(baseUrl, "/sitemap.xsl");
  assert.equal(stylesheetResponse.status, 200);
  assert.match(stylesheetResponse.headers.get("content-type"), /application\/xslt\+xml/);
  assert.match(await stylesheetResponse.text(), /XML Sitemap/);

  const archiveResponse = await request(baseUrl, `/sitemap-archive/${archiveId}/sitemap1.xml`);
  assert.equal(archiveResponse.status, 200);
  assert.equal(await archiveResponse.text(), "<urlset />");
});

test("returns a clear not-found page when no published sitemap is available", async (context) => {
  const app = express();
  app.use(createSitemapRouter({
    generator: { getPublished: async () => null },
    schedule: {},
    verifyAdmin: (_req, _res, next) => next(),
  }));
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  context.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  const response = await request(baseUrl, "/sitemap/");
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "A sitemap has not been generated yet.");

  const dataResponse = await request(baseUrl, "/sitemap-page-data");
  assert.equal(dataResponse.status, 404);
  assert.deepEqual(await dataResponse.json(), { error: "A sitemap has not been generated yet." });
});

test("passes the production sitemap page request through to the frontend app", async (context) => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  context.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  const app = express();
  app.use(createSitemapRouter({
    generator: { getPublished: async () => null },
    schedule: {},
    verifyAdmin: (_req, _res, next) => next(),
  }));
  app.get("/sitemap", (_req, res) => res.status(200).send("frontend app"));
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  context.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  const response = await request(baseUrl, "/sitemap", {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "frontend app");
});
