function createContributorOfferBenefitApprovalHandler(pool) {
  return async (req, res) => {
    const applicationId = Number(req.params.applicationId);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return res.status(400).json({ error: "Invalid Contributor Offer application." });
    }

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const applicationResult = await client.query(
        `SELECT applications.id, applications.contributor_id, applications.status,
                applications.benefit_earning_id, applications.benefit_approved_at,
                campaigns.metadata->>'benefit_type' AS benefit_type,
                campaigns.metadata->>'benefit_value' AS benefit_value
         FROM contributor_offer_applications applications
         JOIN marketing_campaigns campaigns ON campaigns.id = applications.offer_id
         WHERE applications.id = $1
         FOR UPDATE OF applications`,
        [applicationId]
      );
      const application = applicationResult.rows[0];
      if (!application) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Contributor Offer application not found." });
      }
      if (application.benefit_type !== "bonus_payout") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Only bonus payout benefits can be approved here." });
      }

      const benefitAmount = Number(application.benefit_value);
      if (!Number.isFinite(benefitAmount) || benefitAmount <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "This offer does not have a valid bonus payout amount." });
      }

      if (application.benefit_earning_id) {
        await client.query("COMMIT");
        return res.json({
          application: {
            id: application.id,
            status: application.status,
            benefit_approved: true,
            benefit_amount: benefitAmount,
            benefit_earning_id: application.benefit_earning_id,
            benefit_approved_at: application.benefit_approved_at
          },
          alreadyApproved: true
        });
      }
      if (application.status !== "completed") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Only completed applications can receive an approved benefit." });
      }

      const earningResult = await client.query(
        `INSERT INTO earnings (contributor_id, amount, currency, commission_rate, status, created_at)
         VALUES ($1, $2, 'INR', 0, 'pending', NOW())
         RETURNING id, amount, currency, status, created_at`,
        [application.contributor_id, benefitAmount]
      );
      const earning = earningResult.rows[0];
      await client.query(
        `UPDATE contributor_offer_applications
         SET status = 'ended', benefit_earning_id = $1, benefit_approved_at = NOW()
         WHERE id = $2`,
        [earning.id, applicationId]
      );
      await client.query("COMMIT");
      return res.json({
        application: {
          id: application.id,
          status: "ended",
          benefit_approved: true,
          benefit_amount: Number(earning.amount),
          benefit_earning_id: earning.id,
          benefit_approved_at: earning.created_at
        },
        alreadyApproved: false
      });
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Failed to roll back Contributor Offer benefit approval", rollbackError);
        }
      }
      console.error("Failed to approve Contributor Offer benefit", error);
      return res.status(500).json({ error: "Failed to approve Contributor Offer benefit." });
    } finally {
      client?.release();
    }
  };
}

function registerContributorOfferBenefitRoutes(app, pool, verifyAdmin) {
  app.post(
    "/admin/promotions/applications/:applicationId/approve-benefit",
    verifyAdmin,
    createContributorOfferBenefitApprovalHandler(pool)
  );
}

module.exports = {
  createContributorOfferBenefitApprovalHandler,
  registerContributorOfferBenefitRoutes
};
