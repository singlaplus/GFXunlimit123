function CategoryFilter({
  selectedCategory,
  setSelectedCategory,
  setCurrentPage,
}) {
  const categories = [
    "All",
    "nature",
    "travel",
    "animals",
  ];

  return (
    <>
      <h3
        style={{
          marginBottom: "10px",
        }}
      >
        📂 Categories
      </h3>

      <div
        style={{
          marginBottom: "25px",
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => {
              setSelectedCategory(cat);
              setCurrentPage(1);
            }}
            style={{
              padding: "10px 18px",
              borderRadius: "10px",
              border: "none",
              cursor: "pointer",
              background:
                selectedCategory === cat
                  ? "#2196f3"
                  : "#ddd",
              color:
                selectedCategory === cat
                  ? "white"
                  : "black",
            }}
          >
            {cat}
          </button>
        ))}
      </div>
    </>
  );
}

export default CategoryFilter;