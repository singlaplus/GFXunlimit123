import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import EarningsTabPage from "./EarningsTabPage";
import { buildAnalyticsReportCsv, filterAssetsByFilters, filterAssetsByPeriod, sortAnalyticsAssets } from "./ContributorAnalyticsDashboard";
import { calculateLoyaltyPoints } from "../../utils/loyaltyPoints";

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

  it("filters assets for a custom date range when custom period is selected", () => {
    const now = new Date();
    const assets = [
      { title: "Recent", created_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString() },
      { title: "Old", created_at: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString() },
    ];

    const start = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const filtered = filterAssetsByPeriod(assets, "Custom Range", { start, end });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe("Recent");
  });

  it("filters analytics assets by selected type and category", () => {
    const assets = [
      { title: "Photo", asset_type: "photo", category_name: "Nature" },
      { title: "Vector", asset_type: "vector", category_name: "Business" },
    ];

    const filtered = filterAssetsByFilters(assets, "vector", "Business");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe("Vector");
  });

  it("collapses duplicate category casing into one filter option", () => {
    const assets = [
      { category: "business,Business" },
      { category: "Business" },
    ];

    const filtered = filterAssetsByFilters(assets, "All types", "business");

    expect(filtered).toHaveLength(2);
  });

  it("builds an export from the active analytics filters and visible assets", () => {
    const csv = buildAnalyticsReportCsv({
      period: "7 Days",
      type: "photo",
      category: "Business",
      metrics: { "Total Downloads": 4 },
      assets: [{ title: "Quarter, One", asset_type: "photo", category: "Business", downloads: 4 }],
    });

    expect(csv).toContain('"Period","7 Days"');
    expect(csv).toContain('"Asset type","photo"');
    expect(csv).toContain('"Quarter, One"');
  });

  it("sorts visible assets using API metric field names", () => {
    const assets = [
      { title: "Older", view_count: 20, download_count: 1, earning_amount: 2, created_at: "2026-09-01T00:00:00Z" },
      { title: "Newer", view_count: 5, download_count: 8, earning_amount: 10, created_at: "2026-09-10T00:00:00Z" },
    ];

    expect(sortAnalyticsAssets(assets, "downloads")[0].title).toBe("Newer");
    expect(sortAnalyticsAssets(assets, "views")[0].title).toBe("Older");
    expect(sortAnalyticsAssets(assets, "earnings")[0].title).toBe("Newer");
    expect(sortAnalyticsAssets(assets, "newest")[0].title).toBe("Newer");
  });

  it("adds one point for upload days and removes one point for skipped days", () => {
    const assets = [
      { created_at: "2026-09-07T10:00:00" },
      { created_at: "2026-09-08T10:00:00" },
      { created_at: "2026-09-10T10:00:00" },
    ];

    expect(calculateLoyaltyPoints(assets, new Date("2026-09-10T18:00:00"))).toBe(2);
    expect(calculateLoyaltyPoints([{ created_at: "2026-09-10T10:00:00" }], new Date("2026-09-13T18:00:00"))).toBe(0);
  });

  it("uses India time when assigning uploads to calendar days", () => {
    const assets = [{ created_at: "2026-09-11T18:30:00Z" }];

    expect(calculateLoyaltyPoints(assets, new Date("2026-09-11T20:00:00Z"))).toBe(1);
  });

});
