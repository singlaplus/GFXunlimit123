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
      if (req.body?.destinationMode && !['server', 'mac-local'].includes(req.body.destinationMode)) {
        return res.status(422).json({ error: 'Backup destination mode is invalid.' });
      }
      const isClientExport = req.body?.destinationMode === 'mac-local';
      const plan = isClientExport
        ? await service.buildClientExportPlan({ categories: req.body?.categories })
        : await service.buildPlan({
            categories: req.body?.categories,
            destinations: req.body?.destinations
          });
      const response = service.publicPlan(plan);
      if (isClientExport) {
        response.drives = response.drives.map((drive) => ({
          ...drive,
          path: 'Mac-local export staging'
        }));
      }
      res.json(response);
    } catch (error) {
      res.status(422).json({ error: error.message || 'Backup planning failed.' });
    }
  });

  router.post('/start', async (req, res) => {
    try {
      if (req.body?.destinationMode && !['server', 'mac-local'].includes(req.body.destinationMode)) {
        return res.status(422).json({ error: 'Backup destination mode is invalid.' });
      }
      const job = await service.createJob({
        categories: req.body?.categories,
        destinations: req.body?.destinations,
        applicationVersion: req.body?.applicationVersion,
        destinationMode: req.body?.destinationMode || 'server'
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

  router.get('/jobs/:id/export', async (req, res) => {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid backup job ID.' });
    }
    try {
      res.json({ files: await service.getClientExportFiles(req.params.id) });
    } catch (error) {
      res.status(404).json({ error: error.message || 'Verified Mac-local backup export is unavailable.' });
    }
  });

  router.get('/jobs/:id/export/file', async (req, res) => {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid backup job ID.' });
    }
    try {
      const file = await service.openClientExportFile(req.params.id, req.query.path);
      res.status(200);
      res.type('application/octet-stream');
      res.setHeader('Content-Length', String(file.sizeBytes));
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="backup-file"; filename*=UTF-8''${encodeURIComponent(file.filename)}`
      );
      file.stream.on('error', (error) => {
        if (res.headersSent) res.destroy(error);
        else res.status(500).json({ error: 'Manual backup file transfer failed.' });
      });
      file.stream.pipe(res);
    } catch (error) {
      res.status(404).json({ error: error.message || 'Verified manual backup file is unavailable.' });
    }
  });

  router.delete('/jobs/:id/export', async (req, res) => {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid backup job ID.' });
    }
    try {
      await service.deleteClientExport(req.params.id);
      res.status(204).end();
    } catch (error) {
      res.status(404).json({ error: error.message || 'Manual backup staging data could not be removed.' });
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
