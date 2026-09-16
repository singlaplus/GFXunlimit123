import MyFavorites from "../components/MyFavorites";

export default function FavoritesPage(props) {
  return (
    <MyFavorites
      darkMode={props.darkMode}
      username={props.username}
    />
  );
}