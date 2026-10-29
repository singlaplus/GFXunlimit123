import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { getEffectiveAuthToken } from "../utils/authSession";
import { formatIndiaDate } from "../utils/indiaTime";
import "./AdminPromotionsPanel.css";

const SECTION_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "coupons", label: "Coupons" },
  { key: "campaigns", label: "Contributor Offers" },
  { key: "flash-sales", label: "Flash Sales" },
  { key: "referrals", label: "Referral Program" },
  { key: "loyalty", label: "Loyalty Rewards" },
  { key: "bundles", label: "Bundle Discounts" },
  { key: "newsletters", label: "Newsletter Campaigns" },
  { key: "banners", label: "Promotional Banners" },
  { key: "popups", label: "Popups" },
  { key: "announcements", label: "Announcement Bar" },
  { key: "push", label: "Push Notifications" },
  { key: "automation", label: "Automation Rules" },
  { key: "analytics", label: "Analytics" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
  { key: "activity", label: "Activity Log" }
];
const ACTIVE_SECTION_STORAGE_KEY = "adminPromotionsActiveSection";

function getCouponMetadata(coupon) {
  return typeof coupon?.metadata === "string"
    ? JSON.parse(coupon.metadata)
    : coupon?.metadata || {};
}

function getCampaignMetadata(campaign) {
  if (typeof campaign?.metadata !== "string") {
    return campaign?.metadata || {};
  }
  try {
    return JSON.parse(campaign.metadata);
  } catch (error) {
    console.error("Invalid Contributor Offer metadata", error);
    return {};
  }
}

function getCampaignDisplayStatus(status) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (normalizedStatus === "planned") return "draft";
  if (normalizedStatus === "expired") return "ended";
  return normalizedStatus;
}

function getContributorApplicationDisplayStatus(application) {
  const applicationStatus = String(application?.status || "pending").trim().toLowerCase();
  return ["completed", "ended", "withdrawn"].includes(applicationStatus) ? applicationStatus : "active";
}

function getCouponDeliveryEmail(coupon) {
  return String(getCouponMetadata(coupon)?.delivery_email || "").trim();
}

const initialCouponForm = {
  name: "",
  code: "",
  coupon_type: "manual",
  discount_type: "percentage",
  discount_value: "",
  status: "active",
  start_at: "",
  end_at: "",
  usage_limit: "",
  notes: ""
};

const initialCampaignForm = {
  name: "",
  description: "",
  benefit_type: "bonus_payout",
  benefit_value: "",
  eligibility_scope: "all",
  eligible_contributors: "",
  eligible_contributor_ids: [],
  eligibility_requirements: "",
  eligibility_requirement_value: "",
  start_date: "",
  end_date: "",
  status: "active",
  admin_notes: ""
};

const initialFlashForm = {
  name: "",
  discount_rule: "",
  status: "scheduled",
  start_date: "",
  end_date: "",
  featured_placement: "homepage",
  featured_category_id: "",
  featured_collection_id: "",
  keywords: "",
  discount_value: ""
};

const FLASH_SALE_DISCOUNT_RULES = [
  { value: "percentage", label: "Percentage" },
  { value: "fixed_amount", label: "Fixed Amount" },
  { value: "BOGO", label: "BOGO — Buy One Get One" },
  { value: "BOG2", label: "BOG2 — Buy One Get Two" },
  { value: "BOG3", label: "BOG3 — Buy One Get Three" },
  { value: "BOG5", label: "BOG5 — Buy One Get Five" }
];

const initialReferralForm = {
  name: "",
  reward_type: "credit",
  signup_reward: "",
  purchase_reward: "",
  status: "active"
};

const initialLoyaltyForm = {
  name: "",
  points_system: "",
  reward_level: "",
  bonus_points: "",
  expiry_days: "",
  status: "active"
};

const initialBundleForm = {
  name: "",
  tiers: [{ asset_count: "3", discount_percent: "10" }],
  start_date: "",
  end_date: "",
  status: "active"
};

const initialNewsletterForm = {
  name: "",
  subject: "",
  schedule: "",
  audience: "all",
  status: "draft"
};

const initialBannerForm = {
  name: "",
  placement: "homepage",
  priority: "medium",
  schedule: "",
  status: "draft"
};

const initialPopupForm = {
  name: "",
  trigger: "homepage",
  schedule: "",
  status: "draft"
};

const initialAnnouncementForm = {
  name: "",
  text: "",
  schedule: "",
  status: "active"
};

const initialPushForm = {
  name: "",
  channel: "browser",
  audience: "all",
  schedule: "",
  status: "draft"
};

const initialAutomationForm = {
  name: "",
  trigger: "new_registration",
  channel: "email",
  status: "active"
};

const buildAuthHeaders = () => {
  const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const formatPromotionCount = (number, prefix, decimals, suffix) => (
  `${prefix}${number.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}${suffix}`
);

function AnimatedPromotionValue({ value }) {
  const displayValue = String(value ?? 0);
  const match = displayValue.match(/^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
  const target = match ? Number(match[2].replace(/,/g, "")) : null;
  const prefix = match?.[1] || "";
  const decimals = match?.[2].split(".")[1]?.length || 0;
  const suffix = match?.[3] || "";
  const [animatedValue, setAnimatedValue] = useState(() => (
    target === null ? displayValue : formatPromotionCount(0, prefix, decimals, suffix)
  ));

  useEffect(() => {
    if (target === null) {
      setAnimatedValue(displayValue);
      return undefined;
    }

    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (prefersReducedMotion || target === 0) {
      setAnimatedValue(displayValue);
      return undefined;
    }

    let frameId;
    let startTime;
    setAnimatedValue(formatPromotionCount(0, prefix, decimals, suffix));

    const animate = (timestamp) => {
      if (startTime === undefined) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / 1200, 1);
      const easedProgress = 1 - (1 - progress) ** 3;
      setAnimatedValue(formatPromotionCount(target * easedProgress, prefix, decimals, suffix));
      if (progress < 1) frameId = window.requestAnimationFrame(animate);
      else setAnimatedValue(displayValue);
    };

    frameId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frameId);
  }, [decimals, displayValue, prefix, suffix, target]);

  return <span aria-label={displayValue} aria-live="off">{animatedValue}</span>;
}

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getISTDateString(date = new Date()) {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const partValues = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
  return `${partValues.year}-${partValues.month}-${partValues.day}`;
}

function getISTDateStart(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - (5 * 60 + 30) * 60 * 1000);
}

function getFlashEventTiming(sale, now = new Date()) {
  const startDateValue = sale.start_date ? String(sale.start_date).slice(0, 10) : "";
  const endDateValue = sale.end_date ? String(sale.end_date).slice(0, 10) : "";
  const startDate = startDateValue ? parseLocalDate(startDateValue) : null;
  const endDate = endDateValue ? parseLocalDate(endDateValue) : null;
  const startAt = startDateValue ? getISTDateStart(startDateValue) : null;
  const expiresAt = endDateValue
    ? new Date(getISTDateStart(endDateValue).getTime() + 24 * 60 * 60 * 1000 - 1)
    : null;
  const savedStatus = String(sale.status || "").trim().toLowerCase();

  if (savedStatus === "expired" || (expiresAt && now > expiresAt)) {
    return { status: "expired", startDate, endDate, expiresAt };
  }
  if ((startAt && now < startAt) || (savedStatus === "scheduled" && (!startAt || now < startAt))) {
    return { status: "scheduled", startDate, endDate, expiresAt };
  }
  if (savedStatus === "scheduled" && startAt && now >= startAt) {
    return { status: "active", startDate, endDate, expiresAt };
  }
  return { status: savedStatus === "running" ? "active" : savedStatus || "scheduled", startDate, endDate, expiresAt };
}

function formatFlashEventDate(date) {
  return date
    ? formatIndiaDate(date, { month: "short", day: "numeric", year: "numeric" })
    : "Not set";
}

function formatFlashEventCountdown(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(remainingSeconds).padStart(2, "0")}s`;
}

function getFlashEventRuleDetails(sale) {
  const rule = String(sale.discount_rule || "").toUpperCase();
  const metadata = typeof sale.metadata === "string" ? JSON.parse(sale.metadata || "{}") : sale.metadata || {};
  const discountValue = Number(metadata.discount_value || 0);

  if (rule === "PERCENTAGE") return `${discountValue}% off`;
  if (rule === "FIXED_AMOUNT") return `Fixed amount discount • ${discountValue}`;
  if (rule === "BOGO") return "Buy one, get one";
  if (rule === "BOG2") return "Buy one, get two";
  if (rule === "BOG3") return "Buy one, get three";
  if (rule === "BOG5") return "Buy one, get five";
  return sale.discount_rule || "Discount";
}

function CouponDatePicker({ id, label, value, onChange, helpText, className = "", minDate = "", required = false }) {
  const pickerRef = useRef(null);
  const selectedDate = parseLocalDate(value);
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const initialDate = selectedDate || parseLocalDate(getISTDateString());
    return new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
  });
  const monthLabel = formatIndiaDate(visibleMonth, { month: "long", year: "numeric" });
  const monthStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const firstVisibleDate = new Date(monthStart);
  firstVisibleDate.setDate(1 - monthStart.getDay());
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstVisibleDate);
    date.setDate(firstVisibleDate.getDate() + index);
    return date;
  });
  const todayValue = getISTDateString();
  const today = parseLocalDate(todayValue);
  const minimumDate = minDate ? parseLocalDate(minDate) : null;
  const minimumMonth = minimumDate ? new Date(minimumDate.getFullYear(), minimumDate.getMonth(), 1) : null;
  const openCalendar = () => {
    if (!isOpen) {
      const dateToShow = selectedDate || today;
      setVisibleMonth(new Date(dateToShow.getFullYear(), dateToShow.getMonth(), 1));
    }
    setIsOpen(!isOpen);
  };

  return (
    <div
      ref={pickerRef}
      className={`promotions-field-group promotions-date-picker ${className}${isOpen ? " is-open" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setIsOpen(false);
      }}
    >
      <label id={`${id}-label`}>{label}</label>
      <button
        id={id}
        type="button"
        className="promotions-date-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-required={required}
        aria-labelledby={`${id}-label`}
        onClick={openCalendar}
      >
        <span className={value ? "" : "is-placeholder"}>
          {selectedDate
            ? formatIndiaDate(selectedDate, { month: "short", day: "numeric", year: "numeric" })
            : "Choose a date"}
        </span>
        <svg className="promotions-date-picker-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none">
          <rect x="2.75" y="4.25" width="14.5" height="13" rx="2.25" />
          <path d="M6.5 2.75v3M13.5 2.75v3M3 8h14" />
          <path d="M6.5 11h.01M10 11h.01M13.5 11h.01M6.5 14.25h.01M10 14.25h.01" />
        </svg>
      </button>
      {isOpen && (
        <div className="promotions-date-picker-popover" role="dialog" aria-label={`${label} calendar`}>
          <div className="promotions-date-picker-header">
            <button
              type="button"
              aria-label="Previous month"
              disabled={Boolean(minimumMonth && new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1) < minimumMonth)}
              onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}
            >
              ‹
            </button>
            <strong>{monthLabel}</strong>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}
            >
              ›
            </button>
          </div>
          <div className="promotions-date-picker-grid promotions-date-picker-weekdays" aria-hidden="true">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="promotions-date-picker-grid promotions-date-picker-days">
            {calendarDays.map((date) => {
              const dateValue = formatLocalDate(date);
              const isSelected = dateValue === value;
              const isToday = dateValue === todayValue;
              const isCurrentMonth = date.getMonth() === visibleMonth.getMonth();
              const isBeforeMinimum = Boolean(minDate && dateValue < minDate);
              return (
                <button
                  key={dateValue}
                  type="button"
                  aria-label={formatIndiaDate(date, { month: "long", day: "numeric", year: "numeric" })}
                  aria-pressed={isSelected}
                  disabled={isBeforeMinimum}
                  className={[
                    isCurrentMonth ? "" : "is-outside-month",
                    isToday ? "is-today" : "",
                    isSelected ? "is-selected" : "",
                    isBeforeMinimum ? "is-disabled" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    onChange(dateValue);
                    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
                    setIsOpen(false);
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="promotions-date-picker-footer">
            <button
              type="button"
              disabled={Boolean(minDate && todayValue < minDate)}
              onClick={() => {
                onChange(todayValue);
                setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                setIsOpen(false);
              }}
            >
              Today
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setIsOpen(false);
                }}
              >
                Clear date
              </button>
            )}
          </div>
        </div>
      )}
      <span className="promotions-field-help">{helpText}</span>
    </div>
  );
}

