function CollectionFilter({
  collections,
  selectedCollection,
  setSelectedCollection,
  setCurrentPage,
}) {
  return (
    <>
      <h3
        style={{
          marginBottom: "10px",
        }}
      >
        📁 Collections
      </h3>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "25px",
        }}
      >
        <button
          onClick={() => {
            setSelectedCollection("All");
            setCurrentPage(1);
          }}
          style={{
            padding: "10px 18px",
            border: "none",
            borderRadius: "10px",
            cursor: "pointer",
            background:
              selectedCollection === "All"
                ? "#4caf50"
                : "#ddd",
            color:
              selectedCollection === "All"
                ? "white"
                : "black",
          }}
        >
          📁 All
        </button>

        {collections.map((collection) => (
          <button
            key={collection}
            onClick={() => {
              setSelectedCollection(collection);
              setCurrentPage(1);
            }}
            style={{
              padding: "10px 18px",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
              background:
                selectedCollection === collection
                  ? "#4caf50"
                  : "#ddd",
              color:
                selectedCollection === collection
                  ? "white"
                  : "black",
            }}
          >
            📁 {collection}
          </button>
        ))}
      </div>
    </>
  );
}

export default CollectionFilter;