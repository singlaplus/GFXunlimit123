import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { isAdminRole, normalizeRole } from "../utils/role";
import { getAssetThumbnailUrl } from "../utils/assetPreview";
import { getEffectiveAuthToken } from "../utils/authSession";
import { likeImageRequest } from "../services/imageService";
import { loadCartItems, saveCartItems } from "../utils/cartPersistence";
import "./PromotionalBannerExperience.css";

const ADMIN_BASE_PATH = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
const POPUP_DISMISSALS_KEY = "dismissedPromotionalBannerPopups";
const POPUP_REPEAT_DISMISSALS_KEY = "promotionalBannerPopupRepeatDismissals";
const BANNER_REFRESH_INTERVAL_MS = 60 * 1000;
const POPUP_REPEAT_DELAY_MS = 2 * 60 * 1000;
const PROMOTIONAL_BANNER_SPARKLE_STYLES = new Set([
  "none",
  "glitter_burst",
  "twinkle",
  "falling_sparkles",
  "snowfall",
  "shimmer_sweep",
  "fireflies",
  "star_trail",
  "pulsing_glow",
  "aurora_glow",
  "confetti_sparkles",
  "orbiting_sparkles"
]);

function isHomepage(pathname) {
  return pathname === "/" || pathname === "/home";
}

function getAssetPageUrl(asset) {
  const assetSlug = String(asset.title || asset.filename || "asset")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";
  return `/asset/${assetSlug}-${asset.id}`;
}

function isAdminPage(pathname) {
  return pathname === "/admin"
    || pathname.startsWith("/admin/")
    || pathname === ADMIN_BASE_PATH
    || pathname.startsWith(`${ADMIN_BASE_PATH}/`);
}

function getPopupAudience(banner) {
  const metadata = typeof banner.metadata === "string"
    ? (() => {
      try {
        return JSON.parse(banner.metadata);
      } catch (error) {
        console.error("Invalid public promotional banner metadata", error);
        return {};
      }
    })()
    : banner.metadata || {};
  return String(metadata.popup_audience || "").trim().toLowerCase();
}

function getSparkleClassName(banner) {
  let metadata = banner.metadata || {};
  if (typeof metadata === "string") {
    try {
      metadata = JSON.parse(metadata);
    } catch (error) {
      console.error("Invalid public promotional banner metadata", error);
      metadata = {};
    }
  }
  const style = String(metadata.sparkle_style || "glitter_burst").trim().toLowerCase();
  return PROMOTIONAL_BANNER_SPARKLE_STYLES.has(style)
    ? `promotion-banner-placement-link--${style}`
    : "promotion-banner-placement-link--glitter_burst";
}

function getDismissedPopupIds() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(POPUP_DISMISSALS_KEY) || "[]");
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch (error) {
    console.error("Unable to read dismissed promotional banners", error);
    return [];
  }
}

function getPopupRepeatDismissals() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(POPUP_REPEAT_DISMISSALS_KEY) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch (error) {
    console.error("Unable to read promotional banner repeat dismissals", error);
    return {};
  }
}

