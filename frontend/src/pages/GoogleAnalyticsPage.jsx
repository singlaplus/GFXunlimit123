import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/apiBaseUrl";
import { buildAuthHeaders } from "../utils/authSession";
import {
  extractGoogleTagIdsFromSnippet,
  normalizeGoogleAnalyticsMeasurementId,
  normalizeGoogleTagManagerId,
} from "../utils/googleAnalyticsTag";
import "./GoogleAnalyticsPage.css";

const DEFAULT_ANALYTICS_REDIRECT_URI = `${API_BASE_URL}/google-analytics/oauth/callback`;
const ANALYTICS_REPORT_NAVIGATION = [
  {
    label: "Reports",
    items: [
      { id: "overview", label: "Reports snapshot", description: "An overview of users, sessions, and page views." },
      { id: "realtime", label: "Realtime", description: "Activity during the selected time window." },
    ],
  },
  {
    label: "Lifecycle",
    items: [
      { id: "acquisition-overview", label: "Acquisition overview", description: "How visitors discover your website." },
      { id: "user-acquisition", label: "User acquisition", description: "Channels that brought new users." },
      { id: "traffic-acquisition", label: "Traffic acquisition", description: "Channels driving sessions and engagement." },
      { id: "engagement-overview", label: "Engagement overview", description: "How visitors interact with your site." },
      { id: "events", label: "Events", description: "Events recorded by your GA4 property." },
      { id: "pages-screens", label: "Pages and screens", description: "The pages and screens visitors view." },
      { id: "landing-pages", label: "Landing pages", description: "Pages where visitors begin a session." },
      { id: "monetization-overview", label: "Monetization overview", description: "Revenue and purchase activity." },
      { id: "ecommerce-purchases", label: "E-commerce purchases", description: "Product views, cart activity, and purchases." },
      { id: "retention", label: "Retention", description: "Active, new, and total users over time." },
    ],
  },
  {
    label: "User",
    items: [
      { id: "demographics", label: "Demographics", description: "Audience activity by country." },
      { id: "tech-details", label: "Tech details", description: "Audience activity by device category." },
    ],
  },
];

const ANALYTICS_DATE_RANGES = [
  { value: "last30min", label: "Last 30 minutes" },
  { value: "last1hour", label: "Last 1 hour" },
  { value: "last2hours", label: "Last 2 hours" },
  { value: "last4hours", label: "Last 4 hours" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7daysAgo", label: "Last 7 days" },
  { value: "28daysAgo", label: "Last 28 days" },
  { value: "90daysAgo", label: "Last 90 days" },
  { value: "365daysAgo", label: "Last 12 months" },
];

const ANALYTICS_METRIC_LABELS = {
  activeUsers: "Active users",
  newUsers: "New users",
  totalUsers: "Total users",
  sessions: "Sessions",
  screenPageViews: "Page views",
  eventCount: "Events",
  engagedSessions: "Engaged sessions",
  engagementRate: "Engagement rate",
  userEngagementDuration: "Engagement time (seconds)",
  keyEvents: "Key events",
  totalRevenue: "Total revenue",
  purchaseRevenue: "Purchase revenue",
  ecommercePurchases: "E-commerce purchases",
  itemsViewed: "Items viewed",
  itemsAddedToCart: "Items added to cart",
  itemsPurchased: "Items purchased",
  itemRevenue: "Item revenue",
  returningUsers: "Returning users",
};

function formatAnalyticsMetric(value, metricName) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return value || "—";
  if (metricName.toLowerCase().includes("revenue")) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(numericValue);
  }
  if (metricName.toLowerCase().includes("rate")) {
    return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(numericValue);
  }
  return new Intl.NumberFormat().format(numericValue);
}

