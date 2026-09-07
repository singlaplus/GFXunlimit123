function Dashboard({
  darkMode,
  contributorRank,
  contributorLevel,
  username,
  totalUserUploads,
  totalUserLikes,
  totalUserViews,
  totalUserDownloads,
  topImage,
}) {
  const cardStyle = (color) => ({
    background: color,
    color: "white",
    padding: "15px",
    borderRadius: "12px",
    textAlign: "center",
  });

  return (
    <>
      <div
        style={{
          background:
            "linear-gradient(135deg,#2196f3,#673ab7)",
          color: "white",
          padding: "25px",
          borderRadius: "20px",
          marginBottom: "25px",
        }}
      >
        <h2>👋 Welcome Back, {username}</h2>

        <div
          style={{
            display: "inline-block",
            padding: "10px 20px",
            borderRadius: "30px",
            marginBottom: "20px",
            background:
              contributorRank === "Platinum"
                ? "#e5e4e2"
                : contributorRank === "Gold"
                ? "#ffd700"
                : contributorRank === "Silver"
                ? "#c0c0c0"
                : "#92918f",
            color: "black",
            fontWeight: "bold",
          }}
        >
          🏅 {contributorRank} Contributor
          <br />
          ⭐ Level {contributorLevel}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(170px,1fr))",
            gap: "15px",
          }}
        >
          <div style={cardStyle("#2196f3")}>
            <h2>{totalUserUploads}</h2>
            <p>📸 Uploads</p>
          </div>

          <div style={cardStyle("#e91e63")}>
            <h2>{totalUserLikes}</h2>
            <p>❤️ Likes</p>
          </div>

          <div style={cardStyle("#ff9800")}>
            <h2>{totalUserViews}</h2>
            <p>👁 Views</p>
          </div>

          <div style={cardStyle("#4caf50")}>
            <h2>{totalUserDownloads}</h2>
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
            color: darkMode ? "white" : "black",
            borderRadius: "12px",
          }}
        >
          <strong>🏆 Best Image:</strong>{" "}
          {topImage ? topImage.title : "No Images"}
        </div>
      </div>
    </>
  );
}

export default Dashboard;