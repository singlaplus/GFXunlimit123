import axios from "axios";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { API_BASE_URL } from "../utils/apiBaseUrl";
import { clearAuthSessionStorage, getEffectiveAuthToken, normalizeAuthToken } from "../utils/authSession";
import { THEME_STORAGE_KEY } from "../utils/theme";

const StartupReadinessContext = createContext(null);
const noop = () => {};
const DEFAULT_STARTUP_LOGO = "/api/files/branding/logo.png";
const DEFAULT_READINESS = {
  auth: { status: "ready", role: "" },
  branding: {},
  reportResource: noop,
  reportAvailability: noop,
  retryKey: 0,
  availabilityRetryKey: 0,
  routeId: "",
  routeReady: true,
};

function requirementsForRoute(pathname, search, role) {
  if (pathname === "/" || pathname === "/home") return ["catalog", "hero"];
  if (pathname === "/explore" || /^\/explore\/\d+$/.test(pathname) ||
      ["/search", "/photos", "/vectors", "/psd", "/psds", "/videos", "/templates"].includes(pathname)) {
    return ["catalog"];
  }
  if (pathname.startsWith("/asset/")) return ["asset"];
  if (pathname === "/pricing") return ["subscriptionPlans"];
  if (pathname === "/blog") return ["publicBlog"];
  if (pathname.startsWith("/blog/")) return ["publicBlogDetail"];
  if (pathname.startsWith("/c/c/c/c/")) return ["publicContributor"];
  if (pathname === "/account-settings") return ["accountSettings"];
  if (pathname === "/profile") return ["profile"];
  if (pathname === "/messages") return ["messages"];
  if (pathname === "/cart" || pathname === "/checkout") return ["cartCheckout"];
  if (pathname === "/checkout/subscription") return ["subscriptionCheckout"];
  if (pathname === "/orders" || pathname.startsWith("/orders/")) return ["orders"];
  if (pathname === "/payments") return ["payments"];
  if (pathname === "/favorites") return ["favorites"];
  if (pathname === "/downloads") return ["downloads"];
  if (pathname === "/myuploads") return ["myUploads"];
  const isDashboardPath = pathname === "/dashboard" || pathname === "/customer";
  const dashboardTab = new URLSearchParams(search).get("tab");
  if (isDashboardPath && [
    "starttaxform",
    "filltaxform",
    "filltaxform1",
    "filltaxform_review",
    "taxcenter",
  ].includes(dashboardTab)) return [];
  if (isDashboardPath && ["customer", "buyer"].includes(role)) {
    return ["customerDashboard"];
  }
  if (isDashboardPath && role === "admin") {
    return ["adminDashboard", "adminDashboardUsers", "adminDashboardCollections"];
  }
  if ((isDashboardPath || pathname === "/contributor") && role === "contributor") {
    return ["dashboard", "earnings", "contributorDashboard"];
  }
  const adminCommercePaths = [
    "/admin/commerce",
    "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/commerce",
  ];
  if (role === "admin" && adminCommercePaths.includes(pathname)) return ["adminCommerce"];
  const adminOrdersPaths = [
    "/admin/orders",
    "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/orders",
  ];
  if (role === "admin" && adminOrdersPaths.includes(pathname)) return ["adminOrders"];
  const adminAnalyticsPaths = [
    "/admin/analytics",
    "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/analytics",
  ];
  if (role === "admin" && adminAnalyticsPaths.includes(pathname)) return ["adminAnalytics"];
  const adminPanelPaths = [
    "/admin",
    "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm",
  ];
  const adminTab = new URLSearchParams(search).get("tab") || "";
  if (role === "admin" && adminPanelPaths.includes(pathname) && adminTab === "admin_dashboard") {
    return ["adminDashboard", "adminDashboardUsers", "adminDashboardCollections"];
  }
  if (role === "admin" && adminPanelPaths.includes(pathname) && adminTab === "users") {
    return ["adminUsers"];
  }
  if (role === "admin" && adminPanelPaths.includes(pathname) && adminTab === "myaccount") {
    return ["adminMyAccount"];
  }
  if (role === "admin" && adminPanelPaths.includes(pathname) && adminTab === "viewcontributor") {
    return ["adminContributors"];
  }
  if (role === "admin" && adminPanelPaths.includes(pathname) &&
      !["controls", "controls_blog", "admin_dashboard", "backup", "restore", "live-assets", "users", "myaccount", "viewcontributor"].includes(adminTab)) {
    return ["adminRoute"];
  }
  return [];
}

