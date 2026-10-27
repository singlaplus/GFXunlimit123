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

export function getFlashSaleMetadata(flashSale = {}) {
  if (typeof flashSale.metadata === 'string') {
    try {
      return JSON.parse(flashSale.metadata);
    } catch (error) {
      console.error('Invalid Flash Sale metadata', error);
      return {};
    }
  }
  return flashSale.metadata && typeof flashSale.metadata === 'object' ? flashSale.metadata : {};
}

export function getFlashSaleRequiredAssetCount(discountRule = '') {
  const rule = String(discountRule).toUpperCase();
  if (rule === 'BOGO') return 2;
  if (rule === 'BOG2') return 3;
  if (rule === 'BOG3') return 4;
  if (rule === 'BOG5') return 6;
  return 0;
}

export function getFlashSaleEligibleItems(items = [], flashSale = {}) {
  const metadata = getFlashSaleMetadata(flashSale);
  const placement = String(flashSale.featured_placement || 'homepage').toLowerCase();
  const categoryId = String(metadata.featured_category_id ?? '');
  const collectionId = String(metadata.featured_collection_id ?? '');
  const keywords = String(metadata.keywords || '')
    .split(/[,\s]+/)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);

  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!item || item.creditPackage || item.subscription || item.freeAsset || item.isFree || Number(item.unitPrice ?? item.price ?? 0) <= 0) {
      return false;
    }

    let matchesPlacement = placement === 'homepage';
    if (placement === 'category') {
      matchesPlacement = categoryId === 'all'
        ? Boolean(String(item.category || '').trim())
        : String(item.category || '').trim().toLowerCase() === String(flashSale.featured_category_name || '').trim().toLowerCase();
    } else if (placement === 'collection') {
      matchesPlacement = collectionId === 'all'
        ? Boolean(String(item.collection || '').trim())
        : String(item.collection || '').trim().toLowerCase() === String(flashSale.featured_collection_name || '').trim().toLowerCase();
    }

    if (!matchesPlacement) return false;
    if (keywords.length === 0) return true;
    const itemKeywords = new Set(
      String(item.keywords || '')
        .split(/[,\s]+/)
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean)
    );
    return keywords.some((keyword) => itemKeywords.has(keyword));
  });
}

export function calculateFlashSaleDiscount(items = [], flashSale = null, selectedAssetIds = []) {
  if (!flashSale) return 0;
  const eligibleItems = getFlashSaleEligibleItems(items, flashSale);
  const rule = String(flashSale.discount_rule || '').toUpperCase();
  const metadata = getFlashSaleMetadata(flashSale);

  if (rule === 'PERCENTAGE') {
    const eligibleSubtotal = eligibleItems.reduce(
      (sum, item) => sum + Number(item.unitPrice ?? item.price ?? 0) * Math.max(1, Number(item.quantity || 1)),
      0
    );
    const percentage = Math.min(100, Math.max(0, Number(metadata.discount_value || 0)));
    return Number((eligibleSubtotal * percentage / 100).toFixed(2));
  }

  if (rule === 'FIXED_AMOUNT') {
    const eligibleSubtotal = eligibleItems.reduce(
      (sum, item) => sum + Number(item.unitPrice ?? item.price ?? 0) * Math.max(1, Number(item.quantity || 1)),
      0
    );
    return Number(Math.min(eligibleSubtotal, Math.max(0, Number(metadata.discount_value || 0))).toFixed(2));
  }

  const requiredCount = getFlashSaleRequiredAssetCount(rule);
  if (!requiredCount) return 0;
  const selectedIds = new Set((Array.isArray(selectedAssetIds) ? selectedAssetIds : []).map(String));
  const selectedItems = eligibleItems.filter((item) => selectedIds.has(String(item.id)));
  if (selectedItems.length !== requiredCount || selectedIds.size !== requiredCount) return 0;

  const prices = selectedItems.map((item) => Number(item.unitPrice ?? item.price ?? 0));
  const highestPrice = Math.max(...prices);
  return Number(Math.max(0, prices.reduce((sum, price) => sum + price, 0) - highestPrice).toFixed(2));
}

export function calculateCartTotals(items = [], options = {}) {
  const normalizedItems = (items || []).map(normalizeCartItem);
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const coupon = options.coupon || null;
  const flashSaleDiscount = Math.max(0, Number(options.flashSaleDiscount || 0));
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

  discount = Math.min(subtotal, Number((discount + flashSaleDiscount).toFixed(2)));
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
