import { useEffect, useState } from "react";
import axios from "axios";
import Pagination from "../components/Pagination";

function formatCurrency(value, currency = "USD") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${currency} ${Number(value).toFixed(2)}`;
}

function formatDetailedDate(dateString) {
  if (!dateString) return "—";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDetailedTime(dateString) {
  if (!dateString) return "—";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OrderHistoryPage({ darkMode = false }) {
  const isDarkMode = Boolean(darkMode);
  const [orders, setOrders] = useState([]);
  const [isContributor, setIsContributor] = useState(false);
  const [orderDetail, setOrderDetail] = useState(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryPaymentOrder, setRetryPaymentOrder] = useState(null);
  const [retryPaymentUtr, setRetryPaymentUtr] = useState("");
  const [retryPaymentError, setRetryPaymentError] = useState("");
  const [retryPaymentSubmitting, setRetryPaymentSubmitting] = useState(false);
  const [retryPaymentPreparing, setRetryPaymentPreparing] = useState(false);
  const [retryPaymentCredits, setRetryPaymentCredits] = useState(null);
  const [retryPaymentSuccess, setRetryPaymentSuccess] = useState("");

  const pathname = typeof window !== "undefined" ? window.location.pathname : "/orders";
  const orderIdMatch = pathname.match(/^\/orders\/(\d+)/);
  const selectedOrderId = orderIdMatch ? Number(orderIdMatch[1]) : null;

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

  useEffect(() => {
    if (!token) {
      setError("You must be logged in to view your orders.");
      setLoading(false);
      return;
    }

    if (selectedOrderId) {
      setDetailLoading(true);
      axios
        .get(`${apiBaseUrl}/orders/${selectedOrderId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        .then((res) => {
          setOrderDetail(res.data || null);
          setError(null);
        })
        .catch((err) => {
          console.error("Failed to load order detail", err);
          setError(err.response?.data?.error || "Failed to load order details.");
          setOrderDetail(null);
        })
        .finally(() => setDetailLoading(false));
    } else {
      setLoading(true);
      axios
        .get(`${apiBaseUrl}/orders?page=${page}&limit=${limit}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        .then((res) => {
          setOrders(res.data?.orders || []);
          setTotal(res.data?.total || 0);
          setIsContributor(Boolean(res.data?.is_contributor));
          setError(null);
        })
        .catch((err) => {
          console.error("Failed to load orders", err);
          setError(err.response?.data?.error || "Failed to load orders.");
          setOrders([]);
          setTotal(0);
          setIsContributor(false);
        })
        .finally(() => setLoading(false));
    }
  }, [selectedOrderId, page, limit, token, apiBaseUrl]);

  const goToOrder = (id) => {
    window.location.href = `/orders/${id}`;
  };

  const goBackToList = () => {
    window.location.href = "/orders";
  };

  const openPaymentRetry = async (order) => {
    setRetryPaymentOrder(order);
    setRetryPaymentUtr("");
    setRetryPaymentError("");
    setRetryPaymentSuccess("");
    setRetryPaymentCredits(null);
    setRetryPaymentPreparing(true);

    try {
      const token = localStorage.getItem("token");
      const [settingsResult, profileResult] = await Promise.allSettled([
        axios.get(`${apiBaseUrl}/payment-settings`),
        axios.get(`${apiBaseUrl}/profile`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }),
      ]);
      if (profileResult.status === "rejected") {
        throw profileResult.reason;
      }

      const paymentSettings = settingsResult.status === "fulfilled" ? settingsResult.value.data : {};
      const googlePayId = String(paymentSettings?.googlePayId || "").trim();
      const enabledGateways = Array.isArray(paymentSettings?.enabledGateways)
        ? paymentSettings.enabledGateways
        : [];
      const googlePayEnabled = enabledGateways.some(
        (gateway) => String(gateway).trim().toLowerCase() === "google pay"
      );
      const availableCredits = Math.max(0, Number(profileResult.value.data?.credits || 0));
      const creditsRequired = Math.ceil(Number(order.total_amount || 0));
      setRetryPaymentCredits({ available: availableCredits, required: creditsRequired });

      if (googlePayEnabled && googlePayId) {
        const paymentReference = order.order_number || `Order ${order.id}`;
        const paymentUri = `upi://pay?pa=${encodeURIComponent(googlePayId)}&pn=${encodeURIComponent("GFXunlimit")}&am=${encodeURIComponent(Number(order.total_amount).toFixed(2))}&cu=${encodeURIComponent(String(order.currency || "INR").toUpperCase())}&tn=${encodeURIComponent(paymentReference)}`;
        setRetryPaymentOrder({ ...order, googlePayId, paymentUri });
      } else if (availableCredits < creditsRequired) {
        setRetryPaymentError(
          settingsResult.status === "rejected"
            ? settingsResult.reason.response?.data?.error || "Unable to load payment options. Please try again."
            : `Google Pay is not configured, and this order needs ${creditsRequired} credits. Your current balance is ${availableCredits}.`
        );
      }
    } catch (requestError) {
      console.error("Failed to prepare payment retry", requestError);
      setRetryPaymentError(requestError.response?.data?.error || "Unable to prepare payment retry. Please try again.");
    } finally {
      setRetryPaymentPreparing(false);
    }
  };

  const submitCreditRetry = async () => {
    if (!retryPaymentOrder) return;
    setRetryPaymentSubmitting(true);
    setRetryPaymentError("");
    try {
      const token = localStorage.getItem("token");
      const response = await axios.post(
        `${apiBaseUrl}/checkout/retry-with-credits`,
        { orderId: retryPaymentOrder.id },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      setOrders((currentOrders) => currentOrders.map((order) => (
        order.id === retryPaymentOrder.id
          ? { ...order, payment_status: "paid", order_status: "completed" }
          : order
      )));
      setRetryPaymentOrder(null);
      setRetryPaymentCredits(null);
      setRetryPaymentSuccess(response.data?.message || "Payment completed with GFX Credits.");
    } catch (requestError) {
      console.error("Credit payment retry failed", requestError);
      setRetryPaymentError(requestError.response?.data?.error || "Credit payment failed. Please try again.");
    } finally {
      setRetryPaymentSubmitting(false);
    }
  };

  const submitPaymentRetry = async () => {
    const utr = retryPaymentUtr.trim();
    if (!retryPaymentOrder) return;
    if (!utr) {
      setRetryPaymentError("Enter UTR / Transaction ID.");
      return;
    }
    if (!/^\d{7,64}$/.test(utr)) {
      setRetryPaymentError("Enter UTR / Transaction ID.");
      return;
    }

    setRetryPaymentSubmitting(true);
    setRetryPaymentError("");
    try {
      const token = localStorage.getItem("token");
      const response = await axios.post(
        `${apiBaseUrl}/checkout/submit-google-pay-payment`,
        { orderId: retryPaymentOrder.id, utr },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      setOrders((currentOrders) => currentOrders.map((order) => (
        order.id === retryPaymentOrder.id
          ? { ...order, payment_status: "paid", order_status: "completed", download_status: "available", payment_submitted: true }
          : order
      )));
      setRetryPaymentOrder(null);
      setRetryPaymentUtr("");
      setRetryPaymentError("");
      setRetryPaymentSuccess(response.data?.message || "Payment details submitted. Your order is complete and downloads are available.");
    } catch (requestError) {
      console.error("Payment retry failed", requestError);
      setRetryPaymentError(requestError.response?.data?.error || "Payment retry failed. Please try again.");
    } finally {
      setRetryPaymentSubmitting(false);
    }
  };

  const rowsToShow = orders.length > 0 ? orders : [];

  if (error && !selectedOrderId) {
    return (
      <div style={{ padding: "24px" }}>
        <h2>Order History</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px" }}>
      <h2 style={{ marginBottom: "16px" }}>Order History</h2>
      {selectedOrderId ? (
        <div>
          <button
            type="button"
            onClick={goBackToList}
            style={{
              marginBottom: "18px",
              padding: "10px 14px",
              borderRadius: "999px",
              border: isDarkMode ? "1px solid rgba(148,163,184,0.35)" : "1px solid #ccc",
              background: isDarkMode ? "#111827" : "white",
              color: isDarkMode ? "#f8fafc" : "#111827",
              cursor: "pointer",
            }}
          >
            ← Back to orders
          </button>
          {detailLoading ? (
            <p>Loading order details...</p>
          ) : error ? (
            <p>{error}</p>
          ) : orderDetail ? (
            <div style={{ display: "grid", gap: "20px" }}>
              <section style={{ padding: "20px", border: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd", borderRadius: "18px", background: isDarkMode ? "#1f2937" : "#fff", color: isDarkMode ? "#f5f5f5" : "#111827" }}>
                <h3>Order #{orderDetail.order.order_number}</h3>
                <p>
                  <strong>Invoice:</strong> {orderDetail.order.invoice_number || "—"}
                </p>
                <p>
                  <strong>Status:</strong> {orderDetail.order.order_status}
                </p>
                <p>
                  <strong>Payment status:</strong>{" "}
                  <span style={{
                    color: String(orderDetail.order.payment_status || "").toLowerCase() === "pending" ? "#dc2626" : "inherit",
                    fontWeight: String(orderDetail.order.payment_status || "").toLowerCase() === "pending" ? 700 : 400,
                  }}>
                    {String(orderDetail.order.payment_status || "").toLowerCase() === "pending" ? "Payment pending" : orderDetail.order.payment_status}
                  </span>
                </p>
                <p>
                  <strong>Refund status:</strong> {orderDetail.order.refund_status}
                </p>
                <p>
                  <strong>Created:</strong> {new Date(orderDetail.order.created_at).toLocaleString()}
                </p>
                <p>
                  <strong>Total:</strong> {formatCurrency(orderDetail.order.total_amount, orderDetail.order.currency)}
                </p>
                {orderDetail.order.admin_remarks && (
                  <div style={{ marginTop: "12px", padding: "12px 14px", borderRadius: "10px", background: isDarkMode ? "#422006" : "#fffbeb", color: isDarkMode ? "#fcd34d" : "#92400e" }}>
                    <strong>Remark from admin:</strong>
                    <div style={{ marginTop: "4px" }}>{orderDetail.order.admin_remarks}</div>
                  </div>
                )}
              </section>

              <section style={{ padding: "20px", border: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd", borderRadius: "18px", background: isDarkMode ? "#1f2937" : "#fff", color: isDarkMode ? "#f5f5f5" : "#111827" }}>
                <h4>Items</h4>
                {orderDetail.items.length === 0 ? (
                  <p>No items found.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #eee" }}>Name</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #eee" }}>Qty</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #eee" }}>Price</th>
                        <th style={{ textAlign: "left", padding: "10px", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #eee" }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderDetail.items.map((item) => (
                        <tr key={item.id} style={{ borderTop: isDarkMode ? "1px solid rgba(148,163,184,0.15)" : "1px solid #f2f2f2" }}>
                          <td style={{ padding: "10px" }}>{item.title || item.asset_id || "Item"}</td>
                          <td style={{ padding: "10px" }}>{item.quantity || 1}</td>
                          <td style={{ padding: "10px" }}>{formatCurrency(item.unit_price || item.price || 0, orderDetail.order.currency)}</td>
                          <td style={{ padding: "10px" }}>{formatCurrency(item.total_price || 0, orderDetail.order.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
              <section style={{ padding: "20px", border: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd", borderRadius: "18px", background: isDarkMode ? "#1f2937" : "#fff", color: isDarkMode ? "#f5f5f5" : "#111827" }}>
                <h4>Downloads</h4>
                {orderDetail.items.map((item) => {
                  const dl = (orderDetail.customerDownloads || []).find(d => Number(d.image_id) === Number(item.asset_id));
                  if (!dl) return null;
                  const expiresAt = dl.expires_at ? new Date(dl.expires_at) : null;
                  const now = new Date();
                  const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000))) : 0;
                  const disabled = !dl.is_active || daysLeft <= 0;
                  const handleDownload = async () => {
                    try {
                      console.log('Download button clicked for item:', item.title, 'asset_id:', item.asset_id);
                      console.log('Download record:', dl);
                      const tokenLocal = localStorage.getItem('token');
                      console.log('Auth token present:', !!tokenLocal);
                      const downloadUrl = `${apiBaseUrl}/customer-download/${dl.download_token}`;
                      console.log('Downloading from URL:', downloadUrl);
                      const res = await axios.get(downloadUrl, {
                        responseType: 'blob',
                        headers: tokenLocal ? { Authorization: `Bearer ${tokenLocal}` } : {}
                      });

                      console.log('Response received:', res.status, 'data size:', res.data?.size, 'headers:', res.headers);
                      if (!res || res.status !== 200 || !res.data) {
                        throw new Error('Download failed: no data');
                      }

                      const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
                      console.log('Blob created, size:', blob.size, 'type:', blob.type);
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      // Log all headers to debug
                      console.log('All response headers:', res.headers);
                      console.log('Response headers keys:', Object.keys(res.headers || {}));
                      
                      let finalFilename = '';
                      const headerKeys = res.headers ? Object.keys(res.headers) : [];
                      const cdKey = headerKeys.find(k => k.toLowerCase() === 'content-disposition');
                      const cd = cdKey ? res.headers[cdKey] : null;
                      if (cd) {
                        let m = cd.match(/filename\*=UTF-8''([^;\n]+)/i);
                        if (m) finalFilename = decodeURIComponent(m[1]);
                        if (!finalFilename) {
                          m = cd.match(/filename="([^"]+)"/i);
                          if (m) finalFilename = m[1];
                        }
                      }
                      const sanitize = (s) => (s || '').toString().trim().replace(/\s+/g, '_').replace(/[^a-z0-9._-]/gi, '_').slice(0, 200);
                      const originalFilename = dl.filename || '';
                      const originalBase = originalFilename.split('/').pop() || '';
                      const originalExtension = originalBase.includes('.') ? `.${originalBase.split('.').pop()}` : '';
                      const actualBase = originalExtension ? originalBase.slice(0, -originalExtension.length) : originalBase;
                      a.download = finalFilename || [
                        sanitize(item.title || item.asset_id || 'asset'),
                        sanitize(actualBase) || 'file',
                        sanitize(orderDetail.order.order_number) || 'order',
                      ].join('_') + originalExtension;
                      document.body.appendChild(a);
                      console.log('Anchor element appended, clicking now...');
                      a.click();
                      console.log('Anchor click completed');
                      a.remove();
                      window.URL.revokeObjectURL(url);
                      console.log('Download complete');
                    } catch (err) {
                      console.error('Download failed', err);
                      alert(err.response?.data?.error || 'Download failed');
                    }
                  };

                  return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #f2f2f2' }}>
                      <div>
                        <strong>{item.title || item.asset_id}</strong>
                        <div style={{ fontSize: '0.95rem', color: '#666' }}>{disabled ? 'Expired' : `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}</div>
                      </div>
                      <div>
                        <button onClick={handleDownload} disabled={disabled} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #1f6feb', background: disabled ? '#f5f5f5' : '#1f6feb', color: disabled ? '#999' : '#fff', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                          {disabled ? 'Download unavailable' : 'Download'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </section>

              {orderDetail.payments?.length > 0 && (
                <section style={{ padding: "20px", border: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd", borderRadius: "18px", background: isDarkMode ? "#1f2937" : "#fff", color: isDarkMode ? "#f5f5f5" : "#111827" }}>
                  <h4>Payments</h4>
                  <ul style={{ margin: 0, paddingLeft: "20px" }}>
                    {orderDetail.payments.map((payment) => (
                      <li key={payment.id}>
                        {new Date(payment.created_at).toLocaleString()} — {payment.payment_gateway || payment.method || "Payment"} — {formatCurrency(payment.amount, payment.currency)} — Transaction ID: {payment.transaction_id || "-"}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {orderDetail.refunds?.length > 0 && (
                <section style={{ padding: "20px", border: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd", borderRadius: "18px", background: isDarkMode ? "#1f2937" : "#fff", color: isDarkMode ? "#f5f5f5" : "#111827" }}>
                  <h4>Refunds</h4>
                  <ul style={{ margin: 0, paddingLeft: "20px" }}>
                    {orderDetail.refunds.map((refund) => (
                      <li key={refund.id}>
                        {new Date(refund.created_at).toLocaleString()} — {formatCurrency(refund.amount, refund.currency)} — {refund.status}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {orderDetail.customerHistory?.length > 0 && (
                <section style={{ padding: "20px", border: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd", borderRadius: "18px", background: isDarkMode ? "#1f2937" : "#fff", color: isDarkMode ? "#f5f5f5" : "#111827" }}>
                  <h4>Recent orders for this account</h4>
                  <ul style={{ margin: 0, paddingLeft: "20px" }}>
                    {orderDetail.customerHistory.map((order) => (
                      <li key={order.id}>
                        <button
                          type="button"
                          onClick={() => goToOrder(order.id)}
                          style={{ border: "none", background: "none", color: isDarkMode ? "#8ec5ff" : "#1f6feb", cursor: "pointer", padding: 0 }}
                        >
                          {order.order_number}
                        </button>{" "}
                        — {order.order_status} — {formatCurrency(order.total_amount, orderDetail.order.currency)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          ) : (
            <p>No order details available.</p>
          )}
        </div>
      ) : (
        <div>
          {loading ? (
            <p>Loading your orders...</p>
          ) : (
            <>
              <div
                style={{
                  overflowX: "auto",
                  border: isDarkMode ? "1px solid rgba(148,163,184,0.18)" : "1px solid #e2e8f0",
                  borderRadius: "18px",
                  background: isDarkMode ? "#111827" : "#ffffff",
                  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.04)",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse", borderSpacing: 0, minWidth: "920px" }}>
                  <thead>
                    <tr style={{ background: isDarkMode ? "rgba(15,23,42,0.92)" : "#0f172a" }}>
                      <th style={{ textAlign: "left", padding: "11px 14px", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: isDarkMode ? "#e2e8f0" : "#f8fafc", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.22)" : "1px solid rgba(148,163,184,0.18)" }}>Order date</th>
                      <th style={{ textAlign: "left", padding: "11px 14px", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: isDarkMode ? "#e2e8f0" : "#f8fafc", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.22)" : "1px solid rgba(148,163,184,0.18)" }}>Asset</th>
                      <th style={{ textAlign: "left", padding: "11px 14px", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: isDarkMode ? "#e2e8f0" : "#f8fafc", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.22)" : "1px solid rgba(148,163,184,0.18)" }}>Upload date</th>
                      <th style={{ textAlign: "left", padding: "11px 14px", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: isDarkMode ? "#e2e8f0" : "#f8fafc", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.22)" : "1px solid rgba(148,163,184,0.18)" }}>Order</th>
                      <th style={{ textAlign: "left", padding: "11px 14px", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: isDarkMode ? "#e2e8f0" : "#f8fafc", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.22)" : "1px solid rgba(148,163,184,0.18)" }}>Invoice</th>
                      <th style={{ textAlign: "right", padding: "11px 14px", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: isDarkMode ? "#e2e8f0" : "#f8fafc", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.22)" : "1px solid rgba(148,163,184,0.18)" }}>{isContributor ? "Contributor earning" : "Total"}</th>
                      <th style={{ textAlign: "left", padding: "11px 14px", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: isDarkMode ? "#e2e8f0" : "#f8fafc", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.22)" : "1px solid rgba(148,163,184,0.18)" }}>Payment status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsToShow.length === 0 ? (
                      <tr style={{ background: isDarkMode ? "rgba(148, 163, 184, 0.04)" : "#f8fafc" }}>
                        <td
                          colSpan={7}
                          style={{
                            padding: "16px 12px",
                            textAlign: "center",
                            color: isDarkMode ? "#cbd5e1" : "#475569",
                            fontSize: "0.82rem",
                            letterSpacing: "0.02em",
                            borderTop: isDarkMode ? "1px solid rgba(148,163,184,0.2)" : "1px solid #e2e8f0",
                            borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.2)" : "1px solid #e2e8f0",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              padding: "5px 10px",
                              borderRadius: "999px",
                              border: isDarkMode ? "1px solid rgba(148,163,184,0.35)" : "1px solid #dbe3ed",
                              background: isDarkMode ? "rgba(15, 23, 42, 0.75)" : "#eef3f8",
                              fontWeight: 600,
                              color: isDarkMode ? "#e2e8f0" : "#475569",
                              lineHeight: 1.2,
                            }}
                          >
                            No data available
                          </span>
                        </td>
                      </tr>
                    ) : (
                      rowsToShow.map((order, index) => (
                        <tr
                          key={order.id}
                          style={{
                            background: index % 2 === 0
                              ? isDarkMode ? "rgba(148,163,184,0.02)" : "#ffffff"
                              : isDarkMode ? "rgba(148,163,184,0.05)" : "#f8fafc",
                            borderTop: isDarkMode ? "1px solid rgba(148,163,184,0.08)" : "1px solid #f1f5f9",
                          }}
                        >
                          <td style={{ padding: "10px 14px", color: isDarkMode ? "#e2e8f0" : "#0f172a", fontSize: "0.9rem" }}>
                            <div style={{ fontWeight: 700 }}>{formatDetailedDate(order.created_at)}</div>
                            <div style={{ marginTop: "4px", fontSize: "0.75rem", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>{formatDetailedTime(order.created_at)}</div>
                          </td>
                          <td style={{ padding: "10px 14px", color: isDarkMode ? "#e2e8f0" : "#0f172a", fontSize: "0.9rem" }}>
                            <div style={{ fontWeight: 700, maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.asset_names || "—"}</div>
                          </td>
                          <td style={{ padding: "10px 14px", color: isDarkMode ? "#e2e8f0" : "#0f172a", fontSize: "0.9rem" }}>
                            <div style={{ color: isDarkMode ? "#cbd5e1" : "#475569", fontSize: "0.82rem" }}>{order.asset_upload_dates || "—"}</div>
                          </td>
                          <td style={{ padding: "10px 14px", color: isDarkMode ? "#e2e8f0" : "#0f172a", fontSize: "0.9rem", fontWeight: 650 }}>
                            <div style={{ fontWeight: 700 }}>{order.order_number || "—"}</div>
                            <div style={{ marginTop: "4px", fontSize: "0.72rem", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>{order.order_type || "Purchase"}</div>
                          </td>
                          <td style={{ padding: "10px 14px", color: isDarkMode ? "#cbd5e1" : "#475569", fontSize: "0.82rem" }}>
                            <div style={{ fontWeight: 600, color: isDarkMode ? "#e2e8f0" : "#0f172a" }}>{order.invoice_number || "—"}</div>
                            <div style={{ marginTop: "4px", fontSize: "0.72rem" }}>{order.assets_count ?? 0} item{(order.assets_count ?? 0) === 1 ? "" : "s"}</div>
                          </td>
                          <td style={{ padding: "10px 14px", textAlign: "right", color: isDarkMode ? "#f8fafc" : "#0f172a", fontSize: "0.92rem", fontWeight: 700 }}>
                            <div>{formatCurrency(isContributor ? order.contributor_earnings : order.total_amount, order.currency)}</div>
                            <div style={{ marginTop: "4px", fontSize: "0.72rem", color: isDarkMode ? "#cbd5e1" : "#64748b", fontWeight: 600 }}>{order.currency || "USD"}</div>
                          </td>
                          <td style={{ padding: "10px 14px", color: isDarkMode ? "#e2e8f0" : "#0f172a", fontSize: "0.82rem" }}>
                            {(() => {
                              const paymentStatus = String(order.payment_status || "unknown").trim().toLowerCase();
                              const isPending = paymentStatus === "pending";
                              const isSubmitted = Boolean(order.payment_submitted);
                              const isPaid = paymentStatus === "paid" || paymentStatus === "completed";
                              return (
                                <div style={{ display: "grid", justifyItems: "start", gap: "8px" }}>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      padding: "5px 9px",
                                      borderRadius: "999px",
                                      fontSize: "0.75rem",
                                      fontWeight: 700,
                                      color: isPending ? "#b91c1c" : isPaid ? "#15803d" : (isDarkMode ? "#cbd5e1" : "#475569"),
                                      background: isPending ? (isDarkMode ? "rgba(220,38,38,0.18)" : "#fef2f2") : isPaid ? (isDarkMode ? "rgba(22,163,74,0.18)" : "#f0fdf4") : (isDarkMode ? "rgba(148,163,184,0.12)" : "#f1f5f9"),
                                      border: `1px solid ${isPending ? (isDarkMode ? "rgba(248,113,113,0.45)" : "#fecaca") : isPaid ? (isDarkMode ? "rgba(74,222,128,0.35)" : "#bbf7d0") : (isDarkMode ? "rgba(148,163,184,0.25)" : "#e2e8f0")}`,
                                    }}
                                  >
                                    {isPaid ? "Paid" : isSubmitted ? "Pending Verification" : isPending ? "Payment pending" : paymentStatus}
                                  </span>
                                  {!isContributor && isPending && !isSubmitted && Number(order.total_amount) > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => openPaymentRetry(order)}
                                      style={{ border: "none", borderRadius: "8px", padding: "7px 10px", background: "#dc2626", color: "#fff", fontWeight: 700, cursor: "pointer" }}
                                    >
                                      Retry payment
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {total > limit && (
                <Pagination
                  currentPage={page}
                  totalPages={Math.ceil(total / limit)}
                  totalImages={total}
                  setCurrentPage={setPage}
                  darkMode={isDarkMode}
                />
              )}
              {retryPaymentSuccess && <p role="status" style={{ color: "#15803d", fontWeight: 600 }}>{retryPaymentSuccess}</p>}
            </>
          )}
        </div>
      )}
      {retryPaymentOrder && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="retry-payment-title"
          onClick={() => setRetryPaymentOrder(null)}
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 20, background: "rgba(15, 23, 42, 0.65)" }}
        >
          <section
            onClick={(event) => event.stopPropagation()}
            style={{ width: "min(440px, 100%)", maxHeight: "calc(100vh - 40px)", overflowY: "auto", boxSizing: "border-box", padding: 24, borderRadius: 18, background: isDarkMode ? "#0f172a" : "#fff", color: isDarkMode ? "#f8fafc" : "#0f172a", textAlign: "center", boxShadow: "0 20px 60px rgba(15, 23, 42, 0.3)" }}
          >
            <h2 id="retry-payment-title" style={{ marginTop: 0 }}>Retry payment</h2>
            <p>Order {retryPaymentOrder.order_number} · {formatCurrency(retryPaymentOrder.total_amount, retryPaymentOrder.currency)}</p>
            {retryPaymentCredits && (
              <div style={{ margin: "12px 0", padding: 12, borderRadius: 10, background: isDarkMode ? "#1e293b" : "#f1f5f9" }}>
                Available credits: <strong>{retryPaymentCredits.available}</strong> · Required: <strong>{retryPaymentCredits.required}</strong>
                {retryPaymentCredits.available >= retryPaymentCredits.required ? (
                  <button
                    type="button"
                    onClick={submitCreditRetry}
                    disabled={retryPaymentSubmitting}
                    style={{ display: "block", width: "100%", border: "none", borderRadius: 10, padding: 12, marginTop: 10, background: "#16a34a", color: "#fff", fontWeight: 700, cursor: retryPaymentSubmitting ? "not-allowed" : "pointer" }}
                  >
                    {retryPaymentSubmitting ? "Paying…" : `Pay with ${retryPaymentCredits.required} credits`}
                  </button>
                ) : (
                  <p style={{ margin: "8px 0 0", color: "#dc2626" }}>Not enough credits to pay this order.</p>
                )}
              </div>
            )}
            {retryPaymentOrder.paymentUri ? (
              <>
                <hr style={{ border: 0, borderTop: isDarkMode ? "1px solid #334155" : "1px solid #e2e8f0", margin: "16px 0" }} />
                <strong>Google Pay / UPI</strong>
                <p>Amount: {formatCurrency(retryPaymentOrder.total_amount, retryPaymentOrder.currency)}</p>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(retryPaymentOrder.paymentUri)}`}
                  alt="Google Pay payment QR code"
                  width="220"
                  height="220"
                  style={{ maxWidth: "100%" }}
                />
                <a href={retryPaymentOrder.paymentUri} style={{ display: "inline-block", marginBottom: 12, borderRadius: 10, padding: "10px 14px", background: "#1d4ed8", color: "#fff", textDecoration: "none", fontWeight: 700 }}>Open payment app</a>
                <p style={{ color: isDarkMode ? "#cbd5e1" : "#475569" }}>Scan the payment QR from checkout using Google Pay or another supported UPI app.</p>
                <label style={{ display: "grid", gap: 6, textAlign: "left", fontWeight: 700 }}>
                  UTR / Transaction ID
                  <input value={retryPaymentUtr} onChange={(event) => setRetryPaymentUtr(event.target.value)} placeholder="Enter UTR / Transaction ID" inputMode="numeric" maxLength={64} required style={inputStyle} />
                </label>
                <button type="button" onClick={submitPaymentRetry} disabled={retryPaymentSubmitting} style={{ border: "none", borderRadius: 12, padding: "12px 18px", marginTop: 12, background: "#16a34a", color: "#fff", fontWeight: 700, cursor: retryPaymentSubmitting ? "not-allowed" : "pointer" }}>
                  {retryPaymentSubmitting ? "Submitting…" : "Submit Payment"}
                </button>
              </>
            ) : (
              !retryPaymentCredits && <p>{retryPaymentPreparing ? "Preparing the payment option…" : "Payment option unavailable."}</p>
            )}
            {retryPaymentError && <p role="alert" style={{ color: "#dc2626", fontWeight: 600 }}>{retryPaymentError}</p>}
            <button type="button" onClick={() => setRetryPaymentOrder(null)} style={{ display: "block", margin: "16px auto 0", border: "none", background: "transparent", color: isDarkMode ? "#cbd5e1" : "#475569", cursor: "pointer" }}>Close</button>
          </section>
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  borderRadius: 14,
  border: "1px solid #cbd5e1",
  padding: "12px 14px",
  fontSize: "0.96rem",
};
