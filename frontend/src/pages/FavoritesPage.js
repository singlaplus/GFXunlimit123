import MyFavorites from "../components/MyFavorites";

function FavoritesPage({ darkMode, username }) {
  return (
    <MyFavorites
      darkMode={darkMode}
      username={username}
    />
  );
}

export default FavoritesPage;