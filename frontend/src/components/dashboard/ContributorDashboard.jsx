import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { buildAuthHeaders, getEffectiveAuthToken } from "../../utils/authSession";
import { getAssetPreviewUrl } from "../../utils/assetPreview";
import Pagination from "../Pagination";
import ContributorAccountDashboard from "./ContributorAccountDashboard";
import ContributorAnalyticsDashboard from "./ContributorAnalyticsDashboard";
import EarningsTabPage from "./EarningsTabPage";
import "./ContributorDashboard.css";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const navGroups = [
  { label: "", items: [["overview", "Home"]] },
  { label: "Earnings", collapsible: true, items: [["earnings", "Earnings summary"], ["payments", "Payment history"], ["tax", "Tax center"]] },
  { label: "Insights", collapsible: true, items: [["top-performer", "Top performer"], ["blog", "Blog"], ["trending-content", "Trending content"]] },
  { label: "", items: [["portfolio", "Portfolio"]] },
  { label: "Account", collapsible: true, items: [["account-settings", "Account settings"], ["public-profile", "Public profile"]] },
  { label: "", items: [["support", "Help"]] },
];

const number = (value) => Number(value || 0).toLocaleString();
const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const dateLabel = (value) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-";
const statusLabel = (value) => String(value || "pending").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const PORTFOLIO_PAGE_SIZE = 6;

