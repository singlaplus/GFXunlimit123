const axios = require('axios');
const { pipeline } = require('node:stream/promises');
const { parseThumbnailAssetId } = require('./assetThumbnails');

const THUMBNAIL_PROXY_TIMEOUT_MS = 10000;

function shouldProxyRemoteThumbnail(platform = process.platform) {
  return platform === 'darwin';
}

function buildRemoteThumbnailUrl(baseUrl, assetId) {
  const numericAssetId = parseThumbnailAssetId(assetId);
  if (numericAssetId === null) throw new Error('Invalid asset ID for remote thumbnail');

  const base = new URL(String(baseUrl || ''));
  const hostname = base.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
    hostname === '0.0.0.0'
  ) {
    throw new Error('PC2_ASSET_SERVER_URL must be a valid non-local HTTP(S) origin');
  }

  return `${base.origin}/api/assets/${numericAssetId}/thumbnail`;
}

function destroyResponseStream(response) {
  if (response?.data && typeof response.data.destroy === 'function') {
    response.data.destroy();
  }
}

function isTimeoutError(error) {
  return error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT';
}

async function proxyRemoteThumbnail({
  req,
  res,
  assetId,
  authorization,
  cacheControl,
  contentDisposition,
  baseUrl = process.env.PC2_ASSET_SERVER_URL,
  httpClient = axios,
  timeoutMs = THUMBNAIL_PROXY_TIMEOUT_MS,
}) {
  if (!String(baseUrl || '').trim()) {
    return res.status(503).json({ error: 'Remote thumbnail service is not configured' });
  }

  let url;
  try {
    url = buildRemoteThumbnailUrl(baseUrl, assetId);
  } catch (error) {
    console.error(`Invalid remote thumbnail configuration: ${error.message}`);
    return res.status(503).json({ error: 'Remote thumbnail service is unavailable' });
  }
  const incomingHost = String(req.headers.host || '').toLowerCase();
  if (incomingHost && new URL(url).host.toLowerCase() === incomingHost) {
    console.error('Remote thumbnail configuration points back to this backend');
    return res.status(503).json({ error: 'Remote thumbnail service is unavailable' });
  }

  const headers = {};
  if (typeof authorization === 'string' && /^Bearer [^\s]+$/.test(authorization)) {
    headers.authorization = authorization;
  }

  try {
    const response = await httpClient.get(url, {
      responseType: 'stream',
      decompress: false,
      timeout: timeoutMs,
      maxRedirects: 0,
      validateStatus: () => true,
      headers,
    });

    if (response.status === 302) {
      const location = String(response.headers?.location || '');
      const legacyLocation = new URL(location, 'http://localhost');
      if (
        legacyLocation.origin === 'http://localhost' &&
        legacyLocation.pathname === '/api/thumbnail' &&
        legacyLocation.searchParams.has('file')
      ) {
        destroyResponseStream(response);
        res.setHeader('Location', `${legacyLocation.pathname}${legacyLocation.search}`);
        return res.status(302).end();
      }
      destroyResponseStream(response);
      return res.status(502).json({ error: 'Remote thumbnail service returned an invalid response' });
    }

    if (response.status === 404 || response.status === 403) {
      destroyResponseStream(response);
      return res.status(response.status).json({
        error: response.status === 404 ? 'Thumbnail not found' : 'Access denied',
      });
    }

    if (response.status < 200 || response.status >= 300) {
      destroyResponseStream(response);
      return res.status(502).json({ error: 'Remote thumbnail service is unavailable' });
    }

    const contentType = String(response.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'image/webp') {
      destroyResponseStream(response);
      return res.status(502).json({ error: 'Remote thumbnail service returned an invalid response' });
    }

    res.status(response.status);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', cacheControl);
    if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
    const contentLength = String(response.headers?.['content-length'] || '');
    if (/^\d+$/.test(contentLength)) res.setHeader('Content-Length', contentLength);
    for (const header of ['content-encoding', 'etag', 'last-modified']) {
      const value = response.headers?.[header];
      if (typeof value === 'string') res.setHeader(header, value);
    }

    await pipeline(response.data, res);
  } catch (error) {
    console.error(`Remote thumbnail request failed for asset ${assetId}: ${error.message}`);
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    return res.status(isTimeoutError(error) ? 504 : 502).json({
      error: isTimeoutError(error)
        ? 'Remote thumbnail service timed out'
        : 'Remote thumbnail service is unavailable',
    });
  }
}

module.exports = {
  THUMBNAIL_PROXY_TIMEOUT_MS,
  buildRemoteThumbnailUrl,
  proxyRemoteThumbnail,
  shouldProxyRemoteThumbnail,
};