export default function GoogleAnalyticsPage({ darkMode = false }) {
  const [connectionMessage, setConnectionMessage] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showManualSetup, setShowManualSetup] = useState(false);
  const [showOAuthConfig, setShowOAuthConfig] = useState(false);
  const [tagType, setTagType] = useState("ga4");
  const [oauthRedirectUri, setOAuthRedirectUri] = useState(DEFAULT_ANALYTICS_REDIRECT_URI);
  const [oauthTokenKey, setOAuthTokenKey] = useState("");
  const [oauthConfigError, setOAuthConfigError] = useState("");
  const [measurementId, setMeasurementId] = useState("");
  const [tagManagerId, setTagManagerId] = useState("");
  const [tagSnippet, setTagSnippet] = useState("");
  const [savedMeasurementId, setSavedMeasurementId] = useState("");
  const [savedTagManagerId, setSavedTagManagerId] = useState("");
  const [googleConnection, setGoogleConnection] = useState({
    configured: false,
    connected: false,
    accountEmail: "",
    missingConfiguration: [],
    redirectUri: "",
    tokenKeyConfigured: false,
    usingSearchConsoleOAuthCredentials: false,
  });
  const [analyticsProperties, setAnalyticsProperties] = useState([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [activeReportId, setActiveReportId] = useState("overview");
  const [analyticsDateRange, setAnalyticsDateRange] = useState("28daysAgo");
  const [hasSelectedAnalyticsDateRange, setHasSelectedAnalyticsDateRange] = useState(false);
  const [analyticsReport, setAnalyticsReport] = useState(null);
  const [analyticsReportError, setAnalyticsReportError] = useState("");
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [reportRefreshKey, setReportRefreshKey] = useState(0);
  const [tagError, setTagError] = useState("");
  const [isLoadingTag, setIsLoadingTag] = useState(true);
  const [isLoadingConnection, setIsLoadingConnection] = useState(true);
  const [isSavingTag, setIsSavingTag] = useState(false);
  const [isSavingOAuthConfig, setIsSavingOAuthConfig] = useState(false);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isDisconnectingGoogle, setIsDisconnectingGoogle] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");
  const dialogRef = useRef(null);
  const connectButtonRef = useRef(null);
  const oauthPopupRef = useRef(null);
  const oauthPopupMonitorRef = useRef(null);
  const selectedReportDateRange = activeReportId === "realtime" && !hasSelectedAnalyticsDateRange
    ? "last30min"
    : analyticsDateRange;
  const isLiveRealtime = activeReportId === "realtime" && selectedReportDateRange === "last30min";

  useEffect(() => {
    let active = true;

    axios.get(`${API_BASE_URL}/admin/google-analytics/tag`, { headers: buildAuthHeaders() })
      .then(({ data }) => {
        if (!active) return;
        const savedMeasurement = normalizeGoogleAnalyticsMeasurementId(data?.measurementId || "");
        const savedTagManager = normalizeGoogleTagManagerId(data?.tagManagerId || "");
        if (savedMeasurement === null || savedTagManager === null) {
          throw new Error("The server returned an invalid Google tag ID.");
        }
        setSavedMeasurementId(savedMeasurement);
        setSavedTagManagerId(savedTagManager);
        setMeasurementId(savedMeasurement);
        setTagManagerId(savedTagManager);
        setTagType(savedMeasurement || !savedTagManager ? "ga4" : "gtm");
      })
      .catch((error) => {
        if (active) {
          setTagError(error.response?.data?.error || "Unable to load the saved Google Analytics tag.");
        }
      })
      .finally(() => {
        if (active) setIsLoadingTag(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    axios.get(`${API_BASE_URL}/admin/google-analytics/connection`, { headers: buildAuthHeaders() })
      .then(({ data }) => {
        if (!active) return;
        setGoogleConnection({
          configured: Boolean(data?.configured),
          connected: Boolean(data?.connected),
          accountEmail: typeof data?.accountEmail === "string" ? data.accountEmail : "",
          missingConfiguration: Array.isArray(data?.missingConfiguration) ? data.missingConfiguration : [],
          redirectUri: typeof data?.redirectUri === "string" && data.redirectUri
            ? data.redirectUri
            : DEFAULT_ANALYTICS_REDIRECT_URI,
          tokenKeyConfigured: Boolean(data?.tokenKeyConfigured),
          usingSearchConsoleOAuthCredentials: Boolean(data?.usingSearchConsoleOAuthCredentials),
        });
        if (typeof data?.redirectUri === "string" && data.redirectUri) {
          setOAuthRedirectUri(data.redirectUri);
        }
      })
      .catch((error) => {
        if (active) console.error("Unable to load Google Analytics connection status", error);
      })
      .finally(() => {
        if (active) setIsLoadingConnection(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!googleConnection.connected) {
      setAnalyticsProperties([]);
      setSelectedPropertyId("");
      setAnalyticsReport(null);
      setAnalyticsReportError("");
      return () => {
        active = false;
      };
    }

    setIsLoadingProperties(true);
    setAnalyticsReportError("");
    axios.get(`${API_BASE_URL}/admin/google-analytics/properties`, { headers: buildAuthHeaders() })
      .then(({ data }) => {
        if (!active) return;
        const properties = Array.isArray(data?.properties)
          ? data.properties.filter((property) => (
            typeof property?.id === "string"
            && /^properties\/\d+$/.test(property.id)
            && typeof property?.displayName === "string"
          ))
          : [];
        setAnalyticsProperties(properties);
        setSelectedPropertyId((current) => (
          properties.some((property) => property.id === current) ? current : properties[0]?.id || ""
        ));
        if (!properties.length) {
          setAnalyticsReportError("No GA4 properties were found for this Google account.");
        }
      })
      .catch((error) => {
        if (active) {
          setAnalyticsReportError(error.response?.data?.error || "Unable to load Google Analytics properties.");
        }
      })
      .finally(() => {
        if (active) setIsLoadingProperties(false);
      });

    return () => {
      active = false;
    };
  }, [googleConnection.connected]);

  useEffect(() => {
    if (!googleConnection.connected || !selectedPropertyId || !isLiveRealtime) return undefined;

    const timer = window.setInterval(() => {
      setReportRefreshKey((current) => current + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [googleConnection.connected, isLiveRealtime, selectedPropertyId]);

  useEffect(() => {
    let active = true;
    if (!googleConnection.connected || !selectedPropertyId) {
      setAnalyticsReport(null);
      setIsLoadingReport(false);
      return () => {
        active = false;
      };
    }

    setIsLoadingReport(true);
    setAnalyticsReportError("");
    axios.post(
      `${API_BASE_URL}/admin/google-analytics/reports`,
      {
        propertyId: selectedPropertyId,
        reportId: activeReportId,
        dateRange: selectedReportDateRange,
      },
      { headers: buildAuthHeaders() }
    )
      .then(({ data }) => {
        if (active) setAnalyticsReport(data);
      })
      .catch((error) => {
        if (active) {
          setAnalyticsReport(null);
          setAnalyticsReportError(error.response?.data?.error || "Unable to load this Google Analytics report.");
        }
      })
      .finally(() => {
        if (active) setIsLoadingReport(false);
      });

    return () => {
      active = false;
    };
  }, [activeReportId, googleConnection.connected, reportRefreshKey, selectedPropertyId, selectedReportDateRange]);

  useEffect(() => {
    const callbackOrigin = new URL(API_BASE_URL).origin;
    const handleOAuthMessage = (event) => {
      if (event.origin !== callbackOrigin || event.source !== oauthPopupRef.current) return;
      const { type, result } = event.data || {};
      if (type !== "google-analytics-oauth" || !["connected", "denied", "error"].includes(result)) return;

      oauthPopupRef.current = null;
      if (oauthPopupMonitorRef.current) {
        window.clearInterval(oauthPopupMonitorRef.current);
        oauthPopupMonitorRef.current = null;
      }
      setIsConnectingGoogle(false);

      if (result === "connected") {
        setConnectionMessage("Google Analytics connected successfully.");
        axios.get(`${API_BASE_URL}/admin/google-analytics/connection`, { headers: buildAuthHeaders() })
          .then(({ data }) => {
            setGoogleConnection({
              configured: Boolean(data?.configured),
              connected: Boolean(data?.connected),
              accountEmail: typeof data?.accountEmail === "string" ? data.accountEmail : "",
              missingConfiguration: Array.isArray(data?.missingConfiguration) ? data.missingConfiguration : [],
              redirectUri: typeof data?.redirectUri === "string" && data.redirectUri
                ? data.redirectUri
                : DEFAULT_ANALYTICS_REDIRECT_URI,
              tokenKeyConfigured: Boolean(data?.tokenKeyConfigured),
              usingSearchConsoleOAuthCredentials: Boolean(data?.usingSearchConsoleOAuthCredentials),
            });
            if (typeof data?.redirectUri === "string" && data.redirectUri) {
              setOAuthRedirectUri(data.redirectUri);
            }
          })
          .catch((error) => console.error("Unable to refresh Google Analytics connection status", error));
      } else {
        setConnectionMessage(result === "denied"
          ? "Google account authorization was cancelled."
          : "Google Analytics connection failed. Please try again.");
      }
    };

    window.addEventListener("message", handleOAuthMessage);
    return () => {
      window.removeEventListener("message", handleOAuthMessage);
      if (oauthPopupMonitorRef.current) {
        window.clearInterval(oauthPopupMonitorRef.current);
        oauthPopupMonitorRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isDialogOpen) return undefined;

    dialogRef.current?.querySelector("button")?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsDialogOpen(false);
      if (event.key !== "Tab") return;

      const focusableElements = dialogRef.current?.querySelectorAll("button:not(:disabled)");
      if (!focusableElements?.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDialogOpen, showManualSetup, showOAuthConfig]);

  const closeDialog = () => {
    setIsDialogOpen(false);
    setShowManualSetup(false);
    setShowOAuthConfig(false);
    connectButtonRef.current?.focus();
  };

  const openOAuthConfig = () => {
    setShowManualSetup(false);
    setShowOAuthConfig(true);
    setOAuthConfigError("");
  };

  const generateOAuthTokenKey = () => {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    setOAuthTokenKey(Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""));
    setOAuthConfigError("");
  };

  const saveOAuthConfig = async () => {
    if (!oauthTokenKey.trim() && !googleConnection.tokenKeyConfigured) {
      setOAuthConfigError("Enter or generate a 32-byte token key before saving.");
      return;
    }

    setIsSavingOAuthConfig(true);
    setOAuthConfigError("");
    try {
      const { data } = await axios.put(
        `${API_BASE_URL}/admin/google-analytics/config`,
        { redirectUri: oauthRedirectUri.trim(), tokenKey: oauthTokenKey.trim() },
        { headers: buildAuthHeaders() }
      );
      setGoogleConnection((current) => ({
        ...current,
        configured: Boolean(data?.configured),
        missingConfiguration: Array.isArray(data?.missingConfiguration) ? data.missingConfiguration : [],
        redirectUri: data?.redirectUri || oauthRedirectUri.trim(),
        tokenKeyConfigured: Boolean(data?.tokenKeyConfigured),
        usingSearchConsoleOAuthCredentials: Boolean(data?.usingSearchConsoleOAuthCredentials),
      }));
      setOAuthTokenKey("");
      setConnectionMessage(data?.message || "Google Analytics OAuth settings saved.");
      closeDialog();
    } catch (error) {
      const missing = error.response?.data?.missingConfiguration;
      setOAuthConfigError(
        Array.isArray(missing) && missing.length
          ? `Configure these settings first: ${missing.join(", ")}.`
          : error.response?.data?.error || error.message || "Unable to save Google Analytics OAuth settings."
      );
    } finally {
      setIsSavingOAuthConfig(false);
    }
  };

  const startGoogleConnection = async () => {
    const popup = window.open(
      "about:blank",
      "google-analytics-oauth",
      "popup=yes,width=560,height=720,resizable=yes,scrollbars=yes"
    );
    if (!popup) {
      setConnectionMessage("The Google sign-in popup was blocked. Allow popups for this site and try again.");
      return;
    }

    oauthPopupRef.current = popup;
    setIsConnectingGoogle(true);
    setConnectionMessage("Opening Google sign-in in a new window…");
    closeDialog();
    oauthPopupMonitorRef.current = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(oauthPopupMonitorRef.current);
      oauthPopupMonitorRef.current = null;
      oauthPopupRef.current = null;
      setIsConnectingGoogle(false);
      setConnectionMessage("Google sign-in was closed before authorization finished.");
    }, 1000);

    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/google-analytics/connect`,
        {},
        { headers: buildAuthHeaders() }
      );
      const authorizationUrl = new URL(response.data?.authorizationUrl);
      if (authorizationUrl.origin !== "https://accounts.google.com") {
        throw new Error("The server returned an invalid Google authorization URL.");
      }
      popup.location.replace(authorizationUrl.toString());
    } catch (error) {
      popup.close();
      oauthPopupRef.current = null;
      if (oauthPopupMonitorRef.current) {
        window.clearInterval(oauthPopupMonitorRef.current);
        oauthPopupMonitorRef.current = null;
      }
      setIsConnectingGoogle(false);
      const missing = error.response?.data?.missingConfiguration;
      setConnectionMessage(
        Array.isArray(missing) && missing.length
          ? `Configure these backend settings first: ${missing.join(", ")}.`
          : error.response?.data?.error || error.message || "Unable to start Google sign-in."
      );
    }
  };

  const disconnectGoogleConnection = async () => {
    setIsDisconnectingGoogle(true);
    setDisconnectError("");
    setConnectionMessage("");
    try {
      await axios.delete(`${API_BASE_URL}/admin/google-analytics/connection`, {
        headers: buildAuthHeaders(),
      });
      setGoogleConnection((current) => ({
        ...current,
        connected: false,
        accountEmail: "",
      }));
      setConnectionMessage("Google Analytics account disconnected.");
    } catch (error) {
      console.error("Unable to disconnect Google Analytics", error);
      setDisconnectError(error.response?.data?.error || "Unable to disconnect Google Analytics.");
    } finally {
      setIsDisconnectingGoogle(false);
    }
  };

  const clearManualFields = () => {
    setMeasurementId("");
    setTagManagerId("");
    setTagSnippet("");
    setTagError("");
  };

  const saveManualTag = async () => {
    const normalizedMeasurement = normalizeGoogleAnalyticsMeasurementId(measurementId);
    const normalizedTagManager = normalizeGoogleTagManagerId(tagManagerId);
    if (normalizedMeasurement === null || normalizedTagManager === null) {
      setTagError("Check both fields: GA4 IDs start with G- and Tag Manager IDs start with GTM-.");
      return;
    }

    let snippetIds = { measurementId: "", tagManagerId: "" };
    if (tagSnippet.trim()) {
      try {
        snippetIds = extractGoogleTagIdsFromSnippet(tagSnippet);
      } catch (error) {
        setTagError(error.message);
        return;
      }
    }

    if (snippetIds.measurementId && normalizedMeasurement && snippetIds.measurementId !== normalizedMeasurement) {
      setTagError("The script’s GA4 ID conflicts with the GA4 Measurement ID field.");
      return;
    }
    if (snippetIds.tagManagerId && normalizedTagManager && snippetIds.tagManagerId !== normalizedTagManager) {
      setTagError("The script’s GTM ID conflicts with the Google Tag Manager field.");
      return;
    }

    const measurementToSave = snippetIds.measurementId || normalizedMeasurement;
    const tagManagerToSave = snippetIds.tagManagerId || normalizedTagManager;

    setIsSavingTag(true);
    setTagError("");
    try {
      const { data } = await axios.put(
        `${API_BASE_URL}/admin/google-analytics/tag`,
        { measurementId: measurementToSave, tagManagerId: tagManagerToSave },
        { headers: buildAuthHeaders() }
      );
      const savedMeasurement = normalizeGoogleAnalyticsMeasurementId(data?.measurementId || "");
      const savedTagManager = normalizeGoogleTagManagerId(data?.tagManagerId || "");
      if (savedMeasurement === null || savedTagManager === null) {
        throw new Error("The server returned an invalid Google tag ID.");
      }

      setSavedMeasurementId(savedMeasurement);
      setSavedTagManagerId(savedTagManager);
      setMeasurementId(savedMeasurement);
      setTagManagerId(savedTagManager);
      setTagSnippet("");
      const activeTags = [
        savedMeasurement && `GA4 ${savedMeasurement}`,
        savedTagManager && `GTM ${savedTagManager}`,
      ].filter(Boolean);
      setConnectionMessage(activeTags.length
        ? `${activeTags.join(" and ")} ${activeTags.length === 1 ? "is" : "are"} now installed site-wide.`
        : "Google tags removed site-wide.");
      window.dispatchEvent(new CustomEvent("google-analytics-tag-updated", {
        detail: { measurementId: savedMeasurement, tagManagerId: savedTagManager },
      }));
      closeDialog();
    } catch (error) {
      setTagError(error.response?.data?.error || error.message || "Unable to save the Google Analytics tag.");
    } finally {
      setIsSavingTag(false);
    }
  };

  const isGoogleTagConnected = Boolean(savedMeasurementId || savedTagManagerId);
  const accountStatus = isLoadingConnection
    ? "Checking…"
    : googleConnection.connected ? "Connected" : "Not connected";
  const tagStatus = isLoadingTag
    ? "Checking…"
    : isGoogleTagConnected ? "Connected" : "Not connected";
  const activeReport = ANALYTICS_REPORT_NAVIGATION
    .flatMap((group) => group.items)
    .find((report) => report.id === activeReportId) || ANALYTICS_REPORT_NAVIGATION[0].items[0];
  const realtimeSummary = analyticsReport?.reports?.summary;
  const isLiveDataAvailable = selectedReportDateRange === "last30min"
    && (activeReportId === "realtime" || analyticsReport?.isRealtime);
  const reportMetricHeaders = activeReportId === "realtime"
    ? realtimeSummary?.metricHeaders || []
    : analyticsReport?.metricHeaders || [];
  const reportMetricValues = activeReportId === "realtime"
    ? realtimeSummary?.rows?.[0]?.metricValues
    : analyticsReport?.totals?.[0]?.metricValues;
  const reportMetricCards = Array.isArray(reportMetricValues)
    ? reportMetricValues.map((value, index) => ({
      name: reportMetricHeaders[index]?.name || `metric-${index}`,
      label: ANALYTICS_METRIC_LABELS[reportMetricHeaders[index]?.name] || reportMetricHeaders[index]?.name,
      value: value.value || "0",
    }))
    : [];

  const renderAnalyticsTable = (title, reportData) => {
    const dimensions = reportData?.dimensionHeaders || [];
    const metrics = reportData?.metricHeaders || [];
    const rows = reportData?.rows || [];
    const isAcquisitionOverview = activeReportId === "acquisition-overview";
    return (
      <section className="google-analytics-report-table-card" key={title} aria-label={title}>
        <h3>{title}</h3>
        {rows.length ? (
          <div className="google-analytics-report-table-scroll">
            <table>
              <thead>
                <tr>
                  {dimensions.map((dimension) => <th key={dimension.name}>{dimension.name}</th>)}
                  {metrics.map((metric) => (
                    <th key={metric.name}>{ANALYTICS_METRIC_LABELS[metric.name] || metric.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`${title}-${rowIndex}`}>
                    {(row.dimensionValues || []).map((value, index) => (
                      <td key={`${dimensions[index]?.name || "dimension"}-${index}`}>{value.value || "(not set)"}</td>
                    ))}
                    {(row.metricValues || []).map((value, index) => (
                      <td key={`${metrics[index]?.name || "metric"}-${index}`}>
                        {formatAnalyticsMetric(value.value, metrics[index]?.name || "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <p className="google-analytics-report-empty">
              {isAcquisitionOverview
                ? "GA4 has no processed channel-group data for this range yet. Acquisition reports use processed data; Realtime does not include channel groups."
                : "No processed data for this report and selected range yet."}
            </p>
            {isAcquisitionOverview && (
              <button
                className="google-analytics-report-refresh"
                type="button"
                onClick={() => {
                  setAnalyticsDateRange("last30min");
                  setHasSelectedAnalyticsDateRange(true);
                  setActiveReportId("realtime");
                }}
              >
                View live activity
              </button>
            )}
          </>
        )}
      </section>
    );
  };

  return (
    <main className={`google-analytics-page${darkMode ? " is-dark" : ""}`}>
      <div className="google-analytics-page-inner">
        <header className="google-analytics-page-heading">
          <div>
            <span className="google-analytics-eyebrow">GROWTH &amp; DISCOVERY</span>
            <h1>Google Analytics</h1>
            <p>Bring your website traffic and audience insights into one place.</p>
          </div>
          <div className="google-analytics-status-group" role="group" aria-label="Connection status">
            <span className={`google-analytics-status${googleConnection.connected ? " is-connected" : ""}`}>
              <span className="google-analytics-status-icon" aria-hidden="true">
                {googleConnection.connected ? "✓" : "○"}
              </span>
              Google account: {accountStatus}
            </span>
            <span className={`google-analytics-status${isGoogleTagConnected ? " is-connected" : ""}`}>
              <span className="google-analytics-status-icon" aria-hidden="true">
                {isGoogleTagConnected ? "✓" : "○"}
              </span>
              Website tag: {tagStatus}
            </span>
          </div>
        </header>

        <section className="google-analytics-hero" aria-labelledby="google-analytics-hero-title">
          <div className="google-analytics-orbit" aria-hidden="true" />
          <div className="google-analytics-hero-content">
            <div className="google-analytics-brand">
              <span className="google-analytics-brand-mark" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>GOOGLE ANALYTICS 4</span>
            </div>
            <div className="google-analytics-hero-copy">
              <div>
                <h2 id="google-analytics-hero-title">Make every visit count.</h2>
                <p>
                  Connect your GA4 property to understand how people discover,
                  explore, and engage with your website.
                </p>
                <div className="google-analytics-tags" aria-label="Integration benefits">
                  <span>Audience insights</span>
                  <span>Real-time reporting</span>
                  <span>Conversion trends</span>
                </div>
              </div>
              <div className="google-analytics-connect">
                <button
                  ref={connectButtonRef}
                  type="button"
                  disabled={isConnectingGoogle}
                  onClick={() => {
                    setConnectionMessage("");
                    setIsDialogOpen(true);
                  }}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M10 3v10m0 0 4-4m-4 4L6 9M4 15v2h12v-2" />
                  </svg>
                  {isConnectingGoogle ? "Connecting to Google…" : "Connect Google Analytics"}
                </button>
                <span>Secure Google authorization</span>
              </div>
            </div>
            <div className="google-analytics-hero-footer">
              <span><i aria-hidden="true" /> {
                [savedMeasurementId && `GA4: ${savedMeasurementId}`, savedTagManagerId && `GTM: ${savedTagManagerId}`]
                  .filter(Boolean)
                  .join(" · ") || "No Google tag configured"
              }</span>
              {googleConnection.connected && googleConnection.accountEmail && (
                <span>Google account: {googleConnection.accountEmail}</span>
              )}
              <span>Your data stays yours</span>
            </div>
          </div>
        </section>

        <section className="google-analytics-dashboard" aria-label="Google Analytics reports">
          <aside className="google-analytics-report-sidebar" aria-label="Analytics reports navigation">
            {ANALYTICS_REPORT_NAVIGATION.map((group) => (
              <div className="google-analytics-report-nav-group" key={group.label}>
                <h2>{group.label}</h2>
                {group.items.map((report) => (
                  <button
                    className={`google-analytics-report-nav-button${activeReportId === report.id ? " is-active" : ""}`}
                    type="button"
                    key={report.id}
                    aria-current={activeReportId === report.id ? "page" : undefined}
                    onClick={() => setActiveReportId(report.id)}
                  >
                    {report.label}
                  </button>
                ))}
              </div>
            ))}
          </aside>

          <div className="google-analytics-report-content">
            <div className="google-analytics-report-toolbar">
              <div>
                <span className="google-analytics-eyebrow">GOOGLE ANALYTICS REPORTS</span>
                <h2>{activeReport.label}</h2>
                <p>{activeReport.description}</p>
              </div>
              <div className="google-analytics-report-controls">
                <label>
                  GA4 property
                  <select
                    value={selectedPropertyId}
                    disabled={!googleConnection.connected || isLoadingProperties || !analyticsProperties.length}
                    onChange={(event) => setSelectedPropertyId(event.target.value)}
                  >
                    {!analyticsProperties.length && <option value="">No property available</option>}
                    {analyticsProperties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.displayName}{property.accountName ? ` · ${property.accountName}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Date range
                  <select
                    value={selectedReportDateRange}
                    onChange={(event) => {
                      setAnalyticsDateRange(event.target.value);
                      setHasSelectedAnalyticsDateRange(true);
                    }}
                  >
                    {ANALYTICS_DATE_RANGES.map((range) => (
                      <option key={range.value} value={range.value}>{range.label}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="google-analytics-report-refresh"
                  type="button"
                  disabled={!googleConnection.connected || !selectedPropertyId || isLoadingReport}
                  onClick={() => setReportRefreshKey((current) => current + 1)}
                >
                  {isLoadingReport ? "Loading…" : isLiveRealtime ? "Refresh now" : "Refresh"}
                </button>
              </div>
            </div>

            {["last30min", "last1hour", "last2hours", "last4hours"].includes(selectedReportDateRange)
              && !isLiveDataAvailable && (
                <p className="google-analytics-report-updated">
                  This historical report may be delayed. Last 30 minutes uses live data where supported.
                </p>
            )}

            {!googleConnection.connected && !isLoadingConnection ? (
              <div className="google-analytics-report-placeholder">
                <h3>Connect your Google account to view reports</h3>
                <p>Authorize the Google account that has access to your GA4 property.</p>
                <button
                  type="button"
                  onClick={() => {
                    setConnectionMessage("");
                    setIsDialogOpen(true);
                  }}
                >
                  Connect Google Analytics
                </button>
              </div>
            ) : (
              <>
                {analyticsReportError && <p className="google-analytics-report-error" role="alert">{analyticsReportError}</p>}
                {analyticsReport?.unavailableReason && (
                  <p className="google-analytics-report-updated" role="status">
                    {analyticsReport.unavailableReason}
                  </p>
                )}
                {googleConnection.connected && (isLoadingProperties || isLoadingReport) && (
                  <p className="google-analytics-report-loading" role="status">
                    {isLoadingProperties ? "Loading GA4 properties…" : "Loading report…"}
                  </p>
                )}
                {!analyticsReport?.unavailableReason && reportMetricCards.length > 0 && (
                  <div className="google-analytics-report-metrics" aria-label="Report metrics">
                    {reportMetricCards.map((metric) => (
                      <article key={metric.name}>
                        <span>{metric.label}</span>
                        <strong>{formatAnalyticsMetric(metric.value, metric.name)}</strong>
                      </article>
                    ))}
                  </div>
                )}
                {!analyticsReport?.unavailableReason && (activeReportId === "realtime" ? (
                  <div className="google-analytics-realtime-tables">
                    {[
                      ["Top countries", "countries"],
                      ["Top pages", "pages"],
                      ["Events", "events"],
                    ].map(([title, key]) => {
                      const report = analyticsReport?.reports?.[key];
                      return renderAnalyticsTable(title, {
                        dimensionHeaders: report?.dimensionHeaders || [],
                        metricHeaders: report?.metricHeaders || [],
                        rows: report?.rows || [],
                      });
                    })}
                    {analyticsReport?.reports?.sources
                      ? renderAnalyticsTable("Traffic sources", analyticsReport.reports.sources)
                      : analyticsReport && (
                        <section className="google-analytics-report-table-card" aria-label="Traffic sources">
                          <h3>Traffic sources</h3>
                          <p className="google-analytics-report-empty">
                            GA4 Realtime does not provide traffic-source dimensions. Use Traffic acquisition for source/medium data.
                          </p>
                        </section>
                      )}
                  </div>
                ) : (
                  renderAnalyticsTable(activeReport.label, analyticsReport)
                ))}
                {activeReportId === "realtime" && analyticsReport?.generatedAt && (
                  <p className="google-analytics-report-updated">
                    Updated {new Date(analyticsReport.generatedAt).toLocaleTimeString()}
                    {isLiveRealtime ? " · refreshes every minute" : " · historical data may be delayed"}
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        {connectionMessage && !isDialogOpen && (
          <p className="google-analytics-notice" role="status">{connectionMessage}</p>
        )}

        {isDialogOpen && (
          <div className="google-analytics-dialog-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}>
            <section
              className="google-analytics-dialog"
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="google-analytics-dialog-title"
              tabIndex="-1"
            >
              <header className="google-analytics-dialog-header">
                <div>
                  <span className="google-analytics-eyebrow">GOOGLE ANALYTICS 4</span>
                  <h2 id="google-analytics-dialog-title">
                    {showManualSetup
                      ? "Add a Google tag manually"
                      : showOAuthConfig ? "Configure Google authorization" : "Choose a connection method"}
                  </h2>
                </div>
                <button className="google-analytics-dialog-close" type="button" onClick={closeDialog} aria-label="Close dialog">
                  ×
                </button>
              </header>

              {!showManualSetup && !showOAuthConfig && (
                <div className="google-analytics-connection-summary" role="group" aria-label="Connection status">
                  <span className={googleConnection.connected ? "is-connected" : ""}>
                    <span aria-hidden="true">{googleConnection.connected ? "✓" : "○"}</span>
                    Google account: {accountStatus}
                  </span>
                  <span className={isGoogleTagConnected ? "is-connected" : ""}>
                    <span aria-hidden="true">{isGoogleTagConnected ? "✓" : "○"}</span>
                    Website tag: {tagStatus}
                  </span>
                </div>
              )}

              {disconnectError && <p className="google-analytics-notice" role="alert">{disconnectError}</p>}
              {connectionMessage && isDialogOpen && (
                <p className="google-analytics-notice" role="status">{connectionMessage}</p>
              )}

              {showOAuthConfig ? (
                <div className="google-analytics-manual-content">
                  <p>
                    {googleConnection.usingSearchConsoleOAuthCredentials
                      ? "Your Google Search Console OAuth client ID and secret will be reused. Configure the Analytics callback and a separate token key below."
                      : "Configure the Analytics callback and token key below. Search Console OAuth credentials will be reused when available."}
                  </p>
                  <label className="google-analytics-measurement-field">
                    Analytics OAuth callback URL
                    <input
                      type="url"
                      autoComplete="url"
                      spellCheck="false"
                      value={oauthRedirectUri}
                      disabled={isSavingOAuthConfig}
                      onChange={(event) => {
                        setOAuthRedirectUri(event.target.value);
                        setOAuthConfigError("");
                      }}
                    />
                  </label>
                  <p className="google-analytics-manual-note">
                    Add this exact URL to your Google OAuth client’s authorized redirect URIs. It is separate from the Search Console callback.
                  </p>
                  <label className="google-analytics-measurement-field">
                    Analytics token key
                    <input
                      type="password"
                      autoComplete="new-password"
                      spellCheck="false"
                      placeholder={googleConnection.tokenKeyConfigured ? "Saved — leave blank to keep current key" : "64-character hex or Base64 key"}
                      value={oauthTokenKey}
                      disabled={isSavingOAuthConfig || googleConnection.connected}
                      onChange={(event) => {
                        setOAuthTokenKey(event.target.value);
                        setOAuthConfigError("");
                      }}
                    />
                  </label>
                  <p className="google-analytics-manual-note">
                    Use a private, persistent 32-byte key. It is stored only on the backend and is not shown again.
                    {googleConnection.connected && " Disconnect Analytics before changing a saved key."}
                  </p>
                  <div className="google-analytics-dialog-actions">
                    <button
                      className="google-analytics-generate-key"
                      type="button"
                      disabled={isSavingOAuthConfig || googleConnection.connected}
                      onClick={generateOAuthTokenKey}
                    >
                      Generate key
                    </button>
                    <button
                      className="google-analytics-secondary-button"
                      type="button"
                      disabled={isSavingOAuthConfig}
                      onClick={() => setShowOAuthConfig(false)}
                    >
                      Back to options
                    </button>
                    <button
                      className="google-analytics-primary-button"
                      type="button"
                      disabled={isSavingOAuthConfig || !oauthRedirectUri.trim()}
                      onClick={saveOAuthConfig}
                    >
                      {isSavingOAuthConfig ? "Saving…" : "Save settings"}
                    </button>
                  </div>
                  {oauthConfigError && <p className="google-analytics-tag-error" role="alert">{oauthConfigError}</p>}
                </div>
              ) : showManualSetup ? (
                <div className="google-analytics-manual-content">
                  <p>
                    Choose GA4 or GTM to enter its code. Switch types to configure both, or paste a Google tag
                    snippet below. We’ll install supported tags across the site automatically.
                  </p>
                  <div className="google-analytics-tag-type">
                    <span>Code type</span>
                    <div className="google-analytics-tag-type-options" role="group" aria-label="Choose tag code type">
                      <button
                        type="button"
                        aria-pressed={tagType === "ga4"}
                        disabled={isLoadingTag || isSavingTag}
                        onClick={() => setTagType("ga4")}
                      >
                        GA4
                      </button>
                      <button
                        type="button"
                        aria-pressed={tagType === "gtm"}
                        disabled={isLoadingTag || isSavingTag}
                        onClick={() => setTagType("gtm")}
                      >
                        GTM
                      </button>
                    </div>
                  </div>
                  {tagType === "ga4" ? (
                    <label className="google-analytics-measurement-field">
                      GA4 Measurement ID
                      <input
                        type="text"
                        autoComplete="off"
                        spellCheck="false"
                        placeholder="G-XXXXXXXXXX"
                        value={measurementId}
                        disabled={isLoadingTag || isSavingTag}
                        onChange={(event) => {
                          setMeasurementId(event.target.value);
                          setTagError("");
                        }}
                      />
                    </label>
                  ) : (
                    <label className="google-analytics-measurement-field">
                      Google Tag Manager Container ID
                      <input
                        type="text"
                        autoComplete="off"
                        spellCheck="false"
                        placeholder="GTM-XXXXXXXX"
                        value={tagManagerId}
                        disabled={isLoadingTag || isSavingTag}
                        onChange={(event) => {
                          setTagManagerId(event.target.value);
                          setTagError("");
                        }}
                      />
                    </label>
                  )}
                  <label className="google-analytics-measurement-field google-analytics-script-field">
                    Google tag script snippet
                    <textarea
                      rows="5"
                      autoComplete="off"
                      spellCheck="false"
                      placeholder={'Paste the Google tag <script> snippet here'}
                      value={tagSnippet}
                      disabled={isLoadingTag || isSavingTag}
                      onChange={(event) => {
                        setTagSnippet(event.target.value);
                        setTagError("");
                      }}
                    />
                  </label>
                  <p className="google-analytics-manual-note">
                    We extract valid GA4/GTM IDs from Google snippets. Pasted code is never executed; only IDs are saved and installed.
                  </p>
                  {tagError && <p className="google-analytics-tag-error" role="alert">{tagError}</p>}
                  <div className="google-analytics-dialog-actions">
                    <button
                      className="google-analytics-clear-button"
                      type="button"
                      disabled={isLoadingTag || isSavingTag || (!measurementId && !tagManagerId && !tagSnippet)}
                      onClick={clearManualFields}
                    >
                      Clear all
                    </button>
                    <button className="google-analytics-secondary-button" type="button" disabled={isSavingTag} onClick={() => setShowManualSetup(false)}>
                      Back to options
                    </button>
                    <button className="google-analytics-primary-button" type="button" disabled={isLoadingTag || isSavingTag} onClick={saveManualTag}>
                      {isSavingTag ? "Installing…" : "Done"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="google-analytics-methods">
                  {googleConnection.connected ? (
                    <div className="google-analytics-method-card is-static">
                      <span className="google-analytics-method-icon" aria-hidden="true">G</span>
                      <span className="google-analytics-method-copy">
                        <strong>Connect Google Analytics</strong>
                        <small>
                          {googleConnection.accountEmail
                            ? `Connected as ${googleConnection.accountEmail}`
                            : "Connected to your Google account."}
                        </small>
                      </span>
                      <span className="google-analytics-method-meta">
                        <span className="google-analytics-method-status is-connected">
                          <span aria-hidden="true">✓</span>
                          Connected
                        </span>
                        <button
                          className="google-analytics-disconnect-button"
                          type="button"
                          disabled={isDisconnectingGoogle}
                          onClick={disconnectGoogleConnection}
                        >
                          {isDisconnectingGoogle ? "Disconnecting…" : "Disconnect"}
                        </button>
                      </span>
                    </div>
                  ) : (
                    <button
                      className="google-analytics-method-card"
                      type="button"
                      disabled={isLoadingConnection || isConnectingGoogle}
                      onClick={startGoogleConnection}
                    >
                      <span className="google-analytics-method-icon" aria-hidden="true">G</span>
                      <span className="google-analytics-method-copy">
                        <strong>Connect Google Analytics</strong>
                        <small>Authorize your Google account for Analytics access.</small>
                      </span>
                      <span className="google-analytics-method-meta">
                        <span className="google-analytics-method-status">
                          <span aria-hidden="true">○</span>
                          {accountStatus === "Checking…" ? accountStatus : "Not connected"}
                        </span>
                        <span className="google-analytics-method-arrow" aria-hidden="true">→</span>
                      </span>
                    </button>
                  )}
                  <button className="google-analytics-method-card" type="button" onClick={() => setShowManualSetup(true)}>
                    <span className="google-analytics-method-icon is-manual" aria-hidden="true">&lt;/&gt;</span>
                    <span className="google-analytics-method-copy">
                      <strong>Add Google Tag Manually</strong>
                      <small>
                        {isGoogleTagConnected
                          ? `Installed: ${[savedMeasurementId && "GA4", savedTagManagerId && "GTM"].filter(Boolean).join(" and ")}`
                          : "Install your GA4 or GTM tag directly on your site."}
                      </small>
                    </span>
                    <span className="google-analytics-method-meta">
                      <span className={`google-analytics-method-status${isGoogleTagConnected ? " is-connected" : ""}`}>
                        <span aria-hidden="true">{isGoogleTagConnected ? "✓" : "○"}</span>
                        {isGoogleTagConnected ? "Connected" : "Not connected"}
                      </span>
                      <span className="google-analytics-method-arrow" aria-hidden="true">→</span>
                    </span>
                  </button>
                  <button className="google-analytics-method-card" type="button" onClick={openOAuthConfig}>
                    <span className="google-analytics-method-icon is-manual" aria-hidden="true">KEY</span>
                    <span className="google-analytics-method-copy">
                      <strong>Configure OAuth Manually</strong>
                      <small>
                        {googleConnection.usingSearchConsoleOAuthCredentials
                          ? "Reuse the Search Console client and enter Analytics-specific settings."
                          : "Set the callback URL and token key for Google authorization."}
                      </small>
                    </span>
                    <span className="google-analytics-method-arrow" aria-hidden="true">→</span>
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
