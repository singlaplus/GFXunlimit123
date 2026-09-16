import { getAssetPreviewUrl } from "../../utils/assetPreview";

function ContributorProfile(props) {

  const {
    darkMode,
    viewContributorPage,
    setViewContributorPage,
    contributorPageImages,
    contributorPageLikes,
    contributorPageViews,
    contributorPageDownloads,
    estimatedEarnings,
    topContributorImages,
    contributorBadge,
    topEarningImage,
    nextLevel,
    progress,
    targetDownloads,
    contributorEarnings,
    monthlyEarnings,
    fetchSingleImage,
  } = props;

  return (
    <>
    
{viewContributorPage && (

  <div
    style={{
      background: darkMode
        ? "#1e1e1e"
        : "white",
      padding: "25px",
      borderRadius: "15px",
      marginBottom: "30px",
    }}
  >
    

    <button
      onClick={() =>
        setViewContributorPage(null)
      }
      style={{
        marginBottom: "15px",
      }}
    >
      ⬅ Back
    </button>

    <h2>
  👤 {viewContributorPage}
</h2>
    <div
  style={{
    background: darkMode
      ? "#2a2a2a"
      : "#f5f5f5",
    padding: "15px",
    borderRadius: "15px",
    marginTop: "15px",
    marginBottom: "20px",
  }}
>
  <h3>
    🏅 Contributor Rank
  </h3>

  <p>
    👤 {viewContributorPage}
  </p>

  <p>
    📸 {(contributorPageImages || []).length}
    {" "}Uploads
  </p>

  <p>
    ❤️ {contributorPageLikes}
    {" "}Likes
  </p>

  <p>
    👁 {contributorPageViews}
    {" "}Views
  </p>

  <p>
    ⬇ {contributorPageDownloads}
    {" "}Downloads
  </p>

  <strong>
    💰 ${estimatedEarnings || 0}
  </strong>
</div>
    <h3
  style={{
    marginTop: "20px",
    marginBottom: "15px",
  }}
>
  🏆 Top Images
</h3>

<div
  style={{
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(180px,1fr))",
    gap: "15px",
    marginBottom: "25px",
  }}
>
  {(topContributorImages || []).map((image) => (

    <div
  key={image.id}
  onClick={() =>
    fetchSingleImage(image.id)
  }
  style={{
    borderRadius: "10px",
    overflow: "hidden",
    background: darkMode
      ? "#2a2a2a"
      : "#f5f5f5",
    cursor: "pointer",
    transition: "0.3s",
  }}
>

      <img
        src={`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/api/images/${image.id}`}
        alt={image.title}
        style={{
          width: "100%",
          height: "140px",
          objectFit: "cover",
        }}
      />

      <div
        style={{
          padding: "10px",
        }}
      >
        <strong>
          {image.title}
        </strong>

        <p>
          ⬇ {image.downloads || 0}
        </p>
      </div>

    </div>

  ))}
</div>
    <div
  style={{
    marginBottom: "20px",
    fontSize: "18px",
    fontWeight: "bold",
    color: "#ff9800",
  }}
>
  {contributorBadge || "New Contributor"}
</div>
<div
  style={{
    background: darkMode
      ? "#2a2a2a"
      : "#f5f5f5",
    padding: "15px",
    borderRadius: "12px",
    marginBottom: "20px",
  }}
>
  <h3>
    🏆 Achievement Progress
  </h3>
  {topEarningImage && (

  <div
    style={{
      background: darkMode
        ? "#2a2a2a"
        : "#f5f5f5",
      padding: "15px",
      borderRadius: "12px",
      marginBottom: "20px",
    }}
  >
    

    <h3>
      💎 Top Earning Image
    </h3>

    <p>
      {topEarningImage?.title}
    </p>

    <p>
      Downloads:
      {" "}
      {topEarningImage?.downloads || 0}
    </p>

    <p>
      Earnings:
      {" "}
      $
      {(
        (topEarningImage.downloads || 0)
        * 0.5
      ).toFixed(2)}
    </p>

  </div>

)}

  <p>
    Current Badge:
    {" "}
    {contributorBadge || "New Contributor"}
  </p>
  <h3>
  🏅 Level Progress
</h3>

<p>
  Next Level:
  {" "}
  {nextLevel || "Beginner"}
</p>

<div
  style={{
    width: "100%",
    height: "20px",
    background: "#ddd",
    borderRadius: "10px",
    overflow: "hidden",
    marginBottom: "10px",
  }}
>
  <div
    style={{
      width: `${progress || 0}%`,
      height: "100%",
      background: "#4caf50",
    }}
  />
</div>

<p>
  {contributorPageDownloads}
  {" / "}
  {targetDownloads}
  {" "}Downloads
</p>

  <p>
    Uploads:
{" "}
{(contributorPageImages || []).length}
{" "}
 / 10
  </p>

  <p>
    Likes:
    {" "}
    {contributorPageLikes}
    {" "}
    / 100
  </p>

  <p>
    Views:
    {" "}
    {contributorPageViews}
    {" "}
    / 1000
  </p>

  <p>
    Downloads:
    {" "}
    {contributorPageDownloads}
    {" "}
    / 100
  </p>

</div>

    <div
  style={{
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(180px,1fr))",
    gap: "15px",
    marginBottom: "25px",
  }}
>

  <div>
    📸 Uploads:
{" "}
{(contributorPageImages || []).length}
  </div>

  <div>
    ❤️ Likes:
    {" "}
    {contributorPageLikes}
  </div>

  <div>
    👁 Views:
    {" "}
    {contributorPageViews}
  </div>

  <div>
    ⬇ Downloads:
    {" "}
    {contributorPageDownloads}
  </div>
  <div
  style={{
    background: darkMode
      ? "#1e1e1e"
      : "white",
    padding: "20px",
    borderRadius: "15px",
    textAlign: "center",
  }}
>
  <h3>💰 Earnings</h3>

  <h2>
  ${contributorEarnings || 0}
</h2>

  <p>
    Based on downloads
  </p>
  <p>
  📈 This Month: ${monthlyEarnings || 0}
</p>
</div>

</div>

    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit,minmax(220px,1fr))",
        gap: "15px",
      }}
    >

      {(contributorPageImages || []).map(
        (image) => (

          <div
            key={`${image.id}-${image.filename}`}
            onClick={() =>
              fetchSingleImage(
                image.id
              )
            }
            style={{
              cursor: "pointer",
            }}
          >

            <img
              src={getAssetPreviewUrl(image, { quality: 50, watermark: false })}
              alt={image.title}
              style={{
                width: "100%",
                height: "180px",
                objectFit: "cover",
                borderRadius: "10px",
              }}
            />

            <p>
              {image.title}
            </p>

          </div>

        )
      )}

    </div>

  </div>

)}
    </>
  );
}

export default ContributorProfile;