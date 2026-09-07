import DashboardContainer from "./DashboardContainer";

import AnalyticsDashboard from "../components/dashboard/AnalyticsDashboard";
import AdminDashboard from "../components/dashboard/AdminDashboard";
import ContributorDashboard from "../components/dashboard/ContributorDashboard";
import CustomerDashboard from "../components/dashboard/CustomerDashboard";
import { normalizeRole } from "../utils/role";

import { useEffect } from "react";

export default function DashboardPage(props) {

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab === "analytics") {
        const el = document.getElementById("analytics");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    } catch (err) {
      // ignore
    }
  }, []);

  const normalizedRole = normalizeRole(props.userRole);

  if (normalizedRole === "customer" || normalizedRole === "buyer") {
    return (
      <CustomerDashboard
        darkMode={props.darkMode}
        username={props.dashboardProps?.username}
      />
    );
  }

  return (
    <>
      {normalizedRole === "contributor" ? (
        <>
          <ContributorDashboard
            reputationScore={props.dashboardProps?.reputationScore}
            reputationTier={props.dashboardProps?.reputationTier}
            totalEarnings={props.dashboardProps?.earningsStats?.total_earnings}
            totalDownloads={props.dashboardProps?.earningsStats?.total_downloads}
            totalUploads={props.dashboardProps?.dashboardStats?.uploads}
            likes={props.dashboardProps?.dashboardStats?.likes}
            views={props.dashboardProps?.dashboardStats?.views}
            monthsOld={props.dashboardProps?.monthsOld}
            darkMode={props.darkMode}
            username={props.dashboardProps?.username}
            userPermissions={props.userPermissions}
            branding={props.dashboardProps?.branding}
          />
        </>
      ) : (
        <DashboardContainer
          dashboardProps={props.dashboardProps}
        />
      )}

      {normalizedRole === "admin" && (
        <AdminDashboard />
      )}

      {normalizedRole === "contributor" && null}

      {!props.userRole && (
        <AnalyticsDashboard
          darkMode={props.darkMode}
        />
      )}
    </>
  );
}