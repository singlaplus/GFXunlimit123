function parseEpsDimensions(header) {
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

function parsePsdDimensions(buffer) {
  if (buffer.byteLength < 26) return null;

  const signature = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  const view = new DataView(buffer);
  const version = view.getUint16(4, false);
  if (signature !== "8BPS" || (version !== 1 && version !== 2)) return null;

  const height = view.getUint32(14, false);
  const width = view.getUint32(18, false);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function getAssetSourceDimensions(buffer, filename) {
  const extension = String(filename || "").split(".").pop()?.toLowerCase();
  if (["psd", "psb"].includes(extension)) return parsePsdDimensions(buffer);

  const header = Array.from(new Uint8Array(buffer), (byte) => String.fromCharCode(byte)).join("");
  const epsDimensions = parseEpsDimensions(header);
  if (epsDimensions) return epsDimensions;

  if (extension === "ai") {
    const mediaBox = header.match(/\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/);
    if (mediaBox) {
      const [, left, bottom, right, top] = mediaBox.map(Number);
      const width = right - left;
      const height = top - bottom;
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return { width, height };
      }
    }
  }

  return null;
}
