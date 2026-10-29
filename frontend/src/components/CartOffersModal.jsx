import {
  calculateBestBundleTierDiscount,
  calculateFlashSaleDiscount,
  getFlashSaleMetadata,
  getFlashSaleEligibleItems,
  getFlashSaleRequiredAssetCount,
} from "../utils/cartCheckout";
import "./CartOffersModal.css";

function getCouponDescription(coupon) {
  const type = String(coupon.discount_type || "").toLowerCase();
  if (type === "percentage") return `${Number(coupon.discount_value || 0)}% off`;
  if (type === "free_asset") return "Free asset";
  return `${String(type || "discount").replace(/_/g, " ")}: ${Number(coupon.discount_value || 0)}`;
}

function getFlashSaleDescription(sale) {
  const rule = String(sale.discount_rule || "").toUpperCase();
  const metadata = getFlashSaleMetadata(sale);
  if (rule === "PERCENTAGE") return `${Number(metadata.discount_value || 0)}% off eligible assets`;
  if (rule === "FIXED_AMOUNT") return `Fixed discount of ${Number(metadata.discount_value || 0)}`;
  if (rule === "BOGO") return "Buy one, get one";
  if (rule === "BOG2") return "Buy one, get two";
  if (rule === "BOG3") return "Buy one, get three";
  if (rule === "BOG5") return "Buy one, get five";
  return "Flash Sale";
}

