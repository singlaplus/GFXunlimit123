import {
  likeImageRequest,
  addFavoriteRequest,
  downloadImageRequest,
} from "../services/imageService";
import { getAssetOriginalDownloadUrl } from "../utils/assetPreview";
import { readLastActivityAt } from "../utils/inactivitySession";

export default function useImageActions({
  images,
  setImages,
  selectedImage,
  setSelectedImage,
  notifySuccess,
  notifyError,
}) {

  const likeImage = async (id) => {
     
  try {
    const res = await likeImageRequest(id);

    const updatedImage = res.data;

    setImages((prevImages) =>
      prevImages.map((img) =>
        Number(img.id) === Number(updatedImage.id)
          ? {
              ...img,
              likes: updatedImage.likes,
            }
          : img
      )
    );

    if (
      selectedImage &&
      Number(selectedImage.id) === Number(updatedImage.id)
    ) {
      setSelectedImage((prev) => ({
        ...prev,
        likes: updatedImage.likes,
      }));
    }

    

notifySuccess(
  `❤️ ${updatedImage.title} received a new like`
);



  } catch (err) {
    console.error(err);

    notifyError("Failed to like image");
  }
};
const addFavorite = async (imageId) => {

  

  try {

    const token =
      localStorage.getItem("token");
      

    await addFavoriteRequest(
      imageId,
      token
    );

    window.dispatchEvent(new Event("favoritesUpdated"));


    notifySuccess(
      "⭐ Image added to Favorites"
    );

  } catch (err) {
  console.error("Favorite Error:", err);

  

  notifyError("Failed to add favorite");
}

};
const downloadImage = async (image) => {
  try {
    const token = localStorage.getItem("token");

    const res = await downloadImageRequest(image.id, token);
    const updatedImage = res.data;

    setImages((prevImages) =>
      prevImages.map((img) =>
        Number(img.id) === Number(updatedImage.id)
          ? updatedImage
          : img
      )
    );

    if (selectedImage && Number(selectedImage.id) === Number(updatedImage.id)) {
      setSelectedImage(updatedImage);
    }

    notifySuccess(`⬇ Downloaded "${updatedImage.title}"`);

    const response = await fetch(getAssetOriginalDownloadUrl(image.id), {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Session-Activity": String(readLastActivityAt()),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Download failed");
    }

    const blob = await response.blob();
    window.dispatchEvent(new Event("notifications-updated"));
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const disposition = response.headers.get("content-disposition") || "";
    const filenameFromHeader = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)?.[1] || disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)?.[2];
    const downloadName = filenameFromHeader || `${image.title || "asset"}`;

    link.href = objectUrl;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error(err);
    notifyError("Failed to download image");
  }
};
const shareImage = async (image) => {

  try {

    

    const imageUrl =
      `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/api/images/${image.id}`;

    await navigator.clipboard.writeText(imageUrl);

    notifySuccess(
      "📤 Image link copied"
    );

  } catch (err) {

    console.error(err);

    notifyError(
      "Failed to share image"
    );

  }

};

  return {
  likeImage,
  addFavorite,
  downloadImage,
  shareImage,
};

}
