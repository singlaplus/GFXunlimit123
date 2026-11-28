const express = require("express");

const POLICY_ID = "default";
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const SECTION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CARD_ICON_IMAGE_PREFIX = "data:image/png;base64,";
const MAX_CARD_ICON_IMAGE_BYTES = 1024 * 1024;
const MAX_CARD_ICON_IMAGE_LENGTH = CARD_ICON_IMAGE_PREFIX.length + Math.ceil(MAX_CARD_ICON_IMAGE_BYTES / 3) * 4;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_HERO_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_HERO_IMAGE_DATA_URL_LENGTH = 32 + Math.ceil(MAX_HERO_IMAGE_BYTES / 3) * 4;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateText(value, label, maxLength = 5000, required = false) {
  if (typeof value !== "string" || value.length > maxLength || (required && !value.trim())) {
    return `${label} must be a ${required ? "non-empty " : ""}string with at most ${maxLength} characters.`;
  }
  return null;
}

function validateEmail(value, label) {
  if (typeof value !== "string" || value.length > 254 || !EMAIL_PATTERN.test(value)) {
    return `${label} must be a valid email address.`;
  }
  return null;
}

function validateDate(value, label) {
  const timestamp = typeof value === "string" ? Date.parse(`${value}T00:00:00Z`) : Number.NaN;
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    return `${label} must be a valid date in YYYY-MM-DD format.`;
  }
  return null;
}

function validateCardIconImage(value) {
  if (typeof value !== "string") return "Card icon image must be a PNG data URL.";
  if (value === "") return null;
  if (value.length > MAX_CARD_ICON_IMAGE_LENGTH) return "Card icon PNG must be 1 MB or smaller.";

  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return "Card icon image must be a base64-encoded PNG.";

  const image = Buffer.from(match[1], "base64");
  if (image.length > MAX_CARD_ICON_IMAGE_BYTES) return "Card icon PNG must be 1 MB or smaller.";
  if (
    image.toString("base64") !== match[1]
    || image.length < 33
    || !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    || image.readUInt32BE(8) !== 13
    || image.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return "Card icon image must contain a valid PNG header.";
  }

  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (!width || !height || width > 1024 || height > 1024) {
    return "Card icon PNG dimensions must be between 1 and 1024 pixels.";
  }
  return null;
}

function getPngDimensions(image) {
  if (
    image.length < 33
    || !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    || image.readUInt32BE(8) !== 13
    || image.toString("ascii", 12, 16) !== "IHDR"
  ) return null;
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

function getJpegDimensions(image) {
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) return null;

  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < image.length) {
    if (image[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (image[offset] === 0xff) offset += 1;
    const marker = image[offset];
    offset += 1;
    if (marker === undefined) return null;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > image.length) return null;
    const segmentLength = image.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > image.length) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: image.readUInt16BE(offset + 3),
        width: image.readUInt16BE(offset + 5)
      };
    }
    offset += segmentLength;
  }
  return null;
}

function validateHeroBackgroundImage(value) {
  if (typeof value !== "string") return "Hero background image must be a PNG or JPEG data URL.";
  if (value === "") return null;
  if (value.length > MAX_HERO_IMAGE_DATA_URL_LENGTH) return "Hero background image must be 3 MB or smaller.";

  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return "Hero background image must be a base64-encoded PNG or JPEG.";

  const image = Buffer.from(match[2], "base64");
  if (image.length > MAX_HERO_IMAGE_BYTES) return "Hero background image must be 3 MB or smaller.";
  if (image.toString("base64") !== match[2]) return "Hero background image must contain valid base64 data.";

  const dimensions = match[1] === "image/png" ? getPngDimensions(image) : getJpegDimensions(image);
  if (!dimensions) return "Hero background image must contain a valid PNG or JPEG image.";
  if (!dimensions.width || !dimensions.height || dimensions.width > 4096 || dimensions.height > 2160) {
    return "Hero background image dimensions must not exceed 4096 x 2160 pixels.";
  }
  return null;
}

