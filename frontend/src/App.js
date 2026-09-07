import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import FloatingAuth from "./components/FloatingAuth";
import AppRoutes from "./components/AppRoutes";
import useNotifications from "./hooks/useNotifications";
import useNotificationLoader from "./hooks/useNotificationLoader";
import useProfile from "./hooks/useProfile";
import AppHeader from "./components/AppHeader";
import { normalizeRole } from "./utils/role";
import Footer from "./components/Footer";
import useHeroStats from "./hooks/useHeroStats";
import useImageActions from "./hooks/useImageActions";
import useContributorNavigation from "./hooks/useContributorNavigation";
import useLeaderboard from "./hooks/useLeaderboard";
import useImages from "./hooks/useImages";
import useDashboard from "./hooks/useDashboard";
import useContributorStats from "./hooks/useContributorStats";
import useEarnings from "./hooks/useEarnings";
import useTrendingKeywords from "./hooks/useTrendingKeywords";
import useFilteredImages from "./hooks/useFilteredImages";
import useDashboardImages from "./hooks/useDashboardImages";
import useContributorPageStats from "./hooks/useContributorPageStats";
import useContributorPopup from "./hooks/useContributorPopup";
import useImageNavigation from "./hooks/useImageNavigation";
import useKeyboardNavigation from "./hooks/useKeyboardNavigation";
import "react-toastify/dist/ReactToastify.css";
import { ToastContainer } from "react-toastify";
import { applyTheme, getInitialDarkMode } from "./utils/theme";
import { WATCH_CONFIG_STORAGE_KEY, DEFAULT_WATCH_CONFIG } from "./utils/watchConfigOptions";
import { getStoredExploreFilterState, saveExploreFilterState } from "./utils/exploreFilters";
import { AUTH_BUSY_START, AUTH_BUSY_END } from "./utils/authBusyEvents";
import { getEffectiveAuthToken } from "./utils/authSession";

function App() {
  const loc = useLocation();
  const location = loc || (typeof window !== 'undefined' ? window.location : { search: '', pathname: '/' });

  const [authVersion, setAuthVersion] = useState(0);
  const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
  const username = typeof window !== "undefined" ? localStorage.getItem("username") || "" : "";

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleAuthChanged = () => {
      setAuthVersion((value) => value + 1);
    };

    window.addEventListener("auth-changed", handleAuthChanged);
    return () => window.removeEventListener("auth-changed", handleAuthChanged);
  }, []);

  // Restore session from httpOnly cookie on app initialization
  useEffect(() => {
    if (typeof window === "undefined") return;

    const restoreSession = async () => {
      try {
        const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
        const response = await axios.get(`${apiBaseUrl}/me`, { withCredentials: true });
        
        if (response.data && response.data.id) {
          // Session is still valid, restore user data to localStorage so the UI can render immediately.
          localStorage.setItem("username", response.data.username || "");
          localStorage.setItem("email", response.data.email || "");
          localStorage.setItem("userRole", response.data.role || "");
          if (response.data.customPermissions) {
            localStorage.setItem("userPermissions", JSON.stringify(response.data.customPermissions));
          }
          window.dispatchEvent(new Event("auth-changed"));
        }
      } catch (err) {
        // Not authenticated - this is fine, user is logged out
        console.debug("No active session found");
      }
    };

    restoreSession();
  }, []);

  const [userRole, setUserRole] = useState(() => {
    if (typeof window === "undefined") return "";
    return normalizeRole(localStorage.getItem("userRole") || "");
  });
  const [userPermissions, setUserPermissions] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem("userPermissions") || "{}");
    } catch (err) {
      return {};
    }
  });
  const [watchConfig, setWatchConfig] = useState(DEFAULT_WATCH_CONFIG);
  const [liveTime, setLiveTime] = useState(new Date());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextUserRole = normalizeRole(localStorage.getItem("userRole") || "");
    if (nextUserRole) {
      setUserRole(nextUserRole);
    }
  }, [authVersion]);
  const [branding, setBranding] = useState({});
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [authBusyType, setAuthBusyType] = useState("");

  const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

  useProfile(setUserRole, setUserPermissions);

  useEffect(() => {
    const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

    const loadBranding = async () => {
      try {
        const res = await axios.get(`${apiBaseUrl}/branding`);
        setBranding(res.data || {});
      } catch (err) {
        console.error("Failed to load branding", err);
      }
    };

    loadBranding();
    const handleBrandingUpdated = (event) => {
      const payload = event?.detail || null;
      if (payload && typeof payload === "object") {
        setBranding(payload);
        return;
      }
      loadBranding();
    };
    window.addEventListener("branding-updated", handleBrandingUpdated);

    return () => window.removeEventListener("branding-updated", handleBrandingUpdated);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextTitle = branding?.topTab || branding?.browserTabTitle || "React App";
    document.title = nextTitle;
  }, [branding]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo(0, 0);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleBusyStart = (event) => {
      setAuthBusyType(event?.detail?.type || "login");
      setIsAuthBusy(true);
    };
    const handleBusyEnd = () => {
      setIsAuthBusy(false);
      setAuthBusyType("");
    };

    window.addEventListener(AUTH_BUSY_START, handleBusyStart);
    window.addEventListener(AUTH_BUSY_END, handleBusyEnd);

    return () => {
      window.removeEventListener(AUTH_BUSY_START, handleBusyStart);
      window.removeEventListener(AUTH_BUSY_END, handleBusyEnd);
    };
  }, []);

