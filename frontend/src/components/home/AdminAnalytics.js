function AdminAnalytics(props) {

  const {
  darkMode,
  totalSiteImages,
  totalSiteLikes,
  totalSiteViews,
  totalSiteDownloads,
} = props;

  return (
    <>
  <h2>
    📊 Admin Analytics
  </h2>

  <div
    style={{
      display: "grid",
      gridTemplateColumns:
        "repeat(auto-fit,minmax(220px,1fr))",
      gap: "15px",
      marginBottom: "30px",
    }}
  >

    <div
      style={{
        background: darkMode
          ? "#1e1e1e"
          : "white",
        padding: "20px",
        borderRadius: "15px",
        textAlign: "center",
      }}
    >
      <h3>📸 Images</h3>
      <h2>{totalSiteImages || 0}</h2>
    </div>

    <div
      style={{
        background: darkMode
          ? "#1e1e1e"
          : "white",
        padding: "20px",
        borderRadius: "15px",
        textAlign: "center",
      }}
    >
      <h3>❤️ Likes</h3>
      <h2>{totalSiteLikes || 0}</h2>
    </div>

    <div
      style={{
        background: darkMode
          ? "#1e1e1e"
          : "white",
        padding: "20px",
        borderRadius: "15px",
        textAlign: "center",
      }}
    >
      <h3>👁 Views</h3>
      <h2>{totalSiteViews || 0}</h2>
    </div>

    <div
      style={{
        background: darkMode
          ? "#1e1e1e"
          : "white",
        padding: "20px",
        borderRadius: "15px",
        textAlign: "center",
      }}
    >
      <h3>⬇ Downloads</h3>
      <h2>{totalSiteDownloads || 0}</h2>
    </div>

  </div>
</>
  );
}

export default AdminAnalytics;