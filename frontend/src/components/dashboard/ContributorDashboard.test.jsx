import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import ContributorDashboard from "./ContributorDashboard";
import { useStartupReadiness } from "../../startup/StartupReadinessProvider";

const mockNavigate = jest.fn();
const mockLocation = { search: "" };

jest.mock("react-router-dom", () => ({
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
}));

jest.mock("axios");
jest.mock("../../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));

describe("ContributorDashboard", () => {
  const reportResource = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockLocation.search = "";
    mockNavigate.mockClear();
    localStorage.clear();
    localStorage.setItem("token", "test-token");
    useStartupReadiness.mockReturnValue({
      reportResource,
      retryKey: 0,
      routeId: "contributor-dashboard-test",
    });

    axios.get.mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/profile/stats")) {
        return Promise.resolve({ data: {
          total_uploads: 5,
          approved_images: 4,
          pending_images: 0,
          rejected_images: 1,
          total_likes: 0,
          total_views: 17,
          total_downloads: 11,
          total_earnings: "8.07",
          top_downloads: 11,
          top_views: 17,
          top_likes: 0,
        } });
      }
      if (typeof url === "string" && url.endsWith("/profile")) {
        return Promise.resolve({ data: { id: 8, username: "asxc", full_name: "A S", email: "asxc@example.com" } });
      }
      if (typeof url === "string" && url.includes("/my-uploads")) {
        return Promise.resolve({ data: [] });
      }
      if (typeof url === "string" && url.includes("/notifications/")) {
        return Promise.resolve({ data: [] });
      }

      return Promise.resolve({ data: [] });
    });
  });

  it("uses unpaid earnings as the available balance when available_balance is missing", async () => {
    render(
      <ContributorDashboard
        darkMode={false}
        username="asxc"
        reputationScore={0}
        reputationTier="New Contributor"
        dashboardStats={{ uploads: 5, downloads: 11, views: 17, likes: 0 }}
        earningsStats={{ total_earnings: "8.07", unpaid_earnings: "8.07" }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Available balance")).toBeInTheDocument();
    });
    expect(reportResource).toHaveBeenCalledWith(
      "contributorDashboard",
      "ready",
      "",
      "contributor-dashboard-test"
    );

    const availableBalance = screen.getByText("Available balance").parentElement;
    expect(availableBalance).toHaveTextContent("₹8.07");
    expect(axios.get.mock.calls.some(([url]) => url.includes("/dashboard-stats"))).toBe(false);
    expect(axios.get.mock.calls.some(([url]) => url.includes("/earnings-dashboard"))).toBe(false);
  });

  it("reports malformed contributor statistics as a readiness failure", async () => {
    axios.get.mockImplementation((url) => {
      if (typeof url === "string" && url.endsWith("/profile")) {
        return Promise.resolve({ data: { id: 8, username: "asxc" } });
      }
      if (typeof url === "string" && url.includes("/profile/stats")) {
        return Promise.resolve({ data: {} });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <ContributorDashboard
        darkMode={false}
        username="asxc"
        dashboardStats={{ uploads: 0, downloads: 0, views: 0, likes: 0 }}
        earningsStats={{ total_earnings: 0 }}
      />
    );

    await waitFor(() => {
      expect(reportResource).toHaveBeenCalledWith(
        "contributorDashboard",
        "error",
        "Unable to load your contributor workspace. Please retry.",
        "contributor-dashboard-test"
      );
    });
    expect(screen.getByText("We could not load your contributor workspace.")).toBeInTheDocument();
  });

  it("shows the submitted tax form and opens it with View", async () => {
    mockLocation.search = "?tab=taxcenter";
    axios.get.mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/profile/stats")) {
        return Promise.resolve({ data: {
          total_uploads: 5,
          approved_images: 4,
          pending_images: 0,
          rejected_images: 1,
          total_likes: 0,
          total_views: 17,
          total_downloads: 11,
          total_earnings: "8.07",
          top_downloads: 11,
          top_views: 17,
          top_likes: 0,
        } });
      }
      if (typeof url === "string" && url.endsWith("/profile")) {
        return Promise.resolve({ data: {
          id: 8,
          username: "asxc",
          full_name: "A S",
          email: "asxc@example.com",
          tax_form_status: "submitted",
          tax_form_type: "W-8BEN",
          tax_form_data: { mailingAddress: "Mumbai" },
          tax_form_submitted_at: "2026-09-14T10:00:00.000Z"
        } });
      }
      return Promise.resolve({ data: [] });
    });

    render(
      <ContributorDashboard
        darkMode={false}
        username="asxc"
        reputationScore={0}
        reputationTier="New Contributor"
        dashboardStats={{ uploads: 5, downloads: 11, views: 17, likes: 0 }}
        earningsStats={{ total_earnings: "8.07", unpaid_earnings: "8.07" }}
      />
    );

    expect(await screen.findByText("Form W-8BEN")).toBeInTheDocument();
    expect(screen.getByText(/submitted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^view$/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard?tab=filltaxform_review", expect.objectContaining({
      state: expect.objectContaining({ formType: "W-8BEN" })
    }));
  });
});
