/**
 * Script to apply watermarks to all existing thumbnail files
 * Finds all thumbnail files and applies watermarks directly
 * Usage: node apply-watermarks-to-files.js
 */

const fs = require('fs');
const path = require('path');
const { applyWatermarkToFile } = require('../utils/watermarkEngine');

const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES = 1000; // 1 second

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findThumbnailFiles(dir, fileList = []) {
  try {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      // Check if it's a thumbnail file (named *thumb*.jpg or similar)
      const isThumbnail = 
        (file.includes('thumbnail') || file.includes('thumb')) && 
        (file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png'));

      if (stat.isDirectory()) {
        // Recursively search subdirectories
        findThumbnailFiles(filePath, fileList);
      } else if (isThumbnail) {
        fileList.push(filePath);
      }
    });
  } catch (err) {
    // Skip directories we can't read
  }

  return fileList;
}

async function applyWatermarksToFiles() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  APPLYING WATERMARKS TO EXISTING THUMBNAIL FILES              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    const uploadsDir = path.resolve(__dirname, '../uploads');
    console.log('Scanning for existing thumbnail files...');
    console.log(`Directory: ${uploadsDir}\n`);

    // Find all thumbnail files
    const thumbnailFiles = findThumbnailFiles(uploadsDir);
    console.log(`Found ${thumbnailFiles.length} thumbnail files to process\n`);

    if (thumbnailFiles.length === 0) {
      console.log('No thumbnail files found.');
      return;
    }

    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;

    // Process in batches
    for (let i = 0; i < thumbnailFiles.length; i += BATCH_SIZE) {
      const batch = thumbnailFiles.slice(i, i + BATCH_SIZE);
      console.log(`\n[BATCH ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(thumbnailFiles.length / BATCH_SIZE)}]`);
      console.log('─'.repeat(60));

      for (const filePath of batch) {
        try {
          // Get file info
          const stats = fs.statSync(filePath);
          const fileSizeKB = (stats.size / 1024).toFixed(2);
          const relativePath = path.relative(uploadsDir, filePath);
          const fileName = path.basename(filePath);

          // Apply watermark
          console.log(`⧗ Processing: ${fileName} (${fileSizeKB}KB)...`);
          await applyWatermarkToFile(filePath, filePath, { quality: 80 });

          // Verify file was updated
          const newStats = fs.statSync(filePath);
          const newFileSizeKB = (newStats.size / 1024).toFixed(2);

          console.log(`✓ Watermarked successfully (${fileSizeKB}KB → ${newFileSizeKB}KB)`);
          successCount++;
        } catch (err) {
          console.error(`✗ Failed: ${err.message}`);
          failureCount++;
        }
      }

      // Delay between batches (except last batch)
      if (i + BATCH_SIZE < thumbnailFiles.length) {
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
    console.log(`Total:         ${thumbnailFiles.length}\n`);

    if (failureCount > 0) {
      console.log('⚠ Some files failed. Check the errors above.\n');
    } else {
      console.log('🎉 All existing thumbnail files now have watermarks!\n');
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

// Run the script
applyWatermarksToFiles().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
