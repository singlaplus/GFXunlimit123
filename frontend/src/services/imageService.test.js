import api from "./api";
import { getImages } from "./imageService";

jest.mock("./api", () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

describe("getImages paginated requests", () => {
  it("sends the requested page, limit, filters, sort, and abort signal to the backend", () => {
    const signal = new AbortController().signal;
    api.get.mockResolvedValue({ data: { images: [], totalImages: 0 } });

    getImages(2, 100, "Nature", "Vectors", "forest", "downloads", signal);

    expect(api.get).toHaveBeenCalledWith("/images", {
      params: expect.objectContaining({
        page: 2,
        limit: 100,
        category: "Nature",
        collection: "Vectors",
        search: "forest",
        sort: "downloads",
      }),
      signal,
    });
  });
});
