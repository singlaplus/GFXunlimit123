import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { getEffectiveAuthToken } from "../utils/authSession";
import { formatIndiaDate } from "../utils/indiaTime";
import { getAssetThumbnailUrl } from "../utils/assetPreview";
import NewsletterSMTPSettings from "./NewsletterSMTPSettings";
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
const NEWSLETTER_AUDIENCES = [
  { value: "all", label: "All customers and contributors" },
  { value: "customer_active", label: "Customer active" },
  { value: "customer_inactive", label: "Customer inactive" },
  { value: "contributor_active", label: "Contributor active" },
  { value: "contributor_inactive", label: "Contributor inactive" }
];

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

function getISTDateTimeLocal(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function getISTScheduleISO(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ""))) return "";
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function parseNewsletterRecipientEmails(value) {
  const tokens = String(value || "")
    .split(/[,\s;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const uniqueTokens = [...new Set(tokens)];
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return {
    emails: uniqueTokens.filter((email) => emailPattern.test(email)),
    invalid: uniqueTokens.filter((email) => !emailPattern.test(email))
  };
}

function formatNewsletterSchedule(value) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatCouponCurrency(value, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
}

function downloadCouponCsv(filename, headerCells, rows) {
  const escapeCell = (value) => {
    const text = String(value ?? "");
    const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  };
  const csv = [headerCells, ...rows]
    .map((row) => row.map(escapeCell).join(","))
    .join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadPromotionCsvWithRecordFields(filename, headerCells, rows, recordGroups, recordLabels = []) {
  const recordColumns = [];
  recordGroups.forEach((records) => {
    records.forEach((record, recordIndex) => {
      Object.keys(record || {}).forEach((key) => {
        const columnKey = `${recordIndex}:${key}`;
        if (!recordColumns.some((column) => column.columnKey === columnKey)) {
          recordColumns.push({ columnKey, recordIndex, key });
        }
      });
    });
  });

  const additionalHeaders = recordColumns.map(({ recordIndex, key }) => (
    `${recordLabels[recordIndex] || (recordIndex === 0 ? "Record" : "Related record")}: ${key}`
  ));
  const additionalRows = rows.map((row, rowIndex) => [
    ...row,
    ...recordColumns.map(({ recordIndex, key }) => {
      const value = recordGroups[rowIndex]?.[recordIndex]?.[key];
      return value !== null && typeof value === "object" ? JSON.stringify(value) : value ?? "";
    })
  ]);
  downloadCouponCsv(filename, [...headerCells, ...additionalHeaders], additionalRows);
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
  status: "draft",
  body: ""
};

const initialBannerForm = {
  name: "",
  placement: "left",
  popupAudience: "homepage",
  sparkleStyle: "glitter_burst",
  iconFile: null,
  start_date: "",
  end_date: "",
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

function getISTDateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : getISTDateString(date);
}

function formatCsvDate(value) {
  if (!value) return "";
  const dateValue = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue;
  return getISTDateKey(dateValue);
}

function shiftDateKey(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function getContributorAnalyticsRange(range, today = getISTDateString()) {
  const [year, month] = today.split("-").map(Number);
  const currentQuarterMonth = Math.floor((month - 1) / 3) * 3;
  const currentQuarterStart = new Date(Date.UTC(year, currentQuarterMonth, 1)).toISOString().slice(0, 10);
  const lastQuarterStart = new Date(Date.UTC(year, currentQuarterMonth - 3, 1)).toISOString().slice(0, 10);
  const financialYearStart = month >= 4 ? `${year}-04-01` : `${year - 1}-04-01`;
  const currentMonthStart = `${today.slice(0, 7)}-01`;

  switch (range) {
    case "last_30_days":
      return { start: shiftDateKey(today, -29), end: today };
    case "current_month":
      return { start: currentMonthStart, end: today };
    case "current_quarter":
      return { start: currentQuarterStart, end: today };
    case "last_quarter":
      return { start: lastQuarterStart, end: shiftDateKey(currentQuarterStart, -1) };
    case "current_financial_year":
      return { start: financialYearStart, end: today };
    case "last_financial_year":
      return {
        start: `${Number(financialYearStart.slice(0, 4)) - 1}-04-01`,
        end: shiftDateKey(financialYearStart, -1)
      };
    default:
      return { start: "", end: "" };
  }
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
  const [loadError, setLoadError] = useState("");
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
  const [couponAnalytics, setCouponAnalytics] = useState({});
  const [couponDailySeries, setCouponDailySeries] = useState([]);
  const [couponTrendMetric, setCouponTrendMetric] = useState("uses");
  const [topCoupons, setTopCoupons] = useState([]);
  const [couponCurrencies, setCouponCurrencies] = useState([]);
  const [couponExchangeRates, setCouponExchangeRates] = useState({});
  const [couponAnalyticsError, setCouponAnalyticsError] = useState("");
  const [couponCurrency, setCouponCurrency] = useState("INR");
  const [contributorBenefitsCurrency, setContributorBenefitsCurrency] = useState("INR");
  const [customers, setCustomers] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [contributorApplications, setContributorApplications] = useState([]);
  const [selectedBonusApplication, setSelectedBonusApplication] = useState(null);
  const [approvingBonusApplicationId, setApprovingBonusApplicationId] = useState(null);
  const [flashSales, setFlashSales] = useState([]);
  const [flashEventFilter, setFlashEventFilter] = useState("active");
  const [couponUsageRange, setCouponUsageRange] = useState("last_30_days");
  const [couponRevenueRange, setCouponRevenueRange] = useState("last_30_days");
  const [contributorApplicationRange, setContributorApplicationRange] = useState("last_30_days");
  const [contributorBenefitsRange, setContributorBenefitsRange] = useState("last_30_days");
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
  const [newsletterRecipientsText, setNewsletterRecipientsText] = useState("");
  const [newsletterRecipientSearch, setNewsletterRecipientSearch] = useState("");
  const [newsletterRecipientResults, setNewsletterRecipientResults] = useState([]);
  const [newsletterSelectedRecipients, setNewsletterSelectedRecipients] = useState([]);
  const [newsletterRecipientSearchError, setNewsletterRecipientSearchError] = useState("");
  const [newsletterRecipientInputError, setNewsletterRecipientInputError] = useState("");
  const [newsletterRecipientSearchComplete, setNewsletterRecipientSearchComplete] = useState(false);
  const [newsletterStatusFilter, setNewsletterStatusFilter] = useState("all");
  const [newsletterAttachments, setNewsletterAttachments] = useState([]);
  const [editingNewsletterId, setEditingNewsletterId] = useState(null);
  const [newsletterAttachmentError, setNewsletterAttachmentError] = useState("");
  const [newsletterLinkUrl, setNewsletterLinkUrl] = useState("");
  const [isNewsletterLinkEditorOpen, setIsNewsletterLinkEditorOpen] = useState(false);
  const [isNewsletterRecipientPickerOpen, setIsNewsletterRecipientPickerOpen] = useState(false);
  const [isNewsletterAudienceDialogOpen, setIsNewsletterAudienceDialogOpen] = useState(false);
  const [isSearchingNewsletterRecipients, setIsSearchingNewsletterRecipients] = useState(false);
  const [isUploadingNewsletterAttachments, setIsUploadingNewsletterAttachments] = useState(false);
  const [isSavingNewsletter, setIsSavingNewsletter] = useState(false);
  const newsletterBodyEditorRef = useRef(null);
  const savedNewsletterBodySelectionRef = useRef(null);
  const newsletterLinkPointerRef = useRef(null);
  const [bannerDraft, setBannerDraft] = useState(initialBannerForm);
  const [editingBannerId, setEditingBannerId] = useState(null);
  const [editingBannerIconFilename, setEditingBannerIconFilename] = useState("");
  const bannerIconInputRef = useRef(null);
  const [isBannerAssetsDialogOpen, setIsBannerAssetsDialogOpen] = useState(false);
  const [bannerAssets, setBannerAssets] = useState([]);
  const [bannerAssetCategories, setBannerAssetCategories] = useState([]);
  const [bannerAssetCollections, setBannerAssetCollections] = useState([]);
  const [selectedBannerAssetIds, setSelectedBannerAssetIds] = useState([]);
  const [draftBannerAssetIds, setDraftBannerAssetIds] = useState([]);
  const [bannerAssetSearch, setBannerAssetSearch] = useState("");
  const [bannerAssetCategory, setBannerAssetCategory] = useState("");
  const [bannerAssetCollection, setBannerAssetCollection] = useState("");
  const [isLoadingBannerAssets, setIsLoadingBannerAssets] = useState(false);
  const [bannerAssetLoadError, setBannerAssetLoadError] = useState("");
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
      setLoadError("");
      const res = await axios.get(`${API_BASE_URL}/admin/promotions`, { headers: buildAuthHeaders() });
      const payload = res.data;
      const hasExpectedData = payload && typeof payload === "object" && !Array.isArray(payload) && (
        (payload.dashboard && typeof payload.dashboard === "object" && !Array.isArray(payload.dashboard)) ||
        ["coupons", "campaigns", "contributor_applications", "flash_sales", "referrals", "loyalty", "bundles", "newsletters", "banners", "popups", "announcements", "push_notifications", "automation_rules", "activity_logs"]
          .some((key) => Array.isArray(payload[key]))
      );
      if (!hasExpectedData) {
        throw new Error("Promotions response was invalid.");
      }
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
      setLoadError(err.response?.data?.error || "Unable to load promotions data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPromotions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!["dashboard", "analytics"].includes(activeSection)) return undefined;
    let active = true;
    const loadCouponAnalytics = async () => {
      setCouponAnalyticsError("");
      try {
        const response = await axios.get(`${API_BASE_URL}/admin/promotions/coupon-analytics`, {
          headers: buildAuthHeaders()
        });
        const {
          currencies,
          rates,
          analytics,
          daily_series: dailySeries,
          top_coupons: couponRanking
        } = response.data || {};
        if (!Array.isArray(currencies) || !rates || typeof rates !== "object" || !analytics || typeof analytics !== "object" || !Array.isArray(couponRanking)) {
          throw new Error("Coupon revenue analytics response was invalid.");
        }
        if (active) {
          setCouponCurrencies(currencies);
          setCouponExchangeRates(rates);
          setCouponAnalytics(analytics);
          setCouponDailySeries(Array.isArray(dailySeries) ? dailySeries : []);
          setTopCoupons(couponRanking);
          setCouponCurrency((currentCurrency) => (
            currencies.includes(currentCurrency) ? currentCurrency : currencies[0] || "INR"
          ));
          setContributorBenefitsCurrency((currentCurrency) => (
            currencies.includes(currentCurrency) ? currentCurrency : currencies[0] || "INR"
          ));
        }
      } catch (error) {
        console.error("Failed to load coupon revenue analytics", error);
        if (active) {
          setCouponAnalyticsError(error.response?.data?.error || "Unable to load coupon revenue and exchange rates.");
        }
      }
    };
    loadCouponAnalytics();
    return () => { active = false; };
  }, [activeSection]);

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

  const filteredNewsletters = useMemo(() => newsletters.filter((campaign) => (
    newsletterStatusFilter === "all"
    || String(campaign.status || "draft").trim().toLowerCase() === newsletterStatusFilter
  )), [newsletters, newsletterStatusFilter]);

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

  const loadBannerAssets = async () => {
    try {
      setIsLoadingBannerAssets(true);
      setBannerAssetLoadError("");
      const [firstPageResponse, categoriesResponse, collectionsResponse] = await Promise.all([
        axios.get(`${API_BASE_URL}/images?limit=1000&page=1`),
        axios.get(`${API_BASE_URL}/categories`),
        axios.get(`${API_BASE_URL}/collections`)
      ]);
      const firstPage = firstPageResponse.data;
      if (
        !firstPage ||
        !Array.isArray(firstPage.images) ||
        !Number.isFinite(Number(firstPage.totalImages)) ||
        !Array.isArray(categoriesResponse.data) ||
        !Array.isArray(collectionsResponse.data)
      ) {
        throw new Error("Live asset catalogue response was invalid.");
      }

      const allAssets = [...firstPage.images];
      const totalPages = Math.ceil(Number(firstPage.totalImages) / 1000);
      if (allAssets.length < Number(firstPage.totalImages)) {
        const remainingPages = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 2);
        const remainingResponses = await Promise.all(remainingPages.map((page) => (
          axios.get(`${API_BASE_URL}/images?limit=1000&page=${page}`)
        )));
        for (const response of remainingResponses) {
          if (!Array.isArray(response.data?.images)) {
            throw new Error("Live asset catalogue response was invalid.");
          }
          allAssets.push(...response.data.images);
        }
      }
      if (allAssets.length < Number(firstPage.totalImages)) {
        throw new Error(`Loaded ${allAssets.length} of ${Number(firstPage.totalImages)} live assets.`);
      }
      setBannerAssets(allAssets);
      setBannerAssetCategories(categoriesResponse.data);
      setBannerAssetCollections(collectionsResponse.data);
    } catch (error) {
      console.error("Failed to load live assets for promotional banner", error);
      setBannerAssetLoadError(error.response?.data?.error || error.message || "Unable to load live assets.");
    } finally {
      setIsLoadingBannerAssets(false);
    }
  };

  const openBannerAssetsDialog = () => {
    setDraftBannerAssetIds(selectedBannerAssetIds);
    setBannerAssetSearch("");
    setBannerAssetCategory("");
    setBannerAssetCollection("");
    setIsBannerAssetsDialogOpen(true);
    if (bannerAssets.length === 0) loadBannerAssets();
  };

  const searchNewsletterRecipients = async () => {
    setIsSearchingNewsletterRecipients(true);
    setNewsletterRecipientSearchComplete(false);
    setNewsletterRecipientSearchError("");
    setNewsletterRecipientResults([]);
    try {
      const params = new URLSearchParams({
        audience: newsletterDraft.audience,
        search: newsletterRecipientSearch.trim()
      });
      const response = await axios.get(
        `${API_BASE_URL}/admin/promotions/newsletter-recipients?${params.toString()}`,
        { headers: buildAuthHeaders() }
      );
      if (!Array.isArray(response.data)) {
        throw new Error("Newsletter recipient search returned an invalid response.");
      }
      setNewsletterRecipientResults(response.data);
      setNewsletterRecipientSearchComplete(true);
      const currentEmails = new Set(
        newsletterRecipientsText.split(/[,\s;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean)
      );
      setNewsletterSelectedRecipients(
        response.data.filter((recipient) => currentEmails.has(String(recipient.email || "").trim().toLowerCase()))
      );
    } catch (error) {
      console.error("Unable to search newsletter recipients", error);
      setNewsletterRecipientSearchComplete(false);
      setNewsletterRecipientSearchError(
        error.response?.data?.error || error.message || "Unable to search newsletter recipients."
      );
    } finally {
      setIsSearchingNewsletterRecipients(false);
    }
  };

  const saveNewsletterBodySelection = () => {
    const editor = newsletterBodyEditorRef.current;
    const selection = window.getSelection();
    if (
      editor &&
      selection?.rangeCount &&
      editor.contains(selection.anchorNode) &&
      editor.contains(selection.focusNode)
    ) {
      savedNewsletterBodySelectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const handleNewsletterBodyInput = (event) => {
    const body = event.currentTarget.innerHTML;
    setNewsletterDraft((current) => ({ ...current, body }));
  };

  const preventNewsletterLinkNavigation = (event) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link) return;

    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const pointerDown = newsletterLinkPointerRef.current;
    newsletterLinkPointerRef.current = null;
    if (pointerDown?.dragged) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    window.open(link.href, "_blank", "noopener,noreferrer");
  };

  const trackNewsletterLinkPointerDown = (event) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    newsletterLinkPointerRef.current = link
      ? { x: event.clientX, y: event.clientY, dragged: false }
      : null;
  };

  const trackNewsletterLinkPointerMove = (event) => {
    const pointerDown = newsletterLinkPointerRef.current;
    if (!pointerDown) return;
    if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) {
      pointerDown.dragged = true;
    }
  };

  const applyNewsletterFormatting = (command, value = "") => {
    const editor = newsletterBodyEditorRef.current;
    if (!editor) return false;

    const selection = window.getSelection();
    if (
      selection?.rangeCount &&
      editor.contains(selection.anchorNode) &&
      editor.contains(selection.focusNode)
    ) {
      savedNewsletterBodySelectionRef.current = selection.getRangeAt(0).cloneRange();
    }

    const savedRange = savedNewsletterBodySelectionRef.current;
    if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
      editor.focus();
      const restoredSelection = window.getSelection();
      restoredSelection.removeAllRanges();
      restoredSelection.addRange(savedRange);
    } else {
      editor.focus();
    }
    if (typeof document.execCommand !== "function") {
      setMessage("Text formatting is not supported in this browser.");
      return false;
    }

    if (!document.execCommand(command, false, value)) {
      setMessage("Unable to apply the selected text formatting.");
      return false;
    }
    setNewsletterDraft((current) => ({ ...current, body: editor.innerHTML }));
    saveNewsletterBodySelection();
    return true;
  };

  const applyNewsletterLink = () => {
    const rawUrl = newsletterLinkUrl.trim();
    const normalizedUrl = /^www\./i.test(rawUrl) ? `https://${rawUrl}` : rawUrl;
    let parsedUrl;
    try {
      parsedUrl = new URL(normalizedUrl);
    } catch {
      setMessage("Enter a valid link, such as https://example.com.");
      return;
    }
    if (!["http:", "https:", "mailto:", "tel:"].includes(parsedUrl.protocol)) {
      setMessage("Use a link starting with https://, http://, mailto:, or tel:.");
      return;
    }

    const editor = newsletterBodyEditorRef.current;
    const savedRange = savedNewsletterBodySelectionRef.current;
    if (!editor || !savedRange || !editor.contains(savedRange.commonAncestorContainer) || savedRange.collapsed) {
      setMessage("Select the text you want to turn into a link.");
      return;
    }

    try {
      const getContainingLink = (node) => {
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        return element?.closest("a") || null;
      };
      const startLink = getContainingLink(savedRange.startContainer);
      const endLink = getContainingLink(savedRange.endContainer);
      if (startLink && startLink === endLink) {
        let link = startLink;
        while (link.parentElement && link.parentElement !== editor) {
          if (link.parentElement.matches("a")) link = link.parentElement;
          else break;
        }
        link.href = normalizedUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.querySelectorAll("a").forEach((nestedLink) => {
          nestedLink.replaceWith(...nestedLink.childNodes);
        });
        const linkRange = document.createRange();
        linkRange.selectNodeContents(link);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(linkRange);
        savedNewsletterBodySelectionRef.current = linkRange.cloneRange();
        setNewsletterDraft((current) => ({ ...current, body: editor.innerHTML }));
        setNewsletterLinkUrl("");
        setIsNewsletterLinkEditorOpen(false);
        return;
      }

      const link = document.createElement("a");
      link.href = normalizedUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(savedRange.extractContents());
      savedRange.insertNode(link);
      const linkedTextRange = document.createRange();
      linkedTextRange.selectNodeContents(link);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(linkedTextRange);
      savedNewsletterBodySelectionRef.current = linkedTextRange.cloneRange();
      setNewsletterDraft((current) => ({ ...current, body: editor.innerHTML }));
    } catch (error) {
      console.error("Unable to convert selected newsletter text to a link", error);
      setMessage("Unable to convert the selected text to a link.");
      return;
    }
    setNewsletterLinkUrl("");
    setIsNewsletterLinkEditorOpen(false);
  };

  const uploadNewsletterAttachments = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const maxAttachments = 5;
    const maxFileSize = 10 * 1024 * 1024;
    const maxTotalSize = 20 * 1024 * 1024;
    const currentSize = newsletterAttachments.reduce((total, attachment) => total + Number(attachment.size || 0), 0);
    if (newsletterAttachments.length + files.length > maxAttachments) {
      setNewsletterAttachmentError(`You can attach up to ${maxAttachments} files.`);
      return;
    }
    if (files.some((file) => file.size > maxFileSize)) {
      setNewsletterAttachmentError("Each newsletter attachment must be 10 MB or less.");
      return;
    }
    if (currentSize + files.reduce((total, file) => total + file.size, 0) > maxTotalSize) {
      setNewsletterAttachmentError("Newsletter attachments must total 20 MB or less.");
      return;
    }

    setIsUploadingNewsletterAttachments(true);
    setNewsletterAttachmentError("");
    const formData = new FormData();
    files.forEach((file) => formData.append("attachments", file));
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/promotions/newsletter-attachments`,
        formData,
        { headers: buildAuthHeaders() }
      );
      if (!Array.isArray(response.data?.attachments)) {
        throw new Error("Attachment upload returned an invalid response.");
      }
      const uploadedAttachments = response.data.attachments.map((attachment, index) => {
        const previewUrl = attachment.inline ? URL.createObjectURL(files[index]) : undefined;
        return { ...attachment, previewUrl };
      });
      setNewsletterAttachments((current) => [...current, ...uploadedAttachments]);
      const editor = newsletterBodyEditorRef.current;
      if (editor) {
        uploadedAttachments.filter((attachment) => attachment.inline).forEach((attachment) => {
          const image = document.createElement("img");
          image.src = attachment.previewUrl;
          image.alt = attachment.name;
          image.dataset.newsletterCid = attachment.cid;
          editor.appendChild(image);
        });
        setNewsletterDraft((current) => ({ ...current, body: editor.innerHTML }));
      }
    } catch (error) {
      console.error("Unable to upload newsletter attachments", error);
      setNewsletterAttachmentError(
        error.response?.data?.error || error.message || "Unable to upload newsletter attachments."
      );
    } finally {
      setIsUploadingNewsletterAttachments(false);
    }
  };

  const removeNewsletterAttachment = (attachment) => {
    if (attachment.inline && newsletterBodyEditorRef.current) {
      newsletterBodyEditorRef.current.querySelectorAll("img").forEach((image) => {
        if (
          (attachment.cid && image.dataset.newsletterCid === attachment.cid)
          || (attachment.previewUrl && image.src === attachment.previewUrl)
        ) {
          image.remove();
        }
      });
      setNewsletterDraft((current) => ({
        ...current,
        body: newsletterBodyEditorRef.current.innerHTML
      }));
    }
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    setNewsletterAttachments((current) => (
      current.filter((item) => item.filename !== attachment.filename)
    ));
  };

  const editNewsletterCampaign = async (campaign) => {
    const status = String(campaign.status || "draft").trim().toLowerCase();
    const bodyContainer = document.createElement("div");
    bodyContainer.innerHTML = String(campaign.body || "");
    const attachments = (Array.isArray(campaign.attachments) ? campaign.attachments : []).map((attachment) => ({
      ...attachment,
      inline: /\.(?:jpe?g|png)$/i.test(String(attachment.filename || "")),
      previewUrl: undefined
    }));
    const previewUrls = [];
    try {
      for (const image of bodyContainer.querySelectorAll('img[src^="cid:"]')) {
        const cid = image.getAttribute("src").slice(4);
        const attachment = attachments.find((item) => item.inline && item.cid === cid);
        if (!attachment) {
          throw new Error(`The inline image "${image.alt || cid}" is missing from this campaign's attachments.`);
        }
        const response = await axios.get(
          `${API_BASE_URL}/admin/promotions/newsletter-attachments/${encodeURIComponent(attachment.filename)}`,
          { headers: buildAuthHeaders(), responseType: "blob" }
        );
        const previewUrl = URL.createObjectURL(response.data);
        previewUrls.push(previewUrl);
        attachment.previewUrl = previewUrl;
        image.src = previewUrl;
        image.dataset.newsletterCid = cid;
      }
    } catch (error) {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      console.error("Unable to load newsletter image previews for editing", error);
      setMessage(error.response?.data?.error || error.message || "Unable to load newsletter image previews.");
      return;
    }

    const body = bodyContainer.innerHTML;
    newsletterAttachments.forEach((attachment) => {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    });
    setEditingNewsletterId(campaign.id);
    setNewsletterDraft({
      name: campaign.name || "",
      subject: campaign.subject || "",
      schedule: campaign.scheduled_at ? getISTDateTimeLocal(new Date(campaign.scheduled_at)) : "",
      audience: campaign.audience || "all",
      status,
      body
    });
    setNewsletterRecipientsText(Array.isArray(campaign.recipients) ? campaign.recipients.join(", ") : "");
    setNewsletterAttachments(attachments);
    if (newsletterBodyEditorRef.current) newsletterBodyEditorRef.current.innerHTML = body;
    document.getElementById("newsletter-campaign-form")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  const cancelNewsletterEdit = () => {
    newsletterAttachments.forEach((attachment) => {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    });
    setEditingNewsletterId(null);
    setNewsletterDraft(initialNewsletterForm);
    setNewsletterRecipientsText("");
    setNewsletterAttachments([]);
    if (newsletterBodyEditorRef.current) newsletterBodyEditorRef.current.innerHTML = "";
  };

  const handleNewsletterSubmit = async (event) => {
    event.preventDefault();
    const bodyForSubmission = document.createElement("div");
    bodyForSubmission.innerHTML = newsletterBodyEditorRef.current?.innerHTML || newsletterDraft.body;
    newsletterAttachments.filter((attachment) => attachment.inline && attachment.cid).forEach((attachment) => {
      bodyForSubmission.querySelectorAll("img").forEach((image) => {
        if (
          image.dataset.newsletterCid === attachment.cid
          || (attachment.previewUrl && image.src === attachment.previewUrl)
        ) {
          image.src = `cid:${attachment.cid}`;
          delete image.dataset.newsletterCid;
        }
      });
    });
    const action = newsletterDraft.status === "scheduled"
      ? "schedule"
      : newsletterDraft.status === "send"
        ? "send"
        : ["sent", "sending"].includes(newsletterDraft.status)
          ? "update"
          : "draft";
    const parsedRecipients = parseNewsletterRecipientEmails(newsletterRecipientsText);
    if (parsedRecipients.invalid.length > 0) {
      setNewsletterRecipientInputError(
        `Please correct these email address(es) before continuing: ${parsedRecipients.invalid.join(", ")}`
      );
      return;
    }
    const recipients = parsedRecipients.emails;
    setNewsletterRecipientInputError("");
    const schedule = action === "schedule" ? getISTScheduleISO(newsletterDraft.schedule) : "";

    if (action !== "draft" && (!newsletterDraft.name.trim() || !newsletterDraft.subject.trim() || !bodyForSubmission.innerHTML.trim())) {
      setMessage("Campaign name, subject, and email body are required to send or schedule a newsletter.");
      return;
    }
    if (action !== "draft" && recipients.length === 0) {
      setMessage("Select at least one recipient email before sending or scheduling.");
      return;
    }
    if (action === "schedule" && (!schedule || new Date(schedule).getTime() <= Date.now())) {
      setMessage("Choose a future schedule date and time in IST.");
      return;
    }

    setIsSavingNewsletter(true);
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/promotions`,
        {
          resource: "newsletter",
          action,
          data: {
            ...(editingNewsletterId !== null ? { id: editingNewsletterId } : {}),
            name: newsletterDraft.name.trim(),
            subject: newsletterDraft.subject.trim(),
            body: bodyForSubmission.innerHTML,
            recipients,
            audience: newsletterDraft.audience,
            schedule,
            attachments: newsletterAttachments.map(({ filename, name, size, cid }) => ({
              filename,
              name,
              size,
              ...(cid ? { cid } : {})
            }))
          }
        },
        { headers: buildAuthHeaders() }
      );
      if (response.data?.campaign) {
        setNewsletters((current) => [
          response.data.campaign,
          ...current.filter((campaign) => String(campaign.id) !== String(response.data.campaign.id))
        ]);
        if (editingNewsletterId === null) {
          setDashboard((current) => ({
            ...current,
            newsletter_campaigns: Number(current.newsletter_campaigns || 0) + 1
          }));
        }
      }
      setMessage(action === "update" || (editingNewsletterId !== null && action === "draft")
        ? "Newsletter campaign updated."
        : action === "send"
          ? `Newsletter queued for ${response.data?.queued || 0} recipient(s).`
          : action === "schedule"
            ? "Newsletter campaign scheduled."
            : "Newsletter draft saved.");
      setNewsletterDraft(initialNewsletterForm);
      if (newsletterBodyEditorRef.current) newsletterBodyEditorRef.current.innerHTML = "";
      setNewsletterRecipientsText("");
      setNewsletterRecipientInputError("");
      setNewsletterRecipientResults([]);
      setNewsletterSelectedRecipients([]);
      newsletterAttachments.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      setNewsletterAttachments([]);
      setEditingNewsletterId(null);
    } catch (error) {
      console.error("Unable to save newsletter campaign", error);
      setMessage(error.response?.data?.error || "Unable to save newsletter campaign.");
    } finally {
      setIsSavingNewsletter(false);
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

  const renderKpiCards = ({ analyticsOnly = false } = {}) => {
    const couponUsageRangeOptions = [
      { value: "last_30_days", label: "Last 30 days" },
      { value: "current_month", label: "Current month" },
      { value: "current_quarter", label: "Current quarter" },
      { value: "last_quarter", label: "Last quarter" },
      { value: "current_financial_year", label: "Current financial year (Apr to Mar)" },
      { value: "last_financial_year", label: "Last financial year" }
    ];
    const selectedUsage = couponAnalytics[couponUsageRange] || { uses: 0 };
    const todayDateKey = getISTDateString();
    const isInDateRange = (value, { start, end }) => {
      const dateKey = getISTDateKey(value);
      return Boolean(dateKey && (!start || dateKey >= start) && (!end || dateKey <= end));
    };
    const getApplicationCount = (range) => {
      const dateRange = range === "today"
        ? { start: todayDateKey, end: todayDateKey }
        : range === "yesterday"
          ? { start: shiftDateKey(todayDateKey, -1), end: shiftDateKey(todayDateKey, -1) }
          : range === "last_7_days"
            ? { start: shiftDateKey(todayDateKey, -6), end: todayDateKey }
            : { start: "", end: "" };
      return contributorApplications.filter((application) => isInDateRange(application.created_at, dateRange)).length;
    };
    const getApprovedBenefits = (range) => {
      const dateRange = range === "today"
        ? { start: todayDateKey, end: todayDateKey }
        : range === "yesterday"
          ? { start: shiftDateKey(todayDateKey, -1), end: shiftDateKey(todayDateKey, -1) }
          : range === "last_7_days"
            ? { start: shiftDateKey(todayDateKey, -6), end: todayDateKey }
            : { start: "", end: "" };
      return contributorApplications.filter((application) => (
        application.benefit_approved && isInDateRange(application.benefit_approved_at, dateRange)
      ));
    };
    const contributorApplicationRangeBounds = getContributorAnalyticsRange(contributorApplicationRange, todayDateKey);
    const contributorBenefitsRangeBounds = getContributorAnalyticsRange(contributorBenefitsRange, todayDateKey);
    const selectedContributorApplications = contributorApplications.filter((application) => (
      isInDateRange(application.created_at, contributorApplicationRangeBounds)
    ));
    const selectedContributorBenefits = contributorApplications.filter((application) => (
      application.benefit_approved
      && isInDateRange(application.benefit_approved_at, contributorBenefitsRangeBounds)
    ));
    const getBenefitPaidAmount = (application) => Number(application.paid_amount || 0);
    const getBenefitTotal = (applications) => applications.reduce((total, application) => (
      total + getBenefitPaidAmount(application)
    ), 0);
    const convertBenefitAmount = (amount) => {
      const rate = Number(couponExchangeRates[contributorBenefitsCurrency]);
      return Number.isFinite(rate) && rate > 0 ? amount * rate : null;
    };
    const formatBenefitsCurrency = (amount) => {
      const convertedAmount = convertBenefitAmount(amount);
      return convertedAmount === null ? "—" : formatCouponCurrency(convertedAmount, contributorBenefitsCurrency);
    };
    const contributorOfferStatusCounts = campaigns.reduce((counts, campaign) => {
      const status = getCampaignDisplayStatus(campaign.status);
      if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
      return counts;
    }, { active: 0, scheduled: 0, ended: 0, draft: 0 });
    const contributorOfferStats = campaigns.map((campaign) => {
      const offerApplications = contributorApplications.filter((application) => (
        String(application.offer_id) === String(campaign.id)
      ));
      const approvedApplications = offerApplications.filter((application) => application.benefit_approved);
      const metadata = getCampaignMetadata(campaign);
      const requirement = String(metadata.eligibility_requirements || "").trim();
      const requirementTarget = metadata.eligibility_requirement_value === ""
        || metadata.eligibility_requirement_value === null
        || metadata.eligibility_requirement_value === undefined
        ? null
        : Number(metadata.eligibility_requirement_value);
      const achievedRequirements = requirement && Number.isFinite(requirementTarget) && requirementTarget > 0
        ? offerApplications.filter((application) => Number(application.progress_count || 0) >= requirementTarget).length
        : null;
      const lastUsedAt = offerApplications.reduce((latestDate, application) => {
        const applicationDate = new Date(application.created_at || "");
        return !Number.isNaN(applicationDate.getTime())
          && (!latestDate || applicationDate > latestDate)
          ? applicationDate
          : latestDate;
      }, null);
      return {
        ...campaign,
        applicationCount: offerApplications.length,
        metadata,
        achievedRequirements,
        lastUsedAt,
        benefitsPaid: getBenefitTotal(approvedApplications)
      };
    }).sort((left, right) => (
      right.applicationCount - left.applicationCount
      || right.benefitsPaid - left.benefitsPaid
      || String(left.name || "").localeCompare(String(right.name || ""))
    ));
    const featuredContributorOffers = contributorOfferStats.slice(0, 5);
    const remainingContributorOffers = contributorOfferStats.slice(5);
    const exportContributorOffers = (offers) => downloadPromotionCsvWithRecordFields(
      "contributor-offers.csv",
      [
        "Offer name",
        "Description",
        "Benefit type",
        "Benefit value",
        "Eligibility requirements",
        "Eligible contributors",
        "Eligibility requirement value",
        "Eligibility requirements achieved",
        "Status",
        "Start date",
        "End date",
        "Applications",
        "Last used date (IST)",
        "Benefits paid (INR)"
      ],
      offers.map((offer) => {
        const metadata = offer.metadata || {};
        const eligibleContributors = metadata.eligibility_scope === "selected"
          ? (Array.isArray(metadata.eligible_contributors)
            ? metadata.eligible_contributors.join(", ")
            : metadata.eligible_contributors || offer.audience || "Selected contributors")
          : "All contributors";
        const requirement = String(metadata.eligibility_requirements || "").trim();
        const achievedRequirements = offer.achievedRequirements === null
          ? ""
          : `${offer.achievedRequirements}/${offer.applicationCount} contributors`;
        return [
          offer.name || "Unnamed offer",
          offer.objective || "",
          metadata.benefit_type || "",
          metadata.benefit_value ?? "",
          requirement,
          eligibleContributors,
          metadata.eligibility_requirement_value ?? "",
          achievedRequirements,
          getCampaignDisplayStatus(offer.status),
          formatCsvDate(offer.start_date),
          formatCsvDate(offer.end_date),
          offer.applicationCount,
          formatCsvDate(offer.lastUsedAt),
          offer.benefitsPaid.toFixed(2)
        ];
      }),
      offers.map((offer) => [offer]),
      ["Contributor offer"]
    );
    const getApplicationOfferExportMetadata = (application) => {
      const campaign = campaigns.find((item) => String(item.id) === String(application.offer_id));
      if (!campaign) return ["", "", "", "", "", "", ""];
      const metadata = getCampaignMetadata(campaign);
      const requirement = String(metadata.eligibility_requirements || "").trim();
      const rawTarget = metadata.eligibility_requirement_value;
      const target = rawTarget === "" || rawTarget === null || rawTarget === undefined
        ? null
        : Number(rawTarget);
      const eligibleContributors = metadata.eligibility_scope === "selected"
        ? (Array.isArray(metadata.eligible_contributors)
          ? metadata.eligible_contributors.join(", ")
          : metadata.eligible_contributors || campaign.audience || "Selected contributors")
        : "All contributors";
      const progress = Number(application.progress_count);
      const achieved = requirement && Number.isFinite(target) && target > 0
        ? `${Number.isFinite(progress) ? progress : 0}/${target} ${requirement}`
        : "";
      return [
        campaign.objective || "",
        metadata.benefit_type || "",
        metadata.benefit_value ?? "",
        requirement,
        eligibleContributors,
        rawTarget ?? "",
        achieved
      ];
    };
    const exportContributorApplications = () => downloadPromotionCsvWithRecordFields(
      "contributor-offer-applications.csv",
      [
        "Contributor",
        "Username",
        "Email",
        "Offer name",
        "Description",
        "Benefit type",
        "Benefit value",
        "Eligibility requirements",
        "Eligible contributors",
        "Eligibility requirement value",
        "Eligibility requirements achieved",
        "Offer start date",
        "Offer end date",
        "Status",
        "Offer used date (IST)",
        "Benefit approved",
        "Benefits paid (INR)"
      ],
      contributorApplications.map((application) => {
        const campaign = campaigns.find((item) => String(item.id) === String(application.offer_id));
        return [
          application.full_name || application.username || `Contributor #${application.contributor_id}`,
          application.username || "",
          application.email || "",
          application.offer_name || `Offer #${application.offer_id}`,
          ...getApplicationOfferExportMetadata(application),
          formatCsvDate(campaign?.start_date),
          formatCsvDate(campaign?.end_date),
          getContributorApplicationDisplayStatus(application),
          formatCsvDate(application.created_at),
          application.benefit_approved ? "Yes" : "No",
          application.benefit_approved ? getBenefitPaidAmount(application).toFixed(2) : ""
        ];
      }),
      contributorApplications.map((application) => [
        application,
        campaigns.find((item) => String(item.id) === String(application.offer_id)) || {}
      ]),
      ["Application", "Contributor offer"]
    );
    const exportContributorBenefits = () => downloadPromotionCsvWithRecordFields(
      "contributor-benefits-paid.csv",
      [
        "Contributor",
        "Username",
        "Offer name",
        "Description",
        "Benefit type",
        "Benefit value",
        "Eligibility requirements",
        "Eligible contributors",
        "Eligibility requirement value",
        "Eligibility requirements achieved",
        "Offer start date",
        "Offer end date",
        "Offer used date (IST)",
        "Approved date",
        `Benefits paid (${contributorBenefitsCurrency})`,
        "Currency"
      ],
      selectedContributorBenefits.map((application) => {
        const convertedAmount = convertBenefitAmount(getBenefitPaidAmount(application));
        const campaign = campaigns.find((item) => String(item.id) === String(application.offer_id));
        return [
          application.full_name || application.username || `Contributor #${application.contributor_id}`,
          application.username || "",
          application.offer_name || `Offer #${application.offer_id}`,
          ...getApplicationOfferExportMetadata(application),
          formatCsvDate(campaign?.start_date),
          formatCsvDate(campaign?.end_date),
          formatCsvDate(application.created_at),
          formatCsvDate(application.benefit_approved_at),
          convertedAmount === null ? "" : convertedAmount.toFixed(2),
          contributorBenefitsCurrency
        ];
      }),
      selectedContributorBenefits.map((application) => [
        application,
        campaigns.find((item) => String(item.id) === String(application.offer_id)) || {}
      ]),
      ["Application", "Contributor offer"]
    );
    const convertRevenueByCurrency = (revenueByCurrency = {}) => {
      const targetRate = Number(couponExchangeRates[couponCurrency]);
      if (!Number.isFinite(targetRate) || targetRate <= 0) return null;
      return Object.entries(revenueByCurrency).reduce((total, [sourceCurrency, amount]) => {
        const sourceRate = Number(couponExchangeRates[sourceCurrency]);
        if (!Number.isFinite(sourceRate) || sourceRate <= 0) return null;
        if (total === null) return null;
        return total + (Number(amount || 0) / sourceRate) * targetRate;
      }, 0);
    };
    const convertCouponRevenue = (period) => (
      convertRevenueByCurrency(couponAnalytics[period]?.revenue_by_currency || {})
    );
    const rankedCoupons = [...topCoupons].sort((left, right) => (
      Number(right.uses || 0) - Number(left.uses || 0) ||
      String(left.name || left.code || "").localeCompare(String(right.name || right.code || ""))
    ));
    const couponRecordsById = new Map(coupons.map((coupon) => [String(coupon.id), coupon]));
    const getCouponExportRecords = (coupon) => [
      couponRecordsById.get(String(coupon.id)) || {},
      coupon
    ];
    const featuredCoupons = rankedCoupons.slice(0, 5);
    const exportCouponUsage = () => downloadPromotionCsvWithRecordFields(
      "coupons-used.csv",
      ["Coupon name", "Coupon code", "Total uses", "Last used date (IST)", "Start date", "End date"],
      rankedCoupons.map((coupon) => [
        coupon.name || "Unnamed coupon",
        coupon.code || "",
        Number(coupon.uses || 0),
        formatCsvDate(coupon.last_used_date),
        formatCsvDate(coupon.start_at),
        formatCsvDate(coupon.end_at)
      ]),
      rankedCoupons.map(getCouponExportRecords),
      ["Coupon", "Usage analytics"]
    );
    const exportCouponRevenue = () => downloadPromotionCsvWithRecordFields(
      "coupon-revenue.csv",
      ["Coupon name", "Coupon code", `Revenue (${couponCurrency})`, "Currency", "Last used date (IST)", "Start date", "End date"],
      rankedCoupons.map((coupon) => {
        const revenue = convertRevenueByCurrency(coupon.revenue_by_currency || {});
        return [
          coupon.name || "Unnamed coupon",
          coupon.code || "",
          revenue === null ? "" : revenue.toFixed(2),
          couponCurrency,
          formatCsvDate(coupon.last_used_date),
          formatCsvDate(coupon.start_at),
          formatCsvDate(coupon.end_at)
        ];
      }),
      rankedCoupons.map(getCouponExportRecords),
      ["Coupon", "Revenue analytics"]
    );
    const exportAllCoupons = () => {
      const csvRows = rankedCoupons.map((coupon) => {
        const revenue = convertRevenueByCurrency(coupon.revenue_by_currency || {});
        return [
          coupon.name || "Unnamed coupon",
          coupon.code || "",
          Number(coupon.uses || 0),
          revenue === null ? "" : revenue.toFixed(2),
          couponCurrency,
          formatCsvDate(coupon.last_used_date),
          formatCsvDate(coupon.start_at),
          formatCsvDate(coupon.end_at)
        ];
      });
      downloadPromotionCsvWithRecordFields(
        "coupons.csv",
        ["Coupon name", "Coupon code", "Coupons used", `Revenue (${couponCurrency})`, "Currency", "Last used date (IST)", "Start date", "End date"],
        csvRows,
        rankedCoupons.map(getCouponExportRecords),
        ["Coupon", "Usage and revenue analytics"]
      );
    };
    const hasUnconvertibleCouponRevenue = Object.values(couponAnalytics).some((period) => (
      Object.keys(period?.revenue_by_currency || {}).some((currency) => {
        const rate = Number(couponExchangeRates[currency]);
        return !Number.isFinite(rate) || rate <= 0;
      })
    ));
    const flashSaleStatusCounts = flashEventRecords.reduce((counts, { timing }) => {
      if (Object.prototype.hasOwnProperty.call(counts, timing.status)) counts[timing.status] += 1;
      return counts;
    }, { active: 0, scheduled: 0, expired: 0 });
    const getFlashSaleDiscountLabel = (sale) => (
      FLASH_SALE_DISCOUNT_RULES.find((rule) => (
        rule.value.toLowerCase() === String(sale.discount_rule || "").trim().toLowerCase()
      ))?.label || sale.discount_rule || "Other"
    );
    const flashSaleDiscountCounts = flashEventRecords.reduce((counts, { sale }) => {
      const label = getFlashSaleDiscountLabel(sale);
      counts[label] = (counts[label] || 0) + 1;
      return counts;
    }, {});
    const flashSalePlacementCounts = flashEventRecords.reduce((counts, { sale }) => {
      const placement = String(sale.featured_placement || "homepage").trim().toLowerCase();
      const label = placement === "category"
        ? "Category"
        : placement === "collection"
          ? "Collection"
          : "Homepage";
      counts[label] += 1;
      return counts;
    }, { Homepage: 0, Category: 0, Collection: 0 });
    const bundleTodayDateKey = getISTDateString(new Date(flashEventsNow));
    const bundleEventRecords = bundles.map((bundle) => {
      const metadata = getCampaignMetadata(bundle);
      const startDate = String(metadata.start_date || "").slice(0, 10);
      const endDate = String(metadata.end_date || "").slice(0, 10);
      const savedStatus = String(bundle.status || "").trim().toLowerCase();
      const status = savedStatus === "draft"
        ? "draft"
        : savedStatus === "expired" || (endDate && endDate < bundleTodayDateKey)
          ? "expired"
          : savedStatus === "scheduled" || (startDate && startDate > bundleTodayDateKey)
            ? "scheduled"
            : savedStatus === "active" || !savedStatus
              ? "active"
              : savedStatus;
      const tiers = Array.isArray(metadata.discount_tiers) ? metadata.discount_tiers : [];
      return {
        bundle,
        metadata,
        status,
        startDate,
        endDate,
        tiers,
        tierDetails: tiers
          .map((tier) => `${Number(tier.asset_count || 0)} assets: ${Number(tier.discount_percent || 0)}%`)
          .join("; ")
      };
    });
    const bundleStatusCounts = bundleEventRecords.reduce((counts, { status }) => {
      if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
      return counts;
    }, { active: 0, scheduled: 0, expired: 0, draft: 0 });
    const bundleTierCounts = bundleEventRecords.reduce((counts, { tiers }) => {
      tiers.forEach((tier) => {
        const label = `${Number(tier.asset_count || 0)} assets · ${Number(tier.discount_percent || 0)}%`;
        counts[label] = (counts[label] || 0) + 1;
      });
      return counts;
    }, {});
    const downloadBundleCsv = (filename, headers, getRow) => {
      const exportRows = bundleEventRecords.flatMap((record) => {
        const userUsage = Array.isArray(record.bundle.usage_details) && record.bundle.usage_details.length
          ? record.bundle.usage_details
          : [{}];
        return userUsage.map((usage) => ({
          row: [
            ...getRow(record),
            usage.user_id ?? "",
            usage.username || "",
            usage.full_name || "",
            usage.email || "",
            Number(usage.uses || 0),
            Number(usage.assets_downloaded || 0)
          ],
          records: [record.bundle, usage]
        }));
      });
      downloadPromotionCsvWithRecordFields(
        filename,
        [...headers, "User ID", "Username", "Full name", "Email", "Times used", "Assets downloaded"],
        exportRows.map(({ row }) => row),
        exportRows.map(({ records }) => records),
        ["Bundle discount", "User usage"]
      );
    };
    const exportBundleStatuses = () => downloadBundleCsv(
      "bundle-discount-statuses.csv",
      ["Bundle discount", "Status", "Start date", "End date"],
      ({ bundle, status, startDate, endDate }) => [
        bundle.name || "Unnamed bundle",
        status,
        formatCsvDate(startDate),
        formatCsvDate(endDate)
      ]
    );
    const exportBundleTiers = () => downloadBundleCsv(
      "bundle-discount-tiers.csv",
      ["Bundle discount", "Discount tiers"],
      ({ bundle, tierDetails }) => [bundle.name || "Unnamed bundle", tierDetails]
    );
    const exportAllBundles = () => downloadBundleCsv(
      "bundle-discounts.csv",
      ["Bundle discount", "Status", "Applications", "Users used", "Assets downloaded", "Discount tiers", "Start date", "End date"],
      ({ bundle, status, tierDetails, startDate, endDate }) => [
        bundle.name || "Unnamed bundle",
        status,
        Number(bundle.applications || 0),
        Number(bundle.users_used || 0),
        Number(bundle.assets_downloaded || 0),
        tierDetails,
        formatCsvDate(startDate),
        formatCsvDate(endDate)
      ]
    );
    const featuredBundles = [...bundleEventRecords]
      .sort((left, right) => (
        Number(right.bundle.users_used || 0) - Number(left.bundle.users_used || 0)
        || Number(right.bundle.assets_downloaded || 0) - Number(left.bundle.assets_downloaded || 0)
        || String(left.bundle.name || "").localeCompare(String(right.bundle.name || ""))
      ))
      .slice(0, 5);
    const getNewsletterRecipientsForExport = (campaign) => {
      if (Array.isArray(campaign.recipient_details) && campaign.recipient_details.length) {
        return campaign.recipient_details;
      }
      return (Array.isArray(campaign.recipients) ? campaign.recipients : []).map((recipient) => (
        typeof recipient === "string" ? { recipient } : recipient || {}
      ));
    };
    const getNewsletterRecipientCount = (campaign) => Math.max(
      Number(campaign.queued_recipients || 0),
      Array.isArray(campaign.recipients) ? campaign.recipients.length : 0
    );
    const newsletterStatusCounts = newsletters.reduce((counts, campaign) => {
      const metadata = getCampaignMetadata(campaign);
      const savedStatus = String(campaign.status || "draft").trim().toLowerCase();
      const status = savedStatus === "draft" && metadata.delivery_error ? "failed" : savedStatus;
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    const newsletterAudienceCounts = newsletters.reduce((counts, campaign) => {
      const audience = String(campaign.audience || "unspecified").trim().toLowerCase();
      const configuredAudience = NEWSLETTER_AUDIENCES.find((item) => item.value === audience);
      const label = configuredAudience?.label || (audience === "unspecified" ? "Unspecified audience" : audience);
      const current = counts.get(label) || { campaigns: 0, recipients: 0 };
      current.campaigns += 1;
      current.recipients += getNewsletterRecipientCount(campaign);
      counts.set(label, current);
      return counts;
    }, new Map());
    const newsletterAudienceRows = [...newsletterAudienceCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right));
    const newsletterDeliveryTotals = newsletters.reduce((totals, campaign) => ({
      recipients: totals.recipients + getNewsletterRecipientCount(campaign),
      queued: totals.queued + Number(campaign.queued_recipients || 0),
      sent: totals.sent + Number(campaign.sent_recipients || 0),
      opened: totals.opened + Number(campaign.opened_recipients || 0),
      clicked: totals.clicked + Number(campaign.clicked_recipients || 0)
    }), { recipients: 0, queued: 0, sent: 0, opened: 0, clicked: 0 });
    const downloadNewsletterCsv = (filename, headers, getRow) => {
      const exportRows = newsletters.flatMap((campaign) => {
        const recipients = getNewsletterRecipientsForExport(campaign);
        const recipientRecords = recipients.length ? recipients : [{}];
        return recipientRecords.map((recipient) => ({
          row: getRow(campaign, recipient),
          records: [campaign, recipient]
        }));
      });
      downloadPromotionCsvWithRecordFields(
        filename,
        headers,
        exportRows.map(({ row }) => row),
        exportRows.map(({ records }) => records),
        ["Newsletter campaign", "Recipient delivery"]
      );
    };
    const getNewsletterDisplayStatus = (campaign) => {
      const metadata = getCampaignMetadata(campaign);
      const status = String(campaign.status || "draft").trim().toLowerCase();
      return status === "draft" && metadata.delivery_error ? "failed" : status;
    };
    const exportNewsletterStatuses = () => downloadNewsletterCsv(
      "newsletter-campaign-statuses.csv",
      ["Campaign", "Subject", "Status", "Audience", "Recipients", "Scheduled at (IST)", "Sent at (IST)"],
      (campaign) => [
        campaign.name || "Untitled newsletter",
        campaign.subject || "",
        getNewsletterDisplayStatus(campaign),
        campaign.audience || "",
        getNewsletterRecipientCount(campaign),
        campaign.scheduled_at || campaign.schedule ? formatNewsletterSchedule(campaign.scheduled_at || campaign.schedule) : "",
        campaign.sent_at ? formatNewsletterSchedule(campaign.sent_at) : ""
      ]
    );
    const exportNewsletterAudiences = () => downloadCouponCsv(
      "newsletter-campaign-audiences.csv",
      ["Audience", "Campaigns", "Recipients"],
      newsletterAudienceRows.map(([audience, totals]) => [audience, totals.campaigns, totals.recipients])
    );
    const exportAllNewsletters = () => downloadNewsletterCsv(
      "newsletter-campaigns.csv",
      ["Campaign", "Subject", "Status", "Audience", "Recipients", "Queued", "Sent", "Opened", "Clicked", "Scheduled at (IST)", "Sent at (IST)", "Recipient email", "Recipient status", "Opened at (IST)", "Clicked at (IST)"],
      (campaign, recipient) => [
        campaign.name || "Untitled newsletter",
        campaign.subject || "",
        campaign.status || "draft",
        campaign.audience || "",
        getNewsletterRecipientCount(campaign),
        Number(campaign.queued_recipients || 0),
        Number(campaign.sent_recipients || 0),
        Number(campaign.opened_recipients || 0),
        Number(campaign.clicked_recipients || 0),
        campaign.scheduled_at || campaign.schedule ? formatNewsletterSchedule(campaign.scheduled_at || campaign.schedule) : "",
        campaign.sent_at ? formatNewsletterSchedule(campaign.sent_at) : "",
        recipient.recipient || recipient.email || "",
        recipient.status || "",
        formatCsvDate(recipient.opened_at),
        formatCsvDate(recipient.clicked_at)
      ]
    );
    const featuredNewsletters = [...newsletters]
      .sort((left, right) => (
        getNewsletterRecipientCount(right) - getNewsletterRecipientCount(left)
        || Number(right.opened_recipients || 0) - Number(left.opened_recipients || 0)
        || String(left.name || "").localeCompare(String(right.name || ""))
      ))
      .slice(0, 5);
    const bannerTodayDateKey = getISTDateString(new Date(flashEventsNow));
    const bannerEventRecords = banners.map((banner) => {
      const metadata = getCampaignMetadata(banner);
      const startDate = String(metadata.start_date || "").slice(0, 10);
      const endDate = String(metadata.end_date || "").slice(0, 10);
      const savedStatus = String(banner.status || "draft").trim().toLowerCase();
      const status = savedStatus === "draft"
        ? "draft"
        : savedStatus === "expired" || (endDate && endDate < bannerTodayDateKey)
          ? "expired"
          : startDate && startDate > bannerTodayDateKey
            ? "scheduled"
            : savedStatus === "active"
              ? "active"
              : savedStatus;
      const placement = String(banner.placement || "unknown").trim().toLowerCase();
      const selectedAssetIds = Array.isArray(metadata.selected_asset_ids) ? metadata.selected_asset_ids : [];
      return {
        banner,
        metadata,
        status,
        placement,
        startDate,
        endDate,
        selectedAssetIds
      };
    });
    const bannerStatusCounts = bannerEventRecords.reduce((counts, { status }) => {
      if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
      return counts;
    }, { active: 0, scheduled: 0, expired: 0, draft: 0 });
    const bannerPlacementCounts = bannerEventRecords.reduce((counts, { placement }) => {
      counts[placement] = (counts[placement] || 0) + 1;
      return counts;
    }, {});
    const bannerPopupAudienceCounts = bannerEventRecords.reduce((counts, { placement, metadata }) => {
      if (placement !== "popup") return counts;
      const audience = String(metadata.popup_audience || "unspecified").trim().toLowerCase();
      counts[audience] = (counts[audience] || 0) + 1;
      return counts;
    }, {});
    const bannerPlacementLabels = {
      left: "Left",
      right: "Right",
      up: "Up",
      down: "Down",
      popup: "Popup"
    };
    const bannerSparkleStyleLabels = {
      none: "None",
      glitter_burst: "Glitter burst",
      twinkle: "Twinkle",
      falling_sparkles: "Falling sparkles",
      snowfall: "Snowfall",
      shimmer_sweep: "Shimmer sweep",
      fireflies: "Fireflies",
      star_trail: "Star trail",
      pulsing_glow: "Pulsing glow",
      aurora_glow: "Aurora glow",
      confetti_sparkles: "Confetti sparkles",
      orbiting_sparkles: "Orbiting sparkles"
    };
    const downloadBannerCsv = (filename, headers, getRow, records = bannerEventRecords) => {
      const exportRows = records.map((record) => ({
        row: getRow(record),
        records: [record.banner]
      }));
      downloadPromotionCsvWithRecordFields(
        filename,
        headers,
        exportRows.map(({ row }) => row),
        exportRows.map(({ records }) => records),
        ["Promotional banner"]
      );
    };
    const exportBannerStatuses = () => downloadBannerCsv(
      "promotional-banner-statuses.csv",
      ["Banner", "Status", "Placement", "Start date", "End date"],
      ({ banner, status, placement, startDate, endDate }) => [
        banner.name || "Unnamed banner",
        status,
        bannerPlacementLabels[placement] || placement,
        formatCsvDate(startDate),
        formatCsvDate(endDate)
      ]
    );
    const exportBannerPlacements = () => downloadBannerCsv(
      "promotional-banner-placements.csv",
      ["Banner", "Placement", "Popup audience", "Linked live assets"],
      ({ banner, placement, metadata, selectedAssetIds }) => [
        banner.name || "Unnamed banner",
        bannerPlacementLabels[placement] || placement,
        placement === "popup" ? metadata.popup_audience || "" : "",
        selectedAssetIds.length
      ]
    );
    const exportBannerPopupAudiences = () => downloadBannerCsv(
      "promotional-banner-popup-audiences.csv",
      ["Banner", "Popup audience"],
      ({ banner, metadata }) => [banner.name || "Unnamed banner", metadata.popup_audience || "Unspecified"],
      bannerEventRecords.filter(({ placement }) => placement === "popup")
    );
    const exportAllBanners = () => downloadBannerCsv(
      "promotional-banners.csv",
      ["Banner", "Status", "Placement", "Popup audience", "Sparkle style", "Icon filename", "Linked live assets", "Start date", "End date"],
      ({ banner, status, placement, metadata, selectedAssetIds, startDate, endDate }) => [
        banner.name || "Unnamed banner",
        status,
        bannerPlacementLabels[placement] || placement,
        placement === "popup" ? metadata.popup_audience || "" : "",
        bannerSparkleStyleLabels[metadata.sparkle_style] || metadata.sparkle_style || "Glitter burst",
        metadata.icon_filename || "",
        selectedAssetIds.join(", "),
        formatCsvDate(startDate),
        formatCsvDate(endDate)
      ]
    );
    const featuredBanners = [...bannerEventRecords]
      .sort((left, right) => (
        String(right.banner.created_at || "").localeCompare(String(left.banner.created_at || ""))
        || Number(right.banner.id || 0) - Number(left.banner.id || 0)
      ))
      .slice(0, 5);
    const promotionEvents = [];
    const addUpcomingPromotion = ({ name, category, section, status, startDate, endDate }) => {
      const start = String(startDate || "").slice(0, 10);
      const end = String(endDate || "").slice(0, 10);
      const daysUntilStart = start ? Math.round((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${todayDateKey}T00:00:00Z`)) / 86400000) : null;
      const daysUntilEnd = end ? Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${todayDateKey}T00:00:00Z`)) / 86400000) : null;
      if (status === "scheduled" && start && daysUntilStart >= 0 && daysUntilStart <= 30) {
        promotionEvents.push({ name, category, section, status, date: start, daysUntil: daysUntilStart, dateType: "start" });
      } else if (status === "active" && daysUntilEnd !== null && daysUntilEnd >= 0 && daysUntilEnd <= 7) {
        promotionEvents.push({ name, category, section, status, date: end, daysUntil: daysUntilEnd, dateType: "end" });
      }
    };
    coupons.forEach((coupon) => {
      const metadata = getCouponMetadata(coupon);
      const savedStatus = String(coupon.status || "active").trim().toLowerCase();
      const startDate = coupon.start_at || metadata.start_date;
      const endDate = coupon.end_at || metadata.end_date;
      const startKey = String(startDate || "").slice(0, 10);
      const endKey = String(endDate || "").slice(0, 10);
      const status = ["draft", "disabled", "inactive", "archived"].includes(savedStatus)
        ? savedStatus
        : endKey && endKey < todayDateKey
          ? "expired"
          : startKey && startKey > todayDateKey
            ? "scheduled"
            : "active";
      addUpcomingPromotion({
        name: coupon.name || coupon.code || "Untitled coupon",
        category: "Coupon",
        section: "coupons",
        status,
        startDate,
        endDate
      });
    });
    campaigns.forEach((campaign) => {
      const metadata = getCampaignMetadata(campaign);
      addUpcomingPromotion({
        name: campaign.name || "Contributor offer",
        category: "Contributor offer",
        section: "campaigns",
        status: getCampaignDisplayStatus(campaign.status),
        startDate: metadata.start_date || campaign.start_date,
        endDate: metadata.end_date || campaign.end_date
      });
    });
    flashEventRecords.forEach(({ sale, timing }) => addUpcomingPromotion({
      name: sale.name || "Flash sale",
      category: "Flash sale",
      section: "flash-sales",
      status: timing.status,
      startDate: sale.start_date,
      endDate: sale.end_date
    }));
    bundleEventRecords.forEach(({ bundle, status, startDate, endDate }) => addUpcomingPromotion({
      name: bundle.name || "Bundle discount",
      category: "Bundle discount",
      section: "bundles",
      status,
      startDate,
      endDate
    }));
    bannerEventRecords.forEach(({ banner, status, startDate, endDate }) => addUpcomingPromotion({
      name: banner.name || "Promotional banner",
      category: "Promotional banner",
      section: "banners",
      status,
      startDate,
      endDate
    }));
    newsletters.forEach((newsletter) => {
      const scheduledDate = newsletter.scheduled_at || newsletter.schedule;
      if (String(newsletter.status || "").toLowerCase() !== "scheduled" || !scheduledDate) return;
      const scheduledDateKey = getISTDateKey(scheduledDate);
      addUpcomingPromotion({
        name: newsletter.name || "Newsletter campaign",
        category: "Newsletter",
        section: "newsletters",
        status: "scheduled",
        startDate: scheduledDateKey
      });
    });
    const upcomingPromotions = promotionEvents
      .sort((left, right) => left.daysUntil - right.daysUntil || left.name.localeCompare(right.name))
      .slice(0, 6);
    const promotionsStartingSoon = promotionEvents.filter((promotion) => (
      promotion.dateType === "start" && promotion.daysUntil <= 7
    ));
    const promotionsExpiringSoon = promotionEvents.filter((promotion) => (
      promotion.dateType === "end" && promotion.daysUntil <= 7
    ));
    const topCouponUsageById = new Map(topCoupons.map((coupon) => [String(coupon.id), coupon]));
    const activeCouponsWithoutRedemptions = coupons.filter((coupon) => {
      const usage = topCouponUsageById.get(String(coupon.id));
      const status = String(coupon.status || "active").trim().toLowerCase();
      return usage && usage.uses === 0 && status === "active";
    });
    const promotionAlerts = [
      ...promotionsExpiringSoon.slice(0, 2).map((promotion) => ({
        type: "warning",
        title: `${promotion.name} expires ${promotion.daysUntil === 0 ? "today" : `in ${promotion.daysUntil} day${promotion.daysUntil === 1 ? "" : "s"}`}`,
        section: promotion.section
      })),
      ...promotionsStartingSoon.slice(0, 2).map((promotion) => ({
        type: "info",
        title: `${promotion.name} starts ${promotion.daysUntil === 0 ? "today" : `in ${promotion.daysUntil} day${promotion.daysUntil === 1 ? "" : "s"}`}`,
        section: promotion.section
      })),
      ...(activeCouponsWithoutRedemptions.length > 0 ? [{
        type: "notice",
        title: `${activeCouponsWithoutRedemptions.length} active coupon${activeCouponsWithoutRedemptions.length === 1 ? "" : "s"} with no recorded redemptions`,
        section: "coupons"
      }] : [])
    ];
    const currentPeriodAnalytics = couponAnalytics.last_30_days;
    const previousPeriodAnalytics = couponAnalytics.previous_30_days;
    const getPeriodChange = (currentValue, previousValue, loaded) => {
      if (!loaded) return "—";
      if (previousValue === 0) return currentValue === 0 ? "—" : "New";
      const percent = ((currentValue - previousValue) / previousValue) * 100;
      return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
    };
    const currentPeriodRevenue = convertRevenueByCurrency(currentPeriodAnalytics?.revenue_by_currency || {});
    const previousPeriodRevenue = convertRevenueByCurrency(previousPeriodAnalytics?.revenue_by_currency || {});
    const periodComparison = [
      {
        label: "Coupon redemptions",
        current: Number(currentPeriodAnalytics?.uses || 0).toLocaleString(),
        change: getPeriodChange(
          Number(currentPeriodAnalytics?.uses || 0),
          Number(previousPeriodAnalytics?.uses || 0),
          Boolean(currentPeriodAnalytics && previousPeriodAnalytics)
        )
      },
      {
        label: `Coupon revenue (${couponCurrency})`,
        current: currentPeriodRevenue === null ? "—" : formatCouponCurrency(currentPeriodRevenue, couponCurrency),
        change: getPeriodChange(
          currentPeriodRevenue || 0,
          previousPeriodRevenue || 0,
          Boolean(currentPeriodAnalytics && previousPeriodAnalytics && currentPeriodRevenue !== null && previousPeriodRevenue !== null)
        )
      }
    ];
    const dailySeriesByDate = new Map(couponDailySeries.map((day) => [day.date, day]));
    const couponTrendData = Array.from({ length: 30 }, (_, index) => {
      const date = shiftDateKey(todayDateKey, index - 29);
      const daily = dailySeriesByDate.get(date);
      const convertedRevenue = convertRevenueByCurrency(daily?.revenue_by_currency || {});
      return {
        date,
        label: date.slice(5),
        value: couponTrendMetric === "uses" ? Number(daily?.uses || 0) : (convertedRevenue || 0)
      };
    });
    const couponTrendMaximum = Math.max(1, ...couponTrendData.map(({ value }) => value));
    const featuredFlashSales = [...flashEventRecords]
      .sort((left, right) => (
        Number(right.sale.users_used || 0) - Number(left.sale.users_used || 0)
        || Number(right.sale.assets_downloaded || 0) - Number(left.sale.assets_downloaded || 0)
        || String(left.sale.name || "").localeCompare(String(right.sale.name || ""))
      ))
      .slice(0, 5);
    const topPromotionHighlights = [
      rankedCoupons[0] && {
        category: "Top coupon",
        name: rankedCoupons[0].name || rankedCoupons[0].code || "Unnamed coupon",
        value: Number(rankedCoupons[0].uses || 0),
        metric: "redemptions",
        section: "coupons"
      },
      featuredFlashSales[0] && {
        category: "Top flash sale",
        name: featuredFlashSales[0].sale.name || "Flash sale",
        value: Number(featuredFlashSales[0].sale.users_used || 0),
        metric: "users",
        section: "flash-sales"
      },
      featuredBundles[0] && {
        category: "Top bundle discount",
        name: featuredBundles[0].bundle.name || "Bundle discount",
        value: Number(featuredBundles[0].bundle.applications || 0),
        metric: "applications",
        section: "bundles"
      }
    ].filter(Boolean);
    const downloadFlashSaleCsv = (filename, headers, getRow) => {
      const exportRows = flashEventRecords.flatMap((record) => {
        const usageDetails = Array.isArray(record.sale.usage_details) && record.sale.usage_details.length
          ? record.sale.usage_details
          : [{}];
        return usageDetails.map((usage) => ({
          row: [
            ...getRow(record),
            usage.user_id ?? "",
            usage.username || "",
            usage.full_name || "",
            usage.email || "",
            Number(usage.uses || 0),
            Number(usage.assets_downloaded || 0)
          ],
          records: [record.sale, usage]
        }));
      });
      downloadPromotionCsvWithRecordFields(
        filename,
        [...headers, "User ID", "Username", "Full name", "Email", "Times used", "Assets downloaded"],
        exportRows.map(({ row }) => row),
        exportRows.map(({ records }) => records),
        ["Flash sale", "User usage"]
      );
    };
    const exportFlashSaleStatuses = () => downloadFlashSaleCsv(
      "flash-sale-statuses.csv",
      ["Flash sale", "Status", "Start date", "End date"],
      ({ sale, timing }) => [
        sale.name || "Flash Sale",
        timing.status,
        formatCsvDate(sale.start_date),
        formatCsvDate(sale.end_date)
      ]
    );
    const exportFlashSaleDiscountRules = () => downloadFlashSaleCsv(
      "flash-sale-discount-rules.csv",
      ["Flash sale", "Discount rule", "Discount details"],
      ({ sale, ruleDetails }) => [
        sale.name || "Flash Sale",
        getFlashSaleDiscountLabel(sale),
        ruleDetails
      ]
    );
    const exportFlashSalePlacements = () => downloadFlashSaleCsv(
      "flash-sale-placements.csv",
      ["Flash sale", "Placement"],
      ({ sale, targetLabel }) => [sale.name || "Flash Sale", targetLabel]
    );
    const exportAllFlashSales = () => downloadFlashSaleCsv(
      "flash-sales.csv",
      ["Flash sale", "Status", "Applications", "Users used", "Assets downloaded", "Discount rule", "Discount value", "Placement", "Featured category ID", "Featured collection ID", "Keywords", "Start date", "End date"],
      ({ sale, metadata, timing }) => [
        sale.name || "Flash Sale",
        timing.status,
        Number(sale.applications || 0),
        Number(sale.users_used || 0),
        Number(sale.assets_downloaded || 0),
        getFlashSaleDiscountLabel(sale),
        metadata.discount_value ?? "",
        sale.featured_placement || "homepage",
        metadata.featured_category_id ?? "",
        metadata.featured_collection_id ?? "",
        metadata.keywords || "",
        formatCsvDate(sale.start_date),
        formatCsvDate(sale.end_date)
      ]
    );
    const revenuePeriods = [
      ["today", "Today"],
      ["yesterday", "Yesterday"],
      ["last_7_days", "Last 7 days"],
      ["lifetime", "Lifetime"]
    ];
    const cards = [
      { label: "Active Campaigns", value: dashboard.active_campaigns || 0 },
      { label: "Scheduled Campaigns", value: dashboard.scheduled_campaigns || 0 },
      { label: "Expired Campaigns", value: dashboard.expired_campaigns || 0 },
      { label: "Coupons Created", value: dashboard.coupons_created || 0 },
      { label: "Coupons Redeemed", value: dashboard.coupons_redeemed || 0 },
      { label: "Revenue Generated", value: `₹${Number(dashboard.revenue_generated || 0).toLocaleString()}`, accent: true },
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

    if (analyticsOnly) {
      const analyticsCards = cards.filter(({ label }) => (
        [
          "Active Campaigns",
          "Scheduled Campaigns",
          "Coupons Created",
          "Coupons Redeemed",
          "Revenue Generated",
          "Revenue Discounted",
          "Average Discount",
          "Referral Revenue",
          "Flash Sales",
          "Active Banners",
          "Newsletter Campaigns",
          "Conversion Rate",
          "Coupon Redemption Rate"
        ].includes(label)
      ));

      return (
        <div className="promotions-analytics-dashboard">
          <div className="promotions-analytics-metrics" role="region" aria-label="Promotion performance metrics">
            {analyticsCards.map((card) => (
              <div key={card.label} className="promotions-card" data-accent={card.accent ? "revenue" : undefined}>
                <div className="promotions-card-label">{card.label}</div>
                <div className="promotions-card-value"><AnimatedPromotionValue value={card.value} /></div>
              </div>
            ))}
          </div>
          <section className="promotions-card promotions-insight-card promotions-coupon-trend-card">
            <div className="promotions-dashboard-section-heading">
              <div>
                <span className="promotions-dashboard-eyebrow">LAST 30 DAYS</span>
                <h3>Coupon activity</h3>
              </div>
              <div className="promotions-trend-toggle" role="group" aria-label="Coupon chart metric">
                <button
                  type="button"
                  aria-pressed={couponTrendMetric === "uses"}
                  onClick={() => setCouponTrendMetric("uses")}
                >
                  Uses
                </button>
                <button
                  type="button"
                  aria-pressed={couponTrendMetric === "revenue"}
                  onClick={() => setCouponTrendMetric("revenue")}
                >
                  Revenue
                </button>
              </div>
            </div>
            <div
              className="promotions-coupon-trend-chart"
              role="img"
              aria-label={`Daily coupon ${couponTrendMetric === "uses" ? "redemptions" : `revenue in ${couponCurrency}`} for the last 30 days`}
            >
              {couponTrendData.map(({ date, label, value }, index) => (
                <span
                  className="promotions-coupon-trend-bar"
                  key={date}
                  title={`${date}: ${couponTrendMetric === "uses" ? `${value} uses` : formatCouponCurrency(value, couponCurrency)}`}
                  style={{ height: `${value > 0 ? Math.max(4, (value / couponTrendMaximum) * 100) : 2}%` }}
                >
                  {index % 7 === 0 || index === couponTrendData.length - 1
                    ? <span className="promotions-coupon-trend-tick">{label}</span>
                    : null}
                </span>
              ))}
            </div>
            <p className="promotions-trend-caption" role={couponAnalyticsError ? "alert" : undefined}>
              {couponAnalyticsError || (couponDailySeries.length === 0
                ? "No coupon redemptions are recorded in the last 30 days."
                : "Daily totals are based on recorded coupon redemptions.")}
            </p>
            <div className="promotions-period-comparison">
              <div className="promotions-period-comparison-heading">
                <strong>Last 30 days</strong>
                <span>vs previous 30 days</span>
              </div>
              {periodComparison.map((metric) => (
                <div className="promotions-period-comparison-row" key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.current}</strong>
                  <span className={`promotions-period-change${metric.change.startsWith("-") ? " is-down" : metric.change.startsWith("+") || metric.change === "New" ? " is-up" : ""}`}>
                    {metric.change}
                  </span>
                </div>
              ))}
            </div>
          </section>
          {couponAnalyticsError && (
            <p className="promotions-dashboard-analytics-error" role="alert">{couponAnalyticsError}</p>
          )}
        </div>
      );
    }

    return (
      <div className="promotions-kpi-grid">
        <section className="promotions-card promotions-quick-actions" aria-labelledby="promotions-quick-actions-title">
          <div className="promotions-dashboard-section-heading">
            <div>
              <span className="promotions-dashboard-eyebrow">GET STARTED</span>
              <h3 id="promotions-quick-actions-title">Quick actions</h3>
            </div>
            <span>Create or manage a promotion</span>
          </div>
          <div className="promotions-quick-action-list">
            {[
              ["Create coupon", "coupons"],
              ["Create contributor offer", "campaigns"],
              ["Create flash sale", "flash-sales"],
              ["Create bundle discount", "bundles"],
              ["Create newsletter", "newsletters"],
              ["Create banner", "banners"]
            ].map(([label, section]) => (
              <button
                type="button"
                className="promotions-quick-action"
                key={section}
                onClick={() => setActiveSection(section)}
              >
                <span>{label}</span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </section>
        <div className="promotions-card promotions-coupons-overview">
          <div className="promotions-card-label">Coupons</div>
          <div className="promotions-coupons-overview-grid">
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header">Coupon statuses</div>
              <div className="promotions-coupons-toggle-list">
                <div className="promotions-coupons-metric-row">
                  <span>Active</span>
                  <strong><AnimatedPromotionValue value={dashboard.active_campaigns || 0} /></strong>
                </div>
                <div className="promotions-coupons-metric-row">
                  <span>Scheduled</span>
                  <strong><AnimatedPromotionValue value={dashboard.scheduled_campaigns || 0} /></strong>
                </div>
                <div className="promotions-coupons-metric-row">
                  <span>Expired</span>
                  <strong><AnimatedPromotionValue value={dashboard.expired_campaigns || 0} /></strong>
                </div>
              </div>
            </div>
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Coupons used</span>
                <button type="button" className="promotions-export-button" aria-label="Export coupons used CSV" title="Export CSV" onClick={exportCouponUsage} disabled={rankedCoupons.length === 0}>
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                <div className="promotions-coupons-metric-row">
                  <span>Today</span>
                  <strong><AnimatedPromotionValue value={Number(couponAnalytics.today?.uses || 0).toLocaleString()} /></strong>
                </div>
                <div className="promotions-coupons-metric-row">
                  <span>Yesterday</span>
                  <strong><AnimatedPromotionValue value={Number(couponAnalytics.yesterday?.uses || 0).toLocaleString()} /></strong>
                </div>
                <div className="promotions-coupons-metric-row">
                  <span>Last 7 days</span>
                  <strong><AnimatedPromotionValue value={Number(couponAnalytics.last_7_days?.uses || 0).toLocaleString()} /></strong>
                </div>
                <div className="promotions-coupons-metric-row">
                  <span>Lifetime</span>
                  <strong><AnimatedPromotionValue value={Number(couponAnalytics.lifetime?.uses || 0).toLocaleString()} /></strong>
                </div>
                <div className="promotions-coupons-footer-row">
                  <select value={couponUsageRange} onChange={(event) => setCouponUsageRange(event.target.value)} aria-label="Coupon usage range selector">
                    {couponUsageRangeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <strong className="promotions-selected-range-value" aria-live="polite">
                    <AnimatedPromotionValue value={Number(selectedUsage.uses || 0).toLocaleString()} />
                  </strong>
                </div>
              </div>
            </div>
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Revenue generated</span>
                <div className="promotions-revenue-header-actions">
                  <select
                    className="promotions-currency-selector"
                    value={couponCurrency}
                    onChange={(event) => setCouponCurrency(event.target.value)}
                    aria-label="Coupon revenue currency selector"
                    disabled={couponCurrencies.length === 0}
                  >
                    {couponCurrencies.map((currency) => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                  <button type="button" className="promotions-export-button" aria-label="Export revenue generated CSV" title="Export CSV" onClick={exportCouponRevenue} disabled={rankedCoupons.length === 0}>
                    ⤓
                  </button>
                </div>
              </div>
              <div className="promotions-coupons-toggle-list">
                {revenuePeriods.map(([period, label]) => (
                  <div className="promotions-coupons-metric-row" key={period}>
                    <span>{label}</span>
                    <strong>
                      <AnimatedPromotionValue value={convertCouponRevenue(period) === null
                        ? "—"
                        : formatCouponCurrency(convertCouponRevenue(period), couponCurrency)} />
                    </strong>
                  </div>
                ))}
                <div className="promotions-coupons-footer-row">
                  <select value={couponRevenueRange} onChange={(event) => setCouponRevenueRange(event.target.value)} aria-label="Coupon revenue range selector">
                    {couponUsageRangeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <strong className="promotions-selected-range-value" aria-live="polite">
                    <AnimatedPromotionValue value={convertCouponRevenue(couponRevenueRange) === null
                      ? "—"
                      : formatCouponCurrency(convertCouponRevenue(couponRevenueRange), couponCurrency)} />
                  </strong>
                </div>
                {(couponAnalyticsError || (hasUnconvertibleCouponRevenue && "Some coupon revenue could not be converted because an exchange rate is unavailable.")) && (
                  <p className="promotions-currency-error" role="alert">
                    {couponAnalyticsError || "Some coupon revenue could not be converted because an exchange rate is unavailable."}
                  </p>
                )}
              </div>
            </div>
            <div className="promotions-coupons-panel promotions-coupons-top-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Top coupons</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label={`Export all ${rankedCoupons.length} coupons CSV`}
                  title="Export all coupons, including the top five"
                  onClick={exportAllCoupons}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-table-wrap">
                <table className="promotions-coupons-table" aria-label="Top coupons ranked by usage">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Coupon</th>
                      <th scope="col">Used</th>
                      <th scope="col">Revenue ({couponCurrency})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {featuredCoupons.map((coupon, index) => {
                      const revenue = convertRevenueByCurrency(coupon.revenue_by_currency || {});
                      return (
                        <tr key={coupon.id || coupon.code || coupon.name}>
                          <td><span className="promotions-coupon-rank">{index + 1}</span></td>
                          <td>
                            <span className="promotions-coupon-table-name">{coupon.name || "Unnamed coupon"}</span>
                            {coupon.code && <span className="promotions-coupon-table-code">{coupon.code}</span>}
                          </td>
                          <td><strong><AnimatedPromotionValue value={Number(coupon.uses || 0).toLocaleString()} /></strong></td>
                          <td>
                            <strong>
                              <AnimatedPromotionValue value={revenue === null ? "—" : formatCouponCurrency(revenue, couponCurrency)} />
                            </strong>
                          </td>
                        </tr>
                      );
                    })}
                    {featuredCoupons.length === 0 && (
                      <tr>
                        <td className="promotions-coupons-table-empty" colSpan="4">No coupons to rank yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="promotions-coupons-table-note">
                Showing the five most-used coupons. The CSV export includes all coupons.
              </p>
            </div>
          </div>
        </div>
        <div className="promotions-card promotions-coupons-overview promotions-contributor-overview">
          <div className="promotions-card-label">Contributor Offers</div>
          <div className="promotions-coupons-overview-grid">
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Offer statuses</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export contributor offer statuses CSV"
                  title="Export CSV"
                  onClick={() => exportContributorOffers(contributorOfferStats)}
                  disabled={contributorOfferStats.length === 0}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                {[
                  ["Active", "active"],
                  ["Scheduled", "scheduled"],
                  ["Ended", "ended"],
                  ["Draft", "draft"]
                ].map(([label, status]) => (
                  <div className="promotions-coupons-metric-row" key={status}>
                    <span>{label}</span>
                    <strong><AnimatedPromotionValue value={contributorOfferStatusCounts[status]} /></strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Applications</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export contributor applications CSV"
                  title="Export CSV"
                  onClick={exportContributorApplications}
                  disabled={contributorApplications.length === 0}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                {[
                  ["Today", "today"],
                  ["Yesterday", "yesterday"],
                  ["Last 7 days", "last_7_days"],
                  ["Lifetime", "lifetime"]
                ].map(([label, range]) => (
                  <div className="promotions-coupons-metric-row" key={range}>
                    <span>{label}</span>
                    <strong><AnimatedPromotionValue value={getApplicationCount(range).toLocaleString()} /></strong>
                  </div>
                ))}
                <div className="promotions-coupons-footer-row">
                  <select
                    value={contributorApplicationRange}
                    onChange={(event) => setContributorApplicationRange(event.target.value)}
                    aria-label="Contributor application range selector"
                  >
                    {couponUsageRangeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <strong className="promotions-selected-range-value" aria-live="polite">
                    <AnimatedPromotionValue value={selectedContributorApplications.length.toLocaleString()} />
                  </strong>
                </div>
              </div>
            </div>
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Benefits paid</span>
              <div className="promotions-revenue-header-actions">
                <select
                  className="promotions-currency-selector"
                  value={contributorBenefitsCurrency}
                  onChange={(event) => setContributorBenefitsCurrency(event.target.value)}
                  aria-label="Contributor benefits currency selector"
                  disabled={couponCurrencies.length === 0}
                >
                  {couponCurrencies.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export contributor benefits paid CSV"
                  title="Export CSV"
                  onClick={exportContributorBenefits}
                  disabled={selectedContributorBenefits.length === 0}
                >
                  ⤓
                </button>
              </div>
            </div>
              <div className="promotions-coupons-toggle-list">
                {[
                  ["Today", "today"],
                  ["Yesterday", "yesterday"],
                  ["Last 7 days", "last_7_days"],
                  ["Lifetime", "lifetime"]
                ].map(([label, range]) => (
                  <div className="promotions-coupons-metric-row" key={range}>
                    <span>{label}</span>
                    <strong>
                      <AnimatedPromotionValue value={formatBenefitsCurrency(getBenefitTotal(getApprovedBenefits(range)))} />
                    </strong>
                  </div>
                ))}
                <div className="promotions-coupons-footer-row">
                  <select
                    value={contributorBenefitsRange}
                    onChange={(event) => setContributorBenefitsRange(event.target.value)}
                    aria-label="Contributor benefits range selector"
                  >
                    {couponUsageRangeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <strong className="promotions-selected-range-value" aria-live="polite">
                    <AnimatedPromotionValue value={formatBenefitsCurrency(getBenefitTotal(selectedContributorBenefits))} />
                  </strong>
                </div>
              </div>
            </div>
            <div className="promotions-coupons-panel promotions-coupons-top-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Top contributor offers</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label={`Export all ${contributorOfferStats.length} contributor offers CSV`}
                  title="Export all contributor offers, including the top five"
                  onClick={() => exportContributorOffers(contributorOfferStats)}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-table-wrap">
                <table className="promotions-coupons-table" aria-label="Top contributor offers ranked by applications">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Offer</th>
                      <th scope="col">Applications</th>
                      <th scope="col">Benefits paid (INR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {featuredContributorOffers.map((offer, index) => (
                      <tr key={offer.id}>
                        <td><span className="promotions-coupon-rank">{index + 1}</span></td>
                        <td><span className="promotions-coupon-table-name">{offer.name || "Unnamed offer"}</span></td>
                        <td><strong><AnimatedPromotionValue value={offer.applicationCount.toLocaleString()} /></strong></td>
                        <td><strong><AnimatedPromotionValue value={formatCouponCurrency(offer.benefitsPaid, "INR")} /></strong></td>
                      </tr>
                    ))}
                    {featuredContributorOffers.length === 0 && (
                      <tr>
                        <td className="promotions-coupons-table-empty" colSpan="4">No contributor offers to rank yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="promotions-coupons-table-note">
                Ranked by application count. {remainingContributorOffers.length} remaining offers are available in the CSV export.
              </p>
            </div>
          </div>
        </div>
        <div className="promotions-card promotions-coupons-overview promotions-flash-overview">
          <div className="promotions-card-label">Flash Sales</div>
          <div className="promotions-coupons-overview-grid">
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Flash sale statuses</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export flash sale statuses CSV"
                  title="Export flash sale statuses CSV"
                  onClick={exportFlashSaleStatuses}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                {[
                  ["Active", "active"],
                  ["Scheduled", "scheduled"],
                  ["Expired", "expired"]
                ].map(([label, status]) => (
                  <div className="promotions-coupons-metric-row" key={status}>
                    <span>{label}</span>
                    <strong><AnimatedPromotionValue value={flashSaleStatusCounts[status]} /></strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Discount rules</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export flash sale discount rules CSV"
                  title="Export flash sale discount rules CSV"
                  onClick={exportFlashSaleDiscountRules}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                {[
                  ...FLASH_SALE_DISCOUNT_RULES.map((rule) => [
                    rule.label,
                    flashSaleDiscountCounts[rule.label] || 0
                  ]),
                  ...Object.entries(flashSaleDiscountCounts).filter(([label]) => (
                    !FLASH_SALE_DISCOUNT_RULES.some((rule) => rule.label === label)
                  ))
                ].map(([label, count]) => (
                  <div className="promotions-coupons-metric-row" key={label}>
                    <span>{label}</span>
                    <strong><AnimatedPromotionValue value={count} /></strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Featured placements</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export flash sale placements CSV"
                  title="Export flash sale placements CSV"
                  onClick={exportFlashSalePlacements}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                {Object.entries(flashSalePlacementCounts).map(([label, count]) => (
                  <div className="promotions-coupons-metric-row" key={label}>
                    <span>{label}</span>
                    <strong><AnimatedPromotionValue value={count} /></strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="promotions-coupons-panel promotions-coupons-top-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Flash sales</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label={`Export all ${flashEventRecords.length} flash sales CSV`}
                  title="Export all flash sale configurations CSV"
                  onClick={exportAllFlashSales}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-table-wrap">
                <table className="promotions-coupons-table" aria-label="Flash sales ordered by usage">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Flash sale</th>
                      <th scope="col">Applications</th>
                      <th scope="col">Users used</th>
                      <th scope="col">Assets downloaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {featuredFlashSales.map(({ sale }, index) => (
                      <tr key={sale.id}>
                        <td><span className="promotions-coupon-rank">{index + 1}</span></td>
                        <td><span className="promotions-coupon-table-name">{sale.name || "Flash Sale"}</span></td>
                        <td><strong><AnimatedPromotionValue value={Number(sale.applications || 0).toLocaleString()} /></strong></td>
                        <td><strong><AnimatedPromotionValue value={Number(sale.users_used || 0).toLocaleString()} /></strong></td>
                        <td><strong><AnimatedPromotionValue value={Number(sale.assets_downloaded || 0).toLocaleString()} /></strong></td>
                      </tr>
                    ))}
                    {featuredFlashSales.length === 0 && (
                      <tr>
                        <td className="promotions-coupons-table-empty" colSpan="5">No flash sales to show yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="promotions-coupons-table-note">
                Ranked by users who used each sale, then assets downloaded. Usage tracking starts with orders placed after this update; older orders are not attributed.
              </p>
            </div>
          </div>
        </div>
        <div className="promotions-card promotions-coupons-overview promotions-bundle-overview">
          <div className="promotions-card-label">Bundle Discounts</div>
          <div className="promotions-coupons-overview-grid">
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Bundle statuses</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export bundle discount statuses CSV"
                  title="Export bundle discount statuses CSV"
                  onClick={exportBundleStatuses}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                {[
                  ["Active", "active"],
                  ["Scheduled", "scheduled"],
                  ["Expired", "expired"],
                  ["Draft", "draft"]
                ].map(([label, status]) => (
                  <div className="promotions-coupons-metric-row" key={status}>
                    <span>{label}</span>
                    <strong><AnimatedPromotionValue value={bundleStatusCounts[status]} /></strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Discount tiers</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export bundle discount tiers CSV"
                  title="Export bundle discount tiers CSV"
                  onClick={exportBundleTiers}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                {Object.entries(bundleTierCounts).map(([label, count]) => (
                  <div className="promotions-coupons-metric-row" key={label}>
                    <span>{label}</span>
                    <strong><AnimatedPromotionValue value={count} /></strong>
                  </div>
                ))}
                {Object.keys(bundleTierCounts).length === 0 && (
                  <div className="promotions-coupons-metric-row">
                    <span>No discount tiers</span>
                    <strong>0</strong>
                  </div>
                )}
              </div>
            </div>
            <div className="promotions-coupons-panel promotions-coupons-top-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Top bundle discounts</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label={`Export all ${bundleEventRecords.length} bundle discounts CSV`}
                  title="Export all bundle discount configurations CSV"
                  onClick={exportAllBundles}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-table-wrap">
                <table className="promotions-coupons-table" aria-label="Bundle discounts ordered by usage">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Bundle discount</th>
                      <th scope="col">Applications</th>
                      <th scope="col">Users used</th>
                      <th scope="col">Assets downloaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {featuredBundles.map(({ bundle }, index) => (
                      <tr key={bundle.id}>
                        <td><span className="promotions-coupon-rank">{index + 1}</span></td>
                        <td><span className="promotions-coupon-table-name">{bundle.name || "Unnamed bundle"}</span></td>
                        <td><strong><AnimatedPromotionValue value={Number(bundle.applications || 0).toLocaleString()} /></strong></td>
                        <td><strong><AnimatedPromotionValue value={Number(bundle.users_used || 0).toLocaleString()} /></strong></td>
                        <td><strong><AnimatedPromotionValue value={Number(bundle.assets_downloaded || 0).toLocaleString()} /></strong></td>
                      </tr>
                    ))}
                    {featuredBundles.length === 0 && (
                      <tr>
                        <td className="promotions-coupons-table-empty" colSpan="5">No bundle discounts to show yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="promotions-coupons-table-note">
                Ranked by users who used each bundle, then assets downloaded. Usage tracking starts with orders placed after this update; older orders are not attributed.
              </p>
            </div>
          </div>
        </div>
        <div className="promotions-card promotions-coupons-overview promotions-newsletter-overview">
          <div className="promotions-card-label">Newsletter Campaigns</div>
          <div className="promotions-coupons-overview-grid">
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Campaign statuses</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export newsletter campaign statuses CSV"
                  title="Export newsletter campaign statuses CSV"
                  onClick={exportNewsletterStatuses}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                {[
                  ["Draft", "draft"],
                  ["Scheduled", "scheduled"],
                  ["Sending", "sending"],
                  ["Sent", "sent"],
                  ["Failed", "failed"]
                ].map(([label, status]) => (
                  <div className="promotions-coupons-metric-row" key={status}>
                    <span>{label}</span>
                    <strong><AnimatedPromotionValue value={newsletterStatusCounts[status] || 0} /></strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Recipients by audience</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export newsletter campaign audiences CSV"
                  title="Export newsletter campaign audiences CSV"
                  onClick={exportNewsletterAudiences}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                {newsletterAudienceRows.map(([audience, totals]) => (
                  <div className="promotions-coupons-metric-row" key={audience}>
                    <span>{audience}</span>
                    <strong><AnimatedPromotionValue value={totals.recipients.toLocaleString()} /></strong>
                  </div>
                ))}
                {newsletterAudienceRows.length === 0 && (
                  <div className="promotions-coupons-metric-row">
                    <span>No campaign recipients</span>
                    <strong>0</strong>
                  </div>
                )}
              </div>
              <div className="promotions-coupons-toggle-list">
                {[
                  ["Campaigns", newsletters.length],
                  ["Queued", newsletterDeliveryTotals.queued],
                  ["Opened", newsletterDeliveryTotals.opened],
                  ["Clicked", newsletterDeliveryTotals.clicked]
                ].map(([label, value]) => (
                  <div className="promotions-coupons-metric-row" key={label}>
                    <span>{label}</span>
                    <strong><AnimatedPromotionValue value={Number(value).toLocaleString()} /></strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="promotions-coupons-panel promotions-coupons-top-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Top newsletter campaigns</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label={`Export all ${newsletters.length} newsletter campaigns CSV`}
                  title="Export campaign details and recipient records"
                  onClick={exportAllNewsletters}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-table-wrap">
                <table className="promotions-coupons-table" aria-label="Newsletter campaigns ranked by recipients">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Campaign</th>
                      <th scope="col">Status</th>
                      <th scope="col">Recipients</th>
                      <th scope="col">Queued</th>
                      <th scope="col">Opened</th>
                      <th scope="col">Clicked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {featuredNewsletters.map((campaign, index) => (
                      <tr key={campaign.id}>
                        <td><span className="promotions-coupon-rank">{index + 1}</span></td>
                        <td>
                          <span className="promotions-coupon-table-name">{campaign.name || "Untitled newsletter"}</span>
                          {campaign.subject && <span className="promotions-coupon-table-code">{campaign.subject}</span>}
                        </td>
                        <td>{getNewsletterDisplayStatus(campaign)}</td>
                        <td><strong><AnimatedPromotionValue value={getNewsletterRecipientCount(campaign).toLocaleString()} /></strong></td>
                        <td><strong><AnimatedPromotionValue value={Number(campaign.queued_recipients || 0).toLocaleString()} /></strong></td>
                        <td><strong><AnimatedPromotionValue value={Number(campaign.opened_recipients || 0).toLocaleString()} /></strong></td>
                        <td><strong><AnimatedPromotionValue value={Number(campaign.clicked_recipients || 0).toLocaleString()} /></strong></td>
                      </tr>
                    ))}
                    {featuredNewsletters.length === 0 && (
                      <tr>
                        <td className="promotions-coupons-table-empty" colSpan="7">No newsletter campaigns to show yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="promotions-coupons-table-note">
                Ranked by recipient count. Campaign exports include campaign settings and available per-recipient queue, open, and click records.
              </p>
            </div>
          </div>
        </div>
        <div className="promotions-card promotions-coupons-overview promotions-banner-overview">
          <div className="promotions-card-label">Promotional Banners</div>
          <div className="promotions-coupons-overview-grid">
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Banner statuses</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export promotional banner statuses CSV"
                  title="Export promotional banner statuses CSV"
                  onClick={exportBannerStatuses}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                {[
                  ["Active", "active"],
                  ["Scheduled", "scheduled"],
                  ["Expired", "expired"],
                  ["Draft", "draft"]
                ].map(([label, status]) => (
                  <div className="promotions-coupons-metric-row" key={status}>
                    <span>{label}</span>
                    <strong><AnimatedPromotionValue value={bannerStatusCounts[status]} /></strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Placements</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export promotional banner placements CSV"
                  title="Export promotional banner placements CSV"
                  onClick={exportBannerPlacements}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                {Object.entries(bannerPlacementCounts)
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([placement, count]) => (
                    <div className="promotions-coupons-metric-row" key={placement}>
                      <span>{bannerPlacementLabels[placement] || placement}</span>
                      <strong><AnimatedPromotionValue value={count} /></strong>
                    </div>
                  ))}
                {Object.keys(bannerPlacementCounts).length === 0 && (
                  <div className="promotions-coupons-metric-row">
                    <span>No placements</span>
                    <strong>0</strong>
                  </div>
                )}
              </div>
            </div>
            <div className="promotions-coupons-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Popup audiences</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label="Export promotional banner popup audiences CSV"
                  title="Export promotional banner popup audiences CSV"
                  onClick={exportBannerPopupAudiences}
                  disabled={Object.keys(bannerPopupAudienceCounts).length === 0}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-toggle-list">
                {Object.entries(bannerPopupAudienceCounts)
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([audience, count]) => (
                    <div className="promotions-coupons-metric-row" key={audience}>
                      <span>{audience.replace(/_/g, " ")}</span>
                      <strong><AnimatedPromotionValue value={count} /></strong>
                    </div>
                  ))}
                {Object.keys(bannerPopupAudienceCounts).length === 0 && (
                  <div className="promotions-coupons-metric-row">
                    <span>No popup banners</span>
                    <strong>0</strong>
                  </div>
                )}
              </div>
            </div>
            <div className="promotions-coupons-panel promotions-coupons-top-panel">
              <div className="promotions-mini-header promotions-card-header-with-action">
                <span>Recent banners</span>
                <button
                  type="button"
                  className="promotions-export-button"
                  aria-label={`Export all ${bannerEventRecords.length} promotional banners CSV`}
                  title="Export all banner settings and metadata"
                  onClick={exportAllBanners}
                >
                  ⤓
                </button>
              </div>
              <div className="promotions-coupons-table-wrap">
                <table className="promotions-coupons-table" aria-label="Recent promotional banners">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Banner</th>
                      <th scope="col">Status</th>
                      <th scope="col">Placement</th>
                      <th scope="col">Linked assets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {featuredBanners.map(({ banner, status, placement, selectedAssetIds }, index) => (
                      <tr key={banner.id}>
                        <td><span className="promotions-coupon-rank">{index + 1}</span></td>
                        <td><span className="promotions-coupon-table-name">{banner.name || "Unnamed banner"}</span></td>
                        <td>{status}</td>
                        <td>{bannerPlacementLabels[placement] || placement}</td>
                        <td><strong><AnimatedPromotionValue value={selectedAssetIds.length.toLocaleString()} /></strong></td>
                      </tr>
                    ))}
                    {featuredBanners.length === 0 && (
                      <tr>
                        <td className="promotions-coupons-table-empty" colSpan="5">No promotional banners to show yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="promotions-coupons-table-note">
                Shows banner configuration, dates, placement, popup audience, visual style, icon, and linked live assets. Impression and click analytics are not available for banners.
              </p>
            </div>
          </div>
        </div>
        <section className="promotions-dashboard-insights" aria-label="Promotion insights">
          <div className="promotions-card promotions-insight-card">
            <div className="promotions-dashboard-section-heading">
              <div>
                <span className="promotions-dashboard-eyebrow">PERFORMANCE</span>
                <h3>Top-performing promotions</h3>
              </div>
            </div>
            <div className="promotions-top-performer-list">
              {topPromotionHighlights.map((promotion) => (
                <button
                  type="button"
                  className="promotions-top-performer"
                  key={promotion.category}
                  onClick={() => setActiveSection(promotion.section)}
                >
                  <span className="promotions-top-performer-copy">
                    <span>{promotion.category}</span>
                    <strong>{promotion.name}</strong>
                  </span>
                  <span className="promotions-top-performer-value">
                    <strong>{promotion.value.toLocaleString()}</strong>
                    <span>{promotion.metric}</span>
                  </span>
                </button>
              ))}
              {topPromotionHighlights.length === 0 && (
                <p className="promotions-dashboard-empty">Performance data will appear when promotion activity is recorded.</p>
              )}
            </div>
          </div>
          <div className="promotions-card promotions-insight-card">
            <div className="promotions-dashboard-section-heading">
              <div>
                <span className="promotions-dashboard-eyebrow">NEEDS ATTENTION</span>
                <h3>Promotion alerts</h3>
              </div>
              <span>{promotionAlerts.length} alert{promotionAlerts.length === 1 ? "" : "s"}</span>
            </div>
            <div className="promotions-alert-list">
              {promotionAlerts.map((alert, index) => (
                <button
                  type="button"
                  className={`promotions-alert-item is-${alert.type}`}
                  key={`${alert.section}-${alert.title}-${index}`}
                  onClick={() => setActiveSection(alert.section)}
                >
                  <span className="promotions-alert-indicator" aria-hidden="true" />
                  <span>{alert.title}</span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
              {promotionAlerts.length === 0 && (
                <p className="promotions-dashboard-empty">No upcoming starts or expirations need attention.</p>
              )}
            </div>
          </div>
          <div className="promotions-card promotions-insight-card promotions-upcoming-card">
            <div className="promotions-dashboard-section-heading">
              <div>
                <span className="promotions-dashboard-eyebrow">NEXT 30 DAYS</span>
                <h3>Upcoming promotions</h3>
              </div>
              <span>{upcomingPromotions.length} shown</span>
            </div>
            <div className="promotions-upcoming-list">
              {upcomingPromotions.map((promotion) => (
                <button
                  type="button"
                  className="promotions-upcoming-item"
                  key={`${promotion.section}-${promotion.name}-${promotion.dateType}-${promotion.date}`}
                  onClick={() => setActiveSection(promotion.section)}
                >
                  <span className="promotions-upcoming-date">
                    <strong>{promotion.daysUntil === 0 ? "Today" : `${promotion.daysUntil}d`}</strong>
                    <span>{promotion.date}</span>
                  </span>
                  <span className="promotions-upcoming-copy">
                    <strong>{promotion.name}</strong>
                    <span>{promotion.category} · {promotion.dateType === "start" ? "Starts" : "Expires"}</span>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
              {upcomingPromotions.length === 0 && (
                <p className="promotions-dashboard-empty">No scheduled starts in the next 30 days or active promotions expiring in the next 7 days.</p>
              )}
            </div>
          </div>
          <div className="promotions-card promotions-insight-card promotions-coupon-trend-card">
            <div className="promotions-dashboard-section-heading">
              <div>
                <span className="promotions-dashboard-eyebrow">LAST 30 DAYS</span>
                <h3>Coupon activity</h3>
              </div>
              <div className="promotions-trend-toggle" role="group" aria-label="Coupon chart metric">
                <button
                  type="button"
                  aria-pressed={couponTrendMetric === "uses"}
                  onClick={() => setCouponTrendMetric("uses")}
                >
                  Uses
                </button>
                <button
                  type="button"
                  aria-pressed={couponTrendMetric === "revenue"}
                  onClick={() => setCouponTrendMetric("revenue")}
                >
                  Revenue
                </button>
              </div>
            </div>
            <div
              className="promotions-coupon-trend-chart"
              role="img"
              aria-label={`Daily coupon ${couponTrendMetric === "uses" ? "redemptions" : `revenue in ${couponCurrency}`} for the last 30 days`}
            >
              {couponTrendData.map(({ date, label, value }, index) => (
                <span
                  className="promotions-coupon-trend-bar"
                  key={date}
                  title={`${date}: ${couponTrendMetric === "uses" ? `${value} uses` : formatCouponCurrency(value, couponCurrency)}`}
                  style={{ height: `${value > 0 ? Math.max(4, (value / couponTrendMaximum) * 100) : 2}%` }}
                >
                  {index % 7 === 0 || index === couponTrendData.length - 1
                    ? <span className="promotions-coupon-trend-tick">{label}</span>
                    : null}
                </span>
              ))}
            </div>
            <p className="promotions-trend-caption" role={couponAnalyticsError ? "alert" : undefined}>
              {couponAnalyticsError || (couponDailySeries.length === 0
                ? "No coupon redemptions are recorded in the last 30 days."
                : "Daily totals are based on recorded coupon redemptions.")}
            </p>
            <div className="promotions-period-comparison">
              <div className="promotions-period-comparison-heading">
                <strong>Last 30 days</strong>
                <span>vs previous 30 days</span>
              </div>
              {periodComparison.map((metric) => (
                <div className="promotions-period-comparison-row" key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.current}</strong>
                  <span className={`promotions-period-change${metric.change.startsWith("-") ? " is-down" : metric.change.startsWith("+") || metric.change === "New" ? " is-up" : ""}`}>
                    {metric.change}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
        {cards.map((card) => (
          <div key={card.label} className="promotions-card" data-accent={card.accent ? "revenue" : undefined}>
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
                <p>Manage offers, campaigns, and customer engagement from one place.</p>
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
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>{editingNewsletterId === null ? "Newsletter Campaign" : "Edit Newsletter Campaign"}</h3>
                <span>Send now, save as a draft, or schedule delivery. Scheduled times use IST.</span>
              </div>
              <form
                id="newsletter-campaign-form"
                className="promotions-form-grid promotions-newsletter-form"
                onSubmit={handleNewsletterSubmit}
              >
                <div className="promotions-field-group">
                  <label htmlFor="newsletter-campaign-name">Campaign name</label>
                  <input
                    id="newsletter-campaign-name"
                    value={newsletterDraft.name}
                    onChange={(event) => setNewsletterDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="newsletter-subject">Subject</label>
                  <input
                    id="newsletter-subject"
                    value={newsletterDraft.subject}
                    onChange={(event) => setNewsletterDraft((current) => ({ ...current, subject: event.target.value }))}
                  />
                </div>
                <div className="promotions-field-group promotions-newsletter-email-field">
                  <label htmlFor="newsletter-recipients">Emails</label>
                  <textarea
                    id="newsletter-recipients"
                    className="promotions-newsletter-recipients"
                    value={newsletterRecipientsText}
                    onChange={(event) => {
                      setNewsletterRecipientsText(event.target.value);
                      setNewsletterRecipientInputError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Tab" || !newsletterRecipientsText.trim()) return;
                      const parsedRecipients = parseNewsletterRecipientEmails(newsletterRecipientsText);
                      if (parsedRecipients.invalid.length > 0) {
                        event.preventDefault();
                        setNewsletterRecipientInputError(
                          `Please correct these email address(es) before continuing: ${parsedRecipients.invalid.join(", ")}`
                        );
                        return;
                      }
                      setNewsletterRecipientsText(parsedRecipients.emails.join(", "));
                      setNewsletterRecipientInputError("");
                    }}
                    placeholder="Select recipients or enter email addresses separated by commas"
                    aria-describedby="newsletter-recipient-help"
                  />
                  <span id="newsletter-recipient-help" className="promotions-muted">
                    Separate addresses with commas, spaces, or new lines. Press Tab to validate and organize the full list.
                  </span>
                  {newsletterRecipientInputError && (
                    <p className="promotions-newsletter-error" role="alert">{newsletterRecipientInputError}</p>
                  )}
                  <div className="promotions-inline-actions">
                    <button
                      type="button"
                      onClick={() => setIsNewsletterAudienceDialogOpen(true)}
                      aria-haspopup="dialog"
                    >
                      Search emails
                    </button>
                  </div>
                  {isNewsletterRecipientPickerOpen && (
                    <div className="promotions-newsletter-picker">
                      <div className="promotions-newsletter-search">
                        <input
                          aria-label="Search newsletter recipients"
                          value={newsletterRecipientSearch}
                          onChange={(event) => setNewsletterRecipientSearch(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              searchNewsletterRecipients();
                            }
                          }}
                          placeholder="Search by name or email"
                        />
                        <button
                          type="button"
                          onClick={searchNewsletterRecipients}
                          disabled={isSearchingNewsletterRecipients}
                        >
                          {isSearchingNewsletterRecipients ? "Searching..." : "Search"}
                        </button>
                      </div>
                      {(isSearchingNewsletterRecipients || newsletterRecipientSearchComplete) && (
                        <div className="promotions-newsletter-search-progress" role="status">
                          <span>
                            {isSearchingNewsletterRecipients
                              ? "Searching eligible recipients…"
                              : `Search complete — ${newsletterRecipientResults.length} recipient${newsletterRecipientResults.length === 1 ? "" : "s"} loaded.`}
                          </span>
                          <progress
                            aria-label={isSearchingNewsletterRecipients
                              ? "Searching newsletter recipients"
                              : "Newsletter recipient search complete"}
                            max="100"
                            {...(!isSearchingNewsletterRecipients ? { value: 100 } : {})}
                          />
                        </div>
                      )}
                      {newsletterRecipientSearchError && (
                        <p className="promotions-newsletter-error" role="alert">{newsletterRecipientSearchError}</p>
                      )}
                      <div className="promotions-newsletter-results">
                        {newsletterRecipientResults.length === 0
                          ? <p className="promotions-muted">
                            {newsletterRecipientSearchComplete
                              ? newsletterDraft.audience === "customer_active"
                                ? "No customers with a recorded login in the past 30 days matched this search."
                                : newsletterDraft.audience === "contributor_active"
                                  ? "No contributors with a recorded login in the past 30 days matched this search."
                                  : "No recipients matched this search."
                              : "Search to find eligible customers and contributors."}
                          </p>
                          : newsletterRecipientResults.map((recipient) => {
                            const isSelected = newsletterSelectedRecipients.some(
                              (selected) => String(selected.id) === String(recipient.id)
                            );
                            return (
                              <label className="promotions-newsletter-recipient" key={recipient.id}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(event) => setNewsletterSelectedRecipients((selected) => (
                                    event.target.checked
                                      ? [...selected, recipient]
                                      : selected.filter((item) => String(item.id) !== String(recipient.id))
                                  ))}
                                />
                                <span>
                                  <strong>{recipient.full_name || recipient.username || recipient.email}</strong>
                                  <span>{recipient.email} · {recipient.role}</span>
                                </span>
                              </label>
                            );
                          })}
                      </div>
                      <div className="promotions-inline-actions">
                        <button
                          type="button"
                          onClick={() => setNewsletterSelectedRecipients((selected) => {
                            const selectedIds = new Set(selected.map((recipient) => String(recipient.id)));
                            return [
                              ...selected,
                              ...newsletterRecipientResults.filter((recipient) => !selectedIds.has(String(recipient.id)))
                            ];
                          })}
                          disabled={newsletterRecipientResults.length === 0}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewsletterSelectedRecipients([])}
                          disabled={newsletterSelectedRecipients.length === 0}
                        >
                          Clear selected
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const selectedEmails = newsletterSelectedRecipients.map((recipient) => recipient.email);
                            const currentEmails = newsletterRecipientsText.split(/[,\s;]+/).map((email) => email.trim()).filter(Boolean);
                            const mergedEmails = [...new Set([...currentEmails, ...selectedEmails])];
                            setNewsletterRecipientsText(mergedEmails.join(", "));
                            setIsNewsletterRecipientPickerOpen(false);
                          }}
                        >
                          Add selected emails ({newsletterSelectedRecipients.length})
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="promotions-field-group promotions-newsletter-body-field">
                  <span id="newsletter-body-label">Message body</span>
                  <div className="promotions-newsletter-toolbar" role="toolbar" aria-label="Message formatting">
                    <label className="promotions-newsletter-toolbar-select">
                      <span className="promotions-visually-hidden">Font family</span>
                      <select
                        aria-label="Font family"
                        defaultValue="Arial"
                        onMouseDown={saveNewsletterBodySelection}
                        onChange={(event) => applyNewsletterFormatting("fontName", event.target.value)}
                      >
                        <option value="Arial">Arial</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Verdana">Verdana</option>
                        <option value="Trebuchet MS">Trebuchet MS</option>
                      </select>
                    </label>
                    <label className="promotions-newsletter-toolbar-select">
                      <span className="promotions-visually-hidden">Font size</span>
                      <select
                        aria-label="Font size"
                        defaultValue="3"
                        onMouseDown={saveNewsletterBodySelection}
                        onChange={(event) => applyNewsletterFormatting("fontSize", event.target.value)}
                      >
                        <option value="2">Small</option>
                        <option value="3">Normal</option>
                        <option value="4">Large</option>
                        <option value="5">X-Large</option>
                        <option value="6">XX-Large</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      aria-label="Bold"
                      title="Bold"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyNewsletterFormatting("bold")}
                    ><strong>B</strong></button>
                    <button
                      type="button"
                      aria-label="Italic"
                      title="Italic"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyNewsletterFormatting("italic")}
                    ><em>I</em></button>
                    <button
                      type="button"
                      aria-label="Underline"
                      title="Underline"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyNewsletterFormatting("underline")}
                    ><span className="promotions-newsletter-underline">U</span></button>
                    <button
                      type="button"
                      aria-label="Insert link"
                      title="Convert selected text to a link"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        saveNewsletterBodySelection();
                        setIsNewsletterLinkEditorOpen((isOpen) => !isOpen);
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7M14 10.5a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.2l1.7-1.7" />
                      </svg>
                    </button>
                    <label className="promotions-newsletter-color">
                      <span>Text color</span>
                      <input
                        type="color"
                        aria-label="Text color"
                        defaultValue="#202124"
                        onMouseDown={saveNewsletterBodySelection}
                        onChange={(event) => applyNewsletterFormatting("foreColor", event.target.value)}
                      />
                    </label>
                  </div>
                  {isNewsletterLinkEditorOpen && (
                    <div className="promotions-newsletter-link-editor">
                      <label htmlFor="newsletter-link-url">Link URL</label>
                      <input
                        id="newsletter-link-url"
                        type="text"
                        inputMode="url"
                        autoComplete="url"
                        placeholder="https://example.com"
                        value={newsletterLinkUrl}
                        onChange={(event) => setNewsletterLinkUrl(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            applyNewsletterLink();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={applyNewsletterLink}
                      >
                        Apply link
                      </button>
                      <button
                        type="button"
                        className="promotions-newsletter-link-cancel"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setNewsletterLinkUrl("");
                          setIsNewsletterLinkEditorOpen(false);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <div
                    id="newsletter-body"
                    ref={newsletterBodyEditorRef}
                    className="promotions-newsletter-body"
                    role="textbox"
                    aria-label="Message body"
                    aria-labelledby="newsletter-body-label"
                    aria-multiline="true"
                    contentEditable="true"
                    suppressContentEditableWarning
                    data-placeholder="Write the newsletter message"
                    onInput={handleNewsletterBodyInput}
                    onKeyUp={saveNewsletterBodySelection}
                    onMouseUp={saveNewsletterBodySelection}
                    onPointerUp={saveNewsletterBodySelection}
                    onBlur={saveNewsletterBodySelection}
                    onPointerDown={trackNewsletterLinkPointerDown}
                    onPointerMove={trackNewsletterLinkPointerMove}
                    onMouseDown={trackNewsletterLinkPointerDown}
                    onMouseMove={trackNewsletterLinkPointerMove}
                    onClick={preventNewsletterLinkNavigation}
                  />
                  <div className="promotions-newsletter-attachment-controls">
                    <div className="promotions-newsletter-upload-card">
                      <span className="promotions-newsletter-upload-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" />
                        </svg>
                      </span>
                      <span className="promotions-newsletter-upload-copy">
                        <strong>Attach files</strong>
                        <span>Drop files here or <span className="promotions-newsletter-browse">browse files</span></span>
                      </span>
                      <span className="promotions-newsletter-upload-limit">PDF, images, documents</span>
                      <label className="promotions-visually-hidden" htmlFor="newsletter-attachments">
                        Attach files
                      </label>
                      <input
                        id="newsletter-attachments"
                        type="file"
                        multiple
                        disabled={isUploadingNewsletterAttachments || newsletterAttachments.length >= 5}
                        onChange={uploadNewsletterAttachments}
                      />
                    </div>
                    <span className="promotions-newsletter-upload-help">
                      Up to 5 files · 10 MB each · 20 MB total
                    </span>
                  </div>
                  {isUploadingNewsletterAttachments && (
                    <p className="promotions-muted" role="status">Uploading newsletter attachments…</p>
                  )}
                  {newsletterAttachmentError && (
                    <p className="promotions-newsletter-error" role="alert">{newsletterAttachmentError}</p>
                  )}
                  {newsletterAttachments.length > 0 && (
                    <ul className="promotions-newsletter-attachment-list" aria-label="Newsletter attachments">
                      {newsletterAttachments.map((attachment) => (
                        <li key={attachment.filename}>
                          <span>{attachment.name}</span>
                          <button
                            type="button"
                            aria-label={`Remove ${attachment.name}`}
                            onClick={() => removeNewsletterAttachment(attachment)}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="promotions-field-group">
                  <label htmlFor="newsletter-status">Status</label>
                  <select
                    id="newsletter-status"
                    value={newsletterDraft.status}
                    onChange={(event) => setNewsletterDraft((current) => ({ ...current, status: event.target.value }))}
                  >
                    <option value="send">Send</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="draft">Draft</option>
                    {["sent", "sending"].includes(newsletterDraft.status) && (
                      <option value={newsletterDraft.status}>
                        {newsletterDraft.status === "sent" ? "Sent" : "Sending"}
                      </option>
                    )}
                  </select>
                </div>
                {newsletterDraft.status === "scheduled" && (
                  <div className="promotions-field-group">
                    <label htmlFor="newsletter-schedule">Schedule (IST)</label>
                    <input
                      id="newsletter-schedule"
                      type="datetime-local"
                      min={getISTDateTimeLocal()}
                      value={newsletterDraft.schedule}
                      onChange={(event) => setNewsletterDraft((current) => ({ ...current, schedule: event.target.value }))}
                      required
                    />
                  </div>
                )}
                <div className="promotions-inline-actions promotions-newsletter-actions">
                  <button type="submit" disabled={isSavingNewsletter || isUploadingNewsletterAttachments}>
                    {isSavingNewsletter
                      ? "Saving..."
                      : editingNewsletterId !== null
                        ? newsletterDraft.status === "send"
                          ? "Send Newsletter Changes"
                          : newsletterDraft.status === "scheduled"
                            ? "Schedule Newsletter Changes"
                            : "Save Newsletter Changes"
                        : newsletterDraft.status === "send"
                        ? "Send Newsletter Campaigns"
                        : newsletterDraft.status === "scheduled"
                          ? "Schedule Newsletter Campaigns"
                          : "Draft Newsletter Campaigns"}
                  </button>
                  {editingNewsletterId !== null && (
                    <button
                      type="button"
                      className="promotions-newsletter-cancel-edit"
                      onClick={cancelNewsletterEdit}
                      disabled={isSavingNewsletter}
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
              </form>
            </div>
            {isNewsletterAudienceDialogOpen && (
              <div
                className="promotions-modal-backdrop"
                onClick={(event) => {
                  if (event.target === event.currentTarget) setIsNewsletterAudienceDialogOpen(false);
                }}
              >
                <section
                  className="promotions-modal promotions-newsletter-audience-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="newsletter-audience-dialog-title"
                >
                  <div className="promotions-newsletter-dialog-heading">
                    <span className="promotions-newsletter-dialog-mark" aria-hidden="true">@</span>
                    <div>
                      <span className="promotions-newsletter-dialog-eyebrow">NEWSLETTER RECIPIENTS</span>
                      <h3 id="newsletter-audience-dialog-title">Choose your audience</h3>
                      <p>Select who should appear in the recipient search.</p>
                    </div>
                  </div>
                  <div className="promotions-field-group">
                    <label htmlFor="newsletter-audience">Audience</label>
                    <select
                      id="newsletter-audience"
                      value={newsletterDraft.audience}
                      onChange={(event) => {
                        setNewsletterDraft((current) => ({ ...current, audience: event.target.value }));
                        setNewsletterRecipientResults([]);
                        setNewsletterSelectedRecipients([]);
                        setNewsletterRecipientSearchError("");
                        setNewsletterRecipientSearchComplete(false);
                      }}
                    >
                      {NEWSLETTER_AUDIENCES.map((audience) => (
                        <option key={audience.value} value={audience.value}>{audience.label}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="promotions-newsletter-audience-submit"
                    onClick={() => {
                      setNewsletterRecipientResults([]);
                      setNewsletterSelectedRecipients([]);
                      setNewsletterRecipientSearchError("");
                      setNewsletterRecipientSearchComplete(false);
                      setIsNewsletterAudienceDialogOpen(false);
                      setIsNewsletterRecipientPickerOpen(true);
                    }}
                  >
                    <span>Search recipients</span>
                    <span aria-hidden="true">→</span>
                  </button>
                </section>
              </div>
            )}
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Existing Entries</h3>
                <label className="promotions-newsletter-filter">
                  <span className="promotions-visually-hidden">Filter newsletter campaigns</span>
                  <select
                    aria-label="Filter newsletter campaigns"
                    value={newsletterStatusFilter}
                    onChange={(event) => setNewsletterStatusFilter(event.target.value)}
                  >
                    <option value="all">All campaigns</option>
                    <option value="sent">Sent</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="draft">Draft</option>
                  </select>
                  <span className="promotions-newsletter-filter-chevron" aria-hidden="true">⌄</span>
                </label>
              </div>
              <div className="promotions-list">
                {filteredNewsletters.length === 0
                  ? <p>No newsletter campaigns for this status.</p>
                  : filteredNewsletters.map((campaign) => (
                    <div key={campaign.id} className="promotions-list-item">
                      <div>
                        <strong>{campaign.name || "Untitled newsletter"}</strong>
                        <div className="promotions-muted">
                          {campaign.subject || "No subject"} · {campaign.status || "draft"}
                        </div>
                        <div className="promotions-muted">
                          {campaign.status === "scheduled"
                            ? `Scheduled: ${formatNewsletterSchedule(campaign.scheduled_at || campaign.schedule)}`
                            : `${Array.isArray(campaign.recipients) ? campaign.recipients.length : 0} recipient(s)`}
                        </div>
                      </div>
                      <div className="promotions-inline-actions">
                        <button
                          type="button"
                          className="promotions-newsletter-edit-button"
                          onClick={() => editNewsletterCampaign(campaign)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="promotions-newsletter-delete-button"
                          onClick={() => persistResource("newsletter", "delete", { id: campaign.id }, "Newsletter campaign removed.")}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        );
      case "banners":
        return renderBannerSection();
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
          <div className="promotions-stack promotions-analytics-section">
            <section className="promotions-card promotions-analytics-intro">
              <div className="promotions-card-header">
                <h3>Promotion analytics</h3>
                <span>Performance metrics and coupon activity, based on recorded promotion data.</span>
              </div>
            </section>
            {renderKpiCards({ analyticsOnly: true })}
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
            <NewsletterSMTPSettings />
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

  const renderBannerSection = () => {
    const filteredBannerAssets = bannerAssets.filter((asset) => {
      const search = bannerAssetSearch.trim().toLowerCase();
      const matchesSearch = !search || [
        asset.title,
        asset.filename,
        asset.category,
        asset.collection,
        asset.keywords,
        asset.description
      ].filter(Boolean).join(" ").toLowerCase().includes(search);
      const matchesCategory = !bannerAssetCategory || String(asset.category || "")
        .split(",")
        .some((category) => category.trim().toLowerCase() === bannerAssetCategory.toLowerCase());
      const matchesCollection = !bannerAssetCollection
        || String(asset.collection || "").trim().toLowerCase() === bannerAssetCollection.toLowerCase();
      return matchesSearch && matchesCategory && matchesCollection;
    });

    const handleBannerSubmit = async (event) => {
      event.preventDefault();
      if (!bannerDraft.start_date) {
        setMessage("A start date is required.");
        document.getElementById("promotion-banner-start-date")?.focus();
        return;
      }
      const formData = new FormData();
      if (editingBannerId !== null) formData.append("id", String(editingBannerId));
      formData.append("name", bannerDraft.name);
      formData.append("placement", bannerDraft.placement);
      formData.append("popup_audience", bannerDraft.popupAudience);
      formData.append("sparkle_style", bannerDraft.sparkleStyle);
      formData.append("start_date", bannerDraft.start_date);
      formData.append("end_date", bannerDraft.end_date);
      formData.append("status", bannerDraft.status);
      formData.append("selected_asset_ids", JSON.stringify(selectedBannerAssetIds));
      if (bannerDraft.iconFile) formData.append("icon", bannerDraft.iconFile);

      try {
        await axios.post(`${API_BASE_URL}/admin/promotions/banners`, formData, {
          headers: buildAuthHeaders()
        });
        const successMessage = editingBannerId === null ? "Banner saved." : "Banner updated.";
        await loadPromotions();
        setMessage(successMessage);
        setBannerDraft(initialBannerForm);
        setEditingBannerId(null);
        setEditingBannerIconFilename("");
        setSelectedBannerAssetIds([]);
        if (bannerIconInputRef.current) bannerIconInputRef.current.value = "";
      } catch (error) {
        console.error("Failed to save promotional banner", error);
        setMessage(error.response?.data?.error || "Request failed.");
      }
    };

    const startEditingBanner = (entry, metadata) => {
      setEditingBannerId(entry.id);
      setEditingBannerIconFilename(metadata.icon_filename || "");
      setBannerDraft({
        name: entry.name || "",
        placement: entry.placement || "left",
        popupAudience: metadata.popup_audience || "homepage",
        sparkleStyle: metadata.sparkle_style || "glitter_burst",
        iconFile: null,
        start_date: metadata.start_date ? String(metadata.start_date).slice(0, 10) : "",
        end_date: metadata.end_date ? String(metadata.end_date).slice(0, 10) : "",
        status: entry.status || "draft"
      });
      setSelectedBannerAssetIds(
        Array.isArray(metadata.selected_asset_ids) ? metadata.selected_asset_ids.map(String) : []
      );
      if (bannerIconInputRef.current) bannerIconInputRef.current.value = "";
    };

    const cancelBannerEdit = () => {
      setEditingBannerId(null);
      setEditingBannerIconFilename("");
      setBannerDraft(initialBannerForm);
      setSelectedBannerAssetIds([]);
      if (bannerIconInputRef.current) bannerIconInputRef.current.value = "";
    };

    return (
      <div className="promotions-stack promotions-banner-section">
        <div className="promotions-card promotions-banner-card">
          <div className="promotions-card-header">
            <div className="promotions-banner-heading">
              <span className="promotions-banner-eyebrow">CAMPAIGN CREATOR</span>
              <h3>Promotional Banners</h3>
              <p>Design a placement-ready banner and control when it appears.</p>
            </div>
            <span className="promotions-banner-card-badge">
              <span aria-hidden="true">✦</span> New campaign
            </span>
          </div>
          <form className="promotions-form-grid promotions-banner-form" onSubmit={handleBannerSubmit}>
            <div className="promotions-field-group promotions-banner-name-field">
              <label htmlFor="promotion-banner-name">Banner Name</label>
              <input
                id="promotion-banner-name"
                placeholder="e.g. Summer collection"
                required
                value={bannerDraft.name}
                onChange={(event) => setBannerDraft((current) => ({ ...current, name: event.target.value }))}
              />
            </div>
            <div className="promotions-field-group promotions-banner-placement-field">
              <label htmlFor="promotion-banner-placement">Placement</label>
              <select
                id="promotion-banner-placement"
                value={bannerDraft.placement}
                onChange={(event) => setBannerDraft((current) => ({ ...current, placement: event.target.value }))}
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="up">UP</option>
                <option value="down">Down</option>
                <option value="popup">Popup</option>
              </select>
            </div>
            {bannerDraft.placement === "popup" && (
              <div className="promotions-field-group promotions-conditional-field">
                <label htmlFor="promotion-banner-popup-audience">Popup audience</label>
                <select
                  id="promotion-banner-popup-audience"
                  required
                  value={bannerDraft.popupAudience}
                  onChange={(event) => setBannerDraft((current) => ({ ...current, popupAudience: event.target.value }))}
                >
                  <option value="homepage">Homepage visitors</option>
                  <option value="logged_in_customers">Logged in customers</option>
                  <option value="logged_in_contributors">Logged in Contributors</option>
                </select>
              </div>
            )}
            <div className={`promotions-field-group promotions-banner-upload-field${bannerDraft.iconFile ? " has-file" : ""}`}>
              <label htmlFor="promotion-banner-icon">Icon (original dimensions preserved)</label>
              <div className="promotions-banner-file-control">
                <input
                  id="promotion-banner-icon"
                  ref={bannerIconInputRef}
                  type="file"
                  accept=".png,image/png,.jpg,.jpeg,image/jpeg,.webp,image/webp,.gif,image/gif,.avif,image/avif,.tif,.tiff,image/tiff,.svg,image/svg+xml"
                  required={editingBannerId === null}
                  onChange={(event) => setBannerDraft((current) => ({
                    ...current,
                    iconFile: event.target.files?.[0] || null
                  }))}
                />
                <span aria-hidden="true" className="promotions-banner-upload-mark">↑</span>
                <span className="promotions-banner-upload-copy">
                  <strong>{bannerDraft.iconFile ? bannerDraft.iconFile.name : editingBannerIconFilename || "Choose an icon"}</strong>
                  <span>{bannerDraft.iconFile ? "Ready to upload · original filename and dimensions preserved" : "PNG, JPG, WEBP · original dimensions preserved"}</span>
                </span>
                <span aria-hidden="true" className="promotions-banner-upload-action">
                  {bannerDraft.iconFile ? "Change" : "Browse"}
                </span>
              </div>
              {bannerDraft.iconFile && (
                <span className="promotions-field-help">Stored securely with your thumbnail assets.</span>
              )}
            </div>
            <CouponDatePicker
              id="promotion-banner-start-date"
              label="Start date"
              value={bannerDraft.start_date}
              onChange={(start_date) => setBannerDraft((current) => ({ ...current, start_date }))}
              required
              className="promotions-date-picker--banner promotions-banner-date-field"
              helpText="Required · choose when the banner goes live."
            />
            <CouponDatePicker
              id="promotion-banner-end-date"
              label="End date (optional)"
              value={bannerDraft.end_date}
              onChange={(end_date) => setBannerDraft((current) => ({ ...current, end_date }))}
              minDate={bannerDraft.start_date}
              className="promotions-date-picker--banner promotions-date-picker--banner-end promotions-banner-date-field"
              helpText="Optional · leave blank for no end date."
            />
            <div className="promotions-field-group promotions-banner-assets-field">
              <span className="promotions-banner-form-label">Assets</span>
              <button
                type="button"
                className="promotions-banner-assets-button"
                onClick={openBannerAssetsDialog}
              >
                <span aria-hidden="true">▦</span>
                <span>Assets</span>
                {selectedBannerAssetIds.length > 0 && (
                  <span className="promotions-banner-assets-count">{selectedBannerAssetIds.length}</span>
                )}
              </button>
              <span className="promotions-field-help">
                {selectedBannerAssetIds.length
                  ? `${selectedBannerAssetIds.length} live asset${selectedBannerAssetIds.length === 1 ? "" : "s"} selected`
                  : "Choose assets for this banner"}
              </span>
            </div>
            <div className="promotions-field-group promotions-banner-sparkle-field">
              <label htmlFor="promotion-banner-sparkle-style">Sparkle style</label>
              <select
                id="promotion-banner-sparkle-style"
                value={bannerDraft.sparkleStyle}
                onChange={(event) => setBannerDraft((current) => ({ ...current, sparkleStyle: event.target.value }))}
              >
                <option value="none">None</option>
                <option value="glitter_burst">Glitter burst</option>
                <option value="twinkle">Twinkle</option>
                <option value="falling_sparkles">Falling sparkles</option>
                <option value="snowfall">Snowfall</option>
                <option value="shimmer_sweep">Shimmer sweep</option>
                <option value="fireflies">Fireflies</option>
                <option value="star_trail">Star trail</option>
                <option value="pulsing_glow">Pulsing glow</option>
                <option value="aurora_glow">Aurora glow</option>
                <option value="confetti_sparkles">Confetti sparkles</option>
                <option value="orbiting_sparkles">Orbiting sparkles</option>
              </select>
              <span className="promotions-field-help">Choose the animation shown around this banner icon.</span>
            </div>
            <div className="promotions-field-group promotions-banner-status-field">
              <label htmlFor="promotion-banner-status">Status</label>
              <select
                id="promotion-banner-status"
                value={bannerDraft.status}
                onChange={(event) => setBannerDraft((current) => ({ ...current, status: event.target.value }))}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
              </select>
            </div>
            <button className="promotions-banner-submit" type="submit">
              <span>{editingBannerId === null ? "Save Promotional Banners" : "Update Promotional Banner"}</span>
              <span aria-hidden="true">→</span>
            </button>
            {editingBannerId !== null && (
              <button className="promotions-banner-cancel" type="button" onClick={cancelBannerEdit}>
                Cancel edit
              </button>
            )}
          </form>
        </div>
        {isBannerAssetsDialogOpen && (
          <div
            className="promotions-modal-backdrop promotions-banner-assets-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setIsBannerAssetsDialogOpen(false);
            }}
          >
            <section
              className="promotions-modal promotions-banner-assets-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="promotions-banner-assets-title"
            >
              <div className="promotions-banner-assets-header">
                <div>
                  <span className="promotions-banner-eyebrow">LIVE LIBRARY</span>
                  <h3 id="promotions-banner-assets-title">Choose assets</h3>
                  <p>Select the live assets to associate with this banner.</p>
                </div>
                <button
                  type="button"
                  className="promotions-banner-assets-close"
                  aria-label="Close asset picker"
                  onClick={() => setIsBannerAssetsDialogOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="promotions-banner-assets-filters">
                <label className="promotions-banner-assets-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    type="search"
                    aria-label="Search live assets"
                    placeholder="Search assets..."
                    value={bannerAssetSearch}
                    onChange={(event) => setBannerAssetSearch(event.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter assets by category"
                  value={bannerAssetCategory}
                  onChange={(event) => setBannerAssetCategory(event.target.value)}
                >
                  <option value="">All categories</option>
                  {bannerAssetCategories.map((category) => (
                    <option key={category.id} value={category.name}>{category.name}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter assets by collection"
                  value={bannerAssetCollection}
                  onChange={(event) => setBannerAssetCollection(event.target.value)}
                >
                  <option value="">All collections</option>
                  {bannerAssetCollections.map((collection) => (
                    <option key={collection.id} value={collection.name}>{collection.name}</option>
                  ))}
                </select>
              </div>
              <div className="promotions-banner-assets-results" aria-live="polite">
                {isLoadingBannerAssets ? (
                  <p className="promotions-banner-assets-message" role="status">Loading live assets…</p>
                ) : bannerAssetLoadError ? (
                  <div className="promotions-banner-assets-message" role="alert">
                    <p>{bannerAssetLoadError}</p>
                    <button type="button" onClick={loadBannerAssets}>Retry</button>
                  </div>
                ) : filteredBannerAssets.length === 0 ? (
                  <p className="promotions-banner-assets-message">
                    {bannerAssets.length ? "No live assets match these filters." : "No live assets are available yet."}
                  </p>
                ) : (
                  <div className="promotions-banner-assets-grid">
                    {filteredBannerAssets.map((asset) => {
                      const assetId = String(asset.id);
                      const isSelected = draftBannerAssetIds.includes(assetId);
                      return (
                        <button
                          key={assetId}
                          type="button"
                          className={`promotions-banner-asset-option${isSelected ? " is-selected" : ""}`}
                          aria-pressed={isSelected}
                          onClick={() => setDraftBannerAssetIds((current) => (
                            isSelected
                              ? current.filter((id) => id !== assetId)
                              : [...current, assetId]
                          ))}
                        >
                          <span className="promotions-banner-asset-thumbnail">
                            <img src={getAssetThumbnailUrl(asset)} alt="" loading="lazy" />
                          </span>
                          <span className="promotions-banner-asset-title">{asset.title || asset.filename || `Asset ${assetId}`}</span>
                          <span className="promotions-banner-asset-check" aria-hidden="true">
                            {isSelected ? "✓" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="promotions-banner-assets-footer">
                <span>{draftBannerAssetIds.length} selected</span>
                <div>
                  <button
                    type="button"
                    className="promotions-banner-assets-clear"
                    onClick={() => setDraftBannerAssetIds([])}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="promotions-banner-assets-save"
                    onClick={() => {
                      setSelectedBannerAssetIds(draftBannerAssetIds);
                      setIsBannerAssetsDialogOpen(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
        <div className="promotions-card promotions-banner-entries-card">
          <div className="promotions-card-header">
            <h3>Existing Entries</h3>
            <span className="promotions-banner-entry-count">{banners.length} {banners.length === 1 ? "banner" : "banners"}</span>
          </div>
          <div className="promotions-list">
            {banners.length === 0 ? (
              <div className="promotions-banner-empty-state">
                <span className="promotions-banner-empty-icon" aria-hidden="true">✦</span>
                <strong>Your banners will appear here</strong>
                <span>Once saved, you can review placement, schedule, and status in one place.</span>
              </div>
            ) : banners.map((entry) => {
              const metadata = typeof entry.metadata === "string"
                ? (() => {
                  try {
                    return JSON.parse(entry.metadata);
                  } catch (error) {
                    console.error("Invalid Promotional Banner metadata", error);
                    return {};
                  }
                })()
                : entry.metadata || {};
              return (
                <div key={entry.id} className="promotions-list-item">
                  <div>
                    <strong>{entry.name || "Untitled banner"}</strong>
                    <div className="promotions-muted">
                      {entry.placement || "No placement"} · {entry.status || "draft"}
                      {metadata.popup_audience ? ` · ${metadata.popup_audience}` : ""}
                    </div>
                    <div className="promotions-muted">
                      Start: {metadata.start_date || "Not set"} · End: {metadata.end_date || "No end date"}
                    </div>
                    {Array.isArray(metadata.selected_asset_ids) && metadata.selected_asset_ids.length > 0 && (
                      <div className="promotions-muted">
                        {metadata.selected_asset_ids.length} linked live asset{metadata.selected_asset_ids.length === 1 ? "" : "s"}
                      </div>
                    )}
                    {metadata.icon_filename && (
                      <div className="promotions-muted">Icon: {metadata.icon_filename}</div>
                    )}
                  </div>
                  <div className="promotions-inline-actions">
                    <button type="button" onClick={() => startEditingBanner(entry, metadata)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => persistResource("banner", "delete", { id: entry.id }, "Entry removed.")}>
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
        {loading ? (
          <p role="status">Loading promotions data…</p>
        ) : loadError ? (
          <div role="alert" className="promotions-message">
            <p>{loadError}</p>
            <button type="button" onClick={loadPromotions} disabled={loading}>Retry</button>
          </div>
        ) : renderSectionContent()}
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
