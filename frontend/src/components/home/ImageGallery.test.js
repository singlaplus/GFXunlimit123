import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { useState } from 'react';
import ImageGallery from './ImageGallery';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

function StatefulImageGallery(props) {
  const [search, setSearch] = useState('');
  return <ImageGallery {...props} search={search} setSearch={setSearch} />;
}

describe('ImageGallery search suggestions', () => {
  beforeEach(() => {
    axios.get.mockResolvedValue({ data: [] });
  });

  it('scrolls back to the top when an explore sidebar category selection changes the page', async () => {
    const scrollToSpy = jest.fn();
    window.scrollTo = scrollToSpy;

    const setCurrentPage = jest.fn();
    const setSelectedCategory = jest.fn();

    render(
      <ImageGallery
        search=""
        setSearch={jest.fn()}
        setCurrentPage={setCurrentPage}
        sortType="newest"
        setSortType={jest.fn()}
        selectedCategory="All"
        setSelectedCategory={setSelectedCategory}
        selectedCollection="All"
        setSelectedCollection={jest.fn()}
        darkMode={false}
        allImages={[]}
        totalImages={0}
        resultsPerPage={20}
        setResultsPerPage={jest.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /Images/i }));

    expect(setSelectedCategory).toHaveBeenCalledWith('Images');
    expect(setCurrentPage).toHaveBeenCalledWith(1);
    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });

  it('shows a scrollable category panel so the full category list remains visible', () => {
    render(
      <StatefulImageGallery
        setCurrentPage={jest.fn()}
        sortType="newest"
        setSortType={jest.fn()}
        selectedCategory="All"
        setSelectedCategory={jest.fn()}
        selectedCollection="All"
        setSelectedCollection={jest.fn()}
        darkMode={false}
        allImages={[]}
      />
    );

    const categoriesPanel = screen.getByTestId('categories-panel');
    expect(categoriesPanel).toHaveStyle({ maxHeight: '360px', overflowY: 'auto' });
  });

  it('renders categories returned by the API in the explore sidebar', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/categories')) {
        return Promise.resolve({ data: [{ name: 'Nature' }, { name: 'Travel' }] });
      }

      if (url.includes('/collections')) {
        return Promise.resolve({ data: [] });
      }

      return Promise.resolve({ data: [] });
    });

    render(
      <StatefulImageGallery
        setCurrentPage={jest.fn()}
        sortType="newest"
        setSortType={jest.fn()}
        selectedCategory="All"
        setSelectedCategory={jest.fn()}
        selectedCollection="All"
        setSelectedCollection={jest.fn()}
        darkMode={false}
        allImages={[]}
      />
    );

    expect(await screen.findByText('Nature')).toBeInTheDocument();
    expect(screen.getByText('Travel')).toBeInTheDocument();
  });

  it('uses the backend/approved image total for the All category count', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/categories')) {
        return Promise.resolve({ data: [] });
      }

      if (url.includes('/collections')) {
        return Promise.resolve({ data: [] });
      }

      if (url.includes('limit=1')) {
        return Promise.resolve({ data: { totalImages: 117, images: [] } });
      }

      if (url.includes('limit=117')) {
        return Promise.resolve({ data: { totalImages: 117, images: [
          { id: 1, category: 'Images,Templates' },
          { id: 2, category: 'Images' },
        ] } });
      }

      return Promise.resolve({ data: [] });
    });

    render(
      <StatefulImageGallery
        setCurrentPage={jest.fn()}
        sortType="newest"
        setSortType={jest.fn()}
        selectedCategory="All"
        setSelectedCategory={jest.fn()}
        selectedCollection="All"
        setSelectedCollection={jest.fn()}
        darkMode={false}
        allImages={[]}
      />
    );

    expect(await screen.findByText('All (117)')).toBeInTheDocument();
  });
});
