const axios = require('axios');
const { randomUUID } = require('node:crypto');
const { getAssetServerHttpOrigin } = require('../config');
const { CHUNK_UPLOAD_SIZE_BYTES } = require('./chunkedAssetUpload');

const MAX_REMOTE_UPLOAD_DURATION_MS = 15 * 60 * 1000;
const MAX_REMOTE_UPLOAD_RESPONSE_BYTES = 1024 * 1024;
const MAX_REMOTE_CHUNK_UPLOAD_REQUEST_BYTES = CHUNK_UPLOAD_SIZE_BYTES;

async function readResponseBody(stream) {
  const chunks = [];
  let totalBytes = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    totalBytes += chunk.length;
    if (totalBytes > MAX_REMOTE_UPLOAD_RESPONSE_BYTES) {
      const error = new Error('SERVER upload response exceeded the allowed size.');
      error.code = 'REMOTE_UPLOAD_RESPONSE_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes);
}

function isFinalizedUploadResponse(body) {
  try {
    const result = JSON.parse(body.toString('utf8'));
    return Boolean(
      result &&
      typeof result === 'object' &&
      result.upload_complete === true &&
      result.finalized === true &&
      Number.isSafeInteger(result.id) &&
      result.id > 0 &&
      Number.isSafeInteger(result.file_size) &&
      result.file_size > 0
    );
  } catch (_error) {
    return false;
  }
}

function sendSafeRelayFailure(res, error, hasUpstreamResponse) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const timedOut = isTimeoutError(error);
  const status = timedOut ? 504 : 502;
  return res.status(status).json({
    error: timedOut
      ? 'SERVER upload timed out. Retry this upload to safely resume it.'
      : 'SERVER upload could not be confirmed. Retry this upload to safely resume it.',
    ...(hasUpstreamResponse ? { retryable: true } : {}),
  });
}

function shouldProxyRemoteAssetUpload({
  platform = process.platform,
  allowLocalTestStorage =
    process.env.NODE_ENV === 'test' &&
    process.env.ASSET_UPLOAD_ALLOW_LOCAL_TEST_STORAGE === 'true',
} = {}) {
  return platform === 'darwin' && !allowLocalTestStorage;
}

function getRemoteUploadBaseUrl(value = process.env.PC2_ASSET_SERVER_URL) {
  return getAssetServerHttpOrigin(value);
}

function isTimeoutError(error) {
  return ['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code);
}

function createRemoteAssetUploadProxy({
  verifyUser,
  getAuthorization,
  httpClient = axios,
  shouldProxy = () => shouldProxyRemoteAssetUpload(),
  getBaseUrl = () => getRemoteUploadBaseUrl(),
}) {
  if (typeof verifyUser !== 'function' || typeof getAuthorization !== 'function') {
    throw new TypeError('Remote upload proxy requires authenticated user and SERVER authorization providers.');
  }

  return async function remoteAssetUploadProxy(req, res, next) {
    if (!shouldProxy(req)) return next();
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data;')) {
      return res.status(415).json({ error: 'Asset uploads must use multipart form data.' });
    }

    let response;
    const controller = new AbortController();
    const abortUpstream = () => controller.abort();
    const abortIfClientClosed = () => {
      if (!res.writableFinished) abortUpstream();
    };
    req.once('aborted', abortUpstream);
    res.once('close', abortIfClientClosed);

    try {
      const userId = await verifyUser(req);
      let authorization;
      try {
        authorization = await getAuthorization(userId);
      } catch (error) {
        if (Number.isInteger(error.statusCode)) throw error;
        const authorizationError = new Error('SERVER upload authorization is unavailable.');
        authorizationError.statusCode = 503;
        throw authorizationError;
      }
      const uploadRequestId = String(req.headers['idempotency-key'] || '').trim() || randomUUID();
      const upstreamUrl = `${getBaseUrl()}/upload`;
      response = await httpClient.request({
        method: 'POST',
        url: upstreamUrl,
        data: req,
        responseType: 'stream',
        timeout: MAX_REMOTE_UPLOAD_DURATION_MS,
        maxBodyLength: Infinity,
        maxContentLength: 1024 * 1024,
        maxRedirects: 0,
        signal: controller.signal,
        validateStatus: () => true,
        headers: {
          authorization,
          accept: 'application/json',
          'content-type': req.headers['content-type'],
          ...(req.headers['content-length']
            ? { 'content-length': req.headers['content-length'] }
            : {}),
          'idempotency-key': uploadRequestId,
        },
      });

      const body = await readResponseBody(response.data);
      const isUpstreamSuccess = response.status >= 200 && response.status < 300;
      if (isUpstreamSuccess && (response.status !== 200 || !isFinalizedUploadResponse(body))) {
        return res.status(502).json({
          error: 'SERVER did not confirm that the uploaded original was finalized.',
          retryable: true,
        });
      }

      res.status(response.status);
      const contentType = String(response.headers?.['content-type'] || '').trim();
      if (contentType) res.setHeader('Content-Type', contentType);
      return res.end(body);
    } catch (error) {
      response?.data?.destroy?.();
      if (controller.signal.aborted || req.aborted || res.destroyed) return;
      console.error(`SERVER upload relay failed (${String(error.code || 'UNKNOWN').replace(/[^A-Z0-9_-]/gi, '').slice(0, 32)}).`);
      if (
        error.code === 'REMOTE_UPLOAD_RESPONSE_TOO_LARGE' &&
        Number.isInteger(response?.status) &&
        response.status >= 300 &&
        response.status <= 599
      ) {
        return res.status(response.status).json({
          error: 'SERVER error response exceeded the relay response limit.',
        });
      }
      if (!response && Number.isInteger(error.statusCode)) {
        return res.status(error.statusCode).json({
          error: error.statusCode === 401 ? 'Access denied' : 'SERVER upload authorization is unavailable.',
        });
      }
      return sendSafeRelayFailure(res, error, Boolean(response));
    } finally {
      req.removeListener('aborted', abortUpstream);
      res.removeListener('close', abortIfClientClosed);
    }
  };
}

