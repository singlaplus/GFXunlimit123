const LOCAL_ORIGIN = "http://redirect-rules.local";

const normalizePathname = (pathname) => {
  const normalized = String(pathname || "").replace(/\/+$/, "");
  return normalized || "/";
};

const normalizeRedirectFrom = (value) => {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("//")) throw new TypeError("Redirect From must be an internal path.");

  let parsed;
  try {
    parsed = new URL(raw, LOCAL_ORIGIN);
  } catch (_error) {
    throw new TypeError("Redirect From must be a valid internal path.");
  }

  if (parsed.origin !== LOCAL_ORIGIN || parsed.hash) {
    throw new TypeError("Redirect From must be an internal path without a hash.");
  }

  return `${normalizePathname(parsed.pathname)}${parsed.search}`;
};

const normalizeRedirectTo = (value) => {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("//") || /^(javascript|data|vbscript):/i.test(raw)) {
    throw new TypeError("Redirect To must be a safe HTTP(S) URL or internal path.");
  }

  let parsed;
  try {
    parsed = new URL(raw, LOCAL_ORIGIN);
  } catch (_error) {
    throw new TypeError("Redirect To must be a valid URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol) && parsed.origin !== LOCAL_ORIGIN) {
    throw new TypeError("Redirect To must be a safe HTTP(S) URL or internal path.");
  }

  if (parsed.origin === LOCAL_ORIGIN) {
    return `${normalizePathname(parsed.pathname)}${parsed.search}${parsed.hash}`;
  }

  return parsed.href;
};

const createRedirectRulesService = (pool) => ({
  async list() {
    const result = await pool.query(`
      SELECT id, redirect_from, redirect_to, created_at, updated_at
      FROM redirect_rules
      ORDER BY id ASC
    `);
    return result.rows;
  },

  async create(redirectFrom, redirectTo) {
    const normalizedFrom = normalizeRedirectFrom(redirectFrom);
    const normalizedTo = normalizeRedirectTo(redirectTo);
    if (normalizedFrom === normalizedTo) {
      throw new TypeError("Redirect From and Redirect To cannot be the same.");
    }

    const result = await pool.query(`
      INSERT INTO redirect_rules (redirect_from, redirect_to)
      VALUES ($1, $2)
      RETURNING id, redirect_from, redirect_to, created_at, updated_at
    `, [normalizedFrom, normalizedTo]);
    return result.rows[0];
  },

  async remove(id) {
    const result = await pool.query("DELETE FROM redirect_rules WHERE id = $1 RETURNING id", [id]);
    return result.rowCount > 0;
  },

  async find(pathWithSearch) {
    const normalized = normalizeRedirectFrom(pathWithSearch);
    const pathname = normalizeRedirectFrom(normalized.split("?")[0]);
    const result = await pool.query(`
      SELECT id, redirect_from, redirect_to
      FROM redirect_rules
      WHERE redirect_from = $1 OR redirect_from = $2
      ORDER BY CASE WHEN redirect_from = $1 THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `, [normalized, pathname]);
    return result.rows[0] || null;
  },
});

module.exports = {
  createRedirectRulesService,
  normalizeRedirectFrom,
  normalizeRedirectTo,
};
