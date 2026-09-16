import { useNavigate } from "react-router-dom";
import { useState } from "react";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

function ImageGrid(props) {
  const { filteredImages, darkMode } = props;
  const navigate = useNavigate();

  const slugify = (text) =>
    String(text || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const getAssetUrl = (image) => {
    const slug = slugify(image.title || "asset");
    return `/asset/${slug}-${image.id}`;
  };

  const hasReadyThumbnail = (image) => {
    if (!image || !image.thumbnail_url) return false;
    const status = String(image.thumbnail_status ?? '').trim().toLowerCase();
    const blockedStatuses = new Set(['pending', 'processing', 'retrying', 'failed', 'error']);
    return !blockedStatuses.has(status);
  };

  // Determine which image source to use (thumbnail or original)
  const getImageSource = (image) => {
    // If a saved thumbnail is available and not still pending, use it with 50% quality
    if (hasReadyThumbnail(image)) {
      return `${API_BASE_URL}${image.thumbnail_url}&quality=50`;
    }
    // Otherwise, use the regular image endpoint
    return `${API_BASE_URL}/api/images/${image.id}?quality=50`;
  };

  // Get status badge if thumbnail is still processing
  const getThumbnailStatusBadge = (image) => {
    if (!image || !image.thumbnail_status) return null;
    const status = String(image.thumbnail_status).trim();
    if (!status || status.toLowerCase() === 'completed') {
      return null;
    }
    return status;
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        gridAutoFlow: "row",
        justifyContent: "start",
        justifyItems: "stretch",
        gap: "20px",
        background: darkMode ? "#121212" : "transparent",
        padding: darkMode ? "12px 0" : "0",
        borderRadius: darkMode ? "16px" : "0",
        alignItems: "stretch",
      }}
    >
      {filteredImages.map((image) => {
        const statusBadge = getThumbnailStatusBadge(image);
        const imageSrc = getImageSource(image);

        return (
          <div
            key={`featured-${image.id}-${image.filename}`}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-5px)";
              e.currentTarget.style.boxShadow = "0 12px 25px rgba(0,0,0,0.18)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 6px 18px rgba(0,0,0,0.1)";
            }}
            onClick={() => navigate(getAssetUrl(image))}
            style={{
              borderRadius: "18px",
              overflow: "hidden",
              background: darkMode ? "#1e1e1e" : "white",
              boxShadow: darkMode ? "0 6px 18px rgba(0,0,0,0.35)" : "0 6px 18px rgba(0,0,0,0.1)",
              transition: "0.3s",
              border: darkMode ? "1px solid #2f2f2f" : "1px solid transparent",
              cursor: "pointer",
              position: "relative",
            }}
          >
            <img
              src={imageSrc}
              alt={image.title}
              width="100%"
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
              }}
              style={{
                width: "100%",
                aspectRatio: "16 / 9",
                objectFit: "cover",
                transition: "0.4s",
                display: "block",
              }}
            />

            {/* Thumbnail status badge */}
            {statusBadge && (
              <div
                style={{
                  position: "absolute",
                  top: "10px",
                  right: "10px",
                  backgroundColor: 
                    statusBadge === 'PROCESSING' ? "rgba(255, 193, 7, 0.9)" :
                    statusBadge === 'FAILED' ? "rgba(244, 67, 54, 0.9)" :
                    statusBadge === 'RETRYING' ? "rgba(255, 152, 0, 0.9)" :
                    "rgba(100, 100, 100, 0.9)",
                  color: "white",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  fontSize: "12px",
                  fontWeight: "bold",
                  zIndex: 10,
                }}
              >
                {statusBadge === 'PROCESSING' && '🔄 Generating...'}
                {statusBadge === 'FAILED' && '❌ Failed'}
                {statusBadge === 'RETRYING' && '⚠️ Retrying'}
                {!['PROCESSING', 'FAILED', 'RETRYING'].includes(statusBadge) && statusBadge}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ImageGrid;
