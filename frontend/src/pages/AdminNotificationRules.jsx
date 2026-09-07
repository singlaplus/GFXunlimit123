import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { getEffectiveAuthToken } from '../utils/authSession';
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const EVENT_OPTIONS = [
  { key: 'new_upload', label: 'New Upload Received' },
  { key: 'download', label: 'Asset Downloaded' },
  { key: 'sale_completed', label: 'Sale Completed' },
  { key: 'payout_ready', label: 'Payout Ready' },
  { key: 'account_approved', label: 'Account Approved' },
  { key: 'account_rejected', label: 'Account Rejected' },
  { key: 'account_status_changed', label: 'Account Status Changed' },
  { key: 'daily_reports', label: 'Daily Reports' },
  { key: 'new_contributor', label: 'New Contributor Registered' },
  { key: 'new_customer', label: 'New Customer Registered' }
];

const TEMPLATE_OPTIONS = [
  { key: '', label: 'Default template' },
  { key: 'uploader_notification', label: 'Uploader Notification' },
  { key: 'admin_alert', label: 'Admin Alert' }
];

const INITIAL_TEMPLATES = TEMPLATE_OPTIONS.map((t, i) => ({ key: t.key || `template_${i}`, label: t.label, subject: `${t.label} Subject`, body: `Hello, this is the ${t.label} template.` }));

const TEMPLATE_TOKENS = [
  { token: '{{user_name}}', label: 'User full name' },
  { token: '{{first_name}}', label: "User first name" },
  { token: '{{customer_email}}', label: 'Customer email' },
  { token: '{{contributor_email}}', label: 'Contributor email' },
  { token: '{{asset_title}}', label: 'Asset title' },
  { token: '{{asset_owner_email}}', label: 'Asset owner email' },
  { token: '{{download_link}}', label: 'Download link' },
  { token: '{{site_name}}', label: 'Site name' }
];

