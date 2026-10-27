import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import CheckoutPage from "./CheckoutPage";
import { clearCartItems, loadCartItems } from "../utils/cartPersistence";

jest.mock("axios");
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
}), { virtual: true });
jest.mock("../utils/cartPersistence", () => ({
  loadCartItems: jest.fn(),
  saveCartItems: jest.fn(),
  clearCartItems: jest.fn(),
}));
jest.mock("../utils/cartCheckout", () => ({
  getFlashSaleMetadata: (sale = {}) => typeof sale.metadata === "string" ? JSON.parse(sale.metadata) : sale.metadata || {},
  getFlashSaleEligibleItems: (items) => items,
  getFlashSaleRequiredAssetCount: (rule = "") => ({ BOGO: 2, BOG2: 3, BOG3: 4, BOG5: 6 }[String(rule).toUpperCase()] || 0),
  calculateFlashSaleDiscount: (items, sale) => {
    const metadata = typeof sale?.metadata === "string" ? JSON.parse(sale.metadata) : sale?.metadata || {};
    return String(sale?.discount_rule || "").toLowerCase() === "percentage"
      ? items.reduce((sum, item) => sum + Number(item.unitPrice || item.price || 0), 0) * Number(metadata.discount_value || 0) / 100
      : Number(metadata.discount_value || 0);
  },
  calculateCartTotals: (items) => {
    const subtotal = items.reduce((sum, item) => sum + Number(item.unitPrice || item.price || 0) * Number(item.quantity || 1), 0);
    const tax = subtotal * 0.18;
    return { subtotal, discount: 0, tax, total: subtotal + tax, taxBreakdown: [] };
  },
  readAppliedCoupon: () => ({ code: "" }),
  clearAppliedCoupon: jest.fn(),
  normalizeCouponCode: (code) => code,
}));

