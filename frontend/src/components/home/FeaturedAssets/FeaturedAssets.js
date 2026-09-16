import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

function FeaturedImages({
  featuredImages,
  darkMode,
  onFeaturedImageIdsLoaded,
}) {
  const [liveFeaturedImages, setLiveFeaturedImages] = useState([]);
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

  useEffect(() => {
    const loadFeaturedImages = async () => {
      try {
        const res = await axios.get(
          `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/images`
        );
        const assets = Array.isArray(res.data?.images) ? res.data.images : [];
        const sortedAssets = [...assets]
          .sort((a, b) => (b.likes || 0) - (a.likes || 0))
          .slice(0, 4);
        setLiveFeaturedImages(sortedAssets);
        onFeaturedImageIdsLoaded?.(
          sortedAssets.map((image) => String(image.id))
        );
      } catch (err) {
        console.error("Failed to load featured images", err);
      }
    };

    loadFeaturedImages();

    const handleRefresh = () => {
      window.setTimeout(() => {
        loadFeaturedImages();
      }, 250);
    };

    window.addEventListener("asset-updated", handleRefresh);
    window.addEventListener("asset-refresh", handleRefresh);
    window.addEventListener("home-assets-refresh", handleRefresh);

    return () => {
      window.removeEventListener("asset-updated", handleRefresh);
      window.removeEventListener("asset-refresh", handleRefresh);
      window.removeEventListener("home-assets-refresh", handleRefresh);
    };
  }, [onFeaturedImageIdsLoaded]);

  useEffect(() => {
    if (liveFeaturedImages.length === 0 && Array.isArray(featuredImages)) {
      onFeaturedImageIdsLoaded?.(
        featuredImages.map((image) => String(image.id))
      );
    }
  }, [featuredImages, liveFeaturedImages.length, onFeaturedImageIdsLoaded]);

  return (
    <>
      <h2
        style={{
          marginBottom: "15px",
          marginTop: "30px",
          fontSize: "clamp(1.4rem, 2.2vw, 1.8rem)",
          padding: "0 8px",
        }}
      >
        ⭐ Featured Images
      </h2>

      <div
  style={{
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(220px,1fr))",
    gap: "15px",
    marginBottom: "30px",
    padding: "0 8px",
  }}
>
  {(liveFeaturedImages.length > 0 ? liveFeaturedImages : featuredImages || []).map((image) => (
    <div
      key={`featured-${image.id}-${image.filename}`}
      onClick={() => navigate(getAssetUrl(image))}
      style={{
        cursor: "pointer",
        borderRadius: "15px",
        overflow: "hidden",
        background: darkMode
          ? "#1e1e1e"
          : "white",
        boxShadow:
          "0 4px 12px rgba(0,0,0,0.15)",
      }}
    >
      <img
        src={`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/api/images/${image.id}`}
        alt={image.title}
        style={{
          width: "100%",
          height: "180px",
          objectFit: "cover",
        }}
      />

      <div
        style={{
          padding: "10px",
        }}
      >
        <strong>{image.title}</strong>

        <p>⬇ {image.downloads || 0}</p>
      </div>
    </div>
  ))}
</div>
    </>
  );
}

export default FeaturedImages;