function validatePrivacyPolicyContent(value, documentName = "Policy") {
  if (!isRecord(value)) return { error: `${documentName} content must be an object.` };
  const { hero, overview, sections, contact, appearance } = value;
  if (![hero, overview, contact, appearance].every(isRecord) || !Array.isArray(sections) || sections.length > 30) {
    return { error: `${documentName} content is missing required page sections.` };
  }
  const cardIconImage = hero.cardIconImage === undefined ? "" : hero.cardIconImage;
  const backgroundImage = hero.backgroundImage === undefined ? "" : hero.backgroundImage;

  const stringFields = [
    [hero.eyebrow, "Hero eyebrow", 120],
    [hero.title, "Hero title", 180, true],
    [hero.description, "Hero description", 2000, true],
    [hero.contactLabel, "Hero contact label", 120],
    [hero.cardIcon, "Hero card icon", 3],
    [hero.cardTitle, "Hero card title", 120],
    [hero.cardDescription, "Hero card description", 500],
    [overview.label, "Overview label", 120],
    [overview.title, "Overview title", 180, true],
    [overview.body, "Overview body", 5000, true],
    [contact.label, "Contact label", 120],
    [contact.title, "Contact title", 180, true],
    [contact.body, "Contact body", 2000],
  ];
  for (const [field, label, maxLength, required] of stringFields) {
    const error = validateText(field, label, maxLength, required);
    if (error) return { error };
  }

  const cardIconImageError = validateCardIconImage(cardIconImage);
  if (cardIconImageError) return { error: cardIconImageError };
  const backgroundImageError = validateHeroBackgroundImage(backgroundImage);
  if (backgroundImageError) return { error: backgroundImageError };

  const dateError = validateDate(hero.updatedAt, "Last updated");
  if (dateError) return { error: dateError };
  for (const [field, label] of [[hero.contactEmail, "Hero contact email"], [contact.email, "Contact email"]]) {
    const error = validateEmail(field, label);
    if (error) return { error };
  }
  if (typeof hero.cardVisible !== "boolean" || typeof appearance.showTableOfContents !== "boolean") {
    return { error: "Page visibility settings must be boolean values." };
  }
  if (!["comfortable", "compact"].includes(appearance.density)) {
    return { error: "Content density must be comfortable or compact." };
  }
  for (const [field, label] of [
    [appearance.heroStart, "Hero start color"],
    [appearance.heroEnd, "Hero end color"],
    [appearance.accent, "Accent color"],
    [appearance.surface, "Surface color"],
  ]) {
    if (typeof field !== "string" || !COLOR_PATTERN.test(field)) {
      return { error: `${label} must be a six-digit hex color.` };
    }
  }

  const sectionIds = new Set();
  for (const [index, section] of sections.entries()) {
    if (!isRecord(section) || typeof section.id !== "string" || !SECTION_ID_PATTERN.test(section.id) || section.id.length > 72) {
      return { error: `${documentName} section ${index + 1} has an invalid ID.` };
    }
    if (sectionIds.has(section.id)) return { error: `${documentName} section IDs must be unique.` };
    sectionIds.add(section.id);
    const titleError = validateText(section.title, `Section ${index + 1} title`, 180, true);
    if (titleError) return { error: titleError };
    if (typeof section.visible !== "boolean") return { error: `Section ${index + 1} visibility must be boolean.` };
    if (!Array.isArray(section.paragraphs) || section.paragraphs.length > 20) {
      return { error: `Section ${index + 1} paragraphs must be an array of at most 20 items.` };
    }
    if (!Array.isArray(section.points) || section.points.length > 40) {
      return { error: `Section ${index + 1} bullet points must be an array of at most 40 items.` };
    }
    for (const paragraph of section.paragraphs) {
      const error = validateText(paragraph, `Section ${index + 1} paragraph`);
      if (error) return { error };
    }
    for (const point of section.points) {
      const error = validateText(point, `Section ${index + 1} bullet point`, 2000);
      if (error) return { error };
    }
    const closingError = validateText(section.closing, `Section ${index + 1} closing text`);
    if (closingError) return { error: closingError };
  }

  return {
    content: {
      hero: {
        eyebrow: hero.eyebrow,
        title: hero.title,
        description: hero.description,
        backgroundImage,
        updatedAt: hero.updatedAt,
        contactLabel: hero.contactLabel,
        contactEmail: hero.contactEmail,
        cardVisible: hero.cardVisible,
        cardIcon: hero.cardIcon,
        cardIconImage,
        cardTitle: hero.cardTitle,
        cardDescription: hero.cardDescription,
      },
      overview: { label: overview.label, title: overview.title, body: overview.body },
      sections: sections.map((section) => ({
        id: section.id,
        title: section.title,
        visible: section.visible,
        paragraphs: section.paragraphs,
        points: section.points,
        closing: section.closing,
      })),
      contact: { label: contact.label, title: contact.title, body: contact.body, email: contact.email },
      appearance: {
        heroStart: appearance.heroStart,
        heroEnd: appearance.heroEnd,
        accent: appearance.accent,
        surface: appearance.surface,
        density: appearance.density,
        showTableOfContents: appearance.showTableOfContents,
      },
    },
  };
}

function createPrivacyPolicyRouter({ pool, verifyAdmin }) {
  const router = express.Router();

  router.get("/privacy-policy/content", async (_req, res) => {
    try {
      const result = await pool.query(
        "SELECT content FROM privacy_policy_settings WHERE id = $1",
        [POLICY_ID]
      );
      return res.json({ content: result.rows[0]?.content || null });
    } catch (error) {
      console.error("Failed to load published Privacy Policy content", error);
      return res.status(500).json({ error: "Failed to load Privacy Policy content." });
    }
  });

  router.put("/admin/privacy-policy/content", verifyAdmin, async (req, res) => {
    const validation = validatePrivacyPolicyContent(req.body);
    if (validation.error) return res.status(400).json({ error: validation.error });

    try {
      const result = await pool.query(
        `INSERT INTO privacy_policy_settings (id, content, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id) DO UPDATE
         SET content = EXCLUDED.content, updated_at = now()
         RETURNING content`,
        [POLICY_ID, JSON.stringify(validation.content)]
      );
      return res.json({ content: result.rows[0].content });
    } catch (error) {
      console.error("Failed to save Privacy Policy content", error);
      return res.status(500).json({ error: "Failed to save Privacy Policy content." });
    }
  });

  return router;
}

module.exports = { createPrivacyPolicyRouter, validatePrivacyPolicyContent };
