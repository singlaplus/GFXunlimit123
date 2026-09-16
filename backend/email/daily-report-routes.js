// Daily Report Settings Endpoints
const crypto = require('crypto');
const { sendMail } = require('./mailer');
const pendingReportOtps = new Map();

module.exports = (router, pool, verifyAdminLocal) => {
  let dailyReportSchemaPromise;
  const ensureDailyReportSchema = () => {
    if (!dailyReportSchemaPromise) {
      dailyReportSchemaPromise = (async () => {
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_report_settings JSONB DEFAULT NULL');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS daily_report_schedules (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            time TIME NOT NULL DEFAULT '09:00',
            frequency VARCHAR(50) NOT NULL DEFAULT 'daily',
            last_sent_date DATE,
            report_settings JSONB DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await pool.query('ALTER TABLE daily_report_schedules ADD COLUMN IF NOT EXISTS last_sent_date DATE');
        await pool.query('ALTER TABLE daily_report_schedules ADD COLUMN IF NOT EXISTS report_settings JSONB DEFAULT NULL');
      })().catch((error) => {
        dailyReportSchemaPromise = null;
        throw error;
      });
    }
    return dailyReportSchemaPromise;
  };
  router.post('/daily-report-settings', verifyAdminLocal, async (req, res) => {
    try {
      await ensureDailyReportSchema();
      const { enabled, email, time, metrics, reportSmtp } = req.body || {};
      const userId = req.user;
      const existingSettingsResult = await pool.query('SELECT daily_report_settings FROM users WHERE id = $1', [userId]);
      const existingSettings = existingSettingsResult.rows[0]?.daily_report_settings || {};
      const settingsData = {
        ...existingSettings,
        enabled,
        email,
        time,
        metrics,
        reportSmtp: Object.keys(reportSmtp || {}).length ? reportSmtp : (existingSettings.reportSmtp || {}),
        savedAt: new Date()
      };
      
      try {
        const r = await pool.query(
          'UPDATE users SET daily_report_settings = $1 WHERE id = $2 RETURNING daily_report_settings',
          [JSON.stringify(settingsData), userId]
        );
        
        if (r.rows.length === 0) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ ok: true, settings: r.rows[0].daily_report_settings });
      } catch (colErr) {
        if (colErr.message.includes('daily_report_settings')) {
          await pool.query('ALTER TABLE users ADD COLUMN daily_report_settings JSONB DEFAULT NULL');
          const r = await pool.query(
            'UPDATE users SET daily_report_settings = $1 WHERE id = $2 RETURNING daily_report_settings',
            [JSON.stringify(settingsData), userId]
          );
          res.json({ ok: true, settings: r.rows[0].daily_report_settings });
        } else {
          throw colErr;
        }
      }
    } catch (err) {
      console.error('Error saving daily report settings:', err);
      res.status(500).json({ error: 'Failed to save daily report settings', detail: err.message });
    }
  });

  router.post('/daily-report-schedule/request-otp', verifyAdminLocal, async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'A valid report email is required' });
      }

      const settings = req.body?.reportSmtp || {};
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      pendingReportOtps.set(`${req.user}:${email}`, { otp, expiresAt: Date.now() + 10 * 60 * 1000 });
      await sendMail(settings, {
        to: email,
        subject: 'Daily Report Schedule Verification OTP',
        text: `Your Daily Report scheduling OTP is ${otp}. It expires in 10 minutes.`
      });
      res.json({ ok: true, message: 'OTP sent to the report email' });
    } catch (err) {
      console.error('Failed to send daily report scheduling OTP:', err);
      res.status(500).json({ error: 'Failed to send OTP', detail: err.message });
    }
  });

  router.post('/daily-report-schedule/verify-otp', verifyAdminLocal, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const entry = pendingReportOtps.get(`${req.user}:${email}`);
    if (!entry || entry.expiresAt < Date.now() || String(req.body?.otp || '').trim() !== entry.otp) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }
    pendingReportOtps.delete(`${req.user}:${email}`);
    res.json({ ok: true });
  });
  
  router.get('/daily-report-settings', verifyAdminLocal, async (req, res) => {
    try {
      await ensureDailyReportSchema();
      const userId = req.user;
      
      try {
        const r = await pool.query(
          'SELECT daily_report_settings FROM users WHERE id = $1',
          [userId]
        );
        
        if (r.rows.length === 0) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ ok: true, settings: r.rows[0].daily_report_settings || null });
      } catch (colErr) {
        if (colErr.message.includes('daily_report_settings')) {
          await pool.query('ALTER TABLE users ADD COLUMN daily_report_settings JSONB DEFAULT NULL');
          const r = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
          if (r.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
          }
          res.json({ ok: true, settings: null });
        } else {
          throw colErr;
        }
      }
    } catch (err) {
      console.error('Error loading daily report settings:', err);
      res.status(500).json({ error: 'Failed to load daily report settings', detail: err.message });
    }
  });

  // Daily Report Schedules endpoints
  router.get('/daily-report-schedules', verifyAdminLocal, async (req, res) => {
    try {
      await ensureDailyReportSchema();
      const r = await pool.query(
        'SELECT id, name, time, frequency, report_settings, created_at, updated_at FROM daily_report_schedules ORDER BY created_at DESC'
      );
      res.json({ ok: true, schedules: r.rows || [] });
    } catch (err) {
      console.error('Error loading daily report schedules:', err);
      res.status(500).json({ error: 'Failed to load schedules', detail: err.message });
    }
  });

  router.post('/daily-report-schedules', verifyAdminLocal, async (req, res) => {
    try {
      await ensureDailyReportSchema();
      const { name, time, frequency, reportSettings } = req.body || {};
      
      if (!name || !time || !frequency) {
        return res.status(400).json({ error: 'Name, time, and frequency are required' });
      }

      const r = await pool.query(
        'INSERT INTO daily_report_schedules(name, time, frequency, report_settings) VALUES($1, $2, $3, $4) RETURNING id, name, time, frequency, report_settings, created_at, updated_at',
        [name, time, frequency, reportSettings ? JSON.stringify(reportSettings) : null]
      );
      
      res.json({ ok: true, schedule: r.rows[0] });
    } catch (err) {
      console.error('Error creating daily report schedule:', err);
      res.status(500).json({ error: 'Failed to create schedule', detail: err.message });
    }
  });

  router.put('/daily-report-schedules/:id', verifyAdminLocal, async (req, res) => {
    try {
      await ensureDailyReportSchema();
      const { id } = req.params;
      const { name, time, frequency, reportSettings } = req.body || {};
      
      if (!name || !time || !frequency) {
        return res.status(400).json({ error: 'Name, time, and frequency are required' });
      }

      const r = await pool.query(
        reportSettings
          ? 'UPDATE daily_report_schedules SET name = $1, time = $2, frequency = $3, report_settings = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING id, name, time, frequency, report_settings, created_at, updated_at'
          : 'UPDATE daily_report_schedules SET name = $1, time = $2, frequency = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING id, name, time, frequency, report_settings, created_at, updated_at',
        reportSettings ? [name, time, frequency, JSON.stringify(reportSettings), id] : [name, time, frequency, id]
      );
      
      if (r.rows.length === 0) {
        return res.status(404).json({ error: 'Schedule not found' });
      }

      res.json({ ok: true, schedule: r.rows[0] });
    } catch (err) {
      console.error('Error updating daily report schedule:', err);
      res.status(500).json({ error: 'Failed to update schedule', detail: err.message });
    }
  });

  router.delete('/daily-report-schedules/:id', verifyAdminLocal, async (req, res) => {
    try {
      await ensureDailyReportSchema();
      const { id } = req.params;
      
      const r = await pool.query(
        'DELETE FROM daily_report_schedules WHERE id = $1 RETURNING id',
        [id]
      );
      
      if (r.rows.length === 0) {
        return res.status(404).json({ error: 'Schedule not found' });
      }

      res.json({ ok: true, message: 'Schedule deleted' });
    } catch (err) {
      console.error('Error deleting daily report schedule:', err);
      res.status(500).json({ error: 'Failed to delete schedule', detail: err.message });
    }
  });
};

