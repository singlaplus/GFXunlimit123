import Profile from "../components/Profile";

export default function ProfilePage(props) {
  return (
    <Profile
      username={props.username}
      darkMode={props.darkMode}
    />
  );
}