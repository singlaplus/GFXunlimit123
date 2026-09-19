import { useEffect, useState } from "react";
import { getEffectiveAuthToken } from "../utils/authSession";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const emptyData = { overview: {}, timeline: [], topBlogs: [], categories: [], authors: [], links: [], sources: [], devices: [], countries: [], statuses: [] };
const DEFAULT_THEME = { surface: "#ffffff", surfaceAlt: "#f8fafc", border: "#e2e8f0", text: "#0f172a", muted: "#64748b", accent: "#2563eb", error: "#dc2626", shadow: "0 14px 34px rgba(15, 23, 42, 0.08)" };
const DEFAULT_FILTERS = { range: "30d", startDate: "", endDate: "" };
const number = (value) => Number(value || 0).toLocaleString();
const percent = (value) => `${Number(value || 0).toFixed(2)}%`;

export default function BlogAnalyticsPanel({ filters = DEFAULT_FILTERS, theme = DEFAULT_THEME }) {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metric, setMetric] = useState("views");
  const [sortKey, setSortKey] = useState("views");
  const [sortDirection, setSortDirection] = useState("desc");

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ range: filters.range || "30d" });
    if (filters.range === "custom") {
      if (filters.startDate) params.set("from", filters.startDate);
      if (filters.endDate) params.set("to", filters.endDate);
    }
    setLoading(true);
    setError("");
    const request = typeof fetch === "function"
      ? fetch(`${API_BASE_URL}/admin/analytics/blogs?${params.toString()}`, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } })
      : Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    request
      .then((response) => { if (!response.ok) throw new Error(`Blog analytics request failed: ${response.status}`); return response.json(); })
      .then((response) => { if (active) setData({ ...emptyData, ...(response || {}) }); })
      .catch(() => { if (active) { setData(emptyData); setError("Unable to load blog analytics data right now."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters]);

  const sortRows = (rows) => rows.slice().sort((first, second) => {
    const firstValue = Number(first[sortKey] || 0);
    const secondValue = Number(second[sortKey] || 0);
    return sortDirection === "asc" ? firstValue - secondValue : secondValue - firstValue;
  });
  const toggleSort = (key) => {
    if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDirection("desc"); }
  };
  const cardStyle = { padding: "16px", borderRadius: "18px", border: `1px solid ${theme.border}`, background: theme.surface, boxShadow: theme.shadow };
  const tableStyle = { width: "100%", minWidth: "680px", borderCollapse: "collapse", color: theme.text };
  const headerStyle = { padding: "10px", textAlign: "left", color: theme.muted, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: `1px solid ${theme.border}` };
  const cellStyle = { padding: "10px", borderBottom: `1px solid ${theme.border}`, fontSize: "0.84rem" };
  const overview = data.overview || {};
  const kpis = [
    ["Total Blog Views", number(overview.totalViews)], ["Unique Blog Visitors", number(overview.uniqueVisitors)],
    ["Published Blogs", number(overview.publishedBlogs)], ["Draft Blogs", number(overview.draftBlogs)],
    ["Scheduled Blogs", number(overview.scheduledBlogs)], ["Average Reading Time", `${number(overview.averageReadingTime)} sec`],
    ["Engagement Rate", percent(overview.engagementRate)], ["Blog CTA Clicks", number(overview.ctaClicks)],
    ["Blog Signups", number(overview.signups)], ["Blog Purchases", number(overview.purchases)],
  ];

  if (loading) return <div style={{ ...cardStyle, color: theme.muted }}>Loading blog analytics...</div>;
  if (error) return <div style={{ ...cardStyle, color: theme.error }}>{error}</div>;

  return <div style={{ display: "grid", gap: "16px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
      <div><h2 style={{ margin: 0 }}>Blog Analytics</h2><p style={{ margin: "6px 0 0", color: theme.muted }}>Real visitor, engagement, link, and conversion activity for the selected range.</p></div>
      <label style={{ display: "flex", gap: "8px", alignItems: "center", color: theme.muted }}>Chart metric<select value={metric} onChange={(event) => setMetric(event.target.value)} style={{ padding: "8px", borderRadius: "8px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text }}><option value="views">Views</option><option value="uniqueVisitors">Unique Visitors</option></select></label>
    </div>
    <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>{kpis.map(([label, value]) => <div key={label} style={cardStyle}><div style={{ color: theme.muted, fontSize: "0.76rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div><strong style={{ display: "block", marginTop: "8px", fontSize: "1.35rem" }}>{value}</strong></div>)}</div>
    <div style={cardStyle}><h3 style={{ marginTop: 0 }}>Blog Views Over Time</h3>{data.timeline.length ? <div style={{ display: "grid", gap: "8px" }}>{data.timeline.map((point) => <div key={point.label} style={{ display: "grid", gridTemplateColumns: "90px 1fr 70px", gap: "10px", alignItems: "center", color: theme.muted, fontSize: "0.82rem" }}><span>{point.label}</span><div style={{ height: "9px", borderRadius: "999px", background: theme.surfaceAlt, overflow: "hidden" }}><div style={{ width: `${Math.min(100, (Number(point[metric] || 0) / Math.max(...data.timeline.map((item) => Number(item[metric] || 0)), 1)) * 100)}%`, height: "100%", background: theme.accent }} /></div><strong style={{ color: theme.text }}>{number(point[metric])}</strong></div>)}</div> : <p style={{ color: theme.muted }}>No blog analytics data yet.</p>}</div>
    <div style={{ ...cardStyle, overflowX: "auto" }}><h3 style={{ marginTop: 0 }}>Top Performing Blogs</h3><table style={tableStyle}><thead><tr>{[["Blog", "title"], ["Views", "views"], ["Unique Visitors", "uniqueVisitors"], ["Reading Time", "averageReadingTime"], ["Link Clicks", "linkClicks"], ["Conversions", "conversions"]].map(([label, key]) => <th key={key} style={headerStyle}><button type="button" onClick={() => toggleSort(key)} style={{ border: 0, padding: 0, background: "transparent", color: "inherit", cursor: "pointer", font: "inherit" }}>{label} {key !== "title" ? (sortKey === key ? sortDirection === "asc" ? "↑" : "↓" : "↕") : ""}</button></th>)}</tr></thead><tbody>{sortRows(data.topBlogs).map((row) => <tr key={row.id}><td style={cellStyle}>{row.title || "Untitled blog"}</td><td style={cellStyle}>{number(row.views)}</td><td style={cellStyle}>{number(row.uniqueVisitors)}</td><td style={cellStyle}>{number(row.averageReadingTime)} sec</td><td style={cellStyle}>{number(row.linkClicks)}</td><td style={cellStyle}>{number(row.conversions)}</td></tr>)}</tbody></table>{!data.topBlogs.length && <p style={{ color: theme.muted }}>Publish a blog and start receiving visitors to see performance data here.</p>}</div>
    <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
      {[["Blog Status", data.statuses, "status", "count"], ["Performance by Category", data.categories, "category", "views"], ["Performance by Author", data.authors, "author", "views"], ["Traffic Sources", data.sources, "source", "visitors"], ["Devices", data.devices, "device", "visitors"], ["Audience by Country", data.countries, "country", "visitors"]].map(([title, rows, labelKey, valueKey]) => <div key={title} style={{ ...cardStyle, overflowX: "auto" }}><h3 style={{ marginTop: 0 }}>{title}</h3>{rows.length ? <table style={tableStyle}><tbody>{rows.slice(0, 10).map((row, index) => <tr key={`${title}-${row[labelKey]}-${index}`}><td style={cellStyle}>{row[labelKey]}</td><td style={{ ...cellStyle, textAlign: "right" }}>{number(row[valueKey])}</td></tr>)}</tbody></table> : <p style={{ color: theme.muted }}>No data available for this range.</p>}</div>)}
    </div>
    <div style={{ ...cardStyle, overflowX: "auto" }}><h3 style={{ marginTop: 0 }}>Blog Link Performance</h3><table style={tableStyle}><thead><tr>{["Blog", "Link Text", "Destination", "Type", "Clicks", "Unique Clickers"].map((label) => <th key={label} style={headerStyle}>{label}</th>)}</tr></thead><tbody>{data.links.map((row, index) => <tr key={`${row.blog}-${row.destination}-${index}`}><td style={cellStyle}>{row.blog}</td><td style={cellStyle}>{row.linkText || "-"}</td><td style={cellStyle}>{row.destination || "-"}</td><td style={cellStyle}>{row.linkType}</td><td style={cellStyle}>{number(row.clicks)}</td><td style={cellStyle}>{number(row.uniqueClickers)}</td></tr>)}</tbody></table>{!data.links.length && <p style={{ color: theme.muted }}>No blog link clicks recorded yet.</p>}</div>
  </div>;
}
