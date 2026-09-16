export function normalizeCollectionValue(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (["photos", "photo", "images", "image", "photography", "photographies"].some((alias) => normalized.includes(alias))) {
    return "photos";
  }

  if (["vector", "vectors", "illustration", "illustrations", "illustrative"].some((alias) => normalized.includes(alias))) {
    return "vectors";
  }

  if (["psd", "psds"].some((alias) => normalized.includes(alias))) {
    return "psd";
  }

  if (["video", "videos", "animation", "animations", "motion", "film", "movie"].some((alias) => normalized.includes(alias))) {
    return "videos";
  }

  if (["template", "templates"].some((alias) => normalized.includes(alias))) {
    return "templates";
  }

  if (["abstract"].some((alias) => normalized.includes(alias))) {
    return "abstract";
  }

  if (["logo", "brand", "branding", "identity"].some((alias) => normalized.includes(alias))) {
    return "branding";
  }

  if (["nature", "landscape", "outdoor", "garden", "plants"].some((alias) => normalized.includes(alias))) {
    return "nature";
  }

  return normalized;
}

export function normalizeCategoryValues(categoryValue) {
  return String(categoryValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function normalizeCategoryFilterBucket(categoryValue) {
  const rawValue = String(categoryValue || "").trim().toLowerCase();

  if (!rawValue || rawValue === "all") {
    return "All";
  }

  if (["photos", "photo", "images", "image", "photography", "photographies"].some((alias) => rawValue.includes(alias))) {
    return "Images";
  }

  if (["vector", "vectors", "illustration", "illustrations", "illustrative"].some((alias) => rawValue.includes(alias))) {
    return "Vector/illustrations";
  }

  if (["abstract", "abtrsct"].some((alias) => rawValue.includes(alias))) {
    return "Abstract";
  }

  if (["psd", "psds"].some((alias) => rawValue.includes(alias))) {
    return "PSD";
  }

  if (["video", "videos", "animation", "animations", "motion"].some((alias) => rawValue.includes(alias))) {
    return "Videos";
  }

  if (["template", "templates"].some((alias) => rawValue.includes(alias))) {
    return "Templates";
  }

  return String(categoryValue || "").trim();
}

export function matchesCategoryFilter(image, selectedCategory) {
  const categoryValue = (selectedCategory || "").toLowerCase();
  const text = `${image.category || ""} ${image.collection || ""} ${image.title || ""} ${image.keywords || ""}`.toLowerCase();
  const imageCategory = (image.category || "").toLowerCase();
  const categorySlots = normalizeCategoryValues(image.category).map((value) => value.toLowerCase());

  if (!categoryValue || categoryValue === "all") {
    return true;
  }

  const normalizedSelectedBucket = normalizeCategoryFilterBucket(categoryValue);
  const normalizedSlots = categorySlots.map(normalizeCategoryFilterBucket);

  if (normalizedSelectedBucket === "All") {
    return true;
  }

  if (normalizedSelectedBucket === "Images") {
    return normalizedSlots.includes("Images") ||
      text.includes("photo") ||
      text.includes("photography") ||
      text.includes("image");
  }

  if (normalizedSelectedBucket === "Vector/illustrations") {
    return normalizedSlots.includes("Vector/illustrations") ||
      text.includes("vector") ||
      text.includes("illustration") ||
      text.includes("illustrations");
  }

  if (normalizedSelectedBucket === "Abstract") {
    return normalizedSlots.includes("Abstract") ||
      text.includes("abstract");
  }

  if (normalizedSelectedBucket === "PSD") {
    return normalizedSlots.includes("PSD") || text.includes("psd");
  }

  if (normalizedSelectedBucket === "Videos") {
    return normalizedSlots.includes("Videos") ||
      text.includes("video") ||
      text.includes("animation");
  }

  if (normalizedSelectedBucket === "Templates") {
    return normalizedSlots.includes("Templates") || text.includes("template");
  }

  return normalizedSlots.some((slot) => slot === normalizedSelectedBucket || slot.includes(normalizedSelectedBucket) || normalizedSelectedBucket.includes(slot)) ||
    imageCategory === categoryValue ||
    text.includes(categoryValue);
}

export default function useFilteredImages({
  images,
  search,
  selectedCategory,
  selectedCollection,
  sortType,
}) {

  let filteredImages = images.filter((image) => {
    const title = (image.title || "").toLowerCase();
    const category = (image.category || "").toLowerCase();
    const keywords = (image.keywords || "").toLowerCase();
    const searchText = (search || "").toLowerCase().trim();

    if (!searchText) {
      return true;
    }

    return (
      title.includes(searchText) ||
      category.includes(searchText) ||
      keywords.includes(searchText)
    );
  });

  if (sortType === "likes") {

    filteredImages.sort(
      (a, b) =>
        (b.likes || 0) -
        (a.likes || 0)
    );

  }

  if (sortType === "downloads") {

    filteredImages.sort(
      (a, b) =>
        (b.downloads || 0) -
        (a.downloads || 0)
    );

  }

  if (sortType === "views") {

    filteredImages.sort(
      (a, b) =>
        (b.views || 0) -
        (a.views || 0)
    );

  }

  if (sortType === "newest") {

    filteredImages.sort(
      (a, b) => {
        const aDate = new Date(a.updated_at || a.created_at);
        const bDate = new Date(b.updated_at || b.created_at);
        return bDate - aDate;
      }
    );

  }

  if (sortType === "oldest") {

    filteredImages.sort(
      (a, b) =>
        new Date(a.created_at) -
        new Date(b.created_at)
    );

  }

  return filteredImages;

}