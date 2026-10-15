const express = require('express');
const axios = require('axios');
const crypto = require('node:crypto');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { getAssetServerHttpOrigin } = require('../config');
const { createBackupService, getDefaultClientExportRoot } = require('../services/backupSystem');
const { createRestorePackageService, getDefaultRestoreTemporaryRoot } = require('../services/restorePackageSystem');

function createBackupRouter({ pool, verifyAdmin, projectRoot, serviceOptions = {} }) {
  const router = express.Router();
  const artifactDownloadTickets = new Map();
  const artifactDownloadTicketTtlMs = 60 * 1000;
  const maxArtifactDownloadTickets = 1000;

  function getArtifactDownloadTicket(req) {
    const queryIndex = req.originalUrl.indexOf('?');
    if (queryIndex < 0) return null;
    return new URLSearchParams(req.originalUrl.slice(queryIndex + 1)).get('ticket');
  }

  function getTicketBindingCookieName(ticket) {
    const digest = crypto.createHash('sha256').update(ticket).digest('hex');
    return `stocksite_restore_download_${digest}`;
  }

  function getCookieValue(cookieHeader, name) {
    for (const cookie of String(cookieHeader || '').split(';')) {
      const separator = cookie.indexOf('=');
      if (separator >= 0 && cookie.slice(0, separator).trim() === name) {
        return cookie.slice(separator + 1).trim();
      }
    }
    return null;
  }

  function ticketBindingCookieHeader(cookieHeader, ticket) {
    const name = getTicketBindingCookieName(ticket);
    const value = getCookieValue(cookieHeader, name);
    return value === null ? undefined : `${name}=${value}`;
  }

  function removeTicketBindingCookies(cookieHeader) {
    const cookies = String(cookieHeader || '')
      .split(';')
      .map((cookie) => cookie.trim())
      .filter((cookie) => cookie && !cookie.startsWith('stocksite_restore_download_'));
    return cookies.length ? cookies.join('; ') : undefined;
  }

  function ticketBindingMatches(expectedDigest, proof) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(proof || '')) return false;
    const actualDigest = crypto.createHash('sha256').update(proof).digest();
    const expected = Buffer.from(expectedDigest, 'hex');
    return expected.length === actualDigest.length && crypto.timingSafeEqual(expected, actualDigest);
  }

  router.use((req, res, next) => {
    const isArtifactDownload = /^\/restore-package\/jobs\/[A-Za-z0-9-]{1,120}\/artifacts\/[A-Za-z0-9-]{1,120}$/.test(req.path);
    const isArtifactTicket = /^\/restore-package\/jobs\/[A-Za-z0-9-]{1,120}\/artifacts\/[A-Za-z0-9-]{1,120}\/download-ticket$/.test(req.path);
    if (isArtifactDownload || isArtifactTicket) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
    }
    const hasTicketedArtifactGet =
      isArtifactDownload &&
      req.method === 'GET' &&
      /^[A-Za-z0-9_-]{43}$/.test(getArtifactDownloadTicket(req) || '');
    if (!hasTicketedArtifactGet && req.headers.cookie) {
      req.headers.cookie = removeTicketBindingCookies(req.headers.cookie);
    }
    if (hasTicketedArtifactGet && !req.headers.authorization) {
      return next();
    }
    if (
      isArtifactDownload &&
      !req.headers.authorization &&
      ['GET', 'HEAD'].includes(req.method) &&
      req.cookies?.authToken
    ) {
      req.headers.authorization = `Bearer ${req.cookies.authToken}`;
    }
    return verifyAdmin(req, res, next);
  });

  if ((serviceOptions.platform || process.platform) === 'darwin') {
    const environment = serviceOptions.environment || process.env;
    const httpClient = serviceOptions.httpClient || axios;
    router.use(async (req, res) => {
      let response;
      const controller = new AbortController();
      const abortUpstream = () => controller.abort();
      const abortIfClientClosed = () => {
        if (!res.writableFinished) abortUpstream();
      };
      req.once('aborted', abortUpstream);
      res.once('close', abortIfClientClosed);

      try {
        let serverOrigin;
        try {
          serverOrigin = getAssetServerHttpOrigin(environment.PC2_ASSET_SERVER_URL);
        } catch (_error) {
          return res.status(503).json({
            error: 'SERVER backup service is not configured; no local backup was started.'
          });
        }
        const upstreamUrl = new URL(req.originalUrl, `${serverOrigin}/`);
        if (
          upstreamUrl.origin !== serverOrigin ||
          (upstreamUrl.pathname !== '/admin/backup' && !upstreamUrl.pathname.startsWith('/admin/backup/'))
        ) {
          return res.status(400).json({ error: 'Invalid Backup Center request.' });
        }

        const ticketedArtifactGet =
          req.method === 'GET' &&
          /^\/restore-package\/jobs\/[A-Za-z0-9-]{1,120}\/artifacts\/[A-Za-z0-9-]{1,120}$/.test(req.path) &&
          /^[A-Za-z0-9_-]{43}$/.test(getArtifactDownloadTicket(req) || '');
        const forwardedCookie = ticketedArtifactGet
          ? ticketBindingCookieHeader(req.headers.cookie, getArtifactDownloadTicket(req))
          : removeTicketBindingCookies(req.headers.cookie);

        response = await httpClient.request({
          method: req.method,
          url: upstreamUrl.toString(),
          data: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
          responseType: 'stream',
          timeout: 0,
          maxRedirects: 0,
          signal: controller.signal,
          validateStatus: () => true,
          headers: {
            ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
            ...(forwardedCookie ? { cookie: forwardedCookie } : {}),
            ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
            ...(req.headers.accept ? { accept: req.headers.accept } : {})
          }
        });

        if (
          response.status === 404 &&
          upstreamUrl.pathname.startsWith('/admin/backup/restore-package/') &&
          response.headers?.['x-stocksite-error-code'] === 'RESTORE_PACKAGE_ENDPOINT_NOT_FOUND'
        ) {
          response.data?.destroy?.();
          return res.status(503).json({
            error: 'Restore package endpoints are not available on the configured SERVER. Update the SERVER backend to a version that supports restore-package routes; no package job was started.'
          });
        }

        res.status(response.status);
        for (const header of [
          'content-type',
          'content-length',
          'content-disposition',
          'cache-control',
          'etag',
          'x-content-type-options',
          'referrer-policy'
        ]) {
          const value = response.headers?.[header];
          if (value) res.setHeader(header, value);
        }
        if (
          response.headers?.['set-cookie'] &&
          (
            (
              req.method === 'POST' &&
              /^\/restore-package\/jobs\/[A-Za-z0-9-]{1,120}\/artifacts\/[A-Za-z0-9-]{1,120}\/download-ticket$/.test(req.path)
            ) ||
            (req.method === 'GET' && ticketedArtifactGet)
          )
        ) {
          res.setHeader('Set-Cookie', response.headers['set-cookie']);
        }
        await pipeline(response.data, res);
      } catch (_error) {
        response?.data?.destroy?.();
        if (controller.signal.aborted || req.aborted || res.destroyed) return;
        if (res.headersSent) {
          res.destroy();
          return;
        }
        res.status(502).json({
          error: 'Configured SERVER backup service could not be reached; no local backup was started.'
        });
      } finally {
        req.removeListener('aborted', abortUpstream);
        res.removeListener('close', abortIfClientClosed);
      }
    });
    return router;
  }

  const platform = serviceOptions.platform || process.platform;
  const temporaryRoot = serviceOptions.temporaryRoot || getDefaultRestoreTemporaryRoot(platform);
  const clientExportRoot = serviceOptions.clientExportRoot || getDefaultClientExportRoot(platform);
  const stateDirectory = serviceOptions.stateDirectory || path.resolve(__dirname, '..', 'backup-system');
  const service = createBackupService({
    ...serviceOptions,
    clientExportRoot,
    database: pool,
    projectRoot: projectRoot || path.resolve(__dirname, '../..')
  });
  const restorePackages = createRestorePackageService({
    ...(serviceOptions.restorePackageOptions || {}),
    backupService: service,
    stateDirectory: path.join(stateDirectory, 'restore-packages'),
    temporaryRoot,
    clientExportRoot,
    outputRoot: serviceOptions.restorePackageOptions?.outputRoot || path.join(clientExportRoot, 'GFXunlimit')
  });

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

  router.get('/automatic/browse', async (req, res) => {
    try {
      res.json(await service.browseAutomaticDestination(req.query.path || ''));
    } catch (error) {
      res.status(422).json({ error: error.message || 'Automatic backup destination folders could not be listed.' });
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

  router.post('/restore-package/start', async (req, res) => {
    try {
      if (req.body?.includeEncryptedEnvironmentFiles !== true) {
        return res.status(400).json({ error: 'Explicit administrator authorization is required before encrypted .env configuration can be included.' });
      }
      res.status(202).json({ job: await restorePackages.start({ includeEncryptedEnvironmentFiles: true }) });
    } catch (error) {
      res.status(409).json({ error: error.message || 'Restore package preparation could not be started.' });
    }
  });

  router.get('/restore-package/jobs/:id', async (req, res) => {
    if (!/^[A-Za-z0-9-]{1,120}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid restore package job ID.' });
    }
    try {
      const job = await restorePackages.getJob(req.params.id);
      if (!job) return res.status(404).json({ error: 'Restore package job not found.' });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ job });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Restore package status could not be loaded.' });
    }
  });

  router.head('/restore-package/jobs/:id/artifacts/:artifactId', async (req, res) => {
    if (!/^[A-Za-z0-9-]{1,120}$/.test(req.params.id)) {
      return res.status(400).end();
    }
    try {
      const artifact = await restorePackages.openArtifact(req.params.id, req.params.artifactId);
      artifact.stream.destroy();
      res.type('application/octet-stream');
      res.setHeader('Content-Length', String(artifact.sizeBytes));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${artifact.filename}"; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`
      );
      return res.status(200).end();
    } catch (error) {
      return res.status(404).end();
    }
  });

  router.post('/restore-package/jobs/:id/artifacts/:artifactId/download-ticket', async (req, res) => {
    const userId = req.user?.id;
    const sessionId = req.user?.sessionId;
    if (!userId || typeof sessionId !== 'string' || !sessionId) {
      return res.status(401).json({ error: 'A valid administrator session is required to authorize this download.' });
    }
    if (!/^[A-Za-z0-9-]{1,120}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid restore package job ID.' });
    }
    try {
      const artifact = await restorePackages.openArtifact(req.params.id, req.params.artifactId);
      artifact.stream.destroy();

      const now = Date.now();
      for (const [key, ticket] of artifactDownloadTickets) {
        if (ticket.expiresAt <= now) artifactDownloadTickets.delete(key);
      }
      if (artifactDownloadTickets.size >= maxArtifactDownloadTickets) {
        return res.status(503).json({ error: 'Too many pending artifact downloads. Wait briefly and retry.' });
      }

      const token = crypto.randomBytes(32).toString('base64url');
      const digest = crypto.createHash('sha256').update(token).digest('hex');
      const bindingProof = crypto.randomBytes(32).toString('base64url');
      const bindingCookieName = getTicketBindingCookieName(token);
      const artifactPath = `${req.baseUrl}${req.path.replace(/\/download-ticket$/, '')}`;
      artifactDownloadTickets.set(digest, {
        jobId: req.params.id,
        artifactId: req.params.artifactId,
        userId: String(userId),
        sessionId,
        bindingProofDigest: crypto.createHash('sha256').update(bindingProof).digest('hex'),
        expiresAt: now + artifactDownloadTicketTtlMs
      });
      res.cookie(bindingCookieName, bindingProof, {
        httpOnly: true,
        secure: (serviceOptions.environment || process.env).NODE_ENV === 'production',
        sameSite: 'strict',
        path: artifactPath,
        maxAge: artifactDownloadTicketTtlMs
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      return res.status(201).json({
        ticket: token,
        filename: artifact.filename,
        sizeBytes: artifact.sizeBytes
      });
    } catch (error) {
      return res.status(404).json({ error: error.message || 'Verified restore package artifact is unavailable.' });
    }
  });

  router.get('/restore-package/jobs/:id/artifacts/:artifactId', async (req, res) => {
    if (!/^[A-Za-z0-9-]{1,120}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid restore package job ID.' });
    }
    try {
      const ticket = getArtifactDownloadTicket(req);
      if (ticket) {
        const digest = crypto.createHash('sha256').update(ticket).digest('hex');
        const issued = artifactDownloadTickets.get(digest);
        const bindingCookieName = getTicketBindingCookieName(ticket);
        const bindingProof = getCookieValue(req.headers.cookie, bindingCookieName);
        if (
          !issued ||
          issued.expiresAt <= Date.now() ||
          issued.jobId !== req.params.id ||
          issued.artifactId !== req.params.artifactId ||
          !ticketBindingMatches(issued.bindingProofDigest, bindingProof) ||
          (req.user && (
            String(req.user.id) !== issued.userId ||
            req.user.sessionId !== issued.sessionId
          ))
        ) {
          return res.status(403).json({ error: 'This artifact download authorization is invalid, expired, or already used. Request a new download.' });
        }
        artifactDownloadTickets.delete(digest);
        const artifactPath = `${req.baseUrl}${req.path}`;
        res.clearCookie(bindingCookieName, {
          httpOnly: true,
          secure: (serviceOptions.environment || process.env).NODE_ENV === 'production',
          sameSite: 'strict',
          path: artifactPath
        });
      }
      const artifact = await restorePackages.openArtifact(req.params.id, req.params.artifactId);
      res.status(200);
      res.type('application/octet-stream');
      res.setHeader('Content-Length', String(artifact.sizeBytes));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${artifact.filename}"; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`
      );
      artifact.stream.on('error', (error) => {
        if (res.headersSent) res.destroy(error);
        else res.status(500).json({ error: 'Restore package artifact transfer failed.' });
      });
      await pipeline(artifact.stream, res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      res.status(404).json({ error: error.message || 'Verified restore package artifact is unavailable.' });
    }
  });

  router.all('/restore-package/start', (req, res) => {
    res.status(405).json({ error: 'Method not allowed for restore package start endpoint.' });
  });
  router.all('/restore-package/jobs/:id', (req, res) => {
    res.status(405).json({ error: 'Method not allowed for restore package job endpoint.' });
  });
  router.all('/restore-package/jobs/:id/artifacts/:artifactId', (req, res) => {
    res.status(405).json({ error: 'Method not allowed for restore package artifact endpoint.' });
  });

  router.get('/automatic', async (req, res) => {
    try {
      const result = await service.getAutomaticSchedule();
      res.json({ ...result, schedule: result, schedules: result.schedules || [result] });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Automatic backup schedule could not be loaded.' });
    }
  });

  router.put('/automatic', async (req, res) => {
    try {
      const result = Array.isArray(req.body?.schedules)
        ? await service.saveAutomaticSchedules(req.body.schedules)
        : await service.saveAutomaticSchedule(req.body || {});
      res.json({ ...result, schedule: result, schedules: result.schedules || [result] });
    } catch (error) {
      res.status(422).json({ error: error.message || 'Automatic backup schedule could not be saved.' });
    }
  });

  router.delete('/automatic/:id', async (req, res) => {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Invalid automatic backup schedule ID.' });
    }
    try {
      const result = await service.deleteAutomaticSchedule(req.params.id);
      res.json({ ...result, schedule: result, schedules: result.schedules || [] });
    } catch (error) {
      res.status(409).json({ error: error.message || 'Automatic backup schedule could not be deleted.' });
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

  router.use('/restore-package', (req, res) => {
    res.setHeader('X-Stocksite-Error-Code', 'RESTORE_PACKAGE_ENDPOINT_NOT_FOUND');
    res.status(404).json({
      code: 'RESTORE_PACKAGE_ENDPOINT_NOT_FOUND',
      error: 'Restore package endpoint not found.'
    });
  });

  router.use((req, res) => {
    res.status(404).json({ error: 'Backup endpoint not found.' });
  });

  return router;
}

module.exports = { createBackupRouter };
