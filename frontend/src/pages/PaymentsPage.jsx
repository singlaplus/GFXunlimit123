import { useEffect, useState } from 'react';
import axios from 'axios';

export default function PaymentsPage() {
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [payoutRequests, setPayoutRequests] = useState([]);
  const [error, setError] = useState(null);

  // fetchPayments is callable from the event listener below
  const fetchPayments = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const base = `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000'}/credits/history`;
      // If logged in, request per-user history; otherwise request global latest 50
      const url = token ? base : `${base}?all=true`;
      const res = await axios.get(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

      setPayments(res.data || []);
      try {
        // save generic cache
        localStorage.setItem('payments_cache', JSON.stringify(res.data || []));
        // save per-user cache using userId as the canonical key to avoid username collisions
        const uid = localStorage.getItem('userId');
        if (uid) {
          localStorage.setItem(`payments_cache_user_${uid}`, JSON.stringify(res.data || []));
        }
      } catch (e) {
        // ignore storage errors
      }
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
          setPayments(JSON.parse(cached));
          setLoading(false);
          return;
        }
      } catch (e) {
        // ignore
      }

      if (err.response && err.response.status === 404) {
        setPayments([]);
      } else {
        setError('Failed to load payment history');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayments();

    const fetchPayoutRequests = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000'}/payout-requests`, { headers: { Authorization: `Bearer ${token}` } });
        setPayoutRequests(res.data || []);
      } catch (err) {
        setPayoutRequests([]);
      }
    };
    fetchPayoutRequests();

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
  }, []);

  if (loading) return <p>Loading...</p>;
  if (error) return <p>{error}</p>;

  if ((!payments || payments.length === 0) && payoutRequests.length === 0) {
    return <p>No payment history available.</p>;
  }

  return (
    <div>
      <h2>Payment History</h2>
      {payoutRequests.length > 0 && (
        <>
          <h3>Redeem Requests</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead><tr><th style={{ textAlign: 'left', padding: 8 }}>Submitted</th><th style={{ textAlign: 'left', padding: 8 }}>Credits</th><th style={{ textAlign: 'left', padding: 8 }}>Amount</th><th style={{ textAlign: 'left', padding: 8 }}>Status</th></tr></thead>
            <tbody>{payoutRequests.map((request) => <tr key={request.id} style={{ borderTop: '1px solid #eee' }}><td style={{ padding: 8 }}>{new Date(request.created_at).toLocaleString()}</td><td style={{ padding: 8 }}>{request.requested_credits}</td><td style={{ padding: 8 }}>₹ {Number(request.requested_credits).toFixed(2)}</td><td style={{ padding: 8 }}>{request.status === 'payment_done' ? 'Payment done' : request.status.charAt(0).toUpperCase() + request.status.slice(1)}</td></tr>)}</tbody>
          </table>
        </>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 8 }}>When</th>
            <th style={{ textAlign: 'left', padding: 8 }}>User</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Credits</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Type</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Amount</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => {
            const date = new Date(p.created_at).toLocaleString();
            const purchased = p.amount_paid !== null && p.amount_paid !== undefined;
            const type = purchased ? 'Purchased' : 'Provided by Admin';
            const amount = purchased ? `${p.amount_paid} ${p.currency || ''}` : '-';
            const tx = p.transaction_id || '-';
            return (
              <tr key={p.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{date}</td>
                <td style={{ padding: 8 }}>{p.username || p.email || '-'}</td>
                <td style={{ padding: 8 }}>{p.credits}</td>
                <td style={{ padding: 8 }}>{type}</td>
                <td style={{ padding: 8 }}>{amount}</td>
                <td style={{ padding: 8 }}>{tx}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
