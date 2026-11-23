import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import AssetThumbnail from "./AssetThumbnail";
import Pagination from "./Pagination";
import Upload from "../Upload";
import { buildAuthHeaders } from "../utils/authSession";
import { formatIndiaDate } from "../utils/indiaTime";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";
import "./MyUploads.css";

const hasRequiredDraftMetadata = (image) =>
  [image.title, image.description, image.keywords, image.type]
    .every((value) => String(value || "").trim());

function EditIcon() {
  return (
    <svg
      className="my-upload-edit-icon"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  );
}

function MyUploads({ darkMode = false }) {
  const isDarkMode = Boolean(darkMode);
  const { reportResource, retryKey, routeId } = useStartupReadiness();
  const [images, setImages] = useState([]);
  const [editingImage, setEditingImage] = useState(null);
  const [editingDraftAsset, setEditingDraftAsset] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [selectedView, setSelectedView] = useState("pending");
  const [deletingImageIds, setDeletingImageIds] = useState(() => new Set());
  const [loadStatus, setLoadStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [localRetry, setLocalRetry] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [paginationLayout, setPaginationLayout] = useState(() => ({
    isDesktop: typeof window !== "undefined" && window.innerWidth >= 1024,
    columns: 4
  }));
  const uploadsGridRef = useRef(null);
  const activeRequestIdRef = useRef(0);
  const readinessAttemptRef = useRef({ routeId, retryKey, localRetry });
  readinessAttemptRef.current = { routeId, retryKey, localRetry };

  const fetchMyUploads = useCallback(async (view = selectedView, clearCurrent = false) => {
    const requestId = activeRequestIdRef.current + 1;
    const requestAttempt = { routeId, retryKey, localRetry };
    activeRequestIdRef.current = requestId;
    setLoadStatus("loading");
    setLoadError("");
    if (clearCurrent) setImages([]);
    reportResource("myUploads", "loading", "", routeId);

    try {
      const token = localStorage.getItem("token");
      const res = await axios.get(
        `${API_BASE_URL}/my-uploads?view=${encodeURIComponent(view)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (requestId !== activeRequestIdRef.current ||
          requestAttempt.routeId !== readinessAttemptRef.current.routeId ||
          requestAttempt.retryKey !== readinessAttemptRef.current.retryKey ||
          requestAttempt.localRetry !== readinessAttemptRef.current.localRetry) {
        return;
      }

      if (!Array.isArray(res.data) || res.data.some((image) =>
        !image || typeof image !== "object" || Array.isArray(image) || image.id == null
      )) {
        throw new Error("Uploads response was invalid.");
      }

      const nextImages = res.data.filter((image) => {
        const status = String(image.status || "").toLowerCase();

        if (view === "pending") {
          return status === "pending";
        }
        if (view === "not-submitted") {
          return ["draft", "not submitted", "not_submitted", "not-submitted"].includes(status)
            && String(image.generated_thumbnail_status || "").toUpperCase() === "READY";
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
      setLoadStatus("ready");
      reportResource("myUploads", "ready", "", routeId);
    } catch (err) {
      if (requestId !== activeRequestIdRef.current ||
          requestAttempt.routeId !== readinessAttemptRef.current.routeId ||
          requestAttempt.retryKey !== readinessAttemptRef.current.retryKey ||
          requestAttempt.localRetry !== readinessAttemptRef.current.localRetry) return;
      console.error(err);
      const message = err?.response
        ? `Unable to load uploads (HTTP ${err.response.status}).`
        : err?.message || "Unable to load uploads.";
      setLoadError(message);
      setLoadStatus("error");
      reportResource("myUploads", "error", message, routeId);
    }
  }, [localRetry, reportResource, retryKey, routeId, selectedView]);

  useEffect(() => {
    fetchMyUploads(selectedView, true);
    return () => { activeRequestIdRef.current += 1; };
  }, [fetchMyUploads, localRetry, retryKey, routeId, selectedView]);

  useEffect(() => {
    if (loadStatus !== "ready" || images.length === 0) return undefined;

    const updatePaginationLayout = () => {
      const isDesktop = window.innerWidth >= 1024;
      const grid = uploadsGridRef.current;
      const gridTemplateColumns = grid
        ? window.getComputedStyle(grid).gridTemplateColumns.trim()
        : "";
      const columnsFromGrid = gridTemplateColumns && gridTemplateColumns !== "none"
        ? gridTemplateColumns.split(/\s+/).filter(Boolean).length
        : 0;
      const estimatedColumns = Math.max(1, Math.floor((window.innerWidth - 113) / 288));
      const columns = columnsFromGrid || estimatedColumns;

      setPaginationLayout((current) => (
        current.isDesktop === isDesktop && current.columns === columns
          ? current
          : { isDesktop, columns }
      ));
    };

    updatePaginationLayout();
    window.addEventListener("resize", updatePaginationLayout);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePaginationLayout);
    if (resizeObserver && uploadsGridRef.current) {
      resizeObserver.observe(uploadsGridRef.current);
    }

    return () => {
      window.removeEventListener("resize", updatePaginationLayout);
      resizeObserver?.disconnect();
    };
  }, [images.length, loadStatus, selectedView]);

  const pageSize = paginationLayout.isDesktop
    ? Math.max(1, paginationLayout.columns) * 2
    : Math.max(images.length, 1);
  const totalPages = Math.max(1, Math.ceil(images.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const visibleImages = paginationLayout.isDesktop
    ? images.slice((safeCurrentPage - 1) * pageSize, safeCurrentPage * pageSize)
    : images;

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const deleteImage = async (id) => {
    const image = images.find((item) => Number(item.id) === Number(id));
    const confirmDelete = window.confirm(
      `Permanently delete "${image?.title || "this asset"}", including its original file and thumbnail? This cannot be undone.`
    );

    if (!confirmDelete) return;

    setDeletingImageIds((prev) => new Set(prev).add(id));
    try {
      await axios.delete(
        `${API_BASE_URL}/images/${id}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`
          }
        }
      );
      toast.success("Asset deleted successfully.");

      setImages((prevImages) => prevImages.filter((img) => img.id !== id));
    } catch (err) {
      console.error(err);
      const errorMessage = err.response?.data?.error || err.response?.data || err.message;
      toast.error(typeof errorMessage === "string" ? errorMessage : "Failed to delete asset.");
    } finally {
      setDeletingImageIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const submitImage = async (image) => {
    if (!hasRequiredDraftMetadata(image)) {
      toast.error("Title, description, keywords, and type are required before submitting.");
      return;
    }

    try {
      await axios.post(
        `${API_BASE_URL}/my-uploads/${image.id}/submit`,
        {},
        { headers: buildAuthHeaders() }
      );
      toast.success("Asset submitted for review.");
      setImages((previous) => previous.filter((item) => Number(item.id) !== Number(image.id)));
    } catch (error) {
      console.error(error);
      const message = error.response?.data?.error || error.response?.data || "Unable to submit asset.";
      toast.error(typeof message === "string" ? message : "Unable to submit asset.");
    }
  };

  const editImage = (image) => {
    setEditingImage(image);
    setEditTitle(image.title);
    setEditCategory(image.category);
    setEditKeywords(image.keywords);
  };

  const closeEditDialog = () => {
    setEditingImage(null);
    setThumbnailFile(null);
  };

  const saveImage = async () => {
    try {
      await axios.put(
        `${API_BASE_URL}/images/${editingImage.id}`,
        {
          title: editTitle,
          category: editCategory,
          collection: editingImage.collection || "",
          keywords: editKeywords,
          description: editingImage.description || "",
          type: editingImage.type || "",
          status: selectedView === "portfolio" ? "pending" : undefined
        },
        { headers: buildAuthHeaders() }
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
        `${API_BASE_URL}/images/${editingImage.id}/thumbnail`,
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

  const getViewHint = () => {
    switch (selectedView) {
      case "approved":
        return "Shows approved assets from the last 7 days only.";
      case "pending":
        return "Shows pending assets that are still awaiting review.";
      case "not-submitted":
        return "Shows uploads saved as drafts that have not been submitted for review.";
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

    return formatIndiaDate(value, {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }) || "—";
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
    <div className={`my-uploads${isDarkMode ? " my-uploads--dark" : ""}`}>
      <header className="my-uploads-header">
        <div>
          <p className="my-uploads-eyebrow"><span aria-hidden="true" /> CREATOR STUDIO / LIBRARY</p>
          <h2>My Uploads</h2>
          <p className="my-uploads-intro">Manage drafts, review status, and published assets from one workspace.</p>
        </div>
        {loadStatus === "ready" && (
          <div className="my-uploads-header-count" aria-label={`${images.length} uploads in the current filter`}>
            <strong>{images.length}</strong>
            <span>{images.length === 1 ? "asset" : "assets"} in view</span>
          </div>
        )}
      </header>

      <section className="my-uploads-view-panel" aria-label="Upload library filters">
        <div className="my-uploads-view-control">
          <label htmlFor="my-uploads-view">View</label>
          <select
            id="my-uploads-view"
            aria-label="View"
            value={selectedView}
            onChange={(e) => {
              const view = e.target.value;
              if (view === selectedView) return;
              activeRequestIdRef.current += 1;
              setSelectedView(view);
              setCurrentPage(1);
              setImages([]);
              setLoadStatus("loading");
              setLoadError("");
              reportResource("myUploads", "loading", "", routeId);
            }}
          >
            <option value="not-submitted">Not Submitted</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="rejected">Rejected</option>
            <option value="portfolio">My Portfolio</option>
          </select>
        </div>
        <p className="my-uploads-view-hint">{getViewHint()}</p>
      </section>

      {loadStatus === "loading" ? (
        <p className="my-uploads-state" role="status">Loading uploads...</p>
      ) : loadError ? (
        <div className="my-uploads-state my-uploads-state--error" role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => {
            activeRequestIdRef.current += 1;
            setLoadStatus("loading");
            setLoadError("");
            reportResource("myUploads", "loading", "", routeId);
            setLocalRetry((attempt) => attempt + 1);
          }}>Retry</button>
        </div>
      ) : (
        <>
          <div className="my-uploads-results-heading">
            <p>{`Total Uploads: ${images.length}`}</p>
          </div>

          {images.length === 0 ? (
            <div className="my-uploads-empty">
              <span className="my-uploads-empty-icon" aria-hidden="true">✦</span>
              <h3>Your library is clear</h3>
              <p>No uploads match this view yet.</p>
            </div>
          ) : (
            <div className="my-uploads-grid" ref={uploadsGridRef}>
              {visibleImages.map((image) => (
                <article className="my-upload-card" key={image.id}>
                  <div className="my-upload-card-media">
                    <AssetThumbnail
                      image={image}
                      darkMode={isDarkMode}
                      style={{
                        width: "100%",
                        height: "180px",
                        objectFit: "cover"
                      }}
                    />
                    <span className={`my-upload-status my-upload-status--${String(image.status || "pending").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                      {selectedView === "not-submitted"
                        ? "Not Submitted"
                        : image.status
                          ? image.status.charAt(0).toUpperCase() + image.status.slice(1)
                          : "Pending"}
                    </span>
                  </div>

                  <div className="my-upload-card-body">
                    <div className="my-upload-card-heading">
                      <strong>{image.title || "Untitled"}</strong>
                    </div>

                    <p className="my-upload-description">{image.description || "No description provided."}</p>

                    <div className="my-upload-metadata">
                      <p>{`Collection: ${image.collection || "—"}`}</p>
                      <p>{`File Type: ${image.extension ? String(image.extension).replace(/^\./, "").toUpperCase() : "—"}`}</p>
                      <p>{`Asset Type: ${image.type || "—"}`}</p>
                      <p>{`Category: ${image.category || "—"}`}</p>
                    </div>

                    {selectedView !== "pending" && selectedView !== "portfolio" && selectedView !== "not-submitted" && (
                      <div className="my-upload-review-details">
                        <p>Submitted: {formatDate(image.created_at)}</p>
                        <p>Reviewed: {formatDate(image.updated_at || image.reviewed_at || image.created_at)}</p>
                        <p>Days left: {getDaysLeft(image)}</p>
                      </div>
                    )}

                    {selectedView === "not-submitted" && !hasRequiredDraftMetadata(image) && (
                      <p className="my-upload-draft-warning">
                        Add title, description, keywords, and type using Edit before submitting.
                      </p>
                    )}

                    <div className="my-upload-actions">
                      {selectedView === "not-submitted" && (
                        <>
                          <button
                            className="my-upload-action my-upload-action--edit"
                            type="button"
                            onClick={() => setEditingDraftAsset(image)}
                          >
                            <EditIcon />
                            Edit
                          </button>
                          <button
                            className="my-upload-action my-upload-action--submit"
                            type="button"
                            onClick={() => submitImage(image)}
                            disabled={
                              String(image.generated_thumbnail_status || "").toUpperCase() !== "READY" ||
                              !hasRequiredDraftMetadata(image)
                            }
                            style={{ opacity: hasRequiredDraftMetadata(image) ? 1 : 0.55 }}
                          >
                            Submit
                          </button>
                        </>
                      )}
                      {selectedView === "portfolio" && (
                        <button
                          className="my-upload-action my-upload-action--edit"
                          type="button"
                          onClick={() => editImage(image)}
                        >
                          <EditIcon />
                          Edit
                        </button>
                      )}
                      {selectedView === "not-submitted" && (
                        <button
                          className="my-upload-action my-upload-action--delete"
                          type="button"
                          onClick={() => deleteImage(image.id)}
                          disabled={deletingImageIds.has(image.id)}
                          style={{
                            cursor: deletingImageIds.has(image.id) ? "wait" : "pointer",
                            opacity: deletingImageIds.has(image.id) ? 0.65 : 1
                          }}
                        >
                          {deletingImageIds.has(image.id) ? "Deleting..." : "Delete"}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {paginationLayout.isDesktop && totalPages > 1 && (
            <div className="my-uploads-pagination">
              <Pagination
                currentPage={safeCurrentPage}
                totalPages={totalPages}
                totalImages={images.length}
                setCurrentPage={setCurrentPage}
                darkMode={isDarkMode}
                totalLabel="Total Uploads"
              />
            </div>
          )}
        </>
      )}

      {editingImage && (
        <div
          className="my-upload-edit-overlay"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeEditDialog();
          }}
        >
          <div
            className={`my-upload-edit-dialog${isDarkMode ? " my-upload-edit-dialog--dark" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="my-upload-edit-title"
          >
            <header className="my-upload-edit-header">
              <span className="my-upload-edit-mark"><EditIcon /></span>
              <div>
                <p className="my-upload-edit-eyebrow">ASSET SETTINGS</p>
                <h3 id="my-upload-edit-title">Edit Image</h3>
                <p className="my-upload-edit-intro">Refine your asset details or replace its thumbnail.</p>
              </div>
              <button
                className="my-upload-edit-close"
                type="button"
                aria-label="Close edit dialog"
                onClick={closeEditDialog}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="m6 6 12 12" />
                  <path d="M18 6 6 18" />
                </svg>
              </button>
            </header>

            <div className="my-upload-edit-content">
              <div className="my-upload-edit-fields">
                <div>
                  <label className="my-upload-edit-label" htmlFor="my-upload-edit-title-field">Title</label>
                  <input
                    id="my-upload-edit-title-field"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="my-upload-edit-input"
                  />
                </div>

                <div>
                  <label className="my-upload-edit-label" htmlFor="my-upload-edit-category">Category</label>
                  <input
                    id="my-upload-edit-category"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="my-upload-edit-input"
                  />
                </div>

                <div>
                  <label className="my-upload-edit-label" htmlFor="my-upload-edit-keywords">Keywords</label>
                  <input
                    id="my-upload-edit-keywords"
                    value={editKeywords}
                    onChange={(e) => setEditKeywords(e.target.value)}
                    className="my-upload-edit-input"
                  />
                </div>
              </div>

              <section className="my-upload-thumbnail-edit">
                <div className="my-upload-thumbnail-heading">
                  <span className="my-upload-thumbnail-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 16V4" />
                      <path d="m7 9 5-5 5 5" />
                      <path d="M20 16.5v2A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-2" />
                    </svg>
                  </span>
                  <div>
                    <label className="my-upload-edit-label" htmlFor="my-upload-edit-thumbnail">Change thumbnail</label>
                    <p>Choose an image file to refresh this asset’s preview.</p>
                  </div>
                </div>
                <input
                  id="my-upload-edit-thumbnail"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setThumbnailFile(e.target.files?.[0] || null)}
                  className="my-upload-edit-input my-upload-thumbnail-input"
                />
                <button
                  className="my-upload-edit-button my-upload-edit-button--utility"
                  type="button"
                  onClick={updateThumbnail}
                  disabled={!thumbnailFile}
                  style={{ opacity: thumbnailFile ? 1 : 0.5 }}
                >
                  Update Thumbnail
                </button>
              </section>
            </div>

            <footer className="my-upload-edit-footer">
              <button
                className="my-upload-edit-button my-upload-edit-button--secondary"
                type="button"
                onClick={closeEditDialog}
              >
                Cancel
              </button>
              <button className="my-upload-edit-button my-upload-edit-button--primary" type="button" onClick={saveImage}>
                Save
              </button>
            </footer>
          </div>
        </div>
      )}

      {editingDraftAsset && (
        <Upload
          key={editingDraftAsset.id}
          editingAsset={editingDraftAsset}
          darkMode={isDarkMode}
          onSaved={(savedAsset) => {
            setEditingDraftAsset(null);
            if (savedAsset) fetchMyUploads("not-submitted");
          }}
        />
      )}
    </div>
  );
}

export default MyUploads;