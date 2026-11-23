import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import PaymentsPage from "./PaymentsPage";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

jest.mock("axios");
jest.mock("react-router-dom", () => ({
  useLocation: jest.fn(),
  useNavigate: jest.fn(),
}));
jest.mock("../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));

describe("PaymentsPage startup readiness", () => {
  const reportResource = jest.fn();
  let retryKey;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    useLocation.mockReturnValue({ pathname: "/payments", search: "" });
    useNavigate.mockReturnValue(jest.fn());
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

  it("shows 20 transactions per page and paginates the remaining entries", async () => {
    const payments = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      created_at: "2026-01-01T00:00:00.000Z",
      username: `buyer-${index + 1}`,
      credits: 1,
      amount_paid: 1,
      currency: "INR",
      transaction_id: `transaction-${index + 1}`,
    }));
    axios.get.mockImplementation((url) => Promise.resolve({
      data: url.endsWith("/payout-requests") ? [] : payments,
    }));

    render(<PaymentsPage />);

    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(21));
    expect(screen.getByText("transaction-20")).toBeInTheDocument();
    expect(screen.queryByText("transaction-21")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next ▶" }));

    expect(screen.getAllByRole("row")).toHaveLength(6);
    expect(screen.getByText("transaction-21")).toBeInTheDocument();
    expect(screen.getByText("transaction-25")).toBeInTheDocument();
    expect(screen.queryByText("transaction-20")).not.toBeInTheDocument();
  });
});
