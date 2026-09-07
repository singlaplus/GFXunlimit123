import { getAssetPreviewUrl, getAssetOriginalDownloadUrl, resolveThumbnailDownloadFile } from './assetPreview';

describe('assetPreview', () => {
  test('uses the 50% thumbnail route whenever an optional thumbnail is active on the site', () => {
    const image = {
      id: 42,
      thumbnail_url: '/api/thumbnail?file=contri1%2F2026%2F08%2FApproved%2Fthumb.jpg',
      thumbnail_status: 'COMPLETED',
    };

    expect(getAssetPreviewUrl(image, { quality: 80, watermark: false })).toBe(
      'http://localhost:5000/api/thumbnail?file=contri1%2F2026%2F08%2FApproved%2Fthumb.jpg&quality=50'
    );
  });

  test('applies watermark to thumbnail URL when requested on asset page', () => {
    const image = {
      id: 42,
      thumbnail_url: '/api/thumbnail?file=contri1%2F2026%2F08%2FApproved%2Fthumb.jpg',
      thumbnail_status: 'COMPLETED',
    };

    expect(getAssetPreviewUrl(image, { quality: 50, watermark: true })).toBe(
      'http://localhost:5000/api/thumbnail?file=contri1%2F2026%2F08%2FApproved%2Fthumb.jpg&quality=50&watermark=true'
    );
  });

  test('uses the thumbnail path even when the completion flag is lowercase', () => {
    const image = {
      id: 99,
      thumbnail_url: '/api/thumbnail?file=psd%2Fthumbnails%2Fthumbnail-psd-test-1.png',
      thumbnail_status: 'completed',
    };

    expect(getAssetPreviewUrl(image, { quality: 75, watermark: false })).toBe(
      'http://localhost:5000/api/thumbnail?file=psd%2Fthumbnails%2Fthumbnail-psd-test-1.png&quality=50'
    );
  });

  test('falls back to original asset URL when no thumbnail is ready', () => {
    const image = { id: 7 };

    expect(getAssetPreviewUrl(image, { quality: 60 })).toBe('http://localhost:5000/api/images/7?quality=60');
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