export function PromotionalBannerPlacements({
  userRole = "",
  pathname = "/",
  authStatus = "anonymous"
}) {
  const [banners, setBanners] = useState([]);
  const [dismissedPopupIds, setDismissedPopupIds] = useState(getDismissedPopupIds);
  const [popupRepeatDismissals, setPopupRepeatDismissals] = useState(getPopupRepeatDismissals);
  const [popupClock, setPopupClock] = useState(Date.now());
  const normalizedRole = normalizeRole(userRole);
  const isPublicDisplayEnabled = authStatus !== "pending"
    && !isAdminRole(normalizedRole)
    && !isAdminPage(pathname)
    && !pathname.startsWith("/promotionbanners/");

  useEffect(() => {
    if (!isPublicDisplayEnabled) {
      setBanners([]);
      return undefined;
    }

    let active = true;
    const loadBanners = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/public/promotional-banners`);
        if (!Array.isArray(response.data?.banners)) {
          throw new Error("Public promotional banner response was invalid.");
        }
        if (active) setBanners(response.data.banners);
      } catch (error) {
        console.error("Unable to load public promotional banners", error);
      }
    };

    loadBanners();
    const intervalId = window.setInterval(loadBanners, BANNER_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [isPublicDisplayEnabled]);

  useEffect(() => {
    if (isHomepage(pathname)) return;
    const bannersToMark = banners.filter((banner) => {
      const audience = getPopupAudience(banner);
      if (!["logged_in_customers", "logged_in_contributors"].includes(audience)) return false;
      const dismissal = popupRepeatDismissals[String(banner.id)];
      return dismissal && !dismissal.visitedOtherPage;
    });
    if (bannersToMark.length === 0) return;

    const nextDismissals = { ...popupRepeatDismissals };
    bannersToMark.forEach((banner) => {
      const id = String(banner.id);
      nextDismissals[id] = { ...nextDismissals[id], visitedOtherPage: true };
    });
    setPopupRepeatDismissals(nextDismissals);
    try {
      window.sessionStorage.setItem(POPUP_REPEAT_DISMISSALS_KEY, JSON.stringify(nextDismissals));
    } catch (error) {
      console.error("Unable to save promotional banner repeat dismissals", error);
    }
  }, [banners, pathname, popupRepeatDismissals]);

  useEffect(() => {
    const remainingDelay = Object.values(popupRepeatDismissals)
      .filter((dismissal) => dismissal?.visitedOtherPage && Number.isFinite(dismissal.dismissedAt))
      .reduce((minimum, dismissal) => Math.min(
        minimum,
        Math.max(0, dismissal.dismissedAt + POPUP_REPEAT_DELAY_MS - Date.now())
      ), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(remainingDelay)) return undefined;
    const timeoutId = window.setTimeout(() => setPopupClock(Date.now()), remainingDelay);
    return () => window.clearTimeout(timeoutId);
  }, [popupRepeatDismissals]);

  const placedBanners = useMemo(() => banners.filter((banner) => (
    ["left", "right", "up", "down"].includes(String(banner.placement || "").toLowerCase())
  )), [banners]);
  const popupBanner = useMemo(() => {
    if (!isHomepage(pathname)) return null;
    const audienceRole = normalizeRole(userRole);
    return banners.find((banner) => {
      if (String(banner.placement || "").toLowerCase() !== "popup") return false;
      const audience = getPopupAudience(banner);
      if (audience === "homepage") {
        return !dismissedPopupIds.includes(String(banner.id));
      }
      if (audience === "logged_in_customers" && ["customer", "buyer"].includes(audienceRole)) {
        const dismissal = popupRepeatDismissals[String(banner.id)];
        return !dismissal || (
          dismissal.visitedOtherPage
          && Number.isFinite(dismissal.dismissedAt)
          && Math.max(popupClock, Date.now()) >= dismissal.dismissedAt + POPUP_REPEAT_DELAY_MS
        );
      }
      if (audience === "logged_in_contributors" && audienceRole === "contributor") {
        const dismissal = popupRepeatDismissals[String(banner.id)];
        return !dismissal || (
          dismissal.visitedOtherPage
          && Number.isFinite(dismissal.dismissedAt)
          && Math.max(popupClock, Date.now()) >= dismissal.dismissedAt + POPUP_REPEAT_DELAY_MS
        );
      }
      return false;
    }) || null;
  }, [banners, dismissedPopupIds, popupClock, popupRepeatDismissals, pathname, userRole]);

  if (!isPublicDisplayEnabled) return null;

  const dismissPopup = () => {
    const audience = getPopupAudience(popupBanner);
    if (["logged_in_customers", "logged_in_contributors"].includes(audience)) {
      const nextDismissals = {
        ...popupRepeatDismissals,
        [String(popupBanner.id)]: {
          dismissedAt: Date.now(),
          visitedOtherPage: false
        }
      };
      setPopupRepeatDismissals(nextDismissals);
      try {
        window.sessionStorage.setItem(POPUP_REPEAT_DISMISSALS_KEY, JSON.stringify(nextDismissals));
      } catch (error) {
        console.error("Unable to save promotional banner repeat dismissals", error);
      }
      return;
    }

    const nextDismissed = [...new Set([...dismissedPopupIds, String(popupBanner.id)])];
    setDismissedPopupIds(nextDismissed);
    try {
      window.sessionStorage.setItem(POPUP_DISMISSALS_KEY, JSON.stringify(nextDismissed));
    } catch (error) {
      console.error("Unable to save dismissed promotional banners", error);
    }
  };

  return (
    <>
      {["left", "right", "up", "down"].map((placement) => {
        const matchingBanners = placedBanners.filter(
          (banner) => String(banner.placement || "").toLowerCase() === placement
        );
        if (matchingBanners.length === 0) return null;
        return (
          <div
            key={placement}
            className={`promotion-banner-placement promotion-banner-placement--${placement}`}
            aria-label={`${placement} promotional banners`}
          >
            {matchingBanners.map((banner) => (
              <a
                key={banner.id}
                className={`promotion-banner-placement-link ${getSparkleClassName(banner)}`}
                href={`/promotionbanners/${encodeURIComponent(banner.slug)}`}
                aria-label={`Open promotion: ${banner.name}`}
                title={banner.name}
              >
                <img src={`${API_BASE_URL}${banner.icon_url}`} alt={banner.name} />
              </a>
            ))}
          </div>
        );
      })}
      {popupBanner && (
        <div
          className="promotion-banner-popup-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismissPopup();
          }}
        >
          <section
            className="promotion-banner-popup"
            role="dialog"
            aria-modal="true"
            aria-label={`${popupBanner.name} promotion`}
          >
            <button
              type="button"
              className="promotion-banner-popup-close"
              aria-label="Close promotion"
              onClick={dismissPopup}
            >
              ×
            </button>
            <a
              className="promotion-banner-popup-link"
              href={`/promotionbanners/${encodeURIComponent(popupBanner.slug)}`}
            >
              <img src={`${API_BASE_URL}${popupBanner.icon_url}`} alt="" />
              <strong>{popupBanner.name}</strong>
              <span>View promotion</span>
            </a>
          </section>
        </div>
      )}
    </>
  );
}

export default function PromotionalBannerPage({ slug, userRole = "" }) {
  const [banner, setBanner] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [likedAssetIds, setLikedAssetIds] = useState([]);
  const [addedAssetIds, setAddedAssetIds] = useState([]);
  const [assetActionMessage, setAssetActionMessage] = useState("");
  const isAdmin = isAdminRole(normalizeRole(userRole));
  const normalizedRole = normalizeRole(userRole);
  const isLoggedInCustomer = ["customer", "buyer"].includes(normalizedRole)
    && Boolean(getEffectiveAuthToken());
  const isContributor = normalizedRole === "contributor";

  useEffect(() => {
    if (isAdmin) return undefined;
    let active = true;
    setBanner(null);
    setErrorMessage("");
    axios.get(`${API_BASE_URL}/public/promotional-banners/${encodeURIComponent(slug)}`)
      .then((response) => {
        if (!response.data?.banner) throw new Error("Promotional banner response was invalid.");
        if (active) setBanner(response.data.banner);
      })
      .catch((error) => {
        console.error("Unable to load promotional banner", error);
        if (active) {
          setErrorMessage(error.response?.status === 404
            ? "This promotion is no longer available."
            : error.response?.data?.error || "Unable to load this promotion.");
        }
      });
    return () => { active = false; };
  }, [isAdmin, slug]);

  const likeAsset = async (asset) => {
    try {
      await likeImageRequest(asset.id);
      setLikedAssetIds((current) => [...new Set([...current, String(asset.id)])]);
      setAssetActionMessage(`${asset.title || "Asset"} liked.`);
    } catch (error) {
      console.error("Unable to like promotional asset", error);
      setAssetActionMessage(error.response?.data?.error || "Unable to like this asset.");
    }
  };

  const shareAsset = async (asset) => {
    const assetUrl = new URL(getAssetPageUrl(asset), window.location.origin).toString();
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({
          title: asset.title || "Promotional asset",
          url: assetUrl
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(assetUrl);
        setAssetActionMessage("Asset link copied.");
      } else {
        throw new Error("Sharing is not supported in this browser.");
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Unable to share promotional asset", error);
      setAssetActionMessage(error.message || "Unable to share this asset.");
    }
  };

  const addPromotionalAssetToCart = async (asset) => {
    try {
      const currentItems = await loadCartItems({ strict: true });
      if (!Array.isArray(currentItems)) {
        throw new Error("Your cart could not be loaded.");
      }
      const currency = currentItems[0]?.currency || "USD";
      const promotionalItem = {
        ...asset,
        id: asset.id,
        price: 0,
        unitPrice: 0,
        currency,
        license: asset.license || "Standard license",
        freeAsset: true,
        promotionalBannerSlug: banner.slug
      };
      const matchingIndex = currentItems.findIndex(
        (item) => String(item.id) === String(asset.id) && item.currency === currency
      );
      const nextItems = [...currentItems];
      if (matchingIndex >= 0) {
        nextItems[matchingIndex] = { ...nextItems[matchingIndex], ...promotionalItem };
      } else {
        nextItems.push(promotionalItem);
      }
      await saveCartItems(nextItems, { strict: true });
      window.dispatchEvent(new Event("cartUpdated"));
      setAddedAssetIds((current) => [...new Set([...current, String(asset.id)])]);
      setAssetActionMessage(`${asset.title || "Asset"} added to your cart for free.`);
    } catch (error) {
      console.error("Unable to add promotional asset to cart", error);
      setAssetActionMessage(error.response?.data?.error || error.message || "Unable to add this asset to your cart.");
    }
  };

  if (isAdmin) {
    return (
      <main className="promotion-banner-page" aria-label="Promotional banner">
        <p>Promotional banner pages are not available to administrators.</p>
      </main>
    );
  }

  if (errorMessage) {
    return <main className="promotion-banner-page" role="alert">{errorMessage}</main>;
  }
  if (!banner) {
    return <main className="promotion-banner-page" aria-busy="true">Loading promotion…</main>;
  }

  return (
    <main className="promotion-banner-page">
      <article className="promotion-banner-detail">
        <section className="promotion-banner-info" aria-label={`${banner.name} promotion`}>
          <span className="promotion-banner-detail-eyebrow">PROMOTION</span>
          <img src={`${API_BASE_URL}${banner.icon_url}`} alt={banner.name} />
          <h1>{banner.name}</h1>
          <p>Discover this promotion and its featured collection.</p>
          <a href="/">Continue browsing</a>
        </section>
        {banner.assets?.length > 0 && (
          <section className="promotion-banner-assets" aria-labelledby="promotion-banner-assets-title">
            <h2 id="promotion-banner-assets-title">Promotional assets</h2>
            <div className="promotion-banner-assets-grid">
              {banner.assets.map((asset) => {
                const assetLink = (
                  <>
                    <img
                      src={getAssetThumbnailUrl(asset)}
                      alt={asset.title || asset.filename || "Promotional asset"}
                      loading="lazy"
                    />
                    <strong>{asset.title || asset.filename || `Asset ${asset.id}`}</strong>
                  </>
                );
                return (
                  <article className="promotion-banner-asset-card" key={asset.id}>
                    {isContributor ? (
                      <div className="promotion-banner-asset-image">{assetLink}</div>
                    ) : (
                      <a className="promotion-banner-asset-image" href={getAssetPageUrl(asset)}>
                        {assetLink}
                      </a>
                    )}
                    {isLoggedInCustomer && (
                      <div className="promotion-banner-asset-actions">
                        <button
                          type="button"
                          onClick={() => likeAsset(asset)}
                          disabled={likedAssetIds.includes(String(asset.id))}
                        >
                          {likedAssetIds.includes(String(asset.id)) ? "Liked" : "Like"}
                        </button>
                        <button type="button" onClick={() => shareAsset(asset)}>Share</button>
                        <button
                          type="button"
                          onClick={() => addPromotionalAssetToCart(asset)}
                          disabled={addedAssetIds.includes(String(asset.id))}
                        >
                          {addedAssetIds.includes(String(asset.id)) ? "Added to cart" : "Add to cart · Free"}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            {isLoggedInCustomer && assetActionMessage && (
              <p className="promotion-banner-asset-action-message" role="status">{assetActionMessage}</p>
            )}
          </section>
        )}
      </article>
    </main>
  );
}
