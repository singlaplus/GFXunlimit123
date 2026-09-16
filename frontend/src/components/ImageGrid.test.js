import { render, screen } from '@testing-library/react';
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

  it('renders explore thumbnails using a 16:9 asset ratio', () => {
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
    expect(image.style.aspectRatio).toBe('16 / 9');
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
