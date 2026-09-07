import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { getEffectiveAuthToken } from '../utils/authSession';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

export default function AdminNewsletter() {
  const [subs, setSubs] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [segmentsInput, setSegmentsInput] = useState('customer');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [campaignTitle, setCampaignTitle] = useState('');
  const [campaignSubject, setCampaignSubject] = useState('');
  const [campaignBody, setCampaignBody] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [campaignId, setCampaignId] = useState(null);
  const [stats, setStats] = useState(null);
  const [isDark, setIsDark] = useState(typeof document !== 'undefined' && document.body.classList.contains('dark-mode'));
  const [sending, setSending] = useState(false);
  const fileRef = useRef();

  useEffect(() => { load(); loadTemplates(); }, []);

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

  const load = async () => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const res = await axios.get(`${API_BASE_URL}/admin/email/newsletter/subscribers`, { headers: { Authorization: `Bearer ${token}` } });
      setSubs(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadTemplates = async () => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const res = await axios.get(`${API_BASE_URL}/admin/email/templates`, { headers: { Authorization: `Bearer ${token}` } });
      const list = Array.isArray(res.data) ? res.data : [];
      setTemplates(list);
      if (list.length > 0) {
        const first = list[0];
        setSelectedTemplateId(String(first.id));
        setCampaignTitle(first.name || 'Newsletter Campaign');
        setCampaignSubject(first.subject || '');
        setCampaignBody(first.body || '');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const applyTemplate = (templateId) => {
    const template = templates.find((item) => String(item.id) === String(templateId));
    if (!template) return;
    setSelectedTemplateId(String(template.id));
    setCampaignTitle(template.name || 'Newsletter Campaign');
    setCampaignSubject(template.subject || '');
    setCampaignBody(template.body || '');
  };

  const add = async () => {
    try {
      setError('');
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      await axios.post(
        `${API_BASE_URL}/admin/email/newsletter/subscribers`,
        { email, name, segments: segmentsInput.split(',').map((s) => s.trim()) },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setEmail('');
      setName('');
      load();
    } catch (err) {
      console.error(err);
      setError('Unable to add subscriber');
    }
  };

  const exportCsv = () => {
    const rows = subs.map((s) => `${s.email},${s.name || ''},${(s.segments || []).join('|')}`);
    const csv = 'email,name,segments\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subscribers.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = (file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/).slice(1).filter(Boolean);
      for (const line of lines) {
        const [emailCol, nameCol, segmentsCol] = line.split(',');
        try {
          const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
          await axios.post(
            `${API_BASE_URL}/admin/email/newsletter/subscribers`,
            { email: emailCol.trim(), name: nameCol?.trim(), segments: segmentsCol ? segmentsCol.split('|').map((s) => s.trim()) : [] },
            { headers: { Authorization: `Bearer ${token}` } }
          );
        } catch (err) {
          console.error('import failed for', line, err);
        }
      }
      load();
    };
    reader.readAsText(file);
  };

  const sendToAllSubscribers = async () => {
    try {
      setError('');
      setMessage('');
      if (!selectedTemplateId) {
        setError('Please choose an available template first.');
        return;
      }
      if (!subs.length) {
        setError('No subscribers are available to send to.');
        return;
      }

      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      setSending(true);
      const campaignRes = await axios.post(
        `${API_BASE_URL}/admin/email/newsletter/campaigns`,
        {
          title: campaignTitle || `Newsletter ${Date.now()}`,
          subject: campaignSubject,
          body: campaignBody,
          scheduled_at: null
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const nextCampaignId = campaignRes.data?.id;
      if (!nextCampaignId) {
        throw new Error('Campaign was not created');
      }
      setCampaignId(nextCampaignId);

      const sendRes = await axios.post(`${API_BASE_URL}/admin/email/newsletter/send-campaign/${nextCampaignId}`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setMessage(`Queued ${sendRes.data?.queued || subs.length} emails using the selected template.`);
      await loadStats(nextCampaignId);
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || err?.message || 'Failed to send newsletter');
    } finally {
      setSending(false);
    }
  };

  const loadStats = async (campaignId) => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const res = await axios.get(`${API_BASE_URL}/admin/email/newsletter/stats/${campaignId}`, { headers: { Authorization: `Bearer ${token}` } });
      setStats(res.data || null);
    } catch (err) {
      console.error(err);
    }
  };

  const exportLog = async () => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const currentCampaignId = campaignId || '';
      if (!currentCampaignId) {
        setError('Create or send a campaign before exporting the log.');
        return;
      }
      const response = await axios.get(`${API_BASE_URL}/admin/email/newsletter/export-log/${currentCampaignId}`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `newsletter-report-${currentCampaignId}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setMessage('Newsletter log exported successfully.');
    } catch (err) {
      console.error(err);
      setError('Unable to export newsletter log');
    }
  };

  const shellBackground = isDark
    ? 'linear-gradient(135deg, #020617 0%, #07142d 45%, #111827 100%)'
    : 'linear-gradient(135deg, #f8fbff 0%, #e7efff 45%, #f1f5f9 100%)';
  const panelBackground = isDark ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.96)';
  const panelBorder = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.10)';
  const textPrimary = isDark ? '#f8fafc' : '#0f172a';
  const textSecondary = isDark ? '#cbd5e1' : '#475569';
  const textMuted = isDark ? '#94a3b8' : '#64748b';
  const inputBackground = isDark ? 'rgba(15, 23, 42, 0.72)' : 'rgba(248, 250, 252, 0.96)';
  const inputBorder = isDark ? 'rgba(148, 163, 184, 0.24)' : 'rgba(148, 163, 184, 0.42)';

  return (
    <div style={{ padding: 18, borderRadius: 24, background: shellBackground, color: textSecondary }}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingBottom: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start', padding: '6px 10px', borderRadius: 999, background: isDark ? 'rgba(59,130,246,0.18)' : 'rgba(37,99,235,0.10)', color: isDark ? '#bfdbfe' : '#1d4ed8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.32em', fontWeight: 800 }}>
              Newsletter Manager
            </div>
            <h2 style={{ margin: 0, color: textPrimary, fontSize: '1.65rem', lineHeight: 1.15 }}>Send to all subscribers</h2>
          </div>
          <div style={{ padding: '8px 12px', borderRadius: 999, background: isDark ? 'rgba(37,99,235,0.16)' : 'rgba(37,99,235,0.08)', color: isDark ? '#bfdbfe' : '#1d4ed8', fontWeight: 700 }}>
            {subs.length} subscribers
          </div>
        </div>

        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <div style={{ background: panelBackground, border: `1px solid ${panelBorder}`, borderRadius: 20, padding: 18, boxShadow: isDark ? '0 20px 50px rgba(2,6,23,0.38)' : '0 20px 50px rgba(15,23,42,0.08)' }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.24em', color: isDark ? '#93c5fd' : '#2563eb', fontWeight: 700, marginBottom: 12 }}>Add subscriber</div>
            <div style={{ display: 'grid', gap: 10 }}>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${inputBorder}`, background: inputBackground, color: textPrimary }} />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${inputBorder}`, background: inputBackground, color: textPrimary }} />
              <input value={segmentsInput} onChange={(e) => setSegmentsInput(e.target.value)} placeholder="segments (comma)" style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${inputBorder}`, background: inputBackground, color: textPrimary }} />
              <button onClick={add} style={{ background: 'linear-gradient(90deg, #2563eb, #1d4ed8)', color: '#fff', border: 'none', borderRadius: 12, padding: '11px 14px', fontWeight: 700, cursor: 'pointer' }}>Add subscriber</button>
            </div>
          </div>

          <div style={{ background: panelBackground, border: `1px solid ${panelBorder}`, borderRadius: 20, padding: 18, boxShadow: isDark ? '0 20px 50px rgba(2,6,23,0.38)' : '0 20px 50px rgba(15,23,42,0.08)' }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.24em', color: isDark ? '#93c5fd' : '#2563eb', fontWeight: 700, marginBottom: 12 }}>Template and send</div>
            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6, fontWeight: 700, color: textPrimary }}>
                Available template
                <select value={selectedTemplateId} onChange={(e) => applyTemplate(e.target.value)} style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${inputBorder}`, background: inputBackground, color: textPrimary }}>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name || 'Untitled template'}</option>
                  ))}
                </select>
              </label>

              <input value={campaignTitle} onChange={(e) => setCampaignTitle(e.target.value)} placeholder="Campaign title" style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${inputBorder}`, background: inputBackground, color: textPrimary }} />
              <input value={campaignSubject} onChange={(e) => setCampaignSubject(e.target.value)} placeholder="Email subject" style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${inputBorder}`, background: inputBackground, color: textPrimary }} />
              <textarea value={campaignBody} onChange={(e) => setCampaignBody(e.target.value)} rows={6} placeholder="Email body" style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${inputBorder}`, background: inputBackground, color: textPrimary }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button onClick={sendToAllSubscribers} disabled={sending} style={{ background: sending ? '#64748b' : 'linear-gradient(90deg, #ef4444, #dc2626)', color: '#fff', border: 'none', borderRadius: 12, padding: '11px 14px', fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer' }}>{sending ? 'Sending…' : 'Send to all subscribers'}</button>
                <button onClick={exportLog} style={{ background: 'linear-gradient(90deg, #0f766e, #0d9488)', color: '#fff', border: 'none', borderRadius: 12, padding: '11px 14px', fontWeight: 700, cursor: 'pointer' }}>Export Log</button>
                <button onClick={exportCsv} style={{ background: isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.06)', color: textPrimary, border: `1px solid ${inputBorder}`, borderRadius: 12, padding: '11px 14px', fontWeight: 700, cursor: 'pointer' }}>Export CSV</button>
              </div>
              <input ref={fileRef} type="file" accept="text/csv" style={{ display: 'none' }} onChange={(e) => importCsv(e.target.files[0])} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button onClick={() => fileRef.current.click()} style={{ background: isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.06)', color: textPrimary, border: `1px solid ${inputBorder}`, borderRadius: 12, padding: '11px 14px', fontWeight: 700, cursor: 'pointer' }}>Import CSV</button>
              </div>

              {stats ? (
                <div style={{ display: 'grid', gap: 4, padding: '10px 12px', borderRadius: 12, background: isDark ? 'rgba(15,23,42,0.72)' : 'rgba(248,250,252,0.96)', border: `1px solid ${inputBorder}` }}>
                  <div style={{ fontWeight: 700, color: textPrimary }}>Tracking summary</div>
                  <div style={{ fontSize: '0.92rem', color: textSecondary }}>Sent: {stats.sent} • Delivered: {stats.delivered} • Opened: {stats.opened} • Clicked: {stats.clicked}</div>
                  <div style={{ fontSize: '0.9rem', color: textMuted }}>Tracking window: {stats.tracking_window} • Status: {stats.status}</div>
                </div>
              ) : null}
              {message ? <div style={{ color: '#22c55e', fontWeight: 700 }}>{message}</div> : null}
              {error ? <div style={{ color: '#ef4444', fontWeight: 700 }}>{error}</div> : null}
            </div>
          </div>
        </div>

        <div style={{ background: panelBackground, border: `1px solid ${panelBorder}`, borderRadius: 20, padding: 18, boxShadow: isDark ? '0 20px 50px rgba(2,6,23,0.38)' : '0 20px 50px rgba(15,23,42,0.08)' }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.24em', color: isDark ? '#93c5fd' : '#2563eb', fontWeight: 700, marginBottom: 10 }}>Subscribers</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', color: textPrimary }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 8px', borderBottom: `1px solid ${panelBorder}` }}>Email</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', borderBottom: `1px solid ${panelBorder}` }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', borderBottom: `1px solid ${panelBorder}` }}>Segments</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.email}>
                    <td style={{ padding: '10px 8px', borderBottom: `1px solid ${panelBorder}` }}>{s.email}</td>
                    <td style={{ padding: '10px 8px', borderBottom: `1px solid ${panelBorder}` }}>{s.name}</td>
                    <td style={{ padding: '10px 8px', borderBottom: `1px solid ${panelBorder}` }}>{(s.segments || []).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
