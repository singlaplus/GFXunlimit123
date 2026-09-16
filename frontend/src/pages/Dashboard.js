function Dashboard({
  totalImages,
  totalLikes,
  totalDownloads,
  totalViews,
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit,minmax(220px,1fr))",
        gap: "15px",
        marginBottom: "25px",
      }}
    >
      <div
        style={{
          background: "#2196f3",
          color: "white",
          padding: "20px",
          borderRadius: "15px",
          textAlign: "center",
        }}
      >
        <h2>{totalImages}</h2>
        <p>Total Images</p>
      </div>

      <div
        style={{
          background: "#e91e63",
          color: "white",
          padding: "20px",
          borderRadius: "15px",
          textAlign: "center",
        }}
      >
        <h2>{totalLikes}</h2>
        <p>Total Likes</p>
      </div>

      <div
        style={{
          background: "#4caf50",
          color: "white",
          padding: "20px",
          borderRadius: "15px",
          textAlign: "center",
        }}
      >
        <h2>{totalDownloads}</h2>
        <p>Total Downloads</p>
      </div>

      <div
        style={{
          background: "#ff9800",
          color: "white",
          padding: "20px",
          borderRadius: "15px",
          textAlign: "center",
        }}
      >
        <h2>{totalViews}</h2>
        <p>Total Views</p>
      </div>
    </div>
  );
}

export default Dashboard;