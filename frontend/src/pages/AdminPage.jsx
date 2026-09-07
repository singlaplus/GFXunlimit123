import AdminPanel from "../components/AdminPanel";

export default function AdminPage({ initialDailyReportSettingsPage = false, initialDailyReportPreviewPage = false }) {
  return (
    <div style={{ padding: "20px" }}>
      <AdminPanel
        initialDailyReportSettingsPage={initialDailyReportSettingsPage}
        initialDailyReportPreviewPage={initialDailyReportPreviewPage}
      />
    </div>
  );
}
