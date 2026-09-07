export const getFeaturedImages = (images) => {

  return [...images]
    .sort(
      (a, b) =>
        (b.likes || 0) -
        (a.likes || 0)
    )
    .slice(0, 4);

};

export const getTrendingImages = (images) => {

  return [...images]
    .sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
    .slice(0, 5);

};

export const getTopImage = (images) => {

  return [...images]
    .sort(
      (a, b) =>
        (
          (b.likes || 0) +
          (b.views || 0) +
          (b.downloads || 0)
        )
        -
        (
          (a.likes || 0) +
          (a.views || 0) +
          (a.downloads || 0)
        )
    )[0];

};