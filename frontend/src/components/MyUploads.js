import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { getAssetPreviewUrl } from "../utils/assetPreview";

function MyUploads({ darkMode = false }) {
  const isDarkMode = Boolean(darkMode);
  const [images, setImages] = useState([]);
  const [editingImage, setEditingImage] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [selectedView, setSelectedView] = useState("pending");
  const activeRequestIdRef = useRef(0);


  useEffect(() => {
    fetchMyUploads(selectedView);
  }, [selectedView]);

  const fetchMyUploads = async (view = selectedView) => {
    const requestId = Date.now();
    activeRequestIdRef.current = requestId;

    try {
      const token = localStorage.getItem("token");
      const res = await axios.get(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/my-uploads?view=${encodeURIComponent(view)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (requestId !== activeRequestIdRef.current) {
        return;
      }

      const nextImages = (res.data || []).filter((image) => {
        const status = String(image.status || "").toLowerCase();

        if (view === "pending") {
          return status === "pending";
        }
        if (view === "approved") {
          return status === "approved";
        }
        if (view === "reviewed") {
          return status === "approved" || status === "rejected";
        }
        if (view === "rejected") {
          return status === "rejected";
        }
        if (view === "portfolio") {
          return status === "approved";
        }
        return true;
      });

      setImages(nextImages);
    } catch (err) {
      console.error(err);
    }
  };

  const deleteImage = async (id) => {
    const confirmDelete = window.confirm("Delete this image?");

    if (!confirmDelete) return;

    try {
      await axios.delete(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/images/${id}`
      );
      toast.success("Image deleted successfully 🗑");

      setImages((prevImages) => prevImages.filter((img) => img.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const editImage = (image) => {
    setEditingImage(image);
    setEditTitle(image.title);
    setEditCategory(image.category);
    setEditKeywords(image.keywords);
  };

  const saveImage = async () => {
    try {
      await axios.put(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/images/${editingImage.id}`,
        {
          title: editTitle,
          category: editCategory,
          keywords: editKeywords,
          status: selectedView === "portfolio" ? "pending" : undefined
        }
      );

      fetchMyUploads(selectedView);
      setEditingImage(null);
    } catch (err) {
      console.error(err);
    }
  };

  const updateThumbnail = async () => {
    if (!editingImage || !thumbnailFile) {
      return;
    }

    const token = localStorage.getItem("token");
    const formData = new FormData();
    formData.append("thumbnail", thumbnailFile);

    try {
      const res = await axios.post(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/images/${editingImage.id}/thumbnail`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/form-data"
          }
        }
      );

      setImages((prev) => prev.map((image) => Number(image.id) === Number(res.data.id) ? { ...image, ...res.data } : image));
      setEditingImage((prev) => (prev ? { ...prev, ...res.data } : prev));
      setThumbnailFile(null);
      toast.success("Thumbnail updated successfully");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data || "Failed to update thumbnail");
    }
  };

  const readOnlyView = selectedView !== "pending" && selectedView !== "portfolio";

  const getViewHint = () => {
    switch (selectedView) {
      case "approved":
        return "Shows approved assets from the last 7 days only.";
      case "pending":
        return "Shows pending assets that are still awaiting review.";
      case "reviewed":
        return "Shows reviewed assets (approved or rejected) from the last 14 days.";
      case "rejected":
        return "Shows rejected assets from the last 4 days.";
      case "portfolio":
        return "Shows all approved assets for your portfolio forever.";
      default:
        return "Shows your uploads for this section.";
    }
  };

  const formatDate = (value) => {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  };

  const getDaysLeft = (image) => {
    if (selectedView === "pending") return null;
    if (selectedView === "portfolio") return null;

    const retentionDays = selectedView === "approved" ? 7 : selectedView === "reviewed" ? 14 : 4;
    const createdAt = new Date(image.created_at || image.submitted_at);

    if (Number.isNaN(createdAt.getTime())) {
      return null;
    }

    const expiresAt = new Date(createdAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    const diffDays = Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

    return diffDays > 0 ? diffDays : 0;
  };

  return (
    <div style={{ marginTop: "20px", marginBottom: "30px", color: isDarkMode ? "#f5f5f5" : "#111827" }}>
      <h2>My Uploads</h2>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "16px"
        }}
      >
        <label htmlFor="my-uploads-view" style={{ fontWeight: 600 }}>
          View
        </label>
        <select
          id="my-uploads-view"
          aria-label="View"
          value={selectedView}
          onChange={(e) => setSelectedView(e.target.value)}
          style={{
            padding: "8px 10px",
            borderRadius: "6px",
            border: "1px solid #555",
            background: isDarkMode ? "#111" : "#ffffff",
            color: isDarkMode ? "white" : "#111827"
          }}
        >
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="reviewed">Reviewed</option>
          <option value="rejected">Rejected</option>
          <option value="portfolio">My Portfolio</option>
        </select>
        <span style={{ color: isDarkMode ? "#cbd5e1" : "#64748b", fontSize: "0.95rem" }}>{getViewHint()}</span>
      </div>

      <p>Total Uploads: {images.length}</p>

      {images.length === 0 ? (
        <p style={{ color: isDarkMode ? "#cbd5e1" : "#64748b" }}>No uploads match this view yet.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
            gap: "15px"
          }}
        >
          {images.map((image) => (
            <div
              key={image.id}
              style={{
                border: isDarkMode ? "1px solid #444" : "1px solid #dbe2ea",
                borderRadius: "10px",
                overflow: "hidden",
                background: isDarkMode ? "#1e1e1e" : "#ffffff",
                color: isDarkMode ? "#f5f5f5" : "#111827"
              }}
            >
              <img
                src={getAssetPreviewUrl(image, { quality: 50, watermark: false })}
                alt={image.title}
                style={{
                  width: "100%",
                  height: "180px",
                  objectFit: "cover"
                }}
              />

              <div style={{ padding: "10px", color: isDarkMode ? "white" : "#111827" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <strong>{image.title || "Untitled"}</strong>
                  <span style={{ fontSize: "0.8rem", color: isDarkMode ? "#a8d0ff" : "#2563eb" }}>
                    {image.status ? image.status.charAt(0).toUpperCase() + image.status.slice(1) : "Pending"}
                  </span>
                </div>

                <p style={{ marginTop: "8px", color: isDarkMode ? "#ddd" : "#475569" }}>
                  {image.description || "No description provided."}
                </p>

                <p style={{ marginTop: "8px" }}>Collection: {image.collection || "—"}</p>
                <p>Type: {image.type || "—"}</p>
                <p>Category: {image.category || "—"}</p>

                {selectedView !== "pending" && selectedView !== "portfolio" && (
                  <div style={{ marginTop: "10px", fontSize: "0.9rem", color: isDarkMode ? "#bcdcff" : "#475569" }}>
                    <p>Submitted: {formatDate(image.created_at)}</p>
                    <p>Reviewed: {formatDate(image.updated_at || image.reviewed_at || image.created_at)}</p>
                    <p>Days left: {getDaysLeft(image)}</p>
                  </div>
                )}


                {selectedView === "portfolio" && (
                  <div style={{ marginTop: "10px" }}>
                    <button
                      onClick={() => editImage(image)}
                      style={{
                        background: "#2196f3",
                        color: "white",
                        border: "none",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        cursor: "pointer"
                      }}
                    >
                      ✏ Edit
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingImage && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999
          }}
        >
          <div
            style={{
              background: isDarkMode ? "#1e1e1e" : "#ffffff",
              color: isDarkMode ? "white" : "#111827",
              padding: "20px",
              borderRadius: "10px",
              width: "400px"
            }}
          >
            <h3>Edit Image</h3>

            <label>
              <strong>Title</strong>
            </label>

            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={{
                width: "100%",
                marginBottom: "15px",
                padding: "8px",
                background: isDarkMode ? "#333" : "#ffffff",
                color: isDarkMode ? "white" : "#111827",
                border: "1px solid #555"
              }}
            />

            <label>
              <strong>Category</strong>
            </label>

            <input
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
              style={{
                width: "100%",
                marginBottom: "15px",
                padding: "8px",
                background: isDarkMode ? "#333" : "#ffffff",
                color: isDarkMode ? "white" : "#111827",
                border: "1px solid #555"
              }}
            />

            <label>
              <strong>Keywords</strong>
            </label>

            <input
              value={editKeywords}
              onChange={(e) => setEditKeywords(e.target.value)}
              style={{
                width: "100%",
                marginBottom: "15px",
                padding: "8px",
                background: isDarkMode ? "#333" : "#ffffff",
                color: isDarkMode ? "white" : "#111827",
                border: "1px solid #555"
              }}
            />

            <div style={{ marginTop: "12px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: "600" }}>
                Change thumbnail
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setThumbnailFile(e.target.files?.[0] || null)}
                style={{
                  width: "100%",
                  marginBottom: "10px",
                  padding: "8px",
                  background: isDarkMode ? "#333" : "#ffffff",
                  color: isDarkMode ? "white" : "#111827",
                  border: "1px solid #555"
                }}
              />
              <div style={{ display: "flex", gap: "10px" }}>
                <button onClick={updateThumbnail} disabled={!thumbnailFile} style={{ opacity: thumbnailFile ? 1 : 0.5 }}>
                  Update Thumbnail
                </button>
                <button onClick={saveImage}>Save</button>
                <button onClick={() => { setEditingImage(null); setThumbnailFile(null); }} style={{ marginLeft: "10px" }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MyUploads;