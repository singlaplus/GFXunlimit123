import { act, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import AdminCommercePage from "./AdminCommercePage";

jest.mock("axios");

describe("AdminCommercePage", () => {
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
});
