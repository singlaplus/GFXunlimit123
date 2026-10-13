import React, { useCallback, useEffect, useMemo, useState } from "react";

const HELPER_DEFAULT = "http://127.0.0.1:43127";
const INITIAL_CONFIGURATION = {
  sources: { databaseFile: "", websiteSource: "", assetsSource: "", thumbnailsSource: "" },
  destinations: { databaseName: "", websiteDestination: "", assetsDestination: "", thumbnailsDestination: "" }
};

const TASK_STATES = ["WAITING", "DOWNLOADING", "VERIFYING", "INSTALLING", "CONFIGURING", "VALIDATING", "TRANSFERRING", "COMPLETED", "SKIPPED", "FAILED", "CANCELLED"];

function taskColor(status) {
  if (status === "COMPLETED") return "#15803d";
  if (status === "FAILED" || status === "CANCELLED") return "#b91c1c";
  if (["DOWNLOADING", "VERIFYING", "INSTALLING", "CONFIGURING", "VALIDATING", "TRANSFERRING"].includes(status)) return "#1d4ed8";
  return "#64748b";
}

function timeLabel(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.floor(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function RestoreWizard({ apiBaseUrl }) {
  const [helperUrl, setHelperUrl] = useState(HELPER_DEFAULT);
  const [helperToken, setHelperToken] = useState("");
  const [configuration, setConfiguration] = useState(INITIAL_CONFIGURATION);
  const [manifestResult, setManifestResult] = useState(null);
  const [manifestError, setManifestError] = useState("");
  const [validation, setValidation] = useState(null);
  const [validationError, setValidationError] = useState("");
  const [step, setStep] = useState(1);
  const [confirmation, setConfirmation] = useState("");
  const [restoreAuthorized, setRestoreAuthorized] = useState(false);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);

  const api = useCallback(async (method, endpoint, body) => {
    const base = helperUrl.trim().replace(/\/+$/, "");
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) {
      throw new Error("Restore helper URL must be a loopback HTTP address, for example http://127.0.0.1:43127.");
    }
    if (helperToken.length < 32) throw new Error("Enter the local helper token (at least 32 characters).");
    const response = await fetch(`${base}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${helperToken}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Restore helper returned HTTP ${response.status}.`);
    return payload;
  }, [helperToken, helperUrl]);

  const loadManifest = useCallback(async () => {
    setBusy(true);
    setManifestError("");
    setManifestResult(null);
    try {
      const result = await api("GET", "/api/manifest");
      if (!result.manifest || !Array.isArray(result.manifest.software)) throw new Error("Restore helper returned an invalid manifest.");
      setManifestResult(result);
    } catch (error) {
      setManifestError(error.message || "Could not load a trusted restore manifest.");
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    if (helperToken.length >= 32 && !manifestResult && !manifestError) void loadManifest();
  }, [helperToken, manifestError, manifestResult, loadManifest]);

  const updatePath = (group, key, value) => {
    setConfiguration((previous) => ({
      ...previous,
      [group]: { ...previous[group], [key]: value }
    }));
    setValidation(null);
    setValidationError("");
  };

  const validate = async () => {
    setBusy(true);
    setValidationError("");
    setValidation(null);
    try {
      const result = await api("POST", "/api/validate", configuration);
      setValidation(result.validation);
      setStep(3);
    } catch (error) {
      setValidationError(error.message || "Restore sources and destinations failed validation.");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!validation) return;
    setBusy(true);
    setValidationError("");
    setJob(null);
    try {
      const result = await api("POST", "/api/start", { configuration, confirmation, restoreAuthorized });
      setJob(result.job);
      setStep(4);
    } catch (error) {
      setValidationError(error.message || "Restore could not be started.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!job?.id || !["WAITING", "RUNNING"].includes(job.status)) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const result = await api("GET", `/api/jobs/${encodeURIComponent(job.id)}`);
        if (active) setJob(result.job);
      } catch (error) {
        if (active) setValidationError(`Lost connection to the local restore helper: ${error.message}`);
      }
    };
    const timer = window.setInterval(poll, 1000);
    void poll();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, job?.id, job?.status]);

  const manifest = manifestResult?.manifest;
  const taskList = useMemo(() => [...(job?.softwareTasks || []), ...(job?.tasks || [])], [job]);
  const currentTask = taskList.find((task) => ["DOWNLOADING", "VERIFYING", "INSTALLING", "CONFIGURING", "VALIDATING", "TRANSFERRING"].includes(task.status));
  const confirmText = configuration.destinations.databaseName.trim()
    ? `RESTORE ${configuration.destinations.databaseName.trim()}`
    : "RESTORE <database>";
  const sourceFields = [
    ["databaseFile", "PostgreSQL .backup file", "file", "Path to Database/stocksite.backup"],
    ["websiteSource", "Website code + configuration source", "directory", "Path to the backed-up Website-Code directory"],
    ["assetsSource", "Original assets source directory", "directory", "Path to original assets"],
    ["thumbnailsSource", "Thumbnail source directory", "directory", "Path to permanent thumbnails"]
  ];
  const destinationFields = [
    ["databaseName", "PostgreSQL target database name", "Database must already exist and be empty"],
    ["websiteDestination", "Website code destination directory", "Must not already exist"],
    ["assetsDestination", "Original assets destination directory", "Must not already exist"],
    ["thumbnailsDestination", "Thumbnail destination directory", "Must not already exist"]
  ];

  const commonInput = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: "1px solid var(--backup-border)",
    borderRadius: 9,
    background: "var(--backup-card)",
    color: "var(--backup-ink)"
  };
  const card = {
    display: "grid",
    gap: 12,
    padding: 16,
    border: "1px solid var(--backup-border)",
    borderRadius: 14,
    background: "var(--backup-card)"
  };

  return (
    <section aria-label="Stocksite Restore Wizard" className="gfx-backup-section gfx-restore-wizard">
      <div className="gfx-backup-section-heading">
        <div>
          <span className="gfx-backup-kicker">RESTORE · STEP {step} OF 4</span>
          <h3>Stocksite Restore Wizard</h3>
          <p>Restore selected local sources only after path, archive, capacity, and target safety checks pass.</p>
        </div>
        {job && <span className="gfx-backup-measurement" role="status">Restore {job.status}</span>}
      </div>

      <div style={card}>
        <strong>Secure local restore helper</strong>
        <p style={{ margin: 0, color: "var(--backup-muted)", fontSize: 13 }}>
          Software installation, filesystem copying, and PostgreSQL restore require a helper running on this computer. The browser cannot access arbitrary local paths or execute commands.
        </p>
        <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
          Loopback helper URL
          <input aria-label="Restore helper URL" value={helperUrl} onChange={(event) => { setHelperUrl(event.target.value); setManifestResult(null); setManifestError(""); }} style={commonInput} />
        </label>
        <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
          Local helper token
          <input aria-label="Restore helper token" type="password" autoComplete="off" value={helperToken} onChange={(event) => { setHelperToken(event.target.value); setManifestResult(null); setManifestError(""); }} style={commonInput} />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" onClick={loadManifest} disabled={busy || helperToken.length < 32} style={{ padding: "9px 13px", border: 0, borderRadius: 9, color: "#fff", background: "#2563eb", fontWeight: 700, cursor: "pointer" }}>
            Load trusted software manifest
          </button>
          {manifestResult && <span role="status">{manifestResult.source === "signed-remote" ? "Latest signed remote manifest" : "Bundled fallback manifest"} · v{manifest.manifestVersion}</span>}
          {manifestError && <span role="alert" style={{ color: "#b91c1c" }}>{manifestError}</span>}
        </div>
        {manifestResult?.fallbackReason && <p style={{ margin: 0, color: "#92400e" }}>Fallback reason: {manifestResult.fallbackReason}</p>}
      </div>

      <nav aria-label="Restore wizard steps" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[["1", "Select sources"], ["2", "Select destinations"], ["3", "Review"], ["4", "Progress"]].map(([number, label]) => (
          <button key={number} type="button" aria-current={step === Number(number) ? "step" : undefined} onClick={() => setStep(Number(number))} style={{ padding: "8px 12px", border: "1px solid var(--backup-border)", borderRadius: 999, background: step === Number(number) ? "#dbeafe" : "var(--backup-card)", color: "var(--backup-ink)", fontWeight: 700 }}>
            {number}. {label}
          </button>
        ))}
      </nav>

      {step === 1 && (
        <div style={card}>
          <h4 style={{ margin: 0 }}>Step 1 — Select source files and folders</h4>
          <p style={{ margin: 0, color: "var(--backup-muted)", fontSize: 13 }}>
            Enter absolute Windows or macOS paths visible to the helper computer. Browsers do not reveal native paths selected by an ordinary file picker. For remote storage, first mount it locally or copy the data to a trusted local source.
          </p>
          {sourceFields.map(([key, label, kind, placeholder]) => (
            <label key={key} style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              {label}
              <input aria-label={label} type="text" autoCapitalize="off" spellCheck="false" placeholder={placeholder} value={configuration.sources[key]} onChange={(event) => updatePath("sources", key, event.target.value)} style={commonInput} />
              <small style={{ color: "var(--backup-muted)", fontWeight: 400 }}>{kind === "file" ? "Regular PostgreSQL custom-format .backup file" : "Local directory path"}</small>
            </label>
          ))}
          <button type="button" onClick={() => setStep(2)} disabled={!Object.values(configuration.sources).every(Boolean)} style={{ justifySelf: "end", padding: "10px 15px", border: 0, borderRadius: 9, color: "#fff", background: "#2563eb", fontWeight: 700 }}>Continue to destinations</button>
        </div>
      )}

      {step === 2 && (
        <div style={card}>
          <h4 style={{ margin: 0 }}>Step 2 — Select destination paths</h4>
          <p style={{ margin: 0, color: "var(--backup-muted)", fontSize: 13 }}>Directory destinations must be new paths; PostgreSQL must exist and be empty. The helper checks source readability, destination parent permissions, archive signature, and path overlap without changing data.</p>
          {destinationFields.map(([key, label, hint]) => (
            <label key={key} style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              {label}
              <input aria-label={label} type="text" autoCapitalize="off" spellCheck="false" value={configuration.destinations[key]} onChange={(event) => updatePath("destinations", key, event.target.value)} style={commonInput} />
              <small style={{ color: "var(--backup-muted)", fontWeight: 400 }}>{hint}</small>
            </label>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setStep(1)} style={{ padding: "10px 15px", border: "1px solid var(--backup-border)", borderRadius: 9, background: "var(--backup-card)", color: "var(--backup-ink)" }}>Back</button>
            <button type="button" onClick={validate} disabled={busy || !Object.values(configuration.destinations).every(Boolean)} style={{ padding: "10px 15px", border: 0, borderRadius: 9, color: "#fff", background: "#2563eb", fontWeight: 700 }}>
              {busy ? "Validating..." : "Validate paths and review"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={card}>
          <h4 style={{ margin: 0 }}>Step 3 — Review before restore</h4>
          {validation && (
            <>
              <p role="status" style={{ margin: 0, color: "#15803d" }}>Local path and archive checks passed at {new Date(validation.checkedAt).toLocaleString()}. Directory source bytes: website {validation.requiredBytes.website.toLocaleString()}, originals {validation.requiredBytes.assets.toLocaleString()}, thumbnails {validation.requiredBytes.thumbnails.toLocaleString()}.</p>
              <div style={{ display: "grid", gap: 8, overflowWrap: "anywhere" }}>
                {Object.entries(validation.sources).map(([key, value]) => <span key={key}>Source {key}: <strong>{value}</strong></span>)}
                {Object.entries(validation.destinations).map(([key, value]) => <span key={key}>Destination {key}: <strong>{value}</strong></span>)}
              </div>
            </>
          )}
          <p style={{ margin: 0, color: "#92400e" }}>Database restore writes to the selected database and is not automatically rolled back. A failed PostgreSQL restore may leave partial objects. The target must be a newly created, empty database.</p>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={restoreAuthorized} onChange={(event) => setRestoreAuthorized(event.target.checked)} />
            <span>I reviewed the source and destination paths and authorize the helper to install listed software, write new files, and restore the database.</span>
          </label>
          <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
            Type <code>{confirmText}</code> to confirm the database target
            <input aria-label="Restore confirmation phrase" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} style={commonInput} />
          </label>
          {validationError && <div role="alert" style={{ color: "#b91c1c" }}>{validationError}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setStep(2)} style={{ padding: "10px 15px", border: "1px solid var(--backup-border)", borderRadius: 9, background: "var(--backup-card)", color: "var(--backup-ink)" }}>Back</button>
            <button type="button" onClick={start} disabled={busy || !validation || !restoreAuthorized || confirmation !== confirmText || !manifest} style={{ padding: "10px 15px", border: 0, borderRadius: 9, color: "#fff", background: "#b91c1c", fontWeight: 700 }}>
              Start Restore
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div style={card} aria-label="Restore task dashboard">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h4 style={{ margin: 0 }}>Step 4 — Restore progress</h4>
              <p style={{ margin: "6px 0 0", color: "var(--backup-muted)" }}>Elapsed {timeLabel(job?.elapsedMs)} · Remaining {job?.etaSeconds == null ? "Estimating" : timeLabel(job.etaSeconds * 1000)}</p>
            </div>
            <strong role="status">{job?.status || "Waiting"} · {job?.progress?.percent || 0}%</strong>
          </div>
          <progress aria-label="Overall restore progress" max="100" value={job?.progress?.percent || 0} style={{ width: "100%" }} />
          <div>Completed {job?.progress?.completed || 0} · Failed {job?.progress?.failed || 0} · Pending {job?.progress?.pending || 0} · Skipped {job?.progress?.skipped || 0}</div>
          {currentTask && <div role="status">Current: <strong>{currentTask.name || currentTask.softwareName}</strong> · {currentTask.operation}</div>}
          {job?.error && <div role="alert" style={{ color: "#b91c1c" }}>{job.error}</div>}
          <div style={{ display: "grid", gap: 8 }}>
            {taskList.map((task) => (
              <div key={task.id} style={{ display: "grid", gap: 4, padding: 10, border: "1px solid var(--backup-border)", borderRadius: 9 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong>{task.name || task.softwareName}</strong>
                  <strong style={{ color: taskColor(task.status) }}>{TASK_STATES.includes(task.status) ? task.status : "WAITING"}</strong>
                </div>
                <span style={{ color: "var(--backup-muted)", fontSize: 13 }}>{task.operation}</span>
                {task.bytesTotal != null && <span>{task.bytesCompleted.toLocaleString()} / {task.bytesTotal.toLocaleString()} bytes {task.percent == null ? "" : `(${task.percent}%)`}</span>}
                {task.error && <span role="alert" style={{ color: "#b91c1c" }}>{task.error}</span>}
              </div>
            ))}
          </div>
          <details>
            <summary>Restore helper log ({job?.logs?.length || 0})</summary>
            <pre style={{ maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{(job?.logs || []).map((entry) => `${entry.at} [${entry.taskId}] ${entry.message}`).join("\n")}</pre>
          </details>
          {job && ["WAITING", "RUNNING"].includes(job.status) && (
            <button type="button" onClick={async () => {
              try { const result = await api("POST", `/api/jobs/${encodeURIComponent(job.id)}/cancel`, {}); setJob(result.job); }
              catch (error) { setValidationError(error.message); }
            }} style={{ justifySelf: "end", padding: "10px 15px", border: 0, borderRadius: 9, color: "#fff", background: "#b91c1c", fontWeight: 700 }}>
              Cancel restore
            </button>
          )}
          {job?.status === "COMPLETED" && (
            <div role="status" style={{ padding: 12, borderRadius: 9, background: "#ecfdf5", color: "#14532d" }}>
              Restore operations and validation completed. Website launch was skipped until you review the restored source and configure local secrets. No false launch/success claim is made.
            </div>
          )}
          {job && ["FAILED", "CANCELLED"].includes(job.status) && (
            <div>
              <p role="alert" style={{ color: "#b91c1c" }}>Restore {job.status.toLowerCase()}. Partial database writes cannot be rolled back automatically. Review errors and choose a new empty target before retrying.</p>
              <button type="button" onClick={() => { setJob(null); setStep(1); setValidation(null); setConfirmation(""); }} style={{ padding: "10px 15px", border: "1px solid var(--backup-border)", borderRadius: 9, background: "var(--backup-card)", color: "var(--backup-ink)" }}>Start a new validated attempt</button>
            </div>
          )}
        </div>
      )}

      {validationError && step !== 3 && <div role="alert" style={{ color: "#b91c1c" }}>{validationError}</div>}
    </section>
  );
}
