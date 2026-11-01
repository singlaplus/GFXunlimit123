import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import OrderHistoryPage from "./OrderHistoryPage";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

jest.mock("axios");
jest.mock("../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));

describe("OrderHistoryPage startup readiness", () => {
  const reportResource = jest.fn();
  let retryKey;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("token", "session-token");
    window.history.pushState({}, "", "/orders");
    retryKey = 0;
    useStartupReadiness.mockImplementation(() => ({
      reportResource,
      retryKey,
      routeId: "orders-route",
    }));
    axios.get.mockResolvedValue({ data: { orders: [], total: 0, is_contributor: false } });
  });

  it("accepts a valid empty order list and retry repeats only its GET request", async () => {
    const view = render(<OrderHistoryPage />);
    await waitFor(() => {
      expect(reportResource).toHaveBeenLastCalledWith("orders", "ready", "", "orders-route");
    });
    expect(axios.get).toHaveBeenCalledTimes(1);

    retryKey = 1;
    view.rerender(<OrderHistoryPage />);
    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2));
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("does not report malformed order results as ready", async () => {
    axios.get.mockResolvedValue({ data: { orders: {}, total: 0 } });
    render(<OrderHistoryPage />);

    await waitFor(() => {
      expect(reportResource).toHaveBeenLastCalledWith(
        "orders",
        "error",
        "Unable to load orders. Please retry.",
        "orders-route"
      );
    });
    expect(screen.getByText("Failed to load orders.")).toBeInTheDocument();
  });
});
