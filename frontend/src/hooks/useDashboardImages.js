import { useMemo } from "react";
import {
  getFeaturedImages,
  getTrendingImages,
  getTopImage,
} from "../utils/dashboardUtils";

export default function useDashboardImages(images) {
  const featuredImages = useMemo(() => getFeaturedImages(images), [images]);
  const trendingImages = useMemo(() => getTrendingImages(images), [images]);
  const topImage = useMemo(() => getTopImage(images), [images]);

  const topFiveImages = useMemo(() => {
    return [...images]
      .sort(
        (a, b) =>
          ((b.likes || 0) +
            (b.views || 0) +
            (b.downloads || 0)) -
          ((a.likes || 0) +
            (a.views || 0) +
            (a.downloads || 0))
      )
      .slice(0, 5);
  }, [images]);

  return {
    featuredImages,
    trendingImages,
    topImage,
    topFiveImages,
  };
}