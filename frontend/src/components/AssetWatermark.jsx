import { useEffect, useId, useState } from "react";
import { assetWatermark } from "../utils/assetWatermark";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

function resolveBrandingAsset(path) {
  return new URL(path, `${API_BASE_URL.replace(/\/+$/, "")}/`).toString();
}

export default function AssetWatermark({ width = 640, height = 360 }) {
  const [brandingAssets, setBrandingAssets] = useState(null);
  const patternId = `asset-watermark-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    const controller = new AbortController();
    const loadBrandingAssets = async () => {
      const response = await fetch(`${API_BASE_URL.replace(/\/+$/, "")}/branding`, {
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Branding request failed with status ${response.status}`);
      }
      const branding = await response.json();
      const logoPath = branding.watermarkLogo || branding.logo || "/branding/logo.png";
      const faviconPath = branding.watermarkFavicon || branding.favicon || "/branding/favicon.png";
      setBrandingAssets({
        logo: resolveBrandingAsset(logoPath),
        favicon: resolveBrandingAsset(faviconPath),
      });
    };

    loadBrandingAssets().catch((error) => {
      if (!controller.signal.aborted) {
        console.error("Failed to load branding assets for asset watermark", error);
      }
    });
    return () => controller.abort();
  }, []);

  if (!brandingAssets || width <= 0 || height <= 0) return null;

  const fontSize = Math.max(
    assetWatermark.minimumFontSize,
    Math.round(width * assetWatermark.fontSizeRatio)
  );
  const patternSize = Math.max(
    fontSize * assetWatermark.patternFontSizeMultiplier,
    assetWatermark.minimumPatternSize
  );
  const logoSize = Math.round(patternSize * assetWatermark.logoSizeRatio);
  const faviconSize = Math.max(
    assetWatermark.minimumFaviconSize,
    Math.round(patternSize * assetWatermark.faviconSizeRatio)
  );
  const faviconInset = assetWatermark.faviconInset;
  const farFaviconPosition = Math.max(
    assetWatermark.faviconInset,
    Math.round(patternSize - faviconSize - faviconInset)
  );

  return (
    <svg
      aria-hidden="true"
      data-testid="asset-watermark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      <defs>
        <pattern
          id={patternId}
          data-testid="asset-watermark-pattern"
          patternUnits="userSpaceOnUse"
          width={patternSize}
          height={patternSize}
          patternTransform={`rotate(${assetWatermark.rotation})`}
        >
          <image
            href={brandingAssets.logo}
            x={Math.round((patternSize - logoSize) / 2)}
            y={Math.round((patternSize - logoSize) / 2)}
            width={logoSize}
            height={logoSize}
            opacity={assetWatermark.opacity}
          />
          <image
            href={brandingAssets.favicon}
            x={faviconInset}
            y={faviconInset}
            width={faviconSize}
            height={faviconSize}
            opacity={assetWatermark.opacity}
          />
          <image
            href={brandingAssets.favicon}
            x={farFaviconPosition}
            y={faviconInset}
            width={faviconSize}
            height={faviconSize}
            opacity={assetWatermark.opacity}
          />
          <image
            href={brandingAssets.favicon}
            x={faviconInset}
            y={farFaviconPosition}
            width={faviconSize}
            height={faviconSize}
            opacity={assetWatermark.opacity}
          />
          <image
            href={brandingAssets.favicon}
            x={farFaviconPosition}
            y={farFaviconPosition}
            width={faviconSize}
            height={faviconSize}
            opacity={assetWatermark.opacity}
          />
        </pattern>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill={`url(#${patternId})`}
      />
    </svg>
  );
}
