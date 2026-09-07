import { getAssetPreviewUrl } from "../../utils/assetPreview";

function AnalyticsInsights(props) {

  const {
  darkMode,
  mostLikedImage,
  mostViewedImage,
} = props;

  return (
  <>
    <h2
      style={{
        marginBottom: "15px",
      }}
    >
      📈 Analytics Insights
    </h2>

    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit,minmax(250px,1fr))",
        gap: "15px",
        marginBottom: "30px",
      }}
    >
      <div
        style={{
          background: darkMode
            ? "#1e1e1e"
            : "white",
          padding: "20px",
          borderRadius: "15px",
        }}
      >
        <h3>❤️ Most Liked Image</h3>

        {mostLikedImage && (
          <img
            src={getAssetPreviewUrl(mostLikedImage, { quality: 50, watermark: false })}
            alt={mostLikedImage.title}
            style={{
              width: "100%",
              height: "180px",
              objectFit: "cover",
              borderRadius: "10px",
              marginBottom: "10px",
            }}
          />
        )}

        <p>{mostLikedImage?.title || "N/A"}</p>

        <strong>
          {mostLikedImage?.likes || 0} Likes
        </strong>
      </div>
      <div
  style={{
    background: darkMode
      ? "#1e1e1e"
      : "white",
    padding: "20px",
    borderRadius: "15px",
  }}
>
  <h3>👁 Most Viewed Image</h3>

  {mostViewedImage && (
    <img
      src={getAssetPreviewUrl(mostViewedImage, { quality: 50, watermark: false })}
      alt={mostViewedImage.title}
      style={{
        width: "100%",
        height: "180px",
        objectFit: "cover",
        borderRadius: "10px",
        marginBottom: "10px",
      }}
    />
  )}

  <p>{mostViewedImage?.title || "N/A"}</p>

  <strong>
    {mostViewedImage?.views || 0} Views
  </strong>
</div>
    </div>
  </>
);
}

export default AnalyticsInsights;