function buildMyUploadsQuery(view, userId) {
  let query = `
    SELECT images.*,
      thumbnails.status AS generated_thumbnail_status,
      thumbnails.thumbnail_path
    FROM images
    LEFT JOIN asset_thumbnail_metadata thumbnails ON thumbnails.asset_id = images.id
    WHERE images.uploaded_by = $1
  `;
  const params = [userId];

  if (view === "not-submitted" || view === "bulk-status") {
    query += `
      AND LOWER(REPLACE(REPLACE(COALESCE(images.status, ''), '_', ' '), '-', ' ')) IN ('draft', 'not submitted')
    `;
    if (view === "not-submitted") {
      query += `
        AND thumbnails.status = 'READY'
        AND thumbnails.thumbnail_path IS NOT NULL
      `;
    }
  } else if (view === "approved") {
    query += `
      AND LOWER(COALESCE(images.status, '')) = 'approved'
      AND images.created_at >= NOW() - INTERVAL '7 days'
    `;
  } else if (view === "pending") {
    query += `
      AND LOWER(COALESCE(images.status, '')) = 'pending'
    `;
  } else if (view === "reviewed") {
    query += `
      AND LOWER(COALESCE(images.status, '')) IN ('approved', 'rejected')
      AND images.created_at >= NOW() - INTERVAL '14 days'
    `;
  } else if (view === "rejected") {
    query += `
      AND LOWER(COALESCE(images.status, '')) = 'rejected'
    `;
  } else if (view === "portfolio") {
    query += `
      AND LOWER(COALESCE(images.status, '')) = 'approved'
    `;
  }

  query += `
    ORDER BY images.created_at DESC
  `;

  return { query, params };
}

module.exports = {
  buildMyUploadsQuery,
};
