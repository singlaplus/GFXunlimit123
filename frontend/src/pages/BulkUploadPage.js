import { useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { buildAuthHeaders } from "../utils/authSession";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const MAX_BULK_UPLOAD_FILES = 10;

const createQueueItem = (file) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  file,
  progress: 0,
  status: "queued",
  assetId: null,
  failureStage: null,
  error: ""
});

export default function BulkUploadPage({ darkMode, fetchImages }) {
  const [queue, setQueue] = useState([]);
  const [message, setMessage] = useState("");
  const [removedCount, setRemovedCount] = useState(0);
  const queueRef = useRef([]);
  const activeUploadRef = useRef(null);
  const replaceQueue = (update) => {
    const nextQueue = typeof update === "function" ? update(queueRef.current) : update;
    queueRef.current = nextQueue;
    setQueue(nextQueue);
  };
  const isDarkMode = Boolean(darkMode);
  const colors = isDarkMode
    ? {
        text: "#f8fafc",
        muted: "#aab6c8",
        panel: "#111827",
        raised: "#182235",
        border: "#2a3a52",
        accent: "#a5b4fc",
        accentStrong: "#818cf8",
        track: "#26354a"
      }
    : {
        text: "#101828",
        muted: "#667085",
        panel: "#ffffff",
        raised: "#f8faff",
        border: "#e4eaf3",
        accent: "#4f46e5",
        accentStrong: "#4338ca",
        track: "#e8edf5"
      };
  const surfaceStyle = {
    maxWidth: "1120px",
    margin: "32px auto 64px",
    padding: "0 24px",
    color: colors.text
  };
  const panelStyle = {
    background: colors.panel,
    border: `1px solid ${colors.border}`,
    borderRadius: "22px",
    boxShadow: isDarkMode ? "0 18px 45px rgba(0,0,0,.18)" : "0 18px 45px rgba(30,50,90,.07)"
  };

  const updateItem = (id, update) => {
    replaceQueue((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
  };

  const waitForThumbnail = async (assetId, queueItemId) => {
    let failedChecks = 0;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const response = await axios.get(`${API_BASE_URL}/my-uploads?view=bulk-status`, {
        headers: buildAuthHeaders()
      });
      const asset = (response.data || []).find((item) => Number(item.id) === Number(assetId));
      if (!asset) {
        throw new Error("Uploaded asset is not available to this contributor.");
      }
      const thumbnailStatus = String(asset.generated_thumbnail_status || asset.thumbnail_status || "").toUpperCase();
      if (thumbnailStatus === "READY") {
        updateItem(queueItemId, { status: "completed", progress: 100, error: "" });
        if (typeof fetchImages === "function") fetchImages();
        return;
      }
      if (thumbnailStatus === "FAILED") {
        failedChecks += 1;
        if (failedChecks >= 8) {
          updateItem(queueItemId, {
            status: "thumbnail-failed",
            failureStage: "thumbnail",
            error: asset.thumbnail_error || "Thumbnail generation failed."
          });
          return;
        }
      } else {
        failedChecks = 0;
      }
    }
    updateItem(queueItemId, {
      status: "thumbnail-failed",
      failureStage: "thumbnail",
      error: "Thumbnail processing is taking longer than expected. Retry to check again."
    });
  };

  const pumpQueue = async () => {
    if (activeUploadRef.current) return;
    const item = queueRef.current.find((entry) => entry.status === "queued");
    if (!item) return;

    const activeUpload = { id: item.id, controller: new AbortController(), cancelled: false };
    activeUploadRef.current = activeUpload;
    updateItem(item.id, { status: "uploading", progress: 0, failureStage: null, error: "" });
    const formData = new FormData();
    formData.append("image", item.file);
    formData.append("preSubmission", "true");

    try {
      const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
        headers: buildAuthHeaders(),
        signal: activeUpload.controller.signal,
        onUploadProgress: (event) => {
          if (activeUpload.cancelled || !event.total) return;
          updateItem(item.id, { progress: Math.min(99, Math.round((event.loaded * 100) / event.total)) });
        }
      });
      const uploadedAssetId = response.data?.id;
      if (
        !uploadedAssetId ||
        response.data?.upload_complete !== true ||
        response.data?.finalized !== true ||
        Number(response.data?.file_size) !== Number(item.file.size)
      ) {
        throw new Error("The server did not confirm that this file was fully received and finalized.");
      }
      updateItem(item.id, { assetId: uploadedAssetId, progress: 100, status: "processing" });
      void waitForThumbnail(uploadedAssetId, item.id).catch((error) => {
        const messageText = error.response?.data?.error || error.response?.data || error.message || "Unable to check thumbnail status.";
        updateItem(item.id, {
          status: "thumbnail-failed",
          failureStage: "thumbnail",
          error: typeof messageText === "string" ? messageText : "Unable to check thumbnail status."
        });
      });
      if (typeof fetchImages === "function") fetchImages();
    } catch (error) {
      if (activeUpload.cancelled) {
        updateItem(item.id, { status: "cancelled", progress: 0, error: "" });
      } else {
        const messageText = error.response?.data?.error || error.response?.data || error.message || "Upload failed.";
        updateItem(item.id, {
          status: "failed",
          failureStage: "upload",
          error: typeof messageText === "string" ? messageText : "Upload failed."
        });
      }
    } finally {
      if (activeUploadRef.current === activeUpload) activeUploadRef.current = null;
      void pumpQueue();
    }
  };

  const handleFilesSelected = (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = "";
    if (selectedFiles.length === 0) return;

    if (selectedFiles.length > MAX_BULK_UPLOAD_FILES || queue.length + selectedFiles.length > MAX_BULK_UPLOAD_FILES) {
      const error = `You can upload a maximum of ${MAX_BULK_UPLOAD_FILES} assets per batch.`;
      setMessage(error);
      toast.error(error);
      return;
    }

    setMessage("");
    const items = selectedFiles.map(createQueueItem);
    setRemovedCount(0);
    replaceQueue((current) => [...current, ...items]);
    void pumpQueue();
  };

  const retryItem = async (item) => {
    setMessage("");
    if (item.failureStage === "thumbnail" && item.assetId) {
      updateItem(item.id, { status: "processing", error: "" });
      try {
        await axios.post(
          `${API_BASE_URL}/images/${item.assetId}/thumbnail/retry`,
          {},
          { headers: buildAuthHeaders() }
        );
        await waitForThumbnail(item.assetId, item.id);
      } catch (error) {
        const messageText = error.response?.data?.error || error.response?.data || error.message || "Thumbnail retry failed.";
        updateItem(item.id, {
          status: "thumbnail-failed",
          error: typeof messageText === "string" ? messageText : "Thumbnail retry failed."
        });
      }
      return;
    }
    updateItem(item.id, { status: "queued", progress: 0, failureStage: null, error: "" });
    void pumpQueue();
  };

  const removeQueuedItem = (item) => {
    replaceQueue((current) => current.filter((entry) => entry.id !== item.id));
    setRemovedCount((count) => count + 1);
  };

  const cancelActiveItem = (item) => {
    const activeUpload = activeUploadRef.current;
    if (!activeUpload || activeUpload.id !== item.id) return;
    activeUpload.cancelled = true;
    activeUpload.controller.abort();
    updateItem(item.id, { status: "cancelled", progress: 0, error: "" });
  };

  const uploadedCount = queue.filter((item) => item.status === "completed").length;
  const overallProgress = queue.length
    ? Math.round(queue.reduce((total, item) => total + item.progress, 0) / queue.length)
    : 0;
  const activeUploads = Boolean(activeUploadRef.current) ||
    queue.some((item) => ["queued", "uploading", "processing"].includes(item.status));
  const progressBarColor = isDarkMode ? "#a5b4fc" : "#4f46e5";
  const statusStyles = {
    queued: { background: isDarkMode ? "#29364a" : "#eef2f7", color: colors.muted },
    uploading: { background: isDarkMode ? "#312e81" : "#eef2ff", color: isDarkMode ? "#c7d2fe" : "#4338ca" },
    processing: { background: isDarkMode ? "#3b2f17" : "#fff7e6", color: isDarkMode ? "#fde68a" : "#a16207" },
    uploaded: { background: isDarkMode ? "#3b2f17" : "#fff7e6", color: isDarkMode ? "#fde68a" : "#a16207" },
    completed: { background: isDarkMode ? "#12372b" : "#eaf8f0", color: isDarkMode ? "#86efac" : "#15803d" },
    cancelled: { background: isDarkMode ? "#29364a" : "#eef2f7", color: colors.muted },
    failed: { background: isDarkMode ? "#451f27" : "#fff0f0", color: isDarkMode ? "#fda4af" : "#b42318" },
    "thumbnail-failed": { background: isDarkMode ? "#451f27" : "#fff0f0", color: isDarkMode ? "#fda4af" : "#b42318" }
  };

  return (
    <div style={surfaceStyle}>
      <section
        style={{
          ...panelStyle,
          position: "relative",
          overflow: "hidden",
          padding: "clamp(24px, 5vw, 52px)",
          background: isDarkMode
            ? "radial-gradient(ellipse at 92% 5%, rgba(99,102,241,.2), transparent 38%), #111827"
            : "radial-gradient(ellipse at 92% 5%, rgba(99,102,241,.12), transparent 38%), #fff"
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 310px), 1fr))", gap: "36px", alignItems: "center" }}>
          <div>
            <div style={{ color: colors.accent, fontSize: "12px", fontWeight: 800, letterSpacing: ".16em", textTransform: "uppercase" }}>
              Contributor studio
            </div>
            <h1 style={{ margin: "12px 0 14px", fontSize: "clamp(32px, 5vw, 48px)", letterSpacing: "-.04em", lineHeight: 1.08 }}>
              Your next great work,<br />ready to upload.
            </h1>
            <p style={{ maxWidth: "610px", margin: 0, color: colors.muted, fontSize: "16px", lineHeight: 1.7 }}>
              Upload a batch of assets in one go. We’ll prepare each thumbnail and keep your files private until you’re ready to submit them for review.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "22px" }}>
              {["One file at a time", "Private until submitted", "Thumbnail-ready drafts"].map((item) => (
                <span key={item} style={{ padding: "7px 11px", border: `1px solid ${colors.border}`, borderRadius: "999px", color: colors.muted, fontSize: "12px", fontWeight: 650 }}>
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div style={{ padding: "24px", border: `1px solid ${colors.border}`, borderRadius: "18px", background: isDarkMode ? "rgba(24,34,53,.88)" : "rgba(255,255,255,.82)" }}>
            <div style={{ color: colors.muted, fontSize: "13px", fontWeight: 650 }}>Batch capacity</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", margin: "6px 0 16px" }}>
              <strong style={{ fontSize: "48px", letterSpacing: "-.05em" }}>10</strong>
              <span style={{ color: colors.muted }}>assets at a time</span>
            </div>
            {[
              ["01", "Upload files", "Files upload one at a time"],
              ["02", "Prepare previews", "Thumbnails are generated"],
              ["03", "Submit for review", "Edit details in Not Submitted"]
            ].map(([number, title, description]) => (
              <div key={number} style={{ display: "flex", gap: "12px", alignItems: "flex-start", paddingTop: "13px", marginTop: "13px", borderTop: `1px solid ${colors.border}` }}>
                <span style={{ color: colors.accent, fontSize: "12px", fontWeight: 800 }}>{number}</span>
                <div>
                  <strong style={{ display: "block", fontSize: "13px" }}>{title}</strong>
                  <span style={{ display: "block", marginTop: "3px", color: colors.muted, fontSize: "12px" }}>{description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-label="Select assets to upload" style={{ ...panelStyle, marginTop: "22px", padding: "clamp(20px, 4vw, 34px)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "18px", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "21px", letterSpacing: "-.02em" }}>Start a new batch</h2>
            <p style={{ margin: "7px 0 0", color: colors.muted, lineHeight: 1.55 }}>Choose up to 10 files. Each file is finalized by the server before the next queued file starts.</p>
          </div>
          <span style={{ padding: "8px 12px", borderRadius: "10px", background: isDarkMode ? "#252f45" : "#f1f3ff", color: colors.accent, fontSize: "13px", fontWeight: 750 }}>
            {queue.length} / {MAX_BULK_UPLOAD_FILES} selected
          </span>
        </div>

        <label
          htmlFor="bulk-upload-files"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "18px",
            flexWrap: "wrap",
            minHeight: "146px",
            marginTop: "22px",
            padding: "22px",
            border: `1.5px dashed ${isDarkMode ? "#53617a" : "#b7c3d7"}`,
            borderRadius: "16px",
            background: colors.raised,
            cursor: activeUploads ? "not-allowed" : "pointer",
            opacity: activeUploads ? 0.65 : 1,
            textAlign: "left"
          }}
        >
          <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: "54px", height: "54px", flex: "0 0 54px", borderRadius: "15px", background: isDarkMode ? "#2b3155" : "#e9eaff", color: colors.accent, fontSize: "26px", fontWeight: 500 }}>↑</span>
          <span>
            <strong style={{ display: "block", fontSize: "16px" }}>Choose assets from your device</strong>
            <span style={{ display: "block", marginTop: "6px", color: colors.muted, fontSize: "13px" }}>Select files to begin · Maximum 10 per batch</span>
          </span>
          <span style={{ marginLeft: "auto", padding: "11px 16px", borderRadius: "10px", background: colors.accentStrong, color: "#fff", fontSize: "13px", fontWeight: 750, whiteSpace: "nowrap" }}>
            Browse files
          </span>
        </label>
        <input
          id="bulk-upload-files"
          aria-label="Upload assets"
          type="file"
          multiple
          onChange={handleFilesSelected}
          disabled={activeUploads}
          style={{ display: "none" }}
        />
        {message && <p role="alert" style={{ margin: "12px 0 0", padding: "11px 14px", borderRadius: "10px", background: isDarkMode ? "#451f27" : "#fff0f0", color: isDarkMode ? "#fda4af" : "#b42318" }}>{message}</p>}
      </section>

      {(queue.length > 0 || removedCount > 0) && (
        <section aria-label="Upload queue" style={{ ...panelStyle, marginTop: "22px", padding: "clamp(20px, 4vw, 34px)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
            <div>
              <div style={{ color: colors.accent, fontSize: "11px", fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase" }}>Batch activity</div>
              <h2 style={{ margin: "6px 0 0", fontSize: "22px", letterSpacing: "-.025em" }}>Upload queue</h2>
            </div>
            <span style={{ color: colors.muted, fontSize: "13px" }}>{uploadedCount} uploaded · {removedCount} removed</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginTop: "22px", fontSize: "13px" }}>
            <strong>Overall progress</strong>
            <span style={{ color: colors.muted }}>{overallProgress}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Overall upload progress"
            aria-valuenow={overallProgress}
            aria-valuemin="0"
            aria-valuemax="100"
            style={{ height: "9px", margin: "9px 0 20px", overflow: "hidden", borderRadius: "99px", background: colors.track }}
          >
            <div style={{ width: `${overallProgress}%`, height: "100%", borderRadius: "99px", background: progressBarColor, transition: "width 200ms ease" }} />
          </div>

          <ol style={{ display: "grid", gap: "10px", margin: 0, padding: 0, listStyle: "none" }}>
            {queue.map((item) => {
              const statusLabel = {
                queued: "QUEUED",
                uploading: `UPLOADING · ${item.progress}%`,
                uploaded: "UPLOADED",
                processing: "PROCESSING THUMBNAIL",
                completed: "Completed - ready to submit",
                failed: "FAILED",
                "thumbnail-failed": "THUMBNAIL FAILED",
                cancelled: "CANCELLED"
              }[item.status];
              const extension = item.file.name.split(".").pop()?.toUpperCase() || "FILE";
              const fileSize = item.file.size < 1024 * 1024
                ? `${Math.max(1, Math.round(item.file.size / 1024))} KB`
                : `${(item.file.size / (1024 * 1024)).toFixed(1)} MB`;
              return (
                <li key={item.id} style={{ padding: "14px 16px", border: `1px solid ${colors.border}`, borderRadius: "14px", background: colors.raised }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: "42px", height: "42px", flex: "0 0 42px", borderRadius: "11px", background: isDarkMode ? "#26354a" : "#edf1f8", color: colors.accent, fontSize: "10px", fontWeight: 800, overflow: "hidden" }}>
                      {extension.slice(0, 5)}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong title={item.file.name} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "14px" }}>{item.file.name}</strong>
                      <span style={{ display: "block", marginTop: "4px", color: colors.muted, fontSize: "12px" }}>
                        {item.file.type || `.${extension.toLowerCase()}`} · {fileSize}
                        {item.status === "processing" ? " · Upload confirmed; thumbnail processing" : item.status === "completed" ? " · Private draft in Not Submitted" : item.status === "failed" || item.status === "thumbnail-failed" ? " · This file needs attention" : ""}
                      </span>
                    </div>
                    <span aria-live="polite" style={{ ...statusStyles[item.status], flex: "0 0 auto", padding: "7px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 750 }}>
                      {statusLabel}
                    </span>
                  </div>
                  {(item.status === "uploading" || item.status === "processing") && (
                    <div
                      role={item.status === "uploading" ? "progressbar" : undefined}
                      aria-label={item.status === "uploading" ? `${item.file.name} upload progress` : undefined}
                      aria-valuenow={item.status === "uploading" ? item.progress : undefined}
                      aria-valuemin={item.status === "uploading" ? "0" : undefined}
                      aria-valuemax={item.status === "uploading" ? "100" : undefined}
                      style={{ height: "5px", marginTop: "13px", borderRadius: "99px", background: colors.track }}
                    >
                      <div style={{ width: `${item.progress}%`, height: "100%", borderRadius: "99px", background: progressBarColor, transition: "width 200ms ease" }} />
                    </div>
                  )}
                  {item.error && <p style={{ margin: "11px 0 0", padding: "10px 12px", borderRadius: "9px", background: isDarkMode ? "#451f27" : "#fff0f0", color: isDarkMode ? "#fda4af" : "#b42318", fontSize: "13px" }}>{item.error}</p>}
                  {(item.status === "queued" || item.status === "uploading" || item.status === "failed" || item.status === "thumbnail-failed") && (
                    <div style={{ display: "flex", gap: "8px", marginTop: "11px" }}>
                      {item.status === "queued" && (
                        <button type="button" onClick={() => removeQueuedItem(item)} style={{ padding: "7px 12px", border: `1px solid ${colors.border}`, borderRadius: "8px", background: colors.panel, color: colors.muted, cursor: "pointer", fontWeight: 650 }}>Remove</button>
                      )}
                      {item.status === "uploading" && (
                        <button type="button" onClick={() => cancelActiveItem(item)} style={{ padding: "7px 12px", border: `1px solid ${colors.border}`, borderRadius: "8px", background: colors.panel, color: colors.muted, cursor: "pointer", fontWeight: 650 }}>Cancel upload</button>
                      )}
                      {(item.status === "failed" || item.status === "thumbnail-failed") && (
                        <button type="button" onClick={() => retryItem(item)} style={{ padding: "7px 12px", border: `1px solid ${colors.border}`, borderRadius: "8px", background: colors.panel, color: colors.text, cursor: "pointer", fontWeight: 650 }}>Retry</button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {queue.every((item) => ["completed", "failed", "thumbnail-failed", "cancelled"].includes(item.status)) && (
            <div role="status" style={{ marginTop: "18px", padding: "14px", borderRadius: "10px", background: colors.raised, color: colors.text }}>
              <strong>Batch complete</strong>
              <span style={{ display: "block", marginTop: "5px", color: colors.muted }}>
                {uploadedCount} uploaded · {queue.filter((item) => ["failed", "thumbnail-failed"].includes(item.status)).length} failed · {removedCount} removed · {queue.filter((item) => item.status === "cancelled").length} cancelled
              </span>
            </div>
          )}
          {(queue.every((item) => ["completed", "failed", "thumbnail-failed", "cancelled"].includes(item.status)) || queue.length === 0) && (
            <button
              type="button"
              onClick={() => {
                replaceQueue([]);
                setRemovedCount(0);
              }}
              style={{ marginTop: "18px", padding: "10px 14px", border: `1px solid ${colors.border}`, borderRadius: "9px", background: colors.panel, color: colors.text, cursor: "pointer", fontWeight: 700 }}
            >
              Start a new batch
            </button>
          )}
        </section>
      )}
    </div>
  );
}
