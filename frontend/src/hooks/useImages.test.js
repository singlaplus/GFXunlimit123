import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { getImages } from "../services/imageService";
import useImages from "./useImages";

jest.mock("../services/imageService", () => ({
  getImages: jest.fn(),
}));

function ExploreImagesHarness({ pageSize, initialPage = 1, initialExplorePage = true }) {
  const [selectedPageSize, setSelectedPageSize] = useState(pageSize);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [isExplorePage, setIsExplorePage] = useState(initialExplorePage);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalImages, setTotalImages] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [, setTotalLikes] = useState(0);
  const [, setTotalDownloads] = useState(0);
  const [, setTotalViews] = useState(0);
  const [, setSelectedImage] = useState(null);
  const [, setRelatedImages] = useState([]);
  const [category, setCategory] = useState("All");
  const [collection, setCollection] = useState("All");
  const [sortType, setSortType] = useState("newest");
  const [search, setSearch] = useState("");
  const { hasMore, loadingMore } = useImages({
    currentPage,
    totalPages,
    setCurrentPage,
    imagesPerPage: selectedPageSize,
    images,
    setImages,
    setLoading,
    setTotalImages,
    setTotalLikes,
    setTotalDownloads,
    setTotalViews,
    setTotalPages,
    setSelectedImage,
    setRelatedImages,
    selectedCategory: category,
    selectedCollection: collection,
    search,
    sortType,
    isExplorePage,
  });

  return (
    <>
      <output data-testid="asset-ids">{images.map((image) => image.id).join(",")}</output>
      <output data-testid="current-page">{currentPage}</output>
      <output data-testid="total-pages">{totalPages}</output>
      <output data-testid="loading-state">{String(loading)}</output>
      <output data-testid="has-more">{String(hasMore)}</output>
      <output data-testid="loading-more">{String(loadingMore)}</output>
      <button type="button" onClick={() => setCurrentPage(2)}>Go to page 2</button>
      <button type="button" onClick={() => setSearch("new query")}>Change search</button>
      <button type="button" onClick={() => setCategory("Photos")}>Change category</button>
      <button type="button" onClick={() => setCollection("Vectors")}>Change asset type</button>
      <button type="button" onClick={() => setSortType("downloads")}>Change sort</button>
      <button type="button" onClick={() => setIsExplorePage(true)}>Enter Explore</button>
      <button type="button" onClick={() => setSelectedPageSize(100)}>Select 100</button>
    </>
  );
}

