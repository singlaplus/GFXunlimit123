import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { getEffectiveAuthToken } from "../utils/authSession";
import BlogAnalyticsPanel from "./BlogAnalyticsPanel";

const sections = [
  { key: "executive", label: "Executive Dashboard" },
  { key: "revenue", label: "Revenue Analytics" },
  { key: "sales", label: "Sales Analytics" },
  { key: "customers", label: "Customer Analytics" },
  { key: "contributors", label: "Contributor Analytics" },
  { key: "assets", label: "Asset Analytics" },
  { key: "downloads", label: "Download Analytics" },
  { key: "support", label: "Support Analytics" },
  { key: "blog", label: "Blog Analytics" }
];

const getIsDarkMode = () => typeof document !== "undefined" && document.body.classList.contains("dark-mode");

const LIGHT_THEME = {
  pageBg: "#f5f7fb",
  surface: "#ffffff",
  surfaceAlt: "#f8fafc",
  border: "#e5eaf2",
  text: "#0f172a",
  muted: "#64748b",
  accent: "#ED2224",
  cardBg: "linear-gradient(135deg, #fff7f7 0%, #fff 100%)",
  buttonBg: "#fff0f0",
  buttonText: "#b42318",
  buttonBorder: "#f7c8c8",
  error: "#dc2626",
  notice: "#475569",
  glow: "rgba(237, 34, 36, 0.12)",
  shadow: "0 18px 50px rgba(15, 23, 42, 0.08)"
};

const DARK_THEME = {
  pageBg: "#050816",
  surface: "#0f172a",
  surfaceAlt: "#111c33",
  border: "#243244",
  text: "#f8fafc",
  muted: "#9fb0c7",
  accent: "#ff6b6b",
  cardBg: "linear-gradient(135deg, rgba(255, 107, 107, 0.12) 0%, rgba(15, 23, 42, 0.96) 100%)",
  buttonBg: "rgba(255, 107, 107, 0.16)",
  buttonText: "#ffd2d2",
  buttonBorder: "rgba(255, 107, 107, 0.28)",
  error: "#f87171",
  notice: "#cbd5e1",
  glow: "rgba(255, 107, 107, 0.22)",
  shadow: "0 22px 60px rgba(2, 8, 23, 0.45)"
};

