function TopContributors({
  leaderboard,
  darkMode,
}) {
  return (
    <>
      <h2
        style={{
          marginTop: "30px",
          marginBottom: "15px",
        }}
      >
        🏆 Top Contributors
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(250px,1fr))",
          gap: "15px",
          marginBottom: "30px",
        }}
      >
        {(leaderboard || [])
  .slice(0, 3)
  .map((user, index) => (
            <div
              key={index}
              style={{
                background: darkMode
                  ? "#1e1e1e"
                  : "white",
                padding: "20px",
                borderRadius: "15px",
                boxShadow:
                  "0 4px 12px rgba(0,0,0,0.15)",
              }}
            >
              <h3>
                {index === 0 && "🥇 "}
                {index === 1 && "🥈 "}
                {index === 2 && "🥉 "}
                {user.name}
              </h3>

              <p>
                📸 {user.uploads} Uploads
              </p>

              <p>
                ❤️ {user.likes} Likes
              </p>

              <p>
                👁 {user.views} Views
              </p>

              <p>
                ⬇ {user.downloads} Downloads
              </p>
            </div>
          ))}
      </div>
    </>
  );
}

export default TopContributors;