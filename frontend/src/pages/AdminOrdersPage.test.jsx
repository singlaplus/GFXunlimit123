import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import AdminOrdersPage from "./AdminOrdersPage";

jest.mock("axios");

describe("AdminOrdersPage", () => {
  beforeEach(() => {
    localStorage.setItem("token", "demo-admin-token");
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/admin/orders/summary")) {
        return Promise.resolve({ data: { total_orders: 1, total_revenue: 10, pending_orders: 0, completed_orders: 1, refunded_orders: 0, returning_customers: 0, currency: "INR" } });
      }
      if (url.endsWith("/admin/orders")) {
        return Promise.resolve({ data: { orders: [{ id: 1, order_number: "GFX100826-01", invoice_number: "INV-1", customer_username: "alice", customer_email: "alice@example.com", order_type: "purchase", assets_count: 1, total_amount: 10, currency: "INR", payment_gateway: "Credit Card", order_status: "completed", refund_status: "none", download_status: "completed", id: 1 }], total: 1 } });
      }
      return Promise.resolve({ data: {} });
    });
  });

  it("renders buy orders from the real orders endpoint", async () => {
    render(<AdminOrdersPage />);

    expect(await screen.findByText(/Orders Management/i)).toBeInTheDocument();
    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(await screen.findByText("Total Orders")).toBeInTheDocument();
  });

  it("shows submitted UTR details and requires confirmation before approving payment", async () => {
    const paymentDetails = {
      order: {
        id: 1,
        order_number: "GFX100826-01",
        payment_method: "Google Pay",
        payment_gateway: "Google Pay",
        payment_status: "pending",
        total_amount: 10,
        currency: "INR",
        created_at: new Date().toISOString(),
      },
      payments: [{
        id: 8,
        gateway: "Google Pay",
        status: "pending",
        response: { upiId: "alice@upi", utr: "123456789012", submittedAt: new Date().toISOString() },
      }],
      items: [],
      customerDownloads: [],
      refunds: [],
      notes: [],
      activity: [],
      customerHistory: [],
    };
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/admin/orders/summary")) {
        return Promise.resolve({ data: { total_orders: 1, total_revenue: 10 } });
      }
      if (url.endsWith("/admin/orders")) {
        return Promise.resolve({ data: { orders: [{ id: 1, order_number: "GFX100826-01", customer_username: "alice", total_amount: 10, currency: "INR", payment_gateway: "Google Pay", order_status: "awaiting_payment", refund_status: "none", download_status: "pending" }], total: 1 } });
      }
      if (url.endsWith("/admin/orders/1")) {
        return Promise.resolve({ data: paymentDetails });
      }
      return Promise.resolve({ data: {} });
    });
    axios.put.mockResolvedValue({ data: { success: true, paymentStatus: "completed" } });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    render(<AdminOrdersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "View" }));

    expect(await screen.findByText("Pending Verification")).toBeInTheDocument();
    expect(screen.getByText("123456789012")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve Payment" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/orders/1/payment-status"),
        { decision: "approved" },
        expect.anything()
      );
    });
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Only approve after confirming that the payment has been received."));
    confirmSpy.mockRestore();
  });
});
