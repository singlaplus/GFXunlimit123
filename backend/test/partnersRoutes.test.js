const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createPartnersRouter } = require("../routes/partners-routes");

const validContent = () => ({
  hero: {
    eyebrow: "GFXunlimit · Partnership inquiries",
    title: "Partners",
    description: "Explore partnership opportunities.",
    updatedAt: "2026-11-28",
    contactLabel: "Discuss a partnership",
    contactEmail: "hello@example.test",
    cardVisible: true,
    cardIcon: "+",
    cardTitle: "Better creative together",
    cardDescription: "Tell us what you are building."
  },
  overview: { label: "Partnerships", title: "Let's work together", body: "Share a partnership proposal." },
  sections: [{
    id: "partnership-opportunities",
    title: "Ways to work together",
    visible: true,
    paragraphs: ["We review proposals individually."],
    points: [],
    closing: ""
  }],
  contact: { label: "Interested?", title: "Contact us", body: "Send a short proposal.", email: "hello@example.test" },
  appearance: {
    heroStart: "#172554",
    heroEnd: "#0f766e",
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

test("publishes Partners content publicly but only admins can save it", async (context) => {
  let savedContent = null;
  const pool = {
    async query(sql, values) {
      if (sql.startsWith("SELECT")) {
        assert.deepEqual(values, ["default"]);
        return { rows: savedContent ? [{ content: savedContent }] : [] };
      }
      assert.match(sql, /INSERT INTO partners_page_settings/);
      assert.equal(values[0], "default");
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
  app.use(createPartnersRouter({ pool, verifyAdmin }));
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  context.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  const initialRead = await fetch(`${baseUrl}/partners/content`);
  assert.equal(initialRead.status, 200);
  assert.deepEqual(await initialRead.json(), { content: null });

  const unauthorizedSave = await fetch(`${baseUrl}/admin/partners/content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validContent())
  });
  assert.equal(unauthorizedSave.status, 401);
  assert.equal(savedContent, null);

  const invalidSave = await fetch(`${baseUrl}/admin/partners/content`, {
    method: "PUT",
    headers: {
      authorization: "Bearer admin",
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });
  assert.equal(invalidSave.status, 400);
  assert.match((await invalidSave.json()).error, /Partners page content/);
  assert.equal(savedContent, null);

  const content = validContent();
  content.hero.title = "Partner with GFXunlimit";
  const publishResponse = await fetch(`${baseUrl}/admin/partners/content`, {
    method: "PUT",
    headers: {
      authorization: "Bearer admin",
      "content-type": "application/json"
    },
    body: JSON.stringify(content)
  });
  assert.equal(publishResponse.status, 200);
  assert.equal((await publishResponse.json()).content.hero.title, "Partner with GFXunlimit");

  const publicRead = await fetch(`${baseUrl}/partners/content`);
  assert.equal((await publicRead.json()).content.hero.title, "Partner with GFXunlimit");
});