/* =========================================
   IMAGE DATA
========================================= */
  const [images, setImages] = useState([]);
  
  const [leaderboard, setLeaderboard] =
  useState([]);
  const heroStats =
useHeroStats();
useEffect(() => {
  if (process.env.NODE_ENV === "test") return;

  axios.post(
    `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/track-visitor`
  );

}, []);
/* =========================================
   NOTIFICATIONS
========================================= */
  const [notifications, setNotifications] = useState([]);
  const [notificationCount, setNotificationCount] = useState(0);
  const {
  notifySuccess,
  notifyError,
  clearAllNotifications,
} = useNotifications(
  setNotifications,
  setNotificationCount
);

const [showNotifications, setShowNotifications] = useState(false);

  /* =========================================
   AUTHENTICATION
========================================= */
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinModalAccountType, setJoinModalAccountType] = useState("");

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(WATCH_CONFIG_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setWatchConfig(parsed);
        }
      } catch (err) {
        console.error('Invalid watch config', err);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);


  /* =========================================
   GALLERY
========================================= */
  const [search, setSearch] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("type") || "";
  });
  const initialExploreFilterState = getStoredExploreFilterState();
  const [selectedCategory, setSelectedCategory] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const categoryParam = params.get("category") || initialExploreFilterState.category;
    return categoryParam;
  });
  const [selectedCollection, setSelectedCollection] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const collectionParam = params.get("collection") || initialExploreFilterState.collection;
    return collectionParam;
  });

  const [selectedImage, setSelectedImage] =
    useState(null);
    const {
  likeImage: hookLikeImage,
  addFavorite: hookAddFavorite,
  downloadImage: hookDownloadImage,
  shareImage: hookShareImage,
} = useImageActions({
  images,
  setImages,
  selectedImage,
  setSelectedImage,
  notifySuccess,
  notifyError,
});

/* =========================================
   CONTRIBUTOR
========================================= */
    const [selectedContributor, setSelectedContributor] =
  useState(null);
  const {
  viewContributorPage,
} = useContributorNavigation();
    const [relatedImages, setRelatedImages] =
  useState([]);
/*******************************************
   UI SETTINGS
********************************************/
  const [darkMode, setDarkMode] = useState(getInitialDarkMode);

  useEffect(() => {
    applyTheme(darkMode);
  }, [darkMode]);

  const [sortType, setSortType] = useState("newest");
  const [resultsPerPage, setResultsPerPage] = useState(20);

  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalImages, setTotalImages] = useState(0);
  const [totalLikes, setTotalLikes] = useState(0);
  const [totalDownloads, setTotalDownloads] = useState(0);
  const [totalViews, setTotalViews] = useState(0);

