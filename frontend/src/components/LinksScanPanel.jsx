import React, { useEffect, useState } from "react";
import axios from "axios";
import Pagination from "./Pagination";
import { API_BASE_URL } from "../utils/apiBaseUrl";
import { buildAuthHeaders } from "../utils/authSession";

const LINKS_PER_PAGE = 100;
const getAppPagePath = (pageUrl) => {
  const parsed = new URL(pageUrl, window.location.origin);
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(parsed.search);
  params.sort();
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ""}`;
};
const getDisabledLinkKey = (sourcePath, href, text) => JSON.stringify([sourcePath, href, text]);

function AnimatedMetricCount({ value, label }) {
  const target = Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const [displayedValue, setDisplayedValue] = useState(0);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (prefersReducedMotion || target === 0) {
      setDisplayedValue(target);
      return undefined;
    }

    let frameId;
    let startTime;
    setDisplayedValue(0);
    const animate = (timestamp) => {
      if (startTime === undefined) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / 1200, 1);
      const easedProgress = 1 - (1 - progress) ** 3;
      setDisplayedValue(Math.round(target * easedProgress));
      if (progress < 1) frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frameId);
  }, [target]);

  return (
    <span aria-label={`${label}: ${target.toLocaleString()}`} aria-live="off">
      {displayedValue.toLocaleString()}
    </span>
  );
}

export default function LinksScanPanel({ isDarkMode = false }) {
  const [job, setJob] = useState(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [starting, setStarting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [links, setLinks] = useState([]);
  const [summary, setSummary] = useState({ total: 0, internal: 0, external: 0 });
  const [pagination, setPagination] = useState({ page: 1, pageSize: LINKS_PER_PAGE, total: 0, totalPages: 1 });
  const [scanErrors, setScanErrors] = useState([]);
  const [requestError, setRequestError] = useState("");
  const [disabledRows, setDisabledRows] = useState(() => new Set());
  const [updatingRowKey, setUpdatingRowKey] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_BASE_URL}/admin/links/scan`, { headers: buildAuthHeaders() })
      .then(({ data }) => {
        if (!cancelled) {
          setJob(data.job);
          if (data.job) {
            setProgress({ completed: data.job.pagesScanned || 0, total: data.job.totalPages || 0 });
          }
        }
      })
      .catch((error) => {
        if (!cancelled) setRequestError(error.response?.data?.error || "Unable to load saved link scan status.");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_BASE_URL}/admin/links/disabled-rows`, { headers: buildAuthHeaders() })
      .then(({ data }) => {
        if (!cancelled) {
          setDisabledRows(new Set((data.links || []).map((link) => (
            getDisabledLinkKey(link.source_path, link.href, link.link_text)
          ))));
        }
      })
      .catch((error) => {
        if (!cancelled) setRequestError(error.response?.data?.error || "Unable to load disabled link rows.");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (job?.status !== "running") return undefined;
    let cancelled = false;
    let timeoutId;
    const poll = async () => {
      try {
        const { data } = await axios.get(`${API_BASE_URL}/admin/links/scan`, { headers: buildAuthHeaders() });
        if (cancelled) return;
        setJob(data.job);
        setProgress({ completed: data.job?.pagesScanned || 0, total: data.job?.totalPages || 0 });
        if (data.job?.status === "running") timeoutId = window.setTimeout(poll, 1500);
      } catch (error) {
        if (!cancelled) setRequestError(error.response?.data?.error || "Unable to check link scan progress.");
      }
    };
    timeoutId = window.setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [job?.scanId, job?.status]);

  useEffect(() => {
    if (job?.status !== "completed") return undefined;
    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        const { data } = await axios.get(`${API_BASE_URL}/admin/links/scan/results`, {
          headers: buildAuthHeaders(),
          params: { page: currentPage, pageSize: LINKS_PER_PAGE, search, type: typeFilter },
        });
        if (cancelled) return;
        setLinks(data.links);
        setSummary(data.summary);
        setPagination(data.pagination);
        setScanErrors(data.errors || []);
        if (data.pagination.page !== currentPage) setCurrentPage(data.pagination.page);
      } catch (error) {
        if (!cancelled) setRequestError(error.response?.data?.error || "Unable to load scanned links.");
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [job?.scanId, job?.status, currentPage, search, typeFilter]);

  const scanning = starting || job?.status === "running";
  const scanComplete = job?.status === "completed" || job?.status === "failed";
  const startScan = async () => {
    if (scanning || starting) return;
    setStarting(true);
    setJob(null);
    setRequestError("");
    setScanErrors([]);
    setLinks([]);
    setSummary({ total: 0, internal: 0, external: 0 });
    setCurrentPage(1);
    setSearch("");
    setTypeFilter("All");
    try {
      const { data } = await axios.post(
        `${API_BASE_URL}/admin/links/scan`,
        {},
        { headers: buildAuthHeaders() }
      );
      setJob(data.job);
      setProgress({ completed: data.job.pagesScanned || 0, total: data.job.totalPages || 0 });
    } catch (error) {
      setRequestError(error.response?.data?.error || "Unable to start the app link scan.");
    } finally {
      setStarting(false);
    }
  };

  const exportCsv = async () => {
    if (exporting || !pagination.total) return;
    setExporting(true);
    setRequestError("");
    try {
      const response = await axios.get(`${API_BASE_URL}/admin/links/scan/export`, {
        headers: buildAuthHeaders(),
        params: { search, type: typeFilter },
        responseType: "blob",
      });
      const objectUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `app-links-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setRequestError(error.response?.data?.error || "Unable to export scanned links as CSV.");
    } finally {
      setExporting(false);
    }
  };

  const toggleLinkRow = async (link) => {
    if (link.type !== "Internal") return;
    const sourcePath = getAppPagePath(link.pageUrl);
    const rowKey = getDisabledLinkKey(sourcePath, link.href, link.text);
    const isDisabled = disabledRows.has(rowKey);
    if (!isDisabled && !window.confirm(`Disable this link on ${sourcePath} only?`)) return;

    setUpdatingRowKey(rowKey);
    setRequestError("");
    try {
      if (isDisabled) {
        await axios.delete(`${API_BASE_URL}/admin/links/disabled-rows`, {
          headers: buildAuthHeaders(),
          data: { sourcePath, href: link.href, text: link.text },
        });
        setDisabledRows((current) => {
          const next = new Set(current);
          next.delete(rowKey);
          return next;
        });
      } else {
        await axios.put(
          `${API_BASE_URL}/admin/links/disabled-rows`,
          { sourcePath, href: link.href, text: link.text },
          { headers: buildAuthHeaders() }
        );
        setDisabledRows((current) => new Set(current).add(rowKey));
      }
    } catch (error) {
      setRequestError(error.response?.data?.error || `Unable to ${isDisabled ? "re-enable" : "disable"} this link row.`);
    } finally {
      setUpdatingRowKey("");
    }
  };

  const mutedColor = isDarkMode ? "#94a3b8" : "#64748b";
  const surfaceColor = isDarkMode ? "#0f172a" : "#fff";
  const borderColor = isDarkMode ? "#334155" : "#e2e8f0";
  const totalExternal = summary.external;
  const totalInternal = summary.internal;
  const tableStart = pagination.total ? (pagination.page - 1) * LINKS_PER_PAGE + 1 : 0;
  const tableEnd = Math.min(pagination.page * LINKS_PER_PAGE, pagination.total);

  return (
    <section
      aria-label="App link scanner"
      className="admin-panel-card"
      style={{
        display: "block",
        width: "100%",
        height: "auto",
        minHeight: 0,
        maxHeight: "none",
        overflow: "visible",
        padding: 0,
        boxSizing: "border-box",
        background: "transparent",
        border: 0,
        boxShadow: "none",
        color: isDarkMode ? "#f8fafc" : "#0f172a",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "24px",
          overflow: "hidden",
          padding: "30px 34px",
          border: `1px solid ${isDarkMode ? "#334155" : "#dbeafe"}`,
          borderRadius: "20px",
          background: isDarkMode
            ? "radial-gradient(ellipse at top right, rgba(37,99,235,0.2), transparent 55%), linear-gradient(135deg, #111827, #0f172a)"
            : "radial-gradient(ellipse at top right, rgba(99,102,241,0.13), transparent 52%), linear-gradient(135deg, #fff, #f5f8ff)",
          boxShadow: isDarkMode ? "0 18px 40px rgba(2,6,23,0.24)" : "0 16px 36px rgba(30,64,175,0.08)",
        }}
      >
        <div style={{ position: "relative", zIndex: 1, maxWidth: "680px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "7px", marginBottom: "12px", padding: "6px 10px", border: `1px solid ${isDarkMode ? "rgba(96,165,250,0.28)" : "#bfdbfe"}`, borderRadius: "999px", background: isDarkMode ? "rgba(30,58,138,0.32)" : "#eff6ff", color: isDarkMode ? "#bfdbfe" : "#1d4ed8", fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#3b82f6", boxShadow: "0 0 0 3px rgba(59,130,246,0.14)" }} />
            Site link audit
          </span>
          <h3 style={{ margin: "0 0 8px", fontSize: "clamp(1.35rem, 2.4vw, 1.8rem)", letterSpacing: "-0.03em" }}>Discover every link across your app</h3>
          <p style={{ maxWidth: "600px", margin: 0, color: mutedColor, fontSize: "0.95rem", lineHeight: 1.65 }}>
            Scan public and signed-in pages, review internal and external destinations, and quickly find the page where each link appears.
          </p>
          {scanning && (
            <div style={{ display: "grid", gap: "7px", maxWidth: "400px", marginTop: "18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", color: mutedColor, fontSize: "0.78rem", fontWeight: 700 }}>
                <span>Scanning app pages</span>
                <span>{progress.completed} / {progress.total}</span>
              </div>
              <div
                role="progressbar"
                aria-label="App link scan progress"
                aria-valuenow={progress.completed}
                aria-valuemin={0}
                aria-valuemax={progress.total}
                style={{ height: "7px", overflow: "hidden", borderRadius: "999px", background: isDarkMode ? "#334155" : "#dbeafe" }}
              >
                <div style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%`, height: "100%", borderRadius: "inherit", background: "linear-gradient(90deg, #2563eb, #8b5cf6)", transition: "width 180ms ease" }} />
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={startScan}
          disabled={scanning}
          style={{
            position: "relative",
            zIndex: 1,
            display: "inline-flex",
            flex: "0 0 auto",
            alignItems: "center",
            justifyContent: "center",
            gap: "9px",
            minWidth: "150px",
            padding: "13px 18px",
            border: 0,
            borderRadius: "11px",
            background: scanning ? "#64748b" : "linear-gradient(135deg, #2563eb, #4f46e5)",
            color: "#fff",
            fontWeight: 750,
            boxShadow: scanning ? "none" : "0 8px 18px rgba(37,99,235,0.25)",
            cursor: scanning ? "wait" : "pointer",
          }}
        >
          {!scanning && <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /><path d="M11 8v6M8 11h6" /></svg>}
          {scanning ? "Scanning..." : scanComplete ? "Scan Again" : "Scan Links"}
        </button>
      </div>
      {requestError && (
        <p role="alert" style={{ margin: "14px 0 0", padding: "11px 14px", border: `1px solid ${isDarkMode ? "#7f1d1d" : "#fecaca"}`, borderRadius: "10px", background: isDarkMode ? "rgba(127,29,29,0.18)" : "#fef2f2", color: isDarkMode ? "#fca5a5" : "#b91c1c" }}>
          {requestError}
        </p>
      )}
      {job?.status === "failed" && (
        <p role="alert" style={{ margin: "14px 0 0", color: isDarkMode ? "#fca5a5" : "#b91c1c" }}>
          {job.error || "The backend could not complete the app link scan."}
        </p>
      )}
      {scanComplete && (
        <>
          {job.status === "completed" && scanErrors.length === 0 && (
            <p role="status" style={{ margin: "16px 0 0", color: isDarkMode ? "#86efac" : "#15803d", fontSize: "0.88rem", fontWeight: 650 }}>
              Scanned {progress.total} app pages and found {summary.total.toLocaleString()} links.
            </p>
          )}
          {scanErrors.length > 0 && (
            <p role="alert" style={{ margin: "14px 0 0", padding: "11px 14px", border: `1px solid ${isDarkMode ? "#7f1d1d" : "#fecaca"}`, borderRadius: "10px", background: isDarkMode ? "rgba(127,29,29,0.18)" : "#fef2f2", color: isDarkMode ? "#fca5a5" : "#b91c1c" }}>
              Scanned {progress.completed} of {progress.total} pages. {scanErrors.length} page(s) could not be scanned.
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "14px", marginTop: "18px" }}>
            {[
              { label: "Links found", count: summary.total, tint: "#2563eb", background: isDarkMode ? "rgba(30,64,175,0.12)" : "#eff6ff" },
              { label: "Internal links", count: totalInternal, tint: "#059669", background: isDarkMode ? "rgba(5,150,105,0.12)" : "#ecfdf5" },
              { label: "External links", count: totalExternal, tint: "#7c3aed", background: isDarkMode ? "rgba(124,58,237,0.13)" : "#f5f3ff" },
              { label: "Pages scanned", count: progress.completed, tint: "#d97706", background: isDarkMode ? "rgba(217,119,6,0.12)" : "#fffbeb" },
            ].map((metric) => (
              <div key={metric.label} style={{ display: "grid", gap: "7px", padding: "16px 18px", border: `1px solid ${borderColor}`, borderRadius: "14px", background: surfaceColor, boxShadow: isDarkMode ? "0 8px 18px rgba(2,6,23,0.14)" : "0 8px 18px rgba(15,23,42,0.035)" }}>
                <span style={{ color: mutedColor, fontSize: "0.78rem", fontWeight: 700 }}>{metric.label}</span>
                <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "1.45rem", fontWeight: 850, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
                  <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: metric.tint, boxShadow: `0 0 0 4px ${metric.background}` }} />
                  <AnimatedMetricCount value={metric.count} label={metric.label} />
                </span>
              </div>
            ))}
          </div>
          <section aria-label="Scanned link results" style={{ marginTop: "18px", overflow: "hidden", border: `1px solid ${borderColor}`, borderRadius: "16px", background: surfaceColor, boxShadow: isDarkMode ? "0 12px 28px rgba(2,6,23,0.18)" : "0 10px 28px rgba(15,23,42,0.045)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", padding: "18px 20px", borderBottom: `1px solid ${borderColor}` }}>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: "1rem" }}>Link inventory</h3>
                <p style={{ margin: 0, color: mutedColor, fontSize: "0.82rem" }}>Search and filter links discovered across the scanned pages.</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={exportCsv}
                  disabled={exporting || pagination.total === 0}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "7px",
                    padding: "9px 12px",
                    border: `1px solid ${borderColor}`,
                    borderRadius: "9px",
                    background: isDarkMode ? "#172033" : "#f8fafc",
                    color: isDarkMode ? "#e2e8f0" : "#334155",
                    fontWeight: 700,
                    cursor: exporting || pagination.total === 0 ? "not-allowed" : "pointer",
                    opacity: exporting || pagination.total === 0 ? 0.6 : 1,
                  }}
                >
                  {exporting ? "Exporting..." : "Export CSV"}
                </button>
                <label style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <span aria-hidden="true" style={{ position: "absolute", left: "11px", color: mutedColor, fontSize: "0.95rem" }}>⌕</span>
                  <input
                    type="search"
                    aria-label="Search scanned links"
                    placeholder="Search links..."
                    value={search}
                    onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }}
                    style={{ width: "min(260px, 65vw)", boxSizing: "border-box", padding: "9px 12px 9px 32px", border: `1px solid ${borderColor}`, borderRadius: "9px", background: isDarkMode ? "#0f172a" : "#fff", color: isDarkMode ? "#f8fafc" : "#0f172a", outlineColor: "#3b82f6" }}
                  />
                </label>
                <select
                  aria-label="Filter links by type"
                  value={typeFilter}
                  onChange={(event) => { setTypeFilter(event.target.value); setCurrentPage(1); }}
                  style={{ padding: "9px 30px 9px 11px", border: `1px solid ${borderColor}`, borderRadius: "9px", background: isDarkMode ? "#0f172a" : "#fff", color: isDarkMode ? "#f8fafc" : "#0f172a", fontWeight: 650 }}
                >
                  {["All", "Internal", "External", "Email", "Phone"].map((type) => <option key={type}>{type}</option>)}
                </select>
              </div>
            </div>
            {links.length > 0 ? (
              <>
                <div style={{ width: "100%", overflowX: "auto" }}>
                  <table aria-label="Scanned app links" style={{ width: "100%", minWidth: "760px", borderCollapse: "collapse", textAlign: "left", fontSize: "0.83rem" }}>
                    <thead>
                      <tr style={{ background: isDarkMode ? "#172033" : "#f8fafc" }}>
                        {["Link text", "Destination", "Type", "Found on · Page availability"].map((heading) => (
                          <th key={heading} scope="col" style={{ padding: "12px 16px", color: mutedColor, fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {links.map((link, index) => {
                        const pagePath = getAppPagePath(link.pageUrl);
                        const rowKey = getDisabledLinkKey(pagePath, link.href, link.text);
                        const rowDisabled = disabledRows.has(rowKey);
                        const isUpdating = updatingRowKey === rowKey;
                        const typeStyle = link.type === "Internal"
                          ? { background: isDarkMode ? "rgba(5,150,105,0.16)" : "#ecfdf5", color: isDarkMode ? "#6ee7b7" : "#047857" }
                          : link.type === "External"
                            ? { background: isDarkMode ? "rgba(124,58,237,0.18)" : "#f5f3ff", color: isDarkMode ? "#c4b5fd" : "#6d28d9" }
                            : { background: isDarkMode ? "#1e293b" : "#f1f5f9", color: mutedColor };
                        return (
                          <tr key={`${link.pageUrl}-${link.href}-${index}`} style={{ borderTop: `1px solid ${borderColor}`, background: index % 2 ? (isDarkMode ? "rgba(15,23,42,0.38)" : "#fcfdff") : "transparent" }}>
                            <td style={{ maxWidth: "220px", padding: "12px 16px", color: isDarkMode ? "#e2e8f0" : "#334155", fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={link.text}>{link.text}</td>
                            <td style={{ maxWidth: "400px", padding: "12px 16px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              <a href={link.href} target="_blank" rel="noreferrer" title={link.href} style={{ color: isDarkMode ? "#93c5fd" : "#2563eb", fontWeight: 600, textDecoration: "none" }}>{link.href}</a>
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              <span style={{ display: "inline-flex", padding: "4px 8px", borderRadius: "999px", background: typeStyle.background, color: typeStyle.color, fontSize: "0.7rem", fontWeight: 800 }}>{link.type}</span>
                            </td>
                            <td style={{ minWidth: "260px", maxWidth: "380px", padding: "12px 16px", color: mutedColor }} title={link.pageUrl}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{link.pageUrl}</span>
                                <button
                                  type="button"
                                  onClick={() => toggleLinkRow(link)}
                                  disabled={isUpdating || link.type !== "Internal"}
                                  aria-label={`${rowDisabled ? "Enable" : "Disable"} link ${link.text} on ${pagePath}`}
                                  title={link.type !== "Internal"
                                    ? "Only internal app links can be disabled."
                                    : rowDisabled
                                      ? "Re-enable this link on this page"
                                      : "Disable only this link on this page"}
                                  style={{
                                    flex: "0 0 auto",
                                    padding: "6px 9px",
                                    border: `1px solid ${rowDisabled ? "#bbf7d0" : borderColor}`,
                                    borderRadius: "8px",
                                    background: rowDisabled
                                      ? (isDarkMode ? "rgba(22,163,74,0.14)" : "#f0fdf4")
                                      : (isDarkMode ? "rgba(239,68,68,0.12)" : "#fef2f2"),
                                    color: rowDisabled
                                      ? (isDarkMode ? "#86efac" : "#15803d")
                                      : (isDarkMode ? "#fca5a5" : "#b91c1c"),
                                    fontSize: "0.72rem",
                                    fontWeight: 750,
                                    whiteSpace: "nowrap",
                                    cursor: isUpdating ? "wait" : link.type !== "Internal" ? "not-allowed" : "pointer",
                                    opacity: link.type === "Internal" ? 1 : 0.55,
                                  }}
                                >
                                  {isUpdating
                                    ? "Saving..."
                                    : rowDisabled
                                      ? "Enable link"
                                      : link.type === "Internal" ? "Disable link" : "Unavailable"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", padding: "12px 16px", borderTop: `1px solid ${borderColor}`, color: mutedColor, fontSize: "0.8rem" }}>
                  <span>Showing {tableStart.toLocaleString()}–{tableEnd.toLocaleString()} of {pagination.total.toLocaleString()} links · 100 per page</span>
                </div>
                <Pagination
                  currentPage={pagination.page}
                  totalPages={pagination.totalPages}
                  totalImages={pagination.total}
                  setCurrentPage={setCurrentPage}
                  darkMode={isDarkMode}
                />
              </>
            ) : (
              <p style={{ margin: 0, padding: "28px 20px", color: mutedColor, textAlign: "center" }}>
                {pagination.total === 0 && summary.total > 0 ? "No links match your search and filter." : "No links were found on the scanned app pages."}
              </p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
