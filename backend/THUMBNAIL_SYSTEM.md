# Asset thumbnail system

The new derivative system stores one deterministic WebP file per asset, separately from original assets. Each filename contains a sanitized original filename, sanitized asset title, and asset ID; each file lives under its asset creation date in `YEAR/MONTH/DAY/`. New metadata is isolated in `asset_thumbnail_metadata`; the existing legacy `asset_thumbnails` table and its rows are untouched. Files are served through `/api/assets/:id/thumbnail`; API responses never include the thumbnail filesystem root.

## Processing

- AI/EPS and PSD/PSB thumbnails preserve the rendered artwork aspect ratio within 640×360 so Explore can lay them out proportionally. Raster, SVG/GIF, PDF, and video thumbnails use a 16:9 presentation up to 640×360. All outputs are clean WebP derivatives; the shared branding watermark is applied only to asset-detail previews, not Explore thumbnails.
- The encoder fits and centers the complete source without stretching or cropping. It uses a neutral background for 16:9 thumbnails and does not add a canvas to proportional vector/layered thumbnails. It targets 50 KB, tries smaller bounds when quality reduction is insufficient, and enforces an approximately 75 KB maximum.
- Raster, SVG/GIF, AI/EPS, PSD/PSB, PDF, and common video formats use Sharp, existing GFXunlimit processors, Ghostscript/ImageMagick, or FFmpeg.
- No reliable After Effects/Premiere project renderer exists in this repository. An AEP/PRPROJ upload without a supplied image preview records a permanent thumbnail-processing failure, keeps the original upload intact, and has no new thumbnail until a renderer is added. If an upload includes its optional image preview (or an existing asset's owner/admin replaces its preview), that image is staged outside asset storage and encoded as the asset's one WebP thumbnail; the optional input is removed after successful processing or the final failed attempt.
- The processor stages remote and layered-design sources under `backend/tmp/asset-thumbnail-sources`; it writes only to the separate thumbnail root and never modifies originals. Root overlap checks resolve existing symlinks before accepting storage paths.

## Storage configuration

On the DEVELOPER machine, serving existing thumbnails does not require a mounted thumbnail share: the backend proxies the existing thumbnail endpoint on the SERVER after checking authorization locally. Mac-side generation downloads originals from the SERVER's authenticated `/api/files` endpoint and stages them under `backend/tmp/asset-thumbnail-sources`; no mount of the original asset share is required. If `ASSETS_ROOT` is configured and the original is present there, the local copy is used. Generated thumbnails still require a configured writable `THUMBNAIL_STORAGE_PATH`.

Set these variables in `backend/.env` on the DEVELOPER machine. `ASSETS_ROOT` is optional; do not set it to a Windows drive path. `PC2_ASSET_SERVER_URL` is used for authenticated remote original and thumbnail requests:

```text
THUMBNAIL_STORAGE_PATH=/Volumes/GFXunlimitThumbnails
THUMBNAIL_CONCURRENCY=2
PC2_ASSET_SERVER_URL=http://100.102.63.63:5000
```

On macOS, `/api/assets/:id/thumbnail` is served by proxying the SERVER's existing thumbnail endpoint after the DEVELOPER backend performs its normal database authorization checks. Original downloads use a short-lived backend-generated Bearer token tied to the asset owner's active session; the DEVELOPER backend and SERVER must use the same `JWT_SECRET`, which must remain server-side. Neither the SERVER URL nor the authorization token is sent to the browser. The browser continues to use the DEVELOPER backend URL, and no production thumbnail files are copied to the DEVELOPER machine. `PC2_ASSET_SERVER_URL` must be the SERVER backend origin; do not include credentials, a path, or a query string. Windows continues serving thumbnails from its configured local storage.

Set these variables in the backend environment on the SERVER:

```text
ASSETS_ROOT=F:\GFXunlimitAssets
THUMBNAIL_STORAGE_PATH=F:\GFXunlimitThumbnails
THUMBNAIL_CONCURRENCY=2
```

Both roots must be explicitly configured in Windows production. On macOS, configure `THUMBNAIL_STORAGE_PATH`; `ASSETS_ROOT` is optional and does not require a mounted SERVER original-assets share. The original is located using `images.filename`; the readable prefix uses `images.original_filename` when present, then falls back to `filename`. The title is `images.title`, ID is `images.id`, and the date directory uses the calendar date in `images.created_at`. Missing/invalid dates fall back to the current local date. Worker concurrency defaults to 2 and is capped at 8.

Configure installed renderer executables through `GHOSTSCRIPT_PATH`, `IMAGEMAGICK_PATH`, and `FFMPEG_PATH` as needed. The backend can use Ghostscript and ImageMagick for vector/PDF/layered previews, FFmpeg for supported video frames, Sharp for raster/WebP encoding, and the existing PSD/AI/EPS processors. AEP/PRPROJ has no project renderer here; without a supplied preview it fails explicitly and keeps the source. Renderer availability and service-account access on the SERVER have not been verified from the DEVELOPER machine. Do not install tools on the SERVER as part of this setup.

## Commands

Run at the repository root. Backfill requires an explicit bounded limit (default 20); `--test` chooses up to 20 assets with different file extensions. `--all` is an explicit opt-in and must not be used for the first test:

```text
npm run thumbnails:backfill -- --test --limit=20 --offset=0 --concurrency=2 --retry=1
npm run thumbnails:backfill -- --limit=20 --offset=0 --concurrency=2 --retry=1
npm run thumbnails:check
npm run thumbnails:cleanup
npm run thumbnails:cleanup -- --apply
```

Backfill is resumable by offset/limit, skips valid unchanged outputs, and continues after per-asset failures. `--retry=N` is the number of additional attempts; `--all` is required to select every asset. After deploying a thumbnail processor version change, run backfill so existing derivatives are regenerated; the proportional-vector version changes only AI/EPS and PSD/PSB assets, while unchanged raster versions are skipped. Backfill/check/cleanup are read-only with respect to schema and require migration 028 to have been deliberately applied. Check reports missing, invalid, duplicate, orphan, and unexpected storage entries. Cleanup is a dry run unless `--apply` is supplied; it reports the current new-thumbnail count/size, legacy-reference count, and each orphan's size and reason before any removal. Cleanup only considers safe, dated WebP paths below the dedicated thumbnail root. Original assets, legacy thumbnail files, and unexpected entries are not eligible for removal.

## Rollout and deployment

1. On the DEVELOPER machine, review and commit only the intended project files, then push the chosen branch:

   ```text
   git add THUMBNAIL_SYSTEM_COMPLETE.md package.json backend/THUMBNAIL_SYSTEM.md backend/server.js backend/thumbnail-queue-worker.js backend/thumbnail-engine/processor-detector.js backend/thumbnail-engine/psd-processor.js backend/migrations/028_asset_thumbnails.sql backend/scripts/thumbnail-cli-utils.js backend/scripts/thumbnails-backfill.js backend/scripts/thumbnails-check.js backend/scripts/thumbnails-cleanup.js backend/test/assetThumbnails.test.js backend/utils/assetThumbnails.js frontend/src/components/ImageGrid.js frontend/src/pages/AssetPage.jsx frontend/src/utils/assetPreview.js frontend/src/utils/assetPreview.test.js
   git commit -m "Implement shared WebP asset thumbnails" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
   git push origin <branch>
   ```

2. On the SERVER, back up PostgreSQL and verify both `F:\GFXunlimitAssets` and `F:\GFXunlimitThumbnails` are available to the backend service account. Preserve the existing uploads tree and old thumbnail files.
3. Deploy only the pushed commit on the SERVER; do not edit application code there:

   ```text
   git fetch origin
   git checkout <branch>
   git pull --ff-only origin <branch>
   npm ci --prefix backend
   npm ci --prefix frontend
   npm run build --prefix frontend
   ```

4. After a PostgreSQL backup, inspect the live schema and deliberately apply `backend/migrations/028_asset_thumbnails.sql` on the SERVER if approved. This is additive: it creates the separate `asset_thumbnail_metadata` and orphan tables and an `ON DELETE CASCADE` relationship to `images`; it does not rewrite or delete rows/files in the legacy `asset_thumbnails` table. Backend startup and CLI scripts do not apply this migration.
5. Set storage/concurrency environment variables and configure available renderers. On the SERVER, verify the Ghostscript executable directly with `& $env:GHOSTSCRIPT_PATH -version` in PowerShell; similarly verify ImageMagick and FFmpeg only when installed/configured. Restart the existing backend service only as a separately approved deployment action.
6. Run a first 10–20-asset trial with representative media and inspect dimensions, file sizes, originals, and browser responses:

   ```text
   npm run thumbnails:backfill -- --test --limit=20 --offset=0 --concurrency=2 --retry=1
   npm run thumbnails:check
   ```

7. If the trial passes, regenerate existing assets with the new processor version. The proportional-vector version change causes only AI/EPS and PSD/PSB thumbnails to be regenerated; unchanged raster assets are skipped:

   ```text
   npm run thumbnails:backfill -- --all --concurrency=2 --retry=1
   npm run thumbnails:check
   ```

   Investigate failures before wider traffic. Test upload and asset deletion separately.
8. Verify Explore and Related assets request the WebP endpoint. Keep legacy thumbnail data/files until full coverage and production checks pass. No legacy cleanup is performed by this implementation.
9. The legacy thumbnail system is intentionally retained during migration. Remove it only in a separately reviewed change after coverage, deletion, upload, and production verification.
