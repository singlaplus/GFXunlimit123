const express = require("express");
const { validatePrivacyPolicyContent } = require("./privacy-policy-routes");

const TERMS_AND_CONDITIONS_ID = "default";

function createTermsAndConditionsRouter({ pool, verifyAdmin }) {
  const router = express.Router();

  router.get("/terms-and-conditions/content", async (_req, res) => {
    try {
      const result = await pool.query(
        "SELECT content FROM terms_and_conditions_settings WHERE id = $1",
        [TERMS_AND_CONDITIONS_ID]
      );
      return res.json({ content: result.rows[0]?.content || null });
    } catch (error) {
      console.error("Failed to load published Terms & Conditions content", error);
      return res.status(500).json({ error: "Failed to load Terms & Conditions content." });
    }
  });

  router.put("/admin/terms-and-conditions/content", verifyAdmin, async (req, res) => {
    const validation = validatePrivacyPolicyContent(req.body, "Terms & Conditions");
    if (validation.error) return res.status(400).json({ error: validation.error });

    try {
      const result = await pool.query(
        `INSERT INTO terms_and_conditions_settings (id, content, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id) DO UPDATE
         SET content = EXCLUDED.content, updated_at = now()
         RETURNING content`,
        [TERMS_AND_CONDITIONS_ID, JSON.stringify(validation.content)]
      );
      return res.json({ content: result.rows[0].content });
    } catch (error) {
      console.error("Failed to save Terms & Conditions content", error);
      return res.status(500).json({ error: "Failed to save Terms & Conditions content." });
    }
  });

  return router;
}

module.exports = { createTermsAndConditionsRouter };
