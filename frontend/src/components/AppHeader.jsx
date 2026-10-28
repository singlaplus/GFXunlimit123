import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useCallback, useState, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import "./AppHeader.css";
import { toast } from "react-toastify";
import { startFaviconAnimation, stopFaviconAnimation } from "../utils/faviconAnimation";
import { dispatchAuthBusyStart, dispatchAuthBusyEnd } from "../utils/authBusyEvents";
import SessionTimer from "./SessionTimer";

import LoginModal from "./LoginModal";
import JoinModal from "./JoinModal";
import NotificationsPanel from "./NotificationsPanel";
import { clearExploreFilterState } from "../utils/exploreFilters";
import { isAdminRole, isContributorRole, normalizeRole } from "../utils/role";
import { buildAuthHeaders, clearAuthSessionStorage, getEffectiveAuthToken, hasActiveSession } from "../utils/authSession";
import { loadCartItems, saveCartItems } from "../utils/cartPersistence";
import { INDIA_TIME_ZONE } from "../utils/indiaTime";

const getFlashSaleDateParts = (value) => {
  const dateValue = String(value || "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    ? new Date(`${dateValue}T00:00:00+05:30`)
    : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: INDIA_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
};

const getOrdinalSuffix = (day) => {
  const dayNumber = Number(day);
  if (dayNumber % 100 >= 11 && dayNumber % 100 <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[dayNumber % 10] || "th";
};

const getFlashSaleCountdown = (startDate, now) => {
  const startTime = Date.parse(`${startDate}T00:00:00+05:30`);
  if (!Number.isFinite(startTime)) return "";

  return getTimeRemainingLabel(startTime, now);
};

const getLiveFlashSaleCountdown = (endDate, now) => {
  const endTime = Date.parse(`${endDate}T23:59:59+05:30`);
  if (!Number.isFinite(endTime)) return "";

  return getTimeRemainingLabel(endTime, now);
};

const getTimeRemainingLabel = (targetTime, now) => {
  const remainingSeconds = Math.max(0, Math.floor((targetTime - now) / 1000));
  const days = Math.floor(remainingSeconds / 86400);
  const hours = Math.floor((remainingSeconds % 86400) / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  if (remainingSeconds === 0) return "Starting now";
  return `Time left ${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
};

const getContributorOfferRibbonText = (offer) => {
  const benefitLabels = {
    bonus_payout: "Bonus payout",
    commission_increase: "Commission increase",
    fee_waiver: "Fee waiver"
  };
  const benefitType = offer.benefit_type;
  const benefitLabel = benefitLabels[benefitType] || benefitType || "Contributor offer";
  const benefitValue = offer.benefit_value;
  const benefitSuffix = benefitValue === null || benefitValue === undefined || benefitValue === ""
    ? ""
    : ` · ${benefitLabel}${["bonus_payout", "fee_waiver"].includes(benefitType) ? " ₹" : " "}${benefitValue}${benefitType === "commission_increase" ? "%" : ""}`;
  const requirement = offer.eligibility_requirements;
  const requirementValue = offer.eligibility_requirement_value;
  const requirementLabel = requirement ? `${requirement.charAt(0).toUpperCase()}${requirement.slice(1)}` : "";
  const requirementProgress = requirement === "uploads" && offer.is_applied
    ? ` ${Number(offer.progress_count) || 0}/${requirementValue ?? 0}`
    : requirementValue === null || requirementValue === undefined || requirementValue === ""
      ? ""
      : ` ${requirement === "earnings" ? "₹" : ""}${requirementValue}`;
  const requirementSuffix = requirement
    ? ` · ${requirementLabel}${requirementProgress}`
    : "";
  return `${offer.name || "Contributor offer"}${benefitSuffix}${requirementSuffix}`;
};

export default function AppHeader({
  showNotifications,
  setShowNotifications,
  notificationCount,
  setNotificationCount,
  setShowLoginModal,
  setShowJoinModal,
  showLoginModal,
  showJoinModal,
  joinModalAccountType,
  setJoinModalAccountType,
  darkMode,
  notifications,
  clearAllNotifications,
  setDarkMode,
  userRole,
  userPermissions = {},
  earningsStats = {},
  setSearch,
  setCurrentPage,
  setSortType,
  setSelectedCategory,
  setSelectedCollection,
}) {
  const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
  const navigate = useNavigate();
  const loc = useLocation();
  const location = loc || (typeof window !== 'undefined' ? window.location : { pathname: '/' });
  const [searchTerm, setSearchTerm] = useState("");
  const [notificationOpen, setNotificationOpen] = useState(Boolean(showNotifications));
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [seoMenuOpen, setSeoMenuOpen] = useState(false);
  const [upcomingFlashSales, setUpcomingFlashSales] = useState([]);
  const [activeFlashSales, setActiveFlashSales] = useState([]);
  const [activeContributorOffers, setActiveContributorOffers] = useState([]);
  const [appliedContributorOfferId, setAppliedContributorOfferId] = useState(null);
  const [submittingContributorOfferId, setSubmittingContributorOfferId] = useState(null);
  const [flashSaleCountdownNow, setFlashSaleCountdownNow] = useState(Date.now());
  const [flashSaleGroupWidth, setFlashSaleGroupWidth] = useState(0);
  const [flashSaleAvailableWidth, setFlashSaleAvailableWidth] = useState(0);
  const flashSaleRibbonRef = useRef(null);
  const flashSaleGroupRef = useRef(null);
  const flashSaleLivePanelRef = useRef(null);
  const notificationWrapRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setFlashSaleCountdownNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const storedRole = typeof window !== "undefined" ? localStorage.getItem("userRole") || "" : "";
  const resolvedRole = userRole || storedRole || "";
  const normalizedRole = normalizeRole(resolvedRole);
  const isCustomerUser = hasActiveSession() && normalizedRole === "customer";
  const isContributorUser = hasActiveSession() && isContributorRole(normalizedRole);
  const storedPermissions = (() => {
    try {
      return JSON.parse(localStorage.getItem("userPermissions") || "{}") || {};
    } catch (err) {
      return {};
    }
  })();
  const effectivePermissions = Object.keys(userPermissions || {}).length > 0 ? userPermissions : storedPermissions;
  const hasBulkUploadPermission = isContributorUser && [true, "true", 1, "1"].includes(effectivePermissions?.bulk_upload);
  const isAdminUser = hasActiveSession() && isAdminRole(normalizedRole);
  const isHomePage = location.pathname === "/";
  const unreadNotificationCount = Number(notificationCount || 0) || (notifications || []).length;

  useEffect(() => {
    if (!notificationOpen) return undefined;

    const handleOutsidePointerDown = (event) => {
      if (!notificationWrapRef.current?.contains(event.target)) {
        setNotificationOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [notificationOpen]);

  useEffect(() => {
    if (!token) return;
    console.debug("AppHeader role debug:", {
      tokenPresent: Boolean(token),
      storedRole,
      resolvedRole,
      normalizedRole,
      isCustomerUser,
      isContributorUser,
      isAdminUser,
    });
  }, [token, storedRole, resolvedRole, normalizedRole, isCustomerUser, isContributorUser, isAdminUser]);

  useEffect(() => {
    if (!token || (!isCustomerUser && !isContributorUser && !isAdminUser)) return undefined;
    const loadMessageCount = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/messages/summary`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setMessageUnreadCount(Number(response.data?.unread || 0));
      } catch (err) {
        console.debug("Messages count unavailable", err?.message || err);
      }
    };
    loadMessageCount();
    const timer = setInterval(loadMessageCount, 30000);
    window.addEventListener("messages-updated", loadMessageCount);
    return () => {
      clearInterval(timer);
      window.removeEventListener("messages-updated", loadMessageCount);
    };
  }, [token, isCustomerUser, isContributorUser, isAdminUser]);

  useEffect(() => {
    let active = true;
    const loadUpcomingFlashSales = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/promotions/upcoming-flash-sales`);
        if (active) {
          setUpcomingFlashSales(Array.isArray(response.data?.sales) ? response.data.sales.slice(0, 1) : []);
        }
      } catch (error) {
        console.debug("Upcoming Flash Sales unavailable", error?.message || error);
      }
    };

    loadUpcomingFlashSales();
    const timer = setInterval(loadUpcomingFlashSales, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadActiveFlashSales = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/checkout/active-flash-sales`);
        if (active) {
          setActiveFlashSales(Array.isArray(response.data?.sales) ? response.data.sales : []);
        }
      } catch (error) {
        console.debug("Active Flash Sales unavailable", error?.message || error);
      }
    };

    loadActiveFlashSales();
    const timer = setInterval(loadActiveFlashSales, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!token || !isContributorUser) {
      setActiveContributorOffers([]);
      setAppliedContributorOfferId(null);
      return undefined;
    }

    let active = true;
    const loadActiveContributorOffers = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/promotions/active-contributor-offers`,
          { headers: buildAuthHeaders(token) }
        );
        if (active) {
          const offers = Array.isArray(response.data?.offers) ? response.data.offers : [];
          setActiveContributorOffers(offers);
          const previouslyApplied = offers.find((offer) => offer.is_applied);
          setAppliedContributorOfferId(previouslyApplied?.id ?? null);
        }
      } catch (error) {
        console.debug("Active Contributor Offers unavailable", error?.message || error);
        if (active) setActiveContributorOffers([]);
      }
    };

    loadActiveContributorOffers();
    const timer = setInterval(loadActiveContributorOffers, 30 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token, isContributorUser]);

  const applyToContributorOffer = async (offer) => {
    if (!token || submittingContributorOfferId !== null) return;
    setSubmittingContributorOfferId(offer.id);
    try {
      const response = await axios.post(
        `${API_BASE_URL}/promotions/active-contributor-offers/${offer.id}/apply`,
        {},
        { headers: buildAuthHeaders(token) }
      );
      setAppliedContributorOfferId(offer.id);
      setActiveContributorOffers((offers) => offers.map((item) => (
        String(item.id) === String(offer.id)
          ? {
            ...item,
            is_applied: true,
            progress_count: Number(response.data?.application?.progress_count) || 0
          }
          : item
      )));
      toast.success(response.data?.alreadyApplied
        ? "You have already applied to this Contributor Offer."
        : "Your Contributor Offer application has been submitted.");
    } catch (error) {
      console.error("Unable to apply to Contributor Offer", error);
      toast.error(error.response?.data?.error || "Unable to submit your Contributor Offer application.");
    } finally {
      setSubmittingContributorOfferId(null);
    }
  };

  useEffect(() => {
    const updateRepeatCount = () => {
      const ribbonWidth = flashSaleRibbonRef.current?.clientWidth;
      const groupWidth = flashSaleGroupRef.current?.getBoundingClientRect().width;
      const livePanelWidth = flashSaleLivePanelRef.current?.getBoundingClientRect().width || 0;
      const availableWidth = Math.max(0, ribbonWidth - 120 - livePanelWidth);
      if (ribbonWidth > 0 && groupWidth > 0) {
        setFlashSaleGroupWidth(groupWidth);
        setFlashSaleAvailableWidth(availableWidth);
      }
    };

    updateRepeatCount();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateRepeatCount);
    if (observer) {
      if (flashSaleRibbonRef.current) observer.observe(flashSaleRibbonRef.current);
      if (flashSaleGroupRef.current) observer.observe(flashSaleGroupRef.current);
      if (flashSaleLivePanelRef.current) observer.observe(flashSaleLivePanelRef.current);
    } else {
      window.addEventListener("resize", updateRepeatCount);
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateRepeatCount);
    };
  }, [upcomingFlashSales, activeFlashSales]);
  const isExplorePage = /^\/explore(?:\/\d+)?$/.test(location.pathname);
  const shouldShowCustomerSearch = isCustomerUser && !isHomePage && !isExplorePage;
  const adminBasePath = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
  const getFlashSaleDiscountLabel = (sale) => {
    const rule = String(sale.discount_rule || "").toUpperCase();
    const discountValue = Number(sale.metadata?.discount_value || 0);
    if (rule === "PERCENTAGE" && discountValue > 0) return `${discountValue}% off`;
    if (rule === "FIXED_AMOUNT") return discountValue > 0 ? `₹${discountValue} Fixed Off` : "Fixed Off";
    if (rule === "BOGO") return "Buy One Get One";
    if (rule === "BOG2") return "Buy One Get Two";
    if (rule === "BOG3") return "Buy One Get Three";
    if (rule === "BOG5") return "Buy One Get Five";
    return sale.discount_rule || "Discount";
  };

  const handleLogoClick = () => {
    navigate("/");
  };

  const handleLogout = async () => {
    startFaviconAnimation();
    dispatchAuthBusyStart("logout");
    const userEmail = localStorage.getItem("email") || "";
    const username = localStorage.getItem("username") || "";
    const fullName = localStorage.getItem("fullName") || "";

    try {
      await axios.post(`${API_BASE_URL}/logout`, {
        email: userEmail,
        username,
        full_name: fullName,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error("Logout notification failed", err);
    } finally {
      clearAuthSessionStorage();
      clearExploreFilterState();
      window.dispatchEvent(new Event("auth-changed"));
      stopFaviconAnimation();
      dispatchAuthBusyEnd();
      navigate("/");
    }
    clearAuthSessionStorage();
    clearExploreFilterState();
    window.dispatchEvent(new Event("auth-changed"));
    navigate("/");
  };

  const handleNavigate = (path) => {
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
    }
    navigate(path);
  };

  const handleExploreClick = () => {
    if (setSearch) {
      setSearch("");
    }
    if (setCurrentPage) {
      setCurrentPage(1);
    }
    if (setSortType) {
      setSortType("newest");
    }
    if (setSelectedCategory) {
      setSelectedCategory("All");
    }
    if (setSelectedCollection) {
      setSelectedCollection("All");
    }
    clearExploreFilterState();
    handleNavigate("/explore");
  };

  const handleSearch = (event) => {
    if (event.key !== "Enter") return;

    event.preventDefault();
    const trimmed = searchTerm.trim();
    
    // Track the search keyword if not empty
    if (trimmed) {
      axios.post(
        `${API_BASE_URL}/search-keyword`,
        { keyword: trimmed }
      ).catch((err) => console.log("Search tracking error:", err));
    }
    
    const target = trimmed ? `/explore?type=${encodeURIComponent(trimmed)}` : "/explore";

    handleNavigate(target);
    setSearchTerm("");
  };

  const [showCreditsMenu, setShowCreditsMenu] = useState(false);
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const [branding, setBranding] = useState({});
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutMode, setPayoutMode] = useState("unpaid");
  const [redeemCredits, setRedeemCredits] = useState("50");
  const [payoutContact, setPayoutContact] = useState({ email: "", phone: "", whatsapp: "" });
  const [cancelledCheck, setCancelledCheck] = useState(null);
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);
  const [requestedUnpaidEarnings, setRequestedUnpaidEarnings] = useState(0);
  const [unpaidEarningsCleared, setUnpaidEarningsCleared] = useState(false);
  const [payoutError, setPayoutError] = useState("");
  const [payoutSuccess, setPayoutSuccess] = useState("");
  const unpaidEarningsValue = unpaidEarningsCleared
    ? 0
    : Number(earningsStats?.unpaid_earnings ?? earningsStats?.total_earnings ?? 0) + requestedUnpaidEarnings;
  const canRequestUnpaidPayout = unpaidEarningsValue >= 100;
  const creditsDropdownRef = useRef(null);
  const accountMenuRef = useRef(null);
  const displayName = (typeof window !== "undefined" && (localStorage.getItem("fullName") || localStorage.getItem("username"))) || "Account";
  const avatarInitial = displayName.trim().charAt(0).toUpperCase() || "U";
  const accountPath = isAdminUser
    ? `${adminBasePath}?tab=myaccount`
    : isContributorUser
      ? "/dashboard"
      : "/customer";
  const profileIconUrl = isCustomerUser
    ? branding?.profileIconCustomer
    : isContributorUser
      ? branding?.profileIconContributor
      : isAdminUser
        ? branding?.profileIconAdmin
        : null;
  const profileIconSrc = profileIconUrl
    ? `${API_BASE_URL}${profileIconUrl}?v=${branding?.profileIconsVersion || "default"}`
    : null;

  useEffect(() => {
    if (!isCustomerUser) {
      setCartCount(0);
      return;
    }

    const loadCart = () => {
      const stored = localStorage.getItem("customer-cart");
      let items = [];
      try {
        items = JSON.parse(stored || "[]");
      } catch (err) {
        items = [];
      }
      setCartCount(Array.isArray(items) ? items.length : 0);
    };

    loadCart();
    const handleCartUpdated = () => loadCart();
    window.addEventListener("cartUpdated", handleCartUpdated);

    return () => window.removeEventListener("cartUpdated", handleCartUpdated);
  }, [isCustomerUser]);

  useEffect(() => {
    const apiBaseUrl = API_BASE_URL;

    const loadBranding = async () => {
      try {
        const res = await axios.get(`${apiBaseUrl}/branding`);
        setBranding(res.data || {});
      } catch (err) {
        console.error("Failed to load branding", err);
      }
    };

    loadBranding();
    const handleBrandingUpdated = () => loadBranding();
    window.addEventListener("branding-updated", handleBrandingUpdated);

    return () => {
      window.removeEventListener("branding-updated", handleBrandingUpdated);
    };
  }, []);

  useEffect(() => {
    let iconLink = document.querySelector('link[rel="icon"]');

    if (!iconLink) {
      iconLink = document.createElement("link");
      iconLink.rel = "icon";
      document.head.appendChild(iconLink);
    }

    if (branding?.favicon) {
      const apiBaseUrl = API_BASE_URL;
      iconLink.href = `${apiBaseUrl}${branding.favicon}`;
      iconLink.removeAttribute("type");
    } else {
      iconLink.href = `${process.env.PUBLIC_URL || ""}/favicon.svg`;
      iconLink.type = "image/svg+xml";
    }
  }, [branding]);

  useEffect(() => {
    if (!showCreditsMenu) return;

    const onDocClick = (e) => {
      if (
        creditsDropdownRef.current &&
        !creditsDropdownRef.current.contains(e.target)
      ) {
        setShowCreditsMenu(false);
      }
    };

    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showCreditsMenu]);

  useEffect(() => {
    if (!showAccountMenu) return;

    const onDocClick = (event) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setShowAccountMenu(false);
      }
    };

    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showAccountMenu]);

  const addCredits = async (amount) => {
    try {
      const apiBaseUrl = API_BASE_URL;
      const priceResponse = await fetch(`${apiBaseUrl}/settings/credit-price`);
      const priceData = priceResponse.ok ? await priceResponse.json() : {};
      const price = Number(priceData?.credit_prices?.[amount] ?? amount);
      const currentItems = await loadCartItems();
      const creditItem = {
        id: -amount,
        title: `${amount} Credits`,
        category: "Credits",
        collection: "Credit Packages",
        price,
        unitPrice: price,
        currency: "INR",
        license: "Credit package",
        creditPackage: true,
        creditAmount: amount,
        quantity: 1,
      };
      const nextItems = (Array.isArray(currentItems) ? currentItems : []).filter((item) => item.id !== creditItem.id);
      nextItems.push(creditItem);
      await saveCartItems(nextItems);

      setShowCreditsMenu(false);
      toast.success(`${amount} credits added to your cart`);
      window.dispatchEvent(new Event('cartUpdated'));
    } catch (err) {
      console.error(err);
      toast.error("Failed to add credits");
    }
  };

  const resetPayoutState = useCallback(() => {
    setRedeemCredits("50");
    setPayoutContact({
      email: typeof window !== "undefined" ? localStorage.getItem("email") || "" : "",
      phone: "",
      whatsapp: "",
    });
    setCancelledCheck(null);
    setPayoutSubmitting(false);
    setPayoutError("");
    setPayoutSuccess("");
  }, []);

  const openPayoutModal = useCallback((mode = "unpaid") => {
    resetPayoutState();
    setPayoutMode(mode);
    setRedeemCredits(mode === "unpaid" ? String(Math.floor(unpaidEarningsValue)) : "50");
    setShowPayoutModal(true);
  }, [resetPayoutState, unpaidEarningsValue]);

  useEffect(() => {
    const onPayoutRequested = () => openPayoutModal("unpaid");
    const onRedeemRequested = () => openPayoutModal("redeem");
    window.addEventListener("payoutRequested", onPayoutRequested);
    window.addEventListener("redeemRequested", onRedeemRequested);
    return () => {
      window.removeEventListener("payoutRequested", onPayoutRequested);
      window.removeEventListener("redeemRequested", onRedeemRequested);
    };
  }, [openPayoutModal]);

  const closePayoutModal = () => {
    setShowPayoutModal(false);
    resetPayoutState();
  };

  const submitRedeemRequest = async () => {
    const credits = Number(redeemCredits);
    const minimumCredits = payoutMode === "unpaid" ? 100 : 50;
    const maximumCredits = payoutMode === "unpaid" ? Math.floor(unpaidEarningsValue) : null;
    if (!Number.isInteger(credits) || credits < minimumCredits) {
      setPayoutError(`You must request at least ${minimumCredits} credits.`);
      return;
    }
    if (maximumCredits !== null && credits > maximumCredits) {
      setPayoutError(`You can request up to ${maximumCredits} credits.`);
      return;
    }
    if (payoutMode === "redeem") {
      try {
        setPayoutSubmitting(true);
        const response = await axios.post(`${API_BASE_URL}/redeem-credits`, { credits }, { headers: { Authorization: `Bearer ${token}` } });
        setRequestedUnpaidEarnings((amount) => amount + credits);
        window.dispatchEvent(new CustomEvent("creditsRedeemed", { detail: { credits } }));
        window.dispatchEvent(new Event("creditsUpdated"));
        window.dispatchEvent(new Event("paymentsRequested"));
        setPayoutSuccess(`${response.data.credits_redeemed} credits redeemed and added to unpaid earnings.`);
        setTimeout(() => closePayoutModal(), 800);
      } catch (err) {
        setPayoutError(err.response?.data?.error || "Unable to redeem credits.");
      } finally {
        setPayoutSubmitting(false);
      }
      return;
    }
    if (!payoutContact.email.trim() || !payoutContact.phone.trim() || !payoutContact.whatsapp.trim() || !cancelledCheck) {
      setPayoutError("Email, phone, WhatsApp number and cancelled check are required.");
      return;
    }

    try {
      setPayoutSubmitting(true);
      const formData = new FormData();
      formData.append("requested_credits", String(credits));
      formData.append("email", payoutContact.email.trim());
      formData.append("phone", payoutContact.phone.trim());
      formData.append("whatsapp", payoutContact.whatsapp.trim());
      formData.append("cancelled_check", cancelledCheck);
      const response = await axios.post(`${API_BASE_URL}/payout-requests`, formData, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUnpaidEarningsCleared(true);
      window.dispatchEvent(new CustomEvent("creditsRedeemed", { detail: { credits } }));
      window.dispatchEvent(new Event("creditsUpdated"));
      window.dispatchEvent(new Event("paymentsRequested"));
      setPayoutSuccess(`Redeem request for ${response.data.requested_credits} credits submitted.`);
      setTimeout(() => closePayoutModal(), 800);
    } catch (err) {
      setPayoutError(err.response?.data?.error || "Unable to submit redeem request.");
    } finally {
      setPayoutSubmitting(false);
    }
  };

  return (
    <>
      {/* =========================
          PREMIUM HEADER
      ========================== */}

      <header className={`app-header ${darkMode ? "dark" : ""}`}>
        <div className="app-header-container">
          <div
  className="logo"
  onClick={handleLogoClick}
  style={{ cursor: "pointer" }}
  role="button"
  tabIndex={0}
  onKeyDown={(event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleLogoClick();
    }
  }}
>
  {branding?.logo ? (
    <img
      src={`${API_BASE_URL}${branding.logo}`}
      alt="Website logo"
      className="brand-logo-image"
    />
  ) : (
    <>
      <span className="logo-red">GFX</span>
      <span className="logo-dark">unlimit</span>
    </>
  )}
</div>

          {hasActiveSession() && (isCustomerUser || isContributorUser || isAdminUser) && (
            <div className="header-notification-wrap" ref={notificationWrapRef}>
              <button className="header-notification-button" type="button" onClick={() => setNotificationOpen((open) => !open)} aria-expanded={notificationOpen} aria-label={`Notifications, ${unreadNotificationCount} unread`}>
                <span aria-hidden="true">🔔</span><strong>{unreadNotificationCount}</strong>
              </button>
              {isAdminUser ? (
                <>
                  <div
                    className={`admin-menu-wrap${adminMenuOpen ? " is-open" : ""}`}
                    onMouseEnter={() => setAdminMenuOpen(true)}
                    onMouseLeave={() => setAdminMenuOpen(false)}
                    onFocus={() => setAdminMenuOpen(true)}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setAdminMenuOpen(false);
                      }
                    }}
                  >
                    <button className="nav-link-btn" type="button">
                      Admin
                    </button>
                    <div className="admin-menu-dropdown">
                      <button
                        className="nav-link-btn"
                        onClick={() => {
                          setAdminMenuOpen(false);
                          handleNavigate("/messages");
                        }}
                        aria-label={`Messages, ${messageUnreadCount} unread`}
                      >
                        Messages ({messageUnreadCount})
                      </button>
                      <button
                        className="nav-link-btn"
                        onClick={() => {
                          setAdminMenuOpen(false);
                          handleNavigate(`${adminBasePath}?tab=admin_dashboard`, "admin");
                        }}
                      >
                        Dashboard
                      </button>
                      <button
                        className="nav-link-btn"
                        onClick={() => {
                          setAdminMenuOpen(false);
                          handleNavigate("/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=controls", "admin");
                        }}
                      >
                        Controls
                      </button>
                      <button
                        className="nav-link-btn"
                        onClick={() => {
                          setAdminMenuOpen(false);
                          handleNavigate("/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=live-assets", "admin");
                        }}
                      >
                        Live Assets
                      </button>
                      <button
                        className="nav-link-btn"
                        onClick={() => {
                          setAdminMenuOpen(false);
                          handleNavigate("/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=users", "admin");
                        }}
                      >
                        Users
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <button className="nav-link-btn" onClick={() => handleNavigate("/messages")} aria-label={`Messages, ${messageUnreadCount} unread`}>
                  Messages ({messageUnreadCount})
                </button>
              )}
              <NotificationsPanel showNotifications={notificationOpen} notifications={notifications || []} clearAllNotifications={clearAllNotifications} darkMode={darkMode} userRole={resolvedRole} />
            </div>
          )}

          {isCustomerUser && (
            <div className="header-nav">
              <button
                className="nav-link-btn"
                onClick={handleExploreClick}
              >
                Explore
              </button>
              <button
                className="nav-link-btn"
                onClick={() => handleNavigate("/favorites", "favorites")}
              >
                My Collections
              </button>
              {shouldShowCustomerSearch && (
                <input
                  className="search-input"
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  onKeyDown={handleSearch}
                  placeholder="Search"
                />
              )}
              
              <button
                className="nav-link-btn"
                onClick={() => handleNavigate("/orders", "orders")}
              >
                Orders
              </button>
              <button
                className="nav-link-btn"
                onClick={() => handleNavigate("/downloads", "downloads")}
              >
                My Downloads
              </button>
              <div className="credits-dropdown credits-right" ref={creditsDropdownRef}>
                <button
                  className="nav-link-btn"
                  onClick={() => setShowCreditsMenu(!showCreditsMenu)}
                >
                  Add Credits
                </button>
                {showCreditsMenu && (
                  <div className={`credits-menu ${darkMode ? 'dark' : ''}`}>
                    <button onClick={() => addCredits(100)}>+100 Credits</button>
                    <button onClick={() => addCredits(200)}>+200 Credits</button>
                    <button onClick={() => addCredits(500)}>+500 Credits</button>
                    <button onClick={() => addCredits(1000)}>+1000 Credits</button>
                  </div>
                )}
              </div>
              <button
                className="nav-link-btn"
                onClick={() => {
                  handleNavigate('/payments', 'payments');
                  try {
                    window.dispatchEvent(new Event('paymentsRequested'));
                  } catch (err) {
                    // ignore
                  }
                }}
              >
                Payment History
              </button>
            </div>
          )}

          {isContributorUser && (
            <div className="header-nav">
              <button
                className="nav-link-btn"
                onClick={() => handleNavigate("/upload", "upload")}
              >
                Uploads
              </button>

              {hasBulkUploadPermission && (
                <button
                  className="nav-link-btn"
                  onClick={() => handleNavigate("/bulk-upload", "bulk-upload")}
                >
                  Bulk Upload
                </button>
              )}

              <button
                className="nav-link-btn"
                onClick={() => handleNavigate("/myuploads", "myuploads")}
              >
                My Uploads
              </button>

              <button
                className="nav-link-btn"
                onClick={() => handleNavigate("/dashboard?tab=analytics", "dashboard")}
              >
                Analytics
              </button>

              <button
                className="nav-link-btn"
                onClick={() => {
                  handleNavigate('/payments', 'payments');
                  try { window.dispatchEvent(new Event('paymentsRequested')); } catch (err) {}
                }}
              >
                Payment History
              </button>

              <button
                className="nav-link-btn"
                onClick={() => handleNavigate("/orders", "orders")}
              >
                Orders
              </button>

              <button
                className="nav-link-btn"
                onClick={() => handleNavigate("/favorites", "favorites")}
              >
                My Collection
              </button>
            </div>
          )}

          {isAdminUser && (
            <div className="header-nav">
              <div className="nav-link-btn" style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 12px", cursor: "default" }}>
                <span style={{ color: "inherit" }}>All Assets</span>
                <select
                  aria-label="All Assets"
                  value={new URLSearchParams(window.location.search).get("status") || ""}
                  onChange={(event) => {
                    const nextStatus = event.target.value;
                    const query = nextStatus ? `?status=${encodeURIComponent(nextStatus)}` : "";
                    handleNavigate(`/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm${query}`, "admin");
                  }}
                  style={{
                    padding: "4px 8px",
                    borderRadius: "6px",
                    border: "1px solid #4b5563",
                    background: darkMode ? "#232323" : "#fff",
                    color: darkMode ? "#f5f5f5" : "#222",
                    cursor: "pointer"
                  }}
                >
                  <option value="">All</option>
                  <option value="pending">Pending</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              <div
                className={`tools-menu-wrap${toolsMenuOpen ? " is-open" : ""}`}
                onMouseEnter={() => setToolsMenuOpen(true)}
                onMouseLeave={() => setToolsMenuOpen(false)}
                onFocus={() => setToolsMenuOpen(true)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setToolsMenuOpen(false);
                  }
                }}
              >
                <button className="nav-link-btn" type="button" aria-haspopup="menu" aria-expanded={toolsMenuOpen}>
                  Tools
                </button>
                <div className="tools-menu-dropdown" role="menu" aria-label="Tools menu">
                  <button
                    className="nav-link-btn"
                    onClick={() => {
                      setToolsMenuOpen(false);
                      window.localStorage.removeItem("adminPromotionsActiveSection");
                      handleNavigate("/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=promotions", "admin");
                    }}
                  >
                    Promotions
                  </button>
                  <button
                    className="nav-link-btn"
                    onClick={() => {
                      setToolsMenuOpen(false);
                      handleNavigate(`${adminBasePath}/analytics`);
                    }}
                  >
                    Analytics
                  </button>
                  <button
                    className="nav-link-btn"
                    onClick={() => {
                      setToolsMenuOpen(false);
                      handleNavigate(`${adminBasePath}/commerce`);
                    }}
                  >
                    Commerce
                  </button>
                  <button
                    className="nav-link-btn"
                    onClick={() => {
                      setToolsMenuOpen(false);
                      handleNavigate(`${adminBasePath}/orders`);
                    }}
                  >
                    Orders
                  </button>
                </div>
              </div>
              <div
                className={`tools-menu-wrap${seoMenuOpen ? " is-open" : ""}`}
                onMouseEnter={() => setSeoMenuOpen(true)}
                onMouseLeave={() => setSeoMenuOpen(false)}
                onFocus={() => setSeoMenuOpen(true)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setSeoMenuOpen(false);
                  }
                }}
              >
                <button className="nav-link-btn" type="button" aria-haspopup="menu" aria-expanded={seoMenuOpen}>
                  SEO
                </button>
                <div className="tools-menu-dropdown" role="menu" aria-label="SEO menu">
                  <button
                    className="nav-link-btn"
                    onClick={() => {
                      setSeoMenuOpen(false);
                      handleNavigate(`${adminBasePath}/search_console`);
                    }}
                  >
                    Google Search Console
                  </button>
                  <button
                    className="nav-link-btn"
                    onClick={() => {
                      setSeoMenuOpen(false);
                      handleNavigate(`${adminBasePath}/google_analytics`);
                    }}
                  >
                    Google Analytics
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="header-actions">
            {isCustomerUser && (
              <button
                className="nav-link-btn cart-button"
                onClick={() => navigate('/cart')}
                aria-label="Open cart"
              >
                🛒 Cart{cartCount > 0 ? ` (${cartCount})` : ""}
              </button>
            )}
            {isContributorUser && (
              <button
                type="button"
                onClick={() => canRequestUnpaidPayout && openPayoutModal("unpaid")}
                disabled={!canRequestUnpaidPayout}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "8px 12px",
                  borderRadius: "999px",
                  background: darkMode ? "rgba(255,255,255,0.12)" : "rgba(15, 23, 42, 0.08)",
                  color: darkMode ? "#f8fafc" : "#0f172a",
                  fontWeight: 700,
                  fontSize: "13px",
                  marginRight: "8px",
                  whiteSpace: "nowrap",
                  border: "none",
                  cursor: canRequestUnpaidPayout ? "pointer" : "not-allowed",
                  opacity: canRequestUnpaidPayout ? 1 : 0.75,
                }}
              >
                Unpaid: ₹{unpaidEarningsValue.toFixed(2)}
              </button>
            )}

            <button
              className="darkmode-btn"
              onClick={() => setDarkMode(!darkMode)}
            >
              {darkMode ? "☀ Light" : "🌙 Dark"}
            </button>

            {token && (
              <div className="account-menu-wrapper" ref={accountMenuRef}>
                <button
                  type="button"
                  className="account-avatar-button"
                  onClick={() => setShowAccountMenu((open) => !open)}
                  aria-label={`Open account menu for ${displayName}`}
                  aria-expanded={showAccountMenu}
                >
                  {isCustomerUser && (profileIconSrc ? (
                    <img src={profileIconSrc} alt="" className="profile-icon-image profile-icon-image-customer" aria-hidden="true" />
                  ) : <span className="account-crown" aria-hidden="true" />)}
                  {isContributorUser && (profileIconSrc ? (
                    <img src={profileIconSrc} alt="" className="profile-icon-image profile-icon-image-contributor" aria-hidden="true" />
                  ) : (
                    <span className="account-bow" aria-hidden="true">
                      <span className="account-bow-tail account-bow-tail-left" />
                      <span className="account-bow-tail account-bow-tail-right" />
                      <span className="account-bow-knot" />
                    </span>
                  ))}
                  {isAdminUser && (profileIconSrc ? (
                    <img src={profileIconSrc} alt="" className="profile-icon-image profile-icon-image-admin" aria-hidden="true" />
                  ) : <span className="account-verified-tick" aria-hidden="true">✓</span>)}
                  <span className="account-avatar" aria-hidden="true">{avatarInitial}</span>
                </button>
                {showAccountMenu && (
                  <div className={`account-menu ${darkMode ? "dark" : ""}`}>
                    <div className="account-menu-name">{displayName}</div>
                    <button type="button" onClick={() => { setShowAccountMenu(false); handleNavigate(accountPath); }}>
                      My Account
                    </button>
                    <button type="button" onClick={() => { setShowAccountMenu(false); handleNavigate("/profile"); }}>
                      Profile
                    </button>
                    <button type="button" onClick={handleLogout}>
                      Logout
                    </button>
                  </div>
                )}
                <SessionTimer darkMode={darkMode} />
              </div>
            )}
          </div>
        </div>
        {!isContributorUser && (upcomingFlashSales.length > 0 || activeFlashSales.length > 0) && (
          <div
            className="upcoming-flash-sale-ribbon"
            aria-label="Upcoming Flash Sales"
            ref={flashSaleRibbonRef}
          >
            <strong className="upcoming-flash-sale-label">FLASH SALE</strong>
            {upcomingFlashSales.length > 0 && (
              <div
                className="upcoming-flash-sale-track"
                style={{
                  "--flash-sale-shift": `${flashSaleGroupWidth}px`,
                  "--flash-sale-available-width": `${flashSaleAvailableWidth}px`,
                }}
              >
                <div className="upcoming-flash-sale-group" ref={flashSaleGroupRef}>
                  {upcomingFlashSales.map((sale) => {
                    const startDateParts = getFlashSaleDateParts(sale.start_date);
                    return (
                      <span
                        className="upcoming-flash-sale-item"
                        key={sale.id}
                      >
                        <span>{sale.name}</span>
                        <strong className="upcoming-flash-sale-discount">{getFlashSaleDiscountLabel(sale)}</strong>
                        {startDateParts && (
                          <span>
                            Starts on {startDateParts.day}<sup>{getOrdinalSuffix(startDateParts.day)}</sup> {startDateParts.month} {startDateParts.year} IST
                          </span>
                        )}
                        <span>{getFlashSaleCountdown(sale.start_date, flashSaleCountdownNow)}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {activeFlashSales.length > 0 && (
              <div
                className="upcoming-flash-sale-live-panel"
                aria-label="Live Flash Sale details"
                ref={flashSaleLivePanelRef}
              >
                {activeFlashSales.map((sale) => (
                  <span className="upcoming-flash-sale-live-item" key={sale.id}>
                    <strong className="upcoming-flash-sale-discount">{getFlashSaleDiscountLabel(sale)}</strong>
                    <span> · {getLiveFlashSaleCountdown(sale.end_date, flashSaleCountdownNow)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {isContributorUser && activeContributorOffers.length > 0 && (() => {
          const appliedOffer = activeContributorOffers.find(
            (offer) => String(offer.id) === String(appliedContributorOfferId)
          );
          const isCompletedOffer = appliedOffer?.application_status === "completed"
            || Boolean(appliedOffer?.benefit_approved);
          return (
            <div
              className={`contributor-offer-ribbon${appliedOffer ? " is-applied" : ""}${isCompletedOffer ? " is-completed" : ""}`}
              aria-label={isCompletedOffer
                ? "Completed Contributor Offer"
                : appliedOffer ? "Applied Contributor Offer" : "Active Contributor Offers"}
            >
              <strong className="contributor-offer-ribbon-label">CONTRIBUTOR OFFER</strong>
              <div className="contributor-offer-ribbon-track">
                <div className="contributor-offer-ribbon-list">
                  {(appliedOffer ? [appliedOffer] : activeContributorOffers).map((offer) => (
                    <span className="contributor-offer-ribbon-item" key={offer.id}>
                      <span>{getContributorOfferRibbonText(offer)}</span>
                      <button
                        type="button"
                        disabled={offer.is_applied || submittingContributorOfferId !== null}
                        onClick={() => applyToContributorOffer(offer)}
                      >
                        {offer.is_applied
                          ? offer.application_status === "completed" || offer.benefit_approved ? "Completed" : "Applied"
                          : String(offer.id) === String(submittingContributorOfferId) ? "Applying..." : "Apply"}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              {appliedOffer && (
                <span className="contributor-offer-countdown" aria-label="Contributor offer time remaining">
                  {appliedOffer.end_date
                    ? getLiveFlashSaleCountdown(appliedOffer.end_date, flashSaleCountdownNow)
                    : "No expiry"}
                </span>
              )}
            </div>
          );
        })()}
      </header>

      {/* =========================
          LOGIN / REGISTER MODALS
      ========================== */}

      <LoginModal
        show={showLoginModal}
        onClose={() => setShowLoginModal(false)}
      />

      <JoinModal
        show={showJoinModal}
        onClose={() => setShowJoinModal(false)}
        accountType={joinModalAccountType}
        setAccountType={setJoinModalAccountType}
      />

      {/* =========================
          DASHBOARD NAVIGATION
      ========================== */}

      {showPayoutModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            padding: "20px",
          }}
          onClick={closePayoutModal}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "560px",
              background: darkMode ? "#111827" : "#ffffff",
              color: darkMode ? "#f8fafc" : "#111827",
              borderRadius: "18px",
              padding: "24px",
              boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0 }}>{payoutMode === "unpaid" ? "Request unpaid earnings" : "Redeem credits"}</h3>
              <button type="button" onClick={closePayoutModal} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: "18px", color: darkMode ? "#f8fafc" : "#111827" }}>
                ×
              </button>
            </div>

            {(
              <>
                <p style={{ margin: "0 0 12px", color: darkMode ? "#cbd5e1" : "#475569" }}>
                  {payoutMode === "unpaid" ? "Submit your payout details for review." : "Choose how many credits to redeem. 1 credit = ₹1."}
                </p>
                <label style={{ display: "block", marginBottom: "8px", fontWeight: 600 }}>
                  {payoutMode === "unpaid" ? "Amount to be requested" : "Credits to redeem"}
                </label>
                <input
                  type="number"
                  min={payoutMode === "unpaid" ? "100" : "50"}
                  max={payoutMode === "unpaid" ? Math.floor(unpaidEarningsValue) : undefined}
                  step="1"
                  value={redeemCredits}
                  readOnly={payoutMode === "unpaid"}
                  onChange={(event) => setRedeemCredits(event.target.value)}
                  placeholder={payoutMode === "unpaid" ? "100 credits minimum" : "Minimum 50 credits"}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #94a3b8", marginBottom: "16px" }}
                />
                {payoutMode === "unpaid" && <div style={{ display: "grid", gap: "10px", marginBottom: "16px" }}>
                  <input type="email" value={payoutContact.email} onChange={(event) => setPayoutContact((current) => ({ ...current, email: event.target.value }))} placeholder="Email ID" style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #94a3b8" }} />
                  <input type="tel" inputMode="numeric" pattern="[0-9]*" value={payoutContact.phone} onChange={(event) => setPayoutContact((current) => ({ ...current, phone: event.target.value.replace(/\D/g, "") }))} placeholder="Phone number" style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #94a3b8" }} />
                  <input type="tel" inputMode="numeric" pattern="[0-9]*" value={payoutContact.whatsapp} onChange={(event) => setPayoutContact((current) => ({ ...current, whatsapp: event.target.value.replace(/\D/g, "") }))} placeholder="WhatsApp number" style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #94a3b8" }} />
                  <label style={{ display: "grid", gap: "6px", fontSize: "13px", fontWeight: 600 }}>
                    Cancelled check upload
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setCancelledCheck(event.target.files?.[0] || null)} />
                  </label>
                </div>}
                {payoutError ? <p style={{ color: "#dc2626", margin: "0 0 12px" }}>{payoutError}</p> : null}
                {payoutSuccess ? <p style={{ color: "#16a34a", margin: "0 0 12px" }}>{payoutSuccess}</p> : null}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                  <button type="button" onClick={closePayoutModal} style={{ padding: "10px 16px", borderRadius: "10px", border: "1px solid #94a3b8", background: "transparent", cursor: "pointer" }}>
                    Cancel
                  </button>
                  <button type="button" onClick={submitRedeemRequest} disabled={payoutSubmitting}
                    style={{ padding: "10px 16px", borderRadius: "10px", border: "none", background: "#2563eb", color: "white", cursor: "pointer" }}
                  >
                    {payoutSubmitting ? "Submitting..." : payoutMode === "unpaid" ? "Submit Request" : "Redeem Credits"}
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}

      {/* =========================
          NOTIFICATIONS
      ========================== */}

    </>
  );
}