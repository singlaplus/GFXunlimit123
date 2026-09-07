import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import Pagination from "../components/Pagination";
import { getEffectiveAuthToken } from "../utils/authSession";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";

const getIsDarkMode = () => typeof document !== "undefined" && document.body.classList.contains("dark-mode");

const LIGHT_THEME = {
  pageBg: "#f8fafc",
  surface: "#ffffff",
  surfaceAlt: "#f8fafc",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  accent: "#ed2224",
  buttonText: "#ffffff",
  cardBg: "#ffffff",
  rowBg: "#f8fafc",
  rowBorder: "#e2e8f0",
  headerBg: "#f8fafc",
  error: "#dc2626"
};

const DARK_THEME = {
  pageBg: "#0f172a",
  surface: "#111827",
  surfaceAlt: "#1f2937",
  border: "#374151",
  text: "#f8fafc",
  muted: "#94a3b8",
  accent: "#ed2224",
  buttonText: "#ffffff",
  cardBg: "#1f1f1f",
  rowBg: "#111827",
  rowBorder: "#374151",
  headerBg: "#1f2937",
  error: "#f87171"
};

const STATUS_OPTIONS = ["pending", "awaiting_payment", "payment_processing", "payment_authorized", "completed", "download_available", "partially_downloaded", "fully_downloaded", "refund_requested", "refund_approved", "refunded", "partially_refunded", "cancelled", "failed", "chargeback", "expired", "archived"];
const PAYMENT_STATUS_OPTIONS = ["pending", "completed", "failed", "authorized", "refunded", "cancelled"];
const REFUND_STATUS_OPTIONS = ["none", "requested", "approved", "refunded", "partially_refunded"];
const ORDER_TYPES = ["purchase", "subscription", "credit_purchase"];
const PAYMENT_GATEWAYS = ["Credit Card", "PayPal", "Google Pay", "Paytm", "Stripe", "Bank Transfer"];

const ACTIONS = [
  { key: "markCompleted", label: "Mark Completed", payload: { status: "completed" } },
  { key: "cancel", label: "Cancel Orders", payload: { status: "cancelled" } },
  { key: "approveRefund", label: "Approve Refunds", payload: { refundStatus: "refunded" } },
  { key: "rejectRefund", label: "Reject Refunds", payload: { refundStatus: "refund_requested" } },
  { key: "archive", label: "Archive", payload: { status: "archived" } }
];

const COLORS = ["#ed2224", "#1976d2", "#43a047", "#f59e0b", "#8b5cf6", "#0ea5e9", "#f97316"];

const formatCurrency = (value, currency) => {
  const amount = Number(value || 0);
  return `${currency || "USD"} ${amount.toFixed(2)}`;
};

const toDateString = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
};

const toDateTimeString = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const formatActivityDetails = (details) => {
  if (!details) return "No details";
  if (typeof details === "string") return details;
  if (details.title) {
    return `Asset: ${details.title}${details.assetId ? ` (ID: ${details.assetId})` : ""}`;
  }
  return JSON.stringify(details);
};

const buildCsvContent = (rows, headers) => [
  headers.join(","),
  ...rows.map((row) => headers.map((field) => `"${String(row[field] ?? "").replace(/"/g, '""')}"`).join(","))
].join("\n");

