import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { calculateCartTotals, readAppliedCoupon, writeAppliedCoupon, clearAppliedCoupon, normalizeCouponCode } from '../utils/cartCheckout';
import { loadCartItems, saveCartItems } from '../utils/cartPersistence';
import { getAssetPreviewUrl } from '../utils/assetPreview';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

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

export default function CartPage({ darkMode = false }) {
  const navigate = useNavigate();
  const hasLoadedCart = useRef(false);
  const [items, setItems] = useState([]);
  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState(null);
  const [couponMessage, setCouponMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [taxSettings, setTaxSettings] = useState([{ enabled: true, rate: 18, label: 'GST', id: 1 }]);
  const [subscriptionRestricted, setSubscriptionRestricted] = useState(false);

  // Load cart on mount
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
    (async () => {
      try {
        const items = await loadCartItems();
        setItems(Array.isArray(items) ? items : []);
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
        writeAppliedCoupon(savedCoupon.code, nextCoupon);
      } catch (error) {
        setCouponCode('');
        setCoupon(null);
        setCouponMessage('');
        clearAppliedCoupon();
      }
    };

    syncSavedCoupon();

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
    };
  }, []);

  useEffect(() => {
    if (!subscriptionRestricted || !items.length || items.every((item) => item.creditPackage)) return;
    setItems([]);
    saveCartItems([]);
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

  const validateCoupon = async () => {
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
      writeAppliedCoupon(nextCode, nextCoupon);
    } catch (error) {
      setCoupon(null);
      setCouponMessage(error.response?.data?.error || 'Coupon could not be applied');
      clearAppliedCoupon();
    }
  };

  const clearCoupon = () => {
    setCoupon(null);
    setCouponCode('');
    setCouponMessage('Coupon removed');
    clearAppliedCoupon();
  };

  const removeItem = (id) => {
    const nextItems = items.filter((item) => String(item.id) !== String(id));
    setItems(nextItems);
  };

  const proceedToCheckout = () => {
    if (!items.length || (subscriptionRestricted && !items.every((item) => item.creditPackage))) return;
    navigate('/checkout');
  };

  return (
    <div style={{ minHeight: '100vh', padding: '32px 20px 48px', background: darkMode ? '#020617' : '#f8fafc', color: darkMode ? '#f8fafc' : '#0f172a' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gap: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <p style={{ textTransform: 'uppercase', letterSpacing: '0.2em', color: '#ED2224', fontWeight: 700, margin: 0 }}>Enterprise cart</p>
            <h1 style={{ margin: '6px 0 0', fontSize: '2rem' }}>Your selected assets</h1>
          </div>
          <button onClick={() => navigate('/explore')} style={{ border: 'none', borderRadius: 999, padding: '12px 18px', background: darkMode ? 'rgba(255,255,255,0.12)' : '#fff', color: darkMode ? '#fff' : '#0f172a', cursor: 'pointer', fontWeight: 700 }}>
            Continue shopping
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 0.65fr', gap: 24, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 16 }}>
            {items.length === 0 ? (
              <div style={{ padding: 28, borderRadius: 24, background: darkMode ? 'rgba(255,255,255,0.05)' : '#fff', border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(226,232,240,1)' }}>
                <h2 style={{ marginTop: 0 }}>Your cart is empty</h2>
                <p style={{ color: darkMode ? '#cbd5e1' : '#64748b', marginBottom: 0 }}>Add assets from the marketplace to start your enterprise checkout.</p>
              </div>
            ) : items.map((item) => (
              <div key={item.id} style={{ display: 'grid', gap: 14, padding: 20, borderRadius: 24, background: darkMode ? 'rgba(255,255,255,0.05)' : '#fff', border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(226,232,240,1)' }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  {item.creditPackage ? (
                    <div style={{ width: 88, height: 88, borderRadius: 18, display: 'grid', placeItems: 'center', background: '#fee2e2', color: '#b91c1c', fontWeight: 800, textAlign: 'center', flexShrink: 0 }}>CREDITS</div>
                  ) : (
                    <div style={{ width: 88, height: 88, borderRadius: 18, overflow: 'hidden', background: '#e2e8f0', flexShrink: 0 }}>
                      <img src={getAssetPreviewUrl(item, { quality: 10, watermark: false })} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{item.title || 'Untitled asset'}</div>
                    <div style={{ color: darkMode ? '#cbd5e1' : '#64748b', marginTop: 4 }}>{item.category || 'Marketplace asset'} • {item.collection || 'Collection'}</div>
                    <div style={{ marginTop: 8, color: '#ED2224', fontWeight: 700 }}>{item.license || 'Standard license'}</div>
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{formatCurrency(item.unitPrice || item.price || 0, item.currency || cartCurrency)}</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => removeItem(item.id)} style={{ border: 'none', background: 'transparent', color: '#DC2626', cursor: 'pointer', fontWeight: 700 }}>Remove</button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: 24, borderRadius: 24, background: darkMode ? 'rgba(255,255,255,0.05)' : '#fff', border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(226,232,240,1)', position: 'sticky', top: 24 }}>
            <h2 style={{ marginTop: 0 }}>Order summary</h2>
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{formatCurrency(totals.subtotal, cartCurrency)}</span></div>
              {totals.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Discount</span><span>-{formatCurrency(totals.discount, cartCurrency)}</span></div>}
              <div style={{ display: 'grid', gap: 8 }}>
                {(totals.taxBreakdown || []).map((tax, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', color: darkMode ? '#cbd5e1' : '#64748b' }}>
                    <span>{tax.label} {tax.type === 'fixed' ? `(${formatCurrency(tax.amount, cartCurrency)})` : `(${tax.rate}%)`}</span>
                    <span>{formatCurrency(tax.value, cartCurrency)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Total tax</span><span>{formatCurrency(totals.tax, cartCurrency)}</span></div>
              </div>
              <div style={{ paddingTop: 8, marginTop: 6, borderTop: darkMode ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(226,232,240,1)', display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '1.08rem' }}><span>Total</span><span>{formatCurrency(totals.total, cartCurrency)}</span></div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: 8 }}>Coupon</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="WELCOME10" style={{ flex: 1, borderRadius: 12, border: '1px solid #cbd5e1', padding: '10px 12px' }} />
                {coupon ? (
                  <button onClick={clearCoupon} style={{ border: 'none', background: '#64748b', color: '#fff', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', fontWeight: 700 }}>Remove coupon</button>
                ) : (
                  <button onClick={validateCoupon} style={{ border: 'none', background: '#ED2224', color: '#fff', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', fontWeight: 700 }}>Apply</button>
                )}
              </div>
              {couponMessage ? <div style={{ marginTop: 8, color: coupon ? '#16a34a' : '#DC2626', fontSize: '0.95rem' }}>{couponMessage}</div> : null}
            </div>

            {subscriptionRestricted && !items.every((item) => item.creditPackage) && <div style={{ marginTop: 16, color: '#b45309', fontWeight: 700 }}>Your active subscription is currently valid. New purchases are available after the download limit is reached or the plan expires.</div>}
            <button disabled={!items.length || loading || (subscriptionRestricted && !items.every((item) => item.creditPackage))} onClick={proceedToCheckout} style={{ width: '100%', marginTop: 18, border: 'none', borderRadius: 16, padding: '14px 16px', background: '#ED2224', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
              {loading ? 'Preparing checkout…' : 'Proceed to checkout'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
