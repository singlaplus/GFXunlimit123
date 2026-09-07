function QuickActions({ setActivePage }) {
  return (
    <>
      <h2>🚀 Quick Actions</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: "15px",
          marginBottom: "30px",
        }}
      >
        <div
          onClick={() => setActivePage("upload")}
          style={{
            background: "#2196f3",
            color: "white",
            padding: "25px",
            borderRadius: "15px",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          <h2>📤</h2>
          <h3>Upload Image</h3>
        </div>

        <div
          onClick={() => setActivePage("myuploads")}
          style={{
            background: "#673ab7",
            color: "white",
            padding: "25px",
            borderRadius: "15px",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          <h2>📁</h2>
          <h3>My Uploads</h3>
        </div>

        <div
          onClick={() => setActivePage("favorites")}
          style={{
            background: "#ff5722",
            color: "white",
            padding: "25px",
            borderRadius: "15px",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          <h2>⭐</h2>
          <h3>Favorites</h3>
        </div>

        <div
          onClick={() => setActivePage("downloads")}
          style={{
            background: "#4caf50",
            color: "white",
            padding: "25px",
            borderRadius: "15px",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          <h2>⬇</h2>
          <h3>Downloads</h3>
        </div>

        <div
          onClick={() => setActivePage("profile")}
          style={{
            background: "#e91e63",
            color: "white",
            padding: "25px",
            borderRadius: "15px",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          <h2>👤</h2>
          <h3>Profile</h3>
        </div>

        <div
          onClick={() => setActivePage("leaderboard")}
          style={{
            background: "#ff9800",
            color: "white",
            padding: "25px",
            borderRadius: "15px",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          <h2>🏆</h2>
          <h3>Leaderboard</h3>
        </div>
      </div>
    </>
  );
}

export default QuickActions;