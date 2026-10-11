const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminVerifier } = require('../middleware/createAdminVerifier');

function makeResponse() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createVerifier(user, observed = {}) {
  return createAdminVerifier({
    pool: {
      async query(_sql, parameters) {
        observed.userId = parameters[0];
        return { rows: user ? [user] : [] };
      },
    },
    jwtSecret: 'test-secret',
    verifyToken(token) {
      if (token !== 'valid-token') throw new Error('Invalid token');
      return { user: 23 };
    },
    logger: { log() {}, error() {} },
  });
}

test('admin verifier allows an active administrator and attaches the authenticated user', async () => {
  const observed = {};
  const verifyAdmin = createVerifier({ role: 'admin', status: 'active' }, observed);
  const req = { headers: { authorization: 'Bearer valid-token' } };
  const res = makeResponse();
  let nextCalled = false;

  await verifyAdmin(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.user.id, 23);
  assert.equal(observed.userId, 23);
  assert.equal(res.statusCode, 200);
});

test('admin verifier rejects non-admin, missing-user, and invalid-token requests', async () => {
  for (const user of [
    { role: 'user', status: 'active' },
    { role: 'admin', status: 'inactive' },
    { role: 'admin', status: 'disabled' },
  ]) {
    const response = makeResponse();
    await createVerifier(user)(
      { headers: { authorization: 'Bearer valid-token' } },
      response,
      assert.fail
    );
    assert.equal(response.statusCode, 403);
  }

  const missingUserResponse = makeResponse();
  await createVerifier(null)(
    { headers: { authorization: 'Bearer valid-token' } },
    missingUserResponse,
    assert.fail
  );
  assert.equal(missingUserResponse.statusCode, 404);

  const invalidTokenResponse = makeResponse();
  await createVerifier({ role: 'admin', status: 'active' })(
    { headers: { authorization: 'Bearer invalid-token' } },
    invalidTokenResponse,
    assert.fail
  );
  assert.equal(invalidTokenResponse.statusCode, 401);

  const missingTokenResponse = makeResponse();
  await createVerifier({ role: 'admin', status: 'active' })(
    { headers: {} },
    missingTokenResponse,
    assert.fail
  );
  assert.equal(missingTokenResponse.statusCode, 401);

  const unconfiguredResponse = makeResponse();
  await createAdminVerifier({
    pool: { query: assert.fail },
    jwtSecret: '',
    verifyToken: assert.fail,
    logger: { log() {}, error() {} },
  })(
    { headers: { authorization: 'Bearer valid-token' } },
    unconfiguredResponse,
    assert.fail
  );
  assert.equal(unconfiguredResponse.statusCode, 503);
});
