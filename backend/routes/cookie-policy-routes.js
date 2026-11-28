const express = require("express");
const { validatePrivacyPolicyContent } = require("./privacy-policy-routes");

const COOKIE_POLICY_ID = "default";

function createCookiePolicyRouter({ pool, verifyAdmin }) {
  const router = express.Router();

  router.get("/cookie-policy/content", async (_req, res) => {
    try {
      const result = await pool.query(
        "SELECT content FROM cookie_policy_settings WHERE id = $1",
        [COOKIE_POLICY_ID]
      );
      return res.json({ content: result.rows[0]?.content || null });
    } catch (error) {
      console.error("Failed to load published Cookie Policy content", error);
      return res.status(500).json({ error: "Failed to load Cookie Policy content." });
    }
  });

  router.put("/admin/cookie-policy/content", verifyAdmin, async (req, res) => {
    const validation = validatePrivacyPolicyContent(req.body, "Cookie Policy");
    if (validation.error) return res.status(400).json({ error: validation.error });

    try {
      const result = await pool.query(
        `INSERT INTO cookie_policy_settings (id, content, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id) DO UPDATE
         SET content = EXCLUDED.content, updated_at = now()
         RETURNING content`,
        [COOKIE_POLICY_ID, JSON.stringify(validation.content)]
      );
      return res.json({ content: result.rows[0].content });
    } catch (error) {
      console.error("Failed to save Cookie Policy content", error);
      return res.status(500).json({ error: "Failed to save Cookie Policy content." });
    }
  });

  return router;
}

module.exports = { createCookiePolicyRouter };
