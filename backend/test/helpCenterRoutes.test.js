const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createHelpCenterRouter } = require("../routes/help-center-routes");

const validContent = () => ({
  hero: {
    eyebrow: "GFXunlimit · Support",
    title: "Help Center",
    description: "Answers to common questions.",
    updatedAt: "2026-11-28",
    contactLabel: "Contact support",
    contactEmail: "hello@example.test",
    cardVisible: true,
    cardIcon: "?",
    cardTitle: "How can we help?",
    cardDescription: "Browse these answers."
  },
  overview: { label: "Support", title: "Find answers", body: "Browse help topics." },
  sections: [{
    id: "account-help",
    title: "Account help",
    visible: true,
    paragraphs: ["Use the sign-in options to access your account."],
    points: [],
    closing: ""
  }],
  contact: { label: "Contact", title: "Get in touch", body: "Email the support team.", email: "hello@example.test" },
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

test("publishes Help Center content publicly but only admins can save it", async (context) => {
  let savedContent = null;
  const pool = {
    async query(sql, values) {
      if (sql.startsWith("SELECT")) {
        assert.deepEqual(values, ["default"]);
        return { rows: savedContent ? [{ content: savedContent }] : [] };
      }
      assert.match(sql, /INSERT INTO help_center_settings/);
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
  app.use(createHelpCenterRouter({ pool, verifyAdmin }));
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  context.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  const initialRead = await fetch(`${baseUrl}/help-center/content`);
  assert.equal(initialRead.status, 200);
  assert.deepEqual(await initialRead.json(), { content: null });

  const unauthorizedSave = await fetch(`${baseUrl}/admin/help-center/content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validContent())
  });
  assert.equal(unauthorizedSave.status, 401);
  assert.equal(savedContent, null);

  const invalidSave = await fetch(`${baseUrl}/admin/help-center/content`, {
    method: "PUT",
    headers: {
      authorization: "Bearer admin",
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });
  assert.equal(invalidSave.status, 400);
  assert.match((await invalidSave.json()).error, /Help Center content/);
  assert.equal(savedContent, null);

  const published = validContent();
  published.hero.title = "Updated Help Center";
  const saveResponse = await fetch(`${baseUrl}/admin/help-center/content`, {
    method: "PUT",
    headers: {
      authorization: "Bearer admin",
      "content-type": "application/json"
    },
    body: JSON.stringify(published)
  });
  assert.equal(saveResponse.status, 200);
  assert.equal((await saveResponse.json()).content.hero.title, "Updated Help Center");

  const publicRead = await fetch(`${baseUrl}/help-center/content`);
  assert.equal((await publicRead.json()).content.hero.title, "Updated Help Center");
});
