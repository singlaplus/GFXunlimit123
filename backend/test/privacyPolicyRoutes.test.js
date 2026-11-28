const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createPrivacyPolicyRouter, validatePrivacyPolicyContent } = require("../routes/privacy-policy-routes");

const validPngDataUrl = () => {
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/yL8AAAAASUVORK5CYII=",
    "base64"
  );
  return `data:image/png;base64,${image.toString("base64")}`;
};

const validJpegDataUrl = () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
  return `data:image/jpeg;base64,${image.toString("base64")}`;
};

const validContent = () => ({
  hero: {
    eyebrow: "Legal",
    title: "Privacy Policy",
    description: "How the site uses information.",
    updatedAt: "2026-11-28",
    contactLabel: "Contact us",
    contactEmail: "privacy@example.test",
    cardVisible: true,
    cardIcon: "P",
    cardTitle: "Your privacy matters",
    cardDescription: "Your choices matter."
  },
  overview: { label: "Overview", title: "How it works", body: "Summary." },
  sections: [{
    id: "data",
    title: "Data",
    visible: true,
    paragraphs: ["Details."],
    points: [],
    closing: ""
  }],
  contact: { label: "Contact", title: "Get in touch", body: "Email us.", email: "privacy@example.test" },
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

test("publishes policy content publicly but only admins can save it", async (context) => {
  let savedContent = null;
  const pool = {
    async query(sql, values) {
      if (sql.startsWith("SELECT")) {
        assert.deepEqual(values, ["default"]);
        return { rows: savedContent ? [{ content: savedContent }] : [] };
      }
      assert.match(sql, /INSERT INTO privacy_policy_settings/);
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
  app.use(createPrivacyPolicyRouter({ pool, verifyAdmin }));
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  context.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  const initialRead = await fetch(`${baseUrl}/privacy-policy/content`);
  assert.equal(initialRead.status, 200);
  assert.deepEqual(await initialRead.json(), { content: null });

  const unauthorizedSave = await fetch(`${baseUrl}/admin/privacy-policy/content`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validContent())
  });
  assert.equal(unauthorizedSave.status, 401);
  assert.equal(savedContent, null);

  const published = validContent();
  published.hero.title = "Updated policy";
  published.hero.cardIconImage = validPngDataUrl();
  published.hero.backgroundImage = validPngDataUrl();
  const saveResponse = await fetch(`${baseUrl}/admin/privacy-policy/content`, {
    method: "PUT",
    headers: {
      authorization: "Bearer admin",
      "content-type": "application/json"
    },
    body: JSON.stringify(published)
  });
  assert.equal(saveResponse.status, 200);
  const savedContentResponse = await saveResponse.json();
  assert.equal(savedContentResponse.content.hero.title, "Updated policy");
  assert.equal(savedContentResponse.content.hero.cardIconImage, validPngDataUrl());
  assert.equal(savedContentResponse.content.hero.backgroundImage, validPngDataUrl());

  const publicRead = await fetch(`${baseUrl}/privacy-policy/content`);
  const publicContent = (await publicRead.json()).content;
  assert.equal(publicContent.hero.title, "Updated policy");
  assert.equal(publicContent.hero.cardIconImage, validPngDataUrl());
  assert.equal(publicContent.hero.backgroundImage, validPngDataUrl());
});

test("rejects invalid policy colors, dates, and duplicate section anchors", () => {
  const invalidColor = validContent();
  invalidColor.appearance.accent = "red";
  assert.match(validatePrivacyPolicyContent(invalidColor).error, /hex color/);

  const invalidDate = validContent();
  invalidDate.hero.updatedAt = "2026-02-31";
  assert.match(validatePrivacyPolicyContent(invalidDate).error, /valid date/);

  const duplicateIds = validContent();
  duplicateIds.sections.push({ ...duplicateIds.sections[0] });
  assert.match(validatePrivacyPolicyContent(duplicateIds).error, /unique/);

  assert.equal(validatePrivacyPolicyContent(validContent()).error, undefined);
});

test("validates optional card icon PNG data URLs", () => {
  const contentWithPng = validContent();
  contentWithPng.hero.cardIconImage = validPngDataUrl();
  assert.equal(
    validatePrivacyPolicyContent(contentWithPng).content.hero.cardIconImage,
    validPngDataUrl()
  );

  const invalidImage = validContent();
  invalidImage.hero.cardIconImage = "data:image/svg+xml;base64,PHN2Zy8+";
  assert.match(validatePrivacyPolicyContent(invalidImage).error, /base64-encoded PNG/);

  const oversizedImage = validContent();
  oversizedImage.hero.cardIconImage = `data:image/png;base64,${"A".repeat(1_400_000)}`;
  assert.match(validatePrivacyPolicyContent(oversizedImage).error, /1 MB or smaller/);
});

test("validates optional hero background PNG and JPEG images", () => {
  const pngContent = validContent();
  pngContent.hero.backgroundImage = validPngDataUrl();
  assert.equal(validatePrivacyPolicyContent(pngContent).content.hero.backgroundImage, validPngDataUrl());

  const jpegContent = validContent();
  jpegContent.hero.backgroundImage = validJpegDataUrl();
  assert.equal(validatePrivacyPolicyContent(jpegContent).content.hero.backgroundImage, validJpegDataUrl());

  const invalidImage = validContent();
  invalidImage.hero.backgroundImage = "data:image/svg+xml;base64,PHN2Zy8+";
  assert.match(validatePrivacyPolicyContent(invalidImage).error, /base64-encoded PNG or JPEG/);

  const oversizedImage = validContent();
  oversizedImage.hero.backgroundImage = `data:image/png;base64,${"A".repeat(4_200_000)}`;
  assert.match(validatePrivacyPolicyContent(oversizedImage).error, /3 MB or smaller/);
});
