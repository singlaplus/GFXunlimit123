import { useEffect, useState } from "react";
import {
  getContributorRank,
  getContributorLevel,
  getAverageDownloads,
  getLikeRate,
  getViewDownloadRate,
  getContributorReputationTier,
  getCalculatedReputationScore,
} from "../utils/statsUtils";

export default function useContributorStats(dashboardStats) {
  const safeStats = dashboardStats || {};
  const uploads = Number(safeStats.uploads) || 0;
  const likes = Number(safeStats.likes) || 0;
  const downloads = Number(safeStats.downloads) || 0;
  const monthsOld = Number(safeStats.monthsOld) || 1;

  const {
    contributorRank,
    nextRank,
    maxUploads,
  } = getContributorRank(uploads);

  const agreedFormulaScore = (() => {
    const totalContribution = uploads + downloads;
    const viewCount = Number(safeStats.views) || 0;
    if (viewCount <= 0) return 0;
    return Number((totalContribution / Math.max(1, viewCount)).toFixed(2));
  })();

  const rawScore = agreedFormulaScore;
  const reputationScore = agreedFormulaScore;

  const contributorLevel =
    getContributorLevel(
      Math.round((uploads + likes + downloads) / Math.max(1, reputationScore))
    );

  const avgDownloadsPerImage =
    getAverageDownloads(safeStats);

  const likeRate =
    getLikeRate(safeStats);

  const viewDownloadRate =
    getViewDownloadRate(safeStats);

  const [reputationTier, setReputationTier] = useState(() => getContributorReputationTier(reputationScore));

  useEffect(() => {
    setReputationTier(getContributorReputationTier(reputationScore));
  }, [reputationScore]);

  return {
    contributorRank,
    nextRank,
    maxUploads,
    contributorLevel,
    avgDownloadsPerImage,
    likeRate,
    viewDownloadRate,
    reputationScore,
    reputationTier,
    rawScore,
    monthsOld,
  };

}