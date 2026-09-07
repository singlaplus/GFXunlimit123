import { useEffect, useState } from "react";
import axios from "axios";
import { getEffectiveAuthToken } from "../utils/authSession";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";

const getIsDarkMode = () => typeof document !== "undefined" && document.body.classList.contains("dark-mode");

const LIGHT_THEME = {
  pageBg: "#f8fafc",
  surface: "#ffffff",
  surfaceAlt: "#f1f5f9",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  accent: "#ed2224",
  cardBg: "#ffffff",
  button: "#ed2224",
  buttonText: "#ffffff",
  chartStroke: "#1f2937"
};

const DARK_THEME = {
  pageBg: "#0f172a",
  surface: "#111827",
  surfaceAlt: "#1f2937",
  border: "#374151",
  text: "#f8fafc",
  muted: "#94a3b8",
  accent: "#ed2224",
  cardBg: "#1f1f1f",
  button: "#ed2224",
  buttonText: "#ffffff",
  chartStroke: "#f8fafc"
};

const STAT_CARDS = [
  { key: "total_orders", label: "Total Orders" },
  { key: "today_orders", label: "Today's Orders" },
  { key: "monthly_orders", label: "Monthly Orders" },
  { key: "total_revenue", label: "Total Revenue" },
  { key: "pending_orders", label: "Pending Orders" },
  { key: "completed_orders", label: "Completed Orders" },
  { key: "refunded_orders", label: "Refunded Orders" },
  { key: "returning_customers", label: "Returning Customers" }
];

const RECENT_ORDER_ACTIONS = [
  { key: "completed", label: "Mark Completed", payload: { status: "completed" } },
  { key: "cancelled", label: "Cancel", payload: { status: "cancelled" } },
  { key: "refund_requested", label: "Request Refund", payload: { refundStatus: "refund_requested" } }
];

const formatCurrency = (value, currency) => {
  const amount = Number(value || 0);
  return `${currency || "USD"} ${amount.toFixed(2)}`;
};

const MENU_ENTRIES = [
  { label: "Orders", path: "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/orders" },
  { label: "Payments", path: "/payments" },
  { label: "Refunds", path: "/admin/refunds" },
  { label: "Invoices", path: "/admin/invoices" },
  { label: "Coupons", path: "/admin/coupons" },
  { label: "Taxes", path: "/admin/taxes" },
  { label: "Customer Credits", path: "/admin/customer-credits" },
  { label: "Gift Cards", path: "/admin/gift-cards" },
  { label: "Subscriptions", path: "/admin/subscriptions" },
  { label: "Fraud Detection", path: "/admin/fraud" },
  { label: "Revenue Reports", path: "/admin/revenue-reports" },
  { label: "Sales Analytics", path: "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/analytics" },
  { label: "Settings", path: "/admin/settings" }
];

const COLORS = ["#ed2224", "#1976d2", "#43a047", "#f59e0b", "#8b5cf6", "#0ea5e9", "#f97316"];

