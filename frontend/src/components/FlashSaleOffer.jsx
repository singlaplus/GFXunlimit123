import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import "./FlashSaleOffer.css";
import {
  calculateFlashSaleDiscount,
  getFlashSaleMetadata,
  getFlashSaleEligibleItems,
  getFlashSaleRequiredAssetCount
} from "../utils/cartCheckout";

const STORAGE_KEY = "appliedFlashSale";

function getStoredOffer() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return stored && typeof stored === "object" ? stored : {};
  } catch (error) {
    console.error("Invalid saved Flash Sale selection", error);
    return {};
  }
}

function getCartSignature(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item.id))
    .sort()
    .join(",");
}

function getRuleDescription(rule) {
  const normalized = String(rule || "").toUpperCase();
  if (normalized === "BOGO") return "Buy one, get one";
  if (normalized === "BOG2") return "Buy one, get two";
  if (normalized === "BOG3") return "Buy one, get three";
  if (normalized === "BOG5") return "Buy one, get five";
  return normalized === "percentage" ? "Percentage discount" : "Fixed amount discount";
}

function getBestFlashSaleOffer(items, candidates, currentSale, selectedAssetIds) {
  return candidates
    .map((sale) => {
      const eligible = getFlashSaleEligibleItems(items, sale);
      const count = getFlashSaleRequiredAssetCount(sale.discount_rule);
      const currentSelection = String(sale.id) === String(currentSale?.id)
        ? selectedAssetIds
        : [];
      const selected = count > 0 && currentSelection.length === count
        ? currentSelection
        : count > 0
          ? eligible
            .slice()
            .sort((a, b) => Number(b.unitPrice ?? b.price ?? 0) - Number(a.unitPrice ?? a.price ?? 0))
            .slice(0, count)
            .map((item) => String(item.id))
          : [];
      return {
        sale,
        selected,
        discount: calculateFlashSaleDiscount(items, sale, selected)
      };
    })
    .filter((candidate) => candidate.discount > 0)
    .sort((a, b) => b.discount - a.discount)[0] || null;
}

function getIncompleteBogoOffer(items, candidates) {
  return candidates
    .map((sale) => ({
      sale,
      eligibleItems: getFlashSaleEligibleItems(items, sale),
      requiredCount: getFlashSaleRequiredAssetCount(sale.discount_rule)
    }))
    .filter(({ eligibleItems, requiredCount }) => requiredCount > 0 && eligibleItems.length > 0 && eligibleItems.length < requiredCount)
    .sort((a, b) => b.eligibleItems.reduce((sum, item) => sum + Number(item.unitPrice ?? item.price ?? 0), 0)
      - a.eligibleItems.reduce((sum, item) => sum + Number(item.unitPrice ?? item.price ?? 0), 0))[0] || null;
}

