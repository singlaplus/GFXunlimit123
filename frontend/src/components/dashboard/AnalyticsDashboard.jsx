import "./ContributorAnalyticsDashboard.css";

function AnalyticsDashboard({
  darkMode,
  profile = {},
  stats = {},
}) {
  const dashboardCards = [
    ["📊 Approved", stats.approved_images],
    ["⏳ Pending", stats.pending_images],
    ["❌ Rejected", stats.rejected_images],
    ["🔥 Best Downloads", stats.top_downloads || 0],
    ["👁 Best Views", stats.top_views || 0],
    ["❤️ Best Likes", stats.top_likes || 0],
  ];
  const statisticsCards = [
    ["📸 Uploads", stats.total_uploads],
    ["❤️ Likes", stats.total_likes],
    ["👁 Views", stats.total_views],
    ["⬇ Downloads", stats.total_downloads],
    ["💰 Earnings", `₹ ${Number(stats.total_earnings || 0).toFixed(2)}`],
  ];
  const downloads = Number(stats.total_downloads || 0);
  const earnings = Number(stats.total_earnings || 0);
  const credits = Number(profile.credits || 0);

  const requestPayout = () => {
    window.dispatchEvent(new Event("redeemRequested"));
  };

  return (
    <section className={`analytics-dashboard ${darkMode ? "is-dark" : ""}`}>
      <header className="analytics-header">
        <div>
          <h2>📊 Contributor Dashboard</h2>
        </div>
      </header>
      <div className="analytics-metrics">
        <article><span>Credits</span><strong className="credit-balance"><i className="credit-token-icon" aria-hidden="true">✦</i><span>{credits.toFixed(2)} credits</span></strong><button className="analytics-redeem-button" type="button" onClick={requestPayout}>Redeem</button></article>
        {dashboardCards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </div>
      <h3 className="contributor-section-heading">📈 Statistics</h3>
      <div className="analytics-metrics">
        {statisticsCards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </div>
      <article className="analytics-card">
        <h3>💰 Earnings Dashboard</h3>
        <div className="detail-list">
          <span>Total Earnings: <b>₹ {earnings.toFixed(2)}</b></span>
          <span>Total Downloads: <b>{downloads}</b></span>
          <span>Rate Per Download: <b>₹ {downloads ? (earnings / downloads).toFixed(2) : "0.00"}</b></span>
        </div>
      </article>
    </section>
  );
}

export default AnalyticsDashboard;