describe("CheckoutPage manual Google Pay submission", () => {
  beforeEach(() => {
    loadCartItems.mockResolvedValue([{ id: 2, title: "Photo", quantity: 1, unitPrice: 100, currency: "INR" }]);
    clearCartItems.mockResolvedValue();
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/checkout/active-flash-sales")) {
        return Promise.resolve({ data: { sales: [], categories: [], collections: [] } });
      }
      if (url.endsWith("/payment-settings")) {
        return Promise.resolve({ data: { enabledGateways: ["Google Pay"], googlePayId: "merchant@upi" } });
      }
      if (url.endsWith("/profile")) return Promise.resolve({ data: { credits: 0 } });
      return Promise.resolve({ data: {} });
    });
    axios.post.mockImplementation((url) => {
      if (url.endsWith("/checkout/place-order")) {
        return Promise.resolve({ data: { orderId: 15, orderNumber: "GFX-15" } });
      }
      return Promise.resolve({ data: { success: true, paymentStatus: "paid", message: "Payment details submitted. Your order is complete and downloads are available." } });
    });
  });

  it("shows an encoded UPI QR reference and completes the order after a valid UTR submission", async () => {
    render(<CheckoutPage />);

    fireEvent.click(await screen.findByRole("radio", { name: "Google Pay" }));
    const placeOrderButton = screen.getByRole("button", { name: "Place order" });
    const paymentSubmissionCalls = () => axios.post.mock.calls.filter(([url]) => url.endsWith("/checkout/submit-google-pay-payment"));
    await waitFor(() => expect(placeOrderButton).toBeEnabled());
    fireEvent.click(placeOrderButton);
    expect(await screen.findByRole("heading", { name: "Google Pay / UPI" })).toBeInTheDocument();

    const qr = screen.getByAltText("Google Pay payment QR code");
    const paymentUri = new URL(qr.src).searchParams.get("data");
    const paymentParams = new URL(paymentUri).searchParams;
    expect(paymentParams.get("pa")).toBe("merchant@upi");
    expect(paymentParams.get("am")).toBe("118.00");
    expect(paymentParams.get("tn")).toBe("GFX-15");

    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/enter utr \/ transaction id/i);
    expect(paymentSubmissionCalls()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("UTR / Transaction ID"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/enter utr \/ transaction id/i);
    expect(paymentSubmissionCalls()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("UTR / Transaction ID"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/enter utr \/ transaction id/i);
    expect(paymentSubmissionCalls()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("UTR / Transaction ID"), { target: { value: "123456789012" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    await waitFor(() => {
      expect(axios.post).toHaveBeenLastCalledWith(
        expect.stringContaining("/checkout/submit-google-pay-payment"),
        { orderId: 15, utr: "123456789012" },
        expect.anything()
      );
    });
    expect(await screen.findByText("Order complete")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/order is complete and downloads are available/i);
  });

  it("automatically applies an available First Order coupon", async () => {
    axios.post.mockImplementation((url) => {
      if (url.endsWith("/checkout/first-order-coupon")) {
        return Promise.resolve({
          data: {
            eligible: true,
            coupon: {
              id: 9,
              code: "FIRST10",
              couponType: "first_order",
              discountType: "percentage",
              discountValue: 10,
            },
            message: "Your First Order coupon has been applied automatically.",
          },
        });

        it("hides coupon controls while a Flash Sale discount is applied", async () => {
          axios.get.mockImplementation((url) => {
            if (url.endsWith("/checkout/active-flash-sales")) {
              return Promise.resolve({
                data: {
                  sales: [{
                    id: 22,
                    name: "Checkout Sale",
                    discount_rule: "percentage",
                    status: "running",
                    featured_placement: "homepage",
                    metadata: { discount_value: 10 }
                  }],
                  categories: [],
                  collections: []
                }
              });
            }
            if (url.endsWith("/payment-settings")) {
              return Promise.resolve({ data: { enabledGateways: ["Google Pay"], googlePayId: "merchant@upi" } });
            }
            if (url.endsWith("/profile")) return Promise.resolve({ data: { credits: 0 } });
            return Promise.resolve({ data: {} });
          });

          render(<CheckoutPage />);

          expect(await screen.findByText("Flash Sale discount applied")).toBeInTheDocument();
          expect(screen.getByLabelText("Flash Sale")).toHaveClass("flash-sale-cart-card");
          expect(screen.getByText("APPLIED")).toBeInTheDocument();
          expect(screen.getByText("You save")).toBeInTheDocument();
          expect(screen.queryByPlaceholderText("WELCOME10")).not.toBeInTheDocument();
          expect(screen.queryByText("Your available coupons")).not.toBeInTheDocument();
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(<CheckoutPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("WELCOME10")).toHaveValue("FIRST10");
    });
    expect(await screen.findByText("Your First Order coupon has been applied automatically.")).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/checkout/first-order-coupon"),
      { items: [{ id: 2, title: "Photo", quantity: 1, unitPrice: 100, currency: "INR" }] },
      expect.anything()
    );
  });

  it("shows how many distinct assets to remove before applying the First Order coupon", async () => {
    const items = [1, 2, 3, 4, 5].map((id) => ({
      id,
      title: `Photo ${id}`,
      quantity: 1,
      unitPrice: 100,
      currency: "INR",
    }));
    loadCartItems.mockResolvedValue(items);
    axios.post.mockImplementation((url) => {
      if (url.endsWith("/checkout/first-order-coupon")) {
        return Promise.resolve({
          data: {
            eligible: false,
            coupon: { id: 9, code: "FIRST10", couponType: "first_order", discountType: "percentage", discountValue: 10 },
            message: "Remove 3 assets to apply the First Order discount. If you place this order without it, the coupon will not be available on later orders.",
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(<CheckoutPage />);

    expect(await screen.findByText(/remove 3 assets to apply the first order discount/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("WELCOME10")).toHaveValue("");
  });

  it("shows and applies an auto-generated coupon assigned to the signed-in user", async () => {
    localStorage.setItem("token", "customer-token");
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/checkout/available-coupons")) {
        return Promise.resolve({
          data: [{ id: 21, name: "Personal offer", code: "ABCD1234", couponType: "auto", discount_type: "percentage", discount_value: 15 }],
        });
      }
      if (url.endsWith("/payment-settings")) {
        return Promise.resolve({ data: { enabledGateways: ["Google Pay"], googlePayId: "merchant@upi" } });
      }
      if (url.endsWith("/profile")) return Promise.resolve({ data: { credits: 0 } });
      return Promise.resolve({ data: {} });
    });

    render(<CheckoutPage />);

    expect(await screen.findByText("ABCD1234")).toBeInTheDocument();
    expect(screen.queryByText("Personal offer")).not.toBeInTheDocument();
    expect(screen.getByText("15% off")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply coupon ABCD1234" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/checkout/validate-coupon"),
        { code: "ABCD1234", items: [{ id: 2, title: "Photo", quantity: 1, unitPrice: 100, currency: "INR" }] },
        expect.anything()
      );
    });
    localStorage.removeItem("token");
  });
});
