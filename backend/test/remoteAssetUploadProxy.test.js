const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough, Readable } = require('node:stream');
const {
  MAX_REMOTE_UPLOAD_RESPONSE_BYTES,
  createRemoteAssetUploadProxy,
  shouldProxyRemoteAssetUpload,
} = require('../services/remoteAssetUploadProxy');

function createRequest(headers = {}) {
  const request = Readable.from(['multipart-upload-body']);
  request.headers = {
    authorization: 'Bearer client-token-must-not-be-forwarded',
    'content-type': 'multipart/form-data; boundary=upload-boundary',
    'idempotency-key': 'c99547ed-2ff2-44c6-9fbf-218e3b61f1b9',
    ...headers,
  };
  request.aborted = false;
  return request;
}

function createResponse() {
  const response = new PassThrough();
  const headers = new Map();
  const statusCalls = [];
  let headersSent = false;
  response.statusCode = 200;
  response.statusCalls = statusCalls;
  response.markHeadersSent = () => {
    headersSent = true;
  };
  Object.defineProperty(response, 'headersSent', {
    get: () => headersSent,
  });
  response.setHeader = (name, value) => headers.set(String(name).toLowerCase(), value);
  response.getHeader = (name) => headers.get(String(name).toLowerCase());
  response.status = (status) => {
    statusCalls.push(status);
    response.statusCode = status;
    return response;
  };
  response.json = (body) => {
    response.jsonBody = body;
    headersSent = true;
    response.setHeader('Content-Type', 'application/json');
    response.end();
    return response;
  };
  const end = response.end.bind(response);
  response.end = (...args) => {
    headersSent = true;
    return end(...args);
  };
  return response;
}

test('relays a valid finalized response with server credentials and preserves the idempotency key', async () => {
  let requestOptions;
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => 71,
    getAuthorization: async (userId) => {
      assert.equal(userId, 71);
      return 'Bearer server-generated-owner-token';
    },
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async (options) => {
        requestOptions = options;
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          data: Readable.from(['{"id":254,"file_size":5,"upload_complete":true,"finalized":true}']),
        };
      },
    },
  });
  const req = createRequest();
  const res = createResponse();
  const responseBodyPromise = new Promise((resolve) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });

  await middleware(req, res, () => {
    throw new Error('Remote upload should not fall through to local storage.');
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('Content-Type'), 'application/json');
  assert.equal(await responseBodyPromise, '{"id":254,"file_size":5,"upload_complete":true,"finalized":true}');
  assert.equal(requestOptions.url, 'http://127.0.0.1:5000/upload');
  assert.equal(requestOptions.headers.authorization, 'Bearer server-generated-owner-token');
  assert.notEqual(requestOptions.headers.authorization, req.headers.authorization);
  assert.equal(requestOptions.headers['idempotency-key'], req.headers['idempotency-key']);
  assert.equal(requestOptions.data, req);
});

test('rejects an unauthenticated remote upload before contacting SERVER', async () => {
  let upstreamCalled = false;
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => {
      const error = new Error('Access denied');
      error.statusCode = 401;
      throw error;
    },
    getAuthorization: async () => 'Bearer unused',
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async () => {
        upstreamCalled = true;
        throw new Error('must not be called');
      },
    },
  });
  const req = createRequest();
  const res = createResponse();

  await middleware(req, res, () => {});
  assert.equal(res.statusCode, 401);
  assert.equal(upstreamCalled, false);
  assert.deepEqual(res.jsonBody, {
    error: 'Access denied',
  });
});

test('rejects a successful HTTP response that does not confirm a finalized original', async () => {
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => 71,
    getAuthorization: async () => '******',
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: Readable.from(['{"id":254,"upload_complete":true}']),
      }),
    },
  });
  const req = createRequest();
  const res = createResponse();

  await middleware(req, res, () => {});
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.jsonBody, {
    error: 'SERVER did not confirm that the uploaded original was finalized.',
    retryable: true,
  });
});

test('rejects an unexpected 2xx status even when the body claims finalization', async () => {
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => 71,
    getAuthorization: async () => '******',
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async () => ({
        status: 202,
        headers: { 'content-type': 'application/json' },
        data: Readable.from(['{"id":254,"file_size":5,"upload_complete":true,"finalized":true}']),
      }),
    },
  });
  const req = createRequest();
  const res = createResponse();

  await middleware(req, res, () => {});
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.jsonBody, {
    error: 'SERVER did not confirm that the uploaded original was finalized.',
    retryable: true,
  });
});

