function buildMyUploadsQuery(view, userId) {
  let query = `
    SELECT *
    FROM images
    WHERE uploaded_by = $1
  `;
  const params = [userId];

  if (view === "approved") {
    query += `
      AND LOWER(COALESCE(status, '')) = 'approved'
      AND created_at >= NOW() - INTERVAL '7 days'
    `;
  } else if (view === "pending") {
    query += `
      AND LOWER(COALESCE(status, '')) = 'pending'
    `;
  } else if (view === "reviewed") {
    query += `
      AND LOWER(COALESCE(status, '')) IN ('approved', 'rejected')
      AND created_at >= NOW() - INTERVAL '14 days'
    `;
  } else if (view === "rejected") {
    query += `
      AND LOWER(COALESCE(status, '')) = 'rejected'
    `;
  } else if (view === "portfolio") {
    query += `
      AND LOWER(COALESCE(status, '')) = 'approved'
    `;
  }

  query += `
    ORDER BY created_at DESC
  `;

  return { query, params };
}

module.exports = {
  buildMyUploadsQuery,
};