export function calculateReadinessProgress({
  healthReady,
  sessionReady,
  availabilityRequired,
  availabilityReady,
  requiredResources,
  resourceStates,
  pageReady,
}) {
  const completedTasks = [healthReady, sessionReady];
  if (availabilityRequired) completedTasks.push(availabilityReady);
  requiredResources.forEach((resource) => {
    completedTasks.push(resourceStates[resource]?.status === "ready");
  });

  const completedCount = completedTasks.filter(Boolean).length;
  const progress = Math.floor((completedCount / completedTasks.length) * 100);
  return pageReady && completedCount === completedTasks.length ? 100 : Math.min(progress, 99);
}

function validateHealthResponse(response) {
  if (response?.status !== 200 || !Array.isArray(response.data) || response.data.length === 0) {
    throw new Error("The backend health check returned an invalid response.");
  }
  const timestamp = response.data[0]?.now;
  if (typeof timestamp !== "string" && !(timestamp instanceof Date)) {
    throw new Error("The backend health check did not confirm PostgreSQL connectivity.");
  }
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("The backend health check returned an invalid PostgreSQL timestamp.");
  }
}

function getStartupErrorMessage(error) {
  if (error?.message === "Network Error" || error?.code === "ERR_NETWORK" ||
      error?.message === "Request failed with status code 0") {
    return "We couldn’t reach the server. Please try again.";
  }

  if (error?.response) {
    return `The server returned HTTP ${error.response.status}.`;
  }

  return error?.message || "The backend or database could not be reached.";
}

function writeRestoredUser(user) {
  const token = normalizeAuthToken(getEffectiveAuthToken());
  if (token) localStorage.setItem("token", token);
  localStorage.setItem("username", user.username || "");
  localStorage.setItem("userId", String(user.id));
  localStorage.setItem("userRole", user.role || "");
  localStorage.setItem("email", user.email || "");
  localStorage.setItem("fullName", user.fullName || "");
  localStorage.setItem("userPermissions", JSON.stringify(user.customPermissions || {}));
}

function getStartupTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "dark" || storedTheme === "light") return storedTheme;

  const documentTheme = document.documentElement.getAttribute("data-theme");
  if (documentTheme === "dark" || documentTheme === "light") return documentTheme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function LoadingScreen({ logo, logoKey, progress }) {
  const theme = getStartupTheme();
  return (
    <main className="startup-readiness-screen" data-theme={theme} role="status" aria-live="polite">
      <img
        key={`${logo}:${logoKey}`}
        className="startup-readiness-logo"
        src={`${API_BASE_URL}${logo}`}
        alt="GFXunlimit logo"
        style={{ visibility: "hidden" }}
        onLoad={(event) => { event.currentTarget.style.visibility = "visible"; }}
        onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
      />
      <div
        className="startup-readiness-progress"
        role="progressbar"
        aria-label="Page readiness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
    </main>
  );
}

function ErrorScreen({ message, onRetry, logo }) {
  const theme = getStartupTheme();
  return (
    <main className="startup-readiness-screen" data-theme={theme} role="alert">
      <div className="startup-readiness-grid" aria-hidden="true" />
      <div className="startup-readiness-glow startup-readiness-glow-one" aria-hidden="true" />
      <div className="startup-readiness-glow startup-readiness-glow-two" aria-hidden="true" />
      <div className="startup-readiness-glow startup-readiness-glow-three" aria-hidden="true" />
      <div className="startup-readiness-error-card">
        {logo && (
          <img
            className="startup-readiness-logo"
            src={`${API_BASE_URL}${logo}`}
            alt="GFXunlimit logo"
            style={{ visibility: "hidden" }}
            onLoad={(event) => { event.currentTarget.style.visibility = "visible"; }}
            onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
          />
        )}
        <div className="startup-readiness-visual" aria-hidden="true">
          <div className="startup-readiness-orbit startup-readiness-orbit-one" />
          <div className="startup-readiness-orbit startup-readiness-orbit-two" />
          <div className="startup-readiness-status-icon">
            <span>!</span>
          </div>
        </div>
        <div className="startup-readiness-eyebrow">
          <span className="startup-readiness-eyebrow-dot" />
          CONNECTION INTERRUPTED
        </div>
        <h1>Let&apos;s get you back in.</h1>
        <p className="startup-readiness-message">{message}</p>
        <button className="startup-readiness-retry" type="button" onClick={onRetry}>
          <span>Try again</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
            <path d="M4.5 10h10m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="startup-readiness-footnote">Your work is safe. We&apos;ll reconnect as soon as we can.</div>
      </div>
    </main>
  );
}

