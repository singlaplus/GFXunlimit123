const EXPLORE_FILTERS_STORAGE_KEY = "exploreFilters";

export function getStoredExploreFilterState() {
  if (typeof window === "undefined") {
    return { category: "All", collection: "All", hasStoredValue: false };
  }

  try {
    const stored = window.sessionStorage.getItem(EXPLORE_FILTERS_STORAGE_KEY);
    if (!stored) {
      return { category: "All", collection: "All", hasStoredValue: false };
    }

    const parsed = JSON.parse(stored);
    return {
      category: parsed?.category || "All",
      collection: parsed?.collection || "All",
      hasStoredValue: true,
    };
  } catch (err) {
    console.error("Failed to read explore filter state", err);
    return { category: "All", collection: "All", hasStoredValue: false };
  }
}

export function saveExploreFilterState({ category = "All", collection = "All" }) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      EXPLORE_FILTERS_STORAGE_KEY,
      JSON.stringify({ category, collection })
    );
  } catch (err) {
    console.error("Failed to save explore filter state", err);
  }
}

export function clearExploreFilterState() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(EXPLORE_FILTERS_STORAGE_KEY);
  } catch (err) {
    console.error("Failed to clear explore filter state", err);
  }
}
