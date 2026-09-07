import Header from "../components/home/Header/Header";
import FeaturedAssets from "../components/home/FeaturedAssets/FeaturedAssets";
import TrendingAssets from "../components/home/TrendingAssets/TrendingAssets";
import BrowseCollections from "../components/home/BrowseCollections/BrowseCollections";
// TopContributors removed per design request

function HomePage(props) {
  return (
    <>
      <Header {...props} />

      <BrowseCollections {...props} />

      <FeaturedAssets {...props} />

      <TrendingAssets {...props} />
    </>
  );
}

export default HomePage;