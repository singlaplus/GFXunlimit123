import React from "react";
import { render, screen } from "@testing-library/react";
import ContributorRankCard from "./ContributorRankCard";

describe("ContributorRankCard", () => {
  it("renders the contributor rank summary without progress UI", () => {
    render(
      <ContributorRankCard
        username="Test User"
        contributorRank="🥉 Bronze"
        contributorLevel={1}
        reputationScore={0}
        reputationTier="🟢 New Contributor"
        rawScore={0}
        monthsOld={1}
        dashboardStats={{ uploads: 1 }}
        maxUploads={100}
        nextRank="🥈 Silver"
        contributorBadge="Bronze"
        earningsStats={{ total_earnings: 0, total_downloads: 0 }}
        darkMode={false}
      />
    );

    expect(screen.getByText(/welcome back, test user/i)).toBeInTheDocument();
    expect(screen.queryByText(/xp progress/i)).not.toBeInTheDocument();
  });
});
