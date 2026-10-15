function createAdminVerifier({ pool, jwtSecret, verifyToken, logger = console }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('Admin verifier requires a database pool.');
  }
  if (typeof verifyToken !== 'function') {
    throw new TypeError('Admin verifier requires a token verifier.');
  }

  return async function verifyAdmin(req, res, next) {
    try {
      if (!jwtSecret) {
        return res.status(503).json('Backup authentication is not configured');
      }

      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json('Access denied');

      const token = authHeader.split(' ')[1];
      const decoded = verifyToken(token);
      logger.log('========== VERIFY ADMIN ==========');
      logger.log('Decoded Token:', decoded);

      const user = await pool.query(
        `SELECT role, status
         FROM users
         WHERE id = $1`,
        [decoded.user]
      );
      logger.log('Database User:', user.rows);

      if (user.rows.length === 0) return res.status(404).json('User not found');

      logger.log('User Role:', user.rows[0].role);
      if (
        user.rows[0].role !== 'admin' ||
        user.rows[0].status === 'inactive' ||
        user.rows[0].status === 'disabled'
      ) {
        return res.status(403).json('Admin access only');
      }

      req.user = { id: decoded.user, sessionId: decoded.sid };
      return next();
    } catch (error) {
      logger.error(error);
      return res.status(401).json('Invalid token');
    }
  };
}

module.exports = { createAdminVerifier };
