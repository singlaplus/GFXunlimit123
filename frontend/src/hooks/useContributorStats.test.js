import { renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import useContributorStats from "./useContributorStats";

jest.mock("axios");

describe("useContributorStats score-based tiers", () => {
  beforeEach(() => {
    localStorage.clear();
    axios.get.mockReset();
  });

  it("ignores stale server reputation values and computes the agreed formula client-side", () => {
    const { result } = renderHook(() =>
      useContributorStats({
        uploads: 0,
        likes: 0,
        downloads: 0,
        views: 0,
        reputationScore: 500,
        rawScore: 0,
        monthsOld: 1
      })
    );

    expect(result.current.reputationScore).toBe(0);
    expect(result.current.rawScore).toBe(0);
    expect(result.current.reputationTier).toBe("🟢 New Contributor");
  });

  it("uses the agreed upload + downloads divided by views formula for the dashboard score", () => {
    const { result } = renderHook(() =>
      useContributorStats({
        uploads: 3,
        likes: 1,
        downloads: 1,
        views: 4,
        reputationScore: 60,
        rawScore: 60,
        monthsOld: 1
      })
    );

    expect(result.current.reputationScore).toBe(1);
    expect(result.current.rawScore).toBe(1);
    expect(result.current.reputationTier).toBe("🟢 New Contributor");
  });

  it("falls back to neutral defaults when stats are missing", () => {
    const { result } = renderHook(() => useContributorStats(null));

    expect(result.current.contributorRank).toBe("🥉 Bronze");
    expect(result.current.reputationTier).toBe("🟢 New Contributor");
    expect(result.current.contributorLevel).toBe(1);
  });

  it("derives contributor level from the current stats", () => {
    const { result } = renderHook(() =>
      useContributorStats({
        uploads: 100,
        likes: 40,
        downloads: 20,
        views: 10,
        reputationScore: 80,
        rawScore: 0,
        monthsOld: 1
      })
    );

    expect(result.current.contributorLevel).toBe(1);
  });

  it("keeps contributor-level metadata stable", async () => {
    axios.get.mockResolvedValue({
      data: {
        levels: [
          { id: 1, label: "Starter", value: 50, description: "Starter" },
          { id: 2, label: "Growing", value: 120, description: "Growing" }
        ]
      }
    });

    const { result } = renderHook(() =>
      useContributorStats({
        uploads: 1,
        likes: 30,
        downloads: 10,
        views: 0,
        reputationScore: 1,
        rawScore: 0,
        monthsOld: 1
      })
    );

    await waitFor(() => {
      expect(result.current.contributorLevel).toBe(1);
    });
  });

  it("uses the default starter XP threshold values when no server override is available", async () => {
    axios.get.mockResolvedValue({
      data: {
        levels: [
          { id: 1, label: "Starter", value: 100, description: "First milestone" },
          { id: 2, label: "Growing", value: 300, description: "Steady progress" },
          { id: 3, label: "Advanced", value: 600, description: "High engagement" }
        ]
      }
    });

    const { result } = renderHook(() =>
      useContributorStats({
        uploads: 1,
        likes: 50,
        downloads: 42,
        views: 0,
        reputationScore: 1,
        rawScore: 0,
        monthsOld: 1
      })
    );

    await waitFor(() => {
      expect(result.current.contributorLevel).toBe(2);
    });
  });
});
