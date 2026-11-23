import { createEvent, fireEvent, render, screen } from "@testing-library/react";
jest.mock("react-router-dom", () => ({
  useLocation: jest.fn(),
  useNavigate: jest.fn(),
}));
import { useLocation, useNavigate } from "react-router-dom";
import MarketplaceContainer from "./MarketplaceContainer";

jest.mock("./home/ImageGallery", () => () => null);
jest.mock("./LoadingMessage", () => () => null);
jest.mock("./EmptyMessage", () => () => null);
jest.mock("./ImageGrid", () => () => null);
jest.mock("./Pagination", () => () => null);
jest.mock("./gallery/GalleryImageViewer", () => () => null);
jest.mock("./gallery/ContributorPopup", () => () => null);

beforeEach(() => {
  useLocation.mockReturnValue({ pathname: "/" });
  useNavigate.mockReturnValue(jest.fn());
});

describe("MarketplaceContainer search", () => {
  it("submits a trimmed keyword with Enter and closes suggestions", () => {
    const setSearch = jest.fn();
    const setCurrentPage = jest.fn();

    render(
      <MarketplaceContainer
        galleryProps={{
          search: " cloud ",
          setSearch,
          setCurrentPage,
          allImages: [
            {
              id: 1,
              title: "Cloud asset",
              description: "A cloud in the sky",
            },
          ],
        }}
        filteredImages={[]}
      />
    );

    const searchInput = screen.getByRole("textbox", { name: "Search images" });
    fireEvent.focus(searchInput);
    expect(screen.getByRole("button", { name: /Cloud asset/ })).toBeInTheDocument();

    const enterEvent = createEvent.keyDown(searchInput, {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });
    fireEvent(searchInput, enterEvent);

    expect(enterEvent.defaultPrevented).toBe(true);
    expect(setSearch).toHaveBeenCalledWith("cloud");
    expect(setCurrentPage).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("button", { name: /Cloud asset/ })).not.toBeInTheDocument();
  });

  it("persists an Explore search in the URL and returns to page one when submitted", () => {
    const navigate = jest.fn();
    useNavigate.mockReturnValue(navigate);
    useLocation.mockReturnValue({ pathname: "/explore/2", search: "?category=Photos" });

    render(
      <MarketplaceContainer
        isExplore
        galleryProps={{
          search: "cloud",
          setSearch: jest.fn(),
          setCurrentPage: jest.fn(),
          allImages: [],
        }}
        filteredImages={[]}
      />
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search images" }), {
      key: "Enter",
    });

    expect(navigate).toHaveBeenCalledWith(
      "/explore?category=Photos&type=cloud",
      { replace: true }
    );
  });

  it("resets the viewport after navigating between Explore pages", () => {
    const scrollTo = jest.spyOn(window, "scrollTo").mockImplementation(() => {});
    const props = {
      isExplore: true,
      galleryProps: {
        search: "",
        setSearch: jest.fn(),
        setCurrentPage: jest.fn(),
        allImages: [],
      },
      filteredImages: [],
    };
    const { rerender } = render(
      <MarketplaceContainer {...props} />
    );

    scrollTo.mockClear();
    useLocation.mockReturnValue({ pathname: "/explore/2" });
    rerender(<MarketplaceContainer {...props} />);

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    useLocation.mockReturnValue({ search: "?tab=controls" });
    scrollTo.mockRestore();
  });
});
