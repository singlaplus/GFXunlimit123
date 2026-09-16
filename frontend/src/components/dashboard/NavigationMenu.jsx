export default function NavigationMenu({
  setActivePage,
  darkMode,
  setDarkMode,
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
          marginBottom: "20px",
        }}
      >
        <button onClick={() => setActivePage("home")}>
          🏠 Home
        </button>

        <button onClick={() => setActivePage("upload")}>
          📤 Upload
        </button>

        <button onClick={() => setActivePage("myuploads")}>
          📁 My Uploads
        </button>

        <button onClick={() => setActivePage("favorites")}>
          ⭐ Favorites
        </button>

        <button onClick={() => setActivePage("downloads")}>
          ⬇ Downloads
        </button>

        <button onClick={() => setActivePage("profile")}>
          👤 Profile
        </button>

        <button onClick={() => setActivePage("leaderboard")}>
          🏆 Leaderboard
        </button>

        <button onClick={() => setActivePage("analytics")}>
          📊 Analytics
        </button>
      </div>

      <button
        onClick={() => setDarkMode(!darkMode)}
        style={{
          padding: "10px 20px",
          background: darkMode ? "white" : "black",
          color: darkMode ? "black" : "white",
          border: "none",
          borderRadius: "8px",
          cursor: "pointer",
          marginBottom: "20px",
          fontWeight: "bold",
        }}
      >
        {darkMode ? "☀ Light Mode" : "🌙 Dark Mode"}
      </button>
    </>
  );
}