function LoadingMessage({ loading, darkMode }) {
  if (!loading) return null;

  return (
    <h2 style={{ color: darkMode ? "#f5f5f5" : "#111" }}>
      Loading images...
    </h2>
  );
}

export default LoadingMessage;