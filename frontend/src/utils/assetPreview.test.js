import {
  getAssetPreviewUrl,
  getAssetSourceUrl,
  getAssetOriginalDownloadUrl,
  resolveThumbnailDownloadFile,
} from './assetPreview';

describe('assetPreview', () => {
  test('uses an available thumbnail for listing previews', () => {
    const image = {
      id: 42,
      thumbnail_url: '/api/thumbnail?file=contri1%2F2026%2F08%2FApproved%2Fthumb.jpg',
      thumbnail_status: 'COMPLETED',
      thumbnail_generated_at: '2026-08-20T10:15:00.000Z',
    };

    expect(getAssetPreviewUrl(image, { quality: 80, watermark: false, thumbnailOnly: true })).toBe(
      'http://localhost:5000/api/assets/42/thumbnail?v=2026-08-20T10%3A15%3A00.000Z'
    );
  });

  test('bypasses saved thumbnails to apply a watermark to asset previews', () => {
    const image = {
      id: 42,
      thumbnail_url: '/api/thumbnail?file=contri1%2F2026%2F08%2FApproved%2Fthumb.jpg',
      thumbnail_status: 'COMPLETED',
    };

    expect(getAssetPreviewUrl(image, { quality: 50, watermark: true })).toBe(
      'http://localhost:5000/api/images/42?quality=50&watermark=true'
    );
  });

  test('uses a saved thumbnail when available without a version timestamp', () => {
    const image = {
      id: 99,
      thumbnail_url: '/api/thumbnail?file=psd%2Fthumbnails%2Fthumbnail-psd-test-1.png',
      thumbnail_status: 'completed',
    };

    expect(getAssetPreviewUrl(image, { quality: 75, watermark: false, thumbnailOnly: true })).toBe(
      'http://localhost:5000/api/assets/99/thumbnail'
    );
  });

  test('uses a ready thumbnail for non-raster previews when requested', () => {
    const image = {
      id: 166,
      filename: 'preview.psd',
      thumbnail_url: '/api/thumbnail?file=psd%2Fthumbnail.jpg',
      thumbnail_status: 'COMPLETED',
    };

    expect(getAssetPreviewUrl(image, { quality: 50, watermark: false, preferThumbnail: true })).toBe(
      'http://localhost:5000/api/thumbnail?file=psd%2Fthumbnail.jpg&quality=50'
    );
  });

  test('does not fall back to an original-backed preview for listings without a thumbnail', () => {
    const image = { filename: 'unthumbnailed.jpg' };

    expect(getAssetPreviewUrl(image, { thumbnailOnly: true })).toBe(
      'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
    );
  });

  test('uses the clean catalog preview for non-raster assets when requested', () => {
    const image = {
      id: 166,
      filename: 'preview.psd',
      thumbnail_url: '/api/thumbnail?file=psd%2Fthumbnail.jpg',
      thumbnail_status: 'COMPLETED',
    };

    expect(getAssetPreviewUrl(image, { quality: 50, watermark: false, preferThumbnail: true, renderNonRasterPreview: true })).toBe(
      'http://localhost:5000/api/catalog-preview/166?quality=50'
    );
  });

  test('preserves catalog previews for non-raster detail pages unless thumbnail-only is requested', () => {
    const image = {
      id: 166,
      filename: 'preview.psd',
      thumbnail_url: '/api/thumbnail?file=psd%2Fthumbnail.jpg',
      thumbnail_status: 'COMPLETED',
    };

    expect(getAssetPreviewUrl(image, { quality: 50, watermark: true, renderNonRasterPreview: true })).toBe(
      'http://localhost:5000/api/catalog-preview/166?quality=50&watermark=true'
    );
  });

  test('uses a clean non-raster preview in Explore and requests a watermark on detail pages', () => {
    const image = { id: 195, filename: 'asset.eps' };

    expect(getAssetPreviewUrl(image, { quality: 50, watermark: false, renderNonRasterPreview: true })).toBe(
      'http://localhost:5000/api/catalog-preview/195?quality=50'
    );
    expect(getAssetPreviewUrl(image, { quality: 50, watermark: true, renderNonRasterPreview: true })).toBe(
      'http://localhost:5000/api/catalog-preview/195?quality=50&watermark=true'
    );
  });

  test('uses the catalog preview route for raster Explore images', () => {
    const image = {
      id: 196,
      filename: 'asset.jpg',
      thumbnail_generated_at: '2026-08-31T17:23:39.361Z',
    };

    expect(getAssetPreviewUrl(image, { quality: 50, renderCatalogPreview: true })).toBe(
      'http://localhost:5000/api/catalog-preview/196?quality=50&v=2026-08-31T17%3A23%3A39.361Z'
    );
  });

  test('keeps unsupported Explore formats on the existing image route', () => {
    const image = { id: 197, filename: 'asset.mp4' };

    expect(getAssetPreviewUrl(image, { quality: 50, renderCatalogPreview: true })).toBe(
      'http://localhost:5000/api/images/197?quality=50'
    );
  });

  test('keeps fallback asset previews unwatermarked by default', () => {
    const image = { id: 7 };

    expect(getAssetPreviewUrl(image, { quality: 60 })).toBe('http://localhost:5000/api/images/7?quality=60');
  });

  test('builds a source URL for reading bounded asset metadata', () => {
    expect(getAssetSourceUrl({ id: 218 })).toBe('http://localhost:5000/api/images/218');
    expect(getAssetSourceUrl({})).toBe('');
  });

  test('keeps source preview URLs clean so the detail page can apply its shared watermark overlay', () => {
    const image = { id: 7 };

    expect(getAssetPreviewUrl(image, { quality: 50, watermark: false })).toBe(
      'http://localhost:5000/api/images/7?quality=50'
    );
  });

  test('builds the direct original-file download URL', () => {
    expect(getAssetOriginalDownloadUrl(12)).toBe('http://localhost:5000/images/12/download-original');
  });

  test('resolves encoded thumbnail paths from pending/admin assets before download', () => {
    expect(resolveThumbnailDownloadFile('/api/thumbnail?file=contri1%2F2026%2F08%2FPending%2Fthumb.jpg')).toBe('contri1/2026/08/Pending/thumb.jpg');
    expect(resolveThumbnailDownloadFile('uploads/contri1/2026/08/Pending/thumb.jpg')).toBe('contri1/2026/08/Pending/thumb.jpg');
    expect(resolveThumbnailDownloadFile('http://localhost:5000/api/thumbnail?file=contri1%2F2026%2F08%2FPending%2Fthumb.jpg')).toBe('contri1/2026/08/Pending/thumb.jpg');
  });
});
