import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { getEffectiveAuthToken } from '../utils/authSession';
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

export default function AdminEmailLogs() {
  const [logs, setLogs] = useState([]);

  const retry = async (id) => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      await axios.post(`${API_BASE_URL}/admin/email/queue/${encodeURIComponent(id)}/retry`, {}, { headers: { Authorization: `Bearer ${token}` } });
      load();
    } catch (err) { console.error(err); }
  };

  useEffect(() => { load(); }, []);
  const load = async () => { try { const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null; const res = await axios.get(`${API_BASE_URL}/admin/email/logs`, { headers: { Authorization: `Bearer ${token}` } }); setLogs(res.data || []); } catch (err) { console.error(err); } };

  return (
    <div style={{ padding: 20 }}>
      <h2>Email Logs</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>Email ID</th><th>Recipient</th><th>Event</th><th>Template</th><th>Subject</th><th>Status</th><th>Queued</th><th>Sent</th><th>Failed</th><th>Retries</th><th>Error</th><th>Related</th><th>Action</th></tr></thead>
        <tbody>
          {logs.map(l => <tr key={l.id}><td>{l.email_id}</td><td>{l.recipient}</td><td>{l.event}</td><td>{l.template_id || '—'}</td><td>{l.subject}</td><td>{l.status}</td><td>{l.queued_at ? new Date(l.queued_at).toLocaleString() : '—'}</td><td>{l.sent_at ? new Date(l.sent_at).toLocaleString() : '—'}</td><td>{l.failed_at ? new Date(l.failed_at).toLocaleString() : '—'}</td><td>{l.retry_count}</td><td>{l.error || '—'}</td><td>{[l.related_user_id && `User #${l.related_user_id}`, l.related_order_id && `Order #${l.related_order_id}`, l.related_asset_id && `Asset #${l.related_asset_id}`].filter(Boolean).join(' · ') || '—'}</td><td>{l.status === 'FAILED' && <button type="button" onClick={() => retry(l.id)}>Retry</button>}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
