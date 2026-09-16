import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { limitWords, formatKeywords } from "../utils/uploadInputLimits";

const CATEGORY_STORAGE_KEY = "asset-categories";
const COLLECTION_STORAGE_KEY = "asset-collections";
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const DEFAULT_CATEGORY_OPTIONS = [
  { id: "default-images", name: "Images" },
  { id: "default-vector", name: "Vector/illustrations" },
  { id: "default-psd", name: "PSD" },
  { id: "default-videos", name: "Videos" },
  { id: "default-templates", name: "Templates" },
];

const MAX_BULK_UPLOAD_ROWS = 10;

const createEmptyRow = () => ({
  title: "",
  description: "",
  keywords: "",
  category: [],
  optionalCategory: "",
  collection: "",
  type: "",
  file: null,
  thumbnail: null,
});

export default function BulkUploadPage({ darkMode, fetchImages }) {
  const [rows, setRows] = useState([createEmptyRow()]);
  const [message, setMessage] = useState("");
  const [availableCategories, setAvailableCategories] = useState([]);
  const [availableCollections, setAvailableCollections] = useState([]);
  const [loading, setLoading] = useState(false);

  const surfaceStyle = {
    background: darkMode ? "#111" : "#fff",
    color: darkMode ? "#f5f5f5" : "#111",
    border: `1px solid ${darkMode ? "#444" : "#ddd"}`,
    borderRadius: "14px",
    padding: "12px",
    maxWidth: "100%",
    margin: "0 auto",
  };

  const fieldStyle = {
    width: "100%",
    padding: "8px",
    borderRadius: "8px",
    border: `1px solid ${darkMode ? "#4b5563" : "#ccc"}`,
    background: darkMode ? "#2a2a2a" : "#fff",
    color: darkMode ? "#f5f5f5" : "#111",
    minHeight: "38px",
  };

  const rowItemStyle = {
    flex: "1 1 110px",
    minWidth: "110px",
  };

  const fileItemStyle = {
    flex: "1 1 120px",
    minWidth: "120px",
  };

  const actionItemStyle = {
    flex: "0 0 auto",
  };

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const cachedCategories = localStorage.getItem(CATEGORY_STORAGE_KEY);
        const fallbackCategories = cachedCategories ? JSON.parse(cachedCategories) : DEFAULT_CATEGORY_OPTIONS;
        setAvailableCategories(Array.isArray(fallbackCategories) && fallbackCategories.length > 0 ? fallbackCategories : DEFAULT_CATEGORY_OPTIONS);

        const res = await axios.get(`${API_BASE_URL}/categories`);
        const categories = Array.isArray(res.data) && res.data.length > 0 ? res.data : fallbackCategories;
        setAvailableCategories(categories);
        localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(categories));
      } catch (err) {
        console.error("Failed to load categories", err);
      }
    };

    const loadCollections = async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/collections`);
        const collections = Array.isArray(res.data) ? res.data : [];
        setAvailableCollections(collections);
        localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(collections));
      } catch (err) {
        if (typeof window !== "undefined" && window.localStorage) {
          const cachedCollections = window.localStorage.getItem(COLLECTION_STORAGE_KEY);
          if (cachedCollections) {
            try {
              const parsed = JSON.parse(cachedCollections);
              if (Array.isArray(parsed)) {
                setAvailableCollections(parsed);
              }
            } catch (parseErr) {
              console.error("Invalid cached collections", parseErr);
            }
          }
        }
      }
    };

    loadCategories();
    loadCollections();
  }, []);

  const updateRow = (index, field, value) => {
    setRows((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
    setMessage("");
  };

  const handleAddRow = () => {
    setRows((prev) => (prev.length < MAX_BULK_UPLOAD_ROWS ? [...prev, createEmptyRow()] : prev));
  };

  const handleRemoveRow = (index) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, rowIndex) => rowIndex !== index) : prev));
  };

  const uploadRow = async (row, index) => {
    const token = localStorage.getItem("token");

    if (!token) {
      throw new Error("Please login first");
    }

    const trimmedTitle = limitWords(row.title, 5);
    const trimmedDescription = limitWords(row.description, 10);
    const trimmedKeywords = formatKeywords(row.keywords, 14);

    if (!row.file || !trimmedTitle || row.category.length === 0 || !trimmedKeywords) {
      throw new Error(`Row ${index + 1}: all fields are required`);
    }

    const categories = [row.category[0], row.optionalCategory].filter(Boolean);

    const formData = new FormData();
    formData.append("title", trimmedTitle);
    formData.append("category", categories.join(","));
    formData.append("collection", row.collection);
    formData.append("keywords", trimmedKeywords);
    formData.append("description", trimmedDescription);
    formData.append("type", row.type);
    formData.append("image", row.file);
    if (row.thumbnail) {
      formData.append("thumbnail", row.thumbnail);
    }

    await axios.post(`${API_BASE_URL}/upload`, formData, {
      headers: { Authorization: `Bearer ${token}` },
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const validRows = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.file);
    if (validRows.length === 0) {
      setMessage("Choose one or more files to start bulk upload.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const results = await Promise.allSettled(
        validRows.map(({ row, index }) => uploadRow(row, index))
      );
      const failures = results
        .map((result, resultIndex) => ({ result, row: validRows[resultIndex] }))
        .filter(({ result }) => result.status === "rejected")
        .map(({ result, row }) => ({ index: row.index, error: result.reason }));

      if (failures.length > 0) {
        const firstFailure = failures[0];
        throw new Error(
          failures.length === 1
            ? firstFailure.error?.message || `Row ${firstFailure.index + 1}: upload failed`
            : `${failures.length} rows failed to upload. First error: ${firstFailure.error?.message || "Upload failed"}`
        );
      }

      toast.success("Images uploaded successfully!");
      setRows([createEmptyRow()]);
      if (typeof fetchImages === "function") {
        fetchImages();
      }
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data || err?.message || "Upload failed");
      setMessage(err?.response?.data || err?.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={surfaceStyle}>
      <h1 style={{ marginTop: 0 }}>Bulk Upload</h1>
      <p style={{ marginBottom: "20px", lineHeight: 1.6 }}>
        This bulk upload view uses the same field validation and upload behavior as the single upload page, with a plus action to add rows and a minus action from the second row onward.
      </p>
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gap: "12px" }}>
          {rows.map((row, index) => (
            <div
              key={`bulk-row-${index}`}
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                alignItems: "flex-end",
                width: "100%",
                padding: "12px",
                borderRadius: "12px",
                border: `1px solid ${darkMode ? "#374151" : "#e5e7eb"}`,
                background: darkMode ? "#1f2937" : "#fafafa",
              }}
            >
              <div style={rowItemStyle}>
                <input
                  type="text"
                  placeholder="Title (max 5 words)"
                  value={row.title}
                  onChange={(event) => updateRow(index, "title", event.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div style={{ ...rowItemStyle, flex: "1 1 140px", minWidth: "120px", display: "flex", alignItems: "center" }}>
                <textarea
                  placeholder="Description (max 10 words)"
                  value={row.description}
                  onChange={(event) => updateRow(index, "description", event.target.value)}
                  rows={1}
                  style={{
                    ...fieldStyle,
                    resize: "none",
                    height: "42px",
                    lineHeight: "1.2",
                    display: "block",
                    paddingTop: "8px",
                    paddingBottom: "8px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ ...rowItemStyle, flex: "1 1 120px", minWidth: "120px" }}>
                <input
                  type="text"
                  placeholder="Keywords (max 14 words)"
                  value={row.keywords}
                  onChange={(event) => updateRow(index, "keywords", event.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div style={{ ...rowItemStyle, flex: "1 1 120px", minWidth: "120px" }}>
                <select
                  value={row.category[0] || ""}
                  onChange={(event) => updateRow(index, "category", [event.target.value])}
                  style={fieldStyle}
                >
                  <option value="">Primary category</option>
                  {availableCategories.map((categoryOption) => (
                    <option key={categoryOption.id} value={categoryOption.name}>
                      {categoryOption.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ ...rowItemStyle, flex: "1 1 120px", minWidth: "120px" }}>
                <select
                  value={row.optionalCategory}
                  onChange={(event) => updateRow(index, "optionalCategory", event.target.value)}
                  style={fieldStyle}
                >
                  <option value="">Optional category</option>
                  {availableCategories.map((categoryOption) => (
                    <option key={`${categoryOption.id}-optional`} value={categoryOption.name}>
                      {categoryOption.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ ...rowItemStyle, flex: "1 1 120px", minWidth: "120px" }}>
                <select
                  value={row.collection}
                  onChange={(event) => updateRow(index, "collection", event.target.value)}
                  style={fieldStyle}
                >
                  <option value="">Collection</option>
                  {availableCollections.map((collectionOption) => (
                    <option key={collectionOption.id || collectionOption.name} value={collectionOption.name}>
                      {collectionOption.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ ...rowItemStyle, flex: "1 1 110px", minWidth: "110px" }}>
                <select
                  value={row.type}
                  onChange={(event) => updateRow(index, "type", event.target.value)}
                  style={fieldStyle}
                >
                  <option value="">Type</option>
                  <option value="commercial">Commercial</option>
                  <option value="editorial">Editorial</option>
                </select>
              </div>
              <div style={{ ...fileItemStyle, flex: "1 1 120px", minWidth: "120px" }}>
                <input
                  type="file"
                  onChange={(event) => updateRow(index, "file", event.target.files?.[0] || null)}
                  style={{ ...fieldStyle, padding: "8px" }}
                />
              </div>
              <div style={{ ...fileItemStyle, flex: "1 1 120px", minWidth: "120px", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => updateRow(index, "thumbnail", event.target.files?.[0] || null)}
                  style={{ ...fieldStyle, padding: "8px" }}
                />
                <p style={{ marginTop: "4px", fontSize: "12px", color: "#999", marginBottom: "0" }}>
                  optional thumbnail
                </p>
              </div>
              <div style={{ ...actionItemStyle, display: "flex", gap: "8px" }}>
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(index)}
                    aria-label="-"
                    style={{
                      width: "42px",
                      height: "42px",
                      borderRadius: "999px",
                      border: `1px solid ${darkMode ? "#4b5563" : "#ccc"}`,
                      background: darkMode ? "#1f2937" : "#fff",
                      color: darkMode ? "#f5f5f5" : "#111",
                      cursor: "pointer",
                      fontSize: "1.25rem",
                      lineHeight: 1,
                    }}
                  >
                    −
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddRow}
                  aria-label="+"
                  disabled={rows.length >= MAX_BULK_UPLOAD_ROWS}
                  style={{
                    width: "42px",
                    height: "42px",
                    borderRadius: "999px",
                    border: "none",
                    background: rows.length >= MAX_BULK_UPLOAD_ROWS ? "#9ca3af" : darkMode ? "#22c55e" : "#111",
                    color: darkMode ? "#111" : "#fff",
                    cursor: rows.length >= MAX_BULK_UPLOAD_ROWS ? "not-allowed" : "pointer",
                    opacity: rows.length >= MAX_BULK_UPLOAD_ROWS ? 0.65 : 1,
                    fontSize: "1.25rem",
                    lineHeight: 1,
                  }}
                >
                  +
                </button>
                {rows.length >= MAX_BULK_UPLOAD_ROWS && (
                  <div style={{ marginTop: "4px", color: darkMode ? "#93c5fd" : "#0f172a", fontSize: "0.85rem" }}>
                    Max 10 rows
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: "16px",
            padding: "12px 18px",
            borderRadius: "10px",
            border: "none",
            background: loading ? "gray" : darkMode ? "#22c55e" : "#111",
            color: darkMode ? "#111" : "#fff",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Uploading..." : "Start Bulk Upload"}
        </button>
      </form>
      {message && (
        <div style={{ marginTop: "16px", color: darkMode ? "#a5f3fc" : "#0f172a" }}>
          {message}
        </div>
      )}
    </div>
  );
}
