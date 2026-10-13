import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";

const STORAGE_KEY = "stocksite-restore-package-job";

function elapsedLabel(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.floor(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function etaLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return elapsedLabel(seconds * 1000);
}

function bytesLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(2)} ${units[unit]}`;
}

export default function RestorePackagePanel({ apiBaseUrl, getAuthToken }) {
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [authorizeEncryptedConfiguration, setAuthorizeEncryptedConfiguration] = useState(false);
  const [error, setError] = useState("");
  const [downloadMessage, setDownloadMessage] = useState("");

  const request = useCallback((method, endpoint, data) => {
    const token = getAuthToken();
    return axios({
      method,
      url: `${apiBaseUrl}/admin/backup${endpoint}`,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      withCredentials: true,
      ...(data ? { data } : {})
    });
  }, [apiBaseUrl, getAuthToken]);

  const refresh = useCallback(async (id) => {
    return request("get", `/restore-package/jobs/${encodeURIComponent(id)}`);
  }, [request]);

  useEffect(() => {
    const savedId = window.sessionStorage.getItem(STORAGE_KEY);
    if (!savedId) return;
    let active = true;
    request("get", `/restore-package/jobs/${encodeURIComponent(savedId)}`)
      .then((response) => { if (active) setJob(response.data?.job || null); })
      .catch(() => { if (active) window.sessionStorage.removeItem(STORAGE_KEY); });
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    if (!job?.id || job.status !== "RUNNING") return undefined;
    let active = true;
    const update = () => refresh(job.id)
      .then((response) => { if (active) setJob(response.data?.job || null); })
      .catch((requestError) => {
        if (active) setError(requestError.response?.data?.error || "Could not refresh restore package progress.");
      });
    const timer = window.setInterval(() => {
      void update();
    }, 1500);
    void update();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status, refresh]);

  const start = async () => {
    setBusy(true);
    setError("");
    setDownloadMessage("");
    try {
      const response = await request("post", "/restore-package/start", {
        includeEncryptedEnvironmentFiles: authorizeEncryptedConfiguration
      });
      const started = response.data?.job;
      if (!started?.id) throw new Error("The server did not return a restore package job ID.");
      window.sessionStorage.setItem(STORAGE_KEY, started.id);
      setJob(started);
    } catch (requestError) {
      setError(requestError.response?.data?.error || requestError.message || "Restore package preparation could not be started.");
    } finally {
      setBusy(false);
    }
  };

  const download = async (artifact) => {
    setDownloadMessage("");
    try {
      const token = getAuthToken();
      const response = await fetch(`${apiBaseUrl}${artifact.downloadUrl}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include"
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Artifact download failed (HTTP ${response.status}).`);
      }
      let writable;
      if (typeof window.showSaveFilePicker === "function") {
        const file = await window.showSaveFilePicker({ suggestedName: artifact.filename });
        writable = await file.createWritable();
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writable.write(value);
          }
          await writable.close();
        } catch (streamError) {
          await writable.abort().catch(() => {});
          throw streamError;
        }
      } else {
        const blob = await response.blob();
        const link = document.createElement("a");
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl;
        link.download = artifact.filename;
        link.click();
        URL.revokeObjectURL(objectUrl);
      }
      setDownloadMessage(`${artifact.label} downloaded.`);
    } catch (downloadError) {
      setDownloadMessage(downloadError.message || "Artifact download failed.");
    }
  };

  const tasks = useMemo(() => job?.tasks || [], [job?.tasks]);
  const percent = Number.isFinite(job?.progress?.percent) ? job.progress.percent : null;
  const totals = useMemo(() => tasks.reduce((sum, task) => ({
    bytesCompleted: sum.bytesCompleted + Number(task.bytesCompleted || 0),
    bytesTotal: sum.bytesTotal + Number(task.bytesTotal || 0),
    filesCompleted: sum.filesCompleted + Number(task.filesCompleted || 0),
    filesTotal: sum.filesTotal + Number(task.filesTotal || 0)
  }), { bytesCompleted: 0, bytesTotal: 0, filesCompleted: 0, filesTotal: 0 }), [tasks]);

  return (
    <section aria-label="Restore package generator" className="gfx-backup-section gfx-restore-package">
      {!job && (
        <div style={{ display: "grid", justifyItems: "center", gap: 16, padding: "32px 16px", textAlign: "center" }}>
          <h3 style={{ margin: 0 }}>Prepare Stocksite restoration package</h3>
          <p style={{ maxWidth: 660, margin: 0, color: "var(--backup-muted)" }}>
            START asks the configured SERVER backup engine to validate PostgreSQL, website code, original asset, and thumbnail sources, then prepare individually downloadable, verified restore artifacts. Source paths and credentials are read only from server configuration.
          </p>
          <p role="note" style={{ maxWidth: 660, margin: 0, color: "var(--backup-muted)" }}>
            A fresh Windows PC needs supported 64-bit Windows 11 (build 26200+/25H2+), Node.js 22+ on an active or maintenance LTS line, PostgreSQL 18+ server/client tools, and a manually created empty local database and role before restore. This package step does not provision Windows or PostgreSQL. In the local wizard, each database, extraction, configuration, dependency, build, and backend-start action requires a separate approval. It does not install system software, start Windows services, create database roles, or change Windows permissions. The helper does not verify full source/schema compatibility; it checks required asset lifecycle schema only. Normal Stocksite startup may run database initialization/migrations. Use only a disposable local database, and follow the included restore guide.
          </p>
          <label style={{ maxWidth: 660, textAlign: "left", color: "var(--backup-muted)" }}>
            <input
              type="checkbox"
              checked={authorizeEncryptedConfiguration}
              onChange={(event) => setAuthorizeEncryptedConfiguration(event.target.checked)}
            />
            I authorize inclusion of encrypted `.env` configuration in this administrator-only package. It may contain production credentials; decrypting or reusing them on a new computer could grant production access.
          </label>
          <button className="gfx-backup-primary" type="button" onClick={start} disabled={busy || !authorizeEncryptedConfiguration} style={{ minWidth: 150, padding: "13px 28px", fontSize: 16 }}>
            {busy ? "Starting…" : "START"}
          </button>
        </div>
      )}
      {job && (
        <div style={{ display: "grid", gap: 16 }}>
          <div className="gfx-backup-section-heading">
            <div>
              <span className="gfx-backup-kicker">RESTORE PACKAGE · {job.status}</span>
              <h3>Package preparation progress</h3>
              <p>{job.currentOperation || "Waiting for the configured SERVER backup service."}</p>
            </div>
            <span className="gfx-backup-measurement" role="status">
              Elapsed: {elapsedLabel(job.elapsedMs)}
              {etaLabel(job.sourceProgress?.etaSeconds) && ` · Source collection ETA: ${etaLabel(job.sourceProgress.etaSeconds)}`}
            </span>
          </div>
          <div>
            {percent === null
              ? <progress aria-label="Package preparation progress" />
              : <progress aria-label="Package preparation progress" max="100" value={percent} />}
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--backup-muted)", fontSize: 13 }}>
              <span>{percent === null ? "Progress is being measured" : `${percent}% by completed workflow stages`}</span>
              {job.sourceProgress?.filesTotal
                ? <span>{job.sourceProgress.filesCompleted}/{job.sourceProgress.filesTotal} files · {bytesLabel(job.sourceProgress.bytesCompleted)} / {bytesLabel(job.sourceProgress.bytesTotal)}</span>
                : totals.filesTotal
                  ? <span>{totals.filesCompleted}/{totals.filesTotal} measured task files · {bytesLabel(totals.bytesCompleted)} / {bytesLabel(totals.bytesTotal)}</span>
                  : <span>File totals not available yet</span>}
            </div>
          </div>
          <ul aria-label="Package preparation tasks" style={{ display: "grid", gap: 9, paddingLeft: 22, margin: 0 }}>
            {tasks.map((task) => (
              <li key={task.id}>
                <strong>{task.name}</strong> — {task.status}
                {task.operation && <span>: {task.operation}</span>}
                {Number.isFinite(task.percent) && <span> ({task.percent}%)</span>}
                {task.filesTotal != null && <span> · {task.filesCompleted || 0}/{task.filesTotal} files</span>}
                {task.bytesTotal != null && <span> · {bytesLabel(task.bytesCompleted || 0)}/{bytesLabel(task.bytesTotal)}</span>}
                {task.error && <span role="alert" style={{ color: "#b91c1c" }}> · {task.error}</span>}
              </li>
            ))}
          </ul>
          {job.error && <div role="alert" style={{ color: "#b91c1c" }}>{job.error}</div>}
          {job.status === "READY" && (
            <section aria-label="Verified restore package downloads" style={{ display: "grid", gap: 8 }}>
              <h4 style={{ margin: 0 }}>Verified downloads</h4>
              {job.artifacts.map((artifact) => (
                <button key={artifact.id} type="button" onClick={() => download(artifact)} style={{ textAlign: "left" }}>
                  Download {artifact.label} · {bytesLabel(artifact.sizeBytes)}
                </button>
              ))}
              <p className="gfx-backup-measurement">The website-code archive contains encrypted environment-file payloads. Keep the decryption key separate; it is not included in the package.</p>
            </section>
          )}
          {job.status === "FAILED" && <button type="button" className="gfx-backup-primary" onClick={start} disabled={busy}>{busy ? "Retrying…" : "Retry package preparation"}</button>}
          {downloadMessage && <p role="status">{downloadMessage}</p>}
        </div>
      )}
      {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
    </section>
  );
}
