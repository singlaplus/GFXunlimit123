import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { getEffectiveAuthToken } from '../utils/authSession';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const getIsDarkMode = () => typeof document !== 'undefined' && document.body.classList.contains('dark-mode');

export default function AdminEmailQueue() {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isDark, setIsDark] = useState(getIsDarkMode);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [pendingItems, setPendingItems] = useState([]);
  const [loadingQueue, setLoadingQueue] = useState(true);

  useEffect(() => {
    const syncTheme = () => setIsDark(getIsDarkMode());
    syncTheme();

    if (typeof document !== 'undefined') {
      const observer = new MutationObserver(syncTheme);
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      return () => observer.disconnect();
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, []);

  const loadQueue = async () => {
    try {
      setLoadingQueue(true);
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const response = await axios.get(`${API_BASE_URL}/admin/email/queue`, { headers: { Authorization: `Bearer ${token}` } });
      setPendingItems(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      console.error(err);
      setPendingItems([]);
    } finally {
      setLoadingQueue(false);
    }
  };

  const send = async () => {
    if (!to.trim() || !subject.trim() || !body.trim()) {
      setFeedback('Please complete all fields before enqueueing.');
      return;
    }

    setIsSubmitting(true);
    setFeedback('');

    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      await axios.post(`${API_BASE_URL}/admin/email/enqueue`, { to, subject, body }, { headers: { Authorization: `Bearer ${token}` } });
      setFeedback('Email queued successfully.');
      setTo('');
      setSubject('');
      setBody('');
      await loadQueue();
    } catch (err) {
      console.error(err);
      setFeedback('Unable to enqueue the email right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const theme = isDark
    ? {
        surface: 'rgba(15, 23, 42, 0.92)',
        surfaceAlt: 'rgba(30, 41, 59, 0.84)',
        border: 'rgba(148, 163, 184, 0.24)',
        text: '#f8fafc',
        muted: '#94a3b8',
        input: 'rgba(15, 23, 42, 0.82)',
        shadow: '0 20px 45px rgba(2, 6, 23, 0.34)',
      }
    : {
        surface: '#ffffff',
        surfaceAlt: '#f8fafc',
        border: '#e2e8f0',
        text: '#0f172a',
        muted: '#64748b',
        input: '#ffffff',
        shadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
      };

  return (
    <div style={{ padding: 24, color: theme.text, display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(25, 118, 210, 0.12)', fontSize: '1.25rem' }}>
          📬
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.16rem' }}>Email Queue</h2>
          <p style={{ margin: '4px 0 0', color: theme.muted, fontSize: '0.94rem' }}>Pending emails waiting to be sent from newsletters or other templates.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14, padding: 18, borderRadius: 18, background: theme.surface, border: `1px solid ${theme.border}`, boxShadow: theme.shadow }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Pending queue</h3>
          <span style={{ padding: '6px 10px', borderRadius: 999, background: isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(25, 118, 210, 0.1)', color: isDark ? '#7dd3fc' : '#2563eb', fontSize: '0.84rem', fontWeight: 700 }}>
            {loadingQueue ? 'Loading…' : `${pendingItems.length} item${pendingItems.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {loadingQueue ? (
          <div style={{ padding: 12, color: theme.muted }}>Loading pending emails…</div>
        ) : pendingItems.length === 0 ? (
          <div style={{ padding: 12, borderRadius: 12, background: isDark ? 'rgba(148, 163, 184, 0.12)' : '#f8fafc', color: theme.muted }}>
            No pending emails are currently queued.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {pendingItems.map((item) => (
              <div key={item.id} style={{ padding: 12, borderRadius: 12, border: `1px solid ${theme.border}`, background: theme.surfaceAlt }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{item.recipient}</div>
                    <div style={{ marginTop: 4, color: theme.muted, fontSize: '0.92rem' }}>{item.subject}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 110 }}>
                    <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: isDark ? '#7dd3fc' : '#2563eb', fontWeight: 700 }}>{item.event}</div>
                    <div style={{ marginTop: 4, color: theme.muted, fontSize: '0.8rem' }}>{item.status} · {item.retryCount} retries</div>
                  </div>
                </div>
                <div style={{ marginTop: 9, color: theme.muted, fontSize: '0.78rem' }}>Queued {item.queuedAt ? new Date(item.queuedAt).toLocaleString() : '—'}{item.sentAt ? ` · Sent ${new Date(item.sentAt).toLocaleString()}` : ''}{item.failedAt ? ` · Failed ${new Date(item.failedAt).toLocaleString()}` : ''}</div>
                {(item.error || item.relatedUserId || item.relatedOrderId || item.relatedAssetId) && <div style={{ marginTop: 6, color: item.error ? '#ef4444' : theme.muted, fontSize: '0.78rem' }}>{item.error || `Related user ${item.relatedUserId || '—'} · order ${item.relatedOrderId || '—'} · asset ${item.relatedAssetId || '—'}`}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 14, padding: 18, borderRadius: 18, background: theme.surface, border: `1px solid ${theme.border}`, boxShadow: theme.shadow }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Queue a new email</h3>
          <span style={{ color: theme.muted, fontSize: '0.9rem' }}>Manual enqueue</span>
        </div>

        <label style={{ display: 'grid', gap: 7, fontWeight: 600 }} htmlFor="queue-to">
          <span>Recipient</span>
          <input
            id="queue-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="name@example.com"
            style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.input, color: theme.text }}
          />
        </label>

        <label style={{ display: 'grid', gap: 7, fontWeight: 600 }} htmlFor="queue-subject">
          <span>Subject</span>
          <input
            id="queue-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Enter a subject"
            style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.input, color: theme.text }}
          />
        </label>

        <label style={{ display: 'grid', gap: 7, fontWeight: 600 }} htmlFor="queue-body">
          <span>Body</span>
          <textarea
            id="queue-body"
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Compose your email content"
            style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.input, color: theme.text, resize: 'vertical' }}
          />
        </label>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 4 }}>
          <button
            type="button"
            onClick={send}
            disabled={isSubmitting}
            style={{
              padding: '10px 16px',
              borderRadius: 999,
              border: 'none',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              background: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)',
              color: 'white',
              fontWeight: 700,
              boxShadow: '0 12px 24px rgba(37, 99, 235, 0.22)',
              opacity: isSubmitting ? 0.8 : 1,
            }}
          >
            {isSubmitting ? 'Enqueuing...' : 'Enqueue Email'}
          </button>
          <span style={{ color: theme.muted, fontSize: '0.92rem' }}>Queued messages are processed in the background.</span>
        </div>

        {feedback ? (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: feedback.includes('successfully') ? (isDark ? 'rgba(34, 197, 94, 0.16)' : 'rgba(34, 197, 94, 0.1)') : (isDark ? 'rgba(248, 113, 113, 0.16)' : 'rgba(248, 113, 113, 0.1)'), color: feedback.includes('successfully') ? '#22c55e' : '#ef4444', fontSize: '0.93rem' }}>
            {feedback}
          </div>
        ) : null}
      </div>
    </div>
  );
}
