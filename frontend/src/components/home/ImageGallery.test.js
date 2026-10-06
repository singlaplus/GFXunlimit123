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

    await userEvent.click(screen.getByRole('button', { name: /^Categories/ }));
    await userEvent.click(screen.getByRole('button', { name: /Images/i }));

    expect(setSelectedCategory).toHaveBeenCalledWith('Images');
    expect(setCurrentPage).toHaveBeenCalledWith(1);
    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });

  it('keeps categories closed until the filter is clicked', async () => {
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

    const categoriesToggle = screen.getByRole('button', { name: /^Categories/ });
    const categoriesPanel = screen.getByTestId('categories-panel');
    expect(categoriesToggle).toHaveAttribute('aria-expanded', 'false');
    expect(categoriesPanel).toHaveStyle({ maxHeight: '0px', pointerEvents: 'none' });

    await userEvent.click(categoriesToggle);

    expect(categoriesToggle).toHaveAttribute('aria-expanded', 'true');
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

      if (url.includes('/catalog/facets')) {
        return Promise.resolve({ data: {
          totalImages: 117,
          categoryCounts: [{ name: 'Images', count: 2 }, { name: 'Templates', count: 1 }],
          collectionCounts: [],
        } });
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

    expect(await screen.findByRole('button', { name: 'All (117)' })).toBeInTheDocument();
    expect(axios.get).not.toHaveBeenCalledWith(expect.stringContaining('/images?limit='));
  });

  it('offers page sizes of 50, 100, and 200 while showing the full catalog count', () => {
    render(
      <ImageGallery
        search=""
        setSearch={jest.fn()}
        setCurrentPage={jest.fn()}
        sortType="newest"
        setSortType={jest.fn()}
        selectedCategory="All"
        setSelectedCategory={jest.fn()}
        selectedCollection="All"
        setSelectedCollection={jest.fn()}
        darkMode={false}
        allImages={Array.from({ length: 50 }, (_, index) => ({ id: index + 1 }))}
        totalImages={144}
        resultsPerPage={50}
        setResultsPerPage={jest.fn()}
      />
    );

    expect(screen.getByText('Showing 50 of 144')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '50', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '100', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '200', exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '10', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '20', exact: true })).not.toBeInTheDocument();
  });

  it('keeps the final page at the full page-size count for display purposes', () => {
    render(
      <ImageGallery
        search=""
        setSearch={jest.fn()}
        setCurrentPage={jest.fn()}
        sortType="newest"
        setSortType={jest.fn()}
        selectedCategory="All"
        setSelectedCategory={jest.fn()}
        selectedCollection="All"
        setSelectedCollection={jest.fn()}
        darkMode={false}
        allImages={Array.from({ length: 48 }, (_, index) => ({ id: index + 1 }))}
        totalImages={148}
        resultsPerPage={50}
        setResultsPerPage={jest.fn()}
      />
    );

    expect(screen.getByText('Showing 50 of 148')).toBeInTheDocument();
  });
});
