import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import EarningsTabPage from "./EarningsTabPage";

describe("EarningsTabPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const renderDashboard = (props = {}) => render(
    <EarningsTabPage
      reputationScore={92}
      reputationTier="New Contributor"
      totalEarnings={1250}
      totalDownloads={340}
      totalUploads={28}
      likes={120}
      views={820}
      monthsOld={6}
      darkMode={false}
      {...props}
    />
  );

  it("renders a loyalty card as the last analytics card with a progress bar", () => {
    renderDashboard();

    const cards = screen.getAllByTestId("earnings-card");
    const summaryCards = cards.filter((card) => card.textContent?.includes("Reputation Score") || card.textContent?.includes("Total Earnings") || card.textContent?.includes("Total Downloads") || card.textContent?.includes("Total Uploads") || card.textContent?.includes("Loyalty Points"));
    expect(summaryCards).toHaveLength(5);
    expect(screen.getByText("Reputation Score")).toBeInTheDocument();
    expect(summaryCards[0]).toHaveTextContent("Reputation Score");
    expect(screen.getByText(/Loyalty Points/i)).toBeInTheDocument();
    expect(screen.getByText(/1 point per day with at least one upload/i)).toBeInTheDocument();
    expect(screen.getByTestId("loyalty-progress-bar")).toBeInTheDocument();
    expect(screen.getByText(/Contributor Threshold Tier/i)).toBeInTheDocument();
    expect(screen.queryByText("Live formula:")).not.toBeInTheDocument();
  });

  it("uses the provided reputation score to determine the displayed threshold tier", () => {
    renderDashboard({ reputationScore: 500, totalDownloads: 0, totalUploads: 0, reputationTier: "Verified Contributor" });

    expect(screen.getByText(/Verified Contributor/i)).toBeInTheDocument();
  });

  it("keeps the tier label consistent with the supplied reputation score", async () => {
    renderDashboard({ reputationTier: "New Contributor" });

    await waitFor(() => {
      expect(screen.getByText(/New Contributor/i)).toBeInTheDocument();
    });
  });

  it("renders only the main analytics cards without any lower milestone section", () => {
    renderDashboard();

    expect(screen.queryByText("Upload Milestones")).not.toBeInTheDocument();
    expect(screen.queryByText(/Next milestone/i)).not.toBeInTheDocument();
  });

});
