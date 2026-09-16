export function normalizeCouponCode(code = "") {
  return String(code ?? "").trim().toUpperCase();
}

export function normalizeCouponDiscountType(discountType = "") {
  const normalized = String(discountType || "").trim().toLowerCase();

  if (["flat", "fixed", "fixed_amount", "amount"].includes(normalized)) {
    return "flat";
  }

  if (["percentage", "percent", "pct"].includes(normalized)) {
    return "percentage";
  }

  return normalized || "percentage";
}

export function readAppliedCoupon() {
  try {
    const raw = localStorage.getItem('appliedCoupon');
    if (!raw) return { code: '', coupon: null };
    const parsed = JSON.parse(raw);
    return {
      code: normalizeCouponCode(parsed?.code || ''),
      coupon: parsed?.coupon || null,
    };
  } catch (error) {
    return { code: '', coupon: null };
  }
}

export function writeAppliedCoupon(code = '', coupon = null) {
  if (!code && !coupon) {
    localStorage.removeItem('appliedCoupon');
    return;
  }

  localStorage.setItem('appliedCoupon', JSON.stringify({ code: normalizeCouponCode(code), coupon }));
}

export function clearAppliedCoupon() {
  localStorage.removeItem('appliedCoupon');
}

export function normalizeCartItem(item) {
  const unitPrice = Number(item?.unitPrice ?? item?.price ?? 0);
  const quantity = Math.max(1, Number(item?.quantity ?? 1) || 1);
  const free = item?.freeAsset || item?.isFree || unitPrice <= 0;

  return {
    ...item,
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
    quantity,
    freeAsset: free,
    lineTotal: free ? 0 : unitPrice * quantity,
  };
}

export function normalizeTaxSetting(tax = {}) {
  const type = tax.type === 'fixed' ? 'fixed' : 'percentage';
  const numericRate = Number(tax.rate || 0);
  const numericAmount = Number(tax.amount || 0);

  return {
    ...tax,
    id: tax.id ?? Date.now(),
    enabled: tax.enabled !== false,
    label: tax.label || 'GST',
    type,
    rate: type === 'fixed' ? 0 : numericRate,
    amount: type === 'fixed' ? numericAmount : 0,
  };
}

export function calculateCartTotals(items = [], options = {}) {
  const normalizedItems = (items || []).map(normalizeCartItem);
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const coupon = options.coupon || null;
  const taxSettings = Array.isArray(options.taxSettings) ? options.taxSettings.map(normalizeTaxSetting) : [];
  const currency = options.currency || 'USD';

  let discount = 0;
  if (coupon) {
    const discountType = normalizeCouponDiscountType(coupon.discountType ?? coupon.discount_type);
    if (discountType === 'percentage') {
      discount = subtotal * (Number(coupon.discountValue || 0) / 100);
    } else if (discountType === 'flat') {
      discount = Math.min(subtotal, Number(coupon.discountValue || 0));
    }
  }

  const taxableSubtotal = Math.max(0, subtotal - discount);
  const shouldZeroTaxes = taxableSubtotal <= 0;

  const taxBreakdown = taxSettings
    .filter((tax) => tax.enabled)
    .map((tax) => {
      const taxValue = shouldZeroTaxes
        ? 0
        : tax.type === 'fixed'
          ? Number(tax.amount || 0)
          : taxableSubtotal * (Number(tax.rate || 0) / 100);

      return {
        ...tax,
        value: Number(taxValue.toFixed(2)),
      };
    });

  const tax = taxBreakdown.reduce((sum, tax) => sum + tax.value, 0);
  const total = Math.max(0, Number((taxableSubtotal + tax).toFixed(2)));

  return {
    subtotal: Number(subtotal.toFixed(2)),
    discount: Number(discount.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    total,
    currency,
    items: normalizedItems,
    taxBreakdown,
  };
}
