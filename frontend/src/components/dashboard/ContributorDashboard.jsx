import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import {
  buildAuthHeaders,
  getEffectiveAuthToken,
} from "../../utils/authSession";
import { getAssetPreviewUrl } from "../../utils/assetPreview";
import Pagination from "../Pagination";
import ContributorAccountDashboard from "./ContributorAccountDashboard";
import ContributorAnalyticsDashboard from "./ContributorAnalyticsDashboard";
import EarningsTabPage from "./EarningsTabPage";
import "./ContributorDashboard.css";
import "./TaxCenter.css";
import TaxW8BenForm from "./TaxW8BenForm";
import { getContributorReputationTier } from "../../utils/statsUtils";

const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const navGroups = [
  { label: "", items: [["overview", "Home"]] },
  {
    label: "Earnings",
    collapsible: true,
    items: [
      ["earnings", "Earnings summary"],
      ["payments", "Payment history"],
      ["tax", "Tax center"],
    ],
  },
  {
    label: "Insights",
    collapsible: true,
    items: [
      ["top-performer", "Top performer"],
      ["blog", "Blog"],
      ["trending-content", "Trending content"],
    ],
  },
  { label: "", items: [["portfolio", "Portfolio"]] },
  {
    label: "Account",
    collapsible: true,
    items: [
      ["account-settings", "Account settings"],
      ["public-profile", "Public profile"],
    ],
  },
  { label: "", items: [["support", "Help"]] },
];

const number = (value) => Number(value || 0).toLocaleString();
const money = (value) => `₹${Number(value || 0).toFixed(2)}`;
const dateLabel = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "-";
const shortDateLabel = (value) => {
  if (!value) return "-";
  const rawValue = String(value);
  const parsedDate = new Date(
    rawValue.length === 10 ? `${rawValue}T00:00:00` : rawValue,
  );
  return Number.isNaN(parsedDate.getTime())
    ? "-"
    : parsedDate.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
};
const statusLabel = (value) =>
  String(value || "pending")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const PORTFOLIO_PAGE_SIZE = 6;
const SOLD_ASSETS_PAGE_SIZE = 6;

