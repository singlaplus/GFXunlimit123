import { useNavigate } from "react-router-dom";
import "./TrendingAssets.css";

function TrendingImages({
  trendingImages,
  darkMode,
}) {
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
    <>
      <h2
        style={{
          marginTop: "30px",
          marginBottom: "15px",
        }}
      >
        🔥 Trending Images
      </h2>

      <div className="trending-grid">
        {(trendingImages || []).map((image) => (
          <div
            key={`trending-${image.id}-${image.filename}`}
            onClick={() => navigate(getAssetUrl(image))}
            className="trending-card"
            style={{ background: darkMode ? "#1e1e1e" : "white" }}
          >
            <img
              src={`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/api/images/${image.id}`}
              alt={image.title}
            />

            <div className="meta">
              <strong>{image.title}</strong>

              <p>
                ⬇ {image.downloads || 0}
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default TrendingImages;