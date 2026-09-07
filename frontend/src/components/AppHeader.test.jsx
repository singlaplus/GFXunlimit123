import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import AppHeader from './AppHeader';
import { ToastContainer } from 'react-toastify';

const mockNavigate = jest.fn();
const mockLocation = { pathname: '/explore', search: '' };

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}), { virtual: true });

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock('./LoginModal', () => () => <div data-testid="login-modal" />);
jest.mock('./JoinModal', () => () => <div data-testid="join-modal" />);
jest.mock('./NotificationsPanel', () => () => <div data-testid="notifications-panel" />);

describe('AppHeader customer navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    mockNavigate.mockReset();
    mockLocation.pathname = '/explore';
    mockLocation.search = '';
    axios.get.mockResolvedValue({ data: {} });
    axios.post.mockResolvedValue({ data: {} });
  });

  it('shows customer navigation links without a search bar on the explore page', async () => {
    localStorage.setItem('token', 'demo-token');

    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

    render(
      <>
        <AppHeader
        showNotifications={false}
        setShowNotifications={jest.fn()}
        notificationCount={0}
        setNotificationCount={jest.fn()}
        setShowLoginModal={jest.fn()}
        setShowJoinModal={jest.fn()}
        showLoginModal={false}
        showJoinModal={false}
        joinModalAccountType=""
        setJoinModalAccountType={jest.fn()}
        darkMode={false}
        notifications={[]}
        setActivePage={jest.fn()}
        setDarkMode={jest.fn()}
        userRole="customer"
        />
        <ToastContainer />
      </>
    );

    expect(screen.getByRole('button', { name: /explore/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my collections/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add credits/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
    
    // open credits menu and add 100 credits
    userEvent.click(screen.getByRole('button', { name: /add credits/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /\+100 Credits/i })).toBeInTheDocument());
    const option = screen.getByRole('button', { name: /\+100 Credits/i });
    userEvent.click(option);

    await screen.findByText(/100 credits added successfully/i);
    expect(global.fetch).toHaveBeenCalled();
    // menu should be closed after selection
    expect(screen.queryByRole('button', { name: /\+100 Credits/i })).toBeNull();

    global.fetch.mockRestore && global.fetch.mockRestore();
  });

  it('opens the account menu with the user name, account, profile, and logout actions', async () => {
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('username', 'jane');
    localStorage.setItem('fullName', 'Jane Doe');

    render(
      <AppHeader
        showNotifications={false}
        setShowNotifications={jest.fn()}
        notificationCount={0}
        setNotificationCount={jest.fn()}
        setShowLoginModal={jest.fn()}
        setShowJoinModal={jest.fn()}
        showLoginModal={false}
        showJoinModal={false}
        joinModalAccountType=""
        setJoinModalAccountType={jest.fn()}
        darkMode={false}
        notifications={[]}
        setDarkMode={jest.fn()}
        userRole="customer"
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /open account menu for jane doe/i }));

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^my account$/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^profile$/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^logout$/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^my account$/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/customer');
  });

  it('resets the browser viewport when the header menu sends a user to another route', async () => {
    localStorage.setItem('token', 'demo-token');

    const scrollToSpy = jest.fn();
    window.scrollTo = scrollToSpy;

    render(
      <AppHeader
        showNotifications={false}
        setShowNotifications={jest.fn()}
        notificationCount={0}
        setNotificationCount={jest.fn()}
        setShowLoginModal={jest.fn()}
        setShowJoinModal={jest.fn()}
        showLoginModal={false}
        showJoinModal={false}
        joinModalAccountType=""
        setJoinModalAccountType={jest.fn()}
        darkMode={false}
        notifications={[]}
        setActivePage={jest.fn()}
        setDarkMode={jest.fn()}
        userRole="customer"
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /explore/i }));

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });

  it('navigates to explore without relying on the legacy active-page setter', async () => {
    localStorage.setItem('token', 'demo-token');

    const setActivePage = jest.fn();
    const setSearch = jest.fn();
    const setCurrentPage = jest.fn();
    const setSortType = jest.fn();
    const setSelectedCategory = jest.fn();
    const setSelectedCollection = jest.fn();

    render(
      <AppHeader
        showNotifications={false}
        setShowNotifications={jest.fn()}
        notificationCount={0}
        setNotificationCount={jest.fn()}
        setShowLoginModal={jest.fn()}
        setShowJoinModal={jest.fn()}
        showLoginModal={false}
        showJoinModal={false}
        joinModalAccountType=""
        setJoinModalAccountType={jest.fn()}
        darkMode={false}
        notifications={[]}
        setActivePage={setActivePage}
        setDarkMode={jest.fn()}
        userRole="customer"
        setSearch={setSearch}
        setCurrentPage={setCurrentPage}
        setSortType={setSortType}
        setSelectedCategory={setSelectedCategory}
        setSelectedCollection={setSelectedCollection}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /explore/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/explore');
    expect(setActivePage).not.toHaveBeenCalled();
  });

  it('resets exploration state when the Explore button is clicked', async () => {
    localStorage.setItem('token', 'demo-token');

    const setSearch = jest.fn();
    const setCurrentPage = jest.fn();
    const setSortType = jest.fn();
    const setSelectedCategory = jest.fn();
    const setSelectedCollection = jest.fn();

    render(
      <AppHeader
        showNotifications={false}
        setShowNotifications={jest.fn()}
        notificationCount={0}
        setNotificationCount={jest.fn()}
        setShowLoginModal={jest.fn()}
        setShowJoinModal={jest.fn()}
        showLoginModal={false}
        showJoinModal={false}
        joinModalAccountType=""
        setJoinModalAccountType={jest.fn()}
        darkMode={false}
        notifications={[]}
        setActivePage={jest.fn()}
        setDarkMode={jest.fn()}
        userRole="customer"
        setSearch={setSearch}
        setCurrentPage={setCurrentPage}
        setSortType={setSortType}
        setSelectedCategory={setSelectedCategory}
        setSelectedCollection={setSelectedCollection}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /explore/i }));

    expect(setSearch).toHaveBeenCalledWith('');
    expect(setCurrentPage).toHaveBeenCalledWith(1);
    expect(setSortType).toHaveBeenCalledWith('newest');
    expect(setSelectedCategory).toHaveBeenCalledWith('All');
    expect(setSelectedCollection).toHaveBeenCalledWith('All');
    expect(mockNavigate).toHaveBeenCalledWith('/explore');
  });

  it('resets exploration state when navigating back to Explore from another page', async () => {
    localStorage.setItem('token', 'demo-token');
    mockLocation.pathname = '/profile';

    const setSearch = jest.fn();
    const setCurrentPage = jest.fn();
    const setSortType = jest.fn();
    const setSelectedCategory = jest.fn();
    const setSelectedCollection = jest.fn();

    render(
      <AppHeader
        showNotifications={false}
        setShowNotifications={jest.fn()}
        notificationCount={0}
        setNotificationCount={jest.fn()}
        setShowLoginModal={jest.fn()}
        setShowJoinModal={jest.fn()}
        showLoginModal={false}
        showJoinModal={false}
        joinModalAccountType=""
        setJoinModalAccountType={jest.fn()}
        darkMode={false}
        notifications={[]}
        setActivePage={jest.fn()}
        setDarkMode={jest.fn()}
        userRole="customer"
        setSearch={setSearch}
        setCurrentPage={setCurrentPage}
        setSortType={setSortType}
        setSelectedCategory={setSelectedCategory}
        setSelectedCollection={setSelectedCollection}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /explore/i }));

    expect(setSearch).toHaveBeenCalledWith('');
    expect(setCurrentPage).toHaveBeenCalledWith(1);
    expect(setSortType).toHaveBeenCalledWith('newest');
    expect(setSelectedCategory).toHaveBeenCalledWith('All');
    expect(setSelectedCollection).toHaveBeenCalledWith('All');
    expect(mockNavigate).toHaveBeenCalledWith('/explore');
  });

  it('hides the search bar for customer users on the home page', () => {
    localStorage.setItem('token', 'demo-token');
    mockLocation.pathname = '/';

    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

    render(
      <AppHeader
        showNotifications={false}
        setShowNotifications={jest.fn()}
        notificationCount={0}
        setNotificationCount={jest.fn()}
        setShowLoginModal={jest.fn()}
        setShowJoinModal={jest.fn()}
        showLoginModal={false}
        showJoinModal={false}
        joinModalAccountType=""
        setJoinModalAccountType={jest.fn()}
        darkMode={false}
        notifications={[]}
        setActivePage={jest.fn()}
        setDarkMode={jest.fn()}
        userRole="customer"
      />
    );

    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
  });

  it('shows a single All Assets dropdown for admin users', async () => {
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('userRole', 'admin');

    render(
      <AppHeader
        showNotifications={false}
        setShowNotifications={jest.fn()}
        notificationCount={0}
        setNotificationCount={jest.fn()}
        setShowLoginModal={jest.fn()}
        setShowJoinModal={jest.fn()}
        showLoginModal={false}
        showJoinModal={false}
        joinModalAccountType=""
        setJoinModalAccountType={jest.fn()}
        darkMode={false}
        notifications={[]}
        setActivePage={jest.fn()}
        setDarkMode={jest.fn()}
        userRole="admin"
      />
    );

    const assetFilter = screen.getByLabelText(/all assets/i);
    expect(assetFilter).toBeInTheDocument();

    await userEvent.selectOptions(assetFilter, 'pending');

    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?status=pending');
  });

  it('shows analytics and orders buttons for admin users and navigates to blank pages', async () => {
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('userRole', 'admin');

    render(
      <AppHeader
        showNotifications={false}
        setShowNotifications={jest.fn()}
        notificationCount={0}
        setNotificationCount={jest.fn()}
        setShowLoginModal={jest.fn()}
        setShowJoinModal={jest.fn()}
        showLoginModal={false}
        showJoinModal={false}
        joinModalAccountType=""
        setJoinModalAccountType={jest.fn()}
        darkMode={false}
        notifications={[]}
        setActivePage={jest.fn()}
        setDarkMode={jest.fn()}
        userRole="admin"
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /analytics/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/analytics');

    await userEvent.click(screen.getByRole('button', { name: /orders/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/orders');
  });

  it('shows unpaid earnings for contributor users near the dark mode toggle', () => {
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('userRole', 'contributor');

    render(
      <AppHeader
        showNotifications={false}
        setShowNotifications={jest.fn()}
        notificationCount={0}
        setNotificationCount={jest.fn()}
        setShowLoginModal={jest.fn()}
        setShowJoinModal={jest.fn()}
        showLoginModal={false}
        showJoinModal={false}
        joinModalAccountType=""
        setJoinModalAccountType={jest.fn()}
        darkMode={false}
        notifications={[]}
        setActivePage={jest.fn()}
        setDarkMode={jest.fn()}
        userRole="contributor"
        earningsStats={{ total_earnings: 125.5, total_downloads: 8, total_images: 2 }}
      />
    );

    expect(screen.getByText(/unpaid: ₹125.50/i)).toBeInTheDocument();
  });

  it('clears unpaid earnings after a successful payout submission', async () => {
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('userRole', 'contributor');
    localStorage.setItem('email', 'contri1@test.com');
    axios.post.mockResolvedValueOnce({ data: { requested_credits: 100 } });

    render(
      <AppHeader
        showNotifications={false}
        setShowNotifications={jest.fn()}
        notificationCount={0}
        setNotificationCount={jest.fn()}
        setShowLoginModal={jest.fn()}
        setShowJoinModal={jest.fn()}
        showLoginModal={false}
        showJoinModal={false}
        joinModalAccountType=""
        setJoinModalAccountType={jest.fn()}
        darkMode={false}
        notifications={[]}
        setActivePage={jest.fn()}
        setDarkMode={jest.fn()}
        userRole="contributor"
        earningsStats={{ total_earnings: 125.5 }}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /unpaid: ₹125.50/i }));
    expect(screen.getByRole('spinbutton')).toHaveAttribute('readonly');
    await userEvent.type(screen.getByPlaceholderText('Phone number'), '1234567890');
    await userEvent.type(screen.getByPlaceholderText('WhatsApp number'), '1234567890');
    await userEvent.upload(
      screen.getByLabelText('Cancelled check upload'),
      new File(['check'], 'cancelled-check.png', { type: 'image/png' })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Submit Request' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /unpaid: ₹0.00/i })).toBeInTheDocument());
  });

  it('shows bulk upload link for contributor users with permission', () => {
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('userRole', 'contributor');

    render(
      <AppHeader
        showNotifications={false}
        setShowNotifications={jest.fn()}
        notificationCount={0}
        setShowLoginModal={jest.fn()}
        setShowJoinModal={jest.fn()}
        showLoginModal={false}
        showJoinModal={false}
        joinModalAccountType=""
        setJoinModalAccountType={jest.fn()}
        darkMode={false}
        notifications={[]}
        setActivePage={jest.fn()}
        setDarkMode={jest.fn()}
        userRole="contributor"
        userPermissions={{ bulk_upload: true }}
      />
    );

    expect(screen.getByRole('button', { name: /bulk upload/i })).toBeInTheDocument();
  });
});
