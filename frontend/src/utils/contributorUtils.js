import { getBadge } from "./badgeUtils";

export const getContributorStats = (
  images,
  viewContributorPage
) => {

  const contributorPageImages =
    images.filter(
      (img) =>
        img.username === viewContributorPage
    );

  const contributorPageLikes =
    contributorPageImages.reduce(
      (sum, img) => sum + (img.likes || 0),
      0
    );

  const contributorPageViews =
    contributorPageImages.reduce(
      (sum, img) => sum + (img.views || 0),
      0
    );

  const contributorPageDownloads =
    contributorPageImages.reduce(
      (sum, img) => sum + (img.downloads || 0),
      0
    );

  const estimatedEarnings = (
    contributorPageDownloads * 0.05
  ).toFixed(2);

  const contributorEarnings = (
    contributorPageDownloads * 0.5
  ).toFixed(2);

  const monthlyEarnings = (
    contributorPageDownloads * 0.15
  ).toFixed(2);

  const topContributorImages = [...contributorPageImages]
    .sort(
      (a, b) =>
        (b.downloads || 0) -
        (a.downloads || 0)
    )
    .slice(0, 3);

  const topEarningImage = [...contributorPageImages]
    .sort(
      (a, b) =>
        (b.downloads || 0) -
        (a.downloads || 0)
    )[0];

  const contributorBadge =
    getBadge({
      uploads: contributorPageImages.length,
      likes: contributorPageLikes,
      views: contributorPageViews,
      downloads: contributorPageDownloads,
    });

  let nextLevel = "";
  let progress = 0;
  let targetDownloads = 0;

  if (contributorPageDownloads < 10) {
    nextLevel = "🥈 Silver Contributor";
    targetDownloads = 10;
  } else if (contributorPageDownloads < 50) {
    nextLevel = "🥇 Gold Contributor";
    targetDownloads = 50;
  } else if (contributorPageDownloads < 100) {
    nextLevel = "💎 Platinum Contributor";
    targetDownloads = 100;
  } else if (contributorPageDownloads < 500) {
    nextLevel = "👑 Elite Contributor";
    targetDownloads = 500;
  } else {
    nextLevel = "MAX LEVEL";
    targetDownloads = contributorPageDownloads;
  }

  progress = Math.min(
    (contributorPageDownloads /
      targetDownloads) *
      100,
    100
  );

  const contributorLeaderboard =
    Object.values(
      images.reduce((acc, image) => {

        const username =
          image.username || "Unknown";

        if (!acc[username]) {

          acc[username] = {
            username,
            uploads: 0,
            likes: 0,
            views: 0,
            downloads: 0,
          };

        }

        acc[username].uploads++;

        acc[username].likes +=
          image.likes || 0;

        acc[username].views +=
          image.views || 0;

        acc[username].downloads +=
          image.downloads || 0;

        return acc;

      }, {})
    )
      .sort(
        (a, b) =>
          (
            b.likes +
            b.views +
            b.downloads
          ) -
          (
            a.likes +
            a.views +
            a.downloads
          )
      )
      .slice(0, 10);

  return {
    contributorPageImages,
    contributorPageLikes,
    contributorPageViews,
    contributorPageDownloads,
    estimatedEarnings,
    contributorEarnings,
    monthlyEarnings,
    topContributorImages,
    topEarningImage,
    contributorBadge,
    nextLevel,
    progress,
    targetDownloads,
    contributorLeaderboard,
  };
};