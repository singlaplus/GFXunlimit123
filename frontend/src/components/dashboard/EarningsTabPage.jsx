import React from "react";
import {
  getCalculatedReputationScore,
  getContributorReputationTier,
} from "../../utils/statsUtils";
import { calculateLoyaltyPoints } from "../../utils/loyaltyPoints";

function AnalyticsTabPage({
  reputationScore,
  reputationTier,
  totalEarnings,
  totalDownloads,
  totalUploads,
  likes,
  views,
  monthsOld,
  assets = [],
  darkMode,
  downloadsToday = 0,
  downloadsLast7Days = 0,
  downloadsLast30Days = 0,
  downloadsLast365Days = 0,
  uploadsToday = 0,
  uploadsLast7Days = 0,
  uploadsLast30Days = 0,
  uploadsLast365Days = 0,
  earningsToday = 0,
  earningsLast7Days = 0,
  earningsLast30Days = 0,
  earningsLast365Days = 0,
}) {
  const isDark = Boolean(darkMode);
  const cardBaseStyle = {
    background: isDark ? "rgba(15, 23, 42, 0.94)" : "rgba(255, 255, 255, 0.95)",
    color: isDark ? "#f8fafc" : "#0f172a",
    borderRadius: "18px",
    padding: "16px",
    border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(148,163,184,0.2)"}`,
    boxShadow: isDark
      ? "0 12px 30px rgba(2, 6, 23, 0.28)"
      : "0 10px 24px rgba(15, 23, 42, 0.08)",
    minHeight: "150px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  };

  const uploadsCount = Number(totalUploads || 0);
  const downloadsCount = Number(totalDownloads || 0);
  const likesCount = Number(likes || 0);
  const viewsCount = Number(views || 0);
  const months = Math.max(1, Number(monthsOld || 1));

  const qualityMultiplier =
    downloadsCount > 0 ? Math.max(0.1, 1 + viewsCount / downloadsCount) : 0.1;

  const engagementScore =
    uploadsCount > 0
      ? (viewsCount + downloadsCount + likesCount) / uploadsCount
      : 0;

  const maturityFactor = Math.max(1, 1 + uploadsCount / Math.max(1, months));
  const consistencyFactor = months >= 6 ? 1.05 : 1;
  const rawScore = Math.round(
    engagementScore * qualityMultiplier * maturityFactor * consistencyFactor
  );
  const formulaScore = getCalculatedReputationScore({
    uploads: uploadsCount,
    downloads: downloadsCount,
    likes: likesCount,
    views: viewsCount,
    monthsOld: months,
  });
  const effectiveLoyaltyPoints = calculateLoyaltyPoints(assets);
  const todayUploads = Number(uploadsToday || 0);
  const periodUploadsLast7Days = Number(uploadsLast7Days || 0);
  const periodUploadsLast30Days = Number(uploadsLast30Days || 0);
  const periodUploadsLast365Days = Number(uploadsLast365Days || 0);
  const todayDownloads = Number(downloadsToday || 0);
  const periodDownloadsLast7Days = Number(downloadsLast7Days || 0);
  const periodDownloadsLast30Days = Number(downloadsLast30Days || 0);
  const periodDownloadsLast365Days = Number(downloadsLast365Days || 0);
  const todayEarnings = Number(earningsToday || 0);
  const periodEarningsLast7Days = Number(earningsLast7Days || 0);
  const periodEarningsLast30Days = Number(earningsLast30Days || 0);
  const periodEarningsLast365Days = Number(earningsLast365Days || 0);
  const scoreForTier = Number.isFinite(Number(reputationScore)) ? Number(reputationScore) : formulaScore;
  const thresholdTier = reputationTier || getContributorReputationTier(scoreForTier);

  const hoverColors = ["#8b5cf6", "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#06b6d4"];

  const cards = [
    {
      title: "Reputation Score",
      value: Number.isFinite(Number(reputationScore)) ? Number(reputationScore) : formulaScore ?? 0,
      subtitle: "Your contributor standing",
      accent: "#8b5cf6",
      extra: (
        <div style={{ marginTop: "8px", fontSize: "12px", lineHeight: 1.4 }}>
          <div style={{ fontWeight: 700, marginBottom: "4px" }}>Contributor Threshold Tier</div>
          <div>{thresholdTier}</div>
        </div>
      ),
    },
    {
      title: "Total Earnings",
      value: `₹${Number(totalEarnings || 0).toFixed(2)}`,
      subtitle: "Lifetime balance",
      accent: "#10b981",
      extra: (
        <div style={{ marginTop: "10px", display: "grid", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.8 }}>
            <span>Today</span>
            <strong>₹{todayEarnings.toFixed(2)}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.8 }}>
            <span>Last 7 days</span>
            <strong>₹{periodEarningsLast7Days.toFixed(2)}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.8 }}>
            <span>Last 30 days</span>
            <strong>₹{periodEarningsLast30Days.toFixed(2)}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.8 }}>
            <span>Last 365 days</span>
            <strong>₹{periodEarningsLast365Days.toFixed(2)}</strong>
          </div>
        </div>
      ),
    },
    {
      title: "Total Downloads",
      value: totalDownloads || 0,
      subtitle: "Across your uploaded assets",
      accent: "#3b82f6",
      extra: (
        <div style={{ marginTop: "10px", display: "grid", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.8 }}>
            <span>Today</span>
            <strong>{todayDownloads}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.8 }}>
            <span>Last 7 days</span>
            <strong>{periodDownloadsLast7Days}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.8 }}>
            <span>Last 30 days</span>
            <strong>{periodDownloadsLast30Days}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.8 }}>
            <span>Last 365 days</span>
            <strong>{periodDownloadsLast365Days}</strong>
          </div>
        </div>
      ),
    },
    {
      title: "Total Uploads",
      value: totalUploads || 0,
      subtitle: "Images shared by you",
      accent: "#f59e0b",
      extra: (
        <div style={{ marginTop: "10px", display: "grid", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.8 }}>
            <span>Today</span>
            <strong>{todayUploads}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.8 }}>
            <span>Last 7 days</span>
            <strong>{periodUploadsLast7Days}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.8 }}>
            <span>Last 30 days</span>
            <strong>{periodUploadsLast30Days}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.8 }}>
            <span>Last 365 days</span>
            <strong>{periodUploadsLast365Days}</strong>
          </div>
        </div>
      ),
    },
    {
      title: "Loyalty Points",
      value: `${effectiveLoyaltyPoints} pts`,
      subtitle: "1 point per day with at least one upload",
      accent: "#ef4444",
      extra: (
        <div style={{ marginTop: "10px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "6px" }}>
            365-day milestone
          </div>
          <div
            data-testid="loyalty-progress-bar"
            style={{
              width: "100%",
              height: "8px",
              borderRadius: "999px",
              background: isDark ? "rgba(255,255,255,0.16)" : "rgba(15, 23, 42, 0.1)",
              overflow: "hidden",
              marginBottom: "6px",
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.round((effectiveLoyaltyPoints / 365) * 100))}%`,
                height: "100%",
                borderRadius: "999px",
                background: "linear-gradient(90deg, #ef4444, #f59e0b)",
                transition: "width 0.2s ease",
              }}
            />
          </div>
          <div style={{ fontSize: "12px", opacity: 0.8 }}>
            {effectiveLoyaltyPoints}/365 points
          </div>
        </div>
      ),
    },
  ];

  return (
    <div style={{ marginTop: "24px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          alignItems: "stretch",
        }}
      >
        {cards.map((card, index) => {
          const hoverColor = hoverColors[index % hoverColors.length];
          return (
          <div
            key={card.title}
            data-testid="earnings-card"
            style={{
              ...cardBaseStyle,
              borderTop: `4px solid ${card.accent}`,
              transition: "transform 0.2s ease, box-shadow 0.2s ease, border-top-color 0.2s ease",
              cursor: "pointer",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.transform = "scale(1.04)";
              event.currentTarget.style.borderTopColor = hoverColor;
              event.currentTarget.style.boxShadow = isDark
                ? "0 16px 36px rgba(2, 6, 23, 0.34)"
                : "0 14px 30px rgba(15, 23, 42, 0.16)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.transform = "scale(1)";
              event.currentTarget.style.borderTopColor = card.accent;
              event.currentTarget.style.boxShadow = isDark
                ? "0 12px 30px rgba(2, 6, 23, 0.28)"
                : "0 10px 24px rgba(15, 23, 42, 0.08)";
            }}
          >
            <div>
              <div style={{ fontSize: "13px", fontWeight: 700, opacity: 0.8, marginBottom: "6px" }}>
                {card.title}
              </div>
              <div
                style={{
                  fontSize:
                    card.title === "Total Uploads"
                      ? "34px"
                      : card.title === "Total Earnings"
                      ? "26px"
                      : card.title === "Total Downloads"
                      ? "28px"
                      : index === 0
                      ? "24px"
                      : "22px",
                  fontWeight: 800,
                  marginBottom: "6px",
                  lineHeight: 1.1,
                }}
              >
                {card.value}
              </div>
            </div>
            <div style={{ fontSize: "13px", opacity: 0.75, lineHeight: 1.4 }}>
              {card.subtitle}
              {card.extra}
            </div>
          </div>
          );
        })}
      </div>

    </div>
  );
}

export default AnalyticsTabPage;
