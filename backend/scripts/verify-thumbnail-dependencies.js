const { verifyThumbnailToolchain } = require('../services/thumbnailToolchain');

async function main() {
  const { tools, processors } = await verifyThumbnailToolchain();
  console.log('\nThumbnail toolchain checks passed:');
  for (const [name, result] of Object.entries(tools)) {
    console.log(`  ✓ ${name}: ${result.version} (${result.command})`);
  }
  for (const [name, version] of Object.entries(processors)) {
    console.log(`  ✓ ${name}: ${version}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nThumbnail toolchain setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
