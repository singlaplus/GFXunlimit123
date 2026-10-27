import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { buildAuthHeaders } from "../utils/authSession";

const formatSitemapSize = (bytes) => {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) < 0) return "0 KB";
  if (Number(bytes) >= 1024 * 1024) return `${(Number(bytes) / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(Number(bytes) / 1024))} KB`;
};
const DEFAULT_SCHEDULE = { enabled: false, frequency: "daily", time: "02:00" };
const WEEKDAYS = [
  ["sunday", "Sunday"],
  ["monday", "Monday"],
  ["tuesday", "Tuesday"],
  ["wednesday", "Wednesday"],
  ["thursday", "Thursday"],
  ["friday", "Friday"],
  ["saturday", "Saturday"],
];
const TIME_PICKER_HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
const TIME_PICKER_MINUTES = Array.from({ length: 60 }, (_, index) => index);
const normalizeScheduleSettings = (value = {}) => ({
  enabled: value.enabled === true,
  frequency: ["daily", "weekly", "monthly"].includes(value.frequency) ? value.frequency : "daily",
  time: typeof value.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ? value.time : "02:00",
  ...(value.frequency === "weekly" && typeof value.weekday === "string"
    ? { weekday: value.weekday }
    : {}),
  ...(value.frequency === "monthly" && Number.isInteger(Number(value.monthDay))
    ? { monthDay: Number(value.monthDay) }
    : {}),
});
const formatTimeForDisplay = (time) => {
  const [hour, minute] = time.split(":").map(Number);
  return `${String(hour % 12 || 12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
};
const getTimePickerParts = (time) => {
  const [hour, minute] = time.split(":").map(Number);
  return { hour: hour % 12 || 12, minute, period: hour >= 12 ? "PM" : "AM" };
};
const formatTimeFromPicker = ({ hour, minute, period }) => {
  const hour24 = (hour % 12) + (period === "PM" ? 12 : 0);
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

export default function SitemapGenerationPanel({ isDarkMode = false }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [scheduleSettings, setScheduleSettings] = useState(DEFAULT_SCHEDULE);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const completionToastJob = useRef("");
  const textColor = isDarkMode ? "#cbd5e1" : "#475569";

  useEffect(() => {
    let active = true;
    axios.get(`${API_BASE_URL}/admin/sitemap/generation`, { headers: buildAuthHeaders() })
      .then((response) => {
        if (active) setJob(response.data?.job || null);
      })
      .catch((error) => {
        if (!active) return;
        console.error("Unable to load sitemap generation status", error);
        setErrorMessage(error.response?.data?.error || "Unable to load sitemap generation status.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    axios.get(`${API_BASE_URL}/admin/sitemap-schedule`, { headers: buildAuthHeaders() })
      .then((response) => {
        if (active) setScheduleSettings(normalizeScheduleSettings(response.data));
      })
      .catch((error) => {
        if (!active) return;
        console.error("Unable to load sitemap schedule", error);
        setScheduleError(error.response?.data?.error || "Unable to load sitemap schedule.");
      })
      .finally(() => {
        if (active) setScheduleLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!job?.id || job.status !== "running") return undefined;

    let active = true;
    let shouldContinuePolling = true;
    let timeoutId;
    const poll = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/admin/sitemap/generation/${encodeURIComponent(job.id)}`,
          { headers: buildAuthHeaders() }
        );
        if (!active) return;
        const nextJob = response.data?.job;
        if (!nextJob) {
          throw new Error("The backend returned no sitemap generation status.");
        }
        setJob(nextJob);
        setErrorMessage("");
        if (nextJob.status !== "running") shouldContinuePolling = false;
        if (nextJob.status === "completed" && completionToastJob.current !== nextJob.id) {
          completionToastJob.current = nextJob.id;
          toast.success("Sitemap generated successfully.");
        } else if (nextJob.status === "failed") {
          setErrorMessage(nextJob.error || "Sitemap generation failed.");
          toast.error(nextJob.error || "Sitemap generation failed.");
        }
      } catch (error) {
        if (!active) return;
        console.error("Unable to refresh sitemap generation status", error);
        setErrorMessage(error.response?.data?.error || error.message || "Unable to refresh sitemap generation status.");
      } finally {
        if (active && shouldContinuePolling) {
          timeoutId = window.setTimeout(poll, 1000);
        }
      }
    };

    timeoutId = window.setTimeout(poll, 1000);
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [job?.id, job?.status]);

  const startGeneration = async () => {
    setStarting(true);
    setErrorMessage("");
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/sitemap/generation`,
        {},
        { headers: buildAuthHeaders() }
      );
      if (!response.data?.job) throw new Error("The backend did not return a sitemap generation job.");
      setJob(response.data.job);
      completionToastJob.current = "";
    } catch (error) {
      console.error("Unable to start sitemap generation", error);
      const message = error.response?.data?.error || error.message || "Unable to start sitemap generation.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setStarting(false);
    }
  };

  const downloadSitemap = async () => {
    setErrorMessage("");
    try {
      const response = await axios.get(`${API_BASE_URL}/admin/sitemap/download`, {
        headers: buildAuthHeaders(),
        responseType: "blob",
      });
      const downloadUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = job?.result?.primaryFilename || "sitemap.xml";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Unable to download sitemap", error);
      const message = error.response?.data?.error || "Unable to download the generated sitemap.";
      setErrorMessage(message);
      toast.error(message);
    }
  };

  const saveSchedule = async () => {
    setScheduleSaving(true);
    setScheduleMessage("");
    setScheduleError("");
    try {
      const response = await axios.put(
        `${API_BASE_URL}/admin/sitemap-schedule`,
        scheduleSettings,
        { headers: buildAuthHeaders() }
      );
      setScheduleSettings(normalizeScheduleSettings(response.data));
      setScheduleMessage("Sitemap schedule saved.");
      toast.success("Sitemap schedule saved.");
    } catch (error) {
      console.error("Unable to save sitemap schedule", error);
      const message = error.response?.data?.error || "Unable to save sitemap schedule.";
      setScheduleError(message);
      toast.error(message);
    } finally {
      setScheduleSaving(false);
    }
  };

  const isRunning = job?.status === "running";
  const result = job?.result;
  const timePickerParts = getTimePickerParts(scheduleSettings.time);
  const updateTimePicker = (field, value) => {
    setScheduleSettings((current) => {
      const nextParts = { ...getTimePickerParts(current.time), [field]: value };
      return { ...current, time: formatTimeFromPicker(nextParts) };
    });
  };

  return (
    <>
    <section
      aria-label="Sitemap generation"
      className="admin-panel-card"
      style={{
        display: "grid",
        gap: "12px",
        flexBasis: "calc(33.333% - 14px)",
        height: "300px",
        boxSizing: "border-box",
        background: isDarkMode ? "#111827" : "#fff",
        color: isDarkMode ? "#f8fafc" : "#0f172a",
      }}
    >
      <h3 style={{ margin: 0 }}>Generate Sitemap</h3>
      <p style={{ margin: 0, color: textColor }}>
        Generate a sitemap from public pages, approved assets, published blog posts, and contributor profiles.
      </p>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={startGeneration}
          disabled={loading || starting || isRunning}
          style={{
            padding: "10px 14px",
            border: 0,
            borderRadius: "8px",
            background: "#1976d2",
            color: "#fff",
            fontWeight: 700,
            cursor: loading || starting || isRunning ? "not-allowed" : "pointer",
          }}
        >
          {isRunning ? "Generating..." : starting ? "Starting..." : "Generate Sitemap"}
        </button>
        {job?.status === "completed" && (
          <button
            type="button"
            onClick={downloadSitemap}
            style={{ padding: "10px 14px", border: 0, borderRadius: "8px", background: "#0f766e", color: "#fff", fontWeight: 700, cursor: "pointer" }}
          >
            Download Sitemap
          </button>
        )}
      </div>
      {isRunning && (
        <div style={{ display: "grid", gap: "6px" }}>
          <label htmlFor="sitemap-generation-progress" style={{ color: textColor }}>
            {job.stage || "Generating sitemap"} ({Number(job.progress) || 0}%)
          </label>
          <progress
            id="sitemap-generation-progress"
            aria-label="Sitemap generation progress"
            value={Number(job.progress) || 0}
            max="100"
            style={{ width: "100%" }}
          />
          <p role="status" style={{ margin: 0, color: textColor }}>
            Processed {Number(job.processedUrls || 0).toLocaleString()} of {Number(job.totalDiscoveredUrls || 0).toLocaleString()} discovered URLs.
          </p>
        </div>
      )}
      {job?.status === "completed" && result && (
        <div role="status" style={{ display: "grid", gap: "5px", color: textColor }}>
          <p style={{ margin: 0 }}>
            Generated {Number(result.totalUrls || 0).toLocaleString()} URLs in {Number(result.fileCount || 0).toLocaleString()} sitemap file(s).
          </p>
          <p style={{ margin: 0 }}>Primary file: {result.primaryFilename} ({formatSitemapSize(result.fileSizeBytes)}).</p>
          <p style={{ margin: 0, overflowWrap: "anywhere" }}>Saved to: {result.outputPath || "configured sitemap directory"}.</p>
          <a href={result.publicUrl || `${API_BASE_URL}/sitemap.xml`} target="_blank" rel="noreferrer">
            Open public sitemap
          </a>
        </div>
      )}
      {job?.status === "failed" && !errorMessage && (
        <p role="alert" style={{ margin: 0, color: "#dc2626" }}>{job.error || "Sitemap generation failed."}</p>
      )}
      {errorMessage && <p role="alert" style={{ margin: 0, color: "#dc2626" }}>{errorMessage}</p>}
    </section>
    <section
      aria-label="Automatic sitemap schedule"
      className="admin-panel-card"
      style={{
        display: "grid",
        gap: "14px",
        flexBasis: "calc(33.333% - 14px)",
        height: "300px",
        boxSizing: "border-box",
        background: isDarkMode ? "#111827" : "#fff",
        color: isDarkMode ? "#f8fafc" : "#0f172a",
      }}
    >
      <div>
        <h3 style={{ margin: "0 0 6px" }}>Automatic Sitemap Schedule</h3>
        <p style={{ margin: 0, color: textColor }}>
          Automatically generate and publish the sitemap at the selected time in India Standard Time (IST).
        </p>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: "9px", fontWeight: 600 }}>
        <input
          type="checkbox"
          aria-label="Enable automatic sitemap generation"
          checked={Boolean(scheduleSettings.enabled)}
          onChange={(event) => setScheduleSettings((current) => ({ ...current, enabled: event.target.checked }))}
          disabled={scheduleLoading || scheduleSaving}
        />
        Enable automatic generation
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "12px" }}>
        <label style={{ display: "grid", gap: "6px", fontWeight: 600 }}>
          Frequency
          <select
            aria-label="Sitemap frequency"
            value={scheduleSettings.frequency}
            onChange={(event) => setScheduleSettings((current) => {
              const { weekday, monthDay, ...sharedSettings } = current;
              if (event.target.value === "weekly") {
                return { ...sharedSettings, frequency: "weekly", weekday: weekday || "sunday" };
              }
              if (event.target.value === "monthly") {
                return { ...sharedSettings, frequency: "monthly", monthDay: monthDay || 1 };
              }
              return { ...sharedSettings, frequency: "daily" };
            })}
            disabled={scheduleLoading || scheduleSaving}
            style={{ padding: "10px 12px", borderRadius: "8px", border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1", background: isDarkMode ? "#0f172a" : "#fff", color: isDarkMode ? "#f8fafc" : "#0f172a" }}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <div style={{ display: "grid", alignContent: "start", gap: "6px", fontWeight: 600 }}>
          <span>Time (IST)</span>
          <button
            type="button"
            aria-label="Sitemap generation time (IST)"
            aria-expanded={timePickerOpen}
            aria-controls="sitemap-time-picker"
            onClick={() => setTimePickerOpen((open) => !open)}
            disabled={scheduleLoading || scheduleSaving}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              width: "100%",
              padding: "10px 12px",
              borderRadius: "10px",
              border: `1px solid ${timePickerOpen ? "#3b82f6" : isDarkMode ? "#475569" : "#cbd5e1"}`,
              background: isDarkMode ? "#0f172a" : "#fff",
              color: isDarkMode ? "#f8fafc" : "#0f172a",
              boxShadow: timePickerOpen ? "0 0 0 3px rgba(59,130,246,0.16)" : "0 1px 2px rgba(15,23,42,0.05)",
              fontWeight: 700,
              cursor: scheduleLoading || scheduleSaving ? "not-allowed" : "pointer",
            }}
          >
            <span>{formatTimeForDisplay(scheduleSettings.time)}</span>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </button>
          {timePickerOpen && (
            <div
              id="sitemap-time-picker"
              aria-label="Choose sitemap generation time"
              style={{
                display: "grid",
                gap: "8px",
                padding: "10px",
                border: `1px solid ${isDarkMode ? "#334155" : "#e2e8f0"}`,
                borderRadius: "12px",
                background: isDarkMode ? "#111c30" : "#fff",
                boxShadow: "0 12px 28px rgba(15,23,42,0.14)",
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.9fr", gap: "6px" }}>
                {[
                  { label: "Hour", values: TIME_PICKER_HOURS, selected: timePickerParts.hour, field: "hour", format: (value) => String(value).padStart(2, "0") },
                  { label: "Minute", values: TIME_PICKER_MINUTES, selected: timePickerParts.minute, field: "minute", format: (value) => String(value).padStart(2, "0") },
                  { label: "Period", values: ["AM", "PM"], selected: timePickerParts.period, field: "period", format: (value) => value },
                ].map(({ label, values, selected, field, format }) => (
                  <div key={field} style={{ display: "grid", gap: "5px", minWidth: 0 }}>
                    <span style={{ color: textColor, fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.06em", textAlign: "center", textTransform: "uppercase" }}>{label}</span>
                    <div
                      role="group"
                      aria-label={label}
                      style={{
                        display: "grid",
                        gridAutoRows: "30px",
                        maxHeight: "122px",
                        overflowY: "auto",
                        gap: "3px",
                        padding: "3px",
                        borderRadius: "8px",
                        background: isDarkMode ? "#0b1220" : "#f8fafc",
                      }}
                    >
                      {values.map((value) => {
                        const isSelected = value === selected;
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={isSelected}
                            aria-label={`${label} ${format(value)}`}
                            onClick={() => updateTimePicker(field, value)}
                            style={{
                              border: isSelected ? "1px solid #2563eb" : "1px solid transparent",
                              borderRadius: "7px",
                              background: isSelected ? "linear-gradient(135deg, #2563eb, #4f46e5)" : "transparent",
                              color: isSelected ? "#fff" : isDarkMode ? "#cbd5e1" : "#334155",
                              boxShadow: isSelected ? "0 3px 8px rgba(37,99,235,0.25)" : "none",
                              fontSize: "0.82rem",
                              fontWeight: isSelected ? 800 : 600,
                              cursor: "pointer",
                            }}
                          >
                            {format(value)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <span style={{ color: textColor, fontSize: "0.72rem" }}>India Standard Time (IST)</span>
                <button
                  type="button"
                  onClick={() => setTimePickerOpen(false)}
                  style={{ padding: "6px 11px", border: 0, borderRadius: "7px", background: "#2563eb", color: "#fff", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer" }}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
        {scheduleSettings.frequency === "weekly" && (
          <label style={{ display: "grid", gap: "6px", fontWeight: 600 }}>
            Day of week
            <select
              aria-label="Sitemap generation weekday"
              value={scheduleSettings.weekday || "sunday"}
              onChange={(event) => setScheduleSettings((current) => ({ ...current, weekday: event.target.value }))}
              disabled={scheduleLoading || scheduleSaving}
              style={{ padding: "10px 12px", borderRadius: "8px", border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1", background: isDarkMode ? "#0f172a" : "#fff", color: isDarkMode ? "#f8fafc" : "#0f172a" }}
            >
              {WEEKDAYS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        )}
        {scheduleSettings.frequency === "monthly" && (
          <label style={{ display: "grid", gap: "6px", fontWeight: 600 }}>
            Date of month
            <select
              aria-label="Sitemap generation date of month"
              value={scheduleSettings.monthDay || 1}
              onChange={(event) => setScheduleSettings((current) => ({ ...current, monthDay: Number(event.target.value) }))}
              disabled={scheduleLoading || scheduleSaving}
              style={{ padding: "10px 12px", borderRadius: "8px", border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1", background: isDarkMode ? "#0f172a" : "#fff", color: isDarkMode ? "#f8fafc" : "#0f172a" }}
            >
              {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}</option>)}
            </select>
          </label>
        )}
      </div>
      {scheduleSettings.frequency === "monthly" && scheduleSettings.monthDay > 28 && (
        <p style={{ margin: 0, color: textColor, fontSize: "0.9rem" }}>
          If the selected date does not exist in a month, generation runs on that month&apos;s last day.
        </p>
      )}
      <button
        type="button"
        onClick={saveSchedule}
        disabled={scheduleLoading || scheduleSaving}
        style={{ justifySelf: "start", padding: "10px 14px", border: 0, borderRadius: "8px", background: "#1976d2", color: "#fff", fontWeight: 700, cursor: scheduleLoading || scheduleSaving ? "not-allowed" : "pointer" }}
      >
        {scheduleLoading ? "Loading schedule..." : scheduleSaving ? "Saving schedule..." : "Save Schedule"}
      </button>
      {scheduleMessage && <p role="status" style={{ margin: 0, color: "#16a34a" }}>{scheduleMessage}</p>}
      {scheduleError && <p role="alert" style={{ margin: 0, color: "#dc2626" }}>{scheduleError}</p>}
    </section>
    </>
  );
}
