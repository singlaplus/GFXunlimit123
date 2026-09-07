import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import "./AdminPanel.css";
import Pagination from "./Pagination";
import EmailActionButton from "./EmailActionButton";
import { getEffectiveAuthToken } from "../utils/authSession";
import AdminEmailSettings from "../pages/AdminEmailSettings";
import AdminEmailLogs from "../pages/AdminEmailLogs";
import AdminNewsletter from "../pages/AdminNewsletter";
import AdminEmailScheduled from "../pages/AdminEmailScheduled";
import AdminPromotionsPanel from "./AdminPromotionsPanel";
import AdminEmailTemplates from "../pages/AdminEmailTemplates";
import AdminEmailQueue from "../pages/AdminEmailQueue";
import AdminNotificationRules from "../pages/AdminNotificationRules";
import AdminEmailAnalytics from "../pages/AdminEmailAnalytics";
import RestorePage from "../pages/RestorePage";
import { limitWords, formatKeywords } from "../utils/uploadInputLimits";
import { getAssetPreviewUrl } from "../utils/assetPreview";

const CATEGORY_STORAGE_KEY = "asset-categories";
const COLLECTION_STORAGE_KEY = "asset-collections";
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const USER_DELETE_COOLING_PERIOD_MINUTES = 60;
const formatCoolingRemaining = (coolingUntil, now = Date.now()) => {
  const remainingSeconds = Math.max(0, Math.ceil((new Date(coolingUntil).getTime() - now) / 1000));
  if (!remainingSeconds) return "Live now";
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.ceil((remainingSeconds % 3600) / 60);
  return `${hours}h ${minutes}m remaining`;
};
const normalizeBackupDateRange = (fromDate, toDate, now = new Date()) => {
  const currentDate = now.toISOString().slice(0, 10);
  const normalizedFromDate = String(fromDate || currentDate).slice(0, 10);
  const normalizedToDate = String(toDate || currentDate).slice(0, 10);

  return {
    from: `${normalizedFromDate}T00:00:00.000Z`,
    to: normalizedToDate === currentDate ? now.toISOString() : `${normalizedToDate}T23:59:59.999Z`
  };
};
const formatBackupCreatedAt = (createdAt) => {
  if (!createdAt) return "N/A";
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(createdAt));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.day}-${values.month}-${values.year} ${values.hour}:${values.minute}`;
};
const HERO_BADGE_DEFAULT = "✨ World's Next Creative Marketplace";
const HERO_HEADING_LINE_1_DEFAULT = "Discover Millions of";
const HERO_HEADING_LINE_2_DEFAULT = "Creative Stock Assets";
const HERO_PARAGRAPH_DEFAULT = "Browse {totalImages}+ royalty-free photos, vectors, illustrations, PSD files, templates and creative assets from creators around the world.";
const TOP_TAB_DEFAULT = "React App";
const DEFAULT_CATEGORY_OPTIONS = [
  { id: "default-images", name: "Images" },
  { id: "default-vector", name: "Vector/illustrations" },
  { id: "default-psd", name: "PSD" },
  { id: "default-videos", name: "Videos" },
  { id: "default-templates", name: "Templates" }
];

function CardWrapper({ cardId, cardOrder, isLayoutEditMode, isDarkMode, moveCard, children }) {
  const safeCardOrder = Array.isArray(cardOrder) ? cardOrder : [];
  const cardIndex = safeCardOrder.indexOf(cardId);
  const canMoveLeft = cardIndex > 0;
  const canMoveRight = cardIndex < safeCardOrder.length - 1;

  if (!isLayoutEditMode) {
    return <div className="admin-panel-card" style={{ order: cardIndex, flexBasis: "calc(33.333% - 14px)" }}>{children}</div>;
  }

  return (
    <div
      className="admin-panel-card"
      style={{
        position: "relative",
        border: "2px solid #2196f3",
        background: isDarkMode ? "#111827" : "#f0f8ff",
        order: cardIndex,
        flexBasis: "calc(33.333% - 14px)"
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "8px",
          right: "8px",
          display: "flex",
          flexDirection: "row",
          gap: "4px"
        }}
      >
        <button
          type="button"
          onClick={() => moveCard(cardId, "left")}
          disabled={!canMoveLeft}
          title="Move card left"
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            border: "none",
            background: canMoveLeft ? "#43a047" : "#ccc",
            color: "white",
            cursor: canMoveLeft ? "pointer" : "not-allowed",
            fontSize: "18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => moveCard(cardId, "right")}
          disabled={!canMoveRight}
          title="Move card right"
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            border: "none",
            background: canMoveRight ? "#43a047" : "#ccc",
            color: "white",
            cursor: canMoveRight ? "pointer" : "not-allowed",
            fontSize: "18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          →
        </button>
      </div>
      <div>{children}</div>
    </div>
  );
}

function AdminPanel({ initialDailyReportSettingsPage = false, initialDailyReportPreviewPage = false }) {
  const location = useLocation();
  const adminBasePath = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
  const [currentWindowPath, setCurrentWindowPath] = useState(() => (typeof window !== "undefined" ? window.location.pathname : location.pathname || "/"));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncWindowPath = () => setCurrentWindowPath(window.location.pathname);
    syncWindowPath();
    window.addEventListener("popstate", syncWindowPath);
    return () => window.removeEventListener("popstate", syncWindowPath);
  }, []);

  const statusParam = new URLSearchParams(location.search).get("status");
  const tabParam = new URLSearchParams(location.search).get("tab") || "";
  const statusFilter = (statusParam || "all").toLowerCase();
  const isDailyReportSettingsPath =
    currentWindowPath === `${adminBasePath}/email/daily-report-settings`
    || currentWindowPath === "/admin/email/daily-report-settings";
  const isDailyReportPreviewPath =
    currentWindowPath === `${adminBasePath}/email/daily-report-preview`
    || currentWindowPath === "/admin/email/daily-report-preview";
  const isDailyReportSettingsPage = Boolean(initialDailyReportSettingsPage) || isDailyReportSettingsPath;
  const [dailyReportSettingsPageOpen, setDailyReportSettingsPageOpen] = useState(Boolean(initialDailyReportSettingsPage));
  const isDailyReportSettingsRouteOpen = isDailyReportSettingsPage || dailyReportSettingsPageOpen;
  const [dailyReportPreviewPageOpen, setDailyReportPreviewPageOpen] = useState(Boolean(initialDailyReportPreviewPage));
  const isDailyReportPreviewRouteOpen = Boolean(initialDailyReportPreviewPage) || isDailyReportPreviewPath || dailyReportPreviewPageOpen;

  useEffect(() => {
    setDailyReportSettingsPageOpen((previous) => (isDailyReportSettingsPage || previous ? true : previous));
  }, [isDailyReportSettingsPage]);

  const [images, setImages] = useState([]);
  const [categories, setCategories] = useState([]);
  const [collections, setCollections] = useState([]);
  const [users, setUsers] = useState([]);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [newCategory, setNewCategory] = useState("");
  const [newCategoryError, setNewCategoryError] = useState("");
  const [newCollection, setNewCollection] = useState("");
  const [deleteWarning, setDeleteWarning] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [liveCurrentPage, setLiveCurrentPage] = useState(1);
  const [liveSearchQuery, setLiveSearchQuery] = useState("");
  const [liveCategoryFilter, setLiveCategoryFilter] = useState("");
  const [liveCollectionFilter, setLiveCollectionFilter] = useState("");
  const [liveTypeFilter, setLiveTypeFilter] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [editForm, setEditForm] = useState({
    title: "",
    categoryPrimary: "",
    categorySecondary: "",
    collection: "",
    keywords: "",
    description: "",
    type: ""
  });
  const [editingUserId, setEditingUserId] = useState(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [deleteConfirmationUser, setDeleteConfirmationUser] = useState(null);
  const [userFilter, setUserFilter] = useState("all");
  const [isUserSaving, setIsUserSaving] = useState(false);
    const [creditUserId, setCreditUserId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [isAddingCredits, setIsAddingCredits] = useState(false);
  const [otpSettings, setOtpSettings] = useState({
    default_recipient: "",
    bcc_recipients: "",
    login_subject: "Login OTP",
    registration_subject: "Account Verification OTP",
    recovery_subject: "Password Recovery OTP",
    login_body: "Hello {{full_name}},<br>Your login OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.",
    registration_body: "Hello {{full_name}},<br>Your account verification OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.",
    recovery_body: "Hello {{full_name}},<br>Your password recovery OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.",
    valid_minutes: 10,
  });
  const [otpSettingsMessage, setOtpSettingsMessage] = useState("");
  const [otpSettingsSaving, setOtpSettingsSaving] = useState(false);
  const [otpSettingsModal, setOtpSettingsModal] = useState(null);
  const OTP_SETTINGS_MODAL_TITLES = {
    general: "Default OTP Delivery Settings",
    login: "Login OTP Settings",
    registration: "Registration OTP Settings",
    recovery: "Forgot Password OTP Settings"
  };
  const [userEditForm, setUserEditForm] = useState({
    full_name: "",
    username: "",
    email: "",
    role: "",
    identity_number: "",
    credits: "",
    status: "",
    password: "",
    otp_enabled: true,
    custom_permissions: {
      bulk_upload: false
    }
  });
  const [viewingCategoryId, setViewingCategoryId] = useState(null);
  const [viewingCollectionId, setViewingCollectionId] = useState(null);
  const [showCategoryGrid, setShowCategoryGrid] = useState(false);
  const [showCollectionGrid, setShowCollectionGrid] = useState(false);
  const [brandingLogoFile, setBrandingLogoFile] = useState(null);
  const [brandingFaviconFile, setBrandingFaviconFile] = useState(null);
  const [brandingWatermarkLogoFile, setBrandingWatermarkLogoFile] = useState(null);
  const [brandingWatermarkFaviconFile, setBrandingWatermarkFaviconFile] = useState(null);
  const [profileIconCustomerFile, setProfileIconCustomerFile] = useState(null);
  const [profileIconContributorFile, setProfileIconContributorFile] = useState(null);
  const [profileIconAdminFile, setProfileIconAdminFile] = useState(null);
  const [heroBannerFile, setHeroBannerFile] = useState(null);
  const [customerBannerFile, setCustomerBannerFile] = useState(null);
  const [contributorBannerFile, setContributorBannerFile] = useState(null);
  const [brandingConfig, setBrandingConfig] = useState({});
  const [brandingMessage, setBrandingMessage] = useState("");
  const [heroBannerMessage, setHeroBannerMessage] = useState("");
  const [customerBannerMessage, setCustomerBannerMessage] = useState("");
  const [contributorBannerMessage, setContributorBannerMessage] = useState("");
  const [heroTextMessage, setHeroTextMessage] = useState("");
  const [brandingUploading, setBrandingUploading] = useState(false);
  const [heroBannerSaving, setHeroBannerSaving] = useState(false);
  const [customerBannerSaving, setCustomerBannerSaving] = useState(false);
  const [contributorBannerSaving, setContributorBannerSaving] = useState(false);
  const [customerBannerModal, setCustomerBannerModal] = useState(false);
  const [contributorBannerModal, setContributorBannerModal] = useState(false);
  const [heroTextSaving, setHeroTextSaving] = useState(false);
  const [heroBadge, setHeroBadge] = useState("");
  const [heroHeadingLine1, setHeroHeadingLine1] = useState("");
  const [heroHeadingLine2, setHeroHeadingLine2] = useState("");
  const [heroParagraph, setHeroParagraph] = useState("");
  const [topTab, setTopTab] = useState(TOP_TAB_DEFAULT);
  const [heroTextModal, setHeroTextModal] = useState(null);
  const heroBannerInputRef = useRef(null);
  const customerBannerInputRef = useRef(null);
  const contributorBannerInputRef = useRef(null);
  const [editingCategoryInModal, setEditingCategoryInModal] = useState(null);
  const [editingCategoryNameInModal, setEditingCategoryNameInModal] = useState("");
  const [editingCollectionInModal, setEditingCollectionInModal] = useState(null);
  const [editingCollectionNameInModal, setEditingCollectionNameInModal] = useState("");
  const [selectedImageForStatus, setSelectedImageForStatus] = useState(null);
  const [selectedImageStatus, setSelectedImageStatus] = useState("approved");
  const [liveAssetIds, setLiveAssetIds] = useState(() => new Set());
  const [liveAssetsExportStatus, setLiveAssetsExportStatus] = useState("");
  const [userExportStatus, setUserExportStatus] = useState("");
  const [selectedPaymentGateway, setSelectedPaymentGateway] = useState(null);
  const [paymentGatewayIdentifier, setPaymentGatewayIdentifier] = useState("");
  const [paymentGatewaySettings, setPaymentGatewaySettings] = useState({});
  const [paymentGatewaySaving, setPaymentGatewaySaving] = useState(false);
  const [paymentGatewayMessage, setPaymentGatewayMessage] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(() => typeof document !== "undefined" && document.body.classList.contains("dark-mode"));
  const PAYMENT_GATEWAY_OPTIONS = ["Development", "Google Pay", "Paytm", "Credit Card", "Stripe", "PayPal", "Razorpay", "Cashfree"];
  const [paymentGatewayOptions, setPaymentGatewayOptions] = useState(PAYMENT_GATEWAY_OPTIONS);
  const SOCIAL_LINKS_STORAGE_KEY = "footer-social-links";
  const SOCIAL_LINKS_EVENT = "footer-social-links-changed";
  const DEFAULT_SOCIAL_LINKS = [
    { platform: "twitter", url: "https://twitter.com" },
    { platform: "instagram", url: "https://instagram.com" },
    { platform: "facebook", url: "https://facebook.com" },
    { platform: "", url: "" },
    { platform: "", url: "" }
  ];
  const SOCIAL_LINK_OPTIONS = [
    { value: "", label: "Select platform" },
    { value: "twitter", label: "Twitter" },
    { value: "instagram", label: "Instagram" },
    { value: "facebook", label: "Facebook" },
    { value: "linkedin", label: "LinkedIn" },
    { value: "youtube", label: "YouTube" },
    { value: "pinterest", label: "Pinterest" },
    { value: "tiktok", label: "TikTok" },
    { value: "snapchat", label: "Snapchat" },
    { value: "reddit", label: "Reddit" },
    { value: "telegram", label: "Telegram" },
    { value: "discord", label: "Discord" },
    { value: "github", label: "GitHub" },
    { value: "dribbble", label: "Dribbble" },
    { value: "behance", label: "Behance" },
    { value: "medium", label: "Medium" },
    { value: "mastodon", label: "Mastodon" },
    { value: "x", label: "X" }
  ];
  const resolveEnabledPaymentGateways = (settings = {}) => {
    const normalizedSettings = settings && typeof settings === "object" ? settings : {};
    const explicitGateways = Array.isArray(normalizedSettings.enabledGateways)
      ? normalizedSettings.enabledGateways
      : [];

    const inferredGateways = Object.values(normalizedSettings)
      .filter((value) => value && typeof value === "object" && value.gateway)
      .map((value) => String(value.gateway).trim())
      .filter(Boolean);

    return [...new Set([...explicitGateways, ...inferredGateways].map((gateway) => String(gateway).trim()).filter(Boolean))];
  };

  const [enabledPaymentGateways, setEnabledPaymentGateways] = useState([]);

  // Handle token from URL query parameter (for testing/debugging)
  useEffect(() => {
    const queryToken = new URLSearchParams(location.search).get("token");
    if (queryToken && typeof window !== "undefined") {
      localStorage.setItem("token", queryToken);
      // Remove token from URL to clean up
      const newUrl = window.location.pathname + '?tab=' + tabParam;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

  useEffect(() => {
    const fetchPaymentGateways = async () => {
      try {
        const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
        const res = await axios.get(`${API_BASE_URL}/admin/payment-settings`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        setPaymentGatewaySettings(res.data && typeof res.data === "object" ? res.data : {});
        const deletedGateways = Array.isArray(res.data?.deletedGateways) ? res.data.deletedGateways : [];
        setPaymentGatewayOptions(PAYMENT_GATEWAY_OPTIONS.filter((gateway) => !deletedGateways.some((deletedGateway) => String(deletedGateway).toLowerCase() === gateway.toLowerCase())));
        setEnabledPaymentGateways(resolveEnabledPaymentGateways(res.data || {}));
      } catch (err) {
        console.error("Failed to load payment gateways from backend", err);
        setPaymentGatewaySettings({});
        setPaymentGatewayOptions(PAYMENT_GATEWAY_OPTIONS);
        setEnabledPaymentGateways([]);
      }
    };

    fetchPaymentGateways();
    const intervalId = setInterval(fetchPaymentGateways, 5000);
    const onFocus = () => fetchPaymentGateways();
    const onGatewayUpdated = () => fetchPaymentGateways();

    window.addEventListener("focus", onFocus);
    window.addEventListener("payment-gateways-updated", onGatewayUpdated);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("payment-gateways-updated", onGatewayUpdated);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const refreshCollectionsForAssetChanges = async () => {
      try {
        await fetchCollections();
      } catch (err) {
        console.error("Failed to refresh collections after asset update", err);
      }
    };

    const onAssetCollectionRefresh = () => {
      refreshCollectionsForAssetChanges();
    };

    window.addEventListener("asset-refresh", onAssetCollectionRefresh);
    window.addEventListener("asset-updated", onAssetCollectionRefresh);
    window.addEventListener("asset-collections-updated", onAssetCollectionRefresh);
    window.addEventListener("home-assets-refresh", onAssetCollectionRefresh);

    return () => {
      window.removeEventListener("asset-refresh", onAssetCollectionRefresh);
      window.removeEventListener("asset-updated", onAssetCollectionRefresh);
      window.removeEventListener("asset-collections-updated", onAssetCollectionRefresh);
      window.removeEventListener("home-assets-refresh", onAssetCollectionRefresh);
    };
  }, []);

  useEffect(() => {
    const syncTheme = () => {
      setIsDarkMode(typeof document !== "undefined" && document.body.classList.contains("dark-mode"));
    };

    syncTheme();

    if (typeof document !== "undefined") {
      const observer = new MutationObserver(syncTheme);
      observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      return () => observer.disconnect();
    }
  }, []);

  const isControlsTab = tabParam === "controls";
  const isBackupTab = tabParam === "backup";
  const isEmptyAdminBodyTab = tabParam === "restore";
  const isLiveAssetsTab = tabParam === "live-assets";
  const isUsersTab = tabParam === "users";
  const isPromotionsTab = tabParam === "promotions";
  const shouldShowImageGrid = !isControlsTab && !isBackupTab && !isEmptyAdminBodyTab && !isUsersTab && !isPromotionsTab;
  const adminPageHeading = tabParam === "backup"
    ? "GFX Backup"
    : tabParam === "restore"
      ? "Restore"
      : tabParam === "controls"
        ? "Controls"
        : tabParam === "live-assets"
          ? "Live Assets"
          : tabParam === "users"
            ? "Users"
            : tabParam === "promotions"
              ? "Promotions"
              : tabParam === "myaccount"
                ? "My Account"
                : "Admin Panel";

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(images.length / pageSize));
  const pageImages = images.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const visibleCategories = categories.length > 0 ? categories : DEFAULT_CATEGORY_OPTIONS;
  const visibleCollections = collections.length > 0 ? collections : [];
  const liveTypeOptions = Array.from(
    new Set(images.map((image) => String(image.type || "").trim()).filter(Boolean))
  ).sort();
  const liveSearchText = liveSearchQuery.trim().toLowerCase();

  useEffect(() => {
    setLiveCurrentPage(1);
  }, [liveSearchQuery, liveCategoryFilter, liveCollectionFilter, liveTypeFilter]);

  const liveFilteredImages = images.filter((image) => {
    if (!image) return false;
    if (liveSearchText) {
      const haystack = [image.title, image.category, image.collection, image.keywords, image.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(liveSearchText)) {
        return false;
      }
    }
    if (liveCategoryFilter) {
      const categoryParts = String(image.category || "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      if (!categoryParts.includes(liveCategoryFilter.toLowerCase())) {
        return false;
      }
    }
    if (liveCollectionFilter && String(image.collection || "").toLowerCase() !== liveCollectionFilter.toLowerCase()) {
      return false;
    }
    if (liveTypeFilter && String(image.type || "").toLowerCase() !== liveTypeFilter.toLowerCase()) {
      return false;
    }
    return true;
  });
  const liveTotalPages = Math.max(1, Math.ceil(liveFilteredImages.length / pageSize));
  const livePageImages = liveFilteredImages.slice((liveCurrentPage - 1) * pageSize, liveCurrentPage * pageSize);
  const renderedImages = isLiveAssetsTab ? livePageImages : pageImages;

  const getGfxDeviceId = () => {
    if (typeof window === "undefined") return "GFX-DEVICE-001";
    try {
      const stored = window.localStorage.getItem("gfx-device-id");
      if (stored && /^GFX-(MAC|PC1|LINUX|DEVICE)-\d{3}$/i.test(stored)) {
        return stored;
      }

      const platformKey = /Mac|iPhone|iPad/.test(navigator.userAgent || "") ? "MAC" : /Windows/.test(navigator.userAgent || "") ? "PC1" : /Linux/.test(navigator.userAgent || "") ? "LINUX" : "DEVICE";
      const suffix = String(Math.floor(Math.random() * 900 + 100));
      const generated = `GFX-${platformKey}-${suffix}`;
      window.localStorage.setItem("gfx-device-id", generated);
      return generated;
    } catch (error) {
      return "GFX-DEVICE-001";
    }
  };

  const [backupMode, setBackupMode] = useState("incremental");
  const [backupFromDate, setBackupFromDate] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [backupToDate, setBackupToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [backupProgress, setBackupProgress] = useState(0);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatusText, setBackupStatusText] = useState("Ready");
  const [backupRemainingSeconds, setBackupRemainingSeconds] = useState(0);
  const [backupStageIndex, setBackupStageIndex] = useState(0);
  const [backupSummary, setBackupSummary] = useState(null);
  const [savedBackupLocation, setSavedBackupLocation] = useState("backend/backup/--pending-backup--.gfxbackup");
  const backupProgressStages = [
    "Reading synchronization history",
    "Detecting changed application files",
    "Detecting changed assets",
    "Collecting database changes",
    "Creating manifest",
    "Creating checksums",
    "Validating package",
    "Compressing package"
  ];
  const backupProgressRef = useRef(null);
  const [backupHistory, setBackupHistory] = useState([]);
  const [backupFilterFilename, setBackupFilterFilename] = useState("");
  const [backupFilterMode, setBackupFilterMode] = useState("");
  const [backupFilterCreated, setBackupFilterCreated] = useState("");
  const [backupFilterSize, setBackupFilterSize] = useState("");
  const [backupFilterDateRange, setBackupFilterDateRange] = useState("");
  const [backupCurrentPage, setBackupCurrentPage] = useState(1);
  const BACKUP_ITEMS_PER_PAGE = 10;

  useEffect(() => {
    const loadAvailableBackups = async () => {
      try {
        console.log("[DEBUG] Loading backups...");
        const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
        console.log("[DEBUG] Token:", token ? "exists" : "none");
        const response = await axios.get(`${API_BASE_URL}/admin/backup/list`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        console.log("[DEBUG] API Response:", response.data);
        const availableBackups = Array.isArray(response.data) ? response.data : [];
        console.log("[DEBUG] Available backups count:", availableBackups.length);
        setBackupHistory(availableBackups);
        if (typeof window !== "undefined") {
          localStorage.setItem("gfx-backup-history", JSON.stringify(availableBackups));
        }
      } catch (error) {
        console.warn("Could not load backup list from server", error);
        setBackupHistory([]);
      }
    };

    if (tabParam === "backup") {
      console.log("[DEBUG] tabParam is backup, loading backups");
      loadAvailableBackups();
    }
  }, [tabParam]);

  // Reset pagination when filters change
  useEffect(() => {
    setBackupCurrentPage(1);
  }, [backupFilterFilename, backupFilterMode, backupFilterCreated, backupFilterSize, backupFilterDateRange, backupMode]);

  const lastSuccessfulBackup = backupHistory[0] || null;

  const formatFileSize = (bytes) => {
    if (typeof bytes !== "number" || bytes < 0) return "0 KB";
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };

  const handleBackupDownload = async (entry) => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const response = await fetch(`${API_BASE_URL}/admin/backup/download?file=${encodeURIComponent(entry.filePath)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        throw new Error("Download failed");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = entry.fileName || "backup.gfxbackup";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded successfully");
    } catch (error) {
      console.error("Backup download failed", error);
      toast.error("Failed to download backup");
    }
  };

  const handleBackupDelete = async (entry) => {
    if (!window.confirm(`Delete backup "${entry.fileName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      await axios.delete(`${API_BASE_URL}/admin/backup/delete?file=${encodeURIComponent(entry.filePath)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      setBackupHistory((previous) => previous.filter((b) => b.filePath !== entry.filePath));
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("gfx-backup-history");
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
              localStorage.setItem("gfx-backup-history", JSON.stringify(parsed.filter((backup) => backup.filePath !== entry.filePath)));
            }
          } catch (storageError) {
            console.warn("Could not update cached backup history", storageError);
          }
        }
      }
      toast.success("Backup deleted successfully");
    } catch (error) {
      console.error("Backup deletion failed", error);
      toast.error(error.response?.data?.error || "Failed to delete backup");
    }
  };

  useEffect(() => {
    if (!lastSuccessfulBackup) {
      return;
    }

    const candidateFrom = lastSuccessfulBackup.to || lastSuccessfulBackup.from || lastSuccessfulBackup.createdAt;
    if (!candidateFrom) return;

    setBackupFromDate(new Date(candidateFrom).toISOString().slice(0, 10));
    setBackupToDate(new Date().toISOString().slice(0, 10));
  }, [lastSuccessfulBackup]);

  const beginBackupProgress = () => {
    if (backupProgressRef.current) {
      clearInterval(backupProgressRef.current);
    }

    const startedAt = Date.now();
    const stageEstimateSeconds = backupProgressStages.length * 4;

    setBackupBusy(true);
    setBackupStatusText("Creating GFX Backup...");
    setBackupStageIndex(0);
    setBackupProgress(12);
    setBackupRemainingSeconds(stageEstimateSeconds);

    let activeStage = 0;
    backupProgressRef.current = setInterval(() => {
      activeStage = Math.min(activeStage + 1, backupProgressStages.length - 1);
      const elapsedMs = Date.now() - startedAt;
      const elapsedSeconds = Math.max(1, Math.floor(elapsedMs / 1000));
      const progressValue = Math.min(92, 14 + ((activeStage + 1) * 9));
      const measuredProgress = Math.max(12, Math.min(progressValue, 100));
      const estimatedTotalMs = elapsedMs > 0 ? (elapsedMs * 100) / measuredProgress : stageEstimateSeconds * 1000;
      const remainingMs = Math.max(0, estimatedTotalMs - elapsedMs);
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));

      setBackupStageIndex(activeStage);
      setBackupProgress(progressValue);
      setBackupStatusText(backupProgressStages[activeStage]);
      setBackupRemainingSeconds(remainingSeconds);
    }, 500);
  };

  const stopBackupProgress = () => {
    if (backupProgressRef.current) {
      clearInterval(backupProgressRef.current);
      backupProgressRef.current = null;
    }
    setBackupProgress(100);
    setBackupStatusText("Backup completed successfully.");
    setBackupStageIndex(backupProgressStages.length - 1);
    setBackupRemainingSeconds(0);
  };

  useEffect(() => () => {
    if (backupProgressRef.current) {
      clearInterval(backupProgressRef.current);
    }
  }, []);

  const createGfxBackupPackage = async () => {
    beginBackupProgress();

    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const deviceId = getGfxDeviceId();
      const backupDateRange = normalizeBackupDateRange(backupFromDate, backupToDate, new Date());
      const previousBackupId = lastSuccessfulBackup?.backupId || "none";
      const response = await axios.post(
        `${API_BASE_URL}/admin/backup/create`,
        {
          mode: backupMode,
          from: backupDateRange.from,
          to: backupDateRange.to,
          deviceId,
          previousBackupId,
        },
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );

      const responseData = response.data || {};
      const backupId = responseData.backupId || `GFX-${Date.now()}`;
      const generatedAt = new Date().toISOString();
      const summaryFrom = responseData.from || backupFromDate;
      const summaryTo = responseData.to || backupToDate;
      const fileName = responseData.fileName || `${backupId}.gfxbackup`;
      const filePath = responseData.filePath || responseData.relativePath || responseData.saveLocation || `backup/${fileName}`;
      const downloadUrl = responseData.downloadUrl;
      const fileCounts = responseData.fileCounts || {};
      const assetCounts = responseData.assetCounts || {};
      const databaseCounts = responseData.databaseCounts || {};

      if (downloadUrl) {
        const blobResponse = await fetch(`${API_BASE_URL}${downloadUrl}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!blobResponse.ok) {
          throw new Error("Backup download failed");
        }

        const blob = await blobResponse.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      }

      const nextSummary = {
        backupId,
        mode: responseData.mode || (backupMode === "incremental" ? "Incremental Backup" : "Complete Backup"),
        type: (responseData.mode || (backupMode === "incremental" ? "Incremental Backup" : "Complete Backup")).replace(/ Backup$/, ""),
        source: responseData.deviceId || deviceId,
        createdAt: responseData.createdAt || generatedAt,
        from: summaryFrom,
        to: summaryTo,
        dateFrom: summaryFrom,
        dateTo: summaryTo,
        file: fileName,
        fileName,
        filePath,
        downloadUrl,
        newFiles: fileCounts.new || 0,
        modifiedFiles: fileCounts.modified || 0,
        fileCount: (fileCounts.new || 0) + (fileCounts.modified || 0) + (fileCounts.unchanged || 0),
        newAssets: assetCounts.new || 0,
        modifiedAssets: assetCounts.modified || 0,
        newDatabaseRecords: databaseCounts.newRecords || 0,
        updatedDatabaseRecords: databaseCounts.updatedRecords || 0,
        databaseRecordCount: (databaseCounts.newRecords || 0) + (databaseCounts.updatedRecords || 0),
        packageSize: responseData.packageSize || 0,
        saveLocation: responseData.saveLocation || "backend/backup",
        status: "Complete"
      };

      const exactBackupPath = filePath.startsWith("backend/") ? filePath : `backend/${filePath}`;

      setSavedBackupLocation(exactBackupPath);
      setBackupSummary(nextSummary);
      setBackupHistory((previous) => {
        const nextHistory = [nextSummary, ...previous].slice(0, 5);
        if (typeof window !== "undefined") {
          localStorage.setItem("gfx-backup-history", JSON.stringify(nextHistory));
        }
        return nextHistory;
      });

      stopBackupProgress();
      setTimeout(() => {
        setBackupBusy(false);
        setBackupRemainingSeconds(0);
      }, 800);
    } catch (error) {
      console.error("Backup creation failed", error);
      if (backupProgressRef.current) {
        clearInterval(backupProgressRef.current);
        backupProgressRef.current = null;
      }
      setBackupBusy(false);
      setBackupProgress(0);
      setBackupRemainingSeconds(0);
      setBackupStatusText("Backup failed");
      setBackupStageIndex(0);
      toast.error(error.response?.data?.error || "Backup creation failed");
    }
  };

  const getStoredSocialLinks = () => {
    if (typeof window === "undefined") return DEFAULT_SOCIAL_LINKS;
    try {
      const stored = localStorage.getItem(SOCIAL_LINKS_STORAGE_KEY);
      if (!stored) return DEFAULT_SOCIAL_LINKS;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length >= 3) {
        return parsed.map((item) => ({
          platform: item?.platform || "",
          url: item?.url || ""
        }));
      }
    } catch (err) {
      console.error("Failed to load stored social links", err);
    }
    return DEFAULT_SOCIAL_LINKS;
  };
  const [socialLinks, setSocialLinks] = useState(getStoredSocialLinks);
  const [socialLinksMessage, setSocialLinksMessage] = useState("");

  const [accountForm, setAccountForm] = useState({
    full_name: localStorage.getItem("fullName") || "",
    email: localStorage.getItem("email") || "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [accountUserId, setAccountUserId] = useState(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");

  const [emailModal, setEmailModal] = useState(null);
  const [dailyReportPreviewOpen, setDailyReportPreviewOpen] = useState(Boolean(initialDailyReportPreviewPage || isDailyReportPreviewPath));
  const [dailyReportPreviewData, setDailyReportPreviewData] = useState(null);
  const [dailyReportPreviewLoading, setDailyReportPreviewLoading] = useState(false);
  const [dailyReportSmtpFormOpen, setDailyReportSmtpFormOpen] = useState(false);
  const [dailyReportSmtpSaving, setDailyReportSmtpSaving] = useState(false);
  const [dailyReportSmtpMessage, setDailyReportSmtpMessage] = useState('');
  const [dailyReportSmtpDraft, setDailyReportSmtpDraft] = useState({});
  const [dailyReportTestMailOpen, setDailyReportTestMailOpen] = useState(false);
  const [dailyReportTestMailRecipient, setDailyReportTestMailRecipient] = useState('');
  const [dailyReportSchedulingOpen, setDailyReportSchedulingOpen] = useState(false);
  const [dailyReportScheduleName, setDailyReportScheduleName] = useState("");
  const [dailyReportScheduleTime, setDailyReportScheduleTime] = useState("09:00");
  const [dailyReportScheduleFrequency, setDailyReportScheduleFrequency] = useState("daily");
  const [dailyReportScheduleEmail, setDailyReportScheduleEmail] = useState("");
  const [dailyReportScheduleSnapshot, setDailyReportScheduleSnapshot] = useState(null);
  const [dailyReportSchedules, setDailyReportSchedules] = useState([]);
  const [dailyReportSchedulesLoading, setDailyReportSchedulesLoading] = useState(false);
  const [dailyReportScheduleSaving, setDailyReportScheduleSaving] = useState(false);
  const [dailyReportScheduleMessage, setDailyReportScheduleMessage] = useState("");
  const [dailyReportSchedulePreviewData, setDailyReportSchedulePreviewData] = useState(null);
  const [dailyReportSchedulePreviewHtml, setDailyReportSchedulePreviewHtml] = useState("");
  const [dailyReportSchedulePreviewLoading, setDailyReportSchedulePreviewLoading] = useState(false);
  const [dailyReportSettingsMessage, setDailyReportSettingsMessage] = useState("");
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [dailyReportSettings, setDailyReportSettings] = useState({
    enabled: true,
    email: "",
    time: "09:00",
    metrics: {
      totalUsers: true,
      totalContributors: true,
      totalCustomers: true,
      totalAssets: true,
      liveAssets: true,
      pendingAssets: true,
      rejectedAssets: true,
      deletedAssetsLast30Days: true,
      totalOrders: true,
      failedOrders: true,
      paymentFailedCount: true,
      totalRevenueInr: true,
      totalDiscountInr: true,
      totalEarningsInr: true,
      totalDownloads: true,
      last24HoursDownloads: true,
      last7DaysDownloads: true,
      last30DaysDownloads: true,
      last365DaysDownloads: true,
      currentMonthDownloads: true,
      currentFyDownloads: true,
      newToday: true
    }
  });
  const [dailyReportSectionCollapsed, setDailyReportSectionCollapsed] = useState({
    websiteOverview: false,
    assetStatistics: false,
    downloads: false,
    salesRevenue: false,
    contributorStatistics: false,
    userActivity: false,
    systemAdmin: false,
    marketing: false
  });
  const [adminModal, setAdminModal] = useState(null);
  const [pricingSettings, setPricingSettings] = useState(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingMessage, setPricingMessage] = useState("");
  const [creditPrices, setCreditPrices] = useState({ 100: "100", 200: "200", 500: "500", 1000: "1000" });
  const [creditPriceMessage, setCreditPriceMessage] = useState("");
  const [creditPriceSaving, setCreditPriceSaving] = useState(false);
  const [creditPopup, setCreditPopup] = useState(null);
  const [requestedCredits, setRequestedCredits] = useState([]);
  const [requestedCreditsLoading, setRequestedCreditsLoading] = useState(false);
  const [requestedCreditsActionLoading, setRequestedCreditsActionLoading] = useState(false);
  const [currencyUpdateLoading, setCurrencyUpdateLoading] = useState(false);
  const DEFAULT_PRICING_CURRENCY_CODES = ['INR', 'USD', 'EUR'];
  const EXTRA_PRICING_CURRENCY_OPTIONS = ['GBP', 'AUD', 'CAD', 'CHF', 'JPY', 'SGD', 'AED', 'ZAR'];
  const [pricingCurrencyRows, setPricingCurrencyRows] = useState([
    { id: 'inr', code: 'INR', amount: '' },
    { id: 'usd', code: 'USD', amount: '' },
    { id: 'eur', code: 'EUR', amount: '' }
  ]);
  const [taxSettings, setTaxSettings] = useState([
    { enabled: true, type: 'percentage', rate: 18, label: 'GST', id: 1 }
  ]);
  const [invoiceTemplate, setInvoiceTemplate] = useState('Thank you for your purchase.\n\nOrder summary:\n- Asset: {{asset_name}}\n- Amount: {{amount}}\n- Currency: {{currency}}\n\nWe appreciate your business.');
  const [taxModalOpen, setTaxModalOpen] = useState(false);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [freeAssetSettings, setFreeAssetSettings] = useState(null);
  const [freeAssetLoading, setFreeAssetLoading] = useState(false);
  const [freeAssetMessage, setFreeAssetMessage] = useState("");
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [planForm, setPlanForm] = useState({
    name: "",
    short_description: "",
    icon: "",
    badge: "",
    color: "#2196f3",
    active: true,
    recommended: false,
    pricingAmount: "",
    pricingCurrency: "USD",
    duration: "monthly",
    durations: { monthly: true, "3_months": false, "6_months": false, "1_year": false, limited: false },
    durationPrices: { monthly: "", "3_months": "", "6_months": "", "1_year": "", limited: "" },
    startDate: "",
    endDate: "",
    downloads: ""
  });
  const [subscriptionMessage, setSubscriptionMessage] = useState("");
  const [subscriptionSubscribers, setSubscriptionSubscribers] = useState([]);
  const [planCurrencyPrices, setPlanCurrencyPrices] = useState({});
  const [customSubscriptions, setCustomSubscriptions] = useState([]);
  const [customSubscriptionForm, setCustomSubscriptionForm] = useState({
    customer_name: "",
    customer_email: "",
    base_plan: "",
    custom_pricing: "",
    status: "active"
  });
  const [customSubscriptionMessage, setCustomSubscriptionMessage] = useState("");

  const DEFAULT_CARD_ORDER = [
    "manage-categories",
    "website-branding",
    "profile-icons",
    "backup-restore",
    "active-collections",
    "company",
    "payment-gateway",
    "legal-resources",
    "social-media",
    "email-management",
    "daily-reports",
    "watermark-settings",
    "hero-banner-image",
    "hero-text-settings",
    "pricing-controls",
    "free-asset-settings",
    "subscription-plans",
    "custom-subscriptions",
    "otp-settings",
    "customer-banner",
    "credits",
    "credit-price-control"
  ];

  const normalizeCardOrder = (order) => {
    if (!Array.isArray(order)) return DEFAULT_CARD_ORDER;

    const unique = order.filter(Boolean);
    const merged = [...new Set(unique)];
    DEFAULT_CARD_ORDER.forEach((id) => {
      if (!merged.includes(id)) merged.push(id);
    });

    return merged.filter((id) => DEFAULT_CARD_ORDER.includes(id));
  };
  
  // Card layout editing state
  const [isLayoutEditMode, setIsLayoutEditMode] = useState(false);
  const [cardOrder, setCardOrder] = useState(DEFAULT_CARD_ORDER);
  const [layoutSaving, setLayoutSaving] = useState(false);
  
  const EMAIL_MODAL_TITLES = {
    settings: 'Email Configuration',
    templates: 'Email Templates',
    rules: 'Notification Rules',
    newsletter: 'Newsletter Manager',
    queue: 'Email Queue',
    logs: 'Email Logs',
    analytics: 'Email Analytics',
    scheduled: 'Scheduled Emails',
    dailyReportSettings: 'Daily Report Settings'
  };

  const buildDailyReportPreviewValues = (data) => {
    if (!data) return {};
    const formatNumber = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
    const formatCurrency = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

    return {
      totalUsers: formatNumber(data.totalUsers || 0),
      totalContributors: formatNumber(data.totalContributors || 0),
      totalCustomers: formatNumber(data.totalCustomers || 0),
      totalAdmins: formatNumber(data.totalAdmins || 0),
      pendingUsers: formatNumber(data.pendingUsers || 0),
      blockedUsers: formatNumber(data.blockedUsers || 0),
      activeContributors: formatNumber(data.activeContributors || 0),
      inactiveContributors: formatNumber(data.inactiveContributors || 0),
      pendingContributors: formatNumber(data.pendingContributors || 0),
      blockedContributors: formatNumber(data.blockedContributors || 0),
      deletedContributorsLast30Days: formatNumber(data.deletedContributorsLast30Days || 0),
      activeCustomers: formatNumber(data.activeCustomers || 0),
      inactiveCustomers: formatNumber(data.inactiveCustomers || 0),
      pendingCustomers: formatNumber(data.pendingCustomers || 0),
      blockedCustomers: formatNumber(data.blockedCustomers || 0),
      deletedCustomersLast30Days: formatNumber(data.deletedCustomersLast30Days || 0),
      totalAssets: formatNumber(data.totalAssets || 0),
      liveAssets: formatNumber(data.liveAssets || 0),
      collectionLiveAssets: Array.isArray(data.collectionLiveAssets) ? data.collectionLiveAssets : [],
      categoryLiveAssets: Array.isArray(data.categoryLiveAssets) ? data.categoryLiveAssets : [],
      typeLiveAssets: Array.isArray(data.typeLiveAssets) ? data.typeLiveAssets : [],
      pendingAssets: formatNumber(data.pendingAssets || 0),
      collectionPendingAssets: Array.isArray(data.collectionPendingAssets) ? data.collectionPendingAssets : [],
      categoryPendingAssets: Array.isArray(data.categoryPendingAssets) ? data.categoryPendingAssets : [],
      typePendingAssets: Array.isArray(data.typePendingAssets) ? data.typePendingAssets : [],
      rejectedAssets: formatNumber(data.rejectedAssets || 0),
      collectionRejectedAssets: Array.isArray(data.collectionRejectedAssets) ? data.collectionRejectedAssets : [],
      categoryRejectedAssets: Array.isArray(data.categoryRejectedAssets) ? data.categoryRejectedAssets : [],
      typeRejectedAssets: Array.isArray(data.typeRejectedAssets) ? data.typeRejectedAssets : [],
      deletedAssetsLast30Days: formatNumber(data.deletedAssetsLast30Days || 0),
      collectionDeletedAssetsLast30Days: Array.isArray(data.collectionDeletedAssetsLast30Days) ? data.collectionDeletedAssetsLast30Days : [],
      categoryDeletedAssetsLast30Days: Array.isArray(data.categoryDeletedAssetsLast30Days) ? data.categoryDeletedAssetsLast30Days : [],
      typeDeletedAssetsLast30Days: Array.isArray(data.typeDeletedAssetsLast30Days) ? data.typeDeletedAssetsLast30Days : [],
      totalOrders: formatNumber(data.totalOrders || 0),
      failedOrders: formatNumber(data.failedOrders || 0),
      paymentFailedCount: formatNumber(data.paymentFailedCount || 0),
      collectionTotalOrders: Array.isArray(data.collectionTotalOrders) ? data.collectionTotalOrders : [],
      categoryTotalOrders: Array.isArray(data.categoryTotalOrders) ? data.categoryTotalOrders : [],
      typeTotalOrders: Array.isArray(data.typeTotalOrders) ? data.typeTotalOrders : [],
      collectionFailedOrders: Array.isArray(data.collectionFailedOrders) ? data.collectionFailedOrders : [],
      categoryFailedOrders: Array.isArray(data.categoryFailedOrders) ? data.categoryFailedOrders : [],
      typeFailedOrders: Array.isArray(data.typeFailedOrders) ? data.typeFailedOrders : [],
      collectionPaymentFailedCount: Array.isArray(data.collectionPaymentFailedCount) ? data.collectionPaymentFailedCount : [],
      categoryPaymentFailedCount: Array.isArray(data.categoryPaymentFailedCount) ? data.categoryPaymentFailedCount : [],
      typePaymentFailedCount: Array.isArray(data.typePaymentFailedCount) ? data.typePaymentFailedCount : [],
      paymentFailedValue: formatCurrency(data.paymentFailedValue || 0),
      paymentFailedCurrencyBreakdown: Array.isArray(data.paymentFailedCurrencyBreakdown)
        ? data.paymentFailedCurrencyBreakdown.map((item) => ({ ...item, name: item.currency, count: item.total ?? item.count ?? 0 }))
        : [],
      totalRevenueInr: formatCurrency(data.totalRevenueInr || 0),
      totalDiscountInr: formatCurrency(data.totalDiscountInr || 0),
      totalEarningsInr: formatCurrency(data.totalEarningsInr || 0),
      ...Object.fromEntries([
        ['Last7Days', 'Last 7 Days'], ['Last30Days', 'Last 30 Days'], ['CurrentMonth', 'Current Month'], ['CurrentFy', 'Current FY'], ['Last365Days', 'Last 365 Days']
      ].flatMap(([suffix]) => [
        [`revenue${suffix}`, data[`revenue${suffix}`] || []],
        [`discount${suffix}`, data[`discount${suffix}`] || []],
        [`earnings${suffix}`, data[`earnings${suffix}`] || []]
      ])),
      earningsCurrencyBreakdown: Array.isArray(data.earningsCurrencyBreakdown)
        ? data.earningsCurrencyBreakdown.map((item) => ({
          ...item,
          name: item.currency,
          count: item.total ?? item.count ?? 0,
          collections: (item.collections || []).map((entry) => ({ ...entry, currency: item.currency })),
          categories: (item.categories || []).map((entry) => ({ ...entry, currency: item.currency })),
          type: (item.type || []).map((entry) => ({ ...entry, currency: item.currency }))
        }))
        : [],
      discountCurrencyBreakdown: Array.isArray(data.discountCurrencyBreakdown)
        ? data.discountCurrencyBreakdown.map((item) => ({
          ...item,
          name: item.currency,
          count: item.total ?? item.count ?? 0,
          collections: (item.collections || []).map((entry) => ({ ...entry, currency: item.currency })),
          categories: (item.categories || []).map((entry) => ({ ...entry, currency: item.currency })),
          type: (item.type || []).map((entry) => ({ ...entry, currency: item.currency }))
        }))
        : [],
      currencyRevenueBreakdown: Array.isArray(data.currencyRevenueBreakdown) ? data.currencyRevenueBreakdown : [],
      revenueCurrencyBreakdown: Array.isArray(data.revenueCurrencyBreakdown)
        ? data.revenueCurrencyBreakdown.map((item) => ({
          ...item,
          count: item.total ?? item.count ?? 0,
          collections: (item.collections || []).map((entry) => ({ ...entry, currency: item.currency })),
          categories: (item.categories || []).map((entry) => ({ ...entry, currency: item.currency })),
          type: (item.type || []).map((entry) => ({ ...entry, currency: item.currency }))
        }))
        : (Array.isArray(data.currencyRevenueBreakdown) ? data.currencyRevenueBreakdown.map((item) => ({ ...item, currency: item.currency || item.name, total: item.total ?? item.count ?? 0, count: item.total ?? item.count ?? 0 })) : []),
      collectionRevenueBreakdown: Array.isArray(data.collectionRevenueBreakdown) ? data.collectionRevenueBreakdown : [],
      categoryRevenueBreakdown: Array.isArray(data.categoryRevenueBreakdown) ? data.categoryRevenueBreakdown : [],
      typeRevenueBreakdown: Array.isArray(data.typeRevenueBreakdown) ? data.typeRevenueBreakdown : [],
      totalDownloads: formatNumber(data.totalDownloads || 0),
      collectionTotalDownloads: Array.isArray(data.collectionTotalDownloads) ? data.collectionTotalDownloads : [],
      categoryTotalDownloads: Array.isArray(data.categoryTotalDownloads) ? data.categoryTotalDownloads : [],
      typeTotalDownloads: Array.isArray(data.typeTotalDownloads) ? data.typeTotalDownloads : [],
      collectionLast24HoursDownloads: Array.isArray(data.collectionLast24HoursDownloads) ? data.collectionLast24HoursDownloads : [],
      categoryLast24HoursDownloads: Array.isArray(data.categoryLast24HoursDownloads) ? data.categoryLast24HoursDownloads : [],
      typeLast24HoursDownloads: Array.isArray(data.typeLast24HoursDownloads) ? data.typeLast24HoursDownloads : [],
      last24HoursDownloads: formatNumber(data.last24HoursDownloads || data.newToday || 0),
      last7DaysDownloads: formatNumber(data.last7DaysDownloads || 0),
      collectionLast7DaysDownloads: Array.isArray(data.collectionLast7DaysDownloads) ? data.collectionLast7DaysDownloads : [],
      categoryLast7DaysDownloads: Array.isArray(data.categoryLast7DaysDownloads) ? data.categoryLast7DaysDownloads : [],
      typeLast7DaysDownloads: Array.isArray(data.typeLast7DaysDownloads) ? data.typeLast7DaysDownloads : [],
      last30DaysDownloads: formatNumber(data.last30DaysDownloads || 0),
      collectionLast30DaysDownloads: Array.isArray(data.collectionLast30DaysDownloads) ? data.collectionLast30DaysDownloads : [],
      categoryLast30DaysDownloads: Array.isArray(data.categoryLast30DaysDownloads) ? data.categoryLast30DaysDownloads : [],
      typeLast30DaysDownloads: Array.isArray(data.typeLast30DaysDownloads) ? data.typeLast30DaysDownloads : [],
      last365DaysDownloads: formatNumber(data.last365DaysDownloads || 0),
      collectionLast365DaysDownloads: Array.isArray(data.collectionLast365DaysDownloads) ? data.collectionLast365DaysDownloads : [],
      categoryLast365DaysDownloads: Array.isArray(data.categoryLast365DaysDownloads) ? data.categoryLast365DaysDownloads : [],
      typeLast365DaysDownloads: Array.isArray(data.typeLast365DaysDownloads) ? data.typeLast365DaysDownloads : [],
      currentMonthDownloads: formatNumber(data.currentMonthDownloads || 0),
      collectionCurrentMonthDownloads: Array.isArray(data.collectionCurrentMonthDownloads) ? data.collectionCurrentMonthDownloads : [],
      categoryCurrentMonthDownloads: Array.isArray(data.categoryCurrentMonthDownloads) ? data.categoryCurrentMonthDownloads : [],
      typeCurrentMonthDownloads: Array.isArray(data.typeCurrentMonthDownloads) ? data.typeCurrentMonthDownloads : [],
      currentFyDownloads: formatNumber(data.currentFyDownloads || 0),
      collectionCurrentFyDownloads: Array.isArray(data.collectionCurrentFyDownloads) ? data.collectionCurrentFyDownloads : [],
      categoryCurrentFyDownloads: Array.isArray(data.categoryCurrentFyDownloads) ? data.categoryCurrentFyDownloads : [],
      typeCurrentFyDownloads: Array.isArray(data.typeCurrentFyDownloads) ? data.typeCurrentFyDownloads : [],
      newToday: formatNumber(data.last24HoursDownloads || data.newToday || 0)
    };
  };

  const renderSummaryBreakdownList = ({ title, items, isDarkMode, formatValue }) => {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    const formatBreakdownCount = (value, item) => {
      const numericValue = Number(String(value ?? 0).replace(/,/g, ''));
      if (!Number.isFinite(numericValue)) return '0';
      if (typeof formatValue === 'function') return formatValue(numericValue, item);
      return Math.round(numericValue).toLocaleString('en-US');
    };

    return (
      <div style={{
        marginTop: 10,
        padding: '10px 10px 8px',
        borderRadius: 10,
        border: isDarkMode ? '1px solid rgba(96,165,250,0.18)' : '1px solid rgba(37,99,235,0.12)',
        background: isDarkMode ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.72)',
        boxShadow: isDarkMode ? 'inset 0 1px 0 rgba(148,163,184,0.08)' : 'inset 0 1px 0 rgba(255,255,255,0.45)'
      }}>
        <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: isDarkMode ? '#bfdbfe' : '#1d4ed8', marginBottom: 6 }}>{title}:</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: isDarkMode ? '#dbeafe' : '#334155', lineHeight: 1.55, fontSize: 11 }}>
          {items.map((item) => (
            <li key={item.name || item.label || `${title}-${item.count}`} style={{ marginBottom: 2 }}>
              {item.name || item.label || 'Value'}: {formatBreakdownCount(item.count ?? item.value, item)}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderDailyReportBreakdowns = (rowKey) => {
    const breakdowns = {
      liveAssets: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionLiveAssets],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryLiveAssets],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeLiveAssets]
      ],
      pendingAssets: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionPendingAssets],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryPendingAssets],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typePendingAssets]
      ],
      rejectedAssets: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionRejectedAssets],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryRejectedAssets],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeRejectedAssets]
      ],
      deletedAssetsLast30Days: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionDeletedAssetsLast30Days],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryDeletedAssetsLast30Days],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeDeletedAssetsLast30Days]
      ],
      last24HoursDownloads: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionLast24HoursDownloads],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryLast24HoursDownloads],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeLast24HoursDownloads]
      ],
      last7DaysDownloads: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionLast7DaysDownloads],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryLast7DaysDownloads],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeLast7DaysDownloads]
      ],
      last30DaysDownloads: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionLast30DaysDownloads],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryLast30DaysDownloads],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeLast30DaysDownloads]
      ],
      last365DaysDownloads: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionLast365DaysDownloads],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryLast365DaysDownloads],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeLast365DaysDownloads]
      ],
      currentMonthDownloads: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionCurrentMonthDownloads],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryCurrentMonthDownloads],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeCurrentMonthDownloads]
      ],
      currentFyDownloads: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionCurrentFyDownloads],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryCurrentFyDownloads],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeCurrentFyDownloads]
      ],
      totalDownloads: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionTotalDownloads],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryTotalDownloads],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeTotalDownloads]
      ],
      totalOrders: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionTotalOrders],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryTotalOrders],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeTotalOrders]
      ],
      failedOrders: [
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionFailedOrders],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryFailedOrders],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeFailedOrders]
      ],
      paymentFailedCount: [
        ...(DAILY_REPORT_PREVIEW_VALUES.paymentFailedCurrencyBreakdown || []).flatMap((currencyBreakdown) => [
          [currencyBreakdown.currency, [{ name: currencyBreakdown.currency, count: currencyBreakdown.total ?? currencyBreakdown.count ?? 0, currency: currencyBreakdown.currency }]],
          ['Collections', (currencyBreakdown.collections || []).map((item) => ({ ...item, currency: currencyBreakdown.currency }))],
          ['Categories', (currencyBreakdown.categories || []).map((item) => ({ ...item, currency: currencyBreakdown.currency }))],
          ['Type', (currencyBreakdown.type || []).map((item) => ({ ...item, currency: currencyBreakdown.currency }))]
        ])
      ],
      totalUsers: [['Users', [
        { name: 'Customers', count: DAILY_REPORT_PREVIEW_VALUES.totalCustomers },
        { name: 'Admins', count: DAILY_REPORT_PREVIEW_VALUES.totalAdmins },
        { name: 'Contributors', count: DAILY_REPORT_PREVIEW_VALUES.totalContributors },
        { name: 'Pending Users', count: DAILY_REPORT_PREVIEW_VALUES.pendingUsers },
        { name: 'Blocked Users', count: DAILY_REPORT_PREVIEW_VALUES.blockedUsers }
      ]]],
      totalAssets: [['Assets', [
        { name: 'Live Assets', count: DAILY_REPORT_PREVIEW_VALUES.liveAssets },
        { name: 'Pending Assets', count: DAILY_REPORT_PREVIEW_VALUES.pendingAssets },
        { name: 'Rejected Assets', count: DAILY_REPORT_PREVIEW_VALUES.rejectedAssets },
        { name: 'Deleted Assets (Last 30 Days)', count: DAILY_REPORT_PREVIEW_VALUES.deletedAssetsLast30Days }
      ]]],
      totalRevenueInr: [
        ['Currencies', DAILY_REPORT_PREVIEW_VALUES.revenueCurrencyBreakdown],
        ['Collections', DAILY_REPORT_PREVIEW_VALUES.collectionRevenueBreakdown],
        ['Categories', DAILY_REPORT_PREVIEW_VALUES.categoryRevenueBreakdown],
        ['Type', DAILY_REPORT_PREVIEW_VALUES.typeRevenueBreakdown]
      ],
      totalContributors: [['Contributor Status', [
        { name: 'Active', count: DAILY_REPORT_PREVIEW_VALUES.activeContributors },
        { name: 'Inactive', count: DAILY_REPORT_PREVIEW_VALUES.inactiveContributors },
        { name: 'Pending', count: DAILY_REPORT_PREVIEW_VALUES.pendingContributors },
        { name: 'Blocked', count: DAILY_REPORT_PREVIEW_VALUES.blockedContributors },
        { name: 'Deleted (Last 30 Days)', count: DAILY_REPORT_PREVIEW_VALUES.deletedContributorsLast30Days }
      ]]],
      totalCustomers: [['Customer Status', [
        { name: 'Active', count: DAILY_REPORT_PREVIEW_VALUES.activeCustomers },
        { name: 'Inactive', count: DAILY_REPORT_PREVIEW_VALUES.inactiveCustomers },
        { name: 'Pending', count: DAILY_REPORT_PREVIEW_VALUES.pendingCustomers },
        { name: 'Blocked', count: DAILY_REPORT_PREVIEW_VALUES.blockedCustomers },
        { name: 'Deleted (Last 30 Days)', count: DAILY_REPORT_PREVIEW_VALUES.deletedCustomersLast30Days }
      ]]]
    }[rowKey];

    const visibleBreakdowns = (breakdowns || []).filter(([, items]) => Array.isArray(items) && items.length > 0);
    const financialWindowMatch = rowKey.match(/^(revenue|discount|earnings)(Last7Days|Last30Days|CurrentMonth|CurrentFy|Last365Days)$/);
    if (visibleBreakdowns.length === 0 && rowKey !== 'totalRevenueInr' && rowKey !== 'totalDiscountInr' && rowKey !== 'totalEarningsInr' && !financialWindowMatch) return null;

    const formatRevenueValue = (value) => {
      const amount = Number(value || 0);
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 2
      }).format(amount);
    };
    const formatCurrencyValue = (value, item = {}) => new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(item.currency || 'USD').toUpperCase(),
      maximumFractionDigits: 2
    }).format(Number(value || 0));

    if (financialWindowMatch) {
      const currencySections = DAILY_REPORT_PREVIEW_VALUES[rowKey] || [];
      return (
        <div style={{ display: 'grid', gap: 8, marginTop: 10, maxHeight: 176, overflowY: 'auto', paddingRight: 4, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5 }}>
          {renderSummaryBreakdownList({ title: 'Currencies', items: currencySections, isDarkMode, formatValue: formatCurrencyValue })}
          {currencySections.map((currencySection) => (
            <div key={currencySection.currency}>
              <div style={{ fontWeight: 800, fontSize: 12, color: isDarkMode ? '#bfdbfe' : '#1d4ed8', marginTop: 4 }}>{currencySection.currency}</div>
              {renderSummaryBreakdownList({ title: 'Collections', items: currencySection.collections, isDarkMode, formatValue: formatCurrencyValue })}
              {renderSummaryBreakdownList({ title: 'Categories', items: currencySection.categories, isDarkMode, formatValue: formatCurrencyValue })}
              {renderSummaryBreakdownList({ title: 'Type', items: currencySection.type, isDarkMode, formatValue: formatCurrencyValue })}
            </div>
          ))}
        </div>
      );
    }

    if (rowKey === 'totalRevenueInr') {
      const currencySections = DAILY_REPORT_PREVIEW_VALUES.revenueCurrencyBreakdown || [];
      return (
        <div style={{ display: 'grid', gap: 8, marginTop: 10, maxHeight: 176, overflowY: 'auto', paddingRight: 4, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5 }}>
          {renderSummaryBreakdownList({ title: 'Currencies', items: DAILY_REPORT_PREVIEW_VALUES.revenueCurrencyBreakdown, isDarkMode, formatValue: formatCurrencyValue })}
          {currencySections.map((currencySection) => (
            <div key={currencySection.currency}>
              <div style={{ fontWeight: 800, fontSize: 12, color: isDarkMode ? '#bfdbfe' : '#1d4ed8', marginTop: 4 }}>{currencySection.currency}</div>
              {renderSummaryBreakdownList({ title: 'Collections', items: currencySection.collections, isDarkMode, formatValue: formatCurrencyValue })}
              {renderSummaryBreakdownList({ title: 'Categories', items: currencySection.categories, isDarkMode, formatValue: formatCurrencyValue })}
              {renderSummaryBreakdownList({ title: 'Type', items: currencySection.type, isDarkMode, formatValue: formatCurrencyValue })}
            </div>
          ))}
        </div>
      );
    }

    if (rowKey === 'totalDiscountInr') {
      const currencySections = DAILY_REPORT_PREVIEW_VALUES.discountCurrencyBreakdown || [];
      return (
        <div style={{ display: 'grid', gap: 8, marginTop: 10, maxHeight: 176, overflowY: 'auto', paddingRight: 4, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5 }}>
          {renderSummaryBreakdownList({ title: 'Currencies', items: currencySections, isDarkMode, formatValue: formatCurrencyValue })}
          {currencySections.map((currencySection) => (
            <div key={currencySection.currency}>
              <div style={{ fontWeight: 800, fontSize: 12, color: isDarkMode ? '#bfdbfe' : '#1d4ed8', marginTop: 4 }}>{currencySection.currency}</div>
              {renderSummaryBreakdownList({ title: 'Collections', items: currencySection.collections, isDarkMode, formatValue: formatCurrencyValue })}
              {renderSummaryBreakdownList({ title: 'Categories', items: currencySection.categories, isDarkMode, formatValue: formatCurrencyValue })}
              {renderSummaryBreakdownList({ title: 'Type', items: currencySection.type, isDarkMode, formatValue: formatCurrencyValue })}
            </div>
          ))}
        </div>
      );
    }

    if (rowKey === 'totalEarningsInr') {
      const currencySections = DAILY_REPORT_PREVIEW_VALUES.earningsCurrencyBreakdown || [];
      return (
        <div style={{ display: 'grid', gap: 8, marginTop: 10, maxHeight: 176, overflowY: 'auto', paddingRight: 4, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5 }}>
          {renderSummaryBreakdownList({ title: 'Currencies', items: currencySections, isDarkMode, formatValue: formatCurrencyValue })}
          {currencySections.map((currencySection) => (
            <div key={currencySection.currency}>
              <div style={{ fontWeight: 800, fontSize: 12, color: isDarkMode ? '#bfdbfe' : '#1d4ed8', marginTop: 4 }}>{currencySection.currency}</div>
              {renderSummaryBreakdownList({ title: 'Collections', items: currencySection.collections, isDarkMode, formatValue: formatCurrencyValue })}
              {renderSummaryBreakdownList({ title: 'Categories', items: currencySection.categories, isDarkMode, formatValue: formatCurrencyValue })}
              {renderSummaryBreakdownList({ title: 'Type', items: currencySection.type, isDarkMode, formatValue: formatCurrencyValue })}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div style={{
        display: 'grid',
        gap: 4,
        marginTop: 10,
        maxHeight: 176,
        overflowY: 'auto',
        paddingRight: 4,
        color: isDarkMode ? '#cbd5e1' : '#475569',
        fontSize: 12,
        lineHeight: 1.5
      }}>
        {visibleBreakdowns.map(([title, items]) => renderSummaryBreakdownList({
          title,
          items,
          isDarkMode,
          formatValue: (rowKey === 'paymentFailedCount' || (rowKey === 'totalRevenueInr' && title === 'Currencies')) && items.some((item) => item.currency)
            ? formatCurrencyValue
            : rowKey === 'totalRevenueInr' && (title === 'Currencies' || title === 'Collections' || title === 'Categories' || title === 'Type')
              ? formatRevenueValue
            : undefined
        }))}
      </div>
    );
  };

  const toggleDailyReportSection = (key) => {
    setDailyReportSectionCollapsed((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const renderDailyReportSection = ({ key, title, options }) => {
    const isCollapsed = Boolean(dailyReportSectionCollapsed[key]);

    return (
      <React.Fragment key={key}>
        <div style={{ display: 'grid', gap: 12 }}>
          <button
            type="button"
            onClick={() => toggleDailyReportSection(key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '12px 14px',
              borderRadius: 10,
              border: isDarkMode ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(15,23,42,0.12)',
              background: isDarkMode ? 'rgba(15, 23, 42, 0.78)' : '#f8fafc',
              color: isDarkMode ? '#f8fafc' : '#0f172a',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 14,
              textAlign: 'left'
            }}
            aria-expanded={!isCollapsed}
          >
            <span>{title}</span>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{isCollapsed ? '▸' : '▾'}</span>
          </button>

          {!isCollapsed && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              {options.map(({ key: optionKey, label }, index) => (
                <label key={`${key}-${optionKey}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: isDarkMode ? 'rgba(15, 23, 42, 0.8)' : '#f8fafc', border: isDarkMode ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.08)', minHeight: 54 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(dailyReportSettings.metrics?.[optionKey])}
                    onChange={(e) => setDailyReportSettings((prev) => ({
                      ...prev,
                      metrics: {
                        ...prev.metrics,
                        [optionKey]: e.target.checked
                      }
                    }))}
                    aria-label={label}
                    style={{ width: 18, height: 18, accentColor: '#2563eb', flexShrink: 0 }}
                  />
                  <span style={{ color: isDarkMode ? '#e2e8f0' : '#0f172a', lineHeight: 1.35, fontSize: 13 }}>{label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div style={{ borderTop: isDarkMode ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.12)', margin: '16px 0 12px' }} />
      </React.Fragment>
    );
  };

  const saveDailyReportSettings = async () => {
    try {
      setDailyReportSettingsMessage('Saving settings...');
      const token = getEffectiveAuthToken();
      const response = await axios.post('/admin/email/daily-report-settings', dailyReportSettings, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (response.data?.ok) {
        if (response.data.settings) {
          setDailyReportSettings(response.data.settings);
        }
        setDailyReportSettingsMessage('Settings saved successfully.');
        toast.success('Daily report settings saved successfully.');
      }
    } catch (err) {
      console.error('Failed to save daily report settings:', err);
      setDailyReportSettingsMessage('Failed to save settings. Please try again.');
      toast.error('Failed to save daily report settings.');
    }
  };

  const loadDailyReportSettings = async () => {
    try {
      const token = getEffectiveAuthToken();
      const response = await axios.get('/admin/email/daily-report-settings', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (response.data?.ok && response.data.settings) {
        const settings = response.data.settings;
        const mergedSettings = {
          ...settings,
          metrics: {
            ...dailyReportSettings.metrics,
            ...(settings.metrics || {}),
            failedOrders: settings.metrics?.failedOrders ?? true,
            paymentFailedCount: settings.metrics?.paymentFailedCount ?? true,
            totalDiscountInr: settings.metrics?.totalDiscountInr ?? true,
            totalEarningsInr: settings.metrics?.totalEarningsInr ?? true,
            revenueLast7Days: settings.metrics?.revenueLast7Days ?? true,
            discountLast7Days: settings.metrics?.discountLast7Days ?? true,
            earningsLast7Days: settings.metrics?.earningsLast7Days ?? true,
            revenueLast30Days: settings.metrics?.revenueLast30Days ?? true,
            discountLast30Days: settings.metrics?.discountLast30Days ?? true,
            earningsLast30Days: settings.metrics?.earningsLast30Days ?? true,
            revenueCurrentMonth: settings.metrics?.revenueCurrentMonth ?? true,
            discountCurrentMonth: settings.metrics?.discountCurrentMonth ?? true,
            earningsCurrentMonth: settings.metrics?.earningsCurrentMonth ?? true,
            revenueCurrentFy: settings.metrics?.revenueCurrentFy ?? true,
            discountCurrentFy: settings.metrics?.discountCurrentFy ?? true,
            earningsCurrentFy: settings.metrics?.earningsCurrentFy ?? true,
            revenueLast365Days: settings.metrics?.revenueLast365Days ?? true,
            discountLast365Days: settings.metrics?.discountLast365Days ?? true,
            earningsLast365Days: settings.metrics?.earningsLast365Days ?? true
          }
        };
        setDailyReportSettings((prev) => ({ ...prev, ...mergedSettings }));
        return mergedSettings;
      }
    } catch (err) {
      console.error('Failed to load daily report settings:', err);
    }
    return null;
  };

  const openDailyReportPreview = async () => {
    const settings = await loadDailyReportSettings();
    if (settings && settings.enabled === false) {
      toast.info('Daily report is disabled. Enable it in Daily Report Settings first.');
      return;
    }
    setDailyReportPreviewData(null);
    setDailyReportPreviewOpen(true);
    setDailyReportPreviewPageOpen(true);
    if (typeof window !== "undefined") {
      const dailyReportPreviewUrl = `${adminBasePath}/email/daily-report-preview?tab=controls`;
      window.history.pushState({}, "", dailyReportPreviewUrl);
      setCurrentWindowPath(dailyReportPreviewUrl.replace(/\?.*$/, ""));
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };

  const closeDailyReportPreview = () => {
    setDailyReportPreviewOpen(false);
    setDailyReportPreviewPageOpen(false);
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", `${adminBasePath}?tab=controls`);
      setCurrentWindowPath(adminBasePath);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };

  const fetchDailyReportPreviewData = async () => {
    try {
      setDailyReportPreviewLoading(true);
      const token = localStorage.getItem('token');
      const response = await axios.get('/admin/email/daily-report-preview', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const summary = response.data?.summary ?? response.data;
      if (summary && (response.data?.ok !== false)) {
        setDailyReportPreviewData(summary);
      }
    } catch (err) {
      console.error('Failed to fetch daily report preview:', err);
    } finally {
      setDailyReportPreviewLoading(false);
    }
  };

  const openDailyReportSmtpForm = async () => {
    const loadedSettings = await loadDailyReportSettings();
    setDailyReportSmtpDraft({ ...((loadedSettings || dailyReportSettings).reportSmtp || {}) });
    setDailyReportSmtpMessage('');
    setDailyReportSmtpFormOpen(true);
  };

  const saveDailyReportSmtpSettings = async () => {
    try {
      setDailyReportSmtpSaving(true);
      setDailyReportSmtpMessage('Saving daily report SMTP settings...');
      const token = getEffectiveAuthToken();
      const response = await axios.post('/admin/email/daily-report-settings', {
        ...dailyReportSettings,
        reportSmtp: { ...dailyReportSmtpDraft }
      }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (response.data?.settings) setDailyReportSettings(response.data.settings);
      setDailyReportSmtpMessage('Daily report SMTP settings saved.');
    } catch (err) {
      setDailyReportSmtpMessage(err.response?.data?.error || 'Failed to save daily report SMTP settings.');
    } finally {
      setDailyReportSmtpSaving(false);
    }
  };

  const verifyDailyReportSmtpSettings = async () => {
    try {
      setDailyReportSmtpSaving(true);
      setDailyReportSmtpMessage('Verifying daily report SMTP settings...');
      const token = getEffectiveAuthToken();
      await axios.post('/admin/email/verify', { ...dailyReportSmtpDraft }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      setDailyReportSmtpMessage('Daily report SMTP settings verified successfully.');
    } catch (err) {
      setDailyReportSmtpMessage(err.response?.data?.error || err.response?.data?.detail || 'Failed to verify daily report SMTP settings.');
    } finally {
      setDailyReportSmtpSaving(false);
    }
  };

  const sendDailyReportNow = async () => {
    const recipient = String(dailyReportTestMailRecipient || '').trim();
    if (!recipient) {
      setDailyReportSmtpMessage('Enter a recipient email before sending the test mail.');
      return;
    }

    try {
      setDailyReportSmtpSaving(true);
      setDailyReportSmtpMessage('Sending test mail...');
      const token = getEffectiveAuthToken();
      const previewResponse = await axios.get('/admin/email/daily-report-preview', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      await axios.post('/admin/email/send-test', {
        ...dailyReportSmtpDraft,
        to: recipient,
        subject: previewResponse.data?.subject || 'GFXunlimit Daily Report',
        body: previewResponse.data?.html || '<p>Daily report preview unavailable.</p>'
      }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      setDailyReportSmtpMessage('Test mail sent successfully.');
      setDailyReportTestMailOpen(false);
    } catch (err) {
      setDailyReportSmtpMessage(err.response?.data?.error || 'Failed to send daily report.');
    } finally {
      setDailyReportSmtpSaving(false);
    }
  };

  useEffect(() => {
    if (dailyReportPreviewOpen && !dailyReportPreviewData) {
      fetchDailyReportPreviewData();
    }
  }, [dailyReportPreviewOpen, dailyReportPreviewData]);

  useEffect(() => {
    if (emailModal === 'dailyReportSettings' || isDailyReportSettingsRouteOpen) {
      setDailyReportSettingsMessage('');
      loadDailyReportSettings();
    }
  }, [emailModal, isDailyReportSettingsRouteOpen]);

  const loadDailyReportSchedules = async () => {
    try {
      setDailyReportSchedulesLoading(true);
      const token = getEffectiveAuthToken();
      const response = await axios.get('/admin/email/daily-report-schedules', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      setDailyReportSchedules(response.data.schedules || []);
    } catch (err) {
      console.error('Error loading schedules:', err);
    } finally {
      setDailyReportSchedulesLoading(false);
    }
  };

  const previewSavedDailyReport = async (schedule) => {
    try {
      setDailyReportSchedulePreviewLoading(true);
      const token = getEffectiveAuthToken();
      const response = await axios.get(`${API_BASE_URL}/admin/email/daily-report-preview?scheduleId=${encodeURIComponent(schedule.id)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      setDailyReportSchedulePreviewHtml(response.data?.html || "");
      setDailyReportSchedulePreviewData(response.data?.summary ?? response.data);
    } catch (err) {
      setDailyReportScheduleMessage(err.response?.data?.error || 'Failed to load saved schedule preview');
    } finally {
      setDailyReportSchedulePreviewLoading(false);
    }
  };

  const saveDailyReportSchedule = async () => {
    if (!dailyReportScheduleName.trim()) {
      setDailyReportScheduleMessage('Please enter a schedule name');
      return;
    }

    try {
      setDailyReportScheduleSaving(true);
      setDailyReportScheduleMessage('');
      const scheduleSettings = dailyReportScheduleSnapshot || dailyReportSettings;

      if (editingScheduleId) {
        const token = getEffectiveAuthToken();
        await axios.put(`/admin/email/daily-report-schedules/${editingScheduleId}`, {
          name: dailyReportScheduleName,
          time: dailyReportScheduleTime,
          frequency: dailyReportScheduleFrequency,
          reportSettings: {
            enabled: scheduleSettings.enabled,
            email: dailyReportScheduleEmail || scheduleSettings.email,
            time: dailyReportScheduleTime,
            metrics: { ...(scheduleSettings.metrics || {}) },
            reportSmtp: { ...(scheduleSettings.reportSmtp || {}) }
          }
        }, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        setDailyReportScheduleMessage('Schedule updated successfully');
      } else {
        const token = getEffectiveAuthToken();
        await axios.post('/admin/email/daily-report-schedules', {
          name: dailyReportScheduleName,
          time: dailyReportScheduleTime,
          frequency: dailyReportScheduleFrequency,
          reportSettings: {
            enabled: scheduleSettings.enabled,
            email: dailyReportScheduleEmail || scheduleSettings.email,
            time: dailyReportScheduleTime,
            metrics: { ...(scheduleSettings.metrics || {}) },
            reportSmtp: { ...(scheduleSettings.reportSmtp || {}) }
          }
        }, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        setDailyReportScheduleMessage('Schedule saved successfully');
      }

      setDailyReportScheduleName('');
      setDailyReportScheduleTime('09:00');
      setDailyReportScheduleFrequency('daily');
      setDailyReportScheduleEmail('');
      setDailyReportScheduleSnapshot(null);
      setEditingScheduleId(null);
      await loadDailyReportSchedules();
    } catch (err) {
      console.error('Error saving schedule:', err);
      setDailyReportScheduleMessage('Failed to save schedule');
    } finally {
      setDailyReportScheduleSaving(false);
    }
  };

  const deleteSchedule = async (id) => {
    if (!window.confirm('Delete this schedule?')) return;
    try {
      const token = getEffectiveAuthToken();
      await axios.delete(`/admin/email/daily-report-schedules/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      await loadDailyReportSchedules();
    } catch (err) {
      console.error('Error deleting schedule:', err);
    }
  };

  const startEditSchedule = (schedule) => {
    const scheduleSettings = schedule.report_settings || {};
    setEditingScheduleId(schedule.id);
    setDailyReportScheduleName(schedule.name);
    setDailyReportScheduleTime(schedule.time);
    setDailyReportScheduleFrequency(schedule.frequency);
    setDailyReportScheduleEmail(scheduleSettings.email || "");
    setDailyReportScheduleSnapshot(null);
    setDailyReportSettings((previous) => ({
      ...previous,
      enabled: scheduleSettings.enabled ?? previous.enabled,
      email: scheduleSettings.email || previous.email,
      time: scheduleSettings.time || previous.time,
      metrics: {
        ...(previous.metrics || {}),
        ...(scheduleSettings.metrics || {})
      },
      reportSmtp: {
        ...(previous.reportSmtp || {}),
        ...(scheduleSettings.reportSmtp || {})
      }
    }));
  };

  const openDailyReportScheduleFromPreview = () => {
    const snapshot = {
      enabled: dailyReportSettings.enabled,
      email: dailyReportSettings.email,
      metrics: { ...(dailyReportSettings.metrics || {}) },
      reportSmtp: { ...(dailyReportSettings.reportSmtp || {}) }
    };
    setDailyReportScheduleSnapshot(snapshot);
    setDailyReportScheduleEmail(snapshot.email || "");
    setDailyReportScheduleName(`Daily Report ${dailyReportScheduleTime}`);
    setDailyReportScheduleFrequency("daily");
    setEditingScheduleId(null);
    setDailyReportSchedulingOpen(true);
  };

  useEffect(() => {
    if (dailyReportSchedulingOpen) {
      loadDailyReportSchedules();
      loadDailyReportSettings();
    }
  }, [dailyReportSchedulingOpen]);

  const renderDailyReportSettingsContent = () => (
    <div role="dialog" aria-modal="true" aria-label="Daily Report Settings" onClick={(e) => e.stopPropagation()} style={{ display: 'grid', gap: 18, maxHeight: isDailyReportSettingsPage ? 'none' : '72vh', overflowY: isDailyReportSettingsPage ? 'visible' : 'auto', paddingRight: 4 }}>
      <h3 style={{ margin: 0, color: isDarkMode ? '#f8fafc' : '#0f172a' }}>Daily Report Settings</h3>

      {dailyReportSettingsMessage && (
        <div role="status" style={{ color: dailyReportSettingsMessage.startsWith('Failed') ? '#b91c1c' : '#166534', fontSize: 13, fontWeight: 600 }}>
          {dailyReportSettingsMessage}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => {
            const allSectionKeys = [
              'websiteOverview',
              'assetStatistics',
              'downloads',
              'salesRevenue',
              'contributorStatistics',
              'userActivity',
              'systemAdmin',
              'marketing',
              'general'
            ];

            setDailyReportSectionCollapsed((prev) => {
              const next = { ...prev };
              allSectionKeys.forEach((key) => {
                next[key] = true;
              });
              return next;
            });
          }}
          style={{
            padding: '6px 10px',
            borderRadius: 999,
            border: isDarkMode ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(15,23,42,0.1)',
            background: isDarkMode ? 'rgba(148,163,184,0.08)' : '#f8fafc',
            color: isDarkMode ? '#f8fafc' : '#0f172a',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 11,
            lineHeight: 1.2
          }}
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={() => {
            const allSectionKeys = [
              'websiteOverview',
              'assetStatistics',
              'downloads',
              'salesRevenue',
              'contributorStatistics',
              'userActivity',
              'systemAdmin',
              'marketing',
              'general'
            ];

            setDailyReportSectionCollapsed((prev) => {
              const next = { ...prev };
              allSectionKeys.forEach((key) => {
                next[key] = false;
              });
              return next;
            });
          }}
          style={{
            padding: '6px 10px',
            borderRadius: 999,
            border: isDarkMode ? '1px solid rgba(96,165,250,0.35)' : '1px solid rgba(37,99,235,0.18)',
            background: isDarkMode ? 'rgba(37,99,235,0.12)' : '#eff6ff',
            color: isDarkMode ? '#dbeafe' : '#1d4ed8',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 11,
            lineHeight: 1.2,
            boxShadow: isDarkMode ? 'inset 0 0 0 1px rgba(96,165,250,0.15)' : 'none'
          }}
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => setDailyReportSettings((prev) => ({
            ...prev,
            metrics: Object.fromEntries(ALL_DAILY_REPORT_OPTIONS.map(({ key }) => [key, true]))
          }))}
          style={{
            padding: '6px 10px',
            borderRadius: 999,
            border: isDarkMode ? '1px solid rgba(96,165,250,0.35)' : '1px solid rgba(37,99,235,0.18)',
            background: isDarkMode ? 'rgba(37,99,235,0.12)' : '#eff6ff',
            color: isDarkMode ? '#dbeafe' : '#1d4ed8',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 11,
            lineHeight: 1.2,
            boxShadow: isDarkMode ? 'inset 0 0 0 1px rgba(96,165,250,0.15)' : 'none'
          }}
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => setDailyReportSettings((prev) => ({
            ...prev,
            metrics: Object.fromEntries(ALL_DAILY_REPORT_OPTIONS.map(({ key }) => [key, false]))
          }))}
          style={{
            padding: '6px 10px',
            borderRadius: 999,
            border: isDarkMode ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(15,23,42,0.1)',
            background: isDarkMode ? 'rgba(148,163,184,0.08)' : '#f8fafc',
            color: isDarkMode ? '#f8fafc' : '#0f172a',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 11,
            lineHeight: 1.2
          }}
        >
          None
        </button>
      </div>

      {[
        { key: 'websiteOverview', title: 'Website Overview', options: WEBSITE_OVERVIEW_OPTIONS },
        { key: 'assetStatistics', title: 'Asset Statistics', options: ASSET_STATISTICS_OPTIONS },
        { key: 'downloads', title: 'Downloads', options: DOWNLOADS_OPTIONS },
        { key: 'salesRevenue', title: 'Sales / Revenue', options: SALES_REVENUE_OPTIONS },
        { key: 'contributorStatistics', title: 'Contributor Statistics', options: CONTRIBUTOR_STATISTICS_OPTIONS },
        { key: 'userActivity', title: 'User Activity', options: USER_ACTIVITY_OPTIONS },
        { key: 'systemAdmin', title: 'System / Admin', options: SYSTEM_ADMIN_OPTIONS },
        { key: 'marketing', title: 'Marketing', options: MARKETING_OPTIONS }
      ].map((section) => (
        <React.Fragment key={section.key}>
          {renderDailyReportSection(section)}
        </React.Fragment>
      ))}

      <div style={{ display: 'grid', gap: 12 }}>
        <button
          type="button"
          onClick={() => toggleDailyReportSection('general')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '12px 14px',
            borderRadius: 10,
            border: isDarkMode ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(15,23,42,0.12)',
            background: isDarkMode ? 'rgba(15, 23, 42, 0.78)' : '#f8fafc',
            color: isDarkMode ? '#f8fafc' : '#0f172a',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 14,
            textAlign: 'left'
          }}
          aria-expanded={!Boolean(dailyReportSectionCollapsed.general)}
        >
          <span>General</span>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{Boolean(dailyReportSectionCollapsed.general) ? '▸' : '▾'}</span>
        </button>

        {!Boolean(dailyReportSectionCollapsed.general) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            {DAILY_REPORT_METRIC_OPTIONS.map(({ key, label }, index) => (
              <label key={`${key}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: isDarkMode ? 'rgba(15, 23, 42, 0.8)' : '#f8fafc', border: isDarkMode ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.08)', minHeight: 54 }}>
                <input
                  type="checkbox"
                  checked={Boolean(dailyReportSettings.metrics?.[key])}
                  onChange={(e) => setDailyReportSettings((prev) => ({
                    ...prev,
                    metrics: {
                      ...prev.metrics,
                      [key]: e.target.checked
                    }
                  }))}
                  aria-label={label}
                  style={{ width: 18, height: 18, accentColor: '#2563eb', flexShrink: 0 }}
                />
                <span style={{ color: isDarkMode ? '#e2e8f0' : '#0f172a', lineHeight: 1.35, fontSize: 13 }}>{label}</span>
              </label>
            ))}
          </div>
        )}
        <div style={{ borderTop: isDarkMode ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.12)', margin: '16px 0 12px' }} />
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8 }}>
        <button
          type="button"
          onClick={() => {
            if (isDailyReportSettingsPage || dailyReportSettingsPageOpen) {
              setDailyReportSettingsPageOpen(false);
              window.history.pushState({}, '', `${adminBasePath}?tab=controls`);
              setCurrentWindowPath(`${adminBasePath}`);
              window.dispatchEvent(new PopStateEvent('popstate'));
              return;
            }
            setEmailModal(null);
          }}
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            border: 'none',
            background: isDarkMode ? 'rgba(148,163,184,0.14)' : '#e2e8f0',
            color: isDarkMode ? '#f8fafc' : '#0f172a',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          Close
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            saveDailyReportSettings();
          }}
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            border: 'none',
            background: '#2563eb',
            color: 'white',
            cursor: 'pointer',
            fontWeight: 700
          }}
        >
          Save settings
        </button>
      </div>
    </div>
  );

  const DAILY_REPORT_PREVIEW_VALUES = buildDailyReportPreviewValues(dailyReportPreviewData);
  const formatPaymentFailedCurrencyTotal = (item) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(item.currency || 'USD').toUpperCase(),
    maximumFractionDigits: 2
  }).format(Number(item.total ?? item.count ?? 0));
  const formatRevenueCurrencyTotal = (item) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(item.currency || item.name || 'USD').toUpperCase(),
    maximumFractionDigits: 2
  }).format(Number(item.total ?? item.count ?? 0));

  const LIVE_DAILY_REPORT_OPTIONS = [
    { key: 'totalUsers', label: 'Total Users' },
    { key: 'totalContributors', label: 'Total Contributors' },
    { key: 'totalCustomers', label: 'Total Customers' },
    { key: 'totalAssets', label: 'Total Assets' },
    { key: 'liveAssets', label: 'Live Assets' },
    { key: 'pendingAssets', label: 'Pending Assets' },
    { key: 'rejectedAssets', label: 'Rejected Assets' },
    { key: 'deletedAssetsLast30Days', label: 'Deleted Assets (Last 30 Days)' },
    { key: 'totalOrders', label: 'Total Orders' },
    { key: 'failedOrders', label: 'Failed Orders' },
    { key: 'paymentFailedCount', label: 'Payment Failed Value' },
    { key: 'totalRevenueInr', label: 'Revenue' },
    { key: 'totalDownloads', label: 'Total Downloads' },
    { key: 'last24HoursDownloads', label: 'Last 24 Hr Downloads' },
    { key: 'last7DaysDownloads', label: 'Last 7 Days Downloads' },
    { key: 'last30DaysDownloads', label: 'Last 30 Days Downloads' },
    { key: 'last365DaysDownloads', label: 'Last 365 Days Downloads' },
    { key: 'currentMonthDownloads', label: 'Current Month Downloads' },
    { key: 'currentFyDownloads', label: 'Current FY Downloads' }
  ];

  const DAILY_REPORT_METRIC_OPTIONS = LIVE_DAILY_REPORT_OPTIONS;
  const WEBSITE_OVERVIEW_OPTIONS = LIVE_DAILY_REPORT_OPTIONS.slice(0, 4);
  const ASSET_STATISTICS_OPTIONS = LIVE_DAILY_REPORT_OPTIONS.slice(4, 8);
  const DOWNLOADS_OPTIONS = [
    { key: 'totalDownloads', label: 'Total Downloads' },
    { key: 'last24HoursDownloads', label: 'Last 24 Hr Downloads' },
    { key: 'last7DaysDownloads', label: 'Last 7 Days Downloads' },
    { key: 'last30DaysDownloads', label: 'Last 30 Days Downloads' },
    { key: 'last365DaysDownloads', label: 'Last 365 Days Downloads' },
    { key: 'currentMonthDownloads', label: 'Current Month Downloads' },
    { key: 'currentFyDownloads', label: 'Current FY Downloads' }
  ];
  const SALES_REVENUE_OPTIONS = [
    { key: 'totalOrders', label: 'Total Orders' },
    { key: 'failedOrders', label: 'Failed Orders' },
    { key: 'paymentFailedCount', label: 'Payment Failed Value' },
    { key: 'totalRevenueInr', label: 'Revenue' },
    { key: 'totalDiscountInr', label: 'Discount' },
    { key: 'totalEarningsInr', label: 'Earnings' },
    { key: 'revenueLast7Days', label: 'Revenue 7 Days' },
    { key: 'discountLast7Days', label: 'Discount 7 Days' },
    { key: 'earningsLast7Days', label: 'Earnings 7 Days' },
    { key: 'revenueLast30Days', label: 'Revenue Last 30 Days' },
    { key: 'discountLast30Days', label: 'Discount Last 30 Days' },
    { key: 'earningsLast30Days', label: 'Earnings Last 30 Days' },
    { key: 'revenueCurrentMonth', label: 'Revenue Current Month' },
    { key: 'discountCurrentMonth', label: 'Discount Current Month' },
    { key: 'earningsCurrentMonth', label: 'Earnings Current Month' },
    { key: 'revenueCurrentFy', label: 'Revenue Current FY' },
    { key: 'discountCurrentFy', label: 'Discount Current FY' },
    { key: 'earningsCurrentFy', label: 'Earnings Current FY' },
    { key: 'revenueLast365Days', label: 'Revenue Last 365 Days' },
    { key: 'discountLast365Days', label: 'Discount Last 365 Days' },
    { key: 'earningsLast365Days', label: 'Earnings Last 365 Days' }
  ];
  const ALL_DAILY_REPORT_OPTIONS = [
    ...DAILY_REPORT_METRIC_OPTIONS,
    ...SALES_REVENUE_OPTIONS.filter(({ key }) => !DAILY_REPORT_METRIC_OPTIONS.some((option) => option.key === key))
  ];
  const CONTRIBUTOR_STATISTICS_OPTIONS = [
    { key: 'totalContributors', label: 'Total Contributors' },
    { key: 'totalCustomers', label: 'Total Customers' }
  ];
  const USER_ACTIVITY_OPTIONS = [
    { key: 'totalUsers', label: 'Total Users' },
    { key: 'last24HoursDownloads', label: 'Last 24 Hr Downloads' }
  ];
  const SYSTEM_ADMIN_OPTIONS = [
    { key: 'totalUsers', label: 'Total Users' },
    { key: 'totalOrders', label: 'Total Orders' }
  ];
  const MARKETING_OPTIONS = [
    { key: 'totalCustomers', label: 'Total Customers' },
    { key: 'totalRevenueInr', label: 'Revenue' },
    { key: 'totalDownloads', label: 'Total Downloads' }
  ];

  const DAILY_REPORT_PREVIEW_ROWS = [
    { key: 'totalAssets', label: 'Total Assets' },
    ...DAILY_REPORT_METRIC_OPTIONS.filter(({ key }) => key !== 'totalAssets'),
    ...SALES_REVENUE_OPTIONS.filter(({ key }) => !DAILY_REPORT_METRIC_OPTIONS.some((option) => option.key === key))
  ];
  const DAILY_REPORT_PREVIEW_GROUPS = [
    { key: 'overview', label: 'Website Overview', keys: ['totalUsers', 'totalContributors', 'totalCustomers', 'totalAssets'] },
    { key: 'assets', label: 'Asset Statistics', keys: ['liveAssets', 'pendingAssets', 'rejectedAssets', 'deletedAssetsLast30Days'] },
    { key: 'orders', label: 'Orders & Payments', keys: ['totalOrders', 'failedOrders', 'paymentFailedCount'] },
    { key: 'financial', label: 'Financial Performance', keys: ['totalRevenueInr', 'totalDiscountInr', 'totalEarningsInr', 'revenueLast7Days', 'discountLast7Days', 'earningsLast7Days', 'revenueLast30Days', 'discountLast30Days', 'earningsLast30Days', 'revenueCurrentMonth', 'discountCurrentMonth', 'earningsCurrentMonth', 'revenueCurrentFy', 'discountCurrentFy', 'earningsCurrentFy', 'revenueLast365Days', 'discountLast365Days', 'earningsLast365Days'] },
    { key: 'downloads', label: 'Downloads', keys: ['totalDownloads', 'last24HoursDownloads', 'last7DaysDownloads', 'last30DaysDownloads', 'last365DaysDownloads', 'currentMonthDownloads', 'currentFyDownloads'] }
  ];
  const getDailyReportPreviewGroups = () => {
    const selectedRows = DAILY_REPORT_PREVIEW_ROWS.filter((row) => Boolean(dailyReportSettings.metrics?.[row.key]));
    const assigned = new Set();
    const groups = DAILY_REPORT_PREVIEW_GROUPS.map((group) => {
      const rows = selectedRows.filter((row) => group.keys.includes(row.key));
      rows.forEach((row) => assigned.add(row.key));
      return { ...group, rows };
    }).filter((group) => group.rows.length > 0);
    const otherRows = selectedRows.filter((row) => !assigned.has(row.key));
    return otherRows.length ? [...groups, { key: 'other', label: 'Other Metrics', rows: otherRows }] : groups;
  };
  const ADMIN_MODAL_TITLES = {
    pricing: 'Pricing Settings',
    freeAssets: 'Free Asset Settings',
    subscriptionPlans: 'Subscription Plans',
    subscriptionPlanForm: 'Add New Subscription Plan',
    subscriptionSubscribers: 'Subscribed Customers',
    customSubscriptions: 'Custom Subscriptions',
    taxSettings: 'Tax Settings',
    invoiceTemplate: 'Invoice Template'
  };
  const buildAuthHeaders = () => {
    const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // Load custom card order for current admin
  useEffect(() => {
    const loadCardOrder = async () => {
      try {
        const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
        const response = await axios.get(`${API_BASE_URL}/admin/card-layout-preferences`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (response.data && response.data.cardOrder && Array.isArray(response.data.cardOrder)) {
          setCardOrder(normalizeCardOrder(response.data.cardOrder));
        }
      } catch (err) {
        console.debug("No custom card order found, using defaults", err.message);
      }
    };
    
    if (tabParam === "controls") {
      loadCardOrder();
    }
  }, [tabParam]);

  const saveCardOrder = async (newOrder) => {
    const normalizedOrder = normalizeCardOrder(newOrder);
    setLayoutSaving(true);
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      await axios.post(
        `${API_BASE_URL}/admin/card-layout-preferences`,
        { cardOrder: normalizedOrder },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      setCardOrder(normalizedOrder);
      setIsLayoutEditMode(false);
      toast.success("Layout saved successfully");
    } catch (err) {
      console.error("Failed to save card order", err);
      toast.error("Failed to save layout");
    } finally {
      setLayoutSaving(false);
    }
  };

  const moveCard = (cardId, direction) => {
    const currentIndex = (Array.isArray(cardOrder) ? cardOrder : []).indexOf(cardId);
    if (currentIndex === -1) return;

    if (direction === "left" && currentIndex > 0) {
      const newOrder = [...cardOrder];
      [newOrder[currentIndex], newOrder[currentIndex - 1]] = [newOrder[currentIndex - 1], newOrder[currentIndex]];
      setCardOrder(newOrder);
    } else if (direction === "right" && currentIndex < cardOrder.length - 1) {
      const newOrder = [...cardOrder];
      [newOrder[currentIndex], newOrder[currentIndex + 1]] = [newOrder[currentIndex + 1], newOrder[currentIndex]];
      setCardOrder(newOrder);
    }
  };

  const fetchProfileForAccount = async () => {
    setAccountLoading(true);
    setAccountMessage("");
    try {
      const res = await axios.get(`${API_BASE_URL}/profile`, { headers: buildAuthHeaders() });
      const data = res.data || {};
      setAccountUserId(data.id || null);
      setAccountForm((s) => ({ ...s, email: data.email || s.email, full_name: data.full_name || s.full_name }));
    } catch (err) {
      console.error(err);
      setAccountMessage(err.response?.data || "Failed to load profile");
    } finally {
      setAccountLoading(false);
    }
  };

  const handleAccountField = (field, value) => setAccountForm((s) => ({ ...s, [field]: value }));

  const handleAccountSubmit = async () => {
    console.debug('handleAccountSubmit called', { accountForm, accountUserId });
    setAccountMessage("");
    setAccountLoading(true);
    try {
      // expose form to page for debugging
      if (typeof window !== 'undefined') {
        window.__lastAccountSubmit = { stage: 'start', payload: { ...accountForm }, ts: Date.now() };
      }
    } catch (e) {
      /* ignore */
    }
    // basic validation
    if (accountForm.newPassword && accountForm.newPassword !== accountForm.confirmPassword) {
      setAccountMessage("New password and confirmation do not match.");
      setAccountLoading(false);
      return;
    }

    try {
      // If changing password, call profile change endpoint which requires current password
      if (accountForm.newPassword) {
        if (!accountForm.currentPassword) {
          setAccountMessage("Current password is required to change password.");
          setAccountLoading(false);
          return;
        }
        try {
          console.debug('calling /profile/change-password', { currentPasswordProvided: !!accountForm.currentPassword });
          const resp = await axios.post(
            `${API_BASE_URL}/profile/change-password`,
            { currentPassword: accountForm.currentPassword, newPassword: accountForm.newPassword },
            { headers: buildAuthHeaders() }
          );
          console.debug('/profile/change-password response', resp && resp.status, resp && resp.data);
          if (typeof window !== 'undefined') window.__lastAccountSubmit = { stage: 'changed-password', resp: resp && resp.data, ts: Date.now() };
        } catch (err) {
          console.error('/profile/change-password failed', err?.response?.status, err?.response?.data || err.message);
          if (typeof window !== 'undefined') window.__lastAccountSubmit = { stage: 'change-password-failed', error: err?.response?.data || err.message, ts: Date.now() };
          throw err;
        }
      }

      // Update name / email (admin users can use admin users endpoint)
      if (accountUserId) {
        const payload = { full_name: accountForm.full_name || null, email: accountForm.email || null };
        if (accountForm.newPassword) payload.password = accountForm.newPassword;
        try {
          console.debug('calling PUT /admin/users/' + accountUserId, payload);
          const resp = await axios.put(`${API_BASE_URL}/admin/users/${accountUserId}`, payload, { headers: buildAuthHeaders() });
          console.debug('PUT /admin/users response', resp && resp.status, resp && resp.data);
          if (typeof window !== 'undefined') window.__lastAccountSubmit = { stage: 'updated-user', resp: resp && resp.data, ts: Date.now() };
        } catch (err) {
          console.error('PUT /admin/users failed', err?.response?.status, err?.response?.data || err.message);
          if (typeof window !== 'undefined') window.__lastAccountSubmit = { stage: 'update-user-failed', error: err?.response?.data || err.message, ts: Date.now() };
          throw err;
        }
      }

      // refresh local storage values
      if (accountForm.full_name) localStorage.setItem("fullName", accountForm.full_name);
      if (accountForm.email) localStorage.setItem("email", accountForm.email);

      setAccountMessage("Profile updated successfully.");
      setAccountForm((s) => ({ ...s, currentPassword: "", newPassword: "", confirmPassword: "" }));
    } catch (err) {
      console.error(err);
      setAccountMessage(err.response?.data || "Failed to update profile.");
    } finally {
      setAccountLoading(false);
    }
  };

  const normalizePricingSettingsResponse = (data = {}) => {
    const normalized = { ...data };

    if (normalized.custom_currency_rows) {
      normalized.custom_currency_rows = Array.isArray(normalized.custom_currency_rows)
        ? normalized.custom_currency_rows
        : (typeof normalized.custom_currency_rows === 'string' ? JSON.parse(normalized.custom_currency_rows) : []);
    } else {
      normalized.custom_currency_rows = [];
    }

    if (normalized.tax_settings) {
      normalized.tax_settings = Array.isArray(normalized.tax_settings)
        ? normalized.tax_settings
        : (typeof normalized.tax_settings === 'string' ? JSON.parse(normalized.tax_settings) : []);
    } else {
      normalized.tax_settings = [];
    }

    return normalized;
  };

  const getCurrencyRowsFromSettings = (settings = {}) => {
    const rows = [];
    const seen = new Set();
    const baseEntries = [
      ...DEFAULT_PRICING_CURRENCY_CODES.map((code) => ({ id: `base-${code}`, code, amount: settings?.[`${code.toLowerCase()}_amount`] ?? '' })),
      ...(Array.isArray(settings?.custom_currency_rows) ? settings.custom_currency_rows : [])
    ];

    baseEntries.forEach((entry, index) => {
      const code = String(entry?.code || entry?.currency || '').toUpperCase();
      if (!code) return;
      if (seen.has(code)) return;
      seen.add(code);
      rows.push({
        id: entry?.id || `${code}-${index}`,
        code,
        amount: entry?.amount ?? settings?.[`${code.toLowerCase()}_amount`] ?? ''
      });
    });

    if (rows.length === 0) {
      return DEFAULT_PRICING_CURRENCY_CODES.map((code) => ({ id: `base-${code}`, code, amount: '' }));
    }

    return rows;
  };

  const addPricingCurrencyRow = () => {
    setPricingCurrencyRows((prev) => {
      const usedCodes = new Set(prev.map((row) => row.code.toUpperCase()));
      const nextCode = [...DEFAULT_PRICING_CURRENCY_CODES, ...EXTRA_PRICING_CURRENCY_OPTIONS].find((code) => !usedCodes.has(code));
      return [
        ...prev,
        { id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`, code: nextCode || 'USD', amount: '' }
      ];
    });
  };

  const getCurrencyOptionsForRow = (rowId, selectedCode) => {
    const usedCodes = new Set(
      pricingCurrencyRows
        .filter((row) => row.id !== rowId)
        .map((row) => row.code.toUpperCase())
    );

    return [...DEFAULT_PRICING_CURRENCY_CODES, ...EXTRA_PRICING_CURRENCY_OPTIONS].filter(
      (code) => !usedCodes.has(code) || code === selectedCode.toUpperCase()
    );
  };

  const fetchPricingSettings = async () => {
    setPricingLoading(true);
    setPricingMessage("");
    try {
      sessionStorage.setItem('fetchPricingCalled', 'YES-' + Date.now());
      const res = await axios.get(`${API_BASE_URL}/admin/settings/pricing`, { headers: buildAuthHeaders() });
      const normalized = normalizePricingSettingsResponse(res.data || {});
      sessionStorage.setItem('fetchPricingResponse', JSON.stringify(normalized));
      setPricingSettings(normalized);
      setPricingCurrencyRows(getCurrencyRowsFromSettings(normalized));
      sessionStorage.setItem('pricingSettingsSet', JSON.stringify(normalized));
      const parsed = Array.isArray(normalized.tax_settings) ? normalized.tax_settings : [];
      setTaxSettings(parsed.length > 0 ? parsed : [{ enabled: true, rate: 18, label: 'GST', id: 1 }]);
    } catch (err) {
      sessionStorage.setItem('fetchPricingError', err.message);
      console.error(err);
      setPricingMessage("Unable to load pricing settings.");
    } finally {
      setPricingLoading(false);
    }
  };

  const savePricingSettings = async () => {
    sessionStorage.setItem('savePricingCalled', 'YES-' + Date.now());
    if (!pricingSettings) {
      sessionStorage.setItem('noPricingSettings', 'TRUE');
      return;
    }
    setPricingLoading(true);
    setPricingMessage("");
    try {
      const nextCurrencyMap = {};
      pricingCurrencyRows.forEach((row) => {
        const code = String(row.code || '').trim().toUpperCase();
        if (!code) return;
        nextCurrencyMap[`${code.toLowerCase()}_amount`] = Number(row.amount || 0);
      });

      const payload = {
        ...pricingSettings,
        ...nextCurrencyMap,
        custom_currency_rows: pricingCurrencyRows.filter((row) => !DEFAULT_PRICING_CURRENCY_CODES.includes(row.code.toUpperCase())),
        tax_settings: taxSettings
      };
      const headers = buildAuthHeaders();
      const url = `${API_BASE_URL}/admin/settings/pricing`;
      
      const logMsg = `=== SAVE PRICING SETTINGS ===\nURL: ${url}\nHeaders: ${JSON.stringify(headers)}\nPayload: ${JSON.stringify(payload)}`;
      console.log(logMsg);
      sessionStorage.setItem('lastSaveAttempt', logMsg);
      
      const res = await axios.post(url, payload, { headers });
      
      const responseMsg = `Response status: ${res.status}\nResponse data: ${JSON.stringify(res.data)}`;
      console.log(responseMsg);
      sessionStorage.setItem('lastSaveResponse', responseMsg);
      
      const normalized = normalizePricingSettingsResponse(res.data || pricingSettings || {});
      setPricingSettings(normalized);
      setPricingCurrencyRows(getCurrencyRowsFromSettings(normalized));

      const parsed = Array.isArray(normalized.tax_settings) ? normalized.tax_settings : [];
      setTaxSettings(parsed.length > 0 ? parsed : [{ enabled: true, rate: 18, label: 'GST', id: 1 }]);

      sessionStorage.setItem('lastSaveStatus', 'SUCCESS');

      // Force a full reload from the backend so the modal state always reflects the latest saved values
      // and the current live exchange rates instead of stale local state.
      await fetchPricingSettings();
      setPricingMessage("Pricing settings saved successfully.");
    } catch (err) {
      const errorMsg = `=== SAVE ERROR ===\nError: ${err.message}\nStatus: ${err.response?.status}\nResponse: ${JSON.stringify(err.response?.data)}`;
      console.error(errorMsg);
      sessionStorage.setItem('lastSaveError', errorMsg);
      setPricingMessage(err.response?.data?.error || err.response?.data || "Failed to save pricing settings.");
      sessionStorage.setItem('lastSaveStatus', 'FAILED');
    } finally {
      setPricingLoading(false);
    }
  };

  const fetchCreditPrice = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/settings/credit-price`, { headers: buildAuthHeaders() });
      setCreditPrices(Object.fromEntries([100, 200, 500, 1000].map((amount) => [amount, String(res.data?.credit_prices?.[amount] ?? amount)])));
    } catch (err) {
      setCreditPriceMessage("Unable to load credit price.");
    }
  };

  const saveCreditPrice = async () => {
    const prices = Object.fromEntries(Object.entries(creditPrices).map(([amount, price]) => [amount, Number(price)]));
    if (Object.values(prices).some((price) => !Number.isFinite(price) || price <= 0)) {
      setCreditPriceMessage("Each price must be greater than zero.");
      return;
    }

    setCreditPriceSaving(true);
    setCreditPriceMessage("");
    try {
      const res = await axios.post(
        `${API_BASE_URL}/admin/settings/credit-price`,
        { credit_prices: prices },
        { headers: buildAuthHeaders() }
      );
      setCreditPrices(Object.fromEntries([100, 200, 500, 1000].map((amount) => [amount, String(res.data?.credit_prices?.[amount] ?? prices[amount])] )));
      setCreditPriceMessage("Credit price saved.");
    } catch (err) {
      setCreditPriceMessage(err.response?.data?.error || "Failed to save credit price.");
    } finally {
      setCreditPriceSaving(false);
    }
  };

  const openRequestedCredits = async () => {
    setCreditPopup("requested");
    setRequestedCreditsLoading(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/credit-requests`, { headers: buildAuthHeaders() });
      setRequestedCredits(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setRequestedCredits([]);
    } finally {
      setRequestedCreditsLoading(false);
    }
  };

  const updateCreditRequestStatus = async (orderId, status) => {
    setRequestedCreditsActionLoading(true);
    try {
      await axios.put(`${API_BASE_URL}/admin/credit-requests/${orderId}/status`, { status }, { headers: buildAuthHeaders() });
      setRequestedCredits((previous) => previous.map((request) => request.order_id === orderId ? { ...request, order_status: status === "approved" ? "completed" : "cancelled", payment_status: status === "approved" ? "paid" : "failed" } : request));
    } catch (err) {
      setCreditPriceMessage(err.response?.data?.error || "Failed to update credit request.");
    } finally {
      setRequestedCreditsActionLoading(false);
    }
  };

  const manualUpdateCurrencyRates = async () => {
    setCurrencyUpdateLoading(true);
    setPricingMessage("");
    try {
      const headers = buildAuthHeaders();
      const res = await axios.post(`${API_BASE_URL}/admin/settings/currency-update`, {}, { headers });
      
      if (res.data.success) {
        setPricingMessage("Currency rates updated successfully! ✅");
        // Refresh pricing settings to reflect updated rates
        await fetchPricingSettings();
      } else {
        setPricingMessage("Failed to update currency rates: " + res.data.message);
      }
    } catch (err) {
      console.error(err);
      setPricingMessage(err.response?.data?.error || "Failed to update currency rates. Make sure auto-update is enabled.");
    } finally {
      setCurrencyUpdateLoading(false);
    }
  };

  const fetchFreeAssetSettings = async () => {
    setFreeAssetLoading(true);
    setFreeAssetMessage("");
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/settings/free-assets`, { headers: buildAuthHeaders() });
      setFreeAssetSettings(res.data || {});
    } catch (err) {
      console.error(err);
      setFreeAssetMessage("Unable to load free asset settings.");
    } finally {
      setFreeAssetLoading(false);
    }
  };

  const saveFreeAssetSettings = async () => {
    if (!freeAssetSettings) {
      return;
    }
    setFreeAssetLoading(true);
    setFreeAssetMessage("");
    try {
      const res = await axios.post(`${API_BASE_URL}/admin/settings/free-assets`, freeAssetSettings, { headers: buildAuthHeaders() });
      setFreeAssetSettings(res.data || freeAssetSettings);
      setFreeAssetMessage("Free asset settings saved successfully.");
    } catch (err) {
      console.error(err);
      setFreeAssetMessage(err.response?.data?.error || "Failed to save free asset settings.");
    } finally {
      setFreeAssetLoading(false);
    }
  };

  const fetchSubscriptionPlans = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/subscription-plans`, { headers: buildAuthHeaders() });
      setSubscriptionPlans(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      setSubscriptionPlans([]);
    }
  };

  const resetPlanForm = () => {
    setSelectedPlan(null);
    setPlanForm({
      name: "",
      short_description: "",
      icon: "",
      badge: "",
      color: "#2196f3",
      active: true,
      recommended: false,
      pricingAmount: "",
      pricingCurrency: "USD",
      duration: "monthly",
      durations: { monthly: true, "3_months": false, "6_months": false, "1_year": false, limited: false },
      durationPrices: { monthly: "", "3_months": "", "6_months": "", "1_year": "", limited: "" },
      startDate: "",
      endDate: "",
      downloads: ""
    });
    const currencies = getActivePlanCurrencies();
    setPlanCurrencyPrices(Object.fromEntries(currencies.map((currency) => [currency, { monthly: '', '3_months': '', '6_months': '', '1_year': '', limited: '' }])));
    setSubscriptionMessage("");
  };

  const getActivePlanCurrencies = () => {
    const currencies = pricingCurrencyRows
      .map((row) => String(row.code || '').trim().toUpperCase())
      .filter(Boolean);
    return currencies.length > 0 ? [...new Set(currencies)] : ['INR', 'USD', 'EUR'];
  };

  const convertPlanPriceFromInr = (amount, currency) => {
    if (currency === 'INR') return Number(amount || 0);
    const rate = Number(pricingSettings?.liveRates?.[currency] || 0);
    return rate > 0 ? Number((Number(amount || 0) * rate).toFixed(2)) : '';
  };

  const loadPlanIntoForm = (plan) => {
    setSelectedPlan(plan);
    setPlanForm({
      name: plan.name || "",
      short_description: plan.short_description || "",
      icon: plan.icon || "",
      badge: plan.badge || "",
      color: plan.color || "#2196f3",
      active: plan.active !== false,
      recommended: plan.recommended === true,
      pricingAmount: plan.pricing?.amount != null ? String(plan.pricing.amount) : "",
      pricingCurrency: plan.pricing?.currency || "USD",
      duration: plan.plan_settings?.duration || "monthly",
      durations: plan.plan_settings?.durations || { [plan.plan_settings?.duration || "monthly"]: true },
      durationPrices: plan.pricing?.prices || { [plan.plan_settings?.duration || "monthly"]: plan.pricing?.amount != null ? String(plan.pricing.amount) : "" },
      startDate: plan.plan_settings?.start_date || "",
      endDate: plan.plan_settings?.end_date || "",
      downloads: plan.download_limits?.downloads != null ? String(plan.download_limits.downloads) : ""
    });
    const currencies = getActivePlanCurrencies();
    const fallbackDuration = plan.plan_settings?.duration || "monthly";
    const durations = Object.keys(plan.plan_settings?.durations || { [fallbackDuration]: true });
    const storedPrices = plan.pricing?.currency_prices || {};
    const fallbackPrices = plan.pricing?.prices || { [fallbackDuration]: plan.pricing?.amount ?? "" };
    setPlanCurrencyPrices(Object.fromEntries(currencies.map((currency) => [currency, Object.fromEntries(durations.map((duration) => [duration, storedPrices[currency]?.[duration] ?? (currency === (plan.pricing?.currency || 'USD') ? fallbackPrices[duration] : convertPlanPriceFromInr(fallbackPrices[duration], currency))]))])));
    setSubscriptionMessage("");
  };

  const saveSubscriptionPlan = async () => {
    if (!planForm.name.trim()) {
      setSubscriptionMessage("A plan name is required.");
      return;
    }
    const selectedDurations = Object.keys(planForm.durations).filter((duration) => planForm.durations[duration]);
    const activeCurrencies = getActivePlanCurrencies();
    if (selectedDurations.length === 0) {
      setSubscriptionMessage("Select at least one duration.");
      return;
    }
    if (selectedDurations.includes("limited") && (!planForm.startDate || !planForm.endDate)) {
      setSubscriptionMessage("Start and end dates are required for a limited-time plan.");
      return;
    }
    if (selectedDurations.some((duration) => planForm.durationPrices[duration] === "" || Number(planForm.durationPrices[duration]) < 0)) {
      setSubscriptionMessage("Enter a valid price for every selected duration.");
      return;
    }
    if (activeCurrencies.some((currency) => selectedDurations.some((duration) => planCurrencyPrices[currency]?.[duration] === "" || planCurrencyPrices[currency]?.[duration] === undefined || Number(planCurrencyPrices[currency][duration]) < 0))) {
      setSubscriptionMessage("Enter a valid price for every selected duration and active currency.");
      return;
    }
    if (!planForm.downloads || Number(planForm.downloads) < 0) {
      setSubscriptionMessage("Downloads must be zero or greater.");
      return;
    }

    const payload = {
      id: selectedPlan?.id,
      name: planForm.name.trim(),
      short_description: planForm.short_description.trim(),
      icon: planForm.icon.trim(),
      badge: planForm.badge.trim(),
      color: planForm.color,
      display_order: planForm.active ? 0 : (selectedPlan?.display_order || 0),
      active: planForm.active,
      recommended: planForm.recommended,
      pricing: {
        amount: Number(planForm.durationPrices[selectedDurations[0]]) || 0,
        currency: planForm.pricingCurrency || "USD",
        prices: Object.fromEntries(selectedDurations.map((duration) => [duration, Number(planForm.durationPrices[duration])])),
        currency_prices: Object.fromEntries(activeCurrencies.map((currency) => [currency, Object.fromEntries(selectedDurations.map((duration) => [duration, Number(planCurrencyPrices[currency][duration])]))]))
      },
      download_limits: { downloads: Number(planForm.downloads) },
      licenses: [],
      asset_access: [],
      member_benefits: {},
      limitations: [],
      plan_settings: {
        duration: selectedDurations[0],
        durations: Object.fromEntries(selectedDurations.map((duration) => [duration, true])),
        start_date: selectedDurations.includes("limited") ? planForm.startDate : null,
        end_date: selectedDurations.includes("limited") ? planForm.endDate : null
      }
    };

    try {
      const res = await axios.post(`${API_BASE_URL}/admin/subscription-plans`, payload, { headers: buildAuthHeaders() });
      setSubscriptionMessage("Subscription plan saved successfully.");
      resetPlanForm();
      fetchSubscriptionPlans();
    } catch (err) {
      console.error(err);
      setSubscriptionMessage(err.response?.data?.error || "Failed to save subscription plan.");
    }
  };

  const fetchCustomSubscriptions = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/custom-subscriptions`, { headers: buildAuthHeaders() });
      setCustomSubscriptions(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      setCustomSubscriptions([]);
    }
  };

  const fetchSubscriptionSubscribers = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/custom-subscriptions`, { headers: buildAuthHeaders() });
      setSubscriptionSubscribers(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      setSubscriptionSubscribers([]);
    }
  };

  const resetCustomSubscriptionForm = () => {
    setCustomSubscriptionForm({
      customer_name: "",
      customer_email: "",
      base_plan: "",
      custom_pricing: "",
      status: "active"
    });
    setCustomSubscriptionMessage("");
  };

  const saveCustomSubscription = async () => {
    if (!customSubscriptionForm.customer_name.trim() || !customSubscriptionForm.customer_email.trim()) {
      setCustomSubscriptionMessage("Customer name and email are required.");
      return;
    }

    const payload = {
      customer_name: customSubscriptionForm.customer_name.trim(),
      customer_email: customSubscriptionForm.customer_email.trim(),
      base_plan: customSubscriptionForm.base_plan.trim() || null,
      custom_duration: null,
      custom_start_date: null,
      custom_end_date: null,
      custom_pricing: customSubscriptionForm.custom_pricing ? { amount: Number(customSubscriptionForm.custom_pricing) || 0 } : {},
      custom_permissions: {},
      status: customSubscriptionForm.status,
      admin_notes: {},
      activity_log: []
    };

    try {
      await axios.post(`${API_BASE_URL}/admin/custom-subscriptions`, payload, { headers: buildAuthHeaders() });
      setCustomSubscriptionMessage("Custom subscription created successfully.");
      resetCustomSubscriptionForm();
      fetchCustomSubscriptions();
    } catch (err) {
      console.error(err);
      setCustomSubscriptionMessage(err.response?.data?.error || "Failed to create custom subscription.");
    }
  };

  const persistSocialLinks = (nextLinks) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(SOCIAL_LINKS_STORAGE_KEY, JSON.stringify(nextLinks));
      window.dispatchEvent(new Event(SOCIAL_LINKS_EVENT));
    }
  };

  const updateSocialLink = (index, updates) => {
    setSocialLinks((prev) => prev.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...updates } : item
    ));
    setSocialLinksMessage("");
  };

  const savePaymentGatewaySettings = async (gateway, identifier) => {
    if (!identifier?.trim()) {
      setPaymentGatewayMessage("Please enter a valid identifier.");
      return;
    }

    setPaymentGatewaySaving(true);
    setPaymentGatewayMessage("");

    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.post(
        `${API_BASE_URL}/admin/payment-settings`,
        { gateway, identifier: identifier.trim() },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      setPaymentGatewaySettings(res.data && typeof res.data === "object" ? res.data : {});
      setPaymentGatewayMessage("Saved successfully.");
      setPaymentGatewayIdentifier(identifier.trim());
    } catch (err) {
      console.error("Failed to save payment setting", err);
      setPaymentGatewayMessage("Failed to save. Please try again.");
    } finally {
      setPaymentGatewaySaving(false);
    }
  };

  const deletePaymentGateway = async (gateway) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete ${gateway} payment gateway?`)) return;

    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.post(
        `${API_BASE_URL}/admin/payment-settings`,
        { deleteGateway: gateway },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      setPaymentGatewaySettings(res.data && typeof res.data === "object" ? res.data : {});
      setPaymentGatewayOptions((prev) => prev.filter((item) => item !== gateway));
      setEnabledPaymentGateways(resolveEnabledPaymentGateways(res.data || {}));
      setSelectedPaymentGateway((selected) => selected === gateway ? null : selected);
      window.dispatchEvent(new Event("payment-gateways-updated"));
    } catch (err) {
      console.error("Failed to delete payment gateway", err);
      setPaymentGatewayMessage(err.response?.data?.error || "Failed to delete payment gateway. Please try again.");
    }
  };

  const saveSocialLinks = () => {
    persistSocialLinks(socialLinks);
    setSocialLinksMessage("Social links saved");
  };

  const fetchOtpSettings = async () => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.get(`${API_BASE_URL}/admin/otp-settings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOtpSettings({
        default_recipient: res.data?.default_recipient || "",
        bcc_recipients: res.data?.bcc_recipients || "",
        login_subject: res.data?.login_subject || "Login OTP",
        registration_subject: res.data?.registration_subject || "Account Verification OTP",
        recovery_subject: res.data?.recovery_subject || "Password Recovery OTP",
        login_body: res.data?.login_body || "Hello {{full_name}},<br>Your login OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.",
        registration_body: res.data?.registration_body || "Hello {{full_name}},<br>Your account verification OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.",
        recovery_body: res.data?.recovery_body || "Hello {{full_name}},<br>Your password recovery OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.",
        valid_minutes: Number(res.data?.valid_minutes || 10)
      });
    } catch (err) {
      console.error("Failed to load OTP settings", err);
      setOtpSettingsMessage("Failed to load OTP settings.");
    }
  };

  const saveOtpSettings = async () => {
    try {
      setOtpSettingsSaving(true);
      setOtpSettingsMessage("");
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.post(
        `${API_BASE_URL}/admin/otp-settings`,
        {
          ...otpSettings,
          valid_minutes: Number(otpSettings.valid_minutes) || 10,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setOtpSettings({
        default_recipient: res.data?.default_recipient || "",
        bcc_recipients: res.data?.bcc_recipients || "",
        login_subject: res.data?.login_subject || "Login OTP",
        registration_subject: res.data?.registration_subject || "Account Verification OTP",
        recovery_subject: res.data?.recovery_subject || "Password Recovery OTP",
        login_body: res.data?.login_body || "Hello {{full_name}},<br>Your login OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.",
        registration_body: res.data?.registration_body || "Hello {{full_name}},<br>Your account verification OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.",
        recovery_body: res.data?.recovery_body || "Hello {{full_name}},<br>Your password recovery OTP is <strong>{{otp}}</strong>.<br>This code is valid for {{valid_minutes}} minutes.",
        valid_minutes: Number(res.data?.valid_minutes || 10)
      });
      setOtpSettingsMessage("OTP settings saved.");
    } catch (err) {
      console.error("Failed to save OTP settings", err);
      setOtpSettingsMessage(err.response?.data?.error || err.response?.data || err.message || "Failed to save OTP settings.");
    } finally {
      setOtpSettingsSaving(false);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchCollections();

    if (isControlsTab) {
      fetchCategories();
      fetchCollections();
      fetchBrandingConfig();
      fetchOtpSettings();
      fetchUsers();
      fetchCreditPrice();
      // settings are loaded when their modal opens to avoid unnecessary calls
    } else if (tabParam === "live-assets") {
      fetchApprovedImages();
    } else if (tabParam === "users") {
      // honor the incoming status query param by mapping it to the user filter
      setUserFilter(statusFilter || "all");
      fetchUsers();
    } else if (tabParam === "myaccount") {
      fetchProfileForAccount();
    } else {
      fetchImages();
    }
    setCurrentPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, tabParam]);

  // Load admin settings on-demand when a modal opens
  useEffect(() => {
    if (!adminModal) return;
    if (adminModal === 'pricing') {
      fetchPricingSettings();
    } else if (adminModal === 'freeAssets') {
      fetchFreeAssetSettings();
    } else if (adminModal === 'subscriptionPlans') {
      fetchSubscriptionPlans();
    } else if (adminModal === 'subscriptionPlanForm') {
      fetchPricingSettings();
    } else if (adminModal === 'customSubscriptions') {
      fetchCustomSubscriptions();
    } else if (adminModal === 'subscriptionSubscribers') {
      fetchSubscriptionSubscribers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminModal]);

  const fetchLiveAssetIds = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/images?limit=1000&page=1`);
      const liveImages = Array.isArray(res?.data?.images) ? res.data.images : [];
      const nextLiveIds = new Set(liveImages.map((image) => Number(image?.id)).filter(Number.isFinite));
      setLiveAssetIds(nextLiveIds);
      return nextLiveIds;
    } catch (err) {
      console.error(err);
      setLiveAssetIds(new Set());
      return new Set();
    }
  };

  const isAssetCurrentlyLive = (image) => {
    const normalizedStatus = String(image?.status || "").toLowerCase();
    if (normalizedStatus !== "approved") {
      return false;
    }

    return liveAssetIds.has(Number(image?.id));
  };

  const formatDuration = (seconds) => {
    if (seconds == null || Number.isNaN(seconds)) {
      return "—";
    }

    const rounded = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(rounded / 60);
    const remainder = rounded % 60;

    return minutes > 0
      ? `${minutes}m ${String(remainder).padStart(2, "0")}s`
      : `${remainder}s`;
  };

  const fetchImages = async () => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      await fetchLiveAssetIds();
      const res = await axios.get(
        `${API_BASE_URL}/admin/images`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      const assets = Array.isArray(res.data) ? res.data : [];
      const normalizedStatus = statusFilter === "all" ? "" : statusFilter;
      const filteredAssets = assets.filter((image) => {
        if (!normalizedStatus) return true;
        return String(image.status || "").toLowerCase() === normalizedStatus;
      });

      setImages(filteredAssets);
    } catch (err) {
      console.error(err);
      setImages([]);
    }
  };

  const fetchApprovedImages = async () => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      await fetchLiveAssetIds();
      const res = await axios.get(
        `${API_BASE_URL}/admin/images`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      const approvedImages = Array.isArray(res.data)
        ? res.data.filter((image) => String(image.status || "").toLowerCase() === "approved")
        : [];
      setImages(approvedImages);
      return approvedImages;
    } catch (err) {
      console.error(err);
      setImages([]);
      return [];
    }
  };

  const getStoredCategories = () => {
    try {
      const cachedCategories = localStorage.getItem(CATEGORY_STORAGE_KEY);
      if (cachedCategories) {
        const parsed = JSON.parse(cachedCategories);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (err) {
      console.error("Invalid cached categories", err);
    }

    return DEFAULT_CATEGORY_OPTIONS;
  };

  const persistCategories = (nextCategories) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(nextCategories));
    }
  };

  const persistCollections = (nextCollections) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(nextCollections));
    }
  };

  const fetchCategories = async () => {
    const fallbackCategories = getStoredCategories();
    setCategories(fallbackCategories);
    persistCategories(fallbackCategories);

    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.get(
        `${API_BASE_URL}/admin/categories`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      const nextCategories = Array.isArray(res.data) && res.data.length > 0 ? res.data : fallbackCategories;
      setCategories(nextCategories);
      persistCategories(nextCategories);
    } catch (err) {
      console.error(err);
      setCategories(fallbackCategories);
      persistCategories(fallbackCategories);
    }
  };

  const normalizeCollectionList = (rawCollections) => {
    if (!Array.isArray(rawCollections)) return [];

    return rawCollections
      .map((collection) => {
        if (typeof collection === "string") {
          return { id: collection, name: collection, asset_count: 0 };
        }

        if (collection && typeof collection === "object") {
          const normalizedName = collection.name || collection.title || collection.label || "";
          if (!normalizedName) return null;

          const rawAssetCount = Number(
            collection.asset_count ??
            collection.assetCount ??
            collection.count ??
            collection.total_assets ??
            collection.asset_count_total ??
            0
          );

          return {
            id: collection.id ?? collection._id ?? normalizedName,
            name: normalizedName,
            asset_count: Number.isFinite(rawAssetCount) ? rawAssetCount : 0
          };
        }

        return null;
      })
      .filter(Boolean);
  };

  const fetchCollections = async () => {
    const requestAdminCollections = async () => {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.get(
        `${API_BASE_URL}/admin/collections`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      return normalizeCollectionList(res.data);
    };

    try {
      const nextCollections = await requestAdminCollections();
      if (Array.isArray(nextCollections)) {
        setCollections(nextCollections);
        persistCollections(nextCollections);
        if (nextCollections.length > 0) {
          return;
        }
      }
    } catch (err) {
      console.error("Failed to fetch admin collections", err);
    }

    try {
      const publicRes = await axios.get(`${API_BASE_URL}/collections`);
      const nextCollections = normalizeCollectionList(publicRes.data);
      if (Array.isArray(nextCollections)) {
        setCollections(nextCollections);
        persistCollections(nextCollections);
        if (nextCollections.length > 0) {
          return;
        }
      }
    } catch (publicErr) {
      console.error("Failed to fetch public collections", publicErr);
    }

    const cachedCollections = typeof window !== "undefined" ? window.localStorage.getItem(COLLECTION_STORAGE_KEY) : null;
    if (cachedCollections) {
      try {
        const parsed = JSON.parse(cachedCollections);
        const nextCollections = normalizeCollectionList(parsed);
        if (nextCollections.length > 0) {
          setCollections(nextCollections);
        }
      } catch (cacheErr) {
        console.error(cacheErr);
      }
    }
  };

  const fetchUsers = async () => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.get(
        `${API_BASE_URL}/admin/users`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      setUsers(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      setUsers([]);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Ensure we refresh users when the users tab or the active user filter changes
  useEffect(() => {
    if (tabParam === "users") {
      fetchUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam, userFilter]);

  const fetchBrandingConfig = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/branding`);
      setBrandingConfig(res.data || {});
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    setHeroBadge(brandingConfig?.heroBadge || HERO_BADGE_DEFAULT);
    setHeroHeadingLine1(brandingConfig?.heroHeadingLine1 || HERO_HEADING_LINE_1_DEFAULT);
    setHeroHeadingLine2(brandingConfig?.heroHeadingLine2 || HERO_HEADING_LINE_2_DEFAULT);
    setHeroParagraph(brandingConfig?.heroParagraph || HERO_PARAGRAPH_DEFAULT);
    setTopTab(brandingConfig?.topTab || TOP_TAB_DEFAULT);
  }, [brandingConfig]);

  const openHeroModal = (type) => {
    // Populate modal with the persisted branding values so editors see actual data
    setHeroBadge(brandingConfig?.heroBadge || HERO_BADGE_DEFAULT);
    setHeroHeadingLine1(brandingConfig?.heroHeadingLine1 || HERO_HEADING_LINE_1_DEFAULT);
    setHeroHeadingLine2(brandingConfig?.heroHeadingLine2 || HERO_HEADING_LINE_2_DEFAULT);
    setHeroParagraph(brandingConfig?.heroParagraph || HERO_PARAGRAPH_DEFAULT);
    setTopTab(brandingConfig?.topTab || TOP_TAB_DEFAULT);
    setHeroTextModal(type);
  };

  const uploadBranding = async (event) => {
    event.preventDefault();

    if (!brandingLogoFile && !brandingFaviconFile) {
      setBrandingMessage("Choose at least one file to upload.");
      return;
    }

    try {
      setBrandingUploading(true);
      setBrandingMessage("");
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const formData = new FormData();
      if (brandingLogoFile) formData.append("logo", brandingLogoFile);
      if (brandingFaviconFile) formData.append("favicon", brandingFaviconFile);

      const res = await axios.post(
        `${API_BASE_URL}/admin/branding`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const nextBranding = res.data || {};
      setBrandingConfig(nextBranding);
      setBrandingLogoFile(null);
      setBrandingFaviconFile(null);
      setBrandingMessage("Branding updated successfully.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("branding-updated", { detail: nextBranding }));
      }
    } catch (err) {
      console.error(err);
      const errorMessage = err.response?.data?.error || err.response?.data || err.message || "Failed to update branding.";
      setBrandingMessage(errorMessage);
    } finally {
      setBrandingUploading(false);
    }
  };

  const uploadWatermark = async (event) => {
    event.preventDefault();

    if (!brandingWatermarkLogoFile && !brandingWatermarkFaviconFile) {
      setBrandingMessage("Choose at least one watermark file to upload.");
      return;
    }

    try {
      setBrandingUploading(true);
      setBrandingMessage("");
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const formData = new FormData();
      if (brandingWatermarkLogoFile) formData.append("watermarkLogo", brandingWatermarkLogoFile);
      if (brandingWatermarkFaviconFile) formData.append("watermarkFavicon", brandingWatermarkFaviconFile);

      const res = await axios.post(
        `${API_BASE_URL}/admin/branding`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const nextBranding = res.data || {};
      setBrandingConfig(nextBranding);
      setBrandingWatermarkLogoFile(null);
      setBrandingWatermarkFaviconFile(null);
      setBrandingMessage("Watermark updated successfully.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("branding-updated", { detail: nextBranding }));
      }
    } catch (err) {
      console.error(err);
      const errorMessage = err.response?.data?.error || err.response?.data || err.message || "Failed to update watermark.";
      setBrandingMessage(errorMessage);
    } finally {
      setBrandingUploading(false);
    }
  };

  const uploadProfileIcons = async (event) => {
    event.preventDefault();

    if (!profileIconCustomerFile && !profileIconContributorFile && !profileIconAdminFile) {
      setBrandingMessage("Choose at least one profile icon PNG to upload.");
      return;
    }

    try {
      setBrandingUploading(true);
      setBrandingMessage("");
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const formData = new FormData();
      if (profileIconCustomerFile) formData.append("profileIconCustomer", profileIconCustomerFile);
      if (profileIconContributorFile) formData.append("profileIconContributor", profileIconContributorFile);
      if (profileIconAdminFile) formData.append("profileIconAdmin", profileIconAdminFile);

      const res = await axios.post(`${API_BASE_URL}/admin/branding/profile-icons`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const nextBranding = res.data || {};
      setBrandingConfig(nextBranding);
      setProfileIconCustomerFile(null);
      setProfileIconContributorFile(null);
      setProfileIconAdminFile(null);
      setBrandingMessage("Profile icons updated successfully.");
      window.dispatchEvent(new CustomEvent("branding-updated", { detail: nextBranding }));
    } catch (err) {
      console.error(err);
      setBrandingMessage(err.response?.data?.error || err.response?.data || err.message || "Failed to update profile icons.");
    } finally {
      setBrandingUploading(false);
    }
  };

  const restoreDefaultProfileIcons = async () => {
    try {
      setBrandingUploading(true);
      setBrandingMessage("");
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.delete(`${API_BASE_URL}/admin/branding/profile-icons`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const nextBranding = res.data || {};
      setBrandingConfig(nextBranding);
      setProfileIconCustomerFile(null);
      setProfileIconContributorFile(null);
      setProfileIconAdminFile(null);
      setBrandingMessage("Default profile icons restored.");
      window.dispatchEvent(new CustomEvent("branding-updated", { detail: nextBranding }));
    } catch (err) {
      console.error(err);
      setBrandingMessage(err.response?.data?.error || err.response?.data || err.message || "Failed to restore default profile icons.");
    } finally {
      setBrandingUploading(false);
    }
  };

  const uploadHeroBanner = async () => {
    if (!heroBannerFile) {
      setHeroBannerMessage("Choose an image to upload before saving.");
      return;
    }

    try {
      setHeroBannerSaving(true);
      setHeroBannerMessage("");
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const formData = new FormData();
      formData.append("heroBanner", heroBannerFile);

      const res = await axios.post(
        `${API_BASE_URL}/admin/branding`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const nextBranding = res.data || {};
      setBrandingConfig(nextBranding);
      setHeroBannerFile(null);
      setHeroBannerMessage("Hero banner updated successfully.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("branding-updated", { detail: nextBranding }));
      }
    } catch (err) {
      console.error(err);
      const errorMessage = err.response?.data?.error || err.response?.data || err.message || "Failed to update hero banner.";
      setHeroBannerMessage(errorMessage);
    } finally {
      setHeroBannerSaving(false);
    }
  };

  const uploadHeroTextSettings = async (event) => {
    if (event && event.preventDefault) event.preventDefault();

    try {
      setHeroTextSaving(true);
      setHeroTextMessage("");
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const formData = new FormData();
      formData.append("heroBadge", heroBadge);
      formData.append("heroHeadingLine1", heroHeadingLine1);
      formData.append("heroHeadingLine2", heroHeadingLine2);
      formData.append("heroParagraph", heroParagraph);
      formData.append("topTab", topTab);

      const res = await axios.post(
        `${API_BASE_URL}/admin/branding`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const nextBranding = res.data || {};
      setBrandingConfig(nextBranding);
      setHeroTextMessage("Hero text settings updated successfully.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("branding-updated", { detail: nextBranding }));
      }
    } catch (err) {
      console.error(err);
      const errorMessage = err.response?.data?.error || err.response?.data || err.message || "Failed to update hero text settings.";
      setHeroTextMessage(errorMessage);
    } finally {
      setHeroTextSaving(false);
    }
  };

  const uploadCustomerBanner = async () => {
    if (!customerBannerFile) {
      setCustomerBannerMessage("Choose an image to upload before saving.");
      return;
    }

    try {
      setCustomerBannerSaving(true);
      setCustomerBannerMessage("");
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const formData = new FormData();
      formData.append("customerBanner", customerBannerFile);
      const res = await axios.post(`${API_BASE_URL}/admin/branding`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const nextBranding = res.data || {};
      setBrandingConfig(nextBranding);
      setCustomerBannerFile(null);
      setCustomerBannerMessage("Customer banner updated successfully.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("branding-updated", { detail: nextBranding }));
      }
    } catch (err) {
      console.error(err);
      setCustomerBannerMessage(err.response?.data?.error || err.response?.data || err.message || "Failed to update customer banner.");
    } finally {
      setCustomerBannerSaving(false);
    }
  };

  const uploadContributorBanner = async () => {
    if (!contributorBannerFile) {
      setContributorBannerMessage("Choose an image to upload before saving.");
      return;
    }

    try {
      setContributorBannerSaving(true);
      setContributorBannerMessage("");
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const formData = new FormData();
      formData.append("contributorBanner", contributorBannerFile);
      const res = await axios.post(`${API_BASE_URL}/admin/branding`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const nextBranding = res.data || {};
      setBrandingConfig(nextBranding);
      setContributorBannerFile(null);
      setContributorBannerMessage("Contributor banner updated successfully.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("branding-updated", { detail: nextBranding }));
      }
    } catch (err) {
      console.error(err);
      setContributorBannerMessage(err.response?.data?.error || err.response?.data || err.message || "Failed to update contributor banner.");
    } finally {
      setContributorBannerSaving(false);
    }
  };

  const resetHeroBanner = async () => {
    try {
      setHeroBannerSaving(true);
      setHeroBannerMessage("");
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.delete(
        `${API_BASE_URL}/admin/branding/hero-banner`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const nextBranding = res.data || {};
      setBrandingConfig(nextBranding);
      setHeroBannerFile(null);
      setHeroBannerMessage("Hero banner restored to the default background.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("branding-updated", { detail: nextBranding }));
      }
    } catch (err) {
      console.error(err);
      const errorMessage = err.response?.data?.error || err.response?.data || err.message || "Failed to reset hero banner.";
      setHeroBannerMessage(errorMessage);
    } finally {
      setHeroBannerSaving(false);
    }
  };

  const updateUserFormField = (field, value) => {
    setUserEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const normalizeCustomPermissions = (permissions) => {
    const safePermissions = typeof permissions === "object" && permissions !== null ? permissions : {};
    const uploadLimitValue = Number(safePermissions.upload_limit_value ?? 20);
    const normalizedValue = [1, 5, 10, 20, 100].includes(uploadLimitValue) ? uploadLimitValue : 20;
    const normalizedUnit = ["MB", "GB"].includes(String(safePermissions.upload_limit_unit || "MB").toUpperCase())
      ? String(safePermissions.upload_limit_unit || "MB").toUpperCase()
      : "MB";

    return {
      bulk_upload: Boolean(safePermissions.bulk_upload),
      upload_limit_value: normalizedValue,
      upload_limit_unit: normalizedUnit,
      ...safePermissions
    };
  };

  const getUploadLimitDisplay = (customPermissions = {}) => {
    const normalized = normalizeCustomPermissions(customPermissions);
    const value = Number(normalized.upload_limit_value ?? 20);
    const unit = String(normalized.upload_limit_unit || "MB").toUpperCase();
    return `${value} ${unit}`;
  };

  const filteredUsers = users.filter((user) => {
    if (userFilter === "all") return true;
    if (userFilter === "admin") return String(user.role || "").toLowerCase() === "admin";
    if (userFilter === "blocked") return String(user.status || "").toLowerCase() === "blocked";
    return String(user.status || "").toLowerCase() === userFilter;
  });

  const startEditingUser = (user) => {
    setEditingUserId(user.id);
    setIsUserModalOpen(true);
    setUserEditForm({
      full_name: user.full_name || "",
      username: user.username || "",
      email: user.email || "",
      role: user.role || "",
      identity_number: user.identity_number || "",
      credits: user.credits != null ? String(user.credits) : "",
      status: user.status || "",
      otp_enabled: user.otp_enabled !== false,
      password: "",
      custom_permissions: normalizeCustomPermissions(user.custom_permissions)
    });
  };

  const cancelEditingUser = () => {
    setEditingUserId(null);
    setIsUserModalOpen(false);
    setUserEditForm({
      full_name: "",
      username: "",
      email: "",
      role: "",
      identity_number: "",
      credits: "",
      status: "",
      password: "",
      otp_enabled: true,
      custom_permissions: normalizeCustomPermissions({})
    });
  };

  const openDeleteConfirmation = (user) => {
    setDeleteConfirmationUser(user);
  };

  const closeDeleteConfirmation = () => {
    setDeleteConfirmationUser(null);
  };

  const saveUserDetails = async (id) => {
    setIsUserSaving(true);
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const payload = {
        full_name: userEditForm.full_name,
        username: userEditForm.username,
        email: userEditForm.email,
        role: userEditForm.role,
        identity_number: userEditForm.identity_number,
        credits: userEditForm.credits !== "" ? Number(userEditForm.credits) : null,
        status: userEditForm.status,
        otp_enabled: Boolean(userEditForm.otp_enabled),
        custom_permissions: normalizeCustomPermissions(userEditForm.custom_permissions || {}),
        ...(userEditForm.password ? { password: userEditForm.password } : {})
      };

      let res;
      if (id == null) {
        res = await axios.post(
          `${API_BASE_URL}/admin/users`,
          payload,
          {
            headers: { Authorization: `Bearer ${token}` }
          }
        );
      } else {
        res = await axios.put(
          `${API_BASE_URL}/admin/users/${id}`,
          payload,
          {
            headers: { Authorization: `Bearer ${token}` }
          }
        );
      }

      const savedUser = {
        ...res.data,
        otp_enabled: res.data?.otp_enabled !== false,
        custom_permissions: normalizeCustomPermissions(res.data?.custom_permissions)
      };
      setUsers((prev) => {
        if (id == null) {
          return [savedUser, ...prev];
        }
        return prev.map((user) => (user.id == id ? savedUser : user));
      });
      toast.success("User saved successfully.");
      const currentUserId = typeof window !== 'undefined' ? window.localStorage.getItem('userId') : null;
      if (currentUserId && String(savedUser.id) === String(currentUserId)) {
        window.dispatchEvent(new Event('auth-changed'));
      }
      setEditingUserId(null);
      setIsUserModalOpen(false);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data || err.message || "Failed to save user.");
    } finally {
      setIsUserSaving(false);
    }
  };

  const addCreditsToUser = async () => {
    const amount = Number(creditAmount);
    if (!creditUserId || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Select a user and enter a positive credit amount.");
      return;
    }

    setIsAddingCredits(true);
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.put(
        `${API_BASE_URL}/admin/users/${creditUserId}/credits`,
        { credits: amount },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setUsers((prev) => prev.map((user) => (String(user.id) === String(creditUserId) ? res.data : user)));
      setCreditAmount("");
      toast.success(`Added ${amount} credits to ${res.data.username}.`);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data || err.message || "Failed to add credits.");
    } finally {
      setIsAddingCredits(false);
    }
  };

  const activateUser = async (id) => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.put(
        `${API_BASE_URL}/admin/users/${id}/approve`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      setUsers((prev) => prev.map((user) => (user.id === id ? res.data : user)));
    } catch (err) {
      console.error(err);
    }
  };

  const blockUser = async (id) => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.put(
        `${API_BASE_URL}/admin/users/${id}/block`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (res.data) {
        setUsers((prev) => prev.map((user) => (user.id === id ? res.data : user)));
      }
      await fetchUsers();
    } catch (err) {
      console.error("Block user failed", err);
      alert(
        err.response?.data ||
          err.message ||
          "Failed to block user. Please try again."
      );
    }
  };

  const deleteUser = async (id) => {
    if (!id) return;

    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.delete(
        `${API_BASE_URL}/admin/users/${id}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (res.status === 202) {
        if (res.data?.user) {
          setUsers((prev) => prev.map((user) => (user.id === id ? res.data.user : user)));
        } else {
          await fetchUsers();
        }
        setDeleteConfirmationUser(null);
        toast.info(res.data?.message || `User deletion scheduled for ${USER_DELETE_COOLING_PERIOD_MINUTES} minutes.`);
        return;
      }
      setUsers((prev) => prev.filter((user) => user.id !== id));
      if (editingUserId === id) {
        cancelEditingUser();
      }
      setDeleteConfirmationUser(null);
    } catch (err) {
      console.error(err);
      alert(
        err.response?.data ||
          err.message ||
          "Failed to delete user. Please try again."
      );
    }
  };

  const forceDeleteUser = async (id) => {
    if (!id) return;

    const confirmed = window.confirm(
      "This action cannot be undone. Permanently delete this user now?"
    );

    if (!confirmed) return;

    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.delete(
        `${API_BASE_URL}/admin/users/${id}/force-delete`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      setUsers((prev) => prev.filter((user) => user.id !== id));
      if (editingUserId === id) {
        cancelEditingUser();
      }
      setDeleteConfirmationUser(null);
      toast.success(res.data?.message || "User deleted permanently.");
    } catch (err) {
      console.error(err);
      alert(
        err.response?.data ||
          err.message ||
          "Failed to permanently delete user. Please try again."
      );
    }
  };

  const cancelUserDeletion = async (id) => {
    if (!id) return;

    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.delete(
        `${API_BASE_URL}/admin/users/${id}/cancel-deletion`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (res.data?.user) {
        setUsers((prev) => prev.map((user) => (user.id === id ? res.data.user : user)));
      }
      setDeleteConfirmationUser(null);
      toast.success(res.data?.message || "Deletion process cancelled.");
    } catch (err) {
      console.error(err);
      alert(
        err.response?.data ||
          err.message ||
          "Failed to cancel deletion. Please try again."
      );
    }
  };

  const addCategory = async () => {
    const trimmedCategory = newCategory.trim();
    if (!trimmedCategory) {
      setNewCategoryError("Category name is required");
      return;
    }

    setNewCategoryError("");

    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.post(
        `${API_BASE_URL}/admin/categories`,
        { name: trimmedCategory },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      setCategories((prev) => {
        const nextCategories = [...prev, res.data];
        persistCategories(nextCategories);
        return nextCategories;
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("asset-categories-updated"));
      }
      setNewCategory("");
    } catch (err) {
      console.error(err);
      setNewCategoryError("Unable to add category");
    }
  };

  const addCollection = async () => {
    if (!newCollection.trim()) return;

    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.post(
        `${API_BASE_URL}/admin/collections`,
        { name: newCollection.trim() },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      setCollections((prev) => {
        const nextCollections = [...prev, res.data];
        persistCollections(nextCollections);
        return nextCollections;
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("asset-collections-updated"));
      }
      setNewCollection("");
      setDeleteWarning(null);
    } catch (err) {
      console.error(err);
    }
  };

  const deleteCategory = async (id) => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      await axios.delete(
        `${API_BASE_URL}/admin/categories/${id}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      setCategories((prev) => {
        const nextCategories = prev.filter((category) => category.id !== id);
        persistCategories(nextCategories);
        return nextCategories;
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("asset-categories-updated"));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteCollection = async (id) => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      await axios.delete(
        `${API_BASE_URL}/admin/collections/${id}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      setCollections((prev) => {
        const nextCollections = prev.filter((collectionItem) => collectionItem.id !== id);
        persistCollections(nextCollections);
        return nextCollections;
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("asset-collections-updated"));
      }
      setDeleteWarning(null);
    } catch (err) {
      if (err?.response?.status === 409 && err?.response?.data) {
        setDeleteWarning({
          collection: err.response.data,
          assetCount: err.response.data?.assetCount || 0,
          assets: err.response.data?.assets || []
        });
        return;
      }
      console.error(err);
    }
  };

  const startEditingCollection = (collectionItem) => {
    setEditingCollectionInModal(collectionItem.id);
    setEditingCollectionNameInModal(collectionItem.name || "");
  };

  const startEditingCategory = (categoryItem) => {
    setEditingCategoryInModal(categoryItem.id);
    setEditingCategoryNameInModal(categoryItem.name || "");
  };

  const buildCsvContent = (rows, headers) => [
    headers.join(","),
    ...rows.map((row) => headers.map((field) => `"${String(row[field] ?? "").replace(/"/g, '""')}"`).join(","))
  ].join("\n");

  const downloadCsvFile = (csvContent, filename) => {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const exportLiveAssetsCsv = async () => {
    try {
      setLiveAssetsExportStatus("Preparing CSV...");
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.get(
        `${API_BASE_URL}/admin/images`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      const allAssets = Array.isArray(res.data) ? res.data : [];
      const exportAssets = allAssets.filter((image) => {
        const status = String(image?.status || "").toLowerCase();
        return status === "approved" || status === "pending" || status === "rejected";
      });
      const rows = exportAssets.map((image) => ({
        id: image.id,
        title: image.title || "",
        contributor: image.contributor_username || image.contributor || "",
        collection: image.collection || "",
        category: image.category || "",
        type: image.type || "",
        status: image.status || "",
        filename: image.filename || image.storage_filename || "",
        created_at: image.created_at || image.createdAt || "",
        updated_at: image.updated_at || image.updatedAt || "",
        price: image.price || "",
        downloads: image.downloads || image.download_count || 0
      }));

      const headers = ["id", "title", "contributor", "collection", "category", "type", "status", "filename", "created_at", "updated_at", "price", "downloads"];
      const csvContent = buildCsvContent(rows, headers);
      downloadCsvFile(csvContent, `all-assets-${(new Date()).toISOString().slice(0,10)}.csv`);
      setLiveAssetsExportStatus("CSV download started.");
    } catch (err) {
      console.error("Failed to export live assets CSV", err);
      setLiveAssetsExportStatus("CSV export failed.");
      alert("Unable to export live assets CSV right now.");
    }
  };

  const exportUsersCsv = () => {
    if (!Array.isArray(filteredUsers) || filteredUsers.length === 0) {
      setUserExportStatus("No users to export.");
      return;
    }

    try {
      setUserExportStatus("Preparing CSV...");
      const rows = filteredUsers.map((user) => ({
        id: user.id ?? "",
        full_name: user.full_name || user.name || "",
        username: user.username || "",
        email: user.email || "",
        role: user.role || "",
        identity_number: user.identity_number || "",
        credits: user.credits ?? "",
        status: user.status || "",
        otp_enabled: user.otp_enabled == null ? "" : Boolean(user.otp_enabled),
        custom_permissions: (() => {
          if (!user.custom_permissions) return "";
          try {
            return typeof user.custom_permissions === "string"
              ? user.custom_permissions
              : JSON.stringify(user.custom_permissions);
          } catch (err) {
            return String(user.custom_permissions);
          }
        })(),
        created_at: user.created_at || user.createdAt || "",
        updated_at: user.updated_at || user.updatedAt || ""
      }));

      const headers = [
        "id",
        "full_name",
        "username",
        "email",
        "role",
        "identity_number",
        "credits",
        "status",
        "otp_enabled",
        "custom_permissions",
        "created_at",
        "updated_at"
      ];
      const csvContent = buildCsvContent(rows, headers);
      downloadCsvFile(csvContent, `all-users-${(new Date()).toISOString().slice(0,10)}.csv`);
      setUserExportStatus("CSV download started.");
    } catch (err) {
      console.error("Failed to export users CSV", err);
      setUserExportStatus("CSV export failed.");
      alert("Unable to export users CSV right now.");
    }
  };

  useEffect(() => {
    if (editingCategoryInModal === "__pending__" && visibleCategories.length > 0) {
      const nextCategory = visibleCategories[0];
      setEditingCategoryInModal(nextCategory.id);
      setEditingCategoryNameInModal(nextCategory.name || "");
    }
  }, [editingCategoryInModal, visibleCategories]);

  useEffect(() => {
    if (editingCollectionInModal === "__pending__" && visibleCollections.length > 0) {
      const nextCollection = visibleCollections[0];
      setEditingCollectionInModal(nextCollection.id);
      setEditingCollectionNameInModal(nextCollection.name || "");
    }
  }, [editingCollectionInModal, visibleCollections]);

  const parseCategoryValues = (categoryValue) => {
    const values = String(categoryValue || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    return {
      categoryPrimary: values[0] || "",
      categorySecondary: values[1] || ""
    };
  };

  const openImage = (image, shouldEdit = false) => {
    setSelectedImage(image);
    setIsEditing(shouldEdit);
    const categoryValues = parseCategoryValues(image.category);
    setEditForm({
      title: image.title || "",
      categoryPrimary: categoryValues.categoryPrimary,
      categorySecondary: categoryValues.categorySecondary,
      collection: image.collection || "",
      keywords: image.keywords || "",
      description: image.description || "",
      type: image.type || ""
    });
  };

  const closeModal = async () => {
    setSelectedImage(null);
    setIsEditing(false);
    if (tabParam === "live-assets") {
      await fetchApprovedImages();
    }
  };

  const resetEditForm = (image) => {
    const resetCategoryValues = parseCategoryValues(image?.category);
    setEditForm({
      title: image?.title || "",
      categoryPrimary: resetCategoryValues.categoryPrimary,
      categorySecondary: resetCategoryValues.categorySecondary,
      collection: image?.collection || "",
      keywords: image?.keywords || "",
      description: image?.description || "",
      type: image?.type || ""
    });
  };

  const setEditField = (field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const getCategoryOptions = (index) => {
    const selectedInOtherField = index === 0 ? editForm.categorySecondary : editForm.categoryPrimary;
    return visibleCategories.filter((option) => option.name !== selectedInOtherField);
  };

  const handleEditTitleChange = (e) => {
    setEditField("title", limitWords(e.target.value, 5));
  };

  const handleEditDescriptionChange = (e) => {
    setEditField("description", limitWords(e.target.value, 10));
  };

  const handleEditKeywordChange = (e) => {
    setEditField("keywords", e.target.value);
  };

  const handleEditKeywordKeyDown = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      setEditField("keywords", formatKeywords(editForm.keywords, 14));
    }
  };

  const updateSelectedThumbnail = async () => {
    if (!selectedImage || !thumbnailFile) return;

    const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
    const formData = new FormData();
    formData.append("thumbnail", thumbnailFile);

    try {
      const res = await axios.post(
        `${API_BASE_URL}/images/${selectedImage.id}/thumbnail`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/form-data"
          }
        }
      );

      const updated = res.data || {};
      const merged = { ...selectedImage, ...updated };
      setSelectedImage(merged);
      setImages((prev) => prev.map((image) => (Number(image.id) === Number(updated.id) ? merged : image)));
      setThumbnailFile(null);
      window.dispatchEvent(new Event("asset-updated"));
      window.dispatchEvent(new Event("asset-refresh"));
    } catch (err) {
      console.error(err);
    }
  };

  const saveDetails = async () => {
    if (!selectedImage) return;

    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const categoryValue = [editForm.categoryPrimary, editForm.categorySecondary]
        .filter(Boolean)
        .join(",");

      const payload = {
        title: editForm.title,
        category: categoryValue,
        collection: editForm.collection || selectedImage.collection || "",
        keywords: editForm.keywords,
        description: editForm.description,
        type: editForm.type
      };

      const res = await axios.put(
        `${API_BASE_URL}/images/${selectedImage.id}`,
        payload,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const updated = res.data || {};
      const nextCategoryValue = [editForm.categoryPrimary, editForm.categorySecondary]
        .filter(Boolean)
        .join(",");
      const nextCollectionValue = editForm.collection || selectedImage.collection || updated.collection || "";
      const merged = {
        ...selectedImage,
        ...updated,
        title: editForm.title,
        category: nextCategoryValue,
        collection: nextCollectionValue,
        keywords: editForm.keywords,
        description: editForm.description,
        type: editForm.type
      };

      const finalMergedImage = {
        ...merged,
        collection: nextCollectionValue,
        category: nextCategoryValue,
        title: editForm.title,
        keywords: editForm.keywords,
        description: editForm.description,
        type: editForm.type
      };

      setSelectedImage(finalMergedImage);
      setImages((prev) => prev.map((image) => (Number(image.id) === Number(finalMergedImage.id) ? finalMergedImage : image)));
      await fetchCollections();
      if (tabParam === "live-assets") {
        const refreshedImages = await fetchApprovedImages();
        const nextMergedImage = refreshedImages.find((image) => Number(image.id) === Number(finalMergedImage.id)) || finalMergedImage;
        const serverMergedImage = {
          ...nextMergedImage,
          collection: nextCollectionValue,
          category: nextCategoryValue,
          title: editForm.title,
          keywords: editForm.keywords,
          description: editForm.description,
          type: editForm.type
        };
        setSelectedImage(serverMergedImage);
        setImages((prev) => {
          const normalizedPrev = Array.isArray(prev) ? prev : [];
          if (refreshedImages.length > 0) {
            return refreshedImages.map((image) => Number(image.id) === Number(serverMergedImage.id) ? serverMergedImage : image);
          }
          return normalizedPrev.map((image) => (Number(image.id) === Number(serverMergedImage.id) ? serverMergedImage : image));
        });
      }
      if (typeof window !== "undefined") {
        const refreshPayload = {
          ...merged,
          collection: nextCollectionValue,
          category: nextCategoryValue,
          title: editForm.title,
          keywords: editForm.keywords,
          description: editForm.description,
          type: editForm.type
        };
        window.dispatchEvent(new Event("asset-updated"));
        window.dispatchEvent(new CustomEvent("asset-updated-detail", { detail: refreshPayload }));
        window.dispatchEvent(new Event("asset-refresh"));
        window.dispatchEvent(new Event("asset-collections-updated"));
        window.dispatchEvent(new Event("home-assets-refresh"));
      }
      setIsEditing(false);
      await closeModal();
    } catch (err) {
      console.error(err);
    }
  };

  const approveImage = async (id) => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      await axios.put(
        `${API_BASE_URL}/admin/approve/${id}`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      await fetchCollections();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("asset-refresh"));
        window.dispatchEvent(new Event("asset-updated"));
        window.dispatchEvent(new Event("asset-collections-updated"));
      }
      fetchImages();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteImage = async (id) => {
    const confirmDelete = window.confirm("Permanently delete this image?");
    if (!confirmDelete) return;

    try {
      await axios.delete(`${API_BASE_URL}/images/${id}`);
      if (tabParam === "live-assets") {
        fetchApprovedImages();
      } else {
        fetchImages();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const rejectImage = async (id) => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      await axios.put(
        `${API_BASE_URL}/admin/reject/${id}`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      await fetchCollections();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("asset-refresh"));
        window.dispatchEvent(new Event("asset-updated"));
        window.dispatchEvent(new Event("asset-collections-updated"));
      }
      if (tabParam === "live-assets") {
        fetchApprovedImages();
      } else {
        fetchImages();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const downloadOriginalFile = async (imageId) => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const response = await axios.get(
        `${API_BASE_URL}/images/${imageId}/download-original`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'blob'
        }
      );
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      // Extract filename from response headers or use default
      const contentDisposition = response.headers['content-disposition'];
      let filename = 'original-file';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="([^"]+)"/);
        filename = match ? match[1] : 'original-file';
      }
      
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error("Failed to download original file");
    }
  };

  const downloadThumbnail = async (image) => {
    try {
      if (!image.thumbnail_url) {
        toast.warning("No thumbnail available for this asset");
        return;
      }

      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const response = await axios.get(
        `${API_BASE_URL}/images/${image.id}/download-thumbnail`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'blob'
        }
      );
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      // Extract filename from response or use default
      const contentDisposition = response.headers['content-disposition'];
      let filename = `thumbnail-${image.id}`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="([^"]+)"/);
        filename = match ? match[1] : filename;
      }
      
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error("Failed to download thumbnail");
    }
  };

  return (
    <div style={{ marginTop: "30px", colorScheme: isDarkMode ? "dark" : "light" }}>
      {!isControlsTab && !isBackupTab && !isEmptyAdminBodyTab && <h2>{adminPageHeading}</h2>}

      {shouldShowImageGrid && <p>Total Images: {images.length}</p>}

      {isDailyReportPreviewRouteOpen && !dailyReportSchedulingOpen ? (
        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: isDarkMode ? "#64b8ff" : "#2563eb", marginBottom: 4 }}>Daily Report Summary</div>
              <h2 style={{ margin: 0 }}>Website Analytics Preview</h2>
            </div>
            <button type="button" onClick={closeDailyReportPreview} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: isDarkMode ? "#334155" : "#e2e8f0", color: isDarkMode ? "#f8fafc" : "#0f172a", cursor: "pointer", fontWeight: 600 }}>Close</button>
          </div>
          {dailyReportPreviewLoading ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: isDarkMode ? "#a8d4f5" : "#0369a1" }}>Loading real-time data...</div>
          ) : (
            <div style={{ display: "grid", gap: 18, width: "100%" }}>
              {getDailyReportPreviewGroups().map((group) => (
                <section key={group.key} style={{ display: "grid", gap: 10 }}>
                  <h3 style={{ margin: 0, padding: "10px 12px", borderRadius: 10, background: isDarkMode ? "rgba(30,41,59,0.82)" : "#eef4ff", color: isDarkMode ? "#dbeafe" : "#1e3a8a", fontSize: 14, fontWeight: 800 }}>{group.label}</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              {group.rows.map((row) => (
                <div key={row.key} style={{ width: "100%", minHeight: 200, boxSizing: "border-box", padding: "12px 10px 10px", borderRadius: 14, background: isDarkMode ? "linear-gradient(135deg, rgba(37,99,235,0.16), rgba(14,165,233,0.08))" : "linear-gradient(135deg, rgba(37,99,235,0.08), rgba(14,165,233,0.04))", border: isDarkMode ? "1.5px solid rgba(96,165,250,0.3)" : "1.5px solid rgba(37,99,235,0.18)", boxShadow: isDarkMode ? "0 10px 18px rgba(2,6,23,0.22)" : "0 4px 12px rgba(15,23,42,0.08)", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: isDarkMode ? "#93c5fd" : "#2563eb", marginBottom: 2 }}>{row.label}</div>
                  {row.key === "paymentFailedCount" && (DAILY_REPORT_PREVIEW_VALUES.paymentFailedCurrencyBreakdown || []).length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 18, fontWeight: 800, color: isDarkMode ? "#e0f2fe" : "#1d4ed8", lineHeight: 1.3 }}>{DAILY_REPORT_PREVIEW_VALUES.paymentFailedCurrencyBreakdown.map((item) => <span key={item.currency}>{formatPaymentFailedCurrencyTotal(item)}</span>)}</div>}
                  {row.key === "totalRevenueInr" && (DAILY_REPORT_PREVIEW_VALUES.revenueCurrencyBreakdown || []).length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 18, fontWeight: 800, color: isDarkMode ? "#e0f2fe" : "#1d4ed8", lineHeight: 1.3 }}>{DAILY_REPORT_PREVIEW_VALUES.revenueCurrencyBreakdown.map((item) => <span key={item.currency || item.name}>{formatRevenueCurrencyTotal(item)}</span>)}</div>}
                  {row.key === "totalDiscountInr" && (DAILY_REPORT_PREVIEW_VALUES.discountCurrencyBreakdown || []).length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 18, fontWeight: 800, color: isDarkMode ? "#e0f2fe" : "#1d4ed8", lineHeight: 1.3 }}>{DAILY_REPORT_PREVIEW_VALUES.discountCurrencyBreakdown.map((item) => <span key={item.currency}>{formatRevenueCurrencyTotal(item)}</span>)}</div>}
                  {row.key === "totalEarningsInr" && (DAILY_REPORT_PREVIEW_VALUES.earningsCurrencyBreakdown || []).length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 18, fontWeight: 800, color: isDarkMode ? "#e0f2fe" : "#1d4ed8", lineHeight: 1.3 }}>{DAILY_REPORT_PREVIEW_VALUES.earningsCurrencyBreakdown.map((item) => <span key={item.currency}>{formatRevenueCurrencyTotal(item)}</span>)}</div>}
                  {row.key.match(/^(revenue|discount|earnings)(Last7Days|Last30Days|CurrentMonth|CurrentFy|Last365Days)$/) && (DAILY_REPORT_PREVIEW_VALUES[row.key] || []).length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 18, fontWeight: 800, color: isDarkMode ? "#e0f2fe" : "#1d4ed8", lineHeight: 1.3 }}>{DAILY_REPORT_PREVIEW_VALUES[row.key].map((item) => <span key={item.currency}>{formatRevenueCurrencyTotal(item)}</span>)}</div>}
                  {row.key !== "paymentFailedCount" && row.key !== "totalRevenueInr" && row.key !== "totalDiscountInr" && row.key !== "totalEarningsInr" && !row.key.match(/^(revenue|discount|earnings)(Last7Days|Last30Days|CurrentMonth|CurrentFy|Last365Days)$/) && <div style={{ fontSize: 26, fontWeight: 800, color: isDarkMode ? "#e0f2fe" : "#1d4ed8", lineHeight: 1.15, wordBreak: "break-word" }}>{DAILY_REPORT_PREVIEW_VALUES[row.key] || "—"}</div>}
                  {renderDailyReportBreakdowns(row.key)}
                </div>
              ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {dailyReportSmtpFormOpen && (
            <div style={{ padding: 16, borderRadius: 14, background: isDarkMode ? 'rgba(15,23,42,0.72)' : '#f8fafc', border: isDarkMode ? '1px solid rgba(148,163,184,0.2)' : '1px solid #e2e8f0' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Daily Report SMTP Settings</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                {[
                  ['sender_name', 'Sender name', 'text'],
                  ['sender_email', 'Sender email', 'email'],
                  ['smtp_host', 'SMTP host', 'text'],
                  ['smtp_port', 'SMTP port', 'number'],
                  ['smtp_user', 'SMTP username', 'text'],
                  ['smtp_pass', 'SMTP password', 'password']
                ].map(([key, label, type]) => (
                  <label key={key} style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 600 }}>
                    {label}
                    <input type={type} value={dailyReportSmtpDraft[key] || ''} onChange={(event) => setDailyReportSmtpDraft((previous) => ({ ...previous, [key]: event.target.value }))} style={{ padding: '9px 10px', borderRadius: 8, border: isDarkMode ? '1px solid rgba(148,163,184,0.25)' : '1px solid #cbd5e1', background: isDarkMode ? '#0f172a' : '#fff', color: isDarkMode ? '#f8fafc' : '#0f172a' }} />
                  </label>
                ))}
              </div>
              {dailyReportSmtpMessage && <div role="status" style={{ marginTop: 10, color: dailyReportSmtpMessage.includes('successfully') || dailyReportSmtpMessage.includes('saved') ? '#16a34a' : '#b91c1c', fontSize: 12, fontWeight: 600 }}>{dailyReportSmtpMessage}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button type="button" onClick={verifyDailyReportSmtpSettings} disabled={dailyReportSmtpSaving} style={{ padding: '9px 12px', borderRadius: 8, border: 0, background: '#7c3aed', color: '#fff', cursor: dailyReportSmtpSaving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Verify SMTP Settings</button>
                <button type="button" onClick={saveDailyReportSmtpSettings} disabled={dailyReportSmtpSaving} style={{ padding: '9px 12px', borderRadius: 8, border: 0, background: '#2563eb', color: '#fff', cursor: dailyReportSmtpSaving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Save SMTP for Daily Reports</button>
                <button type="button" onClick={() => { setDailyReportTestMailRecipient(''); setDailyReportTestMailOpen(true); }} disabled={dailyReportSmtpSaving} style={{ padding: '9px 12px', borderRadius: 8, border: 0, background: '#0f766e', color: '#fff', cursor: dailyReportSmtpSaving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Send Test Mail</button>
              </div>
            </div>
          )}
          {dailyReportTestMailOpen && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 1700, background: 'rgba(2,6,23,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <div role="dialog" aria-modal="true" aria-label="Send Test Mail" style={{ width: '100%', maxWidth: 460, padding: 22, borderRadius: 14, background: isDarkMode ? '#0f172a' : '#fff', color: isDarkMode ? '#f8fafc' : '#0f172a', boxShadow: '0 24px 70px rgba(0,0,0,0.28)' }}>
                <h3 style={{ margin: '0 0 8px' }}>Send Test Mail</h3>
                <p style={{ margin: '0 0 16px', color: isDarkMode ? '#cbd5e1' : '#64748b', fontSize: 13 }}>Enter the email address that should receive this daily report test.</p>
                <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Recipient email
                  <input type="email" autoFocus value={dailyReportTestMailRecipient} onChange={(event) => setDailyReportTestMailRecipient(event.target.value)} placeholder="recipient@example.com" style={{ padding: '10px 12px', borderRadius: 8, border: isDarkMode ? '1px solid #475569' : '1px solid #cbd5e1', background: isDarkMode ? '#111827' : '#fff', color: isDarkMode ? '#f8fafc' : '#0f172a' }} />
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                  <button type="button" onClick={() => setDailyReportTestMailOpen(false)} style={{ padding: '10px 14px', borderRadius: 8, border: 0, background: isDarkMode ? '#334155' : '#e2e8f0', color: isDarkMode ? '#f8fafc' : '#0f172a', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
                  <button type="button" onClick={sendDailyReportNow} disabled={dailyReportSmtpSaving || !dailyReportTestMailRecipient.trim()} style={{ padding: '10px 14px', borderRadius: 8, border: 0, background: '#0f766e', color: '#fff', cursor: dailyReportSmtpSaving || !dailyReportTestMailRecipient.trim() ? 'not-allowed' : 'pointer', fontWeight: 600 }}>{dailyReportSmtpSaving ? 'Sending...' : 'Send Test Mail'}</button>
                </div>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 16, borderTop: isDarkMode ? '1px solid rgba(148,163,184,0.2)' : '1px solid #e2e8f0' }}>
            <button type="button" onClick={openDailyReportSmtpForm} style={{ padding: '12px 18px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Report SMTP Setting</button>
            <button type="button" onClick={openDailyReportScheduleFromPreview} style={{ padding: '12px 18px', borderRadius: 10, border: 'none', background: '#0f766e', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Schedule Report</button>
          </div>
        </div>
      ) : isDailyReportSettingsRouteOpen ? (
        renderDailyReportSettingsContent()
      ) : isBackupTab ? (
        <div style={{ display: "grid", gap: "20px" }}>
          <div style={{ padding: "24px", borderRadius: "14px", border: "1px solid #dfe7ee", background: isDarkMode ? "#0f172a" : "#f8fafc", color: isDarkMode ? "#f8fafc" : "#111827", boxShadow: isDarkMode ? "0 18px 40px rgba(2, 6, 23, 0.42)" : "0 6px 18px rgba(15, 23, 42, 0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "18px", flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "2rem" }}>GFX Backup</h2>
                <p style={{ margin: "8px 0 0", color: isDarkMode ? "#cbd5e1" : "#475569" }}>Create a portable read-only backup package for this admin environment.</p>
              </div>
              <span style={{ padding: "8px 12px", borderRadius: "999px", background: "#dcfce7", color: "#166534", fontWeight: 700, fontSize: "0.8rem" }}>Admin Only</span>
            </div>

            <div style={{ display: "grid", gap: "18px", width: "100%" }}>
              <div style={{ display: "grid", gap: "12px" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Backup Mode</span>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
                    {[
                      { value: "incremental", label: "Incremental Backup" },
                      { value: "complete", label: "Complete Backup" }
                    ].map((option) => (
                      <label
                        key={option.value}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "12px 14px",
                          borderRadius: "10px",
                          border: backupMode === option.value ? "2px solid #2563eb" : "1px solid #cbd5e1",
                          background: backupMode === option.value ? (isDarkMode ? "#1d4ed8" : "#dbeafe") : isDarkMode ? "#111827" : "#ffffff",
                          color: isDarkMode ? "#f8fafc" : "#111827",
                          cursor: "pointer",
                          fontWeight: 600
                        }}
                      >
                        <input
                          type="radio"
                          name="gfx-backup-mode"
                          value={option.value}
                          checked={backupMode === option.value}
                          onChange={() => setBackupMode(option.value)}
                          aria-label={option.label}
                          style={{ accentColor: "#2563eb" }}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Backup From</span>
                    <input
                      type="date"
                      value={backupFromDate}
                      onChange={(event) => setBackupFromDate(event.target.value)}
                      style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: isDarkMode ? "#111827" : "#fff", color: isDarkMode ? "#f8fafc" : "#111827" }}
                    />
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Backup To</span>
                    <input
                      type="date"
                      value={backupToDate}
                      onChange={(event) => setBackupToDate(event.target.value)}
                      style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: isDarkMode ? "#111827" : "#fff", color: isDarkMode ? "#f8fafc" : "#111827" }}
                    />
                  </label>
                </div>
              </div>

              <div style={{ display: "grid", gap: "12px" }}>
                <button
                  type="button"
                  onClick={createGfxBackupPackage}
                  disabled={backupBusy}
                  style={{
                    background: backupBusy ? "#94a3b8" : "#2563eb",
                    color: "white",
                    border: "none",
                    borderRadius: "10px",
                    padding: "12px 16px",
                    cursor: backupBusy ? "not-allowed" : "pointer",
                    fontWeight: 700,
                    width: "fit-content",
                    minWidth: "160px"
                  }}
                >
                  {backupBusy ? "Creating Backup..." : "Create Backup"}
                </button>

                {(backupBusy || backupSummary || backupProgress > 0) && (
                  <div style={{ display: "grid", gap: "10px" }}>
                    <div style={{ fontSize: "0.95rem", fontWeight: 700, color: isDarkMode ? "#e2e8f0" : "#0f172a" }}>
                      {backupStatusText}
                    </div>

                    <div style={{ display: "grid", gap: "8px" }}>
                      {backupProgressStages.map((step, index) => {
                        const isComplete = backupStageIndex > index || (!backupBusy && backupSummary);
                        const isActive = backupBusy && backupStageIndex === index;
                        return (
                          <div key={step} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.88rem", color: isActive ? (isDarkMode ? "#f8fafc" : "#0f172a") : (isComplete ? "#22c55e" : (isDarkMode ? "#cbd5e1" : "#475569")) }}>
                            <span>{isComplete ? "✓" : isActive ? "●" : "○"}</span>
                            <span>{step}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ display: "grid", gap: "8px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", color: isDarkMode ? "#cbd5e1" : "#475569" }}>
                        <span>Progress</span>
                        <span>{backupProgress}%</span>
                      </div>
                      {backupBusy && backupRemainingSeconds > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", color: isDarkMode ? "#cbd5e1" : "#475569" }}>
                          <span>Estimated time remaining</span>
                          <span>
                            {`${Math.floor(backupRemainingSeconds / 60).toString().padStart(2, "0")}:${(backupRemainingSeconds % 60).toString().padStart(2, "0")}`}
                          </span>
                        </div>
                      )}
                      <div style={{ height: "10px", background: isDarkMode ? "#1e293b" : "#e2e8f0", borderRadius: "999px", overflow: "hidden" }}>
                        <div style={{ width: `${Math.max(backupProgress, 10)}%`, height: "100%", background: "linear-gradient(90deg, #22c55e, #2563eb)", transition: "width 0.2s ease" }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ padding: "12px 14px", borderRadius: "10px", border: "1px solid #cbd5e1", background: isDarkMode ? "#111827" : "#f8fafc" }}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: isDarkMode ? "#cbd5e1" : "#475569" }}>Last backup file</div>
                <div style={{ marginTop: "6px", fontSize: "0.92rem", color: isDarkMode ? "#f8fafc" : "#111827", wordBreak: "break-word" }}>{savedBackupLocation}</div>
              </div>

              {backupSummary && (
                <div style={{ padding: "18px", borderRadius: "12px", border: "1px solid #bbf7d0", background: isDarkMode ? "#072b1a" : "#f0fdf4", color: isDarkMode ? "#dcfce7" : "#166534" }}>
                  <h3 style={{ margin: "0 0 14px", textTransform: "uppercase" }}>Backup Completed</h3>
                  <div style={{ display: "grid", gap: "6px", fontSize: "0.95rem" }}>
                    <div><strong>Backup ID:</strong> {backupSummary.backupId}</div>
                    <div><strong>Type:</strong> {backupSummary.type || backupSummary.mode?.replace(/ Backup$/, "")}</div>
                    <div><strong>Source:</strong> {backupSummary.source || "N/A"}</div>
                    <div><strong>New Files:</strong> {backupSummary.newFiles ?? 0}</div>
                    <div><strong>Modified Files:</strong> {backupSummary.modifiedFiles ?? 0}</div>
                    <div><strong>New Assets:</strong> {backupSummary.newAssets ?? 0}</div>
                    <div><strong>Modified Assets:</strong> {backupSummary.modifiedAssets ?? 0}</div>
                    <div><strong>New Database Records:</strong> {backupSummary.newDatabaseRecords ?? 0}</div>
                    <div><strong>Updated Database Records:</strong> {backupSummary.updatedDatabaseRecords ?? 0}</div>
                    <div><strong>Package Size:</strong> {formatFileSize(backupSummary.packageSize || 0)}</div>
                    <div><strong>Created:</strong> {formatBackupCreatedAt(backupSummary.createdAt)}</div>
                    <div><strong>From:</strong> {backupSummary.from ? new Date(backupSummary.from).toLocaleDateString() : "N/A"}</div>
                    <div><strong>To:</strong> {backupSummary.to ? new Date(backupSummary.to).toLocaleDateString() : "N/A"}</div>
                  </div>
                  {backupSummary.downloadUrl && (
                    <button type="button" onClick={() => handleBackupDownload(backupSummary)} style={{ marginTop: "16px", background: "#166534", color: "#fff", border: "none", borderRadius: "8px", padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>
                      Download Backup
                    </button>
                  )}
                </div>
              )}

              {backupHistory.length > 0 && (
                <div style={{ display: "grid", gap: "10px", marginTop: "8px" }}>
                  <h3 style={{ margin: 0 }}>Backup History</h3>
                  <div style={{ display: "grid", gap: "8px" }}>
                    {backupHistory.slice(0, 3).map((entry) => {
                      const fileCount = entry.fileCount ?? ((entry.newFiles || 0) + (entry.modifiedFiles || 0));
                      const databaseRecordCount = entry.databaseRecordCount ?? ((entry.newDatabaseRecords || 0) + (entry.updatedDatabaseRecords || 0));
                      const type = (entry.type || entry.mode || "Backup").replace(/ Backup$/, "");
                      return (
                        <div key={`history-${entry.filePath || entry.fileName || entry.backupId}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 12px", border: `1px solid ${isDarkMode ? "#334155" : "#cbd5e1"}`, borderRadius: "8px", background: isDarkMode ? "#111827" : "#ffffff" }}>
                          <div style={{ display: "grid", gap: "3px", minWidth: 0 }}>
                            <strong>{formatBackupCreatedAt(entry.createdAt)}</strong>
                            <span style={{ fontSize: "0.9rem", color: isDarkMode ? "#cbd5e1" : "#475569" }}>{type}</span>
                            <span style={{ fontSize: "0.86rem", color: isDarkMode ? "#cbd5e1" : "#475569" }}>{fileCount} files | {databaseRecordCount} DB records</span>
                          </div>
                          <button type="button" onClick={() => handleBackupDownload(entry)} disabled={!entry.filePath} style={{ flexShrink: 0, background: entry.filePath ? "#2563eb" : "#94a3b8", color: "#fff", border: "none", borderRadius: "6px", padding: "7px 10px", fontWeight: 700, cursor: entry.filePath ? "pointer" : "not-allowed" }}>
                            Download
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {backupHistory.length > 0 && (() => {
                // Filter backups
                const filteredBackups = backupHistory.filter((entry) => {
                  const fileName = (entry.fileName || entry.backupId || "backup.gfxbackup").toLowerCase();
                  const mode = (entry.mode || "").toLowerCase();
                  const createdAt = entry.createdAt ? new Date(entry.createdAt).toLocaleString().toLowerCase() : "";
                  const size = typeof entry.size === "number" ? formatFileSize(entry.size).toLowerCase() : "unknown";
                  const dateRangeStr = entry.dateFrom && entry.dateTo 
                    ? `${new Date(entry.dateFrom).toLocaleString().toLowerCase()} - ${new Date(entry.dateTo).toLocaleString().toLowerCase()}`
                    : "";
                  
                  const filenameMatch = !backupFilterFilename || fileName.includes(backupFilterFilename.toLowerCase());
                  const modeFilterMatch = !backupFilterMode || mode.includes(backupFilterMode.toLowerCase());
                  const createdMatch = !backupFilterCreated || createdAt.includes(backupFilterCreated.toLowerCase());
                  const dateRangeMatch = !backupFilterDateRange || dateRangeStr.includes(backupFilterDateRange.toLowerCase());
                  const sizeMatch = !backupFilterSize || size.includes(backupFilterSize.toLowerCase());
                  const backupModeMatch = mode.includes(backupMode.toLowerCase());
                  
                  return filenameMatch && modeFilterMatch && createdMatch && dateRangeMatch && sizeMatch && backupModeMatch;
                });

                // Calculate pagination
                const totalPages = Math.ceil(filteredBackups.length / BACKUP_ITEMS_PER_PAGE);
                const validCurrentPage = Math.min(backupCurrentPage, Math.max(1, totalPages));
                const startIdx = (validCurrentPage - 1) * BACKUP_ITEMS_PER_PAGE;
                const endIdx = startIdx + BACKUP_ITEMS_PER_PAGE;
                const paginatedBackups = filteredBackups.slice(startIdx, endIdx);

                return (
                <div style={{ display: "grid", gap: "10px", marginTop: "8px" }}>
                  <h3 style={{ margin: 0 }}>Available backups ({filteredBackups.length} total)</h3>
                  <div style={{ overflowX: "auto", borderRadius: "10px", border: `1px solid ${isDarkMode ? "#334155" : "#cbd5e1"}` }}>
                    <table style={{ 
                      width: "100%", 
                      borderCollapse: "collapse",
                      fontSize: "0.95rem",
                      color: isDarkMode ? "#f1f5f9" : "#111827"
                    }}>
                      <thead>
                        <tr style={{ background: isDarkMode ? "#1e293b" : "#f8fafc", borderBottom: `2px solid ${isDarkMode ? "#334155" : "#cbd5e1"}` }}>
                          <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: isDarkMode ? "#cbd5e1" : "#475569" }}>Filename</th>
                          <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: isDarkMode ? "#cbd5e1" : "#475569" }}>Mode</th>
                          <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: isDarkMode ? "#cbd5e1" : "#475569" }}>Created</th>
                          <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: isDarkMode ? "#cbd5e1" : "#475569" }}>Date Range</th>
                          <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 700, color: isDarkMode ? "#cbd5e1" : "#475569" }}>Size</th>
                          <th style={{ padding: "12px 14px", textAlign: "center", fontWeight: 700, color: isDarkMode ? "#cbd5e1" : "#475569" }}>Actions</th>
                        </tr>
                        <tr style={{ background: isDarkMode ? "#0f172a" : "#ffffff", borderBottom: `1px solid ${isDarkMode ? "#334155" : "#e2e8f0"}` }}>
                          <th style={{ padding: "8px 14px" }}>
                            <input
                              type="text"
                              placeholder="Filter filename..."
                              value={backupFilterFilename}
                              onChange={(e) => setBackupFilterFilename(e.target.value)}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: "6px",
                                border: `1px solid ${isDarkMode ? "#475569" : "#cbd5e1"}`,
                                background: isDarkMode ? "#1e293b" : "#f8fafc",
                                color: isDarkMode ? "#f8fafc" : "#111827",
                                fontSize: "0.85rem"
                              }}
                            />
                          </th>
                          <th style={{ padding: "8px 14px" }}>
                            <input
                              type="text"
                              placeholder="Filter mode..."
                              value={backupFilterMode}
                              onChange={(e) => setBackupFilterMode(e.target.value)}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: "6px",
                                border: `1px solid ${isDarkMode ? "#475569" : "#cbd5e1"}`,
                                background: isDarkMode ? "#1e293b" : "#f8fafc",
                                color: isDarkMode ? "#f8fafc" : "#111827",
                                fontSize: "0.85rem"
                              }}
                            />
                          </th>
                          <th style={{ padding: "8px 14px" }}>
                            <input
                              type="text"
                              placeholder="Filter created..."
                              value={backupFilterCreated}
                              onChange={(e) => setBackupFilterCreated(e.target.value)}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: "6px",
                                border: `1px solid ${isDarkMode ? "#475569" : "#cbd5e1"}`,
                                background: isDarkMode ? "#1e293b" : "#f8fafc",
                                color: isDarkMode ? "#f8fafc" : "#111827",
                                fontSize: "0.85rem"
                              }}
                            />
                          </th>
                          <th style={{ padding: "8px 14px" }}>
                            <input
                              type="text"
                              placeholder="Filter date range..."
                              value={backupFilterDateRange}
                              onChange={(e) => setBackupFilterDateRange(e.target.value)}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: "6px",
                                border: `1px solid ${isDarkMode ? "#475569" : "#cbd5e1"}`,
                                background: isDarkMode ? "#1e293b" : "#f8fafc",
                                color: isDarkMode ? "#f8fafc" : "#111827",
                                fontSize: "0.85rem"
                              }}
                            />
                          </th>
                          <th style={{ padding: "8px 14px" }}>
                            <input
                              type="text"
                              placeholder="Filter size..."
                              value={backupFilterSize}
                              onChange={(e) => setBackupFilterSize(e.target.value)}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: "6px",
                                border: `1px solid ${isDarkMode ? "#475569" : "#cbd5e1"}`,
                                background: isDarkMode ? "#1e293b" : "#f8fafc",
                                color: isDarkMode ? "#f8fafc" : "#111827",
                                fontSize: "0.85rem"
                              }}
                            />
                          </th>
                          <th style={{ padding: "8px 14px" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedBackups.map((entry, idx) => {
                            const fileName = entry.fileName || entry.backupId || "backup.gfxbackup";
                            const createdAt = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "Unknown time";
                            const modeLabel = entry.mode ? entry.mode : "Backup package";
                            const dateRange = entry.dateFrom && entry.dateTo
                              ? `${new Date(entry.dateFrom).toLocaleString()} - ${new Date(entry.dateTo).toLocaleString()}`
                              : "Not available";
                            const fileSize = typeof entry.size === "number" ? formatFileSize(entry.size) : "Unknown";
                            const isEvenRow = idx % 2 === 0;
                            
                            return (
                              <tr 
                                key={`${fileName}-${entry.createdAt || entry.backupId}`}
                                style={{ 
                                  background: isEvenRow ? (isDarkMode ? "transparent" : "transparent") : (isDarkMode ? "rgba(15, 23, 42, 0.5)" : "rgba(248, 250, 252, 0.8)"),
                                  borderBottom: `1px solid ${isDarkMode ? "#334155" : "#e2e8f0"}`,
                                  transition: "background 0.2s ease",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = isDarkMode ? "rgba(71, 85, 105, 0.2)" : "rgba(203, 213, 225, 0.2)";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = isEvenRow ? (isDarkMode ? "transparent" : "transparent") : (isDarkMode ? "rgba(15, 23, 42, 0.5)" : "rgba(248, 250, 252, 0.8)");
                                }}
                              >
                                <td style={{ padding: "12px 14px", wordBreak: "break-word", maxWidth: "300px", fontWeight: 500 }}>{fileName}</td>
                                <td style={{ padding: "12px 14px", color: isDarkMode ? "#e2e8f0" : "#0f172a", fontWeight: 600 }}>{modeLabel}</td>
                                <td style={{ padding: "12px 14px", color: isDarkMode ? "#cbd5e1" : "#475569", fontSize: "0.9rem" }}>{createdAt}</td>
                                <td style={{ padding: "12px 14px", color: isDarkMode ? "#cbd5e1" : "#475569", fontSize: "0.85rem", maxWidth: "280px", wordBreak: "break-word" }}>{dateRange}</td>
                                <td style={{ padding: "12px 14px", color: isDarkMode ? "#cbd5e1" : "#475569", fontWeight: 500 }}>{fileSize}</td>
                                <td style={{ padding: "12px 14px", textAlign: "center" }}>
                                  <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                                    <button
                                      onClick={() => handleBackupDownload(entry)}
                                      title="Download backup"
                                      style={{
                                        background: "none",
                                        border: "none",
                                        cursor: "pointer",
                                        fontSize: "1.2rem",
                                        padding: "4px 8px",
                                        borderRadius: "6px",
                                        color: isDarkMode ? "#60a5fa" : "#2563eb",
                                        transition: "all 0.2s ease",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = isDarkMode ? "rgba(96, 165, 250, 0.15)" : "rgba(37, 99, 235, 0.1)";
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = "none";
                                      }}
                                    >
                                      ⬇️
                                    </button>
                                    <button
                                      onClick={() => handleBackupDelete(entry)}
                                      title="Delete backup"
                                      style={{
                                        background: "none",
                                        border: "none",
                                        cursor: "pointer",
                                        fontSize: "1.2rem",
                                        padding: "4px 8px",
                                        borderRadius: "6px",
                                        color: isDarkMode ? "#f87171" : "#dc2626",
                                        transition: "all 0.2s ease",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = isDarkMode ? "rgba(248, 113, 113, 0.15)" : "rgba(220, 38, 38, 0.1)";
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = "none";
                                      }}
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  
                  {/* Pagination Controls - Website Style */}
                  {totalPages > 1 && (
                    <div style={{
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      gap: "10px",
                      padding: "18px 20px",
                      borderRadius: "0 0 10px 10px",
                      background: isDarkMode ? "rgba(15, 23, 42, 0.82)" : "rgba(248, 250, 252, 0.9)",
                      border: `1px solid ${isDarkMode ? "rgba(148,163,184,0.2)" : "rgba(148,163,184,0.25)"}`,
                      borderTop: `1px solid ${isDarkMode ? "#334155" : "#cbd5e1"}`,
                      boxShadow: isDarkMode ? "0 16px 38px rgba(2, 6, 23, 0.32)" : "0 16px 38px rgba(15, 23, 42, 0.09)",
                      flexWrap: "wrap",
                    }}>
                      {/* First Button */}
                      <button
                        disabled={validCurrentPage === 1}
                        onClick={() => setBackupCurrentPage(1)}
                        style={{
                          minWidth: "42px",
                          height: "38px",
                          padding: "0 12px",
                          borderRadius: "999px",
                          border: isDarkMode ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,23,42,0.12)",
                          background: isDarkMode ? "rgba(25, 30, 38, 0.9)" : "rgba(255,255,255,0.8)",
                          color: isDarkMode ? "#f8fafc" : "#0f172a",
                          fontSize: "0.82rem",
                          fontWeight: 600,
                          letterSpacing: "0.01em",
                          cursor: validCurrentPage === 1 ? "not-allowed" : "pointer",
                          opacity: validCurrentPage === 1 ? 0.5 : 1,
                          transition: "all 0.2s ease",
                          boxShadow: isDarkMode ? "0 8px 18px rgba(0,0,0,0.28)" : "0 8px 18px rgba(15,23,42,0.08)",
                          backdropFilter: "blur(8px)",
                        }}
                      >
                        ⏮ First
                      </button>

                      {/* Prev Button */}
                      <button
                        disabled={validCurrentPage === 1}
                        onClick={() => setBackupCurrentPage(validCurrentPage - 1)}
                        style={{
                          minWidth: "42px",
                          height: "38px",
                          padding: "0 12px",
                          borderRadius: "999px",
                          border: isDarkMode ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,23,42,0.12)",
                          background: isDarkMode ? "rgba(25, 30, 38, 0.9)" : "rgba(255,255,255,0.8)",
                          color: isDarkMode ? "#f8fafc" : "#0f172a",
                          fontSize: "0.82rem",
                          fontWeight: 600,
                          letterSpacing: "0.01em",
                          cursor: validCurrentPage === 1 ? "not-allowed" : "pointer",
                          opacity: validCurrentPage === 1 ? 0.5 : 1,
                          transition: "all 0.2s ease",
                          boxShadow: isDarkMode ? "0 8px 18px rgba(0,0,0,0.28)" : "0 8px 18px rgba(15,23,42,0.08)",
                          backdropFilter: "blur(8px)",
                        }}
                      >
                        ◀ Prev
                      </button>

                      {/* Page Numbers */}
                      {[...Array(totalPages)].map((_, index) => {
                        const pageNum = index + 1;
                        const isCurrent = validCurrentPage === pageNum;

                        return (
                          <button
                            key={pageNum}
                            onClick={() => setBackupCurrentPage(pageNum)}
                            style={{
                              minWidth: "40px",
                              height: "38px",
                              padding: "0 12px",
                              borderRadius: "999px",
                              border: isCurrent ? "transparent" : (isDarkMode ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,23,42,0.12)"),
                              background: isCurrent 
                                ? "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)"
                                : (isDarkMode ? "rgba(25, 30, 38, 0.9)" : "rgba(255,255,255,0.8)"),
                              color: isCurrent ? "#fff" : (isDarkMode ? "#f8fafc" : "#0f172a"),
                              fontSize: "0.82rem",
                              fontWeight: 600,
                              letterSpacing: "0.01em",
                              cursor: "pointer",
                              opacity: isCurrent ? 1 : 0.9,
                              transition: "all 0.2s ease",
                              boxShadow: isCurrent 
                                ? "0 10px 20px rgba(37, 99, 235, 0.35)"
                                : (isDarkMode ? "0 8px 18px rgba(0,0,0,0.28)" : "0 8px 18px rgba(15,23,42,0.08)"),
                              backdropFilter: "blur(8px)",
                            }}
                          >
                            {pageNum}
                          </button>
                        );
                      })}

                      {/* Next Button */}
                      <button
                        disabled={validCurrentPage === totalPages}
                        onClick={() => setBackupCurrentPage(validCurrentPage + 1)}
                        style={{
                          minWidth: "42px",
                          height: "38px",
                          padding: "0 12px",
                          borderRadius: "999px",
                          border: isDarkMode ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,23,42,0.12)",
                          background: isDarkMode ? "rgba(25, 30, 38, 0.9)" : "rgba(255,255,255,0.8)",
                          color: isDarkMode ? "#f8fafc" : "#0f172a",
                          fontSize: "0.82rem",
                          fontWeight: 600,
                          letterSpacing: "0.01em",
                          cursor: validCurrentPage === totalPages ? "not-allowed" : "pointer",
                          opacity: validCurrentPage === totalPages ? 0.5 : 1,
                          transition: "all 0.2s ease",
                          boxShadow: isDarkMode ? "0 8px 18px rgba(0,0,0,0.28)" : "0 8px 18px rgba(15,23,42,0.08)",
                          backdropFilter: "blur(8px)",
                        }}
                      >
                        Next ▶
                      </button>

                      {/* Last Button */}
                      <button
                        disabled={validCurrentPage === totalPages}
                        onClick={() => setBackupCurrentPage(totalPages)}
                        style={{
                          minWidth: "42px",
                          height: "38px",
                          padding: "0 12px",
                          borderRadius: "999px",
                          border: isDarkMode ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,23,42,0.12)",
                          background: isDarkMode ? "rgba(25, 30, 38, 0.9)" : "rgba(255,255,255,0.8)",
                          color: isDarkMode ? "#f8fafc" : "#0f172a",
                          fontSize: "0.82rem",
                          fontWeight: 600,
                          letterSpacing: "0.01em",
                          cursor: validCurrentPage === totalPages ? "not-allowed" : "pointer",
                          opacity: validCurrentPage === totalPages ? 0.5 : 1,
                          transition: "all 0.2s ease",
                          boxShadow: isDarkMode ? "0 8px 18px rgba(0,0,0,0.28)" : "0 8px 18px rgba(15,23,42,0.08)",
                          backdropFilter: "blur(8px)",
                        }}
                      >
                        Last ⏭
                      </button>

                      {/* Info Text */}
                      <p style={{
                        marginTop: "12px",
                        marginBottom: "0",
                        textAlign: "center",
                        fontWeight: "700",
                        width: "100%",
                        letterSpacing: "0.04em",
                        color: isDarkMode ? "#f8fafc" : "#0f172a",
                        fontSize: "0.82rem",
                        textTransform: "uppercase",
                      }}>
                        Page {validCurrentPage} of {Math.max(1, totalPages)} • Showing {filteredBackups.length > 0 ? startIdx + 1 : 0}-{Math.min(endIdx, filteredBackups.length)} of {filteredBackups.length}
                      </p>
                    </div>
                  )}

                  {filteredBackups.length === 0 && (backupFilterFilename || backupFilterMode || backupFilterCreated || backupFilterDateRange || backupFilterSize) && (
                    <div style={{ padding: "12px 14px", textAlign: "center", color: isDarkMode ? "#cbd5e1" : "#475569", fontSize: "0.9rem" }}>
                      No backups match your filters
                    </div>
                  )}
                </div>
                );
              })()} 
            </div>
          </div>
        </div>
      ) : tabParam === "myaccount" ? (
        <div style={{ display: "grid", gap: "20px" }}>
          <div
            style={{
              padding: "20px",
              borderRadius: "12px",
              border: isDarkMode ? "1px solid rgba(148, 163, 184, 0.25)" : "1px solid #ddd",
              background: isDarkMode ? "#0f172a" : "#fafafa",
              color: isDarkMode ? "#f5f5f5" : "#111827",
              boxShadow: isDarkMode ? "0 18px 40px rgba(2, 6, 23, 0.42)" : "none",
              maxWidth: 720
            }}
          >
            <h3 style={{ color: isDarkMode ? "#f5f5f5" : undefined }}>My Account</h3>
            <p style={{ color: isDarkMode ? "#cbd5e1" : "#555", marginTop: "-4px" }}>Manage your admin account settings and profile.</p>

            <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.95rem", color: isDarkMode ? "#e2e8f0" : "#333", fontWeight: 600 }}>Full name</span>
                <input type="text" value={accountForm.full_name} onChange={(e) => handleAccountField('full_name', e.target.value)} style={{ padding: "10px", borderRadius: "8px", border: isDarkMode ? "1px solid rgba(148,163,184,0.35)" : "1px solid #ccc", background: isDarkMode ? "#111827" : "white", color: isDarkMode ? "#f8fafc" : "#111827" }} />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.95rem", color: isDarkMode ? "#e2e8f0" : "#333", fontWeight: 600 }}>Email</span>
                <input type="email" value={accountForm.email} onChange={(e) => handleAccountField('email', e.target.value)} style={{ padding: "10px", borderRadius: "8px", border: isDarkMode ? "1px solid rgba(148,163,184,0.35)" : "1px solid #ccc", background: isDarkMode ? "#111827" : "white", color: isDarkMode ? "#f8fafc" : "#111827" }} />
              </label>

              <div style={{ borderTop: isDarkMode ? "1px solid rgba(148,163,184,0.18)" : "1px solid #eee", paddingTop: 10 }}>
                <div style={{ fontSize: "0.9rem", color: isDarkMode ? "#e2e8f0" : "#333", marginBottom: 8 }}>Change password</div>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <input type="password" placeholder="Current password" value={accountForm.currentPassword} onChange={(e) => handleAccountField('currentPassword', e.target.value)} style={{ padding: "10px", borderRadius: "8px", border: isDarkMode ? "1px solid rgba(148,163,184,0.35)" : "1px solid #ccc", background: isDarkMode ? "#111827" : "white", color: isDarkMode ? "#f8fafc" : "#111827" }} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: 6 }}>
                  <input type="password" placeholder="New password" value={accountForm.newPassword} onChange={(e) => handleAccountField('newPassword', e.target.value)} style={{ padding: "10px", borderRadius: "8px", border: isDarkMode ? "1px solid rgba(148,163,184,0.35)" : "1px solid #ccc", background: isDarkMode ? "#111827" : "white", color: isDarkMode ? "#f8fafc" : "#111827" }} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: 6 }}>
                  <input type="password" placeholder="Confirm new password" value={accountForm.confirmPassword} onChange={(e) => handleAccountField('confirmPassword', e.target.value)} style={{ padding: "10px", borderRadius: "8px", border: isDarkMode ? "1px solid rgba(148,163,184,0.35)" : "1px solid #ccc", background: isDarkMode ? "#111827" : "white", color: isDarkMode ? "#f8fafc" : "#111827" }} />
                </label>
              </div>

              {accountMessage && <div style={{ color: accountMessage.includes('success') ? '#2e7d32' : '#d32f2f' }}>{accountMessage}</div>}

              <div style={{ display: "flex", gap: "10px", marginTop: 6 }}>
                <button type="button" onClick={handleAccountSubmit} disabled={accountLoading} style={{ background: "#43a047", color: "white", border: "none", padding: "10px 14px", borderRadius: "8px", cursor: "pointer" }}>{accountLoading ? 'Saving...' : 'Save changes'}</button>
                <button type="button" onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('userRole'); window.location.reload(); }} style={{ background: "#f44336", color: "white", border: "none", padding: "10px 14px", borderRadius: "8px", cursor: "pointer" }}>Logout</button>
              </div>
            </div>
          </div>
        </div>
      ) : isPromotionsTab ? (
        <AdminPromotionsPanel />
      ) : isUsersTab ? (
        <div style={{ display: "grid", gap: "20px" }}>
          <div
            data-testid="admin-users-panel"
            style={{
              padding: "20px",
              borderRadius: "12px",
              border: isDarkMode ? "1px solid rgba(148, 163, 184, 0.25)" : "1px solid #ddd",
              background: isDarkMode ? "#0f172a" : "#fafafa",
              color: isDarkMode ? "#f5f5f5" : "#111827",
              boxShadow: isDarkMode ? "0 18px 40px rgba(2,6,23,0.48)" : "none"
            }}
          >
            <h3 style={{ color: isDarkMode ? "#f5f5f5" : undefined }}>User Management</h3>
            <p style={{ color: isDarkMode ? "#cbd5e1" : "#555", marginTop: "-4px" }}>Manage contributor and other admin users.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "16px", alignItems: "center" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                {[
                  { key: "all", label: "All" },
                  { key: "admin", label: "Admin" },
                  { key: "active", label: "Active" },
                  { key: "pending", label: "Pending" },
                  { key: "blocked", label: "Blocked" }
                ].map((button) => (
                  <button
                    key={button.key}
                    type="button"
                    onClick={() => setUserFilter(button.key)}
                    style={{
                      background: userFilter === button.key ? (isDarkMode ? "#2563eb" : "#1565c0") : isDarkMode ? "#1e293b" : "#e0e0e0",
                      color: userFilter === button.key ? "white" : isDarkMode ? "#e2e8f0" : "#333",
                      border: userFilter === button.key ? (isDarkMode ? "2px solid #60a5fa" : "2px solid #0d47a1") : isDarkMode ? "1px solid rgba(148, 163, 184, 0.2)" : "1px solid transparent",
                      boxShadow: userFilter === button.key ? "0 2px 10px rgba(21, 101, 192, 0.2)" : "none",
                      padding: "8px 14px",
                      borderRadius: "8px",
                      cursor: "pointer"
                    }}
                  >
                    {button.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: "10px", marginLeft: "auto", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={exportUsersCsv}
                  disabled={filteredUsers.length === 0}
                  style={{
                    background: filteredUsers.length === 0 ? "#b0bec5" : "#1976d2",
                    color: "white",
                    border: "none",
                    padding: "8px 14px",
                    borderRadius: "8px",
                    cursor: filteredUsers.length === 0 ? "not-allowed" : "pointer"
                  }}
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => startEditingUser({
                    id: null,
                    full_name: "",
                    username: "",
                    email: "",
                    role: "",
                    identity_number: "",
                    credits: 0,
                    status: "active"
                  })}
                  style={{
                    background: "#43a047",
                    color: "white",
                    border: "none",
                    padding: "8px 14px",
                    borderRadius: "8px",
                    cursor: "pointer"
                  }}
                >
                  Add New
                </button>
              </div>
            </div>
            {userExportStatus && (
              <div style={{ marginTop: "12px", color: isDarkMode ? "#cbd5e1" : "#555", fontSize: "0.9rem" }}>{userExportStatus}</div>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: "14px",
                marginTop: "16px"
              }}
            >
              {filteredUsers.length === 0 ? (
                <p>No users found.</p>
              ) : (
                filteredUsers.map((user) => {
                  const normalizedStatus = String(user.status || "").trim().toLowerCase();
                  const displayStatus = normalizedStatus || "unknown";

                  return (
                    <div
                      key={user.id}
                      style={{
                        padding: "14px",
                        borderRadius: "10px",
                        border: isDarkMode ? "1px solid rgba(148, 163, 184, 0.25)" : "1px solid #ddd",
                        background: isDarkMode ? "#111827" : "white",
                        color: isDarkMode ? "#f5f5f5" : "#111827",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        boxShadow: isDarkMode ? "inset 0 1px 0 rgba(148,163,184,0.08)" : "none"
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{user.full_name || user.username || "Unnamed user"}</div>
                      <div style={{ color: isDarkMode ? "#cbd5e1" : "#555" }}>Username: {user.username || "-"}</div>
                      <div style={{ color: isDarkMode ? "#cbd5e1" : "#555" }}>Email: {user.email || "-"}</div>
                      <div style={{ color: isDarkMode ? "#cbd5e1" : "#555" }}>Role: {user.role || "-"}</div>
                      <div style={{ color: isDarkMode ? "#cbd5e1" : "#555" }}>Status: {displayStatus}</div>
                      {String(user.role || "").toLowerCase() === "contributor" && user.contributor_cooling_until && normalizedStatus !== "active" && (
                        <div style={{ color: "#b45309" }}>
                          Cooling period: {formatCoolingRemaining(user.contributor_cooling_until, currentTime)}
                        </div>
                      )}
                      {user.deletion_requested_at && (
                        <div style={{ color: "#b91c1c" }}>
                          Deletion cooling period: {formatCoolingRemaining(user.deletion_requested_at, currentTime)}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                        <button
                          type="button"
                          onClick={() => activateUser(user.id)}
                          style={{
                            background: "#43a047",
                            color: "white",
                            border: "none",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            cursor: "pointer"
                          }}
                        >
                          Activate
                        </button>
                        <button
                          type="button"
                          onClick={() => blockUser(user.id)}
                          style={{
                            background: "#f57c00",
                            color: "white",
                            border: "none",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            cursor: "pointer"
                          }}
                        >
                          Block
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditingUser(user)}
                          style={{
                            background: "#1976d2",
                            color: "white",
                            border: "none",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            cursor: "pointer"
                          }}
                        >
                          Modify
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteConfirmation(user)}
                          style={{
                            background: "#e53935",
                            color: "white",
                            border: "none",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            cursor: "pointer"
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {deleteConfirmationUser && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.55)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "24px",
                  zIndex: 1150
                }}
              >
                <div
                  style={{
                    width: "100%",
                    maxWidth: "420px",
                    background: isDarkMode ? "#111827" : "white",
                    color: isDarkMode ? "#f5f5f5" : "#111827",
                    borderRadius: "14px",
                    boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
                    overflow: "hidden",
                    border: isDarkMode ? "1px solid rgba(148, 163, 184, 0.25)" : "none"
                  }}
                >
                  <div style={{ padding: "18px 20px", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.18)" : "1px solid #eee" }}>
                    <h3 style={{ margin: 0, color: isDarkMode ? "#f5f5f5" : undefined }}>Confirm delete</h3>
                  </div>
                  <div style={{ padding: "20px", display: "grid", gap: "14px" }}>
                    <p style={{ margin: 0, color: isDarkMode ? "#cbd5e1" : undefined }}>
                      {deleteConfirmationUser.deletion_requested_at
                        ? <>Deletion has already been requested for <strong>{deleteConfirmationUser.full_name || deleteConfirmationUser.username || "this user"}</strong>. It will be permanently deleted after the 60-minute cooling period.</>
                        : <>Delete <strong>{deleteConfirmationUser.full_name || deleteConfirmationUser.username || "this user"}</strong>? The account will be permanently deleted after a 60-minute cooling period.</>}
                    </p>
                    <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={closeDeleteConfirmation}
                        style={{
                          background: "#757575",
                          color: "white",
                          border: "none",
                          padding: "10px 14px",
                          borderRadius: "8px",
                          cursor: "pointer"
                        }}
                      >
                        Cancel
                      </button>
                      {deleteConfirmationUser.deletion_requested_at ? (
                        <>
                          <button
                            type="button"
                            onClick={() => cancelUserDeletion(deleteConfirmationUser.id)}
                            style={{
                              background: "#f59e0b",
                              color: "white",
                              border: "none",
                              padding: "10px 14px",
                              borderRadius: "8px",
                              cursor: "pointer"
                            }}
                          >
                            Cancel deletion process
                          </button>
                          <button
                            type="button"
                            onClick={() => forceDeleteUser(deleteConfirmationUser.id)}
                            style={{
                              background: "#b91c1c",
                              color: "white",
                              border: "none",
                              padding: "10px 14px",
                              borderRadius: "8px",
                              cursor: "pointer"
                            }}
                          >
                            Delete now
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => deleteUser(deleteConfirmationUser.id)}
                            style={{
                              background: "#e53935",
                              color: "white",
                              border: "none",
                              padding: "10px 14px",
                              borderRadius: "8px",
                              cursor: "pointer"
                            }}
                          >
                            Start deletion period
                          </button>
                          <button
                            type="button"
                            onClick={() => forceDeleteUser(deleteConfirmationUser.id)}
                            style={{
                              background: "#b91c1c",
                              color: "white",
                              border: "none",
                              padding: "10px 14px",
                              borderRadius: "8px",
                              cursor: "pointer"
                            }}
                          >
                            Delete now
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isUserModalOpen && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.55)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "24px",
                  zIndex: 1100
                }}
              >
                <div
                  style={{
                    width: "100%",
                    maxWidth: "620px",
                    background: isDarkMode ? "#111827" : "white",
                    color: isDarkMode ? "#f5f5f5" : "#111827",
                    borderRadius: "14px",
                    boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
                    overflow: "hidden",
                    border: isDarkMode ? "1px solid rgba(148, 163, 184, 0.25)" : "none"
                  }}
                >
                  <div style={{ padding: "20px 24px", borderBottom: isDarkMode ? "1px solid rgba(148,163,184,0.18)" : "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <h3 style={{ margin: 0, color: isDarkMode ? "#f5f5f5" : undefined }}>Edit User</h3>
                      <p style={{ margin: "8px 0 0", color: isDarkMode ? "#cbd5e1" : "#666" }}>Update user details and save changes.</p>
                    </div>
                    <button
                      type="button"
                      onClick={cancelEditingUser}
                      style={{
                        background: "transparent",
                        color: isDarkMode ? "#f5f5f5" : "#333",
                        border: "none",
                        fontSize: "18px",
                        cursor: "pointer"
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <div style={{ padding: "16px", display: "grid", gap: "10px", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "0.85rem", color: isDarkMode ? "#e2e8f0" : "#333" }}>Full name</span>
                      <input
                        type="text"
                        value={userEditForm.full_name}
                        onChange={(e) => updateUserFormField("full_name", e.target.value)}
                        placeholder="Full name"
                        style={{ padding: "8px", borderRadius: "8px", border: "1px solid #ccc" }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "0.85rem", color: isDarkMode ? "#e2e8f0" : "#333" }}>Username</span>
                      <input
                        type="text"
                        value={userEditForm.username}
                        onChange={(e) => updateUserFormField("username", e.target.value)}
                        placeholder="Username"
                        style={{ padding: "8px", borderRadius: "8px", border: "1px solid #ccc" }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "0.85rem", color: isDarkMode ? "#e2e8f0" : "#333" }}>Email</span>
                      <input
                        type="email"
                        value={userEditForm.email}
                        onChange={(e) => updateUserFormField("email", e.target.value)}
                        placeholder="Email"
                        style={{ padding: "8px", borderRadius: "8px", border: "1px solid #ccc" }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "0.85rem", color: isDarkMode ? "#e2e8f0" : "#333" }}>Role</span>
                      <select
                        value={userEditForm.role}
                        onChange={(e) => updateUserFormField("role", e.target.value)}
                        style={{ padding: "8px", borderRadius: "8px", border: "1px solid #ccc", background: "white" }}
                      >
                        <option value="">Role</option>
                        <option value="admin">Admin</option>
                        <option value="customer">Customer</option>
                        <option value="contributor">Contributor</option>
                        <option value="user">User</option>
                      </select>
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "0.85rem", color: isDarkMode ? "#e2e8f0" : "#333" }}>ID #</span>
                      <input
                        type="text"
                        value={userEditForm.identity_number}
                        onChange={(e) => updateUserFormField("identity_number", e.target.value)}
                        placeholder="ID #"
                        style={{ padding: "8px", borderRadius: "8px", border: "1px solid #ccc" }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "0.85rem", color: isDarkMode ? "#e2e8f0" : "#333" }}>Credits</span>
                      <input
                        type="number"
                        value={userEditForm.credits}
                        onChange={(e) => updateUserFormField("credits", e.target.value)}
                        placeholder="Credits"
                        style={{ padding: "8px", borderRadius: "8px", border: "1px solid #ccc" }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontSize: "0.85rem", color: isDarkMode ? "#e2e8f0" : "#333" }}>Status</span>
                      <select
                        value={userEditForm.status}
                        onChange={(e) => updateUserFormField("status", e.target.value)}
                        style={{ padding: "8px", borderRadius: "8px", border: "1px solid #ccc", background: "white" }}
                      >
                        <option value="">Status</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="pending">Pending</option>
                        <option value="blocked">Blocked</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "4px", gridColumn: "1 / -1" }}>
                      <span style={{ fontSize: "0.85rem", color: isDarkMode ? "#e2e8f0" : "#333" }}>Password</span>
                      <input
                        type="password"
                        value={userEditForm.password}
                        onChange={(e) => updateUserFormField("password", e.target.value)}
                        placeholder="Password"
                        style={{ padding: "8px", borderRadius: "8px", border: "1px solid #ccc" }}
                      />
                    </label>
                    {userEditForm.role === "contributor" && (
                      <div style={{ display: "grid", gap: "10px", gridColumn: "1 / -1", marginTop: "4px" }}>
                        <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <span style={{ fontSize: "0.85rem", color: isDarkMode ? "#e2e8f0" : "#333" }}>Upload limit</span>
                          <div style={{ fontSize: "0.75rem", color: isDarkMode ? "#cbd5e1" : "#666", marginTop: "2px" }}>
                            Default: {getUploadLimitDisplay({ upload_limit_value: 20, upload_limit_unit: "MB" })}
                          </div>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <select
                              value={Number(userEditForm.custom_permissions?.upload_limit_value ?? 20)}
                              onChange={(e) => updateUserFormField("custom_permissions", {
                                ...(userEditForm.custom_permissions || {}),
                                upload_limit_value: Number(e.target.value),
                                upload_limit_unit: userEditForm.custom_permissions?.upload_limit_unit || "MB"
                              })}
                              style={{ flex: 1, padding: "8px", borderRadius: "8px", border: "1px solid #ccc", background: "white" }}
                            >
                              {[1, 5, 10, 20, 100].map((size) => (
                                <option key={size} value={size}>{size}</option>
                              ))}
                            </select>
                            <select
                              value={String(userEditForm.custom_permissions?.upload_limit_unit || "MB").toUpperCase()}
                              onChange={(e) => updateUserFormField("custom_permissions", {
                                ...(userEditForm.custom_permissions || {}),
                                upload_limit_value: Number(userEditForm.custom_permissions?.upload_limit_value ?? 20),
                                upload_limit_unit: e.target.value
                              })}
                              style={{ width: "90px", padding: "8px", borderRadius: "8px", border: "1px solid #ccc", background: "white" }}
                            >
                              <option value="MB">MB</option>
                              <option value="GB">GB</option>
                            </select>
                          </div>
                        </label>
                      </div>
                    )}
                    <label style={{ display: "flex", alignItems: "center", gap: "10px", gridColumn: "1 / -1", marginTop: "4px" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(userEditForm.custom_permissions?.bulk_upload)}
                        onChange={(e) => updateUserFormField("custom_permissions", {
                          ...(userEditForm.custom_permissions || {}),
                          bulk_upload: e.target.checked
                        })}
                        style={{ width: "18px", height: "18px" }}
                      />
                      <span style={{ fontSize: "0.95rem", color: isDarkMode ? "#e2e8f0" : "#333" }}>Bulk Upload permission</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "10px", gridColumn: "1 / -1", marginTop: "4px" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(userEditForm.otp_enabled)}
                        onChange={(e) => updateUserFormField("otp_enabled", e.target.checked)}
                        style={{ width: "18px", height: "18px" }}
                      />
                      <span style={{ fontSize: "0.95rem", color: isDarkMode ? "#e2e8f0" : "#333" }}>Enable OTP login/password</span>
                    </label>
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", gridColumn: "1 / -1", marginTop: "4px" }}>
                      <button
                        type="button"
                        onClick={() => saveUserDetails(editingUserId)}
                        disabled={isUserSaving}
                        style={{
                          background: "#43a047",
                          color: "white",
                          border: "none",
                          padding: "10px 14px",
                          borderRadius: "8px",
                          cursor: isUserSaving ? "not-allowed" : "pointer",
                          opacity: isUserSaving ? 0.7 : 1
                        }}
                      >
                        {isUserSaving ? "⏳ Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditingUser}
                        style={{
                          background: "#757575",
                          color: "white",
                          border: "none",
                          padding: "10px 14px",
                          borderRadius: "8px",
                          cursor: "pointer"
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : isEmptyAdminBodyTab ? (
        <RestorePage />
      ) : isControlsTab ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", marginBottom: "20px" }}>
            <div>
              <h2 style={{ margin: 0 }}>{adminPageHeading}</h2>
              {isLayoutEditMode && <p style={{ color: "#666", marginTop: "4px", fontSize: "0.9rem" }}>Use the left/right arrows to reorder cards</p>}
            </div>
            <button
              type="button"
              onClick={() => {
                if (isLayoutEditMode) {
                  saveCardOrder(cardOrder);
                } else {
                  setIsLayoutEditMode(true);
                }
              }}
              disabled={layoutSaving}
              style={{
                background: isLayoutEditMode ? "#43a047" : "#1976d2",
                color: "white",
                border: "none",
                padding: "10px 20px",
                borderRadius: "8px",
                cursor: layoutSaving ? "not-allowed" : "pointer",
                fontWeight: 600,
                whiteSpace: "nowrap"
              }}
            >
              {layoutSaving ? "Saving..." : isLayoutEditMode ? "Save Layout" : "Edit Layout"}
            </button>
          </div>
          <div className="admin-panel-controls-grid" style={{ display: "flex", flexWrap: "wrap", gap: "20px", justifyContent: "flex-start" }}>
          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="manage-categories">
            <h3>Manage Categories</h3>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
              <span style={{ fontSize: "0.95rem", color: "#333", fontWeight: 600 }}>Add new Category</span>
              <input
                type="text"
                placeholder="New category name"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                style={{ padding: "10px", borderRadius: "8px", border: "1px solid #ccc" }}
              />
            </label>
            <button
              type="button"
              onClick={addCategory}
              style={{
                background: "#2196f3",
                color: "white",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                cursor: "pointer",
                width: "100%",
                marginBottom: "12px"
              }}
            >
              Add Category
            </button>
            {newCategoryError && <p style={{ color: "#d32f2f", marginTop: "-4px", marginBottom: "10px" }}>{newCategoryError}</p>}
            <button
              type="button"
              onClick={() => setShowCategoryGrid(true)}
              style={{
                background: "#1976d2",
                color: "white",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                cursor: "pointer",
                width: "100%"
              }}
            >
              View Categories
            </button>
            <div style={{ marginTop: "12px", display: "grid", gap: "8px" }}>
              {visibleCategories.slice(0, 1).map((categoryItem) => (
                <div key={categoryItem.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "8px 10px", borderRadius: "8px", background: isDarkMode ? "#111827" : "transparent", border: isDarkMode ? "1px solid rgba(148,163,184,0.2)" : "none" }}>
                  <span style={{ fontSize: "0.9rem", color: isDarkMode ? "#e2e8f0" : "#444" }}>{categoryItem.name || "Unnamed category"}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const targetCategory = visibleCategories[0] || null;
                      if (targetCategory) {
                        startEditingCategory(targetCategory);
                      } else {
                        setEditingCategoryInModal("__pending__");
                        setEditingCategoryNameInModal("");
                      }
                    }}
                    style={{
                      background: "#1976d2",
                      color: "white",
                      border: "none",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      cursor: "pointer"
                    }}
                  >
                    Modify
                  </button>
                </div>
              ))}
            </div>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="website-branding">
            <h3 style={{ margin: 0 }}>Website Branding</h3>
            <form onSubmit={uploadBranding} style={{ display: "grid", gap: "12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.95rem", color: "#333", fontWeight: 600 }}>Add new Logo</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setBrandingLogoFile(e.target.files?.[0] || null)}
                  style={{ padding: "10px", background: "white", borderRadius: "8px", border: "1px solid #ccc" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.95rem", color: "#333", fontWeight: 600 }}>Add new Favicon</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setBrandingFaviconFile(e.target.files?.[0] || null)}
                  style={{ padding: "10px", background: "white", borderRadius: "8px", border: "1px solid #ccc" }}
                />
              </label>
              <button
                type="submit"
                style={{
                  background: "#2196f3",
                  color: "white",
                  border: "none",
                  padding: "10px 18px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  width: "100%"
                }}
                disabled={brandingUploading}
              >
                {brandingUploading ? "Saving..." : "Save Branding"}
              </button>
            </form>
            {brandingConfig?.logo || brandingConfig?.favicon ? (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", paddingTop: "4px" }}>
                {brandingConfig.logo && (
                  <img
                    src={`${API_BASE_URL}${brandingConfig.logo}`}
                    alt="Current logo"
                    style={{ height: "36px", width: "auto", objectFit: "contain" }}
                  />
                )}
                {brandingConfig.favicon && (
                  <img
                    src={`${API_BASE_URL}${brandingConfig.favicon}`}
                    alt="Current favicon"
                    style={{ height: "24px", width: "24px", objectFit: "contain" }}
                  />
                )}
              </div>
            ) : null}
            {brandingMessage ? <p style={{ margin: 0, color: brandingMessage.includes("Failed") ? "#d32f2f" : "#2e7d32" }}>{brandingMessage}</p> : null}
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="profile-icons">
            <h3 style={{ margin: 0 }}>Profile Icons</h3>
            <p style={{ margin: 0, color: "#555", fontSize: "0.9rem" }}>
              Upload PNG replacements for the customer crown, contributor ribbon, and admin tick. Each image is displayed automatically at the current icon size.
            </p>
            <form onSubmit={uploadProfileIcons} style={{ display: "grid", gap: "12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.95rem", color: "#333", fontWeight: 600 }}>Customer icon (29 x 17 px)</span>
                <input type="file" accept="image/png" onChange={(e) => setProfileIconCustomerFile(e.target.files?.[0] || null)} style={{ padding: "10px", background: "white", borderRadius: "8px", border: "1px solid #ccc" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.95rem", color: "#333", fontWeight: 600 }}>Contributor icon (30 x 27 px)</span>
                <input type="file" accept="image/png" onChange={(e) => setProfileIconContributorFile(e.target.files?.[0] || null)} style={{ padding: "10px", background: "white", borderRadius: "8px", border: "1px solid #ccc" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.95rem", color: "#333", fontWeight: 600 }}>Admin icon (23 x 23 px)</span>
                <input type="file" accept="image/png" onChange={(e) => setProfileIconAdminFile(e.target.files?.[0] || null)} style={{ padding: "10px", background: "white", borderRadius: "8px", border: "1px solid #ccc" }} />
              </label>
              <button type="submit" disabled={brandingUploading} style={{ background: "#2196f3", color: "white", border: "none", padding: "10px 18px", borderRadius: "8px", cursor: brandingUploading ? "not-allowed" : "pointer", width: "100%" }}>
                {brandingUploading ? "Saving..." : "Save Profile Icons"}
              </button>
              <button type="button" onClick={restoreDefaultProfileIcons} disabled={brandingUploading} style={{ background: "#64748b", color: "white", border: "none", padding: "10px 18px", borderRadius: "8px", cursor: brandingUploading ? "not-allowed" : "pointer", width: "100%" }}>
                Restore Default Icons
              </button>
            </form>
            <div className="profile-icons-active-preview">
              <div className="profile-icon-active-item">
                <span>Customer</span>
                {brandingConfig.profileIconCustomer ? (
                  <img src={`${API_BASE_URL}${brandingConfig.profileIconCustomer}?v=${brandingConfig.profileIconsVersion || "default"}`} alt="Current customer profile icon" style={{ width: "29px", height: "17px", objectFit: "contain" }} />
                ) : <span className="profile-icon-default-preview profile-icon-default-customer" aria-label="Default customer crown" />}
              </div>
              <div className="profile-icon-active-item">
                <span>Contributor</span>
                {brandingConfig.profileIconContributor ? (
                  <img src={`${API_BASE_URL}${brandingConfig.profileIconContributor}?v=${brandingConfig.profileIconsVersion || "default"}`} alt="Current contributor profile icon" style={{ width: "30px", height: "27px", objectFit: "contain" }} />
                ) : <span className="profile-icon-default-preview profile-icon-default-contributor" aria-label="Default contributor ribbon" />}
              </div>
              <div className="profile-icon-active-item">
                <span>Admin</span>
                {brandingConfig.profileIconAdmin ? (
                  <img src={`${API_BASE_URL}${brandingConfig.profileIconAdmin}?v=${brandingConfig.profileIconsVersion || "default"}`} alt="Current admin profile icon" style={{ width: "23px", height: "23px", objectFit: "contain" }} />
                ) : <span className="profile-icon-default-preview profile-icon-default-admin" aria-label="Default admin tick">✓</span>}
              </div>
            </div>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="backup-restore">
            <h3 style={{ margin: 0 }}>Backup/Restore</h3>
            <div style={{ display: "grid", gap: "12px", marginTop: "6px" }}>
              <button
                type="button"
                onClick={() => {
                  const adminBasePath = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
                  window.location.href = `${window.location.origin}${adminBasePath}?tab=backup`;
                }}
                style={{
                  background: "#16a34a",
                  color: "white",
                  border: "none",
                  padding: "10px 18px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  width: "100%"
                }}
              >
                Backup
              </button>
              <button
                type="button"
                onClick={() => {
                  const adminBasePath = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
                  window.location.href = `${window.location.origin}${adminBasePath}?tab=restore`;
                }}
                style={{
                  background: "#f59e0b",
                  color: "white",
                  border: "none",
                  padding: "10px 18px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  width: "100%"
                }}
              >
                Restore
              </button>
            </div>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="active-collections">
            <h3>Active Collections</h3>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
              <span style={{ fontSize: "0.95rem", color: "#333", fontWeight: 600 }}>Add new Collection</span>
              <input
                type="text"
                placeholder="New collection name"
                value={newCollection}
                onChange={(e) => setNewCollection(e.target.value)}
                style={{ padding: "10px", borderRadius: "8px", border: "1px solid #ccc" }}
              />
            </label>
            <button
              type="button"
              onClick={addCollection}
              style={{
                background: "#2196f3",
                color: "white",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                cursor: "pointer",
                width: "100%",
                marginBottom: "12px"
              }}
            >
              Add Collection
            </button>

            <button
              type="button"
              onClick={() => setShowCollectionGrid(true)}
              style={{
                background: "#1976d2",
                color: "white",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                cursor: "pointer",
                width: "100%"
              }}
            >
              View Collections
            </button>
            <div style={{ marginTop: "12px", display: "grid", gap: "8px" }}>
              {visibleCollections.map((collectionItem) => (
                <div key={collectionItem.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "8px 10px", borderRadius: "8px", background: isDarkMode ? "#111827" : "#f8fafc", border: isDarkMode ? "1px solid rgba(148,163,184,0.2)" : "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                    <span style={{ fontSize: "0.9rem", color: isDarkMode ? "#e2e8f0" : "#444", fontWeight: 600 }}>{collectionItem.name || "Unnamed collection"}</span>
                    <span style={{ fontSize: "0.78rem", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>{Number(collectionItem.asset_count || 0)} asset{Number(collectionItem.asset_count || 0) === 1 ? "" : "s"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (collectionItem) {
                        startEditingCollection(collectionItem);
                      } else {
                        setEditingCollectionInModal("__pending__");
                        setEditingCollectionNameInModal("");
                      }
                    }}
                    style={{
                      background: "#1976d2",
                      color: "white",
                      border: "none",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      cursor: "pointer"
                    }}
                  >
                    Modify
                  </button>
                </div>
              ))}
            </div>

            {deleteWarning && (
              <div
                style={{
                  padding: "14px",
                  borderRadius: "10px",
                  border: "1px solid #f4b183",
                  background: "#fff8e1",
                  color: "#8a4b00"
                }}
              >
                <strong>Unable to delete this collection.</strong>
                <div style={{ marginTop: "6px" }}>
                  It currently contains {deleteWarning.assetCount || 0} asset{(deleteWarning.assetCount || 0) === 1 ? "" : "s"}.
                </div>
                {deleteWarning.assets?.length > 0 && (
                  <div style={{ marginTop: "8px" }}>
                    <div>Assets:</div>
                    <ul style={{ margin: "6px 0 0 18px" }}>
                      {deleteWarning.assets.map((asset) => (
                        <li key={asset.id}>{asset.title || asset.filename || "Unnamed asset"}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="company">
            <h3>Company</h3>
            <div style={{ display: "grid", gap: "10px" }}>
              {[
                { label: "About Us", href: "/about" },
                { label: "Pricing", href: "/pricing" },
                { label: "Careers", href: "/careers" },
                { label: "Contact", href: "/contact" }
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    background: "#1976d2",
                    color: "white",
                    border: "none",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    cursor: "pointer",
                    textAlign: "center",
                    textDecoration: "none",
                    fontSize: "0.95rem"
                  }}
                >
                  {link.label}
                </a>
              ))}
            </div>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="payment-gateway">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
              <h3 style={{ margin: 0 }}>Payment Gateway</h3>
              <button
                type="button"
                onClick={() => {
                  setSelectedPaymentGateway("Google Pay");
                  setPaymentGatewayIdentifier(paymentGatewaySettings["google pay"]?.identifier || "");
                  setPaymentGatewayMessage("");
                }}
                style={{
                  background: "#43a047",
                  color: "white",
                  border: "none",
                  padding: "7px 10px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  whiteSpace: "nowrap"
                }}
              >
                Add New
              </button>
            </div>
            <p className="admin-panel-payment-gateway-copy">Select the payment methods you want to offer to customers.</p>
            <div className="admin-panel-payment-gateway-list">
              {paymentGatewayOptions.map((gateway) => {
                const isEnabled = enabledPaymentGateways.includes(gateway);
                return (
                  <label
                    key={gateway}
                    className="admin-panel-payment-gateway-option"
                    style={{
                      background: isEnabled ? "#2f5f8f" : "inherit"
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPaymentGateway(gateway);
                        setPaymentGatewayIdentifier(paymentGatewaySettings[gateway.toLowerCase()]?.identifier || "");
                        setPaymentGatewayMessage("");
                      }}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "inherit",
                        padding: 0,
                        fontWeight: 600,
                        cursor: "pointer",
                        textAlign: "left"
                      }}
                    >
                      {gateway}
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={async () => {
                        const next = enabledPaymentGateways.includes(gateway)
                          ? enabledPaymentGateways.filter((item) => item !== gateway)
                          : [...enabledPaymentGateways, gateway];

                        try {
                          const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
                          await axios.post(
                            `${API_BASE_URL}/admin/payment-settings`,
                            { enabledGateways: next },
                            { headers: token ? { Authorization: `Bearer ${token}` } : {} }
                          );
                          setEnabledPaymentGateways(next);
                          window.dispatchEvent(new Event("payment-gateways-updated"));
                        } catch (err) {
                          console.error("Failed to save payment gateway selection", err);
                        }
                        }}
                      />
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          deletePaymentGateway(gateway);
                        }}
                        aria-label={`Delete ${gateway}`}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#dc2626",
                          padding: "2px",
                          cursor: "pointer",
                          fontSize: "0.78rem",
                          fontWeight: 700
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </label>
                );
              })}
            </div>
          </CardWrapper>

          {selectedPaymentGateway && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15, 23, 42, 0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
                padding: "20px"
              }}
              onClick={() => setSelectedPaymentGateway(null)}
            >
              <div
                style={{
                  background: isDarkMode ? "#1f1f1f" : "#ffffff",
                  color: isDarkMode ? "#f5f5f5" : "#0f172a",
                  borderRadius: "12px",
                  boxShadow: "0 14px 40px rgba(0, 0, 0, 0.2)",
                  width: "min(420px, 100%)",
                  padding: "20px"
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <h3 style={{ margin: 0 }}>{selectedPaymentGateway}</h3>
                  <button
                    type="button"
                    onClick={() => setSelectedPaymentGateway(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "1rem",
                      color: "inherit"
                    }}
                  >
                    ✕
                  </button>
                </div>
                <p style={{ margin: 0 }}>
                  {enabledPaymentGateways.includes(selectedPaymentGateway) ? "Currently active" : "Currently inactive"}
                </p>
                {selectedPaymentGateway === "Google Pay" ? (
                  <div style={{ marginTop: "12px", display: "grid", gap: "10px" }}>
                    <p style={{ margin: 0, color: isDarkMode ? "#cbd5e1" : "#475569" }}>
                      Active Google Pay ID: {paymentGatewaySettings["google pay"]?.identifier || "Not configured"}
                    </p>
                    <label style={{ display: "grid", gap: "6px", fontWeight: 600 }}>
                      Google Pay ID
                      <input
                        type="text"
                        placeholder="Enter Google Pay ID"
                        value={paymentGatewayIdentifier}
                        onChange={(event) => setPaymentGatewayIdentifier(event.target.value)}
                        style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => savePaymentGatewaySettings(selectedPaymentGateway, paymentGatewayIdentifier)}
                      disabled={paymentGatewaySaving}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "none",
                        background: "#1976d2",
                        color: "white",
                        cursor: paymentGatewaySaving ? "not-allowed" : "pointer"
                      }}
                    >
                      {paymentGatewaySaving ? "Saving..." : "Save Google Pay ID"}
                    </button>
                    {paymentGatewayMessage ? <p style={{ margin: 0, color: isDarkMode ? "#cbd5e1" : "#475569" }}>{paymentGatewayMessage}</p> : null}
                  </div>
                ) : null}
                <p style={{ margin: "12px 0 0", color: isDarkMode ? "#cbd5e1" : "#475569" }}>
                  Use the checkbox to enable or disable this payment method.
                </p>
              </div>
            </div>
          )}

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="legal-resources">
            <h3>Legal & Resources</h3>
            <div style={{ display: "grid", gap: "10px" }}>
              {[
                { label: "Privacy Policy", href: "/privacy-policy" },
                { label: "Terms & Conditions", href: "/terms-and-conditions" },
                { label: "Cookie Policy", href: "/cookie-policy" },
                { label: "Help Center", href: "/help-center" },
                { label: "Developers", href: "/developers" },
                { label: "Partners", href: "/partners" }
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    background: "#1976d2",
                    color: "white",
                    border: "none",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    cursor: "pointer",
                    textAlign: "center",
                    textDecoration: "none",
                    fontSize: "0.95rem"
                  }}
                >
                  {link.label}
                </a>
              ))}
            </div>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="social-media">
            <h3 style={{ margin: "4px 0 6px" }}>Social Media</h3>
            <p style={{ color: "inherit", margin: "0 0 8px", fontSize: "0.9rem" }}>Set the footer social links using a platform dropdown and URL field.</p>
            <div style={{ display: "grid", gap: "8px" }}>
              {socialLinks.map((item, index) => {
                const selectedPlatforms = socialLinks.map((entry) => entry.platform);
                return (
                  <div key={`${item.platform}-${index}`} className="admin-panel-social-row">
                    <select
                      value={item.platform}
                      onChange={(e) => updateSocialLink(index, { platform: e.target.value })}
                      style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid #ccc", background: "inherit", minWidth: "110px" }}
                    >
                      {SOCIAL_LINK_OPTIONS.map((option) => (
                        <option
                          key={option.value || "empty"}
                          value={option.value}
                          disabled={selectedPlatforms.includes(option.value) && option.value !== item.platform}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="url"
                      value={item.url}
                      placeholder="https://"
                      onChange={(e) => updateSocialLink(index, { url: e.target.value })}
                      style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid #ccc", flex: 1, background: "inherit" }}
                    />
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={saveSocialLinks}
              style={{
                marginTop: "10px",
                background: "#1976d2",
                color: "white",
                border: "none",
                padding: "8px 14px",
                borderRadius: "8px",
                cursor: "pointer"
              }}
            >
              Save Social Links
            </button>
            {socialLinksMessage ? <div style={{ marginTop: "8px", color: "#8be28b", fontSize: "0.9rem" }}>{socialLinksMessage}</div> : null}
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="email-management">
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
              <span style={{ fontSize: "1.35rem" }}>📧</span>
              <div>
                <h3 style={{ margin: 0 }}>Email Management</h3>
                <div style={{ color: "#55606f", fontSize: "0.92rem", lineHeight: 1.4 }}>Quick access to email settings, templates, alerts, queue, and analytics.</div>
              </div>
            </div>
            <div className="admin-panel-email-grid">
              <div className="admin-panel-email-row">
                <EmailActionButton icon="⚙️" label="Email Configuration" color="#ED2224" onClick={() => setEmailModal('settings')} />
                <EmailActionButton icon="📄" label="Email Templates" color="#1976d2" onClick={() => setEmailModal('templates')} />
                <EmailActionButton icon="🔔" label="Notification Rules" color="#43a047" onClick={() => setEmailModal('rules')} />
              </div>

              <div className="admin-panel-email-row">
                <button
                  type="button"
                  className="admin-panel-email-button admin-panel-email-button--special"
                  onClick={() => setEmailModal('newsletter')}
                  title="Newsletter Manager"
                  aria-label="Newsletter Manager"
                  style={{
                    width: "100%",
                    padding: "13px 14px",
                    borderRadius: "14px",
                    background: "linear-gradient(135deg, #ff8a00 0%, #f57c00 45%, #ffb347 100%)",
                    color: "white",
                    border: "1px solid rgba(255,255,255,0.2)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0",
                    fontWeight: 700,
                    letterSpacing: "0.01em",
                    boxShadow: "0 12px 24px rgba(245, 124, 0, 0.28)",
                    transition: "transform 0.16s ease, box-shadow 0.16s ease",
                    fontSize: "1.35rem",
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                    textAlign: "center",
                    minHeight: "42px"
                  }}
                >
                  <span>📰</span>
                  Newsletter Manager
                </button>
                <button
                  type="button"
                  className="admin-panel-email-button admin-panel-email-button--special"
                  onClick={() => setEmailModal('queue')}
                  title="Email Queue"
                  aria-label="Email Queue"
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: "14px",
                    background: "linear-gradient(135deg, #616161 0%, #424242 45%, #757575 100%)",
                    color: "white",
                    border: "1px solid rgba(255,255,255,0.16)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0",
                    fontWeight: 700,
                    letterSpacing: "0.01em",
                    boxShadow: "0 12px 24px rgba(66, 66, 66, 0.24)",
                    transition: "transform 0.16s ease, box-shadow 0.16s ease",
                    fontSize: "1.35rem",
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                    textAlign: "center",
                    minHeight: "42px"
                  }}
                >
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "28px",
                    height: "28px",
                    borderRadius: "999px",
                    background: "rgba(255,255,255,0.16)",
                    fontSize: "0.95rem"
                  }}>
                    📬
                  </span>
                  <span>Email Queue</span>
                </button>
                <EmailActionButton icon="🧾" label="Email Logs" color="#9c27b0" onClick={() => setEmailModal('logs')} />
              </div>

              <div className="admin-panel-email-row">
                <EmailActionButton icon="⏰" label="Scheduled Emails" color="#00695c" onClick={() => setEmailModal('scheduled')} />
                <EmailActionButton icon="📩" label="Test Email" color="#0288d1" onClick={() => setEmailModal('settings')} />
                <EmailActionButton icon="📊" label="Email Analytics" color="#d84315" onClick={() => setEmailModal('analytics')} />
              </div>
            </div>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="daily-reports">
            <h3 style={{ margin: 0, marginBottom: 10 }}>Daily reports</h3>
            <p style={{ margin: "0 0 16px", color: "inherit", fontSize: "0.95rem" }}>
              Schedule and preview the automated daily website summary email for admins and selected recipients.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  const dailyReportSettingsUrl = `${adminBasePath}/email/daily-report-settings?tab=controls`;
                  setDailyReportSettingsPageOpen(true);
                  if (typeof window !== "undefined") {
                    window.history.pushState({}, "", dailyReportSettingsUrl);
                    setCurrentWindowPath(dailyReportSettingsUrl.replace(/\?.*$/, ""));
                    window.dispatchEvent(new PopStateEvent("popstate"));
                  }
                }}
                style={{
                  background: "#2563eb",
                  color: "white",
                  border: "none",
                  padding: "10px 16px",
                  borderRadius: "10px",
                  cursor: "pointer",
                  width: "100%",
                  fontWeight: 700
                }}
              >
                Daily Report Settings
              </button>
              <button
                type="button"
                onClick={openDailyReportPreview}
                style={{
                  background: "#0f766e",
                  color: "white",
                  border: "none",
                  padding: "10px 16px",
                  borderRadius: "10px",
                  cursor: "pointer",
                  width: "100%",
                  fontWeight: 700
                }}
              >
                Preview Daily Report
              </button>
              <button
                type="button"
                onClick={() => setDailyReportSchedulingOpen(true)}
                style={{
                  background: "#065f46",
                  color: "white",
                  border: "none",
                  padding: "10px 16px",
                  borderRadius: "10px",
                  cursor: "pointer",
                  width: "100%",
                  fontWeight: 700
                }}
              >
                Scheduled reports
              </button>
            </div>
          </CardWrapper>

          {/* Watermark Settings */}
          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="watermark-settings">
            <h3 style={{ margin: 0 }}>Watermark Settings</h3>
            <form onSubmit={uploadWatermark} style={{ display: "grid", gap: "12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.95rem", color: "#333", fontWeight: 600 }}>Upload Watermark Logo</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setBrandingWatermarkLogoFile(e.target.files?.[0] || null)}
                  style={{ padding: "10px", background: "white", borderRadius: "8px", border: "1px solid #ccc", width: "100%", boxSizing: "border-box" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.95rem", color: "#333", fontWeight: 600 }}>Upload Watermark Favicon</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setBrandingWatermarkFaviconFile(e.target.files?.[0] || null)}
                  style={{ padding: "10px", background: "white", borderRadius: "8px", border: "1px solid #ccc", width: "100%", boxSizing: "border-box" }}
                />
              </label>
              <button
                type="submit"
                style={{
                  background: "#2196f3",
                  color: "white",
                  border: "none",
                  padding: "10px 18px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  width: "100%"
                }}
                disabled={brandingUploading}
              >
                {brandingUploading ? "Saving..." : "Save Watermark"}
              </button>
            </form>
            {brandingConfig?.watermarkLogo || brandingConfig?.watermarkFavicon ? (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", paddingTop: "4px" }}>
                {brandingConfig.watermarkLogo && (
                  <img
                    src={`${API_BASE_URL}${brandingConfig.watermarkLogo}`}
                    alt="Current watermark logo"
                    style={{ height: "36px", width: "auto", objectFit: "contain" }}
                  />
                )}
                {brandingConfig.watermarkFavicon && (
                  <img
                    src={`${API_BASE_URL}${brandingConfig.watermarkFavicon}`}
                    alt="Current watermark favicon"
                    style={{ height: "24px", width: "24px", objectFit: "contain" }}
                  />
                )}
              </div>
            ) : null}
            {brandingMessage ? <p style={{ margin: 0, color: brandingMessage.includes("Failed") ? "#d32f2f" : "#2e7d32" }}>{brandingMessage}</p> : null}
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="hero-banner-image">
            <h3>Hero Banner Image</h3>
            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={resetHeroBanner}
                  style={{
                    background: "#607d8b",
                    color: "white",
                    border: "none",
                    padding: "10px 16px",
                    borderRadius: "8px",
                    cursor: "pointer"
                  }}
                  disabled={heroBannerSaving}
                >
                  Default
                </button>
                <button
                  type="button"
                  onClick={() => heroBannerInputRef.current?.click()}
                  style={{
                    background: "#2196f3",
                    color: "white",
                    border: "none",
                    padding: "10px 16px",
                    borderRadius: "8px",
                    cursor: "pointer"
                  }}
                >
                  Add Image
                </button>
                <input
                  ref={heroBannerInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => setHeroBannerFile(e.target.files?.[0] || null)}
                />
              </div>
              <p style={{ margin: "0", color: "#4b5563", fontSize: "0.95rem" }}>
                Recommended size: 1865×607 px.
              </p>

              <div style={{ display: "grid", gap: "8px" }}>
                {brandingConfig.heroBanner ? (
                  <img
                    src={`${API_BASE_URL}${brandingConfig.heroBanner}`}
                    alt="Current hero banner"
                    style={{ width: "100%", maxHeight: "140px", objectFit: "cover", borderRadius: "10px", border: "1px solid #e2e8f0" }}
                  />
                ) : (
                  <p style={{ margin: 0, color: "#5f6c7b" }}>Current home hero uses the default animated background.</p>
                )}
                {heroBannerFile ? (
                  <p style={{ margin: 0, color: "#2e7d32" }}>Selected image: {heroBannerFile.name}</p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={uploadHeroBanner}
                style={{
                  background: "#43a047",
                  color: "white",
                  border: "none",
                  padding: "10px 18px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  width: "100%"
                }}
                disabled={heroBannerSaving}
              >
                {heroBannerSaving ? "Saving..." : "Save Hero Banner"}
              </button>

              {heroBannerMessage ? (
                <p style={{ margin: 0, color: heroBannerMessage.includes("Failed") || heroBannerMessage.includes("Choose") ? "#d32f2f" : "#2e7d32" }}>
                  {heroBannerMessage}
                </p>
              ) : null}
            </div>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="hero-text-settings">
            <h3 style={{ margin: '0 0 12px 0' }}>Hero Text Settings</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              <button
                type="button"
                onClick={() => openHeroModal('badge')}
                title={heroBadge || brandingConfig?.heroBadge || HERO_BADGE_DEFAULT}
                aria-label={`Edit Badge`}
                style={{ padding: 12, borderRadius: 8, border: '1px solid #e6edf3', background: isDarkMode ? '#0b1220' : 'white', cursor: 'pointer', textAlign: 'left' }}
              >
                <div style={{ fontWeight: 700 }}>Badge</div>
              </button>

              <button
                type="button"
                onClick={() => openHeroModal('line1')}
                title={heroHeadingLine1 || brandingConfig?.heroHeadingLine1 || ''}
                aria-label={`Edit Heading line 1`}
                style={{ padding: 12, borderRadius: 8, border: '1px solid #e6edf3', background: isDarkMode ? '#0b1220' : 'white', cursor: 'pointer', textAlign: 'left' }}
              >
                <div style={{ fontWeight: 700 }}>Heading line 1</div>
              </button>

              <button
                type="button"
                onClick={() => openHeroModal('line2')}
                title={heroHeadingLine2 || brandingConfig?.heroHeadingLine2 || ''}
                aria-label={`Edit Heading line 2`}
                style={{ padding: 12, borderRadius: 8, border: '1px solid #e6edf3', background: isDarkMode ? '#0b1220' : 'white', cursor: 'pointer', textAlign: 'left' }}
              >
                <div style={{ fontWeight: 700 }}>Heading line 2</div>
              </button>

              <button
                type="button"
                onClick={() => openHeroModal('paragraph')}
                title={heroParagraph || brandingConfig?.heroParagraph || ''}
                aria-label={`Edit Paragraph`}
                style={{ padding: 12, borderRadius: 8, border: '1px solid #e6edf3', background: isDarkMode ? '#0b1220' : 'white', cursor: 'pointer', textAlign: 'left' }}
              >
                <div style={{ fontWeight: 700 }}>Paragraph</div>
              </button>

              <button
                type="button"
                onClick={() => openHeroModal('topTab')}
                title={topTab || brandingConfig?.topTab || TOP_TAB_DEFAULT}
                aria-label={`Edit TOP Tab`}
                style={{ padding: 12, borderRadius: 8, border: '1px solid #e6edf3', background: isDarkMode ? '#0b1220' : 'white', cursor: 'pointer', textAlign: 'left' }}
              >
                <div style={{ fontWeight: 700 }}>TOP Tab</div>
              </button>
            </div>
            {heroTextMessage ? (
              <p style={{ margin: '12px 0 0', color: heroTextMessage.includes("Failed") ? "#d32f2f" : "#2e7d32" }}>
                {heroTextMessage}
              </p>
            ) : null}
          </CardWrapper>

          {heroTextModal && (
            <div
              className="admin-panel-modal-overlay"
              onClick={() => setHeroTextModal(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400 }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: 'min(760px, 96%)', background: isDarkMode ? '#0f172a' : '#ffffff', color: isDarkMode ? '#f8fafc' : '#0f172a', borderRadius: 12, padding: 18, boxShadow: '0 20px 60px rgba(2,6,23,0.4)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>{heroTextModal === 'badge' ? 'Edit Badge' : heroTextModal === 'line1' ? 'Edit Heading line 1' : heroTextModal === 'line2' ? 'Edit Heading line 2' : heroTextModal === 'paragraph' ? 'Edit Paragraph' : 'Edit TOP Tab'}</h3>
                  <button onClick={() => setHeroTextModal(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
                </div>

                <div>
                  {heroTextModal === 'paragraph' ? (
                    <textarea
                      rows={6}
                      value={heroParagraph}
                      onChange={(e) => setHeroParagraph(e.target.value)}
                      style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #cbd5e1', resize: 'vertical' }}
                    />
                  ) : (
                    <input
                      type="text"
                      value={heroTextModal === 'badge' ? heroBadge : heroTextModal === 'line1' ? heroHeadingLine1 : heroTextModal === 'line2' ? heroHeadingLine2 : topTab}
                      onChange={(e) => {
                        if (heroTextModal === 'badge') setHeroBadge(e.target.value);
                        else if (heroTextModal === 'line1') setHeroHeadingLine1(e.target.value);
                        else if (heroTextModal === 'line2') setHeroHeadingLine2(e.target.value);
                        else setTopTab(e.target.value);
                      }}
                      style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #cbd5e1' }}
                    />
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      uploadHeroTextSettings(e);
                      setHeroTextModal(null);
                    }}
                    disabled={heroTextSaving}
                    style={{ background: '#1976d2', color: 'white', border: 'none', padding: '10px 14px', borderRadius: 8, cursor: 'pointer' }}
                  >
                    {heroTextSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setHeroTextModal(null)} style={{ background: '#e0e0e0', color: '#111827', border: 'none', padding: '10px 14px', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="pricing-controls">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Pricing Controls</span>
              {pricingSettings && (
                <span style={{ marginLeft: 'auto', background: pricingSettings.enable_global_minimum_pricing ? '#2e7d32' : '#9e9e9e', color: 'white', fontSize: 12, padding: '4px 8px', borderRadius: 999 }}>
                  {pricingSettings.enable_global_minimum_pricing ? 'Enabled' : 'Disabled'}
                </span>
              )}
            </h3>
            <button
              type="button"
              onClick={() => setAdminModal('pricing')}
              style={{
                marginTop: "12px",
                background: "#1976d2",
                color: "white",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                cursor: "pointer",
                width: "100%"
              }}
            >
              Open Pricing Settings
            </button>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => { setTaxModalOpen(true); fetchPricingSettings(); }}
                style={{
                  flex: 1,
                  minWidth: 120,
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Tax Settings
              </button>
              <button
                type="button"
                onClick={() => setInvoiceModalOpen(true)}
                style={{
                  flex: 1,
                  minWidth: 120,
                  background: '#1e293b',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Invoice Template
              </button>
            </div>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="free-asset-settings">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Free Asset Settings</span>
              <span style={{ marginLeft: 'auto', background: freeAssetSettings ? (freeAssetSettings.enable_free_assets ? '#2e7d32' : '#9e9e9e') : '#6b7280', color: 'white', fontSize: 12, padding: '4px 8px', borderRadius: 999 }}>
                {freeAssetSettings ? (freeAssetSettings.enable_free_assets ? 'On' : 'Off') : 'Not loaded'}
              </span>
            </h3>
            <p style={{ color: "inherit", marginTop: "-4px", fontSize: "0.95rem" }}>
              Configure free asset downloads, badges, and eligibility rules.
            </p>
            <button
              type="button"
              onClick={() => setAdminModal('freeAssets')}
              style={{
                marginTop: "12px",
                background: "#43a047",
                color: "white",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                cursor: "pointer",
                width: "100%"
              }}
            >
              Open Free Asset Settings
            </button>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="subscription-plans">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Subscription Plans</span>
              <span style={{ marginLeft: 'auto', background: subscriptionPlans && subscriptionPlans.length > 0 ? '#1976d2' : '#6b7280', color: 'white', fontSize: 12, padding: '4px 8px', borderRadius: 999 }}>
                {subscriptionPlans ? `${subscriptionPlans.length}` : '0'}
              </span>
            </h3>
            <p style={{ color: "inherit", marginTop: "-4px", fontSize: "0.95rem" }}>
              View and manage customer subscription plans from the admin panel.
            </p>
            <button
              type="button"
              onClick={() => { resetPlanForm(); setAdminModal('subscriptionPlanForm'); }}
              style={{
                marginTop: "12px",
                background: "#9c27b0",
                color: "white",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                cursor: "pointer",
                width: "100%"
              }}
            >
              Add New Subscription Plan
            </button>
            <a
              href="/admin/current-plans"
              style={{
                marginTop: "8px",
                background: "#00897b",
                color: "white",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                cursor: "pointer",
                width: "100%",
                textAlign: "center",
                textDecoration: "none",
                boxSizing: "border-box"
              }}
            >
              View Current Plans
            </a>
            <a
              href="/admin/subscribers"
              style={{
                marginTop: "8px",
                background: "#1976d2",
                color: "white",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                cursor: "pointer",
                width: "100%"
              }}
            >
              View Subscribers
            </a>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="custom-subscriptions">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Custom Subscriptions</span>
              <span style={{ marginLeft: 'auto', background: customSubscriptions && customSubscriptions.length > 0 ? '#f57c00' : '#6b7280', color: 'white', fontSize: 12, padding: '4px 8px', borderRadius: 999 }}>
                {customSubscriptions ? `${customSubscriptions.length}` : '0'}
              </span>
            </h3>
            <p style={{ color: "inherit", marginTop: "-4px", fontSize: "0.95rem" }}>
              Create and manage custom customer subscriptions with bespoke pricing.
            </p>
            <button
              type="button"
              onClick={() => setAdminModal('customSubscriptions')}
              style={{
                marginTop: "12px",
                background: "#f57c00",
                color: "white",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                cursor: "pointer",
                width: "100%"
              }}
            >
              Open Custom Subscriptions
            </button>
            <a
              href="/admin/custom-subscriptions"
              style={{
                marginTop: "8px",
                background: "#0f766e",
                color: "white",
                border: "none",
                padding: "10px 18px",
                borderRadius: "8px",
                cursor: "pointer",
                width: "100%",
                textAlign: "center",
                textDecoration: "none",
                boxSizing: "border-box",
                display: "inline-block"
              }}
            >
              Request Subscription
            </a>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="otp-settings">
            <h3 style={{ margin: 0, marginBottom: 12 }}>OTP Settings</h3>
            <p style={{ margin: "0 0 16px", color: "inherit" }}>Choose the OTP flow you want to configure.</p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                padding: 8,
                borderRadius: 14,
                background: isDarkMode ? "rgba(15, 23, 42, 0.75)" : "#eef2ff",
                border: isDarkMode ? "1px solid rgba(148, 163, 184, 0.18)" : "1px solid rgba(99, 102, 241, 0.12)",
                boxShadow: isDarkMode ? "inset 0 1px 0 rgba(148,163,184,0.08)" : "inset 0 1px 0 rgba(255,255,255,0.7)"
              }}
            >
              {[
                { key: "general", label: "Default OTP Delivery" },
                { key: "login", label: "Login" },
                { key: "registration", label: "Registration" },
                { key: "recovery", label: "Forgot Password" }
              ].map((option) => {
                const isActive = otpSettingsModal === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setOtpSettingsModal(option.key)}
                    style={{
                      flex: "1 1 180px",
                      minHeight: 42,
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 13,
                      textAlign: "center",
                      color: isActive ? "#ffffff" : isDarkMode ? "#e2e8f0" : "#334155",
                      background: isActive
                        ? "linear-gradient(135deg, #2563eb, #38bdf8)"
                        : isDarkMode
                          ? "rgba(30, 41, 59, 0.8)"
                          : "rgba(255, 255, 255, 0.7)",
                      boxShadow: isActive ? "0 8px 18px rgba(37, 99, 235, 0.30)" : "inset 0 1px 0 rgba(255,255,255,0.1)",
                      transition: "all 0.2s ease"
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {otpSettingsMessage ? (
              <div style={{ marginTop: 16, color: otpSettingsMessage.toLowerCase().includes("failed") ? "#d32f2f" : "#2e7d32" }}>
                {otpSettingsMessage}
              </div>
            ) : null}
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="customer-banner">
            <h3 style={{ margin: 0, marginBottom: 8 }}>Customer Banner</h3>
            <p style={{ margin: "0 0 16px", color: "inherit" }}>
              Choose the image displayed in the customer account banner.
            </p>
            <button
              type="button"
              onClick={() => setCustomerBannerModal(true)}
              style={{ background: "#ed2224", color: "white", border: "none", padding: "10px 18px", borderRadius: "8px", cursor: "pointer", width: "100%" }}
            >
              Open Customer Banner
            </button>
            <button
              type="button"
              onClick={() => setContributorBannerModal(true)}
              style={{ background: "transparent", color: "#ed2224", border: "1px solid #ed2224", padding: "10px 18px", borderRadius: "8px", cursor: "pointer", width: "100%", marginTop: "8px" }}
            >
              Choose Contributor Banner
            </button>
            <input
              ref={customerBannerInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                setCustomerBannerFile(e.target.files?.[0] || null);
                setCustomerBannerMessage("");
              }}
            />
            <p style={{ margin: "12px 0 0", color: "#4b5563", fontSize: "0.9rem" }}>
              Recommended image size: 900 × 164 px.
            </p>
            {brandingConfig.customerBanner ? (
              <img src={`${API_BASE_URL}${brandingConfig.customerBanner}`} alt="Current customer banner" style={{ width: "100%", height: "110px", objectFit: "cover", marginTop: "14px", borderRadius: "10px", border: "1px solid #e2e8f0" }} />
            ) : null}
            {customerBannerFile ? <p style={{ margin: "10px 0 0", color: "#2e7d32" }}>Selected image: {customerBannerFile.name}</p> : null}
            <button
              type="button"
              onClick={uploadCustomerBanner}
              disabled={customerBannerSaving}
              style={{ background: "#43a047", color: "white", border: "none", padding: "10px 18px", borderRadius: "8px", cursor: customerBannerSaving ? "not-allowed" : "pointer", width: "100%", marginTop: "12px" }}
            >
              {customerBannerSaving ? "Saving..." : "Save Customer Banner"}
            </button>
            {customerBannerMessage ? <p style={{ margin: "12px 0 0", color: customerBannerMessage.includes("Failed") || customerBannerMessage.includes("Choose") ? "#d32f2f" : "#2e7d32" }}>{customerBannerMessage}</p> : null}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}>
              <h4 style={{ margin: "0 0 8px" }}>Contributor Banner</h4>
              <p style={{ margin: "0 0 12px", color: "inherit", fontSize: "0.9rem" }}>
                Choose the image displayed behind the Elite Contributor banner.
              </p>
              <input
                ref={contributorBannerInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  setContributorBannerFile(e.target.files?.[0] || null);
                  setContributorBannerMessage("");
                }}
              />
              <button
                type="button"
                onClick={() => setContributorBannerModal(true)}
                style={{ background: "transparent", color: "#ed2224", border: "1px solid #ed2224", padding: "10px 18px", borderRadius: "8px", cursor: "pointer", width: "100%" }}
              >
                Choose Contributor Banner
              </button>
              {brandingConfig.contributorBanner ? (
                <img src={`${API_BASE_URL}${brandingConfig.contributorBanner}`} alt="Current contributor banner" style={{ width: "100%", height: "110px", objectFit: "cover", marginTop: "14px", borderRadius: "10px", border: "1px solid #e2e8f0" }} />
              ) : null}
              {contributorBannerFile ? <p style={{ margin: "10px 0 0", color: "#2e7d32" }}>Selected image: {contributorBannerFile.name}</p> : null}
              <button
                type="button"
                onClick={uploadContributorBanner}
                disabled={contributorBannerSaving}
                style={{ background: "#43a047", color: "white", border: "none", padding: "10px 18px", borderRadius: "8px", cursor: contributorBannerSaving ? "not-allowed" : "pointer", width: "100%", marginTop: "12px" }}
              >
                {contributorBannerSaving ? "Saving..." : "Save Contributor Banner"}
              </button>
              {contributorBannerMessage ? <p style={{ margin: "12px 0 0", color: contributorBannerMessage.includes("Failed") || contributorBannerMessage.includes("Choose") ? "#d32f2f" : "#2e7d32" }}>{contributorBannerMessage}</p> : null}
            </div>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="credits">
            <h3>Credits</h3>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
              <span style={{ fontSize: "0.95rem", color: "inherit", fontWeight: 600 }}>Username</span>
              <input
                type="text"
                list="admin-credit-users"
                value={users.find((user) => String(user.id) === String(creditUserId))?.username || ""}
                onChange={(e) => {
                  const selectedUser = users.find((user) => user.username === e.target.value);
                  setCreditUserId(selectedUser ? String(selectedUser.id) : "");
                }}
                placeholder="Search username"
                style={{ padding: "10px", borderRadius: "8px", border: "1px solid #ccc" }}
              />
              <datalist id="admin-credit-users">
                {users.map((user) => <option key={user.id} value={user.username} />)}
              </datalist>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
              <span style={{ fontSize: "0.95rem", color: "inherit", fontWeight: 600 }}>Amount</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                placeholder="Enter credits"
                style={{ padding: "10px", borderRadius: "8px", border: "1px solid #ccc" }}
              />
            </label>
            <button
              type="button"
              onClick={addCreditsToUser}
              disabled={isAddingCredits}
              style={{ background: "#1976d2", color: "white", border: "none", padding: "10px 18px", borderRadius: "8px", cursor: isAddingCredits ? "not-allowed" : "pointer", width: "100%" }}
            >
              {isAddingCredits ? "Adding..." : "Add Credits"}
            </button>
            <button
              type="button"
              onClick={() => { window.location.href = "/admin/customer-credits"; }}
              style={{ background: "transparent", color: "#1976d2", border: "1px solid #1976d2", padding: "10px 18px", borderRadius: "8px", cursor: "pointer", width: "100%", marginTop: "10px" }}
            >
              View Credits
            </button>
          </CardWrapper>

          <CardWrapper cardOrder={cardOrder} isLayoutEditMode={isLayoutEditMode} isDarkMode={isDarkMode} moveCard={moveCard} cardId="credit-price-control">
            <h3>Credit Price Control</h3>
            <p>Manage credit package pricing for customers.</p>
            <button
              type="button"
              onClick={() => setCreditPopup("price")}
              style={{ background: "#1976d2", color: "white", border: "none", padding: "10px 18px", borderRadius: "8px", cursor: "pointer", width: "100%", marginTop: "8px" }}
            >
              Manage Credit Prices
            </button>
            <button
              type="button"
              onClick={openRequestedCredits}
              style={{ background: "transparent", color: "#1976d2", border: "1px solid #1976d2", padding: "10px 18px", borderRadius: "8px", cursor: "pointer", width: "100%", marginTop: "10px" }}
            >
              Requested Credits
            </button>
          </CardWrapper>

          {creditPopup && (
            <div
              className="admin-panel-modal-overlay"
              onClick={() => setCreditPopup(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.72)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1450 }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", maxWidth: 620, maxHeight: "80vh", overflowY: "auto", padding: 24, background: isDarkMode ? "#111827" : "#ffffff", color: isDarkMode ? "#f8fafc" : "#111827", borderRadius: 16, boxShadow: "0 30px 90px rgba(2,6,23,0.35)" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                  <h3 style={{ margin: 0 }}>{creditPopup === "price" ? "Credit Price Settings" : "Requested Credits"}</h3>
                  <button type="button" aria-label="Close credit popup" onClick={() => setCreditPopup(null)} style={{ border: 0, borderRadius: "50%", width: 34, height: 34, cursor: "pointer" }}>×</button>
                </div>
                {creditPopup === "price" ? (
                  <div style={{ marginTop: 20 }}>
                    <p>Set the INR value of one credit.</p>
                    <label style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
                      <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>Credit package prices (INR)</span>
                      {[100, 200, 500, 1000].map((amount) => (
                        <div key={amount} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "center" }}>
                          <span>{amount} Credits</span>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={creditPrices[amount]}
                            onChange={(e) => {
                              setCreditPrices((previous) => ({ ...previous, [amount]: e.target.value }));
                              setCreditPriceMessage("");
                            }}
                            aria-label={`${amount} credits price in INR`}
                            style={{ padding: "10px", borderRadius: "8px", border: "1px solid #ccc" }}
                          />
                        </div>
                      ))}
                    </label>
                    <button type="button" onClick={saveCreditPrice} disabled={creditPriceSaving} style={{ background: "#1976d2", color: "white", border: "none", padding: "10px 18px", borderRadius: "8px", cursor: creditPriceSaving ? "not-allowed" : "pointer", width: "100%" }}>
                      {creditPriceSaving ? "Saving..." : "Save Credit Price"}
                    </button>
                    {creditPriceMessage ? <p role="status" style={{ margin: "12px 0 0", color: creditPriceMessage.includes("Failed") || creditPriceMessage.includes("Unable") || creditPriceMessage.includes("Enter") ? "#d32f2f" : "#2e7d32" }}>{creditPriceMessage}</p> : null}
                  </div>
                ) : requestedCreditsLoading ? (
                  <p style={{ marginTop: 20 }}>Loading requested credits...</p>
                ) : requestedCredits.length === 0 ? (
                  <p style={{ marginTop: 20 }}>No requested credits found.</p>
                ) : (
                  <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
                    {requestedCredits.map((request) => (
                      <div key={request.order_id} style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 8 }}>
                        <strong>{request.full_name || request.username || request.email || "Unknown user"}</strong>
                        <div>{request.email || "NA"} · {request.phone || "NA"}</div>
                        <div>Requested currently: {Number(request.credit_amount || 0) * Number(request.quantity || 1)} credits</div>
                        <div>Previously requested: {Number(request.previous_requested_credits || 0)} credits</div>
                        <small>Previous request date: {request.previous_requested_at ? new Date(request.previous_requested_at).toLocaleString() : "NA"}</small>
                        <div style={{ marginTop: 8 }}>Status: {String(request.order_status || "pending").replace(/_/g, " ")}</div>
                        {request.order_status === "pending" ? (
                          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                            <button type="button" disabled={requestedCreditsActionLoading} onClick={() => updateCreditRequestStatus(request.order_id, "approved")} style={{ border: 0, borderRadius: 6, padding: "7px 12px", background: "#2e7d32", color: "#fff", cursor: "pointer" }}>Approve</button>
                            <button type="button" disabled={requestedCreditsActionLoading} onClick={() => updateCreditRequestStatus(request.order_id, "rejected")} style={{ border: 0, borderRadius: 6, padding: "7px 12px", background: "#d32f2f", color: "#fff", cursor: "pointer" }}>Reject</button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {customerBannerModal && (
            <div
              className="admin-panel-modal-overlay"
              onClick={() => setCustomerBannerModal(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.72)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1450 }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", maxWidth: 620, padding: 24, background: isDarkMode ? "#111827" : "#ffffff", color: isDarkMode ? "#f8fafc" : "#111827", borderRadius: 20, boxShadow: "0 30px 90px rgba(2,6,23,0.35)" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Change Customer Banner</h3>
                    <p style={{ margin: "8px 0 0", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>Select the image that will appear above Your creative library.</p>
                  </div>
                  <button type="button" onClick={() => setCustomerBannerModal(false)} style={{ border: 0, borderRadius: "50%", width: 34, height: 34, cursor: "pointer" }}>×</button>
                </div>
                <div style={{ marginTop: 20, padding: 12, borderRadius: 12, background: isDarkMode ? "#1f2937" : "#f8fafc" }}>
                  <strong>Required display size</strong>
                  <p style={{ margin: "5px 0 0", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>900 × 164 px. Use a wide image for the best result.</p>
                </div>
                <input ref={customerBannerInputRef} type="file" accept="image/*" hidden onChange={(e) => { setCustomerBannerFile(e.target.files?.[0] || null); setCustomerBannerMessage(""); }} />
                <button type="button" onClick={() => customerBannerInputRef.current?.click()} style={{ marginTop: 18, width: "100%", padding: "12px 18px", border: "1px solid #ed2224", borderRadius: 9, color: "#ed2224", background: "transparent", cursor: "pointer", fontWeight: 700 }}>Choose image</button>
                {customerBannerFile ? <p style={{ color: "#2e7d32" }}>Selected image: {customerBannerFile.name}</p> : null}
                <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                  <button type="button" onClick={() => setCustomerBannerModal(false)} style={{ flex: 1, padding: "11px 16px", border: 0, borderRadius: 9, cursor: "pointer" }}>Cancel</button>
                  <button type="button" onClick={async () => { await uploadCustomerBanner(); setCustomerBannerModal(false); }} disabled={customerBannerSaving} style={{ flex: 1, padding: "11px 16px", border: 0, borderRadius: 9, color: "#fff", background: "#ed2224", cursor: customerBannerSaving ? "not-allowed" : "pointer", fontWeight: 700 }}>{customerBannerSaving ? "Saving..." : "Save banner"}</button>
                </div>
              </div>
            </div>
          )}

          {contributorBannerModal && (
            <div
              className="admin-panel-modal-overlay"
              onClick={() => setContributorBannerModal(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.72)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1450 }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", maxWidth: 620, padding: 24, background: isDarkMode ? "#111827" : "#ffffff", color: isDarkMode ? "#f8fafc" : "#111827", borderRadius: 20, boxShadow: "0 30px 90px rgba(2,6,23,0.35)" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Change Contributor Banner</h3>
                    <p style={{ margin: "8px 0 0", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>Select the image shown only in contributor accounts.</p>
                  </div>
                  <button type="button" onClick={() => setContributorBannerModal(false)} style={{ border: 0, borderRadius: "50%", width: 34, height: 34, cursor: "pointer" }}>×</button>
                </div>
                <div style={{ marginTop: 20, padding: 12, borderRadius: 12, background: isDarkMode ? "#1f2937" : "#f8fafc" }}>
                  <strong>Required display size</strong>
                  <p style={{ margin: "5px 0 0", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>900 × 164 px. Use a wide image for the best result.</p>
                </div>
                <input ref={contributorBannerInputRef} type="file" accept="image/*" hidden onChange={(e) => { setContributorBannerFile(e.target.files?.[0] || null); setContributorBannerMessage(""); }} />
                <button type="button" onClick={() => contributorBannerInputRef.current?.click()} style={{ marginTop: 18, width: "100%", padding: "12px 18px", border: "1px solid #ed2224", borderRadius: 9, color: "#ed2224", background: "transparent", cursor: "pointer", fontWeight: 700 }}>Choose image</button>
                {contributorBannerFile ? <p style={{ color: "#2e7d32" }}>Selected image: {contributorBannerFile.name}</p> : null}
                <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                  <button type="button" onClick={() => setContributorBannerModal(false)} style={{ flex: 1, padding: "11px 16px", border: 0, borderRadius: 9, cursor: "pointer" }}>Cancel</button>
                  <button type="button" onClick={async () => { await uploadContributorBanner(); setContributorBannerModal(false); }} disabled={contributorBannerSaving} style={{ flex: 1, padding: "11px 16px", border: 0, borderRadius: 9, color: "#fff", background: "#ed2224", cursor: contributorBannerSaving ? "not-allowed" : "pointer", fontWeight: 700 }}>{contributorBannerSaving ? "Saving..." : "Save banner"}</button>
                </div>
              </div>
            </div>
          )}

            {emailModal && (
              <div
                className="admin-panel-modal-overlay"
                onClick={() => setEmailModal(null)}
                style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1300 }}
              >
                <div
                  className="admin-panel-modal-panel"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    maxWidth: emailModal === 'templates' ? 1320 : 1000,
                    background: isDarkMode
                      ? 'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.97))'
                      : 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.97))',
                    border: isDarkMode ? '1px solid rgba(148,163,184,0.24)' : '1px solid rgba(15,23,42,0.08)',
                    borderRadius: 24,
                    overflow: 'hidden',
                    boxShadow: isDarkMode ? '0 30px 90px rgba(2,6,23,0.55)' : '0 24px 70px rgba(15,23,42,0.16)'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '18px 22px',
                    background: isDarkMode
                      ? 'linear-gradient(90deg, rgba(37,99,235,0.16), rgba(14,165,233,0.08))'
                      : 'linear-gradient(90deg, rgba(37,99,235,0.08), rgba(14,165,233,0.05))',
                    borderBottom: isDarkMode ? '1px solid rgba(148,163,184,0.16)' : '1px solid rgba(15,23,42,0.08)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 0 6px rgba(56,189,248,0.16)' }} />
                      <h3 style={{ margin: 0, color: isDarkMode ? '#f8fafc' : '#0f172a', fontSize: 18 }}>{EMAIL_MODAL_TITLES[emailModal] || (emailModal ? emailModal.charAt(0).toUpperCase() + emailModal.slice(1) : '')}</h3>
                    </div>
                    <button onClick={() => setEmailModal(null)} style={{ background: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', border: isDarkMode ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.08)', borderRadius: '999px', color: isDarkMode ? '#f8fafc' : '#0f172a', fontSize: 16, cursor: 'pointer', padding: '8px 11px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                  <div style={{ padding: 18, maxHeight: '88vh', overflow: 'auto', background: isDarkMode ? 'linear-gradient(180deg, rgba(2,6,23,0.88), rgba(15,23,42,0.92))' : 'linear-gradient(180deg, rgba(248,250,252,0.96), rgba(255,255,255,0.98))' }}>
                    {emailModal === 'settings' && <AdminEmailSettings />}
                    {emailModal === 'templates' && <AdminEmailTemplates />}
                    {emailModal === 'logs' && <AdminEmailLogs />}
                    {emailModal === 'queue' && <AdminEmailQueue />}
                    {emailModal === 'newsletter' && <AdminNewsletter />}
                    {emailModal === 'rules' && <AdminNotificationRules />}
                    {emailModal === 'analytics' && <AdminEmailAnalytics />}
                    {emailModal === 'scheduled' && <AdminEmailScheduled />}
                    {emailModal === 'dailyReportSettings' && (
                      <div role="dialog" aria-modal="true" aria-label="Daily Report Settings" onClick={(e) => e.stopPropagation()} style={{ display: 'grid', gap: 18, maxHeight: '72vh', overflowY: 'auto', paddingRight: 4 }}>
                        <h3 style={{ margin: 0, color: isDarkMode ? '#f8fafc' : '#0f172a' }}>Daily Report Settings</h3>

                        {dailyReportSettingsMessage && (
                          <div role="status" style={{ color: dailyReportSettingsMessage.startsWith('Failed') ? '#b91c1c' : '#166534', fontSize: 13, fontWeight: 600 }}>
                            {dailyReportSettingsMessage}
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
                          <button
                            type="button"
                            onClick={() => {
                              const allSectionKeys = [
                                'websiteOverview',
                                'assetStatistics',
                                'downloads',
                                'salesRevenue',
                                'contributorStatistics',
                                'userActivity',
                                'systemAdmin',
                                'marketing',
                                'general'
                              ];

                              setDailyReportSectionCollapsed((prev) => {
                                const next = { ...prev };
                                allSectionKeys.forEach((key) => {
                                  next[key] = true;
                                });
                                return next;
                              });
                            }}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 999,
                              border: isDarkMode ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(15,23,42,0.1)',
                              background: isDarkMode ? 'rgba(148,163,184,0.08)' : '#f8fafc',
                              color: isDarkMode ? '#f8fafc' : '#0f172a',
                              cursor: 'pointer',
                              fontWeight: 700,
                              fontSize: 11,
                              lineHeight: 1.2
                            }}
                          >
                            Collapse all
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const allSectionKeys = [
                                'websiteOverview',
                                'assetStatistics',
                                'downloads',
                                'salesRevenue',
                                'contributorStatistics',
                                'userActivity',
                                'systemAdmin',
                                'marketing',
                                'general'
                              ];

                              setDailyReportSectionCollapsed((prev) => {
                                const next = { ...prev };
                                allSectionKeys.forEach((key) => {
                                  next[key] = false;
                                });
                                return next;
                              });
                            }}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 999,
                              border: isDarkMode ? '1px solid rgba(96,165,250,0.35)' : '1px solid rgba(37,99,235,0.18)',
                              background: isDarkMode ? 'rgba(37,99,235,0.12)' : '#eff6ff',
                              color: isDarkMode ? '#dbeafe' : '#1d4ed8',
                              cursor: 'pointer',
                              fontWeight: 700,
                              fontSize: 11,
                              lineHeight: 1.2,
                              boxShadow: isDarkMode ? 'inset 0 0 0 1px rgba(96,165,250,0.15)' : 'none'
                            }}
                          >
                            Expand all
                          </button>
                          <button
                            type="button"
                            onClick={() => setDailyReportSettings((prev) => ({
                              ...prev,
                              metrics: Object.fromEntries(ALL_DAILY_REPORT_OPTIONS.map(({ key }) => [key, true]))
                            }))}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 999,
                              border: isDarkMode ? '1px solid rgba(96,165,250,0.35)' : '1px solid rgba(37,99,235,0.18)',
                              background: isDarkMode ? 'rgba(37,99,235,0.12)' : '#eff6ff',
                              color: isDarkMode ? '#dbeafe' : '#1d4ed8',
                              cursor: 'pointer',
                              fontWeight: 700,
                              fontSize: 11,
                              lineHeight: 1.2,
                              boxShadow: isDarkMode ? 'inset 0 0 0 1px rgba(96,165,250,0.15)' : 'none'
                            }}
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            onClick={() => setDailyReportSettings((prev) => ({
                              ...prev,
                              metrics: Object.fromEntries(ALL_DAILY_REPORT_OPTIONS.map(({ key }) => [key, false]))
                            }))}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 999,
                              border: isDarkMode ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(15,23,42,0.1)',
                              background: isDarkMode ? 'rgba(148,163,184,0.08)' : '#f8fafc',
                              color: isDarkMode ? '#f8fafc' : '#0f172a',
                              cursor: 'pointer',
                              fontWeight: 700,
                              fontSize: 11,
                              lineHeight: 1.2
                            }}
                          >
                            None
                          </button>
                        </div>

                        {[
                          { key: 'websiteOverview', title: 'Website Overview', options: WEBSITE_OVERVIEW_OPTIONS },
                          { key: 'assetStatistics', title: 'Asset Statistics', options: ASSET_STATISTICS_OPTIONS },
                          { key: 'downloads', title: 'Downloads', options: DOWNLOADS_OPTIONS },
                          { key: 'salesRevenue', title: 'Sales / Revenue', options: SALES_REVENUE_OPTIONS },
                          { key: 'contributorStatistics', title: 'Contributor Statistics', options: CONTRIBUTOR_STATISTICS_OPTIONS },
                          { key: 'userActivity', title: 'User Activity', options: USER_ACTIVITY_OPTIONS },
                          { key: 'systemAdmin', title: 'System / Admin', options: SYSTEM_ADMIN_OPTIONS },
                          { key: 'marketing', title: 'Marketing', options: MARKETING_OPTIONS }
                        ].map((section) => (
                          <React.Fragment key={section.key}>
                            {renderDailyReportSection(section)}
                          </React.Fragment>
                        ))}

                        <div style={{ display: 'grid', gap: 12 }}>
                          <button
                            type="button"
                            onClick={() => toggleDailyReportSection('general')}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              width: '100%',
                              padding: '12px 14px',
                              borderRadius: 10,
                              border: isDarkMode ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(15,23,42,0.12)',
                              background: isDarkMode ? 'rgba(15, 23, 42, 0.78)' : '#f8fafc',
                              color: isDarkMode ? '#f8fafc' : '#0f172a',
                              cursor: 'pointer',
                              fontWeight: 700,
                              fontSize: 14,
                              textAlign: 'left'
                            }}
                            aria-expanded={!Boolean(dailyReportSectionCollapsed.general)}
                          >
                            <span>General</span>
                            <span style={{ fontSize: 16, lineHeight: 1 }}>{Boolean(dailyReportSectionCollapsed.general) ? '▸' : '▾'}</span>
                          </button>

                          {!Boolean(dailyReportSectionCollapsed.general) && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                              {DAILY_REPORT_METRIC_OPTIONS.map(({ key, label }, index) => (
                                <label key={`${key}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: isDarkMode ? 'rgba(15, 23, 42, 0.8)' : '#f8fafc', border: isDarkMode ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.08)', minHeight: 54 }}>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(dailyReportSettings.metrics?.[key])}
                                    onChange={(e) => setDailyReportSettings((prev) => ({
                                      ...prev,
                                      metrics: {
                                        ...prev.metrics,
                                        [key]: e.target.checked
                                      }
                                    }))}
                                    aria-label={label}
                                    style={{ width: 18, height: 18, accentColor: '#2563eb', flexShrink: 0 }}
                                  />
                                  <span style={{ color: isDarkMode ? '#e2e8f0' : '#0f172a', lineHeight: 1.35, fontSize: 13 }}>{label}</span>
                                </label>
                              ))}
                            </div>
                          )}
                          <div style={{ borderTop: isDarkMode ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.12)', margin: '16px 0 12px' }} />
                        </div>

                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8 }}>
                          <button
                            type="button"
                            onClick={() => setEmailModal(null)}
                            style={{
                              padding: '10px 16px',
                              borderRadius: 10,
                              border: 'none',
                              background: isDarkMode ? 'rgba(148,163,184,0.14)' : '#e2e8f0',
                              color: isDarkMode ? '#f8fafc' : '#0f172a',
                              cursor: 'pointer',
                              fontWeight: 600
                            }}
                          >
                            Close
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              saveDailyReportSettings();
                            }}
                            style={{
                              padding: '10px 16px',
                              borderRadius: 10,
                              border: 'none',
                              background: '#2563eb',
                              color: 'white',
                              cursor: 'pointer',
                              fontWeight: 700
                            }}
                          >
                            Save Settings
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

          {dailyReportSchedulingOpen && (
            <div
              className="admin-panel-modal-overlay"
              onClick={() => setDailyReportSchedulingOpen(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.72)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 1450 }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", maxWidth: 620, padding: 24, background: isDarkMode ? "#111827" : "#ffffff", color: isDarkMode ? "#f8fafc" : "#111827", borderRadius: 20, boxShadow: "0 30px 90px rgba(2,6,23,0.35)" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Schedule Daily Reports</h3>
                    <p style={{ margin: "8px 0 0", color: isDarkMode ? "#cbd5e1" : "#64748b", fontSize: 14 }}>Set up recurring schedules for automated daily report delivery.</p>
                  </div>
                  <button type="button" onClick={() => setDailyReportSchedulingOpen(false)} style={{ border: 0, borderRadius: "50%", width: 34, height: 34, cursor: "pointer", background: isDarkMode ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)", color: isDarkMode ? "#f8fafc" : "#0f172a", fontSize: 20 }}>×</button>
                </div>

                <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>To email</span>
                    <input
                      type="email"
                      value={dailyReportScheduleEmail}
                      onChange={(e) => setDailyReportScheduleEmail(e.target.value)}
                      placeholder="admin@example.com"
                      style={{ padding: "10px 12px", borderRadius: 10, border: isDarkMode ? "1px solid rgba(148,163,184,0.2)" : "1px solid rgba(15,23,42,0.12)", background: isDarkMode ? "#0f172a" : "#ffffff", color: isDarkMode ? "#f8fafc" : "#0f172a", width: "100%", boxSizing: "border-box" }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Schedule Name</span>
                    <input
                      type="text"
                      value={dailyReportScheduleName}
                      onChange={(e) => setDailyReportScheduleName(e.target.value)}
                      placeholder="e.g., Morning Report"
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: isDarkMode ? "1px solid rgba(148,163,184,0.2)" : "1px solid rgba(15,23,42,0.12)",
                        background: isDarkMode ? "#0f172a" : "#ffffff",
                        color: isDarkMode ? "#f8fafc" : "#0f172a",
                        width: "100%",
                        boxSizing: "border-box"
                      }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Time</span>
                    <input
                      type="time"
                      value={dailyReportScheduleTime}
                      onChange={(e) => setDailyReportScheduleTime(e.target.value)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: isDarkMode ? "1px solid rgba(148,163,184,0.2)" : "1px solid rgba(15,23,42,0.12)",
                        background: isDarkMode ? "#0f172a" : "#ffffff",
                        color: isDarkMode ? "#f8fafc" : "#0f172a",
                        width: "100%",
                        boxSizing: "border-box"
                      }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Frequency</span>
                    <select
                      value={dailyReportScheduleFrequency}
                      onChange={(e) => setDailyReportScheduleFrequency(e.target.value)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: isDarkMode ? "1px solid rgba(148,163,184,0.2)" : "1px solid rgba(15,23,42,0.12)",
                        background: isDarkMode ? "#0f172a" : "#ffffff",
                        color: isDarkMode ? "#f8fafc" : "#0f172a",
                        width: "100%",
                        boxSizing: "border-box",
                        cursor: "pointer"
                      }}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </label>
                </div>

                <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setDailyReportScheduleName("");
                      setDailyReportScheduleTime("09:00");
                      setDailyReportScheduleFrequency("daily");
                      setDailyReportScheduleEmail("");
                      setDailyReportScheduleSnapshot(null);
                      setEditingScheduleId(null);
                    }}
                    style={{ flex: 1, padding: "11px 16px", border: 0, borderRadius: 9, cursor: "pointer", background: isDarkMode ? "rgba(255,255,255,0.08)" : "#f8fafc", color: isDarkMode ? "#f8fafc" : "#0f172a", fontWeight: 600 }}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={saveDailyReportSchedule}
                    disabled={dailyReportScheduleSaving}
                    style={{ flex: 1, padding: "11px 16px", border: 0, borderRadius: 9, cursor: dailyReportScheduleSaving ? "not-allowed" : "pointer", background: "#2563eb", color: "#fff", fontWeight: 600, opacity: dailyReportScheduleSaving ? 0.6 : 1 }}
                  >
                    {dailyReportScheduleSaving ? "Saving..." : editingScheduleId ? "Update Schedule" : "Save Schedule"}
                  </button>
                </div>

                {dailyReportScheduleMessage && (
                  <div style={{ padding: "10px 12px", borderRadius: 10, background: dailyReportScheduleMessage.includes("success") ? (isDarkMode ? "rgba(34, 197, 94, 0.16)" : "rgba(34, 197, 94, 0.1)") : (isDarkMode ? "rgba(248, 113, 113, 0.16)" : "rgba(248, 113, 113, 0.1)"), color: dailyReportScheduleMessage.includes("success") ? "#22c55e" : "#ef4444", fontSize: "13px", marginBottom: 16 }}>
                    {dailyReportScheduleMessage}
                  </div>
                )}

                <div style={{ borderTop: isDarkMode ? "1px solid rgba(148,163,184,0.2)" : "1px solid rgba(15,23,42,0.12)", paddingTop: 16 }}>
                  <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Saved Schedules ({dailyReportSchedules.length})</h4>
                  {dailyReportSchedulesLoading ? (
                    <div style={{ textAlign: "center", padding: "16px", color: isDarkMode ? "#cbd5e1" : "#64748b", fontSize: 13 }}>Loading schedules...</div>
                  ) : dailyReportSchedules.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "16px", color: isDarkMode ? "#cbd5e1" : "#64748b", fontSize: 13 }}>No schedules yet. Create your first one above.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {dailyReportSchedules.map((schedule) => (
                        <div key={schedule.id} style={{ padding: 12, borderRadius: 10, background: isDarkMode ? "rgba(30,41,59,0.6)" : "#f8fafc", border: isDarkMode ? "1px solid rgba(148,163,184,0.2)" : "1px solid rgba(15,23,42,0.12)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{schedule.name}</div>
                            <div style={{ fontSize: 12, color: isDarkMode ? "#a8d4f5" : "#0369a1", marginTop: 4 }}>{schedule.time} • {schedule.frequency}</div>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => previewSavedDailyReport(schedule)}
                              style={{ padding: "6px 10px", borderRadius: 6, border: 0, background: "#0f766e", color: "white", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => startEditSchedule(schedule)}
                              style={{ padding: "6px 10px", borderRadius: 6, border: 0, background: "#f59e0b", color: "white", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSchedule(schedule.id)}
                              style={{ padding: "6px 10px", borderRadius: 6, border: 0, background: "#ef4444", color: "white", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ borderTop: isDarkMode ? "1px solid rgba(148,163,184,0.2)" : "1px solid rgba(15,23,42,0.12)", marginTop: 18, paddingTop: 16 }}>
                  <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Saved Schedule Mail Preview</h4>
                  {dailyReportSchedulePreviewLoading ? (
                    <div style={{ padding: 16, textAlign: "center", color: isDarkMode ? "#cbd5e1" : "#64748b", fontSize: 13 }}>Loading preview...</div>
                  ) : dailyReportSchedulePreviewData ? (
                    <div style={{ maxHeight: "42vh", overflowY: "auto", borderRadius: 12, background: "#f8fafc", border: isDarkMode ? "1px solid rgba(148,163,184,0.2)" : "1px solid #e2e8f0" }}>
                      <div dangerouslySetInnerHTML={{ __html: dailyReportSchedulePreviewHtml }} />
                    </div>
                  ) : (
                    <div style={{ padding: 16, color: isDarkMode ? "#cbd5e1" : "#64748b", fontSize: 13 }}>Click Preview on a saved schedule to view the email.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {dailyReportPreviewOpen && !isDailyReportPreviewRouteOpen && (
            <div
              className="admin-panel-modal-overlay"
              onClick={closeDailyReportPreview}
              style={isDailyReportPreviewRouteOpen
                ? { display: 'block', padding: 0 }
                : { position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.78)', backdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1600 }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: '100%',
                  maxWidth: isDailyReportPreviewRouteOpen ? 'none' : 900,
                  maxHeight: isDailyReportPreviewRouteOpen ? 'none' : '88vh',
                  overflow: isDailyReportPreviewRouteOpen ? 'visible' : 'hidden',
                  background: isDarkMode ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' : 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                  border: isDarkMode ? '1px solid rgba(100,200,255,0.15)' : '1px solid rgba(37,99,235,0.12)',
                  borderRadius: 28,
                  boxShadow: isDarkMode ? '0 40px 100px rgba(2,6,23,0.7), inset 0 1px 0 rgba(148,200,255,0.1)' : '0 32px 80px rgba(15,23,42,0.2), inset 0 1px 0 rgba(100,200,255,0.2)',
                  color: isDarkMode ? '#f8fafc' : '#0f172a'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '20px 28px', borderBottom: isDarkMode ? '1px solid rgba(100,163,255,0.1)' : '1px solid rgba(37,99,235,0.1)', background: isDarkMode ? 'linear-gradient(90deg, rgba(37,99,235,0.12), rgba(59,130,246,0.08))' : 'linear-gradient(90deg, rgba(37,99,235,0.08), rgba(147,197,253,0.05))' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: isDarkMode ? '#64b8ff' : '#2563eb', marginBottom: 4 }}>📊 Daily Report Summary</div>
                    <h3 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Website Analytics Preview</h3>
                  </div>
                  <button type="button" onClick={() => setDailyReportPreviewOpen(false)} style={{ background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)', border: isDarkMode ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(15,23,42,0.12)', borderRadius: '50%', color: isDarkMode ? '#f8fafc' : '#0f172a', fontSize: 18, cursor: 'pointer', padding: '10px 10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }}>✕</button>
                </div>
                <div style={{ padding: '24px 28px', maxHeight: '72vh', overflowY: 'auto' }}>
                  {dailyReportPreviewLoading ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: isDarkMode ? '#a8d4f5' : '#0369a1' }}>
                      <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>Loading real-time data...</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>Fetching your website metrics</div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'grid', gap: 18 }}>
                        {getDailyReportPreviewGroups().map((group) => (
                          <section key={group.key} style={{ display: 'grid', gap: 10 }}>
                            <h4 style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: isDarkMode ? 'rgba(30,41,59,0.82)' : '#eef4ff', color: isDarkMode ? '#dbeafe' : '#1e3a8a', fontSize: 14, fontWeight: 800 }}>{group.label}</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 200px)', gap: 10 }}>
                        {group.rows.map((row) => {
                          return (
                            <div key={row.key} style={{ width: 200, minHeight: 200, boxSizing: 'border-box', padding: '12px 10px 10px', borderRadius: 14, background: isDarkMode ? 'linear-gradient(135deg, rgba(37,99,235,0.16), rgba(14,165,233,0.08))' : 'linear-gradient(135deg, rgba(37,99,235,0.08), rgba(14,165,233,0.04))', border: isDarkMode ? '1.5px solid rgba(96,165,250,0.3)' : '1.5px solid rgba(37,99,235,0.18)', boxShadow: isDarkMode ? '0 10px 18px rgba(2,6,23,0.22)' : '0 4px 12px rgba(15,23,42,0.08)', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: isDarkMode ? '#93c5fd' : '#2563eb', marginBottom: 2 }}>{row.label}</div>
                              {row.key === 'paymentFailedCount' && (DAILY_REPORT_PREVIEW_VALUES.paymentFailedCurrencyBreakdown || []).length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 18, fontWeight: 800, color: isDarkMode ? '#e0f2fe' : '#1d4ed8', lineHeight: 1.3 }}>{DAILY_REPORT_PREVIEW_VALUES.paymentFailedCurrencyBreakdown.map((item) => <span key={item.currency}>{formatPaymentFailedCurrencyTotal(item)}</span>)}</div>}
                              {row.key === 'totalRevenueInr' && (DAILY_REPORT_PREVIEW_VALUES.revenueCurrencyBreakdown || []).length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 18, fontWeight: 800, color: isDarkMode ? '#e0f2fe' : '#1d4ed8', lineHeight: 1.3 }}>{DAILY_REPORT_PREVIEW_VALUES.revenueCurrencyBreakdown.map((item) => <span key={item.currency || item.name}>{formatRevenueCurrencyTotal(item)}</span>)}</div>}
                              {row.key === 'totalDiscountInr' && (DAILY_REPORT_PREVIEW_VALUES.discountCurrencyBreakdown || []).length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 18, fontWeight: 800, color: isDarkMode ? '#e0f2fe' : '#1d4ed8', lineHeight: 1.3 }}>{DAILY_REPORT_PREVIEW_VALUES.discountCurrencyBreakdown.map((item) => <span key={item.currency}>{formatRevenueCurrencyTotal(item)}</span>)}</div>}
                              {row.key === 'totalEarningsInr' && (DAILY_REPORT_PREVIEW_VALUES.earningsCurrencyBreakdown || []).length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 18, fontWeight: 800, color: isDarkMode ? '#e0f2fe' : '#1d4ed8', lineHeight: 1.3 }}>{DAILY_REPORT_PREVIEW_VALUES.earningsCurrencyBreakdown.map((item) => <span key={item.currency}>{formatRevenueCurrencyTotal(item)}</span>)}</div>}
                              {row.key.match(/^(revenue|discount|earnings)(Last7Days|Last30Days|CurrentMonth|CurrentFy|Last365Days)$/) && (DAILY_REPORT_PREVIEW_VALUES[row.key] || []).length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 18, fontWeight: 800, color: isDarkMode ? '#e0f2fe' : '#1d4ed8', lineHeight: 1.3 }}>{DAILY_REPORT_PREVIEW_VALUES[row.key].map((item) => <span key={item.currency}>{formatRevenueCurrencyTotal(item)}</span>)}</div>}
                              {row.key !== 'paymentFailedCount' && row.key !== 'totalRevenueInr' && row.key !== 'totalDiscountInr' && row.key !== 'totalEarningsInr' && !row.key.match(/^(revenue|discount|earnings)(Last7Days|Last30Days|CurrentMonth|CurrentFy|Last365Days)$/) && <div style={{ fontSize: 26, fontWeight: 800, color: isDarkMode ? '#e0f2fe' : '#1d4ed8', lineHeight: 1.15, wordBreak: 'break-word' }}>{DAILY_REPORT_PREVIEW_VALUES[row.key] || '—'}</div>}
                              {renderDailyReportBreakdowns(row.key)}
                              {false && <>
                              {row.key === 'liveAssets' && ((Array.isArray(DAILY_REPORT_PREVIEW_VALUES.collectionLiveAssets) && DAILY_REPORT_PREVIEW_VALUES.collectionLiveAssets.length > 0) || (Array.isArray(DAILY_REPORT_PREVIEW_VALUES.categoryLiveAssets) && DAILY_REPORT_PREVIEW_VALUES.categoryLiveAssets.length > 0) || (Array.isArray(DAILY_REPORT_PREVIEW_VALUES.typeLiveAssets) && DAILY_REPORT_PREVIEW_VALUES.typeLiveAssets.length > 0)) && (
                                <div style={{ margin: 10, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5, maxHeight: 110, overflowY: 'auto', paddingRight: 4 }}>
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.collectionLiveAssets) && DAILY_REPORT_PREVIEW_VALUES.collectionLiveAssets.length > 0 && (
                                    <>
                                      <div style={{ fontWeight: 700, marginBottom: 2 }}>Collections:</div>
                                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                                        {DAILY_REPORT_PREVIEW_VALUES.collectionLiveAssets.map((collection) => (
                                          <li key={collection.name}>{collection.name}: {Number(collection.count || 0).toLocaleString('en-US')}</li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.categoryLiveAssets) && DAILY_REPORT_PREVIEW_VALUES.categoryLiveAssets.length > 0 && (
                                    <>
                                      <div style={{ fontWeight: 700, marginTop: 8, marginBottom: 2 }}>Categories:</div>
                                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                                        {DAILY_REPORT_PREVIEW_VALUES.categoryLiveAssets.map((category) => (
                                          <li key={category.name}>{category.name}: {Number(category.count || 0).toLocaleString('en-US')}</li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.typeLiveAssets) && DAILY_REPORT_PREVIEW_VALUES.typeLiveAssets.length > 0 && (
                                    <>
                                      <div style={{ fontWeight: 700, marginTop: 8, marginBottom: 2 }}>Type:</div>
                                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                                        {DAILY_REPORT_PREVIEW_VALUES.typeLiveAssets.map((type) => (
                                          <li key={type.name}>{type.name}: {Number(type.count || 0).toLocaleString('en-US')}</li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                </div>
                              )}
                              {row.key === 'pendingAssets' && Array.isArray(DAILY_REPORT_PREVIEW_VALUES.collectionPendingAssets) && DAILY_REPORT_PREVIEW_VALUES.collectionPendingAssets.length > 0 && (
                                <div style={{ margin: 10, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5, maxHeight: 110, overflowY: 'auto', paddingRight: 4 }}>
                                  <div style={{ fontWeight: 700, marginBottom: 2 }}>Collections:</div>
                                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                                  {DAILY_REPORT_PREVIEW_VALUES.collectionPendingAssets.map((collection) => (
                                    <li key={collection.name}>{collection.name}: {Number(collection.count || 0).toLocaleString('en-US')}</li>
                                  ))}
                                  </ul>
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.categoryPendingAssets) && DAILY_REPORT_PREVIEW_VALUES.categoryPendingAssets.length > 0 && (
                                    <>
                                      <div style={{ fontWeight: 700, marginTop: 8, marginBottom: 2 }}>Categories:</div>
                                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                                        {DAILY_REPORT_PREVIEW_VALUES.categoryPendingAssets.map((category) => (
                                          <li key={category.name}>{category.name}: {Number(category.count || 0).toLocaleString('en-US')}</li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.typePendingAssets) && DAILY_REPORT_PREVIEW_VALUES.typePendingAssets.length > 0 && (
                                    <>
                                      <div style={{ fontWeight: 700, marginTop: 8, marginBottom: 2 }}>Type:</div>
                                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                                        {DAILY_REPORT_PREVIEW_VALUES.typePendingAssets.map((type) => (
                                          <li key={type.name}>{type.name}: {Number(type.count || 0).toLocaleString('en-US')}</li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                </div>
                              )}
                              {row.key === 'rejectedAssets' && Array.isArray(DAILY_REPORT_PREVIEW_VALUES.collectionRejectedAssets) && DAILY_REPORT_PREVIEW_VALUES.collectionRejectedAssets.length > 0 && (
                                <div style={{ margin: 10, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5, maxHeight: 110, overflowY: 'auto', paddingRight: 4 }}>
                                  <div style={{ fontWeight: 700, marginBottom: 2 }}>Collections:</div>
                                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                                  {DAILY_REPORT_PREVIEW_VALUES.collectionRejectedAssets.map((collection) => (
                                    <li key={collection.name}>{collection.name}: {Number(collection.count || 0).toLocaleString('en-US')}</li>
                                  ))}
                                  </ul>
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.categoryRejectedAssets) && DAILY_REPORT_PREVIEW_VALUES.categoryRejectedAssets.length > 0 && (
                                    <>
                                      <div style={{ fontWeight: 700, marginTop: 8, marginBottom: 2 }}>Categories:</div>
                                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                                        {DAILY_REPORT_PREVIEW_VALUES.categoryRejectedAssets.map((category) => (
                                          <li key={category.name}>{category.name}: {Number(category.count || 0).toLocaleString('en-US')}</li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.typeRejectedAssets) && DAILY_REPORT_PREVIEW_VALUES.typeRejectedAssets.length > 0 && (
                                    <>
                                      <div style={{ fontWeight: 700, marginTop: 8, marginBottom: 2 }}>Type:</div>
                                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                                        {DAILY_REPORT_PREVIEW_VALUES.typeRejectedAssets.map((type) => (
                                          <li key={type.name}>{type.name}: {Number(type.count || 0).toLocaleString('en-US')}</li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                </div>
                              )}
                              {row.key === 'deletedAssetsLast30Days' && Array.isArray(DAILY_REPORT_PREVIEW_VALUES.collectionDeletedAssetsLast30Days) && DAILY_REPORT_PREVIEW_VALUES.collectionDeletedAssetsLast30Days.length > 0 && (
                                <div style={{ margin: 10, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5, maxHeight: 110, overflowY: 'auto', paddingRight: 4 }}>
                                  <div style={{ fontWeight: 700, marginBottom: 2 }}>Collections:</div>
                                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                                  {DAILY_REPORT_PREVIEW_VALUES.collectionDeletedAssetsLast30Days.map((collection) => (
                                    <li key={collection.name}>{collection.name}: {Number(collection.count || 0).toLocaleString('en-US')}</li>
                                  ))}
                                  </ul>
                                  {DAILY_REPORT_PREVIEW_VALUES.categoryDeletedAssetsLast30Days.length > 0 && (
                                    <>
                                      <div style={{ fontWeight: 700, marginTop: 8, marginBottom: 2 }}>Categories:</div>
                                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                                        {DAILY_REPORT_PREVIEW_VALUES.categoryDeletedAssetsLast30Days.map((category) => (
                                          <li key={category.name}>{category.name}: {Number(category.count || 0).toLocaleString('en-US')}</li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                  {DAILY_REPORT_PREVIEW_VALUES.typeDeletedAssetsLast30Days.length > 0 && (
                                    <>
                                      <div style={{ fontWeight: 700, marginTop: 8, marginBottom: 2 }}>Type:</div>
                                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                                        {DAILY_REPORT_PREVIEW_VALUES.typeDeletedAssetsLast30Days.map((type) => (
                                          <li key={type.name}>{type.name}: {Number(type.count || 0).toLocaleString('en-US')}</li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                </div>
                              )}
                              {row.key === 'totalUsers' && (
                                <div style={{ margin: 10, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5 }}>
                                  <div style={{ fontWeight: 700 }}>Users:</div>
                                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                                    <li>Customers: {DAILY_REPORT_PREVIEW_VALUES.totalCustomers || '0'}</li>
                                    <li>Admins: {DAILY_REPORT_PREVIEW_VALUES.totalAdmins || '0'}</li>
                                    <li>Contributors: {DAILY_REPORT_PREVIEW_VALUES.totalContributors || '0'}</li>
                                    <li>Pending Users: {DAILY_REPORT_PREVIEW_VALUES.pendingUsers || '0'}</li>
                                    <li>Blocked Users: {DAILY_REPORT_PREVIEW_VALUES.blockedUsers || '0'}</li>
                                  </ul>
                                </div>
                              )}
                              {row.key === 'totalAssets' && (
                                <div style={{ margin: 10, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5 }}>
                                  <div style={{ fontWeight: 700 }}>Assets:</div>
                                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                                    <li>Live Assets: {DAILY_REPORT_PREVIEW_VALUES.liveAssets || '0'}</li>
                                    <li>Pending Assets: {DAILY_REPORT_PREVIEW_VALUES.pendingAssets || '0'}</li>
                                    <li>Rejected Assets: {DAILY_REPORT_PREVIEW_VALUES.rejectedAssets || '0'}</li>
                                    <li>Deleted Assets (Last 30 Days): {DAILY_REPORT_PREVIEW_VALUES.deletedAssetsLast30Days || '0'}</li>
                                  </ul>
                                </div>
                              )}
                              {row.key === 'last24HoursDownloads' && ((Array.isArray(DAILY_REPORT_PREVIEW_VALUES.collectionLast24HoursDownloads) && DAILY_REPORT_PREVIEW_VALUES.collectionLast24HoursDownloads.length > 0) || (Array.isArray(DAILY_REPORT_PREVIEW_VALUES.categoryLast24HoursDownloads) && DAILY_REPORT_PREVIEW_VALUES.categoryLast24HoursDownloads.length > 0) || (Array.isArray(DAILY_REPORT_PREVIEW_VALUES.typeLast24HoursDownloads) && DAILY_REPORT_PREVIEW_VALUES.typeLast24HoursDownloads.length > 0)) && (
                                <div style={{ margin: 10, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5 }}>
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.collectionLast24HoursDownloads) && DAILY_REPORT_PREVIEW_VALUES.collectionLast24HoursDownloads.length > 0 && <><div style={{ fontWeight: 700 }}>Collections:</div><ul style={{ margin: 0, paddingLeft: 18 }}>{DAILY_REPORT_PREVIEW_VALUES.collectionLast24HoursDownloads.map((item) => <li key={item.name}>{item.name}: {Number(item.count || 0).toLocaleString('en-US')}</li>)}</ul></>}
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.categoryLast24HoursDownloads) && DAILY_REPORT_PREVIEW_VALUES.categoryLast24HoursDownloads.length > 0 && <><div style={{ fontWeight: 700, marginTop: 8 }}>Categories:</div><ul style={{ margin: 0, paddingLeft: 18 }}>{DAILY_REPORT_PREVIEW_VALUES.categoryLast24HoursDownloads.map((item) => <li key={item.name}>{item.name}: {Number(item.count || 0).toLocaleString('en-US')}</li>)}</ul></>}
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.typeLast24HoursDownloads) && DAILY_REPORT_PREVIEW_VALUES.typeLast24HoursDownloads.length > 0 && <><div style={{ fontWeight: 700, marginTop: 8 }}>Type:</div><ul style={{ margin: 0, paddingLeft: 18 }}>{DAILY_REPORT_PREVIEW_VALUES.typeLast24HoursDownloads.map((item) => <li key={item.name}>{item.name}: {Number(item.count || 0).toLocaleString('en-US')}</li>)}</ul></>}
                                </div>
                              )}
                              {row.key === 'totalDownloads' && ((Array.isArray(DAILY_REPORT_PREVIEW_VALUES.collectionTotalDownloads) && DAILY_REPORT_PREVIEW_VALUES.collectionTotalDownloads.length > 0) || (Array.isArray(DAILY_REPORT_PREVIEW_VALUES.categoryTotalDownloads) && DAILY_REPORT_PREVIEW_VALUES.categoryTotalDownloads.length > 0) || (Array.isArray(DAILY_REPORT_PREVIEW_VALUES.typeTotalDownloads) && DAILY_REPORT_PREVIEW_VALUES.typeTotalDownloads.length > 0)) && (
                                <div style={{ margin: 10, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5 }}>
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.collectionTotalDownloads) && DAILY_REPORT_PREVIEW_VALUES.collectionTotalDownloads.length > 0 && <><div style={{ fontWeight: 700 }}>Collections:</div><ul style={{ margin: 0, paddingLeft: 18 }}>{DAILY_REPORT_PREVIEW_VALUES.collectionTotalDownloads.map((item) => <li key={item.name}>{item.name}: {Number(item.count || 0).toLocaleString('en-US')}</li>)}</ul></>}
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.categoryTotalDownloads) && DAILY_REPORT_PREVIEW_VALUES.categoryTotalDownloads.length > 0 && <><div style={{ fontWeight: 700, marginTop: 8 }}>Categories:</div><ul style={{ margin: 0, paddingLeft: 18 }}>{DAILY_REPORT_PREVIEW_VALUES.categoryTotalDownloads.map((item) => <li key={item.name}>{item.name}: {Number(item.count || 0).toLocaleString('en-US')}</li>)}</ul></>}
                                  {Array.isArray(DAILY_REPORT_PREVIEW_VALUES.typeTotalDownloads) && DAILY_REPORT_PREVIEW_VALUES.typeTotalDownloads.length > 0 && <><div style={{ fontWeight: 700, marginTop: 8 }}>Type:</div><ul style={{ margin: 0, paddingLeft: 18 }}>{DAILY_REPORT_PREVIEW_VALUES.typeTotalDownloads.map((item) => <li key={item.name}>{item.name}: {Number(item.count || 0).toLocaleString('en-US')}</li>)}</ul></>}
                                </div>
                              )}
                              {row.key === 'totalContributors' && (
                                <div style={{ margin: 10, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5 }}>
                                  <div style={{ fontWeight: 700 }}>Contributor Status:</div>
                                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                                    <li>Active: {DAILY_REPORT_PREVIEW_VALUES.activeContributors || '0'}</li>
                                    <li>Inactive: {DAILY_REPORT_PREVIEW_VALUES.inactiveContributors || '0'}</li>
                                    <li>Pending: {DAILY_REPORT_PREVIEW_VALUES.pendingContributors || '0'}</li>
                                    <li>Blocked: {DAILY_REPORT_PREVIEW_VALUES.blockedContributors || '0'}</li>
                                    <li>Deleted (Last 30 Days): {DAILY_REPORT_PREVIEW_VALUES.deletedContributorsLast30Days || '0'}</li>
                                  </ul>
                                </div>
                              )}
                              {row.key === 'totalCustomers' && (
                                <div style={{ margin: 10, color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: 12, lineHeight: 1.5 }}>
                                  <div style={{ fontWeight: 700 }}>Customer Status:</div>
                                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                                    <li>Active: {DAILY_REPORT_PREVIEW_VALUES.activeCustomers || '0'}</li>
                                    <li>Inactive: {DAILY_REPORT_PREVIEW_VALUES.inactiveCustomers || '0'}</li>
                                    <li>Pending: {DAILY_REPORT_PREVIEW_VALUES.pendingCustomers || '0'}</li>
                                    <li>Blocked: {DAILY_REPORT_PREVIEW_VALUES.blockedCustomers || '0'}</li>
                                    <li>Deleted (Last 30 Days): {DAILY_REPORT_PREVIEW_VALUES.deletedCustomersLast30Days || '0'}</li>
                                  </ul>
                                </div>
                              )}
                              </>}
                            </div>
                          );
                        })}
                            </div>
                          </section>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {dailyReportSmtpFormOpen && (
                  <div style={{ margin: '0 28px 16px', padding: 16, borderRadius: 14, background: isDarkMode ? 'rgba(15,23,42,0.72)' : '#f8fafc', border: isDarkMode ? '1px solid rgba(148,163,184,0.2)' : '1px solid #e2e8f0' }}>
                    <h4 style={{ margin: '0 0 12px', fontSize: 15 }}>Daily Report SMTP Settings</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                      {[
                        ['sender_name', 'Sender name', 'text'],
                        ['sender_email', 'Sender email', 'email'],
                        ['smtp_host', 'SMTP host', 'text'],
                        ['smtp_port', 'SMTP port', 'number'],
                        ['smtp_user', 'SMTP username', 'text'],
                        ['smtp_pass', 'SMTP password', 'password']
                      ].map(([key, label, type]) => (
                        <label key={key} style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 600 }}>
                          {label}
                          <input
                            type={type}
                            value={dailyReportSmtpDraft[key] || ''}
                            onChange={(event) => setDailyReportSmtpDraft((previous) => ({ ...previous, [key]: event.target.value }))}
                            style={{ padding: '9px 10px', borderRadius: 8, border: isDarkMode ? '1px solid rgba(148,163,184,0.25)' : '1px solid #cbd5e1', background: isDarkMode ? '#0f172a' : '#fff', color: isDarkMode ? '#f8fafc' : '#0f172a' }}
                          />
                        </label>
                      ))}
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(dailyReportSmtpDraft.smtp_secure)}
                          onChange={(event) => setDailyReportSmtpDraft((previous) => ({ ...previous, smtp_secure: event.target.checked }))}
                        />
                        Use secure SMTP connection
                      </label>
                    </div>
                    {dailyReportSmtpMessage && <div role="status" style={{ marginTop: 10, color: dailyReportSmtpMessage.includes('successfully') || dailyReportSmtpMessage.includes('saved') ? '#16a34a' : '#b91c1c', fontSize: 12, fontWeight: 600 }}>{dailyReportSmtpMessage}</div>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                      <button type="button" onClick={verifyDailyReportSmtpSettings} disabled={dailyReportSmtpSaving} style={{ padding: '9px 12px', borderRadius: 8, border: 0, background: '#7c3aed', color: '#fff', cursor: dailyReportSmtpSaving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Verify SMTP Settings</button>
                      <button type="button" onClick={saveDailyReportSmtpSettings} disabled={dailyReportSmtpSaving} style={{ padding: '9px 12px', borderRadius: 8, border: 0, background: '#2563eb', color: '#fff', cursor: dailyReportSmtpSaving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Save SMTP for Daily Reports</button>
                      <button type="button" onClick={() => { setDailyReportTestMailRecipient(''); setDailyReportTestMailOpen(true); }} disabled={dailyReportSmtpSaving} style={{ padding: '9px 12px', borderRadius: 8, border: 0, background: '#0f766e', color: '#fff', cursor: dailyReportSmtpSaving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Send Test Mail</button>
                      <button type="button" onClick={async () => { await saveDailyReportSmtpSettings(); setDailyReportSmtpFormOpen(false); setDailyReportPreviewOpen(false); setDailyReportSchedulingOpen(true); }} disabled={dailyReportSmtpSaving} style={{ padding: '9px 12px', borderRadius: 8, border: 0, background: '#7c3aed', color: '#fff', cursor: dailyReportSmtpSaving ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Schedule Daily Report</button>
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '16px 28px', borderTop: isDarkMode ? '1px solid rgba(100,163,255,0.1)' : '1px solid rgba(37,99,235,0.1)', background: isDarkMode ? 'rgba(15,23,42,0.4)' : 'rgba(248,250,252,0.6)' }}>
                  <button type="button" onClick={openDailyReportSmtpForm} style={{ padding: '12px 18px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s ease' }}>Report SMTP Settings</button>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button type="button" onClick={() => { setDailyReportPreviewOpen(false); setDailyReportSchedulingOpen(true); }} style={{ padding: '12px 18px', borderRadius: 10, border: 'none', background: '#0f766e', color: '#fff', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s ease' }}>Schedule new Daily Report</button>
                    <button type="button" onClick={() => setDailyReportPreviewOpen(false)} style={{ padding: '12px 24px', borderRadius: 10, border: 'none', background: isDarkMode ? 'rgba(148,163,184,0.14)' : '#e2e8f0', color: isDarkMode ? '#f8fafc' : '#0f172a', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s ease' }}>Close</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {otpSettingsModal && (
            <div
              className="admin-panel-modal-overlay"
              onClick={() => setOtpSettingsModal(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1400 }}
            >
              <div
                className="admin-panel-modal-panel"
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: '100%',
                  maxWidth: 760,
                  background: isDarkMode ? 'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.97))' : 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.97))',
                  border: isDarkMode ? '1px solid rgba(148,163,184,0.24)' : '1px solid rgba(15,23,42,0.08)',
                  borderRadius: 24,
                  overflow: 'hidden',
                  boxShadow: isDarkMode ? '0 30px 90px rgba(2,6,23,0.55)' : '0 24px 70px rgba(15,23,42,0.16)'
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '18px 22px',
                  background: isDarkMode ? 'linear-gradient(90deg, rgba(37,99,235,0.16), rgba(14,165,233,0.08))' : 'linear-gradient(90deg, rgba(37,99,235,0.08), rgba(14,165,233,0.05))',
                  borderBottom: isDarkMode ? '1px solid rgba(148,163,184,0.16)' : '1px solid rgba(15,23,42,0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 0 6px rgba(56,189,248,0.16)' }} />
                    <h3 style={{ margin: 0, color: isDarkMode ? '#f8fafc' : '#0f172a', fontSize: 18 }}>{OTP_SETTINGS_MODAL_TITLES[otpSettingsModal] || 'OTP Settings'}</h3>
                  </div>
                  <button onClick={() => setOtpSettingsModal(null)} style={{ background: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', border: isDarkMode ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.08)', borderRadius: '999px', color: isDarkMode ? '#f8fafc' : '#0f172a', fontSize: 16, cursor: 'pointer', padding: '8px 11px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
                <div style={{ padding: 18, maxHeight: '88vh', overflow: 'auto', background: isDarkMode ? 'linear-gradient(180deg, rgba(2,6,23,0.88), rgba(15,23,42,0.92))' : 'linear-gradient(180deg, rgba(248,250,252,0.96), rgba(255,255,255,0.98))' }}>
                  <div style={{ display: 'grid', gap: 14 }}>
                    {(otpSettingsModal === 'general' || otpSettingsModal === 'login' || otpSettingsModal === 'registration' || otpSettingsModal === 'recovery') && (
                      <>
                        {otpSettingsModal === 'general' && (
                          <>
                            <label style={{ display: 'grid', gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>OTP sent to default user</span>
                              <input type="email" value={otpSettings.default_recipient} onChange={(e) => setOtpSettings((prev) => ({ ...prev, default_recipient: e.target.value }))} placeholder="admin@company.com" style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ccc' }} />
                            </label>
                            <label style={{ display: 'grid', gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>BCC recipient(s)</span>
                              <input type="text" value={otpSettings.bcc_recipients} onChange={(e) => setOtpSettings((prev) => ({ ...prev, bcc_recipients: e.target.value }))} placeholder="admin@example.com, ops@example.com" style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ccc' }} />
                            </label>
                            <label style={{ display: 'grid', gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>OTP valid timings (minutes)</span>
                              <input type="number" min="1" value={otpSettings.valid_minutes} onChange={(e) => setOtpSettings((prev) => ({ ...prev, valid_minutes: Number(e.target.value) || 1 }))} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ccc' }} />
                            </label>
                          </>
                        )}

                        {otpSettingsModal === 'login' && (
                          <>
                            <label style={{ display: 'grid', gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>Login OTP subject</span>
                              <input type="text" value={otpSettings.login_subject} onChange={(e) => setOtpSettings((prev) => ({ ...prev, login_subject: e.target.value }))} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ccc' }} />
                            </label>
                            <label style={{ display: 'grid', gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>Login OTP body</span>
                              <textarea value={otpSettings.login_body} onChange={(e) => setOtpSettings((prev) => ({ ...prev, login_body: e.target.value }))} rows={5} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ccc', resize: 'vertical' }} />
                            </label>
                          </>
                        )}

                        {otpSettingsModal === 'registration' && (
                          <>
                            <label style={{ display: 'grid', gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>Registration OTP subject</span>
                              <input type="text" value={otpSettings.registration_subject} onChange={(e) => setOtpSettings((prev) => ({ ...prev, registration_subject: e.target.value }))} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ccc' }} />
                            </label>
                            <label style={{ display: 'grid', gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>Registration OTP body</span>
                              <textarea value={otpSettings.registration_body} onChange={(e) => setOtpSettings((prev) => ({ ...prev, registration_body: e.target.value }))} rows={5} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ccc', resize: 'vertical' }} />
                            </label>
                          </>
                        )}

                        {otpSettingsModal === 'recovery' && (
                          <>
                            <label style={{ display: 'grid', gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>Forgot Password OTP subject</span>
                              <input type="text" value={otpSettings.recovery_subject} onChange={(e) => setOtpSettings((prev) => ({ ...prev, recovery_subject: e.target.value }))} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ccc' }} />
                            </label>
                            <label style={{ display: 'grid', gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>Forgot Password OTP body</span>
                              <textarea value={otpSettings.recovery_body} onChange={(e) => setOtpSettings((prev) => ({ ...prev, recovery_body: e.target.value }))} rows={5} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ccc', resize: 'vertical' }} />
                            </label>
                          </>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                          <button type="button" onClick={saveOtpSettings} disabled={otpSettingsSaving} style={{ background: '#43a047', color: 'white', border: 'none', padding: '10px 18px', borderRadius: 8, cursor: otpSettingsSaving ? 'not-allowed' : 'pointer', opacity: otpSettingsSaving ? 0.7 : 1 }}>
                            {otpSettingsSaving ? 'Saving...' : 'Save OTP Settings'}
                          </button>
                          {otpSettingsMessage ? <span style={{ color: otpSettingsMessage.toLowerCase().includes('failed') ? '#d32f2f' : '#2e7d32' }}>{otpSettingsMessage}</span> : null}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {taxModalOpen && (
            <div className="admin-panel-modal-overlay" onClick={() => setTaxModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1300 }}>
              <div className="admin-panel-modal-panel" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 640, background: isDarkMode ? 'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.97))' : 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.97))', border: isDarkMode ? '1px solid rgba(148,163,184,0.24)' : '1px solid rgba(15,23,42,0.08)', borderRadius: 24, overflow: 'hidden', boxShadow: isDarkMode ? '0 30px 90px rgba(2,6,23,0.55)' : '0 24px 70px rgba(15,23,42,0.16)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', background: isDarkMode ? 'linear-gradient(90deg, rgba(37,99,235,0.16), rgba(14,165,233,0.08))' : 'linear-gradient(90deg, rgba(37,99,235,0.08), rgba(14,165,233,0.05))', borderBottom: isDarkMode ? '1px solid rgba(148,163,184,0.16)' : '1px solid rgba(15,23,42,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 0 6px rgba(56,189,248,0.16)' }} />
                    <h3 style={{ margin: 0, color: isDarkMode ? '#f8fafc' : '#0f172a', fontSize: 18 }}>Tax Settings</h3>
                  </div>
                  <button onClick={() => setTaxModalOpen(false)} style={{ background: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', border: isDarkMode ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.08)', borderRadius: '999px', color: isDarkMode ? '#f8fafc' : '#0f172a', fontSize: 16, cursor: 'pointer', padding: '8px 11px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
                <div style={{ padding: 18, maxHeight: '88vh', overflow: 'auto', background: isDarkMode ? 'linear-gradient(180deg, rgba(2,6,23,0.88), rgba(15,23,42,0.92))' : 'linear-gradient(180deg, rgba(248,250,252,0.96), rgba(255,255,255,0.98))' }}>
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'grid', gap: 12 }}>
                    {taxSettings.map((tax, idx) => (
                      <div key={tax.id || idx} style={{ display: 'grid', gap: 10, padding: 12, borderRadius: 10, background: isDarkMode ? 'rgba(15,23,42,0.8)' : '#f1f5f9', border: isDarkMode ? '1px solid rgba(148,163,184,0.16)' : '1px solid #e2e8f0' }}>
                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <span>Enable</span>
                          <input type="checkbox" checked={tax.enabled} onChange={(e) => setTaxSettings((prev) => prev.map((t, i) => i === idx ? { ...t, enabled: e.target.checked } : t))} />
                        </label>
                        <label style={{ display: 'grid', gap: 6 }}>
                          <span>Tax label</span>
                          <input type="text" value={tax.label} onChange={(e) => setTaxSettings((prev) => prev.map((t, i) => i === idx ? { ...t, label: e.target.value } : t))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} />
                        </label>
                        <label style={{ display: 'grid', gap: 6 }}>
                          <span>Type</span>
                          <select value={tax.type || 'percentage'} onChange={(e) => {
                            const nextType = e.target.value;
                            setTaxSettings((prev) => prev.map((t, i) => i === idx ? {
                              ...t,
                              type: nextType,
                              rate: nextType === 'percentage' ? Number(t.rate ?? t.amount ?? 0) : 0,
                              amount: nextType === 'fixed' ? Number(t.amount ?? t.rate ?? 0) : 0,
                            } : t));
                          }} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }}>
                            <option value="percentage">Percentage</option>
                            <option value="fixed">Fixed amount</option>
                          </select>
                        </label>
                        <label style={{ display: 'grid', gap: 6 }}>
                          <span>{(tax.type || 'percentage') === 'fixed' ? 'Fixed amount' : 'Tax rate (%)'}</span>
                          <input type="number" step="0.01" min="0" max="100" value={(tax.type || 'percentage') === 'fixed' ? (tax.amount ?? tax.rate ?? 0) : (tax.rate ?? 0)} onChange={(e) => {
                            const numericValue = Number(e.target.value) || 0;
                            setTaxSettings((prev) => prev.map((t, i) => i === idx ? {
                              ...t,
                              ...(t.type === 'fixed' ? { amount: numericValue, rate: 0 } : { rate: numericValue, amount: 0 }),
                            } : t));
                          }} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} placeholder={((tax.type || 'percentage') === 'fixed') ? 'e.g., 5, 10' : 'e.g., 5, 10, 18'} />
                        </label>
                        {taxSettings.length > 1 && (
                          <button type="button" onClick={() => setTaxSettings((prev) => prev.filter((_, i) => i !== idx))} style={{ background: '#dc2626', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: 14 }}>Remove tax</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setTaxSettings((prev) => [...prev, { enabled: true, type: 'percentage', rate: 0, amount: 0, label: `Tax ${prev.length + 1}`, id: Date.now() }])} style={{ background: '#16a34a', color: 'white', border: 'none', padding: '10px 14px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700 }}>Add another tax</button>
                  <button type="button" onClick={async () => { await savePricingSettings(); setTaxModalOpen(false); }} style={{ background: '#1976d2', color: 'white', border: 'none', padding: '10px 14px', borderRadius: '10px', cursor: 'pointer' }}>Save Tax Settings</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {invoiceModalOpen && (
            <div className="admin-panel-modal-overlay" onClick={() => setInvoiceModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1300 }}>
              <div className="admin-panel-modal-panel" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 760, background: isDarkMode ? 'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.97))' : 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.97))', border: isDarkMode ? '1px solid rgba(148,163,184,0.24)' : '1px solid rgba(15,23,42,0.08)', borderRadius: 24, overflow: 'hidden', boxShadow: isDarkMode ? '0 30px 90px rgba(2,6,23,0.55)' : '0 24px 70px rgba(15,23,42,0.16)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', background: isDarkMode ? 'linear-gradient(90deg, rgba(37,99,235,0.16), rgba(14,165,233,0.08))' : 'linear-gradient(90deg, rgba(37,99,235,0.08), rgba(14,165,233,0.05))', borderBottom: isDarkMode ? '1px solid rgba(148,163,184,0.16)' : '1px solid rgba(15,23,42,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 0 6px rgba(56,189,248,0.16)' }} />
                    <h3 style={{ margin: 0, color: isDarkMode ? '#f8fafc' : '#0f172a', fontSize: 18 }}>Invoice Template</h3>
                  </div>
                  <button onClick={() => setInvoiceModalOpen(false)} style={{ background: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', border: isDarkMode ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.08)', borderRadius: '999px', color: isDarkMode ? '#f8fafc' : '#0f172a', fontSize: 16, cursor: 'pointer', padding: '8px 11px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
                <div style={{ padding: 18, maxHeight: '88vh', overflow: 'auto', background: isDarkMode ? 'linear-gradient(180deg, rgba(2,6,23,0.88), rgba(15,23,42,0.92))' : 'linear-gradient(180deg, rgba(248,250,252,0.96), rgba(255,255,255,0.98))' }}>
                  <div style={{ display: 'grid', gap: 14 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span>Invoice template</span>
                      <textarea rows={10} value={invoiceTemplate} onChange={(e) => setInvoiceTemplate(e.target.value)} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc', resize: 'vertical' }} />
                    </label>
                    <button type="button" onClick={() => setInvoiceModalOpen(false)} style={{ background: '#1976d2', color: 'white', border: 'none', padding: '10px 14px', borderRadius: '10px', cursor: 'pointer' }}>Save Invoice Template</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {adminModal && (
            <div
              className="admin-panel-modal-overlay"
              onClick={() => setAdminModal(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1300 }}
            >
              <div
                className="admin-panel-modal-panel"
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: '100%',
                  maxWidth: 1000,
                  background: isDarkMode
                    ? 'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.97))'
                    : 'linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,250,252,0.97))',
                  border: isDarkMode ? '1px solid rgba(148,163,184,0.24)' : '1px solid rgba(15,23,42,0.08)',
                  borderRadius: 24,
                  overflow: 'hidden',
                  boxShadow: isDarkMode ? '0 30px 90px rgba(2,6,23,0.55)' : '0 24px 70px rgba(15,23,42,0.16)'
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '18px 22px',
                  background: isDarkMode
                    ? 'linear-gradient(90deg, rgba(37,99,235,0.16), rgba(14,165,233,0.08))'
                    : 'linear-gradient(90deg, rgba(37,99,235,0.08), rgba(14,165,233,0.05))',
                  borderBottom: isDarkMode ? '1px solid rgba(148,163,184,0.16)' : '1px solid rgba(15,23,42,0.08)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 0 6px rgba(56,189,248,0.16)' }} />
                    <h3 style={{ margin: 0, color: isDarkMode ? '#f8fafc' : '#0f172a', fontSize: 18 }}>{ADMIN_MODAL_TITLES[adminModal] || ''}</h3>
                  </div>
                  <button onClick={() => setAdminModal(null)} style={{ background: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', border: isDarkMode ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.08)', borderRadius: '999px', color: isDarkMode ? '#f8fafc' : '#0f172a', fontSize: 16, cursor: 'pointer', padding: '8px 11px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
                <div style={{ padding: 18, maxHeight: '88vh', overflow: 'auto', background: isDarkMode ? 'linear-gradient(180deg, rgba(2,6,23,0.88), rgba(15,23,42,0.92))' : 'linear-gradient(180deg, rgba(248,250,252,0.96), rgba(255,255,255,0.98))' }}>
                  {adminModal === 'pricing' && (
                    <div style={{ display: 'grid', gap: 14 }}>
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px', borderRadius: '8px', background: isDarkMode ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.05)', border: isDarkMode ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(59, 130, 246, 0.2)' }}>
                        <input
                          type="checkbox"
                          checked={pricingSettings?.auto_update_exchange_rate || false}
                          onChange={(e) => setPricingSettings((prev) => ({ ...prev, auto_update_exchange_rate: e.target.checked }))}
                          style={{ cursor: 'pointer', width: 18, height: 18 }}
                        />
                        <div>
                          <span style={{ color: isDarkMode ? '#f8fafc' : '#0f172a', fontWeight: 600 }}>Auto-update exchange rates daily at 10 AM</span>
                          <p style={{ margin: '4px 0 0', color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: '0.85rem' }}>Enable automatic daily currency exchange rate updates</p>
                        </div>
                      </label>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <p style={{ margin: 0, color: isDarkMode ? '#cbd5e1' : '#475569' }}>Set fixed pricing amounts for each currency.</p>
                          <p style={{ margin: '12px 0 0', color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: '0.9rem' }}>Fixed pricing amounts by currency. Custom currencies can be added and removed.</p>
                        </div>
                        <button
                          type="button"
                          onClick={addPricingCurrencyRow}
                          style={{ background: '#16a34a', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap', marginLeft: 12 }}
                        >
                          + Add Currency
                        </button>
                      </div>

                      <div style={{ display: 'grid', gap: 12 }}>
                        {pricingCurrencyRows.map((currencyRow, index) => {
                          const isDefaultCurrency = DEFAULT_PRICING_CURRENCY_CODES.includes(currencyRow.code.toUpperCase());
                          return (
                            <div key={currencyRow.id || `${currencyRow.code}-${index}`} style={{ display: 'grid', gap: 8, padding: 12, borderRadius: 10, background: isDarkMode ? 'rgba(15,23,42,0.8)' : '#f1f5f9', border: isDarkMode ? '1px solid rgba(148,163,184,0.16)' : '1px solid #e2e8f0' }}>
                              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <label style={{ display: 'grid', gap: 6, flex: 1, minWidth: 160 }}>
                                  <span>Currency</span>
                                  <select
                                    aria-label="Currency"
                                    value={currencyRow.code}
                                    onChange={(e) => setPricingCurrencyRows((prev) => prev.map((row) => row.id === currencyRow.id ? { ...row, code: e.target.value.toUpperCase() } : row))}
                                    style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc', minWidth: 110 }}
                                  >
                                    {getCurrencyOptionsForRow(currencyRow.id, currencyRow.code).map((currencyCode) => (
                                      <option key={currencyCode} value={currencyCode}>{currencyCode}</option>
                                    ))}
                                  </select>
                                </label>
                                <label style={{ display: 'grid', gap: 6, flex: 1, minWidth: 160 }}>
                                  <span>Amount</span>
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <input
                                      aria-label="Amount"
                                      type="number"
                                      value={currencyRow.amount ?? ''}
                                      onChange={(e) => setPricingCurrencyRows((prev) => prev.map((row) => row.id === currencyRow.id ? { ...row, amount: e.target.value } : row))}
                                      style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc', flex: 1 }}
                                    />
                                    {currencyRow.code !== 'INR' && (
                                      <span style={{ fontSize: '0.9rem', color: isDarkMode ? '#94a3b8' : '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>
                                        = ₹{pricingSettings?.liveRates && pricingSettings.liveRates[currencyRow.code] ? (Number(currencyRow.amount || 0) / Number(pricingSettings.liveRates[currencyRow.code])).toFixed(2) : (Number(currencyRow.amount || 0) * Number(pricingSettings?.inr_amount || 1)).toFixed(2)}
                                      </span>
                                    )}
                                  </div>
                                </label>
                              </div>
                              {!isDefaultCurrency && (
                                <button
                                  type="button"
                                  onClick={() => setPricingCurrencyRows((prev) => prev.filter((row) => row.id !== currencyRow.id))}
                                  style={{ background: '#dc2626', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', alignSelf: 'flex-start' }}
                                >
                                  Remove currency
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button type="button" onClick={savePricingSettings} style={{ background: '#1976d2', color: 'white', border: 'none', padding: '10px 14px', borderRadius: '10px', cursor: 'pointer' }} disabled={pricingLoading}>{pricingLoading ? 'Saving...' : 'Save pricing settings'}</button>
                        <button type="button" onClick={manualUpdateCurrencyRates} style={{ background: '#0891b2', color: 'white', border: 'none', padding: '10px 14px', borderRadius: '10px', cursor: 'pointer' }} disabled={currencyUpdateLoading}>{currencyUpdateLoading ? 'Updating...' : 'Update Currency Rates'}</button>
                      </div>
                      {pricingMessage ? <p style={{ margin: 0, color: pricingMessage.includes('Failed') ? '#f44336' : '#4caf50' }}>{pricingMessage}</p> : null}
                    </div>
                  )}
                  {adminModal === 'freeAssets' && (
                    <div style={{ display: 'grid', gap: 14 }}>
                      <p style={{ margin: 0, color: isDarkMode ? '#cbd5e1' : '#475569' }}>Configure free asset availability, download limits, badges, and visibility.</p>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <span>Enable free assets</span>
                        <input type="checkbox" checked={freeAssetSettings?.enable_free_assets} onChange={(e) => setFreeAssetSettings((prev) => ({ ...prev, enable_free_assets: e.target.checked }))} />
                      </label>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <span>Max free assets allowed</span>
                        <input type="number" value={freeAssetSettings?.max_free_assets_allowed || ''} onChange={(e) => setFreeAssetSettings((prev) => ({ ...prev, max_free_assets_allowed: e.target.value }))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} />
                      </label>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <span>Free asset source</span>
                        <select value={freeAssetSettings?.free_asset_source || 'admin_only'} onChange={(e) => setFreeAssetSettings((prev) => ({ ...prev, free_asset_source: e.target.value }))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }}>
                          <option value="admin_only">Admin only</option>
                          <option value="contributors">Contributors</option>
                          <option value="mixed">Mixed</option>
                        </select>
                      </label>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <span>Show free badge</span>
                        <input type="checkbox" checked={freeAssetSettings?.show_free_badge} onChange={(e) => setFreeAssetSettings((prev) => ({ ...prev, show_free_badge: e.target.checked }))} />
                      </label>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <span>Highlight free assets in search</span>
                        <input type="checkbox" checked={freeAssetSettings?.highlight_in_search} onChange={(e) => setFreeAssetSettings((prev) => ({ ...prev, highlight_in_search: e.target.checked }))} />
                      </label>
                      <button type="button" onClick={saveFreeAssetSettings} style={{ background: '#43a047', color: 'white', border: 'none', padding: '10px 14px', borderRadius: '10px', cursor: 'pointer' }} disabled={freeAssetLoading}>{freeAssetLoading ? 'Saving...' : 'Save free asset settings'}</button>
                      {freeAssetMessage ? <p style={{ margin: 0, color: freeAssetMessage.includes('Failed') ? '#f44336' : '#4caf50' }}>{freeAssetMessage}</p> : null}
                    </div>
                  )}
                  {adminModal === 'subscriptionPlans' && (
                    <div style={{ display: 'grid', gap: 14 }}>
                      <p style={{ margin: 0, color: isDarkMode ? '#cbd5e1' : '#475569' }}>Current subscription plans.</p>
                      <div style={{ display: 'grid', gap: 12 }}>
                        {subscriptionPlans.length > 0 ? subscriptionPlans.map((plan) => (
                          <div key={plan.id} style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid #ccc' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <strong>{plan.name}</strong>
                              {plan.recommended && <span style={{ background: '#f59e0b', color: '#fff', padding: '3px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>Most Popular</span>}
                            </div>
                            {plan.short_description ? <div style={{ marginTop: 8, whiteSpace: 'pre-line' }}>{plan.short_description}</div> : <div>No description</div>}
                            <div style={{ marginTop: 6, color: isDarkMode ? '#cbd5e1' : '#475569' }}>
                              {plan.pricing?.amount != null ? `${plan.pricing.amount} ${plan.pricing.currency || ''}`.trim() : 'Price not set'}
                              {' · '}{plan.active === false ? 'Inactive' : 'Active'}
                              {plan.recommended ? ' · Recommended' : ''}
                            </div>
                          </div>
                        )) : (
                          <p style={{ margin: 0, color: isDarkMode ? '#cbd5e1' : '#475569' }}>No subscription plans found.</p>
                        )}
                      </div>
                    </div>
                  )}
                  {adminModal === 'subscriptionPlanForm' && (
                    <form onSubmit={(event) => { event.preventDefault(); saveSubscriptionPlan(); }} style={{ display: 'grid', gap: 14 }}>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <span>Plan Name</span>
                        <input type="text" value={planForm.name} onChange={(event) => setPlanForm((previous) => ({ ...previous, name: event.target.value }))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} required />
                      </label>
                      <label style={{ display: 'grid', gap: 6 }}>
                        <span>Description</span>
                        <textarea rows={5} value={planForm.short_description} onChange={(event) => setPlanForm((previous) => ({ ...previous, short_description: event.target.value }))} placeholder="Enter a custom description for this subscription plan" style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc', resize: 'vertical' }} />
                      </label>
                      <fieldset style={{ display: 'grid', gap: 10, border: '1px solid #cbd5e1', borderRadius: 8, padding: 12 }}>
                        <legend>Duration</legend>
                        {[
                          ['monthly', 'Monthly'],
                          ['3_months', '3 Months'],
                          ['6_months', '6 Months'],
                          ['1_year', '1 Year'],
                          ['limited', 'Limited time']
                        ].map(([value, label]) => (
                          <div key={value} style={{ display: 'grid', gap: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input type="checkbox" checked={Boolean(planForm.durations[value])} onChange={(event) => setPlanForm((previous) => ({
                                ...previous,
                                durations: { ...previous.durations, [value]: event.target.checked },
                                duration: value
                              }))} />
                              <span>{label}</span>
                            </label>
                            {planForm.durations[value] ? (
                              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(getActivePlanCurrencies().length, 3)}, minmax(0, 1fr))`, gap: 8, paddingLeft: 26 }}>
                                {getActivePlanCurrencies().map((currency) => (
                                  <label key={currency} style={{ display: 'grid', gap: 4 }}>
                                    <span style={{ fontSize: 12, fontWeight: 700 }}>{currency}{currency === 'INR' ? ' (source)' : ''}</span>
                                    <input type="number" min="0" step="0.01" value={planCurrencyPrices[currency]?.[value] ?? ''} onChange={(event) => {
                                      const nextValue = event.target.value;
                                      setPlanCurrencyPrices((previous) => {
                                        const next = { ...previous, [currency]: { ...previous[currency], [value]: nextValue } };
                                        if (currency === 'INR') {
                                          getActivePlanCurrencies().filter((target) => target !== 'INR').forEach((target) => {
                                            next[target] = { ...next[target], [value]: convertPlanPriceFromInr(nextValue, target) };
                                          });
                                        }
                                        return next;
                                      });
                                      if (currency === getActivePlanCurrencies()[0]) {
                                        setPlanForm((previous) => ({ ...previous, durationPrices: { ...previous.durationPrices, [value]: nextValue } }));
                                      }
                                    }} style={{ minWidth: 0, width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: '8px', border: '1px solid #ccc' }} required />
                                  </label>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </fieldset>
                      {planForm.durations.limited && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                          <label style={{ display: 'grid', gap: 6 }}>
                            <span>Start date</span>
                            <input type="date" value={planForm.startDate} onChange={(event) => setPlanForm((previous) => ({ ...previous, startDate: event.target.value }))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} required />
                          </label>
                          <label style={{ display: 'grid', gap: 6 }}>
                            <span>End date</span>
                            <input type="date" value={planForm.endDate} min={planForm.startDate || undefined} onChange={(event) => setPlanForm((previous) => ({ ...previous, endDate: event.target.value }))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} required />
                          </label>
                        </div>
                      )}
                      <label style={{ display: 'grid', gap: 6 }}>
                        <span>Downloads</span>
                        <input type="number" min="0" step="1" value={planForm.downloads} onChange={(event) => setPlanForm((previous) => ({ ...previous, downloads: event.target.value }))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} required />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" checked={planForm.active} onChange={(event) => setPlanForm((previous) => ({ ...previous, active: event.target.checked }))} />
                        <span>Active plan</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" checked={planForm.recommended} onChange={(event) => setPlanForm((previous) => ({ ...previous, recommended: event.target.checked }))} />
                        <span>Recommended</span>
                      </label>
                      {planForm.active && <p style={{ margin: 0, color: isDarkMode ? '#fbbf24' : '#b45309' }}>Active plans appear first and are highlighted as Most Popular.</p>}
                      <button type="submit" style={{ background: '#9c27b0', color: 'white', border: 'none', padding: '10px 14px', borderRadius: '10px', cursor: 'pointer' }}>Save Subscription Plan</button>
                      {subscriptionMessage ? <p style={{ margin: 0, color: subscriptionMessage.includes('required') || subscriptionMessage.includes('must') ? '#f44336' : '#4caf50' }}>{subscriptionMessage}</p> : null}
                    </form>
                  )}
                  {adminModal === 'subscriptionSubscribers' && (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <p style={{ margin: 0, color: isDarkMode ? '#cbd5e1' : '#475569' }}>Customers with subscription records.</p>
                      {subscriptionSubscribers.length > 0 ? subscriptionSubscribers.map((subscriber) => (
                        <div key={subscriber.id} style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid #ccc' }}>
                          <strong>{subscriber.customer_name || 'Unnamed customer'}</strong>
                          <div>{subscriber.customer_email || 'No email'}</div>
                          <div style={{ marginTop: 6, color: isDarkMode ? '#cbd5e1' : '#475569' }}>
                            {subscriber.base_plan || 'Plan not specified'}
                            {' · '}{subscriber.status || 'Unknown status'}
                          </div>
                        </div>
                      )) : (
                        <p style={{ margin: 0, color: isDarkMode ? '#cbd5e1' : '#475569' }}>No subscribed customers found.</p>
                      )}
                    </div>
                  )}
                  {adminModal === 'customSubscriptions' && (
                    <div style={{ display: 'grid', gap: 14 }}>
                      <p style={{ margin: 0, color: isDarkMode ? '#cbd5e1' : '#475569' }}>Create or review custom subscription requests for customers.</p>
                      <div style={{ display: 'grid', gap: 12 }}>
                        {customSubscriptions.map((sub) => (
                          <div key={sub.id} style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid #ccc', background: isDarkMode ? '#111827' : '#ffffff' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                              <div>
                                <strong>{sub.customer_name || 'Unnamed customer'}</strong>
                                <div style={{ color: isDarkMode ? '#cbd5e1' : '#475569', fontSize: '0.95rem' }}>{sub.customer_email || 'No email'}</div>
                              </div>
                              <div style={{ color: isDarkMode ? '#a5b4fc' : '#1e40af' }}>{sub.status || 'unknown'}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'grid', gap: 10 }}>
                        <label style={{ display: 'grid', gap: 6 }}>
                          <span>Customer name</span>
                          <input type="text" value={customSubscriptionForm.customer_name} onChange={(e) => setCustomSubscriptionForm((prev) => ({ ...prev, customer_name: e.target.value }))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} />
                        </label>
                        <label style={{ display: 'grid', gap: 6 }}>
                          <span>Customer email</span>
                          <input type="email" value={customSubscriptionForm.customer_email} onChange={(e) => setCustomSubscriptionForm((prev) => ({ ...prev, customer_email: e.target.value }))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} />
                        </label>
                        <label style={{ display: 'grid', gap: 6 }}>
                          <span>Base plan</span>
                          <input type="text" value={customSubscriptionForm.base_plan} onChange={(e) => setCustomSubscriptionForm((prev) => ({ ...prev, base_plan: e.target.value }))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} />
                        </label>
                        <label style={{ display: 'grid', gap: 6 }}>
                          <span>Custom pricing</span>
                          <input type="number" value={customSubscriptionForm.custom_pricing} onChange={(e) => setCustomSubscriptionForm((prev) => ({ ...prev, custom_pricing: e.target.value }))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }} />
                        </label>
                        <label style={{ display: 'grid', gap: 6 }}>
                          <span>Status</span>
                          <select value={customSubscriptionForm.status} onChange={(e) => setCustomSubscriptionForm((prev) => ({ ...prev, status: e.target.value }))} style={{ padding: '10px', borderRadius: '8px', border: '1px solid #ccc' }}>
                            <option value="active">Active</option>
                            <option value="pending">Pending</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </label>
                        <button type="button" onClick={saveCustomSubscription} style={{ background: '#f57c00', color: 'white', border: 'none', padding: '10px 14px', borderRadius: '10px', cursor: 'pointer' }}>Create custom subscription</button>
                        {customSubscriptionMessage ? <p style={{ margin: 0, color: customSubscriptionMessage.includes('Failed') ? '#f44336' : '#4caf50' }}>{customSubscriptionMessage}</p> : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Category Modal */}
          {viewingCategoryId && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px",
                zIndex: 1150
              }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: "420px",
                  background: "white",
                  borderRadius: "14px",
                  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
                  overflow: "hidden"
                }}
              >
                <div style={{ padding: "18px 20px", borderBottom: "1px solid #eee" }}>
                  <h3 style={{ margin: 0 }}>Category Details</h3>
                </div>
                <div style={{ padding: "20px", display: "grid", gap: "14px" }}>
                  <p style={{ margin: 0 }}>
                    <strong>Name:</strong> {visibleCategories.find(c => c.id === viewingCategoryId)?.name || "Unnamed"}
                  </p>
                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => {
                        startEditingCategory(visibleCategories.find(c => c.id === viewingCategoryId));
                        setViewingCategoryId(null);
                      }}
                      style={{
                        background: "#1976d2",
                        color: "white",
                        border: "none",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        cursor: "pointer"
                      }}
                    >
                      Modify
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        deleteCategory(viewingCategoryId);
                        setViewingCategoryId(null);
                      }}
                      style={{
                        background: "#e53935",
                        color: "white",
                        border: "none",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        cursor: "pointer"
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewingCategoryId(null)}
                      style={{
                        background: "#757575",
                        color: "white",
                        border: "none",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        cursor: "pointer"
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Collection Modal */}
          {viewingCollectionId && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px",
                zIndex: 1150
              }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: "420px",
                  background: "white",
                  borderRadius: "14px",
                  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
                  overflow: "hidden"
                }}
              >
                <div style={{ padding: "18px 20px", borderBottom: "1px solid #eee" }}>
                  <h3 style={{ margin: 0 }}>Collection Details</h3>
                </div>
                <div style={{ padding: "20px", display: "grid", gap: "14px" }}>
                  <p style={{ margin: 0 }}>
                    <strong>Name:</strong> {visibleCollections.find(c => c.id === viewingCollectionId)?.name || "Unnamed"}
                  </p>
                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => {
                        startEditingCollection(visibleCollections.find(c => c.id === viewingCollectionId));
                        setViewingCollectionId(null);
                      }}
                      style={{
                        background: "#1976d2",
                        color: "white",
                        border: "none",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        cursor: "pointer"
                      }}
                    >
                      Modify
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        deleteCollection(viewingCollectionId);
                        setViewingCollectionId(null);
                      }}
                      style={{
                        background: "#e53935",
                        color: "white",
                        border: "none",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        cursor: "pointer"
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewingCollectionId(null)}
                      style={{
                        background: "#757575",
                        color: "white",
                        border: "none",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        cursor: "pointer"
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Category Grid Modal */}
          {showCategoryGrid && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px",
                zIndex: 1150
              }}
            >
              <div
                style={{
                  width: "90%",
                  maxWidth: "1000px",
                  maxHeight: "80vh",
                  background: "white",
                  borderRadius: "14px",
                  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
                  overflow: "auto",
                  display: "flex",
                  flexDirection: "column"
                }}
              >
                <div style={{ padding: "18px 20px", borderBottom: "1px solid #eee", position: "sticky", top: 0, background: "inherit" }}>
                  <h3 style={{ margin: 0 }}>Categories</h3>
                </div>
                <div style={{ padding: "20px", flex: 1 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
                    {visibleCategories.map((categoryItem) => (
                      <div
                        key={categoryItem.id}
                        style={{
                          padding: "14px",
                          borderRadius: "12px",
                          border: "1px solid #ddd",
                          background: "inherit",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "10px",
                          color: "inherit",
                          textAlign: "center",
                          minHeight: "100px"
                        }}
                      >
                        <span style={{ color: "inherit", fontWeight: 600, fontSize: "0.95rem" }}>{categoryItem.name || "Unnamed category"}</span>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCategoryInModal(categoryItem.id);
                              setEditingCategoryNameInModal(categoryItem.name || "");
                            }}
                            style={{
                              background: "#1976d2",
                              color: "white",
                              border: "none",
                              padding: "8px 16px",
                              borderRadius: "8px",
                              cursor: "pointer",
                              fontSize: "0.9rem"
                            }}
                          >
                            Modify
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              deleteCategory(categoryItem.id);
                              setShowCategoryGrid(false);
                            }}
                            style={{
                              background: "#e53935",
                              color: "white",
                              border: "none",
                              padding: "8px 16px",
                              borderRadius: "8px",
                              cursor: "pointer",
                              fontSize: "0.9rem"
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ padding: "18px 20px", borderTop: "1px solid #eee", textAlign: "right", background: "white" }}>
                  <button
                    type="button"
                    onClick={() => setShowCategoryGrid(false)}
                    style={{
                      background: "#757575",
                      color: "white",
                      border: "none",
                      padding: "10px 18px",
                      borderRadius: "8px",
                      cursor: "pointer"
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Collection Grid Modal */}
          {showCollectionGrid && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px",
                zIndex: 1150
              }}
            >
              <div
                style={{
                  width: "90%",
                  maxWidth: "1000px",
                  maxHeight: "80vh",
                  background: "white",
                  borderRadius: "14px",
                  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
                  overflow: "auto",
                  display: "flex",
                  flexDirection: "column"
                }}
              >
                <div style={{ padding: "18px 20px", borderBottom: "1px solid #eee", position: "sticky", top: 0, background: "inherit" }}>
                  <h3 style={{ margin: 0 }}>Collections</h3>
                </div>
                <div style={{ padding: "20px", flex: 1 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
                    {visibleCollections.length === 0 ? (
                      <span style={{ color: "#777" }}>No active collections yet.</span>
                    ) : (
                      visibleCollections.map((collectionItem) => (
                        <div
                          key={collectionItem.id}
                          style={{
                            padding: "14px",
                            borderRadius: "12px",
                            border: "1px solid #ddd",
                            background: "inherit",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "10px",
                            color: "inherit",
                            textAlign: "center",
                            minHeight: "100px"
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                            <span style={{ color: "inherit", fontWeight: 600, fontSize: "0.95rem" }}>{collectionItem.name || "Unnamed collection"}</span>
                            <span style={{ color: "#64748b", fontSize: "0.8rem" }}>{Number(collectionItem.asset_count || 0)} asset{Number(collectionItem.asset_count || 0) === 1 ? "" : "s"}</span>
                          </div>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCollectionInModal(collectionItem.id);
                                setEditingCollectionNameInModal(collectionItem.name || "");
                              }}
                              style={{
                                background: "#1976d2",
                                color: "white",
                                border: "none",
                                padding: "8px 16px",
                                borderRadius: "8px",
                                cursor: "pointer",
                                fontSize: "0.9rem"
                              }}
                            >
                              Modify
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                deleteCollection(collectionItem.id);
                                setShowCollectionGrid(false);
                              }}
                              style={{
                                background: "#e53935",
                                color: "white",
                                border: "none",
                                padding: "8px 16px",
                                borderRadius: "8px",
                                cursor: "pointer",
                                fontSize: "0.9rem"
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div style={{ padding: "18px 20px", borderTop: "1px solid #eee", textAlign: "right", background: "inherit" }}>
                  <button
                    type="button"
                    onClick={() => setShowCollectionGrid(false)}
                    style={{
                      background: "#757575",
                      color: "white",
                      border: "none",
                      padding: "10px 18px",
                      borderRadius: "8px",
                      cursor: "pointer"
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Category Modal */}
          {editingCategoryInModal && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px",
                zIndex: 1160
              }}
            >
              <div
                className="admin-panel-modal-panel"
                style={{
                  width: "100%",
                  maxWidth: "420px",
                  background: "white",
                  borderRadius: "14px",
                  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
                  overflow: "hidden"
                }}
              >
                <div style={{ padding: "18px 20px", borderBottom: "1px solid #eee" }}>
                  <h3 style={{ margin: 0 }}>Edit Category</h3>
                </div>
                <div style={{ padding: "20px", display: "grid", gap: "14px" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontSize: "0.9rem", color: "inherit", fontWeight: 500 }}>Category Name</span>
                    <input
                      type="text"
                      value={editingCategoryNameInModal}
                      onChange={(e) => setEditingCategoryNameInModal(e.target.value)}
                      style={{
                        padding: "10px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        fontSize: "1rem"
                      }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={async () => {
                        const trimmedName = editingCategoryNameInModal.trim();
                        if (!trimmedName) return;

                        try {
                          const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
                          const res = await axios.put(
                            `${API_BASE_URL}/admin/categories/${editingCategoryInModal}`,
                            { name: trimmedName },
                            {
                              headers: { Authorization: `Bearer ${token}` }
                            }
                          );
                          setCategories((prev) => {
                            const nextCategories = prev.map((categoryItem) => (categoryItem.id === editingCategoryInModal ? res.data : categoryItem));
                            persistCategories(nextCategories);
                            return nextCategories;
                          });
                          if (typeof window !== "undefined") {
                            window.dispatchEvent(new Event("asset-categories-updated"));
                          }
                          setEditingCategoryInModal(null);
                          setEditingCategoryNameInModal("");
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                      style={{
                        background: "#43a047",
                        color: "white",
                        border: "none",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        cursor: "pointer"
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCategoryInModal(null);
                        setEditingCategoryNameInModal("");
                      }}
                      style={{
                        background: "#757575",
                        color: "white",
                        border: "none",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        cursor: "pointer"
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Edit Collection Modal */}
          {editingCollectionInModal && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px",
                zIndex: 1160
              }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: "420px",
                  background: "white",
                  borderRadius: "14px",
                  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
                  overflow: "hidden"
                }}
              >
                <div style={{ padding: "18px 20px", borderBottom: "1px solid #eee" }}>
                  <h3 style={{ margin: 0 }}>Edit Collection</h3>
                </div>
                <div style={{ padding: "20px", display: "grid", gap: "14px" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontSize: "0.9rem", color: "#333", fontWeight: 500 }}>Collection Name</span>
                    <input
                      type="text"
                      value={editingCollectionNameInModal}
                      onChange={(e) => setEditingCollectionNameInModal(e.target.value)}
                      style={{
                        padding: "10px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        fontSize: "1rem"
                      }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={async () => {
                        const trimmedName = editingCollectionNameInModal.trim();
                        if (!trimmedName) return;

                        try {
                          const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
                          const res = await axios.put(
                            `${API_BASE_URL}/admin/collections/${editingCollectionInModal}`,
                            { name: trimmedName },
                            {
                              headers: { Authorization: `Bearer ${token}` }
                            }
                          );
                          setCollections((prev) => {
                            const nextCollections = prev.map((collectionItem) => (collectionItem.id === editingCollectionInModal ? res.data : collectionItem));
                            persistCollections(nextCollections);
                            return nextCollections;
                          });
                          if (typeof window !== "undefined") {
                            window.dispatchEvent(new Event("asset-collections-updated"));
                            window.dispatchEvent(new Event("asset-refresh"));
                            window.dispatchEvent(new Event("asset-updated"));
                            window.dispatchEvent(new Event("home-assets-refresh"));
                          }
                          if (tabParam === "live-assets") {
                            await fetchApprovedImages();
                          }
                          setEditingCollectionInModal(null);
                          setEditingCollectionNameInModal("");
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                      style={{
                        background: "#43a047",
                        color: "white",
                        border: "none",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        cursor: "pointer"
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCollectionInModal(null);
                        setEditingCollectionNameInModal("");
                      }}
                      style={{
                        background: "#757575",
                        color: "white",
                        border: "none",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        cursor: "pointer"
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        </>
      ) : (
        <>
          {isLiveAssetsTab && (
            <>
              <div
                style={{
                  marginBottom: "20px",
                  padding: "20px",
                  borderRadius: "12px",
                  border: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd",
                  background: isDarkMode ? "#0f172a" : "#fafafa",
                  color: isDarkMode ? "#f5f5f5" : "#111827",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start"
                }}
              >
                <div>
                  <h3>Live Assets</h3>
                  <p style={{ color: isDarkMode ? "#cbd5e1" : "#555", marginTop: "-4px" }}>Manage currently approved assets that are visible on the site.</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={exportLiveAssetsCsv}
                      disabled={images.length === 0}
                      style={{ borderRadius: "16px", border: "none", background: "#1976d2", color: "white", padding: "10px 14px", cursor: images.length === 0 ? "not-allowed" : "pointer" }}
                    >
                      Export CSV
                    </button>
                  </div>
                  <div style={{ color: isDarkMode ? "#cbd5e1" : "#555", fontSize: "0.9rem" }}>{liveAssetsExportStatus}</div>
                </div>
              </div>
              <div
                aria-hidden={isEditing}
                style={{
                  marginBottom: "18px",
                  padding: "18px",
                  borderRadius: "12px",
                  border: isDarkMode ? "1px solid rgba(148,163,184,0.25)" : "1px solid #ddd",
                  background: isDarkMode ? "#1f2937" : "#fff",
                  color: isDarkMode ? "#f5f5f5" : "#111827",
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr 1fr auto",
                  gap: "12px",
                  alignItems: "end"
                }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "0.9rem", color: isDarkMode ? "#e2e8f0" : "#333", fontWeight: 600 }}>Search Assets</span>
                  <input
                    type="text"
                    placeholder="Search title, collection, category, keywords"
                    value={liveSearchQuery}
                    onChange={(e) => setLiveSearchQuery(e.target.value)}
                    style={{ padding: "10px", borderRadius: "8px", border: isDarkMode ? "1px solid #4b5563" : "1px solid #ccc", background: isDarkMode ? "#111827" : "#fff", color: isDarkMode ? "#f8fafc" : "#111827", width: "100%" }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "0.9rem", color: isDarkMode ? "#e2e8f0" : "#333", fontWeight: 600 }}>Category</span>
                  <select
                    value={liveCategoryFilter}
                    onChange={(e) => setLiveCategoryFilter(e.target.value)}
                    style={{ padding: "10px", borderRadius: "8px", border: isDarkMode ? "1px solid #4b5563" : "1px solid #ccc", background: isDarkMode ? "#111827" : "#fff", color: isDarkMode ? "#f8fafc" : "#111827", width: "100%" }}
                  >
                    <option value="">All Categories</option>
                    {visibleCategories.map((categoryItem) => (
                      <option key={categoryItem.id} value={categoryItem.name}>{categoryItem.name}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span aria-hidden="true" style={{ fontSize: "0.9rem", color: isDarkMode ? "#e2e8f0" : "#333", fontWeight: 600 }}>Collection</span>
                  <select
                    aria-label="Live assets filter"
                    value={liveCollectionFilter}
                    onChange={(e) => setLiveCollectionFilter(e.target.value)}
                    style={{ padding: "10px", borderRadius: "8px", border: isDarkMode ? "1px solid #4b5563" : "1px solid #ccc", background: isDarkMode ? "#111827" : "#fff", color: isDarkMode ? "#f8fafc" : "#111827", width: "100%" }}
                  >
                    <option value="">All Collections</option>
                    {visibleCollections.map((collectionItem) => (
                      <option key={collectionItem.id} value={collectionItem.name}>{collectionItem.name}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "0.9rem", color: isDarkMode ? "#e2e8f0" : "#333", fontWeight: 600 }}>Type</span>
                  <select
                    value={liveTypeFilter}
                    onChange={(e) => setLiveTypeFilter(e.target.value)}
                    style={{ padding: "10px", borderRadius: "8px", border: isDarkMode ? "1px solid #4b5563" : "1px solid #ccc", background: isDarkMode ? "#111827" : "#fff", color: isDarkMode ? "#f8fafc" : "#111827", width: "100%" }}
                  >
                    <option value="">All Types</option>
                    {liveTypeOptions.map((typeOption) => (
                      <option key={typeOption} value={typeOption}>{typeOption}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setLiveSearchQuery("");
                    setLiveCategoryFilter("");
                    setLiveCollectionFilter("");
                    setLiveTypeFilter("");
                  }}
                  style={{
                    background: "#5c6bc0",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    padding: "12px 18px",
                    cursor: "pointer",
                    width: "100%"
                  }}
                >
                  Clear
                </button>
              </div>
            </>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "12px",
              marginTop: "20px"
            }}
          >
            {renderedImages.map((image) => (
              <div
                key={image.id}
                style={{
                  border: isDarkMode ? "1px solid rgba(148, 163, 184, 0.25)" : "1px solid #ddd",
                  padding: "12px",
                  borderRadius: "8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  background: isDarkMode ? "#1f2937" : "#fff",
                  color: isDarkMode ? "#f5f5f5" : "#111827",
                  position: "relative"
                }}
              >
                {isAssetCurrentlyLive(image) && (
                  <div
                    style={{
                      position: "absolute",
                      top: "10px",
                      left: "10px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "6px 10px",
                      borderRadius: "999px",
                      fontSize: "0.72rem",
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "#fff",
                      background: "linear-gradient(135deg, #d7263d 0%, #a61b2d 100%)",
                      boxShadow: "0 8px 18px rgba(168, 27, 45, 0.25)",
                      border: "1px solid rgba(255,255,255,0.28)",
                      animation: "admin-live-badge-glow 1.8s ease-in-out infinite",
                      transformOrigin: "left center",
                      zIndex: 1
                    }}
                  >
                    Live
                  </div>
                )}
                <img
                  src={getAssetPreviewUrl(image, { quality: 50, watermark: false })}
                  alt={image.title}
                  style={{
                    width: "100%",
                    minHeight: "120px",
                    maxHeight: "150px",
                    objectFit: "cover",
                    borderRadius: "6px"
                  }}
                />
                <p style={{ margin: "0", fontSize: "0.85rem", color: isDarkMode ? "#cbd5e1" : "#555" }}>Title: {image.title}</p>
                <p style={{ margin: "0", fontSize: "0.85rem", color: isDarkMode ? "#cbd5e1" : "#555" }}>Collection: {image.collection || "-"}</p>
                <p style={{ margin: "0", fontSize: "0.85rem", color: isDarkMode ? "#cbd5e1" : "#555" }}>Type: {image.type || "-"}</p>
                <p style={{ margin: "0", fontSize: "0.85rem", color: isDarkMode ? "#cbd5e1" : "#555" }}>Contributor: {image.contributor_username || image.contributor || image.username || "-"}</p>
                {String(image.status || "").toLowerCase() === "pending" && (image.estimated_total_remaining_seconds != null || image.queue_position != null) && (
                  <div style={{ marginTop: "10px", padding: "10px", borderRadius: "10px", background: isDarkMode ? "#45320b" : "#fff8e1", color: isDarkMode ? "#fcd34d" : "#5d4037" }}>
                    {Number.isFinite(image.queue_position) && (
                      <p style={{ margin: "0 0 4px", fontSize: "0.85rem" }}>
                        Queue position: {image.queue_position}
                      </p>
                    )}
                    <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700 }}>
                      Estimated remaining: {formatDuration(image.estimated_total_remaining_seconds)}
                    </p>
                  </div>
                )}
                <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                  <button
                    onClick={() => openImage(image, true)}
                    style={{
                      flex: 1,
                      background: "#2196f3",
                      color: "white",
                      border: "none",
                      padding: "6px 10px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "0.85rem"
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      window.location.href = `/asset/${image.id}`;
                    }}
                    style={{
                      flex: 1,
                      background: "#5c6bc0",
                      color: "white",
                      border: "none",
                      padding: "6px 10px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "0.85rem"
                    }}
                  >
                    View
                  </button>
                  <button
                    onClick={() => setSelectedImageForStatus(image)}
                    style={{
                      flex: 1,
                      background: "#43a047",
                      color: "white",
                      border: "none",
                      padding: "6px 10px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "0.85rem"
                    }}
                  >
                    Active
                  </button>
                </div>
                <div style={{ display: "flex", gap: "5px", marginTop: "6px" }}>
                  <button
                    onClick={() => downloadOriginalFile(image.id)}
                    title="Download Original File"
                    style={{
                      flex: 0.5,
                      background: "#ff9800",
                      color: "white",
                      border: "none",
                      padding: "4px 8px",
                      borderRadius: "5px",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px"
                    }}
                  >
                    <span>⬇</span>
                    <span>Original</span>
                  </button>
                  <button
                    onClick={() => downloadThumbnail(image)}
                    title="Download Thumbnail"
                    style={{
                      flex: 0.5,
                      background: "#4caf50",
                      color: "white",
                      border: "none",
                      padding: "4px 8px",
                      borderRadius: "5px",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "4px"
                    }}
                  >
                    <span>⬇</span>
                    <span>Thumbnail</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {isLiveAssetsTab ? (
            <Pagination
              currentPage={liveCurrentPage}
              totalPages={liveTotalPages}
              totalImages={liveFilteredImages.length}
              setCurrentPage={setLiveCurrentPage}
              darkMode={isDarkMode}
            />
          ) : (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalImages={images.length}
              setCurrentPage={setCurrentPage}
              darkMode={isDarkMode}
            />
          )}

          {/* Image Status Modal */}
          {selectedImageForStatus && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px",
                zIndex: 1150
              }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: "420px",
                  background: "white",
                  borderRadius: "14px",
                  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
                  overflow: "hidden"
                }}
              >
                <div style={{ padding: "18px 20px", borderBottom: "1px solid #eee" }}>
                  <h3 style={{ margin: 0 }}>Update Status</h3>
                </div>
                <div style={{ padding: "20px", display: "grid", gap: "14px" }}>
                  <p style={{ margin: 0 }}>
                    <strong>Asset:</strong> {selectedImageForStatus.title}
                  </p>
                  <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontSize: "0.9rem", color: "#333", fontWeight: 500 }}>Select Status</span>
                    <select
                      value={selectedImageStatus}
                      onChange={(e) => setSelectedImageStatus(e.target.value)}
                      style={{
                        padding: "10px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        background: "white",
                        fontSize: "1rem"
                      }}
                    >
                      <option value="approved">Approved</option>
                      <option value="reject">Reject</option>
                      <option value="delete">Delete</option>
                    </select>
                  </label>
                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedImageStatus === "approved") {
                          approveImage(selectedImageForStatus.id);
                        } else if (selectedImageStatus === "reject") {
                          rejectImage(selectedImageForStatus.id);
                        } else if (selectedImageStatus === "delete") {
                          deleteImage(selectedImageForStatus.id);
                        }
                        setSelectedImageForStatus(null);
                        setSelectedImageStatus("approved");
                      }}
                      style={{
                        background: "#43a047",
                        color: "white",
                        border: "none",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        cursor: "pointer"
                      }}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedImageForStatus(null);
                        setSelectedImageStatus("approved");
                      }}
                      style={{
                        background: "#757575",
                        color: "white",
                        border: "none",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        cursor: "pointer"
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedImage && (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                padding: "20px",
                zIndex: 1000
              }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: "880px",
                  background: "white",
                  borderRadius: "12px",
                  overflow: "auto",
                  maxHeight: "90vh",
                  padding: "24px",
                  boxShadow: "0 20px 50px rgba(0,0,0,0.2)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <h3 style={{ margin: 0 }}>{selectedImage.title}</h3>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button
                      onClick={() => setIsEditing(true)}
                      style={{
                        background: "#1976d2",
                        color: "white",
                        border: "none",
                        padding: "8px 14px",
                        borderRadius: "6px",
                        cursor: "pointer"
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={closeModal}
                      style={{
                        background: "#eee",
                        color: "#222",
                        border: "none",
                        padding: "8px 14px",
                        borderRadius: "6px",
                        cursor: "pointer"
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "20px", marginTop: "20px" }}>
                  <img
                    src={getAssetPreviewUrl(selectedImage, { quality: 80, watermark: false })}
                    alt={selectedImage.title}
                    style={{ width: "100%", borderRadius: "12px", objectFit: "cover", maxHeight: "420px" }}
                  />

                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    {isEditing ? (
                      <>
                        <label>
                          Title (max 5 words)
                          <input
                            type="text"
                            value={editForm.title}
                            onChange={handleEditTitleChange}
                            style={{ width: "100%", padding: "10px", marginTop: "6px", borderRadius: "8px", border: "1px solid #ccc" }}
                          />
                        </label>
                        <label>
                          Description (max 10 words)
                          <textarea
                            value={editForm.description}
                            onChange={handleEditDescriptionChange}
                            rows={5}
                            style={{ width: "100%", padding: "10px", marginTop: "6px", borderRadius: "8px", border: "1px solid #ccc" }}
                          />
                        </label>
                        <label style={{ display: "block", marginBottom: "6px", fontWeight: "600" }}>
                          Category (1 required, 2 max)
                        </label>
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: "220px" }}>
                            <select
                              aria-label="Select primary category"
                              value={editForm.categoryPrimary}
                              onChange={(e) => setEditField("categoryPrimary", e.target.value)}
                              style={{ width: "100%", padding: "10px", marginTop: "6px", borderRadius: "8px", border: "1px solid #ccc" }}
                            >
                              <option value="">Select primary category</option>
                              {getCategoryOptions(0).map((categoryItem) => (
                                <option key={categoryItem.id} value={categoryItem.name}>{categoryItem.name}</option>
                              ))}
                            </select>
                          </div>
                          <div style={{ flex: 1, minWidth: "220px" }}>
                            <select
                              aria-label="Select optional category"
                              value={editForm.categorySecondary}
                              onChange={(e) => setEditField("categorySecondary", e.target.value)}
                              style={{ width: "100%", padding: "10px", marginTop: "6px", borderRadius: "8px", border: "1px solid #ccc" }}
                            >
                              <option value="">Select optional category</option>
                              {getCategoryOptions(1).map((categoryItem) => (
                                <option key={`${categoryItem.id}-secondary`} value={categoryItem.name}>{categoryItem.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: "220px" }}>
                            <label style={{ display: "block", marginBottom: "6px", fontWeight: "600" }}>
                              Collection
                            </label>
                            <select
                              aria-label="Collection"
                              value={editForm.collection}
                              onChange={(e) => setEditField("collection", e.target.value)}
                              style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #ccc" }}
                            >
                              <option value="">Select Collection</option>
                              {visibleCollections.map((collectionItem) => (
                                <option key={collectionItem.id} value={collectionItem.name}>{collectionItem.name}</option>
                              ))}
                            </select>
                          </div>
                          <div style={{ flex: 1, minWidth: "220px" }}>
                            <label style={{ display: "block", marginBottom: "6px", fontWeight: "600" }}>
                              Type
                            </label>
                            <select
                              value={editForm.type}
                              onChange={(e) => setEditField("type", e.target.value)}
                              style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #ccc" }}
                            >
                              <option value="">Select Type</option>
                              <option value="commercial">Commercial</option>
                              <option value="editorial">Editorial</option>
                            </select>
                          </div>
                        </div>
                        <label>
                          Keywords (max 14 words, Press Tab key to set Auto - format)
                          <input
                            type="text"
                            value={editForm.keywords}
                            onChange={handleEditKeywordChange}
                            onKeyDown={handleEditKeywordKeyDown}
                            style={{ width: "100%", padding: "10px", marginTop: "6px", borderRadius: "8px", border: "1px solid #ccc" }}
                          />
                        </label>
                        <label style={{ display: "block", marginTop: "8px", fontWeight: 600 }}>
                          Change thumbnail
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => setThumbnailFile(e.target.files?.[0] || null)}
                            style={{ width: "100%", padding: "10px", marginTop: "6px", borderRadius: "8px", border: "1px solid #ccc" }}
                          />
                        </label>
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                          <button
                            onClick={updateSelectedThumbnail}
                            disabled={!thumbnailFile}
                            style={{
                              background: thumbnailFile ? "#43a047" : "#9ca3af",
                              color: "white",
                              border: "none",
                              padding: "10px 16px",
                              borderRadius: "6px",
                              cursor: thumbnailFile ? "pointer" : "not-allowed"
                            }}
                          >
                            Update Thumbnail
                          </button>
                          <button
                            onClick={saveDetails}
                            style={{
                              background: "green",
                              color: "white",
                              border: "none",
                              padding: "10px 16px",
                              borderRadius: "6px",
                              cursor: "pointer"
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={async () => {
                              setIsEditing(false);
                              setThumbnailFile(null);
                              resetEditForm(selectedImage);
                              await closeModal();
                            }}
                            style={{
                              background: "#eee",
                              color: "#222",
                              border: "none",
                              padding: "10px 16px",
                              borderRadius: "6px",
                              cursor: "pointer"
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p><strong>Description:</strong> {selectedImage.description || "Not provided"}</p>
                        <p><strong>Category:</strong> {selectedImage.category || "-"}</p>
                        <p><strong>Collection:</strong> {selectedImage.collection || "-"}</p>
                        <p><strong>Type:</strong> {selectedImage.type || "-"}</p>
                        <p><strong>Keywords:</strong> {selectedImage.keywords || "-"}</p>
                        <p><strong>Status:</strong> {selectedImage.status}</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default AdminPanel;
