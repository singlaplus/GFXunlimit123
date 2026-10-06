import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { buildAuthHeaders } from "../utils/authSession";
import { getAssetPreviewUrl, getAssetThumbnailUrl } from "../utils/assetPreview";

const BROWSER_IMAGE_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"]);

const getOriginalImageUrl = (image) => {
  const filename = String(image.filename || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!filename || !BROWSER_IMAGE_EXTENSIONS.has(extension)) return "";

  const encodedPath = filename.split("/").map(encodeURIComponent).join("/");
  const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
  return `${apiBaseUrl.replace(/\/+$/, "")}/api/files/${encodedPath}`;
};

function AssetThumbnail({ image, darkMode = false, style = {} }) {
  const containerRef = useRef(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [loadedImageUrl, setLoadedImageUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [thumbnailUnavailable, setThumbnailUnavailable] = useState(false);
  const thumbnailUrl = getAssetThumbnailUrl(image);
  const isNonRasterPreview = /\.(?:ai|eps|psd|psb)$/i.test(String(image.filename || ""));
  const catalogPreviewUrl = isNonRasterPreview
    ? getAssetPreviewUrl(image, { quality: 63, renderCatalogPreview: true })
    : "";
  const originalImageUrl = getOriginalImageUrl(image);
  const alt = image.title || "Asset thumbnail";

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return undefined;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      const bounds = entry.target.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;
      setIsNearViewport(true);
      observer.disconnect();
    }, { rootMargin: "0px" });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setThumbnailUnavailable(false);
    setLoadedImageUrl("");
    setIsLoading(false);

    if (!isNearViewport) return undefined;

    let active = true;
    let objectUrl = null;
    setIsLoading(true);

    const loadImage = async () => {
      try {
        const response = await axios.get(thumbnailUrl, {
          responseType: "blob",
          headers: buildAuthHeaders()
        });
        if (!response.data.type?.startsWith("image/")) {
          throw new Error("Thumbnail endpoint did not return an image");
        }
        return response.data;
      } catch (thumbnailError) {
        if (catalogPreviewUrl) {
          const response = await axios.get(catalogPreviewUrl, {
            responseType: "blob",
            headers: buildAuthHeaders()
          });
          if (!response.data.type?.startsWith("image/")) {
            throw new Error("Catalog preview endpoint did not return an image");
          }
          return response.data;
        }
        if (!originalImageUrl) throw thumbnailError;
        const response = await axios.get(originalImageUrl, {
          responseType: "blob",
          headers: buildAuthHeaders()
        });
        if (!response.data.type?.startsWith("image/")) {
          throw new Error("Asset file endpoint did not return an image");
        }
        return response.data;
      }
    };

    loadImage()
      .then((data) => {
        objectUrl = URL.createObjectURL(data);
        if (active) {
          setLoadedImageUrl(objectUrl);
          setIsLoading(false);
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      })
      .catch((error) => {
        if (!active) return;
        console.error(
          `Failed to load thumbnail for asset ${image.id}:`,
          error.response?.status || error.message
        );
        setThumbnailUnavailable(true);
        setIsLoading(false);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [catalogPreviewUrl, image.id, isNearViewport, originalImageUrl, thumbnailUrl]);

  const fallbackStyle = {
    ...style,
    minHeight: style.height || style.minHeight || "120px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: darkMode ? "#111827" : "#f1f5f9",
    color: darkMode ? "#cbd5e1" : "#64748b",
    fontSize: "0.85rem",
  };
  return (
    <div ref={containerRef} style={{ width: style.width || "100%" }}>
      {thumbnailUnavailable ? (
        <div role="img" aria-label={`${alt} thumbnail unavailable`} style={fallbackStyle}>
          Thumbnail unavailable
        </div>
      ) : loadedImageUrl ? (
        <img
          src={loadedImageUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          style={style}
        />
      ) : (
        <div
          role="img"
          aria-label={`${alt} thumbnail loading`}
          style={fallbackStyle}
        >
          {isLoading ? "Loading thumbnail…" : "Thumbnail loading…"}
        </div>
      )}
    </div>
  );
}

export default AssetThumbnail;
