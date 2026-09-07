import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { getEffectiveAuthToken } from '../utils/authSession';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
const getIsDarkMode = () => typeof document !== 'undefined' && document.body.classList.contains('dark-mode');

export default function AdminEmailScheduled() {
  const [scheduled, setScheduled] = useState([]);
  const [name, setName] = useState('');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [cron, setCron] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [isDark, setIsDark] = useState(getIsDarkMode);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const syncTheme = () => setIsDark(getIsDarkMode());
    syncTheme();

    if (typeof document !== 'undefined') {
      const observer = new MutationObserver(syncTheme);
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      return () => observer.disconnect();
    }
  }, []);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const res = await axios.get(`${API_BASE_URL}/admin/email/scheduled`, { headers: { Authorization: `Bearer ${token}` } });
      setScheduled(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const resetForm = () => {
    setName('');
    setRecipient('');
    setSubject('');
    setBody('');
    setImageUrl('');
    setCron('');
    setScheduledAt('');
    setEditingId(null);
  };

  const create = async () => {
    if (!name.trim()) {
      setFeedback('Please provide a schedule name.');
      return;
    }

    setIsCreating(true);
    setFeedback('');

    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const payloadToSend = {
        to: recipient,
        subject,
        body,
        imageUrl,
        scheduledAt: scheduledAt || undefined,
      };

      if (editingId) {
        await axios.put(`${API_BASE_URL}/admin/email/scheduled/${editingId}`, { name, payload: payloadToSend, cron_expression: cron, next_run: scheduledAt ? new Date(scheduledAt).toISOString() : null, active: true }, { headers: { Authorization: `Bearer ${token}` } });
        setFeedback('Schedule updated successfully.');
      } else {
        await axios.post(`${API_BASE_URL}/admin/email/scheduled`, { name, payload: payloadToSend, cron_expression: cron, next_run: scheduledAt ? new Date(scheduledAt).toISOString() : null, active: true }, { headers: { Authorization: `Bearer ${token}` } });
        setFeedback('Schedule created successfully.');
      }

      resetForm();
      load();
    } catch (err) {
      console.error(err);
      setFeedback(editingId ? 'Failed to update the scheduled email.' : 'Failed to create the scheduled email.');
    } finally {
      setIsCreating(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setName(item.name || '');
    setRecipient(item.payload?.to || '');
    setSubject(item.payload?.subject || '');
    setBody(item.payload?.body || '');
    setImageUrl(item.payload?.imageUrl || '');
    setCron(item.cron_expression || '');
    setScheduledAt(item.next_run ? new Date(item.next_run).toISOString().slice(0, 16) : '');
    setFeedback('Editing existing schedule.');
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this scheduled email?')) return;
    setIsDeleting(true);
    setFeedback('');

    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      await axios.delete(`${API_BASE_URL}/admin/email/scheduled/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setFeedback('Schedule deleted successfully.');
      if (editingId === id) resetForm();
      load();
    } catch (err) {
      console.error(err);
      setFeedback('Failed to delete the scheduled email.');
    } finally {
      setIsDeleting(false);
    }
  };

  const uploadImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    setFeedback('');

    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const formData = new FormData();
      formData.append('image', file);
      const res = await axios.post(`${API_BASE_URL}/admin/email/scheduled/upload-image`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      setImageUrl(res.data?.url || '');
      setFeedback('Image uploaded successfully.');
    } catch (err) {
      console.error(err);
      setFeedback('Failed to upload image.');
    } finally {
      setUploadingImage(false);
    }
  };

  const theme = isDark
    ? {
        surface: 'rgba(15, 23, 42, 0.92)',
        panel: 'rgba(30, 41, 59, 0.82)',
        border: 'rgba(148, 163, 184, 0.24)',
        text: '#f8fafc',
        muted: '#94a3b8',
        input: 'rgba(15, 23, 42, 0.82)',
        shadow: '0 20px 45px rgba(2, 6, 23, 0.34)',
      }
    : {
        surface: '#ffffff',
        panel: '#f8fafc',
        border: '#e2e8f0',
        text: '#0f172a',
        muted: '#64748b',
        input: '#ffffff',
        shadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
      };

  return (
    <div style={{ padding: 24, color: theme.text, display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(25, 118, 210, 0.12)', fontSize: '1.2rem' }}>
          ⏰
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.12rem' }}>Scheduled Emails</h3>
          <p style={{ margin: '4px 0 0', color: theme.muted, fontSize: '0.94rem' }}>Create recurring delivery jobs with a friendly cron schedule.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14, padding: 18, borderRadius: 18, background: theme.surface, border: `1px solid ${theme.border}`, boxShadow: theme.shadow }}>
        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 7, fontWeight: 600 }}>
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily newsletter digest" style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.input, color: theme.text }} />
          </label>

          <label style={{ display: 'grid', gap: 7, fontWeight: 600 }}>
            <span>Recipient email</span>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="recipient@example.com" style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.input, color: theme.text }} />
          </label>

          <label style={{ display: 'grid', gap: 7, fontWeight: 600 }}>
            <span>Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.input, color: theme.text }} />
          </label>

          <label style={{ display: 'grid', gap: 7, fontWeight: 600 }}>
            <span>Body</span>
            <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Compose the email body" style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.input, color: theme.text, resize: 'vertical' }} />
          </label>

          <label style={{ display: 'grid', gap: 7, fontWeight: 600 }}>
            <span>Upload image</span>
            <input type="file" accept="image/*" onChange={uploadImage} style={{ padding: '8px 0', color: theme.text }} />
            {uploadingImage ? <span style={{ color: theme.muted, fontSize: '0.9rem' }}>Uploading image…</span> : null}
            {imageUrl ? <span style={{ color: theme.muted, fontSize: '0.9rem' }}>Stored at: {imageUrl}</span> : null}
          </label>

          <label style={{ display: 'grid', gap: 7, fontWeight: 600 }}>
            <span>Send date and time</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.input, color: theme.text }}
              />
              <button
                type="button"
                onClick={() => {
                  if (!scheduledAt) {
                    const now = new Date();
                    now.setMinutes(now.getMinutes() + 5);
                    const value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                    setScheduledAt(value);
                  }
                }}
                style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.panel, color: theme.text, cursor: 'pointer', fontWeight: 700 }}
              >
                Set time
              </button>
            </div>
          </label>

          <label style={{ display: 'grid', gap: 7, fontWeight: 600 }}>
            <span>Cron expression (optional)</span>
            <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="* * * * *" style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.input, color: theme.text }} />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 4 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={create} disabled={isCreating} style={{ padding: '10px 16px', borderRadius: 999, border: 'none', background: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)', color: 'white', cursor: isCreating ? 'not-allowed' : 'pointer', fontWeight: 700, boxShadow: '0 12px 24px rgba(37, 99, 235, 0.22)', opacity: isCreating ? 0.8 : 1 }}>
                {isCreating ? 'Saving…' : editingId ? 'Update schedule' : 'Create schedule'}
              </button>
              {editingId ? (
                <button onClick={resetForm} style={{ padding: '10px 16px', borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.panel, color: theme.text, cursor: 'pointer', fontWeight: 700 }}>
                  Cancel
                </button>
              ) : null}
            </div>
            <span style={{ color: theme.muted, fontSize: '0.92rem' }}>Runs automatically in the background.</span>
          </div>

          {feedback ? <div style={{ padding: '10px 12px', borderRadius: 10, background: feedback.includes('successfully') ? (isDark ? 'rgba(34, 197, 94, 0.16)' : 'rgba(34, 197, 94, 0.1)') : (isDark ? 'rgba(248, 113, 113, 0.16)' : 'rgba(248, 113, 113, 0.1)'), color: feedback.includes('successfully') ? '#22c55e' : '#ef4444', fontSize: '0.93rem' }}>{feedback}</div> : null}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, padding: 18, borderRadius: 18, background: theme.surface, border: `1px solid ${theme.border}`, boxShadow: theme.shadow }}>
        <h4 style={{ margin: 0 }}>Existing schedules</h4>
        {scheduled.length === 0 ? (
          <div style={{ padding: 12, borderRadius: 12, background: isDark ? 'rgba(148, 163, 184, 0.12)' : '#f8fafc', color: theme.muted }}>No scheduled emails yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {scheduled.map((item) => (
              <div key={item.id} style={{ padding: 12, borderRadius: 12, border: `1px solid ${theme.border}`, background: theme.panel }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{item.name}</div>
                    <div style={{ marginTop: 4, color: theme.muted, fontSize: '0.9rem' }}>Next run: {item.next_run ? new Date(item.next_run).toLocaleString() : 'n/a'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ padding: '6px 10px', borderRadius: 999, background: isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(25, 118, 210, 0.1)', color: isDark ? '#7dd3fc' : '#2563eb', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {item.cron_expression || 'manual'}
                    </div>
                    <button onClick={() => startEdit(item)} style={{ padding: '6px 10px', borderRadius: 999, border: 'none', background: '#f59e0b', color: 'white', cursor: 'pointer', fontWeight: 700 }}>Edit</button>
                    <button onClick={() => remove(item.id)} disabled={isDeleting} style={{ padding: '6px 10px', borderRadius: 999, border: 'none', background: '#ef4444', color: 'white', cursor: isDeleting ? 'not-allowed' : 'pointer', fontWeight: 700 }}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
