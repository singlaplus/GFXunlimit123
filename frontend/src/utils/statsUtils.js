export const getContributorReputationTier = (reputationScore) => {
  const score = Number(reputationScore) || 0;

  if (score < 220) {
    return "🟢 New Contributor";
  }

  if (score < 450) {
    return "🔵 Trusted Contributor";
  }

  if (score < 700) {
    return "🟣 Verified Contributor";
  }

  if (score < 1000) {
    return "🟠 Premium Contributor";
  }

  return "🔴 Elite Contributor";
};

export const getContributorRank = (uploads) => {

  let contributorRank = "🥉 Bronze";
  let nextRank = "🥈 Silver";
  let maxUploads = 500;

  if (uploads >= 500) {
    contributorRank = "🥈 Silver";
    nextRank = "🥇 Gold";
    maxUploads = 1500;
  }

  if (uploads >= 1500) {
    contributorRank = "🥇 Gold";
    nextRank = "👑 Platinum";
    maxUploads = 5000;
  }

  if (uploads >= 5000) {
    contributorRank = "👑 Platinum";
    nextRank = "🏆 Max Rank";
    maxUploads = 25000;
  }

  return {
    contributorRank,
    nextRank,
    maxUploads,
  };

};

export const getContributorLevel = (xp) => {

  return Math.floor(xp / 50) + 1;

};

export const getAverageDownloads = (stats) => {

  if (stats.uploads === 0)
    return 0;

  return (
    stats.downloads /
    stats.uploads
  ).toFixed(2);

};

export const getLikeRate = (stats) => {

  if (stats.views === 0)
    return 0;

  return (
    (
      stats.likes /
      stats.views
    ) * 100
  ).toFixed(1);

};

export const getViewDownloadRate = (stats) => {

  if (stats.views === 0)
    return 0;

  return (
    (
      stats.downloads /
      stats.views
    ) * 100
  ).toFixed(1);

};

export const getCalculatedReputationScore = (stats) => {
  const uploadsCount = Number(stats?.uploads || 0);
  const downloadsCount = Number(stats?.downloads || 0);
  const likesCount = Number(stats?.likes || 0);
  const viewsCount = Number(stats?.views || 0);
  const months = Math.max(1, Number(stats?.monthsOld || 1));

  const qualityMultiplier =
    downloadsCount > 0 ? Math.max(0.1, 1 + viewsCount / downloadsCount) : 0.1;

  const engagementScore =
    uploadsCount > 0
      ? (viewsCount + downloadsCount + likesCount) / uploadsCount
      : 0;

  const maturityFactor = Math.max(1, 1 + uploadsCount / Math.max(1, months));
  const consistencyFactor = months >= 6 ? 1.05 : 1;
  const rawScore = Math.round(
    engagementScore * qualityMultiplier * maturityFactor * consistencyFactor
  );

  return Math.round(engagementScore + qualityMultiplier + rawScore + maturityFactor);
};