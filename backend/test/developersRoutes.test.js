const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createDevelopersRouter } = require("../routes/developers-routes");

const validContent = () => ({
  hero: {
    eyebrow: "GFXunlimit · Developer resources",
    title: "Developers",
    description: "Developer resources and guidance.",
    updatedAt: "2026-11-28",
    contactLabel: "Contact our team",
    contactEmail: "hello@example.test",
    cardVisible: true,
    cardIcon: "</>",
    cardTitle: "Build with confidence",
    cardDescription: "Review asset and license details."
  },
  overview: { label: "Resources", title: "Get started", body: "Review these developer resources." },
  sections: [{
    id: "using-assets",
    title: "Using assets",
    visible: true,
    paragraphs: ["Review each asset's usage details."],
    points: [],
    closing: ""
  }],
  contact: { label: "Support", title: "Talk to our team", body: "Contact us with questions.", email: "hello@example.test" },
  appearance: {
    heroStart: "#081a2b",
    heroEnd: "#164e82",
    accent: "#0f766e",
    surface: "#ffffff",
    density: "comfortable",
    showTableOfContents: true
  }
});

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("publishes Developers page content publicly but only admins can save it", async (context) => {
  let savedContent = null;
  const pool = {
    async query(sql, values) {
      if (sql.startsWith("SELECT")) {
        assert.deepEqual(values, ["default"]);
        return { rows: savedContent ? [{ content: savedContent }] : [] };
      }
      assert.match(sql, /INSERT INTO developers_page_settings/);
      assert.deepEqual(values[0], "default");
      savedContent = JSON.parse(values[1]);
      return { rows: [{ content: savedContent }] };
    }
  };
  const verifyAdmin = (req, res, next) => (
    req.get("authorization") === "Bearer admin"
      ? next()
      : res.status(401).json({ error: "Unauthorized" })
  );
  const app = express();
  app.use(express.json());
  app.use(createDevelopersRouter({ pool, verifyAdmin }));
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  context.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  const initialRead = await fetch(`${baseUrl}/developers/content`);
  assert.equal(initialRead.status, 200);
  assert.deepEqual(await initialRead.json(), { content: null });

  const unauthorizedSave = await fetch(`${baseUrl}/admin/developers/content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validContent())
  });
  assert.equal(unauthorizedSave.status, 401);
  assert.equal(savedContent, null);

  const invalidSave = await fetch(`${baseUrl}/admin/developers/content`, {
    method: "PUT",
    headers: {
      authorization: "Bearer admin",
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });
  assert.equal(invalidSave.status, 400);
  assert.match((await invalidSave.json()).error, /Developers page content/);
  assert.equal(savedContent, null);

  const published = validContent();
  published.hero.title = "Updated Developers";
  const saveResponse = await fetch(`${baseUrl}/admin/developers/content`, {
    method: "PUT",
    headers: {
      authorization: "Bearer admin",
      "content-type": "application/json"
    },
    body: JSON.stringify(published)
  });
  assert.equal(saveResponse.status, 200);
  assert.equal((await saveResponse.json()).content.hero.title, "Updated Developers");

  const publicRead = await fetch(`${baseUrl}/developers/content`);
  assert.equal((await publicRead.json()).content.hero.title, "Updated Developers");
});
