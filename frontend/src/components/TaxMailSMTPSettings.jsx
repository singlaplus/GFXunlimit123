import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

const DEFAULT_SETTINGS = {
  smtp_from_name: "GFXunlimit Tax Forms",
  smtp_from_email: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: ""
};

export default function TaxMailSMTPSettings({ isDarkMode, getEffectiveAuthToken }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [testMailOpen, setTestMailOpen] = useState(false);
  const [testMailRecipient, setTestMailRecipient] = useState("");

  useEffect(() => {
    fetchSMTPSettings();
  }, []);

  const fetchSMTPSettings = async () => {
    try {
      const token = getEffectiveAuthToken ? getEffectiveAuthToken() : null;
      const response = await axios.get(`${API_BASE_URL}/admin/email/tax-mail-config`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const serverSettings = response.data?.smtp_settings || {};
      const localSettings = localStorage.getItem("taxMailSMTPSettings");
      const legacySettings = localSettings ? JSON.parse(localSettings) : {};
      setSettings({
        ...DEFAULT_SETTINGS,
        smtp_from_name: serverSettings.sender_name || legacySettings.smtp_from_name || DEFAULT_SETTINGS.smtp_from_name,
        smtp_from_email: serverSettings.sender_email || legacySettings.smtp_from_email || "",
        smtp_host: serverSettings.smtp_host || legacySettings.smtp_host || "",
        smtp_port: serverSettings.smtp_port || legacySettings.smtp_port || 587,
        smtp_username: serverSettings.smtp_user || legacySettings.smtp_username || "",
        smtp_password: serverSettings.smtp_pass || legacySettings.smtp_password || ""
      });
      if (!response.data?.updated_at && legacySettings.smtp_host && legacySettings.smtp_password) {
        await axios.put(`${API_BASE_URL}/admin/email/tax-mail-config`, { smtp_settings: {
          sender_name: legacySettings.smtp_from_name || DEFAULT_SETTINGS.smtp_from_name,
          sender_email: legacySettings.smtp_from_email || "",
          smtp_host: legacySettings.smtp_host,
          smtp_port: Number(legacySettings.smtp_port || 587),
          smtp_user: legacySettings.smtp_username || "",
          smtp_pass: legacySettings.smtp_password,
          smtp_secure: Number(legacySettings.smtp_port || 587) === 465
        } }, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
      }
    } catch (error) {
      console.error("Unable to load tax SMTP settings", error);
    }
  };

  const updateSetting = (key, value) => {
    setSettings((currentSettings) => ({ ...currentSettings, [key]: value }));
  };

  const validateSettings = () => {
    const requiredFields = [
      ["Sender name", settings.smtp_from_name],
      ["Sender email", settings.smtp_from_email],
      ["SMTP host", settings.smtp_host],
      ["SMTP port", settings.smtp_port],
      ["SMTP username", settings.smtp_username],
      ["SMTP password", settings.smtp_password]
    ];
    const missingField = requiredFields.find(([, value]) => !String(value || "").trim());
    if (missingField) {
      toast.warning(`${missingField[0]} is required.`);
      return false;
    }
    return true;
  };

  const saveSMTPSettings = async () => {
    if (!validateSettings()) return;
    try {
      setSaving(true);
      const token = getEffectiveAuthToken ? getEffectiveAuthToken() : null;
      await axios.put(`${API_BASE_URL}/admin/email/tax-mail-config`, { smtp_settings: normalizeSettingsForApi() }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      toast.success("SMTP settings saved for tax forms.");
    } finally {
      setSaving(false);
    }
  };

  const normalizeSettingsForApi = () => ({
    sender_name: settings.smtp_from_name,
    sender_email: settings.smtp_from_email,
    smtp_host: settings.smtp_host,
    smtp_port: Number(settings.smtp_port || 587),
    smtp_user: settings.smtp_username,
    smtp_pass: settings.smtp_password,
    smtp_secure: Number(settings.smtp_port || 587) === 465
  });

  const verifySMTPSettings = async () => {
    if (!validateSettings()) return;
    try {
      setVerifying(true);
      const token = getEffectiveAuthToken ? getEffectiveAuthToken() : null;
      await axios.post(`${API_BASE_URL}/admin/email/tax-mail/verify`, normalizeSettingsForApi(), {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      toast.success("SMTP settings are complete and ready to use.");
    } catch (error) {
      const details = error.response?.data?.error || error.response?.data?.detail || "Unable to verify SMTP settings.";
      toast.error(details);
    } finally {
      setVerifying(false);
    }
  };

  const sendTestMail = async () => {
    if (!validateSettings()) return;
    setTestMailOpen(true);
  };

  const submitTestMail = async () => {
    const recipient = String(testMailRecipient || "").trim();
    if (!recipient) {
      toast.warning("Recipient email is required.");
      return;
    }

    try {
      setSending(true);
      const token = getEffectiveAuthToken ? getEffectiveAuthToken() : null;
      await axios.post(`${API_BASE_URL}/admin/email/tax-mail/send-test`, {
        to: recipient,
        subject: "Tax form SMTP test email",
        body: "<p>Tax form SMTP test email</p>"
      }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      toast.success(`Test mail sent to ${recipient}.`);
      setTestMailOpen(false);
      setTestMailRecipient("");
    } catch (error) {
      const details = error.response?.data?.error || error.response?.data?.detail || "Unable to send test mail.";
      toast.error(details);
    } finally {
      setSending(false);
    }
  };

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1",
    borderRadius: "6px",
    background: isDarkMode ? "#0f172a" : "#fff",
    color: isDarkMode ? "#f8fafc" : "#0f172a",
    fontSize: "0.95rem"
  };

  const fields = [
    { key: "smtp_from_name", label: "Sender name", type: "text" },
    { key: "smtp_from_email", label: "Sender email", type: "email" },
    { key: "smtp_host", label: "SMTP host", type: "text" },
    { key: "smtp_port", label: "SMTP port", type: "number" },
    { key: "smtp_username", label: "SMTP username", type: "text" },
    { key: "smtp_password", label: "SMTP password", type: "password" }
  ];

  return (
    <div style={{ padding: "20px", maxHeight: "80vh", overflowY: "auto" }}>
      <div style={{ display: "grid", gap: "14px" }}>
        {fields.map(({ key, label, type }) => (
          <label key={key} style={{ display: "grid", gap: "6px", color: isDarkMode ? "#f8fafc" : "#0f172a", fontWeight: 600 }}>
            <span>{label}</span>
            <input
              type={type}
              min={type === "number" ? "1" : undefined}
              value={settings[key]}
              onChange={(event) => updateSetting(key, type === "number" ? Number(event.target.value) : event.target.value)}
              style={inputStyle}
            />
          </label>
        ))}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
          <button type="button" onClick={verifySMTPSettings} disabled={verifying || saving || sending} style={{ padding: "10px 14px", border: 0, borderRadius: "6px", background: "#455a64", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            {verifying ? "Verifying..." : "Verify SMTP Settings"}
          </button>
          <button type="button" onClick={saveSMTPSettings} disabled={saving || verifying || sending} style={{ padding: "10px 14px", border: 0, borderRadius: "6px", background: "#1976d2", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            {saving ? "Saving..." : "Save SMTP for Tax forms"}
          </button>
          <button type="button" onClick={sendTestMail} disabled={sending || saving || verifying} style={{ padding: "10px 14px", border: 0, borderRadius: "6px", background: "#2e7d32", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            {sending ? "Sending..." : "Send Test Mail"}
          </button>
        </div>
      </div>

      {testMailOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(2, 6, 23, 0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div role="dialog" aria-modal="true" aria-label="Send Test Mail" style={{ width: "100%", maxWidth: 460, padding: 22, borderRadius: 14, background: isDarkMode ? "#0f172a" : "#fff", color: isDarkMode ? "#f8fafc" : "#0f172a", boxShadow: "0 24px 70px rgba(0,0,0,0.28)" }}>
            <h3 style={{ margin: "0 0 8px" }}>Send Test Mail</h3>
            <p style={{ margin: "0 0 16px", color: isDarkMode ? "#cbd5e1" : "#64748b", fontSize: 13 }}>Enter the email address that should receive this tax form test mail.</p>
            <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 600 }}>
              Recipient email
              <input
                type="email"
                autoFocus
                value={testMailRecipient}
                onChange={(event) => setTestMailRecipient(event.target.value)}
                placeholder="recipient@example.com"
                style={{ padding: "10px 12px", borderRadius: 8, border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1", background: isDarkMode ? "#111827" : "#fff", color: isDarkMode ? "#f8fafc" : "#0f172a" }}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button type="button" onClick={() => setTestMailOpen(false)} style={{ padding: "10px 14px", borderRadius: 8, border: 0, background: isDarkMode ? "#334155" : "#e2e8f0", color: isDarkMode ? "#f8fafc" : "#0f172a", cursor: "pointer", fontWeight: 600 }}>
                Cancel
              </button>
              <button type="button" onClick={submitTestMail} disabled={sending || !testMailRecipient.trim()} style={{ padding: "10px 14px", borderRadius: 8, border: 0, background: "#0f766e", color: "#fff", cursor: sending || !testMailRecipient.trim() ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {sending ? "Sending..." : "Send Test Mail"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
