import { useState } from "react";
import axios from "axios";
import ImageGallery from "./home/ImageGallery";
import "./MarketplaceContainer.css";
import LoadingMessage from "./LoadingMessage";
import EmptyMessage from "./EmptyMessage";
import ImageGrid from "./ImageGrid";
import Pagination from "./Pagination";
import GalleryImageViewer from "./gallery/GalleryImageViewer";
import ContributorPopup from "./gallery/ContributorPopup";

export default function MarketplaceContainer(props) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { search, setSearch, setCurrentPage, allImages = [] } = props.galleryProps || {};

  const suggestions = (allImages || [])
    .filter((image) => {
      const haystack = [image?.title || "", image?.description || "", image?.keywords || ""]
        .join(" ")
        .toLowerCase();
      return search?.trim() && haystack.includes(search.trim().toLowerCase());
    })
    .slice(0, 6);

  return (
    <div className="marketplace-shell">
      <div className="marketplace-searchbar">
        <div className="marketplace-searchbox">
          <input
            type="text"
            placeholder="Search images..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
            style={{
              width: "100%",
              padding: "16px 20px 16px 48px",
              borderRadius: "999px",
              border: props.darkMode ? "1px solid #3a3a3a" : "1px solid rgba(0,0,0,0.08)",
              background: props.darkMode ? "#232323" : "#ffffff",
              color: props.darkMode ? "#f5f5f5" : "#111",
              boxShadow: props.darkMode ? "0 12px 30px rgba(0,0,0,0.28)" : "0 12px 30px rgba(15, 23, 42, 0.08)",
              outline: "none",
              fontSize: "15px",
              fontWeight: 500,
            }}
          />
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "18px",
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: "18px",
              color: props.darkMode ? "#9ca3af" : "#6b7280",
            }}
          >
            🔍
          </span>

          {showSuggestions && search?.trim() && suggestions.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                left: 0,
                right: 0,
                background: props.darkMode ? "#1f1f1f" : "#ffffff",
                border: props.darkMode ? "1px solid #3a3a3a" : "1px solid #e5e7eb",
                borderRadius: "16px",
                boxShadow: props.darkMode ? "0 16px 40px rgba(0,0,0,0.3)" : "0 16px 40px rgba(15, 23, 42, 0.08)",
                zIndex: 20,
                overflow: "hidden",
              }}
            >
              {suggestions.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  onMouseDown={() => {
                    const searchTerm = image.title || image.description || image.keywords || "";
                    
                    // Track the search keyword
                    if (searchTerm) {
                      axios.post(
                        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/search-keyword`,
                        { keyword: searchTerm }
                      ).catch((err) => console.log("Search tracking error:", err));
                    }
                    
                    setSearch(searchTerm);
                    setCurrentPage(1);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    border: "none",
                    background: "transparent",
                    color: props.darkMode ? "#f5f5f5" : "#111",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{image.title || "Untitled asset"}</div>
                  <div style={{ color: props.darkMode ? "#9ca3af" : "#6b7280", marginTop: "2px" }}>
                    {image.description || image.keywords || "Matched via description or keywords"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="marketplace-layout">
        <div className="marketplace-sidebar">
          <ImageGallery {...props.galleryProps} darkMode={props.darkMode} />
        </div>

        <div className="marketplace-results">
          <LoadingMessage
            loading={props.loading}
            darkMode={props.darkMode}
          />

          <EmptyMessage
            loading={props.loading}
            filteredImages={props.filteredImages}
            darkMode={props.darkMode}
          />

          <ImageGrid
            filteredImages={props.filteredImages}
            darkMode={props.darkMode}
            fetchSingleImage={props.fetchSingleImage}
            likeImage={props.likeImage}
            addFavorite={props.addFavorite}
            downloadImage={props.downloadImage}
            shareImage={props.shareImage}
          />

          <Pagination
            currentPage={props.currentPage}
            totalPages={props.totalPages}
            totalImages={props.totalImages}
            setCurrentPage={props.setCurrentPage}
            darkMode={props.darkMode}
          />
        </div>
      </div>

      <GalleryImageViewer
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
      />

      <ContributorPopup
        selectedContributor={props.selectedContributor}
        setSelectedContributor={
          props.setSelectedContributor
        }
        darkMode={props.darkMode}
        contributorImages={props.contributorImages}
        contributorLikes={props.contributorLikes}
        contributorViews={props.contributorViews}
        contributorDownloads={
          props.contributorDownloads
        }
        contributorBestImage={
          props.contributorBestImage
        }
        fetchSingleImage={props.fetchSingleImage}
      />
    </div>
  );
}