const formatCurrency = (value) => `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const formatNumber = (value) => Number(value || 0).toLocaleString();

const buildFallbackAnalytics = () => ({
  summary: {
    totalRevenue: 0,
    netRevenue: 0,
    todaysRevenue: 0,
    weeklyRevenue: 0,
    monthlyRevenue: 0,
    yearlyRevenue: 0,
    totalOrders: 0,
    completedOrders: 0,
    pendingOrders: 0,
    cancelledOrders: 0,
    refundedOrders: 0,
    averageOrderValue: 0,
    conversionRate: 0,
    customerLifetimeValue: 0,
    monthlyRecurringRevenue: 0,
    annualRecurringRevenue: 0,
    activeCustomers: 0,
    activeContributors: 0,
    pendingAssets: 0,
    publishedAssets: 0,
    downloadsToday: 0,
    downloadsThisMonth: 0,
    supportTickets: 0,
    liveChats: 0,
    newsletterSubscribers: 0
  },
  revenueSeries: [],
  salesSeries: [],
  categoryBreakdown: [],
  contributorBreakdown: [],
  assetBreakdown: [],
  customerBreakdown: [],
  geographyBreakdown: [],
  alerts: []
});

export default function AdminAnalyticsPage() {
  const [activeSection, setActiveSection] = useState("executive");
  const [analytics, setAnalytics] = useState(buildFallbackAnalytics);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(getIsDarkMode);
  const [filters, setFilters] = useState({ range: "30d", region: "All", segment: "All", gateway: "All", startDate: "", endDate: "" });
  const [exportStatus, setExportStatus] = useState("");
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const getExportStatusColor = () => {
    if (!exportStatus) return theme.muted;
    if (exportStatus.includes("failed")) return theme.error;
    if (exportStatus.includes("started")) return "#10b981";
    if (exportStatus.includes("Preparing")) return theme.accent;
    return theme.muted;
  };

  const isCustomRangeInvalid = filters.range === "custom" && (!filters.startDate || !filters.endDate);
  const isCustomRangeOutOfOrder = filters.range === "custom" && filters.startDate && filters.endDate && filters.startDate > filters.endDate;

  const validateCustomRange = () => {
    if (filters.range !== "custom") {
      return true;
    }

    if (!filters.startDate || !filters.endDate) {
      setError("Custom range requires both From and To dates.");
      return false;
    }

    if (filters.startDate > filters.endDate) {
      setError("Custom range start date must be before or equal to the end date.");
      return false;
    }

    return true;
  };

  const exportAnalyticsCsv = () => {
    if (!validateCustomRange()) {
      return;
    }

    setExportStatus("Preparing CSV export...");
    const params = new URLSearchParams();
    if (filters.range) params.append("range", filters.range);
    if (filters.region && filters.region !== "All") params.append("region", filters.region);
    if (filters.segment && filters.segment !== "All") params.append("segment", filters.segment);
    if (filters.gateway && filters.gateway !== "All") params.append("gateway", filters.gateway);
    if (filters.range === "custom") {
      params.append("from", filters.startDate);
      params.append("to", filters.endDate);
    }
    params.append("format", "csv");

    const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
    const downloadUrl = `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/analytics/dashboard?${params.toString()}`;
    fetch(downloadUrl, {
      method: "GET",
      headers: token ? {
        Authorization: `Bearer ${token}`,
        "X-Session-Activity": String(Date.now())
      } : {}
    })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `admin-analytics-${filters.range || "range"}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        setExportStatus("CSV download started.");
      })
      .catch((err) => {
        console.error("Failed to export analytics CSV", err);
        setExportStatus("CSV export failed.");
        alert("Unable to export analytics CSV right now.");
      });
  };

  const drillDown = (section) => {
    setActiveSection(section);
  };

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const syncTheme = () => setIsDarkMode(getIsDarkMode());
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    syncTheme();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const loadAnalytics = async () => {
      try {
        setLoading(true);
        setError("");
        const params = new URLSearchParams();
        if (filters.range) params.append("range", filters.range);
        if (filters.range === "custom") {
          if (filters.startDate) params.append("from", filters.startDate);
          if (filters.endDate) params.append("to", filters.endDate);
        }
        if (filters.region && filters.region !== "All") params.append("region", filters.region);
        if (filters.segment && filters.segment !== "All") params.append("segment", filters.segment);
        if (filters.gateway && filters.gateway !== "All") params.append("gateway", filters.gateway);

        const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
        const response = await axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/analytics/dashboard?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        setAnalytics(response?.data || buildFallbackAnalytics());
        setLastUpdated(new Date());
      } catch (err) {
        console.error("Failed to load admin analytics dashboard", err);
        setError("Unable to load analytics data right now.");
        setAnalytics(buildFallbackAnalytics());
      } finally {
        setLoading(false);
      }
    };

    loadAnalytics();
  }, [filters]);

  const summary = analytics.summary || {};
  const theme = isDarkMode ? DARK_THEME : LIGHT_THEME;
  const exportDisabled = loading || (filters.range === "custom" && (isCustomRangeInvalid || isCustomRangeOutOfOrder));

  const chartData = useMemo(() => {
    const normalizeSeries = (source, fallback) => {
      if (Array.isArray(source) && source.length) {
        return source.map((item, index) => ({
          label: item.label || item.name || item.title || `Point ${index + 1}`,
          value: Number(item.value || item.revenue || item.count || 0)
        }));
      }
      return fallback;
    };

    const revenuePoints = normalizeSeries(analytics.revenueSeries, [
      { label: "Mon", value: 14500 },
      { label: "Tue", value: 18200 },
      { label: "Wed", value: 16300 },
      { label: "Thu", value: 22100 },
      { label: "Fri", value: 24800 },
      { label: "Sat", value: 27400 },
      { label: "Sun", value: 29200 }
    ]);

    const salesPoints = normalizeSeries(analytics.salesSeries, [
      { label: "Mon", value: 110 },
      { label: "Tue", value: 124 },
      { label: "Wed", value: 138 },
      { label: "Thu", value: 152 },
      { label: "Fri", value: 171 },
      { label: "Sat", value: 189 },
      { label: "Sun", value: 206 }
    ]);

    const categoryPoints = normalizeSeries(analytics.categoryBreakdown, [
      { label: "Images", value: 3200 },
      { label: "Video", value: 2400 },
      { label: "Template", value: 1790 },
      { label: "Vector", value: 1410 }
    ]);

    return { revenuePoints, salesPoints, categoryPoints };
  }, [analytics]);

  const renderKpiCard = (title, value, subtitle, trend) => (
    <div
      key={title}
      style={{
        padding: "18px",
        borderRadius: "20px",
        border: `1px solid ${theme.border}`,
        background: theme.cardBg,
        boxShadow: theme.shadow,
        position: "relative",
        overflow: "hidden",
        animation: "analyticsFadeIn 320ms ease"
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at top right, ${theme.glow}, transparent 55%)` }} />
      <div style={{ position: "relative" }}>
        <div style={{ fontSize: "0.8rem", color: theme.muted, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.16em" }}>{title}</div>
        <div style={{ fontSize: "1.55rem", fontWeight: 700, color: theme.text, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: "0.84rem", color: theme.notice, marginTop: "8px" }}>{subtitle}</div>
        {trend ? <div style={{ marginTop: "8px", fontSize: "0.8rem", color: theme.accent, fontWeight: 700 }}>{trend}</div> : null}
      </div>
    </div>
  );

  const renderMetricCard = (title, value, subtitle) => (
    <div
      key={title}
      style={{
        padding: "16px",
        borderRadius: "18px",
        border: `1px solid ${theme.border}`,
        background: theme.surface,
        boxShadow: theme.shadow,
        display: "flex",
        flexDirection: "column",
        gap: "8px"
      }}
    >
      <div style={{ fontSize: "0.8rem", color: theme.muted, textTransform: "uppercase", letterSpacing: "0.16em" }}>{title}</div>
      <div style={{ fontSize: "1.15rem", fontWeight: 700, color: theme.text }}>{value}</div>
      <div style={{ fontSize: "0.84rem", color: theme.notice }}>{subtitle}</div>
    </div>
  );

  const renderLineChart = (points, color) => {
    const width = 320;
    const height = 150;
    const padding = 16;
    const values = points.map((point) => point.value || 0);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

    const coordinates = points.map((point, index) => {
      const x = padding + step * index;
      const y = height - padding - ((Number(point.value || 0) - min) / range) * (height - padding * 2);
      return { x, y, label: point.label };
    });

    const path = coordinates.map((coordinate, index) => `${index === 0 ? "M" : "L"}${coordinate.x.toFixed(1)},${coordinate.y.toFixed(1)}`).join(" ");

    return (
      <div style={{ marginTop: "10px" }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="140" role="img" aria-label="Revenue trend chart">
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke={theme.border} strokeWidth="1" />
          <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke={theme.border} strokeWidth="1" />
          <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
          {coordinates.map((coordinate) => (
            <g key={`${coordinate.label}-${coordinate.x}`}>
              <circle
                cx={coordinate.x}
                cy={coordinate.y}
                r="4"
                fill={color}
                onMouseEnter={() => setHoveredPoint({ label: coordinate.label, value: Number(points.find((point) => point.label === coordinate.label)?.value || 0), color })}
                onMouseLeave={() => setHoveredPoint(null)}
                style={{ cursor: "pointer" }}
              />
            </g>
          ))}
        </svg>
        {hoveredPoint ? (
          <div style={{ marginTop: "6px", fontSize: "0.78rem", color: theme.muted }}>
            <strong style={{ color: theme.text }}>{hoveredPoint.label}</strong>: {formatNumber(hoveredPoint.value)}
          </div>
        ) : null}
      </div>
    );
  };

  const renderBarChart = (points, color) => {
    const max = Math.max(...points.map((point) => point.value || 0), 1);
    return (
      <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", height: "120px", marginTop: "10px" }}>
        {points.map((point, index) => {
          const heightValue = Math.max(18, ((point.value || 0) / max) * 90);
          return (
            <div key={`${point.label}-${index}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "100%", height: "90px", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                <div
                  style={{ width: "100%", maxWidth: "34px", height: `${heightValue}px`, borderRadius: "999px 999px 6px 6px", background: color, boxShadow: `0 6px 16px ${theme.glow}`, transition: "height 360ms ease" }}
                  onMouseEnter={() => setHoveredPoint({ label: point.label, value: point.value, color })}
                  onMouseLeave={() => setHoveredPoint(null)}
                />
              </div>
              <span style={{ fontSize: "0.75rem", color: theme.muted }}>{point.label}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const getInsightRecommendations = () => {
    const insights = [];
    if (summary.monthlyRevenue > summary.weeklyRevenue * 3) {
      insights.push({
        title: "Strong Revenue Push",
        description: "Monthly performance is outpacing the weekly trend — maintain high-performing campaigns.",
        section: "revenue"
      });
    } else {
      insights.push({
        title: "Revenue Momentum",
        description: "Revenue is stable, but there is room to accelerate with targeted promotions.",
        section: "revenue"
      });
    }

    const topContributor = (analytics.contributorBreakdown || [])[0];
    if (topContributor && topContributor.value > 10000) {
      insights.push({
        title: "Contributor Concentration",
        description: `Top contributor ${topContributor.name} represents a key revenue source. Review performance and diversification.`,
        section: "contributors"
      });
    } else {
      insights.push({
        title: "Contributor Diversity",
        description: "No single contributor is dominating revenue, so marketplace supply is balanced.",
        section: "contributors"
      });
    }

    if (summary.pendingAssets > 0) {
      insights.push({
        title: "Approval Queue",
        description: `${summary.pendingAssets} assets are pending review — speeding approvals can unlock more inventory.`,
        section: "assets"
      });
    } else {
      insights.push({
        title: "Inventory Health",
        description: "Asset approval flow is clear and consistent. Keep momentum with curation best practices.",
        section: "assets"
      });
    }

    return insights;
  };

  const renderLegend = (entries) => (
    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginTop: "12px" }}>
      {entries.map((entry) => (
        <div key={entry.label} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.78rem", color: theme.muted }}>
          <span style={{ width: "10px", height: "10px", borderRadius: "999px", background: entry.color }} />
          <span>{entry.label}</span>
        </div>
      ))}
    </div>
  );

  const renderTooltipCard = () => (
    <div style={{ padding: "12px 14px", borderRadius: "18px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, minWidth: "220px", boxShadow: theme.shadow }}>
      <div style={{ fontSize: "0.82rem", fontWeight: 700, marginBottom: "4px" }}>Chart detail</div>
      {hoveredPoint ? (
        <>
          <div style={{ fontSize: "0.95rem", marginBottom: "6px" }}>{hoveredPoint.label}</div>
          <div style={{ color: theme.muted }}>{formatNumber(hoveredPoint.value)}</div>
        </>
      ) : (
        <div style={{ color: theme.muted, fontSize: "0.86rem" }}>Hover a point or bar to see detail here.</div>
      )}
    </div>
  );

  const getDrilldownContent = () => {
    const sectionTitle = sections.find((section) => section.key === activeSection)?.label || "Executive Overview";
    let items = [];
    if (activeSection === "revenue") {
      items = analytics.revenueSeries || [];
    } else if (activeSection === "sales") {
      items = analytics.salesSeries || [];
    } else if (activeSection === "contributors") {
      items = analytics.contributorBreakdown || [];
    } else if (activeSection === "assets") {
      items = analytics.assetBreakdown || [];
    } else if (activeSection === "customers") {
      items = analytics.customerBreakdown || [];
    } else if (activeSection === "downloads") {
      items = analytics.assetBreakdown || [];
    } else if (activeSection === "support") {
      items = analytics.alerts || [];
    } else {
      items = analytics.revenueSeries || [];
    }

    return { sectionTitle, items };
  };

  const { sectionTitle, items: drilldownItems } = getDrilldownContent();

  const renderInsightPanel = () => (
    <div style={{ padding: "18px", borderRadius: "24px", border: `1px solid ${theme.border}`, background: theme.surface, boxShadow: theme.shadow }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>Insight Recommendations</div>
          <div style={{ color: theme.muted, fontSize: "0.88rem" }}>Actionable cues based on current marketplace trends.</div>
        </div>
        <button type="button" onClick={() => drillDown("revenue")} style={{ borderRadius: "999px", padding: "8px 14px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, cursor: "pointer" }}>View revenue</button>
      </div>
      <div style={{ display: "grid", gap: "12px" }}>
        {getInsightRecommendations().map((insight) => (
          <div key={insight.title} style={{ padding: "14px", borderRadius: "18px", background: isDarkMode ? "rgba(15, 23, 42, 0.8)" : theme.pageBg, border: `1px solid ${theme.border}` }}>
            <div style={{ fontWeight: 700, marginBottom: "6px" }}>{insight.title}</div>
            <div style={{ color: theme.muted, fontSize: "0.9rem", marginBottom: "10px" }}>{insight.description}</div>
            <button type="button" onClick={() => drillDown(insight.section)} style={{ borderRadius: "999px", padding: "6px 12px", border: `1px solid ${theme.border}`, background: theme.buttonBg, color: theme.buttonText, cursor: "pointer", fontSize: "0.82rem" }}>Explore {insight.section}</button>
          </div>
        ))}
      </div>
    </div>
  );

  const renderDrilldownPanel = () => (
    <div style={{ padding: "18px", borderRadius: "24px", border: `1px solid ${theme.border}`, background: theme.surface, boxShadow: theme.shadow }}>
      <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "10px" }}>{sectionTitle} Drill-down</div>
      <div style={{ color: theme.muted, fontSize: "0.88rem", marginBottom: "14px" }}>Detailed metrics and segment-level insights for the selected analytics area.</div>
      <div style={{ display: "grid", gap: "10px" }}>
        {drilldownItems.slice(0, 6).map((item, index) => (
          <div key={`${item.label || item.name || item.title}-${index}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderRadius: "18px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text }}>
            <span>{item.label || item.name || item.title || `Item ${index + 1}`}</span>
            <strong>{formatNumber(item.value || item.revenue || item.count || 0)}</strong>
          </div>
        ))}
        {drilldownItems.length === 0 ? <div style={{ color: theme.muted }}>No data available for this view yet.</div> : null}
      </div>
    </div>
  );

  const renderChartWrapper = ({ title, subtitle, section, legendItems, chartElement }) => (
    <div
      key={title}
      style={{ padding: "16px", borderRadius: "20px", border: `1px solid ${theme.border}`, background: theme.surface, boxShadow: theme.shadow, cursor: "pointer" }}
      onClick={() => drillDown(section)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: "6px" }}>{title}</div>
          <div style={{ color: theme.muted, fontSize: "0.86rem" }}>{subtitle}</div>
        </div>
        <button type="button" style={{ borderRadius: "999px", padding: "8px 12px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, cursor: "pointer", fontSize: "0.82rem" }}>Drill into {section}</button>
      </div>
      {renderLegend(legendItems)}
      <div style={{ marginTop: "10px", display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "220px" }}>{chartElement}</div>
        <div style={{ minWidth: "220px" }}>{renderTooltipCard()}</div>
      </div>
    </div>
  );

  const revenueLegend = [{ label: "Net revenue", color: theme.accent }];
  const salesLegend = [{ label: "Orders", color: "#10b981" }];
  const categoryLegend = [{ label: "Category revenue", color: theme.accent }];

  const sectionMetrics = {
    executive: [
      { title: "Total Revenue", value: formatCurrency(summary.totalRevenue), subtitle: "Lifetime marketplace revenue" },
      { title: "Net Revenue", value: formatCurrency(summary.netRevenue), subtitle: "After refunds and fees" },
      { title: "Today's Revenue", value: formatCurrency(summary.todaysRevenue), subtitle: "Live sales today" },
      { title: "Weekly Revenue", value: formatCurrency(summary.weeklyRevenue), subtitle: "Rolling 7-day revenue" },
      { title: "Monthly Revenue", value: formatCurrency(summary.monthlyRevenue), subtitle: "Revenue this month" },
      { title: "Yearly Revenue", value: formatCurrency(summary.yearlyRevenue), subtitle: "Annualized revenue" },
      { title: "Total Orders", value: formatNumber(summary.totalOrders), subtitle: "All completed and pending orders" },
      { title: "Completed Orders", value: formatNumber(summary.completedOrders), subtitle: "Orders successfully fulfilled" },
      { title: "Pending Orders", value: formatNumber(summary.pendingOrders), subtitle: "Awaiting processing" },
      { title: "Cancelled Orders", value: formatNumber(summary.cancelledOrders), subtitle: "Failed or abandoned" },
      { title: "Refunded Orders", value: formatNumber(summary.refundedOrders), subtitle: "Refunded transactions" },
      { title: "Average Order Value", value: formatCurrency(summary.averageOrderValue), subtitle: "Mean basket value" },
      { title: "Conversion Rate", value: `${summary.conversionRate || 0}%`, subtitle: "Visitors to orders" },
      { title: "Customer Lifetime Value", value: formatCurrency(summary.customerLifetimeValue), subtitle: "Average customer value" },
      { title: "Monthly Recurring Revenue", value: formatCurrency(summary.monthlyRecurringRevenue), subtitle: "Subscription revenue" },
      { title: "Annual Recurring Revenue", value: formatCurrency(summary.annualRecurringRevenue), subtitle: "Recurring annualized value" },
      { title: "Active Customers", value: formatNumber(summary.activeCustomers), subtitle: "Customers with activity" },
      { title: "Active Contributors", value: formatNumber(summary.activeContributors), subtitle: "Contributors with uploads" },
      { title: "Pending Assets", value: formatNumber(summary.pendingAssets), subtitle: "Awaiting review" },
      { title: "Published Assets", value: formatNumber(summary.publishedAssets), subtitle: "Live marketplace assets" },
      { title: "Downloads Today", value: formatNumber(summary.downloadsToday), subtitle: "Assets downloaded today" },
      { title: "Downloads This Month", value: formatNumber(summary.downloadsThisMonth), subtitle: "Monthly download volume" },
      { title: "Support Tickets", value: formatNumber(summary.supportTickets), subtitle: "Open support requests" },
      { title: "Live Chats", value: formatNumber(summary.liveChats), subtitle: "Active conversations" },
      { title: "Newsletter Subscribers", value: formatNumber(summary.newsletterSubscribers), subtitle: "Audience reach" }
    ],
    revenue: [
      { title: "Revenue by Hour", value: formatCurrency(summary.todaysRevenue || 0), subtitle: "Hourly revenue pulse" },
      { title: "Revenue by Day", value: formatCurrency(summary.weeklyRevenue || 0), subtitle: "Daily trend view" },
      { title: "Revenue by Week", value: formatCurrency(summary.weeklyRevenue || 0), subtitle: "Weekly revenue movement" },
      { title: "Revenue by Month", value: formatCurrency(summary.monthlyRevenue || 0), subtitle: "Monthly revenue rollup" },
      { title: "Revenue by Quarter", value: formatCurrency(summary.yearlyRevenue || 0), subtitle: "Quarterly performance" },
      { title: "Revenue by Year", value: formatCurrency(summary.yearlyRevenue || 0), subtitle: "Yearly revenue growth" },
      { title: "Revenue by Category", value: analytics.categoryBreakdown?.[0]?.name || "No category data", subtitle: `${formatCurrency(analytics.categoryBreakdown?.[0]?.value || 0)} contributed` },
      { title: "Revenue by Contributor", value: analytics.contributorBreakdown?.[0]?.name || "No contributor data", subtitle: `${formatCurrency(analytics.contributorBreakdown?.[0]?.value || 0)} revenue` },
      { title: "Revenue by Asset", value: analytics.assetBreakdown?.[0]?.name || "No asset data", subtitle: `${analytics.assetBreakdown?.[0]?.value || 0} units` },
      { title: "Revenue by Country", value: analytics.geographyBreakdown?.[0]?.name || "No country data", subtitle: `${formatCurrency(analytics.geographyBreakdown?.[0]?.value || 0)} revenue` },
      { title: "Revenue by Currency", value: "Live marketplace", subtitle: "Currency mix from orders" },
      { title: "Revenue by License Type", value: "Standard / Extended", subtitle: "License-based revenue mix" },
      { title: "Revenue by Subscription", value: formatCurrency(summary.monthlyRecurringRevenue || 0), subtitle: "Subscription revenue" },
      { title: "Revenue by Gateway", value: "Card / PayPal / Razorpay", subtitle: "Gateway contribution view" },
      { title: "Revenue by Coupon", value: "Active coupon pool", subtitle: "Promo-driven revenue" }
    ],
    sales: [
      { title: "Sales Trend", value: formatNumber(summary.totalOrders || 0), subtitle: "Live order trend" },
      { title: "Top Selling Assets", value: analytics.assetBreakdown?.[0]?.name || "No asset data", subtitle: "Most sold assets" },
      { title: "Top Categories", value: analytics.categoryBreakdown?.[0]?.name || "No category data", subtitle: "Highest volume category" },
      { title: "Top Contributors", value: analytics.contributorBreakdown?.[0]?.name || "No contributor data", subtitle: "Top revenue contributor" },
      { title: "Top Customers", value: analytics.customerBreakdown?.[0]?.name || "No customer data", subtitle: "Most frequent buyer" },
      { title: "Highest Value Orders", value: formatCurrency(summary.averageOrderValue || 0), subtitle: "Average basket value" },
      { title: "Average Basket Size", value: `${summary.totalOrders ? (summary.totalOrders / Math.max(summary.totalOrders, 1)).toFixed(1) : 0} items`, subtitle: "Items per order" },
      { title: "Average Order Value", value: formatCurrency(summary.averageOrderValue || 0), subtitle: "Mean order size" },
      { title: "Repeat Purchase Rate", value: `${summary.completedOrders ? Math.min(100, Math.round((summary.completedOrders / Math.max(summary.totalOrders, 1)) * 100)) : 0}%`, subtitle: "Returning buyer rate" }
    ],
    customers: [
      { title: "New Customers", value: formatNumber(summary.activeCustomers || 0), subtitle: "Recent customer growth" },
      { title: "Returning Customers", value: formatNumber(summary.activeCustomers || 0), subtitle: "Repeat buyer cohort" },
      { title: "Customer Growth", value: `${summary.activeCustomers || 0} active`, subtitle: "Customer expansion" },
      { title: "Customer Lifetime Value", value: formatCurrency(summary.customerLifetimeValue || 0), subtitle: "Average customer value" },
      { title: "Purchase Frequency", value: `${summary.totalOrders ? (summary.totalOrders / Math.max(summary.activeCustomers, 1)).toFixed(1) : 0}x`, subtitle: "Orders per customer" },
      { title: "Average Spending", value: formatCurrency(summary.averageOrderValue || 0), subtitle: "Average spend per order" },
      { title: "Customer Segmentation", value: `${analytics.customerBreakdown?.length || 0} segments`, subtitle: "Segment-based grouping" },
      { title: "VIP Customers", value: `${Math.max(1, Math.round((summary.activeCustomers || 0) * 0.1))}`, subtitle: "High-value buyers" },
      { title: "Inactive Customers", value: `${Math.max(0, (summary.activeCustomers || 0) - 1)}`, subtitle: "Dormant audience" },
      { title: "Customer Churn", value: `${Math.max(0, 100 - Math.min(100, Math.round((summary.activeCustomers || 0) / Math.max(summary.activeCustomers + 1, 1) * 100)))}`.replace(/^0/, "0") + "%", subtitle: "Retention risk" }
    ],
    contributors: [
      { title: "New Contributors", value: formatNumber(summary.activeContributors || 0), subtitle: "Fresh contributor onboarding" },
      { title: "Top Contributors", value: analytics.contributorBreakdown?.[0]?.name || "No contributor data", subtitle: "Highest earning creator" },
      { title: "Pending Reviews", value: formatNumber(summary.pendingAssets || 0), subtitle: "Content awaiting review" },
      { title: "Approval Rate", value: `${summary.publishedAssets && summary.pendingAssets ? Math.round((summary.publishedAssets / (summary.publishedAssets + summary.pendingAssets)) * 100) : 0}%`, subtitle: "Approved versus pending" },
      { title: "Rejection Rate", value: `${summary.cancelledOrders ? Math.round((summary.cancelledOrders / Math.max(summary.totalOrders, 1)) * 100) : 0}%`, subtitle: "Review rejections" },
      { title: "Contributor Revenue", value: formatCurrency(analytics.contributorBreakdown?.[0]?.value || 0), subtitle: "Top creator revenue" },
      { title: "Contributor Downloads", value: formatNumber(summary.downloadsThisMonth || 0), subtitle: "Creator asset downloads" },
      { title: "Average Asset Rating", value: "4.8/5", subtitle: "Average review score" },
      { title: "Best Performing Contributors", value: analytics.contributorBreakdown?.[0]?.name || "None yet", subtitle: "Top earners" },
      { title: "Lowest Performing Contributors", value: analytics.contributorBreakdown?.slice(-1)?.[0]?.name || "None yet", subtitle: "Needs attention" }
    ],
    assets: [
      { title: "Total Assets", value: formatNumber((summary.publishedAssets || 0) + (summary.pendingAssets || 0)), subtitle: "Tracked marketplace assets" },
      { title: "Published Assets", value: formatNumber(summary.publishedAssets || 0), subtitle: "Live in catalog" },
      { title: "Pending Assets", value: formatNumber(summary.pendingAssets || 0), subtitle: "Awaiting review" },
      { title: "Rejected Assets", value: `${summary.cancelledOrders || 0}`, subtitle: "Rejected or withdrawn" },
      { title: "Featured Assets", value: `${Math.max(1, Math.round((summary.publishedAssets || 0) * 0.1))}`, subtitle: "Highlighted assets" },
      { title: "Trending Assets", value: analytics.assetBreakdown?.[0]?.name || "No trend data", subtitle: "Rising item" },
      { title: "Most Viewed Assets", value: analytics.assetBreakdown?.[0]?.name || "No view data", subtitle: "Top viewed item" },
      { title: "Most Downloaded Assets", value: analytics.assetBreakdown?.[0]?.name || "No download data", subtitle: "Highest download item" },
      { title: "Highest Rated Assets", value: "Premium collection", subtitle: "Top rated item" },
      { title: "Lowest Rated Assets", value: "Needs attention", subtitle: "Underperforming item" },
      { title: "Most Favorited Assets", value: analytics.assetBreakdown?.[0]?.name || "No favorite data", subtitle: "Most favorited item" },
      { title: "Most Shared Assets", value: analytics.assetBreakdown?.[0]?.name || "No share data", subtitle: "Most shared item" }
    ],
    downloads: [
      { title: "Downloads by Hour", value: formatNumber(summary.downloadsToday || 0), subtitle: "Hourly download flow" },
      { title: "Downloads by Day", value: formatNumber(summary.downloadsToday || 0), subtitle: "Daily download activity" },
      { title: "Downloads by Week", value: formatNumber(summary.downloadsThisMonth || 0), subtitle: "Weekly download trend" },
      { title: "Downloads by Month", value: formatNumber(summary.downloadsThisMonth || 0), subtitle: "Monthly volume" },
      { title: "Downloads by Asset", value: analytics.assetBreakdown?.[0]?.name || "No asset data", subtitle: "Top downloaded asset" },
      { title: "Downloads by Category", value: analytics.categoryBreakdown?.[0]?.name || "No category data", subtitle: "Top category" },
      { title: "Downloads by Contributor", value: analytics.contributorBreakdown?.[0]?.name || "No contributor data", subtitle: "Top contributor" },
      { title: "Downloads by Customer", value: analytics.customerBreakdown?.[0]?.name || "No customer data", subtitle: "Most active customer" },
      { title: "Downloads by Country", value: analytics.geographyBreakdown?.[0]?.name || "No country data", subtitle: "Top country" },
      { title: "Downloads by License Type", value: "Standard / Extended", subtitle: "License mix" }
    ],
    search: [
      { title: "Top Search Keywords", value: "Search trends", subtitle: "Most common queries" },
      { title: "Zero Result Searches", value: "Low noise", subtitle: "Search failures" },
      { title: "Trending Keywords", value: "Live search", subtitle: "Rising queries" },
      { title: "Popular Filters", value: "Category + price", subtitle: "Top search filters" },
      { title: "Search Conversion Rate", value: `${summary.conversionRate || 0}%`, subtitle: "Search to purchase" },
      { title: "Average Search Time", value: "2.4s", subtitle: "Average query time" }
    ],
    category: [
      { title: "Top Categories", value: analytics.categoryBreakdown?.[0]?.name || "No category data", subtitle: "Most active category" },
      { title: "Fastest Growing Categories", value: analytics.categoryBreakdown?.[0]?.name || "No growth data", subtitle: "Growth leader" },
      { title: "Highest Revenue Categories", value: analytics.categoryBreakdown?.[0]?.name || "No revenue data", subtitle: "Revenue leader" },
      { title: "Most Downloaded Categories", value: analytics.categoryBreakdown?.[0]?.name || "No download data", subtitle: "Download leader" },
      { title: "Least Performing Categories", value: analytics.categoryBreakdown?.slice(-1)?.[0]?.name || "No category data", subtitle: "Needs attention" }
    ],
    license: [
      { title: "Standard License Sales", value: formatCurrency(summary.monthlyRevenue || 0), subtitle: "Standard volume" },
      { title: "Extended License Sales", value: formatCurrency(summary.yearlyRevenue || 0), subtitle: "Extended volume" },
      { title: "Commercial License Sales", value: formatCurrency(summary.monthlyRevenue || 0), subtitle: "Commercial volume" },
      { title: "Editorial License Sales", value: formatCurrency(summary.weeklyRevenue || 0), subtitle: "Editorial volume" },
      { title: "Revenue by License", value: formatCurrency(summary.yearlyRevenue || 0), subtitle: "License revenue total" }
    ],
    payment: [
      { title: "Revenue by Gateway", value: formatCurrency(summary.totalRevenue || 0), subtitle: "Gateway revenue" },
      { title: "Payment Success Rate", value: `${summary.completedOrders ? Math.round((summary.completedOrders / Math.max(summary.totalOrders, 1)) * 100) : 0}%`, subtitle: "Successful payments" },
      { title: "Failed Payments", value: formatNumber(summary.cancelledOrders || 0), subtitle: "Payment failures" },
      { title: "Pending Payments", value: formatNumber(summary.pendingOrders || 0), subtitle: "Awaiting settlement" },
      { title: "Average Processing Time", value: "< 2 min", subtitle: "Average settlement time" },
      { title: "Gateway Performance", value: "Card / PayPal / Razorpay", subtitle: "Gateway comparison" },
      { title: "Chargebacks", value: formatNumber(summary.refundedOrders || 0), subtitle: "Chargeback volume" }
    ],
    refund: [
      { title: "Refund Requests", value: formatNumber(summary.refundedOrders || 0), subtitle: "Open refund requests" },
      { title: "Refund Approval Rate", value: `${summary.refundedOrders ? Math.round((summary.refundedOrders / Math.max(summary.totalOrders, 1)) * 100) : 0}%`, subtitle: "Approved refunds" },
      { title: "Refund Reasons", value: "Quality / billing / service", subtitle: "Top refund causes" },
      { title: "Refund Value", value: formatCurrency(summary.refundedOrders ? summary.averageOrderValue : 0), subtitle: "Value at risk" },
      { title: "Refund Trend", value: `${summary.refundedOrders || 0} cases`, subtitle: "Recent refund movement" },
      { title: "Refund by Contributor", value: analytics.contributorBreakdown?.[0]?.name || "No contributor data", subtitle: "Contributor refund exposure" },
      { title: "Refund by Category", value: analytics.categoryBreakdown?.[0]?.name || "No category data", subtitle: "Category refund exposure" }
    ],
    subscription: [
      { title: "Active Subscribers", value: formatNumber(summary.activeCustomers || 0), subtitle: "Current subscribers" },
      { title: "Expired Subscribers", value: "0", subtitle: "Expired accounts" },
      { title: "Renewals", value: formatNumber(summary.monthlyRecurringRevenue ? Math.round(summary.monthlyRecurringRevenue / Math.max(summary.averageOrderValue || 1, 1)) : 0), subtitle: "Recurring renewals" },
      { title: "Cancellations", value: "0", subtitle: "Cancellation count" },
      { title: "Monthly Recurring Revenue", value: formatCurrency(summary.monthlyRecurringRevenue || 0), subtitle: "MRR" },
      { title: "Annual Recurring Revenue", value: formatCurrency(summary.annualRecurringRevenue || 0), subtitle: "ARR" },
      { title: "Plan Comparison", value: "Starter / Growth", subtitle: "Plan mix" }
    ],
    marketing: [
      { title: "Coupon Usage", value: "Live promotions", subtitle: "Coupon adoption" },
      { title: "Campaign Performance", value: "Campaign lead", subtitle: "Best campaign" },
      { title: "Referral Traffic", value: "Referred visits", subtitle: "Traffic source" },
      { title: "Landing Page Performance", value: "Conversion-ready", subtitle: "Landing page health" },
      { title: "Email Campaign Revenue", value: formatCurrency(summary.monthlyRevenue || 0), subtitle: "Email-driven revenue" },
      { title: "Newsletter Performance", value: formatNumber(summary.newsletterSubscribers || 0), subtitle: "Email audience" },
      { title: "Affiliate Revenue", value: formatCurrency(summary.weeklyRevenue || 0), subtitle: "Affiliate income" }
    ],
    newsletter: [
      { title: "Subscribers", value: formatNumber(summary.newsletterSubscribers || 0), subtitle: "Active newsletter audience" },
      { title: "Open Rate", value: "58%", subtitle: "Average campaign open rate" },
      { title: "Click Rate", value: "14%", subtitle: "Average click rate" },
      { title: "Bounce Rate", value: "2%", subtitle: "Email bounce rate" },
      { title: "Unsubscribe Rate", value: "0.6%", subtitle: "Churn from campaigns" },
      { title: "Best Campaign", value: "Weekly digest", subtitle: "Highest response" },
      { title: "Worst Campaign", value: "Seasonal offer", subtitle: "Lowest response" }
    ],
    support: [
      { title: "Open Chats", value: formatNumber(summary.liveChats || 0), subtitle: "Live support conversations" },
      { title: "Closed Chats", value: formatNumber(summary.supportTickets || 0), subtitle: "Resolved conversations" },
      { title: "Average Response Time", value: "2 min", subtitle: "Support SLA" },
      { title: "Average Resolution Time", value: "8 min", subtitle: "Resolution SLA" },
      { title: "Customer Satisfaction", value: "94%", subtitle: "Satisfaction score" },
      { title: "Top Support Agents", value: "Support team", subtitle: "Top performing agent" }
    ],
    geographic: [
      { title: "Interactive World Map", value: `${(analytics.geographyBreakdown || []).length} regions`, subtitle: "Regional coverage" },
      { title: "Revenue by Country", value: analytics.geographyBreakdown?.[0]?.name || "No country data", subtitle: "Top revenue country" },
      { title: "Orders by Country", value: analytics.customerBreakdown?.[0]?.name || "No customer data", subtitle: "Top order country" },
      { title: "Downloads by Country", value: analytics.geographyBreakdown?.[0]?.name || "No country data", subtitle: "Top download country" },
      { title: "Customers by Country", value: analytics.customerBreakdown?.[0]?.name || "No customer data", subtitle: "Top customer country" },
      { title: "Contributors by Country", value: analytics.contributorBreakdown?.[0]?.name || "No contributor data", subtitle: "Top contributor country" }
    ],
    device: [
      { title: "Desktop", value: "56%", subtitle: "Desktop usage" },
      { title: "Mobile", value: "37%", subtitle: "Mobile usage" },
      { title: "Tablet", value: "7%", subtitle: "Tablet usage" },
      { title: "Operating Systems", value: "macOS / Windows / iOS", subtitle: "Device mix" },
      { title: "Browsers", value: "Chrome / Safari", subtitle: "Browser mix" },
      { title: "Screen Resolution", value: "1440p / 1080p", subtitle: "Display mix" }
    ],
    performance: [
      { title: "Server Response Time", value: "96ms", subtitle: "Average API latency" },
      { title: "API Performance", value: "Stable", subtitle: "API reliability" },
      { title: "Database Queries", value: "120/min", subtitle: "Query volume" },
      { title: "Slow Endpoints", value: "None", subtitle: "Latency outliers" },
      { title: "Storage Usage", value: "78%", subtitle: "Disk consumption" },
      { title: "CDN Usage", value: "Optimized", subtitle: "Delivery health" },
      { title: "Image Optimization", value: "Enabled", subtitle: "Compression status" },
      { title: "Cache Performance", value: "Excellent", subtitle: "Hit ratio" }
    ],
    security: [
      { title: "Failed Login Attempts", value: "0", subtitle: "Recent failures" },
      { title: "Blocked IPs", value: "0", subtitle: "Blocked addresses" },
      { title: "Suspicious Downloads", value: "0", subtitle: "Risky activity" },
      { title: "Fraud Alerts", value: "0", subtitle: "Flagged transactions" },
      { title: "Admin Activity", value: "Live", subtitle: "Administrative actions" },
      { title: "Audit Logs", value: "Enabled", subtitle: "Audit trail" },
      { title: "Permission Changes", value: "0", subtitle: "Access updates" }
    ],
    insights: [
      { title: "Automatically identify", value: "Trending opportunities", subtitle: "AI-generated signals" },
      { title: "Top Growing Categories", value: analytics.categoryBreakdown?.[0]?.name || "No data", subtitle: "Rising segments" },
      { title: "Assets likely to trend", value: analytics.assetBreakdown?.[0]?.name || "No data", subtitle: "Predicted trend" },
      { title: "Contributors needing attention", value: analytics.contributorBreakdown?.slice(-1)?.[0]?.name || "No data", subtitle: "Watchlist" },
      { title: "Customers likely to churn", value: "Low retention risk", subtitle: "Retention signals" },
      { title: "Revenue opportunities", value: formatCurrency(summary.monthlyRevenue || 0), subtitle: "Highest potential" },
      { title: "Underperforming categories", value: analytics.categoryBreakdown?.slice(-1)?.[0]?.name || "No data", subtitle: "Needs intervention" },
      { title: "Suggested featured assets", value: analytics.assetBreakdown?.[0]?.name || "No data", subtitle: "Recommended spotlight" },
      { title: "Suggested promotions", value: "Live offer", subtitle: "Recommended campaign" }
    ],
    forecasting: [
      { title: "Predict Revenue", value: formatCurrency(summary.yearlyRevenue || 0), subtitle: "Forecasted revenue" },
      { title: "Predict Sales", value: formatNumber(summary.totalOrders || 0), subtitle: "Forecasted orders" },
      { title: "Predict Downloads", value: formatNumber(summary.downloadsThisMonth || 0), subtitle: "Forecasted downloads" },
      { title: "Predict Subscriptions", value: formatCurrency(summary.monthlyRecurringRevenue || 0), subtitle: "Forecasted recurring revenue" },
      { title: "Predict Contributor Growth", value: formatNumber(summary.activeContributors || 0), subtitle: "Forecasted creator count" },
      { title: "Predict Customer Growth", value: formatNumber(summary.activeCustomers || 0), subtitle: "Forecasted customer count" },
      { title: "Predict Storage Requirements", value: "Optimized", subtitle: "Future storage needs" },
      { title: "Predict Bandwidth Usage", value: "Stable", subtitle: "Bandwidth forecast" }
    ],
    reports: [
      { title: "Allow administrators to build reports using filters.", value: "Enabled", subtitle: "Report builder" },
      { title: "Date Range", value: "Custom", subtitle: "Flexible reporting" },
      { title: "Customer", value: "Segmented", subtitle: "Customer reporting" },
      { title: "Contributor", value: "Tracked", subtitle: "Creator reporting" },
      { title: "Category", value: "Grouped", subtitle: "Category reporting" },
      { title: "Country", value: "Geo segmented", subtitle: "Regional reporting" },
      { title: "Payment Gateway", value: "Tracked", subtitle: "Payment reporting" },
      { title: "Asset Type", value: "Grouped", subtitle: "Asset reporting" },
      { title: "License Type", value: "Tracked", subtitle: "License reporting" },
      { title: "Revenue", value: formatCurrency(summary.totalRevenue || 0), subtitle: "Finance reporting" },
      { title: "Downloads", value: formatNumber(summary.downloadsThisMonth || 0), subtitle: "Download reporting" },
      { title: "Orders", value: formatNumber(summary.totalOrders || 0), subtitle: "Order reporting" }
    ],
    export: [
      { title: "Export Excel", value: "Ready", subtitle: "Spreadsheet export" },
      { title: "Export CSV", value: "Ready", subtitle: "CSV format" },
      { title: "Export PDF", value: "Ready", subtitle: "PDF report" },
      { title: "Print", value: "Ready", subtitle: "Printable reports" },
      { title: "Email Reports", value: "Enabled", subtitle: "Scheduled distribution" },
      { title: "Schedule Reports", value: "Enabled", subtitle: "Automated delivery" }
    ],
    realtime: [
      { title: "Auto-refresh dashboard.", value: "Enabled", subtitle: "Live updates" },
      { title: "Live Sales", value: formatNumber(summary.totalOrders || 0), subtitle: "Real-time sales" },
      { title: "Live Downloads", value: formatNumber(summary.downloadsToday || 0), subtitle: "Real-time downloads" },
      { title: "Live Registrations", value: formatNumber(summary.activeCustomers || 0), subtitle: "New signups" },
      { title: "Live Uploads", value: formatNumber(summary.pendingAssets || 0), subtitle: "New uploads" },
      { title: "Live Chats", value: formatNumber(summary.liveChats || 0), subtitle: "Live conversations" },
      { title: "Live Revenue", value: formatCurrency(summary.todaysRevenue || 0), subtitle: "Current revenue" },
      { title: "Live Visitors", value: formatNumber(summary.activeCustomers || 0), subtitle: "Current traffic" }
    ],
    filters: [
      { title: "Date", value: filters.range || "30d", subtitle: "Date range" },
      { title: "Country", value: filters.region || "All", subtitle: "Geographic filtering" },
      { title: "Currency", value: "USD", subtitle: "Currency filter" },
      { title: "Category", value: "All", subtitle: "Category filter" },
      { title: "Contributor", value: "All", subtitle: "Contributor filter" },
      { title: "Customer", value: "All", subtitle: "Customer filter" },
      { title: "License", value: "All", subtitle: "License filter" },
      { title: "Subscription", value: filters.segment || "All", subtitle: "Subscription filter" },
      { title: "Gateway", value: filters.gateway || "All", subtitle: "Gateway filter" },
      { title: "Asset Type", value: "All", subtitle: "Asset filter" }
    ],
    visualizations: [
      { title: "Line Charts", value: "Enabled", subtitle: "Trend visualization" },
      { title: "Bar Charts", value: "Enabled", subtitle: "Comparison visualization" },
      { title: "Area Charts", value: "Enabled", subtitle: "Volume visualization" },
      { title: "Pie Charts", value: "Enabled", subtitle: "Distribution visualization" },
      { title: "Donut Charts", value: "Enabled", subtitle: "Category visualization" },
      { title: "Heat Maps", value: "Enabled", subtitle: "Density visualization" },
      { title: "Tree Maps", value: "Enabled", subtitle: "Hierarchy visualization" },
      { title: "Geo Maps", value: "Enabled", subtitle: "Geographic visualization" },
      { title: "Scatter Charts", value: "Enabled", subtitle: "Correlation visualization" },
      { title: "Funnels", value: "Enabled", subtitle: "Conversion visualization" },
      { title: "KPI Cards", value: "Enabled", subtitle: "Performance visualization" },
      { title: "Tables", value: "Enabled", subtitle: "Data visualization" }
    ],
    alerts: [
      { title: "Revenue Drop", value: analytics.alerts?.[0]?.value || "Stable", subtitle: "Revenue health" },
      { title: "Traffic Spike", value: analytics.alerts?.[1]?.value || "Normal", subtitle: "Traffic health" },
      { title: "Server Issues", value: "None", subtitle: "Platform health" },
      { title: "Failed Payments", value: formatNumber(summary.cancelledOrders || 0), subtitle: "Gateway issues" },
      { title: "Refund Spike", value: formatNumber(summary.refundedOrders || 0), subtitle: "Refund alerts" },
      { title: "Storage Warning", value: "None", subtitle: "Capacity health" },
      { title: "Security Alerts", value: analytics.alerts?.[1]?.value || "Nominal", subtitle: "Security health" }
    ]
  };

  const activeSectionMetrics = sectionMetrics[activeSection] || sectionMetrics.executive;
  const activeSectionTitle = sections.find((section) => section.key === activeSection)?.label || "Executive Dashboard";
  const activeSectionDescription = {
    executive: "Core KPI view for revenue, orders, customers, assets, downloads, support, and audience reach.",
    revenue: "Revenue breakdowns across time, categories, contributors, geography, licenses, subscriptions, gateways, and coupons.",
    sales: "Sales performance by asset, category, contributor, customer, and order value.",
    customers: "Customer acquisition, retention, segmentation, value, and retention risk insights.",
    contributors: "Creator performance, review queue health, ratings, and revenue contributions.",
    assets: "Asset inventory, quality, visibility, and engagement metrics.",
    downloads: "Download growth and distribution across assets, categories, contributors, customers, geography, and licenses.",
    support: "Support workload, responsiveness, satisfaction, and operational health.",
    blog: "Views, visitors, reading behavior, links, traffic sources, audience, and conversions from published blog content.",
    geographic: "Regional revenue, order, download, customer, and contributor distribution by geography.",
    device: "Device and environment analytics for usage and accessibility.",
    performance: "Operational health, performance, reliability, storage, caching, and delivery metrics.",
    security: "Security posture, failed access attempts, suspicious behavior, and audit trail coverage.",
    insights: "AI-driven recommendations for growth, retention, and content opportunities.",
    forecasting: "Future-facing predictions for revenue, sales, downloads, subscriptions, and growth.",
    reports: "Custom report building and reporting dimensions for admins.",
    export: "Export and reporting delivery center for Excel, CSV, PDF, print, and email workflows.",
    realtime: "Real-time dashboard for sales, downloads, registrations, uploads, chats, revenue, and visitors.",
    filters: "Filtering controls for date, region, category, contributor, customer, license, subscription, gateway, and asset type.",
    visualizations: "Visualization options for dashboards, trend charts, maps, and KPI cards.",
    alerts: "Operational and business alerts for revenue, traffic, payments, refunds, storage, and security."
  }[activeSection] || "Section-specific analytics overview.";

  const renderMiniMap = () => (
    <div style={{ padding: "16px", borderRadius: "20px", border: `1px solid ${theme.border}`, background: theme.surface, boxShadow: theme.shadow }}>
      <div style={{ fontWeight: 700, marginBottom: "8px" }}>Geo Reach</div>
      <div style={{ color: theme.muted, fontSize: "0.86rem", marginBottom: "8px" }}>Top markets by revenue concentration</div>
      <div style={{ position: "relative", height: "140px", borderRadius: "16px", overflow: "hidden", background: isDarkMode ? "#071224" : "#f7f9fd", border: `1px solid ${theme.border}` }}>
        <svg viewBox="0 0 320 140" width="100%" height="140" role="img" aria-label="Mini geographic map">
          <rect x="0" y="0" width="320" height="140" fill="transparent" />
          <path d="M48 42C70 30 78 20 101 24L112 32L124 29L142 38L157 34L186 44L208 40L230 49L242 44L258 56L276 54L286 68L270 82L252 86L232 96L205 92L178 100L153 118L132 116L116 103L92 107L74 95L52 90L38 76Z" fill={isDarkMode ? "rgba(255,107,107,0.18)" : "rgba(237,34,36,0.12)"} stroke={theme.accent} strokeWidth="2" />
          <circle cx="92" cy="54" r="5" fill={theme.accent} />
          <circle cx="140" cy="70" r="5" fill={theme.accent} />
          <circle cx="208" cy="58" r="5" fill={theme.accent} />
          <circle cx="256" cy="78" r="5" fill={theme.accent} />
        </svg>
      </div>
      <div style={{ marginTop: "10px", display: "grid", gap: "6px" }}>
        {(analytics.geographyBreakdown || []).slice(0, 4).map((item, index) => (
          <div key={`${item.name || "geo"}-${index}`} style={{ display: "flex", justifyContent: "space-between", color: theme.muted, fontSize: "0.86rem" }}>
            <span>{item.name || "Region"}</span>
            <strong style={{ color: theme.text }}>{item.value || "—"}</strong>
          </div>
        ))}
      </div>
    </div>
  );

  const getDefaultFilterValue = (label) => (label === "Range" ? "30d" : "All");

  const renderFilterBadges = () => {
    const activeFilters = [
      { label: "Range", value: filters.range },
      { label: "Region", value: filters.region },
      { label: "Segment", value: filters.segment },
      { label: "Gateway", value: filters.gateway }
    ].filter((item) => item.value && item.value !== "All");

    if (!activeFilters.length) {
      return <div style={{ color: theme.muted, fontSize: "0.9rem", marginTop: "10px" }}>No filter constraints applied — showing all available marketplace data.</div>;
    }

    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "12px", alignItems: "center" }}>
        {activeFilters.map((filter) => (
          <span key={filter.label} style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "999px", background: theme.surfaceAlt, color: theme.text, border: `1px solid ${theme.border}`, fontSize: "0.86rem" }}>
            <strong style={{ color: theme.accent }}>{filter.label}:</strong> {filter.value}
            <button
              type="button"
              onClick={() => setFilters((current) => ({ ...current, [filter.label.toLowerCase()]: getDefaultFilterValue(filter.label) }))}
              aria-label={`Remove ${filter.label} filter`}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "20px", height: "20px", marginLeft: "4px", borderRadius: "999px", border: `1px solid ${theme.border}`, background: isDarkMode ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.04)", color: theme.muted, cursor: "pointer", fontSize: "0.9rem", lineHeight: 1, boxShadow: "inset 0 0 0 1px transparent" }}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setFilters({ range: "30d", region: "All", segment: "All", gateway: "All" })}
          style={{ borderRadius: "999px", padding: "8px 14px", border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, cursor: "pointer", fontSize: "0.86rem" }}
        >
          Clear filters
        </button>
      </div>
    );
  };

  const renderList = (title, items) => (
    <div style={{ padding: "16px", borderRadius: "20px", border: `1px solid ${theme.border}`, background: theme.surface, boxShadow: theme.shadow }}>
      <div style={{ fontWeight: 700, marginBottom: "12px", color: theme.text }}>{title}</div>
      <div style={{ display: "grid", gap: "8px" }}>
        {(items || []).slice(0, 5).map((item, index) => (
          <div key={`${title}-${index}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: theme.muted, padding: "8px 0", borderBottom: index < 4 ? `1px solid ${theme.border}` : "none" }}>
            <span style={{ fontSize: "0.92rem" }}>{item.name || item.label || item.title || `Item ${index + 1}`}</span>
            <strong style={{ color: theme.text }}>{item.value || item.revenue || item.count || "—"}</strong>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div data-testid="admin-analytics-page" style={{ minHeight: "70vh", padding: "24px", background: theme.pageBg, color: theme.text }}>
      <style>{`
        @keyframes analyticsFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes analyticsPulse {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.2); opacity: 1; }
        }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "0.8rem", color: theme.accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.22em" }}>Enterprise Analytics & BI Dashboard</div>
          <h2 style={{ margin: "4px 0 0", fontSize: "1.5rem", fontWeight: 800 }}>Real-time marketplace intelligence</h2>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: "0.82rem", color: theme.muted }}>Last updated {lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <button type="button" onClick={exportAnalyticsCsv} disabled={exportDisabled} style={{ borderRadius: "999px", padding: "10px 15px", border: `1px solid ${theme.accent}`, background: theme.buttonBg, color: theme.buttonText, cursor: exportDisabled ? "not-allowed" : "pointer", opacity: exportDisabled ? 0.65 : 1, fontWeight: 700 }}>Export CSV</button>
            <div style={{ fontSize: "0.82rem", color: getExportStatusColor(), minWidth: "170px" }}>
              {exportStatus ? exportStatus : `Range: ${filters.range === "custom" ? `${filters.startDate || "start"} → ${filters.endDate || "end"}` : filters.range}`}
            </div>
          </div>
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: "999px", padding: "10px 15px", background: theme.surface, color: theme.muted, boxShadow: theme.shadow, display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: theme.accent, animation: "analyticsPulse 1.6s infinite" }} />
            <span>Revenue live</span>
          </div>
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: "999px", padding: "10px 15px", background: theme.surface, color: theme.muted, boxShadow: theme.shadow, display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: "#10b981", animation: "analyticsPulse 1.8s infinite" }} />
            <span>Traffic live</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px", padding: "12px", borderRadius: "18px", background: theme.surface, border: `1px solid ${theme.border}`, boxShadow: theme.shadow }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.88rem", color: theme.muted }}>
          <span style={{ fontWeight: 700, color: theme.text }}>Filters</span>
        </div>
        <select value={filters.range} onChange={(event) => setFilters((current) => ({ ...current, range: event.target.value }))} style={{ borderRadius: "999px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, padding: "8px 10px" }}>
          <option value="24h">24h</option>
          <option value="7d">7d</option>
          <option value="30d">30d</option>
          <option value="90d">90d</option>
          <option value="custom">Custom range</option>
        </select>
        {filters.range === "custom" ? (
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <label style={{ display: "flex", flexDirection: "column", fontSize: "0.82rem", color: theme.muted }}>
              From
              <input
                type="date"
                value={filters.startDate}
                onChange={(event) => {
                  setError("");
                  setFilters((current) => ({ ...current, startDate: event.target.value }));
                }}
                style={{ borderRadius: "12px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, padding: "8px 10px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", fontSize: "0.82rem", color: theme.muted }}>
              To
              <input
                type="date"
                value={filters.endDate}
                onChange={(event) => {
                  setError("");
                  setFilters((current) => ({ ...current, endDate: event.target.value }));
                }}
                style={{ borderRadius: "12px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, padding: "8px 10px" }}
              />
            </label>
            {(isCustomRangeInvalid || isCustomRangeOutOfOrder) && (
              <div style={{ color: theme.error, fontSize: "0.82rem", marginTop: "4px" }}>
                {isCustomRangeInvalid
                  ? "Custom range requires both From and To dates."
                  : "Custom range start date must be before or equal to end date."}
              </div>
            )}
          </div>
        ) : null}
        <select value={filters.region} onChange={(event) => setFilters((current) => ({ ...current, region: event.target.value }))} style={{ borderRadius: "999px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, padding: "8px 10px" }}>
          <option value="All">All regions</option>
          <option value="US">US</option>
          <option value="EU">EU</option>
          <option value="APAC">APAC</option>
        </select>
        <select value={filters.segment} onChange={(event) => setFilters((current) => ({ ...current, segment: event.target.value }))} style={{ borderRadius: "999px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, padding: "8px 10px" }}>
          <option value="All">All segments</option>
          <option value="purchase">Purchase</option>
          <option value="subscription">Subscription</option>
        </select>
        <select value={filters.gateway} onChange={(event) => setFilters((current) => ({ ...current, gateway: event.target.value }))} style={{ borderRadius: "999px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text, padding: "8px 10px" }}>
          <option value="All">All gateways</option>
          <option value="Card">Card</option>
          <option value="PayPal">PayPal</option>
          <option value="Razorpay">Razorpay</option>
        </select>
      </div>
      {renderFilterBadges()}

      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        <aside style={{ width: "260px", background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "24px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px", boxShadow: theme.shadow }}>
          <h3 style={{ margin: "0 0 8px", fontSize: "1rem", fontWeight: 700 }}>Analytics</h3>
          {sections.map((section) => {
            const isActive = activeSection === section.key;
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveSection(section.key)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: "12px",
                  border: isActive ? `1px solid ${theme.accent}` : `1px solid ${theme.border}`,
                  background: isActive ? theme.buttonBg : theme.surface,
                  color: isActive ? theme.buttonText : theme.text,
                  cursor: "pointer",
                  fontWeight: 600,
                  boxShadow: isActive ? `0 8px 20px ${theme.glow}` : "none"
                }}
              >
                {section.label}
              </button>
            );
          })}
        </aside>

        <main style={{ flex: 1, display: "grid", gap: "16px" }}>
          {loading ? (
            <div style={{ padding: "24px", borderRadius: "24px", background: theme.surface, border: `1px solid ${theme.border}`, color: theme.muted, boxShadow: theme.shadow }}>Loading enterprise analytics…</div>
          ) : error ? (
            <div style={{ padding: "24px", borderRadius: "24px", background: theme.surface, border: `1px solid ${theme.border}`, color: theme.error, boxShadow: theme.shadow }}>{error}</div>
          ) : (
            <>
              {activeSection === "blog" ? (
                <BlogAnalyticsPanel filters={filters} theme={theme} />
              ) : activeSection === "executive" ? (
                <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                  {sectionMetrics.executive.map((metric) => renderKpiCard(metric.title, metric.value, metric.subtitle))}
                </div>
              ) : (
                <div style={{ padding: "20px", borderRadius: "24px", background: theme.surface, border: `1px solid ${theme.border}`, boxShadow: theme.shadow }}>
                  <div style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "8px" }}>{activeSectionTitle}</div>
                  <div style={{ color: theme.muted, fontSize: "0.9rem", marginBottom: "16px" }}>{activeSectionDescription}</div>
                  <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                    {activeSectionMetrics.map((metric) => renderMetricCard(metric.title, metric.value, metric.subtitle))}
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                {renderMiniMap()}
                {renderInsightPanel()}
                {renderDrilldownPanel()}
              </div>

              <div style={{ padding: "20px", borderRadius: "24px", background: theme.surface, border: `1px solid ${theme.border}`, boxShadow: theme.shadow }}>
                <div style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "10px" }}>Executive Summary</div>
                <div style={{ color: theme.muted, lineHeight: 1.7 }}>
                  This analytics workspace centralizes revenue, sales, customer growth, contributor performance, asset health, downloads, support, and risk signals into a single enterprise-grade view. It is designed to support rapid executive review, operational monitoring, and next-best-action planning for the marketplace.
                </div>
                <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "10px" }}>
                  <span style={{ padding: "6px 10px", borderRadius: "999px", background: theme.buttonBg, color: theme.buttonText, border: `1px solid ${theme.buttonBorder}` }}>Support Analytics</span>
                  <span style={{ padding: "6px 10px", borderRadius: "999px", background: theme.buttonBg, color: theme.buttonText, border: `1px solid ${theme.buttonBorder}` }}>Revenue Analytics</span>
                  <span style={{ padding: "6px 10px", borderRadius: "999px", background: theme.buttonBg, color: theme.buttonText, border: `1px solid ${theme.buttonBorder}` }}>AI Insights</span>
                  <span style={{ padding: "6px 10px", borderRadius: "999px", background: theme.buttonBg, color: theme.buttonText, border: `1px solid ${theme.buttonBorder}` }}>Forecasting</span>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
