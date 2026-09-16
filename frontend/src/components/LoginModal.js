import Login from "./Login";

function LoginModal({ show, onClose }) {
  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "#111827",
          color: "#f9fafb",
          padding: "30px",
          borderRadius: "12px",
          width: "450px",
          position: "relative",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.35)",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "10px",
            right: "15px",
            border: "none",
            background: "transparent",
            fontSize: "20px",
            cursor: "pointer",
            color: "#f9fafb",
          }}
        >
          ✖
        </button>

        <Login onSuccess={onClose} onClose={onClose} />
      </div>
    </div>
  );
}

export default LoginModal;