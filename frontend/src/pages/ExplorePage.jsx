import MarketplaceContainer from "../components/MarketplaceContainer";

export default function ExplorePage(props) {
  return (
    <div
      style={{
        paddingTop: 30,
        minHeight: "100vh",
        background: props.darkMode ? "#121212" : "#f8f8f8",
        color: props.darkMode ? "#f5f5f5" : "#111",
      }}
    >
      <MarketplaceContainer {...props} />
    </div>
  );
}