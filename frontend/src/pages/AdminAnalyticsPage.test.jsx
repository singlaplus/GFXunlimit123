import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import AdminAnalyticsPage from "./AdminAnalyticsPage";

jest.mock("axios");

describe("AdminAnalyticsPage", () => {
  beforeEach(() => {
    localStorage.setItem("token", "demo-admin-token");
    axios.get.mockResolvedValue({
      data: {
        summary: {
          totalRevenue: 125000,
          netRevenue: 118500,
          todaysRevenue: 4250,
          weeklyRevenue: 21800,
          monthlyRevenue: 95400,
          yearlyRevenue: 125000,
          totalOrders: 124,
          completedOrders: 109,
          pendingOrders: 11,
          cancelledOrders: 4,
          refundedOrders: 3,
          averageOrderValue: 1008.06,
          conversionRate: 4.8,
          customerLifetimeValue: 624,
          monthlyRecurringRevenue: 9180,
          annualRecurringRevenue: 110160,
          activeCustomers: 84,
          activeContributors: 16,
          pendingAssets: 6,
          publishedAssets: 142,
          downloadsToday: 184,
          downloadsThisMonth: 3412,
          supportTickets: 9,
          liveChats: 4,
          newsletterSubscribers: 512
        },
        revenueSeries: [],
        salesSeries: [],
        categoryBreakdown: [],
        contributorBreakdown: [],
        assetBreakdown: [],
        customerBreakdown: [],
        geographyBreakdown: [],
        alerts: []
      }
    });
  });

  it("renders the enterprise analytics dashboard shell and KPI cards", async () => {
    render(<AdminAnalyticsPage />);

    expect(await screen.findByText("Enterprise Analytics & BI Dashboard")).toBeInTheDocument();
    expect(await screen.findByText("Total Revenue")).toBeInTheDocument();
    expect(await screen.findByText("Active Customers")).toBeInTheDocument();
    expect(screen.getAllByText("Executive Dashboard").length).toBeGreaterThan(0);
  });

  it("renders executive KPI cards and revenue analytics metric groups when the sidebar is clicked", async () => {
    render(<AdminAnalyticsPage />);

    expect(await screen.findByText("Total Revenue")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /revenue analytics/i }));

    expect(await screen.findByText("Revenue by Hour")).toBeInTheDocument();
    expect(screen.getByText("Revenue by Category")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /executive dashboard/i }));

    expect(await screen.findByText("Total Revenue")).toBeInTheDocument();
    expect(screen.getByText("Active Customers")).toBeInTheDocument();
  });

  it("shows custom date range fields and exports CSV with selected dates", async () => {
    const originalFetch = global.fetch;
    const originalWindowFetch = window.fetch;
    const fetchMock = jest.fn().mockResolvedValue({ blob: jest.fn().mockResolvedValue(new Blob(["a,b\n1,2"], { type: "text/csv" })) });
    global.fetch = fetchMock;
    window.fetch = fetchMock;

    render(<AdminAnalyticsPage />);

    expect(await screen.findByText("Total Revenue")).toBeInTheDocument();
    const rangeSelect = screen.getByDisplayValue(/30d/i);
    fireEvent.change(rangeSelect, { target: { value: "custom" } });

    const fromInput = await screen.findByLabelText(/from/i);
    const toInput = await screen.findByLabelText(/to/i);
    fireEvent.change(fromInput, { target: { value: "2026-01-01" } });
    fireEvent.change(toInput, { target: { value: "2026-01-31" } });

    fireEvent.click(await screen.findByRole("button", { name: /export csv/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const exportUrl = fetchMock.mock.calls[0][0];
    expect(exportUrl).toContain("format=csv");
    expect(exportUrl).toContain("range=custom");
    expect(exportUrl).toContain("from=2026-01-01");
    expect(exportUrl).toContain("to=2026-01-31");

    global.fetch = originalFetch;
    window.fetch = originalWindowFetch;
  });
});
