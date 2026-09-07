import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { getEffectiveAuthToken } from '../utils/authSession';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

export default function AdminEmailSettings() {
  const [settings, setSettings] = useState({ enabled_queue: true, smtp_secure: false });
  const [message, setMessage] = useState('');
  const [testTo, setTestTo] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDark, setIsDark] = useState(typeof document !== 'undefined' && document.body.classList.contains('dark-mode'));

  useEffect(() => {
    const update = () => setIsDark(typeof document !== 'undefined' && document.body.classList.contains('dark-mode'));
    update();
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      const mo = new MutationObserver(() => update());
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      return () => mo.disconnect();
    }
    return undefined;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
        if (!token) {
          setMessage('Admin login is required to load email settings');
          return;
        }
        const res = await axios.get(`${API_BASE_URL}/admin/email/settings`, { headers: { Authorization: `Bearer ${token}` } });
        setSettings(res.data || {});
      } catch (err) {
        console.error(err);
        setMessage('Failed to load email settings: ' + (err.response?.data || err.message || 'Unauthorized'));
      }
    })();
  }, []);

  const getErrorMessage = (err, fallback = 'Unknown error') => {
    const payload = err?.response?.data;
    if (payload && typeof payload === 'object') {
      if (payload.detail) return payload.detail;
      if (payload.error) return payload.error;
      return JSON.stringify(payload);
    }
    if (typeof payload === 'string') return payload;
    return err?.message || fallback;
  };

  const save = async () => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      if (!token) {
        setMessage('Save failed: Admin login required');
        return;
      }
      const res = await axios.post(`${API_BASE_URL}/admin/email/settings`, settings, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data?.error) {
        setMessage('Save failed: ' + res.data.error);
      } else {
        setSettings(res.data);
        setMessage('Settings saved');
      }
      setTimeout(() => setMessage(''), 2500);
    } catch (err) {
      console.error(err);
      setMessage('Save failed: ' + getErrorMessage(err));
    }
  };

  const verify = async () => {
    if (!settings.smtp_host) {
      setMessage('Verify failed: SMTP host is required');
      return;
    }
    if (!settings.smtp_user && !settings.sender_email) {
      setMessage('Verify failed: SMTP user or sender email is required');
      return;
    }

    const verifyPayload = {
      provider: settings.provider || 'smtp',
      smtp_host: settings.smtp_host,
      smtp_port: Number(settings.smtp_port) || undefined,
      smtp_user: settings.smtp_user || settings.sender_email,
      smtp_pass: settings.smtp_pass,
      smtp_secure: !!settings.smtp_secure,
      auth_required: settings.auth_required !== false,
      connection_timeout: Number(settings.connection_timeout) || 10000,
    };

    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      if (!token) {
        setMessage('Verify failed: Admin login required');
        return;
      }
      setIsVerifying(true);
      setMessage('Verifying SMTP connection...');
      const res = await axios.post(`${API_BASE_URL}/admin/email/verify`, verifyPayload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMessage('Verify success: ' + (res.data?.status || 'connected'));
    } catch (err) {
      console.error(err);
      setMessage('Verify failed: ' + getErrorMessage(err));
    } finally {
      setIsVerifying(false);
      setTimeout(() => setMessage(''), 5000);
    }
  };

  const sendTest = async () => {
    const trimmedTo = (testTo || '').trim();
    if (!trimmedTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedTo)) {
      setMessage('Test failed: Please enter a valid recipient email');
      return;
    }

    const indiaDateTime = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: true,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      if (!token) {
        setMessage('Test failed: Admin login required');
        return;
      }
      setIsSending(true);
      setMessage('Sending test email...');
      await axios.post(
        `${API_BASE_URL}/admin/email/send-test`,
        {
          provider: settings.provider || 'smtp',
          smtp_host: settings.smtp_host,
          smtp_port: Number(settings.smtp_port) || undefined,
          smtp_user: settings.smtp_user || settings.sender_email,
          smtp_pass: settings.smtp_pass,
          smtp_secure: !!settings.smtp_secure,
          auth_required: settings.auth_required !== false,
          connection_timeout: Number(settings.connection_timeout) || 10000,
          sender_name: settings.sender_name,
          sender_email: settings.sender_email,
          reply_to: settings.reply_to,
          to: trimmedTo,
          subject: `GFXunlimit: Test Email on ${indiaDateTime}`,
          body: `<!DOCTYPE html>
            <html>
              <body style="font-family: Arial, sans-serif; margin:0; padding:0; background:#f4f6f8;">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px; margin:20px auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 20px 40px rgba(0,0,0,0.08);">
                  <tr>
                    <td style="padding:24px; background:#0d47a1; color:#ffffff; text-align:center;">
                      <h1 style="margin:0; font-size:24px;">GFXunlimit: Test Email</h1>
                      <p style="margin:8px 0 0; font-size:14px; opacity:0.85;">You’re receiving this infographic-style test email from your admin settings.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:24px;">
                      <p style="margin:0 0 16px; font-size:16px; color:#333;">Here is a quick snapshot of your email engine:</p>
                      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                        <tr>
                          <td style="padding:16px; background:#e3f2fd; border-radius:12px;">
                            <strong style="display:block; font-size:14px; margin-bottom:8px;">SMTP Host</strong>
                            <span style="font-size:14px; color:#0d47a1;">${settings.smtp_host || 'smtp.hostinger.com'}</span>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:16px; background:#f3e5f5; border-radius:12px; margin-top:12px;">
                            <strong style="display:block; font-size:14px; margin-bottom:8px;">IMAP Host</strong>
                            <span style="font-size:14px; color:#6a1b9a;">${settings.imap_host || 'imap.hostinger.com'}</span>
                          </td>
                        </tr>
                      </table>
                      <div style="margin:24px 0; padding:18px; background:#e8f5e9; border-radius:12px;">
                        <h2 style="margin:0 0 10px; font-size:18px; color:#2e7d32;">Infographic Summary</h2>
                        <ul style="margin:0; padding-left:18px; color:#444; font-size:14px;">
                          <li>SMTP secure: ${settings.smtp_secure ? 'Enabled' : 'Disabled'}</li>
                          <li>IMAP secure: ${settings.imap_secure ? 'Enabled' : 'Disabled'}</li>
                          <li>Sender: ${settings.sender_email || 'no-reply@localhost'}</li>
                        </ul>
                      </div>
                      <p style="margin:0; font-size:14px; color:#555;">If you see this message, your admin email settings are actively sending a styled test email.</p>
                    </td>
                  </tr>
                </table>
              </body>
            </html>`,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessage('Test email sent successfully');
    } catch (err) {
      console.error(err);
      setMessage('Test failed: ' + getErrorMessage(err));
    } finally {
      setIsSending(false);
      setTimeout(() => setMessage(''), 5000);
    }
  };

  const fieldStyle = {
    padding: '10px 12px',
    borderRadius: 10,
    border: isDark ? '1px solid rgba(148,163,184,0.24)' : '1px solid #d6d6d6',
    fontSize: 14,
    outline: 'none',
    background: isDark ? 'rgba(15,23,42,0.72)' : '#fff',
    color: isDark ? '#f8fafc' : '#0f172a',
    boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.02)'
  };
  const labelStyle = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: isDark ? '#e2e8f0' : '#333' };
  const sectionStyle = {
    background: isDark ? 'rgba(15,23,42,0.82)' : '#fbfbfb',
    padding: 12,
    borderRadius: 12,
    border: isDark ? '1px solid rgba(148,163,184,0.16)' : '1px solid #f0f0f0'
  };
  const pageStyle = {
    padding: 20,
    background: isDark ? 'linear-gradient(135deg, rgba(2,6,23,0.96), rgba(15,23,42,0.98))' : '#fff',
    color: isDark ? '#f8fafc' : '#0f172a',
    borderRadius: 18
  };

  return (
    <div style={pageStyle}>
      <h2 style={{ marginBottom: 8, color: isDark ? '#f8fafc' : '#0f172a' }}>Email Configuration</h2>
      <p style={{ margin: '0 0 16px 0', color: isDark ? '#cbd5e1' : '#555', maxWidth: 820 }}>Configure Name, Email ID, Incoming IMAP details, and Outgoing SMTP details with ports.</p>
      <div style={{ display: 'grid', gap: 12, maxWidth: 820 }}>
        <div style={sectionStyle}>
          <h3 style={{ margin: '0 0 12px 0' }}>Sender Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={labelStyle}>
              Name
              <input placeholder="e.g. Acme Support" style={fieldStyle} value={settings.sender_name || ''} onChange={e => setSettings({ ...settings, sender_name: e.target.value })} />
            </label>
            <label style={labelStyle}>
              Email ID
              <input placeholder="support@yourdomain.com" style={fieldStyle} value={settings.sender_email || ''} onChange={e => setSettings({ ...settings, sender_email: e.target.value })} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <label style={labelStyle}>
              Reply-to Email
              <input placeholder="reply@yourdomain.com" style={fieldStyle} value={settings.reply_to || ''} onChange={e => setSettings({ ...settings, reply_to: e.target.value })} />
            </label>
            <label style={labelStyle}>
              Provider
              <select style={{ ...fieldStyle, padding: '10px' }} value={settings.provider || 'smtp'} onChange={e => setSettings({ ...settings, provider: e.target.value })}>
                <option value="smtp">SMTP</option>
                <option value="gmail">Gmail</option>
                <option value="sendgrid">SendGrid</option>
                <option value="resend">Resend</option>
                <option value="mailgun">Mailgun</option>
              </select>
            </label>
          </div>
        </div>

        <div style={sectionStyle}>
          <h3 style={{ margin: '0 0 12px 0' }}>Outgoing SMTP</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={labelStyle}>
              SMTP Host
              <input placeholder="smtp.yourprovider.com" style={fieldStyle} value={settings.smtp_host || ''} onChange={e => setSettings({ ...settings, smtp_host: e.target.value })} />
            </label>
            <label style={labelStyle}>
              SMTP Port
              <input placeholder="587" style={fieldStyle} value={settings.smtp_port || ''} onChange={e => setSettings({ ...settings, smtp_port: Number(e.target.value) })} />
            </label>
            <label style={labelStyle}>
              SMTP User
              <input placeholder="smtp-user" style={fieldStyle} value={settings.smtp_user || ''} onChange={e => setSettings({ ...settings, smtp_user: e.target.value })} />
            </label>
            <label style={labelStyle}>
              SMTP Password
              <input type="password" placeholder="••••••••" style={fieldStyle} value={settings.smtp_pass || ''} onChange={e => setSettings({ ...settings, smtp_pass: e.target.value })} />
            </label>
            <label style={labelStyle}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Use secure SMTP</span>
                <input type="checkbox" checked={!!settings.smtp_secure} onChange={e => setSettings({ ...settings, smtp_secure: e.target.checked })} />
              </span>
            </label>
          </div>
        </div>

        <div style={sectionStyle}>
          <h3 style={{ margin: '0 0 12px 0' }}>Incoming Mail</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={labelStyle}>
              Incoming Protocol
              <select
                aria-label="Incoming Protocol"
                style={{ ...fieldStyle, padding: '10px' }}
                value={settings.incoming_protocol || 'imap'}
                onChange={e => setSettings({ ...settings, incoming_protocol: e.target.value })}
              >
                <option value="imap">IMAP</option>
                <option value="pop">POP</option>
              </select>
            </label>
            
            {(settings.incoming_protocol || 'imap') === 'imap' ? (
              <>
                <label style={labelStyle}>
                  IMAP Host
                  <input placeholder="imap.yourprovider.com" style={fieldStyle} value={settings.imap_host || ''} onChange={e => setSettings({ ...settings, imap_host: e.target.value })} />
                </label>
                <label style={labelStyle}>
                  IMAP Port
                  <input placeholder="993" style={fieldStyle} value={settings.imap_port || ''} onChange={e => setSettings({ ...settings, imap_port: Number(e.target.value) })} />
                </label>
                <label style={labelStyle}>
                  IMAP User
                  <input placeholder="imap-user" style={fieldStyle} value={settings.imap_user || ''} onChange={e => setSettings({ ...settings, imap_user: e.target.value })} />
                </label>
                <label style={labelStyle}>
                  IMAP Password
                  <input type="password" placeholder="••••••••" style={fieldStyle} value={settings.imap_pass || ''} onChange={e => setSettings({ ...settings, imap_pass: e.target.value })} />
                </label>
                <label style={labelStyle}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Use secure IMAP</span>
                    <input type="checkbox" checked={!!settings.imap_secure} onChange={e => setSettings({ ...settings, imap_secure: e.target.checked })} />
                  </span>
                </label>
              </>
            ) : (
              <>
                <label style={labelStyle}>
                  POP Host
                  <input placeholder="pop.yourprovider.com" style={fieldStyle} value={settings.pop_host || ''} onChange={e => setSettings({ ...settings, pop_host: e.target.value })} />
                </label>
                <label style={labelStyle}>
                  POP Port
                  <input placeholder="995" style={fieldStyle} value={settings.pop_port || ''} onChange={e => setSettings({ ...settings, pop_port: Number(e.target.value) })} />
                </label>
                <label style={labelStyle}>
                  POP User
                  <input placeholder="pop-user" style={fieldStyle} value={settings.pop_user || ''} onChange={e => setSettings({ ...settings, pop_user: e.target.value })} />
                </label>
                <label style={labelStyle}>
                  POP Password
                  <input type="password" placeholder="••••••••" style={fieldStyle} value={settings.pop_pass || ''} onChange={e => setSettings({ ...settings, pop_pass: e.target.value })} />
                </label>
                <label style={labelStyle}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Use secure POP</span>
                    <input type="checkbox" checked={!!settings.pop_secure} onChange={e => setSettings({ ...settings, pop_secure: e.target.checked })} />
                  </span>
                </label>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={save} style={{ background: 'linear-gradient(90deg, #2563eb, #1d4ed8)', color: 'white', padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer' }} disabled={isVerifying || isSending}>Save Settings</button>
          <button onClick={verify} style={{ background: isDark ? 'rgba(59,130,246,0.18)' : '#1976d2', color: isDark ? '#dbeafe' : 'white', padding: '10px 14px', borderRadius: 10, border: isDark ? '1px solid rgba(147,197,253,0.35)' : 'none', cursor: isVerifying ? 'wait' : 'pointer' }} disabled={isVerifying || isSending}>{isVerifying ? 'Verifying…' : 'Verify SMTP Connection'}</button>
          <div style={{ marginLeft: 'auto', color: isDark ? '#93c5fd' : '#1976d2' }}>{message}</div>
        </div>

        <div style={sectionStyle}>
          <h3 style={{ margin: '0 0 8px 0' }}>Send Test Email</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input placeholder="recipient@example.com" value={testTo} onChange={e => setTestTo(e.target.value)} style={{ ...fieldStyle, flex: 1, minWidth: 220 }} />
            <button onClick={sendTest} style={{ background: 'linear-gradient(90deg, #16a34a, #15803d)', color: 'white', padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer' }}>Send Test</button>
          </div>
        </div>
      </div>
    </div>
  );
}
