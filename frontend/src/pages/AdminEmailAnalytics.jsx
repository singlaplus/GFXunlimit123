import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { getEffectiveAuthToken } from '../utils/authSession';

function getBarColor(index, total) {
  const colors = ['#38bdf8', '#2563eb', '#818cf8', '#14b8a6', '#f59e0b'];
  if (total <= 1) return colors[0];
  return colors[index % colors.length];
}

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'lifetime', label: 'Lifetime' },
  { key: 'custom', label: 'Custom' },
];

const TREND_METRICS = [
  { key: 'sent', label: 'Sent' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'opened', label: 'Opened' },
  { key: 'clicked', label: 'Clicked' },
];

const getIsDarkMode = () => typeof document !== 'undefined' && document.body.classList.contains('dark-mode');

const LIGHT_THEME = {
  pageBg: '#f8fafc',
  surface: '#ffffff',
  surfaceAlt: '#f8fafc',
  border: '#e2e8f0',
  text: '#0f172a',
  muted: '#64748b',
  inputBg: '#ffffff',
  inputBorder: '#cbd5e1',
  buttonBg: '#eff6ff',
  buttonBorder: '#e2e8f0',
  buttonText: '#2563eb',
  cardBg: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(248,250,252,0.95))',
  chartBg: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
  tooltipBg: '#0f172a',
  tooltipText: '#fff',
  gridLine: '#e2e8f0',
  labelText: '#64748b',
};

const DARK_THEME = {
  pageBg: '#0f172a',
  surface: '#111827',
  surfaceAlt: '#1f2937',
  border: '#374151',
  text: '#f8fafc',
  muted: '#94a3b8',
  inputBg: '#1f2937',
  inputBorder: '#374151',
  buttonBg: '#1e293b',
  buttonBorder: '#334155',
  buttonText: '#93c5fd',
  cardBg: 'linear-gradient(135deg, rgba(17,24,39,0.96), rgba(30,41,59,0.95))',
  chartBg: 'linear-gradient(135deg, #111827 0%, #1f2937 100%)',
  tooltipBg: '#f8fafc',
  tooltipText: '#0f172a',
  gridLine: '#334155',
  labelText: '#94a3b8',
};

function formatDateValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export default function AdminEmailAnalytics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [range, setRange] = useState('7d');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [metric, setMetric] = useState('sent');
  const [isDarkMode, setIsDarkMode] = useState(getIsDarkMode);
  const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;

  useEffect(() => {
    // initial load and periodic refresh so sidebar/totals reflect live results
    load();
    const id = setInterval(() => load(), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const syncTheme = () => setIsDarkMode(getIsDarkMode());
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const load = async (nextRange = range, from = startDate, to = endDate) => {
    try {
      setLoading(true);
      setError('');
      const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
      const params = new URLSearchParams();
      params.set('range', nextRange);
      if (nextRange === 'custom' && from) params.set('from', from);
      if (nextRange === 'custom' && to) params.set('to', to);
      const res = await axios.get(`${API_BASE_URL}/admin/email/analytics?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      setData(res.data);
    } catch (err) {
      console.error(err);
      setError('Unable to load analytics data right now.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handlePreset = (nextRange) => {
    setRange(nextRange);
    if (nextRange !== 'custom') {
      load(nextRange, '', '');
    } else {
      load('custom', startDate, endDate);
    }
  };

  const applyCustomRange = () => load('custom', startDate, endDate);

  const exportCsv = async () => {
    const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;
    if (!token) {
      alert('Please sign in as an admin to export email analytics CSV.');
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set('range', range);
      if (range === 'custom' && startDate) params.set('from', startDate);
      if (range === 'custom' && endDate) params.set('to', endDate);

      const url = `${API_BASE_URL}/admin/email/analytics/export?${params.toString()}`;
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });

      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const downloadName = range === 'custom' ? `email-analytics-${startDate || 'custom'}-${endDate || 'current'}.csv` : `email-analytics-${range}.csv`;
      const urlObject = URL.createObjectURL(blob);
      link.href = urlObject;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(urlObject);
    } catch (err) {
      console.error('Failed to export email analytics CSV', err);
      alert(err?.response?.status === 401 ? 'Your admin session expired. Please sign in again to export CSV.' : 'Unable to export email analytics CSV right now.');
    }
  };

  const summaryCards = useMemo(() => {
    const totals = data?.totals || {};
    return [
      { label: 'Sent', value: totals.sent ?? 0, accent: 'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)' },
      { label: 'Delivered', value: totals.delivered ?? 0, accent: 'linear-gradient(135deg, #059669 0%, #34d399 100%)' },
      { label: 'Opened', value: totals.opened ?? 0, accent: 'linear-gradient(135deg, #d97706 0%, #fbbf24 100%)' },
      { label: 'Clicked', value: totals.clicked ?? 0, accent: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)' },
    ];
  }, [data]);

  const [hoveredDay, setHoveredDay] = useState(null);
  const theme = isDarkMode ? DARK_THEME : LIGHT_THEME;

  if (!data && loading) return <div style={{ padding: 24, color: theme.text }}>Loading analytics…</div>;

  if (!data && !loading) {
    return (
      <div style={{ padding: 24, color: theme.text }}>
        <div style={{ padding: 18, borderRadius: 14, background: theme.surface, border: `1px solid ${theme.border}`, maxWidth: 560 }}>
          <h2 style={{ margin: '0 0 8px', color: theme.text }}>Email Analytics</h2>
          <p style={{ margin: 0, color: theme.muted }}>{error || 'Unable to load analytics data right now.'}</p>
        </div>
      </div>
    );
  }

  const daily = data.daily || [];
  const metricKey = `${metric}_count`;
  const max = Math.max(1, ...daily.map((d) => Number(d[metricKey] || 0)));

  return (
    <div style={{ padding: 24, background: theme.pageBg, color: theme.text, minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, color: theme.text, fontSize: '1.2rem' }}>Email Analytics</h2>
          <p style={{ margin: '4px 0 0', color: theme.muted, fontSize: '0.95rem' }}>Track delivery performance with refined range controls.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => handlePreset(preset.key)}
              style={{
                border: range === preset.key ? `1px solid ${theme.buttonText}` : `1px solid ${theme.border}`,
                background: range === preset.key ? theme.buttonBg : theme.surface,
                color: range === preset.key ? theme.buttonText : theme.text,
                borderRadius: 999,
                padding: '8px 12px',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!token}
          title={token ? 'Export current email analytics as CSV' : 'Sign in as an admin to export CSV'}
          style={{
            border: `1px solid ${theme.border}`,
            background: token ? theme.surface : '#e2e8f0',
            color: token ? theme.text : '#64748b',
            borderRadius: 999,
            padding: '8px 12px',
            cursor: token ? 'pointer' : 'not-allowed',
            fontWeight: 700,
            opacity: token ? 1 : 0.7,
          }}
        >
          Export CSV
        </button>
      </div>

      {range === 'custom' ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18, padding: 14, borderRadius: 14, background: theme.surfaceAlt, border: `1px solid ${theme.border}` }}>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.9rem', color: theme.muted }}>
            <span>From</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.inputBorder}`, background: theme.inputBg, color: theme.text }} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: '0.9rem', color: theme.muted }}>
            <span>To</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.inputBorder}`, background: theme.inputBg, color: theme.text }} />
          </label>
          <button type="button" onClick={applyCustomRange} style={{ padding: '9px 14px', borderRadius: 10, background: 'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)', color: '#ffffff', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Apply</button>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        {summaryCards.map((card) => (
          <div key={card.label} style={{ padding: 18, borderRadius: 18, background: theme.cardBg, border: `1px solid ${theme.border}`, boxShadow: isDarkMode ? '0 18px 40px rgba(0, 0, 0, 0.24)' : '0 18px 40px rgba(15, 23, 42, 0.06)' }}>
            <div style={{ height: 6, borderRadius: 999, background: card.accent, marginBottom: 12 }} />
            <div style={{ color: theme.muted, fontSize: '0.9rem', fontWeight: 600 }}>{card.label}</div>
            <div style={{ marginTop: 6, fontSize: '1.8rem', fontWeight: 800, color: theme.text }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: 18, borderRadius: 20, background: theme.chartBg, border: `1px solid ${theme.border}`, boxShadow: isDarkMode ? '0 18px 40px rgba(0, 0, 0, 0.24)' : '0 18px 40px rgba(15, 23, 42, 0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, color: theme.text, fontSize: '1rem' }}>{TREND_METRICS.find((item) => item.key === metric)?.label || 'Sent'} trend</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label htmlFor="trend-metric" style={{ fontSize: '0.9rem', color: theme.muted }}>
              <span style={{ marginRight: 6 }}>Trend metric</span>
              <select id="trend-metric" value={metric} onChange={(e) => setMetric(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${theme.inputBorder}`, background: theme.inputBg, color: theme.text }}>
                {TREND_METRICS.map((item) => (
                  <option key={item.key} value={item.key}>{item.label}</option>
                ))}
              </select>
            </label>
            <span style={{ color: theme.muted, fontSize: '0.9rem' }}>{range === 'custom' ? 'Custom range' : 'Recent activity'}</span>
          </div>
        </div>
        <div style={{ paddingTop: 6 }}>
          {daily.length === 0 ? (
            <div style={{ color: theme.muted, padding: '12px 0' }}>No data for this range yet.</div>
          ) : (() => {
            const chartWidth = 100;
            const chartHeight = 120;
            const padding = 10;
            const points = daily.map((d) => {
              const countValue = Number(d[metricKey] || 0);
              const x = daily.length === 1 ? 50 : padding + ((daily.indexOf(d) / (daily.length - 1)) * (chartWidth - padding * 2));
              const y = chartHeight - padding - (countValue / max) * (chartHeight - padding * 2);
              return { day: d.day, countValue, x, y };
            });
            const path = points.map((point) => `${point.x},${point.y}`).join(' ');
            const areaPath = `${points.map((point) => `${point.x},${point.y}`).join(' ')} ${points[points.length - 1].x},${chartHeight - padding} ${points[0].x},${chartHeight - padding}`;
            return (
              <div>
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: 180 }}>
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                    <line key={ratio} x1={padding} x2={chartWidth - padding} y1={padding + (chartHeight - padding * 2) * ratio} y2={padding + (chartHeight - padding * 2) * ratio} stroke={theme.gridLine} strokeDasharray="3 3" />
                  ))}
                  <polyline points={path} fill="none" stroke="#2563eb" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points={areaPath} fill="rgba(37, 99, 235, 0.08)" stroke="none" />
                  {points.map((point) => {
                    const isHovered = hoveredDay === point.day;
                    return (
                      <g key={point.day}>
                        <circle
                          data-testid={`analytics-bar-${point.day}`}
                          cx={point.x}
                          cy={point.y}
                          r={isHovered ? 3.2 : 2.4}
                          fill={isHovered ? '#f59e0b' : '#2563eb'}
                          stroke="#fff"
                          strokeWidth="1.4"
                          onMouseEnter={() => setHoveredDay(point.day)}
                          onMouseLeave={() => setHoveredDay(null)}
                        />
                      </g>
                    );
                  })}
                </svg>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  {points.map((point) => (
                    <div key={point.day} style={{ fontSize: 10, color: theme.muted, textAlign: 'center', width: `${100 / points.length}%` }}>{String(point.day || '').slice(5)}</div>
                  ))}
                </div>
                {hoveredDay ? (
                  <div style={{ marginTop: 8, padding: '8px 10px', background: theme.tooltipBg, color: theme.tooltipText, borderRadius: 8, fontSize: 12, display: 'inline-block' }}>
                    {daily.find((d) => d.day === hoveredDay)?.day} · {Number(daily.find((d) => d.day === hoveredDay)?.[metricKey] || 0)} {metric}
                  </div>
                ) : null}
              </div>
            );
          })()}
        </div>
      </div>

      {loading ? <div style={{ marginTop: 12, color: theme.muted }}>Refreshing analytics…</div> : null}
    </div>
  );
}
