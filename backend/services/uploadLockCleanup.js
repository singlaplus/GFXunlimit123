async function releaseUploadLocks({
  client,
  advisoryLockAcquired,
  lockKey,
  requestId,
  releaseContributorLock,
  logger = console,
}) {
  let unlockFailed = false;
  let unlockError;
  try {
    try {
      if (advisoryLockAcquired && client) {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext($1))",
          [lockKey]
        );
      }
    } catch (error) {
      unlockFailed = true;
      unlockError = error;
      logger.error(`Could not release upload idempotency lock ${requestId}:`, error);
    }
  } finally {
    try {
      if (unlockFailed) client?.release(unlockError);
      else client?.release();
    } catch (error) {
      logger.error(`Could not release upload database client ${requestId}:`, error);
    } finally {
      try {
        releaseContributorLock();
      } catch (error) {
        logger.error(`Could not release contributor upload lock ${requestId}:`, error);
      }
    }
  }
}

module.exports = { releaseUploadLocks };
