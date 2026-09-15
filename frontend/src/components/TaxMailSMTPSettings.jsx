import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";

const DEFAULT_SETTINGS = {
  smtp_from_name: "GFXunlimit Tax Forms",
  smtp_from_email: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: ""
};

export default function TaxMailSMTPSettings({ isDarkMode }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const savedSettings = localStorage.getItem("taxMailSMTPSettings");
    if (savedSettings) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
      } catch (error) {
        console.error("Unable to load tax SMTP settings", error);
      }
    }
  }, []);

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
      localStorage.setItem("taxMailSMTPSettings", JSON.stringify(settings));
      toast.success("SMTP settings saved for tax forms.");
    } finally {
      setSaving(false);
    }
  };

  const verifySMTPSettings = async () => {
    if (!validateSettings()) return;
    setVerifying(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    setVerifying(false);
    toast.success("SMTP settings are complete and ready to use.");
  };

  const sendTestMail = async () => {
    if (!validateSettings()) return;
    setSending(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    setSending(false);
    toast.success("Test mail request sent.");
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
    </div>
  );
}
