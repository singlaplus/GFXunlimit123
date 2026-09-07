function Achievements({ dashboardStats }) {
  return (
    <>
      <h2>🏅 Achievements</h2>

      <div
        style={{
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
          marginTop: "10px",
          marginBottom: "20px",
        }}
      >
        {dashboardStats.uploads >= 10 && (
          <div
            style={{
              background: "#2196f3",
              color: "white",
              padding: "8px 15px",
              borderRadius: "20px",
              fontWeight: "bold",
            }}
          >
            📸 Beginner Contributor
          </div>
        )}

        {dashboardStats.uploads >= 50 && (
          <div
            style={{
              background: "#4caf50",
              color: "white",
              padding: "8px 15px",
              borderRadius: "20px",
              fontWeight: "bold",
            }}
          >
            🚀 Rising Creator
          </div>
        )}

        {dashboardStats.uploads >= 100 && (
          <div
            style={{
              background: "#ff9800",
              color: "white",
              padding: "8px 15px",
              borderRadius: "20px",
              fontWeight: "bold",
            }}
          >
            👑 Top Contributor
          </div>
        )}

        {dashboardStats.downloads >= 100 && (
          <div
            style={{
              background: "#9c27b0",
              color: "white",
              padding: "8px 15px",
              borderRadius: "20px",
              fontWeight: "bold",
            }}
          >
            ⬇ Download Master
          </div>
        )}

        {dashboardStats.likes >= 100 && (
          <div
            style={{
              background: "#e91e63",
              color: "white",
              padding: "8px 15px",
              borderRadius: "20px",
              fontWeight: "bold",
            }}
          >
            ❤️ Crowd Favorite
          </div>
        )}
      </div>
    </>
  );
}

export default Achievements;