export default function AdminCommercePage() {
  const [summary, setSummary] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [recentOrders, setRecentOrders] = useState([]);
  const [payoutRequests, setPayoutRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(getIsDarkMode);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const syncTheme = () => setIsDarkMode(getIsDarkMode());
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    syncTheme();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError("");
        const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
        const [summaryRes, analyticsRes, recentOrdersRes, payoutRequestsRes] = await Promise.all([
          axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/orders/summary`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          }),
          axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/orders/analytics`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          }),
          axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/orders/recent`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          }),
          axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/payout-requests`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          })
        ]);
        setSummary(summaryRes.data || {});
        setAnalytics(analyticsRes.data || {});
        setRecentOrders(recentOrdersRes.data || []);
        setPayoutRequests(payoutRequestsRes.data || []);
      } catch (err) {
        console.error(err);
        setError("Unable to load commerce analytics.");
        setSummary({});
        setAnalytics({});
        setRecentOrders([]);
        setPayoutRequests([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleOrderAction = async (orderId, payload) => {
    try {
      setActionLoading(true);
      setError("");
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const response = await axios.put(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/orders/${orderId}/status`,
        payload,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        }
      );
      const updatedOrder = response.data;
      setRecentOrders((previous) => previous.map((order) => (order.id === updatedOrder.id ? { ...order, ...updatedOrder } : order)));
    } catch (err) {
      console.error(err);
      setError("Unable to update order status.");
    } finally {
      setActionLoading(false);
    }
  };

  const handlePayoutStatus = async (requestId, status) => {
    try {
      setActionLoading(true);
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const response = await axios.put(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/payout-requests/${requestId}/status`, { status }, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      setPayoutRequests((previous) => previous.map((request) => request.id === requestId ? { ...request, ...response.data } : request));
    } catch (err) {
      setError("Unable to update payout request status.");
    } finally {
      setActionLoading(false);
    }
  };

  const theme = isDarkMode ? DARK_THEME : LIGHT_THEME;

  return (
    <div style={{ minHeight: "100vh", padding: "24px", background: theme.pageBg, color: theme.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "18px", marginBottom: "22px" }}>
        <div style={{ maxWidth: "720px" }}>
          <h1 style={{ margin: 0, fontSize: "2rem", letterSpacing: "-0.02em" }}>Commerce</h1>
          <p style={{ margin: "10px 0 0", color: theme.muted, maxWidth: "680px", lineHeight: 1.7 }}>
            Monitor purchase performance, revenue trends, refunds and customer behavior from a single enterprise-grade commerce command center.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => window.location.href = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/orders"}
            style={{ background: theme.button, color: theme.buttonText, border: "none", borderRadius: "14px", padding: "12px 18px", cursor: "pointer", minWidth: "140px" }}
          >
            View Orders
          </button>
          <button
            type="button"
            onClick={() => window.location.href = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/analytics"}
            style={{ background: "transparent", color: theme.text, border: `1px solid ${theme.border}`, borderRadius: "14px", padding: "12px 18px", cursor: "pointer", minWidth: "140px" }}
          >
            View Analytics
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: "18px", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginBottom: "24px" }}>
        {STAT_CARDS.map((metric) => (
          <div key={metric.key} style={{ padding: "22px", borderRadius: "20px", background: theme.cardBg, border: `1px solid ${theme.border}`, minHeight: "120px" }}>
            <span style={{ display: "block", color: theme.muted, fontSize: "0.92rem", marginBottom: "10px" }}>{metric.label}</span>
            <span style={{ display: "block", fontSize: "1.9rem", fontWeight: 700, color: theme.text }}>
              {metric.key.startsWith("total_") || metric.key.endsWith("orders") || metric.key.endsWith("customers")
                ? Number(summary?.[metric.key] || 0).toLocaleString()
                : Number(summary?.[metric.key] || 0).toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: "18px", gridTemplateColumns: "3fr 2fr", marginBottom: "24px" }}>
        <div style={{ borderRadius: "20px", background: theme.cardBg, border: `1px solid ${theme.border}`, padding: "22px", minHeight: "360px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "20px" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.2rem" }}>Revenue Trend</h2>
              <p style={{ margin: "8px 0 0", color: theme.muted, fontSize: "0.94rem" }}>Daily revenue over the past 30 days.</p>
            </div>
          </div>
          <div style={{ height: "280px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics?.revenueTrend || []} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={theme.border} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: theme.muted, fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: theme.muted, fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: theme.surfaceAlt, borderRadius: 16, border: `1px solid ${theme.border}`, color: theme.text }} />
                <Line type="monotone" dataKey="value" stroke={theme.accent} strokeWidth={3} dot={{ r: 3, fill: theme.accent }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ display: "grid", gap: "18px" }}>
          <div style={{ borderRadius: "20px", background: theme.cardBg, border: `1px solid ${theme.border}`, padding: "22px" }}>
            <h2 style={{ margin: 0, fontSize: "1.2rem" }}>Top Categories</h2>
            <div style={{ height: "240px", marginTop: "16px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics?.salesByCategory || []} margin={{ top: 10, right: 0, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={theme.border} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: theme.muted, fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: theme.muted, fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: theme.surfaceAlt, borderRadius: 16, border: `1px solid ${theme.border}`, color: theme.text }} />
                  <Bar dataKey="value" fill={theme.accent} radius={[12, 12, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ borderRadius: "20px", background: theme.cardBg, border: `1px solid ${theme.border}`, padding: "22px" }}>
            <h2 style={{ margin: 0, fontSize: "1.2rem" }}>Payment Gateways</h2>
            <div style={{ display: "grid", gap: "14px", marginTop: "18px" }}>
              {(analytics?.paymentGatewayDistribution || []).map((entry, index) => (
                <div key={entry.name || index} style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                  <span style={{ color: theme.text }}>{entry.name || "Unknown"}</span>
                  <span style={{ color: theme.muted }}>{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderRadius: "20px", background: theme.cardBg, border: `1px solid ${theme.border}`, padding: "22px", marginBottom: "24px" }}>
        <h2 style={{ margin: "0 0 14px", fontSize: "1.2rem" }}>Commerce Control</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px" }}>
          {MENU_ENTRIES.map((entry) => (
            <button
              key={entry.label}
              type="button"
              onClick={() => { window.location.href = entry.path; }}
              style={{
                padding: "16px 18px",
                background: isDarkMode ? "#111827" : "#f8fafc",
                borderRadius: "16px",
                border: `1px solid ${theme.border}`,
                color: theme.text,
                cursor: "pointer",
                textAlign: "left",
                fontWeight: 600
              }}
            >
              {entry.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => document.getElementById("requested-earnings")?.scrollIntoView({ behavior: "smooth" })}
            style={{ padding: "16px 18px", background: theme.accent, borderRadius: "16px", border: `1px solid ${theme.accent}`, color: "#ffffff", cursor: "pointer", textAlign: "left", fontWeight: 700 }}
          >
            Requested Earnings{payoutRequests.length ? ` (${payoutRequests.length})` : ""}
          </button>
        </div>
      </div>

      <div id="requested-earnings" style={{ borderRadius: "20px", background: theme.cardBg, border: `1px solid ${theme.border}`, padding: "22px", marginBottom: "24px" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: "1.2rem" }}>Requested Earnings</h2>
        <p style={{ margin: "0 0 18px", color: theme.muted }}>Review contributor payout details, cancelled-check uploads, and payment progress.</p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1100px" }}>
            <thead><tr style={{ textAlign: "left", borderBottom: `1px solid ${theme.border}` }}><th style={{ padding: "12px" }}>Contributor</th><th style={{ padding: "12px" }}>Credits / Amount</th><th style={{ padding: "12px" }}>Contact</th><th style={{ padding: "12px" }}>Check</th><th style={{ padding: "12px" }}>Progress</th><th style={{ padding: "12px" }}>Actions</th></tr></thead>
            <tbody>{payoutRequests.length === 0 ? <tr><td colSpan="6" style={{ padding: "18px 12px", color: theme.muted }}>No requested earnings yet.</td></tr> : payoutRequests.map((request) => <tr key={request.id} style={{ borderBottom: `1px solid ${theme.border}` }}><td style={{ padding: "12px" }}>{request.username || request.account_email}</td><td style={{ padding: "12px" }}>{request.requested_credits} / ₹{Number(request.requested_credits).toFixed(2)}</td><td style={{ padding: "12px", color: theme.muted }}>{request.email}<br />{request.phone}<br />{request.whatsapp}</td><td style={{ padding: "12px" }}><a href={`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/api/files/${request.cancelled_check_path}`} target="_blank" rel="noreferrer" style={{ color: theme.accent }}>View upload</a></td><td style={{ padding: "12px" }}>{request.status === "payment_done" ? "Payment done" : request.status.charAt(0).toUpperCase() + request.status.slice(1)}</td><td style={{ padding: "12px", display: "flex", gap: "6px", flexWrap: "wrap" }}>{["reviewed", "approved", "rejected", "payment_done"].map((status) => <button key={status} type="button" disabled={actionLoading} onClick={() => handlePayoutStatus(request.id, status)} style={{ border: "none", borderRadius: "8px", padding: "7px 9px", background: status === "rejected" ? "#dc2626" : theme.button, color: "#fff", cursor: "pointer", fontSize: "11px" }}>{status === "payment_done" ? "Payment done" : status.charAt(0).toUpperCase() + status.slice(1)}</button>)}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div style={{ borderRadius: "20px", background: theme.cardBg, border: `1px solid ${theme.border}`, padding: "22px", marginBottom: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginBottom: "18px", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.2rem" }}>Recent Orders</h2>
            <p style={{ margin: "8px 0 0", color: theme.muted, fontSize: "0.95rem" }}>Latest orders with quick admin actions and direct navigation.</p>
          </div>
          <button
            type="button"
            onClick={() => window.location.href = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/orders"}
            style={{ background: theme.button, color: theme.buttonText, border: "none", borderRadius: "14px", padding: "12px 18px", cursor: "pointer" }}
          >
            Manage All Orders
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: `1px solid ${theme.border}` }}>
                <th style={{ padding: "14px 12px", color: theme.muted, fontSize: "0.92rem" }}>Order</th>
                <th style={{ padding: "14px 12px", color: theme.muted, fontSize: "0.92rem" }}>Customer</th>
                <th style={{ padding: "14px 12px", color: theme.muted, fontSize: "0.92rem" }}>Status</th>
                <th style={{ padding: "14px 12px", color: theme.muted, fontSize: "0.92rem" }}>Revenue</th>
                <th style={{ padding: "14px 12px", color: theme.muted, fontSize: "0.92rem" }}>Date</th>
                <th style={{ padding: "14px 12px", color: theme.muted, fontSize: "0.92rem" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ padding: "18px 12px", color: theme.muted }}>
                    No recent orders available.
                  </td>
                </tr>
              ) : recentOrders.map((order) => (
                <tr key={order.id} style={{ borderBottom: `1px solid ${theme.border}` }}>
                  <td style={{ padding: "14px 12px", color: theme.text, fontWeight: 600 }}>
                    <button
                      type="button"
                      onClick={() => window.location.href = `/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/orders/${order.id}`}
                      style={{ background: "transparent", border: "none", color: theme.accent, cursor: "pointer", padding: 0, fontWeight: 600 }}
                    >
                      {order.order_number || `#${order.id}`} 
                    </button>
                  </td>
                  <td style={{ padding: "14px 12px", color: theme.muted }}>{order.customer_name || order.customer_email || "Unknown"}</td>
                  <td style={{ padding: "14px 12px", color: theme.text }}>{order.order_status || order.status || "Pending"}</td>
                  <td style={{ padding: "14px 12px", color: theme.text }}>{formatCurrency(order.total_amount, order.currency)}</td>
                  <td style={{ padding: "14px 12px", color: theme.muted }}>{new Date(order.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: "14px 12px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {RECENT_ORDER_ACTIONS.map((action) => (
                      <button
                        key={action.key}
                        type="button"
                        onClick={() => handleOrderAction(order.id, action.payload)}
                        disabled={actionLoading}
                        style={{
                          background: action.key === "cancelled" ? "#ef4444" : theme.button,
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "12px",
                          padding: "8px 10px",
                          cursor: actionLoading ? "not-allowed" : "pointer",
                          fontSize: "0.82rem"
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error ? (
        <div style={{ padding: "18px", borderRadius: "18px", background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" }}>{error}</div>
      ) : null}

      {loading && (
        <div style={{ padding: "18px", borderRadius: "18px", background: theme.surface, border: `1px solid ${theme.border}`, color: theme.muted }}>Loading Commerce insights…</div>
      )}
    </div>
  );
}
