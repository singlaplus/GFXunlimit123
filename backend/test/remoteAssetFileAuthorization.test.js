const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareRemoteAssetFileAuthorization } = require('../services/remoteAssetFileAuthorization');

test('creates trusted SERVER authorization for a locally authorized cookie-authenticated owner', async () => {
  let requestedUserId;
  let authenticatedUserId;
  const result = await prepareRemoteAssetFileAuthorization({
    getRequesterId: () => authenticatedUserId,
    isPublic: false,
    authorizeLocal: async () => {
      authenticatedUserId = 41;
      return true;
    },
    getAuthorization: async (userId) => {
      requestedUserId = userId;
      return 'Bearer trusted-server-token';
    },
  });

  assert.deepEqual(result, {
    authorized: true,
    authorization: 'Bearer trusted-server-token',
  });
  assert.equal(requestedUserId, 41);
});

test('uses the verified requester identity for bearer-authenticated private access', async () => {
  const result = await prepareRemoteAssetFileAuthorization({
    getRequesterId: () => 52,
    isPublic: false,
    authorizeLocal: async () => true,
    getAuthorization: async (userId) => `Bearer trusted-user-${userId}`,
  });

  assert.equal(result.authorization, 'Bearer trusted-user-52');
});

test('does not create or forward authorization for unauthorized or public requests', async () => {
  let authCalls = 0;
  const denied = await prepareRemoteAssetFileAuthorization({
    getRequesterId: () => 41,
    isPublic: false,
    authorizeLocal: async () => false,
    getAuthorization: async () => {
      authCalls += 1;
      return 'Bearer trusted';
    },
  });
  const publicResult = await prepareRemoteAssetFileAuthorization({
    isPublic: true,
    authorizeLocal: async () => true,
    getAuthorization: async () => {
      authCalls += 1;
      return 'Bearer trusted';
    },
  });

  assert.deepEqual(denied, { authorized: false, authorization: null });
  assert.deepEqual(publicResult, { authorized: true, authorization: null });
  assert.equal(authCalls, 0);
});

test('fails closed if a private SERVER credential cannot be produced', async () => {
  await assert.rejects(
    prepareRemoteAssetFileAuthorization({
      getRequesterId: () => 41,
      isPublic: false,
      authorizeLocal: async () => true,
      getAuthorization: async () => { throw new Error('session unavailable'); },
    }),
    {
      message: 'Private SERVER asset authorization is unavailable.',
      statusCode: 503,
    }
  );
});
