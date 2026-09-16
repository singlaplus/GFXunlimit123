import { render, screen, waitFor } from "@testing-library/react";
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
});
