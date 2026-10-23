const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizePublicAsset, sanitizePublicAssets } = require("../utils/publicAssetSerializer");

test("public asset serialization hides storage paths and private upload metadata", () => {
  const asset = sanitizePublicAsset({
    id: 42,
    title: "Sample",
    filename: "contributor/2026/10/Approved/sample.jpg",
    original_filename: "/private/storage/sample-original.jpg",
    thumbnail_url: "/api/thumbnail?file=contributor%2Fthumbnails%2Fsample.webp",
    thumbnail_path: "contributor/thumbnails/sample.webp",
    upload_thumbnail_location_id: "private-location",
    upload_file_device: "device-id",
    upload_file_inode: "inode-id",
    upload_error: "/private/storage/sample.jpg: failed",
    status: "approved",
  });

  assert.deepEqual(asset, {
    id: 42,
    title: "Sample",
    filename: "sample.jpg",
    original_filename: "sample-original.jpg",
    thumbnail_url: "/api/assets/42/thumbnail",
    status: "approved",
  });
});

test("public asset list serialization preserves non-path fields", () => {
  const result = sanitizePublicAssets([
    { id: 7, filename: "folder/image.png", views: 12 },
  ]);

  assert.deepEqual(result, [{ id: 7, filename: "image.png", views: 12 }]);
});
