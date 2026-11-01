import { render, waitFor } from "@testing-library/react";
import axios from "axios";
import PaymentsPage from "./PaymentsPage";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

jest.mock("axios");
jest.mock("../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));

describe("PaymentsPage startup readiness", () => {
  const reportResource = jest.fn();
  let retryKey;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    retryKey = 0;
    useStartupReadiness.mockImplementation(() => ({
      reportResource,
      retryKey,
      routeId: "payments-route",
    }));
    axios.get.mockImplementation((url) => Promise.resolve({
      data: url.endsWith("/payout-requests") ? [] : [],
    }));
  });

  it("waits for valid empty payment and payout history and retries only GET requests", async () => {
    const view = render(<PaymentsPage />);
    await waitFor(() => {
      expect(reportResource).toHaveBeenLastCalledWith("payments", "ready", "", "payments-route");
    });
    expect(axios.get).toHaveBeenCalledTimes(2);

    retryKey = 1;
    view.rerender(<PaymentsPage />);
    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(4));
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("keeps malformed payout responses from reporting readiness success", async () => {
    axios.get.mockImplementation((url) => Promise.resolve({
      data: url.endsWith("/payout-requests") ? {} : [],
    }));
    render(<PaymentsPage />);

    await waitFor(() => {
      expect(reportResource).toHaveBeenLastCalledWith(
        "payments",
        "error",
        "Unable to load payment history. Please retry.",
        "payments-route"
      );
    });
  });
});
