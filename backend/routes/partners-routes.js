const express = require("express");
const { validatePrivacyPolicyContent } = require("./privacy-policy-routes");

const PARTNERS_PAGE_ID = "default";

function createPartnersRouter({ pool, verifyAdmin }) {
  const router = express.Router();

  router.get("/partners/content", async (_req, res) => {
    try {
      const result = await pool.query(
        "SELECT content FROM partners_page_settings WHERE id = $1",
        [PARTNERS_PAGE_ID]
      );
      return res.json({ content: result.rows[0]?.content || null });
    } catch (error) {
      console.error("Failed to load published Partners page content", error);
      return res.status(500).json({ error: "Failed to load Partners page content." });
    }
  });

  router.put("/admin/partners/content", verifyAdmin, async (req, res) => {
    const validation = validatePrivacyPolicyContent(req.body, "Partners page");
    if (validation.error) return res.status(400).json({ error: validation.error });

    try {
      const result = await pool.query(
        `INSERT INTO partners_page_settings (id, content, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id) DO UPDATE
         SET content = EXCLUDED.content, updated_at = now()
         RETURNING content`,
        [PARTNERS_PAGE_ID, JSON.stringify(validation.content)]
      );
      return res.json({ content: result.rows[0].content });
    } catch (error) {
      console.error("Failed to save Partners page content", error);
      return res.status(500).json({ error: "Failed to save Partners page content." });
    }
  });

  return router;
}

module.exports = { createPartnersRouter };