export default function FlashSaleOffer({ items, subscriptionRestricted, darkMode = false, onChange, variant = "default", currency = null }) {
  const [sales, setSales] = useState([]);
  const [categories, setCategories] = useState([]);
  const [collections, setCollections] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [offer, setOffer] = useState(getStoredOffer);
  const [isChoosingAssets, setIsChoosingAssets] = useState(false);
  const [showEligibilityDialog, setShowEligibilityDialog] = useState(false);
  const previousCartSignature = useRef(getCartSignature(items));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let active = true;
    axios.get(`${API_BASE_URL}/checkout/active-flash-sales`)
      .then((response) => {
        const payload = response.data || {};
        if (!Array.isArray(payload.sales) || !Array.isArray(payload.categories) || !Array.isArray(payload.collections)) {
          throw new Error("Active Flash Sale response was invalid.");
        }
        if (active) {
          setSales(payload.sales);
          setCategories(payload.categories);
          setCollections(payload.collections);
        }
      })
      .catch((error) => {
        console.error("Failed to load active Flash Sales", error);
        if (active) setLoadError(error.response?.data?.error || "Unable to load Flash Sales.");
      });

    return () => {
      active = false;
    };
  }, []);

  const candidates = useMemo(() => {
    if (subscriptionRestricted || items.some((item) => item.subscription || item.creditPackage)) return [];
    return sales
      .map((sale) => {
        const metadata = getFlashSaleMetadata(sale);
        return {
          ...sale,
          featured_category_name: categories.find((category) => String(category.id) === String(metadata.featured_category_id))?.name || "",
          featured_collection_name: collections.find((collection) => String(collection.id) === String(metadata.featured_collection_id))?.name || ""
        };
      })
      .filter((sale) => getFlashSaleEligibleItems(items, sale).length > 0);
  }, [sales, categories, collections, items, subscriptionRestricted]);

  const configuredSales = useMemo(() => sales.map((sale) => {
    const metadata = getFlashSaleMetadata(sale);
    return {
      ...sale,
      featured_category_name: categories.find((category) => String(category.id) === String(metadata.featured_category_id))?.name || "",
      featured_collection_name: collections.find((collection) => String(collection.id) === String(metadata.featured_collection_id))?.name || ""
    };
  }), [sales, categories, collections]);
  const selectedSale = configuredSales.find((sale) => String(sale.id) === String(offer.saleId)) || null;
  const eligibleItems = selectedSale ? getFlashSaleEligibleItems(items, selectedSale) : [];
  const requiredAssetCount = selectedSale ? getFlashSaleRequiredAssetCount(selectedSale.discount_rule) : 0;
  const selectedAssetIds = useMemo(
    () => Array.isArray(offer.selectedAssetIds) ? offer.selectedAssetIds.map(String) : [],
    [offer.selectedAssetIds]
  );
  const selectedOfferItems = eligibleItems.filter((item) => selectedAssetIds.includes(String(item.id)));
  const highestPriceItem = selectedOfferItems.reduce((highest, item) => (
    !highest || Number(item.unitPrice ?? item.price ?? 0) > Number(highest.unitPrice ?? highest.price ?? 0)
      ? item
      : highest
  ), null);
  const flashSaleDiscount = selectedSale
    ? calculateFlashSaleDiscount(items, selectedSale, selectedAssetIds)
    : 0;
  const isPremiumVariant = variant === "cart" || variant === "checkout";
  const normalizedRule = String(selectedSale?.discount_rule || "").toUpperCase();
  const discountValue = Number(selectedSale ? getFlashSaleMetadata(selectedSale).discount_value || 0 : 0);
  const formattedDiscount = new Intl.NumberFormat("en-US", currency
    ? { style: "currency", currency, maximumFractionDigits: 2 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  ).format(flashSaleDiscount);
  const cartSignature = getCartSignature(items);
  const isDismissedForCart = offer.dismissedForCartSignature === cartSignature;
  const incompleteBogoOffer = !selectedSale ? getIncompleteBogoOffer(items, candidates) : null;
  const reapplicableOffer = isDismissedForCart
    ? getBestFlashSaleOffer(items, candidates, selectedSale, selectedAssetIds)
    : null;

  useEffect(() => {
    if (candidates.length === 0 || subscriptionRestricted) {
      onChangeRef.current?.(null);
      return;
    }

    const savedSale = candidates.find((sale) => String(sale.id) === String(offer.saleId));
    const signatureMatchesDismissal = offer.dismissedForCartSignature === cartSignature;
    if (!savedSale && offer.saleId && !signatureMatchesDismissal) {
      onChangeRef.current?.(null);
    } else if (savedSale && !signatureMatchesDismissal) {
      onChangeRef.current?.(flashSaleDiscount > 0 ? {
        sale: savedSale,
        selectedAssetIds,
        discount: flashSaleDiscount
      } : null);
    } else {
      onChangeRef.current?.(null);
    }
  }, [candidates, offer, items, selectedAssetIds, cartSignature, subscriptionRestricted, flashSaleDiscount]);

  useEffect(() => {
    const previousSignature = previousCartSignature.current;
    if (previousSignature !== cartSignature && selectedSale && requiredAssetCount > 0) {
      const selectedStillPresent = selectedAssetIds.every((id) => items.some((item) => String(item.id) === id));
      if (!selectedStillPresent || selectedAssetIds.length !== requiredAssetCount) {
        setShowEligibilityDialog(true);
      }
    }
    previousCartSignature.current = cartSignature;
  }, [cartSignature, items, selectedSale, requiredAssetCount, selectedAssetIds]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(offer));
  }, [offer]);

  useEffect(() => {
    if (candidates.length === 0 || offer.dismissedForCartSignature === cartSignature) return;

    const bestOffer = getBestFlashSaleOffer(items, candidates, selectedSale, selectedAssetIds);

    if (!bestOffer) return;
    const removedSelectedAsset = selectedSale
      && getFlashSaleRequiredAssetCount(selectedSale.discount_rule) > 0
      && selectedAssetIds.length > 0
      && selectedAssetIds.some((id) => !items.some((item) => String(item.id) === id));
    if (removedSelectedAsset) return;

    if (String(bestOffer.sale.id) !== String(selectedSale?.id)) {
      setOffer({ saleId: bestOffer.sale.id, selectedAssetIds: bestOffer.selected });
    } else if (selectedAssetIds.length === 0 && bestOffer.selected.length > 0) {
      setOffer((current) => ({ ...current, selectedAssetIds: bestOffer.selected }));
    }
  }, [candidates, selectedSale, selectedAssetIds, items, offer.dismissedForCartSignature, cartSignature]);

  const updateSelection = (nextIds) => {
    setOffer((current) => ({ ...current, selectedAssetIds: nextIds.map(String) }));
  };

  const toggleAsset = (assetId) => {
    const id = String(assetId);
    const selected = new Set(selectedAssetIds);
    if (selected.has(id)) {
      selected.delete(id);
    } else if (selected.size < requiredAssetCount) {
      selected.add(id);
    }
    updateSelection([...selected]);
  };

  const removeFlashSale = () => {
    setOffer({ dismissedForCartSignature: cartSignature });
    setShowEligibilityDialog(false);
    setIsChoosingAssets(false);
    onChangeRef.current?.(null);
  };

  const reapplyFlashSale = () => {
    if (!reapplicableOffer) return;
    setOffer({
      saleId: reapplicableOffer.sale.id,
      selectedAssetIds: reapplicableOffer.selected
    });
    setIsChoosingAssets(false);
  };

  const selectReplacementAssets = () => {
    updateSelection([]);
    setShowEligibilityDialog(false);
    setIsChoosingAssets(true);
  };

  if (subscriptionRestricted || items.some((item) => item.subscription || item.creditPackage)) return null;

  const cardStyle = {
    display: "grid",
    gap: 10,
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    background: darkMode ? "rgba(255,255,255,0.06)" : "#fff7ed",
    border: darkMode ? "1px solid rgba(255,255,255,0.12)" : "1px solid #fed7aa",
    color: darkMode ? "#f8fafc" : "#7c2d12"
  };

  return (
    <>
      {loadError && <div role="alert" style={{ marginTop: 12, color: "#dc2626" }}>{loadError}</div>}
      {!selectedSale && reapplicableOffer && (
        <section
          aria-label="Flash Sale Available"
          className={`flash-sale-cart-card flash-sale-cart-reapply${darkMode ? " is-dark" : ""}`}
          style={isPremiumVariant ? undefined : cardStyle}
        >
          <div className="flash-sale-cart-reapply-copy">
            <strong>Flash Sale Available</strong>
            <span>
              {reapplicableOffer.discount > 0
                ? "Your eligible offer is still available for this cart."
                : `Add ${getFlashSaleRequiredAssetCount(reapplicableOffer.sale.discount_rule) - reapplicableOffer.selected.length} more eligible asset${getFlashSaleRequiredAssetCount(reapplicableOffer.sale.discount_rule) - reapplicableOffer.selected.length === 1 ? "" : "s"} to apply this ${String(reapplicableOffer.sale.discount_rule).toUpperCase()} offer.`}
            </span>
          </div>
          <button type="button" className="flash-sale-cart-reapply-button" onClick={reapplyFlashSale}>
            Apply now
          </button>
        </section>
      )}
      {!selectedSale && !reapplicableOffer && incompleteBogoOffer && (
        <section
          aria-label="Flash Sale Available"
          className={isPremiumVariant ? `flash-sale-cart-card flash-sale-cart-reapply${darkMode ? " is-dark" : ""}` : undefined}
          style={isPremiumVariant ? undefined : cardStyle}
        >
          <div className="flash-sale-cart-reapply-copy">
            <strong>Flash Sale {String(incompleteBogoOffer.sale.discount_rule).toUpperCase()} available</strong>
            <span>
              Add {incompleteBogoOffer.requiredCount - incompleteBogoOffer.eligibleItems.length} more eligible asset
              {incompleteBogoOffer.requiredCount - incompleteBogoOffer.eligibleItems.length === 1 ? "" : "s"} to your cart
              ({incompleteBogoOffer.requiredCount} total) to unlock {String(incompleteBogoOffer.sale.discount_rule).toUpperCase()}.
            </span>
          </div>
        </section>
      )}
      {selectedSale && (
        <section
          aria-label="Flash Sale"
          className={isPremiumVariant ? `flash-sale-cart-card${darkMode ? " is-dark" : ""}` : undefined}
          style={isPremiumVariant ? undefined : cardStyle}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div className={isPremiumVariant ? "flash-sale-cart-heading" : undefined}>
            {isPremiumVariant && (
              <span className={`flash-sale-cart-badge${flashSaleDiscount > 0 ? " is-applied" : ""}`}>
                {flashSaleDiscount > 0 ? "APPLIED" : "OFFER"}
              </span>
            )}
            <strong className={isPremiumVariant ? "flash-sale-cart-title" : undefined}>
              {isPremiumVariant
                ? requiredAssetCount > 0
                  ? `Flash Sale ${normalizedRule} ${flashSaleDiscount > 0 ? "applied" : "available"}`
                  : `Flash Sale discount ${flashSaleDiscount > 0 ? "applied" : "available"}`
                : selectedSale.name || "Flash Sale"}
            </strong>
            <div className={isPremiumVariant ? "flash-sale-cart-description" : undefined}>
              {requiredAssetCount > 0
                ? getRuleDescription(selectedSale.discount_rule)
                : normalizedRule === "PERCENTAGE"
                  ? `${discountValue}% off eligible assets`
                  : "Fixed amount off eligible assets"}
            </div>
            {flashSaleDiscount > 0 && (
              <div className={isPremiumVariant ? "flash-sale-cart-savings" : undefined}>
                <span>{isPremiumVariant ? "You save" : "Flash Sale discount:"}</span>
                <strong>-{isPremiumVariant ? formattedDiscount : flashSaleDiscount.toFixed(2)}</strong>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={removeFlashSale}
            aria-label="Remove Flash Sale"
            className={isPremiumVariant ? "flash-sale-cart-remove" : undefined}
          >
            Remove
          </button>
        </div>
        {requiredAssetCount > 0 && (
          <div className={isPremiumVariant ? "flash-sale-cart-assets" : undefined}>
            <div className={isPremiumVariant ? "flash-sale-cart-prompt" : undefined}>
              {flashSaleDiscount > 0
                ? `Your ${normalizedRule} offer is applied to these assets.`
                : eligibleItems.length < requiredAssetCount
                  ? `Add ${requiredAssetCount - eligibleItems.length} more eligible asset${requiredAssetCount - eligibleItems.length === 1 ? "" : "s"} to your cart (${requiredAssetCount} total) to unlock ${normalizedRule}.`
                  : selectedAssetIds.length < requiredAssetCount
                    ? `Select ${requiredAssetCount - selectedAssetIds.length} more eligible asset${requiredAssetCount - selectedAssetIds.length === 1 ? "" : "s"} for this offer.`
                    : `Select ${requiredAssetCount} eligible assets for this offer.`}
            </div>
            {eligibleItems.map((item) => {
              const checked = selectedAssetIds.includes(String(item.id));
              const selectionFull = selectedAssetIds.length >= requiredAssetCount;
              return (
                <label key={item.id} className={isPremiumVariant ? "flash-sale-cart-asset" : undefined} style={isPremiumVariant ? undefined : { display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && selectionFull}
                      onChange={() => toggleAsset(item.id)}
                    />
                    <span>
                      {item.title || `Asset ${item.id}`} — {Number(item.unitPrice ?? item.price ?? 0).toFixed(2)}
                      {checked && selectedAssetIds.length === requiredAssetCount && (
                        isPremiumVariant ? (
                          <span className={`flash-sale-cart-asset-status${String(highestPriceItem?.id) === String(item.id) ? " is-charged" : " is-free"}`}>
                            {String(highestPriceItem?.id) === String(item.id) ? "Charged" : "Free"}
                          </span>
                        ) : String(highestPriceItem?.id) === String(item.id) ? " (charged)" : " (free)"
                      )}
                    </span>
                  </label>
                );
              })}
              {selectedAssetIds.length !== requiredAssetCount && (
                <div role="status" style={{ marginTop: 8 }}>
                  Choose {Math.max(0, requiredAssetCount - selectedAssetIds.length)} more asset{requiredAssetCount - selectedAssetIds.length === 1 ? "" : "s"} to apply this sale.
                </div>
              )}
              {isChoosingAssets && <div role="status">Choose eligible assets to keep the Flash Sale applied.</div>}
            </div>
          )}
        </section>
      )}
      {showEligibilityDialog && selectedSale && (
        <div className={`flash-sale-dialog-backdrop${darkMode ? " is-dark" : ""}`} role="dialog" aria-modal="true" aria-labelledby="flash-sale-dialog-title">
          <div className="flash-sale-dialog">
            <div className="flash-sale-dialog-icon" aria-hidden="true">!</div>
            <span className="flash-sale-dialog-eyebrow">FLASH SALE UPDATE</span>
            <h2 id="flash-sale-dialog-title">Your selection has changed</h2>
            <p>Your cart no longer matches the assets selected for this offer. Choose a new eligible set to keep the savings, or remove the Flash Sale.</p>
            <div className="flash-sale-dialog-actions">
              <button type="button" className="flash-sale-dialog-remove" onClick={removeFlashSale}>Remove Flash Sale</button>
              {eligibleItems.length >= requiredAssetCount && (
                <button type="button" className="flash-sale-dialog-choose" onClick={selectReplacementAssets}>Choose assets</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
