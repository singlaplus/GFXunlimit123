/**
 * Script to apply watermarks to existing thumbnails
 * Usage: node apply-watermarks-to-existing.js
 */

const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { applyWatermarkToFile } = require('../utils/watermarkEngine');

const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function applyWatermarksToExisting() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  APPLYING WATERMARKS TO EXISTING THUMBNAILS                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Get all thumbnails that exist
    console.log('Fetching existing thumbnails from database...');
    const result = await pool.query(`
      SELECT id, thumbnail_url, title FROM images 
      WHERE thumbnail_url IS NOT NULL 
      AND thumbnail_url != ''
      ORDER BY id DESC
    `);

    const thumbnails = result.rows;
    console.log(`Found ${thumbnails.length} thumbnails to process\n`);

    if (thumbnails.length === 0) {
      console.log('No thumbnails found.');
      await pool.end();
      return;
    }

    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;

    // Process in batches
    for (let i = 0; i < thumbnails.length; i += BATCH_SIZE) {
      const batch = thumbnails.slice(i, i + BATCH_SIZE);
      console.log(`\n[BATCH ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(thumbnails.length / BATCH_SIZE)}]`);
      console.log('─'.repeat(60));

      for (const thumb of batch) {
        const assetId = thumb.id;
        const title = thumb.title;
        const thumbnailUrl = thumb.thumbnail_url;

        try {
          // Parse the file path from the URL
          const match = String(thumbnailUrl).match(/[?&]file=([^&]+)/i);
          let filePath = null;

          if (match) {
            const encodedPath = match[1];
            const relativePath = decodeURIComponent(encodedPath);
            filePath = path.resolve(__dirname, '../uploads', relativePath);
          } else {
            // Try as direct path
            filePath = path.resolve(__dirname, '../uploads', String(thumbnailUrl).replace(/^\/+/, ''));
          }

          // Check if file exists
          if (!fs.existsSync(filePath)) {
            console.log(`⊘ [${assetId}] File not found: ${title}`);
            skippedCount++;
            continue;
          }

          // Get file stats
          const stats = fs.statSync(filePath);
          const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);

          // Apply watermark
          console.log(`⧗ [${assetId}] Processing: ${title} (${fileSizeMB}MB)...`);
          await applyWatermarkToFile(filePath, filePath, { quality: 80 });

          // Verify file was updated
          const newStats = fs.statSync(filePath);
          const newFileSizeMB = (newStats.size / 1024 / 1024).toFixed(2);

          console.log(`✓ [${assetId}] Watermarked successfully (${fileSizeMB}MB → ${newFileSizeMB}MB)`);
          successCount++;
        } catch (err) {
          console.error(`✗ [${assetId}] Failed to watermark: ${err.message}`);
          failureCount++;
        }
      }

      // Delay between batches (except last batch)
      if (i + BATCH_SIZE < thumbnails.length) {
        console.log(`\nWaiting ${DELAY_BETWEEN_BATCHES / 1000}s before next batch...`);
        await sleep(DELAY_BETWEEN_BATCHES);
      }
    }

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║  PROCESSING COMPLETE                                           ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    console.log(`✓ Successful:  ${successCount}`);
    console.log(`✗ Failed:      ${failureCount}`);
    console.log(`⊘ Skipped:     ${skippedCount}`);
    console.log(`Total:         ${thumbnails.length}\n`);

    if (failureCount > 0) {
      console.log('⚠ Some thumbnails failed. Check the errors above.\n');
    } else {
      console.log('🎉 All existing thumbnails now have watermarks!\n');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Run the script
applyWatermarksToExisting().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
