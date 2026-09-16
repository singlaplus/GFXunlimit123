function EmptyMessage({ loading, filteredImages, darkMode }) {

  if (loading || filteredImages.length > 0)
    return null;

  return (
    <h2 style={{ color: darkMode ? "#f5f5f5" : "#111" }}>
      No images found.
    </h2>
  );

}

export default EmptyMessage;