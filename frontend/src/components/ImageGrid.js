import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAssetPreviewUrl, getAssetSourceUrl } from "../utils/assetPreview";

let deferredPreviewObserver;
const deferredPreviewCallbacks = new WeakMap();

function observeDeferredPreview(element, onVisible) {
  if (typeof IntersectionObserver === "undefined") {
    onVisible();
    return () => {};
  }

  if (!deferredPreviewObserver) {
    deferredPreviewObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const bounds = entry.target.getBoundingClientRect();
        if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;

        const callback = deferredPreviewCallbacks.get(entry.target);
        deferredPreviewCallbacks.delete(entry.target);
        deferredPreviewObserver.unobserve(entry.target);
        callback?.();
      });
    }, { rootMargin: "0px" });
  }

  deferredPreviewCallbacks.set(element, onVisible);
  deferredPreviewObserver.observe(element);

  return () => {
    deferredPreviewCallbacks.delete(element);
    deferredPreviewObserver?.unobserve(element);
  };
}

const DeferredPreviewImage = forwardRef(function DeferredPreviewImage(
  { src, alt = "", ...imageProps },
  forwardedRef
) {
  const imageRef = useRef(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    const imageElement = imageRef.current;
    if (!imageElement) return undefined;

    return observeDeferredPreview(imageElement, () => setIsNearViewport(true));
  }, [src]);

  const setImageRef = (element) => {
    imageRef.current = element;
    if (typeof forwardedRef === "function") {
      forwardedRef(element);
    } else if (forwardedRef) {
      forwardedRef.current = element;
    }
  };

  return <img ref={setImageRef} src={isNearViewport ? src : undefined} alt={alt} {...imageProps} />;
});

function getMasonryRowSpan(card, aspectRatio) {
  const grid = card?.parentElement;
  const cardWidth = card?.getBoundingClientRect().width || 0;
  if (!card || !grid || cardWidth <= 0) return null;

  const styles = window.getComputedStyle(grid);
  const rowHeight = Number.parseFloat(styles.gridAutoRows) || 8;
  const rowGap = Number.parseFloat(styles.rowGap) || 16;
  const imageHeight = cardWidth / aspectRatio;

  return Math.max(
    1,
    Math.ceil((imageHeight + rowGap) / (rowHeight + rowGap))
  );
}

function getEpsDimensions(header) {
  const number = "(-?\\d+(?:\\.\\d+)?)";
  const parseBox = (label) => {
    const match = header.match(
      new RegExp(`^%%${label}:\\s*${number}\\s+${number}\\s+${number}\\s+${number}\\s*$`, "m")
    );
    if (!match) return null;

    const [left, bottom, right, top] = match.slice(1).map(Number);
    const width = right - left;
    const height = top - bottom;
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      ? { width, height }
      : null;
  };

  return parseBox("HiResBoundingBox") || parseBox("BoundingBox");
}

function getPsdDimensions(buffer) {
  if (buffer.byteLength < 26) return null;

  const bytes = new Uint8Array(buffer, 0, 6);
  const signature = String.fromCharCode(...bytes.subarray(0, 4));
  const view = new DataView(buffer);
  const version = view.getUint16(4, false);
  if (signature !== "8BPS" || (version !== 1 && version !== 2)) return null;

  const height = view.getUint32(14, false);
  const width = view.getUint32(18, false);
  return width > 0 && height > 0
    ? { width, height }
    : null;
}

