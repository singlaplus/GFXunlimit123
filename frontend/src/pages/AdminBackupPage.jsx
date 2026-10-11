import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import "./AdminBackupPage.css";

const BACKUP_CATEGORIES = [
  { key: "database", title: "Database", description: "Complete native PostgreSQL backup, including schema and data." },
  { key: "websiteCode", title: "Website Code + .env", description: "Allowlisted application source, configuration, migrations, and encrypted .env files." },
  { key: "assetsAndThumbnails", title: "Assets + Thumbnails", description: "Production originals and the separate centralized thumbnail store." }
];
const BACKUP_TIME_ZONE = "Asia/Kolkata";

const byteUnits = ["B", "KB", "MB", "GB", "TB", "PB"];

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), byteUnits.length - 1);
  return `${(bytes / (1024 ** unit)).toFixed(unit === 0 ? 0 : 2)} ${byteUnits[unit]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)} sec`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${Math.ceil(seconds % 60)} sec`;
  return `${Math.floor(seconds / 3600)} hr ${Math.floor((seconds % 3600) / 60)} min`;
}

function statusColor(status) {
  if (status === "SUCCESS" || status === "READY" || status === "VERIFIED") return "#15803d";
  if (status === "FAILED" || status === "INSUFFICIENT") return "#b91c1c";
  if (status === "RUNNING" || status === "IN_PROGRESS") return "#1d4ed8";
  return "#64748b";
}

export default function AdminBackupPage({ isDarkMode, apiBaseUrl, getAuthToken }) {
  const [categories, setCategories] = useState(BACKUP_CATEGORIES.map(({ key }) => key));
  const [destinations, setDestinations] = useState([{ id: 1, path: "" }]);
  const [nextDestinationId, setNextDestinationId] = useState(2);
  const [testedDrives, setTestedDrives] = useState({});
  const [destinationMessages, setDestinationMessages] = useState({});
  const [plan, setPlan] = useState(null);
  const [job, setJob] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const [sources, setSources] = useState(null);
  const [sourceError, setSourceError] = useState("");
  const [localFolderSelections, setLocalFolderSelections] = useState({});
  const [manualDestinationMode, setManualDestinationMode] = useState("server");
  const [localExportBusy, setLocalExportBusy] = useState(false);
  const [localExportError, setLocalExportError] = useState("");
  const [localExportComplete, setLocalExportComplete] = useState(false);
  const [localExportProgress, setLocalExportProgress] = useState("");
  const [automaticDestination, setAutomaticDestination] = useState("");
  const [automaticDrive, setAutomaticDrive] = useState(null);
  const [automaticPlan, setAutomaticPlan] = useState(null);
  const [automaticSchedule, setAutomaticSchedule] = useState({
    configured: false,
    enabled: false,
    destination: "",
    selectedTypes: ["database", "websiteCode"],
    frequency: "daily",
    time: "02:00",
    weeklyDay: 0,
    monthlyDay: 1,
    timezone: "UTC",
    nextRun: null,
    lastRun: null
  });
  const [scheduleMessage, setScheduleMessage] = useState("");

  const palette = useMemo(() => ({
    surface: isDarkMode ? "#0f172a" : "#fff",
    panel: isDarkMode ? "#111827" : "#f8fafc",
    border: isDarkMode ? "#334155" : "#dbe3ed",
    text: isDarkMode ? "#f8fafc" : "#0f172a",
    muted: isDarkMode ? "#a8b4c5" : "#64748b"
  }), [isDarkMode]);

  const request = useCallback((method, endpoint, data) => {
    const token = getAuthToken();
    return axios({
      method,
      url: `${apiBaseUrl}/admin/backup${endpoint}`,
      data,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      withCredentials: true
    });
  }, [apiBaseUrl, getAuthToken]);

  const refreshHistory = useCallback(async () => {
    const response = await request("get", "/history");
    setHistory(Array.isArray(response.data?.jobs) ? response.data.jobs : []);
  }, [request]);

  const refreshSources = useCallback(async () => {
    setSourceError("");
    try {
      const response = await request("get", "/sources");
      setSources(response.data?.sources || null);
      return response.data?.sources || null;
    } catch (error) {
      const message = error.response?.data?.error || "Could not measure current backup source sizes.";
      setSourceError(message);
      throw error;
    }
  }, [request]);

  const refreshSchedule = useCallback(async () => {
    const response = await request("get", "/automatic");
    const schedule = response.data?.schedule;
    if (schedule) {
      setAutomaticSchedule(schedule);
      setAutomaticDestination(schedule.destination || "");
    }
  }, [request]);

  const refreshJob = useCallback(async (jobId) => {
    const response = await request("get", `/jobs/${encodeURIComponent(jobId)}`);
    const nextJob = response.data?.job || null;
    setJob(nextJob);
    if (nextJob?.status !== "RUNNING") {
      await refreshHistory();
      if (nextJob?.backupType === "AUTOMATIC") await refreshSchedule();
    }
  }, [refreshHistory, refreshSchedule, request]);

  useEffect(() => {
    let active = true;
    Promise.all([
      request("get", "/jobs/active"),
      request("get", "/history"),
      request("get", "/automatic"),
      request("get", "/sources")
    ]).then(([activeResponse, historyResponse, scheduleResponse, sourceResponse]) => {
      if (!active) return;
      const activeJob = activeResponse.data?.job || null;
      setJob(activeJob);
      setHistory(Array.isArray(historyResponse.data?.jobs) ? historyResponse.data.jobs : []);
      if (scheduleResponse.data?.schedule) {
        setAutomaticSchedule(scheduleResponse.data.schedule);
        setAutomaticDestination(scheduleResponse.data.schedule.destination || "");
      }
      setSources(sourceResponse.data?.sources || null);
      if (activeJob?.status === "RUNNING") {
        request("get", `/jobs/${encodeURIComponent(activeJob.id)}`)
          .then((response) => { if (active) setJob(response.data?.job || activeJob); })
          .catch((error) => {
            if (active) setPageError(error.response?.data?.error || "Could not reconnect to the active backup job.");
          });
      }
    }).catch((error) => {
      if (active) setPageError(error.response?.data?.error || "Could not load backup status and history.");
    });
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    if (!job?.id || job.status !== "RUNNING") return undefined;
    const timer = window.setInterval(() => {
      refreshJob(job.id).catch((error) => {
        setPageError(error.response?.data?.error || "Lost connection to the backup job.");
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, refreshJob]);

  useEffect(() => {
    if (!automaticSchedule.enabled) return undefined;
    let active = true;
    const pollActiveAutomaticJob = async () => {
      try {
        const response = await request("get", "/jobs/active");
        const activeJob = response.data?.job;
        if (active && activeJob?.backupType === "AUTOMATIC") setJob(activeJob);
      } catch (error) {
        if (active) setPageError(error.response?.data?.error || "Could not refresh automatic backup status.");
      }
    };
    const timer = window.setInterval(pollActiveAutomaticJob, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [automaticSchedule.enabled, request]);

  const updateDestination = (id, value) => {
    setDestinations((previous) => previous.map((destination) => (
      destination.id === id ? { ...destination, path: value } : destination
    )));
    setTestedDrives((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setPlan(null);
    setPageError("");
  };

  const addDestination = () => {
    if (destinations.length >= 8) return;
    setDestinations((previous) => [...previous, { id: nextDestinationId, path: "" }]);
    setNextDestinationId((previous) => previous + 1);
    setPlan(null);
  };

  const removeDestination = (id) => {
    if (destinations.length <= 1) return;
    setDestinations((previous) => previous.filter((destination) => destination.id !== id));
    setLocalFolderSelections((previous) => {
      const next = { ...previous };
      delete next[`manual-${id}`];
      return next;
    });
    setTestedDrives((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setPlan(null);
  };

  const testConnection = async (destination) => {
    if (!destination.path.trim()) {
      setPageError(`Enter a path for Drive ${destinations.findIndex((item) => item.id === destination.id) + 1}.`);
      return;
    }
    setBusy(true);
    setPageError("");
    try {
      const response = await request("post", "/test-connection", { path: destination.path.trim() });
      const drive = response.data?.drives?.[0];
      if (!drive) throw new Error("The server returned no destination information.");
      setTestedDrives((previous) => ({ ...previous, [destination.id]: drive }));
      setDestinationMessages((previous) => ({ ...previous, [destination.id]: { ok: true, message: "Destination connected and writable." } }));
      setPlan(null);
      toast.success(`Drive ${destinations.findIndex((item) => item.id === destination.id) + 1} is ready.`);
    } catch (error) {
      const message = error.response?.data?.error || error.message || "Destination test failed.";
      setDestinationMessages((previous) => ({ ...previous, [destination.id]: { ok: false, message } }));
      setPageError(message);
      setTestedDrives((previous) => {
        const next = { ...previous };
        delete next[destination.id];
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  const buildPlan = async () => {
    if (manualDestinationMode === "mac-local" && !localFolderSelections["manual-local"]?.handle) {
      setPageError("Choose a folder on this Mac before building a local backup plan.");
      return;
    }
    setBusy(true);
    setPageError("");
    setPlan(null);
    try {
      const freshSources = await refreshSources();
      if (!freshSources) throw new Error("Current backup source sizes could not be refreshed.");
      const response = await request("post", "/plan", {
        categories,
        ...(manualDestinationMode === "mac-local"
          ? { destinationMode: "mac-local" }
          : { destinations: destinations.map(({ path: destinationPath }) => destinationPath.trim()) })
      });
      setPlan(response.data);
      if (!response.data?.ready) {
        setPageError((response.data?.issues || []).join(" "));
      }
    } catch (error) {
      setPageError(error.response?.data?.error || "Backup preflight failed.");
    } finally {
      setBusy(false);
    }
  };

  const startBackup = async () => {
    if (job?.status === "RUNNING" || categories.length === 0) return;
    if (manualDestinationMode === "mac-local" && !localFolderSelections["manual-local"]?.handle) {
      setPageError("Choose a folder on this Mac before starting a local backup.");
      return;
    }
    setBusy(true);
    setPageError("");
    try {
      const freshSources = await refreshSources();
      if (!freshSources) throw new Error("Current backup source sizes could not be refreshed.");
      const refreshedPlanResponse = await request("post", "/plan", {
        categories,
        ...(manualDestinationMode === "mac-local"
          ? { destinationMode: "mac-local" }
          : { destinations: destinations.map(({ path: destinationPath }) => destinationPath.trim()) })
      });
      const freshPlan = refreshedPlanResponse.data;
      setPlan(freshPlan);
      if (!freshPlan?.ready) {
        setPageError((freshPlan?.issues || []).join(" ") || "The current complete backup does not fit safely.");
        return;
      }
      const response = await request("post", "/start", {
        categories,
        ...(manualDestinationMode === "mac-local"
          ? { destinationMode: "mac-local" }
          : { destinations: destinations.map(({ path: destinationPath }) => destinationPath.trim()) })
      });
      setJob(response.data);
      setLocalExportComplete(false);
      setLocalExportError("");
      setLocalExportProgress("");
      await refreshHistory();
      toast.info(manualDestinationMode === "mac-local"
        ? "The verified backup is being prepared on the server. You can transfer it to this Mac when complete."
        : "The server-side backup has started.");
    } catch (error) {
      const message = error.response?.data?.error || "Backup could not be started.";
      setPageError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const testAutomaticDestination = async () => {
    if (!automaticDestination.trim()) {
      setScheduleMessage("Select a PC2 backup location first.");
      return;
    }
    setBusy(true);
    setScheduleMessage("");
    try {
      const response = await request("post", "/test-connection", { path: automaticDestination.trim() });
      const drive = response.data?.drives?.[0];
      if (!drive) throw new Error("PC2 returned no destination information.");
      setAutomaticDrive(drive);
      const planResponse = await request("post", "/plan", {
        categories: automaticSchedule.selectedTypes,
        destinations: [automaticDestination.trim()]
      });
      setAutomaticPlan(planResponse.data);
      setScheduleMessage(planResponse.data?.ready
        ? "Automatic destination connected and writable; current selected backup fits the safety plan."
        : `Destination connected, but the current automatic backup plan is not safe: ${(planResponse.data?.issues || []).join(" ")}`);
    } catch (error) {
      setAutomaticDrive(null);
      setAutomaticPlan(null);
      setScheduleMessage(error.response?.data?.error || error.message || "Automatic destination validation failed.");
    } finally {
      setBusy(false);
    }
  };

  const saveSchedule = async () => {
    setBusy(true);
    setScheduleMessage("");
    try {
      const response = await request("put", "/automatic", {
        ...automaticSchedule,
        destination: automaticDestination.trim(),
        enabled: automaticSchedule.enabled
      });
      setAutomaticSchedule(response.data?.schedule || automaticSchedule);
      setAutomaticDrive(null);
      setAutomaticPlan(null);
      setScheduleMessage("Automatic backup schedule saved.");
      toast.success("Automatic backup schedule saved.");
    } catch (error) {
      const message = error.response?.data?.error || "Automatic backup schedule could not be saved.";
      setScheduleMessage(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const pickLocalFolder = async (selectionKey) => {
    if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") {
      setLocalFolderSelections((previous) => ({
        ...previous,
        [selectionKey]: { ...previous[selectionKey], error: "Local folder selection is unavailable in this browser or context. Use a supported browser in a secure context, or enter a server-accessible destination path instead." }
      }));
      return;
    }

    try {
      const directory = await window.showDirectoryPicker({
        mode: selectionKey === "manual-local" ? "readwrite" : "read"
      });
      setLocalFolderSelections((previous) => ({
        ...previous,
        [selectionKey]: { name: directory.name, handle: directory, error: "" }
      }));
      if (selectionKey === "manual-local") setLocalExportComplete(false);
    } catch (error) {
      if (error?.name === "AbortError") return;
      setLocalFolderSelections((previous) => ({
        ...previous,
        [selectionKey]: { ...previous[selectionKey], error: "Could not select a local folder. Check browser permissions and try again." }
      }));
    }
  };

  const transferBackupToMac = async (exportJob = job) => {
    const directory = localFolderSelections["manual-local"]?.handle;
    if (
      !directory ||
      exportJob?.backupType !== "MANUAL" ||
      exportJob?.clientExport !== true ||
      exportJob?.status !== "SUCCESS" ||
      exportJob?.verificationStatus !== "VERIFIED"
    ) {
      setLocalExportError("A selected Mac folder and a completed, verified Mac-local manual backup are required.");
      return;
    }
    setLocalExportBusy(true);
    setLocalExportError("");
    setLocalExportComplete(false);
    let stagingParent = null;
    let createdSetName = null;
    try {
      const permission = await directory.queryPermission({ mode: "readwrite" });
      const granted = permission === "granted"
        ? permission
        : await directory.requestPermission({ mode: "readwrite" });
      if (granted !== "granted") throw new Error("Read/write permission for the selected Mac folder was not granted.");

      const token = getAuthToken();
      const exportResponse = await request("get", `/jobs/${encodeURIComponent(exportJob.id)}/export`);
      const files = exportResponse.data?.files;
      if (!Array.isArray(files) || files.length === 0) throw new Error("The verified backup contains no files to transfer.");

      const gfxDirectory = await directory.getDirectoryHandle("GFXunlimit", { create: true });
      const setName = `Backup-Set-${exportJob.id}`;
      try {
        await gfxDirectory.getDirectoryHandle(setName);
        throw new Error("A folder for this backup set already exists in the selected Mac folder. Choose another destination folder.");
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
      }
      const setDirectory = await gfxDirectory.getDirectoryHandle(setName, { create: true });
      stagingParent = gfxDirectory;
      createdSetName = setName;
      const driveDirectory = await setDirectory.getDirectoryHandle("Drive-1", { create: true });

      for (const [index, file] of files.entries()) {
        const parts = String(file.path || "").split("/");
        if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) {
          throw new Error("The server returned an unsafe backup file name.");
        }
        let parent = driveDirectory;
        for (const part of parts.slice(0, -1)) {
          parent = await parent.getDirectoryHandle(part, { create: true });
        }
        const fileHandle = await parent.getFileHandle(parts[parts.length - 1], { create: true });
        const response = await fetch(
          `${apiBaseUrl}/admin/backup/jobs/${encodeURIComponent(exportJob.id)}/export/file?path=${encodeURIComponent(file.path)}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            credentials: "include"
          }
        );
        if (!response.ok || !response.body?.pipeTo) {
          throw new Error(response.ok
            ? "Streaming this backup file is not supported by this browser."
            : `The server could not transfer ${file.path}.`);
        }
        const writable = await fileHandle.createWritable();
        try {
          await response.body.pipeTo(writable);
        } catch (error) {
          await writable.abort().catch(() => {});
          throw error;
        }
        const writtenFile = await fileHandle.getFile();
        if (writtenFile.size !== Number(file.sizeBytes)) {
          throw new Error(`Transferred file size did not match the verified server copy: ${file.path}`);
        }
        setLocalExportProgress(`Transferred ${index + 1} of ${files.length} files`);
      }

      setLocalExportComplete(true);
      toast.success("The verified manual backup was transferred to the selected Mac folder.");
      try {
        await request("delete", `/jobs/${encodeURIComponent(exportJob.id)}/export`);
      } catch (error) {
        setLocalExportError("The Mac copy is complete, but temporary server staging could not be removed. Contact the administrator to reclaim that space.");
      }
    } catch (error) {
      const message = error.response?.data?.error || error.message || "The backup could not be transferred to this Mac.";
      if (stagingParent && createdSetName) {
        try {
          await stagingParent.removeEntry(createdSetName, { recursive: true });
        } catch (cleanupError) {
          setLocalExportError(`${message} The incomplete Mac folder could not be removed; delete Backup-Set-${exportJob.id} before retrying.`);
          return;
        }
      }
      setLocalExportError(message);
    } finally {
      setLocalExportBusy(false);
    }
  };

  const sourceSize = (key) => {
    if (!sources) return null;
    if (key === "database") return sources.database?.available ? sources.database.currentBytes : null;
    if (key === "websiteCode") return sources.websiteCode?.available ? sources.websiteCode.currentBytes : null;
    if (key === "assetsAndThumbnails") return sources.assets?.available ? sources.assets.totalBytes : null;
    return null;
  };
  const selectedSourceValues = categories.map(sourceSize);
  const selectedSourceBytes = selectedSourceValues.some((size) => size == null)
    ? null
    : selectedSourceValues.reduce((sum, size) => sum + size, 0);
  const automaticSelectedValues = automaticSchedule.selectedTypes.map(sourceSize);
  const automaticSelectedBytes = automaticSelectedValues.some((size) => size == null)
    ? null
    : automaticSelectedValues.reduce((sum, size) => sum + size, 0);
  const formatScheduleDate = (value) => {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: BACKUP_TIME_ZONE
      }).format(new Date(value)) + " IST";
    } catch {
      return "Date unavailable";
    }
  };
  const formatScheduleTime = (value) => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
    if (!match) return "Time unavailable";
    const date = new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2])));
    return `${new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC"
    }).format(date)} IST`;
  };

  const activeJob = job?.status === "RUNNING";
  const activeAutomaticJob = job?.backupType === "AUTOMATIC" ? job : null;
  const automaticRunStatus = activeAutomaticJob?.status === "RUNNING"
    ? activeAutomaticJob.progress?.stage === "VERIFYING" || activeAutomaticJob.progress?.stage === "FINALIZING"
      ? "VERIFYING"
      : "RUNNING"
    : activeAutomaticJob?.status || automaticSchedule.lastRun?.status || (automaticSchedule.enabled ? "WAITING" : "DISABLED");
  const buttonStyle = (primary = false) => ({
    border: primary ? 0 : `1px solid ${palette.border}`,
    borderRadius: 10,
    padding: "10px 14px",
    color: primary ? "#fff" : palette.text,
    background: primary ? "#2563eb" : palette.surface,
    fontWeight: 700,
    cursor: busy || activeJob ? "not-allowed" : "pointer",
    opacity: busy || activeJob ? 0.65 : 1
  });
  const sectionStyle = {
    display: "grid",
    gap: 14,
    padding: 18,
    borderRadius: 14,
    border: `1px solid ${palette.border}`,
    background: palette.surface,
    color: palette.text
  };

  return (
    <div className={`gfx-backup ${isDarkMode ? "gfx-backup--dark" : ""}`} style={{ display: "grid", gap: 18, color: palette.text }}>
      <header className="gfx-backup-hero">
        <div className="gfx-backup-hero__copy">
          <span className="gfx-backup-eyebrow"><span className="gfx-backup-live-dot" /> ADMINISTRATOR · DATA PROTECTION</span>
          <h2>Backup Center</h2>
          <p>Protect your platform with complete, verified backups — managed securely from your server.</p>
        </div>
        <div className="gfx-backup-hero__aside">
          <span className="gfx-backup-hero__icon" aria-hidden="true">↻</span>
          <span><strong>Server-side protection</strong><small>Runs on PC2, even when you leave this page</small></span>
        </div>
      </header>
      <section className="gfx-backup-section gfx-backup-sources" style={sectionStyle}>
        <div className="gfx-backup-section-heading">
          <div><span className="gfx-backup-kicker">01 / CONFIGURE</span><h3>Select backup type</h3><p>Choose the data you want to protect in this complete backup.</p></div>
          <span className="gfx-backup-measurement">{sources?.measuredAt ? `Measured ${formatScheduleDate(sources.measuredAt)}` : "Live source measurements"}</span>
        </div>
        <div className="gfx-backup-category-grid" aria-label="Backup categories">
        {BACKUP_CATEGORIES.map((category) => {
          const selected = categories.includes(category.key);
          const size = sourceSize(category.key);
          return (
            <label key={category.key} className={`gfx-backup-category-card ${selected ? "is-selected" : ""}`} style={{
              display: "grid",
              gap: 9,
              padding: 17,
              borderRadius: 14,
              border: `1px solid ${selected ? "#3b82f6" : palette.border}`,
              background: selected ? (isDarkMode ? "rgba(37,99,235,.14)" : "#eff6ff") : palette.surface,
              cursor: activeJob ? "not-allowed" : "pointer"
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={activeJob || busy}
                  onChange={(event) => {
                    setCategories((previous) => event.target.checked
                      ? [...previous, category.key]
                      : previous.filter((key) => key !== category.key));
                    setPlan(null);
                  }}
                />
                <strong>{category.title}</strong>
              </span>
              <span style={{ color: palette.muted, fontSize: 13, lineHeight: 1.45 }}>{category.description}</span>
              {category.key !== "assetsAndThumbnails" && (
                <span className="gfx-backup-category-size"><small>Current source size</small><strong>{size == null ? "Unavailable" : formatBytes(size)}</strong></span>
              )}
              {category.key === "database" && sources?.database && (
                <span style={{ fontSize: 12, color: palette.muted }}>
                  {sources.database.name || "stocksite"} · {sources.database.version || "PostgreSQL version unavailable"} · {sources.database.sourceServer || "Server unavailable"}
                  {sources.database.pgDump && <span style={{ display: "block", color: sources.database.pgDump.available ? "#15803d" : "#b91c1c" }}>
                    {sources.database.pgDump.available ? `Compatible pg_dump: ${sources.database.pgDump.version}` : sources.database.pgDump.error}
                  </span>}
                  {sources.database.error && <span style={{ display: "block", color: "#b91c1c" }}>{sources.database.error}</span>}
                </span>
              )}
              {category.key === "websiteCode" && sources?.websiteCode?.error && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{sources.websiteCode.error}</span>
              )}
              {category.key === "assetsAndThumbnails" && (
                <span style={{ display: "grid", gap: 5, fontSize: 12, color: palette.muted }}>
                  <span className="gfx-backup-asset-size"><span>Original assets</span><strong style={{ color: palette.text }}>{sources?.assets?.originalBytes == null ? "Unavailable" : formatBytes(sources.assets.originalBytes)}</strong><small>{sources?.assets?.originalRoot || "Not configured on PC2"}</small></span>
                  <span className="gfx-backup-asset-size"><span>Centralized thumbnails</span><strong style={{ color: palette.text }}>{sources?.assets?.thumbnailBytes == null ? "Unavailable" : formatBytes(sources.assets.thumbnailBytes)}</strong><small>{sources?.assets?.thumbnailRoot || "Not configured on PC2"}</small></span>
                  <span className="gfx-backup-category-size"><small>Total assets + thumbnails</small><strong>{size == null ? "Unavailable" : formatBytes(size)}</strong></span>
                  {sources?.assets?.error && <span role="alert" style={{ color: "#b91c1c" }}>{sources.assets.error}</span>}
                </span>
              )}
            </label>
          );
        })}
        </div>
        <div className="gfx-backup-selected-total">
          <strong>Selected Backup Size: {selectedSourceBytes == null ? "Unavailable" : formatBytes(selectedSourceBytes)}</strong>
          <button type="button" onClick={() => refreshSources().catch(() => {})} disabled={busy || activeJob} style={buttonStyle()}>Refresh Source Sizes</button>
        </div>
        {sourceError && <div role="alert" style={{ color: "#b91c1c" }}>{sourceError}</div>}
        {sources?.measuredAt && <span style={{ color: palette.muted, fontSize: 12 }}>Measured {formatScheduleDate(sources.measuredAt)}</span>}
      </section>

      <section className="gfx-backup-section gfx-backup-manual" style={sectionStyle}>
        <div>
          <div className="gfx-backup-section-heading">
            <div><span className="gfx-backup-kicker">02 / ON DEMAND</span><h3>Manual backup</h3><p>Run a complete backup now, with verified storage and a clear capacity plan.</p></div>
            <span className="gfx-backup-section-badge">COMPLETE · VERIFIED</span>
          </div>
          <div role="radiogroup" aria-label="Manual backup destination type" style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12 }}>
            <label>
              <input
                type="radio"
                name="manual-backup-destination-mode"
                value="server"
                checked={manualDestinationMode === "server"}
                disabled={busy || activeJob}
                onChange={() => { setManualDestinationMode("server"); setPlan(null); }}
              /> Server destination
            </label>
            <label>
              <input
                type="radio"
                name="manual-backup-destination-mode"
                value="mac-local"
                checked={manualDestinationMode === "mac-local"}
                disabled={busy || activeJob}
                onChange={() => { setManualDestinationMode("mac-local"); setPlan(null); }}
              /> This Mac
            </label>
          </div>
          {manualDestinationMode === "server" ? (
            <div style={{ marginTop: 10 }}>
              <h4 style={{ margin: "10px 0 5px" }}>Backup Destination</h4>
              <p style={{ margin: 0, color: palette.muted, fontSize: 13 }}>
                Browse selects a folder on this computer only and does not make it writable by server-side jobs. Enter a destination accessible to the backend server. Drive 1 has priority.
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <p style={{ margin: 0, color: palette.muted, fontSize: 13 }}>
                The server creates and verifies the backup using the existing backup engine, then streams its files to the folder you choose here. It uses temporary server space until transfer completes; unclaimed exports expire after 24 hours.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <button type="button" onClick={() => pickLocalFolder("manual-local")} disabled={busy || activeJob || localExportBusy} style={buttonStyle()}>
                  {localFolderSelections["manual-local"]?.name ? "Change Mac folder" : "Choose Mac folder"}
                </button>
                {localFolderSelections["manual-local"]?.name && (
                  <span role="status">Selected folder: <strong>{localFolderSelections["manual-local"].name}</strong></span>
                )}
              </div>
              {localFolderSelections["manual-local"]?.error && (
                <div role="alert" style={{ color: "#b91c1c" }}>{localFolderSelections["manual-local"].error}</div>
              )}
              <small style={{ color: palette.muted }}>
                Requires a supported browser with File System Access API support in a secure context. The selected folder handle stays in this browser and is never sent to the server.
              </small>
            </div>
          )}
        </div>
        {manualDestinationMode === "server" && <div style={{ display: "grid", gap: 12 }}>
          {destinations.map((destination, index) => {
            const tested = testedDrives[destination.id];
            const planned = plan?.drives?.find((drive) => drive.driveNumber === index + 1);
            return (
              <div key={destination.id} className="gfx-backup-drive-card" style={{ display: "grid", gap: 10, padding: 14, borderRadius: 12, background: palette.panel, border: `1px solid ${palette.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <strong>Drive {index + 1}</strong>
                  <strong style={{ color: statusColor(planned?.status || tested?.status) }}>{planned?.status || tested?.status || "NOT TESTED"}</strong>
                </div>
                <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
                  Destination path
                  <input
                    value={destination.path}
                    disabled={activeJob || busy}
                    onChange={(event) => updateDestination(destination.id, event.target.value)}
                    placeholder="Select backup location"
                    style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", border: `1px solid ${palette.border}`, borderRadius: 9, background: palette.surface, color: palette.text }}
                  />
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button type="button" onClick={() => pickLocalFolder(`manual-${destination.id}`)} disabled={busy || activeJob} style={buttonStyle()}>{destination.path ? "Change" : "Browse this computer"}</button>
                  <button type="button" onClick={() => testConnection(destination)} disabled={busy || activeJob} style={buttonStyle()}>Test Connection</button>
                  {destinations.length > 1 && <button type="button" onClick={() => removeDestination(destination.id)} disabled={busy || activeJob} style={buttonStyle()}>Remove Drive</button>}
                </div>
                {localFolderSelections[`manual-${destination.id}`]?.name && (
                  <div role="status" style={{ color: palette.muted, fontSize: 13 }}>
                    Local folder selected: <strong>{localFolderSelections[`manual-${destination.id}`].name}</strong>. It is not the server destination above and cannot be used by the current backup jobs.
                  </div>
                )}
                {localFolderSelections[`manual-${destination.id}`]?.error && (
                  <div role="alert" style={{ color: "#b91c1c" }}>{localFolderSelections[`manual-${destination.id}`].error}</div>
                )}
                {destinationMessages[destination.id] && (
                  <div role={destinationMessages[destination.id].ok ? "status" : "alert"} style={{ color: destinationMessages[destination.id].ok ? "#15803d" : "#b91c1c" }}>
                    {destinationMessages[destination.id].ok ? "✓ " : "✕ "}{destinationMessages[destination.id].message}
                  </div>
                )}
                {(tested || planned) && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, fontSize: 12, color: palette.muted }}>
                    <span>Actual capacity: <strong style={{ color: palette.text }}>{formatBytes(planned?.actualCapacityBytes ?? tested?.totalBytes)}</strong></span>
                    <span>Used: <strong style={{ color: palette.text }}>{formatBytes(planned?.currentUsedBytes ?? tested?.usedBytes)}</strong></span>
                    <span>Available: <strong style={{ color: palette.text }}>{formatBytes(planned?.currentAvailableBytes ?? tested?.availableBytes)}</strong></span>
                    <span>90% safety limit: <strong style={{ color: palette.text }}>{formatBytes(planned?.safetyLimitBytes ?? tested?.safetyLimitBytes)}</strong></span>
                    <span>Usable backup space: <strong style={{ color: palette.text }}>{formatBytes(planned?.usableBackupBytes ?? tested?.usableBackupBytes)}</strong></span>
                    {planned && <span>Required: <strong style={{ color: palette.text }}>{formatBytes(planned.requiredBytes)}</strong></span>}
                    {planned && <span>Safe space remaining: <strong style={{ color: palette.text }}>{formatBytes(planned.remainingSafeBytes)}</strong></span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
          {manualDestinationMode === "server" && <button type="button" onClick={addDestination} disabled={destinations.length >= 8 || busy || activeJob} style={buttonStyle()}>+ Add another backup drive</button>}
          <button type="button" onClick={buildPlan} disabled={busy || activeJob || categories.length === 0} style={buttonStyle()}>Build Complete Backup Plan</button>
        </div>
      </section>

      {plan && (
        <section className="gfx-backup-section gfx-backup-plan" style={sectionStyle} aria-label="Backup plan">
          <div>
            <h3 style={{ margin: "0 0 6px" }}>Pre-backup plan</h3>
            <p style={{ margin: 0, color: palette.muted }}>
              {manualDestinationMode === "mac-local"
                ? "The server will stage a verified backup set temporarily, then stream its unchanged files into the selected Mac folder."
                : "Every selected category is a complete copy. Existing target files are overwritten; source folder hierarchy is preserved."}
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 9 }}>
            {plan.categories?.database && categories.includes("database") && <span>Database dump reserve: <strong>{formatBytes(plan.categories.database.plannedBytes)}</strong></span>}
            {categories.includes("websiteCode") && <span>Website Code: <strong>{formatBytes(plan.categories.websiteCode?.plannedBytes)}</strong></span>}
            {categories.includes("assetsAndThumbnails") && (
              <>
                <span>Original assets: <strong>{formatBytes(plan.categories.originalAssets?.plannedBytes)}</strong></span>
                <span>Thumbnails: <strong>{formatBytes(plan.categories.thumbnails?.plannedBytes)}</strong></span>
              </>
            )}
            <span>Total required reserve: <strong>{formatBytes(plan.totalRequiredBytes)}</strong></span>
            <span>Files: <strong>{Number(plan.filesTotal || 0).toLocaleString()}</strong></span>
          </div>
          {plan.categories?.originalAssets?.users?.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              <strong>Original asset groups (complete users, sorted largest first)</strong>
              {plan.categories.originalAssets.users.map((user) => (
                <div key={user.username} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 10px", borderRadius: 8, background: palette.panel, color: palette.muted }}>
                  <span>{user.displayName}</span><strong style={{ color: palette.text }}>{formatBytes(user.sizeBytes)}</strong>
                </div>
              ))}
            </div>
          )}
          {plan.issues?.length > 0 && (
            <div role="alert" style={{ padding: 12, borderRadius: 10, color: "#991b1b", background: isDarkMode ? "#451a1a" : "#fef2f2" }}>
              <strong>Plan is not safe to start.</strong>
              <ul style={{ marginBottom: 0 }}>{plan.issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>
              {plan.unplacedGroups?.length > 0 && (
                <ul style={{ marginBottom: 0 }}>
                  {plan.unplacedGroups.map((group) => (
                    <li key={group.key}>{group.label}: {formatBytes(group.requiredBytes)} required — {group.reason}</li>
                  ))}
                </ul>
              )}
              {plan.additionalSafeCapacityRequired > 0 && <div style={{ marginTop: 8 }}>At least {formatBytes(plan.additionalSafeCapacityRequired)} additional safe capacity is needed; indivisible groups may require a larger individual drive.</div>}
            </div>
          )}
          {plan.warnings?.length > 0 && (
            <div style={{ padding: 12, borderRadius: 10, color: isDarkMode ? "#fde68a" : "#854d0e", background: isDarkMode ? "#422006" : "#fffbeb" }}>
              <strong>Planning notes</strong>
              <ul style={{ marginBottom: 0 }}>{plan.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
            </div>
          )}
          <button className="gfx-backup-primary" type="button" onClick={startBackup} disabled={!plan.ready || busy || activeJob} style={{ ...buttonStyle(true), width: "fit-content" }}>
            {busy ? "Starting..." : manualDestinationMode === "mac-local" ? "Start Mac-local Backup" : "Start Complete Backup"}
          </button>
        </section>
      )}

      {pageError && <div role="alert" style={{ padding: 12, borderRadius: 10, color: "#991b1b", background: isDarkMode ? "#451a1a" : "#fef2f2" }}>{pageError}</div>}

      {job && (
        <section className="gfx-backup-section gfx-backup-progress" style={sectionStyle} aria-label="Backup job progress">
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12 }}>
            <div>
              <span className="gfx-backup-kicker">{job.backupType === "AUTOMATIC" ? "AUTOMATIC BACKUP RUN" : "MANUAL BACKUP RUN"}</span>
              <h3 style={{ margin: "5px 0" }}>{job.status === "SUCCESS" && job.verificationStatus === "VERIFIED" ? "Backup completed and verified" : job.status === "FAILED" || job.verificationStatus === "FAILED" ? "Backup failed" : `Backup Progress — ${Number(job.progress?.percent || 0).toFixed(1)}%`}</h3>
              <span style={{ color: palette.muted }}>Set ID: {job.id}</span>
            </div>
            <strong style={{ color: statusColor(job.status) }}>{job.status} · {job.verificationStatus}</strong>
          </div>
          {job.backupType === "MANUAL" && job.clientExport === true && job.status === "SUCCESS" && job.verificationStatus === "VERIFIED" && (
            <div style={{ display: "grid", gap: 8 }}>
              <p style={{ margin: 0, color: palette.muted }}>
                The server-side backup is verified and ready to transfer to this Mac. The server copy remains staged until transfer completes.
              </p>
              <button
                type="button"
                onClick={() => transferBackupToMac(job)}
                disabled={localExportBusy || localExportComplete || !localFolderSelections["manual-local"]?.handle}
                style={buttonStyle(true)}
              >
                {localExportBusy ? "Transferring to Mac..." : localExportComplete ? "Transferred to Mac" : "Transfer verified backup to Mac"}
              </button>
              {localExportProgress && <span role="status">{localExportProgress}</span>}
              {localExportError && <div role="alert" style={{ color: "#b91c1c" }}>{localExportError}</div>}
            </div>
          )}
          {(job.status === "RUNNING" || job.status === "SUCCESS") && (
            <>
              <div className="gfx-backup-overall-progress">
                <div className="gfx-backup-progress-label">
                  <strong>Overall backup progress</strong>
                  <span>{job.status === "SUCCESS" && job.verificationStatus === "VERIFIED" ? "100%" : `${Number(job.progress?.percent || 0).toFixed(1)}%`}</span>
                </div>
                <div role="progressbar" aria-label="Overall backup progress" aria-valuenow={job.status === "SUCCESS" && job.verificationStatus === "VERIFIED" ? 100 : Math.min(99.9, Number(job.progress?.percent || 0))} aria-valuemin={0} aria-valuemax={100} style={{ height: 11, borderRadius: 99, background: palette.panel, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${job.status === "SUCCESS" && job.verificationStatus === "VERIFIED" ? 100 : Math.min(99.9, Math.max(0, Number(job.progress?.percent || 0)))}%`, background: "linear-gradient(90deg, #ed2224, #f97316)", transition: "width .25s ease" }} />
                </div>
                <div className="gfx-backup-progress-label gfx-backup-progress-secondary">
                  <span>{formatBytes(job.completedBytes)} / {formatBytes(job.totalBytes)}</span>
                  <span>{job.progress?.stage === "VERIFYING" || job.progress?.stage === "FINALIZING" ? "Copy complete — 100% · Verifying backup…" : job.progress?.stage === "COPY_VERIFYING" ? "Verifying current file…" : job.progress?.stage === "COMPLETE" ? "Backup completed and verified" : "Copying backup data…"}</span>
                </div>
              </div>
              <div className="gfx-backup-live-details">
                <div className="gfx-backup-current-destination">
                  <span className="gfx-backup-live-dot" />
                  <span><strong>Drive {job.progress?.driveNumber || "—"} · {job.progress?.category || "Preparing"}</strong><small>{job.progress?.drivePath || "Destination not assigned"}{job.progress?.currentPath ? ` → ${job.progress.currentPath}` : ""}</small></span>
                </div>
                <div className="gfx-backup-progress-metrics">
                  <span>Current file <strong>{formatBytes(job.progress?.currentFileBytes)} / {formatBytes(job.progress?.currentFileSize)}</strong></span>
                  <span>Files copied <strong>{Number(job.filesCompleted || 0).toLocaleString()} / {Number(job.filesTotal || 0).toLocaleString()}</strong></span>
                  <span>Transfer speed <strong>{formatBytes(job.progress?.bytesPerSecond)}/s</strong></span>
                  <span>Estimated remaining <strong>{formatDuration(job.progress?.etaSeconds)}</strong></span>
                </div>
              </div>
              <div className="gfx-backup-subprogress-grid" aria-label="Category progress">
                {(job.selectedTypes || []).map((key) => {
                  const category = BACKUP_CATEGORIES.find((item) => item.key === key);
                  const progress = job.progress?.categories?.[key] || {};
                  const percent = job.status === "SUCCESS" && job.verificationStatus === "VERIFIED" ? 100 : Math.min(99.9, Number(progress.percent || 0));
                  return (
                    <div className="gfx-backup-subprogress" key={key}>
                      <div className="gfx-backup-progress-label"><strong>{category?.title || key}</strong><span>{percent.toFixed(1)}%</span></div>
                      <div role="progressbar" aria-label={`${category?.title || key} progress`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div>
                      <small>{formatBytes(progress.bytesCompleted)} / {formatBytes(progress.totalBytes)} · {Number(progress.filesCompleted || 0)} / {Number(progress.filesTotal || 0)} files verified</small>
                    </div>
                  );
                })}
              </div>
              {(job.progress?.drives || []).length > 1 && (
                <div className="gfx-backup-drive-progress" aria-label="Destination drive progress">
                  {(job.progress.drives || []).map((drive) => (
                    <div className="gfx-backup-drive-progress__item" key={drive.driveNumber}>
                      <span><strong>Drive {drive.driveNumber}</strong><em>{drive.status === "RUNNING" ? `${Number(drive.percent || 0).toFixed(1)}% complete` : drive.status === "COMPLETE" ? "Complete" : drive.status === "WAITING" ? "Waiting" : drive.status}</em></span>
                      <small>{drive.path}</small>
                      <div role="progressbar" aria-label={`Drive ${drive.driveNumber} progress`} aria-valuenow={Number(drive.percent || 0)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Number(drive.percent || 0)}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
              {(job.progress?.stage === "COPY_VERIFYING" || job.progress?.stage === "VERIFYING" || job.progress?.stage === "FINALIZING" || job.status === "SUCCESS") && (
                <div className="gfx-backup-verification" role="status">
                  <strong>{job.verificationStatus === "VERIFIED" ? "Backup completed and verified" : job.progress?.stage === "COPY_VERIFYING" ? "Verifying current file…" : job.progress?.stage === "FINALIZING" ? "Finalizing verified backup…" : "Verifying backup…"}</strong>
                  <span>Verified: {Number(job.progress?.verifiedFiles ?? job.filesCompleted ?? 0).toLocaleString()} / {Number(job.progress?.totalFiles ?? job.filesTotal ?? 0).toLocaleString()} files</span>
                </div>
              )}
              {job.verificationStatus === "FAILED" && <div className="gfx-backup-verification is-failed" role="alert">Verification failed. This backup was not completed successfully.</div>}
            </>
          )}
          {job.status === "FAILED" && job.verificationStatus !== "FAILED" && (
            <div className="gfx-backup-verification is-failed" role="alert">Backup failed before verification could complete.</div>
          )}
          {job.status === "FAILED" && (
            <div className="gfx-backup-verification is-failed" role="alert">Verification failed. The backup was not marked successful.</div>
          )}
          {job.database?.verified && (
            <div style={{ padding: 11, borderRadius: 9, background: palette.panel, overflowWrap: "anywhere" }}>
              Database dump verified · {formatBytes(job.database.sizeBytes)} · PostgreSQL {job.database.serverVersion} · SHA-256 {job.database.sha256}
            </div>
          )}
          {job.errors?.length > 0 && <ul role="alert" style={{ color: "#b91c1c", marginBottom: 0 }}>{job.errors.map((error, index) => <li key={`${index}-${error.path || ""}`}>{error.path ? `${error.path}: ` : ""}{error.message}</li>)}</ul>}
        </section>
      )}

      <section className="gfx-backup-section gfx-backup-history" style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Backup History</h3>
          <button type="button" onClick={() => refreshHistory().catch((error) => setPageError(error.response?.data?.error || "Could not refresh backup history."))} disabled={busy} style={buttonStyle()}>Refresh</button>
        </div>
        {history.length === 0 ? <p style={{ color: palette.muted, margin: 0 }}>No server-side backup jobs have been recorded yet.</p> : (
          <div style={{ display: "grid", gap: 8 }}>
            {history.map((entry) => (
              <div key={entry.id} className="gfx-backup-history-row" style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1.5fr) repeat(7, minmax(90px, 1fr))", gap: 10, alignItems: "center", padding: 11, borderRadius: 9, background: palette.panel, fontSize: 13 }}>
                <span><strong>{entry.id}</strong><span style={{ display: "block", color: palette.muted }}>{entry.startedAt ? new Date(entry.startedAt).toLocaleString() : "Date unavailable"}</span></span>
                <span>{entry.backupType === "AUTOMATIC" ? `Automatic · ${entry.automaticFrequency || "schedule"}` : "Manual"}<span style={{ display: "block", color: palette.muted }}>Type</span></span>
                <span style={{ color: statusColor(entry.status), fontWeight: 700 }}>{entry.status}</span>
                <span>{formatBytes(entry.totalBytes)}<span style={{ display: "block", color: palette.muted }}>Total size</span></span>
                <span style={{ overflowWrap: "anywhere" }}>
                  {(entry.drives || []).map((drive) => `Drive ${drive.driveNumber}: ${drive.path}`).join(" · ") || "—"}
                  <span style={{ display: "block", color: palette.muted }}>Destinations</span>
                </span>
                <span>{entry.durationMs == null ? "—" : formatDuration(Number(entry.durationMs) / 1000)}<span style={{ display: "block", color: palette.muted }}>Duration</span></span>
                <span>{entry.verificationStatus}</span>
                <span>{(entry.selectedTypes || []).map((type) => BACKUP_CATEGORIES.find((item) => item.key === type)?.title || type).join(", ")}</span>
                {entry.clientExport === true && entry.backupType === "MANUAL" && entry.status === "SUCCESS" && entry.verificationStatus === "VERIFIED" && (
                  <button
                    type="button"
                    onClick={() => transferBackupToMac(entry)}
                    disabled={localExportBusy || !localFolderSelections["manual-local"]?.handle}
                    style={buttonStyle()}
                  >
                    Transfer to Mac
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="gfx-backup-section gfx-backup-automatic" style={sectionStyle} aria-label="Automatic Backup">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: "0 0 5px" }}>Automatic Backup</h3>
            <p style={{ margin: 0, color: palette.muted }}>The PC2 server runs complete backups on schedule. Closing this page will not stop an automatic job.</p>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={Boolean(automaticSchedule.enabled)}
              disabled={busy || activeJob}
              onChange={(event) => setAutomaticSchedule((previous) => ({ ...previous, enabled: event.target.checked }))}
            />
            Automatic Backup {automaticSchedule.enabled ? "ON" : "OFF"}
          </label>
        </div>
        <div className="gfx-backup-auto-status" role="status" aria-label="Automatic backup run status">
          <span className={`gfx-backup-status-dot ${automaticRunStatus === "RUNNING" || automaticRunStatus === "VERIFYING" ? "is-active" : automaticRunStatus === "FAILED" ? "is-failed" : ""}`} />
          <span><small>Current automatic run</small><strong>{automaticRunStatus}</strong></span>
          {activeAutomaticJob && <span className="gfx-backup-auto-status__detail">{activeAutomaticJob.id} · {Number(activeAutomaticJob.progress?.percent || 0).toFixed(1)}% · {activeAutomaticJob.verificationStatus}</span>}
        </div>

        <div className="gfx-backup-location" style={{ display: "grid", gap: 8 }}>
          <strong>Automatic Backup Location</strong>
          <p style={{ margin: 0, color: palette.muted, fontSize: 13 }}>
            Browse selects a folder on this computer only. Automatic server-side backups cannot write to that browser-selected folder; the saved server destination remains unchanged.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <input
              aria-label="Automatic Backup Location"
              value={automaticDestination}
              disabled={busy || activeJob}
              onChange={(event) => {
                setAutomaticDestination(event.target.value);
                setAutomaticDrive(null);
                setAutomaticPlan(null);
                setScheduleMessage("");
              }}
              placeholder="Select backup location"
              style={{ flex: "1 1 300px", minWidth: 0, boxSizing: "border-box", padding: "11px 12px", border: `1px solid ${palette.border}`, borderRadius: 9, background: palette.surface, color: palette.text }}
            />
            <button type="button" onClick={() => pickLocalFolder("automatic")} disabled={busy || activeJob} style={buttonStyle()}>{automaticDestination ? "Change" : "Browse this computer"}</button>
            <button type="button" onClick={testAutomaticDestination} disabled={busy || activeJob || !automaticDestination} style={buttonStyle()}>Test Connection</button>
          </div>
          {localFolderSelections.automatic?.name && (
            <div role="status" style={{ color: palette.muted, fontSize: 13 }}>
              Local folder selected: <strong>{localFolderSelections.automatic.name}</strong>. It is not the saved server destination and cannot be used by automatic backup jobs.
            </div>
          )}
          {localFolderSelections.automatic?.error && (
            <div role="alert" style={{ color: "#b91c1c" }}>{localFolderSelections.automatic.error}</div>
          )}
          {scheduleMessage && <div role="status" style={{ color: (automaticPlan?.ready || /saved/i.test(scheduleMessage)) ? "#15803d" : "#b91c1c" }}>{automaticPlan?.ready ? "✓ " : ""}{scheduleMessage}</div>}
          {automaticDrive && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, color: palette.muted, fontSize: 12 }}>
              <span>Drive/Path: <strong style={{ color: palette.text }}>{automaticDrive.path}</strong></span>
              <span>Actual Capacity: <strong style={{ color: palette.text }}>{formatBytes(automaticDrive.totalBytes)}</strong></span>
              <span>Available Space: <strong style={{ color: palette.text }}>{formatBytes(automaticDrive.availableBytes)}</strong></span>
              <span>90% Safety Limit: <strong style={{ color: palette.text }}>{formatBytes(automaticDrive.safetyLimitBytes)}</strong></span>
              <span>Usable Backup Space: <strong style={{ color: palette.text }}>{formatBytes(automaticDrive.usableBackupBytes)}</strong></span>
              <span>Status: <strong style={{ color: statusColor(automaticDrive.status) }}>{automaticDrive.status}</strong></span>
            </div>
          )}
          {automaticPlan?.drives?.map((drive) => (
            <div key={`automatic-drive-${drive.driveNumber}`} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, color: palette.muted, fontSize: 12 }}>
              <span>Drive {drive.driveNumber} Required: <strong style={{ color: palette.text }}>{formatBytes(drive.requiredBytes)}</strong></span>
              <span>Remaining Safe Space: <strong style={{ color: palette.text }}>{formatBytes(drive.remainingSafeBytes)}</strong></span>
              <span>Plan Status: <strong style={{ color: statusColor(drive.status) }}>{automaticPlan.ready ? drive.status : "INSUFFICIENT SPACE"}</strong></span>
            </div>
          ))}
          {automaticPlan?.issues?.length > 0 && <ul role="alert" style={{ color: "#b91c1c", margin: 0 }}>{automaticPlan.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
        </div>

        <div style={{ display: "grid", gap: 9 }}>
          <strong>Automatic Backup Types</strong>
          {BACKUP_CATEGORIES.map((category) => {
            const checked = automaticSchedule.selectedTypes.includes(category.key);
            const size = sourceSize(category.key);
            return (
              <label key={`automatic-${category.key}`} className={`gfx-backup-auto-type ${checked ? "is-selected" : ""}`} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: 10, borderRadius: 9, background: palette.panel }}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy || activeJob}
                  onChange={(event) => {
                    setAutomaticSchedule((previous) => ({
                      ...previous,
                      selectedTypes: event.target.checked
                        ? [...previous.selectedTypes, category.key]
                        : previous.selectedTypes.filter((key) => key !== category.key)
                    }));
                    setAutomaticPlan(null);
                  }}
                />
                <span style={{ display: "grid", gap: 4 }}>
                  <strong>{category.title}</strong>
                  <span style={{ color: palette.muted }}>Current size: {size == null ? "Unavailable" : formatBytes(size)}</span>
                  {category.key === "assetsAndThumbnails" && <span style={{ color: palette.muted }}>Not selected by default; large user groups remain indivisible and must fit safely.</span>}
                </span>
              </label>
            );
          })}
          <strong className="gfx-backup-auto-total">Selected automatic backup size: {automaticSelectedBytes == null ? "Unavailable" : formatBytes(automaticSelectedBytes)}</strong>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
            Frequency
            <select
              value={automaticSchedule.frequency}
              disabled={busy || activeJob}
              onChange={(event) => setAutomaticSchedule((previous) => ({ ...previous, frequency: event.target.value }))}
              style={{ padding: "10px 12px", borderRadius: 9, border: `1px solid ${palette.border}`, background: palette.surface, color: palette.text }}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          {automaticSchedule.frequency === "weekly" && (
            <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              Day of week
              <select value={automaticSchedule.weeklyDay} disabled={busy || activeJob} onChange={(event) => setAutomaticSchedule((previous) => ({ ...previous, weeklyDay: Number(event.target.value) }))} style={{ padding: "10px 12px", borderRadius: 9, border: `1px solid ${palette.border}`, background: palette.surface, color: palette.text }}>
                {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <option key={day} value={index}>{day}</option>)}
              </select>
            </label>
          )}
          {automaticSchedule.frequency === "monthly" && (
            <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              Day of month
              <select value={automaticSchedule.monthlyDay} disabled={busy || activeJob} onChange={(event) => setAutomaticSchedule((previous) => ({ ...previous, monthlyDay: Number(event.target.value) }))} style={{ padding: "10px 12px", borderRadius: 9, border: `1px solid ${palette.border}`, background: palette.surface, color: palette.text }}>
                {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}{day === 31 ? " (last day in shorter months)" : ""}</option>)}
              </select>
            </label>
          )}
          <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
            Time (IST)
            <input aria-label="Time (IST)" type="time" value={automaticSchedule.time} disabled={busy || activeJob} onChange={(event) => setAutomaticSchedule((previous) => ({ ...previous, time: event.target.value, timezone: BACKUP_TIME_ZONE }))} style={{ padding: "10px 12px", borderRadius: 9, border: `1px solid ${palette.border}`, background: palette.surface, color: palette.text }} />
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, color: palette.muted }}>
          <span>Configured time: <strong style={{ color: palette.text }}>{formatScheduleTime(automaticSchedule.time)}</strong></span>
          <span>Schedule timezone: <strong style={{ color: palette.text }}>IST (Asia/Kolkata)</strong></span>
          <span>Next Run: <strong style={{ color: palette.text }}>{automaticSchedule.enabled ? formatScheduleDate(automaticSchedule.nextRun) : "Disabled"}</strong></span>
          <span>Last Run: <strong style={{ color: palette.text }}>{automaticSchedule.lastRun?.startedAt ? formatScheduleDate(automaticSchedule.lastRun.startedAt) : "—"}</strong></span>
          <span>Last Status: <strong style={{ color: statusColor(automaticRunStatus) }}>{automaticRunStatus}</strong></span>
          {automaticSchedule.lastRun?.totalBytes != null && <span>Last Size: <strong style={{ color: palette.text }}>{formatBytes(automaticSchedule.lastRun.totalBytes)}</strong></span>}
          {automaticSchedule.lastRun?.error && <span role="alert" style={{ color: "#b91c1c" }}>Last Error: {automaticSchedule.lastRun.error}</span>}
        </div>
        <div style={{ display: "grid", gap: 4, color: palette.muted, fontSize: 13 }}>
          <strong style={{ color: palette.text }}>30-run rolling retention per frequency</strong>
          <span>Automatic Backups / YYYY-MM-DD / Database / Website-Code</span>
          <span>At 30 runs, the oldest complete folder for the selected frequency is renamed to the current run date and fully replaced.</span>
        </div>
        <button className="gfx-backup-primary" type="button" onClick={saveSchedule} disabled={busy || activeJob || automaticSchedule.selectedTypes.length === 0} style={{ ...buttonStyle(true), width: "fit-content" }}>Save Schedule</button>
      </section>
    </div>
  );
}
