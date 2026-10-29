import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { calculateBestBundleTierDiscount, calculateCartTotals, countDistinctAssetItems, getFlashSaleEligibleItems, getFlashSaleRequiredAssetCount, getNextBundleDiscountTier, readAppliedBundleOfferId, readAppliedCoupon, writeAppliedBundleOfferId, writeAppliedCoupon, clearAppliedCoupon, normalizeCouponCode } from '../utils/cartCheckout';
import { loadCartItems, saveCartItems } from '../utils/cartPersistence';
import { getAssetPreviewUrl } from '../utils/assetPreview';
import FlashSaleOffer from '../components/FlashSaleOffer';
import CartOffersModal from '../components/CartOffersModal';
import './CartPage.css';


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
  const isLoggedInCustomer = Boolean(localStorage.getItem('token'));
  const hasLoadedCart = useRef(false);
  const [items, setItems] = useState([]);
  const [couponCode, setCouponCode] = useState('');
  const [coupon, setCoupon] = useState(null);
  const [couponMessage, setCouponMessage] = useState('');
  const [appliedFlashSale, setAppliedFlashSale] = useState(null);
  const [showBogoCheckoutDialog, setShowBogoCheckoutDialog] = useState(false);
  const [bogoCheckoutAssetIds, setBogoCheckoutAssetIds] = useState([]);
  const [availableCoupons, setAvailableCoupons] = useState([]);
  const [availableCouponsError, setAvailableCouponsError] = useState('');
  const [bundleOffers, setBundleOffers] = useState([]);
  const [bundleOffersError, setBundleOffersError] = useState('');
  const [availableFlashSales, setAvailableFlashSales] = useState([]);
  const [showOffersModal, setShowOffersModal] = useState(false);
  const [selectedBundleOfferId, setSelectedBundleOfferId] = useState(readAppliedBundleOfferId);
  const [flashSaleApplyRequest, setFlashSaleApplyRequest] = useState(null);
  const [flashSaleClearRequest, setFlashSaleClearRequest] = useState(null);
  const flashSaleApplyRequestId = useRef(0);
  const flashSaleClearRequestId = useRef(0);
  const manualOfferSelection = useRef(false);
  const [loading, setLoading] = useState(false);
  const [taxSettings, setTaxSettings] = useState([{ enabled: true, rate: 18, label: 'GST', id: 1 }]);
  const [subscriptionRestricted, setSubscriptionRestricted] = useState(false);
  const clearFlashSaleSelection = useCallback(() => {
    localStorage.removeItem('appliedFlashSale');
    setAppliedFlashSale(null);
    flashSaleClearRequestId.current += 1;
    setFlashSaleClearRequest({ requestId: flashSaleClearRequestId.current });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    axios.get(`${API_BASE_URL}/checkout/available-coupons`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => {
        setAvailableCoupons(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error('Failed to load available coupons:', error);
        setAvailableCouponsError(error.response?.data?.error || 'Unable to load your available coupons.');
      });
  }, []);

  useEffect(() => {
    let active = true;
    axios.get(`${API_BASE_URL}/checkout/active-bundle-discounts`)
      .then((response) => {
        if (!Array.isArray(response.data?.offers)) throw new Error('Active bundle discount response was invalid.');
        if (active) setBundleOffers(response.data.offers);
      })
      .catch((error) => {
        console.error('Failed to load active bundle discounts:', error);
        if (active) setBundleOffersError(error.response?.data?.error || 'Unable to load bundle discounts.');
      });
    return () => {
      active = false;
    };
  }, []);

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
        const savedItems = await loadCartItems();
        const res = await axios.post(`${API_BASE_URL}/checkout/validate-coupon`, { code: savedCoupon.code, items: savedItems }, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const nextCoupon = res.data?.coupon || null;
        setCouponCode(savedCoupon.code);
        setCoupon(nextCoupon);
        writeAppliedCoupon(savedCoupon.code, nextCoupon);
        setSelectedBundleOfferId('');
        writeAppliedBundleOfferId('');
        clearFlashSaleSelection();
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
  }, [clearFlashSaleSelection, navigate]);

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

  useEffect(() => {
    if (!hasLoadedCart.current || !items.length || items.some((item) => item.creditPackage || item.subscription)) return;
    const syncFirstOrderCoupon = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await axios.post(`${API_BASE_URL}/checkout/first-order-coupon`, { items }, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const { coupon: firstOrderCoupon, eligible, message } = response.data || {};
        if (manualOfferSelection.current) return;
        if (!firstOrderCoupon) return;
        if (eligible) {
          setSelectedBundleOfferId('');
          writeAppliedBundleOfferId('');
          clearFlashSaleSelection();
          setCouponCode(firstOrderCoupon.code);
          setCoupon(firstOrderCoupon);
          setCouponMessage(message || 'Your First Order coupon has been applied automatically.');
          writeAppliedCoupon(firstOrderCoupon.code, firstOrderCoupon);
          return;
        }
        setCoupon(null);
        setCouponCode('');
        setCouponMessage(message || '');
        clearAppliedCoupon();
      } catch (error) {
        console.error('Failed to check First Order coupon:', error);
        setCouponMessage(error.response?.data?.error || 'Unable to check First Order coupon availability.');
      }
    };
    syncFirstOrderCoupon();
  }, [items, clearFlashSaleSelection]);

  const cartCurrency = useMemo(
    () => items.find((item) => item.currency)?.currency || null,
    [items]
  );

  const handleFlashSaleChange = useCallback((flashSale) => {
    setAppliedFlashSale(flashSale);
  }, []);
  const handleFlashSaleOffersLoaded = useCallback((sales) => {
    setAvailableFlashSales(sales);
  }, []);
  const applyFlashSaleFromOffers = useCallback((sale) => {
    manualOfferSelection.current = true;
    setCoupon(null);
    setCouponCode('');
    setCouponMessage('');
    clearAppliedCoupon();
    setSelectedBundleOfferId('');
    writeAppliedBundleOfferId('');
    setAppliedFlashSale(null);
    flashSaleApplyRequestId.current += 1;
    setFlashSaleApplyRequest({ saleId: sale.id, requestId: flashSaleApplyRequestId.current });
  }, []);
  const applyBundleFromOffers = useCallback((offerId) => {
    manualOfferSelection.current = true;
    setCoupon(null);
    setCouponCode('');
    setCouponMessage('');
    clearAppliedCoupon();
    clearFlashSaleSelection();
    const nextOfferId = String(offerId);
    setSelectedBundleOfferId(nextOfferId);
    writeAppliedBundleOfferId(nextOfferId);
  }, [clearFlashSaleSelection]);
  const applyCouponFromOffers = useCallback(async (code) => {
    const nextCode = normalizeCouponCode(code);
    if (!nextCode) return false;
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(`${API_BASE_URL}/checkout/validate-coupon`, { code: nextCode, items }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const nextCoupon = response.data?.coupon || null;
      manualOfferSelection.current = true;
      setSelectedBundleOfferId('');
      writeAppliedBundleOfferId('');
      clearFlashSaleSelection();
      setCouponCode(nextCode);
      setCoupon(nextCoupon);
      setCouponMessage(response.data?.message || 'Coupon applied');
      writeAppliedCoupon(nextCode, nextCoupon);
      return true;
    } catch (error) {
      setCoupon(null);
      setCouponMessage(error.response?.data?.error || 'Coupon could not be applied');
      clearAppliedCoupon();
      return false;
    }
  }, [items, clearFlashSaleSelection]);

  const totals = useMemo(() => calculateCartTotals(items, {
    coupon,
    flashSaleDiscount: appliedFlashSale?.discount || 0,
    bundleDiscount: calculateBestBundleTierDiscount(items, bundleOffers, selectedBundleOfferId).discount,
    taxSettings,
    currency: cartCurrency
  }), [items, coupon, appliedFlashSale, taxSettings, cartCurrency, bundleOffers, selectedBundleOfferId]);
  const bundleDeal = useMemo(
    () => calculateBestBundleTierDiscount(items, bundleOffers, selectedBundleOfferId),
    [items, bundleOffers, selectedBundleOfferId]
  );
  const nextBundleTier = getNextBundleDiscountTier(
    bundleOffers,
    bundleDeal.assetCount,
    bundleDeal.tier?.discountPercent || 0
  );
  const bundleOfferActive = !coupon && !readAppliedCoupon().code && !(appliedFlashSale?.discount > 0);
  const hasOtherAppliedOffer = Boolean(
    coupon
    || (selectedBundleOfferId && bundleDeal.discount > 0)
    || readAppliedCoupon().code
  );

  const validateCoupon = async (couponCodeToApply = couponCode) => {
    const nextCode = normalizeCouponCode(couponCodeToApply);
    if (!nextCode) return false;
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API_BASE_URL}/checkout/validate-coupon`, { code: nextCode, items }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const nextCoupon = res.data.coupon || null;
      manualOfferSelection.current = true;
      setSelectedBundleOfferId('');
      writeAppliedBundleOfferId('');
      clearFlashSaleSelection();
      setCouponCode(nextCode);
      setCoupon(nextCoupon);
      setCouponMessage(res.data.message || 'Coupon applied');
      writeAppliedCoupon(nextCode, nextCoupon);
      return true;
    } catch (error) {
      setCoupon(null);
      setCouponMessage(error.response?.data?.error || 'Coupon could not be applied');
      clearAppliedCoupon();
      return false;
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
    const sale = appliedFlashSale?.sale;
    const requiredCount = getFlashSaleRequiredAssetCount(sale?.discount_rule);
    if (sale && requiredCount > 0) {
      const eligibleItems = getFlashSaleEligibleItems(items, sale);
      if (eligibleItems.length > requiredCount) {
        const existingSelection = (appliedFlashSale.selectedAssetIds || []).map(String);
        const selectionIsEligible = existingSelection.length === requiredCount
          && existingSelection.every((id) => eligibleItems.some((item) => String(item.id) === id));
        const initialSelection = selectionIsEligible
          ? existingSelection
          : eligibleItems
            .slice()
            .sort((a, b) => Number(b.unitPrice ?? b.price ?? 0) - Number(a.unitPrice ?? a.price ?? 0))
            .slice(0, requiredCount)
            .map((item) => String(item.id));
        setBogoCheckoutAssetIds(initialSelection);
        setShowBogoCheckoutDialog(true);
        return;
      }
    }
    navigate('/checkout');
  };

  const toggleBogoCheckoutAsset = (assetId) => {
    const normalizedId = String(assetId);
    setBogoCheckoutAssetIds((current) => {
      if (current.includes(normalizedId)) return current.filter((id) => id !== normalizedId);
      const requiredCount = getFlashSaleRequiredAssetCount(appliedFlashSale?.sale?.discount_rule);
      return current.length < requiredCount ? [...current, normalizedId] : current;
    });
  };

  const continueWithBogoSelection = () => {
    const sale = appliedFlashSale?.sale;
    const requiredCount = getFlashSaleRequiredAssetCount(sale?.discount_rule);
    if (!sale || bogoCheckoutAssetIds.length !== requiredCount) return;
    localStorage.setItem('appliedFlashSale', JSON.stringify({
      saleId: sale.id,
      selectedAssetIds: bogoCheckoutAssetIds
    }));
    setShowBogoCheckoutDialog(false);
    navigate('/checkout');
  };

  return (
    <div style={{ minHeight: '100vh', padding: '32px 20px 48px', background: darkMode ? '#020617' : '#f8fafc', color: darkMode ? '#f8fafc' : '#0f172a' }}>
      {showBogoCheckoutDialog && appliedFlashSale?.sale && (
        <div className={`cart-bogo-dialog-backdrop${darkMode ? ' is-dark' : ''}`} role="presentation">
          <section
            className="cart-bogo-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-bogo-dialog-title"
            aria-describedby="cart-bogo-dialog-description"
          >
            <div className="cart-bogo-dialog-accent" aria-hidden="true">✦</div>
            <div className="cart-bogo-dialog-heading">
              <span className="cart-bogo-dialog-eyebrow">FLASH SALE</span>
              <h2 id="cart-bogo-dialog-title">Choose your BOGO assets</h2>
              <p id="cart-bogo-dialog-description">
                Choose {getFlashSaleRequiredAssetCount(appliedFlashSale.sale.discount_rule)} eligible assets. The highest-priced asset is charged; the rest are free.
              </p>
            </div>
            <div className="cart-bogo-dialog-list">
              {getFlashSaleEligibleItems(items, appliedFlashSale.sale).map((item) => {
                const assetId = String(item.id);
                const checked = bogoCheckoutAssetIds.includes(assetId);
                const limitReached = bogoCheckoutAssetIds.length >= getFlashSaleRequiredAssetCount(appliedFlashSale.sale.discount_rule);
                const selectedItems = getFlashSaleEligibleItems(items, appliedFlashSale.sale)
                  .filter((eligibleItem) => bogoCheckoutAssetIds.includes(String(eligibleItem.id)));
                const highestSelectedPrice = selectedItems.reduce(
                  (highest, selectedItem) => Math.max(highest, Number(selectedItem.unitPrice ?? selectedItem.price ?? 0)),
                  0
                );
                const itemPrice = Number(item.unitPrice ?? item.price ?? 0);
                const wouldBeCharged = checked
                  ? itemPrice >= highestSelectedPrice
                  : itemPrice > highestSelectedPrice;
                return (
                  <label key={assetId} className="cart-bogo-dialog-asset">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && limitReached}
                      onChange={() => toggleBogoCheckoutAsset(assetId)}
                    />
                    <span className="cart-bogo-dialog-asset-name">{item.title || `Asset ${item.id}`}</span>
                    <span className="cart-bogo-dialog-asset-price">{formatCurrency(itemPrice, item.currency || cartCurrency)}</span>
                    {checked && (
                      <span className={`cart-bogo-dialog-asset-status${wouldBeCharged ? ' is-charged' : ' is-free'}`}>
                        {wouldBeCharged ? 'Charged' : 'Free'}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
            <div className="cart-bogo-dialog-footer">
              <span>{bogoCheckoutAssetIds.length} of {getFlashSaleRequiredAssetCount(appliedFlashSale.sale.discount_rule)} selected</span>
              <div>
                <button type="button" className="cart-bogo-dialog-cancel" onClick={() => setShowBogoCheckoutDialog(false)}>
                  Back to cart
                </button>
                <button
                  type="button"
                  className="cart-bogo-dialog-continue"
                  disabled={bogoCheckoutAssetIds.length !== getFlashSaleRequiredAssetCount(appliedFlashSale.sale.discount_rule)}
                  onClick={continueWithBogoSelection}
                >
                  Continue to checkout
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      <CartOffersModal
        open={showOffersModal}
        onClose={() => setShowOffersModal(false)}
        darkMode={darkMode}
        items={items}
        coupons={availableCoupons}
        appliedCoupon={coupon}
        couponError={availableCouponsError}
        onApplyCoupon={applyCouponFromOffers}
        flashSales={availableFlashSales}
        appliedFlashSale={appliedFlashSale}
        onApplyFlashSale={applyFlashSaleFromOffers}
        bundleOffers={bundleOffers}
        appliedBundleOfferId={bundleOfferActive ? selectedBundleOfferId : ''}
        bundleApplicationActive={bundleOfferActive}
        onApplyBundle={applyBundleFromOffers}
        subscriptionRestricted={subscriptionRestricted}
      />
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
                      <img src={getAssetPreviewUrl(item, { quality: 10, watermark: false, thumbnailOnly: true })} alt={item.title} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ marginTop: 0 }}>Order summary</h2>
            </div>
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{formatCurrency(totals.subtotal, cartCurrency)}</span></div>
              {totals.discount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: appliedFlashSale?.discount > 0 ? (darkMode ? '#6ee7b7' : '#047857') : undefined, fontWeight: appliedFlashSale?.discount > 0 ? 700 : undefined }}>
                  <span>Discounts</span>
                  <span>-{formatCurrency(totals.discount, cartCurrency)}</span>
                </div>
              )}
              {bundleOfferActive && bundleDeal.discount > 0 ? (
                <div style={{ color: darkMode ? '#6ee7b7' : '#047857', fontSize: '0.9rem' }}>
                  {bundleDeal.offer.name}: {bundleDeal.assetCount} paid assets qualify for {bundleDeal.tier.discountPercent}% off
                  {" "}(-{formatCurrency(bundleDeal.discount, cartCurrency)})
                </div>
              ) : null}
              {nextBundleTier && (
                <div style={{ color: darkMode ? '#cbd5e1' : '#64748b', fontSize: '0.9rem' }}>
                  Add {Math.max(0, nextBundleTier.assetCount - bundleDeal.assetCount)} more paid asset{nextBundleTier.assetCount - bundleDeal.assetCount === 1 ? '' : 's'} to unlock {nextBundleTier.discountPercent}% off.
                </div>
              )}
              {bundleOffersError && <div role="alert" style={{ color: '#DC2626', fontSize: '0.9rem' }}>{bundleOffersError}</div>}
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

            <FlashSaleOffer
                items={items}
                subscriptionRestricted={subscriptionRestricted}
                darkMode={darkMode}
                onChange={handleFlashSaleChange}
                onOffersLoaded={handleFlashSaleOffersLoaded}
                applySaleRequest={flashSaleApplyRequest}
                clearSelectionRequest={flashSaleClearRequest}
                hasOtherAppliedOffer={hasOtherAppliedOffer}
                variant="cart"
                currency={cartCurrency}
            />

            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <label style={{ fontWeight: 700 }}>Coupon</label>
                {isLoggedInCustomer && (
                  <button type="button" onClick={() => setShowOffersModal(true)} style={{ border: 'none', padding: 0, background: 'transparent', color: darkMode ? '#ff8b91' : '#c91d28', cursor: 'pointer', fontWeight: 700 }}>
                    View all offers
                  </button>
                )}
              </div>
              {!(appliedFlashSale?.discount > 0) && (
                <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="WELCOME10" style={{ flex: 1, borderRadius: 12, border: '1px solid #cbd5e1', padding: '10px 12px' }} />
                  {coupon ? (
                    <button onClick={clearCoupon} style={{ border: 'none', background: '#64748b', color: '#fff', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', fontWeight: 700 }}>Remove coupon</button>
                  ) : (
                    <button onClick={validateCoupon} style={{ border: 'none', background: '#ED2224', color: '#fff', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', fontWeight: 700 }}>Apply</button>
                  )}
                </div>
                {couponMessage ? <div style={{ marginTop: 8, color: coupon ? '#16a34a' : '#DC2626', fontSize: '0.95rem' }}>{couponMessage}</div> : null}
                {availableCouponsError ? <div role="alert" style={{ marginTop: 8, color: '#DC2626', fontSize: '0.95rem' }}>{availableCouponsError}</div> : null}
                {availableCoupons.length > 0 ? (
                  <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    <strong>Your available coupons</strong>
                    {availableCoupons.map((availableCoupon) => {
                      const isApplied = String(coupon?.id) === String(availableCoupon.id);
                      return (
                        <div key={availableCoupon.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, background: darkMode ? 'rgba(255,255,255,0.06)' : '#f8fafc' }}>
                          <div>
                            <div>{availableCoupon.code}</div>
                            <div style={{ fontSize: '0.8rem', color: darkMode ? '#cbd5e1' : '#64748b' }}>
                              {String(availableCoupon.discount_type || '').toLowerCase() === 'percentage'
                                ? `${Number(availableCoupon.discount_value || 0)}% off`
                                : String(availableCoupon.discount_type || '').toLowerCase() === 'free_asset'
                                  ? 'Free asset'
                                  : `${String(availableCoupon.discount_type || 'Discount').replace(/_/g, ' ')}: ${Number(availableCoupon.discount_value || 0)}`}
                            </div>
                          </div>
                          <button
                            type="button"
                            aria-label={`Apply coupon ${availableCoupon.code}`}
                            disabled={isApplied}
                            onClick={() => validateCoupon(availableCoupon.code)}
                            style={{ border: 'none', background: isApplied ? '#64748b' : '#ED2224', color: '#fff', borderRadius: 10, padding: '8px 12px', cursor: isApplied ? 'default' : 'pointer', fontWeight: 700 }}
                          >
                            {isApplied ? 'Applied' : 'Apply'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                </>
              )}
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
