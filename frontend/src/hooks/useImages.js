import { useEffect } from "react";
import axios from "axios";
import { getImages } from "../services/imageService";

export default function useImages({
  currentPage,
  imagesPerPage,
  images,
  setImages,
  setLoading,
  setTotalImages,
  setTotalLikes,
  setTotalDownloads,
  setTotalViews,
  setTotalPages,
  selectedImage,
  setSelectedImage,
  setRelatedImages,
  selectedCategory,
  selectedCollection,
}) {

  const fetchImages = async () => {

    try {

      setLoading(true);

      const res = await getImages(
        currentPage,
        imagesPerPage,
        selectedCategory,
        selectedCollection
      );

      const data = res?.data || {};
      const imagesResult = Array.isArray(data.images) ? data.images : [];
      const totalImagesResult = Number(data.totalImages) || 0;
      const totalLikesResult = Number(data.totalLikes) || 0;
      const totalDownloadsResult = Number(data.totalDownloads) || 0;
      const totalViewsResult = Number(data.totalViews) || 0;

      setImages(imagesResult);
      setTotalImages(totalImagesResult);
      setTotalLikes(totalLikesResult);
      setTotalDownloads(totalDownloadsResult);
      setTotalViews(totalViewsResult);
      setTotalPages(
        imagesPerPage > 0
          ? Math.ceil(totalImagesResult / imagesPerPage)
          : 0
      );

    } catch (err) {

      console.error(err);

    } finally {

      setLoading(false);

    }

  };
  useEffect(() => {
    const handleAssetUpdate = () => {
      window.setTimeout(() => {
        fetchImages();
      }, 250);
    };

    window.addEventListener("asset-updated", handleAssetUpdate);
    window.addEventListener("asset-refresh", handleAssetUpdate);
    window.addEventListener("asset-updated-detail", handleAssetUpdate);
    window.addEventListener("home-assets-refresh", handleAssetUpdate);
    fetchImages();

    return () => {
      window.removeEventListener("asset-updated", handleAssetUpdate);
      window.removeEventListener("asset-refresh", handleAssetUpdate);
      window.removeEventListener("asset-updated-detail", handleAssetUpdate);
      window.removeEventListener("home-assets-refresh", handleAssetUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, imagesPerPage, selectedCategory, selectedCollection]);

  const fetchSingleImage = async (id) => {

    try {

      await axios.put(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/images/${id}/view`
      );

      const res = await axios.get(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/images/${id}`
      );

      setSelectedImage(res.data);

      const related = images
        .filter(
          (img) =>
            img.id !== res.data.id &&
            img.category === res.data.category
        )
        .slice(0, 4);

      setRelatedImages(related);

      setImages((prevImages) =>
        prevImages.map((img) =>
          Number(img.id) === Number(id)
            ? {
                ...img,
                views: res.data.views,
              }
            : img
        )
      );

    } catch (err) {

      console.error(err);

    }

  };

  return {
    fetchImages,
    fetchSingleImage,
  };

}