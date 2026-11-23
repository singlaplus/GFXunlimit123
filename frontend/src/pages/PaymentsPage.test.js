import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("shows five transactions per page and paginates the remaining entries", async () => {
    const payments = Array.from({ length: 7 }, (_, index) => ({
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

    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(6));
    expect(screen.getByText("transaction-5")).toBeInTheDocument();
    expect(screen.queryByText("transaction-6")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next ▶" }));

    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("transaction-6")).toBeInTheDocument();
    expect(screen.getByText("transaction-7")).toBeInTheDocument();
    expect(screen.queryByText("transaction-5")).not.toBeInTheDocument();
  });

  it("paginates redeem requests when there are more than five", async () => {
    const requests = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      created_at: "2026-01-01T00:00:00.000Z",
      requested_credits: index + 1,
      status: "Submitted",
    }));
    axios.get.mockImplementation((url) => Promise.resolve({
      data: url.endsWith("/payout-requests") ? requests : [],
    }));

    render(<PaymentsPage />);

    const payoutTable = await screen.findAllByRole("table").then((tables) => tables[0]);
    await waitFor(() => expect(within(payoutTable).getAllByRole("row")).toHaveLength(6));
    expect(within(payoutTable).getByText("5")).toBeInTheDocument();
    expect(within(payoutTable).queryByText("6")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next ▶" }));

    expect(within(payoutTable).getAllByRole("row")).toHaveLength(3);
    expect(within(payoutTable).getByText("6")).toBeInTheDocument();
    expect(within(payoutTable).getByText("7")).toBeInTheDocument();
  });

  it("shows redeem request pagination starting with a single entry", async () => {
    axios.get.mockImplementation((url) => Promise.resolve({
      data: url.endsWith("/payout-requests") ? [{
        id: 1,
        created_at: "2026-01-01T00:00:00.000Z",
        requested_credits: 1,
        status: "Submitted",
      }] : [],
    }));

    render(<PaymentsPage />);

    expect(await screen.findByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next ▶" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Last ⏭" })).toBeDisabled();
  });
});
