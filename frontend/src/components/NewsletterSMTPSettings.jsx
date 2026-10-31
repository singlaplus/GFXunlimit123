import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect, useState } from "react";
import axios from "axios";
import { buildAuthHeaders } from "../utils/authSession";
import "./NewsletterSMTPSettings.css";

const EMPTY_SETTINGS = {
  sender_name: "",
  sender_email: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_user: "",
  smtp_pass: ""
};

const SMTP_FIELDS = [
  { key: "sender_name", label: "Sender name", type: "text" },
  { key: "sender_email", label: "Sender email", type: "email" },
  { key: "smtp_host", label: "SMTP host", type: "text" },
  { key: "smtp_port", label: "SMTP port", type: "number" },
  { key: "smtp_user", label: "SMTP username", type: "text" },
  { key: "smtp_pass", label: "SMTP password", type: "password" }
];

const authConfig = () => ({ headers: buildAuthHeaders() });

export default function NewsletterSMTPSettings() {
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const [isTestDialogOpen, setIsTestDialogOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  useEffect(() => {
    let active = true;
    axios.get(`${API_BASE_URL}/admin/email/newsletter-smtp-settings`, authConfig())
      .then((response) => {
        if (active) setSettings({ ...EMPTY_SETTINGS, ...response.data });
      })
      .catch((error) => {
        console.error("Unable to load newsletter SMTP settings", error);
        if (active) {
          setMessage(error.response?.data?.error || "Unable to load newsletter SMTP settings.");
          setMessageType("error");
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  const updateSetting = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage("");
  };

  const validate = () => {
    const missing = SMTP_FIELDS.find(({ key, label }) => !String(settings[key] || "").trim() && label);
    if (missing) {
      setMessage(`${missing.label} is required.`);
      setMessageType("error");
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.sender_email)) {
      setMessage("Enter a valid sender email address.");
      setMessageType("error");
      return false;
    }
    if (!Number.isInteger(Number(settings.smtp_port)) || Number(settings.smtp_port) < 1 || Number(settings.smtp_port) > 65535) {
      setMessage("SMTP port must be between 1 and 65535.");
      setMessageType("error");
      return false;
    }
    return true;
  };

  const verifySettings = async () => {
    if (!validate()) return;
    setIsVerifying(true);
    try {
      await axios.post(
        `${API_BASE_URL}/admin/email/newsletter-smtp-settings/verify`,
        { ...settings, smtp_port: Number(settings.smtp_port) },
        authConfig()
      );
      setMessage("SMTP connection verified successfully.");
      setMessageType("success");
    } catch (error) {
      console.error("Unable to verify newsletter SMTP settings", error);
      setMessage(error.response?.data?.error || "Unable to verify SMTP settings.");
      setMessageType("error");
    } finally {
      setIsVerifying(false);
    }
  };

  const saveSettings = async () => {
    if (!validate()) return;
    setIsSaving(true);
    try {
      const response = await axios.put(
        `${API_BASE_URL}/admin/email/newsletter-smtp-settings`,
        { ...settings, smtp_port: Number(settings.smtp_port) },
        authConfig()
      );
      setSettings((current) => ({ ...current, ...response.data }));
      setMessage("SMTP settings saved for newsletters.");
      setMessageType("success");
    } catch (error) {
      console.error("Unable to save newsletter SMTP settings", error);
      setMessage(error.response?.data?.error || "Unable to save newsletter SMTP settings.");
      setMessageType("error");
    } finally {
      setIsSaving(false);
    }
  };

  const sendTestMail = async () => {
    if (!validate()) return;
    const recipient = testRecipient.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setMessage("Enter a valid test recipient email address.");
      setMessageType("error");
      return;
    }

    setIsSendingTest(true);
    try {
      await axios.post(
        `${API_BASE_URL}/admin/email/newsletter-smtp-settings/test`,
        {
          to: recipient,
          settings: { ...settings, smtp_port: Number(settings.smtp_port) }
        },
        authConfig()
      );
      setMessage(`Test email sent to ${recipient}.`);
      setMessageType("success");
      setIsTestDialogOpen(false);
      setTestRecipient("");
    } catch (error) {
      console.error("Unable to send newsletter SMTP test email", error);
      setMessage(error.response?.data?.error || "Unable to send the test email.");
      setMessageType("error");
    } finally {
      setIsSendingTest(false);
    }
  };

  const busy = isSaving || isVerifying || isSendingTest || isLoading;

  return (
    <section className="newsletter-smtp-card" aria-labelledby="newsletter-smtp-heading">
      <header className="newsletter-smtp-header">
        <div>
          <span className="newsletter-smtp-eyebrow">NEWSLETTER DELIVERY</span>
          <h3 id="newsletter-smtp-heading">SMTP Settings</h3>
          <p>Configure the mail server used specifically for newsletter campaigns.</p>
        </div>
        <span className="newsletter-smtp-status">Newsletter only</span>
      </header>

      {message && (
        <p className={`newsletter-smtp-message is-${messageType}`} role={messageType === "error" ? "alert" : "status"}>
          {message}
        </p>
      )}

      <div className="newsletter-smtp-fields">
        {SMTP_FIELDS.map(({ key, label, type }) => (
          <label key={key} className="newsletter-smtp-field">
            <span>{label}</span>
            <input
              aria-label={label}
              type={type}
              min={type === "number" ? "1" : undefined}
              max={type === "number" ? "65535" : undefined}
              value={settings[key]}
              disabled={isLoading}
              autoComplete={key === "smtp_pass" ? "new-password" : "off"}
              onChange={(event) => updateSetting(key, event.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="newsletter-smtp-actions">
        <button type="button" className="is-secondary" onClick={verifySettings} disabled={busy}>
          {isVerifying ? "Verifying..." : "Verify SMTP Settings"}
        </button>
        <button type="button" onClick={saveSettings} disabled={busy}>
          {isSaving ? "Saving..." : "Save SMTP for newsletter"}
        </button>
        <button type="button" className="is-test" onClick={() => setIsTestDialogOpen(true)} disabled={busy}>
          Send Test Mail
        </button>
      </div>

      {isTestDialogOpen && (
        <div className="newsletter-smtp-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isSendingTest) setIsTestDialogOpen(false);
        }}>
          <section className="newsletter-smtp-dialog" role="dialog" aria-modal="true" aria-labelledby="newsletter-smtp-test-heading">
            <h3 id="newsletter-smtp-test-heading">Send Test Mail</h3>
            <p>Enter the recipient address for a test using these newsletter SMTP settings.</p>
            <label className="newsletter-smtp-field">
              <span>Recipient email</span>
              <input
                autoFocus
                aria-label="Test recipient email"
                type="email"
                value={testRecipient}
                onChange={(event) => setTestRecipient(event.target.value)}
                placeholder="recipient@example.com"
              />
            </label>
            <div className="newsletter-smtp-dialog-actions">
              <button type="button" className="is-secondary" disabled={isSendingTest} onClick={() => setIsTestDialogOpen(false)}>
                Cancel
              </button>
              <button type="button" disabled={isSendingTest} onClick={sendTestMail}>
                {isSendingTest ? "Sending..." : "Send Test Mail"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
