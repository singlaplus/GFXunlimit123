const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  calculateBestBundleTierDiscount,
  isBundleOfferDateActive,
  validateBundleDiscountSchedule,
  validateBundleDiscountTiers,
} = require("../utils/bundleDiscounts");

const offer = {
  id: 1,
  name: "Asset tiers",
  status: "active",
  metadata: {
    start_date: "2020-01-01",
    discount_tiers: [
      { asset_count: 3, discount_percent: 10 },
      { asset_count: 5, discount_percent: 15 },
      { asset_count: 10, discount_percent: 25 },
    ],
  },
};

test("validates and sorts editable bundle tiers", () => {
  assert.deepEqual(validateBundleDiscountTiers([
    { asset_count: "5", discount_percent: "15" },
    { asset_count: "3", discount_percent: "10" },
  ]), {
    tiers: [
      { asset_count: 3, discount_percent: 10 },
      { asset_count: 5, discount_percent: 15 },
    ],
  });
});

test("rejects duplicate thresholds and percentages outside the valid range", () => {
  assert.match(validateBundleDiscountTiers([
    { asset_count: 3, discount_percent: 10 },
    { asset_count: 3, discount_percent: 15 },
  ]).error, /unique/);
  assert.match(validateBundleDiscountTiers([
    { asset_count: 3, discount_percent: 100.1 },
  ]).error, /no more than 100/);
});

test("requires a valid start date and validates the optional end date", () => {
  assert.match(validateBundleDiscountSchedule("", null).error, /require a valid start date/);
  assert.match(validateBundleDiscountSchedule("2026-02-30", null).error, /valid start date/);
  assert.match(validateBundleDiscountSchedule("2026-10-29", "2026-10-28").error, /on or after/);
  assert.deepEqual(validateBundleDiscountSchedule("2026-10-29", ""), {
    start_date: "2026-10-29",
    end_date: null,
  });
});

test("bundle offer dates are inclusive and use the scheduled end date", () => {
  const scheduledOffer = {
    ...offer,
    metadata: {
      ...offer.metadata,
      start_date: "2026-10-29",
      end_date: "2026-11-02",
    },
  };
  assert.equal(isBundleOfferDateActive(scheduledOffer, "2026-10-28"), false);
  assert.equal(isBundleOfferDateActive(scheduledOffer, "2026-10-29"), true);
  assert.equal(isBundleOfferDateActive(scheduledOffer, "2026-11-02"), true);
  assert.equal(isBundleOfferDateActive(scheduledOffer, "2026-11-03"), false);
});

test("applies the highest qualifying tier to distinct paid assets", () => {
  const items = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, unitPrice: 20 }));
  assert.deepEqual(calculateBestBundleTierDiscount(items, [offer]), {
    offer,
    assetCount: 5,
    tier: { asset_count: 5, discount_percent: 15 },
    discount: 15,
  });
});

test("honors a selected eligible offer without trusting client tier data", () => {
  const items = Array.from({ length: 3 }, (_, index) => ({ id: index + 1, unitPrice: 100 }));
  const lowerOffer = {
    id: 2,
    status: "active",
    metadata: {
      start_date: "2020-01-01",
      discount_tiers: [{ asset_count: 3, discount_percent: 10 }],
    },
  };
  const higherOffer = {
    id: 3,
    status: "active",
    metadata: {
      start_date: "2020-01-01",
      discount_tiers: [{ asset_count: 3, discount_percent: 20 }],
    },
  };

  assert.deepEqual(
    calculateBestBundleTierDiscount(items, [lowerOffer, higherOffer], new Set(), lowerOffer.id),
    {
      offer: lowerOffer,
      assetCount: 3,
      tier: { asset_count: 3, discount_percent: 10 },
      discount: 30,
    }
  );
});

test("ignores free and non-asset items and chooses the best single active offer", () => {
  const assets = [
    { id: 1, unitPrice: 100 },
    { id: 2, unitPrice: 100 },
    { id: 3, unitPrice: 100 },
    { id: 3, unitPrice: 100 },
    { id: 4, unitPrice: 100 },
    { id: "free", unitPrice: 100, freeAsset: true },
    { id: "credits", unitPrice: 100, creditPackage: true },
  ];
  const strongerOffer = {
    id: 2,
    status: "active",
    metadata: {
      start_date: "2020-01-01",
      discount_tiers: [{ asset_count: 3, discount_percent: 20 }],
    },
  };
  const draftOffer = {
    id: 3,
    status: "draft",
    metadata: { discount_tiers: [{ asset_count: 3, discount_percent: 90 }] },
  };

  assert.equal(calculateBestBundleTierDiscount(assets, [offer, strongerOffer, draftOffer]).discount, 100);
});