test('does not set success status or headers until the complete response body validates', async () => {
  const upstreamBody = new PassThrough();
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => 71,
    getAuthorization: async () => '******',
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: upstreamBody,
      }),
    },
  });
  const req = createRequest();
  const res = createResponse();
  const responseBodyPromise = new Promise((resolve) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });

  const relayPromise = middleware(req, res, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(res.statusCalls, []);
  assert.equal(res.getHeader('content-type'), undefined);

  upstreamBody.write('{"id":254,"file_size":5,"upload_complete":true,');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(res.statusCalls, []);

  upstreamBody.end('"finalized":true}');
  await relayPromise;
  assert.deepEqual(res.statusCalls, [200]);
  assert.equal(res.getHeader('content-type'), 'application/json');
  assert.equal(await responseBodyPromise, '{"id":254,"file_size":5,"upload_complete":true,"finalized":true}');
});

test('returns a safe JSON error when the upstream response stream fails before headers are sent', async () => {
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => 71,
    getAuthorization: async () => '******',
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: Readable.from((async function* () {
          yield '{"id":254,';
          const error = new Error('private stream detail');
          error.code = 'ECONNRESET';
          throw error;
        })()),
      }),
    },
  });
  const req = createRequest();
  const res = createResponse();

  await middleware(req, res, () => {});
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.jsonBody, {
    error: 'SERVER upload could not be confirmed. Retry this upload to safely resume it.',
    retryable: true,
  });
  assert.doesNotMatch(JSON.stringify(res.jsonBody), /private|ECONNRESET/);
});

test('terminates the client response when an upstream failure occurs after headers are already sent', async () => {
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => 71,
    getAuthorization: async () => '******',
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: Readable.from((async function* () {
          const error = new Error('private stream detail');
          error.code = 'ECONNRESET';
          throw error;
        })()),
      }),
    },
  });
  const req = createRequest();
  const res = createResponse();
  res.markHeadersSent();

  await middleware(req, res, () => {});
  assert.equal(res.destroyed, true);
  assert.equal(res.jsonBody, undefined);
});

test('returns a safe JSON error for an oversized successful upstream response body', async () => {
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => 71,
    getAuthorization: async () => '******',
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: Readable.from([
          Buffer.alloc(MAX_REMOTE_UPLOAD_RESPONSE_BYTES / 2, 0x61),
          Buffer.alloc(MAX_REMOTE_UPLOAD_RESPONSE_BYTES / 2, 0x61),
          Buffer.from('x'),
        ]),
      }),
    },
  });
  const req = createRequest();
  const res = createResponse();

  await middleware(req, res, () => {});
  assert.equal(res.statusCode, 502);
  assert.equal(res.jsonBody.error, 'SERVER upload could not be confirmed. Retry this upload to safely resume it.');
  assert.doesNotMatch(JSON.stringify(res.jsonBody), /allowed size|REMOTE_UPLOAD/);
});

for (const status of [413, 422]) {
  test(`preserves upstream HTTP ${status} when its error body exceeds the response limit`, async () => {
    const upstreamBody = Readable.from([
      Buffer.alloc(MAX_REMOTE_UPLOAD_RESPONSE_BYTES, 0x61),
      Buffer.from('one byte over limit'),
    ]);
    const middleware = createRemoteAssetUploadProxy({
      verifyUser: async () => 71,
      getAuthorization: async () => '******',
      shouldProxy: () => true,
      getBaseUrl: () => 'http://127.0.0.1:5000',
      httpClient: {
        request: async () => ({
          status,
          headers: { 'content-type': 'application/json' },
          data: upstreamBody,
        }),
      },
    });
    const req = createRequest();
    const res = createResponse();

    await middleware(req, res, () => {});

    assert.equal(res.statusCode, status);
    assert.deepEqual(res.jsonBody, {
      error: 'SERVER error response exceeded the relay response limit.',
    });
    assert.equal(upstreamBody.destroyed, true);
  });
}

