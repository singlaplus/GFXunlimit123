import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import MyFavorites from "./MyFavorites";
import { loadCartItems, saveCartItems } from "../utils/cartPersistence";

jest.mock("axios");
jest.mock("../utils/cartPersistence", () => ({
  loadCartItems: jest.fn(),
  saveCartItems: jest.fn(),
}));
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
}));

describe("MyFavorites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("token", "test-token");
    loadCartItems.mockResolvedValue([]);
    saveCartItems.mockImplementation(async (items) => {
      localStorage.setItem("customer-cart", JSON.stringify(items));
      return true;
    });
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
    expect(loadCartItems).toHaveBeenCalledWith({ strict: true });
    expect(saveCartItems).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 7, title: "Saved asset" })]),
      { strict: true }
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(axios.delete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("Saved asset")).not.toBeInTheDocument());
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it("reports cart sync failures without marking the asset as added", async () => {
    axios.get.mockResolvedValue({ data: [{ id: 7, title: "Saved asset" }] });
    saveCartItems.mockRejectedValueOnce(new Error("Cart unavailable"));

    renderFavorites();
    expect(await screen.findByText("Saved asset")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to add this asset to your cart");
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
    expect(JSON.parse(localStorage.getItem("customer-cart"))).toEqual([]);
  });

  it("shows cart items already saved by the same account on another device", async () => {
    axios.get.mockResolvedValue({ data: [{ id: 7, title: "Saved asset" }] });
    loadCartItems.mockResolvedValue([{ id: 7, title: "Saved asset" }]);

    renderFavorites();

    expect(await screen.findByRole("button", { name: "Added" })).toBeDisabled();
    expect(JSON.parse(localStorage.getItem("customer-cart"))).toEqual([
      { id: 7, title: "Saved asset" },
    ]);
  });
});
