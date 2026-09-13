import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAssetPreviewUrl } from "../../utils/assetPreview";
import { getContributorReputationTier } from "../../utils/statsUtils";
import { calculateLoyaltyPoints } from "../../utils/loyaltyPoints";
import "./ContributorAnalyticsDashboard.css";

const periods = ["Today", "7 Days", "30 Days", "90 Days", "365 Days", "Custom Range"];
const number = (value) => Number(value || 0).toLocaleString();
const money = (value) => `₹${Number(value || 0).toFixed(2)}`;
const field = (asset, ...keys) => keys.reduce((value, key) => value ?? asset?.[key], undefined);
const typeOf = (asset) => field(asset, "asset_type", "file_type", "type", "format") || "Unclassified";
const categoryValues = (asset) => {
  const value = field(asset, "category_name", "category") || "Unclassified";
  const labels = new Map();
  String(value).split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => {
    const key = item.toLowerCase();
    if (!labels.has(key)) labels.set(key, item);
  });
  return [...labels.values()];
};
const categoryOf = (asset) => categoryValues(asset).join(", ");
const categoryKey = (value) => String(value || "").trim().toLowerCase();
const statusOf = (asset) => String(asset?.status || "pending").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateOf = (value) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-";
export const getPeriodWindowMs = (period) => {
  const map = {
    Today: 24 * 60 * 60 * 1000,
    "7 Days": 7 * 24 * 60 * 60 * 1000,
    "30 Days": 30 * 24 * 60 * 60 * 1000,
    "90 Days": 90 * 24 * 60 * 60 * 1000,
    "365 Days": 365 * 24 * 60 * 60 * 1000,
  };

  return map[period] ?? map["30 Days"];
};

export const filterAssetsByPeriod = (assets, period, customRange = {}) => {
  if (period === "Custom Range") {
    const { start, end } = customRange;
    const startDate = start ? new Date(`${start}T00:00:00`) : null;
    const endDate = end ? new Date(`${end}T23:59:59.999`) : null;

    return assets.filter((asset) => {
      const createdAt = field(asset, "created_at", "uploaded_at", "updated_at");
      if (!createdAt) return true;
      const ts = new Date(createdAt).getTime();
      if (Number.isNaN(ts)) return true;

      if (startDate && ts < startDate.getTime()) return false;
      if (endDate && ts > endDate.getTime()) return false;
      return true;
    });
  }

  const windowMs = getPeriodWindowMs(period);
  const cutoff = Date.now() - windowMs;

  return assets.filter((asset) => {
    const createdAt = field(asset, "created_at", "uploaded_at", "updated_at");
    if (!createdAt) return true;
    const ts = new Date(createdAt).getTime();
    if (Number.isNaN(ts)) return true;
    return ts >= cutoff;
  });
};

export const filterAssetsByFilters = (assets, type, category) => assets.filter((asset) => (
  (type === "All types" || typeOf(asset) === type) &&
  (category === "All categories" || categoryValues(asset).some((value) => categoryKey(value) === categoryKey(category)))
));

export const sortAnalyticsAssets = (assets, sort) => assets.slice().sort((a, b) => {
  if (sort === "newest") {
    return new Date(field(b, "created_at", "uploaded_at", "updated_at") || 0) - new Date(field(a, "created_at", "uploaded_at", "updated_at") || 0);
  }

  const keys = {
    views: ["views", "view_count"],
    earnings: ["earnings", "earning_amount"],
    downloads: ["downloads", "download_count"],
  };
  const metricKeys = keys[sort] || keys.downloads;
  return Number(field(b, ...metricKeys) || 0) - Number(field(a, ...metricKeys) || 0);
});

const csvValue = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export const buildAnalyticsReportCsv = ({ period, type, category, metrics, assets: reportAssets }) => {
  const rows = [
    ["Contributor Analytics Report"],
    ["Period", period],
    ["Asset type", type],
    ["Category", category],
    [],
    ["Metric", "Value"],
    ...Object.entries(metrics || {}),
    [],
    ["Asset", "Type", "Category", "Status", "Created", "Views", "Downloads", "Earnings"],
    ...(reportAssets || []).map((asset) => [
      asset.title || asset.filename || "Untitled asset",
      typeOf(asset),
      categoryOf(asset),
      statusOf(asset),
      field(asset, "created_at", "uploaded_at") || "",
      field(asset, "views", "view_count") || 0,
      field(asset, "downloads", "download_count") || 0,
      field(asset, "earnings", "earning_amount") || 0,
    ]),
  ];

  return rows.map((row) => row.map(csvValue).join(",")).join("\n");
};

