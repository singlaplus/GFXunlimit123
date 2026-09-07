import React from "react";

export default function EmailActionButton({ icon, label, color, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`admin-panel-email-button ${className}`.trim()}
      title={label}
      aria-label={label}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: "12px",
        background: color,
        color: "white",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0",
        fontWeight: 600,
        fontSize: "1.3rem",
        lineHeight: 1,
        whiteSpace: "nowrap",
        textAlign: "center",
        minHeight: "42px"
      }}
    >
      <span>{icon}</span>
    </button>
  );
}
