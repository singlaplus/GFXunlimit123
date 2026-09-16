import HomePageContainer from "../pages/HomePageContainer";
import "./HomeSection.css";

export default function HomeSection({
  homePageProps,
  galleryProps,
  containerProps,
  popupProps,
}) {
  return (
    <div className="home-section-shell">
      <HomePageContainer
      homePageProps={homePageProps}
      galleryProps={galleryProps}
      {...containerProps}
      {...popupProps}
    />
    </div>
  );
}