export default function ContributorAnalyticsDashboard({ darkMode, profile = {}, stats = {}, earnings = {}, assets = [], reputationScore, reputationTier }) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState("30 Days");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [type, setType] = useState("All types");
  const [category, setCategory] = useState("All categories");
  const [sort, setSort] = useState("downloads");
  const periodAssets = useMemo(() => filterAssetsByPeriod(assets, period, customRange), [assets, period, customRange]);
  const types = useMemo(() => [...new Set(periodAssets.map(typeOf))].sort(), [periodAssets]);
  const categories = useMemo(() => [...new Map(periodAssets.flatMap(categoryValues).map((label) => [categoryKey(label), label]))]
    .map(([, label]) => label)
    .sort((a, b) => a.localeCompare(b)), [periodAssets]);
  const filteredAssets = useMemo(() => filterAssetsByFilters(periodAssets, type, category), [periodAssets, type, category]);
  const uploads = filteredAssets.length;
  const downloads = filteredAssets.reduce((sum, asset) => sum + Number(field(asset, "downloads", "download_count") || 0), 0);
  const likes = filteredAssets.reduce((sum, asset) => sum + Number(field(asset, "likes", "like_count") || 0), 0);
  const views = filteredAssets.reduce((sum, asset) => sum + Number(field(asset, "views", "view_count") || 0), 0);
  const totalEarnings = filteredAssets.reduce((sum, asset) => sum + Number(field(asset, "earnings", "earning_amount") || 0), 0);
  const approved = filteredAssets.filter((asset) => String(asset?.status || "").toLowerCase() === "approved").length;
  const pending = filteredAssets.filter((asset) => String(asset?.status || "").toLowerCase() === "pending").length;
  const rejected = filteredAssets.filter((asset) => String(asset?.status || "").toLowerCase() === "rejected").length;
  const credits = Number(profile.credits ?? stats.credits ?? 0);
  const loyalty = calculateLoyaltyPoints(assets);
  const visibleAssets = useMemo(() => sortAnalyticsAssets(filteredAssets, sort).slice(0, 10), [filteredAssets, sort]);
  const submitted = approved + pending + rejected;
  const conversion = views ? `${((downloads / views) * 100).toFixed(1)}%` : "N/A";
  const score = Number(reputationScore ?? stats.reputation_score ?? 0);
  const tier = getContributorReputationTier(score);
  const badge = profile.badge || stats.badge || tier;
  const ratePerDownload = downloads ? Number(totalEarnings || 0) / downloads : 0;
  const requestPayout = () => window.dispatchEvent(new Event("redeemRequested"));

  const handlePeriodChange = (nextPeriod) => {
    setPeriod(nextPeriod);
    if (nextPeriod !== "Custom Range") {
      setCustomRange({ start: "", end: "" });
    }
  };

  const customRangeActive = period === "Custom Range";

  const exportReport = () => {
    const csv = buildAnalyticsReportCsv({
      period,
      type,
      category,
      metrics: {
        "Reputation Score": score,
        "Total Earnings": totalEarnings,
        "Total Downloads": downloads,
        "Total Uploads": uploads,
        "Total Likes": likes,
        "Total Views": views,
        "Loyalty Points": loyalty,
      },
      assets: visibleAssets,
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `contributor-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return <section className={`analytics-dashboard ${darkMode ? "is-dark" : ""}`}>
    <header className="analytics-header"><div><span className="contributor-kicker">Performance</span><h2>Contributor Analytics</h2><p>Track your assets, downloads, views, earnings and contributor growth.</p></div><button className="analytics-export" type="button" onClick={exportReport}>Export Report</button></header>
    <div className="analytics-controls"><div className="analytics-periods">{periods.map((item) => <button key={item} type="button" className={period === item ? "is-active" : ""} onClick={() => handlePeriodChange(item)}>{item}</button>)}</div><label>Asset type<select value={type} onChange={(event) => setType(event.target.value)}><option>All types</option>{types.map((item) => <option key={item}>{item}</option>)}</select></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label></div>
    {customRangeActive && <div className="custom-range-controls" style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "18px", flexWrap: "wrap" }}>
      <label style={{ display: "grid", gap: "6px", color: "var(--creator-muted)", fontSize: "10px", fontWeight: 750, textTransform: "uppercase", letterSpacing: ".08em" }}>
        Start date
        <input type="date" value={customRange.start} onChange={(event) => setCustomRange((prev) => ({ ...prev, start: event.target.value }))} style={{ minWidth: "140px", padding: "9px 10px", color: "var(--creator-ink)", background: "var(--creator-surface)", border: "1px solid var(--creator-line)", borderRadius: "9px", font: "inherit", fontSize: "12px" }} />
      </label>
      <label style={{ display: "grid", gap: "6px", color: "var(--creator-muted)", fontSize: "10px", fontWeight: 750, textTransform: "uppercase", letterSpacing: ".08em" }}>
        End date
        <input type="date" value={customRange.end} onChange={(event) => setCustomRange((prev) => ({ ...prev, end: event.target.value }))} style={{ minWidth: "140px", padding: "9px 10px", color: "var(--creator-ink)", background: "var(--creator-surface)", border: "1px solid var(--creator-line)", borderRadius: "9px", font: "inherit", fontSize: "12px" }} />
      </label>
    </div>}
    <div className="analytics-metrics"><article><span>Reputation Score</span><strong>{score}</strong><small>{tier}</small></article><article><span>Total Earnings</span><strong>{money(totalEarnings)}</strong><small>Lifetime balance</small></article><article><span>Total Downloads</span><strong>{number(downloads)}</strong><small>Across uploaded assets</small></article><article><span>Total Uploads</span><strong>{number(uploads)}</strong><small>Images shared by you</small></article><article><span>Total Likes</span><strong>{number(likes)}</strong><small>Across uploaded assets</small></article><article><span>Total Views</span><strong>{number(views)}</strong><small>Across uploaded assets</small></article><article><span>Loyalty Points</span><strong>{number(loyalty)} pts</strong><small>+1 upload day, -1 skipped day · {number(loyalty)}/365</small></article></div>
    <div className="analytics-grid"><article className="analytics-card"><span className="contributor-kicker">Credits</span><h3>{credits.toFixed(2)}</h3><button className="analytics-redeem-button" type="button" onClick={requestPayout}>Redeem</button></article><article className="analytics-card"><span className="contributor-kicker">Contributor badge</span><h3>{badge}</h3><div className="detail-list"><span>Current standing <b>{tier}</b></span></div></article><article className="analytics-card"><span className="contributor-kicker">Earnings</span><h3>{money(totalEarnings)}</h3><div className="detail-list"><span>Available balance <b>{earnings.available_balance != null ? money(earnings.available_balance) : "N/A"}</b></span><span>Pending earnings <b>{earnings.pending_earnings != null ? money(earnings.pending_earnings) : "N/A"}</b></span><span>Rate per download <b>{money(ratePerDownload)}</b></span></div></article><article className="analytics-card"><span className="contributor-kicker">Reach</span><h3>{number(views)} <small>views</small></h3><div className="detail-list"><span>Total downloads <b>{number(downloads)}</b></span><span>Average per upload <b>{uploads ? (downloads / uploads).toFixed(1) : "N/A"}</b></span><span>Download conversion <b>{conversion}</b></span></div></article><article className="analytics-card"><span className="contributor-kicker">Upload health</span><h3>{number(approved)} <small>approved</small></h3><div className="detail-list"><span>Pending <b>{number(pending)}</b></span><span>Rejected <b>{number(rejected)}</b></span><span>Approval rate <b>{submitted ? `${((approved / submitted) * 100).toFixed(1)}%` : "N/A"}</b></span></div></article><article className="analytics-card"><span className="contributor-kicker">Goals</span><h3>{number(approved)} approved</h3><div className="detail-list"><span>Upload goal <b>{number(uploads)}/50</b></span><span>Download goal <b>{number(downloads)}/100</b></span><span>View goal <b>{number(views)}/500</b></span></div></article></div>
    <article className="analytics-card assets-card"><div className="card-heading"><div><span className="contributor-kicker">Portfolio performance</span><h3>Top Performing Assets</h3></div><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="downloads">Downloads</option><option value="views">Views</option><option value="earnings">Earnings</option><option value="newest">Newest</option></select></div>{visibleAssets.length ? <div className="asset-table">{visibleAssets.map((asset) => { const assetId = asset.id || asset.image_id; const assetViews = Number(field(asset, "views", "view_count") || 0); const assetDownloads = Number(field(asset, "downloads", "download_count") || 0); const assetSlug = String(asset.title || asset.filename || "asset").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); return <button type="button" className="asset-row" key={assetId} onClick={() => navigate(`/asset/${assetSlug}-${assetId}`)}><img src={getAssetPreviewUrl(asset, { quality: 55, watermark: false })} alt={asset.title || "Asset preview"} loading="lazy" /><span><strong>{asset.title || asset.filename || "Untitled asset"}</strong><small>{typeOf(asset)} · {statusOf(asset)} · {dateOf(field(asset, "created_at", "uploaded_at"))}</small></span><b>{number(assetViews)} views<br />{number(assetDownloads)} downloads</b></button>; })}</div> : <div className="empty-state">No assets match the selected filters.</div>}</article>
  </section>;
}
