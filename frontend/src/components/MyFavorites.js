import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { getAssetPreviewUrl } from "../utils/assetPreview";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

function MyFavorites({ darkMode = false }) {
  const navigate = useNavigate();
  const { reportResource, retryKey, routeId } = useStartupReadiness();

  const [favorites, setFavorites] = useState([]);
  const [cartItems, setCartItems] = useState([]);
  const [hoveredFavoriteId, setHoveredFavoriteId] = useState(null);
  const [loadStatus, setLoadStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [localRetry, setLocalRetry] = useState(0);
  const favoritesRequestIdRef = useRef(0);
  const readinessAttemptRef = useRef({ routeId, retryKey, localRetry });
  readinessAttemptRef.current = { routeId, retryKey, localRetry };

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
    fetchFavorites();
    loadCart();
    const onFavoritesUpdate = () => fetchFavorites();
    const onCartUpdate = () => loadCart();
    window.addEventListener("favoritesUpdated", onFavoritesUpdate);
    window.addEventListener("cartUpdated", onCartUpdate);
    return () => {
      favoritesRequestIdRef.current += 1;
      window.removeEventListener("favoritesUpdated", onFavoritesUpdate);
      window.removeEventListener("cartUpdated", onCartUpdate);
    };
  }, [retryKey, routeId, localRetry]);

  const loadCart = () => {
    try {
      const stored = localStorage.getItem("customer-cart");
      const items = JSON.parse(stored || "[]");
      setCartItems(Array.isArray(items) ? items : []);
    } catch (err) {
      setCartItems([]);
    }
  };

  const saveCart = (items) => {
    localStorage.setItem("customer-cart", JSON.stringify(items));
    setCartItems(items);
    window.dispatchEvent(new Event("cartUpdated"));
  };

  const isInCart = (imageId) => {
    return cartItems.some((item) => Number(item.id) === Number(imageId));
  };

  const addToCart = (image) => {
    let existingCart = [];
    try {
      existingCart = JSON.parse(localStorage.getItem("customer-cart") || "[]");
    } catch (err) {
      existingCart = [];
    }

    const exists = Array.isArray(existingCart)
      ? existingCart.some((item) => Number(item.id) === Number(image.id))
      : false;

    if (exists) {
      loadCart();
      return;
    }

    const nextCart = [
      ...(Array.isArray(existingCart) ? existingCart : []),
      {
        id: image.id,
        title: image.title,
        filename: image.filename,
        collection: image.collection,
        category: image.category,
        price: image.price || null,
      },
    ];

    saveCart(nextCart);
  };

  const fetchFavorites = async () => {
    const requestId = favoritesRequestIdRef.current + 1;
    const requestAttempt = { routeId, retryKey, localRetry };
    favoritesRequestIdRef.current = requestId;
    setLoadStatus("loading");
    setLoadError("");
    reportResource("favorites", "loading", "", routeId);
    try {
      const token =
        localStorage.getItem("token");

      const res =
        await axios.get(
          `${API_BASE_URL}/favorites`,
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        );

      if (!Array.isArray(res.data) || res.data.some((image) =>
        !image || typeof image !== "object" || Array.isArray(image) || image.id == null
      )) {
        throw new Error("Favorites response was invalid.");
      }
      if (requestId !== favoritesRequestIdRef.current ||
          requestAttempt.routeId !== readinessAttemptRef.current.routeId ||
          requestAttempt.retryKey !== readinessAttemptRef.current.retryKey ||
          requestAttempt.localRetry !== readinessAttemptRef.current.localRetry) return;
      setFavorites(res.data);
      setLoadStatus("ready");
      reportResource("favorites", "ready", "", routeId);
    } catch (err) {
      if (requestId !== favoritesRequestIdRef.current ||
          requestAttempt.routeId !== readinessAttemptRef.current.routeId ||
          requestAttempt.retryKey !== readinessAttemptRef.current.retryKey ||
          requestAttempt.localRetry !== readinessAttemptRef.current.localRetry) return;
      console.error(err);
      const message = err?.response
        ? `Unable to load favorites (HTTP ${err.response.status}).`
        : err?.message || "Unable to load favorites.";
      setLoadError(message);
      setLoadStatus("error");
      reportResource("favorites", "error", message, routeId);
    }
  };
  const removeFavorite = async (imageId) => {

  try {

    const token =
      localStorage.getItem("token");

    await axios.delete(
      `${API_BASE_URL}/favorites/${imageId}`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`
        }
      }
    );

    setFavorites(
      favorites.filter(
        (img) => img.id !== imageId
      )
    );

  } catch (err) {

    console.error(err);

  }

};

  return (

    <div style={{ marginTop: "20px", color: darkMode ? "#f5f5f5" : "#111827" }}>

      <h2>⭐ My Favorites</h2>

      {loadStatus === "loading" ? (
        <p role="status">Loading favorites...</p>
      ) : loadError ? (
        <div role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => {
            favoritesRequestIdRef.current += 1;
            setLocalRetry((attempt) => attempt + 1);
          }}>Retry</button>
        </div>
      ) : (
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fill,minmax(200px,1fr))",
          gap: "12px"
        }}
      >

        {favorites.length === 0 ? (

          <p>No favorite images yet.</p>

        ) : (

          favorites.map((image, index) => (

            <div
              key={`favorite-${image.id}-${index}`}
              onClick={() => navigate(getAssetUrl(image))}
              onMouseEnter={(e) => {
                setHoveredFavoriteId(image.id);
                e.currentTarget.style.transform = "translateY(-3px)";
                e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.18)";
              }}
              onMouseLeave={(e) => {
                setHoveredFavoriteId(null);
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 1px 6px rgba(0,0,0,0.08)";
              }}
              style={{
                background: darkMode ? "#1e1e1e" : "#ffffff",
                border: darkMode ? "1px solid #3a3a3a" : "1px solid #e5e7eb",
                borderRadius: "10px",
                overflow: "hidden",
                boxShadow:
                  "0 1px 6px rgba(0,0,0,0.08)",
                cursor: "pointer",
                transition: "transform 0.2s ease, box-shadow 0.2s ease"
              }}
            >

              <img
                src={getAssetPreviewUrl(image, { quality: 50, watermark: false, thumbnailOnly: true })}
                alt={image.title}
                loading="lazy"
                decoding="async"
                style={{
                  width: "100%",
                  height: "150px",
                  objectFit: "cover"
                }}
              />

              <div
                style={{
                  padding: "10px",
                  color: darkMode ? "#f5f5f5" : "#111827"
                }}
              >

                <strong
                  style={{
                    display: "block",
                    fontSize: "0.96rem",
                    marginBottom: "6px",
                    color: hoveredFavoriteId === image.id ? "#f59e0b" : darkMode ? "#f5f5f5" : "#111827",
                    transition: "color 0.2s ease"
                  }}
                >
                  {image.title}
                </strong>

                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", marginBottom: "8px", fontSize: "0.86rem" }}>
                  <span style={{ color: darkMode ? "#cbd5e1" : "#475569" }}>❤️ {image.likes || 0}</span>
                  <span style={{ color: darkMode ? "#cbd5e1" : "#475569" }}>⬇ {image.downloads || 0}</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "8px" }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      addToCart(image);
                    }}
                    disabled={isInCart(image.id)}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      background: isInCart(image.id) ? "#9ca3af" : "#2563eb",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: isInCart(image.id) ? "not-allowed" : "pointer",
                      fontSize: "0.9rem"
                    }}
                  >
                    {isInCart(image.id) ? "Added" : "Add"}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFavorite(image.id);
                    }}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      background: "#f44336",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "0.9rem"
                    }}
                  >
                    ❌ Remove
                  </button>
                </div>

              </div>

            </div>

          ))

        )}

      </div>
      )}

    </div>

  );

}

export default MyFavorites;