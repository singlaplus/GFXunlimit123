import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { sha256ReadableStream } from "../utils/streamSha256";
import "./AdminBackupPage.css";

const BACKUP_CATEGORIES = [
  { key: "database", title: "Database", description: "Complete native PostgreSQL backup, including schema and data." },
  { key: "websiteCode", title: "Website Code + .env", description: "Allowlisted application source, configuration, migrations, and encrypted .env files." },
  { key: "assetsAndThumbnails", title: "Assets + Thumbnails", description: "Production originals and the separate centralized thumbnail store." }
];
const BACKUP_TIME_ZONE = "Asia/Kolkata";
const LOCAL_EXPORT_COMPONENTS = [
  { key: "database", label: "Database", directory: "Database" },
  { key: "websiteCode", label: "Website Code + .env", directory: "Website-Code" },
  { key: "originalAssets", label: "Original Assets", directory: "Assets" },
  { key: "thumbnails", label: "Thumbnails", directory: "Thumbnails" }
];

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
  const [testedManualDestination, setTestedManualDestination] = useState(null);
  const [plan, setPlan] = useState(null);
  const [job, setJob] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const [sources, setSources] = useState(null);
  const [sourceError, setSourceError] = useState("");
  const [manualDestinationType, setManualDestinationType] = useState("mac-local");
  const [manualLocalFolder, setManualLocalFolder] = useState(null);
  const [manualServerPath, setManualServerPath] = useState("");
  const [manualServerBrowse, setManualServerBrowse] = useState(null);
  const [automaticServerBrowse, setAutomaticServerBrowse] = useState(null);
  const [localExportBusy, setLocalExportBusy] = useState(false);
  const [localExportComplete, setLocalExportComplete] = useState(false);
  const [localExportProgress, setLocalExportProgress] = useState(null);
  const localExportProgressRef = useRef(null);
  const lastLocalProgressRenderRef = useRef(0);
  const localProgressRenderTimerRef = useRef(null);
  const [manualLocalJobTarget, setManualLocalJobTarget] = useState(null);
  const [localExportAttemptedJobId, setLocalExportAttemptedJobId] = useState(null);
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
  const [savedSchedule, setSavedSchedule] = useState(null);
  const [showSavedSchedule, setShowSavedSchedule] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState("");

  useEffect(() => () => {
    if (localProgressRenderTimerRef.current !== null) {
      clearTimeout(localProgressRenderTimerRef.current);
    }
  }, []);

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
      setSavedSchedule(schedule);
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
        setSavedSchedule(scheduleResponse.data.schedule);
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

  const destinationMatchesTest = manualDestinationType === "mac-local"
    ? testedManualDestination?.mode === "mac-local" &&
      testedManualDestination.handle === manualLocalFolder?.handle
    : testedManualDestination?.mode === "server" &&
      testedManualDestination.path === manualServerPath.trim();

  const testManualDestination = async () => {
    setBusy(true);
    setPageError("");
    setTestedManualDestination(null);
    setPlan(null);
    if (manualDestinationType === "server") {
      const selectedPath = manualServerPath.trim();
      if (!selectedPath) {
        setPageError("Enter or browse to a destination folder on the backup server before testing.");
        setBusy(false);
        return;
      }
      try {
        const response = await request("post", "/test-connection", { path: selectedPath });
        const drive = response.data?.drives?.[0];
        if (!drive) throw new Error("The backup server returned no destination information.");
        setTestedManualDestination({ mode: "server", path: selectedPath, drive });
        toast.success("Backup-server destination tested and writable.");
      } catch (error) {
        setPageError(error.response?.data?.error || error.message || "Could not test the backup-server destination.");
      } finally {
        setBusy(false);
      }
      return;
    }

    const directory = manualLocalFolder?.handle;
    if (!directory) {
      setPageError("Browse and select a folder on this computer before testing the destination.");
      setBusy(false);
      return;
    }
    let fileHandle;
    let fileName;
    try {
      const permission = await directory.queryPermission({ mode: "readwrite" });
      const granted = permission === "granted"
        ? permission
        : await directory.requestPermission({ mode: "readwrite" });
      if (granted !== "granted") throw new Error("Read/write permission for the selected folder was not granted.");
      fileName = `.gfx-backup-write-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      fileHandle = await directory.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write("GFX Backup write test");
      await writable.close();
      if (await (await fileHandle.getFile()).text() !== "GFX Backup write test") {
        throw new Error("The selected folder did not return the test file contents.");
      }
      await directory.removeEntry(fileName);
      fileHandle = null;
      setTestedManualDestination({ mode: "mac-local", handle: directory });
      toast.success("Selected folder tested and writable.");
    } catch (error) {
      if (fileHandle) await directory.removeEntry(fileName).catch(() => {});
      setPageError(error.message || "Could not test read/write access to the selected folder.");
    } finally {
      setBusy(false);
    }
  };

  const buildPlan = async () => {
    if (!destinationMatchesTest) {
      setPageError("Test the currently selected backup destination successfully before building its plan.");
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
        ...(manualDestinationType === "mac-local"
          ? { destinationMode: "mac-local" }
          : { destinationMode: "server", destinations: [manualServerPath.trim()] })
      });
      if (!response.data?.ready) {
        setPageError(`Backup plan validation failed: ${(response.data?.issues || []).join(" ") || "The selected backup does not fit the safe capacity plan."}`);
        return;
      }
      setPlan(response.data);
    } catch (error) {
      setSourceError("");
      setPageError(error.response?.data?.error || error.message || "Backup preflight failed.");
    } finally {
      setBusy(false);
    }
  };

  const startBackup = async () => {
    if (job?.status === "RUNNING" || categories.length === 0) return;
    if (!destinationMatchesTest || !plan?.ready) {
      setPageError("Test the selected destination and build a safe backup plan before starting.");
      return;
    }
    setBusy(true);
    setPageError("");
    try {
      const freshSources = await refreshSources();
      if (!freshSources) throw new Error("Current backup source sizes could not be refreshed.");
      const refreshedPlanResponse = await request("post", "/plan", {
        categories,
        ...(manualDestinationType === "mac-local"
          ? { destinationMode: "mac-local" }
          : { destinationMode: "server", destinations: [manualServerPath.trim()] })
      });
      const freshPlan = refreshedPlanResponse.data;
      setPlan(freshPlan);
      if (!freshPlan?.ready) {
        setPlan(null);
        setPageError(`Backup plan validation failed: ${(freshPlan?.issues || []).join(" ") || "The current complete backup does not fit safely."}`);
        return;
      }
      const response = await request("post", "/start", {
        categories,
        ...(manualDestinationType === "mac-local"
          ? { destinationMode: "mac-local" }
          : { destinationMode: "server", destinations: [manualServerPath.trim()] })
      });
      setJob(response.data);
      setManualLocalJobTarget(manualDestinationType === "mac-local"
        ? { jobId: response.data.id, destination: testedManualDestination }
        : null);
      setLocalExportAttemptedJobId(null);
      setLocalExportComplete(false);
      if (manualDestinationType === "mac-local") {
        const initialExportProgress = {
          status: "PREPARING",
          bytesTransferred: 0,
          totalBytes: null,
          bytesRemaining: null,
          speedBytesPerSecond: null,
          etaSeconds: null,
          currentFile: null,
          filesCompleted: 0,
          totalFiles: null,
          components: []
        };
        localExportProgressRef.current = initialExportProgress;
        lastLocalProgressRenderRef.current = 0;
        setLocalExportProgress(initialExportProgress);
      } else {
        localExportProgressRef.current = null;
        setLocalExportProgress(null);
      }
      await refreshHistory();
      toast.info(manualDestinationType === "mac-local"
        ? "The server is preparing a verified manual backup for the selected computer folder."
        : "The backup server is writing a verified manual backup to the tested server folder.");
    } catch (error) {
      setSourceError("");
      const message = error.response?.data?.error || "Backup could not be started.";
      setPageError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const browseManualServerPath = async (selectedPath = "") => {
    setBusy(true);
    setPageError("");
    try {
      const query = selectedPath ? `?path=${encodeURIComponent(selectedPath)}` : "";
      const response = await request("get", `/browse${query}`);
      setManualServerBrowse(response.data);
    } catch (error) {
      setPageError(error.response?.data?.error || "Could not browse the backup server folders.");
      setManualServerBrowse(null);
    } finally {
      setBusy(false);
    }
  };

  const browseAutomaticServerPath = async (selectedPath = "") => {
    setBusy(true);
    setScheduleMessage("");
    try {
      const query = selectedPath ? `?path=${encodeURIComponent(selectedPath)}` : "";
      const response = await request("get", `/automatic/browse${query}`);
      setAutomaticServerBrowse(response.data);
    } catch (error) {
      setScheduleMessage(error.response?.data?.error || "Could not browse the server-managed automatic backup folders.");
      setAutomaticServerBrowse(null);
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
      const saved = response.data?.schedule || automaticSchedule;
      setAutomaticSchedule(saved);
      setSavedSchedule(saved);
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

  const pickLocalFolder = async () => {
    if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") {
      const message = "Local folder selection is unavailable in this browser or context. Use a supported browser in a secure context.";
      setPageError(message);
      return;
    }

    try {
      const directory = await window.showDirectoryPicker({ mode: "readwrite" });
      setManualLocalFolder({ name: directory.name, handle: directory });
      setTestedManualDestination(null);
      setPlan(null);
      setPageError("");
      setLocalExportComplete(false);
    } catch (error) {
      if (error?.name === "AbortError") return;
      const message = "Could not select a local folder. Check browser permissions and try again.";
      setPageError(message);
    }
  };

  const transferBackupToMac = async (exportJob = job, testedDestination = testedManualDestination) => {
    const directory = testedDestination?.mode === "mac-local" ? testedDestination.handle : null;
    if (
      !directory ||
      exportJob?.backupType !== "MANUAL" ||
      exportJob?.clientExport !== true ||
      exportJob?.status !== "SUCCESS" ||
      exportJob?.verificationStatus !== "VERIFIED"
    ) {
      setPageError("A tested Mac folder and a completed, verified manual backup are required.");
      return;
    }
    setLocalExportBusy(true);
    setPageError("");
    setLocalExportComplete(false);
    let stagingParent = null;
    let createdSetName = null;
    let transferStartedAt = null;
    let transferredBytes = 0;
    let completedFiles = 0;
    const publishProgress = (progress, force = false) => {
      localExportProgressRef.current = progress;
      const now = Date.now();
      const elapsed = now - lastLocalProgressRenderRef.current;
      if (force || elapsed >= 250) {
        if (localProgressRenderTimerRef.current !== null) {
          clearTimeout(localProgressRenderTimerRef.current);
          localProgressRenderTimerRef.current = null;
        }
        lastLocalProgressRenderRef.current = now;
        setLocalExportProgress(progress);
      } else if (localProgressRenderTimerRef.current === null) {
        localProgressRenderTimerRef.current = setTimeout(() => {
          localProgressRenderTimerRef.current = null;
          lastLocalProgressRenderRef.current = Date.now();
          setLocalExportProgress(localExportProgressRef.current);
        }, 250 - elapsed);
      }
    };
    try {
      publishProgress({
        status: "PREPARING",
        bytesTransferred: 0,
        totalBytes: null,
        bytesRemaining: null,
        speedBytesPerSecond: null,
        etaSeconds: null,
        currentFile: "Checking Mac folder permission",
        filesCompleted: 0,
        totalFiles: null,
        components: []
      }, true);
      const permission = await directory.queryPermission({ mode: "readwrite" });
      const granted = permission === "granted"
        ? permission
        : await directory.requestPermission({ mode: "readwrite" });
      if (granted !== "granted") throw new Error("Read/write permission expired or was not granted for the selected Mac folder.");

      const token = getAuthToken();
      publishProgress({ ...localExportProgressRef.current, currentFile: "Loading verified export file list" }, true);
      const exportResponse = await request("get", `/jobs/${encodeURIComponent(exportJob.id)}/export`);
      const files = exportResponse.data?.files;
      if (!Array.isArray(files) || files.length < 3) throw new Error("The verified backup is missing its manifest, checksums, or backup data.");
      const fileByPath = new Map(files.map((file) => [String(file.path || ""), file]));
      if (fileByPath.size !== files.length || !fileByPath.has("manifest.json") || !fileByPath.has("checksums.sha256")) {
        throw new Error("The verified backup has an invalid or incomplete file list.");
      }
      const totalBytes = files.reduce((total, file) => {
        const size = Number(file.sizeBytes);
        if (!Number.isSafeInteger(size) || size < 0) {
          throw new Error(`The server returned an invalid size for ${file.path || "a backup file"}.`);
        }
        const nextTotal = total + size;
        if (!Number.isSafeInteger(nextTotal)) {
          throw new Error("The server returned a backup whose total size cannot be measured safely.");
        }
        return nextTotal;
      }, 0);
      const selectedTypes = exportJob.selectedTypes || [];
      const componentProgress = LOCAL_EXPORT_COMPONENTS.map((component) => {
          const componentFiles = files.filter((file) => String(file.path || "").startsWith(`${component.directory}/`));
          const selected = component.key === "originalAssets" || component.key === "thumbnails"
            ? selectedTypes.includes("assetsAndThumbnails")
            : selectedTypes.includes(component.key);
          return {
            ...component,
            selected,
            totalBytes: componentFiles.reduce((total, file) => total + Number(file.sizeBytes), 0),
            bytesTransferred: 0,
            totalFiles: componentFiles.length,
            filesCompleted: 0,
            status: selected ? componentFiles.length === 0 ? "COMPLETE" : "PENDING" : "NOT_SELECTED"
          };
        });
      publishProgress({
        status: "PREPARING",
        bytesTransferred: 0,
        totalBytes,
        bytesRemaining: totalBytes,
        speedBytesPerSecond: null,
        etaSeconds: null,
        currentFile: "Preparing selected folder",
        filesCompleted: 0,
        totalFiles: files.length,
        components: componentProgress
      }, true);

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

      const orderedFiles = [
        fileByPath.get("checksums.sha256"),
        ...files.filter((file) => !["checksums.sha256", "manifest.json"].includes(file.path)),
        fileByPath.get("manifest.json")
      ];
      let expectedChecksums = null;
      for (const [index, file] of orderedFiles.entries()) {
        publishProgress({
          ...localExportProgressRef.current,
          status: transferredBytes > 0 ? "TRANSFERRING" : "PREPARING",
          currentFile: file.path
        }, true);
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
        if (!response.ok || !response.body?.getReader) {
          throw new Error(response.ok
            ? "Readable streaming is not supported by this browser; no file bytes were written."
            : `The server could not transfer ${file.path}.`);
        }
        const writable = await fileHandle.createWritable();
        const writer = writable.getWriter();
        const reader = response.body.getReader();
        const component = componentProgress.find(({ directory: prefix }) => file.path.startsWith(`${prefix}/`));
        let currentFileBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writer.write(value);
            if (transferStartedAt === null) transferStartedAt = Date.now();
            currentFileBytes += value.byteLength;
            transferredBytes += value.byteLength;
            if (component) component.bytesTransferred += value.byteLength;
            const elapsedSeconds = (Date.now() - transferStartedAt) / 1000;
            const speedBytesPerSecond = elapsedSeconds >= 0.5
              ? Math.round(transferredBytes / elapsedSeconds)
              : null;
            const bytesRemaining = Math.max(0, totalBytes - transferredBytes);
            publishProgress({
              status: "TRANSFERRING",
              bytesTransferred: transferredBytes,
              totalBytes,
              bytesRemaining,
              speedBytesPerSecond,
              etaSeconds: speedBytesPerSecond > 0 ? Math.ceil(bytesRemaining / speedBytesPerSecond) : null,
              currentFile: file.path,
              currentFileBytes,
              currentFileSize: Number(file.sizeBytes),
              filesCompleted: completedFiles,
              totalFiles: files.length,
              components: componentProgress.map((item) => ({
                ...item,
                status: !item.selected
                  ? "NOT_SELECTED"
                  : item.filesCompleted === item.totalFiles
                  ? "COMPLETE"
                  : item.bytesTransferred > 0
                    ? "TRANSFERRING"
                    : "PENDING"
              }))
            });
          }
          await writer.close();
        } catch (error) {
          await reader.cancel(error).catch(() => {});
          await writer.abort().catch(() => {});
          throw error;
        } finally {
          reader.releaseLock();
          writer.releaseLock();
        }
        const writtenFile = await fileHandle.getFile();
        if (writtenFile.size !== Number(file.sizeBytes)) {
          throw new Error(`Transferred file size did not match the verified server copy: ${file.path}`);
        }
        publishProgress({
          ...localExportProgressRef.current,
          status: "VERIFYING",
          currentFile: file.path,
          currentFileBytes: writtenFile.size,
          currentFileSize: Number(file.sizeBytes)
        }, true);
        if (file.path === "checksums.sha256") {
          expectedChecksums = new Map();
          const lines = (await writtenFile.text()).split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            const match = /^([a-f0-9]{64})\s+(\d+)\s+(.+)$/i.exec(line);
            if (!match || expectedChecksums.has(match[3])) {
              throw new Error("The backup checksum file is malformed or contains duplicate paths.");
            }
            expectedChecksums.set(match[3], { sha256: match[1].toLowerCase(), sizeBytes: Number(match[2]) });
          }
          const payloadFiles = files.filter((candidate) => !["checksums.sha256", "manifest.json"].includes(candidate.path));
          if (!expectedChecksums.size || expectedChecksums.size !== payloadFiles.length) {
            throw new Error("The backup checksum list does not match its payload files.");
          }
          for (const payload of payloadFiles) {
            if (!expectedChecksums.has(payload.path) || expectedChecksums.get(payload.path).sizeBytes !== Number(payload.sizeBytes)) {
              throw new Error(`The backup checksum list is missing or mismatches ${payload.path}.`);
            }
          }
        } else if (file.path !== "manifest.json") {
          const expected = expectedChecksums?.get(file.path);
          if (!expected) throw new Error(`No verified checksum was provided for ${file.path}.`);
          const actualSha256 = await sha256ReadableStream(writtenFile.stream());
          if (actualSha256 !== expected.sha256) {
            throw new Error(`Transferred file checksum did not match the verified server copy: ${file.path}`);
          }
        } else {
          let manifest;
          try {
            manifest = JSON.parse(await writtenFile.text());
          } catch (_error) {
            throw new Error("The transferred backup manifest is not valid JSON.");
          }
          if (
            manifest.format !== "GFXUNLIMIT-BACKUP-SET" ||
            manifest.backupSetId !== exportJob.id ||
            manifest.backupType !== "MANUAL" ||
            manifest.status !== "SUCCESS" ||
            manifest.verificationStatus !== "VERIFIED" ||
            !Array.isArray(manifest.selectedTypes) ||
            !manifest.totals ||
            manifest.totals.files !== expectedChecksums?.size
          ) {
            throw new Error("The transferred backup manifest does not describe this verified manual backup.");
          }
        }
        completedFiles += 1;
        if (component) component.filesCompleted += 1;
        publishProgress({
          ...localExportProgressRef.current,
          status: index === orderedFiles.length - 1 ? "VERIFYING" : "TRANSFERRING",
          bytesTransferred: transferredBytes,
          bytesRemaining: Math.max(0, totalBytes - transferredBytes),
          filesCompleted: completedFiles,
          totalFiles: files.length,
          components: componentProgress.map((item) => ({
            ...item,
            status: !item.selected
              ? "NOT_SELECTED"
              : item.filesCompleted === item.totalFiles
              ? "COMPLETE"
              : item.bytesTransferred > 0
                ? "TRANSFERRING"
                : "PENDING"
          }))
        }, true);
      }

      publishProgress({
        ...localExportProgressRef.current,
        status: "COMPLETE",
        bytesTransferred: totalBytes,
        bytesRemaining: 0,
        speedBytesPerSecond: transferredBytes > 0 && transferStartedAt !== null
          ? Math.round(transferredBytes / Math.max(0.001, (Date.now() - transferStartedAt) / 1000))
          : null,
        etaSeconds: 0,
        currentFile: "Manifest, file sizes, and SHA-256 checksums verified",
        filesCompleted: files.length,
        components: componentProgress.map((item) => ({
          ...item,
          status: item.selected ? "COMPLETE" : "NOT_SELECTED"
        }))
      }, true);
      setLocalExportComplete(true);
      toast.success("The manual backup was copied to the tested Mac folder and its checksums were verified.");
      try {
        await request("delete", `/jobs/${encodeURIComponent(exportJob.id)}/export`);
      } catch (error) {
        setPageError("The Mac copy is verified, but temporary server staging could not be removed. Contact the administrator to reclaim that space.");
      }
    } catch (error) {
      const message = error.response?.data?.error || error.message || "The backup could not be transferred to this Mac.";
      publishProgress({
        ...(localExportProgressRef.current || {}),
        status: "FAILED",
        currentFile: localExportProgressRef.current?.currentFile || "Transfer failed"
      }, true);
      if (stagingParent && createdSetName) {
        try {
          await stagingParent.removeEntry(createdSetName, { recursive: true });
        } catch (cleanupError) {
          setPageError(`${message} The incomplete Mac folder could not be removed; delete Backup-Set-${exportJob.id} before retrying.`);
          return;
        }
      }
      setPageError(message);
    } finally {
      setLocalExportBusy(false);
    }
  };

  useEffect(() => {
    if (
      job?.backupType === "MANUAL" &&
      job.clientExport === true &&
      job.status === "SUCCESS" &&
      job.verificationStatus === "VERIFIED" &&
      manualLocalJobTarget?.jobId === job.id &&
      localExportAttemptedJobId !== job.id
    ) {
      setLocalExportAttemptedJobId(job.id);
      void transferBackupToMac(job, manualLocalJobTarget.destination);
    }
  }, [job, localExportAttemptedJobId, manualLocalJobTarget, transferBackupToMac]);

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
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <fieldset style={{ display: "flex", flexWrap: "wrap", gap: 14, border: `1px solid ${palette.border}`, borderRadius: 9, padding: 10 }}>
              <legend style={{ fontSize: 13, fontWeight: 700 }}>Manual destination type</legend>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="manual-destination-type"
                  checked={manualDestinationType === "mac-local"}
                  disabled={busy || activeJob || localExportBusy}
                  onChange={() => {
                    setManualDestinationType("mac-local");
                    setTestedManualDestination(null);
                    setPlan(null);
                    setPageError("");
                  }}
                />
                This computer
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="manual-destination-type"
                  checked={manualDestinationType === "server"}
                  disabled={busy || activeJob || localExportBusy}
                  onChange={() => {
                    setManualDestinationType("server");
                    setTestedManualDestination(null);
                    setPlan(null);
                    setPageError("");
                  }}
                />
                Backup server
              </label>
            </fieldset>
            {manualDestinationType === "mac-local" ? (
            <>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setManualDestinationType("mac-local");
                  setTestedManualDestination(null);
                  setPlan(null);
                  setPageError("");
                  pickLocalFolder();
                }}
                disabled={busy || activeJob || localExportBusy}
                style={buttonStyle()}
              >
                Browse this computer
              </button>
            </div>
            <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
              Selected folder
              <input
                aria-label="Selected folder"
                value={manualLocalFolder?.name || ""}
                readOnly
                placeholder="No folder selected"
                style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", border: `1px solid ${palette.border}`, borderRadius: 9, background: palette.panel, color: palette.text }}
              />
            </label>
            <small style={{ color: palette.muted }}>
              {manualLocalFolder?.name
                ? "This is the folder name provided by the browser. Browsers do not reveal the absolute local path; the server stages the verified backup, then the browser copies it into this folder."
                : "Browse and select a folder on this computer. The browser will test that exact folder before backup planning can continue."}
            </small>
            </>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
                  Selected server folder
                  <input
                    aria-label="Selected server folder"
                    value={manualServerPath}
                    onChange={(event) => {
                      setManualServerPath(event.target.value);
                      setTestedManualDestination(null);
                      setPlan(null);
                      setPageError("");
                    }}
                    disabled={busy || activeJob || localExportBusy}
                    placeholder="Browse or enter a path accessible to the backup server"
                    style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", border: `1px solid ${palette.border}`, borderRadius: 9, background: palette.panel, color: palette.text }}
                  />
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button type="button" onClick={() => browseManualServerPath()} disabled={busy || activeJob || localExportBusy} style={buttonStyle()}>
                    Browse server folders
                  </button>
                  {manualServerBrowse?.currentPath && (
                    <button type="button" onClick={() => {
                      setManualServerPath(manualServerBrowse.currentPath);
                      setTestedManualDestination(null);
                      setPlan(null);
                      setPageError("");
                    }} disabled={busy || activeJob || localExportBusy} style={buttonStyle()}>
                      Use this server folder
                    </button>
                  )}
                </div>
                {manualServerBrowse && (
                  <div style={{ display: "grid", gap: 6, padding: 10, border: `1px solid ${palette.border}`, borderRadius: 9, background: palette.panel }}>
                    {manualServerBrowse.currentPath
                      ? <strong>Server location: {manualServerBrowse.currentPath}</strong>
                      : <strong>Available server drives</strong>}
                    {manualServerBrowse.parentPath && (
                      <button type="button" onClick={() => browseManualServerPath(manualServerBrowse.parentPath)} disabled={busy} style={buttonStyle()}>
                        Up one folder
                      </button>
                    )}
                    {manualServerBrowse.directories?.map((directory) => (
                      <button key={directory.path} type="button" onClick={() => browseManualServerPath(directory.path)} disabled={busy} style={{ ...buttonStyle(), textAlign: "left" }}>
                        {directory.name}
                      </button>
                    ))}
                    {!manualServerBrowse.directories?.length && <small>No child folders found in this location.</small>}
                  </div>
                )}
                <small style={{ color: palette.muted }}>
                  This path is tested and used by the backup server. It is not a path on this computer.
                </small>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <button type="button" onClick={testManualDestination} disabled={busy || activeJob || localExportBusy} style={buttonStyle()}>
                Test Connection
              </button>
              {destinationMatchesTest && <span role="status" style={{ color: "#15803d" }}>Selected destination tested successfully.</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
          <button type="button" onClick={buildPlan} disabled={!destinationMatchesTest || busy || activeJob || categories.length === 0} style={buttonStyle()}>
            Build Complete Backup Plan
          </button>
        </div>
      </section>

      {plan && (
        <section className="gfx-backup-section gfx-backup-plan" style={sectionStyle} aria-label="Backup plan">
          <div>
            <h3 style={{ margin: "0 0 6px" }}>Pre-backup plan</h3>
            <p style={{ margin: 0, color: palette.muted }}>
              {manualDestinationType === "mac-local"
                ? "The server will stage a verified backup set temporarily, then stream its unchanged files into the selected computer folder."
                : "The backup server will write the verified backup set to the tested server folder."}
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
            {categories.includes("database") && plan.database?.sourceServer && (
              <span>Database source: <strong>{plan.database.sourceServer} · {plan.database.name}</strong></span>
            )}
            {categories.includes("assetsAndThumbnails") && plan.sourceRoots && (
              <>
                <span>Original asset source: <strong>{plan.sourceRoots.originalAssets || "Unavailable"}</strong></span>
                <span>Thumbnail source: <strong>{plan.sourceRoots.thumbnails || "Unavailable"}</strong></span>
              </>
            )}
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
            {busy ? "Starting..." : "Start Manual Backup"}
          </button>
        </section>
      )}

      {pageError && <div role="alert" style={{ padding: 12, borderRadius: 10, color: "#991b1b", background: isDarkMode ? "#451a1a" : "#fef2f2" }}>{pageError}</div>}

      {job && (
        <section className="gfx-backup-section gfx-backup-progress" style={sectionStyle} aria-label="Backup job progress">
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12 }}>
            <div>
              <span className="gfx-backup-kicker">{job.backupType === "AUTOMATIC" ? "AUTOMATIC BACKUP RUN" : "MANUAL BACKUP RUN"}</span>
              <h3 style={{ margin: "5px 0" }}>{job.clientExport === true && job.status === "SUCCESS" && job.verificationStatus === "VERIFIED"
                ? localExportComplete
                  ? "Manual backup copied and verified"
                  : localExportAttemptedJobId === job.id && pageError
                    ? "Local copy failed; verified server staging retained"
                    : "Server backup verified; copying to selected folder"
                : job.status === "SUCCESS" && job.verificationStatus === "VERIFIED"
                  ? "Backup completed and verified"
                  : job.status === "FAILED" || job.verificationStatus === "FAILED"
                    ? "Backup failed"
                    : `Backup Progress — ${Number(job.progress?.percent || 0).toFixed(1)}%`}</h3>
              <span style={{ color: palette.muted }}>Set ID: {job.id}</span>
            </div>
            <strong style={{ color: statusColor(job.status) }}>{job.status} · {job.verificationStatus}</strong>
          </div>
          {job.backupType === "MANUAL" && job.clientExport === true && job.status === "SUCCESS" && job.verificationStatus === "VERIFIED" && (
            <div style={{ display: "grid", gap: 8 }}>
              <p style={{ margin: 0, color: palette.muted }}>
                The server-side backup is verified and ready to transfer to this computer. The server copy remains staged until transfer completes.
              </p>
              <button
                type="button"
                onClick={() => transferBackupToMac(job)}
                disabled={localExportBusy || localExportComplete || !testedManualDestination?.handle}
                style={buttonStyle(true)}
              >
                {localExportBusy ? "Transferring to this computer..." : localExportComplete ? "Transferred to this computer" : "Transfer verified backup to this computer"}
              </button>
            </div>
          )}
          {job.backupType === "MANUAL" && job.clientExport === true && localExportProgress && (
            <div aria-label="Mac-local transfer progress" style={{ display: "grid", gap: 10, padding: 12, border: `1px solid ${palette.border}`, borderRadius: 10, background: palette.panel }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
                <strong>
                  {localExportProgress.status === "PREPARING" ? "Preparing Mac-local transfer" :
                    localExportProgress.status === "TRANSFERRING" ? "Transferring to this computer" :
                      localExportProgress.status === "VERIFYING" ? "Verifying Mac-local files" :
                        localExportProgress.status === "COMPLETE" ? "Mac-local copy complete and verified" : "Mac-local transfer failed"}
                </strong>
                <span>{localExportProgress.totalBytes == null
                  ? "Mac bytes written: 0 (transfer has not started)"
                  : `${formatBytes(localExportProgress.bytesTransferred)} / ${formatBytes(localExportProgress.totalBytes)} written`}</span>
              </div>
              {localExportProgress.totalBytes != null && (
                <div role="progressbar" aria-label="Mac-local bytes written" aria-valuenow={localExportProgress.totalBytes > 0
                  ? Math.min(100, (localExportProgress.bytesTransferred / localExportProgress.totalBytes) * 100)
                  : localExportProgress.status === "COMPLETE" ? 100 : 0} aria-valuemin={0} aria-valuemax={100}
                >
                  <span style={{
                    display: "block",
                    height: 10,
                    borderRadius: 99,
                    background: "linear-gradient(90deg, #ed2224, #f97316)",
                    width: `${localExportProgress.totalBytes > 0
                      ? Math.min(100, (localExportProgress.bytesTransferred / localExportProgress.totalBytes) * 100)
                      : localExportProgress.status === "COMPLETE" ? 100 : 0}%`
                  }} />
                </div>
              )}
              <div className="gfx-backup-progress-metrics">
                <span>Bytes remaining <strong>{localExportProgress.bytesRemaining == null ? "Not measured yet" : formatBytes(localExportProgress.bytesRemaining)}</strong></span>
                <span>Transfer speed <strong>{localExportProgress.speedBytesPerSecond == null ? "Measuring…" : `${formatBytes(localExportProgress.speedBytesPerSecond)}/s`}</strong></span>
                <span>Estimated remaining <strong>{localExportProgress.etaSeconds == null ? "Not available yet" : formatDuration(localExportProgress.etaSeconds)}</strong></span>
                <span>Files written and verified <strong>{localExportProgress.totalFiles == null
                  ? "Not measured yet"
                  : `${localExportProgress.filesCompleted} / ${localExportProgress.totalFiles} · ${Math.max(0, localExportProgress.totalFiles - localExportProgress.filesCompleted)} pending`}</strong></span>
              </div>
              <span style={{ color: palette.muted, overflowWrap: "anywhere" }}>
                Current file/component: {localExportProgress.currentFile || "Waiting for server-side backup verification"}
                {localExportProgress.currentFileSize != null && ` · ${formatBytes(localExportProgress.currentFileBytes || 0)} / ${formatBytes(localExportProgress.currentFileSize)}`}
              </span>
              {localExportProgress.components?.length > 0 && (
                <div className="gfx-backup-subprogress-grid" aria-label="Mac-local component progress">
                  {localExportProgress.components.map((component) => (
                    <div className="gfx-backup-subprogress" key={component.key}>
                      <div className="gfx-backup-progress-label">
                        <strong>{component.label}</strong>
                        <span>{component.status === "NOT_SELECTED" ? "Not selected" :
                          component.status === "COMPLETE" ? "Complete" :
                            component.status === "TRANSFERRING" ? "Transferring" :
                              component.status === "VERIFYING" ? "Verifying" : "Pending"}</span>
                      </div>
                      <small>
                        {component.selected
                          ? `${formatBytes(component.bytesTransferred)} / ${formatBytes(component.totalBytes)} written · ${component.filesCompleted} / ${component.totalFiles} files · ${Math.max(0, component.totalFiles - component.filesCompleted)} pending`
                          : "Not included in this backup"}
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {(job.status === "RUNNING" || job.status === "SUCCESS") && (
            <>
              <div className="gfx-backup-overall-progress">
                <div className="gfx-backup-progress-label">
                  <strong>{job.clientExport === true ? "Server staging progress (not yet written to this computer)" : "Overall backup progress"}</strong>
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
                  <strong>{job.clientExport === true && !localExportComplete
                    ? localExportBusy ? "Server staging verified; copying and checking files on this Mac…" : "Server staging verified; local copy not yet verified"
                    : job.verificationStatus === "VERIFIED" ? "Backup completed and verified" : job.progress?.stage === "COPY_VERIFYING" ? "Verifying current file…" : job.progress?.stage === "FINALIZING" ? "Finalizing verified backup…" : "Verifying backup…"}</strong>
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
                    disabled={localExportBusy || !testedManualDestination?.handle}
                    style={buttonStyle()}
                  >
                    Transfer to this computer
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
            Automatic backups run on the server and can write only to a tested server-managed path.
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
            <button type="button" onClick={() => browseAutomaticServerPath()} disabled={busy || activeJob} style={buttonStyle()}>
              Browse server folders
            </button>
            <button type="button" onClick={testAutomaticDestination} disabled={busy || activeJob || !automaticDestination} style={buttonStyle()}>Test Connection</button>
          </div>
          {automaticServerBrowse && (
            <div style={{ display: "grid", gap: 6, padding: 10, border: `1px solid ${palette.border}`, borderRadius: 9, background: palette.panel }}>
              {automaticServerBrowse.currentPath
                ? <strong>Server location: {automaticServerBrowse.currentPath}</strong>
                : <strong>Available server drives</strong>}
              {automaticServerBrowse.parentPath && (
                <button type="button" onClick={() => browseAutomaticServerPath(automaticServerBrowse.parentPath)} disabled={busy} style={buttonStyle()}>
                  Up one folder
                </button>
              )}
              {automaticServerBrowse.directories?.map((directory) => (
                <button key={directory.path} type="button" onClick={() => browseAutomaticServerPath(directory.path)} disabled={busy} style={{ ...buttonStyle(), textAlign: "left" }}>
                  {directory.name}
                </button>
              ))}
              {automaticServerBrowse.currentPath && (
                <button type="button" onClick={() => {
                  setAutomaticDestination(automaticServerBrowse.currentPath);
                  setAutomaticDrive(null);
                  setAutomaticPlan(null);
                  setScheduleMessage("");
                }} disabled={busy || activeJob} style={buttonStyle()}>
                  Use this server folder
                </button>
              )}
              {!automaticServerBrowse.directories?.length && <small>No child folders found in this location.</small>}
            </div>
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
        <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
          <button className="gfx-backup-primary" type="button" onClick={saveSchedule} disabled={busy || activeJob || automaticSchedule.selectedTypes.length === 0} style={{ ...buttonStyle(true), width: "fit-content" }}>Save Schedule</button>
          <button
            type="button"
            aria-expanded={showSavedSchedule}
            aria-haspopup="dialog"
            onClick={() => setShowSavedSchedule((visible) => !visible)}
            style={buttonStyle()}
          >
            Saved Schedule
          </button>
        </div>
      </section>
      {showSavedSchedule && (
        <div
          onClick={() => setShowSavedSchedule(false)}
          style={{ position: "fixed", inset: 0, zIndex: 1400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(15, 23, 42, 0.65)" }}
        >
          <section
            id="saved-schedule-details"
            role="dialog"
            aria-modal="true"
            aria-labelledby="saved-schedule-title"
            onClick={(event) => event.stopPropagation()}
            style={{ width: "min(720px, 100%)", maxHeight: "85vh", overflowY: "auto", display: "grid", gap: 14, padding: 20, border: `1px solid ${palette.border}`, borderRadius: 14, background: palette.surface, color: palette.text, boxShadow: "0 24px 60px rgba(15, 23, 42, 0.35)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <h3 id="saved-schedule-title" style={{ margin: 0 }}>Saved Automatic Backup Schedule</h3>
              <button type="button" aria-label="Close saved schedules" onClick={() => setShowSavedSchedule(false)} style={buttonStyle()}>Close</button>
            </div>
            {!savedSchedule ? (
              <p style={{ color: palette.muted, margin: 0 }}>Live saved schedules are unavailable until the schedule has loaded.</p>
            ) : !savedSchedule.enabled ? (
              <p style={{ color: palette.muted, margin: 0 }}>There are no live automatic backup schedules.</p>
            ) : (
              <div style={{ display: "grid", gap: 8, padding: 12, border: `1px solid ${palette.border}`, borderRadius: 9, background: palette.panel }}>
                <strong>Live automatic schedule</strong>
                <span>Server destination: <strong style={{ overflowWrap: "anywhere" }}>{savedSchedule.destination || "Not configured"}</strong></span>
                <span>Backup types: <strong>{(savedSchedule.selectedTypes || []).map((key) => BACKUP_CATEGORIES.find((item) => item.key === key)?.title || key).join(", ") || "None"}</strong></span>
                <span>Frequency: <strong>{savedSchedule.frequency || "Unavailable"}</strong></span>
                <span>Configured time: <strong>{formatScheduleTime(savedSchedule.time)}</strong></span>
                <span>Next run: <strong>{formatScheduleDate(savedSchedule.nextRun)}</strong></span>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