export function StartupReadinessProvider({ children }) {
  const location = useLocation();
  const routeId = `${location.key || "initial"}:${location.pathname}${location.search}`;
  const [bootstrap, setBootstrap] = useState({ status: "checking", message: "" });
  const [auth, setAuth] = useState({ status: "pending", role: "" });
  const [resourceStates, setResourceStates] = useState({});
  const [availabilityStates, setAvailabilityStates] = useState({});
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [availabilityRetryKey, setAvailabilityRetryKey] = useState(0);
  const [startupMilestones, setStartupMilestones] = useState({ health: false, session: false });
  const [branding, setBranding] = useState({ logo: DEFAULT_STARTUP_LOGO });
  const [brandingLoaded, setBrandingLoaded] = useState(false);
  const reportResource = useCallback((resource, status, error = "", reportedRouteId) => {
    if (!reportedRouteId) return;
    setResourceStates((current) => {
      return {
        ...current,
        [reportedRouteId]: {
          ...current[reportedRouteId],
          [resource]: { status, error },
        },
      };
    });
  }, []);
  const reportAvailability = useCallback((status, error = "", reportedRouteId) => {
    if (!reportedRouteId) return;
    setAvailabilityStates((current) => ({
      ...current,
      [reportedRouteId]: { status, error },
    }));
  }, []);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      setBootstrap({ status: "checking", message: "" });
      setAuth({ status: "pending", role: "" });
      setStartupMilestones({ health: false, session: false });
      try {
        const healthResponse = await axios.get(`${API_BASE_URL}/health`, { timeout: 15000 });
        validateHealthResponse(healthResponse);
        if (!active) return;
        setStartupMilestones((current) => ({ ...current, health: true }));

        const token = getEffectiveAuthToken();
        let restoredUser = null;
        try {
          const response = await axios.get(`${API_BASE_URL}/me`, {
            withCredentials: true,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            timeout: 15000,
          });
          if (response?.status !== 200 || !response.data || response.data.id == null ||
              typeof response.data.role !== "string") {
            throw new Error("The session restoration response was invalid.");
          }
          restoredUser = response.data;
        } catch (error) {
          const status = error?.response?.status;
          const isUnauthenticated = [401, 403].includes(status);
          const isDeletedUserSession = status === 404 &&
            error?.response?.data?.error === "User not found";
          if (!isUnauthenticated && !isDeletedUserSession) {
            throw error;
          }
          clearAuthSessionStorage();
        }

        if (!active) return;
        setStartupMilestones((current) => ({ ...current, session: true }));
        if (restoredUser) {
          writeRestoredUser(restoredUser);
          setAuth({ status: "authenticated", role: restoredUser.role.trim().toLowerCase() });
        } else {
          localStorage.removeItem("userRole");
          localStorage.removeItem("userPermissions");
          setAuth({ status: "anonymous", role: "" });
        }
        window.dispatchEvent(new Event("auth-changed"));
        setBootstrap({ status: "ready", message: "" });
      } catch (error) {
        if (!active) return;
        console.error("Startup readiness check failed", error);
        setBootstrap({
          status: "error",
          message: getStartupErrorMessage(error),
        });
      }
    };

    initialize();
    return () => { active = false; };
  }, [startupAttempt]);

  const requirements = requirementsForRoute(location.pathname, location.search, auth.role);
  const currentResources = resourceStates[routeId] || {};
  const currentAvailability = availabilityStates[routeId];
  const failedResource = requirements
    .map((resource) => currentResources[resource])
    .find((resource) => resource?.status === "error");
  const availabilityRequired = auth.role !== "admin";
  const availabilityReady = !availabilityRequired || currentAvailability?.status === "ready";
  const routeReady = availabilityReady &&
    requirements.every((resource) => currentResources[resource]?.status === "ready");
  const pageReady = bootstrap.status === "ready" && routeReady;
  const progress = calculateReadinessProgress({
    healthReady: startupMilestones.health,
    sessionReady: startupMilestones.session,
    availabilityRequired,
    availabilityReady: currentAvailability?.status === "ready",
    requiredResources: requirements,
    resourceStates: currentResources,
    pageReady,
  });
  const routeError = (
    availabilityRequired && currentAvailability?.status === "error"
      ? currentAvailability.error
      : failedResource?.error
  ) || "";

  const retryStartup = useCallback(() => {
    setResourceStates((current) => ({ ...current, [routeId]: {} }));
    setAvailabilityStates((current) => {
      const next = { ...current };
      delete next[routeId];
      return next;
    });
    setStartupAttempt((attempt) => attempt + 1);
  }, [routeId]);
  const retryRoute = useCallback(() => {
    setResourceStates((current) => ({ ...current, [routeId]: {} }));
    setRetryKey((attempt) => attempt + 1);
  }, [routeId]);
  const retryAvailability = useCallback(() => {
    setAvailabilityStates((current) => ({
      ...current,
      [routeId]: { status: "loading", error: "" },
    }));
    setAvailabilityRetryKey((attempt) => attempt + 1);
  }, [routeId]);

  useEffect(() => {
    let active = true;
    const loadBranding = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/branding`, { skipGlobalLoading: true });
        if (active && response.data && typeof response.data === "object" && !Array.isArray(response.data)) {
          setBrandingLoaded(true);
          setBranding((current) => ({
            ...current,
            ...response.data,
            logo: response.data.logo || current.logo || DEFAULT_STARTUP_LOGO,
          }));
        }
      } catch (error) {
        console.error("Failed to load startup branding", error);
      }
    };
    const handleBrandingUpdated = (event) => {
      const payload = event?.detail;
      if (payload && typeof payload === "object") {
        setBrandingLoaded(true);
        setBranding((current) => ({
          ...current,
          ...payload,
          logo: payload.logo || current.logo || DEFAULT_STARTUP_LOGO,
        }));
      } else {
        loadBranding();
      }
    };

    loadBranding();
    window.addEventListener("branding-updated", handleBrandingUpdated);
    return () => {
      active = false;
      window.removeEventListener("branding-updated", handleBrandingUpdated);
    };
  }, []);

  const value = useMemo(() => ({
    auth,
    branding,
    reportResource,
    reportAvailability,
    retryKey,
    availabilityRetryKey,
    routeId,
    routeReady: pageReady,
  }), [
    auth,
    branding,
    reportResource,
    reportAvailability,
    retryKey,
    availabilityRetryKey,
    routeId,
    pageReady,
  ]);

  if (bootstrap.status === "checking") {
    return <LoadingScreen
      key={startupAttempt}
      logo={branding.logo}
      logoKey={`${startupAttempt}:${brandingLoaded}`}
      progress={progress}
    />;
  }
  if (bootstrap.status === "error") {
    return <ErrorScreen
      message={bootstrap.message}
      onRetry={retryStartup}
      logo={brandingLoaded ? branding.logo : ""}
    />;
  }

  return (
    <StartupReadinessContext.Provider value={value}>
      <div
        className="startup-readiness-content"
        aria-hidden={!routeReady}
        inert={!routeReady}
      >
        {children}
      </div>
      {!routeReady && (
        <div className="startup-readiness-cover">
          {routeError
            ? <ErrorScreen
                message={routeError}
                onRetry={availabilityRequired && currentAvailability?.status === "error" ? retryAvailability : retryRoute}
                logo={brandingLoaded ? branding.logo : ""}
              />
            : <LoadingScreen
                key={`${routeId}:${retryKey}:${availabilityRetryKey}`}
                logo={branding.logo}
                logoKey={`${routeId}:${retryKey}:${availabilityRetryKey}:${brandingLoaded}`}
                progress={progress}
              />}
        </div>
      )}
    </StartupReadinessContext.Provider>
  );
}

export function useStartupReadiness() {
  return useContext(StartupReadinessContext) || DEFAULT_READINESS;
}
