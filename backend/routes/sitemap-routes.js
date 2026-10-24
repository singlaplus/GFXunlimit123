const express = require("express");
const path = require("node:path");
const { SitemapGenerationError } = require("../services/sitemapGenerator");

function createSitemapRouter({ generator, schedule, verifyAdmin }) {
  const router = express.Router();

  router.get("/admin/sitemap-schedule", verifyAdmin, (req, res) => {
    try {
      return res.json(schedule.getSettings());
    } catch (error) {
      console.error("Unable to load sitemap schedule", error);
      return res.status(500).json({ error: "Unable to load sitemap schedule." });
    }
  });

  router.put("/admin/sitemap-schedule", verifyAdmin, (req, res) => {
    try {
      return res.json(schedule.save(req.body));
    } catch (error) {
      if (error instanceof TypeError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("Unable to save sitemap schedule", error);
      return res.status(500).json({ error: "Unable to save sitemap schedule." });
    }
  });

  router.post("/admin/sitemap/generation", verifyAdmin, (req, res) => {
    try {
      return res.status(202).json({ job: generator.start() });
    } catch (error) {
      if (error instanceof SitemapGenerationError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Unable to start sitemap generation", error);
      return res.status(500).json({ error: "Unable to start sitemap generation." });
    }
  });

  router.get("/admin/sitemap/generation", verifyAdmin, async (req, res) => {
    try {
      return res.json({ job: await generator.getCurrent() });
    } catch (error) {
      console.error("Unable to load sitemap generation status", error);
      return res.status(500).json({ error: "Unable to load sitemap generation status." });
    }
  });

  router.get("/admin/sitemap/generation/:jobId", verifyAdmin, (req, res) => {
    const job = generator.getStatus(req.params.jobId);
    return job
      ? res.json({ job })
      : res.status(404).json({ error: "Sitemap generation job not found." });
  });

  const downloadLatest = async (req, res, jobId) => {
    try {
      const filePath = await generator.getDownloadPath(jobId);
      if (!filePath) {
        return res.status(404).json({
          error: jobId ? "Completed sitemap not found." : "No sitemap has been generated yet.",
        });
      }
      res.type("application/xml");
      res.set("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
      return res.sendFile(filePath, (error) => {
        if (error && !res.headersSent) {
          console.error("Unable to download the generated sitemap", error);
          res.status(500).json({ error: "Unable to download the generated sitemap." });
        }
      });
    } catch (error) {
      console.error("Unable to download the generated sitemap", error);
      return res.status(500).json({ error: "Unable to download the generated sitemap." });
    }
  };

  router.get("/admin/sitemap/download", verifyAdmin, (req, res) => downloadLatest(req, res));
  router.get("/admin/sitemap/download/:jobId", verifyAdmin, (req, res) => downloadLatest(req, res, req.params.jobId));

  router.get("/sitemap.xml", async (req, res) => {
    try {
      const published = await generator.getPublished();
      if (!published) {
        return res.status(404).type("text/plain").send("A sitemap has not been generated yet.");
      }
      res.type("application/xml");
      res.set("Cache-Control", "public, max-age=300");
      return res.sendFile(published.primaryPath, (error) => {
        if (error && !res.headersSent) {
          console.error("Unable to serve the published sitemap", error);
          res.status(404).type("text/plain").send("The published sitemap is unavailable.");
        }
      });
    } catch (error) {
      console.error("Unable to serve the published sitemap", error);
      return res.status(500).type("text/plain").send("Unable to serve the published sitemap.");
    }
  });

  router.get("/sitemap-archive/:archiveId/:filename", async (req, res) => {
    try {
      const filePath = await generator.getArchiveFile(req.params.archiveId, req.params.filename);
      if (!filePath) return res.status(404).type("text/plain").send("Sitemap file not found.");
      res.type("application/xml");
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      return res.sendFile(filePath, (error) => {
        if (error && !res.headersSent) {
          console.error("Unable to serve an archived sitemap", error);
          res.status(404).type("text/plain").send("Sitemap file not found.");
        }
      });
    } catch (error) {
      console.error("Unable to serve an archived sitemap", error);
      return res.status(500).type("text/plain").send("Unable to serve the sitemap file.");
    }
  });

  return router;
}

module.exports = { createSitemapRouter };
