import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import "./BrowseCollections.css";

const normalizeCollectionValue = (value) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (["photos", "photo", "images", "image", "photography", "photographies"].some((alias) => normalized.includes(alias))) {
    return "photos";
  }

  if (["vector", "vectors", "illustration", "illustrations", "illustrative"].some((alias) => normalized.includes(alias))) {
    return "vectors";
  }

  if (["psd", "psds"].some((alias) => normalized.includes(alias))) {
    return "psd";
  }

  if (["video", "videos", "animation", "animations", "motion", "film", "movie"].some((alias) => normalized.includes(alias))) {
    return "videos";
  }

  if (["template", "templates"].some((alias) => normalized.includes(alias))) {
    return "templates";
  }

  if (["abstract"].some((alias) => normalized.includes(alias))) {
    return "abstract";
  }

  if (["logo", "brand", "branding", "identity"].some((alias) => normalized.includes(alias))) {
    return "branding";
  }

  if (["nature", "landscape", "outdoor", "garden", "plants"].some((alias) => normalized.includes(alias))) {
    return "nature";
  }

  return normalized;
};

const getIconForCollection = (title) => {
  const normalized = normalizeCollectionValue(title);

  if (normalized === "photos") {
    return "📷";
  }

  if (normalized === "vectors") {
    return "🎨";
  }

  if (normalized === "psd") {
    return "🖌️";
  }

  if (normalized === "videos") {
    return "🎥";
  }

  if (normalized === "templates") {
    return "🧩";
  }

  if (normalized === "abstract") {
    return "🌀";
  }

  if (normalized === "branding") {
    return "🔷";
  }

  if (normalized === "nature") {
    return "🌿";
  }

  return "📁";
};

function BrowseCollections() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);

  useEffect(() => {
    const loadCollections = async () => {
      try {
        const res = await axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/collections`);
        const nextCollections = Array.isArray(res.data) ? res.data.map((item) => {
          const title = item.name || item;
          return title ? {
            icon: getIconForCollection(title),
            title,
            slug: title.toLowerCase().replace(/\s+/g, "-"),
            count: Number(item.live_asset_count ?? item.asset_count ?? 0),
          } : null;
        }).filter(Boolean) : [];
        const nextCollectionCards = nextCollections.length > 0
          ? nextCollections
          : [
              { icon: "📷", title: "Photos", slug: "photos", count: 0 },
              { icon: "🎨", title: "Vectors", slug: "vectors", count: 0 },
              { icon: "🖌️", title: "PSD", slug: "psds", count: 0 },
              { icon: "🎥", title: "Videos", slug: "videos", count: 0 },
              { icon: "🧩", title: "Templates", slug: "templates", count: 0 },
            ];
        setCollections(nextCollectionCards);
      } catch (err) {
        console.error("Failed to load collections list", err);
      }
    };

    loadCollections();

    const handleAssetUpdate = () => {
      window.setTimeout(() => {
        loadCollections();
      }, 250);
    };

    window.addEventListener("asset-updated", handleAssetUpdate);
    window.addEventListener("asset-refresh", handleAssetUpdate);
    window.addEventListener("asset-updated-detail", handleAssetUpdate);
    window.addEventListener("home-assets-refresh", handleAssetUpdate);

    return () => {
      window.removeEventListener("asset-updated", handleAssetUpdate);
      window.removeEventListener("asset-refresh", handleAssetUpdate);
      window.removeEventListener("asset-updated-detail", handleAssetUpdate);
      window.removeEventListener("home-assets-refresh", handleAssetUpdate);
    };
  }, []);

  return (
    <section className="browse-collections">
      <h2>Browse Collections</h2>

      <p>
        Discover live approved assets for every project.
      </p>

      <div className="category-grid">
        {collections.map((collection) => {
          const count = collection.count;

          return (
            <div
              key={collection.title}
              className="category-card"
              onClick={() => navigate(`/${collection.slug}`)}
              style={{ cursor: "pointer" }}
            >
              <div className="category-icon">{collection.icon}</div>
              <h3>{collection.title}</h3>
              <span>{count} Assets</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default BrowseCollections;