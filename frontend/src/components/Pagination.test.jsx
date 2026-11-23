import { fireEvent, render, screen } from "@testing-library/react";
jest.mock("react-router-dom", () => ({
  useLocation: jest.fn(),
  useNavigate: jest.fn(),
}));
import { useLocation, useNavigate } from "react-router-dom";
import Pagination from "./Pagination";

const navigate = jest.fn();

beforeEach(() => {
  navigate.mockClear();
  useNavigate.mockReturnValue(navigate);
});

it("keeps the active Explore search and existing query parameters when changing pages", () => {
  useLocation.mockReturnValue({
    pathname: "/explore",
    search: "?category=Photos",
  });

  render(
    <Pagination
      currentPage={1}
      totalPages={3}
      totalImages={120}
      setCurrentPage={jest.fn()}
      darkMode={false}
      search="cloud sky"
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "2" }));

  expect(navigate).toHaveBeenCalledWith(
    "/explore/2?category=Photos&type=cloud+sky",
    { replace: false }
  );
});

it("removes a cleared search term while preserving other Explore query parameters", () => {
  useLocation.mockReturnValue({
    pathname: "/explore/2",
    search: "?category=Photos&type=cloud",
  });

  render(
    <Pagination
      currentPage={2}
      totalPages={3}
      totalImages={120}
      setCurrentPage={jest.fn()}
      darkMode={false}
      search=""
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "1" }));

  expect(navigate).toHaveBeenCalledWith(
    "/explore?category=Photos",
    { replace: false }
  );
});
