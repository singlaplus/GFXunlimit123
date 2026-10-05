const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const EMPTY_THUMBNAIL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const BLOCKED_THUMBNAIL_STATUSES = new Set(['pending', 'processing', 'retrying', 'failed', 'error']);

export const hasReadyThumbnail = (image) => {
  const status = String(
    image?.generated_thumbnail_status ?? image?.thumbnail_status ?? ''
  ).trim().toLowerCase();
  if (BLOCKED_THUMBNAIL_STATUSES.has(status)) return false;
  if (status === 'ready' || status === 'completed') return true;
  return !status && Boolean(image?.thumbnail_url);
};

export const getAssetThumbnailUrl = (image, options = {}) => {
  if (!image?.id) return EMPTY_THUMBNAIL;
  const baseUrl = `${API_BASE_URL.replace(/\/+$/, "")}/api/assets/${encodeURIComponent(String(image.id))}/thumbnail`;
  const params = new URLSearchParams();
  if (image.thumbnail_generated_at) params.set('v', String(image.thumbnail_generated_at));
  if (options.watermark) {
    params.set('watermark', 'true');
    params.set('quality', String(Number.isFinite(options.quality) ? options.quality : 63));
  }
  const query = params.toString();
  return `${baseUrl}${query ? `?${query}` : ''}`;
};

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
    preferThumbnail = false,
    thumbnailOnly = false,
    previewScale = null,
    renderNonRasterPreview = false,
    renderCatalogPreview = false,
  } = options;

  const isNonRasterPreview = /\.(?:ai|eps|psd|psb)$/i.test(String(image?.filename || ""));
  const isSupportedPreview = /\.(?:jpe?g|png|webp|gif|tif|tiff|ai|eps|psd|psb)$/i.test(String(image?.filename || ""));

  if (thumbnailOnly) {
    return getAssetThumbnailUrl(image, { watermark, quality });
  }

  if (
    image?.id &&
    ((renderNonRasterPreview && isNonRasterPreview) ||
      (renderCatalogPreview && isSupportedPreview))
  ) {
    const params = new URLSearchParams();
    if (Number.isFinite(quality)) params.set("quality", String(quality));
    if (watermark) params.set("watermark", "true");
    if (image.thumbnail_generated_at) params.set("v", String(image.thumbnail_generated_at));
    return `${API_BASE_URL}/api/catalog-preview/${image.id}?${params.toString()}`;
  }

  if (useThumbnail && !watermark && preferThumbnail && hasReadyThumbnail(image)) {
    return getAssetThumbnailUrl(image);
  }

  if (!image || !image.id) {
    return "";
  }

  const params = new URLSearchParams();
  if (Number.isFinite(quality)) params.set('quality', String(quality));
  if (watermark) params.set('watermark', 'true');
  if (previewScale === 0.2) params.set('previewScale', '0.2');

  const qs = params.toString();
  return `${API_BASE_URL}/api/images/${image.id}${qs ? `?${qs}` : ''}`;
};

export const getAssetSourceUrl = (image) => {
  if (!image?.id) return "";
  return `${API_BASE_URL.replace(/\/+$/, "")}/api/images/${encodeURIComponent(String(image.id))}`;
};

export const getAssetOriginalDownloadUrl = (imageId) => {
  if (!imageId) return "";
  return `${API_BASE_URL}/images/${imageId}/download-original`;
};
