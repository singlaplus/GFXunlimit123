import { Navigate, useLocation } from "react-router-dom";
import HomeSection from "./HomeSection";
import ExplorePage from "../pages/ExplorePage";
import FavoritesPage from "../pages/FavoritesPage";
import DownloadsPage from "../pages/DownloadsPage";
import UploadPage from "../pages/UploadPage";
import DashboardPage from "../pages/DashboardPage";
import ProfilePage from "../pages/ProfilePage";
import PublicProfilePage from "../pages/PublicProfilePage";
import PublicContributorPage from "../pages/PublicContributorPage";
import AccountSettingsPage from "../pages/AccountSettingsPage";
import PaymentsPage from "../pages/PaymentsPage";
import ContributorPage from "../pages/ContributorPage";
import MyUploadsPage from "../pages/MyUploadsPage";
import AdminPage from "../pages/AdminPage";
import AdminEmailTemplates from "../pages/AdminEmailTemplates";
import AdminEmailScheduled from "../pages/AdminEmailScheduled";
import AdminAnalyticsPage from "../pages/AdminAnalyticsPage";
import AdminOrdersPage from "../pages/AdminOrdersPage";
import AdminCommercePage from "../pages/AdminCommercePage";
import AdminCustomerCreditsPage from "../pages/AdminCustomerCreditsPage";
import AdminSubscribersPage from "../pages/AdminSubscribersPage";
import AdminCurrentPlansPage from "../pages/AdminCurrentPlansPage";
import SubscriptionCheckoutPage from "../pages/SubscriptionCheckoutPage";
import BulkUploadPage from "../pages/BulkUploadPage";
import OrderHistoryPage from "../pages/OrderHistoryPage";
import AssetPage from "../pages/AssetPage";
import CartPage from "../pages/CartPage";
import CheckoutPage from "../pages/CheckoutPage";
import CompanyPage from "./CompanyPage";
import { isAdminRole, isContributorRole } from "../utils/role";
import { resolveActivePage } from "../utils/routeState";
import ProtectedRoute from "./ProtectedRoute";
import MessagesPage from "../pages/MessagesPage";

