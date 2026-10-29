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
    localStorage.removeItem("appliedBundleOfferId");
    localStorage.removeItem("appliedCoupon");
    localStorage.removeItem("token");
    loadCartItems.mockResolvedValue(cartItems);
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/checkout/active-bundle-discounts")) {
        return Promise.resolve({ data: { offers: [] } });
      }
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

  it("shows a bundle tier and its savings for paid cart assets", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/checkout/active-bundle-discounts")) {
        return Promise.resolve({
          data: {
            offers: [{
              id: 21,
              name: "Asset tiers",
              status: "active",
              metadata: {
                discount_tiers: [{ asset_count: 3, discount_percent: 10 }],
                start_date: "2020-01-01"
              }
            }]
          }
        });
      }
      if (url.endsWith("/checkout/active-flash-sales")) {
        return Promise.resolve({ data: { sales: [], categories: [], collections: [] } });
      }
      if (url.endsWith("/settings/pricing")) {
        return Promise.resolve({ data: { tax_settings: [] } });
      }
      return Promise.resolve({ data: {} });
    });

    render(<CartPage />);

    expect(await screen.findByText(/3 paid assets qualify for 10% off/i)).toBeInTheDocument();
    expect(await screen.findAllByText(/17\.50/)).toHaveLength(2);
  });

  it("applies only the Flash Sale when a bundle discount is also eligible", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/checkout/active-bundle-discounts")) {
        return Promise.resolve({
          data: {
            offers: [{
              id: 21,
              name: "Asset tiers",
              status: "active",
              metadata: {
                discount_tiers: [{ asset_count: 3, discount_percent: 20 }],
                start_date: "2020-01-01"
              }
            }]
          }
        });
      }
      if (url.endsWith("/checkout/active-flash-sales")) {
        return Promise.resolve({
          data: {
            sales: [{
              id: 22,
              name: "Summer sale",
              discount_rule: "PERCENTAGE",
              status: "running",
              featured_placement: "homepage",
              metadata: { discount_value: 10 }
            }],
            categories: [],
            collections: []
          }
        });
      }
      if (url.endsWith("/settings/pricing")) return Promise.resolve({ data: { tax_settings: [] } });
      return Promise.resolve({ data: {} });
    });

    render(<CartPage />);

    expect(await screen.findByText("Flash Sale discount applied")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/Asset tiers/)).not.toBeInTheDocument();
      expect(screen.getAllByText(/17\.50/).length).toBeGreaterThan(0);
    });
  });

  it("opens all active customer offers from the cart", async () => {
    localStorage.setItem("token", "customer-token");
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/checkout/available-coupons")) {
        return Promise.resolve({
          data: [{ id: 32, name: "Welcome", code: "WELCOME10", coupon_type: "manual", discount_type: "percentage", discount_value: 10 }]
        });
      }
      if (url.endsWith("/checkout/active-bundle-discounts")) {
        return Promise.resolve({
          data: {
            offers: [{
              id: 42,
              name: "Three assets",
              status: "active",
              metadata: { start_date: "2020-01-01", discount_tiers: [{ asset_count: 3, discount_percent: 10 }] }
            }]
          }
        });
      }
      if (url.endsWith("/checkout/active-flash-sales")) {
        return Promise.resolve({
          data: {
            sales: [{ id: 52, name: "Summer sale", discount_rule: "PERCENTAGE", status: "running", featured_placement: "homepage", metadata: { discount_value: 10 } }],
            categories: [],
            collections: []
          }
        });
      }
      if (url.endsWith("/settings/pricing")) return Promise.resolve({ data: { tax_settings: [] } });
      return Promise.resolve({ data: {} });
    });

    render(<CartPage />);

    const offersButton = await screen.findByRole("button", { name: "View all offers" });
    expect(offersButton.parentElement).toHaveTextContent("Coupon");
    fireEvent.click(offersButton);
    const dialog = await screen.findByRole("dialog", { name: "Available offers" });
    expect(await within(dialog).findByText(/WELCOME10/)).toBeInTheDocument();
    expect(within(dialog).getByText("Summer sale")).toBeInTheDocument();
    expect(within(dialog).getByText("Three assets")).toBeInTheDocument();
    localStorage.removeItem("token");
  });

  it("replaces an applied coupon when a bundle offer is selected", async () => {
    localStorage.setItem("token", "customer-token");
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/checkout/available-coupons")) {
        return Promise.resolve({
          data: [{ id: 32, name: "Welcome", code: "WELCOME10", coupon_type: "manual", discount_type: "percentage", discount_value: 10 }]
        });
      }
      if (url.endsWith("/checkout/active-bundle-discounts")) {
        return Promise.resolve({
          data: {
            offers: [{
              id: 42,
              name: "Three assets",
              status: "active",
              metadata: { start_date: "2020-01-01", discount_tiers: [{ asset_count: 3, discount_percent: 10 }] }
            }]
          }
        });
      }
      if (url.endsWith("/checkout/active-flash-sales")) {
        return Promise.resolve({ data: { sales: [], categories: [], collections: [] } });
      }
      if (url.endsWith("/settings/pricing")) return Promise.resolve({ data: { tax_settings: [] } });
      return Promise.resolve({ data: {} });
    });
    axios.post.mockImplementation((url) => url.endsWith("/checkout/validate-coupon")
      ? Promise.resolve({ data: { coupon: { id: 32, code: "WELCOME10", discount_type: "percentage", discount_value: 10 } } })
      : Promise.resolve({ data: { coupon: null, eligible: false } }));

    render(<CartPage />);

    fireEvent.click(await screen.findByRole("button", { name: "View all offers" }));
    let dialog = await screen.findByRole("dialog", { name: "Available offers" });
    const couponArticle = within(dialog).getByText(/WELCOME10/).closest("article");
    fireEvent.click(within(couponArticle).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(localStorage.getItem("appliedCoupon")).toContain("WELCOME10"));

    fireEvent.click(await screen.findByRole("button", { name: "View all offers" }));
    dialog = await screen.findByRole("dialog", { name: "Available offers" });
    const bundleArticle = within(dialog).getByText("Three assets").closest("article");
    fireEvent.click(within(bundleArticle).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(localStorage.getItem("appliedBundleOfferId")).toBe("42"));
    expect(localStorage.getItem("appliedCoupon")).toBeNull();
    expect(JSON.parse(localStorage.getItem("appliedFlashSale"))).not.toHaveProperty("saleId");
    localStorage.removeItem("token");
  });
});