function AdminPromotionsPanel() {
  const [activeSection, setActiveSection] = useState(() => {
    const savedSection = window.localStorage.getItem(ACTIVE_SECTION_STORAGE_KEY);
    return SECTION_ITEMS.some((item) => item.key === savedSection) ? savedSection : "dashboard";
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [dashboard, setDashboard] = useState({
    active_campaigns: 0,
    scheduled_campaigns: 0,
    expired_campaigns: 0,
    coupons_created: 0,
    coupons_redeemed: 0,
    revenue_generated: 0,
    revenue_discounted: 0,
    average_discount: 0,
    referral_revenue: 0,
    loyalty_members: 0,
    flash_sales: 0,
    active_banners: 0,
    newsletter_campaigns: 0,
    conversion_rate: 0,
    email_open_rate: 0,
    email_click_rate: 0,
    coupon_redemption_rate: 0
  });
  const [coupons, setCoupons] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [contributorApplications, setContributorApplications] = useState([]);
  const [selectedBonusApplication, setSelectedBonusApplication] = useState(null);
  const [approvingBonusApplicationId, setApprovingBonusApplicationId] = useState(null);
  const [flashSales, setFlashSales] = useState([]);
  const [flashEventFilter, setFlashEventFilter] = useState("active");
  const [flashEventsNow, setFlashEventsNow] = useState(() => Date.now());
  const [contributorApplicationFilter, setContributorApplicationFilter] = useState("active");
  const [referrals, setReferrals] = useState([]);
  const [loyalty, setLoyalty] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [newsletters, setNewsletters] = useState([]);
  const [banners, setBanners] = useState([]);
  const [popups, setPopups] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [pushItems, setPushItems] = useState([]);
  const [automations, setAutomations] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [couponDraft, setCouponDraft] = useState(initialCouponForm);
  const [campaignDraft, setCampaignDraft] = useState(initialCampaignForm);
  const [flashDraft, setFlashDraft] = useState(initialFlashForm);
  const [flashCategories, setFlashCategories] = useState([]);
  const [flashCollections, setFlashCollections] = useState([]);
  const [referralDraft, setReferralDraft] = useState(initialReferralForm);
  const [loyaltyDraft, setLoyaltyDraft] = useState(initialLoyaltyForm);
  const [bundleDraft, setBundleDraft] = useState(initialBundleForm);
  const [newsletterDraft, setNewsletterDraft] = useState(initialNewsletterForm);
  const [bannerDraft, setBannerDraft] = useState(initialBannerForm);
  const [popupDraft, setPopupDraft] = useState(initialPopupForm);
  const [announcementDraft, setAnnouncementDraft] = useState(initialAnnouncementForm);
  const [pushDraft, setPushDraft] = useState(initialPushForm);
  const [automationDraft, setAutomationDraft] = useState(initialAutomationForm);
  const [couponSearch, setCouponSearch] = useState("");
  const [couponFilter, setCouponFilter] = useState("all");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState("active");
  const [couponDeliveryEmail, setCouponDeliveryEmail] = useState("");
  const [couponDeliveryUserId, setCouponDeliveryUserId] = useState("");
  const [couponCustomerSearch, setCouponCustomerSearch] = useState("");
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false);
  const [isLoadingCouponCustomers, setIsLoadingCouponCustomers] = useState(false);
  const [couponCustomerLoadError, setCouponCustomerLoadError] = useState("");
  const [activeContributors, setActiveContributors] = useState([]);
  const [contributorSearch, setContributorSearch] = useState("");
  const [isContributorPickerOpen, setIsContributorPickerOpen] = useState(false);
  const [isLoadingContributors, setIsLoadingContributors] = useState(false);
  const [contributorLoadError, setContributorLoadError] = useState("");
  const [editingCouponId, setEditingCouponId] = useState(null);
  const [editingCampaignId, setEditingCampaignId] = useState(null);
  const [editingFlashId, setEditingFlashId] = useState(null);
  const [editingBundleId, setEditingBundleId] = useState(null);

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, activeSection);
  }, [activeSection]);

  useEffect(() => {
    const timerId = window.setInterval(() => setFlashEventsNow(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  const loadPromotions = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE_URL}/admin/promotions`, { headers: buildAuthHeaders() });
      const payload = res.data || {};
      setDashboard(payload.dashboard || dashboard);
      setCoupons(Array.isArray(payload.coupons) ? payload.coupons : []);
      setCampaigns(Array.isArray(payload.campaigns) ? payload.campaigns : []);
      setContributorApplications(Array.isArray(payload.contributor_applications) ? payload.contributor_applications : []);
      setFlashSales(Array.isArray(payload.flash_sales) ? payload.flash_sales : []);
      setReferrals(Array.isArray(payload.referrals) ? payload.referrals : []);
      setLoyalty(Array.isArray(payload.loyalty) ? payload.loyalty : []);
      setBundles(Array.isArray(payload.bundles) ? payload.bundles : []);
      setNewsletters(Array.isArray(payload.newsletters) ? payload.newsletters : []);
      setBanners(Array.isArray(payload.banners) ? payload.banners : []);
      setPopups(Array.isArray(payload.popups) ? payload.popups : []);
      setAnnouncements(Array.isArray(payload.announcements) ? payload.announcements : []);
      setPushItems(Array.isArray(payload.push_notifications) ? payload.push_notifications : []);
      setAutomations(Array.isArray(payload.automation_rules) ? payload.automation_rules : []);
      setActivityLog(Array.isArray(payload.activity_logs) ? payload.activity_logs : []);
      setMessage(payload.message || "");
    } catch (err) {
      console.error(err);
      setMessage(err.response?.data?.error || "Unable to load promotions data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPromotions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeSection !== "campaigns") return undefined;
    let active = true;
    const refreshContributorApplications = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/admin/promotions`, { headers: buildAuthHeaders() });
        if (active) {
          setContributorApplications(Array.isArray(response.data?.contributor_applications)
            ? response.data.contributor_applications
            : []);
        }
      } catch (error) {
        console.error("Failed to refresh Contributor Offer applications", error);
        if (active) setMessage(error.response?.data?.error || "Unable to refresh Contributor Offer applications.");
      }
    };
    const timerId = window.setInterval(refreshContributorApplications, 30 * 1000);
    return () => {
      active = false;
      window.clearInterval(timerId);
    };
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== "flash-sales") return undefined;

    let active = true;
    const loadFlashPlacementOptions = async () => {
      try {
        const [categoriesResponse, collectionsResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/categories`),
          axios.get(`${API_BASE_URL}/collections`)
        ]);
        if (!Array.isArray(categoriesResponse.data) || !Array.isArray(collectionsResponse.data)) {
          throw new Error("Flash sale placement options response was invalid.");
        }
        if (active) {
          setFlashCategories(categoriesResponse.data);
          setFlashCollections(collectionsResponse.data);
        }
      } catch (err) {
        console.error("Failed to load flash sale placement options", err);
        if (active) {
          setMessage(err.response?.data?.error || "Unable to load categories and collections for flash sales.");
        }
      }
    };

    loadFlashPlacementOptions();
    return () => {
      active = false;
    };
  }, [activeSection]);

  useEffect(() => {
    if (!isCustomerPickerOpen && !editingCouponId) return undefined;

    let active = true;
    const loadCustomers = async () => {
      setIsLoadingCouponCustomers(true);
      setCouponCustomerLoadError("");
      try {
        const response = await axios.get(`${API_BASE_URL}/admin/promotions/customers`, { headers: buildAuthHeaders() });
        if (!Array.isArray(response.data)) {
          throw new Error("Active customer response was invalid.");
        }
        if (active) setCustomers(response.data);
      } catch (error) {
        console.error("Unable to load active customers for generated coupons", error);
        if (active) setCouponCustomerLoadError(error.response?.data?.error || "Unable to load active customers. Please close and reopen the list to try again.");
      } finally {
        if (active) setIsLoadingCouponCustomers(false);
      }
    };

    loadCustomers();
    return () => { active = false; };
  }, [isCustomerPickerOpen, editingCouponId]);

  useEffect(() => {
    if (activeSection !== "campaigns" || campaignDraft.eligibility_scope !== "selected" || activeContributors.length > 0) {
      return undefined;
    }

    let active = true;
    const loadActiveContributors = async () => {
      setIsLoadingContributors(true);
      setContributorLoadError("");
      try {
        const response = await axios.get(`${API_BASE_URL}/admin/promotions/contributors`, { headers: buildAuthHeaders() });
        if (!Array.isArray(response.data)) {
          throw new Error("Active contributors response was invalid.");
        }
        if (active) setActiveContributors(response.data);
      } catch (error) {
        console.error("Unable to load active contributors for offers", error);
        if (active) {
          setContributorLoadError(error.response?.data?.error || "Unable to load active contributors. Please retry.");
        }
      } finally {
        if (active) setIsLoadingContributors(false);
      }
    };

    loadActiveContributors();
    return () => { active = false; };
  }, [activeSection, campaignDraft.eligibility_scope, activeContributors.length]);

  const filteredCoupons = useMemo(() => {
    return coupons.filter((coupon) => {
      const matchesSearch = !couponSearch || String(coupon.name || coupon.code || "").toLowerCase().includes(couponSearch.toLowerCase());
      const matchesFilter = couponFilter === "all" || String(coupon.status || "draft") === couponFilter;
      return matchesSearch && matchesFilter;
    });
  }, [coupons, couponSearch, couponFilter]);

  const filteredCampaigns = useMemo(() => campaigns.filter((campaign) => (
    campaignStatusFilter === "all" || getCampaignDisplayStatus(campaign.status) === campaignStatusFilter
  )), [campaigns, campaignStatusFilter]);

  const filteredContributorApplications = useMemo(() => contributorApplications.filter((application) => (
    contributorApplicationFilter === "all"
    || getContributorApplicationDisplayStatus(application) === contributorApplicationFilter
  )), [contributorApplications, contributorApplicationFilter]);

  const filteredCouponCustomers = useMemo(() => {
    const query = couponCustomerSearch.trim().toLowerCase();
    return customers.filter((customer) => String(customer.username || "").toLowerCase().includes(query));
  }, [customers, couponCustomerSearch]);

  const filteredActiveContributors = useMemo(() => {
    const query = contributorSearch.trim().toLowerCase();
    return activeContributors.filter((contributor) => (
      String(contributor.username || "").toLowerCase().includes(query)
    ));
  }, [activeContributors, contributorSearch]);

  const editingCoupon = coupons.find((coupon) => String(coupon.id) === String(editingCouponId));
  const editingCouponMetadata = editingCoupon ? getCouponMetadata(editingCoupon) : {};
  const editingCouponRecipientUser = customers.find(
    (customer) => String(customer.id) === String(editingCouponMetadata.restricted_user_id || "")
  );
  const editingCouponRecipient = editingCoupon?.coupon_type === "auto"
    ? [
      editingCouponRecipientUser?.username || editingCouponMetadata.restricted_username,
      getCouponDeliveryEmail(editingCoupon)
    ].filter(Boolean).join(" • ")
    : "";

  const persistResource = async (resource, action, data, successMessage) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/admin/promotions`, { resource, action, data }, { headers: buildAuthHeaders() });
      setMessage(successMessage || res.data?.message || "Saved successfully.");
      await loadPromotions();
      return res.data;
    } catch (err) {
      console.error(err);
      setMessage(err.response?.data?.error || "Request failed.");
      throw err;
    }
  };

  const withdrawContributorApplication = async (application) => {
    try {
      await axios.post(
        `${API_BASE_URL}/admin/promotions/applications/${application.id}/withdraw`,
        {},
        { headers: buildAuthHeaders() }
      );
      setContributorApplications((currentApplications) => currentApplications.map((item) => (
        String(item.id) === String(application.id) ? { ...item, status: "withdrawn" } : item
      )));
      setMessage("Contributor application withdrawn.");
    } catch (error) {
      console.error("Failed to withdraw Contributor Offer application", error);
      setMessage(error.response?.data?.error || "Failed to withdraw Contributor Offer application.");
    }
  };

  const approveContributorBonus = async (application) => {
    if (approvingBonusApplicationId !== null || application.benefit_approved) return;
    setApprovingBonusApplicationId(application.id);
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/promotions/applications/${application.id}/approve-benefit`,
        {},
        { headers: buildAuthHeaders() }
      );
      const approvedApplication = {
        ...application,
        ...response.data?.application,
        paid_amount: response.data?.application?.benefit_amount ?? application.paid_amount,
        benefit_approved: true
      };
      setContributorApplications((currentApplications) => currentApplications.map((item) => (
        String(item.id) === String(application.id) ? approvedApplication : item
      )));
      setSelectedBonusApplication(approvedApplication);
      setMessage(response.data?.alreadyApproved
        ? "This Contributor Offer bonus was already approved and credited."
        : "Contributor Offer bonus approved and added to unpaid earnings.");
    } catch (error) {
      console.error("Failed to approve Contributor Offer bonus", error);
      setMessage(error.response?.data?.error || "Failed to approve Contributor Offer bonus.");
    } finally {
      setApprovingBonusApplicationId(null);
    }
  };

  const handleCouponSubmit = async (event) => {
    event.preventDefault();
    const isAutoGenerated = couponDraft.coupon_type === "auto";
    const deliveryEmail = couponDeliveryEmail.trim();
    const deliveryUserId = couponDeliveryUserId;
    if (isAutoGenerated && !editingCouponId && Boolean(deliveryEmail) === Boolean(deliveryUserId)) {
      setMessage("Choose either an email address or a customer for the generated coupon.");
      return;
    }
    if (!isAutoGenerated && !couponDraft.code.trim()) {
      setMessage("Enter a coupon code for a manual coupon.");
      return;
    }
    const payload = {
      ...couponDraft,
      ...(isAutoGenerated ? {
        code: "",
        delivery_email: deliveryEmail || undefined,
        delivery_user_id: deliveryUserId || undefined,
      } : {}),
      discount_value: Number(couponDraft.discount_value || 0),
      usage_limit: Number(couponDraft.usage_limit || 0)
    };
    if (editingCouponId) {
      await persistResource("coupon", "update", { ...payload, id: editingCouponId }, "Coupon updated.");
      setEditingCouponId(null);
      setCouponDraft(initialCouponForm);
      return;
    }
    await persistResource("coupon", "create", payload, isAutoGenerated ? "Generated coupon created and sent." : "Coupon created.");
    setCouponDraft(initialCouponForm);
    setCouponDeliveryEmail("");
    setCouponDeliveryUserId("");
  };

  const startEditingCoupon = (coupon) => {
    setEditingCouponId(coupon.id);
    const metadata = getCouponMetadata(coupon);
    setCouponDeliveryEmail(metadata?.restricted_user_id ? "" : String(metadata?.delivery_email || ""));
    setCouponDeliveryUserId(metadata?.restricted_user_id == null ? "" : String(metadata.restricted_user_id));
    setCouponDraft({
      name: coupon.name || "",
      code: coupon.code || "",
      coupon_type: coupon.coupon_type || "manual",
      discount_type: coupon.discount_type || "percentage",
      discount_value: coupon.discount_value ?? "",
      status: coupon.status || "active",
      start_at: coupon.start_at ? String(coupon.start_at).slice(0, 10) : "",
      end_at: coupon.end_at ? String(coupon.end_at).slice(0, 10) : "",
      usage_limit: coupon.usage_limit ?? "",
      notes: coupon.notes || ""
    });
    setActiveSection("coupons");
  };

  const toggleCouponStatus = async (coupon, nextStatus) => {
    await persistResource("coupon", "update", { id: coupon.id, status: nextStatus }, "Coupon status updated.");
  };

  const archiveCoupon = async (coupon) => {
    await persistResource("coupon", "update", { id: coupon.id, status: "archived" }, "Coupon archived.");
  };

  const duplicateCoupon = async (coupon) => {
    await persistResource("coupon", "duplicate", { id: coupon.id }, "Coupon duplicated.");
  };

  const deleteCoupon = async (id) => {
    await persistResource("coupon", "delete", { id }, "Coupon removed.");
  };

  const handleCampaignSubmit = async (event) => {
    event.preventDefault();
    if (!campaignDraft.start_date) {
      setMessage("Contributor Offers require a start date.");
      return;
    }
    if (campaignDraft.eligibility_scope === "selected" && campaignDraft.eligible_contributor_ids.length === 0) {
      setMessage("Select at least one active contributor for this offer.");
      return;
    }
    if (campaignDraft.end_date && campaignDraft.end_date < campaignDraft.start_date) {
      setMessage("Offer end date must be on or after the start date.");
      return;
    }
    const selectedContributors = activeContributors.filter((contributor) => (
      campaignDraft.eligible_contributor_ids.includes(String(contributor.id))
    ));
    const payload = {
      name: campaignDraft.name,
      campaign_type: "contributor_offer",
      objective: campaignDraft.description,
      status: ({ draft: "planned", ended: "expired", active: "scheduled" })[campaignDraft.status] || campaignDraft.status,
      budget: 0,
      start_date: campaignDraft.start_date || null,
      end_date: campaignDraft.end_date || null,
      audience: campaignDraft.eligibility_scope === "all"
        ? "All contributors"
        : `Selected contributors: ${selectedContributors.map((contributor) => contributor.username).join(", ")}`,
      priority: "medium",
      notes: campaignDraft.admin_notes,
      metadata: {
        benefit_type: campaignDraft.benefit_type,
        benefit_value: campaignDraft.benefit_value === "" ? null : Number(campaignDraft.benefit_value),
        eligibility_scope: campaignDraft.eligibility_scope,
        eligible_contributors: selectedContributors.map((contributor) => contributor.username).join(", "),
        eligible_contributor_ids: campaignDraft.eligible_contributor_ids,
        eligibility_requirements: campaignDraft.eligibility_requirements,
        eligibility_requirement_value: campaignDraft.eligibility_requirement_value === ""
          ? null
          : Number(campaignDraft.eligibility_requirement_value)
      }
    };
    if (editingCampaignId) {
      await persistResource("campaign", "update", { ...payload, id: editingCampaignId }, "Contributor offer updated.");
      setEditingCampaignId(null);
      setCampaignDraft(initialCampaignForm);
      return;
    }
    await persistResource("campaign", "create", payload, "Contributor offer created.");
    setCampaignDraft(initialCampaignForm);
  };

  const startEditingCampaign = (campaign) => {
    const metadata = getCampaignMetadata(campaign);
    setEditingCampaignId(campaign.id);
    setCampaignDraft({
      name: campaign.name || "",
      description: campaign.objective || "",
      benefit_type: metadata.benefit_type || "bonus_payout",
      benefit_value: metadata.benefit_value ?? "",
      eligibility_scope: metadata.eligibility_scope || "all",
      eligible_contributors: metadata.eligible_contributors || "",
      eligible_contributor_ids: Array.isArray(metadata.eligible_contributor_ids)
        ? metadata.eligible_contributor_ids.map(String)
        : [],
      eligibility_requirements: metadata.eligibility_requirements || "",
      eligibility_requirement_value: metadata.eligibility_requirement_value ?? "",
      start_date: campaign.start_date ? String(campaign.start_date).slice(0, 10) : "",
      end_date: campaign.end_date ? String(campaign.end_date).slice(0, 10) : "",
      status: ({ planned: "draft", running: "active", completed: "ended", expired: "ended" })[campaign.status] || campaign.status || "draft",
      admin_notes: campaign.notes || ""
    });
    setActiveSection("campaigns");
  };

  const handleFlashSubmit = async (event) => {
    event.preventDefault();
    const today = getISTDateString();
    if (flashDraft.status === "scheduled" && (!flashDraft.start_date || flashDraft.start_date <= today)) {
      setMessage("Scheduled Flash Sales must have a start date later than today.");
      return;
    }
    const payload = {
      ...flashDraft,
      metadata: {
        featured_category_id: flashDraft.featured_placement === "category" ? flashDraft.featured_category_id || null : null,
        featured_collection_id: flashDraft.featured_placement === "collection" ? flashDraft.featured_collection_id || null : null,
        keywords: (
          (flashDraft.featured_placement === "category" && flashDraft.featured_category_id === "all")
          || (flashDraft.featured_placement === "collection" && flashDraft.featured_collection_id === "all")
        ) ? flashDraft.keywords : "",
        discount_value: ["percentage", "fixed_amount"].includes(flashDraft.discount_rule)
          ? Number(flashDraft.discount_value || 0)
          : 0
      }
    };

    if (editingFlashId) {
      await persistResource("flash_sale", "update", { ...payload, id: editingFlashId }, "Flash sale updated.");
      setEditingFlashId(null);
      setFlashDraft(initialFlashForm);
      return;
    }
    await persistResource("flash_sale", "create", payload, "Flash sale created.");
    setFlashDraft(initialFlashForm);
  };

  const handleBundleSubmit = async (event) => {
    event.preventDefault();
    if (!bundleDraft.name.trim()) {
      setMessage("Enter a name for this bundle discount.");
      return;
    }
    if (!bundleDraft.start_date) {
      setMessage("Bundle discounts require a start date.");
      return;
    }
    if (bundleDraft.end_date && bundleDraft.end_date < bundleDraft.start_date) {
      setMessage("Bundle discount end date must be on or after the start date.");
      return;
    }
    const thresholds = new Set();
    const tiers = [];
    for (const tier of bundleDraft.tiers) {
      const assetCount = Number(tier.asset_count);
      const discountPercent = Number(tier.discount_percent);
      if (!Number.isInteger(assetCount) || assetCount <= 0) {
        setMessage("Each tier must have a positive whole-number asset count.");
        return;
      }
      if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
        setMessage("Each tier discount must be greater than 0% and no more than 100%.");
        return;
      }
      if (thresholds.has(assetCount)) {
        setMessage("Each asset-count threshold must be unique.");
        return;
      }
      thresholds.add(assetCount);
      tiers.push({ asset_count: assetCount, discount_percent: discountPercent });
    }

    tiers.sort((left, right) => left.asset_count - right.asset_count);
    const payload = {
      name: bundleDraft.name.trim(),
      status: bundleDraft.status,
      metadata: {
        discount_tiers: tiers,
        start_date: bundleDraft.start_date,
        end_date: bundleDraft.end_date || null
      }
    };
    if (editingBundleId) {
      await persistResource("bundle", "update", { ...payload, id: editingBundleId }, "Bundle discount updated.");
      setEditingBundleId(null);
    } else {
      await persistResource("bundle", "create", payload, "Bundle discount created.");
    }
    setBundleDraft(initialBundleForm);
  };

  const startEditingBundle = (bundle) => {
    const metadata = getCampaignMetadata(bundle);
    const tiers = Array.isArray(metadata.discount_tiers) && metadata.discount_tiers.length
      ? metadata.discount_tiers.map((tier) => ({
        asset_count: String(tier.asset_count ?? ""),
        discount_percent: String(tier.discount_percent ?? "")
      }))
      : initialBundleForm.tiers;
    setEditingBundleId(bundle.id);
    setBundleDraft({
      name: bundle.name || "",
      tiers: tiers.map((tier) => ({ ...tier })),
      start_date: metadata.start_date ? String(metadata.start_date).slice(0, 10) : "",
      end_date: metadata.end_date ? String(metadata.end_date).slice(0, 10) : "",
      status: String(bundle.status || "draft").toLowerCase() === "active" ? "active" : "draft"
    });
    setActiveSection("bundles");
  };

  const startEditingFlash = (sale) => {
    setEditingFlashId(sale.id);
    const metadata = typeof sale.metadata === "string" ? JSON.parse(sale.metadata) : sale.metadata || {};
    setFlashDraft({
      name: sale.name || "",
      discount_rule: sale.discount_rule || "",
      status: sale.status || "scheduled",
      start_date: sale.start_date ? String(sale.start_date).slice(0, 10) : "",
      end_date: sale.end_date ? String(sale.end_date).slice(0, 10) : "",
      featured_placement: sale.featured_placement || "homepage",
      featured_category_id: metadata.featured_category_id == null ? "" : String(metadata.featured_category_id),
      featured_collection_id: metadata.featured_collection_id == null ? "" : String(metadata.featured_collection_id),
      keywords: metadata.keywords || "",
      discount_value: metadata.discount_value ?? ""
    });
    setActiveSection("flash-sales");
  };

  const scheduledStartMinimum = (() => {
    const tomorrow = parseLocalDate(getISTDateString());
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatLocalDate(tomorrow);
  })();

  const flashEventRecords = flashSales.map((sale) => {
    const metadata = typeof sale.metadata === "string" ? JSON.parse(sale.metadata || "{}") : sale.metadata || {};
    const timing = getFlashEventTiming(sale, new Date(flashEventsNow));
    const placement = String(sale.featured_placement || "homepage").toLowerCase();
    const targetLabel = placement === "category"
      ? `Category: ${metadata.featured_category_id === "all" ? "All categories" : flashCategories.find((category) => String(category.id) === String(metadata.featured_category_id))?.name || "Selected category"}`
      : placement === "collection"
        ? `Collection: ${metadata.featured_collection_id === "all" ? "All collections" : flashCollections.find((collection) => String(collection.id) === String(metadata.featured_collection_id))?.name || "Selected collection"}`
        : "Homepage";
    return {
      sale,
      metadata,
      timing,
      targetLabel,
      ruleDetails: getFlashEventRuleDetails(sale),
      remaining: timing.expiresAt ? timing.expiresAt.getTime() - flashEventsNow : null
    };
  });
  const filteredFlashEvents = flashEventRecords.filter(({ timing }) => (
    flashEventFilter === "all" || timing.status === flashEventFilter
  ));

  const renderKpiCards = () => {
    const cards = [
      { label: "Active Campaigns", value: dashboard.active_campaigns || 0 },
      { label: "Scheduled Campaigns", value: dashboard.scheduled_campaigns || 0 },
      { label: "Expired Campaigns", value: dashboard.expired_campaigns || 0 },
      { label: "Coupons Created", value: dashboard.coupons_created || 0 },
      { label: "Coupons Redeemed", value: dashboard.coupons_redeemed || 0 },
      { label: "Revenue Generated", value: `₹${Number(dashboard.revenue_generated || 0).toLocaleString()}` },
      { label: "Revenue Discounted", value: `₹${Number(dashboard.revenue_discounted || 0).toLocaleString()}` },
      { label: "Average Discount", value: `${Number(dashboard.average_discount || 0).toFixed(1)}%` },
      { label: "Referral Revenue", value: `₹${Number(dashboard.referral_revenue || 0).toLocaleString()}` },
      { label: "Loyalty Members", value: dashboard.loyalty_members || 0 },
      { label: "Flash Sales", value: dashboard.flash_sales || 0 },
      { label: "Active Banners", value: dashboard.active_banners || 0 },
      { label: "Newsletter Campaigns", value: dashboard.newsletter_campaigns || 0 },
      { label: "Conversion Rate", value: `${Number(dashboard.conversion_rate || 0).toFixed(1)}%` },
      { label: "Email Open Rate", value: `${Number(dashboard.email_open_rate || 0).toFixed(1)}%` },
      { label: "Email Click Rate", value: `${Number(dashboard.email_click_rate || 0).toFixed(1)}%` },
      { label: "Coupon Redemption Rate", value: `${Number(dashboard.coupon_redemption_rate || 0).toFixed(1)}%` }
    ];

    return (
      <div className="promotions-kpi-grid">
        {cards.map((card) => (
          <div key={card.label} className="promotions-card">
            <div className="promotions-card-label">{card.label}</div>
            <div className="promotions-card-value"><AnimatedPromotionValue value={card.value} /></div>
          </div>
        ))}
      </div>
    );
  };

  const renderSectionContent = () => {
    switch (activeSection) {
      case "dashboard":
        return (
          <div className="promotions-stack">
            <div className="promotions-card promotions-hero">
              <div>
                <div className="promotions-eyebrow">Enterprise Marketing Hub</div>
                <h3>Promotions Hub</h3>
                <p>Create, schedule, and analyze promotions from one place with PostgreSQL-backed workflows.</p>
              </div>
              <div className="promotions-chip">Super Admin + Authorized Admin</div>
            </div>
            {renderKpiCards()}
          </div>
        );
      case "coupons":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Coupon Management</h3>
                <span>Create, edit, duplicate, enable, disable, archive, and search coupons.</span>
              </div>
              <form className="promotions-form-grid promotions-coupon-form" onSubmit={handleCouponSubmit}>
                <div className="promotions-field-group">
                  <label htmlFor="coupon-name">Coupon name</label>
                  <input id="coupon-name" value={couponDraft.name} onChange={(e) => setCouponDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="Coupon name" />
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="coupon-code">Coupon code</label>
                  <input
                    id="coupon-code"
                    value={couponDraft.code}
                    onChange={(e) => setCouponDraft((prev) => ({ ...prev, code: e.target.value }))}
                    placeholder={couponDraft.coupon_type === "auto" ? "Generated when coupon is created" : "Enter coupon code"}
                    disabled={couponDraft.coupon_type === "auto"}
                  />
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="coupon-type">Coupon type</label>
                  <select
                    id="coupon-type"
                    value={couponDraft.coupon_type}
                    onChange={(e) => {
                      const couponType = e.target.value;
                      setCouponDraft((prev) => ({ ...prev, coupon_type: couponType, code: couponType === "auto" ? "" : prev.code }));
                      if (couponType !== "auto") {
                        setCouponDeliveryEmail("");
                        setCouponDeliveryUserId("");
                      }
                    }}
                  >
                    <option value="manual">Manual</option>
                    <option value="auto">Auto Generated</option>
                    <option value="first_order">First Order</option>
                  </select>
                </div>
                <div className={`promotions-auto-fields${couponDraft.coupon_type === "auto" ? " is-open" : ""}`} aria-hidden={couponDraft.coupon_type !== "auto"}>
                  <div className="promotions-auto-fields-inner">
                    <div className="promotions-field-group promotions-coupon-recipient">
                      <label htmlFor="coupon-delivery-email">Send generated code to email</label>
                      <input
                        id="coupon-delivery-email"
                        type="email"
                        value={couponDeliveryEmail}
                        onChange={(e) => {
                          setCouponDeliveryEmail(e.target.value);
                          if (e.target.value) setCouponDeliveryUserId("");
                        }}
                        placeholder="customer@example.com"
                      />
                    </div>
                    <div
                      className={`promotions-field-group promotions-coupon-recipient promotions-customer-picker${isCustomerPickerOpen ? " is-open" : ""}`}
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) {
                          setIsCustomerPickerOpen(false);
                        }
                      }}
                    >
                      <label id="coupon-delivery-customer-label">Or select a customer</label>
                      <button
                        type="button"
                        className="promotions-customer-picker-trigger"
                        aria-haspopup="listbox"
                        aria-expanded={isCustomerPickerOpen}
                        aria-labelledby="coupon-delivery-customer-label"
                        onClick={() => setIsCustomerPickerOpen((open) => !open)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setIsCustomerPickerOpen(false);
                        }}
                      >
                        {customers.find((customer) => String(customer.id) === couponDeliveryUserId)?.username || "Choose a customer"}
                      </button>
                      {isCustomerPickerOpen && (
                        <div className="promotions-customer-picker-menu" role="listbox" aria-label="Active customers">
                          <input
                            type="search"
                            aria-label="Search customers by username"
                            placeholder="Search username..."
                            value={couponCustomerSearch}
                            onChange={(event) => setCouponCustomerSearch(event.target.value)}
                            autoFocus
                          />
                          <div className="promotions-customer-picker-options">
                            {isLoadingCouponCustomers ? (
                              <span className="promotions-customer-picker-empty">Loading active customers...</span>
                            ) : couponCustomerLoadError ? (
                              <span className="promotions-customer-picker-empty" role="alert">{couponCustomerLoadError}</span>
                            ) : filteredCouponCustomers.length ? filteredCouponCustomers.map((customer) => (
                              <button
                                key={customer.id}
                                type="button"
                                role="option"
                                aria-selected={String(customer.id) === couponDeliveryUserId}
                                onClick={() => {
                                  setCouponDeliveryUserId(String(customer.id));
                                  setCouponDeliveryEmail("");
                                  setCouponCustomerSearch("");
                                  setIsCustomerPickerOpen(false);
                                }}
                              >
                                {customer.username}
                              </button>
                            )) : <span className="promotions-customer-picker-empty">No active customers found.</span>}
                          </div>
                        </div>
                      )}
                    </div>
                    {editingCouponRecipient ? (
                      <div className="promotions-field-help promotions-coupon-recipient">
                        Current recipient: {editingCouponRecipient}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="coupon-discount-type">Discount type</label>
                  <select id="coupon-discount-type" value={couponDraft.discount_type} onChange={(e) => setCouponDraft((prev) => ({ ...prev, discount_type: e.target.value }))}>
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed Amount</option>
                  </select>
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="coupon-discount-value">Discount value</label>
                  <input id="coupon-discount-value" type="number" value={couponDraft.discount_value} onChange={(e) => setCouponDraft((prev) => ({ ...prev, discount_value: e.target.value }))} placeholder="Enter value" />
                </div>
                <CouponDatePicker
                  id="coupon-start-date"
                  label="Start date"
                  value={couponDraft.start_at}
                  onChange={(start_at) => setCouponDraft((prev) => ({ ...prev, start_at }))}
                  helpText="The coupon becomes available on this date."
                />
                <CouponDatePicker
                  id="coupon-end-date"
                  label="End date"
                  value={couponDraft.end_at}
                  onChange={(end_at) => setCouponDraft((prev) => ({ ...prev, end_at }))}
                  helpText="The coupon expires at the start of this date, so it may not be usable on the selected end date."
                />
                <div className="promotions-field-group">
                  <label htmlFor="coupon-usage-limit">Usage limit</label>
                  <input id="coupon-usage-limit" type="number" value={couponDraft.usage_limit} onChange={(e) => setCouponDraft((prev) => ({ ...prev, usage_limit: e.target.value }))} placeholder="Unlimited" />
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="coupon-status">Status</label>
                  <select id="coupon-status" value={couponDraft.status} onChange={(e) => setCouponDraft((prev) => ({ ...prev, status: e.target.value }))}>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                    <option value="archived">Archived</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
                <div className="promotions-field-group promotions-coupon-notes">
                  <label htmlFor="coupon-notes">Notes</label>
                  <textarea id="coupon-notes" value={couponDraft.notes} onChange={(e) => setCouponDraft((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notes" />
                </div>
                <button type="submit">{editingCouponId ? "Update Coupon" : "Create Coupon"}</button>
              </form>
            </div>
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Coupon Library</h3>
                <div className="promotions-inline-controls">
                  <input value={couponSearch} onChange={(e) => setCouponSearch(e.target.value)} placeholder="Search" />
                  <select value={couponFilter} onChange={(e) => setCouponFilter(e.target.value)}>
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>
              <div className="promotions-list">
                {filteredCoupons.length === 0 ? <p>No coupons yet.</p> : filteredCoupons.map((coupon) => {
                  const usageLimit = Number(coupon.usage_limit || 0);
                  const usedCount = Number(coupon.used_count || 0);
                  const remainingUses = usageLimit > 0 ? Math.max(0, usageLimit - usedCount) : "Unlimited";
                  const expiryText = coupon.expires_label || (
                    coupon.end_at ? `Expires in ${Math.ceil((new Date(coupon.end_at) - new Date()) / (1000 * 60 * 60 * 24))} days` : "No expiry date"
                  );

                  return (
                    <div key={coupon.id} className="promotions-list-item">
                      <div>
                        <strong>{coupon.name || coupon.code}</strong>
                        <div className="promotions-muted">
                          {coupon.code} • {String(coupon.discount_type || '').replace(/^(flat|fixed)$/i, 'Fixed Amount').replace(/^percentage$/i, 'Percentage')} • {coupon.status}
                        </div>
                        {String(coupon.coupon_type || '').toLowerCase() === "auto" && (
                          <div className="promotions-muted">
                            Recipient: {[
                              getCouponMetadata(coupon).restricted_username,
                              getCouponDeliveryEmail(coupon)
                            ].filter(Boolean).join(" • ") || "Not recorded"}
                          </div>
                        )}
                        <div className="promotions-muted">
                          {usageLimit > 0 ? `Remaining: ${remainingUses}/${usageLimit}` : 'Remaining: Unlimited'} • {expiryText}
                        </div>
                      </div>
                      <div className="promotions-inline-actions">
                        <button type="button" onClick={() => startEditingCoupon(coupon)}>Edit</button>
                        <button type="button" onClick={() => duplicateCoupon(coupon)}>Duplicate</button>
                        <button type="button" onClick={() => toggleCouponStatus(coupon, coupon.status === "active" ? "disabled" : "active")}>{coupon.status === "active" ? "Disable" : "Enable"}</button>
                        <button type="button" disabled={coupon.status === "archived"} onClick={() => archiveCoupon(coupon)}>{coupon.status === "archived" ? "Archived" : "Archive"}</button>
                        <button type="button" onClick={() => deleteCoupon(coupon.id)}>Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      case "campaigns":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Contributor Offers</h3>
                <span>Configure benefits and eligibility for contributor offers.</span>
              </div>
              <form className="promotions-form-grid promotions-campaign-form" onSubmit={handleCampaignSubmit}>
                <div className="promotions-field-group">
                  <label htmlFor="campaign-name">Offer name</label>
                  <input id="campaign-name" value={campaignDraft.name} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="Offer name" required />
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="campaign-description">Description</label>
                  <textarea id="campaign-description" value={campaignDraft.description} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, description: e.target.value }))} placeholder="Describe this offer" />
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="campaign-benefit-type">Benefit type</label>
                  <select id="campaign-benefit-type" value={campaignDraft.benefit_type} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, benefit_type: e.target.value }))}>
                    <option value="bonus_payout">Bonus payout</option>
                    <option value="commission_increase">Commission increase</option>
                    <option value="fee_waiver">Fee waiver</option>
                  </select>
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="campaign-benefit-value">Benefit value</label>
                  <input id="campaign-benefit-value" type="number" min="0" step="any" value={campaignDraft.benefit_value} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, benefit_value: e.target.value }))} placeholder="Amount or percentage" />
                </div>
                <CouponDatePicker
                  id="campaign-start-date"
                  label="Start Date"
                  value={campaignDraft.start_date}
                  onChange={(value) => setCampaignDraft((prev) => ({ ...prev, start_date: value }))}
                  required
                  className="promotions-date-picker--contributor-offer"
                />
                <CouponDatePicker
                  id="campaign-end-date"
                  label="End Date"
                  value={campaignDraft.end_date}
                  onChange={(value) => setCampaignDraft((prev) => ({ ...prev, end_date: value }))}
                  minDate={campaignDraft.start_date}
                  className="promotions-date-picker--contributor-offer"
                />
                <div className="promotions-field-group">
                  <label htmlFor="campaign-eligibility-scope">Eligible contributors</label>
                  <select id="campaign-eligibility-scope" value={campaignDraft.eligibility_scope} onChange={(e) => {
                    const eligibilityScope = e.target.value;
                    setCampaignDraft((prev) => ({
                      ...prev,
                      eligibility_scope: eligibilityScope,
                      ...(eligibilityScope === "all" ? { eligible_contributors: "", eligible_contributor_ids: [] } : {})
                    }));
                  }}>
                    <option value="all">All contributors</option>
                    <option value="selected">Selected contributors</option>
                  </select>
                </div>
                {campaignDraft.eligibility_scope === "selected" && (
                  <div
                    className={`promotions-field-group promotions-customer-picker promotions-conditional-field${isContributorPickerOpen ? " is-open" : ""}`}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setIsContributorPickerOpen(false);
                      }
                    }}
                  >
                    <label htmlFor="campaign-contributor-picker-trigger">Choose Active Contributor</label>
                    <button
                      id="campaign-contributor-picker-trigger"
                      type="button"
                      className="promotions-customer-picker-trigger"
                      aria-haspopup="listbox"
                      aria-expanded={isContributorPickerOpen}
                      aria-required="true"
                      aria-label="Select active contributors"
                      onClick={() => setIsContributorPickerOpen((open) => !open)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setIsContributorPickerOpen(false);
                      }}
                    >
                      <span>
                        {campaignDraft.eligible_contributor_ids.length
                          ? `${campaignDraft.eligible_contributor_ids.length} contributor${campaignDraft.eligible_contributor_ids.length === 1 ? "" : "s"} selected`
                          : "Select contributors"}
                      </span>
                      <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
                        <path d="m4 6 4 4 4-4" />
                      </svg>
                    </button>
                    {isContributorPickerOpen && (
                      <div className="promotions-customer-picker-menu" role="listbox" aria-label="Active contributors" aria-multiselectable="true">
                        <input
                          type="search"
                          aria-label="Search active contributors by username"
                          placeholder="Search username..."
                          value={contributorSearch}
                          onChange={(event) => setContributorSearch(event.target.value)}
                          autoFocus
                        />
                        <div className="promotions-customer-picker-options">
                          {isLoadingContributors ? (
                            <span className="promotions-customer-picker-empty">Loading active contributors...</span>
                          ) : contributorLoadError ? (
                            <span className="promotions-customer-picker-empty" role="alert">{contributorLoadError}</span>
                          ) : filteredActiveContributors.length ? filteredActiveContributors.map((contributor) => {
                            const contributorId = String(contributor.id);
                            const isSelected = campaignDraft.eligible_contributor_ids.includes(contributorId);
                            return (
                              <button
                                key={contributorId}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => setCampaignDraft((prev) => {
                                  const nextIds = prev.eligible_contributor_ids.includes(contributorId)
                                    ? prev.eligible_contributor_ids.filter((id) => id !== contributorId)
                                    : [...prev.eligible_contributor_ids, contributorId];
                                  return {
                                    ...prev,
                                    eligible_contributor_ids: nextIds,
                                    eligible_contributors: activeContributors
                                      .filter((item) => nextIds.includes(String(item.id)))
                                      .map((item) => item.username)
                                      .join(", ")
                                  };
                                })}
                              >
                                {contributor.username} ({Number(contributor.live_asset_count) || 0})
                              </button>
                            );
                          }) : (
                            <span className="promotions-customer-picker-empty">
                              {activeContributors.length ? "No active contributors match your search." : "No active contributors found."}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    <span className="promotions-field-help">Select one or more active contributor usernames.</span>
                  </div>
                )}
                <div className="promotions-field-group">
                  <label htmlFor="campaign-eligibility-requirements">Eligibility requirements</label>
                  <select id="campaign-eligibility-requirements" value={campaignDraft.eligibility_requirements} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, eligibility_requirements: e.target.value }))}>
                    <option value="">Select a requirement</option>
                    <option value="uploads">Uploads</option>
                    <option value="downloads">Downloads</option>
                    <option value="earnings">Earnings</option>
                  </select>
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="campaign-eligibility-requirement-value">Eligibility requirement value</label>
                  <input
                    id="campaign-eligibility-requirement-value"
                    type="number"
                    min="0"
                    step={campaignDraft.eligibility_requirements === "earnings" ? "any" : "1"}
                    value={campaignDraft.eligibility_requirement_value}
                    onChange={(e) => setCampaignDraft((prev) => ({ ...prev, eligibility_requirement_value: e.target.value }))}
                    placeholder={
                      campaignDraft.eligibility_requirements
                        ? `Enter ${campaignDraft.eligibility_requirements} required`
                        : "Select an eligibility requirement first"
                    }
                    disabled={!campaignDraft.eligibility_requirements}
                    required={Boolean(campaignDraft.eligibility_requirements)}
                  />
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="campaign-status">Status</label>
                  <select id="campaign-status" value={campaignDraft.status} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, status: e.target.value }))}>
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="active">Active</option>
                    <option value="ended">Ended</option>
                  </select>
                </div>
                <div className="promotions-field-group promotions-campaign-notes">
                  <label htmlFor="campaign-notes">Admin notes</label>
                  <textarea id="campaign-notes" value={campaignDraft.admin_notes} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, admin_notes: e.target.value }))} placeholder="Internal notes" />
                </div>
                <button type="submit">{editingCampaignId ? "Update Offer" : "Create Offer"}</button>
              </form>
            </div>
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Contributor Offer Library</h3>
                <div className="promotions-inline-controls">
                  <label htmlFor="contributor-offer-status-filter">Status</label>
                  <select
                    id="contributor-offer-status-filter"
                    aria-label="Contributor offer status filter"
                    value={campaignStatusFilter}
                    onChange={(event) => setCampaignStatusFilter(event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="draft">Draft</option>
                    <option value="ended">Ended</option>
                  </select>
                </div>
              </div>
              <div className="promotions-list">
                {campaigns.length === 0 ? <p>No contributor offers yet.</p> : filteredCampaigns.length === 0 ? (
                  <p>No contributor offers found with this status.</p>
                ) : filteredCampaigns.map((campaign) => {
                  const metadata = getCampaignMetadata(campaign);
                  const benefitLabels = {
                    bonus_payout: "Bonus payout",
                    commission_increase: "Commission increase",
                    fee_waiver: "Fee waiver"
                  };
                  const benefitValue = metadata.benefit_value;
                  const requirement = metadata.eligibility_requirements;
                  const requirementValue = metadata.eligibility_requirement_value;
                  const eligibleContributors = Array.isArray(metadata.eligible_contributors)
                    ? metadata.eligible_contributors.join(", ")
                    : metadata.eligible_contributors;
                  return (
                    <div key={campaign.id} className="promotions-list-item promotions-offer-list-item">
                      <div>
                        <strong>{campaign.name}</strong>
                        {campaign.objective && <p className="promotions-offer-description">{campaign.objective}</p>}
                        <div className="promotions-offer-details">
                          <span><b>Benefit:</b> {benefitLabels[metadata.benefit_type] || metadata.benefit_type || "Not set"}{benefitValue !== null && benefitValue !== undefined && benefitValue !== "" ? ` · ${benefitValue}` : ""}</span>
                          <span><b>Eligible contributors:</b> {metadata.eligibility_scope === "selected"
                            ? (eligibleContributors || campaign.audience || "Selected contributors")
                            : "All contributors"}</span>
                          {requirement && (
                            <span><b>Requirement:</b> {requirement.charAt(0).toUpperCase() + requirement.slice(1)}
                              {requirementValue !== null && requirementValue !== undefined && requirementValue !== "" ? ` · ${requirementValue}` : ""}
                            </span>
                          )}
                          <span><b>Dates:</b> {campaign.start_date ? String(campaign.start_date).slice(0, 10) : "Not set"}
                            {campaign.end_date ? ` – ${String(campaign.end_date).slice(0, 10)}` : " – No end date"}
                          </span>
                          <span><b>Status:</b> {getCampaignDisplayStatus(campaign.status)}</span>
                          {campaign.notes && <span><b>Admin notes:</b> {campaign.notes}</span>}
                        </div>
                      </div>
                      <div className="promotions-inline-actions">
                        <button type="button" onClick={() => startEditingCampaign(campaign)}>Edit</button>
                        <button type="button" onClick={() => persistResource("campaign", "delete", { id: campaign.id }, "Contributor offer removed.")}>Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Contributor Applications</h3>
                <div className="promotions-inline-controls">
                  <label htmlFor="contributor-application-status-filter">Status</label>
                  <select
                    id="contributor-application-status-filter"
                    aria-label="Contributor application status filter"
                    value={contributorApplicationFilter}
                    onChange={(event) => setContributorApplicationFilter(event.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="ended">Ended</option>
                    <option value="withdrawn">Withdrawn</option>
                  </select>
                </div>
              </div>
              <div className="promotions-list">
                {contributorApplications.length === 0 ? (
                  <p>No contributor applications yet.</p>
                ) : filteredContributorApplications.length === 0 ? (
                  <p>No contributor applications found with this status.</p>
                ) : filteredContributorApplications.map((application) => (
                  <div className="promotions-list-item promotions-application-list-item" key={application.id}>
                    <div>
                      <strong>{application.full_name || application.username || `Contributor #${application.contributor_id}`}</strong>
                      <div className="promotions-application-details">
                        <span><b>Username:</b> {application.username || "Not available"}</span>
                        <span><b>Email:</b> {application.email || "Not available"}</span>
                        <span><b>Offer:</b> {application.offer_name || `Offer #${application.offer_id}`}</span>
                        <span><b>Submitted:</b> {application.created_at ? String(application.created_at).slice(0, 10) : "Not available"}</span>
                        <span><b>Status:</b> {getContributorApplicationDisplayStatus(application)}</span>
                        {application.benefit_approved && (
                          <span>
                            <b>Remarks:</b> Paid ₹{Number(application.paid_amount ?? application.benefit_value ?? 0).toFixed(2)}
                          </span>
                        )}
                        {application.eligibility_requirements && (
                          <span>
                            <b>{application.eligibility_requirements.charAt(0).toUpperCase() + application.eligibility_requirements.slice(1)} progress:</b>{" "}
                            {application.eligibility_requirements === "earnings" ? "₹" : ""}
                            {Number(application.progress_count) || 0}
                            /
                            {application.eligibility_requirements === "earnings" ? "₹" : ""}
                            {Number(application.eligibility_requirement_value) || 0}
                          </span>
                        )}
                      </div>
                    </div>
                    {getContributorApplicationDisplayStatus(application) !== "ended"
                      && getContributorApplicationDisplayStatus(application) !== "withdrawn" && (
                        <div className="promotions-inline-actions promotions-application-actions">
                          {getContributorApplicationDisplayStatus(application) === "completed" && (
                            <button
                              type="button"
                              className="promotions-application-complete"
                              aria-label={`View completed application for ${application.username || application.full_name || `contributor ${application.contributor_id}`}`}
                              title="View bonus payout"
                              disabled={application.benefit_type !== "bonus_payout" || application.benefit_approved}
                              onClick={() => setSelectedBonusApplication(application)}
                            >
                              <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
                                <path d="m4 10.5 4 4 8-9" />
                              </svg>
                            </button>
                          )}
                          <button
                            type="button"
                            className="promotions-application-withdraw"
                            aria-label={`Withdraw application from ${application.username || application.full_name || `contributor ${application.contributor_id}`}`}
                            title="Withdraw application"
                            onClick={() => withdrawContributorApplication(application)}
                          >
                            <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
                              <path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z" />
                              <path d="m7 7 6 6m0-6-6 6" />
                            </svg>
                          </button>
                        </div>
                      )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      case "flash-sales":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Flash Sales</h3>
                <span>Build urgency, countdown rules, and featured placement.</span>
              </div>
              <form className="promotions-form-grid" onSubmit={handleFlashSubmit}>
                <div className="promotions-field-group">
                  <label htmlFor="flash-sale-name">Flash Sale Name</label>
                  <input id="flash-sale-name" value={flashDraft.name} onChange={(e) => setFlashDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="Flash sale name" />
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="flash-sale-discount-rule">Discount Rule</label>
                  <select
                    id="flash-sale-discount-rule"
                    value={flashDraft.discount_rule}
                    onChange={(e) => setFlashDraft((prev) => ({ ...prev, discount_rule: e.target.value }))}
                    required
                  >
                    <option value="">Select a discount rule</option>
                    {!FLASH_SALE_DISCOUNT_RULES.some((rule) => rule.value === flashDraft.discount_rule)
                      && flashDraft.discount_rule
                      && <option value={flashDraft.discount_rule}>{flashDraft.discount_rule}</option>}
                    {FLASH_SALE_DISCOUNT_RULES.map((rule) => (
                      <option key={rule.value} value={rule.value}>{rule.label}</option>
                    ))}
                  </select>
                </div>
                {["percentage", "fixed_amount"].includes(flashDraft.discount_rule) && (
                  <div key="flash-discount-value-field" className="promotions-field-group promotions-conditional-field">
                    <label htmlFor="flash-sale-discount-value">
                      {flashDraft.discount_rule === "percentage" ? "Discount Percentage" : "Discount Amount"}
                    </label>
                    <input
                      id="flash-sale-discount-value"
                      type="number"
                      min="0.01"
                      max={flashDraft.discount_rule === "percentage" ? "100" : undefined}
                      step="0.01"
                      value={flashDraft.discount_value}
                      onChange={(e) => setFlashDraft((prev) => ({ ...prev, discount_value: e.target.value }))}
                      required
                      placeholder={flashDraft.discount_rule === "percentage" ? "Enter percentage" : "Enter amount"}
                    />
                  </div>
                )}
                <CouponDatePicker
                  id="flash-sale-start-date"
                  label="Start Date"
                  value={flashDraft.start_date}
                  onChange={(start_date) => setFlashDraft((prev) => ({ ...prev, start_date }))}
                  minDate={flashDraft.status === "scheduled" ? scheduledStartMinimum : ""}
                  helpText={flashDraft.status === "scheduled"
                    ? "Scheduled sales must start after today. Dates follow IST (Asia/Kolkata)."
                    : "Dates follow IST (Asia/Kolkata)."}
                  className="promotions-date-picker--flash-sale"
                />
                <CouponDatePicker
                  id="flash-sale-end-date"
                  label="End Date"
                  value={flashDraft.end_date}
                  onChange={(end_date) => setFlashDraft((prev) => ({ ...prev, end_date }))}
                  helpText="The end date is inclusive through 11:59:59 PM IST."
                  className="promotions-date-picker--flash-sale"
                />
                <div className="promotions-field-group">
                  <label htmlFor="flash-sale-placement">Featured Placement</label>
                  <select id="flash-sale-placement" value={flashDraft.featured_placement} onChange={(e) => setFlashDraft((prev) => ({ ...prev, featured_placement: e.target.value }))}>
                    <option value="homepage">Homepage</option>
                    <option value="category">Category</option>
                    <option value="collection">Collection</option>
                  </select>
                </div>
                {flashDraft.featured_placement === "category" && (
                  <div key="flash-category-field" className="promotions-field-group promotions-conditional-field">
                    <label htmlFor="flash-sale-category">Active Category</label>
                    <select
                      id="flash-sale-category"
                      value={flashDraft.featured_category_id}
                      onChange={(e) => setFlashDraft((prev) => ({ ...prev, featured_category_id: e.target.value }))}
                      required
                    >
                      <option value="all">All</option>
                      <option value="">Select a category</option>
                      {flashCategories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {flashDraft.featured_placement === "collection" && (
                  <div key="flash-collection-field" className="promotions-field-group promotions-conditional-field">
                    <label htmlFor="flash-sale-collection">Active Collection</label>
                    <select
                      id="flash-sale-collection"
                      value={flashDraft.featured_collection_id}
                      onChange={(e) => setFlashDraft((prev) => ({ ...prev, featured_collection_id: e.target.value }))}
                      required
                    >
                      <option value="all">All</option>
                      <option value="">Select a collection</option>
                      {flashCollections.map((collection) => (
                        <option key={collection.id} value={collection.id}>{collection.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {((flashDraft.featured_placement === "category" && flashDraft.featured_category_id === "all")
                  || (flashDraft.featured_placement === "collection" && flashDraft.featured_collection_id === "all")) && (
                  <div key="flash-keywords-field" className="promotions-field-group promotions-conditional-field">
                    <label htmlFor="flash-sale-keywords">Keywords</label>
                    <input
                      id="flash-sale-keywords"
                      type="text"
                      value={flashDraft.keywords}
                      onChange={(e) => setFlashDraft((prev) => ({ ...prev, keywords: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Tab") {
                          const keywords = e.currentTarget.value
                            .split(/[,\s]+/)
                            .map((keyword) => keyword.trim())
                            .filter(Boolean)
                            .join(", ");
                          setFlashDraft((prev) => ({ ...prev, keywords }));
                        }
                      }}
                      placeholder="Enter keywords separated by spaces or commas"
                    />
                  </div>
                )}
                <div className="promotions-field-group">
                  <label htmlFor="flash-sale-status">Status</label>
                  <select
                    id="flash-sale-status"
                    value={flashDraft.status}
                    onChange={(e) => {
                      const status = e.target.value;
                      setFlashDraft((prev) => ({
                        ...prev,
                        status,
                        start_date: status === "scheduled" && prev.start_date <= getISTDateString() ? "" : prev.start_date
                      }));
                    }}
                  >
                    <option value="scheduled">Scheduled</option>
                    <option value="running">Running</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>
                <button className="flash-sale-submit" type="submit">
                  {editingFlashId ? "Update Flash Sale" : "Create Flash Sale"}
                </button>
              </form>
            </div>
            <div className="promotions-card">
              <div className="promotions-card-header flash-events-header">
                <div>
                  <h3>Flash Events</h3>
                  <span>{filteredFlashEvents.length} {flashEventFilter === "all" ? "events" : `${flashEventFilter} events`}</span>
                </div>
                <div className="flash-events-filter">
                  <label htmlFor="flash-events-status-filter">Show</label>
                  <select
                    id="flash-events-status-filter"
                    aria-label="Flash event status filter"
                    value={flashEventFilter}
                    onChange={(event) => setFlashEventFilter(event.target.value)}
                  >
                    <option value="active">Active</option>
                    <option value="expired">Expired</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="all">All events</option>
                  </select>
                </div>
              </div>
              <div className="promotions-list">
                {flashSales.length === 0 ? <p>No flash sales yet.</p> : filteredFlashEvents.length === 0 ? (
                  <p>No {flashEventFilter === "all" ? "" : `${flashEventFilter} `}flash events found.</p>
                ) : filteredFlashEvents.map(({ sale, timing, targetLabel, ruleDetails, remaining }) => (
                  <div key={sale.id} className="promotions-list-item flash-event-item">
                    <div className="flash-event-content">
                      <div className="flash-event-title-row">
                        <strong>{sale.name || "Flash Sale"}</strong>
                        <span className={`flash-event-status is-${timing.status}`}>{timing.status}</span>
                      </div>
                      <div className="flash-event-details">
                        <span>{ruleDetails}</span>
                        <span>{targetLabel}</span>
                        <span>Starts {formatFlashEventDate(timing.startDate)}</span>
                        {timing.endDate ? (
                          <span>
                            {timing.status === "expired" ? "Expired" : "Expires"} {formatFlashEventDate(timing.endDate)} at 11:59:59 PM IST
                          </span>
                        ) : (
                          <span>No expiry date set</span>
                        )}
                      </div>
                      {timing.status === "active" && remaining !== null && remaining > 0 && (
                        <div className="flash-event-countdown" aria-live="off">
                          <span>Time remaining</span>
                          <strong>{formatFlashEventCountdown(remaining)}</strong>
                        </div>
                      )}
                      {timing.status === "active" && remaining !== null && remaining <= 0 && (
                        <div className="flash-event-countdown is-expired">Expiry reached</div>
                      )}
                    </div>
                    <div className="promotions-inline-actions">
                      <button type="button" onClick={() => startEditingFlash(sale)}>Edit</button>
                      <button type="button" onClick={() => persistResource("flash_sale", "delete", { id: sale.id }, "Flash sale removed.")}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      case "referrals":
        return renderSimpleSection("Referral Program", "referral", referrals, referralDraft, setReferralDraft, initialReferralForm, "Referral program created.", [
          { key: "name", label: "Program name", type: "text" },
          { key: "signup_reward", label: "Signup reward", type: "text" },
          { key: "purchase_reward", label: "Purchase reward", type: "text" },
          { key: "reward_type", label: "Reward type", type: "select", options: [{ value: "credit", label: "Credits" }, { value: "discount", label: "Discount" }] },
          { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }] }
        ]);
      case "loyalty":
        return renderSimpleSection("Loyalty Rewards", "loyalty", loyalty, loyaltyDraft, setLoyaltyDraft, initialLoyaltyForm, "Loyalty reward created.", [
          { key: "name", label: "Program name", type: "text" },
          { key: "points_system", label: "Points system", type: "text" },
          { key: "reward_level", label: "Reward level", type: "text" },
          { key: "bonus_points", label: "Bonus points", type: "text" },
          { key: "expiry_days", label: "Expiry days", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }] }
        ]);
      case "bundles":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Bundle Discounts</h3>
                <span>Set editable quantity tiers for paid assets in a customer’s cart.</span>
              </div>
              <form className="promotions-form-grid promotions-bundle-form" onSubmit={handleBundleSubmit}>
                <div className="promotions-field-group">
                  <label htmlFor="bundle-name">Bundle name</label>
                  <input
                    id="bundle-name"
                    value={bundleDraft.name}
                    onChange={(event) => setBundleDraft((current) => ({ ...current, name: event.target.value }))}
                    required
                  />
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="bundle-status">Status</label>
                  <select
                    id="bundle-status"
                    value={bundleDraft.status}
                    onChange={(event) => setBundleDraft((current) => ({ ...current, status: event.target.value }))}
                  >
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
                <CouponDatePicker
                  id="bundle-start-date"
                  label="Start Date"
                  value={bundleDraft.start_date}
                  onChange={(start_date) => setBundleDraft((current) => ({ ...current, start_date }))}
                  helpText="Required. The discount becomes available from this date (IST)."
                  required
                  className="promotions-date-picker--bundle"
                />
                <CouponDatePicker
                  id="bundle-end-date"
                  label="End Date (optional)"
                  value={bundleDraft.end_date}
                  onChange={(end_date) => setBundleDraft((current) => ({ ...current, end_date }))}
                  minDate={bundleDraft.start_date}
                  helpText="Leave blank for no end date."
                  className="promotions-date-picker--bundle"
                />
                <div className="promotions-field-group promotions-campaign-notes">
                  <strong>Discount tiers</strong>
                  <span className="promotions-field-help">
                    Each threshold counts distinct paid assets. The highest qualifying tier applies to all eligible asset value.
                  </span>
                </div>
                {bundleDraft.tiers.map((tier, index) => (
                  <div className="promotions-inline-controls promotions-bundle-tier-row" key={`bundle-tier-${index}`}>
                    <div className="promotions-field-group">
                      <label htmlFor={`bundle-tier-assets-${index}`}>Minimum assets</label>
                      <input
                        id={`bundle-tier-assets-${index}`}
                        aria-label={`Tier ${index + 1} minimum assets`}
                        type="number"
                        min="1"
                        step="1"
                        value={tier.asset_count}
                        onChange={(event) => setBundleDraft((current) => ({
                          ...current,
                          tiers: current.tiers.map((currentTier, currentIndex) => (
                            currentIndex === index ? { ...currentTier, asset_count: event.target.value } : currentTier
                          ))
                        }))}
                        required
                      />
                    </div>
                    <div className="promotions-field-group">
                      <label htmlFor={`bundle-tier-discount-${index}`}>Discount (%)</label>
                      <input
                        id={`bundle-tier-discount-${index}`}
                        aria-label={`Tier ${index + 1} discount percent`}
                        type="number"
                        min="0.01"
                        max="100"
                        step="0.01"
                        value={tier.discount_percent}
                        onChange={(event) => setBundleDraft((current) => ({
                          ...current,
                          tiers: current.tiers.map((currentTier, currentIndex) => (
                            currentIndex === index ? { ...currentTier, discount_percent: event.target.value } : currentTier
                          ))
                        }))}
                        required
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove tier ${index + 1}`}
                      disabled={bundleDraft.tiers.length === 1}
                      onClick={() => setBundleDraft((current) => ({
                        ...current,
                        tiers: current.tiers.filter((_, currentIndex) => currentIndex !== index)
                      }))}
                    >
                      Remove tier
                    </button>
                  </div>
                ))}
                <div className="promotions-inline-actions promotions-bundle-actions">
                  <button
                    type="button"
                    onClick={() => setBundleDraft((current) => ({
                      ...current,
                      tiers: [...current.tiers, { asset_count: "", discount_percent: "" }]
                    }))}
                  >
                    Add tier
                  </button>
                  {editingBundleId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBundleId(null);
                        setBundleDraft(initialBundleForm);
                      }}
                    >
                      Cancel edit
                    </button>
                  )}
                  <button type="submit">{editingBundleId ? "Update Bundle Discount" : "Save Bundle Discount"}</button>
                </div>
              </form>
            </div>
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Existing Entries</h3>
                <span>When multiple active bundles qualify, checkout applies the single bundle with the greatest saving.</span>
              </div>
              <div className="promotions-list">
                {bundles.length === 0 ? <p>No bundle discounts yet.</p> : bundles.map((bundle) => {
                  const metadata = getCampaignMetadata(bundle);
                  const tiers = Array.isArray(metadata.discount_tiers) ? metadata.discount_tiers : [];
                  return (
                    <div key={bundle.id} className="promotions-list-item">
                      <div>
                        <strong>{bundle.name}</strong>
                        <div className="promotions-muted">
                          {tiers.length
                            ? tiers.map((tier) => `${tier.asset_count} assets → ${tier.discount_percent}%`).join(" · ")
                            : "No discount tiers configured"}
                          {" · "}{bundle.status || "active"}
                        </div>
                        <div className="promotions-muted">
                          Dates: {metadata.start_date ? String(metadata.start_date).slice(0, 10) : "Start date required"}
                          {" – "}{metadata.end_date ? String(metadata.end_date).slice(0, 10) : "No end date"}
                        </div>
                      </div>
                      <div className="promotions-inline-actions">
                        <button type="button" onClick={() => startEditingBundle(bundle)}>Edit</button>
                        <button
                          type="button"
                          onClick={() => persistResource("bundle", "delete", { id: bundle.id }, "Bundle discount removed.")}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      case "newsletters":
        return renderSimpleSection("Newsletter Campaigns", "newsletter", newsletters, newsletterDraft, setNewsletterDraft, initialNewsletterForm, "Newsletter saved.", [
          { key: "name", label: "Campaign name", type: "text" },
          { key: "subject", label: "Subject", type: "text" },
          { key: "schedule", label: "Schedule", type: "text" },
          { key: "audience", label: "Audience", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "draft", label: "Draft" }, { value: "scheduled", label: "Scheduled" }, { value: "sent", label: "Sent" }] }
        ]);
      case "banners":
        return renderSimpleSection("Promotional Banners", "banner", banners, bannerDraft, setBannerDraft, initialBannerForm, "Banner saved.", [
          { key: "name", label: "Banner name", type: "text" },
          { key: "placement", label: "Placement", type: "text" },
          { key: "priority", label: "Priority", type: "text" },
          { key: "schedule", label: "Schedule", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }] }
        ]);
      case "popups":
        return renderSimpleSection("Popups", "popup", popups, popupDraft, setPopupDraft, initialPopupForm, "Popup saved.", [
          { key: "name", label: "Popup name", type: "text" },
          { key: "trigger", label: "Trigger", type: "text" },
          { key: "schedule", label: "Schedule", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }] }
        ]);
      case "announcements":
        return renderSimpleSection("Announcement Bar", "announcement", announcements, announcementDraft, setAnnouncementDraft, initialAnnouncementForm, "Announcement saved.", [
          { key: "name", label: "Announcement name", type: "text" },
          { key: "text", label: "Text", type: "text" },
          { key: "schedule", label: "Schedule", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }] }
        ]);
      case "push":
        return renderSimpleSection("Push Notifications", "push_notification", pushItems, pushDraft, setPushDraft, initialPushForm, "Push notification saved.", [
          { key: "name", label: "Notification name", type: "text" },
          { key: "channel", label: "Channel", type: "text" },
          { key: "audience", label: "Audience", type: "text" },
          { key: "schedule", label: "Schedule", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "draft", label: "Draft" }, { value: "scheduled", label: "Scheduled" }] }
        ]);
      case "automation":
        return renderSimpleSection("Automation Rules", "automation", automations, automationDraft, setAutomationDraft, initialAutomationForm, "Automation saved.", [
          { key: "name", label: "Rule name", type: "text" },
          { key: "trigger", label: "Trigger", type: "text" },
          { key: "channel", label: "Channel", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }] }
        ]);
      case "analytics":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Analytics</h3>
                <span>Interactive charts and performance snapshots for campaigns, referrals, and loyalty.</span>
              </div>
              <div className="promotions-list">
                <div className="promotions-list-item">
                  <div><strong>Coupon Usage</strong><div className="promotions-muted">Track top coupons and redemption velocity.</div></div>
                </div>
                <div className="promotions-list-item">
                  <div><strong>Revenue Generated</strong><div className="promotions-muted">Compare promotion revenue with discount impact.</div></div>
                </div>
                <div className="promotions-list-item">
                  <div><strong>Campaign Performance</strong><div className="promotions-muted">Review conversion, email engagement, and participation rates.</div></div>
                </div>
              </div>
            </div>
          </div>
        );
      case "reports":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Reports</h3>
                <span>Consolidated reports for coupons, campaigns, loyalty, newsletter, flash sales, and bundles.</span>
              </div>
              <div className="promotions-list">
                {['Coupons','Campaigns','Loyalty','Referral','Newsletter','Flash Sales','Bundles','Promotion Revenue','Promotion ROI'].map((item) => (
                  <div className="promotions-list-item" key={item}><div><strong>{item}</strong></div></div>
                ))}
              </div>
            </div>
          </div>
        );
      case "settings":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Settings</h3>
                <span>Manage defaults for expiry, stacking rules, eligibility, and automated promotion policy.</span>
              </div>
              <div className="promotions-list">
                <div className="promotions-list-item"><div><strong>Role-based permissions</strong><div className="promotions-muted">Super admin and authorized admins can manage the hub.</div></div></div>
                <div className="promotions-list-item"><div><strong>Duplicate coupon prevention</strong><div className="promotions-muted">Enabled by default.</div></div></div>
                <div className="promotions-list-item"><div><strong>Automatic expiry</strong><div className="promotions-muted">Policies are applied automatically when promotions end.</div></div></div>
              </div>
            </div>
          </div>
        );
      case "activity":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Activity Log</h3>
                <span>Track every create, edit, activation, expiry, redemption, send, and schedule action.</span>
              </div>
              <div className="promotions-list">
                {activityLog.length === 0 ? <p>No recent activity yet.</p> : activityLog.map((entry) => (
                  <div key={entry.id || `${entry.action}-${entry.created_at}`} className="promotions-list-item">
                    <div><strong>{entry.action || entry.type || "Activity"}</strong><div className="promotions-muted">{entry.details || entry.description || ""}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderSimpleSection = (title, resource, items, draft, setter, resetDraft, successMessage, fields) => {
    const handleSimpleSubmit = async (event) => {
      event.preventDefault();
      await persistResource(resource, "create", draft, successMessage);
      setter(resetDraft);
    };

    return (
      <div className="promotions-stack">
        <div className="promotions-card">
          <div className="promotions-card-header">
            <h3>{title}</h3>
            <span>Persist and review entries in PostgreSQL immediately.</span>
          </div>
          <form className="promotions-form-grid" onSubmit={handleSimpleSubmit}>
            {fields.map((field) => (
              <div key={field.key} className="promotions-field-group">
                {field.type === "select" ? (
                  <>
                    <label>{field.label}</label>
                    <select value={draft[field.key] || ""} onChange={(e) => setter((prev) => ({ ...prev, [field.key]: e.target.value }))}>
                      {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </>
                ) : field.type === "date" ? (
                  <>
                    <label>{field.label}</label>
                    <input type="date" value={draft[field.key] || ""} onChange={(e) => setter((prev) => ({ ...prev, [field.key]: e.target.value }))} />
                  </>
                ) : (
                  <>
                    <label>{field.label}</label>
                    <input value={draft[field.key] || ""} onChange={(e) => setter((prev) => ({ ...prev, [field.key]: e.target.value }))} />
                  </>
                )}
              </div>
            ))}
            <button type="submit">Save {title}</button>
          </form>
        </div>
        <div className="promotions-card">
          <div className="promotions-card-header">
            <h3>Existing Entries</h3>
          </div>
          <div className="promotions-list">
            {items.length === 0 ? <p>No entries yet.</p> : items.map((entry) => (
              <div key={entry.id} className="promotions-list-item">
                <div>
                  <strong>{entry.name}</strong>
                  <div className="promotions-muted">{entry.status || entry.trigger || "Active"}</div>
                </div>
                <div className="promotions-inline-actions">
                  <button type="button" onClick={() => persistResource(resource, "delete", { id: entry.id }, "Entry removed.")}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="promotions-panel">
      <div className="promotions-sidebar">
        <div className="promotions-sidebar-title">PROMOTIONS</div>
        {SECTION_ITEMS.map((item) => (
          <button key={item.key} type="button" className={`promotions-nav-item ${activeSection === item.key ? "is-active" : ""}`} onClick={() => setActiveSection(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="promotions-content">
        <div className="promotions-toolbar">
          <div>
            <div className="promotions-eyebrow">Marketing & Promotions Management</div>
            <h2>Admin Promotions Center</h2>
          </div>
          <div className="promotions-chip">{loading ? "Loading" : "Live"}</div>
        </div>
        {message ? <div className="promotions-message">{message}</div> : null}
        {renderSectionContent()}
      </div>
      {selectedBonusApplication && (
        <div
          className="promotions-modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedBonusApplication(null);
          }}
        >
          <section
            className="promotions-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contributor-bonus-title"
          >
            <h3 id="contributor-bonus-title">Contributor bonus payout</h3>
            <p>
              {selectedBonusApplication.full_name || selectedBonusApplication.username || `Contributor #${selectedBonusApplication.contributor_id}`}
              {" "}completed the offer {selectedBonusApplication.offer_name || `#${selectedBonusApplication.offer_id}`}.
            </p>
            <strong className="promotions-modal-benefit">
              Benefit to add: ₹{Number(selectedBonusApplication.benefit_value || 0).toFixed(2)}
            </strong>
            {selectedBonusApplication.benefit_approved ? (
              <p className="promotions-modal-note" role="status">
                Bonus approved and credited to unpaid earnings.
              </p>
            ) : (
              <p className="promotions-modal-note">
                Approving adds this bonus to the contributor&apos;s unpaid earnings.
              </p>
            )}
            <div className="promotions-inline-actions">
              {!selectedBonusApplication.benefit_approved && (
                <button
                  type="button"
                  className="promotions-benefit-approve"
                  disabled={approvingBonusApplicationId !== null}
                  onClick={() => approveContributorBonus(selectedBonusApplication)}
                >
                  {String(approvingBonusApplicationId) === String(selectedBonusApplication.id)
                    ? "Approving..."
                    : "Approve"}
                </button>
              )}
              <button type="button" onClick={() => setSelectedBonusApplication(null)}>Close</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default AdminPromotionsPanel;
