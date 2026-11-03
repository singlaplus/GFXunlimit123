const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  PROMOTIONAL_BANNER_ICON_FOLDER,
  assignPromotionalBannerSlugs,
  createPromotionalBannerIcon,
  getPromotionalBannerIconFilename,
  isSupportedPromotionalBannerIconUpload,
  parsePromotionalBannerAssetIds,
  slugifyPromotionalBannerName,
  validatePromotionalBanner
} = require("../services/promotionBannerIcons");

test("validates promotional banner fields and Popup targeting", () => {
  const result = validatePromotionalBanner({
    name: "  Sale banner ",
    placement: "Popup",
    popup_audience: "logged_in_customers",
    sparkle_style: "orbiting_sparkles",
    start_date: "2026-11-05",
    end_date: "",
    status: "Active"
  });

  assert.equal(result.error, undefined);
  assert.equal(result.value.name, "Sale banner");
  assert.equal(result.value.placement, "popup");
  assert.equal(result.value.status, "active");
  assert.deepEqual(result.value.metadata, {
    start_date: "2026-11-05",
    end_date: null,
    popup_audience: "logged_in_customers",
    sparkle_style: "orbiting_sparkles"
  });
  assert.equal(PROMOTIONAL_BANNER_ICON_FOLDER, "promotional banner icons");
});

test("defaults banner sparkle to glitter burst and rejects unknown sparkle styles", () => {
  const base = {
    name: "Sale banner",
    placement: "right",
    start_date: "2026-11-05",
    status: "active"
  };
  assert.equal(validatePromotionalBanner(base).value.metadata.sparkle_style, "glitter_burst");
  assert.equal(
    validatePromotionalBanner({ ...base, sparkle_style: "snowfall" }).value.metadata.sparkle_style,
    "snowfall"
  );
  for (const sparkleStyle of [
    "shimmer_sweep",
    "fireflies",
    "star_trail",
    "pulsing_glow",
    "aurora_glow",
    "confetti_sparkles"
  ]) {
    assert.equal(
      validatePromotionalBanner({ ...base, sparkle_style: sparkleStyle }).value.metadata.sparkle_style,
      sparkleStyle
    );
  }
  assert.match(validatePromotionalBanner({ ...base, sparkle_style: "custom-css" }).error, /sparkle style/i);
});

test("requires a start date and rejects an end date before it", () => {
  const base = {
    name: "Sale banner",
    placement: "left",
    status: "draft"
  };

  assert.match(validatePromotionalBanner({ ...base, start_date: "" }).error, /start date is required/i);
  assert.match(
    validatePromotionalBanner({
      ...base,
      start_date: "2026-11-05",
      end_date: "2026-11-04"
    }).error,
    /on or after the start date/i
  );
});

test("parses unique positive asset ids and rejects malformed selections", () => {
  assert.deepEqual(parsePromotionalBannerAssetIds('["7",7,12]'), { value: [7, 12] });
  assert.match(parsePromotionalBannerAssetIds("[0]").error, /selected banner assets are invalid/i);
  assert.match(parsePromotionalBannerAssetIds("{").error, /selected banner assets are invalid/i);
});

test("accepts PNG files even when the browser reports a generic MIME type", () => {
  assert.equal(isSupportedPromotionalBannerIconUpload({
    originalname: "banner.PNG",
    mimetype: "application/octet-stream"
  }), true);
  assert.equal(isSupportedPromotionalBannerIconUpload({
    originalname: "banner.txt",
    mimetype: "text/plain"
  }), false);
});

test("preserves uploaded image bytes, format, and dimensions", async () => {
  const source = await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 4,
      background: { r: 220, g: 20, b: 60, alpha: 1 }
    }
  }).jpeg().toBuffer();

  const icon = await createPromotionalBannerIcon(source);
  const metadata = await sharp(icon).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 640);
  assert.equal(metadata.height, 480);
  assert.deepEqual(icon, source);
});

test("keeps the uploaded icon filename while stripping path components", () => {
  assert.equal(getPromotionalBannerIconFilename("Summer Sale.PNG"), "Summer Sale.PNG");
  assert.equal(getPromotionalBannerIconFilename("C:\\uploads\\summer.png"), "summer.png");
  assert.throws(() => getPromotionalBannerIconFilename(".."), /valid filename/i);
});

test("creates readable banner URLs and disambiguates duplicate names", () => {
  assert.equal(slugifyPromotionalBannerName("  Summer Sale!  "), "summer-sale");
  assert.deepEqual(
    assignPromotionalBannerSlugs([
      { id: 8, name: "Summer Sale" },
      { id: 9, name: "Summer Sale" },
      { id: 10, name: "Winter" }
    ]).map(({ slug }) => slug),
    ["summer-sale-8", "summer-sale-9", "winter"]
  );
});
