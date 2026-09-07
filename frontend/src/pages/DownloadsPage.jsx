import MyDownloads from "../components/MyDownloads";

export default function DownloadsPage(props) {
  return (
    <MyDownloads
      darkMode={props.darkMode}
      username={props.username}
    />
  );
}