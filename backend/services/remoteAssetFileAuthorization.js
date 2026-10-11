async function prepareRemoteAssetFileAuthorization({
  getRequesterId,
  isPublic,
  authorizeLocal,
  getAuthorization,
}) {
  if (!(await authorizeLocal())) return { authorized: false, authorization: null };
  if (isPublic) return { authorized: true, authorization: null };

  const userId = Number(getRequesterId());
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    const error = new Error('Private SERVER asset authorization is unavailable.');
    error.statusCode = 503;
    throw error;
  }
  let authorization;
  try {
    authorization = await getAuthorization(userId);
  } catch (_error) {
    const error = new Error('Private SERVER asset authorization is unavailable.');
    error.statusCode = 503;
    throw error;
  }
  if (typeof authorization !== 'string' || !/^Bearer\s+\S+$/i.test(authorization)) {
    const error = new Error('Private SERVER asset authorization is unavailable.');
    error.statusCode = 503;
    throw error;
  }
  return { authorized: true, authorization };
}

module.exports = { prepareRemoteAssetFileAuthorization };
