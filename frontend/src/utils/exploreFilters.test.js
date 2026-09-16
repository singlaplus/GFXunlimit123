import { clearExploreFilterState, getStoredExploreFilterState, saveExploreFilterState } from "./exploreFilters";

describe("explore filter persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("defaults to All when nothing is stored for the session", () => {
    expect(getStoredExploreFilterState()).toEqual({
      category: "All",
      collection: "All",
      hasStoredValue: false,
    });
  });

  it("persists a selected category and collection for the current session", () => {
    saveExploreFilterState({ category: "Nature", collection: "Summer" });

    expect(getStoredExploreFilterState()).toEqual({
      category: "Nature",
      collection: "Summer",
      hasStoredValue: true,
    });
  });

  it("clears the session state on logout", () => {
    saveExploreFilterState({ category: "Nature", collection: "Summer" });
    clearExploreFilterState();

    expect(getStoredExploreFilterState()).toEqual({
      category: "All",
      collection: "All",
      hasStoredValue: false,
    });
  });
});