export default function CartOffersModal({
  open,
  onClose,
  darkMode,
  items,
  coupons,
  appliedCoupon,
  couponError,
  onApplyCoupon,
  flashSales,
  appliedFlashSale,
  onApplyFlashSale,
  bundleOffers,
  appliedBundleOfferId,
  bundleApplicationActive = true,
  onApplyBundle,
  subscriptionRestricted,
}) {
  if (!open) return null;

  const restrictedItems = subscriptionRestricted || items.some((item) => item.subscription || item.creditPackage);
  const appliedCouponId = String(appliedCoupon?.id || "");
  const appliedSaleId = String(appliedFlashSale?.sale?.id || "");
  const activeBundle = bundleApplicationActive
    ? calculateBestBundleTierDiscount(items, bundleOffers, appliedBundleOfferId)
    : { offer: null, assetCount: 0, tier: null, discount: 0 };

  const applyCoupon = async (code) => {
    const applied = await onApplyCoupon(code);
    if (applied) onClose();
  };

  return (
    <div className={`cart-offers-backdrop${darkMode ? " is-dark" : ""}`} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="cart-offers-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-offers-title"
      >
        <header className="cart-offers-header">
          <div>
            <span className="cart-offers-eyebrow">PROMOTIONS</span>
            <h2 id="cart-offers-title">Available offers</h2>
            <p>Offers are checked against your cart before they are applied.</p>
          </div>
          <button type="button" className="cart-offers-close" aria-label="Close offers" onClick={onClose}>×</button>
        </header>

        {couponError && <p className="cart-offers-error" role="alert">{couponError}</p>}

        <div className="cart-offers-content">
          <section className="cart-offers-group" aria-labelledby="cart-offers-coupons">
            <h3 id="cart-offers-coupons">Coupons</h3>
            {coupons.length === 0 ? <p className="cart-offers-empty">No eligible coupons are available.</p> : coupons.map((coupon) => {
              const isApplied = appliedCouponId && appliedCouponId === String(coupon.id);
              const isFirstOrder = String(coupon.coupon_type || coupon.couponType || "").toLowerCase() === "first_order";
              const assetCount = new Set(items.filter((item) => !item.creditPackage && !item.subscription && item.id != null).map((item) => String(item.id))).size;
              const firstOrderBlocked = isFirstOrder && (restrictedItems || assetCount > 2);
              return (
                <article className="cart-offer-item" key={`coupon-${coupon.id}`}>
                  <div className="cart-offer-copy">
                    <strong>{coupon.name || coupon.code}</strong>
                    <span>{coupon.code} · {getCouponDescription(coupon)}</span>
                    {firstOrderBlocked && <small>First Order coupons apply to asset carts with no more than 2 distinct assets.</small>}
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(isApplied || firstOrderBlocked)}
                    onClick={() => applyCoupon(coupon.code)}
                  >
                    {isApplied ? "Applied" : firstOrderBlocked ? "Not eligible" : "Apply"}
                  </button>
                </article>
              );
            })}
          </section>

          <section className="cart-offers-group" aria-labelledby="cart-offers-flash-sales">
            <h3 id="cart-offers-flash-sales">Flash Sales</h3>
            {flashSales.length === 0 ? <p className="cart-offers-empty">No active Flash Sales are available.</p> : flashSales.map((sale) => {
              const requiredCount = getFlashSaleRequiredAssetCount(sale.discount_rule);
              const eligibleItems = restrictedItems ? [] : getFlashSaleEligibleItems(items, sale);
              const selectedIds = requiredCount
                ? eligibleItems
                  .slice()
                  .sort((left, right) => Number(right.unitPrice ?? right.price ?? 0) - Number(left.unitPrice ?? left.price ?? 0))
                  .slice(0, requiredCount)
                  .map((item) => String(item.id))
                : [];
              const discount = !restrictedItems && (
                requiredCount === 0 || eligibleItems.length >= requiredCount
              ) ? calculateFlashSaleDiscount(items, sale, selectedIds) : 0;
              const eligible = discount > 0;
              const isApplied = appliedSaleId === String(sale.id) && appliedFlashSale?.discount > 0;
              return (
                <article className="cart-offer-item" key={`flash-sale-${sale.id}`}>
                  <div className="cart-offer-copy">
                    <strong>{sale.name}</strong>
                    <span>{getFlashSaleDescription(sale)}</span>
                    {!eligible && <small>{restrictedItems ? "Not available for this cart." : requiredCount > eligibleItems.length ? `Add ${requiredCount - eligibleItems.length} eligible asset${requiredCount - eligibleItems.length === 1 ? "" : "s"} to qualify.` : "No cart items qualify for this sale."}</small>}
                  </div>
                  <button
                    type="button"
                    disabled={!eligible || isApplied}
                    onClick={() => {
                      onApplyFlashSale(sale);
                      onClose();
                    }}
                  >
                    {isApplied ? "Applied" : eligible ? "Apply" : "Not eligible"}
                  </button>
                </article>
              );
            })}
          </section>

          <section className="cart-offers-group" aria-labelledby="cart-offers-bundles">
            <h3 id="cart-offers-bundles">Bundle Discounts</h3>
            {bundleOffers.length === 0 ? <p className="cart-offers-empty">No active Bundle Discounts are available.</p> : bundleOffers.map((offer) => {
              const deal = calculateBestBundleTierDiscount(items, [offer]);
              const eligible = String(deal.offer?.id || "") === String(offer.id) && deal.discount > 0;
              const isApplied = eligible && String(activeBundle.offer?.id || "") === String(offer.id);
              const nextTier = (offer.metadata?.discount_tiers || [])
                .map((tier) => Number(tier.asset_count))
                .filter((count) => Number.isInteger(count) && count > deal.assetCount)
                .sort((left, right) => left - right)[0];
              return (
                <article className="cart-offer-item" key={`bundle-${offer.id}`}>
                  <div className="cart-offer-copy">
                    <strong>{offer.name}</strong>
                    <span>{(offer.metadata?.discount_tiers || []).map((tier) => `${tier.asset_count} assets · ${tier.discount_percent}%`).join(" / ")}</span>
                    {!eligible && <small>{restrictedItems ? "Not available for this cart." : nextTier ? `Add ${Math.max(0, nextTier - deal.assetCount)} more paid asset${nextTier - deal.assetCount === 1 ? "" : "s"} to qualify.` : "This offer is not eligible for the cart."}</small>}
                  </div>
                  <button
                    type="button"
                    disabled={!eligible || isApplied}
                    onClick={() => {
                      onApplyBundle(offer.id);
                      onClose();
                    }}
                  >
                    {isApplied ? "Applied" : eligible ? "Apply" : "Not eligible"}
                  </button>
                </article>
              );
            })}
          </section>
        </div>
      </section>
    </div>
  );
}
