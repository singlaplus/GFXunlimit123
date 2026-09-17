import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

export default function TaxMailSettings({ isDarkMode, getEffectiveAuthToken }) {
  const [settings, setSettings] = useState({
    enable_reminders: true,
    reminder_interval_days: 7,
    reminder_subject: "Tax Form Submission Reminder",
    enable_approval_notification: true,
    enable_rejection_notification: true,
    renewal_days_left: [200, 150, 100, 50, 30, 15, 10, 7, 5, 3, 2, 1],
    expired_reminder_interval_days: 15,
    monthly_unsubmitted_reminder_day: 9,
    monthly_unsubmitted_reminder_template: "reminder",
  });
  const [loading, setLoading] = useState(false);

  const parseRenewalDaysLeft = (value) => {
    if (Array.isArray(value)) return value;
    if (!value && value !== 0) return [200, 150, 100, 50, 30, 15, 10, 7, 5, 3, 2, 1];
    return String(value)
      .split(",")
      .map((entry) => Number(String(entry).trim()))
      .filter((entry) => Number.isInteger(entry) && entry > 0)
      .slice(0, 20);
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const token = getEffectiveAuthToken ? getEffectiveAuthToken() : null;
      const response = await axios.get(`${API_BASE_URL}/admin/email/tax-mail-config`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const saved = localStorage.getItem("taxMailSettings");
      const nextSettings = response.data?.updated_at
        ? response.data.settings
        : (saved ? JSON.parse(saved) : response.data?.settings);
      if (nextSettings) {
        setSettings((currentSettings) => ({
          ...currentSettings,
          ...nextSettings,
          renewal_days_left: parseRenewalDaysLeft(nextSettings.renewal_days_left || currentSettings.renewal_days_left)
        }));
        if (!response.data?.updated_at && saved) {
          await axios.put(`${API_BASE_URL}/admin/email/tax-mail-config`, { settings: nextSettings }, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          });
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      setLoading(true);
      const token = getEffectiveAuthToken ? getEffectiveAuthToken() : null;
      await axios.put(`${API_BASE_URL}/admin/email/tax-mail-config`, { settings }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      toast.success("Tax mail settings saved.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to save tax mail settings.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "20px", maxHeight: "80vh", overflowY: "auto" }}>
      <h3 style={{ margin: "0 0 20px 0", color: isDarkMode ? "#f8fafc" : "#0f172a" }}>Tax Form Email Settings</h3>

      <div style={{ display: "grid", gap: "16px" }}>
        {/* Enable Reminders */}
        <div style={{ padding: "12px", borderRadius: "8px", background: isDarkMode ? "#1e293b" : "#f1f5f9" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={settings.enable_reminders}
              onChange={(e) => setSettings({ ...settings, enable_reminders: e.target.checked })}
              style={{ cursor: "pointer" }}
            />
            <span style={{ fontWeight: 600, color: isDarkMode ? "#f8fafc" : "#0f172a" }}>Enable Tax Form Reminders</span>
          </label>
          <p style={{ margin: "8px 0 0 32px", fontSize: "0.85rem", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>
            Automatically send reminders to contributors who haven't submitted tax forms
          </p>
        </div>

        {/* Reminder Interval */}
        {settings.enable_reminders && (
          <div style={{ padding: "12px", borderRadius: "8px", background: isDarkMode ? "#1e293b" : "#f1f5f9" }}>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: 600, color: isDarkMode ? "#f8fafc" : "#0f172a" }}>
              Reminder Interval (days)
            </label>
            <input
              type="number"
              min="1"
              max="90"
              value={settings.reminder_interval_days}
              onChange={(e) => setSettings({ ...settings, reminder_interval_days: parseInt(e.target.value) || 7 })}
              style={{
                width: "100%",
                padding: "8px",
                border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1",
                borderRadius: "6px",
                background: isDarkMode ? "#0f172a" : "#fff",
                color: isDarkMode ? "#f8fafc" : "#0f172a",
                fontSize: "1rem",
              }}
            />
            <p style={{ margin: "8px 0 0 0", fontSize: "0.85rem", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>
              Send reminders every {settings.reminder_interval_days} day(s)
            </p>
          </div>
        )}

        {/* Reminder Subject */}
        {settings.enable_reminders && (
          <div style={{ padding: "12px", borderRadius: "8px", background: isDarkMode ? "#1e293b" : "#f1f5f9" }}>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: 600, color: isDarkMode ? "#f8fafc" : "#0f172a" }}>
              Reminder Email Subject
            </label>
            <input
              type="text"
              value={settings.reminder_subject}
              onChange={(e) => setSettings({ ...settings, reminder_subject: e.target.value })}
              style={{
                width: "100%",
                padding: "8px",
                border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1",
                borderRadius: "6px",
                background: isDarkMode ? "#0f172a" : "#fff",
                color: isDarkMode ? "#f8fafc" : "#0f172a",
                fontSize: "1rem",
              }}
            />
          </div>
        )}

        {/* Renewal reminder thresholds */}
        <div style={{ padding: "12px", borderRadius: "8px", background: isDarkMode ? "#1e293b" : "#f1f5f9" }}>
          <label style={{ display: "block", marginBottom: "8px", fontWeight: 600, color: isDarkMode ? "#f8fafc" : "#0f172a" }}>
            Renewal email triggers (days left)
          </label>
          <input
            type="text"
            value={Array.isArray(settings.renewal_days_left) ? settings.renewal_days_left.join(", ") : "200, 150, 100, 50, 30, 15, 10, 7, 5, 3, 2, 1"}
            onChange={(e) => setSettings({ ...settings, renewal_days_left: parseRenewalDaysLeft(e.target.value) })}
            placeholder="200, 150, 100, 50, 30, 15, 10, 7, 5, 3, 2, 1"
            style={{
              width: "100%",
              padding: "8px",
              border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1",
              borderRadius: "6px",
              background: isDarkMode ? "#0f172a" : "#fff",
              color: isDarkMode ? "#f8fafc" : "#0f172a",
              fontSize: "1rem",
            }}
          />
          <p style={{ margin: "8px 0 0 0", fontSize: "0.85rem", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>
            Renewal emails will be queued when remaining days fall at or below these values.
          </p>
        </div>

        <div style={{ padding: "12px", borderRadius: "8px", background: isDarkMode ? "#1e293b" : "#f1f5f9" }}>
          <label style={{ display: "block", marginBottom: "8px", fontWeight: 600, color: isDarkMode ? "#f8fafc" : "#0f172a" }}>
            Expired tax form reminder interval (days)
          </label>
          <input
            type="number"
            min="1"
            value={settings.expired_reminder_interval_days ?? 15}
            onChange={(e) => setSettings({ ...settings, expired_reminder_interval_days: parseInt(e.target.value) || 15 })}
            style={{
              width: "100%",
              padding: "8px",
              border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1",
              borderRadius: "6px",
              background: isDarkMode ? "#0f172a" : "#fff",
              color: isDarkMode ? "#f8fafc" : "#0f172a",
              fontSize: "1rem",
            }}
          />
          <p style={{ margin: "8px 0 0 0", fontSize: "0.85rem", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>
            Once a tax form is expired, send the expired reminder every 15 days.
          </p>
        </div>

        <div style={{ padding: "12px", borderRadius: "8px", background: isDarkMode ? "#1e293b" : "#f1f5f9" }}>
          <label style={{ display: "block", marginBottom: "8px", fontWeight: 600, color: isDarkMode ? "#f8fafc" : "#0f172a" }}>
            Monthly unsubmitted reminder day
          </label>
          <input
            type="number"
            min="1"
            max="31"
            value={settings.monthly_unsubmitted_reminder_day ?? 9}
            onChange={(e) => setSettings({ ...settings, monthly_unsubmitted_reminder_day: Math.min(31, Math.max(1, parseInt(e.target.value) || 9)) })}
            style={{
              width: "100%",
              padding: "8px",
              border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1",
              borderRadius: "6px",
              background: isDarkMode ? "#0f172a" : "#fff",
              color: isDarkMode ? "#f8fafc" : "#0f172a",
              fontSize: "1rem",
            }}
          />
          <p style={{ margin: "8px 0 0 0", fontSize: "0.85rem", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>
            If a contributor has not submitted a tax form, send the reminder template on the 9th of every month.
          </p>
        </div>

        {/* Enable Approval Notification */}
        <div style={{ padding: "12px", borderRadius: "8px", background: isDarkMode ? "#1e293b" : "#f1f5f9" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={settings.enable_approval_notification}
              onChange={(e) => setSettings({ ...settings, enable_approval_notification: e.target.checked })}
              style={{ cursor: "pointer" }}
            />
            <span style={{ fontWeight: 600, color: isDarkMode ? "#f8fafc" : "#0f172a" }}>Notify on Approval</span>
          </label>
          <p style={{ margin: "8px 0 0 32px", fontSize: "0.85rem", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>
            Send email notification when a tax form is approved
          </p>
        </div>

        {/* Enable Rejection Notification */}
        <div style={{ padding: "12px", borderRadius: "8px", background: isDarkMode ? "#1e293b" : "#f1f5f9" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={settings.enable_rejection_notification}
              onChange={(e) => setSettings({ ...settings, enable_rejection_notification: e.target.checked })}
              style={{ cursor: "pointer" }}
            />
            <span style={{ fontWeight: 600, color: isDarkMode ? "#f8fafc" : "#0f172a" }}>Notify on Rejection</span>
          </label>
          <p style={{ margin: "8px 0 0 32px", fontSize: "0.85rem", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>
            Send email notification when a tax form is rejected
          </p>
        </div>

        {/* Save Button */}
        <button
          onClick={saveSettings}
          disabled={loading}
          style={{
            padding: "10px 16px",
            background: "#1976d2",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.6 : 1,
            marginTop: "12px",
          }}
        >
          {loading ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
