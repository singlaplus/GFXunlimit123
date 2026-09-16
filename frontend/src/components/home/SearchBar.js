function SearchBar({
  search,
  setSearch,
  setCurrentPage,
}) {
  return (
    <input
      type="text"
      placeholder="Search images..."
      value={search}
      onChange={(e) => {
        setSearch(e.target.value);
        setCurrentPage(1);
      }}
      style={{
        width: "100%",
        padding: "14px",
        marginBottom: "20px",
        borderRadius: "12px",
        border: "1px solid #ccc",
      }}
    />
  );
}

export default SearchBar;