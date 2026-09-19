const pool = require("../db");

async function seed() {
  for (let index = 1; index <= 20; index += 1) {
    const number = String(index).padStart(2, "0");
    await pool.query(
      `INSERT INTO blog_drafts(
        title, slug, excerpt, content, category, tags, author, status,
        publish_at, seo_title, seo_description, allow_comments, featured, created_by
      )
      SELECT $1, $2, $3, $4, $5, $6, $7, 'published', NOW() - ($8 || ' hours')::interval,
             $1, $3, TRUE, $9, 3
      WHERE NOT EXISTS (SELECT 1 FROM blog_drafts WHERE slug = $2)`,
      [
        `Demo Published Blog ${number}`,
        `demo-published-blog-${number}`,
        `A demo published blog post ${number} for the public grid.`,
        `This is demonstration content for published blog ${number}.`,
        index % 2 ? "Tips & Tricks" : "Collections",
        `demo,blog-${number}`,
        "ankit",
        index - 1,
        index === 1,
      ]
    );
  }

  for (let index = 1; index <= 10; index += 1) {
    const number = String(index).padStart(2, "0");
    await pool.query(
      `INSERT INTO blog_drafts(
        title, slug, excerpt, content, category, tags, author, status,
        seo_title, seo_description, allow_comments, featured, created_by
      )
      SELECT $1, $2, $3, $4, 'Draft Ideas', $5, 'ankit', 'draft', $1, $3, TRUE, FALSE, 3
      WHERE NOT EXISTS (SELECT 1 FROM blog_drafts WHERE slug = $2)`,
      [
        `Demo Draft Blog ${number}`,
        `demo-draft-blog-${number}`,
        `A demo draft blog post ${number} for the admin drafts table.`,
        `This is demonstration draft content for blog ${number}.`,
        `draft,demo-${number}`,
      ]
    );
  }

  const result = await pool.query(
    "SELECT status, COUNT(*)::int AS count FROM blog_drafts GROUP BY status ORDER BY status"
  );
  console.log(JSON.stringify(result.rows));
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
