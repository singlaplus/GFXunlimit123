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

function Pc2DirectoryPicker({ request, onChoose, onClose, palette }) {
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [typedPath, setTypedPath] = useState("");

  const browse = useCallback(async (directory = "") => {
    setLoading(true);
    setError("");
    try {
      const query = directory ? `?path=${encodeURIComponent(directory)}` : "";
      const response = await request("get", `/browse${query}`);
      setListing(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.error || "PC2 could not list that directory.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    browse();
  }, [browse]);

  return (
    <div className="gfx-backup-picker-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 10000, display: "grid", placeItems: "center", padding: 18, background: "rgba(2,6,23,.68)" }}>
      <section className="gfx-backup-picker" role="dialog" aria-modal="true" aria-labelledby="pc2-picker-title" style={{ width: "min(680px, 100%)", maxHeight: "min(80vh, 720px)", display: "grid", gridTemplateRows: "auto auto auto 1fr auto auto", gap: 12, padding: 18, borderRadius: 14, border: `1px solid ${palette.border}`, background: palette.surface, color: palette.text, boxShadow: "0 24px 80px rgba(0,0,0,.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <h3 id="pc2-picker-title" style={{ margin: 0 }}>Select a PC2 backup location</h3>
          <button type="button" onClick={onClose} aria-label="Close location browser">Close</button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <button type="button" disabled={!listing?.parentPath || loading} onClick={() => browse(listing.parentPath)}>Up</button>
          <code style={{ overflowWrap: "anywhere" }}>{listing?.currentPath || "PC2 filesystem roots"}</code>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <input aria-label="Enter PC2 path to browse" value={typedPath} onChange={(event) => setTypedPath(event.target.value)} placeholder="Enter a PC2 path or UNC share" style={{ flex: "1 1 280px", minWidth: 0, padding: "9px 10px", borderRadius: 8, border: `1px solid ${palette.border}`, background: palette.surface, color: palette.text }} />
          <button type="button" disabled={!typedPath.trim() || loading} onClick={() => browse(typedPath.trim())}>Open PC2 path</button>
        </div>
        <div style={{ overflow: "auto", minHeight: 160, border: `1px solid ${palette.border}`, borderRadius: 10, padding: 8 }}>
          {loading ? <span>Loading folders from PC2...</span> : (
            <div style={{ display: "grid", gap: 4 }}>
              {(listing?.directories || []).map((directory) => (
                <button key={directory.path} type="button" onClick={() => browse(directory.path)} style={{ textAlign: "left", padding: "9px 10px", border: 0, borderRadius: 7, background: palette.panel, color: palette.text, cursor: "pointer" }}>
                  {directory.name}
                </button>
              ))}
              {!listing?.directories?.length && <span style={{ color: palette.muted }}>No subfolders found.</span>}
            </div>
          )}
        </div>
        {error && <div role="alert" style={{ color: "#b91c1c" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={!listing?.currentPath || loading} onClick={() => { onChoose(listing.currentPath); onClose(); }}>Select this folder</button>
        </div>
      </section>
    </div>
  );
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
  const [pickerTarget, setPickerTarget] = useState(null);
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
    setBusy(true);
    setPageError("");
    setPlan(null);
    try {
      const freshSources = await refreshSources();
      if (!freshSources) throw new Error("Current backup source sizes could not be refreshed.");
      const response = await request("post", "/plan", {
        categories,
        destinations: destinations.map(({ path: destinationPath }) => destinationPath.trim())
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
    setBusy(true);
    setPageError("");
    try {
      const freshSources = await refreshSources();
      if (!freshSources) throw new Error("Current backup source sizes could not be refreshed.");
      const refreshedPlanResponse = await request("post", "/plan", {
        categories,
        destinations: destinations.map(({ path: destinationPath }) => destinationPath.trim())
      });
      const freshPlan = refreshedPlanResponse.data;
      setPlan(freshPlan);
      if (!freshPlan?.ready) {
        setPageError((freshPlan?.issues || []).join(" ") || "The current complete backup does not fit safely.");
        return;
      }
      const response = await request("post", "/start", {
        categories,
        destinations: destinations.map(({ path: destinationPath }) => destinationPath.trim())
      });
      setJob(response.data);
      await refreshHistory();
      toast.info("The server-side backup has started.");
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

  const chooseDestination = (path) => {
    if (pickerTarget?.kind === "automatic") {
      setAutomaticDestination(path);
      setAutomaticDrive(null);
      setAutomaticPlan(null);
      setScheduleMessage("");
      return;
    }
    const destinationId = pickerTarget?.id;
    if (destinationId != null) updateDestination(destinationId, path);
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
          <h4 style={{ margin: "10px 0 5px" }}>Backup Destination</h4>
          <p style={{ margin: 0, color: palette.muted, fontSize: 13 }}>
            Browse folders on the PC2 server. The browser does not select a local Mac or workstation path. Drive 1 has priority.
          </p>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
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
                  <button type="button" onClick={() => setPickerTarget({ kind: "manual", id: destination.id })} disabled={busy || activeJob} style={buttonStyle()}>{destination.path ? "Change" : "Browse"}</button>
                  <button type="button" onClick={() => testConnection(destination)} disabled={busy || activeJob} style={buttonStyle()}>Test Connection</button>
                  {destinations.length > 1 && <button type="button" onClick={() => removeDestination(destination.id)} disabled={busy || activeJob} style={buttonStyle()}>Remove Drive</button>}
                </div>
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
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
          <button type="button" onClick={addDestination} disabled={destinations.length >= 8 || busy || activeJob} style={buttonStyle()}>+ Add another backup drive</button>
          <button type="button" onClick={buildPlan} disabled={busy || activeJob || categories.length === 0} style={buttonStyle()}>Build Complete Backup Plan</button>
        </div>
      </section>

      {plan && (
        <section className="gfx-backup-section gfx-backup-plan" style={sectionStyle} aria-label="Backup plan">
          <div>
            <h3 style={{ margin: "0 0 6px" }}>Pre-backup plan</h3>
            <p style={{ margin: 0, color: palette.muted }}>Every selected category is a complete copy. Existing target files are overwritten; source folder hierarchy is preserved.</p>
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
            {busy ? "Starting..." : "Start Complete Backup"}
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
            <button type="button" onClick={() => setPickerTarget({ kind: "automatic" })} disabled={busy || activeJob} style={buttonStyle()}>{automaticDestination ? "Change" : "Browse"}</button>
            <button type="button" onClick={testAutomaticDestination} disabled={busy || activeJob || !automaticDestination} style={buttonStyle()}>Test Connection</button>
          </div>
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
      {pickerTarget && <Pc2DirectoryPicker request={request} palette={palette} onChoose={chooseDestination} onClose={() => setPickerTarget(null)} />}
    </div>
  );
}