export default function AppRoutes(props) {
  const loc = useLocation();
  const pathname = (loc && loc.pathname) || (typeof window !== 'undefined' ? window.location.pathname : '/');
  const search = (loc && loc.search) || (typeof window !== 'undefined' ? window.location.search : '');

  const adminBasePath = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
  const explorePaths = new Set(["/explore", "/search", "/photos", "/vectors", "/psd", "/psds", "/videos", "/templates"]);

  if (pathname === "/profile" && search.includes("tab=controls")) {
    return <Navigate to={`${adminBasePath}?tab=controls`} replace />;
  }

  const normalizedUserRole = (props.userRole || "").toString();
  const resolvedActivePage = resolveActivePage(pathname) || "home";

  if (isContributorRole(normalizedUserRole) && explorePaths.has(pathname)) {
    return <Navigate to="/myuploads" replace />;
  }

  if (pathname === "/about") return <CompanyPage slug="about" />;
  if (pathname === "/pricing") return <CompanyPage slug="pricing" />;
  if (pathname === "/account-settings") return <AccountSettingsPage darkMode={props.darkMode} username={props.username} />;
  if (pathname === "/messages") {
    return (
      <ProtectedRoute allowedRoles={["customer", "buyer", "contributor", "admin"]} userRole={normalizedUserRole}>
        <MessagesPage darkMode={props.darkMode} userRole={normalizedUserRole} />
      </ProtectedRoute>
    );
  }
  if (pathname.startsWith("/c/c/c/c/")) return <PublicContributorPage darkMode={props.darkMode} username={decodeURIComponent(pathname.replace("/c/c/c/c/", ""))} />;
  if (pathname === "/public-profile") return <PublicProfilePage darkMode={props.darkMode} username={props.username} />;
  if (pathname === "/careers") return <CompanyPage slug="careers" />;
  if (pathname === "/contact") return <CompanyPage slug="contact" />;
  if (pathname === `${adminBasePath}/email/templates` || pathname === "/admin/email/templates") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminEmailTemplates />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/email/scheduled` || pathname === "/admin/email/scheduled") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminEmailScheduled />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/email/daily-report-settings` || pathname === "/admin/email/daily-report-settings") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminPage initialDailyReportSettingsPage />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/email/daily-report-preview` || pathname === "/admin/email/daily-report-preview") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminPage initialDailyReportPreviewPage />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/analytics` || pathname === "/admin/analytics") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminAnalyticsPage />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/commerce` || pathname === "/admin/commerce") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminCommercePage />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/orders` || pathname === "/admin/orders") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminOrdersPage />
      </ProtectedRoute>
    );
  }

  if (pathname === "/admin/customer-credits") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminCustomerCreditsPage />
      </ProtectedRoute>
    );
  }

  if (pathname === "/admin/subscribers") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminSubscribersPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/admin/custom-subscriptions") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminSubscribersPage
          darkMode={props.darkMode}
          pageTitle="Custom Subscriptions"
          pageSubtitle="Customer custom pricing requests and subscription approvals."
          pageMode="custom-requests"
        />
      </ProtectedRoute>
    );
  }

  if (pathname === "/admin/current-plans") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminCurrentPlansPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/checkout/subscription") {
    return (
      <ProtectedRoute allowedRoles={["customer", "buyer", "admin"]} userRole={normalizedUserRole}>
        <SubscriptionCheckoutPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/orders" || pathname.startsWith("/orders/")) {
    return (
      <ProtectedRoute allowedRoles={["customer", "buyer", "contributor"]} userRole={normalizedUserRole}>
        <OrderHistoryPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/cart") {
    return (
      <ProtectedRoute allowedRoles={["customer", "buyer"]} userRole={normalizedUserRole}>
        <CartPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/checkout") {
    return (
      <ProtectedRoute allowedRoles={["customer", "buyer"]} userRole={normalizedUserRole}>
        <CheckoutPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/bulk-upload") {
    return (
      <ProtectedRoute
        allowedRoles={["contributor"]}
        allowedPermissions={["bulk_upload"]}
        userRole={normalizedUserRole}
        userPermissions={props.userPermissions}
        fallback={<Navigate to="/myuploads" replace />}
      >
        <BulkUploadPage darkMode={props.darkMode} username={props.username} />
      </ProtectedRoute>
    );
  }

  if (pathname.startsWith("/asset/")) {
    const assetSlug = pathname.replace("/asset/", "");
    const parts = assetSlug.split("-");
    const assetId = parts.length > 0 ? parts[parts.length - 1] : assetSlug;
    return <AssetPage imageId={assetId} darkMode={props.darkMode} />;
  }

  return (
    <>
      {/* HOME */}
      {resolvedActivePage === "home" && (
        <HomeSection
          homePageProps={props.homeSectionProps.homePageProps}
        />
      )}

      {/* EXPLORE */}
      {resolvedActivePage === "explore" && (
        <ExplorePage
          galleryProps={props.homeSectionProps.galleryProps}

          loading={props.homeSectionProps.containerProps.loading}

          filteredImages={props.homeSectionProps.containerProps.filteredImages}

          currentPage={props.homeSectionProps.containerProps.currentPage}

          totalPages={props.homeSectionProps.containerProps.totalPages}

          totalImages={props.homeSectionProps.containerProps.totalImages}

          setCurrentPage={props.homeSectionProps.containerProps.setCurrentPage}

          selectedImage={props.homeSectionProps.containerProps.selectedImage}

          setSelectedImage={props.homeSectionProps.containerProps.setSelectedImage}

          darkMode={props.homeSectionProps.containerProps.darkMode}

          relatedImages={props.homeSectionProps.containerProps.relatedImages}

          fetchSingleImage={props.homeSectionProps.containerProps.fetchSingleImage}

          goToPreviousImage={props.homeSectionProps.containerProps.goToPreviousImage}

          goToNextImage={props.homeSectionProps.containerProps.goToNextImage}

          likeImage={props.homeSectionProps.containerProps.likeImage}

          addFavorite={props.homeSectionProps.containerProps.addFavorite}

          downloadImage={props.homeSectionProps.containerProps.downloadImage}

          shareImage={props.homeSectionProps.containerProps.shareImage}

          selectedContributor={props.homeSectionProps.popupProps.selectedContributor}

          setSelectedContributor={props.homeSectionProps.popupProps.setSelectedContributor}

          contributorImages={props.homeSectionProps.popupProps.contributorImages}

          contributorLikes={props.homeSectionProps.popupProps.contributorLikes}

          contributorViews={props.homeSectionProps.popupProps.contributorViews}

          contributorDownloads={props.homeSectionProps.popupProps.contributorDownloads}

          contributorBestImage={props.homeSectionProps.popupProps.contributorBestImage}
        />
      )}

      {/* DASHBOARD */}
      {(resolvedActivePage === "dashboard" || resolvedActivePage === "customer") && (
        <DashboardPage
          dashboardProps={props.dashboardProps}
          darkMode={props.darkMode}
          userRole={props.userRole}
        />
      )}

      {/* FAVORITES */}
      {resolvedActivePage === "favorites" && (
        <FavoritesPage
          darkMode={props.darkMode}
          username={props.username}
        />
      )}

      {/* DOWNLOADS */}
      {resolvedActivePage === "downloads" && (
        <DownloadsPage
          darkMode={props.darkMode}
          username={props.username}
        />
      )}

      {/* UPLOAD */}
      {resolvedActivePage === "upload" && (
        <UploadPage
          darkMode={props.darkMode}
          username={props.username}
          fetchImages={props.fetchImages}
        />
      )}

      {/* PROFILE */}
      {resolvedActivePage === "profile" && (
        <ProfilePage
          darkMode={props.darkMode}
          username={props.username}
        />
      )}
      {resolvedActivePage === "payments" && (
        <PaymentsPage />
      )}
      {resolvedActivePage === "myuploads" && (
        <MyUploadsPage darkMode={props.darkMode} />
      )}
      {resolvedActivePage === "admin" && (
        <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
          <AdminPage />
        </ProtectedRoute>
      )}
      {window.location.pathname === `${adminBasePath}/email/templates` && isAdminRole(normalizedUserRole) && (
        <AdminEmailTemplates />
      )}
      {resolvedActivePage === "contributor" && (
        <ProtectedRoute allowedRoles={["contributor"]} userRole={normalizedUserRole}>
          <ContributorPage dashboardProps={props.dashboardProps} />
        </ProtectedRoute>
      )}
    </>
  );
}