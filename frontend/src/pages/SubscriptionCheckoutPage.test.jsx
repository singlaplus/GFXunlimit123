import { render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import SubscriptionCheckoutPage from "./SubscriptionCheckoutPage";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

jest.mock("axios");
jest.mock("react-router-dom", () => {
  const searchParams = new URLSearchParams("plan=1");
  return {
    useNavigate: () => jest.fn(),
    useSearchParams: () => [searchParams],
  };
});
jest.mock("../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));

describe("SubscriptionCheckoutPage startup readiness", () => {
  const reportResource = jest.fn();
  let retryKey;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    retryKey = 0;
    useStartupReadiness.mockImplementation(() => ({
      reportResource,
      retryKey,
      routeId: "subscription-checkout-route",
    }));
    axios.get.mockImplementation((url) => Promise.resolve({
      data: url.endsWith("/subscription-plans")
        ? [{
            id: 1,
            name: "Monthly",
            pricing: { prices: { monthly: 10 }, currency_prices: {} },
            plan_settings: { duration: "monthly", durations: { monthly: {} } },
          }]
        : { enabledGateways: [] },
    }));
  });

  it("loads plan and payment settings before reporting ready; retry repeats GETs only", async () => {
    const view = render(<SubscriptionCheckoutPage />);

    await waitFor(() => {
      expect(reportResource).toHaveBeenLastCalledWith(
        "subscriptionCheckout",
        "ready",
        "",
        "subscription-checkout-route"
      );
    });
    expect(screen.getAllByText("Monthly")).toHaveLength(2);
    expect(axios.get).toHaveBeenCalledTimes(2);

    retryKey = 1;
    view.rerender(<SubscriptionCheckoutPage />);
    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(4));
    expect(axios.post).not.toHaveBeenCalled();
  });
});
