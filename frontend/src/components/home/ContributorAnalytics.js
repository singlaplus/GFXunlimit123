function ContributorAnalytics(props) {

  const {
    darkMode,
    dashboardStats,
    averageLikes,
    totalUserViews,
    totalUserDownloads,
    topImage,
  } = props;
  const stats = dashboardStats || {};

  return (
    <>
      <div
  style={{
    background: darkMode
      ? "#1e1e1e"
      : "white",
    padding: "20px",
    borderRadius: "15px",
    marginBottom: "30px",
    boxShadow:
      "0 4px 12px rgba(0,0,0,0.15)",
  }}
>

  <h2>
    📈 Contributor Analytics
  </h2>

  <div
  style={{
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(180px,1fr))",
    gap: "15px",
    marginTop: "15px",
  }}
>

  <div
    style={{
      background: "#673ab7",
      color: "white",
      padding: "15px",
      borderRadius: "12px",
      textAlign: "center",
    }}
  >
    <h2>{dashboardStats?.uploads || 0}</h2>
    <p>📸 Uploads</p>
  </div>

  <div
    style={{
      background: "#e91e63",
      color: "white",
      padding: "15px",
      borderRadius: "12px",
      textAlign: "center",
    }}
  >
    <h2>{averageLikes || 0}</h2>
    <p>❤️ Avg Likes</p>
  </div>

  <div
    style={{
      background: "#ff9800",
      color: "white",
      padding: "15px",
      borderRadius: "12px",
      textAlign: "center",
    }}
  >
    <h2>{totalUserViews || 0}</h2>
    <p>👁 Views</p>
  </div>

  <div
    style={{
      background: "#4caf50",
      color: "white",
      padding: "15px",
      borderRadius: "12px",
      textAlign: "center",
    }}
  >
    <h2>{totalUserDownloads || 0}</h2>
    <p>⬇ Downloads</p>
  </div>

</div>

<div
  style={{
    marginTop: "20px",
    padding: "15px",
    background: darkMode
      ? "#2a2a2a"
      : "#f5f5f5",
    borderRadius: "12px",
  }}
>
  <strong>
    🏆 Best Image:
  </strong>
  {" "}
  {topImage
    ? topImage.title
    : "No Images"}
</div>

</div>
    </>
  );
}

export default ContributorAnalytics;