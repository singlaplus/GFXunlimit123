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

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      // Load from local storage
      const saved = localStorage.getItem("taxMailTemplates");
      if (saved) {
        setTemplates(JSON.parse(saved));
      } else {
        setTemplates(DEFAULT_TEMPLATES);
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
      localStorage.setItem("taxMailTemplates", JSON.stringify(templates));
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
            <h4 style={{ margin: 0, color: isDarkMode ? "#f8fafc" : "#0f172a" }}>{currentTemplate.name || "Template"}</h4>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => setEditMode(!editMode)}
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
                {editMode ? "Done" : "Edit"}
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
            {editMode ? (
              <textarea
                value={currentTemplate.body}
                onChange={(e) =>
                  setTemplates({
                    ...templates,
                    [selectedTemplate]: { ...currentTemplate, body: e.target.value },
                  })
                }
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
          </div>

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
