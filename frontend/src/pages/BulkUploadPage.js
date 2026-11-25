import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { buildAuthHeaders } from "../utils/authSession";
import "./BulkUploadPage.css";

const MAX_BULK_UPLOAD_FILES = 10;
const UPLOAD_STALL_TIMEOUT_MS = 10_000;
const MAX_UPLOAD_ATTEMPTS = 3;

const createUploadRequestId = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
};

const createQueueItem = (file) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  uploadRequestId: createUploadRequestId(),
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
  const [isDragging, setIsDragging] = useState(false);
  const queueRef = useRef([]);
  const activeUploadRef = useRef(null);
  const dragDepthRef = useRef(0);
  const thumbnailPollsRef = useRef(new Map());
  const completedRemovalTimersRef = useRef(new Map());
  useEffect(() => () => {
    for (const controller of thumbnailPollsRef.current.values()) controller.abort();
    thumbnailPollsRef.current.clear();
    for (const timer of completedRemovalTimersRef.current.values()) window.clearTimeout(timer);
    completedRemovalTimersRef.current.clear();
    const activeUpload = activeUploadRef.current;
    if (activeUpload) {
      activeUpload.cancelled = true;
      activeUpload.controller.abort();
    }
  }, []);
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
    maxWidth: "none",
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

  const removeCompletedItem = (queueItemId) => {
    const timer = completedRemovalTimersRef.current.get(queueItemId);
    if (timer) window.clearTimeout(timer);
    completedRemovalTimersRef.current.delete(queueItemId);
    const existed = queueRef.current.some((item) => item.id === queueItemId);
    if (!existed) return;
    replaceQueue((current) => current.filter((item) => item.id !== queueItemId));
    setRemovedCount((count) => count + 1);
  };

  const scheduleCompletedRemoval = (queueItemId) => {
    if (completedRemovalTimersRef.current.has(queueItemId)) return;
    const timer = window.setTimeout(() => removeCompletedItem(queueItemId), 30000);
    completedRemovalTimersRef.current.set(queueItemId, timer);
  };

  const waitForThumbnail = async (assetId, queueItemId) => {
    thumbnailPollsRef.current.get(queueItemId)?.abort();
    const controller = new AbortController();
    thumbnailPollsRef.current.set(queueItemId, controller);
    let failedChecks = 0;
    let assetSeen = false;
    const waitForNextCheck = () => new Promise((resolve, reject) => {
      if (controller.signal.aborted) {
        reject(new DOMException("Thumbnail polling was cancelled.", "AbortError"));
        return;
      }
      const onAbort = () => {
        window.clearTimeout(timer);
        controller.signal.removeEventListener("abort", onAbort);
        reject(new DOMException("Thumbnail polling was cancelled.", "AbortError"));
      };
      const timer = window.setTimeout(() => {
        controller.signal.removeEventListener("abort", onAbort);
        resolve();
      }, 2000);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      for (let attempt = 0; attempt < 150; attempt += 1) {
        await waitForNextCheck();
        if (controller.signal.aborted || !queueRef.current.some((item) => item.id === queueItemId)) return;
        const response = await axios.get(`${API_BASE_URL}/my-uploads?view=bulk-status`, {
          headers: buildAuthHeaders(),
          signal: controller.signal,
          skipGlobalLoading: true
        });
        if (controller.signal.aborted) return;
        const asset = (response.data || []).find((item) => Number(item.id) === Number(assetId));
        if (!asset) {
          failedChecks = 0;
          continue;
        }
        assetSeen = true;
        const thumbnailStatus = String(asset.generated_thumbnail_status || asset.thumbnail_status || "").toUpperCase();
        if (thumbnailStatus === "READY") {
          updateItem(queueItemId, { status: "completed", progress: 100, error: "" });
          scheduleCompletedRemoval(queueItemId);
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
      if (controller.signal.aborted) return;
      updateItem(queueItemId, {
        status: "thumbnail-failed",
        failureStage: "thumbnail",
        error: assetSeen
          ? "Thumbnail processing is taking longer than expected. Retry to check again."
          : "Uploaded asset did not become available in bulk status before the thumbnail wait timed out."
      });
    } catch (error) {
      if (controller.signal.aborted || error.name === "AbortError" || axios.isCancel?.(error)) return;
      throw error;
    } finally {
      if (thumbnailPollsRef.current.get(queueItemId) === controller) {
        thumbnailPollsRef.current.delete(queueItemId);
      }
    }
  };

  const pumpQueue = async () => {
    if (activeUploadRef.current) return;
    const item = queueRef.current.find((entry) => entry.status === "queued");
    if (!item) return;

    const activeUpload = { id: item.id, controller: null, cancelled: false, stallDetected: false };
    activeUploadRef.current = activeUpload;
    updateItem(item.id, { status: "uploading", progress: 0, failureStage: null, error: "" });

    try {
      for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
        const controller = new AbortController();
        activeUpload.controller = controller;
        activeUpload.stallDetected = false;
        let lastProgressPercent = 0;
        let requestBodySent = false;
        let stallTimeout = null;
        const clearStallTimeout = () => {
          if (stallTimeout !== null) {
            window.clearTimeout(stallTimeout);
            stallTimeout = null;
          }
        };
        const armStallTimeout = () => {
          clearStallTimeout();
          if (requestBodySent || activeUpload.cancelled) return;
          stallTimeout = window.setTimeout(() => {
            activeUpload.stallDetected = true;
            controller.abort();
          }, UPLOAD_STALL_TIMEOUT_MS);
        };
        const formData = new FormData();
        formData.append("image", item.file);
        formData.append("preSubmission", "true");
        armStallTimeout();

        try {
          const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
            headers: {
              ...buildAuthHeaders(),
              "Idempotency-Key": item.uploadRequestId
            },
            signal: controller.signal,
            skipGlobalLoading: true,
            onUploadProgress: (event) => {
              if (activeUpload.cancelled) return;
              const loaded = Number(event.loaded) || 0;
              const total = Number(event.total) || 0;
              const progressPercent = Math.min(
                99,
                Math.round((loaded * 100) / (total > 0 ? total : item.file.size))
              );
              const progressAdvanced = progressPercent > lastProgressPercent;
              if (total > 0 && loaded >= total) {
                requestBodySent = true;
                clearStallTimeout();
              } else if (progressAdvanced) {
                lastProgressPercent = progressPercent;
                armStallTimeout();
              }
              if (!requestBodySent && total <= 0 && loaded >= item.file.size) {
                requestBodySent = true;
                clearStallTimeout();
              }
              updateItem(item.id, {
                progress: progressPercent,
                ...(progressAdvanced ? { error: "" } : {})
              });
            }
          });
          clearStallTimeout();
          const uploadedAssetId = response.data?.id;
          if (
            !Number.isSafeInteger(uploadedAssetId) ||
            uploadedAssetId <= 0 ||
            response.data?.upload_complete !== true ||
            response.data?.finalized !== true ||
            response.data?.file_size !== item.file.size
          ) {
            throw new Error("The server did not confirm that this file was fully received and finalized.");
          }
          updateItem(item.id, { assetId: uploadedAssetId, progress: 100, status: "processing", error: "" });
          void waitForThumbnail(uploadedAssetId, item.id).catch((error) => {
            const messageText = error.response?.data?.error || error.response?.data || error.message || "Unable to check thumbnail status.";
            updateItem(item.id, {
              status: "thumbnail-failed",
              failureStage: "thumbnail",
              error: typeof messageText === "string" ? messageText : "Unable to check thumbnail status."
            });
          });
          if (typeof fetchImages === "function") fetchImages();
          return;
        } catch (error) {
          clearStallTimeout();
          if (activeUpload.cancelled) {
            updateItem(item.id, { status: "cancelled", progress: 0, error: "" });
            return;
          }
          if (activeUpload.stallDetected) {
            if (attempt < MAX_UPLOAD_ATTEMPTS) {
              updateItem(item.id, {
                progress: 0,
                error: `No upload progress for 10 seconds. Restarting from 0% (attempt ${attempt + 1} of ${MAX_UPLOAD_ATTEMPTS}).`
              });
              continue;
            }
            updateItem(item.id, {
              status: "failed",
              failureStage: "upload",
              error: `Upload made no progress for 10 seconds after ${MAX_UPLOAD_ATTEMPTS} attempts. Retry to try again.`
            });
            return;
          }
          const messageText = error.response?.data?.error || error.response?.data || error.message || "Upload failed.";
          updateItem(item.id, {
            status: "failed",
            failureStage: "upload",
            error: typeof messageText === "string" ? messageText : "Upload failed."
          });
          return;
        }
      }
    } finally {
      if (activeUploadRef.current === activeUpload) activeUploadRef.current = null;
      void pumpQueue();
    }
  };

  const addSelectedFiles = (selectedFileList) => {
    if (activeUploadRef.current) {
      return;
    }
    const selectedFiles = Array.from(selectedFileList || []);
    if (selectedFiles.length === 0) return;

    if (selectedFiles.length > MAX_BULK_UPLOAD_FILES || queueRef.current.length + selectedFiles.length > MAX_BULK_UPLOAD_FILES) {
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

  const handleFilesSelected = (event) => {
    addSelectedFiles(event.target.files);
    event.target.value = "";
  };

  const handleDragEnter = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (activeHttpUpload) return;
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = activeHttpUpload ? "none" : "copy";
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (activeHttpUpload) return;
    addSelectedFiles(event.dataTransfer?.files);
  };

  const retryItem = async (item) => {
    setMessage("");
    if (item.failureStage === "thumbnail" && item.assetId) {
      updateItem(item.id, { status: "processing", error: "" });
      try {
        await axios.post(
          `${API_BASE_URL}/images/${item.assetId}/thumbnail/retry`,
          {},
          { headers: buildAuthHeaders(), skipGlobalLoading: true }
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
    thumbnailPollsRef.current.get(item.id)?.abort();
    const timer = completedRemovalTimersRef.current.get(item.id);
    if (timer) window.clearTimeout(timer);
    completedRemovalTimersRef.current.delete(item.id);
    replaceQueue((current) => current.filter((entry) => entry.id !== item.id));
    setRemovedCount((count) => count + 1);
  };

  const cancelActiveItem = (item) => {
    const activeUpload = activeUploadRef.current;
    if (!activeUpload || activeUpload.id !== item.id) return;
    activeUpload.cancelled = true;
    activeUpload.controller.abort();
    thumbnailPollsRef.current.get(item.id)?.abort();
    updateItem(item.id, { status: "cancelled", progress: 0, error: "" });
  };

  const uploadedCount = queue.filter((item) => item.status === "completed").length;
  const overallProgress = queue.length
    ? Math.round(queue.reduce((total, item) => total + item.progress, 0) / queue.length)
    : 0;
  const activeHttpUpload = Boolean(activeUploadRef.current);
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
    <div className="bulk-upload-surface" style={surfaceStyle}>
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
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "18px",
            flexWrap: "wrap",
            minHeight: "146px",
            marginTop: "22px",
            padding: "22px",
            border: `1.5px dashed ${isDragging ? colors.accentStrong : (isDarkMode ? "#53617a" : "#b7c3d7")}`,
            borderRadius: "16px",
            background: isDragging
              ? (isDarkMode ? "rgba(129,140,248,.16)" : "#f0f1ff")
              : colors.raised,
            cursor: activeHttpUpload ? "not-allowed" : "pointer",
            opacity: activeHttpUpload ? 0.65 : 1,
            textAlign: "left"
          }}
        >
          <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: "54px", height: "54px", flex: "0 0 54px", borderRadius: "15px", background: isDarkMode ? "#2b3155" : "#e9eaff", color: colors.accent, fontSize: "26px", fontWeight: 500 }}>↑</span>
          <span>
            <strong style={{ display: "block", fontSize: "16px" }}>
              {isDragging ? "Drop assets here" : "Choose assets from your device"}
              <span aria-hidden="true" style={{ color: "#dc2626", fontSize: "0.75em", marginLeft: "3px" }}>*</span>
            </strong>
            <span style={{ display: "block", marginTop: "6px", color: colors.muted, fontSize: "13px" }}>
              Drag and drop or browse · Maximum 10 per batch
            </span>
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
          required
          onChange={handleFilesSelected}
          disabled={activeHttpUpload}
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
                  {(item.status === "queued" || item.status === "uploading" || item.status === "failed" || item.status === "thumbnail-failed" || item.status === "cancelled") && (
                    <div style={{ display: "flex", gap: "8px", marginTop: "11px" }}>
                      {item.status === "queued" && (
                        <button type="button" onClick={() => removeQueuedItem(item)} style={{ padding: "7px 12px", border: `1px solid ${colors.border}`, borderRadius: "8px", background: colors.panel, color: colors.muted, cursor: "pointer", fontWeight: 650 }}>Remove</button>
                      )}
                      {item.status === "uploading" && (
                        <button type="button" onClick={() => cancelActiveItem(item)} style={{ padding: "7px 12px", border: `1px solid ${colors.border}`, borderRadius: "8px", background: colors.panel, color: colors.muted, cursor: "pointer", fontWeight: 650 }}>Cancel upload</button>
                      )}
                      {(item.status === "failed" || item.status === "thumbnail-failed" || item.status === "cancelled") && (
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
