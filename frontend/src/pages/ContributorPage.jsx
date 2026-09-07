import ContributorDashboard from "../components/dashboard/ContributorDashboard";

export default function ContributorPage(props) {

  return (
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
      />
    </>
  );

}
