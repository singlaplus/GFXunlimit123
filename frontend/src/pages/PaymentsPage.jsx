import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { formatIndiaDateTime } from '../utils/indiaTime';
import Pagination from "../components/Pagination";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";
import "./PaymentsPage.css";

const PAYMENT_PAGE_SIZE = 20;

export default function PaymentsPage({ darkMode = false }) {
  const { reportResource, retryKey, routeId } = useStartupReadiness();
  const previousRetryKey = useRef(retryKey);
  const payoutRequestsLoaderRef = useRef(async () => false);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [payoutRequests, setPayoutRequests] = useState([]);
  const [error, setError] = useState(null);
  const animatedPaymentCountRef = useRef(0);
  const [animatedPaymentCount, setAnimatedPaymentCount] = useState(0);

  useEffect(() => {
    if (loading) return undefined;

    const total = payments.length;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (
      prefersReducedMotion ||
      typeof window.requestAnimationFrame !== "function" ||
      animatedPaymentCountRef.current === total
    ) {
      animatedPaymentCountRef.current = total;
      setAnimatedPaymentCount(total);
      return undefined;
    }

    const startValue = animatedPaymentCountRef.current;
    const duration = 900;
    let startTime;
    let frameId;
    const animate = (timestamp) => {
      if (startTime === undefined) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(startValue + (total - startValue) * easedProgress);
      animatedPaymentCountRef.current = nextValue;
      setAnimatedPaymentCount(nextValue);
      if (progress < 1) {
        frameId = window.requestAnimationFrame(animate);
      }
    };

    frameId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frameId);
  }, [loading, payments.length]);

  // fetchPayments is callable from the event listener below
  const fetchPayments = useCallback(async (readinessAttempt = false) => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const base = `${API_BASE_URL}/credits/history`;
      // If logged in, request per-user history; otherwise request global latest 50
      const url = token ? base : `${base}?all=true`;
      const res = await axios.get(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

      if (!Array.isArray(res.data)) {
        throw new Error("Payment history response was invalid.");
      }
      setPayments(res.data);
      try {
        // save generic cache
        localStorage.setItem('payments_cache', JSON.stringify(res.data));
        // save per-user cache using userId as the canonical key to avoid username collisions
        const uid = localStorage.getItem('userId');
        if (uid) {
          localStorage.setItem(`payments_cache_user_${uid}`, JSON.stringify(res.data || []));
        }
      } catch (e) {
        // ignore storage errors
      }
      if (readinessAttempt) reportResource("payments", "ready", "", routeId);
      return true;
    } catch (err) {
      // try to fall back to cached payments so the UI still shows recent history
      try {
        const uid = localStorage.getItem('userId');
        let cached = null;
        if (uid) {
          // when authenticated, only use per-user cache keyed by userId
          cached = localStorage.getItem(`payments_cache_user_${uid}`);
        } else {
          // when not authenticated, fall back to generic cache
          cached = localStorage.getItem('payments_cache');
        }
        if (cached) {
          const cachedPayments = JSON.parse(cached);
          if (!Array.isArray(cachedPayments)) throw new Error("Cached payment history was invalid.");
          setPayments(cachedPayments);
          setLoading(false);
          if (readinessAttempt) reportResource("payments", "ready", "", routeId);
          return true;
        }
      } catch (e) {
        // ignore
      }

      if (err.response && err.response.status === 404) {
        setPayments([]);
        if (readinessAttempt) reportResource("payments", "ready", "", routeId);
        return true;
      } else {
        setError('Failed to load payment history');
        if (readinessAttempt) {
          reportResource("payments", "error", "Unable to load payment history. Please retry.", routeId);
        }
        return false;
      }
    } finally {
      setLoading(false);
    }
  }, [reportResource, routeId]);

  const loadPaymentData = useCallback(async () => {
    reportResource("payments", "loading", "", routeId);
    const [historyLoaded, payoutsLoaded] = await Promise.all([
      fetchPayments(),
      payoutRequestsLoaderRef.current(),
    ]);
    if (historyLoaded && payoutsLoaded) {
      reportResource("payments", "ready", "", routeId);
    } else {
      setError("Unable to load payment history. Please retry.");
      reportResource("payments", "error", "Unable to load payment history. Please retry.", routeId);
    }
  }, [fetchPayments, reportResource, routeId]);

  useEffect(() => {

    const fetchPayoutRequests = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_BASE_URL}/payout-requests`, { headers: { Authorization: `Bearer ${token}` } });
        if (!Array.isArray(res.data)) throw new Error("Payout request response was invalid.");
        setPayoutRequests(res.data);
        return true;
      } catch (err) {
        console.error("Failed to load payout requests", err);
        setPayoutRequests([]);
        return false;
      }
    };
    payoutRequestsLoaderRef.current = fetchPayoutRequests;
    loadPaymentData();

    const onPaymentsRequested = () => {
      fetchPayments();
      fetchPayoutRequests();
    };
    const onCreditsUpdated = () => {
      fetchPayments();
      fetchPayoutRequests();
    };

    window.addEventListener('paymentsRequested', onPaymentsRequested);
    window.addEventListener('creditsUpdated', onCreditsUpdated);
    return () => {
      window.removeEventListener('paymentsRequested', onPaymentsRequested);
      window.removeEventListener('creditsUpdated', onCreditsUpdated);
    };
  }, [fetchPayments, loadPaymentData]);

  useEffect(() => {
    if (previousRetryKey.current === retryKey) return;
    previousRetryKey.current = retryKey;
    loadPaymentData();
  }, [loadPaymentData, retryKey]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(payments.length / PAYMENT_PAGE_SIZE));
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [payments.length]);

  const isDarkMode = Boolean(darkMode);
  const pageClassName = `payments-page${isDarkMode ? " is-dark" : ""}`;

  if (loading) {
    return <div className={`${pageClassName} payments-page-state`} role="status">Loading...</div>;
  }
  if (error) {
    return <div className={`${pageClassName} payments-page-state`} role="alert">{error}</div>;
  }

  const hasPaymentHistory = payments.length > 0 || payoutRequests.length > 0;
  const totalPages = Math.ceil(payments.length / PAYMENT_PAGE_SIZE);
  const visiblePayments = payments.slice(
    (currentPage - 1) * PAYMENT_PAGE_SIZE,
    currentPage * PAYMENT_PAGE_SIZE
  );

  return (
    <div className={pageClassName}>
      <header className="payments-page-heading">
        <div>
          <p className="payments-page-eyebrow">Account activity</p>
          <h1>Payment History</h1>
          <p className="payments-page-description">
            Review your credit transactions and redemption requests.
          </p>
        </div>
        <div className="payments-page-count" aria-label={`${payments.length} payment transactions`}>
          <span>{animatedPaymentCount.toLocaleString()}</span>
          <span>Transactions</span>
        </div>
      </header>

      {payoutRequests.length > 0 && (
        <section className="payments-section" aria-labelledby="redeem-requests-heading">
          <div className="payments-section-heading">
            <div>
              <p className="payments-section-eyebrow">Payout activity</p>
              <h2 id="redeem-requests-heading">Redeem Requests</h2>
            </div>
            <span className="payments-section-count">
              {payoutRequests.length} {payoutRequests.length === 1 ? "request" : "requests"}
            </span>
          </div>
          <div className="payments-table-scroll">
            <table className="payments-table payments-payout-table">
              <thead>
                <tr>
                  <th scope="col">Submitted</th>
                  <th scope="col">Credits</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {payoutRequests.map((request) => (
                  <tr key={request.id}>
                    <td data-label="Submitted">{formatIndiaDateTime(request.created_at)} IST</td>
                    <td data-label="Credits">{request.requested_credits}</td>
                    <td data-label="Amount">₹ {Number(request.requested_credits).toFixed(2)}</td>
                    <td data-label="Status">
                      <span className={`payments-status-pill${request.status === 'payment_done' ? " is-complete" : ""}`}>
                        {request.status === 'payment_done'
                          ? 'Payment done'
                          : request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hasPaymentHistory ? (
        <section className="payments-section" aria-labelledby="transactions-heading">
          <div className="payments-section-heading">
            <div>
              <p className="payments-section-eyebrow">Credits overview</p>
              <h2 id="transactions-heading">Transactions</h2>
            </div>
            <span className="payments-section-count">
              {animatedPaymentCount} {animatedPaymentCount === 1 ? "entry" : "entries"}
            </span>
          </div>
          <div className="payments-table-scroll">
            <table className="payments-table payments-transaction-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">User</th>
                  <th scope="col">Credits</th>
                  <th scope="col">Type</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {visiblePayments.map((p) => {
                  const date = `${formatIndiaDateTime(p.created_at)} IST`;
                  const purchased = p.amount_paid !== null && p.amount_paid !== undefined;
                  const type = purchased ? 'Purchased' : 'Provided by Admin';
                  const amount = purchased ? `${p.amount_paid} ${p.currency || ''}` : '-';
                  const tx = p.transaction_id || '-';
                  return (
                    <tr key={p.id}>
                      <td data-label="When">{date}</td>
                      <td data-label="User">{p.username || p.email || '-'}</td>
                      <td data-label="Credits" className="payments-credit-value">{p.credits}</td>
                      <td data-label="Type">
                        <span className={`payments-type-pill${purchased ? " is-purchase" : " is-grant"}`}>
                          {type}
                        </span>
                      </td>
                      <td data-label="Amount">{amount}</td>
                      <td data-label="Transaction" className="payments-transaction-id">{tx}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {payments.length > PAYMENT_PAGE_SIZE && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalImages={payments.length}
              setCurrentPage={setCurrentPage}
              darkMode={isDarkMode}
              totalLabel="Total Transactions"
            />
          )}
        </section>
      ) : (
        <section className="payments-empty-state">
          <span className="payments-empty-icon" aria-hidden="true">₹</span>
          <p>No payment history available.</p>
        </section>
      )}
    </div>
  );
}
