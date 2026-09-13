import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import ContributorDashboard from "./ContributorDashboard";

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ search: "" }),
  useNavigate: () => jest.fn(),
}));

jest.mock("axios");

describe("ContributorDashboard", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("token", "test-token");

    axios.get.mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/profile")) {
        return Promise.resolve({ data: { username: "asxc", full_name: "A S", email: "asxc@example.com" } });
      }
      if (typeof url === "string" && url.includes("/profile/stats")) {
        return Promise.resolve({ data: { total_views: 17, total_downloads: 11, total_likes: 0, uploads: 5, approved_images: 4, rejected_images: 1 } });
      }
      if (typeof url === "string" && url.includes("/dashboard-stats")) {
        return Promise.resolve({ data: { uploads: 5, downloads: 11, views: 17, likes: 0 } });
      }
      if (typeof url === "string" && url.includes("/earnings-dashboard")) {
        return Promise.resolve({ data: { total_earnings: "8.07", unpaid_earnings: "8.07", earnings_today: "5.40", earnings_last_7_days: "8.07", earnings_last_30_days: "8.07", earnings_last_365_days: "8.07" } });
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
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Available balance")).toBeInTheDocument();
    });

    const availableBalance = screen.getByText("Available balance").parentElement;
    expect(availableBalance).toHaveTextContent("₹8.07");
  });
});
