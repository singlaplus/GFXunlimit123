import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

const DEFAULT_TEMPLATES = {
  reminder: {
    name: "Tax Form Reminder",
    subject: "Please Submit Your Tax Form",
    body: `Dear {{contributor_name}},

This is a friendly reminder that we haven't yet received your tax form.

To ensure timely payment processing, please submit your tax information as soon as possible by logging into your contributor account.

If you have already submitted your form, please disregard this message.

Best regards,
The Team`,
  },
  approved: {
    name: "Tax Form Approved",
    subject: "Your Tax Form Has Been Approved",
    body: `Dear {{contributor_name}},

Good news! Your tax form has been reviewed and approved.

You are now cleared for payment processing. Earnings will be processed according to our regular payment schedule.

Thank you for your contribution!

Best regards,
The Team`,
  },
  rejected: {
    name: "Tax Form Requires Revision",
    subject: "Action Required: Tax Form Revision",
    body: `Dear {{contributor_name}},

We've reviewed your tax form and need some additional information or corrections.

Please log into your account and resubmit your form with the necessary updates. Our support team is available if you have any questions.

Best regards,
The Team`,
  },
};

export default function TaxMailTemplates({ isDarkMode, getEffectiveAuthToken }) {
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [selectedTemplate, setSelectedTemplate] = useState("reminder");
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [imageDimensions, setImageDimensions] = useState(null);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const token = getEffectiveAuthToken ? getEffectiveAuthToken() : null;
      const response = await axios.get(`${API_BASE_URL}/admin/email/tax-mail-config`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const saved = localStorage.getItem("taxMailTemplates");
      const serverTemplates = response.data?.templates;
      const nextTemplates = response.data?.updated_at
        ? serverTemplates
        : (saved ? JSON.parse(saved) : DEFAULT_TEMPLATES);
      setTemplates({ ...DEFAULT_TEMPLATES, ...nextTemplates });
      if (!response.data?.updated_at && saved) {
        await axios.put(`${API_BASE_URL}/admin/email/tax-mail-config`, { templates: nextTemplates }, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const saveTemplates = async () => {
    try {
      setLoading(true);
      const token = getEffectiveAuthToken ? getEffectiveAuthToken() : null;
      await axios.put(`${API_BASE_URL}/admin/email/tax-mail-config`, { templates }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      toast.success("Tax mail templates saved.");
      setEditMode(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to save tax mail templates.");
    } finally {
      setLoading(false);
    }
  };

  const resetToDefault = () => {
    if (window.confirm("Reset this template to default?")) {
      setTemplates({
        ...templates,
        [selectedTemplate]: DEFAULT_TEMPLATES[selectedTemplate],
      });
      toast.info("Template reset to default.");
    }
  };

  const currentTemplate = templates[selectedTemplate] || {};
  const accentColor = currentTemplate.accentColor || "#0f766e";
  const fontFamily = currentTemplate.fontFamily || "Georgia, serif";

  const updateCurrentTemplate = (changes) => {
    setTemplates({
      ...templates,
      [selectedTemplate]: { ...currentTemplate, ...changes },
    });
  };

  const insertIntoBody = (value) => {
    updateCurrentTemplate({ body: `${currentTemplate.body || ""}${currentTemplate.body ? "\n" : ""}${value}` });
  };

  const replaceBodySelection = (before, after = before) => {
    const textarea = document.getElementById("tax-mail-template-body");
    const body = currentTemplate.body || "";
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    updateCurrentTemplate({ body: `${body.slice(0, start)}${before}${body.slice(start, end)}${after}${body.slice(end)}` });
  };

  const uploadTemplateImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setLoading(true);
      const token = getEffectiveAuthToken ? getEffectiveAuthToken() : null;
      const formData = new FormData();
      formData.append("image", file);
      const response = await axios.post(`${API_BASE_URL}/admin/email/upload-image`, formData, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "multipart/form-data" }
      });
      updateCurrentTemplate({ imageUrl: response.data.url });
      toast.success("Template image uploaded. Save the template to keep it.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Failed to upload template image.");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const previewLines = String(currentTemplate.body || "")
    .replace(/\{\{\s*contributor_name\s*\}\}/gi, "Aarav Contributor")
    .replace(/\{\{\s*form_type\s*\}\}/gi, "W-8BEN")
    .replace(/\{\{\s*submission_date\s*\}\}/gi, "September 17, 2026")
    .split("\n");
  const previewImage = currentTemplate.imageUrl && (currentTemplate.imageUrl.startsWith("http") ? currentTemplate.imageUrl : `${API_BASE_URL}${currentTemplate.imageUrl}`);

  return (
    <div style={{ padding: "20px", maxHeight: "80vh", overflowY: "auto" }}>
      <h3 style={{ margin: "0 0 20px 0", color: isDarkMode ? "#f8fafc" : "#0f172a" }}>Tax Form Email Templates</h3>

      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "20px" }}>
        {/* Template List */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {Object.entries(templates).map(([key, template]) => (
            <button
              key={key}
              onClick={() => setSelectedTemplate(key)}
              style={{
                padding: "10px 12px",
                border: selectedTemplate === key ? "2px solid #1976d2" : "1px solid #cbd5e1",
                borderRadius: "6px",
                background: selectedTemplate === key ? (isDarkMode ? "#1e3a8a" : "#eff6ff") : isDarkMode ? "#1e293b" : "#f8fafc",
                color: isDarkMode ? "#f8fafc" : "#0f172a",
                cursor: "pointer",
                textAlign: "left",
                fontWeight: selectedTemplate === key ? 700 : 600,
              }}
            >
              {template.name}
            </button>
          ))}
        </div>

        {/* Template Editor */}
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <h4 style={{ margin: 0, color: isDarkMode ? "#f8fafc" : "#0f172a" }}>{currentTemplate.name || "Template"}</h4>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setPreviewMode((value) => !value)}
                style={{ padding: "6px 10px", background: previewMode ? "#0f766e" : (isDarkMode ? "#334155" : "#e2e8f0"), color: previewMode || isDarkMode ? "#fff" : "#0f172a", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem" }}
              >
                {previewMode ? "Hide preview" : "Preview email"}
              </button>
              <button
                onClick={() => (editMode ? saveTemplates() : setEditMode(true))}
                disabled={loading}
                style={{
                  padding: "6px 10px",
                  background: editMode ? "#2e7d32" : "#1976d2",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                {loading ? "Saving..." : editMode ? "Save" : "Edit"}
              </button>
              {editMode && (
                <button
                  onClick={resetToDefault}
                  style={{
                    padding: "6px 10px",
                    background: "#757575",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontWeight: 600, fontSize: "0.9rem", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>
              Subject
            </label>
            {editMode ? (
              <input
                type="text"
                value={currentTemplate.subject}
                onChange={(e) =>
                  setTemplates({
                    ...templates,
                    [selectedTemplate]: { ...currentTemplate, subject: e.target.value },
                  })
                }
                style={{
                  width: "100%",
                  padding: "8px",
                  border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1",
                  borderRadius: "6px",
                  background: isDarkMode ? "#0f172a" : "#fff",
                  color: isDarkMode ? "#f8fafc" : "#0f172a",
                  fontSize: "0.9rem",
                }}
              />
            ) : (
              <div style={{ padding: "8px", background: isDarkMode ? "#1e293b" : "#f1f5f9", borderRadius: "6px", color: isDarkMode ? "#f8fafc" : "#0f172a" }}>
                {currentTemplate.subject}
              </div>
            )}
          </div>

          {/* Body */}
          <div>
            <label style={{ display: "block", marginBottom: "4px", fontWeight: 600, fontSize: "0.9rem", color: isDarkMode ? "#cbd5e1" : "#64748b" }}>
              Email Body
            </label>
            {editMode && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, padding: 8, border: isDarkMode ? "1px solid #334155" : "1px solid #e2e8f0", borderRadius: 8, background: isDarkMode ? "#111827" : "#f8fafc" }}>
                <button type="button" onClick={() => replaceBodySelection("**", "**")} style={{ padding: "5px 9px", border: 0, borderRadius: 5, cursor: "pointer", fontWeight: 800 }}>B</button>
                <button type="button" onClick={() => replaceBodySelection("_", "_")} style={{ padding: "5px 9px", border: 0, borderRadius: 5, cursor: "pointer", fontStyle: "italic" }}>I</button>
                <button type="button" onClick={() => insertIntoBody("• ")} style={{ padding: "5px 9px", border: 0, borderRadius: 5, cursor: "pointer" }}>List</button>
                <button type="button" onClick={() => insertIntoBody("[Review your tax form](https://example.com)")} style={{ padding: "5px 9px", border: 0, borderRadius: 5, cursor: "pointer" }}>Link</button>
                {['{{contributor_name}}', '{{form_type}}', '{{submission_date}}'].map((variable) => (
                  <button key={variable} type="button" onClick={() => insertIntoBody(variable)} style={{ padding: "5px 8px", border: 0, borderRadius: 5, cursor: "pointer", color: isDarkMode ? "#bae6fd" : "#0369a1", background: isDarkMode ? "#164e63" : "#e0f2fe", fontSize: 11 }}>{variable}</button>
                ))}
              </div>
            )}
            {editMode ? (
              <textarea
                id="tax-mail-template-body"
                value={currentTemplate.body}
                onChange={(e) => updateCurrentTemplate({ body: e.target.value })}
                style={{
                  width: "100%",
                  minHeight: "300px",
                  padding: "8px",
                  border: isDarkMode ? "1px solid #475569" : "1px solid #cbd5e1",
                  borderRadius: "6px",
                  background: isDarkMode ? "#0f172a" : "#fff",
                  color: isDarkMode ? "#f8fafc" : "#0f172a",
                  fontSize: "0.9rem",
                  fontFamily: "monospace",
                }}
              />
            ) : (
              <div
                style={{
                  padding: "12px",
                  background: isDarkMode ? "#1e293b" : "#f1f5f9",
                  borderRadius: "6px",
                  color: isDarkMode ? "#f8fafc" : "#0f172a",
                  whiteSpace: "pre-wrap",
                  fontSize: "0.85rem",
                  lineHeight: 1.5,
                }}
              >
                {currentTemplate.body}
              </div>
            )}
            <p style={{ margin: "6px 0 0 0", fontSize: "0.75rem", color: isDarkMode ? "#94a3b8" : "#94a3b8" }}>
              Available variables: {'{{contributor_name}}, {{form_type}}, {{submission_date}}'}
            </p>
            {editMode && (
              <div style={{ display: "grid", gap: 8, marginTop: 12, padding: 12, borderRadius: 8, background: isDarkMode ? "#1e293b" : "#f8fafc" }}>
                <label style={{ fontSize: 12, fontWeight: 700 }}>Email image</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <label style={{ padding: "8px 11px", borderRadius: 6, background: "#0f766e", color: "#fff", cursor: loading ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
                    Add image
                    <input type="file" accept="image/*" onChange={uploadTemplateImage} disabled={loading} style={{ display: "none" }} />
                  </label>
                  <input type="url" value={currentTemplate.imageUrl || ""} onChange={(e) => updateCurrentTemplate({ imageUrl: e.target.value })} placeholder="Or paste an image URL" style={{ flex: "1 1 240px", minWidth: 180, padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6 }} />
                  {currentTemplate.imageUrl && <button type="button" onClick={() => updateCurrentTemplate({ imageUrl: "" })} style={{ padding: "8px 10px", border: 0, borderRadius: 6, background: isDarkMode ? "#451a1a" : "#fee2e2", color: isDarkMode ? "#fca5a5" : "#991b1b", cursor: "pointer", fontWeight: 700 }}>Remove</button>}
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.45, color: isDarkMode ? "#94a3b8" : "#64748b" }}>
                  Recommended image size: 652 × 220 px. JPG or PNG, maximum 8 MB. This matches the visible email preview area.
                  {imageDimensions && <span style={{ display: "block", marginTop: 3, color: isDarkMode ? "#cbd5e1" : "#475569", fontWeight: 700 }}>Current image: {imageDimensions.width} x {imageDimensions.height} px ({imageDimensions.ratio}:1)</span>}
                </div>
                {previewImage && <img src={previewImage} alt="Selected template" onLoad={(event) => { const { naturalWidth, naturalHeight } = event.currentTarget; setImageDimensions({ width: naturalWidth, height: naturalHeight, ratio: (naturalWidth / naturalHeight).toFixed(2) }); }} style={{ width: "100%", maxHeight: 140, objectFit: "cover", borderRadius: 8 }} />}
              </div>
            )}
          </div>

          {editMode && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, padding: 12, borderRadius: 8, background: isDarkMode ? "#1e293b" : "#f8fafc" }}>
              <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>
                Accent color
                <input type="color" value={accentColor} onChange={(e) => updateCurrentTemplate({ accentColor: e.target.value })} style={{ width: "100%", height: 34, border: 0, padding: 0, background: "transparent" }} />
              </label>
              <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>
                Body font
                <select value={fontFamily} onChange={(e) => updateCurrentTemplate({ fontFamily: e.target.value })} style={{ padding: 8, borderRadius: 6, border: "1px solid #cbd5e1" }}>
                  <option value="Georgia, serif">Editorial Serif</option>
                  <option value="Arial, sans-serif">Clean Sans</option>
                  <option value="Verdana, sans-serif">Modern Sans</option>
                </select>
              </label>
            </div>
          )}

          {previewMode && (
            <div className="tax-template-preview" style={{ border: isDarkMode ? "1px solid #334155" : "1px solid #dbe4ea", borderRadius: 14, overflow: "hidden", background: "#fff", color: "#1f2937", boxShadow: "0 16px 40px rgba(15, 23, 42, 0.12)" }}>
              <div style={{ padding: "26px 28px", background: `linear-gradient(135deg, ${accentColor}, #123c55)`, color: "#fff" }}>
                <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.78 }}>GFXunlimit Tax Services</div>
                <h4 style={{ margin: "10px 0 0", fontSize: 22 }}>{currentTemplate.subject || "Tax form update"}</h4>
              </div>
              <div className="tax-template-preview-body" style={{ padding: "28px", fontFamily, fontSize: 15, lineHeight: 1.65, color: "#1f2937" }}>
                {previewLines.map((line, index) => (
                  <React.Fragment key={`${line}-${index}`}>
                    {previewImage && /best regards\s*,?/i.test(line) && <img src={previewImage} alt="Template body" style={{ display: "block", width: "100%", maxHeight: 220, objectFit: "cover", margin: "20px 0 24px", borderRadius: 10 }} />}
                    {line.trim() ? <p style={{ margin: "0 0 14px" }}>{line}</p> : <div style={{ height: 4 }} />}
                  </React.Fragment>
                ))}
              </div>
              <div style={{ margin: "0 28px 26px", paddingTop: 18, borderTop: "1px solid #e5e7eb", color: "#64748b", fontFamily: "Arial, sans-serif", fontSize: 12 }}>Preview values are used for the template variables.</div>
            </div>
          )}

          {/* Save Button */}
          {editMode && (
            <button
              onClick={saveTemplates}
              disabled={loading}
              style={{
                padding: "10px 16px",
                background: "#2e7d32",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Saving..." : "Save All Templates"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
