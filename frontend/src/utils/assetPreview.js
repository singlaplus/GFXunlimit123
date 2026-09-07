const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

export const resolveThumbnailDownloadFile = (value) => {
  if (value === null || value === undefined) return "";

  let normalized = String(value).trim();
  if (!normalized || normalized === "null" || normalized === "undefined") return "";

  try {
    normalized = decodeURIComponent(normalized);
  } catch (err) {
    // Some values are already decoded; keep as-is.
  }

  const fileMatch = normalized.match(/[?&]file=([^&]+)/i);
  if (fileMatch && fileMatch[1]) {
    normalized = fileMatch[1];
  }

  normalized = normalized
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+/, "")
    .replace(/^api\/files\/+/, "")
    .replace(/^uploads[\\/]+/, "")
    .replace(/^api\/thumbnail[\\/]+/, "")
    .replace(/^file=/i, "")
    .replace(/\\/g, "/");

  try {
    normalized = decodeURIComponent(normalized);
  } catch (err) {
    // Leave it as-is when it is already a clean relative path.
  }

  return normalized.replace(/^\/+/, "").replace(/^uploads[\\/]+/, "").replace(/^api\/files\/+/, "");
};

export const getAssetPreviewUrl = (image, options = {}) => {
  const {
    quality = 50,
    watermark = false,
    useThumbnail = true,
  } = options;

  const buildThumbnailUrl = (baseUrl, thumbnailQuality) => {
    if (!baseUrl) return "";

    const url = new URL(baseUrl, API_BASE_URL);
    if (Number.isFinite(thumbnailQuality)) {
      url.searchParams.set('quality', String(thumbnailQuality));
    }
    if (watermark) {
      url.searchParams.set('watermark', 'true');
    }
    return url.toString();
  };

  const hasReadyThumbnail = (img) => {
    if (!img || !img.thumbnail_url) return false;
    const status = String(img.thumbnail_status ?? '').trim().toLowerCase();
    const blockedStatuses = new Set(['pending', 'processing', 'retrying', 'failed', 'error']);
    return !blockedStatuses.has(status);
  };

  // Optional thumbnails always render at 50% quality on the website
  if (useThumbnail && image && hasReadyThumbnail(image)) {
    const thumbnailUrl = buildThumbnailUrl(image.thumbnail_url, 50);
    if (thumbnailUrl) return thumbnailUrl;
  }

  if (!image || !image.id) {
    return "";
  }

  const params = new URLSearchParams();
  if (Number.isFinite(quality)) params.set('quality', String(quality));
  if (watermark) params.set('watermark', 'true');

  const qs = params.toString();
  return `${API_BASE_URL}/api/images/${image.id}${qs ? `?${qs}` : ''}`;
};

export const getAssetOriginalDownloadUrl = (imageId) => {
  if (!imageId) return "";
  return `${API_BASE_URL}/images/${imageId}/download-original`;
};