describe("useImages Explore pagination", () => {
  beforeEach(() => {
    getImages.mockReset();
  });

  it.each([50, 100, 200])("requests %i records per page and replaces assets when navigating pages", async (pageSize) => {
    const catalog = Array.from({ length: pageSize * 2 }, (_, index) => ({
      id: index + 1,
      created_at: new Date(Date.UTC(2026, 0, pageSize * 2 - index)).toISOString(),
    }));
    getImages.mockResolvedValue({
      data: {
        images: catalog,
        totalImages: catalog.length,
      },
    });

    render(<ExploreImagesHarness pageSize={pageSize} />);

    await waitFor(() => expect(screen.getByTestId("asset-ids").textContent.split(",")).toHaveLength(pageSize));
    expect(getImages).toHaveBeenNthCalledWith(
      1,
      1,
      1000,
      "All",
      "All",
      "",
      "newest",
      expect.any(AbortSignal)
    );
    expect(screen.getByTestId("asset-ids").textContent.split(",")[0]).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));
    await waitFor(() => {
      const assetIds = screen.getByTestId("asset-ids").textContent.split(",");
      expect(assetIds).toHaveLength(pageSize);
      expect(assetIds[0]).toBe(String(pageSize + 1));
    });
    expect(getImages).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("current-page")).toHaveTextContent("2");
    expect(screen.getByTestId("total-pages")).toHaveTextContent("2");
    expect(screen.getByTestId("asset-ids").textContent.split(",")).not.toContain("1");
  });

  it("sorts the full Explore catalog by upload date instead of edit date", async () => {
    getImages.mockResolvedValue({
      data: {
        images: [
          {
            id: 1,
            title: "edited-old-upload",
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-10-04T00:00:00Z",
          },
          {
            id: 2,
            title: "new-upload",
            created_at: "2026-10-03T00:00:00Z",
            updated_at: "2026-10-03T00:00:00Z",
          },
        ],
        totalImages: 2,
      },
    });

    render(<ExploreImagesHarness pageSize={50} />);

    await waitFor(() => {
      expect(screen.getByTestId("asset-ids").textContent).toBe("2,1");
    });
  });

  it("ignores a stale batch when the search query changes", async () => {
    let resolveOldSearch;
    let oldSearchSignal;
    getImages.mockImplementation((page, limit, category, collection, search, sort, signal) => {
      if (!search) {
        oldSearchSignal = signal;
        return new Promise((resolve) => {
          resolveOldSearch = resolve;
        });
      }
      return Promise.resolve({
        data: { images: [{ id: "new-result" }], totalImages: 1 },
      });
    });

    render(<ExploreImagesHarness pageSize={50} />);
    await waitFor(() => expect(resolveOldSearch).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Change search" }));

    await waitFor(() => expect(screen.getByTestId("asset-ids")).toHaveTextContent("new-result"));
    expect(oldSearchSignal.aborted).toBe(true);

    await act(async () => {
      resolveOldSearch({ data: { images: [{ id: "stale-result" }], totalImages: 1 } });
    });

    expect(screen.getByTestId("asset-ids")).toHaveTextContent("new-result");
    expect(screen.getByTestId("asset-ids")).not.toHaveTextContent("stale-result");
    expect(getImages).toHaveBeenNthCalledWith(
      2,
      1,
      1000,
      "All",
      "All",
      "new query",
      "newest",
      expect.any(AbortSignal)
    );
  });

  it("starts at page one with the selected category, asset type, and sort", async () => {
    getImages.mockResolvedValue({
      data: { images: [{ id: 1 }], totalImages: 1 },
    });

    render(<ExploreImagesHarness pageSize={50} />);
    await waitFor(() => expect(getImages).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Change category" }));
    await waitFor(() => expect(getImages).toHaveBeenCalledTimes(2));
    expect(getImages).toHaveBeenLastCalledWith(
      1,
      1000,
      "Photos",
      "All",
      "",
      "newest",
      expect.any(AbortSignal)
    );

    fireEvent.click(screen.getByRole("button", { name: "Change asset type" }));
    await waitFor(() => expect(getImages).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: "Change sort" }));
    await waitFor(() => expect(getImages).toHaveBeenCalledTimes(4));
    expect(getImages).toHaveBeenLastCalledWith(
      1,
      50,
      "Photos",
      "Vectors",
      "",
      "downloads",
      expect.any(AbortSignal)
    );
    expect(screen.getByTestId("current-page")).toHaveTextContent("1");
  });

  it("resets the shared page state to page one when entering Explore", async () => {
    getImages.mockResolvedValue({
      data: { images: [{ id: 4 }], totalImages: 1 },
    });

    render(
      <ExploreImagesHarness
        pageSize={50}
        initialPage={4}
        initialExplorePage={false}
      />
    );

    await waitFor(() => expect(getImages).toHaveBeenCalledTimes(1));
    expect(getImages).toHaveBeenNthCalledWith(
      1,
      4,
      50,
      "All",
      "All",
      "",
      "newest",
      expect.any(AbortSignal)
    );

    fireEvent.click(screen.getByRole("button", { name: "Enter Explore" }));

    await waitFor(() => expect(getImages).toHaveBeenCalledTimes(2));
    expect(getImages).toHaveBeenNthCalledWith(
      2,
      1,
      1000,
      "All",
      "All",
      "",
      "newest",
      expect.any(AbortSignal)
    );
    expect(screen.getByTestId("current-page")).toHaveTextContent("1");
  });

  it("requests page one at the new page size", async () => {
    getImages.mockResolvedValue({
      data: {
        images: Array.from({ length: 150 }, (_, index) => ({
          id: index + 1,
          created_at: new Date(Date.UTC(2026, 0, 150 - index)).toISOString(),
        })),
        totalImages: 150,
      },
    });

    render(<ExploreImagesHarness pageSize={50} />);
    await waitFor(() => expect(screen.getByTestId("loading-state")).toHaveTextContent("false"));

    fireEvent.click(screen.getByRole("button", { name: "Select 100" }));
    await waitFor(() => expect(getImages).toHaveBeenCalledTimes(2));
    expect(getImages).toHaveBeenNthCalledWith(
      2,
      1,
      1000,
      "All",
      "All",
      "",
      "newest",
      expect.any(AbortSignal)
    );

  });
});