function MasonryAssetCard({ image, darkMode, onClick }) {
  const cardRef = useRef(null);
  const imageRef = useRef(null);
  const [aspectRatio, setAspectRatio] = useState("16 / 9");
  const [rowSpan, setRowSpan] = useState(1);
  const [sourceDimensions, setSourceDimensions] = useState(null);
  const hasSourceDimensions = /\.(?:eps|psd|psb)$/i.test(String(image.filename || ""));

  useEffect(() => {
    if (!hasSourceDimensions) return undefined;

    const controller = new AbortController();
    const readDimensions = async () => {
      const response = await fetch(getAssetSourceUrl(image), {
        credentials: "include",
        headers: { Range: "bytes=0-65535" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Asset source request failed with status ${response.status}`);
      }
      if (response.status !== 206) {
        throw new Error("EPS source server did not honor the bounded range request");
      }

      const buffer = await response.arrayBuffer();
      const dimensions = /\.eps$/i.test(String(image.filename || ""))
        ? getEpsDimensions(Array.from(new Uint8Array(buffer), (byte) => String.fromCharCode(byte)).join(""))
        : getPsdDimensions(buffer);
      if (!dimensions) {
        throw new Error("Asset source does not contain valid dimensions in its header");
      }
      if (!controller.signal.aborted) setSourceDimensions(dimensions);
    };

    readDimensions().catch((error) => {
      if (!controller.signal.aborted) {
        console.error(`Failed to read artwork dimensions for asset ${image.id}`, error);
      }
    });

    return () => controller.abort();
  }, [image, hasSourceDimensions]);

  useLayoutEffect(() => {
    const updateRowSpan = (loadedAspectRatio) => {
      const card = cardRef.current;
      const naturalWidth = imageRef.current?.naturalWidth || 0;
      const naturalHeight = imageRef.current?.naturalHeight || 0;
      const imageAspectRatio = sourceDimensions
        ? sourceDimensions.width / sourceDimensions.height
        : loadedAspectRatio || (
        naturalWidth > 0 && naturalHeight > 0
          ? naturalWidth / naturalHeight
          : 16 / 9
        );
      const nextRowSpan = getMasonryRowSpan(card, imageAspectRatio);
      if (nextRowSpan === null) return;

      setRowSpan((currentRowSpan) => (
        currentRowSpan === nextRowSpan ? currentRowSpan : nextRowSpan
      ));
    };

    updateRowSpan();
    const card = cardRef.current;
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => updateRowSpan());

    if (card && resizeObserver) {
      resizeObserver.observe(card);
    }
    window.addEventListener("resize", updateRowSpan);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateRowSpan);
    };
  }, [sourceDimensions]);

  const handleImageLoad = (event) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth <= 0 || naturalHeight <= 0) return;

    const dimensions = sourceDimensions || { width: naturalWidth, height: naturalHeight };
    const nextAspectRatio = dimensions.width / dimensions.height;
    setAspectRatio(`${dimensions.width} / ${dimensions.height}`);
    const nextRowSpan = getMasonryRowSpan(cardRef.current, nextAspectRatio);
    if (nextRowSpan !== null) setRowSpan(nextRowSpan);
  };

  const slug = String(image.title || "asset")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const supportsProportionalPreview = /\.(?:jpe?g|png|webp|ai|eps|psd|psb)$/i.test(
    String(image.filename || "")
  );
  const usesGeneratedThumbnail = /\.(?:ai|eps|psd|psb)$/i.test(String(image.filename || ""));

  return (
    <div
      ref={cardRef}
      className="explore-asset-card"
      onMouseEnter={(event) => {
        event.currentTarget.style.transform = "translateY(-5px)";
        event.currentTarget.style.boxShadow = "0 12px 25px rgba(0,0,0,0.18)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform = "translateY(0)";
        event.currentTarget.style.boxShadow = "0 6px 18px rgba(0,0,0,0.1)";
      }}
      onClick={() => onClick(`/asset/${slug}-${image.id}`)}
      style={{
        gridRowEnd: `span ${rowSpan}`,
        borderRadius: "18px",
        overflow: "hidden",
        minWidth: 0,
        boxSizing: "border-box",
        background: darkMode ? "#1e1e1e" : "white",
        boxShadow: darkMode ? "0 6px 18px rgba(0,0,0,0.35)" : "0 6px 18px rgba(0,0,0,0.1)",
        transition: "0.3s",
        border: darkMode ? "1px solid #2f2f2f" : "1px solid transparent",
        cursor: "pointer",
      }}
    >
      <DeferredPreviewImage
        ref={imageRef}
        src={usesGeneratedThumbnail
          ? getAssetPreviewUrl(image, { thumbnailOnly: true })
          : supportsProportionalPreview
          ? getAssetPreviewUrl(image, { quality: 50, renderCatalogPreview: true })
          : getAssetPreviewUrl(image, { thumbnailOnly: true })}
        alt={image.title}
        width="100%"
        loading="lazy"
        decoding="async"
        onLoad={handleImageLoad}
        onMouseEnter={(event) => {
          event.currentTarget.style.transform = "scale(1.04)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.transform = "scale(1)";
        }}
        style={{
          width: "100%",
          height: "auto",
          aspectRatio: sourceDimensions ? `${sourceDimensions.width} / ${sourceDimensions.height}` : aspectRatio,
          objectFit: sourceDimensions ? "cover" : "contain",
          transition: "0.4s",
          display: "block",
        }}
      />
    </div>
  );
}

function ImageGrid(props) {
  const { filteredImages, darkMode } = props;
  const navigate = useNavigate();

  return (
    <div
      className="explore-asset-grid"
      style={{
        background: darkMode ? "#121212" : "transparent",
        padding: darkMode ? "12px 0" : "0",
        borderRadius: darkMode ? "16px" : "0",
      }}
    >
      {filteredImages.map((image) => (
        <MasonryAssetCard
          key={`featured-${image.id}-${image.filename}`}
          image={image}
          darkMode={darkMode}
          onClick={navigate}
        />
      ))}
    </div>
  );
}

export default ImageGrid;