export default function AdminNotificationRules() {
  const [rules, setRules] = useState([]);
  const [editing, setEditing] = useState(null);
  const [templates, setTemplates] = useState(() => {
    try {
      const raw = localStorage.getItem('notification_templates');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return INITIAL_TEMPLATES;
  });
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const inputRef = useRef(null);
  const [isDark, setIsDark] = useState(typeof document !== 'undefined' && document.body.classList.contains('dark-mode'));

  useEffect(() => { load(); }, []);

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

  const isRuleActive = (rule) => {
    if (!rule) return false;
    if (rule.active !== undefined) return !!rule.active;
    return !!rule.enable_email || !!rule.enable_internal || !!rule.enable_dashboard;
  };

  const parseStoredRecipients = (recipients = []) => {
    const list = Array.isArray(recipients) ? recipients : [];
    const toRecipients = [];
    const bccRecipients = [];

    list.forEach((item) => {
      const value = String(item || '').trim();
      if (!value) return;
      if (value.startsWith('bcc:')) {
        bccRecipients.push(value.replace(/^bcc:/, ''));
      } else {
        toRecipients.push(value);
      }
    });

    return {
      toRecipients: [...new Set(toRecipients)],
      bccRecipients: [...new Set(bccRecipients)]
    };
  };

  const buildRecipientsPayload = (editingState) => {
    const toList = [...new Set((editingState?.toRecipients || '').split(',').map((item) => item.trim()).filter(Boolean))];
    const bccList = [...new Set((editingState?.bccRecipients || '').split(',').map((item) => item.trim()).filter(Boolean))];
    const recipients = [...toList, ...bccList.map((email) => `bcc:${email}`)];
    return recipients;
  };

  const load = async () => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const res = await axios.get(`${API_BASE_URL}/admin/email/notification-rules`, { headers: { Authorization: `Bearer ${token}` } });
      const next = Array.isArray(res.data) ? res.data : [];
      setRules(next);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem('notification_templates', JSON.stringify(templates));
    } catch (e) {}
  }, [templates]);

  const openEdit = (rule) => {
    const templateKey = rule.template || '';
    if (templateKey && !templates.find((t) => String(t.key) === String(templateKey))) {
      // add placeholder so it can be selected/edited
      setTemplates((prev) => [...prev, { key: String(templateKey), label: String(templateKey), subject: '', body: '' }]);
    }
    const { toRecipients, bccRecipients } = parseStoredRecipients(Array.isArray(rule.recipients) ? rule.recipients : (rule.recipients || '').split(',').map(s => s.trim()).filter(Boolean));
    setEditing({
      ...rule,
      active: isRuleActive(rule),
      recipients: Array.isArray(rule.recipients) ? rule.recipients : (rule.recipients || '').split(',').map(s => s.trim()).filter(Boolean),
      template: rule.template || '',
      priority: rule.priority || 'normal',
      schedule_time: rule.schedule_time || (rule.metadata && rule.metadata.schedule_time) || '11:00',
      toRecipients: toRecipients.join(', '),
      bccRecipients: bccRecipients.join(', ')
    });
  };

  const openTemplateManager = (templateKey = editing?.template || '') => {
    let selectedTemplate = null;
    if (templateKey) {
      selectedTemplate = templates.find((t) => String(t.key) === String(templateKey));
      if (!selectedTemplate) {
        selectedTemplate = { key: String(templateKey), label: String(templateKey), subject: '', body: '' };
        setTemplates((prev) => [...prev, selectedTemplate]);
      }
    } else {
      selectedTemplate = templates[0] || null;
    }
    setEditingTemplate(selectedTemplate);
    setTemplateEditorOpen(true);
  };

  const deleteTemplate = (template) => {
    if (!template) return;
    setTemplates((prev) => prev.filter((t) => String(t.key) !== String(template.key)));
    if (editingTemplate && String(editingTemplate.key) === String(template.key)) {
      setEditingTemplate(null);
    }
  };

  const deleteRule = async (rule) => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const eventKey = rule?.event_key || rule?.key || '';
      if (!eventKey) {
        setError('No rule event key found for deletion');
        return;
      }
      await axios.delete(`${API_BASE_URL}/admin/email/notification-rules/${encodeURIComponent(eventKey)}`, { headers: { Authorization: `Bearer ${token}` } });
      setMessage('Rule deleted');
      setError('');
      setEditing(null);
      await load();
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      console.error(err);
      const detail = err?.response?.data?.error || err?.response?.data || 'Unable to delete rule';
      setError(typeof detail === 'string' ? detail : 'Unable to delete rule');
    }
  };

  const save = async () => {
    try {
      setError('');
      if (!editing || !editing.event_key) {
        setError('Please select an event.');
        return;
      }

      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
        // validate minimum recipients per event
        const currentRecipients = buildRecipientsPayload(editing);
        const minRequired = editing.event_key === 'download' ? 3 : editing.event_key === 'daily_reports' ? 1 : 2;
        if (currentRecipients.length < minRequired) {
          setError(`Please configure at least ${minRequired} recipient${minRequired === 1 ? '' : 's'} for this event.`);
          return;
        }
        const payload = {
        event_key: editing.event_key,
        active: !!editing.active,
        enable_email: !!editing.enable_email,
        enable_internal: !!editing.enable_internal,
        enable_dashboard: !!editing.enable_dashboard,
        recipients: currentRecipients,
        schedule_time: editing.schedule_time || '11:00',
        metadata: { schedule_time: editing.schedule_time || '11:00' },
        include_admins: !!editing.include_admins,
        admins_opt_out: !!editing.admins_opt_out
      };

      await axios.post(`${API_BASE_URL}/admin/email/notification-rules`, payload, { headers: { Authorization: `Bearer ${token}` } });
      setMessage('Rule saved');
      setEditing(null);
      load();
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      console.error(err);
      setError('Unable to save rule');
    }
  };

  const startNewRule = () => setEditing({ event_key: '', active: true, enable_email: true, enable_internal: false, enable_dashboard: false, recipients: [], template: '', priority: 'normal', schedule_time: '11:00', include_admins: false, admins_opt_out: false });

  const toggleRuleActive = async (rule, checked) => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const payload = {
        event_key: rule?.event_key || rule?.key || '',
        active: !!checked,
        enable_email: !!checked ? (rule?.enable_email || true) : false,
        enable_internal: !!checked ? !!rule?.enable_internal : false,
        enable_dashboard: !!checked ? !!rule?.enable_dashboard : false,
        recipients: Array.isArray(rule?.recipients) ? rule.recipients : []
      };
      await axios.post(`${API_BASE_URL}/admin/email/notification-rules`, payload, { headers: { Authorization: `Bearer ${token}` } });
      await load();
    } catch (err) {
      console.error(err);
      setError('Unable to update rule status');
    }
  };

  const addRecipient = (value) => {
    const email = (value || '').trim();
    if (!email) return;
    // allow explicit tokens like {{customer_email}} or normal emails
    const isToken = /^{{\w+}}$/.test(email);
    const isValid = isToken || (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
    if (!isValid) {
      setError('Enter a valid email address or use a recipient token');
      return;
    }
    setEditing((prev) => ({ ...prev, recipients: Array.isArray(prev.recipients) ? [...prev.recipients, email] : [email] }));
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeRecipient = (idx) => {
    setEditing((prev) => {
      const list = Array.isArray(prev.recipients) ? prev.recipients : [];
      const minRequired = prev && prev.event_key === 'download' ? 3 : prev && prev.event_key === 'daily_reports' ? 1 : 2;
      if (list.length <= minRequired) {
        setError(`At least ${minRequired} recipient${minRequired === 1 ? '' : 's'} are required for this event.`);
        return prev;
      }
      return { ...prev, recipients: list.filter((_, i) => i !== idx) };
    });
  };

  const ensureAdminsToken = (include) => {
    setEditing((prev) => {
      const list = Array.isArray(prev.recipients) ? [...prev.recipients] : [];
      const hasAdmins = list.includes('{{admins}}');
      if (include && !hasAdmins) {
        return { ...prev, recipients: [...list, '{{admins}}'], include_admins: true };
      }
      if (!include && hasAdmins) {
        return { ...prev, recipients: list.filter((r) => r !== '{{admins}}'), include_admins: false };
      }
      return { ...prev, include_admins: !!prev.include_admins };
    });
  };

  const toggleAdminsOptOut = (value) => {
    setEditing((prev) => ({ ...prev, admins_opt_out: !!value }));
  };

  const addCustomBcc = () => {
    const val = window.prompt('Enter custom BCC email');
    if (!val) return;
    const email = val.trim();
    const isValid = (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
    if (!isValid) { setError('Enter a valid email address'); return; }
    // insert as BCC (index 1). If no recipients yet, push as first then ensure placeholder TO exists
    setEditing((prev) => {
      const list = Array.isArray(prev.recipients) ? [...prev.recipients] : [];
      if (list.length === 0) list.push('');
      // insert at index 1
      list.splice(1, 0, email);
      return { ...prev, recipients: list };
    });
  };

  const reorderRecipients = (from, to) => {
    setEditing((prev) => {
      const list = Array.isArray(prev.recipients) ? [...prev.recipients] : [];
      if (!list || list.length === 0) return prev;
      const item = list.splice(from, 1)[0];
      list.splice(to, 0, item);
      return { ...prev, recipients: list };
    });
  };

  const onDragStart = (e, idx) => {
    e.dataTransfer.setData('text/plain', String(idx));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDrop = (e, idx) => {
    e.preventDefault();
    const src = Number(e.dataTransfer.getData('text/plain'));
    if (Number.isNaN(src)) return;
    if (src === idx) return;
    reorderRecipients(src, idx);
  };

  const onDragOver = (e) => {
    e.preventDefault();
  };

  const testRule = async () => {
    if (!editing) return;
    const recipients = Array.isArray(editing.recipients) ? editing.recipients : ((editing.recipients || '').split(',').map(s => s.trim()).filter(Boolean));
    const cnt = recipients.length;
    const eventLabel = EVENT_OPTIONS.find((o) => o.key === editing.event_key)?.label || editing.event_key;
    const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;

    if (editing.event_key === 'daily_reports') {
      try {
        const res = await axios.get(`${API_BASE_URL}/admin/email/daily-report-preview`, { headers: { Authorization: `Bearer ${token}` } });
        const htmlContent = res.data?.html || '';
        const templateSubject = res.data?.subject || `GFXunlimit daily website summary - ${new Date().toDateString()}`;
        setPreviewData({ event: editing.event_key, eventLabel, recipients, cnt, htmlContent, templateSubject });
        setPreviewOpen(true);
        return;
      } catch (err) {
        console.error(err);
        setError(err?.response?.data?.error || 'Failed to load live daily report preview');
        return;
      }
    }

    let htmlContent = '';
    const tpl = templates.find((t) => String(t.key) === String(editing.template));
    htmlContent = tpl ? tpl.body : `<p>Event: ${eventLabel}</p>`;

    setPreviewData({ event: editing.event_key, eventLabel, recipients, cnt, htmlContent, templateSubject: tpl ? tpl.subject : eventLabel });
    setPreviewOpen(true);
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewData(null);
  };

  const sendTestEmail = async (overrideTo) => {
    if (!previewData) return;
    try {
      setError('');
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const to = overrideTo || (previewData.recipients && previewData.recipients[0]) || '';
      if (!to) { setError('No test recipient available'); return; }
      const subject = previewData.templateSubject || previewData.eventLabel || 'Test Notification';
      const body = previewData.htmlContent || `<p>This is a test for event ${previewData.eventLabel}.</p>`;
      await axios.post(`${API_BASE_URL}/admin/email/send-test`, { to, subject, body }, { headers: { Authorization: `Bearer ${token}` } });
      setMessage(`Test email sent to ${to}`);
      setTimeout(() => setMessage(''), 4000);
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.error || 'Failed to send test email');
    }
  };

  const insertToken = (field, token) => {
    if (!editingTemplate) return;
    if (field === 'subject') {
      const el = subjectRef.current;
      const current = editingTemplate.subject || '';
      if (el && typeof el.selectionStart === 'number') {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const next = current.slice(0, start) + token + current.slice(end);
        setEditingTemplate({ ...editingTemplate, subject: next });
        setTimeout(() => { el.selectionStart = el.selectionEnd = start + token.length; el.focus(); }, 0);
      } else {
        setEditingTemplate({ ...editingTemplate, subject: current + token });
      }
      return;
    }
    if (field === 'body') {
      const el = bodyRef.current;
      const current = editingTemplate.body || '';
      if (el && typeof el.selectionStart === 'number') {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const next = current.slice(0, start) + token + current.slice(end);
        setEditingTemplate({ ...editingTemplate, body: next });
        setTimeout(() => { el.selectionStart = el.selectionEnd = start + token.length; el.focus(); }, 0);
      } else {
        setEditingTemplate({ ...editingTemplate, body: current + token });
      }
    }
  };

  useEffect(() => {
    if (!previewOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') closePreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewOpen]);

  const surface = isDark ? '#1e1e1e' : '#ffffff';
  const surfaceElevated = isDark ? '#242424' : '#ffffff';
  const surfaceSoft = isDark ? '#2a2a2a' : '#f7f8fb';
  const border = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)';
  const textPrimary = isDark ? '#f5f7fa' : '#111111';
  const textSecondary = isDark ? '#cbd5e1' : '#616161';
  const textMuted = isDark ? '#94a3b8' : '#444444';
  const chipBg = isDark ? '#2a2a2a' : '#f1f5f9';
  const inputBg = isDark ? '#2a2a2a' : '#ffffff';
  const inputBorder = isDark ? '#4b5563' : '#dcdfe6';

  return (
    <div style={{ padding: 20, display: 'grid', gap: 18, fontFamily: 'Inter, system-ui, -apple-system, Roboto, sans-serif', color: textPrimary, background: isDark ? '#121212' : 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0, color: textPrimary }}>Notification Rules & Alerts <span style={{ fontSize: 12, color: textSecondary, marginLeft: 8 }}>(Pro)</span></h2>
        <button onClick={startNewRule} style={{ marginLeft: 'auto', background: 'linear-gradient(90deg,#4caf50,#2e7d32)', color: 'white', padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer' }}>Add Rule</button>
      </div>

      <p style={{ color: textSecondary, margin: 0 }}>Configure when notifications are sent and which channels receive alerts for each event. New UI includes recipient chips, templates, priority and a preview test.</p>

      <div style={{ display: 'grid', gap: 14, alignItems: 'start' }}>
        <div style={{ padding: 18, borderRadius: 14, border: `1px solid ${border}`, background: isDark ? 'linear-gradient(180deg, #1e1e1e, #1a1a1a)' : 'linear-gradient(180deg, #ffffff, #fbfbfb)', boxShadow: isDark ? 'none' : '0 6px 24px rgba(16,24,40,0.06)', color: textPrimary }}>
          <h3 style={{ marginTop: 0, color: textPrimary }}>Existing Rules</h3>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', alignItems: 'stretch' }}>
            {rules.length === 0 ? (
              <div style={{ color: textSecondary }}>No notification rules configured yet.</div>
            ) : (
              rules.map((rule) => (
                <div key={rule.event_key} style={{ padding: 12, borderRadius: 12, border: `1px solid ${border}`, background: surface, display: 'grid', gap: 8, width: '100%', minHeight: '100%', color: textPrimary }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 700, color: textPrimary }}>{EVENT_OPTIONS.find((opt) => opt.key === rule.event_key)?.label || rule.event_key}</div>
                    <div style={{ fontSize: 12, color: textSecondary }}>{(rule.priority || 'normal').toUpperCase()}</div>
                  </div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: textPrimary }}>
                    <input type="checkbox" checked={isRuleActive(rule)} onChange={(e) => toggleRuleActive(rule, e.target.checked)} />
                    <span>{isRuleActive(rule) ? 'Active' : 'Inactive'}</span>
                  </label>
                  {rule.event_key === 'daily_reports' && (
                    <div style={{ padding: 10, background: isDark ? '#1a1a1a' : '#f0f7ff', border: `1px solid ${isDark ? '#334155' : '#d4e6f1'}`, borderRadius: 8, fontSize: 13, color: textPrimary }}>
                      <div style={{ marginBottom: 6 }}><strong>⏰ Schedule Time:</strong> {rule.schedule_time || (rule.metadata?.schedule_time) || '11:00'}</div>
                      <div><strong>📧 Recipients:</strong> {Array.isArray(rule.recipients) && rule.recipients.length > 0 ? rule.recipients.slice(0, 3).join(', ') + (rule.recipients.length > 3 ? ` +${rule.recipients.length - 3} more` : '') : 'Not configured'}</div>
                    </div>
                  )}
                  <div style={{ color: textMuted, fontSize: 13 }}>
                    Channels: {rule.enable_email ? 'Email ' : ''}{rule.enable_internal ? '· Internal ' : ''}{rule.enable_dashboard ? '· Dashboard' : ''}
                  </div>
                  {rule.event_key !== 'daily_reports' && (
                    <div style={{ marginTop: 4, fontSize: 13, color: textMuted, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {(Array.isArray(rule.recipients) ? rule.recipients : []).slice(0, 6).map((r) => (
                        <span key={r} style={{ background: chipBg, color: textPrimary, padding: '6px 8px', borderRadius: 999, fontSize: 13 }}>{r}</span>
                      ))}
                      {Array.isArray(rule.recipients) && rule.recipients.length > 6 ? <span style={{ color: textSecondary, fontSize: 13 }}>+{rule.recipients.length - 6} more</span> : null}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={() => openEdit(rule)} style={{ background: '#1565c0', color: 'white', padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>Edit</button>
                    <button onClick={() => { openEdit(rule); testRule(); }} style={{ background: '#0288d1', color: 'white', padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>Preview</button>
                    <button onClick={() => deleteRule(rule)} style={{ background: '#d32f2f', color: 'white', padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {editing ? (
          <div style={{ padding: 18, borderRadius: 14, border: `1px solid ${border}`, background: surfaceElevated, boxShadow: isDark ? 'none' : '0 6px 18px rgba(16,24,40,0.04)', color: textPrimary }}>
            <h3 style={{ marginTop: 0, color: textPrimary }}>Edit Rule</h3>
            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                Event
                <select value={editing.event_key} onChange={(e) => setEditing({ ...editing, event_key: e.target.value })} style={{ padding: 10, borderRadius: 10, border: `1px solid ${inputBorder}`, background: inputBg, color: textPrimary }}>
                  <option value="">Choose an event</option>
                  {EVENT_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: isDark ? '#2a2a2a' : '#f7f8fb', padding: 10, borderRadius: 10 }}>
                  <input type="checkbox" checked={!!editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked, enable_email: e.target.checked ? (!!editing.enable_email || true) : false, enable_internal: e.target.checked ? !!editing.enable_internal : false, enable_dashboard: e.target.checked ? !!editing.enable_dashboard : false })} />
                  <span style={{ fontSize: 14 }}>{editing.active ? 'Active Rule' : 'Inactive Rule'}</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: isDark ? '#2a2a2a' : '#f7f8fb', padding: 10, borderRadius: 10 }}>
                  <input type="checkbox" checked={!!editing.enable_email} onChange={(e) => setEditing({ ...editing, enable_email: e.target.checked })} />
                  <span style={{ fontSize: 14 }}>Send Email</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: isDark ? '#2a2a2a' : '#f7f8fb', padding: 10, borderRadius: 10 }}>
                  <input type="checkbox" checked={!!editing.enable_internal} onChange={(e) => setEditing({ ...editing, enable_internal: e.target.checked })} />
                  <span style={{ fontSize: 14 }}>Internal Alert</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: isDark ? '#2a2a2a' : '#f7f8fb', padding: 10, borderRadius: 10 }}>
                  <input type="checkbox" checked={!!editing.enable_dashboard} onChange={(e) => setEditing({ ...editing, enable_dashboard: e.target.checked })} />
                  <span style={{ fontSize: 14 }}>Dashboard Notice</span>
                </label>
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 13, color: textMuted }}>Recipients</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => addRecipient('{{customer_email}}')} style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${inputBorder}`, background: inputBg, color: textPrimary, cursor: 'pointer' }}>Add Customer Email</button>
                    <button type="button" onClick={() => addRecipient('{{contributor_email}}')} style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${inputBorder}`, background: inputBg, color: textPrimary, cursor: 'pointer' }}>Add Contributor Email</button>
                    <button type="button" onClick={() => addRecipient('{{asset_owner_email}}')} style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${inputBorder}`, background: inputBg, color: textPrimary, cursor: 'pointer' }}>Add Asset Owner</button>
                    <button type="button" onClick={() => { addRecipient('{{admin_email}}'); ensureAdminsToken(true); }} style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${inputBorder}`, background: inputBg, color: textPrimary, cursor: 'pointer' }}>Add Admin Email + Admins</button>
                    <button type="button" onClick={addCustomBcc} style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${inputBorder}`, background: inputBg, color: textPrimary, cursor: 'pointer' }}>Add Custom BCC</button>
                    <button type="button" onClick={() => { setEditing(prev => ({ ...prev, recipients: Array.isArray(prev.recipients) ? [...prev.recipients, '{{customer_email}}','{{asset_owner_email}}','{{admin_email}}'] : ['{{customer_email}}','{{asset_owner_email}}','{{admin_email}}'] })); ensureAdminsToken(true); }} style={{ padding: '6px 10px', borderRadius: 8, border: `1px dashed ${inputBorder}`, background: 'transparent', color: textPrimary, cursor: 'pointer' }}>Quick add Download Trio</button>
                    <label style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={!!(editing && (editing.include_admins || (Array.isArray(editing.recipients) && editing.recipients.includes('{{admins}}'))))} onChange={(e) => ensureAdminsToken(e.target.checked)} />
                      <span style={{ fontSize: 13, color: textPrimary }}>Send to all admins</span>
                    </label>
                    <label style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={!!(editing && editing.admins_opt_out)} onChange={(e) => toggleAdminsOptOut(e.target.checked)} />
                      <span style={{ fontSize: 13, color: textPrimary }}>Allow admins to opt out</span>
                    </label>
                  </div>

                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', width: '100%' }}>
                    <label style={{ display: 'grid', gap: 6, color: textMuted, fontSize: 13 }}>
                      TO
                      <textarea
                        rows={3}
                        value={editing?.toRecipients || ''}
                        onChange={(e) => setEditing((prev) => ({ ...prev, toRecipients: e.target.value }))}
                        style={{ padding: 10, borderRadius: 10, border: '1px solid #dcdfe6', width: '100%', minHeight: 110, background: isDark ? '#2a2a2a' : '#fff', color: isDark ? '#fff' : '#111' }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 6, color: textMuted, fontSize: 13 }}>
                      BCC
                      <textarea
                        rows={3}
                        value={editing?.bccRecipients || ''}
                        onChange={(e) => setEditing((prev) => ({ ...prev, bccRecipients: e.target.value }))}
                        style={{ padding: 10, borderRadius: 10, border: '1px solid #dcdfe6', width: '100%', minHeight: 110, background: isDark ? '#2a2a2a' : '#fff', color: isDark ? '#fff' : '#111' }}
                      />
                    </label>
                  </div>

                  <input ref={inputRef} placeholder="Add recipient and press Enter" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(e.target.value); } }} style={{ padding: 8, borderRadius: 8, border: `1px solid ${inputBorder}`, minWidth: 180, background: inputBg, color: textPrimary }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  Template
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select value={editing.template || ''} onChange={(e) => setEditing({ ...editing, template: e.target.value })} style={{ padding: 10, borderRadius: 10, border: `1px solid ${inputBorder}`, minWidth: 200, background: inputBg, color: textPrimary }}>
                        {templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                      <button type="button" onClick={() => openTemplateManager(editing?.template || '')} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${inputBorder}`, background: isDark ? '#2a2a2a' : 'transparent', color: textPrimary, cursor: 'pointer' }}>Manage Templates</button>
                      <button type="button" onClick={() => { const key = `tmpl_${Date.now()}`; const newT = { key, label: 'New Template', subject: 'Subject', body: 'Body' }; setTemplates(prev => [...prev, newT]); setEditingTemplate(newT); setTemplateEditorOpen(true); }} style={{ padding: '8px 10px', borderRadius: 8, border: `1px dashed ${inputBorder}`, background: isDark ? '#2a2a2a' : 'transparent', color: textPrimary, cursor: 'pointer' }}>New Template</button>
                    </div>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 160 }}>
                  Priority
                  <select value={editing.priority || 'normal'} onChange={(e) => setEditing({ ...editing, priority: e.target.value })} style={{ padding: 10, borderRadius: 10, border: `1px solid ${inputBorder}`, background: inputBg, color: textPrimary }}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <label style={{ display: 'grid', gap: 6, color: textPrimary }}>
                  Schedule time
                  <input
                    type="time"
                    value={editing.schedule_time || '11:00'}
                    onChange={(e) => setEditing({ ...editing, schedule_time: e.target.value })}
                    style={{ padding: 10, borderRadius: 10, border: `1px solid ${inputBorder}`, background: inputBg, color: textPrimary }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6, color: textPrimary }}>
                  Daily report email
                  <input
                    type="email"
                    value={Array.isArray(editing.recipients) ? editing.recipients.filter((item) => !String(item).startsWith('bcc:')).join(', ') : (editing.toRecipients || '')}
                    onChange={(e) => setEditing((prev) => ({ ...prev, recipients: e.target.value.split(',').map((r) => r.trim()).filter(Boolean), toRecipients: e.target.value }))}
                    placeholder="admin@example.com"
                    style={{ padding: 10, borderRadius: 10, border: `1px solid ${inputBorder}`, background: inputBg, color: textPrimary }}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button onClick={save} style={{ background: 'linear-gradient(90deg,#4caf50,#2e7d32)', color: 'white', padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer' }}>Save Rule</button>
                <button onClick={() => { setEditing(null); setError(''); }} style={{ background: '#757575', color: 'white', padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer' }}>Cancel</button>
                <button onClick={testRule} style={{ background: '#0288d1', color: 'white', padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer' }}>Test Preview</button>
              </div>

              {error ? <div style={{ color: '#d32f2f' }}>{error}</div> : null}
              {message ? <div style={{ color: '#1976d2' }}>{message}</div> : null}
              {previewOpen && previewData ? (
                <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}>
                  <div onClick={closePreview} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
                  <div role="dialog" aria-modal="true" style={{ position: 'relative', minWidth: 360, maxWidth: 900, width: '95%', maxHeight: '90vh', background: isDark ? '#121212' : '#fff', color: isDark ? '#eee' : '#111', borderRadius: 12, padding: 18, boxShadow: '0 12px 40px rgba(2,6,23,0.5)', zIndex: 1300, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <button onClick={closePreview} aria-label="Close" style={{ position: 'absolute', right: 12, top: 12, background: 'transparent', border: 'none', color: isDark ? '#ddd' : '#333', fontSize: 18, cursor: 'pointer', zIndex: 10 }}>✕</button>
                    <h3 style={{ marginTop: 0, marginBottom: 12, color: isDark ? '#f5f7fa' : '#111827' }}>📧 {previewData.eventLabel} — Email Preview</h3>
                    <div style={{ fontSize: 13, color: isDark ? '#bfc3c8' : '#666', marginBottom: 12 }}>This is how the email will look when sent.</div>
                    
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr', marginBottom: 12, fontSize: 13 }}>
                      <div>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>Recipients ({previewData.cnt})</div>
                        <div style={{ padding: 8, background: isDark ? '#1f1f1f' : '#f4f6f8', borderRadius: 8, maxHeight: 100, overflowY: 'auto' }}>
                          {previewData.recipients.map((r, i) => (
                            <div key={`${r}-${i}`} style={{ padding: '4px 0', fontSize: 12, wordBreak: 'break-all' }}>{r}</div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>Subject</div>
                        <div style={{ padding: 8, background: isDark ? '#1f1f1f' : '#f4f6f8', borderRadius: 8, fontSize: 12, wordBreak: 'break-word' }}>{previewData.templateSubject}</div>
                      </div>
                    </div>
                    
                    <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>Email Body</div>
                    <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${isDark ? '#333' : '#ddd'}`, borderRadius: 8, background: '#fff', padding: 0 }}>
                      <iframe
                        srcDoc={previewData.htmlContent}
                        style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8 }}
                        title="Email Preview"
                      />
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                      <button onClick={() => { const to = window.prompt('Send test to (email) or leave blank to use first recipient'); sendTestEmail(to); }} style={{ background: '#2e7d32', color: 'white', padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 500 }}>Send Test Email</button>
                      <button onClick={closePreview} style={{ background: '#757575', color: 'white', padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 500 }}>Close</button>
                    </div>
                  </div>
                </div>
              ) : null}
              {templateEditorOpen ? (
                <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}>
                  <div onClick={() => { setTemplateEditorOpen(false); setEditingTemplate(null); }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
                  <div role="dialog" aria-modal="true" style={{ position: 'relative', minWidth: 480, maxWidth: 980, width: '92%', background: isDark ? '#121212' : '#fff', color: isDark ? '#eee' : '#111', borderRadius: 12, padding: 18, boxShadow: '0 12px 40px rgba(2,6,23,0.5)', zIndex: 1300 }}>
                    <button onClick={() => { setTemplateEditorOpen(false); setEditingTemplate(null); }} aria-label="Close" style={{ position: 'absolute', right: 12, top: 12, background: 'transparent', border: 'none', color: isDark ? '#ddd' : '#333', fontSize: 18, cursor: 'pointer' }}>✕</button>
                    <h3 style={{ marginTop: 0 }}>Template Manager</h3>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 180, maxHeight: '60vh', overflowY: 'auto' }}>
                        {templates.map((t) => (
                          <div key={t.key} style={{ padding: 8, borderRadius: 8, marginBottom: 8, background: editingTemplate && String(editingTemplate.key) === String(t.key) ? (isDark ? '#1b1b1b' : '#eef3fb') : (isDark ? '#0f0f0f' : '#f7f9fc'), cursor: 'pointer' }} onClick={() => setEditingTemplate(t)}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <div style={{ fontWeight: 700 }}>{t.label}</div>
                                <div style={{ fontSize: 12, color: '#666' }}>{t.key}</div>
                              </div>
                              <button type="button" onClick={(e) => { e.stopPropagation(); deleteTemplate(t); }} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #f5c2c7', background: '#fff5f5', color: '#b42318', cursor: 'pointer' }}>Delete</button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ flex: 1, display: 'grid', gap: 8 }}>
                        {editingTemplate ? (
                          <div style={{ display: 'grid', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary }}>Insert tokens:</div>
                              {TEMPLATE_TOKENS.map((tk) => (
                                <div key={tk.token} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 8px', borderRadius: 8, background: isDark ? '#0f0f0f' : '#f6f8fa', color: textPrimary }}>
                                  <div style={{ fontSize: 12 }}>{tk.label}</div>
                                  <button type="button" onClick={() => insertToken('subject', tk.token)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d0d7e0', background: 'transparent', cursor: 'pointer' }}>S</button>
                                  <button type="button" onClick={() => insertToken('body', tk.token)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d0d7e0', background: 'transparent', cursor: 'pointer' }}>B</button>
                                </div>
                              ))}
                            </div>
                            <label style={{ display: 'grid', gap: 6, color: textPrimary }}>
                              Label
                              <input value={editingTemplate.label} onChange={(e) => setEditingTemplate({ ...editingTemplate, label: e.target.value })} style={{ padding: 8, borderRadius: 8, border: `1px solid ${inputBorder}`, background: inputBg, color: textPrimary }} />
                            </label>
                            <label style={{ display: 'grid', gap: 6, color: textPrimary }}>
                              Subject
                              <input ref={subjectRef} value={editingTemplate.subject} onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })} style={{ padding: 8, borderRadius: 8, border: `1px solid ${inputBorder}`, background: inputBg, color: textPrimary }} />
                            </label>
                            <label style={{ display: 'grid', gap: 6, color: textPrimary }}>
                              Body
                              <textarea ref={bodyRef} value={editingTemplate.body} onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })} rows={8} style={{ padding: 8, borderRadius: 8, border: `1px solid ${inputBorder}`, background: inputBg, color: textPrimary }} />
                            </label>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button onClick={() => { setTemplateEditorOpen(false); setEditingTemplate(null); }} style={{ background: '#757575', color: 'white', padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>Close</button>
                              <button onClick={() => { // save template changes
                                setTemplates(prev => prev.map(p => p.key === editingTemplate.key ? editingTemplate : p));
                                setMessage('Template saved');
                                setTimeout(() => setMessage(''), 3000);
                              }} style={{ background: 'linear-gradient(90deg,#4caf50,#2e7d32)', color: 'white', padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>Save Template</button>
                              <button onClick={() => { setTemplates(prev => prev.filter(p => p.key !== editingTemplate.key)); setEditingTemplate(null); }} style={{ background: '#d32f2f', color: 'white', padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>Delete</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ color: textSecondary }}>Select or create a template to edit its subject and body.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
