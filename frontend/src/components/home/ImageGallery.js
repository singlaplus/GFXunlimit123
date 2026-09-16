import { useEffect, useState } from "react";
import axios from "axios";
import { normalizeCategoryFilterBucket, normalizeCollectionValue } from "../../hooks/useFilteredImages";

function ImageGallery(props) {

  const {
    search,
    setSearch,
    setCurrentPage,
    sortType,
    setSortType,
    selectedCategory,
    setSelectedCategory,
    selectedCollection,
    setSelectedCollection,
    darkMode,
    allImages = [],
    totalImages = 0,
    resultsPerPage = 20,
    setResultsPerPage = () => {},
  } = props;

  const [categories, setCategories] = useState([]);
  const [collections, setCollections] = useState([]);
  const [categoryCounts, setCategoryCounts] = useState({});
  const [collectionCounts, setCollectionCounts] = useState({});
  const [allImagesCount, setAllImagesCount] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showSortOptions, setShowSortOptions] = useState(false);
  const [showCategories, setShowCategories] = useState(true);
  const [showCollections, setShowCollections] = useState(false);

  const CATEGORY_STORAGE_KEY = "asset-categories";
  const COLLECTION_STORAGE_KEY = "asset-collections";

  const normalizeAdminOptions = (value) => {
    if (!Array.isArray(value)) return [];

    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          return item.name || item.title || item.label || "";
        }
        return "";
      })
      .filter(Boolean);
  };

  const loadStoredAdminOptions = (storageKey) => {
    if (typeof window === "undefined") return [];

    try {
      const storedValue = window.localStorage.getItem(storageKey);
      if (!storedValue) return [];
      const parsed = JSON.parse(storedValue);
      return normalizeAdminOptions(parsed);
    } catch (err) {
      console.error(`Failed to read ${storageKey}`, err);
      return [];
    }
  };

  const suggestions = (allImages || [])
    .filter((image) => {
      const haystack = [
        image?.title || "",
        image?.description || "",
        image?.keywords || "",
      ]
        .join(" ")
        .toLowerCase();

      return search.trim() && haystack.includes(search.trim().toLowerCase());
    })
    .slice(0, 6);

  const loadCategoryCounts = async () => {
    try {
      const probe = await axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/images?limit=1&page=1`);
      const totalImages = Number(probe?.data?.totalImages || 0);
      const limit = Math.max(totalImages, 1);
      const res = await axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/images?limit=${limit}&page=1`);
      const nextImages = Array.isArray(res?.data?.images) ? res.data.images : [];

      const nextCounts = {};
      const nextCollectionCounts = {};
      nextImages.forEach((image) => {
        const slots = String(image?.category || "")
          .split(",")
          .map((value) => String(value || "").trim())
          .filter(Boolean);

        slots.forEach((slot) => {
          const bucket = normalizeCategoryFilterBucket(slot);
          if (bucket && bucket !== "All") {
            nextCounts[bucket] = (nextCounts[bucket] || 0) + 1;
          }
        });

        const collectionKey = normalizeCollectionValue(image?.collection);
        if (collectionKey && collectionKey !== "all") {
          nextCollectionCounts[collectionKey] = (nextCollectionCounts[collectionKey] || 0) + 1;
        }
      });

      setCategoryCounts(nextCounts);
      setCollectionCounts(nextCollectionCounts);
      setAllImagesCount(totalImages);
    } catch (err) {
      console.error("Failed to load live category counts", err);
    }
  };

  useEffect(() => {
    const syncAdminOptions = () => {
      setCategories(loadStoredAdminOptions(CATEGORY_STORAGE_KEY));
      setCollections(loadStoredAdminOptions(COLLECTION_STORAGE_KEY));
    };

    const loadCategories = async () => {
      try {
        const res = await axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/categories`);
        const nextCategories = normalizeAdminOptions(res.data);
        if (nextCategories.length > 0) {
          setCategories(nextCategories);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(nextCategories));
          }
        }
      } catch (err) {
        console.error("Failed to load categories", err);
      }
    };

    const loadCollections = async () => {
      try {
        const res = await axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/collections`);
        const nextCollections = Array.isArray(res.data) ? res.data.map((item) => item.name).filter(Boolean) : [];
        setCollections((prev) => (prev.length > 0 ? prev : nextCollections));
      } catch (err) {
        console.error("Failed to load collections", err);
      }
    };

    syncAdminOptions();
    loadCategories();
    loadCollections();
    loadCategoryCounts();

    const handleCategoriesUpdated = () => {
      syncAdminOptions();
      loadCategories();
      loadCategoryCounts();
    };
    const handleCollectionsUpdated = () => syncAdminOptions();
    const handleAssetRefresh = () => {
      loadCategoryCounts();
    };

    window.addEventListener("asset-categories-updated", handleCategoriesUpdated);
    window.addEventListener("asset-collections-updated", handleCollectionsUpdated);
    window.addEventListener("asset-updated", handleAssetRefresh);
    window.addEventListener("asset-refresh", handleAssetRefresh);
    window.addEventListener("asset-updated-detail", handleAssetRefresh);
    window.addEventListener("home-assets-refresh", handleAssetRefresh);

    return () => {
      window.removeEventListener("asset-categories-updated", handleCategoriesUpdated);
      window.removeEventListener("asset-collections-updated", handleCollectionsUpdated);
      window.removeEventListener("asset-updated", handleAssetRefresh);
      window.removeEventListener("asset-refresh", handleAssetRefresh);
      window.removeEventListener("asset-updated-detail", handleAssetRefresh);
      window.removeEventListener("home-assets-refresh", handleAssetRefresh);
    };
  }, []);

  const resetExplorerViewport = () => {
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
    }
  };

  const changeCategory = (cat) => {
    setSelectedCategory(cat);
    setCurrentPage(1);
    resetExplorerViewport();
  };

  const changeCollection = (collection) => {
    setSelectedCollection(collection);
    setCurrentPage(1);
    resetExplorerViewport();
  };

  const changeSort = (value) => {
    setSortType(value);
    setCurrentPage(1);
    resetExplorerViewport();
  };

  const changeResultsPerPage = (value) => {
    setResultsPerPage(value);
    setCurrentPage(1);
    resetExplorerViewport();
  };

  const visibleCategories = categories.length > 0 ? categories : ["Images", "Vector/illustrations", "PSD", "Videos", "Templates"];
  const visibleCollections = collections.length > 0 ? collections : [];
  const dropdownPanelStyle = (isOpen) => ({
    maxHeight: isOpen ? "360px" : "0px",
    opacity: isOpen ? 1 : 0,
    overflow: "hidden",
    overflowY: "auto",
    transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease",
    transform: isOpen ? "translateY(0)" : "translateY(-6px)",
    pointerEvents: isOpen ? "auto" : "none",
  });

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: "24px",
          flexWrap: "wrap",
          marginBottom: "24px",
          width: "100%",
        }}
      >
        <aside
          style={{
            width: "260px",
            padding: "18px",
            borderRadius: "20px",
            background: darkMode ? "#1b1b1b" : "#ffffff",
            border: darkMode ? "1px solid #2f2f2f" : "1px solid #ececec",
            boxShadow: darkMode
              ? "0 10px 24px rgba(0,0,0,0.25)"
              : "0 10px 24px rgba(15, 23, 42, 0.06)",
            flexShrink: 0,
            position: "sticky",
            top: "20px",
            alignSelf: "flex-start",
            zIndex: 10,
          }}
        >
          <div style={{ marginBottom: "16px" }}>
            <h3 style={{ margin: "0 0 8px", color: darkMode ? "#f5f5f5" : "#111" }}>Sort</h3>
            <button
              type="button"
              onClick={() => setShowSortOptions((value) => !value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "12px",
                border: darkMode ? "1px solid #3a3a3a" : "1px solid #e5e7eb",
                background: darkMode ? "#232323" : "#fff",
                color: darkMode ? "#f5f5f5" : "#111",
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                {sortType === "newest"
                  ? "Newest First"
                  : sortType === "oldest"
                  ? "Oldest First"
                  : sortType === "likes"
                  ? "Most Liked"
                  : sortType === "downloads"
                  ? "Most Downloaded"
                  : "Most Viewed"}
              </span>
              <span>{showSortOptions ? "▾" : "▸"}</span>
            </button>
            <div style={{ ...dropdownPanelStyle(showSortOptions), marginTop: "8px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {[
                  { value: "newest", label: "Newest First" },
                  { value: "oldest", label: "Oldest First" },
                  { value: "likes", label: "Most Liked" },
                  { value: "downloads", label: "Most Downloaded" },
                  { value: "views", label: "Most Viewed" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      changeSort(option.value);
                      setShowSortOptions(false);
                    }}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "12px",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      background: sortType === option.value ? "#2196f3" : darkMode ? "#2f2f2f" : "#f3f4f6",
                      color: sortType === option.value ? "white" : darkMode ? "#f5f5f5" : "#111",
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <h3 style={{ margin: "0 0 8px", color: darkMode ? "#f5f5f5" : "#111" }}>Categories</h3>
            <button
              type="button"
              onClick={() => setShowCategories((value) => !value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "12px",
                border: darkMode ? "1px solid #3a3a3a" : "1px solid #e5e7eb",
                background: darkMode ? "#232323" : "#fff",
                color: darkMode ? "#f5f5f5" : "#111",
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Categories</span>
              <span>{showCategories ? "▾" : "▸"}</span>
            </button>
            <div
              data-testid="categories-panel"
              style={{ ...dropdownPanelStyle(showCategories), marginTop: "8px" }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {(["All", ...visibleCategories]).map((cat) => {
                  const normalizedButtonName = cat === "All" ? "All" : normalizeCategoryFilterBucket(cat);
                  const allCount = allImagesCount || Object.values(categoryCounts).reduce((sum, value) => sum + Number(value || 0), 0);
                  const count = cat === "All"
                    ? allCount
                    : Number(categoryCounts[normalizedButtonName] || 0);

                  return (
                    <button
                      key={cat}
                      onClick={() => {
                        changeCategory(cat);
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "12px",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        background:
                          selectedCategory === cat
                            ? "#2196f3"
                            : darkMode ? "#2f2f2f" : "#f3f4f6",
                        color:
                          selectedCategory === cat
                            ? "white"
                            : darkMode ? "#f5f5f5" : "#111",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                      }}
                    >
                      <span>{cat}</span>
                      <span style={{ fontSize: "12px", opacity: 0.82 }}>({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <h3 style={{ margin: "0 0 8px", color: darkMode ? "#f5f5f5" : "#111" }}>Results</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ color: darkMode ? "#9ca3af" : "#6b7280", fontSize: "14px" }}>
                Showing {Math.min(resultsPerPage, totalImages || 0)} of {totalImages || 0}
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {[10, 20, 50].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      changeResultsPerPage(value);
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "999px",
                      border: "none",
                      cursor: "pointer",
                      background: resultsPerPage === value ? "#4caf50" : darkMode ? "#2f2f2f" : "#f3f4f6",
                      color: resultsPerPage === value ? "white" : darkMode ? "#f5f5f5" : "#111",
                      fontSize: "13px",
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <h3 style={{ margin: "0 0 8px", color: darkMode ? "#f5f5f5" : "#111" }}>Collections</h3>
            <button
              type="button"
              onClick={() => setShowCollections((value) => !value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "12px",
                border: darkMode ? "1px solid #3a3a3a" : "1px solid #e5e7eb",
                background: darkMode ? "#232323" : "#fff",
                color: darkMode ? "#f5f5f5" : "#111",
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Collections</span>
              <span>{showCollections ? "▾" : "▸"}</span>
            </button>
            <div style={{ ...dropdownPanelStyle(showCollections), marginTop: "8px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {['All', ...visibleCollections].map((collection) => {
                  const normalizedCollection = normalizeCollectionValue(collection);
                  const count = collection === "All"
                    ? allImagesCount
                    : Number(collectionCounts[normalizedCollection] || 0);

                  return (
                    <button
                      key={collection}
                      onClick={() => {
                        changeCollection(collection);
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "12px",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        background:
                          selectedCollection === collection
                            ? "#4caf50"
                            : darkMode ? "#2f2f2f" : "#f3f4f6",
                        color:
                          selectedCollection === collection
                            ? "white"
                            : darkMode ? "#f5f5f5" : "#111",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                      }}
                    >
                      <span>📁 {collection}</span>
                      <span style={{ fontSize: "12px", opacity: 0.82 }}>({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export default ImageGallery;
