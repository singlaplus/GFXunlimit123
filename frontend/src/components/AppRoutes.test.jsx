import { render, screen } from "@testing-library/react";
import AppRoutes from "./AppRoutes";

const mockLocation = { pathname: "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/analytics" };

jest.mock("react-router-dom", () => ({
  useLocation: () => mockLocation,
  Navigate: ({ to }) => <div>{to}</div>,
}), { virtual: true });

jest.mock("../pages/AdminAnalyticsPage", () => () => <div>Admin Analytics</div>);
jest.mock("../pages/AdminOrdersPage", () => () => <div>Admin Orders</div>);
jest.mock("../pages/ExplorePage", () => () => <div>Explore Page</div>);
jest.mock("../pages/OrderHistoryPage", () => () => <div>Order History</div>);

describe("AppRoutes", () => {
  it("renders admin analytics for admin users regardless of role casing", () => {
    render(<AppRoutes userRole="Admin" activePage="analytics" />);
    expect(screen.getByText("Admin Analytics")).toBeInTheDocument();
  });

  it("renders the page for the current pathname even when the cached active page is stale", () => {
    mockLocation.pathname = "/explore";
    render(
      <AppRoutes
        userRole="customer"
        activePage="home"
        homeSectionProps={{
          homePageProps: {},
          galleryProps: {},
          containerProps: {
            loading: false,
            filteredImages: [],
            currentPage: 1,
            totalPages: 1,
            totalImages: 0,
            setCurrentPage: jest.fn(),
            selectedImage: null,
            setSelectedImage: jest.fn(),
            darkMode: false,
            relatedImages: [],
            fetchSingleImage: jest.fn(),
            goToPreviousImage: jest.fn(),
            goToNextImage: jest.fn(),
            likeImage: jest.fn(),
            addFavorite: jest.fn(),
            downloadImage: jest.fn(),
            shareImage: jest.fn(),
          },
          popupProps: {
            selectedContributor: null,
            setSelectedContributor: jest.fn(),
            contributorImages: [],
            contributorLikes: [],
            contributorViews: [],
            contributorDownloads: [],
            contributorBestImage: null,
          },
        }}
      />
    );
    expect(screen.getByText("Explore Page")).toBeInTheDocument();
  });

  it("renders order history for customer orders route", () => {
    mockLocation.pathname = "/orders";
    render(<AppRoutes userRole="customer" activePage="home" homeSectionProps={{ homePageProps: {}, galleryProps: {}, containerProps: { loading: false, filteredImages: [], currentPage: 1, totalPages: 1, totalImages: 0, setCurrentPage: jest.fn(), selectedImage: null, setSelectedImage: jest.fn(), darkMode: false, relatedImages: [], fetchSingleImage: jest.fn(), goToPreviousImage: jest.fn(), goToNextImage: jest.fn(), likeImage: jest.fn(), addFavorite: jest.fn(), downloadImage: jest.fn(), shareImage: jest.fn() }, popupProps: { selectedContributor: null, setSelectedContributor: jest.fn(), contributorImages: [], contributorLikes: [], contributorViews: [], contributorDownloads: [], contributorBestImage: null } }} />);
    expect(screen.getByText("Order History")).toBeInTheDocument();
  });
});
