import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useRef, useState } from "react";
import axios from "axios";
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
import "./dashboard/TaxCenter.css";
import TaxW8BenForm from "./dashboard/TaxW8BenForm";
import TaxW9Form from "./dashboard/TaxW9Form";
import { getEffectiveAuthToken } from "../utils/authSession";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

function StartTaxFormMenu() {
  const location = useLocation();
  const navigate = useNavigate();
  const [earningsOpen, setEarningsOpen] = useState(true);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const navGroups = [
    { label: "", items: [["/dashboard", "Home"]] },
    { label: "Earnings", open: earningsOpen, setOpen: setEarningsOpen, items: [["/dashboard?tab=earningssummary", "Earnings summary"], ["/dashboard?tab=paymenthistory", "Payment history"], ["/dashboard?tab=taxcenter", "Tax center"]] },
    { label: "Insights", open: insightsOpen, setOpen: setInsightsOpen, items: [["/dashboard?tab=analytics", "Analytics"], ["/dashboard?tab=top-performer", "Top performer"], ["/dashboard?tab=blog", "Blog"], ["/dashboard?tab=trending-content", "Trending content"]] },
    { label: "", items: [["/dashboard?tab=portfolio", "Portfolio"]] },
    { label: "Account", open: accountOpen, setOpen: setAccountOpen, items: [["/dashboard?tab=account", "Account settings"], ["/public-profile", "Public profile"]] },
    { label: "", items: [["/contact", "Help"]] },
  ];
  const activeTab = new URLSearchParams(location.search).get("tab");

  return (
    <aside className="contributor-sidebar starttaxform-sidebar" aria-label="Contributor menu">
      <div className="contributor-nav">
        {navGroups.map((group, index) => (
          <div key={`${group.label || "main"}-${index}`}>
            {group.label ? <button type="button" className={group.open ? "is-active" : ""} onClick={() => group.setOpen((open) => !open)} aria-expanded={group.open}>{group.label}<span aria-hidden="true">{group.open ? "−" : "+"}</span></button> : null}
            {(!group.label || group.open) && <div className={group.label ? "contributor-subnav" : ""}>{group.items.map(([path, label]) => <button key={path} type="button" className={path === "/dashboard" && activeTab === null ? "is-active" : ""} onClick={() => navigate(path)}>{label}</button>)}</div>}
          </div>
        ))}
      </div>
    </aside>
  );
}

function StartTaxFormOptions() {
  const navigate = useNavigate();
  const [isUsPerson, setIsUsPerson] = useState("");
  const [entityType, setEntityType] = useState("");
  const isUsPersonSelect = useRef(null);
  const entityTypeSelect = useRef(null);
  const handleSubmit = () => {
    const selectedIsUsPerson = isUsPersonSelect.current?.value || isUsPerson;
    const selectedEntityType = entityTypeSelect.current?.value || entityType;
    if (!selectedIsUsPerson || !selectedEntityType) return;
    setIsUsPerson(selectedIsUsPerson);
    setEntityType(selectedEntityType);
    const useW9Form = selectedIsUsPerson === "Yes" || selectedEntityType === "Business";
    navigate(`/dashboard?tab=${useW9Form ? "filltaxform1" : "filltaxform"}`);
  };
  return (
    <main className="starttaxform-options-panel">
      <h1>Tax center</h1>
      <p>Before we can pay you, <strong>GFXunlimit</strong> needs to have your correct tax form on file.</p>
      <p>While we can't give you tax or legal advice, we've created the following questions to help you choose the best tax form and make your own decision about how to comply with applicable U.S. tax laws. If you still have questions after reviewing the information we've provided, please contact your legal and/or tax advisor.</p>
      <p>Please answer the following questions to help us determine which tax form is appropriate for your situation:</p>
      <div className="starttaxform-options-box">
        <label><span>For U.S. tax purposes, are you a U.S. person?</span><em>*</em><select ref={isUsPersonSelect} value={isUsPerson} onChange={(event) => setIsUsPerson(event.target.value)}><option value="">Select</option><option value="No">No</option><option value="Yes">Yes</option></select></label>
        <label><span>Are you contributing to <strong>GFXunlimit</strong> as an individual or as a business?</span><em>*</em><select ref={entityTypeSelect} value={entityType} onChange={(event) => setEntityType(event.target.value)}><option value="">Select</option><option value="Individual">Individual</option><option value="Business">Business</option></select></label>
      </div>
      <div className="starttaxform-options-submit"><button type="button" disabled={!isUsPerson || !entityType} onClick={handleSubmit}>Submit</button></div>
    </main>
  );
}