export default function ContributorDashboard({
  darkMode,
  username,
  reputationScore,
  reputationTier,
  branding = {},
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const taxWizardRequestedRef = useRef(false);

  const [section, setSection] = useState(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab === "account" || tab === "analytics"
      ? tab
      : tab === "earningssummary"
        ? "earnings"
        : tab === "paymenthistory"
          ? "payments"
          : tab === "taxcenter" || tab === "starttaxform"
            ? "tax"
            : "overview";
  });
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState({});
  const [earnings, setEarnings] = useState({});
  const [assets, setAssets] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [earningsOpen, setEarningsOpen] = useState(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    return (
      tab === "earningssummary" ||
      tab === "paymenthistory" ||
      tab === "taxcenter" ||
      tab === "starttaxform"
    );
  });
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [portfolioPage, setPortfolioPage] = useState(1);
  const [soldAssetPage, setSoldAssetPage] = useState(1);
  const [earningsModalOpen, setEarningsModalOpen] = useState(false);
  const [taxWizardOpen, setTaxWizardOpen] = useState(false);
  const [taxW8BenOpen, setTaxW8BenOpen] = useState(
    () =>
      new URLSearchParams(window.location.search).get("tab") === "starttaxform",
  );
  const [taxWizardAnswers, setTaxWizardAnswers] = useState({
    isUsPerson: "",
    entityType: "",
    businessEntityType: "",
  });
  const [taxForm, setTaxForm] = useState({
    isUsPerson: "No",
    entityType: "Individual",
    mailingAddress: "",
    addressLine2: "",
    city: "",
    postalCode: "",
    country: "India",
    province: "",
    phone: "",
  });
  const [taxFormEditing, setTaxFormEditing] = useState(false);
  const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;

  const submitTaxForm = async (form) => {
    await axios.post(
      `${API_BASE_URL}/profile/tax-form`,
      { ...form, formType: "W-8BEN" },
      {
        headers: buildAuthHeaders(),
      },
    );
    setProfile((current) => ({
      ...(current || {}),
      tax_form_status: "submitted",
      tax_form_type: "W-8BEN",
      tax_form_data: form,
      tax_form_submitted_at: new Date().toISOString(),
    }));
    setTaxW8BenOpen(false);
    setTaxFormEditing(false);
  };

  useEffect(() => {
    const tab = new URLSearchParams(location.search).get("tab");
    setSection(
      tab === "account" || tab === "analytics"
        ? tab
        : tab === "earningssummary"
          ? "earnings"
          : tab === "paymenthistory"
            ? "payments"
            : tab === "taxcenter" || tab === "starttaxform"
              ? "tax"
              : "overview",
    );
    if (tab === "starttaxform" && taxWizardRequestedRef.current) {
      taxWizardRequestedRef.current = false;
    } else if (tab === "starttaxform") {
      setTaxWizardOpen(false);
      setTaxW8BenOpen(true);
    } else {
      setTaxWizardOpen(false);
      setTaxW8BenOpen(false);
    }
  }, [location.search]);

  useEffect(() => {
    if (!profile) return;
    setTaxForm((current) => ({
      ...current,
      mailingAddress:
        profile.mailing_address ||
        profile.address ||
        profile.full_name ||
        profile.username ||
        current.mailingAddress,
      addressLine2:
        profile.address_line_2 || profile.addressLine2 || current.addressLine2,
      city: profile.city || current.city,
      postalCode:
        profile.postal_code || profile.postalCode || current.postalCode,
      country: profile.country || current.country,
      province: profile.province || profile.state || current.province,
      phone: profile.phone || current.phone,
    }));
  }, [profile]);

  useEffect(() => {
    if (taxW8BenOpen) setTaxWizardOpen(false);
  }, [taxW8BenOpen]);

  useEffect(() => {
    const onCreditsRedeemed = (event) => {
      const redeemedCredits = Number(event.detail?.credits || 0);
      setProfile((current) =>
        current
          ? {
              ...current,
              credits: Math.max(
                0,
                Number(current.credits || 0) - redeemedCredits,
              ),
            }
          : current,
      );
    };
    window.addEventListener("creditsRedeemed", onCreditsRedeemed);
    return () =>
      window.removeEventListener("creditsRedeemed", onCreditsRedeemed);
  }, []);

  useEffect(() => {
    const onTaxFormRequest = (event) => {
      if (
        event.target.closest(".tax-link-button")?.textContent?.trim() ===
        "Submit a new tax form"
      ) {
        taxWizardRequestedRef.current = true;
        setTaxWizardOpen(true);
        navigate("/dashboard?tab=starttaxform");
      }
    };
    document.addEventListener("click", onTaxFormRequest);
    return () => document.removeEventListener("click", onTaxFormRequest);
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setLoading(false);
      return undefined;
    }
    const headers = buildAuthHeaders(token);
    const loadDashboardData = () => {
      const requestConfig = { headers, params: { _ts: Date.now() } };
      return Promise.allSettled([
        axios.get(`${API_BASE_URL}/profile`, requestConfig),
        axios.get(`${API_BASE_URL}/profile/stats`, requestConfig),
        axios.get(`${API_BASE_URL}/dashboard-stats`, requestConfig),
        axios.get(`${API_BASE_URL}/earnings-dashboard`, requestConfig),
        axios.get(`${API_BASE_URL}/my-uploads?view=all`, requestConfig),
        axios.get(
          `${API_BASE_URL}/notifications/${encodeURIComponent(username || "")}`,
          requestConfig,
        ),
      ]).then((results) => {
        if (!mounted) return;
        const [
          profileResult,
          statsResult,
          dashboardStatsResult,
          earningsResult,
          assetsResult,
          notificationsResult,
        ] = results;
        if (profileResult.status === "fulfilled")
          setProfile(
            profileResult.value.data?.user || profileResult.value.data,
          );
        if (statsResult.status === "fulfilled")
          setStats((current) => ({
            ...current,
            ...(statsResult.value.data || {}),
          }));
        if (dashboardStatsResult.status === "fulfilled")
          setStats((current) => ({
            ...current,
            ...(dashboardStatsResult.value.data || {}),
          }));
        if (earningsResult.status === "fulfilled")
          setEarnings(earningsResult.value.data || {});
        if (assetsResult.status === "fulfilled")
          setAssets(
            Array.isArray(assetsResult.value.data)
              ? assetsResult.value.data
              : [],
          );
        if (notificationsResult.status === "fulfilled")
          setNotifications(
            Array.isArray(notificationsResult.value.data)
              ? notificationsResult.value.data
              : [],
          );
        if (results.every((result) => result.status === "rejected"))
          setError("We could not load your contributor workspace.");
        setLoading(false);
      });
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadDashboardData();
    };
    const refreshInterval = window.setInterval(loadDashboardData, 5000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    loadDashboardData();

    return () => {
      mounted = false;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [token, username]);

  const displayName =
    profile?.full_name || profile?.username || username || "Contributor";
  const totalEarningsValue = Number(
    earnings.total_earnings ?? stats.total_earnings ?? 0,
  );
  const availableBalanceValue = Number(
    earnings.available_balance ??
      earnings.unpaid_earnings ??
      totalEarningsValue ??
      0,
  );
  const last30DaysEarnings = Number(
    earnings.earnings_last_30_days ?? earnings.earningsLast30Days ?? 0,
  );
  const last7DaysEarnings = Number(
    earnings.earnings_last_7_days ?? earnings.earningsLast7Days ?? 0,
  );
  const weeklyEarnings = Array.isArray(earnings.earnings_weekly)
    ? earnings.earnings_weekly.slice(-7)
    : [];
  const dailyEarnings = Array.isArray(earnings.earnings_daily)
    ? earnings.earnings_daily.slice(-30)
    : [];
  const soldAssets = Array.isArray(earnings.sold_assets)
    ? earnings.sold_assets
    : [];
  const weeklyValues =
    weeklyEarnings.length === 7
      ? weeklyEarnings.map((entry) => Number(entry.amount || 0))
      : Array(7).fill(0);
  const weeklyMax = Math.max(1, ...weeklyValues);
  const weeklyTrend = weeklyValues.map((value) => ({
    value,
    height: Math.max(value > 0 ? 12 : 4, (value / weeklyMax) * 100),
  }));
  const dailyValues = dailyEarnings.map((entry) => Number(entry.amount || 0));
  const dailyMax = Math.max(1, ...dailyValues);
  const dailyTrend = dailyEarnings.map((entry, index) => ({
    date: entry.date,
    value: dailyValues[index],
    height: Math.max(
      dailyValues[index] > 0 ? 12 : 3,
      (dailyValues[index] / dailyMax) * 100,
    ),
  }));
  const approved = Number(stats.approved_images || 0);
  const rejected = Number(stats.rejected_images || 0);
  const dashboardReputationScore = (() => {
    const uploadCount = Number(stats.uploads ?? stats.total_uploads ?? 0);
    const downloadCount = Number(stats.downloads ?? stats.total_downloads ?? 0);
    const viewCount = Number(stats.views ?? stats.total_views ?? 0);
    if (viewCount <= 0) return 0;
    return Number(
      ((uploadCount + downloadCount) / Math.max(1, viewCount)).toFixed(2),
    );
  })();
  const dashboardReputationTier = getContributorReputationTier(
    dashboardReputationScore,
  );
  const unread = notifications.filter((item) => !item.is_read).length;
  const recentAssets = useMemo(() => assets.slice(0, 6), [assets]);
  const approvedAssets = useMemo(
    () =>
      assets.filter(
        (asset) => String(asset.status || "").toLowerCase() === "approved",
      ),
    [assets],
  );
  const portfolioPageCount = Math.max(
    1,
    Math.ceil(approvedAssets.length / PORTFOLIO_PAGE_SIZE),
  );
  const visiblePortfolioAssets = approvedAssets.slice(
    (portfolioPage - 1) * PORTFOLIO_PAGE_SIZE,
    portfolioPage * PORTFOLIO_PAGE_SIZE,
  );
  const soldAssetPageCount = Math.max(
    1,
    Math.ceil(soldAssets.length / SOLD_ASSETS_PAGE_SIZE),
  );
  const visibleSoldAssets = soldAssets.slice(
    (soldAssetPage - 1) * SOLD_ASSETS_PAGE_SIZE,
    soldAssetPage * SOLD_ASSETS_PAGE_SIZE,
  );
  useEffect(() => {
    setSoldAssetPage((currentPage) =>
      Math.min(currentPage, soldAssetPageCount),
    );
  }, [soldAssetPageCount]);
  const go = (key) => {
    if (key === "upload") {
      navigate("/upload");
      return;
    }
    if (key === "assets") {
      navigate("/myuploads");
      return;
    }
    if (key === "earnings") {
      navigate("/dashboard?tab=earningssummary");
      return;
    }
    if (key === "payments") {
      navigate("/dashboard?tab=paymenthistory");
      return;
    }
    if (key === "tax") {
      navigate("/dashboard?tab=taxcenter");
      return;
    }
    if (key === "portfolio") {
      setPortfolioPage(1);
      setSection("portfolio");
      return;
    }
    if (key === "account-settings") {
      navigate("/account-settings");
      return;
    }
    if (key === "public-profile") {
      navigate("/public-profile");
      return;
    }
    if (key === "favorites") {
      navigate("/favorites");
      return;
    }
    if (key === "support") {
      navigate("/contact");
      return;
    }
    if (key === "analytics" || key === "account") {
      navigate(`/dashboard?tab=${key}`);
      return;
    }
    setSection(key);
  };

  if (loading)
    return (
      <div className={`contributor-shell ${darkMode ? "is-dark" : ""}`}>
        <div className="contributor-loading">
          <span />
          <span />
          <span />
        </div>
      </div>
    );

  return (
    <div
      className={`contributor-shell ${darkMode ? "is-dark" : ""} ${section === "account" ? "account-only" : ""}`}
    >
      {section !== "analytics" && (
        <aside className="contributor-sidebar">
          <div className="contributor-nav">
            {navGroups.map((group, groupIndex) => (
              <div key={`${group.label || "main"}-${groupIndex}`}>
                {group.collapsible ? (
                  <>
                    <button
                      type="button"
                      className={
                        (
                          group.label === "Earnings"
                            ? earningsOpen
                            : group.label === "Insights"
                              ? insightsOpen
                              : accountOpen
                        )
                          ? "is-active"
                          : ""
                      }
                      onClick={() =>
                        group.label === "Earnings"
                          ? setEarningsOpen((isOpen) => !isOpen)
                          : group.label === "Insights"
                            ? setInsightsOpen((isOpen) => !isOpen)
                            : setAccountOpen((isOpen) => !isOpen)
                      }
                      aria-expanded={
                        group.label === "Earnings"
                          ? earningsOpen
                          : group.label === "Insights"
                            ? insightsOpen
                            : accountOpen
                      }
                    >
                      {group.label}{" "}
                      <span aria-hidden="true">
                        {(
                          group.label === "Earnings"
                            ? earningsOpen
                            : group.label === "Insights"
                              ? insightsOpen
                              : accountOpen
                        )
                          ? "−"
                          : "+"}
                      </span>
                    </button>
                    {(group.label === "Earnings"
                      ? earningsOpen
                      : group.label === "Insights"
                        ? insightsOpen
                        : accountOpen) && (
                      <div className="contributor-subnav">
                        {group.items.map(([key, label]) => (
                          <button
                            key={key}
                            className={section === key ? "is-active" : ""}
                            onClick={() => go(key)}
                            type="button"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  group.items.map(([key, label]) => (
                    <button
                      key={key}
                      className={section === key ? "is-active" : ""}
                      onClick={() => go(key)}
                      type="button"
                    >
                      {label}
                      {key === "notifications" && unread > 0 && (
                        <em>{unread}</em>
                      )}
                    </button>
                  ))
                )}
              </div>
            ))}
          </div>
        </aside>
      )}
      <main className="contributor-main">
        <header className="contributor-header">
          <div className="contributor-avatar">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <span className="contributor-kicker">Contributor studio</span>
            <h1>Welcome back, {displayName.split(" ")[0]}</h1>
            <p>
              @{profile?.username || username || "creator"} ·{" "}
              {profile?.email || "Your creator account"}
            </p>
          </div>
        </header>
        {error && (
          <div className="contributor-error">
            <span>{error}</span>
            <button type="button" onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        )}
        <section
          className="contributor-hero contributor-rank-banner"
          aria-label="Contributor banner"
          style={
            branding.contributorBanner
              ? {
                  backgroundImage: `url(${API_BASE_URL}${branding.contributorBanner})`,
                }
              : undefined
          }
        />
        {section === "tax" && (
          <section className="tax-center-section">
            <div className="tax-center-heading">
              <h2>Tax center</h2>
            </div>
            <div className="tax-center-block">
              <div className="tax-block-heading">
                <h3>Your most recent document</h3>
              </div>
              {profile?.tax_form_status === "submitted" ? (
                <div className="tax-document-row">
                  <span>
                    Form {profile.tax_form_type || "W-8BEN"}{" "}
                    <strong>
                      submitted
                      {profile.tax_form_submitted_at
                        ? ` on ${dateLabel(profile.tax_form_submitted_at)}`
                        : ""}
                    </strong>
                  </span>
                  <button
                    type="button"
                    className="tax-link-button"
                    onClick={() =>
                      navigate("/dashboard?tab=filltaxform_review", {
                        state: {
                          formType: profile.tax_form_type || "W-8BEN",
                          formData: profile.tax_form_data || {},
                        },
                      })
                    }
                  >
                    View
                  </button>
                </div>
              ) : (
                <div className="tax-document-row">
                  <span>No tax form submitted yet.</span>
                  <button
                    type="button"
                    className="tax-link-button"
                    onClick={() => setTaxFormEditing(true)}
                  >
                    Submit a tax form
                  </button>
                </div>
              )}
            </div>
            <div className="tax-center-block">
              <div className="tax-block-heading">
                <h3>Your tax profile</h3>
                <button
                  type="button"
                  className="tax-link-button"
                  onClick={() => setTaxFormEditing(true)}
                >
                  Submit a new tax form
                </button>
              </div>
              <div className="tax-form-grid">
                <label>
                  For U.S. tax purposes, are you a U.S. person?{" "}
                  <select
                    disabled={!taxFormEditing}
                    value={taxForm.isUsPerson}
                    onChange={(event) =>
                      setTaxForm((current) => ({
                        ...current,
                        isUsPerson: event.target.value,
                      }))
                    }
                  >
                    <option>No</option>
                    <option>Yes</option>
                  </select>
                </label>
                <label>
                  Are you contributing as an individual or as a business?{" "}
                  <select
                    disabled={!taxFormEditing}
                    value={taxForm.entityType}
                    onChange={(event) =>
                      setTaxForm((current) => ({
                        ...current,
                        entityType: event.target.value,
                      }))
                    }
                  >
                    <option>Individual</option>
                    <option>Business</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="tax-center-block">
              <div className="tax-block-heading">
                <h3>Your address</h3>
              </div>
              <div className="tax-address-form">
                {[
                  ["Mailing Address", "mailingAddress"],
                  ["Address line 2 (Apartment #, street #)", "addressLine2"],
                  ["City", "city"],
                  ["Postal/Zip code", "postalCode"],
                  ["Province", "province"],
                  ["Phone", "phone"],
                ].map(([label, key]) => (
                  <label key={key}>
                    {label}
                    <input
                      disabled={!taxFormEditing}
                      value={taxForm[key]}
                      onChange={(event) =>
                        setTaxForm((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
                <label>
                  Country
                  <select
                    disabled={!taxFormEditing}
                    value={taxForm.country}
                    onChange={(event) =>
                      setTaxForm((current) => ({
                        ...current,
                        country: event.target.value,
                      }))
                    }
                  >
                    <option>India</option>
                    <option>United States</option>
                    <option>United Kingdom</option>
                    <option>Canada</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="tax-center-actions">
              <button
                type="button"
                className="tax-cancel-button"
                onClick={() => setTaxFormEditing(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="tax-save-button"
                disabled={!taxFormEditing}
                onClick={() => setTaxFormEditing(false)}
              >
                Save
              </button>
            </div>
          </section>
        )}
        {section === "earnings" && (
          <section className="contributor-section sold-assets-section">
            <div className="contributor-section-heading">
              <div>
                <span className="contributor-kicker">Earnings summary</span>
                <h2>Sold asset transactions</h2>
              </div>
              <span className="section-count">{soldAssets.length} sales</span>
            </div>
            {soldAssets.length ? (
              <>
                <div className="sold-assets-list">
                  {visibleSoldAssets.map((asset) => {
                    const assetTitle =
                      asset.title || asset.filename || "Untitled asset";
                    return (
                      <article
                        className="sold-asset-card"
                        key={asset.sale_id || `${asset.id}-${asset.sold_at}`}
                      >
                        <div className="sold-asset-card-heading">
                          <span className="contributor-kicker">
                            Sale{" "}
                            {asset.sale_id ? `#${asset.sale_id}` : "record"}
                          </span>
                          <strong className="sold-asset-earnings">
                            {money(asset.earnings)}
                          </strong>
                        </div>
                        <div className="sold-asset-card-body">
                          <div className="sold-asset-thumb">
                            <img
                              src={getAssetPreviewUrl(asset, {
                                quality: 60,
                                watermark: false,
                              })}
                              alt={assetTitle}
                              loading="lazy"
                            />
                          </div>
                          <div className="sold-asset-info">
                            <h3>{assetTitle}</h3>
                            <p className="sold-asset-sale-line">
                              <strong>{assetTitle}</strong> sold for{" "}
                              <strong>{money(asset.earnings)}</strong>
                            </p>
                            <div className="sold-asset-metrics">
                              <span>
                                Sold on{" "}
                                <strong>
                                  {dateLabel(asset.sold_at || asset.created_at)}
                                </strong>
                              </span>
                              <span>
                                Order <strong>{asset.order_id || "-"}</strong>
                              </span>
                              <span>
                                Asset downloads{" "}
                                <strong>{asset.downloads}</strong>
                              </span>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <Pagination
                  currentPage={soldAssetPage}
                  totalPages={soldAssetPageCount}
                  totalImages={soldAssets.length}
                  setCurrentPage={setSoldAssetPage}
                  darkMode={darkMode}
                />
              </>
            ) : (
              <div className="contributor-empty">
                <h3>No sold assets yet</h3>
                <p>
                  Assets with completed contributor earnings will appear here.
                </p>
              </div>
            )}
          </section>
        )}
        {section === "portfolio" && (
          <section className="contributor-section contributor-portfolio-section">
            <div className="contributor-section-heading">
              <div>
                <span className="contributor-kicker">Portfolio</span>
                <h2>Approved assets</h2>
              </div>
              <span className="section-count">
                {approvedAssets.length} assets
              </span>
            </div>
            {approvedAssets.length ? (
              <>
                <div className="contributor-assets">
                  {visiblePortfolioAssets.map((asset) => (
                    <article
                      className="contributor-asset"
                      key={asset.id || asset.image_id}
                    >
                      <img
                        src={getAssetPreviewUrl(asset, {
                          quality: 65,
                          watermark: false,
                        })}
                        alt={asset.title || "Asset preview"}
                        loading="lazy"
                      />
                      <span>
                        <strong>
                          {asset.title || asset.filename || "Untitled asset"}
                        </strong>
                        <small>{number(asset.downloads)} downloads</small>
                      </span>
                    </article>
                  ))}
                </div>
                {portfolioPageCount > 1 && (
                  <Pagination
                    currentPage={portfolioPage}
                    totalPages={portfolioPageCount}
                    totalImages={approvedAssets.length}
                    setCurrentPage={setPortfolioPage}
                    darkMode={darkMode}
                  />
                )}
              </>
            ) : (
              <div className="contributor-empty">
                <h3>No approved assets yet</h3>
                <p>Approved contributor assets will appear here.</p>
              </div>
            )}
          </section>
        )}
        {section === "account" && (
          <ContributorAccountDashboard
            darkMode={darkMode}
            profile={profile || {}}
            stats={stats}
            assets={assets}
            reputationScore={reputationScore}
            reputationTier={reputationTier}
            onNavigate={go}
          />
        )}
        {section === "overview" && (
          <>
            <EarningsTabPage
              reputationScore={dashboardReputationScore}
              reputationTier={dashboardReputationTier}
              totalEarnings={
                earnings.total_earnings || stats.total_earnings || 0
              }
              totalDownloads={
                stats.downloads ??
                stats.total_downloads ??
                earnings.total_downloads ??
                0
              }
              totalUploads={stats.uploads ?? stats.total_uploads ?? 0}
              likes={stats.total_likes || stats.likes || 0}
              views={stats.total_views || stats.views || 0}
              monthsOld={profile?.months_old || profile?.monthsOld || 1}
              assets={assets}
              darkMode={darkMode}
              downloadsToday={
                stats.downloads_today ?? stats.downloadsToday ?? 0
              }
              downloadsLast7Days={
                stats.downloads_last_7_days ?? stats.downloadsLast7Days ?? 0
              }
              downloadsLast30Days={
                stats.downloads_last_30_days ?? stats.downloadsLast30Days ?? 0
              }
              downloadsLast365Days={
                stats.downloads_last_365_days ?? stats.downloadsLast365Days ?? 0
              }
              uploadsToday={stats.uploads_today ?? stats.uploadsToday ?? 0}
              uploadsLast7Days={
                stats.uploads_last_7_days ?? stats.uploadsLast7Days ?? 0
              }
              uploadsLast30Days={
                stats.uploads_last_30_days ?? stats.uploadsLast30Days ?? 0
              }
              uploadsLast365Days={
                stats.uploads_last_365_days ?? stats.uploadsLast365Days ?? 0
              }
              earningsToday={
                earnings.earnings_today ?? earnings.earningsToday ?? 0
              }
              earningsLast7Days={
                earnings.earnings_last_7_days ?? earnings.earningsLast7Days ?? 0
              }
              earningsLast30Days={
                earnings.earnings_last_30_days ??
                earnings.earningsLast30Days ??
                0
              }
              earningsLast365Days={
                earnings.earnings_last_365_days ??
                earnings.earningsLast365Days ??
                0
              }
            />
            <div className="contributor-section-heading">
              <div>
                <span className="contributor-kicker">Portfolio pulse</span>
                <h2>Your creative business</h2>
              </div>
              <button type="button" onClick={() => go("assets")}>
                Manage assets <span>→</span>
              </button>
            </div>
            <section className="contributor-grid contributor-grid-main">
              <article
                className="contributor-panel earnings-panel earnings-panel-clickable"
                role="button"
                tabIndex="0"
                aria-label="Open last 30 days earnings"
                onClick={() => setEarningsModalOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setEarningsModalOpen(true);
                  }
                }}
              >
                <div className="panel-heading">
                  <div>
                    <span className="contributor-kicker">
                      Earnings · Last 7 weeks
                    </span>
                    <h3>{money(totalEarningsValue)}</h3>
                  </div>
                  <span className="panel-trend">View 30 days</span>
                </div>
                <div
                  className="mini-chart"
                  aria-label="Last 7 weeks earnings trend"
                >
                  {weeklyTrend.map((bar, index) => (
                    <span
                      className="mini-chart-item"
                      key={`earnings-week-${index}`}
                    >
                      <strong>{money(bar.value)}</strong>
                      <i
                        title={`₹${bar.value.toFixed(2)}`}
                        style={{ height: `${bar.height}%` }}
                      />
                      <small>
                        {shortDateLabel(weeklyEarnings[index]?.date) ||
                          `W${index + 1}`}
                      </small>
                    </span>
                  ))}
                </div>
                <div className="panel-foot">
                  <span>Available balance</span>
                  <strong>{money(availableBalanceValue)}</strong>
                </div>
              </article>
              <article className="contributor-panel">
                <div className="panel-heading">
                  <div>
                    <span className="contributor-kicker">
                      Asset performance
                    </span>
                    <h3>
                      {number(stats.total_views)} <small>views</small>
                    </h3>
                  </div>
                </div>
                <div className="performance-rows">
                  <span>
                    <b
                      style={{
                        width: `${Math.min(100, approved > 0 ? (approved / Math.max(approved + rejected, 1)) * 100 : 0)}%`,
                      }}
                    />
                    Approved assets <strong>{approved}</strong>
                  </span>
                  <span>
                    <b
                      style={{
                        width: `${Math.min(100, rejected > 0 ? (rejected / Math.max(approved + rejected, 1)) * 100 : 0)}%`,
                      }}
                    />
                    Rejected assets <strong>{rejected}</strong>
                  </span>
                  <span>
                    <b
                      style={{
                        width: `${Math.min(100, Number(stats.total_downloads || 0) > 0 ? (Number(stats.total_downloads || 0) / Math.max(Number(stats.total_downloads || 0), 1)) * 100 : 0)}%`,
                      }}
                    />
                    Downloads <strong>{number(stats.total_downloads)}</strong>
                  </span>
                </div>
              </article>
            </section>
            <section className="contributor-section" id="contributor-analytics">
              <div className="contributor-section-heading">
                <div>
                  <span className="contributor-kicker">Latest work</span>
                  <h2>Recent uploads</h2>
                </div>
                <span className="section-count">{assets.length} assets</span>
              </div>
              {recentAssets.length ? (
                <div className="contributor-assets">
                  {recentAssets.map((asset) => {
                    const assetId = asset.id || asset.image_id;
                    const assetSlug = String(
                      asset.title || asset.filename || "asset",
                    )
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, "");
                    return (
                      <button
                        type="button"
                        className="contributor-asset"
                        key={assetId}
                        onClick={() =>
                          navigate(`/asset/${assetSlug}-${assetId}`)
                        }
                      >
                        <img
                          src={getAssetPreviewUrl(asset, {
                            quality: 65,
                            watermark: false,
                          })}
                          alt={asset.title || "Asset preview"}
                          loading="lazy"
                        />
                        <span>
                          <strong>
                            {asset.title || asset.filename || "Untitled asset"}
                          </strong>
                          <small>
                            {statusLabel(asset.status)} ·{" "}
                            {number(asset.downloads)} downloads
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="contributor-empty">
                  <h3>Your portfolio starts here</h3>
                  <p>
                    Upload your first asset and track its journey from
                    processing to marketplace.
                  </p>
                  <button type="button" onClick={() => go("upload")}>
                    Upload an asset
                  </button>
                </div>
              )}
            </section>
            <section className="contributor-grid contributor-grid-lower">
              <article className="contributor-panel">
                <div className="panel-heading">
                  <div>
                    <span className="contributor-kicker">Momentum</span>
                    <h3>Creator goals</h3>
                  </div>
                </div>
                <div className="goal">
                  <span>
                    <strong>Upload consistently</strong>
                    <small>{approved} of 10 approved assets</small>
                  </span>
                  <b>
                    <i style={{ width: `${Math.min(100, approved * 10)}%` }} />
                  </b>
                </div>
                <div className="goal">
                  <span>
                    <strong>Reach more customers</strong>
                    <small>
                      {number(stats.total_downloads)} of 100 downloads
                    </small>
                  </span>
                  <b>
                    <i
                      style={{
                        width: `${Math.min(100, Number(stats.total_downloads || 0))}%`,
                      }}
                    />
                  </b>
                </div>
              </article>
              <article className="contributor-panel">
                <div className="panel-heading">
                  <div>
                    <span className="contributor-kicker">Activity</span>
                    <h3>Latest updates</h3>
                  </div>
                  <button
                    className="panel-link"
                    type="button"
                    onClick={() => go("notifications")}
                  >
                    View all
                  </button>
                </div>
                {notifications.slice(0, 3).map((item) => (
                  <div className="activity-item" key={item.id}>
                    <span className="activity-dot" />
                    <div>
                      <strong>
                        {item.message || "Your account has a new update."}
                      </strong>
                      <small>{dateLabel(item.created_at)}</small>
                    </div>
                  </div>
                ))}
                {notifications.length === 0 && (
                  <p className="muted-copy">You are all caught up.</p>
                )}
              </article>
            </section>
          </>
        )}
        {earningsModalOpen && (
          <div
            className="earnings-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget)
                setEarningsModalOpen(false);
            }}
          >
            <section
              className="earnings-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="earnings-modal-title"
            >
              <div className="earnings-modal-heading">
                <div>
                  <span className="contributor-kicker">Earnings detail</span>
                  <h2 id="earnings-modal-title">Last 30 days</h2>
                  <p>Daily earnings by date</p>
                </div>
                <button
                  type="button"
                  className="earnings-modal-close"
                  aria-label="Close earnings detail"
                  onClick={() => setEarningsModalOpen(false)}
                >
                  ×
                </button>
              </div>
              {dailyTrend.length ? (
                <div className="earnings-modal-scroll">
                  <div className="earnings-modal-bars">
                    {dailyTrend.map((bar) => (
                      <div className="earnings-modal-bar" key={bar.date}>
                        <strong>{money(bar.value)}</strong>
                        <i
                          style={{ height: `${bar.height}%` }}
                          title={`${shortDateLabel(bar.date)}: ${money(bar.value)}`}
                        />
                        <small>{shortDateLabel(bar.date)}</small>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="earnings-modal-empty">
                  No daily earnings data is available yet.
                </p>
              )}
              <div className="earnings-modal-footer">
                <span>Last 30 days total</span>
                <strong>{money(last30DaysEarnings)}</strong>
              </div>
            </section>
          </div>
        )}
        {section === "analytics" && (
          <ContributorAnalyticsDashboard
            darkMode={darkMode}
            profile={profile || {}}
            stats={stats}
            earnings={earnings}
            assets={assets}
            reputationScore={reputationScore}
            reputationTier={reputationTier}
          />
        )}
        {(taxWizardOpen ||
          new URLSearchParams(location.search).get("tab") ===
            "starttaxform") && (
          <div className="tax-wizard-backdrop">
            <section
              className="tax-wizard"
              role="dialog"
              aria-modal="true"
              aria-labelledby="tax-wizard-title"
            >
              <h2 id="tax-wizard-title">Tax center</h2>
              <p>
                Before we can pay you,{" "}
                <span className="brand-name">GFXunlimit</span> needs to have
                your correct tax form on file.
              </p>
              <p>
                While we can't give you tax or legal advice, we've created the
                following questions to help you choose the best tax form and
                make your own decision about how to comply with applicable U.S.
                tax laws. If you still have questions after reviewing the
                information we've provided, please contact your legal and/or tax
                advisor.
              </p>
              <p>
                Please answer the following questions to help us determine which
                tax form is appropriate for your situation:
              </p>
              <div className="tax-wizard-questions">
                <label>
                  For U.S. tax purposes, are you a U.S. person?{" "}
                  <span aria-hidden="true">*</span>
                  <select
                    value={taxWizardAnswers.isUsPerson}
                    onChange={(event) =>
                      setTaxWizardAnswers((current) => ({
                        ...current,
                        isUsPerson: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select</option>
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                </label>
                <label>
                  <span className="tax-question-text">
                    Are you contributing to{" "}
                    <span className="brand-name">GFXunlimit</span> as an
                    individual or as a business?
                  </span>
                  <span aria-hidden="true">*</span>
                  <select
                    value={taxWizardAnswers.entityType}
                    onChange={(event) =>
                      setTaxWizardAnswers((current) => ({
                        ...current,
                        entityType: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select</option>
                    <option value="Individual">Individual</option>
                    <option value="Business">Business</option>
                  </select>
                </label>
                {taxWizardAnswers.isUsPerson === "No" &&
                  taxWizardAnswers.entityType === "Business" && (
                    <label className="tax-wizard-conditional-question">
                      <span className="tax-question-text">
                        Are you representing a Partnership, a Disregarded
                        Entity, a Flow-Through Entity, an Intermediary, a Trust
                        or an Estate?
                      </span>
                      <span aria-hidden="true">*</span>
                      <select
                        value={taxWizardAnswers.businessEntityType}
                        onChange={(event) =>
                          setTaxWizardAnswers((current) => ({
                            ...current,
                            businessEntityType: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select</option>
                        <option>Partnership</option>
                        <option>Disregarded Entity</option>
                        <option>Flow-Through Entity</option>
                        <option>Intermediary</option>
                        <option>Trust</option>
                        <option>Estate</option>
                      </select>
                    </label>
                  )}
              </div>
              <div className="tax-wizard-actions">
                <button
                  type="button"
                  className="tax-cancel-button"
                  onClick={() => setTaxWizardOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="tax-save-button"
                  disabled={
                    !taxWizardAnswers.isUsPerson || !taxWizardAnswers.entityType
                  }
                  onClick={() => {
                    setTaxForm((current) => ({
                      ...current,
                      isUsPerson: taxWizardAnswers.isUsPerson,
                      entityType: taxWizardAnswers.entityType,
                    }));
                    setTaxWizardOpen(false);
                    setTaxW8BenOpen(true);
                  }}
                >
                  Submit
                </button>
              </div>
            </section>
          </div>
        )}
        {taxW8BenOpen && (
          <TaxW8BenForm
            onBack={() => setTaxW8BenOpen(false)}
            onSubmit={submitTaxForm}
          />
        )}
      </main>
    </div>
  );
}
