function ContributorRankCard({
  username,
  contributorRank,
  contributorLevel,
  reputationScore,
  reputationTier,
  rawScore,
  monthsOld,
  dashboardStats,
  maxUploads,
  nextRank,
  contributorBadge,
  earningsStats,
  darkMode,
}) {
  const isDark = Boolean(darkMode);
  const shellBg = isDark
    ? "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.95))"
    : "linear-gradient(135deg, #ffffff 0%, #f8fafc 45%, #eef2ff 100%)";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const mutedColor = isDark ? "#cbd5e1" : "#475569";
  const panelBg = isDark ? "rgba(15, 23, 42, 0.75)" : "rgba(255, 255, 255, 0.82)";
  const borderColor = isDark ? "rgba(255,255,255,0.14)" : "rgba(148,163,184,0.24)";
  const badgeBg =
    contributorRank === "👑 Platinum"
      ? "#e5e4e2"
      : contributorRank === "🥇 Gold"
      ? "#ffd700"
      : contributorRank === "🥈 Silver "
      ? "#c0c0c0"
      : "#92918f";
  const balanceValue = Number(earningsStats.total_earnings || 0);
  const monthlyTrendPercent = Math.min(
    92,
    Math.max(18, 24 + Math.round((earningsStats.total_downloads || 0) / 8))
  );
  const trendLabel =
    monthlyTrendPercent >= 70
      ? "Strong momentum"
      : monthlyTrendPercent >= 40
      ? "Steady growth"
      : "Building pace";
  const projectedMonthValue = balanceValue + Math.max(0, Math.round((earningsStats.total_downloads || 0) / 20));

  return (
    <div
      style={{
        background: shellBg,
        color: textColor,
        padding: "28px",
        borderRadius: "24px",
        marginBottom: "24px",
        boxShadow: isDark
          ? "0 18px 45px rgba(2, 6, 23, 0.45)"
          : "0 18px 45px rgba(15, 23, 42, 0.12)",
        border: `1px solid ${borderColor}`,
        backdropFilter: "blur(16px)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: isDark
            ? "radial-gradient(circle at top right, rgba(59,130,246,0.18), transparent 38%)"
            : "radial-gradient(circle at top right, rgba(99,102,241,0.12), transparent 38%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "20px",
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <div style={{ flex: "1 1 320px" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: "28px", fontWeight: 700 }}>
            👋 Welcome Back, {username}
          </h2>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "8px 14px",
              borderRadius: "999px",
              fontWeight: "700",
              fontSize: "15px",
              marginBottom: "12px",
              background: badgeBg,
              color: "#111827",
            }}
          >
            🏅 {contributorRank} Contributor
          </div>

          <p
            style={{
              fontWeight: "700",
              margin: "0 0 10px",
              fontSize: "18px",
              color: mutedColor,
            }}
          >
            ⭐ Level {contributorLevel}
          </p>

          <div
            style={{
              background: panelBg,
              color: textColor,
              padding: "14px 16px",
              borderRadius: "16px",
              marginTop: "10px",
              border: `1px solid ${borderColor}`,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "6px" }}>
              📈 Reputation Score: {reputationScore}
            </div>
            <p style={{ margin: "3px 0", color: mutedColor }}>Raw Score: {rawScore}</p>
            <p style={{ margin: "3px 0", color: mutedColor }}>{reputationTier}</p>
            <p style={{ margin: "3px 0", color: mutedColor }}>
              Account Age: {monthsOld} month(s)
            </p>
          </div>

          <div
            style={{
              marginTop: "18px",
              display: "grid",
              gap: "12px",
              maxWidth: "100%",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <div
              style={{
                background: isDark
                  ? "linear-gradient(135deg, rgba(17,24,39,0.95), rgba(30,41,59,0.9))"
                  : "linear-gradient(135deg, #ffffff, #f8fafc)",
                border: `1px solid ${borderColor}`,
                borderRadius: "18px",
                padding: "16px",
                boxShadow: isDark
                  ? "0 10px 24px rgba(2, 6, 23, 0.25)"
                  : "0 10px 24px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <p style={{ margin: 0, color: mutedColor, fontSize: "13px" }}>Uploads</p>
                <span style={{ fontSize: "12px", color: mutedColor }}>Milestone</span>
              </div>
              <p style={{ margin: 0, fontSize: "28px", fontWeight: 800 }}>
                {dashboardStats.uploads || 0}
              </p>
              <div
                style={{
                  width: "100%",
                  height: "10px",
                  background: isDark ? "rgba(255,255,255,0.14)" : "#e2e8f0",
                  borderRadius: "999px",
                  overflow: "hidden",
                  marginTop: "10px",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    width: `${Math.min((dashboardStats.uploads / maxUploads) * 100, 100)}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #34d399, #10b981)",
                    transition: "width 0.8s ease",
                    animation: "pulse 2.8s ease-in-out infinite",
                  }}
                />
              </div>
              <p style={{ margin: "8px 0 0", color: mutedColor, fontSize: "13px" }}>
                Progress to {nextRank} · {dashboardStats.uploads}/{maxUploads} Uploads
              </p>
            </div>

            <div
              style={{
                background: panelBg,
                border: `1px solid ${borderColor}`,
                borderRadius: "16px",
                padding: "14px",
                boxShadow: isDark
                  ? "inset 0 1px 0 rgba(255,255,255,0.05)"
                  : "inset 0 1px 0 rgba(255,255,255,0.65)",
              }}
            >
              <h3 style={{ margin: "0 0 8px", fontSize: "16px" }}>
                🏅 Current Badge: {contributorBadge}
              </h3>
              <p id="analytics" style={{ margin: "0 0 6px", fontWeight: 700 }}>
                💰 Earnings: ${earningsStats.total_earnings || 0}
              </p>
              <p style={{ margin: "0 0 6px", color: mutedColor }}>
                ⬇ Downloads: {earningsStats.total_downloads || 0}
              </p>
              <p style={{ margin: 0, color: mutedColor }}>
                📸 Uploads: {dashboardStats.uploads || 0}
              </p>
            </div>

            <div
              style={{
                background: isDark
                  ? "linear-gradient(135deg, rgba(17,24,39,0.95), rgba(30,41,59,0.9))"
                  : "linear-gradient(135deg, #f8fafc, #eef2ff)",
                border: `1px solid ${borderColor}`,
                borderRadius: "16px",
                padding: "14px",
                boxShadow: isDark
                  ? "0 8px 20px rgba(2, 6, 23, 0.2)"
                  : "0 8px 20px rgba(15, 23, 42, 0.06)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <span style={{ fontWeight: 700 }}>💳 Earnings Overview</span>
                <span style={{ color: mutedColor, fontSize: "12px" }}>Wallet style</span>
              </div>

              <div style={{ fontSize: "22px", fontWeight: 800, marginBottom: "6px" }}>
                ${balanceValue.toFixed(2)}
              </div>
              <div style={{ color: mutedColor, fontSize: "13px", marginBottom: "8px" }}>
                Projected this month: ${projectedMonthValue.toFixed(2)}
              </div>

              <div style={{ marginBottom: "6px" }}>
                <div
                  style={{
                    height: "7px",
                    width: "100%",
                    background: isDark ? "rgba(255,255,255,0.12)" : "#e2e8f0",
                    borderRadius: "999px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${monthlyTrendPercent}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, #6366f1, #22c55e)",
                      transition: "width 0.7s ease",
                    }}
                  />
                </div>
              </div>

              <div style={{ color: mutedColor, fontSize: "12px" }}>{trendLabel}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ContributorRankCard;