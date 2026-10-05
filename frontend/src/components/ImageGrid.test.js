import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageGrid from './ImageGrid';

describe('ImageGrid dark mode', () => {
  it('does not render a title caption in the explore asset grid', () => {
    const props = {
      filteredImages: [
        {
          id: 1,
          filename: 'sample.jpg',
          title: 'Sample Title',
          category: 'Photos',
          collection: 'Summer',
          uploaded_by: 'Alice',
          keywords: 'sunset',
          likes: 5,
          views: 10,
          downloads: 2,
          created_at: '2024-01-01T00:00:00.000Z',
        },
      ],
      darkMode: false,
      fetchSingleImage: jest.fn(),
      likeImage: jest.fn(),
      addFavorite: jest.fn(),
      downloadImage: jest.fn(),
      shareImage: jest.fn(),
    };

    render(<ImageGrid {...props} />);

    expect(screen.queryByRole('heading', { name: /sample title/i })).not.toBeInTheDocument();
  });

  it('sizes thumbnails by their natural proportions without cropping', () => {
    const props = {
      filteredImages: [
        {
          id: 1,
          filename: 'sample.jpg',
          title: 'Sample Title',
          category: 'Photos',
          collection: 'Summer',
          uploaded_by: 'Alice',
          keywords: 'sunset',
          likes: 5,
          views: 10,
          downloads: 2,
          created_at: '2024-01-01T00:00:00.000Z',
        },
      ],
      darkMode: false,
      fetchSingleImage: jest.fn(),
      likeImage: jest.fn(),
      addFavorite: jest.fn(),
      downloadImage: jest.fn(),
      shareImage: jest.fn(),
    };

    render(<ImageGrid {...props} />);

    const image = screen.getByRole('img', { name: /sample title/i });
    expect(image.style.height).toBe('auto');
    expect(image.style.aspectRatio).toBe('');
    expect(image.style.objectFit).toBe('contain');
    expect(image.getAttribute('src')).toContain('/api/catalog-preview/1?quality=63');

    const grid = image.parentElement.parentElement;
    expect(grid).toHaveClass('explore-asset-grid');
    expect(image.parentElement.style.minWidth).toBe('0');

    image.parentElement.getBoundingClientRect = () => ({ width: 220 });
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 300 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 600 });
    fireEvent.load(image);

    expect(image.style.aspectRatio).toBe('300 / 600');
    expect(image.parentElement.style.gridRowEnd).toBe('span 19');
  });

  it('uses the generated thumbnail for vector and layered assets in Explore', () => {
    render(
      <ImageGrid
        filteredImages={[
          { id: 218, filename: 'new-year.eps', title: 'New Year', thumbnail_url: '/api/thumbnail?file=eps.webp', thumbnail_status: 'READY' },
          { id: 197, filename: 'layered.psd', title: 'Layered asset', thumbnail_url: '/api/thumbnail?file=psd.webp', thumbnail_status: 'READY' },
        ]}
        darkMode={false}
      />
    );

    const vectorImage = screen.getByRole('img', { name: 'New Year' });
    expect(vectorImage.getAttribute('src')).toContain('/api/assets/218/thumbnail');
    expect(screen.getByRole('img', { name: 'Layered asset' }).getAttribute('src'))
      .toContain('/api/assets/197/thumbnail');
    expect(vectorImage.getAttribute('src')).not.toContain('watermark=true');
    expect(screen.queryByTestId('asset-watermark')).not.toBeInTheDocument();

    Object.defineProperty(vectorImage, 'naturalWidth', { configurable: true, value: 144 });
    Object.defineProperty(vectorImage, 'naturalHeight', { configurable: true, value: 360 });
    fireEvent.load(vectorImage);

    expect(vectorImage.style.aspectRatio).toBe('144 / 360');
  });

  it.each(['jpg', 'jpeg', 'eps', 'ai', 'psd', 'psb'])(
    'uses the central generated thumbnail for READY %s assets',
    (extension) => {
      render(
        <ImageGrid
          filteredImages={[
            {
              id: 21,
              filename: `asset.${extension}`,
              title: `Ready ${extension}`,
              thumbnail_url: '/api/thumbnail?file=asset.webp',
              thumbnail_status: 'READY',
            },
          ]}
          darkMode={false}
        />
      );

      const image = screen.getByRole('img', { name: `Ready ${extension}` });
      expect(image.getAttribute('src')).toContain('/api/assets/21/thumbnail');
      expect(image.getAttribute('src')).not.toContain('/api/catalog-preview/21');
      expect(image.getAttribute('src')).not.toContain('watermark=true');
    }
  );

  it.each([
    [1000, 2000, '1000 / 2000'],
    [2000, 1000, '2000 / 1000'],
    [1000, 1000, '1000 / 1000'],
    [3000, 3000, '3000 / 3000'],
  ])('uses original %s×%s dimensions for Masonry aspect ratio', (width, height, expected) => {
    render(
      <ImageGrid
        filteredImages={[
          {
            id: 500,
            filename: 'proportional.jpg',
            title: 'Proportional source',
            original_width: width,
            original_height: height,
          },
        ]}
        darkMode={false}
      />
    );

    const aspectRatio = screen.getByRole('img', { name: 'Proportional source' }).style.aspectRatio;
    const [renderedWidth, renderedHeight] = aspectRatio.split('/').map(Number);
    expect(aspectRatio).toBe(expected);
    expect(renderedWidth / renderedHeight).toBe(width / height);
  });

  it('falls back to the preview processor if a READY central thumbnail is missing', () => {
    render(
      <ImageGrid
        filteredImages={[
          {
            id: 501,
            filename: 'missing.jpg',
            title: 'Missing central thumbnail',
            thumbnail_status: 'READY',
          },
        ]}
        darkMode={false}
      />
    );

    const image = screen.getByRole('img', { name: 'Missing central thumbnail' });
    expect(image.getAttribute('src')).toContain('/api/assets/501/thumbnail');
    fireEvent.error(image);
    expect(image.getAttribute('src')).toContain('/api/catalog-preview/501?quality=63');
    expect(image.getAttribute('src')).not.toContain('watermark=true');
  });

  it('uses the central thumbnail for READY metadata without a legacy thumbnail URL', () => {
    render(
      <ImageGrid
        filteredImages={[
          {
            id: 218,
            filename: 'asset.jpg',
            title: 'Central thumbnail',
            thumbnail_url: null,
            generated_thumbnail_status: 'READY',
            thumbnail_path: '2026/10/04/asset-218.webp',
            format: 'webp',
          },
        ]}
        darkMode={false}
      />
    );

    const image = screen.getByRole('img', { name: 'Central thumbnail' });
    expect(image.getAttribute('src')).toContain('/api/assets/218/thumbnail');
    expect(image.getAttribute('src')).not.toContain('/api/catalog-preview/218');
  });

  it('uses the API COMPLETED status when a central thumbnail has no legacy URL', () => {
    render(
      <ImageGrid
        filteredImages={[
          {
            id: 219,
            filename: 'asset.png',
            title: 'Completed thumbnail',
            thumbnail_url: null,
            thumbnail_status: 'COMPLETED',
          },
        ]}
        darkMode={false}
      />
    );

    expect(screen.getByRole('img', { name: 'Completed thumbnail' }).getAttribute('src'))
      .toContain('/api/assets/219/thumbnail');
  });

  it.each(['pending', 'processing', 'retrying', 'failed'])(
    'uses preview fallback instead of a generated-thumbnail request for %s assets',
    (thumbnailStatus) => {
      render(
        <ImageGrid
          filteredImages={[
            {
              id: 21,
              filename: 'asset.jpg',
              title: `Asset ${thumbnailStatus}`,
              thumbnail_url: '/api/thumbnail?file=asset.webp',
              thumbnail_status: thumbnailStatus,
            },
            {
              id: 22,
              filename: 'asset.eps',
              title: `Vector ${thumbnailStatus}`,
              thumbnail_url: '/api/thumbnail?file=vector.webp',
              thumbnail_status: thumbnailStatus,
            },
          ]}
          darkMode={false}
        />
      );

      const rasterPreview = screen.getByRole('img', { name: `Asset ${thumbnailStatus}` });
      const vectorPreview = screen.getByRole('img', { name: `Vector ${thumbnailStatus}` });
      expect(rasterPreview.getAttribute('src')).toContain('/api/catalog-preview/21?quality=63');
      expect(vectorPreview.getAttribute('src')).toContain('/api/catalog-preview/22?quality=63');
      expect(rasterPreview.getAttribute('src')).not.toContain('/api/assets/21/thumbnail');
      expect(vectorPreview.getAttribute('src')).not.toContain('/api/assets/22/thumbnail');
    }
  );

  it('uses the EPS source bounding box when cached thumbnails still have a 16:9 canvas', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 206,
      arrayBuffer: jest.fn().mockResolvedValue(
        Uint8Array.from(
          [...'%!PS-Adobe-3.0 EPSF-3.0\n%%HiResBoundingBox: 0 0 595.2756 841.8898\n']
            .map((character) => character.charCodeAt(0))
        ).buffer
      ),
    });

    try {
      render(
        <ImageGrid
          filteredImages={[{ id: 218, filename: 'new-year.eps', title: 'New Year' }]}
          darkMode={false}
        />
      );

      const image = screen.getByRole('img', { name: 'New Year' });
      image.parentElement.getBoundingClientRect = () => ({ width: 220 });
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 640 });
      Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 360 });
      fireEvent.load(image);

      await waitFor(() => {
        expect(image.style.aspectRatio).toBe('595.2756 / 841.8898');
      });
      expect(image.style.objectFit).toBe('contain');
      expect(image.parentElement.style.gridRowEnd).toBe('span 14');
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/images/218',
        expect.objectContaining({
          credentials: 'include',
          headers: { Range: 'bytes=0-65535' },
        })
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it.each([
    ['psd', 1],
    ['psb', 2],
  ])('uses the %s source dimensions instead of a stale 16:9 thumbnail', async (extension, version) => {
    const originalFetch = global.fetch;
    const header = new ArrayBuffer(26);
    const view = new DataView(header);
    new Uint8Array(header, 0, 4).set([0x38, 0x42, 0x50, 0x53]);
    view.setUint16(4, version, false);
    view.setUint16(12, 3, false);
    view.setUint32(14, 2400, false);
    view.setUint32(18, 1600, false);
    view.setUint16(22, 8, false);
    view.setUint16(24, 3, false);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 206,
      arrayBuffer: jest.fn().mockResolvedValue(header),
    });

    try {
      render(
        <ImageGrid
          filteredImages={[{ id: 197, filename: `layered.${extension}`, title: 'Layered asset' }]}
          darkMode={false}
        />
      );

      const image = screen.getByRole('img', { name: 'Layered asset' });
      image.parentElement.getBoundingClientRect = () => ({ width: 220 });
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 640 });
      Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 360 });
      fireEvent.load(image);

      await waitFor(() => {
        expect(image.style.aspectRatio).toBe('1600 / 2400');
      });
      expect(image.style.objectFit).toBe('contain');
      expect(image.parentElement.style.gridRowEnd).toBe('span 15');
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/images/197',
        expect.objectContaining({
          credentials: 'include',
          headers: { Range: 'bytes=0-65535' },
        })
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('renders assets in the provided newest-first order across the grid', () => {
    const firstAsset = { id: 1, filename: 'first.jpg', title: 'First image' };
    const secondAsset = { id: 2, filename: 'second.jpg', title: 'Second image' };
    render(
      <ImageGrid filteredImages={[firstAsset, secondAsset]} darkMode={false} />
    );
    const firstCard = screen.getByRole('img', { name: 'First image' }).parentElement;
    expect(screen.getByRole('img', { name: 'First image' }).parentElement).toBe(firstCard);
    expect([...document.querySelectorAll('.explore-asset-grid img')].map((image) => image.alt))
      .toEqual(['First image', 'Second image']);
    expect(screen.getByRole('img', { name: 'Second image' })).toBeInTheDocument();
  });

  it('requests each thumbnail only when it approaches the viewport', () => {
    const observers = [];
    const observerOptions = [];
    const OriginalIntersectionObserver = global.IntersectionObserver;
    global.IntersectionObserver = class MockIntersectionObserver {
      constructor(callback, options) {
        this.callback = callback;
        observerOptions.push(options);
        observers.push(this);
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    };

    try {
      render(
        <ImageGrid
          filteredImages={[
            { id: 1, filename: 'one.jpg', title: 'First image' },
            { id: 2, filename: 'two.jpg', title: 'Second image' },
          ]}
          darkMode={false}
        />
      );

      const firstImage = screen.getByRole('img', { name: 'First image' });
      const secondImage = screen.getByRole('img', { name: 'Second image' });
      expect(firstImage).not.toHaveAttribute('src');
      expect(secondImage).not.toHaveAttribute('src');
      expect(observers).toHaveLength(1);
      expect(observerOptions[0]).toEqual({ rootMargin: '0px' });

      firstImage.getBoundingClientRect = () => ({
        top: window.innerHeight + 20,
        bottom: window.innerHeight + 220,
      });
      act(() => {
        observers[0].callback([{ target: firstImage, isIntersecting: true }]);
      });

      expect(firstImage).not.toHaveAttribute('src');

      firstImage.getBoundingClientRect = () => ({ top: 10, bottom: 210 });
      act(() => {
        observers[0].callback([{ target: firstImage, isIntersecting: true }]);
      });

      expect(firstImage.getAttribute('src')).toContain('/api/catalog-preview/1?quality=63');
      expect(secondImage).not.toHaveAttribute('src');
    } finally {
      global.IntersectionObserver = OriginalIntersectionObserver;
    }
  });

  it('applies dark styling to cards and text when dark mode is enabled', () => {
    const props = {
      filteredImages: [
        {
          id: 1,
          filename: 'sample.jpg',
          title: 'Sample Title',
          category: 'Photos',
          collection: 'Summer',
          uploaded_by: 'Alice',
          keywords: 'sunset',
          likes: 5,
          views: 10,
          downloads: 2,
          created_at: '2024-01-01T00:00:00.000Z',
        },
      ],
      darkMode: true,
      fetchSingleImage: jest.fn(),
      likeImage: jest.fn(),
      addFavorite: jest.fn(),
      downloadImage: jest.fn(),
      shareImage: jest.fn(),
    };

    const { container } = render(<ImageGrid {...props} />);

    const card = screen.getByRole('img', { name: /sample title/i }).parentElement;
    expect(card.style.background).toBe('rgb(30, 30, 30)');
  });
});
