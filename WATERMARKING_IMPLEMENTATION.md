# Watermarking Implementation - Complete Guide

## Overview
The watermarking system is fully implemented with scope-based display:
- ✅ Watermarks appear ONLY on the asset detail page
- ✅ No watermarks on browsing pages (downloads, favorites, uploads, galleries)
- ✅ Optional thumbnails support watermarking

## Architecture

### Frontend - Watermark Scope Control
The `getAssetPreviewUrl()` function in `frontend/src/utils/assetPreview.js` controls watermark display:

```javascript
export const getAssetPreviewUrl = (image, options = {}) => {
  const { quality = 50, watermark = false, useThumbnail = true } = options;
  // ... adds ?watermark=true to URL when watermark option is true
}
```

### Pages Using This Control

| Page | Component | Watermark | Purpose |
|------|-----------|-----------|---------|
| Asset Detail | `AssetPage.jsx` (line 188-190) | ✅ `true` | Protect full-resolution preview |
| My Downloads | `MyDownloads.js` (line 205) | ❌ `false` | Browse without protection |
| My Favorites | `MyFavorites.js` (line 196) | ❌ `false` | Browse without protection |
| My Uploads | `MyUploads.js` (line 254) | ❌ `false` | Browse without protection |
| Gallery | `GalleryImageViewer.js` (49, 90) | ❌ `false` | Browse without protection |
| Admin Panel | `AdminPanel.js` (4889, 5142) | ❌ `false` | Admin preview |
| Home Page | `AnalyticsInsights.js` (43, 74) | ❌ `false` | Marketing display |

### Backend - Watermark Application

**Endpoint:** `GET /api/images/:id?quality=Q&watermark=true`

The `streamImageFile()` function in `backend/server.js` applies watermarking:

1. **Format Check** (line 426):
   - Only applies watermark to: `.jpg`, `.jpeg`, `.png`, `.webp`
   - EPS/AI/PSD files → fallback to thumbnail

2. **Watermark Generation** (lines 434-510):
   - Reads branding config (logo, favicon)
   - Creates SVG pattern overlay at -30° rotation
   - Applies with 0.5 opacity
   - Caches disabled for watermarked images

3. **Output** (lines 511-523):
   - Returns processed image with watermark
   - Supports JPG/PNG/WEBP output formats

## Optional Thumbnail Support

### Upload Flow
1. User uploads asset with optional thumbnail (`POST /upload`)
2. Optional thumbnail saved as JPEG/PNG (quality 50)
3. Stored in `uploads/{contributor}/YYYY/MM/thumbnails/` directory
4. URL stored in database: `/api/thumbnail?file=...`

### Display Flow
1. Component calls `getAssetPreviewUrl(image, { watermark: true })`
2. Checks for `image.thumbnail_url` (optional thumbnail URL)
3. If present, uses thumbnail URL with `?watermark=true` appended
4. Backend receives request at `/api/thumbnail?file=...&watermark=true`
5. Applies watermark if file is JPEG/PNG

### Code Path
```
Frontend: getAssetPreviewUrl(image, { watermark: true })
  ↓
Checks: image.thumbnail_url && image.thumbnail_status === 'COMPLETED'
  ↓
Builds: `/api/thumbnail?file={path}&watermark=true`
  ↓
Backend: /api/thumbnail endpoint
  ↓
streamImageFile() applies watermark overlay
  ↓
Returns: Watermarked JPEG/PNG to client
```

## Testing Checklist

### ✅ Test 1: Asset Detail Page Shows Watermark
**Steps:**
1. Navigate to any approved asset page (e.g., asset ID 156)
2. Observe main preview image
3. Look for diagonal watermark pattern with logo/favicon

**Expected:** Watermark visible on all image previews

**Code:** AssetPage.jsx line 188-190 uses `watermark: true`

### ✅ Test 2: Downloads Page Has NO Watermark
**Steps:**
1. Go to "My Downloads" page
2. Observe thumbnail previews in the grid
3. Look for watermark pattern

**Expected:** No watermark visible on thumbnails

**Code:** MyDownloads.js line 205 uses `watermark: false`

### ✅ Test 3: Favorites Page Has NO Watermark
**Steps:**
1. Go to "My Favorites" page
2. Observe image previews
3. Look for watermark pattern

**Expected:** No watermark visible

**Code:** MyFavorites.js line 196 uses `watermark: false`

### ✅ Test 4: Uploads Page Has NO Watermark
**Steps:**
1. Go to "My Uploads" page
2. Observe contributor's uploaded assets
3. Look for watermark pattern

**Expected:** No watermark visible

**Code:** MyUploads.js line 254 uses `watermark: false`

### ✅ Test 5: Optional Thumbnail Shows Watermark on Detail Page
**Steps:**
1. Upload an asset with optional thumbnail
   - Main image: Any format (EPS, JPG, PNG, PSD)
   - Optional thumbnail: JPG/PNG file
2. Navigate to asset detail page
3. Observe image preview

**Expected:** Optional thumbnail displayed with watermark visible

**Code Path:**
- Upload: backend/server.js lines 4728-4790 saves optional thumbnail
- Display: AssetPage.jsx line 188 with `watermark: true`
- Frontend: frontend/src/utils/assetPreview.js line 21 uses optional thumbnail
- Backend: backend/server.js line 426+ applies watermark

### ✅ Test 6: Optional Thumbnail Has NO Watermark in Downloads
**Steps:**
1. Use asset uploaded in Test 5
2. Go to "My Downloads" page
3. Observe thumbnail preview