const imagesPerPage = resultsPerPage;
useLeaderboard(
  currentPage,
  setLeaderboard
);
const {
  fetchImages,
  fetchSingleImage,
} = useImages({
  currentPage,
  imagesPerPage,
  images,
  setImages,
  setLoading,
  setTotalImages,
  setTotalLikes,
  setTotalDownloads,
  setTotalViews,
  setTotalPages,
  selectedCategory,
  selectedCollection,
});
  /* =========================================
   DASHBOARD
========================================= */
  const {
  dashboardStats,
} = useDashboard();
  const [earningsStats, setEarningsStats] =
  useState({
    total_earnings: 0,
    total_downloads: 0,
    total_images: 0
  });
const {
  contributorRank,
  nextRank,
  maxUploads,
  contributorLevel,
  avgDownloadsPerImage,
  likeRate,
  viewDownloadRate,
  reputationScore,
  reputationTier,
  rawScore,
  monthsOld,
} = useContributorStats(
  dashboardStats
);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextSearch = params.get("type") || "";
    const nextQueryCategory = params.get("category");
    const nextQueryCollection = params.get("collection");
    const routeCollectionMap = {
      "/photos": "Photos",
      "/vectors": "Vectors",
      "/psds": "Psd",
      "/psd": "Psd",
      "/videos": "Videos",
      "/templates": "Templates",
    };

    const routeCollection = routeCollectionMap[location.pathname];

    setSearch(nextSearch);

    if (nextQueryCategory) {
      setSelectedCategory(nextQueryCategory);
    } else {
      setSelectedCategory("All");
    }

    if (nextQueryCollection) {
      setSelectedCollection(nextQueryCollection);
    } else if (routeCollection) {
      setSelectedCollection(routeCollection);
    } else {
      setSelectedCollection("All");
    }
  }, [location.search, location.pathname]);

  useEffect(() => {
    saveExploreFilterState({ category: selectedCategory, collection: selectedCollection });
  }, [selectedCategory, selectedCollection]);

  useEarnings({
  token,
  setEarningsStats,
});

  

useNotificationLoader({
  setNotifications,
  setNotificationCount,
});
const trendingKeywords = useTrendingKeywords();

  /* DOWNLOAD IMAGE */

