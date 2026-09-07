import { matchesCategoryFilter, normalizeCategoryFilterBucket } from "./useFilteredImages";

describe("matchesCategoryFilter", () => {
  it("keeps a saved Photos category in the photos bucket", () => {
    expect(
      matchesCategoryFilter(
        { category: "Photos", collection: "", title: "", keywords: "" },
        "photos"
      )
    ).toBe(true);
  });

  it("does not treat vectors as photos", () => {
    expect(
      matchesCategoryFilter(
        { category: "Vector/illustrations", collection: "", title: "", keywords: "" },
        "photos"
      )
    ).toBe(false);
  });

  it("matches a category when it is stored in the second asset category slot", () => {
    expect(
      matchesCategoryFilter(
        { category: "Images,Templates", collection: "", title: "", keywords: "" },
        "templates"
      )
    ).toBe(true);
  });

  it("normalizes photo/image aliases to the same browse bucket", () => {
    expect(normalizeCategoryFilterBucket("Photos")).toBe("Images");
    expect(normalizeCategoryFilterBucket("Images")).toBe("Images");
  });

  it("normalizes abstract spellings and typos to the same browse bucket", () => {
    expect(normalizeCategoryFilterBucket("Abstract")).toBe("Abstract");
    expect(normalizeCategoryFilterBucket("Abtrsct")).toBe("Abstract");
  });
});
