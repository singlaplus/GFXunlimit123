import { act, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import AdminCommercePage from "./AdminCommercePage";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

const mockDefaultReportResource = jest.fn();

jest.mock("axios");
jest.mock("../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));

describe("AdminCommercePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStartupReadiness.mockReturnValue({
      reportResource: mockDefaultReportResource,
      retryKey: 0,
      routeId: "admin-commerce-test",
    });
  });

  it("counts commerce KPI values up to their formatted totals", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/admin/orders/summary")) {
        return Promise.resolve({
          data: {
            total_orders: 29,
            today_orders: 0,
            monthly_orders: 4,
            total_revenue: 127.5,
            pending_orders: 6,
            completed_orders: 22,
            refunded_orders: 0,
            returning_customers: 3
          }
        });
      }
      if (url.endsWith("/admin/orders/analytics")) {
        return Promise.resolve({ data: { paymentGatewayDistribution: [] } });
      }
      return Promise.resolve({ data: [] });
    });

    const queuedFrames = [];
    const requestFrameSpy = jest.spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        queuedFrames.push(callback);
        return queuedFrames.length;
      });
    const cancelFrameSpy = jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    render(<AdminCommercePage />);
    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(4));

    const totalRevenue = await screen.findByLabelText("127.5");
    await waitFor(() => expect(totalRevenue).toHaveTextContent("0.0"));

    const runAnimationFrames = (timestamp) => {
      queuedFrames.splice(0).forEach((callback) => callback(timestamp));
    };
    act(() => runAnimationFrames(0));
    act(() => runAnimationFrames(600));
    expect(totalRevenue).toHaveTextContent("111.6");

    act(() => runAnimationFrames(1200));
    expect(totalRevenue).toHaveTextContent("127.5");

    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
  });

  it("reports malformed commerce responses and supports GET-only retry", async () => {
    const reportResource = jest.fn();
    let retryKey = 0;
    useStartupReadiness.mockImplementation(() => ({
      reportResource,
      retryKey,
      routeId: "admin-commerce-test",
    }));
    axios.get.mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: {} });
    const view = render(<AdminCommercePage />);

    await waitFor(() => {
      expect(reportResource).toHaveBeenCalledWith(
        "adminCommerce",
        "error",
        "Unable to load commerce analytics. Please retry.",
        "admin-commerce-test"
      );
    });

    axios.get.mockResolvedValueOnce({
      data: {
        total_orders: 0,
        today_orders: 0,
        monthly_orders: 0,
        total_revenue: 0,
        pending_orders: 0,
        completed_orders: 0,
        refunded_orders: 0,
        returning_customers: 0,
      },
    })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });
    retryKey = 1;
    view.rerender(<AdminCommercePage />);

    await waitFor(() => {
      expect(reportResource).toHaveBeenCalledWith("adminCommerce", "ready", "", "admin-commerce-test");
    });
    expect(axios.get).toHaveBeenCalledTimes(8);
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.patch).not.toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled();
  });
});