const downloadCsvFile = (csvContent, filename) => {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

const exportModuleCsv = (rows, headers, filename) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    downloadCsvFile(buildCsvContent([], headers), filename);
    return;
  }
  const csvContent = buildCsvContent(rows, headers);
  downloadCsvFile(csvContent, filename);
};

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState({});
  const [analytics, setAnalytics] = useState({});
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [details, setDetails] = useState(null);
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(getIsDarkMode);
  const [resetCountdown, setResetCountdown] = useState(0);
  const resetTimeoutRef = useRef(null);
  const resetIntervalRef = useRef(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    search: "",
    orderStatus: "",
    paymentStatus: "",
    refundStatus: "",
    downloadStatus: "",
    paymentGateway: "",
    orderType: "",
    currency: "",
    country: "",
    couponCode: "",
    invoiceNumber: "",
    transactionId: "",
    customerId: "",
    contributorId: "",
    assetId: "",
    category: "",
    dateFrom: "",
    dateTo: ""
  });

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const syncTheme = () => setIsDarkMode(getIsDarkMode());
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    syncTheme();
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    window.clearTimeout(resetTimeoutRef.current);
    window.clearInterval(resetIntervalRef.current);
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError("");
        const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
        const params = {
          page,
          limit,
          ...filters
        };
        const [summaryRes, ordersRes] = await Promise.all([
          axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/orders/summary`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          }),
          axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/orders`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            params
          })
        ]);

        setSummary(summaryRes.data || {});
        setAnalytics(ordersRes.data?.analytics || {});
        setOrders(Array.isArray(ordersRes.data?.orders) ? ordersRes.data.orders : []);
        setTotal(Number(ordersRes.data?.total || 0));
      } catch (err) {
        console.error("Failed to load admin orders", err);
        setError("Unable to load orders right now.");
        setOrders([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [page, limit, filters]);

  const theme = isDarkMode ? DARK_THEME : LIGHT_THEME;

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const onFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const toggleOrderSelection = (orderId) => {
    setSelectedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const selectAll = () => {
    const next = new Set(orders.filter((order) => order.id).map((order) => order.id));
    setSelectedOrders(next);
  };

  const clearSelection = () => {
    setSelectedOrders(new Set());
  };

  const exportCsv = () => {
    const rows = orders.map((order) => ({
      order_number: order.order_number || "",
      invoice_number: order.invoice_number || "",
      created_at: order.created_at || "",
      customer_name: order.customer_username || "",
      customer_email: order.customer_email || "",
      customer_id: order.customer_id || "",
      order_type: order.order_type || "",
      assets_count: order.assets_count || 0,
      subtotal: order.subtotal || 0,
      discount: order.discount || 0,
      coupon_code: order.coupon_code || "",
      tax: order.tax || 0,
      total_amount: order.total_amount || 0,
      currency: order.currency || "",
      payment_gateway: order.payment_gateway || "",
      transaction_id: order.transaction_id || "",
      payment_status: order.payment_status || "",
      order_status: order.order_status || "",
      download_status: order.download_status || "",
      refund_status: order.refund_status || "",
      contributor_earnings: order.contributor_earnings || 0,
      platform_commission: order.platform_commission || 0,
      support_status: order.support_status || ""
    }));
    const headers = Object.keys(rows[0] || {});
    const csvContent = buildCsvContent(rows, headers);
    downloadCsvFile(csvContent, "admin-orders.csv");
  };

  const exportSummaryCsv = () => {
    const summaryRows = [
      { metric: "Total Orders", value: orderSummary.totalOrders },
      { metric: "Total Revenue", value: orderSummary.totalRevenue },
      { metric: "Pending Orders", value: orderSummary.pendingOrders },
      { metric: "Completed Orders", value: orderSummary.completedOrders },
      { metric: "Refunded Orders", value: orderSummary.refundedOrders },
      { metric: "Returning Customers", value: orderSummary.returningCustomers }
    ];
    exportModuleCsv(summaryRows, ["metric", "value"], "order-summary.csv");
  };

  const exportAllOrdersForReset = async () => {
    const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
    const allOrders = [];
    let currentPage = 1;
    let totalOrders = 0;
    do {
      const response = await axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/orders`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        params: { page: currentPage, limit: 100 }
      });
      allOrders.push(...(response.data?.orders || []));
      totalOrders = Number(response.data?.total || allOrders.length);
      currentPage += 1;
    } while (allOrders.length < totalOrders);
    const rows = allOrders.map((order) => ({
      order_number: order.order_number || "",
      invoice_number: order.invoice_number || "",
      created_at: order.created_at || "",
      customer_name: order.customer_username || "",
      customer_email: order.customer_email || "",
      customer_id: order.customer_id || "",
      order_type: order.order_type || "",
      assets_count: order.assets_count || 0,
      subtotal: order.subtotal || 0,
      discount: order.discount || 0,
      coupon_code: order.coupon_code || "",
      tax: order.tax || 0,
      total_amount: order.total_amount || 0,
      currency: order.currency || "",
      payment_gateway: order.payment_gateway || "",
      transaction_id: order.transaction_id || "",
      payment_status: order.payment_status || "",
      order_status: order.order_status || "",
      download_status: order.download_status || "",
      refund_status: order.refund_status || "",
      contributor_earnings: order.contributor_earnings || 0,
      platform_commission: order.platform_commission || 0,
      support_status: order.support_status || ""
    }));
    const headers = Object.keys(rows[0] || {
      order_number: "",
      invoice_number: "",
      created_at: "",
      customer_name: "",
      customer_email: "",
      customer_id: "",
      order_type: "",
      assets_count: "",
      subtotal: "",
      discount: "",
      coupon_code: "",
      tax: "",
      total_amount: "",
      currency: "",
      payment_gateway: "",
      transaction_id: "",
      payment_status: "",
      order_status: "",
      download_status: "",
      refund_status: "",
      contributor_earnings: "",
      platform_commission: "",
      support_status: ""
    });
    downloadCsvFile(buildCsvContent(rows, headers), "orders-before-reset.csv");
  };

  const resetOrderStats = async () => {
    try {
      setLoading(true);
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      await axios.post(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/orders/reset`, {}, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
    } catch (err) {
      console.error("Failed to reset order statistics", err);
      setError("Unable to reset order statistics.");
    } finally {
      setLoading(false);
    }
  };

  const clearVisibleOrderStats = () => {
    setResetCountdown(0);
    setSelectedOrders(new Set());
    setPage(1);
    setSummary({});
    setAnalytics({});
    setOrders([]);
    setTotal(0);
  };

  const cancelReset = () => {
    window.clearTimeout(resetTimeoutRef.current);
    window.clearInterval(resetIntervalRef.current);
    resetTimeoutRef.current = null;
    resetIntervalRef.current = null;
    setResetCountdown(0);
  };

  const beginReset = async () => {
    if (!window.confirm("Reset all order and sales statistics? A CSV backup will download before the 30-second countdown, and all sales data will then be deleted.")) return;
    try {
      await exportAllOrdersForReset();
      setError("");
      setResetCountdown(30);
      resetIntervalRef.current = window.setInterval(() => setResetCountdown((value) => Math.max(0, value - 1)), 1000);
      resetTimeoutRef.current = window.setTimeout(() => {
        window.clearInterval(resetIntervalRef.current);
        clearVisibleOrderStats();
        resetOrderStats();
      }, 30000);
    } catch (err) {
      console.error("Failed to export orders before reset", err);
      setError("Unable to download the order backup. Reset was cancelled.");
    }
  };

  const exportOrderTrendCsv = () => {
    const trendRows = (analytics.orderTrend || []).map((item) => ({ date: item.label || "", orders: item.value || 0 }));
    exportModuleCsv(trendRows, ["date", "orders"], "order-volume.csv");
  };

  const exportTopCustomersCsv = () => {
    const customerRows = (analytics.topCustomers || []).map((item) => ({ customer: item.name || item.email || "Unknown", revenue: item.revenue || 0 }));
    exportModuleCsv(customerRows, ["customer", "revenue"], "top-customers.csv");
  };

  const exportGatewayMixCsv = () => {
    const gatewayRows = (analytics.paymentGatewayDistribution || []).map((item) => ({ gateway: item.name || "Unknown", count: item.value || 0 }));
    exportModuleCsv(gatewayRows, ["gateway", "count"], "gateway-mix.csv");
  };

  const openDetails = async (orderId) => {
    try {
      setDetailsLoading(true);
      setDetails(null);
      setShowDetails(true);
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const response = await axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/orders/${orderId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      setDetails(response.data || null);
    } catch (err) {
      console.error("Failed to load order details", err);
      setError("Unable to load order details.");
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeDetails = () => {
    setShowDetails(false);
    setDetails(null);
  };

  const performBulkAction = async (action) => {
    if (selectedOrders.size === 0) return;
    try {
      setLoading(true);
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const payload = ACTIONS.find((item) => item.key === action)?.payload || {};
      for (const orderId of Array.from(selectedOrders)) {
        await axios.put(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/orders/${orderId}/status`, payload, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
      }
      clearSelection();
      setPage(1);
    } catch (err) {
      console.error("Bulk action failed", err);
      setError("Bulk action failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const renderStatusBadge = (status) => {
    const normalized = String(status || "").toLowerCase().replace(/\s+/g, "_");
    const colorMap = {
      completed: "#43a047",
      refunded: "#8b5cf6",
      pending: "#f59e0b",
      failed: "#ef4444",
      cancelled: "#b91c1c",
      archived: "#6b7280"
    };
    const color = colorMap[normalized] || "#2563eb";
    return (
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "90px", padding: "6px 10px", borderRadius: "999px", background: `${color}22`, color, fontSize: "0.82rem", fontWeight: 600, textTransform: "capitalize" }}>
        {status || "Unknown"}
      </span>
    );
  };

  const orderSummary = useMemo(() => ({
    totalOrders: total,
    totalRevenue: summary.total_revenue || 0,
    pendingOrders: summary.pending_orders || 0,
    completedOrders: summary.completed_orders || 0,
    refundedOrders: summary.refunded_orders || 0,
    returningCustomers: summary.returning_customers || 0
  }), [summary, total]);

  return (
    <div style={{ minHeight: "100vh", padding: "24px", background: theme.pageBg, color: theme.text }}>
      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", marginBottom: "24px" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: "2rem" }}>Orders Management</h1>
          <p style={{ margin: "10px 0 0", color: theme.muted, maxWidth: "760px" }}>
            Enterprise order lifecycle tools for tracking purchases, payments, downloads, refunds, invoices, contributors, and customer history.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button type="button" onClick={exportCsv} disabled={loading || orders.length === 0} style={{ borderRadius: "16px", border: "none", background: theme.accent, color: theme.buttonText, padding: "12px 18px", cursor: loading || orders.length === 0 ? "not-allowed" : "pointer" }}>
            Export CSV
          </button>
          <button type="button" onClick={() => window.print()} style={{ borderRadius: "16px", border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, padding: "12px 18px", cursor: "pointer" }}>
            Print
          </button>
        </div>
      </header>

      <section style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Order Summary</h2>
            <p style={{ margin: "8px 0 0", color: theme.muted }}>High-level summary metrics for orders, revenue, refunds, and customer behavior.</p>
          </div>
          <button type="button" onClick={exportSummaryCsv} disabled={loading} style={{ borderRadius: "16px", border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, padding: "12px 18px", cursor: loading ? "not-allowed" : "pointer" }}>
            Export Summary CSV
          </button>
        </div>
        <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {[
            { label: "Total Orders", value: orderSummary.totalOrders },
            { label: "Total Revenue", value: formatCurrency(orderSummary.totalRevenue, summary.currency || "USD") },
            { label: "Pending Orders", value: orderSummary.pendingOrders },
            { label: "Completed Orders", value: orderSummary.completedOrders },
            { label: "Refunded Orders", value: orderSummary.refundedOrders },
            { label: "Returning Customers", value: orderSummary.returningCustomers }
          ].map((metric) => (
            <div key={metric.label} style={{ padding: "20px", borderRadius: "20px", background: theme.cardBg, border: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: "0.95rem", color: theme.muted, marginBottom: "10px" }}>{metric.label}</div>
              <div style={{ fontSize: "1.7rem", fontWeight: 700, color: theme.text }}>{metric.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: "grid", gap: "18px", marginBottom: "22px" }}>
        <div style={{ display: "grid", gap: "14px", gridTemplateColumns: "1.5fr 0.9fr", alignItems: "start" }}>
          <div style={{ padding: "22px", borderRadius: "20px", background: theme.cardBg, border: `1px solid ${theme.border}`, minHeight: "320px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "18px" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Order Volume</h2>
                <p style={{ margin: "8px 0 0", color: theme.muted }}>Revenue and orders across the last 30 days.</p>
              </div>
              <button type="button" onClick={exportOrderTrendCsv} disabled={!Array.isArray(analytics.orderTrend) || analytics.orderTrend.length === 0} style={{ borderRadius: "14px", border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, padding: "10px 14px", cursor: "pointer", fontSize: "0.9rem" }}>
                Export CSV
              </button>
            </div>
            <div style={{ width: "100%", height: "260px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics.orderTrend || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={theme.border} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: theme.muted, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: theme.muted, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: theme.surface, color: theme.text, borderRadius: 14, border: `1px solid ${theme.border}` }} />
                  <Line type="monotone" dataKey="value" stroke={theme.accent} strokeWidth={3} dot={{ fill: theme.accent }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display: "grid", gap: "14px", alignContent: "start" }}>
            <div style={{ padding: "22px", borderRadius: "20px", background: theme.cardBg, border: `1px solid ${theme.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Top Customers</h2>
                <button type="button" onClick={exportTopCustomersCsv} disabled={!Array.isArray(analytics.topCustomers) || analytics.topCustomers.length === 0} style={{ borderRadius: "14px", border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, padding: "10px 14px", cursor: "pointer", fontSize: "0.9rem" }}>
                  Export CSV
                </button>
              </div>
              <div style={{ marginTop: "14px", display: "grid", gap: "12px" }}>
                {(analytics.topCustomers || []).slice(0, 4).map((customer, index) => (
                  <div key={customer.name || index} style={{ display: "flex", justifyContent: "space-between", gap: "14px", color: theme.text }}>
                    <span>{customer.name || customer.email || "Unknown"}</span>
                    <span style={{ color: theme.muted }}>{formatCurrency(customer.revenue, summary.currency || "USD")}</span>
                  </div>
                ))}
                {!(analytics.topCustomers || []).length ? <div style={{ color: theme.muted }}>No customer analytics available.</div> : null}
              </div>
            </div>

            <div style={{ padding: "22px", borderRadius: "20px", background: theme.cardBg, border: `1px solid ${theme.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Gateway Mix</h2>
                <button type="button" onClick={exportGatewayMixCsv} disabled={!Array.isArray(analytics.paymentGatewayDistribution) || analytics.paymentGatewayDistribution.length === 0} style={{ borderRadius: "14px", border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, padding: "10px 14px", cursor: "pointer", fontSize: "0.9rem" }}>
                  Export CSV
                </button>
              </div>
              <div style={{ width: "100%", height: "220px", marginTop: "14px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={analytics.paymentGatewayDistribution || []} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} fill={theme.accent} paddingAngle={4}>
                      {(analytics.paymentGatewayDistribution || []).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend verticalAlign="bottom" height={36} wrapperStyle={{ color: theme.text }} />
                    <Tooltip contentStyle={{ background: theme.surface, color: theme.text, borderRadius: 14, border: `1px solid ${theme.border}` }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: "22px", borderRadius: "20px", background: theme.cardBg, border: `1px solid ${theme.border}`, marginBottom: "24px" }}>
        <div style={{ display: "grid", gap: "18px", marginBottom: "14px" }}>
          <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ color: theme.muted, fontSize: "0.92rem" }}>Search</span>
              <input type="text" value={filters.search} onChange={(event) => onFilterChange("search", event.target.value)} placeholder="Order number, customer, transaction, coupon" style={{ width: "100%", padding: "12px 14px", borderRadius: "14px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ color: theme.muted, fontSize: "0.92rem" }}>Order Status</span>
              <select value={filters.orderStatus} onChange={(event) => onFilterChange("orderStatus", event.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: "14px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text }}>
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ color: theme.muted, fontSize: "0.92rem" }}>Payment Status</span>
              <select value={filters.paymentStatus} onChange={(event) => onFilterChange("paymentStatus", event.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: "14px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text }}>
                <option value="">All</option>
                {PAYMENT_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ color: theme.muted, fontSize: "0.92rem" }}>Refund Status</span>
              <select value={filters.refundStatus} onChange={(event) => onFilterChange("refundStatus", event.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: "14px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text }}>
                <option value="">All</option>
                {REFUND_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}
              </select>
            </label>
          </div>

          <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ color: theme.muted, fontSize: "0.92rem" }}>Gateway</span>
              <select value={filters.paymentGateway} onChange={(event) => onFilterChange("paymentGateway", event.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: "14px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text }}>
                <option value="">All gateways</option>
                {PAYMENT_GATEWAYS.map((gateway) => <option key={gateway} value={gateway}>{gateway}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ color: theme.muted, fontSize: "0.92rem" }}>Order Type</span>
              <select value={filters.orderType} onChange={(event) => onFilterChange("orderType", event.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: "14px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text }}>
                <option value="">All types</option>
                {ORDER_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ color: theme.muted, fontSize: "0.92rem" }}>From Date</span>
              <input type="date" value={filters.dateFrom} onChange={(event) => onFilterChange("dateFrom", event.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: "14px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ color: theme.muted, fontSize: "0.92rem" }}>To Date</span>
              <input type="date" value={filters.dateTo} onChange={(event) => onFilterChange("dateTo", event.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: "14px", border: `1px solid ${theme.border}`, background: theme.surfaceAlt, color: theme.text }} />
            </label>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" onClick={selectAll} style={{ minWidth: "120px", background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "14px", color: theme.text, padding: "10px 14px", cursor: "pointer" }}>
              Select Page
            </button>
            <button type="button" onClick={clearSelection} style={{ minWidth: "120px", background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "14px", color: theme.text, padding: "10px 14px", cursor: "pointer" }}>
              Clear Selection
            </button>
            <span style={{ color: theme.muted }}>{selectedOrders.size} order(s) selected</span>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {ACTIONS.map((action) => (
              <button key={action.key} type="button" onClick={() => performBulkAction(action.key)} disabled={selectedOrders.size === 0 || loading} style={{ background: theme.accent, color: theme.buttonText, border: "none", borderRadius: "14px", padding: "10px 14px", cursor: selectedOrders.size === 0 ? "not-allowed" : "pointer" }}>
                {action.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: "auto", border: `1px solid ${theme.border}`, borderRadius: "18px", background: theme.surface }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1320px" }}>
            <thead>
              <tr style={{ background: theme.headerBg, color: theme.text, textAlign: "left" }}>
                <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}> <input type="checkbox" checked={selectedOrders.size > 0 && selectedOrders.size === orders.length} onChange={(event) => event.target.checked ? selectAll() : clearSelection()} /></th>
                <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Order #</th>
                <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Invoice</th>
                <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Customer</th>
                <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Type</th>
                <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Items</th>
                <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Total</th>
                <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Payment</th>
                <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Order Status</th>
                <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Refund</th>
                <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Downloads</th>
                <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan="12" style={{ padding: "24px", color: theme.muted }}>No orders found for the selected filters.</td></tr>
              ) : orders.map((order) => (
                <tr key={order.id} style={{ background: theme.rowBg, color: theme.text }}>
                  <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>
                    <input type="checkbox" checked={selectedOrders.has(order.id)} onChange={() => toggleOrderSelection(order.id)} />
                  </td>
                  <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{order.order_number || "—"}</td>
                  <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{order.invoice_number || "—"}</td>
                  <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>
                    <div style={{ fontWeight: 600 }}>{order.customer_username || "—"}</div>
                    <div style={{ color: theme.muted, fontSize: "0.88rem" }}>{order.customer_email || "—"}</div>
                  </td>
                  <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{order.order_type || "—"}</td>
                  <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{order.assets_count ?? 0}</td>
                  <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{formatCurrency(order.total_amount, order.currency)}</td>
                  <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{order.payment_gateway || "—"}</td>
                  <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{renderStatusBadge(order.order_status)}</td>
                  <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{renderStatusBadge(order.refund_status)}</td>
                  <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{renderStatusBadge(order.download_status)}</td>
                  <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>
                    <button type="button" onClick={() => openDetails(order.id)} style={{ border: "none", borderRadius: "12px", background: theme.accent, color: theme.buttonText, padding: "8px 12px", cursor: "pointer" }}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination currentPage={page} totalPages={totalPages} totalImages={total} setCurrentPage={setPage} darkMode={isDarkMode} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap", marginTop: "16px" }}>
          <button type="button" onClick={beginReset} disabled={loading || resetCountdown > 0} style={{ borderRadius: "16px", border: `1px solid ${theme.error}`, background: theme.surface, color: theme.error, padding: "12px 18px", cursor: loading || resetCountdown > 0 ? "not-allowed" : "pointer" }}>
            Reset Stats
          </button>
          {resetCountdown > 0 ? (
            <>
              <span style={{ color: theme.error }}>Resetting in {resetCountdown}s</span>
              <button type="button" onClick={cancelReset} style={{ borderRadius: "12px", border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, padding: "8px 12px", cursor: "pointer" }}>
                Cancel
              </button>
            </>
          ) : null}
        </div>
      </section>

      {showDetails && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(15, 23, 42, 0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ width: "100%", maxWidth: "1120px", maxHeight: "90vh", overflowY: "auto", background: theme.surface, color: theme.text, borderRadius: "24px", boxShadow: "0 24px 60px rgba(15, 23, 42, 0.35)", padding: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", marginBottom: "18px" }}>
              <div>
                <h2 style={{ margin: 0 }}>Order Details</h2>
                <p style={{ margin: "8px 0 0", color: theme.muted }}>Comprehensive order lifecycle and customer history.</p>
              </div>
              <button type="button" onClick={closeDetails} style={{ background: theme.surfaceAlt, border: `1px solid ${theme.border}`, color: theme.text, borderRadius: "12px", padding: "10px 14px", cursor: "pointer" }}>
                Close
              </button>
            </div>
            {detailsLoading ? (
              <p style={{ color: theme.muted }}>Loading order details…</p>
            ) : details ? (
              <div style={{ display: "grid", gap: "24px" }}>
                <section style={{ display: "grid", gap: "16px", gridTemplateColumns: "1fr 1fr" }}>
                  <div style={{ padding: "20px", borderRadius: "20px", background: theme.surfaceAlt, border: `1px solid ${theme.border}` }}>
                    <h3 style={{ margin: "0 0 12px" }}>Customer</h3>
                    <div><strong>Name:</strong> {details.order.customer_full_name || "-"}</div>
                    <div><strong>Username:</strong> {details.order.customer_username || "-"}</div>
                    <div><strong>Email:</strong> {details.order.customer_email || "-"}</div>
                    <div><strong>Phone:</strong> {details.order.customer_phone || "-"}</div>
                    <div><strong>Country:</strong> {details.order.customer_country || "-"}</div>
                    <div><strong>Registered:</strong> {toDateString(details.order.customer_registered_at)}</div>
                  </div>
                  <div style={{ padding: "20px", borderRadius: "20px", background: theme.surfaceAlt, border: `1px solid ${theme.border}` }}>
                    <h3 style={{ margin: "0 0 12px" }}>Purchase</h3>
                    <div><strong>Order #:</strong> {details.order.order_number || "-"}</div>
                    <div><strong>Invoice #:</strong> {details.order.invoice_number || "-"}</div>
                    <div><strong>Created:</strong> {toDateTimeString(details.order.created_at)}</div>
                    <div><strong>Order Type:</strong> {details.order.order_type || "-"}</div>
                    <div><strong>Currency:</strong> {details.order.currency || "USD"}</div>
                    <div><strong>Subtotal:</strong> {formatCurrency(details.order.subtotal, details.order.currency)}</div>
                    <div><strong>Discount:</strong> {formatCurrency(details.order.discount, details.order.currency)}</div>
                    <div><strong>Tax:</strong> {formatCurrency(details.order.tax, details.order.currency)}</div>
                    <div><strong>Grand Total:</strong> {formatCurrency(details.order.total_amount, details.order.currency)}</div>
                  </div>
                </section>

                <section style={{ display: "grid", gap: "16px" }}>
                  <div style={{ padding: "20px", borderRadius: "20px", background: theme.surfaceAlt, border: `1px solid ${theme.border}` }}>
                    <h3 style={{ margin: "0 0 12px" }}>Assets</h3>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: theme.headerBg, color: theme.text }}>
                            <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Asset</th>
                            <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Contributor</th>
                            <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Category</th>
                            <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Price</th>
                            <th style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.border}` }}>Earnings</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(details.items || []).map((item) => (
                            <tr key={item.id || `${item.asset_id}-${item.title}`}>
                              <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{item.title || item.asset_id || "-"}</td>
                              <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{item.contributor_username || "-"}</td>
                              <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{item.category || "-"}</td>
                              <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{formatCurrency(item.total_price, details.order.currency)}</td>
                              <td style={{ padding: "12px 14px", borderBottom: `1px solid ${theme.rowBorder}` }}>{formatCurrency(item.contributor_earnings, details.order.currency)}</td>
                            </tr>
                          ))}
                          {(details.items || []).length === 0 ? (
                            <tr><td colSpan="5" style={{ padding: "14px", color: theme.muted }}>No asset details available.</td></tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

                <section style={{ display: "grid", gap: "18px", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                  <div style={{ padding: "20px", borderRadius: "20px", background: theme.surfaceAlt, border: `1px solid ${theme.border}` }}>
                    <h3 style={{ margin: "0 0 12px" }}>Payment</h3>
                    <div><strong>Gateway:</strong> {details.order.payment_gateway || "-"}</div>
                    <div><strong>Method:</strong> {details.order.payment_method || "-"}</div>
                    <div><strong>UPI ID:</strong> {details.order.payer_upi_id || "-"}</div>
                    <div><strong>Transaction ID:</strong> {details.order.transaction_id || details.payments?.[0]?.transaction_id || "-"}</div>
                    <div><strong>Status:</strong> {details.order.payment_status || "-"}</div>
                  </div>
                  <div style={{ padding: "20px", borderRadius: "20px", background: theme.surfaceAlt, border: `1px solid ${theme.border}` }}>
                    <h3 style={{ margin: "0 0 12px" }}>Fulfillment</h3>
                    <div><strong>Download Status:</strong> {details.order.download_status || "-"}</div>
                    <div><strong>Refund Status:</strong> {details.order.refund_status || "-"}</div>
                    <div><strong>Support Status:</strong> {details.order.support_status || "-"}</div>
                  </div>
                </section>

                <section style={{ display: "grid", gap: "18px" }}>
                  <div style={{ padding: "20px", borderRadius: "20px", background: theme.surfaceAlt, border: `1px solid ${theme.border}` }}>
                    <h3 style={{ margin: "0 0 12px" }}>Timeline</h3>
                    {details.activity?.length > 0 ? details.activity.map((activity) => (
                      <div key={activity.id || `${activity.event}-${activity.created_at}`} style={{ marginBottom: "10px", paddingBottom: "10px", borderBottom: `1px solid ${theme.border}` }}>
                        <div style={{ color: theme.muted, fontSize: "0.9rem" }}>{toDateTimeString(activity.created_at)}</div>
                        <div style={{ fontWeight: 600 }}>{activity.event || "Event"}</div>
                        <div style={{ color: theme.muted, marginTop: "4px" }}>{formatActivityDetails(activity.details)}</div>
                      </div>
                    )) : <div style={{ color: theme.muted }}>No timeline activity available.</div>}
                  </div>

                  <div style={{ padding: "20px", borderRadius: "20px", background: theme.surfaceAlt, border: `1px solid ${theme.border}` }}>
                    <h3 style={{ margin: "0 0 12px" }}>Administrative Notes</h3>
                    {details.notes?.length > 0 ? details.notes.map((note) => (
                      <div key={note.id || `${note.author_id}-${note.created_at}`} style={{ marginBottom: "12px", padding: "14px", borderRadius: "16px", background: theme.surface, border: `1px solid ${theme.border}` }}>
                        <div style={{ color: theme.muted, fontSize: "0.9rem", marginBottom: "6px" }}>By {note.author_username || "Admin"} · {toDateTimeString(note.created_at)}</div>
                        <div>{note.note}</div>
                      </div>
                    )) : <div style={{ color: theme.muted }}>No internal notes yet.</div>}
                  </div>
                </section>
              </div>
            ) : (
              <p style={{ color: theme.muted }}>No details available.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