function createRemoteChunkedUploadProxy({
  verifyUser,
  getAuthorization,
  httpClient = axios,
  shouldProxy = () => shouldProxyRemoteAssetUpload(),
  getBaseUrl = () => getRemoteUploadBaseUrl(),
}) {
  if (typeof verifyUser !== 'function' || typeof getAuthorization !== 'function') {
    throw new TypeError('Remote chunked upload proxy requires authenticated user and SERVER authorization providers.');
  }

  return async function remoteChunkedUploadProxy(req, res, next) {
    if (!shouldProxy(req)) return next();
    const requestPath = String(req.path || '');
    const allowedPath = requestPath === '/upload/chunked/init' ||
      /^\/upload\/chunked\/[a-f0-9]{64}(?:\/parts\/\d+|\/complete)?$/i.test(requestPath);
    if (!allowedPath) return res.status(404).json({ error: 'Chunked upload route not found.' });

    const contentLength = Number(req.headers['content-length']);
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_REMOTE_CHUNK_UPLOAD_REQUEST_BYTES
    ) {
      return res.status(413).json({ error: 'Upload chunk exceeds the maximum allowed chunk size.' });
    }

    let response;
    const controller = new AbortController();
    const abortUpstream = () => controller.abort();
    const abortIfClientClosed = () => {
      if (!res.writableFinished) abortUpstream();
    };
    req.once('aborted', abortUpstream);
    res.once('close', abortIfClientClosed);

    try {
      const userId = await verifyUser(req);
      let authorization;
      try {
        authorization = await getAuthorization(userId);
      } catch (error) {
        if (Number.isInteger(error.statusCode)) throw error;
        const authorizationError = new Error('SERVER upload authorization is unavailable.');
        authorizationError.statusCode = 503;
        throw authorizationError;
      }

      const method = String(req.method || '').toUpperCase();
      const isRawChunk = method === 'PUT' && /\/parts\/\d+$/i.test(requestPath);
      response = await httpClient.request({
        method,
        url: `${getBaseUrl()}${req.originalUrl || requestPath}`,
        data: isRawChunk ? req : (method === 'DELETE' ? undefined : req.body),
        responseType: 'arraybuffer',
        timeout: MAX_REMOTE_UPLOAD_DURATION_MS,
        maxBodyLength: MAX_REMOTE_CHUNK_UPLOAD_REQUEST_BYTES,
        maxContentLength: MAX_REMOTE_UPLOAD_RESPONSE_BYTES,
        maxRedirects: 0,
        signal: controller.signal,
        validateStatus: () => true,
        headers: {
          authorization,
          accept: 'application/json',
          ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
          ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] } : {}),
          ...(req.headers['idempotency-key']
            ? { 'idempotency-key': String(req.headers['idempotency-key']) }
            : {}),
        },
      });

      const body = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data || '');
      if (body.length > MAX_REMOTE_UPLOAD_RESPONSE_BYTES) {
        return res.status(502).json({ error: 'SERVER chunked upload response exceeded the relay limit.' });
      }
      res.status(response.status);
      const contentType = String(response.headers?.['content-type'] || '').trim();
      if (contentType) res.setHeader('Content-Type', contentType);
      return res.end(body);
    } catch (error) {
      if (controller.signal.aborted || req.aborted || res.destroyed) return;
      console.error(`SERVER chunked upload relay failed (${String(error.code || 'UNKNOWN').replace(/[^A-Z0-9_-]/gi, '').slice(0, 32)}).`);
      if (!response && Number.isInteger(error.statusCode)) {
        return res.status(error.statusCode).json({
          error: error.statusCode === 401 ? 'Access denied' : 'SERVER upload authorization is unavailable.',
        });
      }
      const timedOut = isTimeoutError(error);
      return res.status(timedOut ? 504 : 502).json({
        error: timedOut
          ? 'SERVER chunked upload timed out. Retry this upload to safely resume it.'
          : 'SERVER chunked upload could not be confirmed. Retry this upload to safely resume it.',
        ...(response ? { retryable: true } : {}),
      });
    } finally {
      req.removeListener('aborted', abortUpstream);
      res.removeListener('close', abortIfClientClosed);
    }
  };
}

module.exports = {
  MAX_REMOTE_UPLOAD_DURATION_MS,
  MAX_REMOTE_UPLOAD_RESPONSE_BYTES,
  MAX_REMOTE_CHUNK_UPLOAD_REQUEST_BYTES,
  createRemoteAssetUploadProxy,
  createRemoteChunkedUploadProxy,
  getRemoteUploadBaseUrl,
  shouldProxyRemoteAssetUpload,
};
