import { render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import CustomerDashboard from "./CustomerDashboard";
import { useStartupReadiness } from "../../startup/StartupReadinessProvider";
import { loadCartItems } from "../../utils/cartPersistence";

jest.mock("axios");
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
}));
jest.mock("../../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));
jest.mock("../../utils/cartPersistence", () => ({
  loadCartItems: jest.fn().mockResolvedValue([]),
}));

describe("CustomerDashboard startup readiness", () => {
  const reportResource = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    loadCartItems.mockResolvedValue([]);
    localStorage.setItem("token", "session-token");
    useStartupReadiness.mockReturnValue({
      reportResource,
      retryKey: 0,
      routeId: "dashboard-test",
    });
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/profile")) return Promise.resolve({ data: { id: 8, username: "buyer" } });
      if (url.endsWith("/my-customer-downloads")) return Promise.resolve({ data: [] });
      if (url.endsWith("/favorites")) return Promise.resolve({ data: [] });
      if (url.includes("/orders?")) return Promise.resolve({ data: { orders: [] } });
      if (url.includes("/notifications/")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: {} });
    });
  });

  it("reports readiness when essential customer data is valid and empty", async () => {
    render(<CustomerDashboard darkMode={false} username="buyer" />);

    await waitFor(() => {
      expect(reportResource).toHaveBeenCalledWith(
        "customerDashboard",
        "ready",
        "",
        "dashboard-test"
      );
    });
    expect(screen.getByText("Fresh assets for your next idea.")).toBeInTheDocument();
  });

  it("reports malformed essential responses as failures", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/profile")) return Promise.resolve({ data: { id: 8 } });
      if (url.endsWith("/my-customer-downloads")) return Promise.resolve({ data: [] });
      if (url.endsWith("/favorites")) return Promise.resolve({ data: [] });
      if (url.includes("/orders?")) return Promise.resolve({ data: { orders: {} } });
      return Promise.resolve({ data: [] });
    });
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    render(<CustomerDashboard darkMode={false} username="buyer" />);

    await waitFor(() => {
      expect(reportResource).toHaveBeenCalledWith(
        "customerDashboard",
        "error",
        "Unable to load your dashboard information. Please retry.",
        "dashboard-test"
      );
    });
    expect(reportResource).not.toHaveBeenCalledWith(
      "customerDashboard",
      "ready",
      "",
      "dashboard-test"
    );
    consoleError.mockRestore();
  });

  it("does not report ready when essential cart loading fails", async () => {
    loadCartItems.mockRejectedValueOnce(new Error("Cart unavailable"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    render(<CustomerDashboard darkMode={false} username="buyer" />);

    await waitFor(() => {
      expect(reportResource).toHaveBeenCalledWith(
        "customerDashboard",
        "error",
        "Unable to load your dashboard information. Please retry.",
        "dashboard-test"
      );
    });
    expect(loadCartItems).toHaveBeenCalledWith({ strict: true });
    expect(reportResource).not.toHaveBeenCalledWith(
      "customerDashboard",
      "ready",
      "",
      "dashboard-test"
    );
    consoleError.mockRestore();
  });
});
