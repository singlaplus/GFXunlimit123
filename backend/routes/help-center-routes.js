const express = require("express");
const { validatePrivacyPolicyContent } = require("./privacy-policy-routes");

const HELP_CENTER_ID = "default";

function createHelpCenterRouter({ pool, verifyAdmin }) {
  const router = express.Router();

  router.get("/help-center/content", async (_req, res) => {
    try {
      const result = await pool.query(
        "SELECT content FROM help_center_settings WHERE id = $1",
        [HELP_CENTER_ID]
      );
      return res.json({ content: result.rows[0]?.content || null });
    } catch (error) {
      console.error("Failed to load published Help Center content", error);
      return res.status(500).json({ error: "Failed to load Help Center content." });
    }
  });

  router.put("/admin/help-center/content", verifyAdmin, async (req, res) => {
    const validation = validatePrivacyPolicyContent(req.body, "Help Center");
    if (validation.error) return res.status(400).json({ error: validation.error });

    try {
      const result = await pool.query(
        `INSERT INTO help_center_settings (id, content, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id) DO UPDATE
         SET content = EXCLUDED.content, updated_at = now()
         RETURNING content`,
        [HELP_CENTER_ID, JSON.stringify(validation.content)]
      );
      return res.json({ content: result.rows[0].content });
    } catch (error) {
      console.error("Failed to save Help Center content", error);
      return res.status(500).json({ error: "Failed to save Help Center content." });
    }
  });

  return router;
}

module.exports = { createHelpCenterRouter };
