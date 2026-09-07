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