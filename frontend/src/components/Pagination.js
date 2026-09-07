function Pagination(props) {
  const {
    currentPage,
    totalPages,
    totalImages,
    setCurrentPage,
    darkMode,
  } = props;

  const goToPage = (page) => {
    setCurrentPage(page);
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
    }
  };

  const baseButtonStyle = {
    minWidth: "42px",
    height: "38px",
    padding: "0 14px",
    borderRadius: "999px",
    border: darkMode ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,23,42,0.12)",
    background: darkMode ? "rgba(25, 30, 38, 0.9)" : "rgba(255,255,255,0.8)",
    color: darkMode ? "#f8fafc" : "#0f172a",
    fontSize: "0.82rem",
    fontWeight: 600,
    letterSpacing: "0.01em",
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxShadow: darkMode ? "0 8px 18px rgba(0,0,0,0.28)" : "0 8px 18px rgba(15,23,42,0.08)",
    backdropFilter: "blur(8px)",
  };

  const navButtonStyle = {
    ...baseButtonStyle,
    opacity: currentPage === 1 ? 0.5 : 1,
    cursor: currentPage === 1 ? "not-allowed" : "pointer",
  };

  const activePageStyle = {
    ...baseButtonStyle,
    background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
    borderColor: "transparent",
    color: "#fff",
    boxShadow: "0 10px 20px rgba(37, 99, 235, 0.35)",
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: "10px",
        marginTop: "30px",
        flexWrap: "wrap",
        padding: "18px 20px",
        borderRadius: "24px",
        background: darkMode ? "rgba(15, 23, 42, 0.82)" : "rgba(248, 250, 252, 0.9)",
        border: darkMode ? "1px solid rgba(148,163,184,0.2)" : "1px solid rgba(148,163,184,0.25)",
        boxShadow: darkMode ? "0 16px 38px rgba(2, 6, 23, 0.32)" : "0 16px 38px rgba(15, 23, 42, 0.09)",
      }}
    >
      <button
        disabled={currentPage === 1}
        onClick={() => goToPage(1)}
        style={{
          ...navButtonStyle,
          padding: "0 12px",
        }}
      >
        ⏮ First
      </button>

      <button
        disabled={currentPage === 1}
        onClick={() => goToPage(currentPage - 1)}
        style={{
          ...navButtonStyle,
          padding: "0 12px",
        }}
      >
        ◀ Prev
      </button>

      {[...Array(totalPages)].map((_, index) => {
        const isCurrent = currentPage === index + 1;

        return (
          <button
            key={index}
            onClick={() => goToPage(index + 1)}
            style={
              isCurrent
                ? {
                    ...activePageStyle,
                    minWidth: "40px",
                    padding: "0 12px",
                  }
                : {
                    ...baseButtonStyle,
                    minWidth: "40px",
                    padding: "0 12px",
                    opacity: 0.9,
                  }
            }
          >
            {index + 1}
          </button>
        );
      })}

      <button
        disabled={currentPage === totalPages}
        onClick={() => goToPage(currentPage + 1)}
        style={{
          ...navButtonStyle,
          opacity: currentPage === totalPages ? 0.5 : 1,
          cursor: currentPage === totalPages ? "not-allowed" : "pointer",
          padding: "0 12px",
        }}
      >
        Next ▶
      </button>

      <button
        disabled={currentPage === totalPages}
        onClick={() => goToPage(totalPages)}
        style={{
          ...navButtonStyle,
          opacity: currentPage === totalPages ? 0.5 : 1,
          cursor: currentPage === totalPages ? "not-allowed" : "pointer",
          padding: "0 12px",
        }}
      >
        Last ⏭
      </button>

      <p
        style={{
          marginTop: "12px",
          marginBottom: "0",
          textAlign: "center",
          fontWeight: "700",
          width: "100%",
          letterSpacing: "0.04em",
          color: darkMode ? "#f8fafc" : "#0f172a",
          fontSize: "0.82rem",
          textTransform: "uppercase",
        }}
      >
        Page {currentPage} of {totalPages}
      </p>

      <p
        style={{
          margin: "0",
          textAlign: "center",
          width: "100%",
          color: darkMode ? "#cbd5e1" : "#475569",
          fontSize: "0.8rem",
        }}
      >
        Total Assets: {totalImages}
      </p>
    </div>
  );
}

export default Pagination;