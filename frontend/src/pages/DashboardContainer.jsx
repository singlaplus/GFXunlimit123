import DashboardHeader from "../components/dashboard/DashboardHeader";

export default function DashboardContainer({
  dashboardProps,
  children,
}) {
  return (
    <>
      <DashboardHeader {...dashboardProps} />

      {children}
    </>
  );
}