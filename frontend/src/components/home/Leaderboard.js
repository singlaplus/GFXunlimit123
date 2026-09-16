function Leaderboard(props) {

  const {
    darkMode,
    contributorLeaderboard,
    notifications,
    getBadge,
    setViewContributorPage,
  } = props;
  const leaderboard = contributorLeaderboard || [];
const alerts = notifications || [];
  return (
    <>
      <h2>
  🏆 Contributor Leaderboard
</h2>

<div
  style={{
    background: darkMode
      ? "#1e1e1e"
      : "white",
    padding: "20px",
    borderRadius: "15px",
    marginBottom: "30px",
  }}
>

  {leaderboard.map(
    (user, index) => (

      <div
        key={user.username}
        style={{
          padding: "10px 0",
          borderBottom:
            index !==
            leaderboard.length - 1
              ? "1px solid #444"
              : "none",
        }}
      >

        <strong
  onClick={() => {
  console.log(user.username);
  setViewContributorPage(
    user.username
  );
}}
  style={{
    cursor: "pointer",
    color: "#2196f3",
  }}
>
  #{index + 1}
  {" "}
  {user.username}
</strong>
<p
  style={{
    color: "#ff9800",
    fontWeight: "bold",
    margin: "5px 0",
  }}
>
  {getBadge(user)}
</p>

        <p>
          📸 {user.uploads}
          {" "}
          | ❤️ {user.likes}
          {" "}
          | 👁 {user.views}
          {" "}
          | ⬇ {user.downloads}
        </p>

      </div>

    )
  )}
  <h2>
  🔔 Notifications
</h2>

<div
  style={{
    background: darkMode
      ? "#1e1e1e"
      : "white",
    padding: "20px",
    borderRadius: "15px",
    marginBottom: "30px",
  }}
>

  {alerts.map(
  (notification) => (

      <div
        key={notification.id}
        style={{
          padding: "10px 0",
          borderBottom:
            "1px solid #444",
        }}
      >

        {notification.message}

      </div>

    )
  )}

</div>
  <h2>
  🏅 Monthly Top Contributors
</h2>

<div
  style={{
    background: darkMode
      ? "#1e1e1e"
      : "white",
    padding: "20px",
    borderRadius: "15px",
    marginBottom: "30px",
  }}
>

  {leaderboard
  .slice(0, 5)
  .map((user, index) => (

      <div
        key={`monthly-${user.username}`}
        style={{
          padding: "10px 0",
          borderBottom:
            index !== 4
              ? "1px solid #444"
              : "none",
        }}
      >

        <strong
  onClick={() => {

    setViewContributorPage(
      user.username
    );

  }}
  style={{
    cursor: "pointer",
    color: "#2196f3"
  }}
>

  {index === 0
    ? "🥇"
    : index === 1
    ? "🥈"
    : index === 2
    ? "🥉"
    : "🏅"}

  {" "}
  {user.username}

</strong>

        <p>
          💰 $
          {(
            user.downloads * 0.15
          ).toFixed(2)}
        </p>

      </div>

    ))}

</div>


</div>

    </>
  );
}

export default Leaderboard;