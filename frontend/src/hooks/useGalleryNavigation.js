export default function useGalleryNavigation({
  filteredImages,
  selectedImage,
  fetchSingleImage,
}) {
  const goToNextImage = () => {
    if (!selectedImage) return;

    const currentIndex = filteredImages.findIndex(
      (img) => img.id === selectedImage.id
    );

    const nextIndex =
      (currentIndex + 1) % filteredImages.length;

    fetchSingleImage(
      filteredImages[nextIndex].id
    );
  };

  const goToPreviousImage = () => {
    if (!selectedImage) return;

    const currentIndex = filteredImages.findIndex(
      (img) => img.id === selectedImage.id
    );

    const previousIndex =
      (currentIndex - 1 + filteredImages.length) %
      filteredImages.length;

    fetchSingleImage(
      filteredImages[previousIndex].id
    );
  };

  return {
    goToNextImage,
    goToPreviousImage,
  };
}