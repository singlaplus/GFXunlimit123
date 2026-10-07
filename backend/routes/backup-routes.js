const express = require('express');
const path = require('node:path');
const { createBackupService } = require('../services/backupSystem');

function createBackupRouter({ pool, verifyAdmin, projectRoot, serviceOptions = {} }) {
  const router = express.Router();
  const service = createBackupService({
    ...serviceOptions,
    database: pool,
    projectRoot: projectRoot || path.resolve(__dirname, '../..')
  });
  router.use(verifyAdmin);

  router.get('/sources', async (req, res) => {
    try {
      res.json({ sources: await service.getSourceMetrics() });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Backup source measurements failed.' });
    }
  });

  router.get('/browse', async (req, res) => {
    try {
      res.json(await service.browseDestination(req.query.path || ''));
    } catch (error) {
      res.status(422).json({ error: error.message || 'PC2 destination folders could not be listed.' });
    }
  });

  router.post('/test-connection', async (req, res) => {
    try {
      const paths = Array.isArray(req.body?.destinations)
        ? req.body.destinations
        : [req.body?.path];
      const drives = await service.testDriveSet(paths);
      res.json({ drives });
    } catch (error) {
      res.status(422).json({ error: error.message || 'Destination test failed.' });
    }
  });

  router.post('/plan', async (req, res) => {
    try {
      const plan = await service.buildPlan({
        categories: req.body?.categories,
        destinations: req.body?.destinations
      });
      res.json(service.publicPlan(plan));
    } catch (error) {
      res.status(422).json({ error: error.message || 'Backup planning failed.' });
    }
  });

  router.post('/start', async (req, res) => {
    try {
      const job = await service.createJob({
        categories: req.body?.categories,
        destinations: req.body?.destinations,
        applicationVersion: req.body?.applicationVersion
      });
      res.status(202).json(job);
    } catch (error) {
      res.status(409).json({ error: error.message || 'Backup could not be started.' });
    }
  });

  router.get('/automatic', async (req, res) => {
    try {
      res.json({ schedule: await service.getAutomaticSchedule() });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Automatic backup schedule could not be loaded.' });
    }
  });

  router.put('/automatic', async (req, res) => {
    try {
      res.json({ schedule: await service.saveAutomaticSchedule(req.body || {}) });
    } catch (error) {
      res.status(422).json({ error: error.message || 'Automatic backup schedule could not be saved.' });
    }
  });

  router.get('/jobs/active', async (req, res) => {
    try {
      res.json({ job: await service.getActiveJob() });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Active backup job could not be loaded.' });
    }
  });

  router.get('/jobs/:id', async (req, res) => {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid backup job ID.' });
    }
    try {
      const job = await service.getJob(req.params.id);
      if (!job) return res.status(404).json({ error: 'Backup job not found.' });
      res.json({ job });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Backup job status could not be loaded.' });
    }
  });

  router.get('/history', async (req, res) => {
    try {
      res.json({ jobs: await service.getHistory() });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Backup history could not be loaded.' });
    }
  });

  router.use((req, res) => {
    res.status(404).json({ error: 'Backup endpoint not found.' });
  });

  return router;
}

module.exports = { createBackupRouter };
