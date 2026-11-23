import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { getAssetPreviewUrl } from "../utils/assetPreview";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";
import { loadCartItems, saveCartItems } from "../utils/cartPersistence";
import "./MyFavorites.css";

function MyFavorites({ darkMode = false }) {
  const navigate = useNavigate();
  const { reportResource, retryKey, routeId } = useStartupReadiness();

  const [favorites, setFavorites] = useState([]);
  const [cartItems, setCartItems] = useState([]);
  const [hoveredFavoriteId, setHoveredFavoriteId] = useState(null);
  const [loadStatus, setLoadStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [cartError, setCartError] = useState("");
  const [localRetry, setLocalRetry] = useState(0);
  const favoritesRequestIdRef = useRef(0);
  const cartLoadRequestIdRef = useRef(0);
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
    loadCartFromStorage();
    loadCartFromServer();
    const onFavoritesUpdate = () => fetchFavorites();
    const onCartUpdate = () => loadCartFromStorage();
    const onCartSync = () => loadCartFromStorage();
    window.addEventListener("favoritesUpdated", onFavoritesUpdate);
    window.addEventListener("cartUpdated", onCartUpdate);
    window.addEventListener("cartSynced", onCartSync);
    return () => {
      favoritesRequestIdRef.current += 1;
      cartLoadRequestIdRef.current += 1;
      window.removeEventListener("favoritesUpdated", onFavoritesUpdate);
      window.removeEventListener("cartUpdated", onCartUpdate);
      window.removeEventListener("cartSynced", onCartSync);
    };
  }, [retryKey, routeId, localRetry]);

  const loadCartFromStorage = () => {
    try {
      const stored = localStorage.getItem("customer-cart");
      const items = JSON.parse(stored || "[]");
      setCartItems(Array.isArray(items) ? items : []);
    } catch (err) {
      setCartItems([]);
    }
  };

  const loadCartFromServer = async () => {
    const requestId = ++cartLoadRequestIdRef.current;
    try {
      const items = await loadCartItems({ strict: true });
      if (requestId !== cartLoadRequestIdRef.current) return;
      if (!Array.isArray(items)) {
        throw new Error("The cart response was invalid.");
      }
      localStorage.setItem("customer-cart", JSON.stringify(items));
      setCartItems(items);
      setCartError("");
    } catch (err) {
      if (requestId !== cartLoadRequestIdRef.current) return;
      console.error("Failed to load cart:", err);
      setCartError(err?.response?.data?.error || "Unable to load your cart. Please try again.");
    }
  };

  const isInCart = (imageId) => {
    return cartItems.some((item) => Number(item.id) === Number(imageId));
  };

  const addToCart = async (image) => {
    let existingCart;
    const requestId = ++cartLoadRequestIdRef.current;
    try {
      setCartError("");
      existingCart = await loadCartItems({ strict: true });
      if (requestId !== cartLoadRequestIdRef.current) return;
      if (!Array.isArray(existingCart)) {
        throw new Error("The cart response was invalid.");
      }

      if (existingCart.some((item) => Number(item.id) === Number(image.id))) {
        localStorage.setItem("customer-cart", JSON.stringify(existingCart));
        setCartItems(existingCart);
        window.dispatchEvent(new Event("cartUpdated"));
        return;
      }

      const nextCart = [
        ...existingCart,
        {
          id: image.id,
          title: image.title,
          filename: image.filename,
          collection: image.collection,
          category: image.category,
          price: image.price || null,
        },
      ];

      await saveCartItems(nextCart, { strict: true });
      if (requestId !== cartLoadRequestIdRef.current) return;
      setCartItems(nextCart);
      window.dispatchEvent(new Event("cartUpdated"));
    } catch (err) {
      console.error("Failed to add favorite to cart:", err);
      if (Array.isArray(existingCart)) {
        try {
          localStorage.setItem("customer-cart", JSON.stringify(existingCart));
          setCartItems(existingCart);
        } catch (restoreError) {
          console.error("Failed to restore the previous cart:", restoreError);
        }
      }
      setCartError(err?.response?.data?.error || "Unable to add this asset to your cart. Please try again.");
    }
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

    <div className="my-favorites-page" style={{ color: darkMode ? "#f5f5f5" : "#111827" }}>

      <h2>⭐ My Favorites</h2>

      {cartError && <p className="my-favorites-cart-error" role="alert" style={{ color: darkMode ? "#fca5a5" : "#b91c1c" }}>{cartError}</p>}

      {loadStatus === "loading" ? (
        <p className="my-favorites-message" role="status">Loading favorites...</p>
      ) : loadError ? (
        <div className="my-favorites-error" role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => {
            favoritesRequestIdRef.current += 1;
            setLocalRetry((attempt) => attempt + 1);
          }}>Retry</button>
        </div>
      ) : (
      <div className="my-favorites-grid">

        {favorites.length === 0 ? (

          <p className="my-favorites-empty">No favorite images yet.</p>

        ) : (

          favorites.map((image, index) => (

            <div
              key={`favorite-${image.id}-${index}`}
              className="my-favorites-card"
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
                className="my-favorites-image"
                src={getAssetPreviewUrl(image, { quality: 50, watermark: false, thumbnailOnly: true })}
                alt={image.title}
                loading="lazy"
                decoding="async"
                style={{
                  width: "100%",
                  objectFit: "cover"
                }}
              />

              <div
                className="my-favorites-card-content"
                style={{
                  color: darkMode ? "#f5f5f5" : "#111827"
                }}
              >

                <strong
                  className="my-favorites-title"
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

                <div className="my-favorites-stats">
                  <span style={{ color: darkMode ? "#cbd5e1" : "#475569" }}>❤️ {image.likes || 0}</span>
                  <span style={{ color: darkMode ? "#cbd5e1" : "#475569" }}>⬇ {image.downloads || 0}</span>
                </div>

                <div className="my-favorites-actions">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      addToCart(image);
                    }}
                    disabled={isInCart(image.id)}
                    style={{
                      background: isInCart(image.id) ? "#9ca3af" : "#2563eb",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: isInCart(image.id) ? "not-allowed" : "pointer",
                    }}
                  >
                    {isInCart(image.id) ? "Added" : <>
                      <svg
                        className="my-favorites-cart-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <circle cx="9" cy="21" r="1" />
                        <circle cx="20" cy="21" r="1" />
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H5" />
                      </svg>
                      Add
                    </>}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFavorite(image.id);
                    }}
                    style={{
                      background: "#f44336",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    <span className="my-favorites-remove-icon" aria-hidden="true">✕</span> Remove
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