function FillTaxFormPage() {
  const navigate = useNavigate();
  return (
    <TaxW8BenForm
      onBack={() => navigate("/dashboard?tab=starttaxform")}
      onSubmit={(formData) => navigate("/dashboard?tab=filltaxform_review", { state: { formType: "W-8BEN", formData } })}
    />
  );
}

function FillTaxFormW9Page() {
  const navigate = useNavigate();
  return (
    <TaxW9Form
      onBack={() => navigate("/dashboard?tab=starttaxform")}
      onSubmit={(formData) => navigate("/dashboard?tab=filltaxform_review", { state: { formType: "W-9", formData } })}
    />
  );
}

function TaxFormReviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const formData = location.state?.formData || {};
  const formType = location.state?.formType || "Tax form";
  const detailEntries = Object.entries(formData).filter(([key, value]) => {
    if (key === "certification" || key === "certifications") return false;
    if (value === null || value === undefined || value === "") return false;
    if (Array.isArray(value)) return false;
    return true;
  });
  const submitTaxForm = async () => {
    setIsSubmitting(true);
    setSubmitError("");
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      await axios.post(`${API_BASE_URL}/profile/tax-form`, { ...formData, formType }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      navigate("/dashboard?tab=taxcenter");
    } catch (error) {
      console.error("Failed to submit tax form", error);
      setSubmitError("Unable to submit your tax form. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="starttaxform-layout">
      <StartTaxFormMenu />
      <main className="tax-form-review-panel">
        <div className="tax-form-review-header">
          <div>
            <p className="tax-form-review-kicker">Tax form review</p>
            <h1>Review tax form</h1>
          </div>
          <div className="tax-form-review-actions">
            <button type="button" className="tax-form-review-back" onClick={() => navigate("/dashboard?tab=starttaxform")}>Back</button>
            <button type="button" className="tax-form-review-submit" onClick={submitTaxForm} disabled={isSubmitting}>{isSubmitting ? "Submitting..." : "Submit"}</button>
          </div>
        </div>

        <p className="tax-form-review-subtitle">Please confirm the details below before submitting your {formType} form.</p>
        {submitError && <p role="alert" className="tax-form-review-error">{submitError}</p>}

        <section className="tax-form-review-card">
          <h2>{formType}</h2>
          <dl className="tax-form-review-list">
            {detailEntries.map(([key, value]) => (
              <div key={key} className="tax-form-review-item">
                <dt>{key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase())}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  );
}

export default function AppRoutes(props) {
  const loc = useLocation();
  const navigate = useNavigate();
  const pathname = (loc && loc.pathname) || (typeof window !== 'undefined' ? window.location.pathname : '/');
  const search = (loc && loc.search) || (typeof window !== 'undefined' ? window.location.search : '');

  const dashboardTab = new URLSearchParams(search).get("tab");
  if (pathname === "/dashboard" && dashboardTab === "filltaxform1") {
    return <div className="starttaxform-layout"><StartTaxFormMenu /><FillTaxFormW9Page /></div>;
  }

  if (pathname === "/dashboard" && dashboardTab === "filltaxform") {
    return <div className="starttaxform-layout"><StartTaxFormMenu /><FillTaxFormPage /></div>;
  }

  if (pathname === "/dashboard" && dashboardTab === "filltaxform_review") {
    return <TaxFormReviewPage />;
  }

  if (pathname === "/dashboard" && dashboardTab === "starttaxform") {
    return <div className="starttaxform-layout"><StartTaxFormMenu /><StartTaxFormOptions /></div>;
  }

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