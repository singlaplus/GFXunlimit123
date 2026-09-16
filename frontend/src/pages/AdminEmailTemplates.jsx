import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { getFooterHtml } from '../components/Footer';
import { getEffectiveAuthToken } from '../utils/authSession';
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const TEMPLATE_VARIABLES = [
  '{{user_name}}',
  '{{user_email}}',
  '{{order_id}}',
  '{{asset_name}}',
  '{{asset_id}}',
  '{{amount}}',
  '{{currency}}',
  '{{download_url}}',
  '{{subscription_name}}',
  '{{expiry_date}}',
  '{{coupon_code}}',
  '{{site_name}}'
];

const DEFAULT_TEMPLATE_LIBRARY = {
  email: {
    name: 'Default email template',
    subject: 'Welcome {{user_name}}',
    body: '<p>Hello {{user_name}},</p><p>Thanks for joining {{site_name}}.</p>'
  },
  internal_message: {
    name: 'Default internal message template',
    subject: '{{site_name}} update for {{user_name}}',
    body: '<p>Hello {{user_name}},</p><p>Your account update is ready. Please review it in the dashboard.</p>'
  }
};

export default function AdminEmailTemplates() {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [sampleData, setSampleData] = useState('{"user_name":"Jane Doe","user_email":"jane@example.com","order_id":"ORD-1001","asset_name":"Mountain Photo","asset_id":"A-100","amount":"49.99","currency":"USD","download_url":"https://example.com/download","subscription_name":"Pro Plan","expiry_date":"2026-12-31","coupon_code":"SAVE10","site_name":"GFXunlimit"}');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isDark, setIsDark] = useState(typeof document !== 'undefined' && document.body.classList.contains('dark-mode'));
  const [hoveredTemplateId, setHoveredTemplateId] = useState(null);
  const BLOCK_TYPES = ['header','text','image','button','divider'];
  const emptyBlock = (type) => {
    switch(type) {
      case 'header': return { type: 'header', text: 'Welcome to our update', align: 'center' };
      case 'text': return { type: 'text', text: 'Write your paragraph here...' };
      case 'image': return { type: 'image', src: '', alt: 'Image description', width: '100%' };
      case 'button': return { type: 'button', text: 'Call To Action', url: '#', bgcolor: '#ED2224', color: '#fff' };
      case 'divider': return { type: 'divider' };
      default: return { type: 'text', text: '' };
    }
  };

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
  const load = async () => { try { const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null; const res = await axios.get(`${API_BASE_URL}/admin/email/templates`, { headers: { Authorization: `Bearer ${token}` } }); setTemplates(res.data || []); } catch (err) { console.error(err); } };

  const startNewTemplate = (templateType = 'email') => {
    const defaultTemplate = DEFAULT_TEMPLATE_LIBRARY[templateType] || DEFAULT_TEMPLATE_LIBRARY.email;
    setEditing({
      id: null,
      name: defaultTemplate.name,
      subject: defaultTemplate.subject,
      body: defaultTemplate.body,
      variables: TEMPLATE_VARIABLES,
      template_type: templateType,
      enabled: true,
      is_default: false,
      blocks: [emptyBlock('header'), emptyBlock('text')]
    });
  };

  const renderEmailShell = (contentHtml) => `
    <div style="background:#eff4fb;padding:40px 0;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#eff4fb;">
        <tr>
          <td align="center">
            <table width="680" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:28px;overflow:hidden;box-shadow:0 28px 80px rgba(15,23,42,0.16);margin:0 auto;">
              <tr>
                <td style="padding:40px 48px 32px 48px;color:#111827;">
                  ${contentHtml}
                </td>
              </tr>
              <tr>
                <td style="background:#0f1724;padding:32px 48px;">
                  ${getFooterHtml()}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;

  const save = async () => {
    try {
      if (!editing?.name?.trim()) {
        window.alert('Please enter a template name before saving.');
        return;
      }

      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const html = Array.isArray(editing.blocks)
        ? renderEmailShell(renderBlocksToHtml(editing.blocks))
        : editing?.body || '';

      const payload = {
        id: editing?.id || null,
        name: String(editing.name).trim(),
        subject: String(editing.subject || '').trim(),
        body: html,
        variables: Array.isArray(editing.variables) ? editing.variables : TEMPLATE_VARIABLES,
        template_type: editing?.template_type || 'email',
        enabled: editing?.enabled !== false,
        is_default: !!editing?.is_default
      };

      await axios.post(`${API_BASE_URL}/admin/email/templates`, payload, { headers: { Authorization: `Bearer ${token}` } });
      window.dispatchEvent(new Event('messages-updated'));
      setEditing(null);
      await load();
    } catch (err) {
      console.error(err);
      window.alert(err?.response?.data?.error || 'Failed to save template');
    }
  };

  const testTemplate = async () => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const parsedData = JSON.parse(sampleData || '{}');
      const html = Array.isArray(editing?.blocks)
        ? renderEmailShell(renderBlocksToHtml(editing.blocks))
        : editing?.body || '';

      await axios.post(`${API_BASE_URL}/admin/email/templates/test`, {
        to: parsedData.user_email || 'test@example.com',
        templateType: editing?.template_type || 'email',
        subject: editing?.subject || 'Template test',
        body: html,
        data: parsedData,
      }, { headers: { Authorization: `Bearer ${token}` } });
      window.alert('Test email sent successfully.');
    } catch (err) {
      console.error(err);
      window.alert(err?.response?.data?.error || 'Failed to send test template');
    }
  };

  const restoreDefaultTemplate = async () => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const response = await axios.post(`${API_BASE_URL}/admin/email/templates/restore-default`, {
        templateType: editing?.template_type || 'email'
      }, { headers: { Authorization: `Bearer ${token}` } });
      const restored = response.data || {};
      setEditing((current) => ({
        ...(current || {}),
        ...restored,
        subject: restored.subject || '',
        body: restored.body || '',
        variables: restored.variables || TEMPLATE_VARIABLES,
        template_type: restored.template_type || 'email',
        enabled: restored.enabled !== false,
        is_default: restored.is_default === true,
        blocks: parseBodyToBlocks(restored.body || '')
      }));
      await load();
    } catch (err) {
      console.error(err);
      window.alert(err?.response?.data?.error || 'Failed to restore the default template');
    }
  };

  const deleteTemplate = async (id) => {
    if (!window.confirm('Delete this template? This cannot be undone.')) return;
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      await axios.delete(`${API_BASE_URL}/admin/email/templates/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (editing?.id === id) setEditing(null);
      load();
    } catch (err) {
      console.error(err);
    }
  };

  const preview = async () => {
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const bodyHtml = (editing && Array.isArray(editing.blocks)) ? renderEmailShell(renderBlocksToHtml(editing.blocks)) : (editing?.body || '');
      const data = JSON.parse(sampleData || '{}');
      const res = await axios.post(`${API_BASE_URL}/admin/email/preview`, { body: bodyHtml, data }, { headers: { Authorization: `Bearer ${token}` } });
      setPreviewHtml(res.data.html || bodyHtml);
    } catch (err) {
      console.error(err);
      setPreviewHtml('<pre>Error rendering preview</pre>');
    }
  };

  const renderBlocksToHtml = (blocks) => {
    if (!Array.isArray(blocks)) return '';
    return blocks.map((b) => {
      switch(b.type) {
        case 'header':
          return `<h1 style="text-align:${b.align || 'left'}; font-family:Arial,sans-serif; color:#111827; font-size:32px; line-height:1.1; margin:0 0 20px; letter-spacing:-0.03em;">${escapeHtml(b.text || '')}</h1>`;
        case 'text':
          return `<p style="font-family:Arial,sans-serif; color:#475569; font-size:16px; line-height:1.8; margin:0 0 18px;">${escapeHtml(b.text || '')}</p>`;
        case 'image':
          return `<div style="text-align:center;margin:24px 0;"><img src="${escapeAttr(b.src || '')}" alt="${escapeAttr(b.alt||'')}" style="width:100%;max-width:${escapeAttr(b.width||'100%')};height:auto;border-radius:18px;display:block;margin:0 auto;"/></div>`;
        case 'button':
          return `<div style="text-align:center;margin:28px 0;"><a href="${escapeAttr(b.url||'#')}" style="background:${escapeAttr(b.bgcolor||'#ED2224')}; color:${escapeAttr(b.color||'#fff')}; padding:14px 28px; border-radius:999px; text-decoration:none; display:inline-block; font-weight:700; font-size:15px; box-shadow:0 18px 40px rgba(237,34,36,0.18);">${escapeHtml(b.text||'Click')}</a></div>`;
        case 'divider':
          return `<hr style="border:none; border-top:1px solid #e2e8f0; margin:28px 0;"/>`;
        default:
          return '';
      }
    }).join('\n');
  };

  const escapeHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const escapeAttr = (s) => escapeHtml(s).replace(/'/g, '&#39;');

  const uploadTemplateImage = async (file, idx) => {
    if (!file || !editing) return;
    try {
      setUploadError('');
      setUploadingImage(true);
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const formData = new FormData();
      formData.append('image', file);
      const res = await axios.post(`${API_BASE_URL}/admin/email/upload-image`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const imageUrl = res.data?.url || res.data?.path || '';
      if (imageUrl) {
        updateBlock(idx, { src: imageUrl });
      } else {
        setUploadError('Upload succeeded but returned no image URL.');
      }
    } catch (err) {
      console.error(err);
      setUploadError('Image upload failed. Please try again.');
    } finally {
      setUploadingImage(false);
    }
  };

  const deleteUploadedAsset = async (imageUrl) => {
    if (!imageUrl) return;
    try {
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      await axios.delete(`${API_BASE_URL}/admin/email/uploaded-file`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { path: imageUrl },
      });
    } catch (err) {
      console.error('Failed to delete uploaded asset', err);
    }
  };

  const parseBodyToBlocks = (body) => {
    if (!body || typeof body !== 'string') return [];

    const blocks = [];
    const cleanedBody = body.replace(/<div[^>]*style=["']background:#eff4fb[^>]*>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/table>[\s\S]*?<\/div>/i, '$1');
    const content = cleanedBody.replace(/<style[\s\S]*?<\/style>/gi, '');

    const headerMatches = content.matchAll(/<h1([^>]*)>([\s\S]*?)<\/h1>/gi);
    for (const match of headerMatches) {
      const attrs = match[1] || '';
      const text = match[2] || '';
      const alignMatch = attrs.match(/text-align:([^;"']+)/i);
      blocks.push({ type: 'header', text: text.replace(/<[^>]+>/g, '').trim(), align: alignMatch ? alignMatch[1].trim() : 'center' });
    }

    const paragraphMatches = content.matchAll(/<p([^>]*)>([\s\S]*?)<\/p>/gi);
    for (const match of paragraphMatches) {
      const text = match[2] || '';
      const plainText = text.replace(/<[^>]+>/g, '').trim();
      if (!plainText) continue;
      blocks.push({ type: 'text', text: plainText });
    }

    const imageMatches = content.matchAll(/<img([^>]*)>/gi);
    for (const match of imageMatches) {
      const attrs = match[1] || '';
      const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
      const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
      const widthMatch = attrs.match(/max-width:([^;"']+)/i);
      if (!srcMatch) continue;
      blocks.push({ type: 'image', src: srcMatch[1], alt: altMatch ? altMatch[1] : '', width: widthMatch ? widthMatch[1].trim() : '100%' });
    }

    const buttonMatches = content.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/gi);
    for (const match of buttonMatches) {
      const attrs = match[1] || '';
      const text = match[2] || '';
      const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);
      const styleMatch = attrs.match(/style=["']([^"']*)["']/i);
      const bgColorMatch = styleMatch?.[1]?.match(/background:([^;]+)/i);
      const colorMatch = styleMatch?.[1]?.match(/color:([^;]+)/i);
      if (!hrefMatch) continue;
      blocks.push({ type: 'button', text: text.replace(/<[^>]+>/g, '').trim() || 'Click', url: hrefMatch[1], bgcolor: bgColorMatch ? bgColorMatch[1].trim() : '#ED2224', color: colorMatch ? colorMatch[1].trim() : '#fff' });
    }

    const dividerCount = (content.match(/<hr/gi) || []).length;
    for (let i = 0; i < dividerCount; i += 1) {
      blocks.push({ type: 'divider' });
    }

    return blocks.length > 0 ? blocks : [];
  };

  const addBlock = (type) => {
    if (!editing) return;
    const next = { ...editing };
    next.blocks = Array.isArray(next.blocks) ? [...next.blocks, emptyBlock(type)] : [emptyBlock(type)];
    setEditing(next);
  };

  const updateBlock = (idx, patch) => {
    const next = { ...editing };
    const currentBlock = next.blocks?.[idx];
    if (currentBlock?.type === 'image' && patch.src && currentBlock.src && patch.src !== currentBlock.src) {
      deleteUploadedAsset(currentBlock.src);
    }
    next.blocks = next.blocks.map((b,i)=> i===idx ? { ...b, ...patch } : b);
    setEditing(next);
  };

  const removeBlock = (idx) => {
    const next = { ...editing };
    const blockToRemove = next.blocks?.[idx];
    if (blockToRemove?.type === 'image' && blockToRemove.src) {
      deleteUploadedAsset(blockToRemove.src);
    }
    next.blocks = next.blocks.filter((_,i)=>i!==idx);
    setEditing(next);
  };

  const moveBlock = (from, to) => {
    if (!editing) return;
    const arr = [...editing.blocks];
    const [item] = arr.splice(from,1);
    arr.splice(to,0,item);
    setEditing({ ...editing, blocks: arr });
  };

  const shellBackground = isDark
    ? 'linear-gradient(135deg, #020617 0%, #07142d 45%, #111827 100%)'
    : 'linear-gradient(135deg, #f8fbff 0%, #e8f0ff 45%, #f1f5f9 100%)';
  const panelBackground = isDark ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.96)';
  const panelBorder = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.10)';
  const panelHeading = isDark ? '#f8fafc' : '#0f172a';
  const panelText = isDark ? '#cbd5e1' : '#475569';
  const panelMuted = isDark ? '#94a3b8' : '#64748b';
  const panelInputBackground = isDark ? 'rgba(15, 23, 42, 0.65)' : 'rgba(248, 250, 252, 0.95)';
  const panelInputBorder = isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(148, 163, 184, 0.35)';
  const panelRowBackground = isDark ? 'rgba(15, 23, 42, 0.75)' : 'rgba(255, 255, 255, 0.96)';

  return (
    <div style={{ minHeight: 'auto', padding: 12, background: shellBackground, color: panelText, borderRadius: 24 }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div style={{ color: panelHeading }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.2em', color: isDark ? '#93c5fd' : '#2563eb', fontSize: 12 }}>
              <span>Email template builder</span>
            </div>
            <h2 style={{ margin: 0, fontSize: '1.6rem', lineHeight: 1.1, fontWeight: 700, color: panelHeading }}>Create and manage reusable email templates</h2>
          </div>
        </div>

        <div style={{ background: panelBackground, border: `1px solid ${panelBorder}`, borderRadius: 24, padding: 26, boxShadow: isDark ? '0 30px 80px rgba(0, 0, 0, 0.38)' : '0 30px 80px rgba(15, 23, 42, 0.12)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ minWidth: 260 }}>
              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.24em', color: isDark ? '#93c5fd' : '#2563eb' }}>Template workspace</div>
              <h2 style={{ margin: '10px 0 0', fontSize: '1.6rem', color: panelHeading, lineHeight: 1.1 }}>Email Templates</h2>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button onClick={() => { if (editing) { setEditing(null); } else { startNewTemplate('email'); } }} style={{ background: '#2563eb', color: '#fff', padding: '14px 18px', borderRadius: 14, border: 'none', fontWeight: 700, cursor: 'pointer' }}>{editing ? 'Cancel' : 'New Template'}</button>
              <button onClick={() => startNewTemplate('internal_message')} style={{ background: '#0f766e', color: '#fff', padding: '14px 18px', borderRadius: 14, border: 'none', fontWeight: 700, cursor: 'pointer' }}>New Internal Template</button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 18 }}>
            <div style={{ padding: 18, borderRadius: 18, background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15, 23, 42, 0.03)', border: `1px solid ${panelBorder}` }}>
              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.24em', color: isDark ? '#93c5fd' : '#2563eb', marginBottom: 10 }}>Saved templates</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {templates.length === 0 ? (
                  <div style={{ color: '#cbd5e1', fontSize: 14 }}>No saved templates yet.</div>
                ) : (
                  templates.map((template) => (
                    <div
                      key={template.id || template.name}
                      onMouseEnter={() => setHoveredTemplateId(template.id || template.name)}
                      onMouseLeave={() => setHoveredTemplateId(null)}
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'center',
                        padding: '12px 14px',
                        borderRadius: 12,
                        border: `1px solid ${panelBorder}`,
                        background: hoveredTemplateId === (template.id || template.name)
                          ? (isDark ? 'rgba(37, 99, 235, 0.20)' : 'rgba(37, 99, 235, 0.08)')
                          : panelRowBackground,
                        transform: hoveredTemplateId === (template.id || template.name) ? 'translateY(-1px)' : 'translateY(0)',
                        transition: 'all 0.22s ease',
                        boxShadow: hoveredTemplateId === (template.id || template.name)
                          ? (isDark ? '0 12px 28px rgba(28, 46, 93, 0.30)' : '0 12px 28px rgba(37, 99, 235, 0.12)')
                          : 'none'
                      }}
                    >
                      <div style={{ flex: 1, textAlign: 'left', padding: 0 }}>
                        <div style={{ fontWeight: 700 }}>{template.name || 'Untitled template'}</div>
                        <div style={{ color: panelMuted, fontSize: 12, marginTop: 4 }}>{template.subject || 'No subject'}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditing({ ...template, blocks: parseBodyToBlocks(template.body || '') })}
                        style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontWeight: 700, marginRight: 8 }}
                      >
                        Edit template
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!template.id) return;
                          if (!window.confirm(`Delete template "${template.name || 'Untitled template'}"?`)) return;
                          try {
                            const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
                            await axios.delete(`${API_BASE_URL}/admin/email/templates/${template.id}`, { headers: { Authorization: `Bearer ${token}` } });
                            await load();
                          } catch (err) {
                            console.error(err);
                            window.alert(err?.response?.data?.error || 'Failed to delete template');
                          }
                        }}
                        style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontWeight: 700 }}
                      >
                        Delete template
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {editing ? (
              <div style={{ padding: 18, borderRadius: 18, background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15, 23, 42, 0.03)', border: `1px solid ${panelBorder}`, display: 'grid', gap: 16 }}>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.24em', color: isDark ? '#93c5fd' : '#2563eb' }}>Template creation</div>
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    <label style={{ display: 'grid', gap: 6, color: panelHeading, fontWeight: 600 }}>
                      Template name
                      <input
                        value={editing.name || ''}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        style={{ padding: '12px 14px', borderRadius: 12, border: `1px solid ${panelInputBorder}`, background: panelInputBackground, color: panelHeading }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 6, color: panelHeading, fontWeight: 600 }}>
                      Template type
                      <select
                        aria-label="Template type"
                        value={editing.template_type || 'email'}
                        onChange={(e) => setEditing({ ...editing, template_type: e.target.value })}
                        style={{ padding: '12px 14px', borderRadius: 12, border: `1px solid ${panelInputBorder}`, background: panelInputBackground, color: panelHeading }}
                      >
                        <option value="email">Email template</option>
                        <option value="internal_message">Internal message template</option>
                      </select>
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    <label style={{ display: 'grid', gap: 6, color: panelHeading, fontWeight: 600 }}>
                      Subject
                      <input
                        value={editing.subject || ''}
                        onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                        style={{ padding: '12px 14px', borderRadius: 12, border: `1px solid ${panelInputBorder}`, background: panelInputBackground, color: panelHeading }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 6, color: panelHeading, fontWeight: 600 }}>
                      Enabled
                      <input
                        type="checkbox"
                        aria-label="Enabled"
                        checked={editing.enabled !== false}
                        onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                        style={{ width: 18, height: 18, marginTop: 10 }}
                      />
                    </label>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <button onClick={() => addBlock('header')} style={{ background: '#0f766e', color: '#fff', padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer' }}>Add Header</button>
                    <button onClick={() => addBlock('text')} style={{ background: '#2563eb', color: '#fff', padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer' }}>Add Text</button>
                    <button onClick={() => addBlock('button')} style={{ background: '#9333ea', color: '#fff', padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer' }}>Add Button</button>
                    <button onClick={() => addBlock('image')} style={{ background: '#ea580c', color: '#fff', padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer' }}>Add Image</button>
                    <button onClick={() => addBlock('divider')} style={{ background: '#334155', color: '#fff', padding: '10px 14px', borderRadius: 10, border: 'none', cursor: 'pointer' }}>Add Divider</button>
                  </div>

                  <div style={{ display: 'grid', gap: 12 }}>
                    {(editing.blocks || []).map((block, idx) => (
                      <div key={`${block.type}-${idx}`} style={{ padding: 14, borderRadius: 14, background: 'rgba(15, 23, 42, 0.78)', border: '1px solid rgba(148, 163, 184, 0.18)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                          <strong style={{ color: panelHeading }}>{block.type.toUpperCase()}</strong>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => moveBlock(idx, Math.max(0, idx - 1))} style={{ background: 'transparent', color: '#93c5fd', border: '1px solid rgba(147, 197, 253, 0.4)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>↑</button>
                            <button onClick={() => moveBlock(idx, Math.min((editing.blocks || []).length - 1, idx + 1))} style={{ background: 'transparent', color: '#93c5fd', border: '1px solid rgba(147, 197, 253, 0.4)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>↓</button>
                            <button onClick={() => removeBlock(idx)} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>Remove</button>
                          </div>
                        </div>

                        {block.type === 'header' && (
                          <input
                            value={block.text || ''}
                            onChange={(e) => updateBlock(idx, { text: e.target.value })}
                            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${panelInputBorder}`, background: panelInputBackground, color: panelHeading, marginBottom: 8 }}
                          />
                        )}

                        {block.type === 'text' && (
                          <textarea
                            value={block.text || ''}
                            onChange={(e) => updateBlock(idx, { text: e.target.value })}
                            rows={4}
                            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${panelInputBorder}`, background: panelInputBackground, color: panelHeading }}
                          />
                        )}

                        {block.type === 'button' && (
                          <div style={{ display: 'grid', gap: 8 }}>
                            <input value={block.text || ''} onChange={(e) => updateBlock(idx, { text: e.target.value })} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${panelInputBorder}`, background: panelInputBackground, color: panelHeading }} />
                            <input value={block.url || ''} onChange={(e) => updateBlock(idx, { url: e.target.value })} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${panelInputBorder}`, background: panelInputBackground, color: panelHeading }} />
                          </div>
                        )}

                        {block.type === 'image' && (
                          <div style={{ display: 'grid', gap: 8 }}>
                            <input value={block.src || ''} onChange={(e) => updateBlock(idx, { src: e.target.value })} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${panelInputBorder}`, background: panelInputBackground, color: panelHeading }} />
                            <input value={block.alt || ''} onChange={(e) => updateBlock(idx, { alt: e.target.value })} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${panelInputBorder}`, background: panelInputBackground, color: panelHeading }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <button onClick={save} style={{ background: '#16a34a', color: '#fff', padding: '12px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700 }}>Save Template</button>
                    <button onClick={() => setEditing(null)} style={{ background: 'transparent', color: '#cbd5e1', padding: '12px 16px', borderRadius: 12, border: '1px solid rgba(148, 163, 184, 0.35)', cursor: 'pointer' }}>Cancel</button>
                    <button onClick={preview} style={{ background: 'transparent', color: '#93c5fd', padding: '12px 16px', borderRadius: 12, border: '1px solid rgba(147, 197, 253, 0.45)', cursor: 'pointer' }}>Preview</button>
                    <button onClick={testTemplate} style={{ background: '#0f766e', color: '#fff', padding: '12px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700 }}>Test template</button>
                    <button onClick={restoreDefaultTemplate} style={{ background: '#7c3aed', color: '#fff', padding: '12px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700 }}>Restore default template</button>
                  </div>

                  <div style={{ display: 'grid', gap: 8 }}>
                    <label style={{ color: panelHeading, fontWeight: 600 }}>Template variables</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {TEMPLATE_VARIABLES.map((variable) => (
                        <span key={variable} style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 8px', borderRadius: 999, background: isDark ? 'rgba(96, 165, 250, 0.12)' : 'rgba(37, 99, 235, 0.08)', color: panelHeading, fontSize: 12 }}>
                          {variable}
                        </span>
                      ))}
                    </div>
                    <textarea
                      aria-label="Template preview data"
                      value={sampleData}
                      onChange={(event) => setSampleData(event.target.value)}
                      rows={6}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${panelInputBorder}`, background: panelInputBackground, color: panelHeading }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: 18, borderRadius: 18, background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15, 23, 42, 0.03)', border: `1px solid ${panelBorder}` }}>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.24em', color: isDark ? '#93c5fd' : '#2563eb', marginBottom: 8 }}>Template creation</div>
                <div style={{ color: panelText, fontSize: 14, marginBottom: 12 }}>Build reusable email templates for any automated communication.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