/* SHARE IMAGE */
const filteredImages = useFilteredImages({
  images,
  search,
  selectedCategory,
  selectedCollection,
  sortType,
});
const {
  featuredImages,
  topImage,
} = useDashboardImages(images);

  const [serverTrendingImages, setServerTrendingImages] = useState([]);
  const [featuredImageIds, setFeaturedImageIds] = useState([]);

  useEffect(() => {
    setFeaturedImageIds(
      Array.isArray(featuredImages)
        ? featuredImages.map((image) => String(image.id))
        : []
    );
  }, [featuredImages]);

  const featuredImageIdSet = new Set(featuredImageIds.map(String));
  const nonOverlappingTrendingImages = serverTrendingImages.filter(
    (image) => !featuredImageIdSet.has(String(image.id))
  );

  useEffect(() => {
    const fetchTrending = async () => {
      try {
        const res = await axios.get(
          `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/images/trending?limit=5`
        );
        setServerTrendingImages(res.data || []);
      } catch (err) {
        console.error("Failed to load server trending images", err);
      }
    };

    fetchTrending();
  }, []);
  
  const {
  contributorPageImages,
  contributorPageLikes,
  contributorPageViews,
  contributorPageDownloads,
  estimatedEarnings,
  contributorEarnings,
  monthlyEarnings,
  topContributorImages,
  topEarningImage,
  contributorBadge,
  nextLevel,
  progress,
  targetDownloads,
} = useContributorPageStats(
  images,
  viewContributorPage
);
  
  const {
  contributorImages,
  contributorLikes,
  contributorViews,
  contributorDownloads,
  contributorBestImage,
} = useContributorPopup(
  images,
  selectedContributor
);

  const {
  goToNextImage,
  goToPreviousImage,
} = useImageNavigation({
  filteredImages,
  selectedImage,
  fetchSingleImage,
});

  useKeyboardNavigation({
  selectedImage,
  setSelectedImage,
  goToNextImage,
  goToPreviousImage,
  filteredImages,
});
const homePageProps = {
  darkMode,
  username,
  totalImages,
  images,
  trendingKeywords,
  setSearch,
  setShowJoinModal,
  setJoinModalAccountType,
  heroStats,
  contributorRank,
  contributorLevel,
  topImage,
  featuredImages,
  trendingImages: nonOverlappingTrendingImages,
  fetchSingleImage,
  onFeaturedImageIdsLoaded: setFeaturedImageIds,
  leaderboard,
  contributorPageImages,
  contributorPageLikes,
  contributorPageViews,
  contributorPageDownloads,
  estimatedEarnings,
  topContributorImages,
  contributorBadge,
  topEarningImage,
  nextLevel,
  progress,
  targetDownloads,
  contributorEarnings,
  monthlyEarnings,
  setCurrentPage,
  setSortType,
  branding,
};
const galleryProps = {
  search,
  setSearch,
  setCurrentPage,
  sortType,
  setSortType,
  selectedCategory,
  setSelectedCategory,
  selectedCollection,
  setSelectedCollection,
  allImages: images,
  totalImages,
  resultsPerPage,
  setResultsPerPage,
};
const containerProps = {
  loading,
  filteredImages,
  currentPage,
  totalPages,
  totalImages,
  setCurrentPage,
  selectedImage,
  setSelectedImage,
  darkMode,
  relatedImages,
  fetchSingleImage,
  goToPreviousImage,
  goToNextImage,
  likeImage: hookLikeImage,
  addFavorite: hookAddFavorite,
  downloadImage: hookDownloadImage,
  shareImage: hookShareImage,
};
const popupProps = {
  selectedContributor,
  setSelectedContributor,
  contributorImages,
  contributorLikes,
  contributorViews,
  contributorDownloads,
  contributorBestImage,
};
  
  return (

    <div
      style={{
        padding: "20px",
        background: darkMode
          ? "#121212"
          : "#f5f5f5",
        minHeight: "100vh",
        color: darkMode
          ? "white"
          : "black",
        position: "relative",
      }}
    >

{/*
<HomePage
  totalImages={totalImages}
  totalLikes={totalLikes}
  totalDownloads={totalDownloads}
  totalViews={totalViews}

  dashboardStats={dashboardStats}
  setActivePage={setActivePage}

  search={search}
  setSearch={setSearch}
    featuredImages={featuredImages}
    trendingImages={trendingImages}
    leaderboard={leaderboard}
  darkMode={darkMode}
  fetchSingleImage={fetchSingleImage}

  
/>
*/}

      <AppHeader
  showNotifications={showNotifications}
  setShowNotifications={setShowNotifications}
  notificationCount={notificationCount}
  setNotificationCount={setNotificationCount}
  setShowLoginModal={setShowLoginModal}
  setShowJoinModal={setShowJoinModal}
  showLoginModal={showLoginModal}
  showJoinModal={showJoinModal}
  joinModalAccountType={joinModalAccountType}
  setJoinModalAccountType={setJoinModalAccountType}
  darkMode={darkMode}
  notifications={notifications}
  clearAllNotifications={clearAllNotifications}
  setDarkMode={setDarkMode}
  userRole={userRole}
  userPermissions={userPermissions}
  earningsStats={earningsStats}
  setSearch={setSearch}
  setCurrentPage={setCurrentPage}
  setSortType={setSortType}
  setSelectedCategory={setSelectedCategory}
  setSelectedCollection={setSelectedCollection}
/>

      {isAuthBusy && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17, 24, 39, 0.34)",
            backdropFilter: "blur(7px)",
            WebkitBackdropFilter: "blur(7px)",
            zIndex: 99999,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            pointerEvents: "all",
          }}
        >
          {authBusyType === "logout" ? (
            branding?.favicon || branding?.logo ? (
              <img
                src={`${apiBaseUrl}${branding.favicon || branding.logo}`}
                alt="Brand icon"
                style={{
                  width: "120px",
                  height: "120px",
                  objectFit: "contain",
                }}
              />
            ) : (
              <span
                style={{
                  color: "#f8fafc",
                  fontSize: "42px",
                  fontWeight: 900,
                  fontFamily: "Inter, Arial, sans-serif",
                }}
              >
                G
              </span>
            )
          ) : branding?.logo ? (
            <img
              src={`${apiBaseUrl}${branding.logo}`}
              alt="Brand logo"
              style={{
                width: "140px",
                height: "140px",
                objectFit: "contain",
                animation: "authBusyLoginLogoPulse 2s ease-in-out infinite",
              }}
            />
          ) : branding?.favicon ? (
            <img
              src={`${apiBaseUrl}${branding.favicon}`}
              alt="Brand icon"
              style={{
                width: "140px",
                height: "140px",
                objectFit: "contain",
              }}
            />
          ) : (
            <span
              style={{
                color: "#f8fafc",
                fontSize: "48px",
                fontWeight: 900,
                fontFamily: "Inter, Arial, sans-serif",
              }}
            >
              G
            </span>
          )}
        </div>
      )}

     <AppRoutes
  username={username}
  darkMode={darkMode}
  userRole={userRole}
  userPermissions={userPermissions}
  fetchImages={fetchImages}
  homeSectionProps={{
    homePageProps,
    galleryProps,
    containerProps,
    popupProps,
  }}
  dashboardProps={{
    username,
    contributorRank,
    contributorLevel,
    reputationScore,
    rawScore,
    reputationTier,
    monthsOld,
    dashboardStats,
    maxUploads,
    nextRank,
    contributorBadge,
    earningsStats,
    avgDownloadsPerImage,
    likeRate,
    viewDownloadRate,
    darkMode,
    branding,
  }}
