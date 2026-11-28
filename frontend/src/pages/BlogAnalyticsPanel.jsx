import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect, useState } from "react";
import { getEffectiveAuthToken } from "../utils/authSession";
import { formatIndiaDate } from "../utils/indiaTime";
import "./BlogAnalyticsPanel.css";

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
  const panelStyle = {
    "--blog-analytics-surface": theme.surface,
    "--blog-analytics-surface-alt": theme.surfaceAlt,
    "--blog-analytics-border": theme.border,
    "--blog-analytics-text": theme.text,
    "--blog-analytics-muted": theme.muted,
    "--blog-analytics-accent": theme.accent,
    "--blog-analytics-error": theme.error,
    "--blog-analytics-shadow": theme.shadow
  };
  const overview = data.overview || {};
  const kpis = [
    ["Total Blog Views", number(overview.totalViews)], ["Unique Blog Visitors", number(overview.uniqueVisitors)],
    ["Published Blogs", number(overview.publishedBlogs)], ["Draft Blogs", number(overview.draftBlogs)],
    ["Scheduled Blogs", number(overview.scheduledBlogs)], ["Average Reading Time", `${number(overview.averageReadingTime)} sec`],
    ["Engagement Rate", percent(overview.engagementRate)], ["Blog CTA Clicks", number(overview.ctaClicks)],
    ["Blog Signups", number(overview.signups)], ["Blog Purchases", number(overview.purchases)],
  ];

  if (loading) return <div className="blog-analytics-panel blog-analytics-panel--state" style={panelStyle}>Loading blog analytics...</div>;
  if (error) return <div className="blog-analytics-panel blog-analytics-panel--state is-error" style={panelStyle}>{error}</div>;

  return (
    <div className="blog-analytics-panel" style={panelStyle}>
      <header className="blog-analytics-panel__header">
        <div>
          <span className="blog-analytics-panel__eyebrow">Content performance</span>
          <h2>Blog Analytics</h2>
          <p>Real visitor, engagement, link, and conversion activity for the selected range.</p>
        </div>
        <label className="blog-analytics-panel__metric">
          <span>Chart metric</span>
          <select value={metric} onChange={(event) => setMetric(event.target.value)}>
            <option value="views">Views</option>
            <option value="uniqueVisitors">Unique Visitors</option>
          </select>
        </label>
      </header>

      <div className="blog-analytics-panel__kpis">
        {kpis.map(([label, value]) => (
          <div className="blog-analytics-panel__kpi" key={label}>
            <div className="blog-analytics-panel__kpi-label">{label}</div>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <section className="blog-analytics-panel__card">
        <div className="blog-analytics-panel__section-heading">
          <div>
            <h3>Blog Views Over Time</h3>
            <p>Daily activity for the selected date range</p>
          </div>
        </div>
        {data.timeline.length ? (
          <div className="blog-analytics-panel__timeline">
            {data.timeline.map((point) => (
              <div className="blog-analytics-panel__timeline-row" key={point.label}>
                <span className="blog-analytics-panel__timeline-label" title={point.label}>
                  {formatIndiaDate(point.label, { day: "numeric", month: "short" }) || point.label}
                </span>
                <div className="blog-analytics-panel__timeline-track">
                  <div
                    style={{
                      width: `${Math.min(100, (Number(point[metric] || 0) / Math.max(...data.timeline.map((item) => Number(item[metric] || 0)), 1)) * 100)}%`
                    }}
                  />
                </div>
                <strong>{number(point[metric])}</strong>
              </div>
            ))}
          </div>
        ) : <p className="blog-analytics-panel__empty">No blog analytics data yet.</p>}
      </section>

      <section className="blog-analytics-panel__card">
        <div className="blog-analytics-panel__section-heading">
          <div>
            <h3>Top Performing Blogs</h3>
            <p>Compare readership and conversion activity</p>
          </div>
        </div>
        <div className="blog-analytics-panel__table-scroll">
          <table className="blog-analytics-panel__table">
            <thead>
              <tr>
                {[["Blog", "title"], ["Views", "views"], ["Unique Visitors", "uniqueVisitors"], ["Reading Time", "averageReadingTime"], ["Link Clicks", "linkClicks"], ["Conversions", "conversions"]].map(([label, key]) => (
                  <th key={key}>
                    <button type="button" onClick={() => toggleSort(key)}>
                      {label} {key !== "title" ? (sortKey === key ? sortDirection === "asc" ? "↑" : "↓" : "↕") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortRows(data.topBlogs).map((row) => (
                <tr key={row.id}>
                  <td>{row.title || "Untitled blog"}</td>
                  <td>{number(row.views)}</td>
                  <td>{number(row.uniqueVisitors)}</td>
                  <td>{number(row.averageReadingTime)} sec</td>
                  <td>{number(row.linkClicks)}</td>
                  <td>{number(row.conversions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.topBlogs.length && <p className="blog-analytics-panel__empty">Publish a blog and start receiving visitors to see performance data here.</p>}
      </section>

      <div className="blog-analytics-panel__breakdown">
        {[
          ["Blog Status", data.statuses, "status", "count"],
          ["Performance by Category", data.categories, "category", "views"],
          ["Performance by Author", data.authors, "author", "views"],
          ["Traffic Sources", data.sources, "source", "visitors"],
          ["Devices", data.devices, "device", "visitors"],
          ["Audience by Country", data.countries, "country", "visitors"]
        ].map(([title, rows, labelKey, valueKey]) => (
          <section className="blog-analytics-panel__card" key={title}>
            <div className="blog-analytics-panel__section-heading">
              <h3>{title}</h3>
            </div>
            {rows.length ? (
              <div className="blog-analytics-panel__table-scroll">
                <table className="blog-analytics-panel__table blog-analytics-panel__table--compact">
                  <tbody>
                    {rows.slice(0, 10).map((row, index) => (
                      <tr key={`${title}-${row[labelKey]}-${index}`}>
                        <td>{row[labelKey]}</td>
                        <td className="is-numeric">{number(row[valueKey])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="blog-analytics-panel__empty">No data available for this range.</p>}
          </section>
        ))}
      </div>

      <section className="blog-analytics-panel__card">
        <div className="blog-analytics-panel__section-heading">
          <div>
            <h3>Blog Link Performance</h3>
            <p>Clicks and unique visitors for tracked blog links</p>
          </div>
        </div>
        <div className="blog-analytics-panel__table-scroll">
          <table className="blog-analytics-panel__table">
            <thead>
              <tr>{["Blog", "Link Text", "Destination", "Type", "Clicks", "Unique Clickers"].map((label) => <th key={label}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {data.links.map((row, index) => (
                <tr key={`${row.blog}-${row.destination}-${index}`}>
                  <td>{row.blog}</td>
                  <td>{row.linkText || "-"}</td>
                  <td>{row.destination || "-"}</td>
                  <td>{row.linkType}</td>
                  <td>{number(row.clicks)}</td>
                  <td>{number(row.uniqueClickers)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.links.length && <p className="blog-analytics-panel__empty">No blog link clicks recorded yet.</p>}
      </section>
    </div>
  );
}
