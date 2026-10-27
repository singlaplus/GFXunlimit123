import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import CartPage from "./CartPage";
import { loadCartItems } from "../utils/cartPersistence";

const mockNavigate = jest.fn();

jest.mock("axios");
jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate
}), { virtual: true });
jest.mock("../utils/cartPersistence", () => ({
  loadCartItems: jest.fn(),
  saveCartItems: jest.fn()
}));
jest.mock("../utils/assetPreview", () => ({
  getAssetPreviewUrl: () => ""
}));

describe("CartPage BOGO checkout selection", () => {
  const cartItems = [
    { id: 1, title: "Asset One", unitPrice: 100 },
    { id: 2, title: "Asset Two", unitPrice: 50 },
    { id: 3, title: "Asset Three", unitPrice: 25 }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.removeItem("appliedFlashSale");
    localStorage.removeItem("token");
    loadCartItems.mockResolvedValue(cartItems);
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/checkout/active-flash-sales")) {
        return Promise.resolve({
          data: {
            sales: [{
              id: 12,
              name: "Buy One Get One",
              discount_rule: "BOGO",
              status: "running",
              featured_placement: "homepage",
              metadata: {}
            }],
            categories: [],
            collections: []
          }
        });
      }
      if (url.endsWith("/settings/pricing")) {
        return Promise.resolve({ data: { tax_settings: [] } });
      }
      return Promise.resolve({ data: {} });
    });
    axios.post.mockResolvedValue({ data: { coupon: null, eligible: false } });
  });

  it("opens a premium asset picker before checkout when the cart has extra BOGO assets", async () => {
    render(<CartPage />);

    expect(await screen.findByText("Flash Sale BOGO applied")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByPlaceholderText("WELCOME10")).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: "Proceed to checkout" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose your BOGO assets" });
    expect(dialog).toHaveTextContent("Choose 2 eligible assets.");
    expect(within(dialog).getByLabelText(/Asset One/)).toBeChecked();
    expect(within(dialog).getByLabelText(/Asset Two/)).toBeChecked();

    fireEvent.click(within(dialog).getByLabelText(/Asset One/));
    fireEvent.click(within(dialog).getByLabelText(/Asset Three/));
    expect(within(dialog).getByText("2 of 2 selected")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Continue to checkout" }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/checkout"));
    expect(JSON.parse(localStorage.getItem("appliedFlashSale"))).toEqual({
      saleId: 12,
      selectedAssetIds: ["2", "3"]
    });
  });

  it("does not navigate until the required BOGO asset count is selected", async () => {
    render(<CartPage />);
    expect(await screen.findByText("Flash Sale BOGO applied")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Proceed to checkout" }));

    const dialog = await screen.findByRole("dialog", { name: "Choose your BOGO assets" });
    const continueButton = within(dialog).getByRole("button", { name: "Continue to checkout" });
    fireEvent.click(within(dialog).getByLabelText(/Asset One/));
    expect(continueButton).toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
