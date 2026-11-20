function LoadingMessage({ loading, darkMode, search = "" }) {
  if (!loading) return null;

  return (
    <h2 role="status" style={{ color: darkMode ? "#f5f5f5" : "#111" }}>
      {search.trim() ? "Searching images..." : "Loading images..."}
    </h2>
  );
}

export default LoadingMessage;