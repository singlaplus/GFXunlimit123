import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import AdminOrdersPage from "./AdminOrdersPage";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

const mockReportResource = jest.fn();
jest.mock("axios");
jest.mock("../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));

describe("AdminOrdersPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStartupReadiness.mockReturnValue({
      reportResource: mockReportResource,
      retryKey: 0,
      routeId: "admin-orders-test",
    });
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

  it("counts order summary values up to their formatted totals", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/admin/orders/summary")) {
        return Promise.resolve({
          data: {
            total_orders: 29,
            total_revenue: 127.5,
            pending_orders: 6,
            completed_orders: 22,
            refunded_orders: 0,
            returning_customers: 3,
            currency: "USD"
          }
        });
      }
      if (url.endsWith("/admin/orders")) return Promise.resolve({ data: { orders: [], total: 29 } });
      return Promise.resolve({ data: {} });
    });

    const queuedFrames = [];
    const requestFrameSpy = jest.spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        queuedFrames.push(callback);
        return queuedFrames.length;
      });
    const cancelFrameSpy = jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    render(<AdminOrdersPage />);

    const totalRevenue = await screen.findByLabelText("USD 127.50");
    await waitFor(() => expect(totalRevenue).toHaveTextContent("USD 0.00"));

    const runAnimationFrames = (timestamp) => {
      queuedFrames.splice(0).forEach((callback) => callback(timestamp));
    };
    act(() => runAnimationFrames(0));
    act(() => runAnimationFrames(600));
    expect(totalRevenue).toHaveTextContent("USD 111.56");

    act(() => runAnimationFrames(1200));
    expect(totalRevenue).toHaveTextContent("USD 127.50");

    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
  });

  it("reports initial order failures and retries with GET requests only", async () => {
    axios.get.mockImplementation((url) => (
      url.endsWith("/admin/orders/summary")
        ? Promise.reject(new Error("Unavailable"))
        : Promise.resolve({ data: { orders: [], total: 0 } })
    ));
    const view = render(<AdminOrdersPage />);

    await waitFor(() => {
      expect(mockReportResource).toHaveBeenCalledWith(
        "adminOrders",
        "error",
        "Unable to load orders right now. Please retry.",
        "admin-orders-test"
      );
    });

    axios.get.mockImplementation((url) => (
      url.endsWith("/admin/orders/summary")
        ? Promise.resolve({
            data: {
              total_orders: 0,
              total_revenue: 0,
              pending_orders: 0,
              completed_orders: 0,
              refunded_orders: 0,
              returning_customers: 0,
            },
          })
        : Promise.resolve({ data: { orders: [], total: 0 } })
    ));
    useStartupReadiness.mockReturnValue({
      reportResource: mockReportResource,
      retryKey: 1,
      routeId: "admin-orders-test",
    });
    view.rerender(<AdminOrdersPage />);

    await waitFor(() => {
      expect(mockReportResource).toHaveBeenCalledWith("adminOrders", "ready", "", "admin-orders-test");
    });
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.patch).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled();
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
        return Promise.resolve({
          data: {
            total_orders: 1,
            total_revenue: 10,
            pending_orders: 0,
            completed_orders: 1,
            refunded_orders: 0,
            returning_customers: 0,
          },
        });
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
