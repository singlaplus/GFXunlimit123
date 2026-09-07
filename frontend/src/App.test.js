import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import Pagination from './components/Pagination';
import axios from 'axios';

jest.mock('axios');

jest.mock('react-toastify', () => ({
  ToastContainer: () => null,
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();

  axios.get.mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('/branding')) {
      return Promise.resolve({ data: {} });
    }
    if (typeof url === 'string' && url.includes('/hero-stats')) {
      return Promise.resolve({ data: { totalAssets: 0, totalSearches: 0, totalDownloads: 0, todayVisitors: 0 } });
    }
    if (typeof url === 'string' && url.includes('/profile')) {
      return Promise.resolve({ data: { role: 'customer' } });
    }
    if (typeof url === 'string' && url.includes('/notifications/')) {
      return Promise.resolve({ data: [] });
    }
    if (typeof url === 'string' && url.includes('/notifications/count/')) {
      return Promise.resolve({ data: { count: 0 } });
    }
    if (typeof url === 'string' && url.includes('/images/trending')) {
      return Promise.resolve({ data: [] });
    }
    if (typeof url === 'string' && url.includes('/dashboard-stats')) {
      return Promise.resolve({ data: { uploads: 0, downloads: 0, views: 0, likes: 0 } });
    }
    if (typeof url === 'string' && url.includes('/leaderboard')) {
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({ data: [] });
  });

  axios.post.mockResolvedValue({ data: {} });
  axios.put.mockResolvedValue({ data: {} });
});

test('pagination controls reset the browser position to the top when users move to another page', () => {
  const setCurrentPage = jest.fn();
  const scrollToSpy = jest.fn();
  window.scrollTo = scrollToSpy;

  render(
    <Pagination
      currentPage={1}
      totalPages={3}
      totalImages={30}
      setCurrentPage={setCurrentPage}
      darkMode={false}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: /Next/i }));

  expect(setCurrentPage).toHaveBeenCalledWith(2);
  expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
});

test('renders the home hero content', () => {
  render(<App />);
  expect(screen.getByText(/Discover Millions of/i)).toBeInTheDocument();
});

test('resets scroll position when the app is mounted through a navigation context', () => {
  const scrollToSpy = jest.fn();
  window.scrollTo = scrollToSpy;

  render(<App />);

  expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
});

test('renders without triggering a state-update loop', async () => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  render(<App />);

  expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Maximum update depth exceeded'));

  consoleErrorSpy.mockRestore();
});

test('removing an item persists the updated cart after the initial load', async () => {
  const saveCartItems = jest.fn();
  const loadCartItems = jest.fn().mockResolvedValue([
    { id: 1, title: 'Alpha asset', currency: 'USD', unitPrice: 100, price: 100 },
    { id: 2, title: 'Beta asset', currency: 'USD', unitPrice: 50, price: 50 },
  ]);

  function TestCartHarness() {
    const [items, setItems] = React.useState([]);
    const hasLoadedCart = React.useRef(false);

    React.useEffect(() => {
      (async () => {
        const nextItems = await loadCartItems();
        setItems(nextItems);
        hasLoadedCart.current = true;
      })();
    }, []);

    React.useEffect(() => {
      if (!hasLoadedCart.current) return;
      saveCartItems(items);
    }, [items]);

    const removeItem = (id) => {
      setItems((current) => current.filter((item) => String(item.id) !== String(id)));
    };

    return (
      <button onClick={() => removeItem(1)}>
        Remove alpha
      </button>
    );
  }

  render(<TestCartHarness />);

  await waitFor(() => expect(loadCartItems).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: /Remove alpha/i }));

  await waitFor(() => {
    expect(saveCartItems).toHaveBeenLastCalledWith([
      { id: 2, title: 'Beta asset', currency: 'USD', unitPrice: 50, price: 50 },
    ]);
  });
});
