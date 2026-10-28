import { act, render, screen, waitFor } from '@testing-library/react';
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

    await userEvent.hover(screen.getByRole('button', { name: /^admin$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^controls$/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=controls');
  });

  it('shows the Dashboard tab only for admin users and navigates to the admin dashboard', async () => {
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('userRole', 'admin');

    const { unmount } = render(
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

    expect(screen.getByRole('button', { name: /^dashboard$/i }).parentElement).toHaveClass('admin-menu-dropdown');
    await userEvent.hover(screen.getByRole('button', { name: /^admin$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^dashboard$/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=admin_dashboard');
    expect(screen.getByRole('button', { name: /^dashboard$/i }).parentElement.parentElement).not.toHaveClass('is-open');

    unmount();
    localStorage.setItem('userRole', 'customer');
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

    expect(screen.queryByRole('button', { name: /^dashboard$/i })).not.toBeInTheDocument();
  });

  it('shows Admin and Tools dropdown actions for admin users', async () => {
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

    const adminButton = screen.getByRole('button', { name: /^admin$/i });
    await userEvent.hover(adminButton);
    const dashboardButton = screen.getByRole('button', { name: /^dashboard$/i });
    const controlsButton = screen.getByRole('button', { name: /^controls$/i });
    const liveAssetsButton = screen.getByRole('button', { name: /^live assets$/i });
    const usersButton = screen.getByRole('button', { name: /^users$/i });
    const messagesButton = screen.getByRole('button', { name: /messages/i });
    const toolsButton = screen.getByRole('button', { name: /^tools$/i });
    const assetFilter = screen.getByLabelText(/all assets/i);
    expect(assetFilter.compareDocumentPosition(toolsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(adminButton.compareDocumentPosition(messagesButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(messagesButton.compareDocumentPosition(dashboardButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dashboardButton.compareDocumentPosition(controlsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(controlsButton.compareDocumentPosition(liveAssetsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(liveAssetsButton.compareDocumentPosition(usersButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(adminButton);
    expect(mockNavigate).not.toHaveBeenCalled();

    await userEvent.click(dashboardButton);
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=admin_dashboard');
    expect(adminButton.parentElement).not.toHaveClass('is-open');

    mockNavigate.mockReset();
    await userEvent.hover(adminButton);
    await userEvent.click(controlsButton);
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=controls');
    expect(adminButton.parentElement).not.toHaveClass('is-open');

    mockNavigate.mockReset();
    await userEvent.hover(adminButton);
    await userEvent.click(liveAssetsButton);
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=live-assets');
    expect(adminButton.parentElement).not.toHaveClass('is-open');

    mockNavigate.mockReset();
    await userEvent.hover(adminButton);
    await userEvent.click(usersButton);
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=users');
    expect(adminButton.parentElement).not.toHaveClass('is-open');

    mockNavigate.mockReset();
    await userEvent.hover(adminButton);
    await userEvent.click(messagesButton);
    expect(mockNavigate).toHaveBeenCalledWith('/messages');
    expect(adminButton.parentElement).not.toHaveClass('is-open');

    mockNavigate.mockReset();
    await userEvent.hover(toolsButton);
    const toolsMenu = screen.getByRole('menu', { name: 'Tools menu' });
    const promotionsButton = screen.getByRole('button', { name: /^promotions$/i });
    const analyticsButton = screen.getByRole('button', { name: /^analytics$/i });
    const commerceButton = screen.getByRole('button', { name: /^commerce$/i });
    const ordersButton = screen.getByRole('button', { name: /^orders$/i });
    expect(toolsMenu).toContainElement(promotionsButton);
    expect(toolsMenu).toContainElement(analyticsButton);
    expect(toolsMenu).toContainElement(commerceButton);
    expect(toolsMenu).toContainElement(ordersButton);
    expect(promotionsButton.compareDocumentPosition(analyticsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(analyticsButton.compareDocumentPosition(commerceButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(commerceButton.compareDocumentPosition(ordersButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    localStorage.setItem("adminPromotionsActiveSection", "coupons");
    await userEvent.click(promotionsButton);
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=promotions');
    expect(localStorage.getItem("adminPromotionsActiveSection")).toBeNull();
    expect(toolsButton.parentElement).not.toHaveClass('is-open');

    mockNavigate.mockReset();
    await userEvent.hover(toolsButton);
    await userEvent.click(analyticsButton);
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/analytics');
    expect(toolsButton.parentElement).not.toHaveClass('is-open');

    mockNavigate.mockReset();
    await userEvent.hover(toolsButton);
    await userEvent.click(commerceButton);
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/commerce');
    expect(toolsButton.parentElement).not.toHaveClass('is-open');

    mockNavigate.mockReset();
    await userEvent.hover(toolsButton);
    await userEvent.click(ordersButton);
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/orders');
    expect(toolsButton.parentElement).not.toHaveClass('is-open');

    const seoButton = screen.getByRole('button', { name: /^seo$/i });
    expect(toolsButton.compareDocumentPosition(seoButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.hover(seoButton);
    const seoMenu = screen.getByRole('menu', { name: 'SEO menu' });
    const searchConsoleButton = screen.getByRole('button', { name: 'Google Search Console' });
    const googleAnalyticsButton = screen.getByRole('button', { name: 'Google Analytics' });
    expect(seoMenu).toContainElement(searchConsoleButton);
    expect(seoMenu).toContainElement(googleAnalyticsButton);

    await userEvent.click(searchConsoleButton);
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/search_console');
    expect(seoButton.parentElement).not.toHaveClass('is-open');

    mockNavigate.mockReset();
    await userEvent.hover(seoButton);
    await userEvent.click(googleAnalyticsButton);
    expect(mockNavigate).toHaveBeenCalledWith('/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/google_analytics');
    expect(seoButton.parentElement).not.toHaveClass('is-open');
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

  it('disables unpaid payout button while unpaid earnings are below 100', () => {
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
        earningsStats={{ total_earnings: 99.99 }}
      />
    );

    const button = screen.getByRole('button', { name: /unpaid: ₹99.99/i });
    expect(button).toBeDisabled();
  });

  it('shows the upcoming Flash Sale ribbon with its IST start date', async () => {
    axios.get.mockImplementation((url) => (
      url.endsWith('/promotions/upcoming-flash-sales')
        ? Promise.resolve({ data: { sales: [
          { id: 8, name: 'BOG Photos', discount_rule: 'BOGO', start_date: '2026-11-02' },
          { id: 11, name: 'Later Sale', discount_rule: 'PERCENTAGE', metadata: { discount_value: 20 }, start_date: '2026-11-09' },
        ] } })
        : url.endsWith('/checkout/active-flash-sales')
          ? Promise.resolve({ data: { sales: [
            { id: 9, name: 'Current Sale', discount_rule: 'PERCENTAGE', metadata: { discount_value: 15 }, end_date: '2026-10-30' },
            { id: 10, name: 'Fixed Sale', discount_rule: 'FIXED_AMOUNT', metadata: { discount_value: 25 }, end_date: '2026-10-30' },
          ] } })
        : Promise.resolve({ data: {} })
    ));

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
      />
    );

    const ribbon = await screen.findByLabelText('Upcoming Flash Sales');
    expect(ribbon).toHaveClass('upcoming-flash-sale-ribbon');
    expect(ribbon.querySelector('.upcoming-flash-sale-label')).toHaveTextContent('FLASH SALE');
    expect(ribbon).toHaveTextContent('BOG Photos');
    expect(ribbon).not.toHaveTextContent('Later Sale');
    expect(ribbon).toHaveTextContent('Buy One Get One');
    expect(ribbon.querySelector('.upcoming-flash-sale-discount')).toHaveTextContent('Buy One Get One');
    expect(ribbon).toHaveTextContent('Starts on 2nd Nov 2026 IST');
    expect(ribbon).toHaveTextContent(/Time left \d+d \d{2}h \d{2}m \d{2}s/);
    expect(ribbon.querySelectorAll('.upcoming-flash-sale-group')).toHaveLength(1);
    expect(ribbon.querySelectorAll('.upcoming-flash-sale-item')).toHaveLength(1);

    const liveSaleDetails = await screen.findByLabelText('Live Flash Sale details');
    expect(liveSaleDetails).toHaveTextContent('15% off');
    expect(liveSaleDetails).toHaveTextContent('₹25 Fixed Off');
    expect(liveSaleDetails).toHaveTextContent(/Time left \d+d \d{2}h \d{2}m \d{2}s/);
    expect(liveSaleDetails).toHaveClass('upcoming-flash-sale-live-panel');
    expect(liveSaleDetails.querySelector('.upcoming-flash-sale-discount')).toHaveTextContent('15% off');
    expect(liveSaleDetails.querySelector('.upcoming-flash-sale-live-item > span')).toHaveTextContent(/Time left/);
  });

  it('hides the Flash Sale banner from logged-in contributors', async () => {
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('userRole', 'contributor');
    axios.get.mockImplementation((url) => (
      url.endsWith('/promotions/upcoming-flash-sales')
        ? Promise.resolve({ data: { sales: [{ id: 8, name: 'BOG Photos', discount_rule: 'BOGO', start_date: '2026-11-02' }] } })
        : url.endsWith('/checkout/active-flash-sales')
          ? Promise.resolve({ data: { sales: [{ id: 9, name: 'Current Sale', discount_rule: 'BOGO', end_date: '2026-10-30' }] } })
          : Promise.resolve({ data: {} })
    ));

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
        userRole="contributor"
      />
    );

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/promotions/upcoming-flash-sales'));
    });
    expect(screen.queryByLabelText('Upcoming Flash Sales')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Live Flash Sale details')).not.toBeInTheDocument();
  });

  it('shows active Contributor Offers in a blue ribbon for logged-in contributors', async () => {
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('userRole', 'contributor');
    axios.get.mockImplementation((url) => (
      url.endsWith('/promotions/active-contributor-offers')
        ? Promise.resolve({
          data: {
            offers: [{
              id: 45,
              name: 'Upload bonus',
              end_date: '2026-11-02',
              benefit_type: 'bonus_payout',
              benefit_value: 500,
              eligibility_requirements: 'uploads',
              eligibility_requirement_value: 10,
              is_applied: false,
              progress_count: 0,
            }],
          },
        })
        : Promise.resolve({ data: {} })
    ));

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
        userRole="contributor"
      />
    );

    const ribbon = await screen.findByLabelText('Active Contributor Offers');
    expect(ribbon).toHaveClass('contributor-offer-ribbon');
    expect(ribbon).toHaveTextContent('Upload bonus · Bonus payout ₹500 · Uploads 10');
    expect(ribbon.parentElement).toHaveClass('app-header');
    expect(ribbon.querySelector('.contributor-offer-ribbon-label')).toHaveTextContent('CONTRIBUTOR OFFER');
    expect(ribbon.querySelector('.contributor-offer-ribbon-list')).toHaveClass('contributor-offer-ribbon-list');
    const applyButton = screen.getByRole('button', { name: 'Apply' });
    expect(applyButton).toBeInTheDocument();
    expect(ribbon).not.toHaveClass('is-applied');
    await userEvent.click(applyButton);
    expect(await screen.findByLabelText('Applied Contributor Offer')).toHaveClass('is-applied');
    expect(screen.getByRole('button', { name: 'Applied' })).toBeDisabled();
    expect(screen.getByLabelText('Contributor offer time remaining')).toHaveTextContent(/Time left \d+d \d{2}h \d{2}m \d{2}s/);
    expect(ribbon).toHaveTextContent('Uploads 0/10');
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/promotions/active-contributor-offers/45/apply'),
      {},
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer demo-token' }) })
    );
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/promotions/active-contributor-offers'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer demo-token' }) })
    );
  });

  it('returns a withdrawn Contributor Offer ribbon to the blue Apply state', async () => {
    jest.useFakeTimers();
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('userRole', 'contributor');
    let applicationStatus = 'pending';
    axios.get.mockImplementation((url) => (
      url.endsWith('/promotions/active-contributor-offers')
        ? Promise.resolve({
          data: {
            offers: [{
              id: 45,
              name: 'Upload bonus',
              end_date: '2026-11-02',
              eligibility_requirements: 'uploads',
              eligibility_requirement_value: 10,
              is_applied: applicationStatus !== 'withdrawn',
              application_status: applicationStatus,
              progress_count: 2,
            }],
          },
        })
        : Promise.resolve({ data: {} })
    ));

    const { unmount } = render(
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
        userRole="contributor"
      />
    );

    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByLabelText('Applied Contributor Offer')).toHaveClass('is-applied');
      expect(screen.getByRole('button', { name: 'Applied' })).toBeDisabled();

      applicationStatus = 'completed';
      await act(async () => {
        jest.advanceTimersByTime(30 * 1000);
        await Promise.resolve();
        await Promise.resolve();
      });

      const completedRibbon = screen.getByLabelText('Completed Contributor Offer');
      expect(completedRibbon).toHaveClass('is-applied', 'is-completed');
      expect(screen.getByRole('button', { name: 'Completed' })).toBeDisabled();
      expect(screen.getByLabelText('Contributor offer time remaining')).toHaveTextContent(/Time left \d+d \d{2}h \d{2}m \d{2}s/);

      applicationStatus = 'withdrawn';
      await act(async () => {
        jest.advanceTimersByTime(30 * 1000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByLabelText('Active Contributor Offers')).not.toHaveClass('is-applied');
      expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
      expect(screen.queryByLabelText('Contributor offer time remaining')).not.toBeInTheDocument();
    } finally {
      unmount();
      jest.useRealTimers();
    }
  });

  it('does not request or show Contributor Offers for non-contributors', () => {
    localStorage.setItem('token', 'demo-token');
    localStorage.setItem('userRole', 'customer');

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

    expect(screen.queryByLabelText('Active Contributor Offers')).not.toBeInTheDocument();
    expect(axios.get).not.toHaveBeenCalledWith(
      expect.stringContaining('/promotions/active-contributor-offers'),
      expect.anything()
    );
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
