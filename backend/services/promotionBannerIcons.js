const sharp = require("sharp");
const path = require("node:path");

const PROMOTIONAL_BANNER_ICON_FOLDER = "promotional banner icons";
const PROMOTIONAL_BANNER_PLACEMENTS = new Set(["left", "right", "up", "down", "popup"]);
const PROMOTIONAL_BANNER_POPUP_AUDIENCES = new Set([
  "homepage",
  "logged_in_customers",
  "logged_in_contributors"
]);
const PROMOTIONAL_BANNER_STATUSES = new Set(["draft", "active"]);
const PROMOTIONAL_BANNER_SPARKLE_STYLES = new Set([
  "none",
  "glitter_burst",
  "twinkle",
  "falling_sparkles",
  "snowfall",
  "shimmer_sweep",
  "fireflies",
  "star_trail",
  "pulsing_glow",
  "aurora_glow",
  "confetti_sparkles",
  "orbiting_sparkles"
]);
const ALLOWED_ICON_FORMATS = new Set(["avif", "gif", "jpeg", "png", "svg", "tiff", "webp"]);
const ALLOWED_ICON_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".tif", ".tiff", ".webp"]);

function isSupportedPromotionalBannerIconUpload(file) {
  const mimeType = String(file?.mimetype || "").trim().toLowerCase();
  const extension = path.extname(String(file?.originalname || "")).toLowerCase();
  return mimeType.startsWith("image/") || ALLOWED_ICON_EXTENSIONS.has(extension);
}

function getPromotionalBannerIconFilename(originalname) {
  const filename = String(originalname || "").split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .trim();
  if (!filename || filename === "." || filename === ".." || filename.length > 255) {
    const error = new Error("Choose a valid filename for the banner icon.");
    error.code = "INVALID_PROMOTIONAL_BANNER_ICON_FILENAME";
    throw error;
  }
  return filename;
}

function slugifyPromotionalBannerName(name) {
  const slug = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "banner";
}

function assignPromotionalBannerSlugs(banners) {
  const slugs = banners.map((banner) => slugifyPromotionalBannerName(banner.name));
  const slugCounts = new Map();
  for (const slug of slugs) slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1);
  return banners.map((banner, index) => ({
    ...banner,
    slug: slugCounts.get(slugs[index]) > 1 ? `${slugs[index]}-${banner.id}` : slugs[index]
  }));
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validatePromotionalBanner({
  name,
  placement,
  popup_audience,
  sparkle_style,
  start_date,
  end_date,
  status
}) {
  const normalizedName = String(name || "").trim();
  const normalizedPlacement = String(placement || "").trim().toLowerCase();
  const normalizedAudience = String(popup_audience || "").trim().toLowerCase();
  const normalizedSparkleStyle = String(sparkle_style || "glitter_burst").trim().toLowerCase();
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const normalizedStartDate = String(start_date || "").trim();
  const normalizedEndDate = String(end_date || "").trim();

  if (!normalizedName) return { error: "Banner name is required." };
  if (!PROMOTIONAL_BANNER_PLACEMENTS.has(normalizedPlacement)) {
    return { error: "Choose a valid banner placement." };
  }
  if (normalizedPlacement === "popup" && !PROMOTIONAL_BANNER_POPUP_AUDIENCES.has(normalizedAudience)) {
    return { error: "Choose a valid Popup audience." };
  }
  if (!PROMOTIONAL_BANNER_SPARKLE_STYLES.has(normalizedSparkleStyle)) {
    return { error: "Choose a valid promotional banner sparkle style." };
  }
  if (!isValidDateOnly(normalizedStartDate)) return { error: "A valid start date is required." };
  if (normalizedEndDate && (!isValidDateOnly(normalizedEndDate) || normalizedEndDate < normalizedStartDate)) {
    return { error: "End date must be a valid date on or after the start date." };
  }
  if (!PROMOTIONAL_BANNER_STATUSES.has(normalizedStatus)) {
    return { error: "Banner status must be draft or active." };
  }

  return {
    value: {
      name: normalizedName,
      placement: normalizedPlacement,
      status: normalizedStatus,
      metadata: {
        start_date: normalizedStartDate,
        end_date: normalizedEndDate || null,
        popup_audience: normalizedPlacement === "popup" ? normalizedAudience : null,
        sparkle_style: normalizedSparkleStyle
      }
    }
  };
}

function parsePromotionalBannerAssetIds(value) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch (_error) {
      return { error: "Selected banner assets are invalid." };
    }
  }
  if (parsed === undefined || parsed === null) parsed = [];
  if (!Array.isArray(parsed) || parsed.length > 5000) {
    return { error: "Selected banner assets are invalid." };
  }
  const assetIds = [];
  for (const valueItem of parsed) {
    const assetId = Number(valueItem);
    if (!Number.isSafeInteger(assetId) || assetId <= 0 || assetId > 2147483647) {
      return { error: "Selected banner assets are invalid." };
    }
    if (!assetIds.includes(assetId)) assetIds.push(assetId);
  }
  return { value: assetIds };
}

async function createPromotionalBannerIcon(buffer) {
  const image = sharp(buffer, { animated: false, failOn: "error", limitInputPixels: 100_000_000 });
  const metadata = await image.metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    !ALLOWED_ICON_FORMATS.has(String(metadata.format || "").toLowerCase())
  ) {
    const error = new Error("Choose a supported image file for the banner icon.");
    error.code = "INVALID_PROMOTIONAL_BANNER_ICON";
    throw error;
  }

  return buffer;
}

module.exports = {
  PROMOTIONAL_BANNER_ICON_FOLDER,
  PROMOTIONAL_BANNER_SPARKLE_STYLES,
  assignPromotionalBannerSlugs,
  createPromotionalBannerIcon,
  getPromotionalBannerIconFilename,
  isSupportedPromotionalBannerIconUpload,
  parsePromotionalBannerAssetIds,
  slugifyPromotionalBannerName,
  validatePromotionalBanner
};
