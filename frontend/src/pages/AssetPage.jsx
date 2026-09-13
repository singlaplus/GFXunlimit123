import { useEffect, useRef, useState } from "react";
import { getSingleImage } from "../services/api";
import axios from "axios";
import { getRelatedImages, likeImageRequest, viewImageRequest, addFavoriteRequest } from "../services/imageService";
import { saveCartItems } from "../utils/cartPersistence";
import { getAssetPreviewUrl } from "../utils/assetPreview";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

export default function AssetPage(props) {
  const { imageId, darkMode } = props;
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const [zoomImageLoading, setZoomImageLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);
  const [pricingSettings, setPricingSettings] = useState(null);
  const [selectedCurrency, setSelectedCurrency] = useState(null);
  const [cartCurrency, setCartCurrency] = useState(null);
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [relatedImages, setRelatedImages] = useState([]);
  const relatedSliderRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    axios.get(`${API_BASE_URL}/subscription-status`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => setSubscriptionActive(Boolean(response.data?.active && response.data?.canPurchase)))
      .catch(() => setSubscriptionActive(false));
  }, []);

  useEffect(() => {
    const fetchAndViewImage = async () => {
      if (!imageId) {
        setError("Invalid asset identifier.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        await viewImageRequest(imageId);
        const res = await getSingleImage(imageId);
        const result = res.data;

        if (!result || Object.keys(result).length === 0) {
          setError("Asset not found.");
        } else {
          setImage(result);
        }
      } catch (err) {
        console.error(err);
        setError("Unable to load asset details.");
      } finally {
        setLoading(false);
      }
    };
    fetchAndViewImage();
  }, [imageId]);

  useEffect(() => {
    if (!image?.id) return;
    getRelatedImages(image.id)
      .then((response) => setRelatedImages(Array.isArray(response.data) ? response.data : []))
      .catch(() => setRelatedImages([]));
  }, [image]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setIsZoomOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const checkFavorited = async () => {
      if (!image) return;
      const token = localStorage.getItem("token");
      if (!token) return;
      try {
        const res = await axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/favorites`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const favs = res.data || [];
        const exists = favs.some((f) => Number(f.id) === Number(image.id));
        setIsFavorited(!!exists);
      } catch (err) {
        console.error("Failed to fetch favorites", err);
      }
    };
    checkFavorited();
  }, [image]);

  useEffect(() => {
    // Fetch pricing settings
    const fetchPricingSettings = async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/settings/pricing`);
        setPricingSettings(res.data || {});
      } catch (err) {
        console.error("Failed to fetch pricing settings", err);
      }
    };
    fetchPricingSettings();

    // Fetch cart currency if items exist
    const cartItems = JSON.parse(localStorage.getItem('customer-cart') || '[]');
    if (cartItems.length > 0) {
      const existingCurrency = cartItems[0]?.currency || null;
      setCartCurrency(existingCurrency);
    }
  }, []);

  const addToCart = () => {
    if (!image) return;
    setShowCurrencyModal(true);
    setSelectedCurrency(null);
    // Update cart currency when opening modal
    const cartItems = JSON.parse(localStorage.getItem('customer-cart') || '[]');
    if (cartItems.length > 0) {
      setCartCurrency(cartItems[0]?.currency || null);
    }
  };

  const addToCartWithCurrency = (currency) => {
    if (!image) return;

    const cartKey = "customer-cart";
    let cartItems = [];

    try {
      cartItems = JSON.parse(localStorage.getItem(cartKey) || "[]");
    } catch (err) {
      cartItems = [];
    }

    const exists = cartItems.some((item) => item.id === image.id && item.currency === currency);
    if (!exists) {
      const DEFAULT_CODES = ['INR', 'USD', 'EUR'];
      const defaultCurrencies = DEFAULT_CODES.map((code) => ({
        code,
        amount: Number(pricingSettings?.[`${code.toLowerCase()}_amount`] || 0)
      }));
      const customCurrencies = Array.isArray(pricingSettings?.custom_currency_rows)
        ? pricingSettings.custom_currency_rows.map((row) => ({
            code: row.code,
            amount: Number(row.amount || 0)
          }))
        : [];
      const allCurrencies = [...defaultCurrencies, ...customCurrencies];
      const currencyData = allCurrencies.find((c) => c.code === currency) || { code: currency, amount: 0 };
      const price = Number(currencyData.amount || 0);

      cartItems.push({
        id: image.id,
        title: image.title,
        filename: image.filename,
        collection: image.collection,
        category: image.category,
        thumbnail_url: image.thumbnail_url || null,
        thumbnail_status: image.thumbnail_status || null,
        price: price,
        unitPrice: price,
        currency: currency,
        license: image.license || 'Standard license',
        freeAsset: price <= 0,
        contributorId: image.uploaded_by || null,
      });
      saveCartItems(cartItems);
      window.dispatchEvent(new Event("cartUpdated"));
    }

    setShowCurrencyModal(false);
    setSelectedCurrency(null);
  };

  const downloadSubscribedAsset = async () => {
    if (!image) return;
    try {
      const token = localStorage.getItem("token");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      await axios.put(`${API_BASE_URL}/images/${image.id}/download`, {}, { headers });
      const response = await axios.get(`${API_BASE_URL}/images/${image.id}/download-original`, { headers, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = image.filename?.split("/").pop() || `${image.title || "asset"}.download`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data || "Unable to download this asset.");
    }
  };

  const likeAsset = async () => {
    if (!image) return;

    try {
      const response = await likeImageRequest(image.id);
      const updatedImage = response.data;
      setImage((prev) => ({
        ...prev,
        likes: updatedImage.likes,
      }));
    } catch (err) {
      console.error("Asset like failed", err);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 30, color: darkMode ? "#f5f5f5" : "#111" }}>
        Loading asset details...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 30, color: darkMode ? "#f5f5f5" : "#111" }}>
        <p>{error}</p>
      </div>
    );
  }

  if (!image) {
    return null;
  }

  const previewUrl = getAssetPreviewUrl(image, { quality: 10, watermark: true });
  const popupUrl = getAssetPreviewUrl(image, { quality: 50, watermark: true });
  const fullSizeUrl = getAssetPreviewUrl(image, { quality: 100, watermark: true });

  return (
    <div
      style={{
        padding: "40px 0",
        minHeight: "100vh",
        background: darkMode ? "linear-gradient(180deg, #020617 0%, #101828 100%)" : "#f3f4f6",
        color: darkMode ? "#f8fafc" : "#111827",
      }}
    >
      <div
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "1.45fr 0.85fr",
          gap: "32px",
        }}
      >
          <div
            style={{
              borderRadius: "32px",
              overflow: "hidden",
              background: darkMode ? "rgba(255,255,255,0.02)" : "#ffffff",
              boxShadow: "none",
              border: "none",
            }}
          >
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              aspectRatio: "1 / 1", // make preview area square
              width: "100%",
              margin: 0,
              maxHeight: 432,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 20,
              border: darkMode ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(226,232,240,1)",
              boxShadow: darkMode ? "0 8px 24px rgba(0,0,0,0.24)" : "0 6px 18px rgba(15,23,42,0.06)",
            }}
          >
            <img
              src={previewUrl}
              alt={image.title}
              onClick={() => setIsZoomOpen(true)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                cursor: "zoom-in",
                borderRadius: 18,
              }}
            />

            {isZoomOpen && (
              <div
                role="dialog"
                aria-modal="true"
                onClick={() => setIsZoomOpen(false)}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(2,6,23,0.75)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 1400,
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "min(90vw, 90vh)",
                    height: "min(90vw, 90vh)",
                    background: "#000",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 8,
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  {zoomImageLoading && (
                    <div style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      color: "#fff",
                      fontSize: "16px",
                    }}>
                      Loading...
                    </div>
                  )}
                  <img
                    src={fullSizeUrl}
                    alt={image.title}
                    onLoad={() => setZoomImageLoading(false)}
                    onLoadStart={() => setZoomImageLoading(true)}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      cursor: "zoom-out",
                      display: "block",
                    }}
                  />
                </div>
              </div>
            )}
            <div
              style={{
                position: "absolute",
                left: "20px",
                top: "20px",
                padding: "10px 16px",
                borderRadius: "999px",
                background: darkMode ? "rgba(15, 23, 42, 0.8)" : "rgba(255,255,255,0.9)",
                color: darkMode ? "#f8fafc" : "#111827",
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              Premium asset
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          <div
            style={{
              background: darkMode ? "rgba(255,255,255,0.04)" : "#ffffff",
              padding: "32px",
              borderRadius: "28px",
              boxShadow: darkMode ? "0 24px 60px rgba(0,0,0,0.24)" : "0 20px 50px rgba(15,23,42,0.08)",
              border: darkMode ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(226,232,240,1)",
            }}
          >
            <div style={{ marginBottom: "22px" }}>
              <p
                style={{
                  margin: 0,
                  marginBottom: "12px",
                  color: darkMode ? "#93c5fd" : "#2563eb",
                  fontSize: "13px",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Exclusive collection
              </p>
              <h1
                style={{
                  margin: 0,
                  fontSize: "2.4rem",
                  lineHeight: 1.05,
                  letterSpacing: "-0.03em",
                }}
              >
                {image.title || "Untitled asset"}
              </h1>
            </div>

            <p
              style={{
                margin: 0,
                marginBottom: "24px",
                color: darkMode ? "#d1d5db" : "#475569",
                lineHeight: 1.75,
                fontSize: "1rem",
              }}
            >
              {image.description || "No description provided."}
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginBottom: "28px" }}>
              {image.collection ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "10px 16px",
                    borderRadius: "999px",
                    background: darkMode ? "rgba(59,130,246,0.15)" : "rgba(59,130,246,0.12)",
                    color: darkMode ? "#bfdbfe" : "#1d4ed8",
                    fontWeight: 600,
                    fontSize: "0.95rem",
                  }}
                >
                  Collection: {image.collection}
                </span>
              ) : null}
              {image.category ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "10px 16px",
                    borderRadius: "999px",
                    background: darkMode ? "rgba(229,231,235,0.08)" : "rgba(15,23,42,0.04)",
                    color: darkMode ? "#e2e8f0" : "#0f172a",
                    fontWeight: 600,
                    fontSize: "0.95rem",
                  }}
                >
                  Category: {image.category}
                </span>
              ) : null}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "16px",
                marginBottom: "28px",
              }}
            >
              <div
                style={{
                  padding: "20px",
                  borderRadius: "20px",
                  background: darkMode ? "rgba(255,255,255,0.04)" : "#f8fafc",
                  border: darkMode ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(226,232,240,1)",
                }}
              >
                <div style={{ fontSize: "0.85rem", color: darkMode ? "#cbd5e1" : "#6b7280", marginBottom: "6px" }}>
                  Likes
                </div>
                <div style={{ fontSize: "1.55rem", fontWeight: 700 }}>{image.likes || 0}</div>
              </div>
              <div
                style={{
                  padding: "20px",
                  borderRadius: "20px",
                  background: darkMode ? "rgba(255,255,255,0.04)" : "#f8fafc",
                  border: darkMode ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(226,232,240,1)",
                }}
              >
                <div style={{ fontSize: "0.85rem", color: darkMode ? "#cbd5e1" : "#6b7280", marginBottom: "6px" }}>
                  Views
                </div>
                <div style={{ fontSize: "1.55rem", fontWeight: 700 }}>{image.views || 0}</div>
              </div>
              <div
                style={{
                  padding: "20px",
                  borderRadius: "20px",
                  background: darkMode ? "rgba(255,255,255,0.04)" : "#f8fafc",
                  border: darkMode ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(226,232,240,1)",
                }}
              >
                <div style={{ fontSize: "0.85rem", color: darkMode ? "#cbd5e1" : "#6b7280", marginBottom: "6px" }}>
                  Downloads
                </div>
                <div style={{ fontSize: "1.55rem", fontWeight: 700 }}>{image.downloads || 0}</div>
              </div>
            </div>

            <div style={{ display: "grid", gap: "14px" }}>
              {subscriptionActive ? <button
                type="button"
                onClick={downloadSubscribedAsset}
                style={{ width: "100%", padding: "16px 20px", borderRadius: "16px", border: "none", background: "#16a34a", color: "#ffffff", fontWeight: 700, cursor: "pointer", boxShadow: "0 18px 40px rgba(22, 163, 74, 0.24)" }}
              >
                Download with subscription
              </button> : <button
                type="button"
                onClick={addToCart}
                style={{
                  width: "100%",
                  padding: "16px 20px",
                  borderRadius: "16px",
                  border: "none",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 18px 40px rgba(37, 99, 235, 0.24)",
                }}
              >
                Add to cart
              </button>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <button
                  type="button"
                  onClick={async () => {
                    if (isFavorited || favLoading) return;
                    setFavLoading(true);
                    try {
                      const token = localStorage.getItem("token");
                      await addFavoriteRequest(image.id, token);
                      setIsFavorited(true);
                      window.dispatchEvent(new Event("favoritesUpdated"));
                    } catch (err) {
                      console.error("Favorite Error:", err);
                    } finally {
                      setFavLoading(false);
                    }
                  }}
                  disabled={isFavorited}
                  style={{
                    width: "100%",
                    padding: "14px 18px",
                    borderRadius: "16px",
                    border: "1px solid transparent",
                    background: darkMode ? "rgba(255,255,255,0.08)" : "#f8fafc",
                    color: darkMode ? "#ffffff" : "#111827",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {isFavorited ? "Saved" : favLoading ? "Saving..." : "Add to favorites"}
                </button>
                <button
                  type="button"
                  onClick={likeAsset}
                  style={{
                    width: "100%",
                    padding: "14px 18px",
                    borderRadius: "16px",
                    border: "1px solid transparent",
                    background: darkMode ? "rgba(255,255,255,0.08)" : "#f8fafc",
                    color: darkMode ? "#ffffff" : "#111827",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Like
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "14px" }}>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(window.location.href);
                    } catch (err) {
                      console.error("Copy failed", err);
                    } finally {
                      setShareCopied(true);
                      setTimeout(() => setShareCopied(false), 2000);
                    }
                  }}
                  style={{
                    width: "100%",
                    padding: "14px 18px",
                    borderRadius: "16px",
                    border: "1px solid transparent",
                    background: darkMode ? "rgba(255,255,255,0.08)" : "#f8fafc",
                    color: darkMode ? "#ffffff" : "#111827",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {shareCopied ? "Copied!" : "Share"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {relatedImages.length > 0 && (
          <section
            aria-labelledby="related-assets-heading"
            style={{
              gridColumn: "1 / -1",
              marginTop: "8px",
              padding: "28px 0 4px",
              borderTop: darkMode ? "1px solid rgba(255,255,255,0.1)" : "1px solid #e2e8f0",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
              <h2 id="related-assets-heading" style={{ margin: 0, fontSize: "1.45rem" }}>Related assets</h2>
              <div style={{ display: "flex", gap: "8px" }}>
                {[-1, 1].map((direction) => (
                  <button
                    key={direction}
                    type="button"
                    aria-label={direction < 0 ? "Previous related assets" : "Next related assets"}
                    onClick={() => relatedSliderRef.current?.scrollBy({ left: direction * 320, behavior: "smooth" })}
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "50%",
                      border: darkMode ? "1px solid rgba(255,255,255,0.15)" : "1px solid #cbd5e1",
                      background: darkMode ? "rgba(255,255,255,0.06)" : "#ffffff",
                      color: darkMode ? "#f8fafc" : "#111827",
                      cursor: "pointer",
                      fontSize: "20px",
                    }}
                  >
                    {direction < 0 ? "‹" : "›"}
                  </button>
                ))}
              </div>
            </div>
            <div
              ref={relatedSliderRef}
              style={{ display: "flex", gap: "16px", overflowX: "auto", scrollBehavior: "smooth", paddingBottom: "12px" }}
            >
              {relatedImages.map((related) => {
                const slug = String(related.title || "asset").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
                return (
                  <a
                    key={related.id}
                    href={`/asset/${slug || "asset"}-${related.id}`}
                    style={{ flex: "0 0 220px", textDecoration: "none", color: "inherit" }}
                  >
                    <img
                      src={getAssetPreviewUrl(related, { quality: 50, watermark: false })}
                      alt={related.title || "Related asset"}
                      style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover", display: "block", borderRadius: "14px" }}
                    />
                    <div style={{ marginTop: "10px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {related.title || "Untitled asset"}
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {/* Currency Selection Modal */}
        {showCurrencyModal && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
            onClick={() => {
              setShowCurrencyModal(false);
              setSelectedCurrency(null);
            }}
          >
            <div
              style={{
                background: darkMode ? "#1f2937" : "#ffffff",
                borderRadius: "16px",
                padding: "32px",
                maxWidth: "400px",
                width: "90%",
                boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                style={{
                  margin: "0 0 24px 0",
                  fontSize: "24px",
                  fontWeight: 700,
                  color: darkMode ? "#f8fafc" : "#111827",
                }}
              >
                Select Currency
              </h2>
              <p
                style={{
                  margin: "0 0 24px 0",
                  color: darkMode ? "#cbd5e1" : "#475569",
                  fontSize: "14px",
                }}
              >
                {cartCurrency ? `You are currently shopping in ${cartCurrency}. Select the same currency to add more items.` : "Choose your preferred currency to add to cart:"}
              </p>

              <div style={{ display: "grid", gap: "12px" }}>
                {(() => {
                  const DEFAULT_CODES = ['INR', 'USD', 'EUR'];
                  const defaultCurrencies = DEFAULT_CODES.map((code) => ({
                    code,
                    amount: pricingSettings?.[`${code.toLowerCase()}_amount`] || 0
                  }));
                  const customCurrencies = Array.isArray(pricingSettings?.custom_currency_rows)
                    ? pricingSettings.custom_currency_rows
                    : [];
                  return [...defaultCurrencies, ...customCurrencies].map((curr) => {
                    const isDisabled = cartCurrency && cartCurrency !== curr.code;
                    const displayAmount = Number(curr.amount || 0);
                    return (
                      <button
                        key={curr.code || curr.id}
                        onClick={() => !isDisabled && addToCartWithCurrency(curr.code)}
                        disabled={isDisabled}
                        style={{
                          width: "100%",
                          padding: "16px",
                          borderRadius: "12px",
                          border: selectedCurrency === curr.code ? "2px solid #2563eb" : isDisabled ? "1px solid #cbd5e1" : "1px solid #e2e8f0",
                          background: isDisabled ? (darkMode ? "rgba(255,255,255,0.05)" : "#f0f0f0") : (selectedCurrency === curr.code ? "#f0f9ff" : (darkMode ? "#374151" : "#f8fafc")),
                          color: isDisabled ? (darkMode ? "#9ca3af" : "#9ca3af") : (darkMode ? "#f8fafc" : "#111827"),
                          cursor: isDisabled ? "not-allowed" : "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontWeight: 600,
                          transition: "all 0.2s ease",
                          opacity: isDisabled ? 0.6 : 1,
                        }}
                        onMouseEnter={(e) => {
                          if (!isDisabled) {
                            e.target.style.borderColor = "#2563eb";
                            e.target.style.background = darkMode ? "#464f5f" : "#f0f9ff";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isDisabled && selectedCurrency !== curr.code) {
                            e.target.style.borderColor = "#e2e8f0";
                            e.target.style.background = darkMode ? "#374151" : "#f8fafc";
                          }
                        }}
                      >
                        <span>{curr.code} {isDisabled && "(locked)"}</span>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: "16px", fontWeight: 700, color: isDisabled ? "#9ca3af" : "#2563eb" }}>
                            {displayAmount}
                          </div>
                        </div>
                      </button>
                    );
                  });
                })()}
              </div>

              <button
                onClick={() => {
                  setShowCurrencyModal(false);
                  setSelectedCurrency(null);
                }}
                style={{
                  width: "100%",
                  marginTop: "16px",
                  padding: "12px 16px",
                  borderRadius: "8px",
                  border: "none",
                  background: darkMode ? "#464f5f" : "#e2e8f0",
                  color: darkMode ? "#f8fafc" : "#111827",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
