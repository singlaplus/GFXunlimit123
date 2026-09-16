const pool = require('./db');

async function fixThumbnailUrls() {
  try {
    const result = await pool.query(`
      UPDATE images 
      SET thumbnail_url = REPLACE(
        REPLACE(
          REPLACE(
            thumbnail_url,
            'contri1%2F2026%2F08%2FPending%2F',
            'contri1%2F2026%2F08%2Fthumbnails%2F'
          ),
          'contri1%2F2026%2F08%2FApproved%2F',
          'contri1%2F2026%2F08%2Fthumbnails%2F'
        ),
        'contri1%2F2026%2F08%2FRejected%2F',
        'contri1%2F2026%2F08%2Fthumbnails%2F'
      )
      WHERE thumbnail_url LIKE '%contri1%2F2026%2F08%'
      AND (thumbnail_url LIKE '%Pending%' OR thumbnail_url LIKE '%Approved%' OR thumbnail_url LIKE '%Rejected%')
    `);
    
    console.log(`Updated ${result.rowCount} rows`);
    
    const check = await pool.query(`SELECT id, title, thumbnail_url FROM images WHERE id IN (156, 157)`);
    console.log('After update:');
    check.rows.forEach(row => {
      console.log(`ID ${row.id}: ${row.title} -> ${row.thumbnail_url}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

fixThumbnailUrls();
