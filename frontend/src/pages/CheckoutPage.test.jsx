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
      return Promise.resolve({ data: { success: true, paymentStatus: "completed", message: "Payment details submitted. Your order is complete and downloads are available." } });
    });
  });

  it("shows an encoded UPI QR reference and completes the order after a valid UTR submission", async () => {
    render(<CheckoutPage />);

    fireEvent.click(await screen.findByRole("radio", { name: "Google Pay" }));
    const placeOrderButton = screen.getByRole("button", { name: "Place order" });
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
    expect(axios.post).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("UTR / Transaction ID"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/enter utr \/ transaction id/i);
    expect(axios.post).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("UTR / Transaction ID"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/enter utr \/ transaction id/i);
    expect(axios.post).toHaveBeenCalledTimes(1);

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
});
