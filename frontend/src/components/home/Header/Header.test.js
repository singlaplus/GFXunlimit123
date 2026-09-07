import { fireEvent, render, screen } from "@testing-library/react";
import Header from "./Header";
import { useNavigate } from "react-router-dom";

jest.mock(
  "react-router-dom",
  () => ({
    useNavigate: jest.fn(),
  }),
  { virtual: true }
);

describe("Header search actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    window.setActivePage = jest.fn();
  });

  it("routes the search button to the search results page", () => {
    const mockNavigate = jest.fn();
    useNavigate.mockReturnValue(mockNavigate);
    const setSearch = jest.fn();

    render(
      <Header
        totalImages={100}
        heroStats={{}}
        trendingKeywords={[]}
        setSearch={setSearch}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/search photos/i), {
      target: { value: "nature" },
    });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    expect(setSearch).toHaveBeenCalledWith("nature");
    expect(mockNavigate).toHaveBeenCalledWith("/search?type=nature");
    expect(window.setActivePage).toHaveBeenCalledWith("explore");
  });

  it("routes the explore button to the full explore catalog and clears the current search", () => {
    const mockNavigate = jest.fn();
    useNavigate.mockReturnValue(mockNavigate);
    const setSearch = jest.fn();

    render(
      <Header
        totalImages={100}
        heroStats={{}}
        trendingKeywords={[]}
        setSearch={setSearch}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /explore assets/i }));

    expect(setSearch).toHaveBeenCalledWith("");
    expect(mockNavigate).toHaveBeenCalledWith("/explore");
    expect(window.setActivePage).toHaveBeenCalledWith("explore");
  });

  it("opens the join modal in contributor mode", () => {
    const setShowJoinModal = jest.fn();
    const setJoinModalAccountType = jest.fn();

    render(
      <Header
        totalImages={100}
        heroStats={{}}
        trendingKeywords={[]}
        setSearch={jest.fn()}
        setShowJoinModal={setShowJoinModal}
        setJoinModalAccountType={setJoinModalAccountType}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /become a contributor/i }));

    expect(setJoinModalAccountType).toHaveBeenCalledWith("contributor");
    expect(setShowJoinModal).toHaveBeenCalledWith(true);
  });

  it("hides the contributor button when a user is already logged in", () => {
    window.localStorage.setItem("token", "test-token");

    render(
      <Header
        totalImages={100}
        heroStats={{}}
        trendingKeywords={[]}
        setSearch={jest.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /become a contributor/i })).not.toBeInTheDocument();
  });

  it("hides the explore assets button for contributor logged-in users", () => {
    window.localStorage.setItem("token", "test-token");
    window.localStorage.setItem("userRole", "contributor");

    render(
      <Header
        totalImages={100}
        heroStats={{}}
        trendingKeywords={[]}
        setSearch={jest.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /explore assets/i })).not.toBeInTheDocument();
  });
});
