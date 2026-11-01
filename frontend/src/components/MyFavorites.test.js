import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import MyFavorites from "./MyFavorites";

jest.mock("axios");
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
}));

describe("MyFavorites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("token", "test-token");
  });

  const renderFavorites = () => render(<MyFavorites />);

  it("does not show the empty state while the favorites request is pending", async () => {
    let resolveFavorites;
    axios.get.mockImplementation(() => new Promise((resolve) => {
      resolveFavorites = resolve;
    }));

    renderFavorites();
    expect(screen.getByRole("status")).toHaveTextContent("Loading favorites");
    expect(screen.queryByText("No favorite images yet.")).not.toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(1);

    resolveFavorites({ data: [] });
    expect(await screen.findByText("No favorite images yet.")).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it("shows request failures and retries successfully without duplicate initial requests", async () => {
    axios.get
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce({ data: [] });

    renderFavorites();
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 500");
    expect(screen.queryByText("No favorite images yet.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No favorite images yet.")).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed responses and preserves favorite actions for valid results", async () => {
    axios.get
      .mockResolvedValueOnce({ data: { favorites: [] } })
      .mockResolvedValueOnce({ data: [{ id: 7, title: "Saved asset" }] });
    axios.delete.mockResolvedValue({ data: "Favorite removed" });

    renderFavorites();
    expect(await screen.findByRole("alert")).toHaveTextContent("Favorites response was invalid");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Saved asset")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("button", { name: "Added" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "❌ Remove" }));
    await waitFor(() => expect(axios.delete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("Saved asset")).not.toBeInTheDocument());
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});
