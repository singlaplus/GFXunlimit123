function GoalsCard({ dashboardStats, darkMode }) {
  return (
    <div
      style={{
        background: darkMode ? "#1e1e1e" : "white",
        padding: "20px",
        borderRadius: "15px",
        marginBottom: "20px",
      }}
    >
      <h2>🎯 Goals</h2>

      <p>
        📸 Upload Goal: {dashboardStats.uploads} / 50
      </p>

      <progress
        value={dashboardStats.uploads}
        max="50"
        style={{
          width: "100%",
        }}
      />

      <p style={{ marginTop: "20px" }}>
        ❤️ Likes Goal: {dashboardStats.likes} / 100
      </p>

      <progress
        value={dashboardStats.likes}
        max="100"
        style={{
          width: "100%",
        }}
      />

      <p style={{ marginTop: "20px" }}>
        ⬇ Downloads Goal: {dashboardStats.downloads} / 50
      </p>

      <progress
        value={dashboardStats.downloads}
        max="50"
        style={{
          width: "100%",
        }}
      />

      <p style={{ marginTop: "20px" }}>
        👁 Views Goal: {dashboardStats.views} / 500
      </p>

      <progress
        value={dashboardStats.views}
        max="500"
        style={{
          width: "100%",
        }}
      />
    </div>
  );
}

export default GoalsCard;