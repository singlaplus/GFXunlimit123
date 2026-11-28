const express = require("express");
const { validatePrivacyPolicyContent } = require("./privacy-policy-routes");

const DEVELOPERS_PAGE_ID = "default";

function createDevelopersRouter({ pool, verifyAdmin }) {
  const router = express.Router();

  router.get("/developers/content", async (_req, res) => {
    try {
      const result = await pool.query(
        "SELECT content FROM developers_page_settings WHERE id = $1",
        [DEVELOPERS_PAGE_ID]
      );
      return res.json({ content: result.rows[0]?.content || null });
    } catch (error) {
      console.error("Failed to load published Developers page content", error);
      return res.status(500).json({ error: "Failed to load Developers page content." });
    }
  });

  router.put("/admin/developers/content", verifyAdmin, async (req, res) => {
    const validation = validatePrivacyPolicyContent(req.body, "Developers page");
    if (validation.error) return res.status(400).json({ error: validation.error });

    try {
      const result = await pool.query(
        `INSERT INTO developers_page_settings (id, content, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id) DO UPDATE
         SET content = EXCLUDED.content, updated_at = now()
         RETURNING content`,
        [DEVELOPERS_PAGE_ID, JSON.stringify(validation.content)]
      );
      return res.json({ content: result.rows[0].content });
    } catch (error) {
      console.error("Failed to save Developers page content", error);
      return res.status(500).json({ error: "Failed to save Developers page content." });
    }
  });

  return router;
}

module.exports = { createDevelopersRouter };
