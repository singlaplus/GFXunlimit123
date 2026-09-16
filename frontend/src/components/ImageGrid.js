import { useNavigate } from "react-router-dom";
import { getAssetPreviewUrl } from "../utils/assetPreview";

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
      {filteredImages.map((image) => (
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
          }}
        >
          <img
            src={getAssetPreviewUrl(image, { quality: 50, watermark: false })}
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
        </div>
      ))}
    </div>
  );
}

export default ImageGrid;