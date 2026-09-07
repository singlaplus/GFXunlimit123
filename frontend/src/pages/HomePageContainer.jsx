import HomePage from "./HomePage";

export default function HomePageContainer(props) {
  return (
    <>
      <HomePage {...props.homePageProps} />
    </>
  );
}