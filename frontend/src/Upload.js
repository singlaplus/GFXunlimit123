import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { limitWords, formatKeywords } from "./utils/uploadInputLimits";
import {
  DEFAULT_WATCH_CONFIG,
  WATCH_CONFIG_STORAGE_KEY,
  WATCH_COUNTRY_OPTIONS
} from "./utils/watchConfigOptions";

const CATEGORY_STORAGE_KEY = "asset-categories";
const COLLECTION_STORAGE_KEY = "asset-collections";
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const DEFAULT_CATEGORY_OPTIONS = [
  { id: "default-images", name: "Images" },
  { id: "default-vector", name: "Vector/illustrations" },
  { id: "default-psd", name: "PSD" },
  { id: "default-videos", name: "Videos" },
  { id: "default-templates", name: "Templates" }
];

function Upload({ fetchImages, darkMode }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState([]);
  const [availableCategories, setAvailableCategories] = useState([]);
  const [collection, setCollection] = useState("");
  const [availableCollections, setAvailableCollections] = useState([]);
  const [keywords, setKeywords] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("");
  const [image, setImage] = useState(null);
  const [thumbnail, setThumbnail] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const storedPermissions = (() => {
    try {
      return JSON.parse(localStorage.getItem("userPermissions") || "{}") || {};
    } catch (err) {
      return {};
    }
  })();
  const currentUserRole = typeof window !== "undefined" ? (localStorage.getItem("userRole") || "").toLowerCase() : "";
  const currentUploadLimitConfig = (() => {
    const value = Number(storedPermissions.upload_limit_value ?? 20);
    const unit = String(storedPermissions.upload_limit_unit || "MB").toUpperCase();
    const safeValue = [1, 5, 10, 20, 100].includes(value) ? value : 20;
    const safeUnit = ["MB", "GB"].includes(unit) ? unit : "MB";
    return { value: safeValue, unit: safeUnit, label: `${safeValue} ${safeUnit}` };
  })();

  const surfaceStyle = {
    border: `1px solid ${darkMode ? "#4b5563" : "#ccc"}`,
    padding: "20px",
    borderRadius: "10px",
    marginBottom: "30px",
    background: darkMode ? "#1e1e1e" : "#fff",
    color: darkMode ? "#f5f5f5" : "#111",
  };

  const fieldStyle = {
    width: "100%",
    padding: "10px",
    borderRadius: "8px",
    border: `1px solid ${darkMode ? "#4b5563" : "#ccc"}`,
    background: darkMode ? "#2a2a2a" : "#fff",
    color: darkMode ? "#f5f5f5" : "#111",
  };

  const isDisabled =
    !title || category.length === 0 || !keywords || !image || loading;

  const buttonStyle = {
    padding: "10px 20px",
    background: isDisabled ? "gray" : darkMode ? "#f5f5f5" : "#111",
    color: isDisabled ? "white" : darkMode ? "#111" : "white",
    border: "none",
    borderRadius: "5px",
    cursor: isDisabled ? "not-allowed" : "pointer",
    marginTop: "20px",
  };

  // 🧠 cleanup preview URL to avoid memory leak
  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  useEffect(() => {
    const getStoredCategories = () => {
      try {
        const cachedCategories = localStorage.getItem(CATEGORY_STORAGE_KEY);
        if (cachedCategories) {
          const parsed = JSON.parse(cachedCategories);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch (err) {
        console.error("Invalid cached categories", err);
      }
      return DEFAULT_CATEGORY_OPTIONS;
    };

    const loadCategories = async () => {
      const fallbackCategories = getStoredCategories();
      setAvailableCategories(fallbackCategories);

      try {
        const res = await axios.get(
          `${API_BASE_URL}/categories`
        );
        const categories = Array.isArray(res.data) && res.data.length > 0 ? res.data : fallbackCategories;
        setAvailableCategories(categories);
        localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(categories));
      } catch (err) {
        console.error("Failed to load categories", err);
        setAvailableCategories(fallbackCategories);
      }
    };

    const loadCollections = async () => {
      try {
        const res = await axios.get(
          `${API_BASE_URL}/collections`
        );
        const collections = Array.isArray(res.data) ? res.data : [];
        setAvailableCollections(collections);
        localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(collections));
      } catch (err) {
        console.error("Failed to load collections", err);
        try {
          const cachedCollections = localStorage.getItem(COLLECTION_STORAGE_KEY);
          if (cachedCollections) {
            const parsed = JSON.parse(cachedCollections);
            if (Array.isArray(parsed)) {
              setAvailableCollections(parsed);
            }
          }
        } catch (cacheErr) {
          console.error("Invalid cached collections", cacheErr);
        }
      }
    };

    loadCategories();
    loadCollections();

    const handleCategoryUpdate = () => {
      loadCategories();
    };

    const handleCollectionUpdate = () => {
      loadCollections();
    };

    const handleStorageUpdate = (event) => {
      if (event.key === CATEGORY_STORAGE_KEY) {
        loadCategories();
      }
    };

    window.addEventListener("asset-categories-updated", handleCategoryUpdate);
    window.addEventListener("asset-collections-updated", handleCollectionUpdate);
    window.addEventListener("storage", handleStorageUpdate);

    return () => {
      window.removeEventListener("asset-categories-updated", handleCategoryUpdate);
      window.removeEventListener("asset-collections-updated", handleCollectionUpdate);
      window.removeEventListener("storage", handleStorageUpdate);
    };
  }, []);

  const handleUpload = async (e) => {
    e.preventDefault();

    const token = localStorage.getItem("token");

    if (!token) {
      alert("Please login first");
      return;
    }

    const trimmedTitle = limitWords(title, 5);
    const trimmedDescription = limitWords(description, 10);
    const trimmedKeywords = formatKeywords(keywords, 14);

    if (!image || !trimmedTitle || category.length === 0 || !trimmedKeywords) {
      alert("All fields are required");
      return;
    }

    const formData = new FormData();

    formData.append("title", trimmedTitle);
    formData.append("category", category.join(","));
    formData.append("collection", collection);
    formData.append("keywords", trimmedKeywords);
    formData.append("description", trimmedDescription);
    formData.append("type", type);
    formData.append("image", image);
    if (thumbnail) {
      formData.append("thumbnail", thumbnail);
    }

    try {
      setLoading(true);
setUploadProgress(0);

      const res = await axios.post(
  `${API_BASE_URL}/upload`,
  formData,
  {
    headers: {
      Authorization: `Bearer ${token}`
    },

    onUploadProgress: (progressEvent) => {
      const percentCompleted =
        Math.round(
          (progressEvent.loaded * 100) /
          progressEvent.total
        );

      setUploadProgress(
        percentCompleted
      );
    }
  }
);

console.log("UPLOAD SUCCESS:", res.data);
setUploadProgress(100);
      toast.success(
  "Image uploaded successfully!"
);

      fetchImages();

      // reset form safely
      setTitle("");
      setCategory([]);
      setCollection("");
      setType("");
      setDescription("");
      setKeywords("");
      setImage(null);
      setThumbnail(null);

      if (preview) {
        URL.revokeObjectURL(preview);
      }
      setPreview(null);

    } catch (err) {
      console.error(err);

      toast.error(
  err?.response?.data ||
  "Upload failed"
);
    } finally {

  setLoading(false);

  setTimeout(() => {
    setUploadProgress(0);
  }, 1500);

}
  };

  const handleCategorySelection = (index, value) => {
    setCategory((prev) => {
      const next = [...prev];
      next[index] = value;
      return next.filter(Boolean);
    });
  };

  const getCategoryOptions = (index) => {
    const selectedInOtherField = index === 0 ? category[1] : category[0];
    return availableCategories.filter((option) => option.name !== selectedInOtherField);
  };

  const handleTitleChange = (e) => {
    setTitle(limitWords(e.target.value, 5));
  };

  const handleDescriptionChange = (e) => {
    setDescription(limitWords(e.target.value, 10));
  };

  const handleKeywordChange = (e) => {
    setKeywords(e.target.value);
  };

  const handleKeywordKeyDown = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const formatted = formatKeywords(keywords, 14);
      setKeywords(formatted);
    }
  };

  return (
    <>
      <div style={surfaceStyle}>
        <h2>Upload Image</h2>

      <form onSubmit={handleUpload}>

        <div style={{ display: "flex", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 220px", width: "220px" }}>
            <input
              type="text"
              placeholder="Title (max 5 words)"
              value={title}
              onChange={handleTitleChange}
              style={{ ...fieldStyle }}
            />
          </div>
          <div style={{ flex: "1 1 260px", minWidth: "220px" }}>
            <textarea
              placeholder="Description (max 10 words)"
              value={description}
              onChange={handleDescriptionChange}
              rows={1}
              style={{ ...fieldStyle, minHeight: "42px", resize: "vertical" }}
            />
          </div>
          <div style={{ flex: "1 1 260px", minWidth: "220px" }}>
            <input
              type="text"
              placeholder="Keywords (max 14 words, Press Tab key to set Auto - format)"
              value={keywords}
              onChange={handleKeywordChange}
              onKeyDown={handleKeywordKeyDown}
              style={{ ...fieldStyle }}
            />
          </div>
        </div>

        <label
          style={{
            display: "block",
            marginBottom: "6px",
            fontWeight: "600",
          }}
        >
          Category (1 required, 2 max)
        </label>
        <div
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "10px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: "220px" }}>
            <select
              value={category[0] || ""}
              onChange={(e) => handleCategorySelection(0, e.target.value)}
              style={{ ...fieldStyle }}
            >
              <option value="">Select primary category</option>
              {getCategoryOptions(0).map((categoryOption) => (
                <option key={categoryOption.id} value={categoryOption.name}>
                  {categoryOption.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: "220px" }}>
            <select
              value={category[1] || ""}
              onChange={(e) => handleCategorySelection(1, e.target.value)}
              style={{ ...fieldStyle }}
            >
              <option value="">Select optional category</option>
              {getCategoryOptions(1).map((categoryOption) => (
                <option key={categoryOption.id} value={categoryOption.name}>
                  {categoryOption.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "220px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "6px",
                fontWeight: "600",
              }}
            >
              Collection
            </label>
            <select
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
              style={{ ...fieldStyle }}
            >
              <option value="">Select Collection</option>
              {availableCollections.map((collectionOption) => (
                <option key={collectionOption.id || collectionOption.name} value={collectionOption.name}>
                  {collectionOption.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: "220px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "6px",
                fontWeight: "600",
              }}
            >
              Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              style={{ ...fieldStyle }}
            >
              <option value="">Select Type</option>
              <option value="commercial">Commercial</option>
              <option value="editorial">Editorial</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: "10px" }}>
          <label style={{ display: "block", marginBottom: "6px", fontWeight: "600" }}>
            Asset file
          </label>
          {currentUserRole === "contributor" && (
            <p style={{ margin: "0 0 8px", fontSize: "12px", color: darkMode ? "#d1d5db" : "#666" }}>
              Active upload limit: {currentUploadLimitConfig.label} (default: 20 MB)
            </p>
          )}
          <input
            type="file"
            onChange={(e) => {
              const file = e.target.files[0];

              if (!file) return;

              setImage(file);

              const url = URL.createObjectURL(file);

              setPreview(url);
            }}
            style={{
              ...fieldStyle,
              width: "100%",
              padding: "12px 10px",
            }}
          />
        </div>

        <div style={{ marginBottom: "10px" }}>
          <label style={{ display: "block", marginBottom: "6px", fontWeight: "600" }}>
            Optional thumbnail (recommended)
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setThumbnail(e.target.files?.[0] || null)}
            style={{
              ...fieldStyle,
              width: "100%",
              padding: "12px 10px",
            }}
          />
          <p style={{ marginTop: "4px", fontSize: "12px", color: "#999", marginBottom: "0" }}>
            optional thumbnail
          </p>
        </div>

        {preview && (
          <div style={{ marginBottom: "20px" }}>
            <img
              src={preview}
              alt="Preview"
              width="300"
              style={{ borderRadius: "10px" }}
            />
          </div>
        )}
{loading && (

  <div
    style={{
      marginBottom: "20px",
    }}
  >

    <div
      style={{
        width: "100%",
        height: "20px",
        background: "#ddd",
        borderRadius: "20px",
        overflow: "hidden",
      }}
    >

      <div
        style={{
          width: `${uploadProgress}%`,
          height: "100%",
          background: "#4caf50",
          transition: "0.3s",
        }}
      />

    </div>

    <p
      style={{
        marginTop: "8px",
        fontWeight: "bold",
      }}
    >
      Uploading...
      {" "}
      {uploadProgress}%
    </p>

  </div>

)}
        <button
          type="submit"
          disabled={isDisabled}
          style={buttonStyle}
        >
          {loading ? "Uploading..." : "Upload"}
        </button>

      </form>
      </div>
    </>
  );
}

export default Upload;