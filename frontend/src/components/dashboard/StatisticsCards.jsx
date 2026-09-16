function StatisticsCards({
  dashboardStats,
  earningsStats,
  contributorBadge,
  averageLikes,
  totalImages,
  totalLikes,
  totalViews,
  totalDownloads,
  darkMode,
}) {
  const isDark = Boolean(darkMode);
  const cards = [
    {
      title: "📸 Uploads",
      value: dashboardStats.uploads || 0,
      color: "#2196f3",
    },
    {
      title: "❤️ Likes",
      value: dashboardStats.likes || 0,
      color: "#e91e63",
    },
    {
      title: "👁 Views",
      value: dashboardStats.views || 0,
      color: "#ff9800",
    },
    {
      title: "⬇ Downloads",
      value: dashboardStats.downloads || 0,
      color: "#4caf50",
    },
    {
      title: "💰 Earnings",
      value: `₹${earningsStats.total_earnings || 0}`,
      color: "#673ab7",
    },
    {
      title: "🏅 Badge",
      value: contributorBadge,
      color: "#009688",
    },
    {
      title: "⭐ Avg Likes / Image",
      value: averageLikes,
      color: "#3f51b5",
    },
    {
      title: "🌍 Site Images",
      value: totalImages,
      color: "#795548",
    },
    {
      title: "❤️ Site Likes",
      value: totalLikes,
      color: "#c2185b",
    },
    {
      title: "👁 Site Views",
      value: totalViews,
      color: "#ff5722",
    },
    {
      title: "⬇ Site Downloads",
      value: totalDownloads,
      color: "#607d8b",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit,minmax(220px,1fr))",
        gap: "16px",
        marginBottom: "25px",
      }}
    >
      {cards.map((card, index) => (
        <div
          key={index}
          style={{
            background: isDark ? "rgba(15, 23, 42, 0.92)" : "rgba(255, 255, 255, 0.95)",
            color: isDark ? "#f8fafc" : "#0f172a",
            borderRadius: "18px",
            padding: "20px",
            textAlign: "center",
            boxShadow: isDark
              ? "0 12px 30px rgba(2, 6, 23, 0.35)"
              : "0 10px 24px rgba(15, 23, 42, 0.08)",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(148,163,184,0.2)"}`,
            borderLeft: `4px solid ${card.color}`,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: isDark
                ? "linear-gradient(135deg, rgba(255,255,255,0.05), transparent 70%)"
                : "linear-gradient(135deg, rgba(99,102,241,0.06), transparent 70%)",
              pointerEvents: "none",
            }}
          />
          <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>{card.title}</h3>

          <h2 style={{ margin: 0, fontSize: "24px" }}>{card.value}</h2>
        </div>
      ))}
    </div>
  );
}

export default StatisticsCards;