/>

<ToastContainer
  position="top-right"
  autoClose={3000}
  hideProgressBar={false}
  newestOnTop={true}
  closeOnClick={true}
  pauseOnHover={true}
  draggable={true}
  theme={darkMode ? "dark" : "light"}
/>
      <FloatingAuth
  darkMode={darkMode}
  setShowLoginModal={setShowLoginModal}
  setShowJoinModal={setShowJoinModal}
/>
      <Footer
  onOpenLogin={() => setShowLoginModal(true)}
  onOpenJoin={(type) => {
    setJoinModalAccountType(type);
    setShowJoinModal(true);
  }}
  isLoggedIn={Boolean(token)}
/>

      <div
        style={{
          marginTop: "24px",
          padding: "20px",
          background: darkMode ? "#0b1220" : "#f8fafc",
          borderTop: darkMode ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(15,23,42,0.08)",
          display: "flex",
          justifyContent: "center",
          alignItems: "stretch",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        {watchConfig.map((watch) => (
          <div
            key={watch.label}
            style={{
              minWidth: "min(180px, 100%)",
              flex: "1 1 180px",
              maxWidth: "220px",
              padding: "16px",
              borderRadius: "18px",
              background: darkMode ? "rgba(255,255,255,0.04)" : "#ffffff",
              border: darkMode ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(15,23,42,0.08)",
              boxShadow: darkMode ? "0 18px 48px rgba(0,0,0,0.18)" : "0 18px 48px rgba(15,23,42,0.08)",
              color: darkMode ? "#f8fafc" : "#0f172a",
              textAlign: "center",
              whiteSpace: "nowrap",
            }}
          >
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", marginBottom: "10px", fontSize: "clamp(0.58rem, 0.96vw, 0.66rem)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: darkMode ? "#9ca3af" : "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span>{watch.flag}</span>
              <span>{watch.label}</span>
            </div>
            <div style={{ fontSize: "clamp(0.88rem, 1.84vw, 1.48rem)", fontWeight: 800, marginBottom: "6px", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {liveTime.toLocaleTimeString("en-US", {
                timeZone: watch.timezone,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
              })}
            </div>
            <div style={{ fontSize: "clamp(0.60rem, 0.88vw, 0.68rem)", fontWeight: 600, color: darkMode ? "#cbd5e1" : "#475569", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {liveTime.toLocaleDateString("en-US", {
                timeZone: watch.timezone,
                weekday: "short",
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </div>
          </div>
        ))}
      </div>
    </div>

  );

}

export default App;