import { useEffect } from "react";

export default function useKeyboardNavigation({
  selectedImage,
  setSelectedImage,
  goToNextImage,
  goToPreviousImage,
  filteredImages,
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setSelectedImage(null);
      }

      if (e.key === "ArrowRight" && selectedImage) {
        goToNextImage();
      }

      if (e.key === "ArrowLeft" && selectedImage) {
        goToPreviousImage();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImage, filteredImages]);
}