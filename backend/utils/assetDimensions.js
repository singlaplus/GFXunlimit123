const fs = require('node:fs/promises');

const parseBoundingBox = (header, name) => {
  const number = '(-?\\d+(?:\\.\\d+)?)';
  const match = header.match(
    new RegExp(`^%%${name}:\\s*${number}\\s+${number}\\s+${number}\\s+${number}\\s*$`, 'm')
  );
  if (!match) return null;
  const [, left, bottom, right, top] = match.map(Number);
  const width = right - left;
  const height = top - bottom;
  return width > 0 && height > 0 ? { width, height } : null;
};

async function getAssetSourceDimensions(filePath, extension) {
  const ext = String(extension || '').toLowerCase();
  const handle = await fs.open(filePath, 'r');
  try {
    if (ext === '.psd' || ext === '.psb') {
      const header = Buffer.alloc(26);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead < header.length || header.toString('ascii', 0, 4) !== '8BPS') return null;
      const version = header.readUInt16BE(4);
      if (version !== 1 && version !== 2) return null;
      const height = header.readUInt32BE(14);
      const width = header.readUInt32BE(18);
      return width > 0 && height > 0 ? { width, height } : null;
    }

    if (ext === '.ai' || ext === '.eps') {
      const header = Buffer.alloc(65536);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      const content = header.toString('latin1', 0, bytesRead);
      const boundingBox = parseBoundingBox(content, 'HiResBoundingBox') ||
        parseBoundingBox(content, 'BoundingBox');
      if (boundingBox) return boundingBox;

      if (ext === '.ai') {
        const match = content.match(
          /\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/
        );
        if (match) {
          const [, left, bottom, right, top] = match.map(Number);
          const width = right - left;
          const height = top - bottom;
          return width > 0 && height > 0 ? { width, height } : null;
        }
      }
    }
    return null;
  } finally {
    await handle.close();
  }
}

module.exports = { getAssetSourceDimensions };