**Expected:** Optional thumbnail visible WITHOUT watermark

**Code:** MyDownloads.js line 205 with `watermark: false`

### ✅ Test 7: Watermark Only on Supported Formats
**Steps:**
1. Upload EPS/AI/PSD file without optional thumbnail
2. Visit asset detail page
3. Observe that generated thumbnail appears (EPS renders via Ghostscript)

**Expected:** Watermark applied to generated thumbnail

**Note:** Generated thumbnails are always JPEG format → support watermarking

### ✅ Test 8: Watermark with Quality Parameter
**Steps:**
1. Access `/api/images/{id}?quality=100&watermark=true` directly
2. Load image in browser

**Expected:** High-quality image with watermark overlay

**Code:** backend/server.js line 426+ checks both quality and watermark parameters

## Implementation Details

### Watermark Configuration
- **Text:** "GFXunlimit"
- **Opacity:** 0.5 (50% transparency)
- **Rotation:** -30° (diagonal tilt)
- **Pattern:** Repeating grid with logo and favicon
- **Logo size:** 72% of pattern tile
- **Favicon size:** 22% of pattern tile
- **Format:** SVG overlay composite

### Quality Levels
| Page | Quality | Purpose |
|------|---------|---------|
| Asset Detail (preview) | 10 | Quick load, protected by watermark |
| Asset Detail (popup) | 50 | Medium quality |
| Asset Detail (full) | 100 | High quality with watermark |
| Downloads/Favorites | 50 | Balanced quality, no watermark |
| Uploads | 50 | Contributor preview |
| Galleries | 50 | Grid display |
| Optional Thumbnails | 50 | Pre-generated and cached |

### Caching Strategy
- **Watermarked images:** Cache-Control: no-cache (line 513)
- **Non-watermarked images:** Standard cache headers
- **Reason:** Watermark might change if branding config updates

## Database Schema

### Images Table
```sql
-- Relevant columns for watermarking
id SERIAL PRIMARY KEY
filename TEXT                    -- Original upload path
thumbnail_url TEXT              -- URL to thumbnail (/api/thumbnail?file=...)
thumbnail_status TEXT           -- 'COMPLETED', 'PENDING', 'FAILED'
status TEXT                     -- 'approved', 'pending', 'rejected'
uploaded_by INTEGER            -- Contributor user ID
```

## API Endpoints

### `/api/images/:id` (GET)
- Serves full-resolution image with optional watermark
- Permission checks: approved files public, pending files owner/admin only
- Query parameters: `quality` (10-100), `watermark` (true/false), `download` (true/false)
- Example: `/api/images/156?quality=80&watermark=true`

### `/api/thumbnail` (GET)
- Serves thumbnail with optional watermark
- Used for optional thumbnails and generated thumbnails
- Query parameters: `file` (path), `quality` (10-100), `watermark` (true/false)
- Example: `/api/thumbnail?file=contri1%2F2026%2F08%2Fthumbnails%2Fimage-thumb.jpg&watermark=true`

### `/uploads/processed` (GET)
- Alternative endpoint for processed images
- Used by some legacy components
- Supports watermarking same as `/api/thumbnail`

## Troubleshooting

### Watermark Not Appearing
1. **Check component code:** Verify `watermark: true` is passed to `getAssetPreviewUrl()`
2. **Check image format:** Ensure image is JPG/PNG/WEBP (not EPS/AI/PSD)
3. **Check database:** Verify `thumbnail_status = 'COMPLETED'` for thumbnails
4. **Check logs:** Backend should log watermark generation in console

### Watermark Appearing on Wrong Page
1. **Check component:** Grep for `getAssetPreviewUrl` usage
2. **Check options:** Ensure `watermark: false` is passed for non-detail pages
3. **Rebuild frontend:** Run `npm run build` in frontend directory

### Optional Thumbnail Not Showing
1. **Check upload:** Verify file was accepted as image (JPG/PNG/WEBP)
2. **Check thumbnail_url:** Query database to verify URL is stored
3. **Check directory:** Verify file exists at path specified in thumbnail_url
4. **Check API:** Test `/api/thumbnail?file=...` endpoint directly

## Files Modified for Implementation

### Frontend
- `frontend/src/utils/assetPreview.js` - Central watermark control
- `frontend/src/pages/AssetPage.jsx` - Uses `watermark: true`
- `frontend/src/components/MyDownloads.js` - Uses `watermark: false`
- `frontend/src/components/MyFavorites.js` - Uses `watermark: false`
- `frontend/src/components/MyUploads.js` - Uses `watermark: false`
- `frontend/src/components/GalleryImageViewer.js` - Uses `watermark: false`

### Backend
- `backend/server.js` - Watermark logic in `streamImageFile()` function
- `backend/utils/watermarkEngine.js` - SVG watermark generation
- `backend/utils/assetThumbnail.js` - Optional thumbnail URL building

## Summary

The watermarking system is **fully implemented and production-ready**:

1. ✅ **Scope-based display:** Watermarks only on asset detail page
2. ✅ **All browsing protected:** No watermarks on downloads/favorites/uploads/galleries
3. ✅ **Optional thumbnail support:** User-uploaded thumbnails support watermarking
4. ✅ **Format support:** JPG/PNG/WEBP with generated EPS thumbnails
5. ✅ **Performance optimized:** Cached watermark-free images, no-cache for watermarked
6. ✅ **Admin configurable:** Branding logo and favicon used in watermark pattern

**Last Verified:** 2026-08-16
**Status:** ✅ Production Ready
