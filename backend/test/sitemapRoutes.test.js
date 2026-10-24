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
  fs.writeFileSync(primaryPath, "<urlset />");
  fs.writeFileSync(archivePath, "<urlset />");
  const archiveId = "11111111-1111-4111-8111-111111111111";
  const generator = {
    start: () => ({ id: "job-1", status: "running" }),
    getCurrent: async () => ({ id: "job-1", status: "running" }),
    getStatus: () => ({ id: "job-1", status: "running" }),
    getDownloadPath: async () => primaryPath,
    getPublished: async () => ({ primaryPath }),
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
  const app = express();
  app.use(express.json());
  app.use(createSitemapRouter({ generator, schedule, verifyAdmin }));
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
  assert.equal(await downloadResponse.text(), "<urlset />");

  const publicResponse = await request(baseUrl, "/sitemap.xml");
  assert.equal(publicResponse.status, 200);
  assert.equal(await publicResponse.text(), "<urlset />");

  const archiveResponse = await request(baseUrl, `/sitemap-archive/${archiveId}/sitemap1.xml`);
  assert.equal(archiveResponse.status, 200);
  assert.equal(await archiveResponse.text(), "<urlset />");
});
