import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAssetPreviewUrl } from "../utils/assetPreview";

function DeferredPreviewImage({ src, ...imageProps }) {
  const imageRef = useRef(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    const imageElement = imageRef.current;
    if (!imageElement) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setIsNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "100px 0px" });

    observer.observe(imageElement);
    return () => observer.disconnect();
  }, [src]);

  return <img ref={imageRef} src={isNearViewport ? src : undefined} {...imageProps} />;
}

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
          <DeferredPreviewImage
            src={getAssetPreviewUrl(image, {
              quality: 50,
              watermark: false,
              renderNonRasterPreview: true,
            })}
            alt={image.title}
            width="100%"
            loading="lazy"
            decoding="async"
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