export default function ContributorDashboard({ darkMode, username, reputationScore, reputationTier, branding = {} }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [section, setSection] = useState(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab === "account" || tab === "analytics" ? tab : "overview";
  });
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState({});
  const [earnings, setEarnings] = useState({});
  const [assets, setAssets] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [earningsOpen, setEarningsOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [portfolioPage, setPortfolioPage] = useState(1);
  const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;

  useEffect(() => {
    const tab = new URLSearchParams(location.search).get("tab");
    setSection(tab === "account" || tab === "analytics" ? tab : "overview");
  }, [location.search]);

  useEffect(() => {
    const onCreditsRedeemed = (event) => {
      const redeemedCredits = Number(event.detail?.credits || 0);
      setProfile((current) => current ? { ...current, credits: Math.max(0, Number(current.credits || 0) - redeemedCredits) } : current);
    };
    window.addEventListener("creditsRedeemed", onCreditsRedeemed);
    return () => window.removeEventListener("creditsRedeemed", onCreditsRedeemed);
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!token) { setLoading(false); return undefined; }
    const headers = buildAuthHeaders(token);
    Promise.allSettled([
      axios.get(`${API_BASE_URL}/profile`, { headers }),
      axios.get(`${API_BASE_URL}/profile/stats`, { headers }),
      axios.get(`${API_BASE_URL}/earnings-dashboard`, { headers }),
      axios.get(`${API_BASE_URL}/my-uploads?view=all`, { headers }),
      axios.get(`${API_BASE_URL}/notifications/${encodeURIComponent(username || "")}`, { headers }),
    ]).then((results) => {
      if (!mounted) return;
      const [profileResult, statsResult, earningsResult, assetsResult, notificationsResult] = results;
      if (profileResult.status === "fulfilled") setProfile(profileResult.value.data?.user || profileResult.value.data);
      if (statsResult.status === "fulfilled") setStats(statsResult.value.data || {});
      if (earningsResult.status === "fulfilled") setEarnings(earningsResult.value.data || {});
      if (assetsResult.status === "fulfilled") setAssets(Array.isArray(assetsResult.value.data) ? assetsResult.value.data : []);
      if (notificationsResult.status === "fulfilled") setNotifications(Array.isArray(notificationsResult.value.data) ? notificationsResult.value.data : []);
      if (results.every((result) => result.status === "rejected")) setError("We could not load your contributor workspace.");
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [token, username]);

  const displayName = profile?.full_name || profile?.username || username || "Contributor";
  const approved = Number(stats.approved_images || 0);
  const rejected = Number(stats.rejected_images || 0);
  const unread = notifications.filter((item) => !item.is_read).length;
  const recentAssets = useMemo(() => assets.slice(0, 6), [assets]);
  const approvedAssets = useMemo(() => assets.filter((asset) => String(asset.status || "").toLowerCase() === "approved"), [assets]);
  const portfolioPageCount = Math.max(1, Math.ceil(approvedAssets.length / PORTFOLIO_PAGE_SIZE));
  const visiblePortfolioAssets = approvedAssets.slice((portfolioPage - 1) * PORTFOLIO_PAGE_SIZE, portfolioPage * PORTFOLIO_PAGE_SIZE);
  const go = (key) => {
    if (key === "upload") { navigate("/upload"); return; }
    if (key === "assets") { navigate("/myuploads"); return; }
    if (key === "portfolio") { setPortfolioPage(1); setSection("portfolio"); return; }
    if (key === "account-settings") { navigate("/account-settings"); return; }
    if (key === "public-profile") { navigate("/public-profile"); return; }
    if (key === "payments") { navigate("/payments"); return; }
    if (key === "favorites") { navigate("/favorites"); return; }
    if (key === "support") { navigate("/contact"); return; }
    if (key === "analytics" || key === "account") { navigate(`/dashboard?tab=${key}`); return; }
    setSection(key);
  };

  if (loading) return <div className={`contributor-shell ${darkMode ? "is-dark" : ""}`}><div className="contributor-loading"><span /><span /><span /></div></div>;

  return <div className={`contributor-shell ${darkMode ? "is-dark" : ""} ${section === "account" ? "account-only" : ""}`}>
    {section !== "analytics" && <aside className="contributor-sidebar">
      <div className="contributor-nav">
        {navGroups.map((group, groupIndex) => <div key={`${group.label || "main"}-${groupIndex}`}>{group.collapsible ? <><button type="button" className={(group.label === "Earnings" ? earningsOpen : group.label === "Insights" ? insightsOpen : accountOpen) ? "is-active" : ""} onClick={() => group.label === "Earnings" ? setEarningsOpen((isOpen) => !isOpen) : group.label === "Insights" ? setInsightsOpen((isOpen) => !isOpen) : setAccountOpen((isOpen) => !isOpen)} aria-expanded={group.label === "Earnings" ? earningsOpen : group.label === "Insights" ? insightsOpen : accountOpen}>{group.label} <span aria-hidden="true">{(group.label === "Earnings" ? earningsOpen : group.label === "Insights" ? insightsOpen : accountOpen) ? "−" : "+"}</span></button>{(group.label === "Earnings" ? earningsOpen : group.label === "Insights" ? insightsOpen : accountOpen) && <div className="contributor-subnav">{group.items.map(([key, label]) => <button key={key} className={section === key ? "is-active" : ""} onClick={() => go(key)} type="button">{label}</button>)}</div>}</> : group.items.map(([key, label]) => <button key={key} className={section === key ? "is-active" : ""} onClick={() => go(key)} type="button">{label}{key === "notifications" && unread > 0 && <em>{unread}</em>}</button>)}</div>)}
      </div>
    </aside>}
    <main className="contributor-main">
      <header className="contributor-header"><div className="contributor-avatar">{displayName.charAt(0).toUpperCase()}</div><div><span className="contributor-kicker">Contributor studio</span><h1>Welcome back, {displayName.split(" ")[0]}</h1><p>@{profile?.username || username || "creator"} · {profile?.email || "Your creator account"}</p></div></header>
      {error && <div className="contributor-error"><span>{error}</span><button type="button" onClick={() => window.location.reload()}>Retry</button></div>}
      <section className="contributor-hero contributor-rank-banner" aria-label="Contributor banner" style={branding.contributorBanner ? { backgroundImage: `url(${API_BASE_URL}${branding.contributorBanner})` } : undefined} />
      {section === "portfolio" && <section className="contributor-section contributor-portfolio-section"><div className="contributor-section-heading"><div><span className="contributor-kicker">Portfolio</span><h2>Approved assets</h2></div><span className="section-count">{approvedAssets.length} assets</span></div>{approvedAssets.length ? <><div className="contributor-assets">{visiblePortfolioAssets.map((asset) => <article className="contributor-asset" key={asset.id || asset.image_id}><img src={getAssetPreviewUrl(asset, { quality: 65, watermark: false })} alt={asset.title || "Asset preview"} loading="lazy" /><span><strong>{asset.title || asset.filename || "Untitled asset"}</strong><small>{number(asset.downloads)} downloads</small></span></article>)}</div>{portfolioPageCount > 1 && <Pagination currentPage={portfolioPage} totalPages={portfolioPageCount} totalImages={approvedAssets.length} setCurrentPage={setPortfolioPage} darkMode={darkMode} />}</> : <div className="contributor-empty"><h3>No approved assets yet</h3><p>Approved contributor assets will appear here.</p></div>}</section>}
        {section === "account" && <ContributorAccountDashboard darkMode={darkMode} profile={profile || {}} stats={stats} reputationScore={reputationScore} reputationTier={reputationTier} onNavigate={go} />}
      {section === "overview" && <>
        <EarningsTabPage
          reputationScore={reputationScore}
          reputationTier={reputationTier}
          totalEarnings={earnings.total_earnings || stats.total_earnings || 0}
          totalDownloads={stats.total_downloads || earnings.total_downloads || 0}
          totalUploads={stats.total_uploads || stats.uploads || 0}
          likes={stats.total_likes || stats.likes || 0}
          views={stats.total_views || stats.views || 0}
          monthsOld={profile?.months_old || profile?.monthsOld || 1}
          darkMode={darkMode}
        />
        <div className="contributor-section-heading"><div><span className="contributor-kicker">Portfolio pulse</span><h2>Your creative business</h2></div><button type="button" onClick={() => go("assets")}>Manage assets <span>→</span></button></div>
        <section className="contributor-grid contributor-grid-main"><article className="contributor-panel earnings-panel"><div className="panel-heading"><div><span className="contributor-kicker">Earnings</span><h3>{money(earnings.total_earnings || stats.total_earnings)}</h3></div><span className="panel-trend">Lifetime</span></div><div className="mini-chart" aria-label="Earnings trend"><i /><i /><i /><i /><i /><i /><i /></div><div className="panel-foot"><span>Available balance</span><strong>{money(earnings.available_balance)}</strong></div></article><article className="contributor-panel"><div className="panel-heading"><div><span className="contributor-kicker">Asset performance</span><h3>{number(stats.total_views)} <small>views</small></h3></div></div><div className="performance-rows"><span><b style={{ width: "76%" }} />Approved assets <strong>{approved}</strong></span><span><b style={{ width: "34%" }} />Rejected assets <strong>{rejected}</strong></span><span><b style={{ width: "52%" }} />Downloads <strong>{number(stats.total_downloads)}</strong></span></div></article></section>
        <section className="contributor-section" id="contributor-analytics"><div className="contributor-section-heading"><div><span className="contributor-kicker">Latest work</span><h2>Recent uploads</h2></div><span className="section-count">{assets.length} assets</span></div>{recentAssets.length ? <div className="contributor-assets">{recentAssets.map((asset) => { const assetId = asset.id || asset.image_id; const assetSlug = String(asset.title || asset.filename || "asset").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); return <button type="button" className="contributor-asset" key={assetId} onClick={() => navigate(`/asset/${assetSlug}-${assetId}`)}><img src={getAssetPreviewUrl(asset, { quality: 65, watermark: false })} alt={asset.title || "Asset preview"} loading="lazy" /><span><strong>{asset.title || asset.filename || "Untitled asset"}</strong><small>{statusLabel(asset.status)} · {number(asset.downloads)} downloads</small></span></button>; })}</div> : <div className="contributor-empty"><h3>Your portfolio starts here</h3><p>Upload your first asset and track its journey from processing to marketplace.</p><button type="button" onClick={() => go("upload")}>Upload an asset</button></div>}</section>
        <section className="contributor-grid contributor-grid-lower"><article className="contributor-panel"><div className="panel-heading"><div><span className="contributor-kicker">Momentum</span><h3>Creator goals</h3></div></div><div className="goal"><span><strong>Upload consistently</strong><small>{approved} of 10 approved assets</small></span><b><i style={{ width: `${Math.min(100, approved * 10)}%` }} /></b></div><div className="goal"><span><strong>Reach more customers</strong><small>{number(stats.total_downloads)} of 100 downloads</small></span><b><i style={{ width: `${Math.min(100, Number(stats.total_downloads || 0))}%` }} /></b></div></article><article className="contributor-panel"><div className="panel-heading"><div><span className="contributor-kicker">Activity</span><h3>Latest updates</h3></div><button className="panel-link" type="button" onClick={() => go("notifications")}>View all</button></div>{notifications.slice(0, 3).map((item) => <div className="activity-item" key={item.id}><span className="activity-dot" /><div><strong>{item.message || "Your account has a new update."}</strong><small>{dateLabel(item.created_at)}</small></div></div>)}{notifications.length === 0 && <p className="muted-copy">You are all caught up.</p>}</article></section>
      </>}
      {section === "analytics" && <ContributorAnalyticsDashboard
        darkMode={darkMode}
        profile={profile || {}}
        stats={stats}
        earnings={earnings}
        assets={assets}
        reputationScore={reputationScore}
        reputationTier={reputationTier}
      />}
    </main>
  </div>;
}