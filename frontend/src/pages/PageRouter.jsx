import HomePageContainer from "./HomePageContainer";
import FavoritesPage from "./FavoritesPage";
import DownloadsPage from "./DownloadsPage";
import UploadPage from "./UploadPage";
import ProfilePage from "./ProfilePage";

export default function PageRouter(props) {
  return (
  <>
    {props.activePage === "home" && (
      <HomePageContainer
        homePageProps={props.homePageProps}
        galleryProps={props.galleryProps}
        loading={props.loading}
        filteredImages={props.filteredImages}
        currentPage={props.currentPage}
        totalPages={props.totalPages}
        totalImages={props.totalImages}
        setCurrentPage={props.setCurrentPage}
        selectedImage={props.selectedImage}
        setSelectedImage={props.setSelectedImage}
        darkMode={props.darkMode}
        relatedImages={props.relatedImages}
        fetchSingleImage={props.fetchSingleImage}
        goToPreviousImage={props.goToPreviousImage}
        goToNextImage={props.goToNextImage}
        likeImage={props.likeImage}
        addFavorite={props.addFavorite}
        downloadImage={props.downloadImage}
        shareImage={props.shareImage}
        selectedContributor={props.selectedContributor}
        setSelectedContributor={props.setSelectedContributor}
        contributorImages={props.contributorImages}
        contributorLikes={props.contributorLikes}
        contributorViews={props.contributorViews}
        contributorDownloads={props.contributorDownloads}
        contributorBestImage={props.contributorBestImage}
      />
    )}
  </>
);