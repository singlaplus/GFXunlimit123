import Upload from "../Upload";

export default function UploadPage(props) {
  return (
    <Upload
      username={props.username}
      darkMode={props.darkMode}
      fetchImages={props.fetchImages}
    />
  );
}