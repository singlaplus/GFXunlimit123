function validateBundleDiscountTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { error: "Add at least one asset-count discount tier." };
  }

  const normalizedTiers = [];
  const counts = new Set();
  for (const tier of tiers) {
    const assetCount = Number(tier?.asset_count);
    const discountPercent = Number(tier?.discount_percent);
    if (!Number.isInteger(assetCount) || assetCount <= 0) {
      return { error: "Each tier must have a positive whole-number asset count." };
    }
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
      return { error: "Each tier discount must be greater than 0% and no more than 100%." };
    }
    if (counts.has(assetCount)) {
      return { error: "Each asset-count threshold must be unique." };
    }
    counts.add(assetCount);
    normalizedTiers.push({ asset_count: assetCount, discount_percent: discountPercent });
  }

  normalizedTiers.sort((left, right) => left.asset_count - right.asset_count);
  return { tiers: normalizedTiers };
}

function validateBundleDiscountSchedule(startDate, endDate) {
  const isValidDate = (value) => (
    typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  );
  if (!isValidDate(startDate)) {
    return { error: "Bundle discounts require a valid start date." };
  }
  if (endDate != null && endDate !== "" && !isValidDate(endDate)) {
    return { error: "Bundle discount end date must be a valid date." };
  }
  if (endDate && endDate < startDate) {
    return { error: "Bundle discount end date must be on or after the start date." };
  }
  return { start_date: startDate, end_date: endDate || null };
}

function getCurrentISTDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isBundleOfferDateActive(offer, today = getCurrentISTDate()) {
  const metadata = typeof offer?.metadata === "string"
    ? JSON.parse(offer.metadata)
    : offer?.metadata || {};
  const schedule = validateBundleDiscountSchedule(metadata.start_date, metadata.end_date);
  return !schedule.error && schedule.start_date <= today
    && (!schedule.end_date || schedule.end_date >= today);
}

function getBundleDiscountTiers(offer) {
  const metadata = typeof offer?.metadata === "string"
    ? JSON.parse(offer.metadata)
    : offer?.metadata || {};
  const result = validateBundleDiscountTiers(metadata.discount_tiers);
  return result.tiers || [];
}

function calculateBestBundleTierDiscount(items = [], offers = [], freeAssetIds = new Set(), selectedOfferId = "") {
  const eligibleItems = (Array.isArray(items) ? items : []).filter((item) => (
    item
    && !item.creditPackage
    && !item.subscription
    && !item.freeAsset
    && !item.isFree
    && item.id != null
    && !freeAssetIds.has(String(item.id))
    && Number(item.unitPrice ?? item.price ?? 0) > 0
  ));
  const assetCount = new Set(eligibleItems.map((item) => String(item.id))).size;
  const eligibleSubtotal = eligibleItems.reduce(
    (sum, item) => sum + Number(item.unitPrice ?? item.price ?? 0) * Math.max(1, Number(item.quantity || 1)),
    0
  );
  const candidates = (Array.isArray(offers) ? offers : [])
    .filter((offer) => String(offer?.status || "").trim().toLowerCase() === "active")
    .filter((offer) => isBundleOfferDateActive(offer))
    .map((offer) => {
      const tiers = getBundleDiscountTiers(offer);
      const qualifyingTiers = tiers.filter((tier) => tier.asset_count <= assetCount);
      const tier = qualifyingTiers[qualifyingTiers.length - 1];
      if (!tier || eligibleSubtotal <= 0) return null;
      return {
        offer,
        assetCount,
        tier,
        discount: Number((eligibleSubtotal * tier.discount_percent / 100).toFixed(2)),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.discount - left.discount);

  const selectedCandidate = selectedOfferId
    ? candidates.find((candidate) => String(candidate.offer.id) === String(selectedOfferId))
    : null;
  return selectedCandidate || candidates[0] || { offer: null, assetCount, tier: null, discount: 0 };
}

module.exports = {
  calculateBestBundleTierDiscount,
  isBundleOfferDateActive,
  validateBundleDiscountSchedule,
  validateBundleDiscountTiers,
};
