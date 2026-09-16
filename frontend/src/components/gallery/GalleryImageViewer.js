import { getAssetPreviewUrl } from "../../utils/assetPreview";

function GalleryImageViewer({
  selectedImage,
  setSelectedImage,
  darkMode,
  relatedImages = [],
  fetchSingleImage,
  goToPreviousImage,
  goToNextImage,
  likeImage,
  addFavorite,
  downloadImage,
  shareImage,
}) {
  if (!selectedImage) return null;

  return (
    <div
      onClick={() => setSelectedImage(null)}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "rgba(0,0,0,0.9)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
        padding: "20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: darkMode ? "#1e1e1e" : "white",
          color: darkMode ? "white" : "black",
          padding: "25px",
          borderRadius: "20px",
          maxWidth: "1000px",
          width: "100%",
          maxHeight: "95vh",
          overflowY: "auto",
        }}
      >
        <img
          src={getAssetPreviewUrl(selectedImage, { quality: 80, watermark: false })}
          alt={selectedImage.title}
          width="100%"
          style={{
            borderRadius: "15px",
            maxHeight: "650px",
            objectFit: "contain",
          }}
        />

        <h2 style={{ marginTop: 20 }}>
          {selectedImage.title}
        </h2>

        <p>📂 {selectedImage.category}</p>
        <p>🏷 {selectedImage.keywords}</p>
        <p>❤️ {selectedImage.likes || 0}</p>
        <p>👁 {selectedImage.views || 0}</p>
        <p>⬇ {selectedImage.downloads || 0}</p>

        <p>
          📅{" "}
          {new Date(
            selectedImage.created_at
          ).toLocaleDateString()}
        </p>

        <h3 style={{ marginTop: 20 }}>
          🔗 Related Images
        </h3>

        <div
          style={{
            display: "flex",
            gap: "10px",
            overflowX: "auto",
          }}
        >
          {relatedImages.map((image) => (
            <img
              key={`${image.id}-${image.filename}`}
              src={getAssetPreviewUrl(image, { quality: 50, watermark: false })}
              alt={image.title}
              onClick={() => fetchSingleImage(image.id)}
              style={{
                width: "120px",
                height: "80px",
                objectFit: "cover",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
            marginTop: "20px",
          }}
        >
          <button onClick={goToPreviousImage}>
            ⬅ Previous
          </button>

          <button onClick={goToNextImage}>
            Next ➡
          </button>

          <button
            onClick={() => likeImage(selectedImage.id)}
            style={{
              background: "hotpink",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "10px 15px",
            }}
          >
            ❤️ Like
          </button>

          <button
            onClick={() => addFavorite(selectedImage.id)}
            style={{
              background: "#ff5722",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "10px 15px",
            }}
          >
            ⭐ Favorite
          </button>

          <button
            onClick={() => downloadImage(selectedImage)}
            style={{
              background: "#2196f3",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "10px 15px",
            }}
          >
            ⬇ Download
          </button>

          <button
            onClick={() => shareImage(selectedImage)}
            style={{
              background: "#9c27b0",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "10px 15px",
            }}
          >
            📤 Share
          </button>

          <button
            onClick={() => setSelectedImage(null)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default GalleryImageViewer;