for (const [name, body] of [
  ['malformed JSON', '{"id":254,"file_size":5'],
  ['missing asset ID', '{"file_size":5,"upload_complete":true,"finalized":true}'],
  ['invalid asset ID', '{"id":"not-an-id","file_size":5,"upload_complete":true,"finalized":true}'],
  ['zero file size', '{"id":254,"file_size":0,"upload_complete":true,"finalized":true}'],
  ['invalid file size', '{"id":254,"file_size":"unknown","upload_complete":true,"finalized":true}'],
]) {
  test(`rejects successful upstream response with ${name}`, async () => {
    const middleware = createRemoteAssetUploadProxy({
      verifyUser: async () => 71,
      getAuthorization: async () => '******',
      shouldProxy: () => true,
      getBaseUrl: () => 'http://127.0.0.1:5000',
      httpClient: {
        request: async () => ({
          status: 200,
          headers: { 'content-type': 'application/json' },
          data: Readable.from([body]),
        }),
      },
    });
    const req = createRequest();
    const res = createResponse();

    await middleware(req, res, () => {});
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.jsonBody, {
      error: 'SERVER did not confirm that the uploaded original was finalized.',
      retryable: true,
    });
  });
}

test('preserves SERVER rejection status and response body', async () => {
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => 71,
    getAuthorization: async () => '******',
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async () => ({
        status: 413,
        headers: { 'content-type': 'application/json' },
        data: Readable.from(['{"error":"File is too large."}']),
      }),
    },
  });
  const req = createRequest();
  const res = createResponse();
  const responseBodyPromise = new Promise((resolve) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });

  await middleware(req, res, () => {});
  assert.equal(res.statusCode, 413);
  assert.equal(await responseBodyPromise, '{"error":"File is too large."}');
});

test('returns a service-unavailable response when SERVER authorization cannot be created', async () => {
  let upstreamCalled = false;
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => 71,
    getAuthorization: async () => {
      throw new Error('private authorization detail');
    },
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async () => {
        upstreamCalled = true;
        throw new Error('must not be called');
      },
    },
  });
  const req = createRequest();
  const res = createResponse();

  await middleware(req, res, () => {});
  assert.equal(res.statusCode, 503);
  assert.equal(upstreamCalled, false);
  assert.deepEqual(res.jsonBody, {
    error: 'SERVER upload authorization is unavailable.',
  });
  assert.doesNotMatch(JSON.stringify(res.jsonBody), /private authorization detail/);
});

test('reports transport failures as retryable relay failures without exposing request credentials', async () => {
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => 71,
    getAuthorization: async () => '******',
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async () => {
        const error = new Error('connect ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        throw error;
      },
    },
  });
  const req = createRequest();
  const res = createResponse();

  await middleware(req, res, () => {});
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.jsonBody, {
    error: 'SERVER upload could not be confirmed. Retry this upload to safely resume it.',
  });
  assert.doesNotMatch(JSON.stringify(res.jsonBody), /Bearer|secret|ECONNREFUSED/);
});

test('maps upstream timeouts to a safe gateway-timeout response', async () => {
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => 71,
    getAuthorization: async () => '******',
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async () => {
        const error = new Error('private timeout detail');
        error.code = 'ETIMEDOUT';
        throw error;
      },
    },
  });
  const req = createRequest();
  const res = createResponse();

  await middleware(req, res, () => {});
  assert.equal(res.statusCode, 504);
  assert.deepEqual(res.jsonBody, {
    error: 'SERVER upload timed out. Retry this upload to safely resume it.',
  });
  assert.doesNotMatch(JSON.stringify(res.jsonBody), /private|ETIMEDOUT/);
});

test('aborts the upstream relay when the client disconnects', async () => {
  let upstreamSignal;
  const middleware = createRemoteAssetUploadProxy({
    verifyUser: async () => 71,
    getAuthorization: async () => '******',
    shouldProxy: () => true,
    getBaseUrl: () => 'http://127.0.0.1:5000',
    httpClient: {
      request: async (options) => {
        upstreamSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.code = 'ERR_CANCELED';
            reject(error);
          }, { once: true });
        });
      },
    },
  });
  const req = createRequest();
  const res = createResponse();
  const relayPromise = middleware(req, res, () => {});

  await new Promise((resolve) => setImmediate(resolve));
  req.emit('aborted');
  await relayPromise;

  assert.equal(upstreamSignal.aborted, true);
  assert.deepEqual(res.statusCalls, []);
  assert.equal(res.jsonBody, undefined);
});

test('proxies all macOS uploads unless explicit test-only local storage is enabled', () => {
  assert.equal(shouldProxyRemoteAssetUpload({
    platform: 'darwin',
    assetsRoot: '/Users/developer/local-assets',
    allowLocalTestStorage: false,
  }), true);
  assert.equal(shouldProxyRemoteAssetUpload({ platform: 'darwin', allowLocalTestStorage: true }), false);
  assert.equal(shouldProxyRemoteAssetUpload({ platform: 'win32', allowLocalTestStorage: false }), false);
});
