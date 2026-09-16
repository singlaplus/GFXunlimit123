import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { calculateCartTotals, readAppliedCoupon, clearAppliedCoupon, normalizeCouponCode } from '../utils/cartCheckout';
import { loadCartItems, saveCartItems, clearCartItems } from '../utils/cartPersistence';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
const REQUEST_ADMIN_PAYMENT_METHOD = "Request to Admin";

function formatCurrency(value, currency = null) {
  const amount = Number(value || 0);

  if (!currency) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function CheckoutPage({ darkMode = false }) {
  const navigate = useNavigate();
  const hasLoadedCart = useRef(false);
  const [items, setItems] = useState([]);
  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState(null);
  const [couponMessage, setCouponMessage] = useState('');
  const [billing, setBilling] = useState({ fullName: '', email: '', phone: '', address: '', city: '', country: 'India' });
  const [paymentMethod, setPaymentMethod] = useState('');
  const [hasCreditPackage, setHasCreditPackage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [googlePayId, setGooglePayId] = useState('');
  const [googlePayQr, setGooglePayQr] = useState(null);
  const [googlePayUpiId, setGooglePayUpiId] = useState('');
  const [taxSettings, setTaxSettings] = useState([{ enabled: true, rate: 18, label: 'GST', id: 1 }]);
  const [subscriptionRestricted, setSubscriptionRestricted] = useState(false);
  const resolveEnabledPaymentMethods = (settings = {}) => {
    const normalizedSettings = settings && typeof settings === 'object' ? settings : {};
    const explicitGateways = Array.isArray(normalizedSettings.enabledGateways)
      ? normalizedSettings.enabledGateways
      : [];

    const inferredGateways = Object.values(normalizedSettings)
      .filter((value) => value && typeof value === 'object' && value.gateway)
      .map((value) => String(value.gateway).trim())
      .filter(Boolean);

    return [...new Set([...explicitGateways, ...inferredGateways].map((gateway) => String(gateway).trim()).filter(Boolean))];
  };

  const [availablePaymentMethods, setAvailablePaymentMethods] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      axios.get(`${API_BASE_URL}/subscription-status`, { headers: { Authorization: `Bearer ${token}` } })
        .then((response) => {
          const restricted = Boolean(response.data?.active && response.data?.canPurchase);
          setSubscriptionRestricted(restricted);
        })
        .catch(() => setSubscriptionRestricted(false));
    }
    const syncPaymentMethods = async () => {
      let nextMethods = [];
      try {
        const token = localStorage.getItem('token');
        const [settingsResult, profileResult] = await Promise.allSettled([
          axios.get(`${API_BASE_URL}/payment-settings`),
          axios.get(`${API_BASE_URL}/profile`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
        ]);
        if (settingsResult.status === 'fulfilled') {
          setGooglePayId(settingsResult.value.data?.googlePayId || '');
          nextMethods = [...(hasCreditPackage ? [REQUEST_ADMIN_PAYMENT_METHOD] : []), ...resolveEnabledPaymentMethods(settingsResult.value.data || {})];
        }
        if (profileResult.status === 'fulfilled') {
        }
      } catch (error) {
        console.error('Failed to load payment settings from backend:', error);
      }
      setAvailablePaymentMethods(nextMethods);
      setPaymentMethod((currentMethod) => nextMethods.length > 0
        ? (nextMethods.includes(currentMethod) ? currentMethod : nextMethods[0])
        : '');
    };

    syncPaymentMethods();
    const refreshInterval = setInterval(syncPaymentMethods, 5000);
    window.addEventListener('storage', syncPaymentMethods);
    window.addEventListener('payment-gateways-updated', syncPaymentMethods);
    window.addEventListener('focus', syncPaymentMethods);

    (async () => {
      try {
        const items = await loadCartItems();
        const loadedItems = Array.isArray(items) ? items : [];
        setItems(loadedItems);
        setHasCreditPackage(loadedItems.some((item) => item.creditPackage));
      } catch (error) {
        console.error('Failed to load cart:', error);
        setItems([]);
      } finally {
        hasLoadedCart.current = true;
      }
    })();

    const syncSavedCoupon = async () => {
      const savedCoupon = readAppliedCoupon();
      if (!savedCoupon.code) return;

      try {
        const token = localStorage.getItem('token');
        const res = await axios.post(`${API_BASE_URL}/checkout/validate-coupon`, { code: savedCoupon.code }, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const nextCoupon = res.data?.coupon || null;
        setCouponCode(savedCoupon.code);
        setCoupon(nextCoupon);
        localStorage.setItem('appliedCoupon', JSON.stringify({ code: savedCoupon.code, coupon: nextCoupon }));
      } catch (error) {
        setCouponCode('');
        setCoupon(null);
        setCouponMessage('');
        clearAppliedCoupon();
      }
    };

    syncSavedCoupon();

    const profile = JSON.parse(localStorage.getItem('profile') || '{}');
    setBilling((prev) => ({
      ...prev,
      fullName: profile.full_name || profile.fullName || localStorage.getItem('fullName') || '',
      email: profile.email || localStorage.getItem('email') || '',
    }));

    // Fetch tax settings from backend
    const fetchTaxSettings = async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/settings/pricing`);
        if (res.data?.tax_settings) {
          const parsed = Array.isArray(res.data.tax_settings) 
            ? res.data.tax_settings 
            : (typeof res.data.tax_settings === 'string' ? JSON.parse(res.data.tax_settings) : []);
          setTaxSettings(parsed.length > 0 ? parsed : [{ enabled: true, rate: 18, label: 'GST', id: 1 }]);
        }
      } catch (err) {
        console.error('Failed to load tax settings:', err);
      }
    };

    fetchTaxSettings();

    return () => {
      hasLoadedCart.current = false;
      clearInterval(refreshInterval);
      window.removeEventListener('storage', syncPaymentMethods);
      window.removeEventListener('payment-gateways-updated', syncPaymentMethods);
      window.removeEventListener('focus', syncPaymentMethods);
    };
  }, [hasCreditPackage]);

  useEffect(() => {
    if (!subscriptionRestricted || !items.length || items.every((item) => item.creditPackage)) return;
    navigate('/pricing', { replace: true });
  }, [items, navigate, subscriptionRestricted]);

  // Persist cart to server/localStorage whenever items change after the initial cart load.
  useEffect(() => {
    if (!hasLoadedCart.current) return;
    saveCartItems(items);
    window.dispatchEvent(new Event('cartUpdated'));
  }, [items]);

  const cartCurrency = useMemo(
    () => items.find((item) => item.currency)?.currency || null,
    [items]
  );

  const totals = useMemo(() => calculateCartTotals(items, { coupon, taxSettings, currency: cartCurrency }), [items, coupon, taxSettings, cartCurrency]);

  const applyCoupon = async () => {
    const nextCode = normalizeCouponCode(couponCode);
    if (!nextCode) return;
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API_BASE_URL}/checkout/validate-coupon`, { code: nextCode }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const nextCoupon = res.data.coupon || null;
      setCoupon(nextCoupon);
      setCouponMessage(res.data.message || 'Coupon applied');
      localStorage.setItem('appliedCoupon', JSON.stringify({ code: nextCode, coupon: nextCoupon }));
    } catch (error) {
      setCoupon(null);
      setCouponMessage(error.response?.data?.error || 'Coupon could not be applied');
      clearAppliedCoupon();
    }
  };

  const removeCoupon = () => {
    setCoupon(null);
    setCouponCode('');
    setCouponMessage('Coupon removed');
    clearAppliedCoupon();
  };

  const submitOrder = async () => {
    if (!items.length) return;
    if (subscriptionRestricted && !items.every((item) => item.creditPackage)) {
      setMessage('Your active subscription is currently valid. New purchases are available after the download limit is reached or the plan expires.');
      return;
    }
    if (totals.total > 0 && paymentMethod === 'Google Pay' && !googlePayId) {
      setMessage('Google Pay is not configured. Please contact support.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const token = localStorage.getItem('token');
      const payload = {
        items,
        billing,
        paymentMethod: totals.total === 0 ? 'free' : paymentMethod,
        couponCode: coupon?.code || couponCode.trim(),
        currency: cartCurrency,
        taxRate: totals.tax > 0 ? Number((totals.tax / Math.max(1, totals.subtotal || 1)).toFixed(4)) : 0,
        taxBreakdown: totals.taxBreakdown || [],
      };
      const res = await axios.post(`${API_BASE_URL}/checkout/place-order`, payload, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (totals.total > 0 && paymentMethod === 'Google Pay') {
        const paymentUri = `upi://pay?pa=${encodeURIComponent(googlePayId)}&pn=${encodeURIComponent('GFXunlimit')}&am=${encodeURIComponent(totals.total.toFixed(2))}&cu=INR`;
        setGooglePayUpiId('');
        setGooglePayQr({ paymentUri, amount: totals.total, orderId: res.data.orderId, orderNumber: res.data.orderNumber || '' });
        setMessage('Scan the QR code to complete your payment.');
        return;
      }
      await clearCartItems();
      clearAppliedCoupon();
      window.dispatchEvent(new Event('cartUpdated'));
      navigate('/orders');
      setMessage(res.data.message || 'Order placed successfully');
    } catch (error) {
      setMessage(error.response?.data?.error || 'Unable to place order');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmGooglePayPayment = async () => {
    setSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API_BASE_URL}/checkout/confirm-google-pay`, {
        orderId: googlePayQr?.orderId,
        upiId: googlePayUpiId.trim(),
      }, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      await clearCartItems();
      clearAppliedCoupon();
      window.dispatchEvent(new Event('cartUpdated'));
      setGooglePayQr(null);
      navigate(`/orders/${res.data.orderId}`);
    } catch (error) {
      setGooglePayQr(null);
      setMessage(error.response?.data?.error || 'Payment failed. The order cannot be downloaded.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', padding: '32px 20px 48px', background: darkMode ? '#020617' : '#f8fafc', color: darkMode ? '#f8fafc' : '#0f172a' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 24 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ padding: 24, borderRadius: 24, background: darkMode ? 'rgba(255,255,255,0.05)' : '#fff', border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(226,232,240,1)' }}>
            <p style={{ color: '#ED2224', textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700, margin: 0 }}>Secure checkout</p>
            <h1 style={{ margin: '6px 0 16px', fontSize: '2rem' }}>Complete your order</h1>
            <div style={{ display: 'grid', gap: 12 }}>
              <input placeholder="Full name" value={billing.fullName} onChange={(e) => setBilling({ ...billing, fullName: e.target.value })} style={inputStyle} />
              <input placeholder="Email" value={billing.email} onChange={(e) => setBilling({ ...billing, email: e.target.value })} style={inputStyle} />
              <input placeholder="Phone" value={billing.phone} onChange={(e) => setBilling({ ...billing, phone: e.target.value })} style={inputStyle} />
              <input placeholder="Address" value={billing.address} onChange={(e) => setBilling({ ...billing, address: e.target.value })} style={inputStyle} />
              <input placeholder="City" value={billing.city} onChange={(e) => setBilling({ ...billing, city: e.target.value })} style={inputStyle} />
              <input placeholder="Country" value={billing.country} onChange={(e) => setBilling({ ...billing, country: e.target.value })} style={inputStyle} />
            </div>
          </div>

          <div style={{ padding: 24, borderRadius: 24, background: darkMode ? 'rgba(255,255,255,0.05)' : '#fff', border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(226,232,240,1)' }}>
            <h2 style={{ marginTop: 0 }}>Payment</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              {totals.total > 0 ? (
                availablePaymentMethods.length > 0 ? (
                  availablePaymentMethods.map((method) => (
                    <label key={method} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14, border: paymentMethod === method ? '1px solid #ED2224' : '1px solid #cbd5e1' }}>
                      <input type="radio" name="paymentMethod" value={method} aria-label={method} checked={paymentMethod === method} onChange={() => setPaymentMethod(method)} />
                      <span>{method}</span>
                    </label>
                  ))
                ) : (
                  <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid #cbd5e1' }}>No payment methods enabled by admin</div>
                )
              ) : (
                <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid #cbd5e1' }}>No payment required for zero total</div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ padding: 24, borderRadius: 24, background: darkMode ? 'rgba(255,255,255,0.05)' : '#fff', border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(226,232,240,1)', position: 'sticky', top: 24 }}>
            <h2 style={{ marginTop: 0 }}>Order summary</h2>
            {items.map((item) => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, color: darkMode ? '#cbd5e1' : '#475569' }}>
                <span>{item.title || 'Asset'} x{item.quantity || 1}</span>
                <span>{formatCurrency((item.unitPrice || item.price || 0) * (item.quantity || 1), item.currency || cartCurrency)}</span>
              </div>
            ))}
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{formatCurrency(totals.subtotal, cartCurrency)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Discount</span><span style={{ color: totals.discount > 0 ? '#16a34a' : 'inherit' }}>-{formatCurrency(totals.discount, cartCurrency)}</span></div>
              <div style={{ display: 'grid', gap: 6 }}>
                {(totals.taxBreakdown || []).map((tax, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', color: darkMode ? '#cbd5e1' : '#64748b' }}>
                    <span>{tax.label} {tax.type === 'fixed' ? `(${formatCurrency(tax.amount, cartCurrency)})` : `(${tax.rate}%)`}</span>
                    <span>{formatCurrency(tax.value, cartCurrency)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Total tax</span><span>{formatCurrency(totals.tax, cartCurrency)}</span></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.08rem', paddingTop: 8, borderTop: darkMode ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(226,232,240,1)' }}><span>Total</span><span>{formatCurrency(totals.total, cartCurrency)}</span></div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: 8 }}>Coupon</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="WELCOME10" style={{ flex: 1, borderRadius: 12, border: '1px solid #cbd5e1', padding: '10px 12px' }} />
                {coupon ? (
                  <button onClick={removeCoupon} style={{ border: 'none', background: '#64748b', color: '#fff', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', fontWeight: 700 }}>Remove coupon</button>
                ) : (
                  <button onClick={applyCoupon} style={{ border: 'none', background: '#ED2224', color: '#fff', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', fontWeight: 700 }}>Apply</button>
                )}
              </div>
              {couponMessage ? <div style={{ marginTop: 8, color: coupon ? '#16a34a' : '#DC2626', fontSize: '0.95rem' }}>{couponMessage}</div> : null}
            </div>

            <button disabled={submitting || !items.length || (totals.total > 0 && !paymentMethod)} onClick={submitOrder} style={{ width: '100%', marginTop: 18, border: 'none', borderRadius: 16, padding: '14px 16px', background: '#ED2224', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
              {submitting ? 'Placing order…' : 'Place order'}
            </button>
            {message ? <div style={{ marginTop: 12, color: '#16a34a', fontWeight: 600 }}>{message}</div> : null}
          </div>
        </div>
      </div>
      {googlePayQr ? (
        <div role="dialog" aria-modal="true" aria-labelledby="google-pay-qr-title" style={{ position: 'fixed', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(15, 23, 42, 0.65)' }}>
          <div style={{ width: 'min(390px, 100%)', padding: 24, borderRadius: 20, background: darkMode ? '#0f172a' : '#fff', color: darkMode ? '#f8fafc' : '#0f172a', textAlign: 'center', boxShadow: '0 20px 60px rgba(15, 23, 42, 0.3)' }}>
            <h2 id="google-pay-qr-title" style={{ marginTop: 0 }}>Pay with Google Pay</h2>
            <p>Scan this QR code to pay {formatCurrency(googlePayQr.amount, cartCurrency)}.</p>
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(googlePayQr.paymentUri)}`} alt="Google Pay payment QR code" width="260" height="260" />
            <p style={{ wordBreak: 'break-word', color: darkMode ? '#cbd5e1' : '#475569' }}>Google Pay ID: {googlePayId}</p>
            <label style={{ display: 'grid', gap: 6, textAlign: 'left', fontWeight: 700 }}>
              Your UPI ID
              <input value={googlePayUpiId} onChange={(event) => setGooglePayUpiId(event.target.value)} placeholder="example@upi" style={inputStyle} />
            </label>
            <button type="button" onClick={confirmGooglePayPayment} disabled={submitting} style={{ border: 'none', borderRadius: 12, padding: '12px 18px', marginTop: 12, background: '#16a34a', color: '#fff', fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}>Submit UPI ID</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  borderRadius: 14,
  border: '1px solid #cbd5e1',
  padding: '12px 14px',
  fontSize: '0.96rem',
};
