const fs = require('fs');
const path = require('path');

function normalizeUploadPath(value, baseDir = path.resolve(__dirname, '..')) {
  if (!value || typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('mailto:')) {
    return null;
  }

  let relativePath = trimmed;
  if (relativePath.startsWith('/')) {
    relativePath = relativePath.slice(1);
  } else if (relativePath.startsWith('./')) {
    relativePath = relativePath.slice(2);
  }

  if (!relativePath.startsWith('uploads/')) {
    return null;
  }

  const resolvedPath = path.resolve(baseDir, relativePath);
  const uploadsRoot = path.resolve(baseDir, 'uploads');
  if (!resolvedPath.startsWith(uploadsRoot)) {
    return null;
  }

  return resolvedPath;
}

function extractLocalUploadPaths(body, baseDir = path.resolve(__dirname, '..')) {
  if (!body || typeof body !== 'string') return [];

  const matches = body.matchAll(/(?:src|href)=["']([^"']+)["']/gi);
  const paths = [];

  for (const match of matches) {
    const resolved = normalizeUploadPath(match[1], baseDir);
    if (resolved) paths.push(resolved);
  }

  return [...new Set(paths)];
}

async function deleteReferencedUploadFiles(body, baseDir = path.resolve(__dirname, '..')) {
  const paths = extractLocalUploadPaths(body, baseDir);
  const results = [];

  for (const filePath of paths) {
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      }
      results.push({ filePath, deleted: true });
    } catch (error) {
      results.push({ filePath, deleted: false, error: error.message });
    }
  }

  return results;
}

module.exports = {
  normalizeUploadPath,
  extractLocalUploadPaths,
  deleteReferencedUploadFiles,
};
