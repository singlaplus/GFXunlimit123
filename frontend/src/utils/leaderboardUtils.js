export const getContributorPopupStats = (
  images,
  selectedContributor
) => {

  const contributorImages =
    images.filter(
      (img) =>
        img.username === selectedContributor
    );

  const contributorLikes =
    contributorImages.reduce(
      (sum, img) =>
        sum + (img.likes || 0),
      0
    );

  const contributorViews =
    contributorImages.reduce(
      (sum, img) =>
        sum + (img.views || 0),
      0
    );

  const contributorDownloads =
    contributorImages.reduce(
      (sum, img) =>
        sum + (img.downloads || 0),
      0
    );

  const contributorBestImage =
    [...contributorImages].sort(
      (a, b) =>
        ((b.likes || 0) +
          (b.views || 0) +
          (b.downloads || 0))
        -
        ((a.likes || 0) +
          (a.views || 0) +
          (a.downloads || 0))
    )[0];

  return {
    contributorImages,
    contributorLikes,
    contributorViews,
    contributorDownloads,
    contributorBestImage,
  };

};

export const getSiteStats = (images) => {

  const averageLikes =
    images.length > 0
      ? Math.round(
          images.reduce(
            (sum, img) =>
              sum + (img.likes || 0),
            0
          ) / images.length
        )
      : 0;

  const totalUserViews =
    images.reduce(
      (sum, img) =>
        sum + (img.views || 0),
      0
    );

  const totalUserDownloads =
    images.reduce(
      (sum, img) =>
        sum + (img.downloads || 0),
      0
    );

  const totalSiteLikes =
    images.reduce(
      (sum, img) =>
        sum + (img.likes || 0),
      0
    );

  const totalSiteViews =
    images.reduce(
      (sum, img) =>
        sum + (img.views || 0),
      0
    );

  const totalSiteDownloads =
    images.reduce(
      (sum, img) =>
        sum + (img.downloads || 0),
      0
    );

  const totalSiteImages =
    images.length;

  return {

    averageLikes,

    totalUserViews,

    totalUserDownloads,

    totalSiteLikes,

    totalSiteViews,

    totalSiteDownloads,

    totalSiteImages,

  };

};