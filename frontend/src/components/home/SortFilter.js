function SortFilter({
  sortType,
  setSortType,
  setCurrentPage,
}) {
  return (
    <select
      value={sortType}
      onChange={(e) => {
        setSortType(e.target.value);
        setCurrentPage(1);
      }}
      style={{
        padding: "10px",
        borderRadius: "10px",
        marginBottom: "20px",
      }}
    >
      <option value="newest">
        Newest First
      </option>

      <option value="oldest">
        Oldest First
      </option>

      <option value="likes">
        Most Liked
      </option>

      <option value="downloads">
        Most Downloaded
      </option>

      <option value="views">
        Most Viewed
      </option>
    </select>
  );
}

export default SortFilter;