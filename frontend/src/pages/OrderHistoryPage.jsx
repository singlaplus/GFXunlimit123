import { useEffect, useState } from "react";
import axios from "axios";
import Pagination from "../components/Pagination";

function formatCurrency(value, currency = "USD") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${currency} ${Number(value).toFixed(2)}`;
}

export default function OrderHistoryPage({ darkMode = false }) {
  const isDarkMode = Boolean(darkMode);
  const [orders, setOrders] = useState([]);
  const [orderDetail, setOrderDetail] = useState(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);

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
          setError(null);
        })
        .catch((err) => {
          console.error("Failed to load orders", err);
          setError(err.response?.data?.error || "Failed to load orders.");
          setOrders([]);
          setTotal(0);
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
                  <strong>Payment status:</strong> {orderDetail.order.payment_status}
                </p>
                <p>
                  <strong>UPI ID:</strong> {orderDetail.order.payer_upi_id || "—"}
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
                      
                      // Extract extension helper
                      const extractExt = (str) => {
                        if (!str) return '';
                        const s = str.toString();
                        const q = s.split('?')[0].split('#')[0];
                        const idx = q.lastIndexOf('.');
                        if (idx === -1) return '';
                        const e = q.slice(idx);
                        if (e.length > 0 && e.length <= 10) return e;
                        return '';
                      };
                      
                      // Try to get filename from Content-Disposition header (case insensitive)
                      let finalFilename = '';
                      const headerKeys = res.headers ? Object.keys(res.headers) : [];
                      const cdKey = headerKeys.find(k => k.toLowerCase() === 'content-disposition');
                      const cd = cdKey ? res.headers[cdKey] : null;
                      console.log('Content-Disposition key found:', cdKey, 'value:', cd);
                      
                      if (cd) {
                        // Try RFC 5987 first: filename*=UTF-8''...
                        let m = cd.match(/filename\*=UTF-8''([^;\n]+)/i);
                        if (m) {
                          finalFilename = decodeURIComponent(m[1]);
                          console.log('Extracted filename from RFC 5987:', finalFilename);
                        }
                        // Fall back to standard format: filename="..."
                        if (!finalFilename) {
                          m = cd.match(/filename="([^"]+)"/i);
                          if (m) {
                            finalFilename = m[1];
                            console.log('Extracted filename from standard format:', finalFilename);
                          }
                        }
                      }
                      
                      // Use extracted filename if available, otherwise construct from title
                      if (finalFilename) {
                        a.download = finalFilename;
                      } else {
                        const sanitize = (s) => (s || '').toString().trim().replace(/\s+/g, '_').replace(/[^a-z0-9._-]/gi, '_').slice(0, 200);
                        const titleBase = sanitize(item.title || item.asset_id || 'asset');
                        let ext = '';
                        if (item && item.title && item.title.includes('.')) {
                          ext = extractExt(item.title);
                        }
                        a.download = `${titleBase}${ext || ''}`;
                      }
                      console.log('Final download filename:', a.download);
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
              {rowsToShow.length === 0 ? (
                <p>You have no orders yet.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "12px", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd" }}>Date</th>
                        <th style={{ textAlign: "left", padding: "12px", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd" }}>Order</th>
                        <th style={{ textAlign: "left", padding: "12px", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd" }}>Invoice</th>
                        <th style={{ textAlign: "left", padding: "12px", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd" }}>Status</th>
                        <th style={{ textAlign: "right", padding: "12px", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd" }}>Total</th>
                        <th style={{ textAlign: "center", padding: "12px", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowsToShow.map((order) => (
                        <tr key={order.id} style={{ borderTop: isDarkMode ? "1px solid rgba(148,163,184,0.15)" : "1px solid #f2f2f2", backgroundColor: isDarkMode ? "transparent" : "undefined" }}>
                          <td style={{ padding: "12px" }}>{new Date(order.created_at).toLocaleDateString()}</td>
                          <td style={{ padding: "12px" }}>{order.order_number}</td>
                          <td style={{ padding: "12px" }}>{order.invoice_number || "—"}</td>
                          <td style={{ padding: "12px" }}>{order.order_status}</td>
                          <td style={{ padding: "12px", textAlign: "right" }}>{formatCurrency(order.total_amount, order.currency)}</td>
                          <td style={{ padding: "12px", textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() => goToOrder(order.id)}
                              style={{
                                padding: "8px 12px",
                                borderRadius: "999px",
                                border: isDarkMode ? "1px solid rgba(31,111,235,0.5)" : "1px solid #1f6feb",
                                background: "#1f6feb",
                                color: "white",
                                cursor: "pointer",
                              }}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {total > limit && (
                <Pagination
                  currentPage={page}
                  totalPages={Math.ceil(total / limit)}
                  totalImages={total}
                  setCurrentPage={setPage}
                  darkMode={isDarkMode}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
