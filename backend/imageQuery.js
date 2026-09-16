function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCategoryAlias(value) {
  const rawValue = normalizeText(value);
  if (!rawValue) return rawValue;

  if (["photos", "photo", "images", "image", "photography", "photographies"].some((alias) => rawValue.includes(alias))) {
    return "images";
  }

  if (["vector", "vectors", "illustration", "illustrations", "illustrative"].some((alias) => rawValue.includes(alias))) {
    return "vector/illustrations";
  }

  if (["abstract", "abtrsct", "abstr"].some((alias) => rawValue.includes(alias))) {
    return "abstract";
  }

  if (["psd", "psds"].some((alias) => rawValue.includes(alias))) {
    return "psd";
  }

  if (["video", "videos", "animation", "animations", "motion"].some((alias) => rawValue.includes(alias))) {
    return "videos";
  }

  if (["template", "templates"].some((alias) => rawValue.includes(alias))) {
    return "templates";
  }

  return rawValue;
}

function buildCategoryTokens(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];

  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function applyCatalogFilters(images, filters = {}) {
  const category = normalizeCategoryAlias(filters.category);
  const collection = normalizeText(filters.collection);

  return (images || []).filter((image) => {
    const status = normalizeText(image.status);
    if (status !== "approved") {
      return false;
    }

    const imageCategory = normalizeText(image.category);
    const imageCollection = normalizeText(image.collection);
    const imageCategoryAlias = normalizeCategoryAlias(image.category);
    const categorySlots = String(image.category || "")
      .split(",")
      .map((value) => normalizeCategoryAlias(value))
      .filter(Boolean);
    const categoryTokens = categorySlots.flatMap((slot) => buildCategoryTokens(slot));

    const matchesCategory = !category || category === "all" ||
      imageCategoryAlias === category ||
      categorySlots.some((slot) => slot === category || slot.includes(category) || category.includes(slot)) ||
      imageCategory === category ||
      imageCategory.includes(category) ||
      category.includes(imageCategory) ||
      categoryTokens.includes(category) ||
      categoryTokens.some((token) => token.includes(category) || category.includes(token));
    const matchesCollection = !collection || collection === "all" || imageCollection === collection || imageCollection.includes(collection) || collection.includes(imageCollection);

    return matchesCategory && matchesCollection;
  });
}

module.exports = {
  applyCatalogFilters,
};
