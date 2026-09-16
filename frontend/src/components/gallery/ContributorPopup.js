function ContributorPopup({
  selectedContributor,
  setSelectedContributor,
  darkMode,
  contributorImages = [],
  contributorLikes = 0,
  contributorViews = 0,
  contributorDownloads = 0,
  contributorBestImage,
  fetchSingleImage,
}) {
  if (!selectedContributor) return null;

  return (
    <div
      onClick={() => setSelectedContributor(null)}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 10000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: darkMode ? "#1e1e1e" : "white",
          padding: "25px",
          borderRadius: "15px",
          width: "500px",
          maxWidth: "90%",
        }}
      >
        <h2>👤 {selectedContributor}</h2>

        <p>📸 Uploads: {contributorImages.length}</p>

        <p>❤️ Total Likes: {contributorLikes}</p>

        <p>👁 Total Views: {contributorViews}</p>

        <p>⬇ Total Downloads: {contributorDownloads}</p>

        <p>
          🏆 Best Image:{" "}
          {contributorBestImage
            ? contributorBestImage.title
            : "No Images"}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(120px,1fr))",
            gap: "10px",
            marginTop: "15px",
          }}
        >
          {contributorImages.map((image) => (
            <img
              key={`${image.id}-${image.filename}`}
              src={`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/api/images/${image.id}`}
              alt={image.title}
              onClick={() => {
                setSelectedContributor(null);
                fetchSingleImage(image.id);
              }}
              style={{
                width: "100%",
                height: "100px",
                objectFit: "cover",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            />
          ))}
        </div>

        <button
          onClick={() =>
            setSelectedContributor(null)
          }
          style={{
            marginTop: "20px",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default ContributorPopup;