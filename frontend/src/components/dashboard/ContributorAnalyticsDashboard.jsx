import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAssetPreviewUrl } from "../../utils/assetPreview";
import { getContributorReputationTier } from "../../utils/statsUtils";
import "./ContributorAnalyticsDashboard.css";

const periods = ["Today", "7 Days", "30 Days", "90 Days", "365 Days", "Custom Range"];
const number = (value) => Number(value || 0).toLocaleString();
const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const field = (asset, ...keys) => keys.reduce((value, key) => value ?? asset?.[key], undefined);
const typeOf = (asset) => field(asset, "asset_type", "file_type", "type", "format") || "Unclassified";
const categoryOf = (asset) => field(asset, "category_name", "category") || "Unclassified";
const statusOf = (asset) => String(asset?.status || "pending").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateOf = (value) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-";

export default function ContributorAnalyticsDashboard({ darkMode, profile = {}, stats = {}, earnings = {}, assets = [], reputationScore, reputationTier }) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState("30 Days");
  const [type, setType] = useState("All types");
  const [category, setCategory] = useState("All categories");
  const [sort, setSort] = useState("downloads");
  const uploads = Number(stats.total_uploads ?? stats.totalUploads ?? 0);
  const downloads = Number(stats.total_downloads ?? stats.downloads ?? 0);
  const likes = Number(stats.total_likes ?? stats.likes ?? 0);
  const views = Number(stats.total_views ?? stats.views ?? 0);
  const totalEarnings = Number(earnings.total_earnings ?? stats.total_earnings ?? 0);
  const approved = Number(stats.approved_images || 0);
  const pending = Number(stats.pending_images || 0);
  const rejected = Number(stats.rejected_images || 0);
  const credits = Number(profile.credits ?? stats.credits ?? 0);
  const loyalty = stats.loyalty_points != null ? Number(stats.loyalty_points) : Math.max(0, uploads - 2);
  const types = useMemo(() => [...new Set(assets.map(typeOf))].sort(), [assets]);
  const categories = useMemo(() => [...new Set(assets.map(categoryOf))].sort(), [assets]);
  const visibleAssets = useMemo(() => assets.filter((asset) => (type === "All types" || typeOf(asset) === type) && (category === "All categories" || categoryOf(asset) === category)).sort((a, b) => {
    if (sort === "newest") return new Date(field(b, "created_at", "uploaded_at") || 0) - new Date(field(a, "created_at", "uploaded_at") || 0);
    const key = sort === "views" ? "views" : sort === "earnings" ? "earnings" : "downloads";
    return Number(field(b, key) || 0) - Number(field(a, key) || 0);
  }).slice(0, 10), [assets, type, category, sort]);
  const submitted = approved + pending + rejected;
  const conversion = views ? `${((downloads / views) * 100).toFixed(1)}%` : "N/A";
  const score = Number(reputationScore ?? stats.reputation_score ?? 0);
  const tier = getContributorReputationTier(score);
  const badge = profile.badge || stats.badge || tier;
  const ratePerDownload = downloads ? Number(totalEarnings || 0) / downloads : 0;
  const requestPayout = () => window.dispatchEvent(new Event("redeemRequested"));

  return <section className={`analytics-dashboard ${darkMode ? "is-dark" : ""}`}>
    <header className="analytics-header"><div><span className="contributor-kicker">Performance</span><h2>Contributor Analytics</h2><p>Track your assets, downloads, views, earnings and contributor growth.</p></div><button className="analytics-export" type="button" disabled>Export Report</button></header>
    <div className="analytics-controls"><div className="analytics-periods">{periods.map((item) => <button key={item} type="button" className={period === item ? "is-active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}</div><label>Asset type<select value={type} onChange={(event) => setType(event.target.value)}><option>All types</option>{types.map((item) => <option key={item}>{item}</option>)}</select></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label></div>
    <div className="analytics-metrics"><article><span>Reputation Score</span><strong>{score}</strong><small>{tier}</small></article><article><span>Total Earnings</span><strong>{money(totalEarnings)}</strong><small>Lifetime balance</small></article><article><span>Total Downloads</span><strong>{number(downloads)}</strong><small>Across uploaded assets</small></article><article><span>Total Uploads</span><strong>{number(uploads)}</strong><small>Images shared by you</small></article><article><span>Total Likes</span><strong>{number(likes)}</strong><small>Across uploaded assets</small></article><article><span>Total Views</span><strong>{number(views)}</strong><small>Across uploaded assets</small></article><article><span>Loyalty Points</span><strong>{number(loyalty)} pts</strong><small>365-day milestone {number(loyalty)}/365</small></article></div>
    <div className="analytics-grid"><article className="analytics-card"><span className="contributor-kicker">Credits</span><h3>{credits.toFixed(2)}</h3><button className="analytics-redeem-button" type="button" onClick={requestPayout}>Redeem</button></article><article className="analytics-card"><span className="contributor-kicker">Contributor badge</span><h3>{badge}</h3><div className="detail-list"><span>Current standing <b>{tier}</b></span></div></article><article className="analytics-card"><span className="contributor-kicker">Earnings</span><h3>{money(totalEarnings)}</h3><div className="detail-list"><span>Available balance <b>{earnings.available_balance != null ? money(earnings.available_balance) : "N/A"}</b></span><span>Pending earnings <b>{earnings.pending_earnings != null ? money(earnings.pending_earnings) : "N/A"}</b></span><span>Rate per download <b>{money(ratePerDownload)}</b></span></div></article><article className="analytics-card"><span className="contributor-kicker">Reach</span><h3>{number(views)} <small>views</small></h3><div className="detail-list"><span>Total downloads <b>{number(downloads)}</b></span><span>Average per upload <b>{uploads ? (downloads / uploads).toFixed(1) : "N/A"}</b></span><span>Download conversion <b>{conversion}</b></span></div></article><article className="analytics-card"><span className="contributor-kicker">Upload health</span><h3>{number(approved)} <small>approved</small></h3><div className="detail-list"><span>Pending <b>{number(pending)}</b></span><span>Rejected <b>{number(rejected)}</b></span><span>Approval rate <b>{submitted ? `${((approved / submitted) * 100).toFixed(1)}%` : "N/A"}</b></span></div></article><article className="analytics-card"><span className="contributor-kicker">Goals</span><h3>{number(approved)} approved</h3><div className="detail-list"><span>Upload goal <b>{number(uploads)}/50</b></span><span>Download goal <b>{number(downloads)}/100</b></span><span>View goal <b>{number(views)}/500</b></span></div></article></div>
    <article className="analytics-card assets-card"><div className="card-heading"><div><span className="contributor-kicker">Portfolio performance</span><h3>Top Performing Assets</h3></div><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="downloads">Downloads</option><option value="views">Views</option><option value="earnings">Earnings</option><option value="newest">Newest</option></select></div>{visibleAssets.length ? <div className="asset-table">{visibleAssets.map((asset) => { const assetId = asset.id || asset.image_id; const assetViews = Number(field(asset, "views", "view_count") || 0); const assetDownloads = Number(field(asset, "downloads", "download_count") || 0); const assetSlug = String(asset.title || asset.filename || "asset").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); return <button type="button" className="asset-row" key={assetId} onClick={() => navigate(`/asset/${assetSlug}-${assetId}`)}><img src={getAssetPreviewUrl(asset, { quality: 55, watermark: false })} alt={asset.title || "Asset preview"} loading="lazy" /><span><strong>{asset.title || asset.filename || "Untitled asset"}</strong><small>{typeOf(asset)} · {statusOf(asset)} · {dateOf(field(asset, "created_at", "uploaded_at"))}</small></span><b>{number(assetViews)} views<br />{number(assetDownloads)} downloads</b></button>; })}</div> : <div className="empty-state">No assets match the selected filters.</div>}</article>
  </section>;
}
