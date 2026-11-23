import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AppRoutes from "./AppRoutes";
import axios from "axios";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

const mockLocation = {
  pathname: "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/analytics",
  search: "",
  state: null,
};
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
  Navigate: ({ to }) => <div>{to}</div>,
}), { virtual: true });

jest.mock("../pages/AdminAnalyticsPage", () => () => <div>Admin Analytics</div>);
jest.mock("../pages/AdminOrdersPage", () => () => <div>Admin Orders</div>);
jest.mock("../pages/ExplorePage", () => () => <div>Explore Page</div>);
jest.mock("../pages/OrderHistoryPage", () => () => <div>Order History</div>);
jest.mock("../pages/CartPage", () => () => <div>Cart Page</div>);
jest.mock("./CompanyPage", () => ({ slug }) => (
  <main><a href="http://localhost:3000/privacy">Privacy Policy</a><a href="http://localhost:3000/terms">Terms</a>{slug}</main>
));
jest.mock("../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));
jest.mock("axios");

describe("AppRoutes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/analytics";
    mockLocation.search = "";
    mockLocation.state = null;
    useStartupReadiness.mockReturnValue({
      auth: { status: "ready", role: "" },
      routeId: "route-test",
      reportResource: jest.fn(),
      reportAvailability: jest.fn(),
      availabilityRetryKey: 0,
    });
    axios.get.mockResolvedValue({
      data: {
        available: true,
        path: mockLocation.pathname,
        disabledLinks: [],
      },
    });
  });

  it("renders admin analytics for admin users regardless of role casing", () => {
    render(<AppRoutes userRole="Admin" activePage="analytics" />);
    expect(screen.getByText("Admin Analytics")).toBeInTheDocument();
  });

  it("uses the verified session role when rendering the cart route", async () => {
    mockLocation.pathname = "/cart";
    useStartupReadiness.mockReturnValue({
      auth: { status: "authenticated", role: "customer" },
      routeId: "cart-route",
      reportResource: jest.fn(),
      reportAvailability: jest.fn(),
      availabilityRetryKey: 0,
    });

    render(<AppRoutes userRole="" />);

    expect(await screen.findByText("Cart Page")).toBeInTheDocument();
  });

  it("does not grant cart access from a stale role when the session is anonymous", async () => {
    mockLocation.pathname = "/cart";
    useStartupReadiness.mockReturnValue({
      auth: { status: "anonymous", role: "" },
      routeId: "cart-route",
      reportResource: jest.fn(),
      reportAvailability: jest.fn(),
      availabilityRetryKey: 0,
    });

    render(<AppRoutes userRole="customer" />);

    expect(await screen.findByText("/")).toBeInTheDocument();
  });

  it("renders the Google Search Console connection section", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/search_console";

    render(<AppRoutes userRole="admin" activePage="home" />);

    expect(screen.getByRole("heading", { name: "Search integrations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Search Console" })).toBeInTheDocument();
  });

  it("opens Google authorization in a new popup from the connection dialog", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/google_analytics";
    const popup = { location: { replace: jest.fn() }, close: jest.fn() };
    const openPopup = jest.spyOn(window, "open").mockReturnValue(popup);
    const authorizationUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=test";
    axios.post.mockResolvedValue({ data: { authorizationUrl } });

    render(<AppRoutes userRole="admin" activePage="home" />);

    expect(screen.getByRole("heading", { name: "Google Analytics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Make every visit count." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect Google Analytics" }));
    const dialog = screen.getByRole("dialog", { name: "Choose a connection method" });
    const connectionOption = within(dialog).getByRole("button", { name: /Connect Google Analytics/ });
    await waitFor(() => expect(connectionOption).toBeEnabled());
    fireEvent.click(connectionOption);
    await waitFor(() => expect(popup.location.replace).toHaveBeenCalledWith(authorizationUrl));
    expect(openPopup).toHaveBeenCalledWith(
      "about:blank",
      "google-analytics-oauth",
      "popup=yes,width=560,height=720,resizable=yes,scrollbars=yes"
    );
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/google-analytics/connect"),
      {},
      expect.objectContaining({ headers: expect.any(Object) })
    );
    openPopup.mockRestore();
  });

  it("reports missing backend OAuth settings after closing the temporary popup", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/google_analytics";
    const popup = { location: { replace: jest.fn() }, close: jest.fn() };
    const openPopup = jest.spyOn(window, "open").mockReturnValue(popup);
    axios.post.mockRejectedValue({
      response: {
        data: {
          error: "Google Analytics OAuth is not configured on the server.",
          missingConfiguration: ["GOOGLE_ANALYTICS_CLIENT_ID", "GOOGLE_ANALYTICS_CLIENT_SECRET"],
        },
      },
    });

    render(<AppRoutes userRole="admin" activePage="home" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Google Analytics" }));
    const dialog = screen.getByRole("dialog", { name: "Choose a connection method" });
    const connectionOption = within(dialog).getByRole("button", { name: /Connect Google Analytics/ });
    await waitFor(() => expect(connectionOption).toBeEnabled());
    fireEvent.click(connectionOption);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(
      "Configure these backend settings first: GOOGLE_ANALYTICS_CLIENT_ID, GOOGLE_ANALYTICS_CLIENT_SECRET."
    ));
    expect(popup.close).toHaveBeenCalled();
    openPopup.mockRestore();
  });

  it("shows account and tag connection indicators in the page and connection dialog", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/google_analytics";
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/google-analytics/connection")) {
        return Promise.resolve({
          data: {
            configured: true,
            connected: true,
            accountEmail: "analytics@example.test",
            missingConfiguration: [],
            redirectUri: "http://localhost:5000/google-analytics/oauth/callback",
            tokenKeyConfigured: true,
            usingSearchConsoleOAuthCredentials: true,
          },
        });
      }
      if (url.includes("/admin/google-analytics/tag")) {
        return Promise.resolve({ data: { measurementId: "G-ABC1234567", tagManagerId: "GTM-T2NG27X8" } });
      }
      return Promise.resolve({ data: { available: true, path: mockLocation.pathname, disabledLinks: [] } });
    });

    render(<AppRoutes userRole="admin" activePage="home" />);
    const pageStatus = await screen.findByRole("group", { name: "Connection status" });
    await waitFor(() => {
      expect(pageStatus).toHaveTextContent(/Google account:\s*Connected/);
      expect(pageStatus).toHaveTextContent(/Website tag:\s*Connected/);
    });

    fireEvent.click(screen.getByRole("button", { name: "Connect Google Analytics" }));
    const dialog = screen.getByRole("dialog", { name: "Choose a connection method" });
    const dialogStatus = within(dialog).getByRole("group", { name: "Connection status" });
    expect(dialogStatus).toHaveTextContent(/Google account:\s*Connected/);
    expect(dialogStatus).toHaveTextContent(/Website tag:\s*Connected/);
    expect(within(dialog).getByText("Connected as analytics@example.test")).toBeInTheDocument();
    expect(within(dialog).getByText("Installed: GA4 and GTM")).toBeInTheDocument();
  });

  it("offers a separate disconnect action for a connected Google account without affecting the tag", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/google_analytics";
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/google-analytics/connection")) {
        return Promise.resolve({
          data: { configured: true, connected: true, accountEmail: "analytics@example.test" },
        });
      }
      if (url.includes("/admin/google-analytics/tag")) {
        return Promise.resolve({ data: { measurementId: "", tagManagerId: "GTM-T2NG27X8" } });
      }
      return Promise.resolve({ data: { available: true, path: mockLocation.pathname, disabledLinks: [] } });
    });
    axios.delete.mockResolvedValue({ data: { connected: false } });

    render(<AppRoutes userRole="admin" activePage="home" />);
    await screen.findByText("Google account: analytics@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Connect Google Analytics" }));
    const dialog = screen.getByRole("dialog", { name: "Choose a connection method" });
    const dialogStatus = within(dialog).getByRole("group", { name: "Connection status" });

    expect(within(dialog).queryByRole("button", { name: /Connect Google Analytics/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining("/admin/google-analytics/connection"),
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(dialogStatus).toHaveTextContent(/Google account:\s*Not connected/);
      expect(dialogStatus).toHaveTextContent(/Website tag:\s*Connected/);
    });
    expect(axios.post).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: /Connect Google Analytics/ })).toBeInTheDocument();
    expect(within(dialog).getByText("Google Analytics account disconnected.")).toBeInTheDocument();
  });

  it("loads GA4 properties and switches the analytics report navigation to realtime data", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/google_analytics";
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/google-analytics/connection")) {
        return Promise.resolve({ data: { configured: true, connected: true, accountEmail: "analytics@example.test" } });
      }
      if (url.includes("/admin/google-analytics/properties")) {
        return Promise.resolve({
          data: { properties: [{ id: "properties/123456", displayName: "Main website", accountName: "Example" }] },
        });
      }
      if (url.includes("/admin/google-analytics/tag")) {
        return Promise.resolve({ data: { measurementId: "G-ABC1234567", tagManagerId: "" } });
      }
      return Promise.resolve({ data: { available: true, path: mockLocation.pathname, disabledLinks: [] } });
    });
    axios.post.mockImplementation((_url, body) => Promise.resolve({
      data: body.reportId === "acquisition-overview" && body.dateRange === "last30min"
        ? {
          reportId: body.reportId,
          unavailableReason: "GA4 Realtime does not provide channel-group breakdowns. Use a longer range after historical data has been processed.",
        }
        : body.reportId === "acquisition-overview"
          ? {
            reportId: body.reportId,
            dimensionHeaders: [{ name: "sessionDefaultChannelGroup" }],
            metricHeaders: [{ name: "sessions" }],
            rows: [],
          }
        : body.reportId === "realtime"
          ? {
          reportId: "realtime",
          generatedAt: "2026-11-13T16:00:00.000Z",
          reports: {
            summary: {
              metricHeaders: [
                { name: "activeUsers" },
                { name: "screenPageViews" },
                { name: "eventCount" },
              ],
              rows: [{ metricValues: [{ value: "4" }, { value: "9" }, { value: "12" }] }],
            },
            countries: {
              dimensionHeaders: [{ name: "country" }],
              metricHeaders: [{ name: "activeUsers" }],
              rows: [{ dimensionValues: [{ value: "India" }], metricValues: [{ value: "4" }] }],
            },
            pages: { dimensionHeaders: [], metricHeaders: [], rows: [] },
            events: { dimensionHeaders: [], metricHeaders: [], rows: [] },
          },
          }
          : {
            reportId: "overview",
            dimensionHeaders: [{ name: "date" }],
            metricHeaders: [{ name: "activeUsers" }, { name: "sessions" }],
            totals: [{ metricValues: [{ value: "12" }, { value: "18" }] }],
            rows: [{
              dimensionValues: [{ value: "20261113" }],
              metricValues: [{ value: "12" }, { value: "18" }],
            }],
          },
    }));

    render(<AppRoutes userRole="admin" activePage="home" />);
    expect(await screen.findAllByRole("heading", { name: "Reports snapshot" })).toHaveLength(2);
    expect(await screen.findByText("12", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "GA4 property" })).toHaveValue("properties/123456");
    expect(screen.getByRole("button", { name: "Tech details" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Realtime" }));
    expect(await screen.findByRole("heading", { name: "Realtime" })).toBeInTheDocument();
    const dateRange = screen.getByRole("combobox", { name: "Date range" });
    expect(dateRange).toHaveValue("last30min");
    expect(await screen.findByText("Top countries")).toBeInTheDocument();
    expect(await screen.findByText("India")).toBeInTheDocument();
    expect(await screen.findByText(/Realtime does not provide traffic-source dimensions/i)).toBeInTheDocument();
    fireEvent.change(dateRange, { target: { value: "last1hour" } });
    expect(axios.post).toHaveBeenLastCalledWith(
      expect.stringContaining("/admin/google-analytics/reports"),
      expect.objectContaining({
        propertyId: "properties/123456",
        reportId: "realtime",
        dateRange: "last1hour",
      }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
    fireEvent.click(screen.getByRole("button", { name: "Acquisition overview" }));
    expect(await screen.findByText(/GA4 has no processed channel-group data for this range yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View live activity" }));
    expect(await screen.findByRole("heading", { name: "Realtime" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Date range" })).toHaveValue("last30min");
    fireEvent.click(screen.getByRole("button", { name: "Acquisition overview" }));
    fireEvent.change(dateRange, { target: { value: "last30min" } });
    expect(await screen.findByText(/Realtime does not provide channel-group breakdowns/i)).toBeInTheDocument();
  });

  it("reuses Search Console OAuth credentials and saves Analytics-specific settings manually", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/google_analytics";
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/google-analytics/connection")) {
        return Promise.resolve({
          data: {
            configured: false,
            connected: false,
            missingConfiguration: ["GOOGLE_ANALYTICS_REDIRECT_URI", "GOOGLE_ANALYTICS_TOKEN_KEY"],
            redirectUri: "http://localhost:5000/google-analytics/oauth/callback",
            tokenKeyConfigured: false,
            usingSearchConsoleOAuthCredentials: true,
          },
        });
      }
      return Promise.resolve({ data: { available: true, path: mockLocation.pathname, disabledLinks: [] } });
    });
    axios.put.mockResolvedValue({
      data: {
        configured: true,
        redirectUri: "http://localhost:5000/google-analytics/oauth/callback",
        tokenKeyConfigured: true,
        usingSearchConsoleOAuthCredentials: true,
        message: "Google Analytics settings saved.",
      },
    });

    render(<AppRoutes userRole="admin" activePage="home" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Google Analytics" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Choose a connection method" }))
      .getByRole("button", { name: /Configure OAuth Manually/ }));

    const configDialog = screen.getByRole("dialog", { name: "Configure Google authorization" });
    expect(await within(configDialog).findByText(/Search Console OAuth client ID and secret will be reused/)).toBeInTheDocument();
    expect(within(configDialog).getByLabelText("Analytics OAuth callback URL"))
      .toHaveValue("http://localhost:5000/google-analytics/oauth/callback");
    fireEvent.change(within(configDialog).getByLabelText("Analytics token key"), {
      target: { value: "0123456789abcdef".repeat(4) },
    });
    fireEvent.click(within(configDialog).getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining("/admin/google-analytics/config"),
      {
        redirectUri: "http://localhost:5000/google-analytics/oauth/callback",
        tokenKey: "0123456789abcdef".repeat(4),
      },
      expect.objectContaining({ headers: expect.any(Object) })
    ));
    expect(await screen.findByRole("status")).toHaveTextContent("Google Analytics settings saved.");
  });

  it("switches between GA4 and GTM code types and saves both IDs", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/google_analytics";
    axios.put.mockResolvedValue({
      data: { measurementId: "G-ABC1234567", tagManagerId: "GTM-T2NG27X8" },
    });

    render(<AppRoutes userRole="admin" activePage="home" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Google Analytics" }));

    const dialog = screen.getByRole("dialog", { name: "Choose a connection method" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Add Google Tag Manually/ }));

    const manualDialog = screen.getByRole("dialog", { name: "Add a Google tag manually" });
    const measurementInput = within(manualDialog).getByRole("textbox", { name: "GA4 Measurement ID" });
    await waitFor(() => expect(measurementInput).toBeEnabled());
    fireEvent.change(measurementInput, { target: { value: "g-abc1234567" } });

    fireEvent.click(within(manualDialog).getByRole("button", { name: "GTM" }));
    const tagManagerInput = within(manualDialog).getByRole("textbox", { name: "Google Tag Manager Container ID" });
    fireEvent.change(tagManagerInput, { target: { value: "gtm-t2ng27x8" } });
    expect(within(manualDialog).getByRole("button", { name: "GTM" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(manualDialog).getByRole("button", { name: "Done" }));

    await waitFor(() => expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining("/admin/google-analytics/tag"),
      { measurementId: "G-ABC1234567", tagManagerId: "GTM-T2NG27X8" },
      expect.objectContaining({ headers: expect.any(Object) })
    ));
    expect(await screen.findByRole("status")).toHaveTextContent("GA4 G-ABC1234567 and GTM GTM-T2NG27X8 are now installed site-wide");
  });

  it("extracts IDs from the shared Google tag script field before saving", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/google_analytics";
    axios.put.mockResolvedValue({
      data: { measurementId: "G-ABC1234567", tagManagerId: "GTM-T2NG27X8" },
    });

    render(<AppRoutes userRole="admin" activePage="home" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Google Analytics" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Choose a connection method" }))
      .getByRole("button", { name: /Add Google Tag Manually/ }));

    const manualDialog = screen.getByRole("dialog", { name: "Add a Google tag manually" });
    const scriptInput = within(manualDialog).getByRole("textbox", { name: "Google tag script snippet" });
    await waitFor(() => expect(scriptInput).toBeEnabled());
    fireEvent.change(scriptInput, {
      target: {
        value: [
          '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>',
          '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-T2NG27X8"></script>',
        ].join(""),
      },
    });
    fireEvent.click(within(manualDialog).getByRole("button", { name: "Done" }));

    await waitFor(() => expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining("/admin/google-analytics/tag"),
      { measurementId: "G-ABC1234567", tagManagerId: "GTM-T2NG27X8" },
      expect.objectContaining({ headers: expect.any(Object) })
    ));
  });

  it("clears both ID fields and the script snippet together", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/google_analytics";

    render(<AppRoutes userRole="admin" activePage="home" />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Google Analytics" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Choose a connection method" }))
      .getByRole("button", { name: /Add Google Tag Manually/ }));

    const manualDialog = screen.getByRole("dialog", { name: "Add a Google tag manually" });
    const measurementInput = within(manualDialog).getByRole("textbox", { name: "GA4 Measurement ID" });
    const scriptInput = within(manualDialog).getByRole("textbox", { name: "Google tag script snippet" });
    await waitFor(() => expect(measurementInput).toBeEnabled());

    fireEvent.change(measurementInput, { target: { value: "G-ABC1234567" } });
    fireEvent.click(within(manualDialog).getByRole("button", { name: "GTM" }));
    const tagManagerInput = within(manualDialog).getByRole("textbox", { name: "Google Tag Manager Container ID" });
    fireEvent.change(tagManagerInput, { target: { value: "GTM-T2NG27X8" } });
    fireEvent.change(scriptInput, { target: { value: "<script>sample</script>" } });
    fireEvent.click(within(manualDialog).getByRole("button", { name: "Clear all" }));

    expect(tagManagerInput).toHaveValue("");
    fireEvent.click(within(manualDialog).getByRole("button", { name: "GA4" }));
    expect(within(manualDialog).getByRole("textbox", { name: "GA4 Measurement ID" })).toHaveValue("");
    expect(scriptInput).toHaveValue("");
  });

  it("renders a blank protected page with the blog sidebar menu", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog";

    const { container } = render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.getByRole("complementary", { name: "Blog menu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dashboard" })).not.toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "Add New" })).not.toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "Drafts" })).not.toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "View" })).not.toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "Schedule" })).not.toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "Analytics" })).not.toHaveAttribute("href");
    expect(container.querySelector("main")).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "Analytics" }));
    expect(window.location.search).toBe("?tab=controls_blog&section=analytics");
  });

  it("renders the Blog Analytics panel from the Blog analytics section", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=analytics";
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ overview: { totalViews: 4, uniqueVisitors: 2 }, topBlogs: [], timeline: [] }) });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(await screen.findByText("Blog Analytics")).toBeInTheDocument();
    expect(screen.getByText("Total Blog Views")).toBeInTheDocument();
    global.fetch = originalFetch;
  });

  it("shows total, draft, and scheduled blog cards on the dashboard", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=dashboard";
    axios.get.mockImplementation((url) => {
      if (url.includes("status=published")) return Promise.resolve({ data: { drafts: [{ id: 1 }, { id: 2 }] } });
      if (url.includes("status=draft")) return Promise.resolve({ data: { drafts: [{ id: 3 }] } });
      return Promise.resolve({ data: { drafts: [{ id: 4 }, { id: 5 }] } });
    });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    await waitFor(() => expect(screen.getByLabelText("Total blogs count")).toHaveTextContent("5"));
    expect(screen.getByLabelText("Live count")).toHaveTextContent("2");
    expect(screen.getByLabelText("Drafts count")).toHaveTextContent("1");
    expect(screen.getByLabelText("Scheduled blogs count")).toHaveTextContent("2");
  });

  it("renders the complete new blog form for the add-new section", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.getByRole("heading", { name: "Add New Blog" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Content")).toBeInTheDocument();
    expect(screen.getByLabelText("Cover image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Schedule" })[1]);
    expect(screen.getByLabelText("Schedule publish date and time")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Schedule publish date and time"), { target: { value: "2099-09-19T20:00" } });
    expect(screen.getByRole("button", { name: "Schedule Publish" })).toBeInTheDocument();
  });

  it("shows rich text controls for the content editor", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Italic" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bullet list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quote" })).toBeInTheDocument();
  });

  it("shows direct text color shortcuts for black, blue, and red", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.getByRole("button", { name: "Text color black" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text color blue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text color red" })).toBeInTheDocument();
  });

  it("supports linking to an internal asset from the link dialog", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";
    axios.get.mockResolvedValue({ data: { images: [{ id: 42, title: "Forest sample", description: "Nature", category: "Photos" }] } });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use asset" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Use asset" }));
    fireEvent.change(screen.getByPlaceholderText("Search internal asset"), { target: { value: "Forest" } });

    await waitFor(() => expect(screen.getByRole("button", { name: /Forest sample/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Forest sample/ }));

    expect(screen.getByLabelText("Link URL")).toHaveValue("/asset/42");
  });

  it("shows link editing controls and rejects dangerous URLs", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(screen.getByLabelText("Selected text")).toBeInTheDocument();
    expect(screen.getByLabelText("Open in")).toBeInTheDocument();
    expect(screen.getByLabelText("Link relationship")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Selected text"), { target: { value: "Unsafe link" } });
    fireEvent.change(screen.getByLabelText("URL", { selector: "input" }), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Link" }));

    expect(screen.getByRole("alert")).toHaveTextContent("This URL is not allowed.");
  });

  it("loads and removes an existing link without removing its text", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);
    const editor = document.querySelector('[contenteditable="true"]');
    editor.innerHTML = '<p><a href="https://example.com" target="_blank" rel="nofollow">Example</a></p>';
    const link = editor.querySelector("a");
    const range = document.createRange();
    range.selectNodeContents(link.firstChild);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(screen.getByLabelText("Selected text")).toHaveValue("Example");
    expect(screen.getByLabelText("URL", { selector: "input" })).toHaveValue("https://example.com");
    expect(screen.getByLabelText("Open in")).toHaveValue("new-tab");
    expect(screen.getByLabelText("Link relationship")).toHaveValue("nofollow");

    fireEvent.click(screen.getByRole("button", { name: "Remove Link" }));
    expect(editor.textContent).toContain("Example");
    expect(editor.querySelector("a")).toBeNull();
  });

  it("automatically styles internal and external links differently", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);
    const editor = document.querySelector('[contenteditable="true"]');

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.change(screen.getByLabelText("Selected text"), { target: { value: "Stock assets" } });
    fireEvent.change(screen.getByLabelText("URL", { selector: "input" }), { target: { value: "/stock-assets" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Link" }));

    const link = editor.querySelector("a");
    expect(link).toHaveStyle({ color: "#2563eb", fontWeight: "700", textDecoration: "none" });

    const range = document.createRange();
    range.selectNodeContents(link.firstChild);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.change(screen.getByLabelText("URL", { selector: "input" }), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Link" }));

    expect(link).toHaveStyle({ color: "#dc2626", fontWeight: "700", textDecoration: "underline" });
  });

  it("falls back to an inline URL dialog when prompt() is unavailable", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    const originalPrompt = window.prompt;
    window.prompt = undefined;

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(() => fireEvent.click(screen.getByRole("button", { name: "Image" }))).not.toThrow();
    expect(screen.getByRole("dialog", { name: "Image URL dialog" })).toBeInTheDocument();

    window.prompt = originalPrompt;
  });

  it("uses a curated open-source Google font list in the editor", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);

    const fontSelect = screen.getByLabelText("Font family");
    const fontValues = Array.from(fontSelect.options).map((option) => option.value);

    expect(fontValues.length).toBeGreaterThan(10);
    expect(fontValues).toContain("Open Sans");
    expect(fontValues).not.toContain("Arial");
  });

  it("shows saved blog drafts in the drafts section", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=drafts";
    window.localStorage.setItem("gfx-blog-drafts", JSON.stringify([{ id: 1, title: "A saved post", excerpt: "Draft summary", savedAt: "2026-09-19T10:00:00.000Z", category: "News", tags: "update", addedBy: "ankit1" }]));

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.getByRole("heading", { name: "Drafts" })).toBeInTheDocument();
    expect(screen.getByText("A saved post")).toBeInTheDocument();
    expect(screen.getByText("Draft summary")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search blogs" }), { target: { value: "saved post" } });
    expect(screen.getByText("A saved post")).toBeInTheDocument();
    expect(screen.getByText("1 draft")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Added by/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Saved/ })).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("button", { name: /Blog post/ }));
    expect(screen.getByRole("columnheader", { name: /Blog post/ })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByText("ankit1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View Published post" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Published post" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Published post" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Add New Blog" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("A saved post");
    window.localStorage.removeItem("gfx-blog-drafts");
  });

  it("hides publish scheduling metadata from the blog editor", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new&draft=12";
    window.localStorage.setItem("gfx-blog-drafts", JSON.stringify([{ id: 12, title: "Scheduled article", status: "scheduled", publishAt: "2026-09-19T14:30:00.000Z" }]));

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.queryByLabelText("Publish date and time")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Canonical URL")).not.toBeInTheDocument();
    window.localStorage.removeItem("gfx-blog-drafts");
  });

  it("confirms before deleting a saved draft", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=drafts";
    window.localStorage.setItem("gfx-blog-drafts", JSON.stringify([{ id: 7, title: "Delete me", savedAt: "2026-09-19T10:00:00.000Z" }]));
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    render(<AppRoutes userRole="admin" activePage="admin" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirmSpy).toHaveBeenCalledWith("Delete this draft? This action cannot be undone.");
    expect(screen.getByText("Delete me")).toBeInTheDocument();
    confirmSpy.mockReturnValue(true);
    window.localStorage.removeItem("gfx-blog-drafts");
    confirmSpy.mockRestore();
  });

  it("keeps the drafts table visible when there are no drafts", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=drafts";
    window.localStorage.removeItem("gfx-blog-drafts");

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Added by/ })).toBeInTheDocument();
    expect(screen.getByText("No saved drafts yet.")).toBeInTheDocument();
  });

  it("shows published blogs in the view section", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=view";
    axios.get.mockResolvedValueOnce({ data: { drafts: [{ id: 9, title: "Published post", excerpt: "Live summary", category: "News", addedBy: "ankit1", status: "published", publishAt: "2026-09-19T10:00:00.000Z", content: "Live content" }] } });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(await screen.findByRole("heading", { name: "Published Blogs" })).toBeInTheDocument();
    expect(await screen.findByText("Published post")).toBeInTheDocument();
    expect(screen.getByText("ankit1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Published post" }));
    expect(mockNavigate).toHaveBeenCalledWith("/blog/news/published-post_9");
  });

  it("shows five latest published blogs per page", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=view";
    axios.get.mockResolvedValueOnce({ data: { drafts: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, title: `Post ${index + 1}`, excerpt: `Summary ${index + 1}`, publishAt: "2026-09-19T10:00:00.000Z" })) } });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(await screen.findByText("Post 1")).toBeInTheDocument();
    expect(screen.getByText("Post 5")).toBeInTheDocument();
    expect(screen.queryByText("Post 6")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByText("Post 6")).toBeInTheDocument();
    expect(screen.queryByText("Post 1")).not.toBeInTheDocument();
  });

  it("sorts published blogs by clickable table headers", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=view";
    axios.get.mockResolvedValueOnce({ data: { drafts: [
      { id: 1, title: "Alpha", category: "Zeta", addedBy: "zoe", publishAt: "2026-09-17T10:00:00.000Z" },
      { id: 2, title: "Charlie", category: "Alpha", addedBy: "amy", publishAt: "2026-09-19T10:00:00.000Z" },
      { id: 3, title: "Bravo", category: "Beta", addedBy: "max", publishAt: "2026-09-18T10:00:00.000Z" },
    ] } });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(await screen.findByText("Charlie")).toBeInTheDocument();
    const titleHeader = screen.getByRole("button", { name: /Blog post/ });
    fireEvent.click(titleHeader);
    const firstBlogTitle = screen.getAllByRole("row")[1].textContent;
    expect(firstBlogTitle).toContain("Alpha");
    fireEvent.click(titleHeader);
    expect(screen.getAllByRole("row")[1].textContent).toContain("Charlie");
  });

  it("filters published blogs live from the search field", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=view";
    axios.get.mockResolvedValueOnce({ data: { drafts: [
      { id: 1, title: "Forest guide", category: "Nature", publishAt: "2026-09-19T10:00:00.000Z" },
      { id: 2, title: "Design trends", category: "Inspiration", publishAt: "2026-09-18T10:00:00.000Z" },
    ] } });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(await screen.findByText("Forest guide")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search blogs"), { target: { value: "nature" } });
    expect(screen.getByText("Forest guide")).toBeInTheDocument();
    expect(screen.queryByText("Design trends")).not.toBeInTheDocument();
  });

  it("shows published blogs on the public blog page newest first", async () => {
    mockLocation.pathname = "/blog";
    mockLocation.search = "";
    axios.get.mockImplementation((url) => Promise.resolve({
      data: url.includes("/pages/availability")
        ? { available: true, path: "/blog", disabledLinks: [] }
        : { posts: [{ id: 1, title: "Latest post", excerpt: "Latest summary", publishAt: "2026-09-19T12:00:00.000Z" }] },
    }));

    render(<AppRoutes userRole="customer" activePage="home" />);

    expect(await screen.findByRole("heading", { name: "Latest from the blog" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Latest post" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search blogs")).toBeInTheDocument();
  });

  it("renders the public blog detail page from a category and title URL", async () => {
    mockLocation.pathname = "/blog/tips-tricks/demo-published-blog-01_7";
    mockLocation.search = "";
    axios.get.mockImplementation((url) => Promise.resolve({
      data: url.includes("/pages/availability")
        ? { available: true, path: mockLocation.pathname, disabledLinks: [] }
        : { post: { id: 7, title: "Demo Published Blog 01", category: "Tips & Tricks", excerpt: "A demo blog post", content: "Blog content", author: "ankit", publishAt: "2026-09-19T12:00:00.000Z" } },
    }));

    render(<AppRoutes userRole="customer" activePage="home" />);

    expect(await screen.findByRole("heading", { name: "Demo Published Blog 01" })).toBeInTheDocument();
    expect(screen.getByText("A demo blog post")).toBeInTheDocument();
    expect(screen.getByText("Tips & Tricks")).toBeInTheDocument();
  });

  it("uses the shared website pagination controls on the public blog page", async () => {
    mockLocation.pathname = "/blog";
    mockLocation.search = "";
    const posts = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      title: `Blog post ${index + 1}`,
      excerpt: `Summary ${index + 1}`,
      publishAt: "2026-09-19T12:00:00.000Z",
    }));
    axios.get.mockImplementation((url) => Promise.resolve({
      data: url.includes("/pages/availability")
        ? { available: true, path: "/blog", disabledLinks: [] }
        : { posts },
    }));

    render(<AppRoutes userRole="customer" activePage="home" />);

    expect(await screen.findByRole("button", { name: /First/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Last/i })).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("saves and publishes a new blog through the shared API", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";
    axios.post.mockResolvedValueOnce({ data: { draft: { id: 42 } } }).mockResolvedValueOnce({ data: { draft: { id: 42, status: "published" } } });

    render(<AppRoutes userRole="admin" activePage="admin" />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Shared post" } });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Shared content" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(axios.post).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/admin/blog/drafts/42/publish"),
      {},
      expect.anything()
    ));
  });

  it("saves edits to an already published blog without forcing publish", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new&draft=9";
    render(<AppRoutes userRole="admin" activePage="admin" />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated published post" } });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Updated content" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/blog/drafts"),
      expect.objectContaining({ title: "Updated published post" }),
      expect.anything()
    ));
  });

  it("opens a saved blog preview in a new page", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    axios.post.mockResolvedValueOnce({ data: { draft: { id: 12 } } });

    render(<AppRoutes userRole="admin" activePage="admin" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("section=blog_preview&draft=12"),
      "_blank",
      "noopener,noreferrer"
    ));
    openSpy.mockRestore();
  });

  it("uses the blog title with preview suffix for the preview page title", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=blog_preview&draft=12";
    axios.get.mockResolvedValueOnce({ data: { draft: { id: 12, title: "My blog" } } });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    await waitFor(() => expect(document.title).toBe("My blog_preview"));
    document.title = "GFXunlimit";
  });

  it("renders the page for the current pathname even when the cached active page is stale", async () => {
    mockLocation.pathname = "/explore";
    axios.get.mockResolvedValue({ data: { available: true, path: "/explore", disabledLinks: [] } });
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
    expect(await screen.findByText("Explore Page")).toBeInTheDocument();
  });

  it("renders order history for customer orders route", async () => {
    mockLocation.pathname = "/orders";
    axios.get.mockResolvedValue({ data: { available: true, path: "/orders", disabledLinks: [] } });
    render(<AppRoutes userRole="customer" activePage="home" homeSectionProps={{ homePageProps: {}, galleryProps: {}, containerProps: { loading: false, filteredImages: [], currentPage: 1, totalPages: 1, totalImages: 0, setCurrentPage: jest.fn(), selectedImage: null, setSelectedImage: jest.fn(), darkMode: false, relatedImages: [], fetchSingleImage: jest.fn(), goToPreviousImage: jest.fn(), goToNextImage: jest.fn(), likeImage: jest.fn(), addFavorite: jest.fn(), downloadImage: jest.fn(), shareImage: jest.fn() }, popupProps: { selectedContributor: null, setSelectedContributor: jest.fn(), contributorImages: [], contributorLikes: [], contributorViews: [], contributorDownloads: [], contributorBestImage: null } }} />);
    expect(await screen.findByText("Order History")).toBeInTheDocument();
  });

  it("renders the tax form review screen for the review tab", async () => {
    mockLocation.pathname = "/dashboard";
    mockLocation.search = "?tab=filltaxform_review";
    axios.get.mockResolvedValue({ data: { available: true, path: "/dashboard", disabledLinks: [] } });
    mockLocation.state = {
      formType: "W-8BEN",
      formData: { name: "Amit Patel", citizenship: "India", treatyCountry: "India" },
    };

    render(<AppRoutes userRole="contributor" activePage="tax" />);

    expect(await screen.findByText("Review tax form")).toBeInTheDocument();
    expect(screen.getByText("Amit Patel")).toBeInTheDocument();
  });

  it("submits the reviewed tax form before returning to Tax Center", async () => {
    mockLocation.pathname = "/dashboard";
    mockLocation.search = "?tab=filltaxform_review";
    mockLocation.state = {
      formType: "W-8BEN",
      formData: { name: "Amit Patel", citizenship: "India", treatyCountry: "India" },
    };
    axios.post.mockResolvedValue({ data: { submitted: true } });
    axios.get.mockResolvedValue({ data: { available: true, path: "/dashboard", disabledLinks: [] } });
    mockNavigate.mockClear();

    render(<AppRoutes userRole="contributor" activePage="tax" />);

    await screen.findByRole("button", { name: /^submit$/i });
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/profile/tax-form"),
        expect.objectContaining({ formType: "W-8BEN", name: "Amit Patel" }),
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(mockNavigate).toHaveBeenCalledWith("/dashboard?tab=taxcenter");
    });
  });

  it("blocks visitors from a page disabled by an administrator", async () => {
    mockLocation.pathname = "/pricing";
    mockLocation.search = "";
    axios.get.mockResolvedValue({ data: { available: false, path: "/pricing", disabledLinks: [] } });

    render(<AppRoutes userRole="customer" activePage="home" />);

    expect(await screen.findByRole("heading", { name: "This page is temporarily unavailable" })).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/pages/availability"),
      { params: { path: "/pricing" } }
    );
    mockLocation.search = "";
  });

  it("does not show the availability-check message while the backend check is pending", async () => {
    mockLocation.pathname = "/pricing";
    mockLocation.search = "";
    let resolveAvailability;
    axios.get.mockReturnValue(new Promise((resolve) => {
      resolveAvailability = resolve;
    }));

    const { container } = render(<AppRoutes userRole="customer" activePage="home" />);

    expect(screen.queryByText(/checking page availability/i)).not.toBeInTheDocument();
    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");

    resolveAvailability({ data: { available: true, path: "/pricing", disabledLinks: [] } });
    await waitFor(() => expect(container.querySelector("main")).not.toHaveAttribute("aria-busy", "true"));
  });

  it("reports repeated availability failures and retries only the availability request", async () => {
    mockLocation.pathname = "/blog";
    mockLocation.search = "";
    const reportAvailability = jest.fn();
    useStartupReadiness.mockReturnValue({
      routeId: "blog-route",
      reportResource: jest.fn(),
      reportAvailability,
      availabilityRetryKey: 0,
    });
    let availabilityAttempts = 0;
    axios.get.mockImplementation((url) => {
      if (url.includes("/pages/availability")) {
        availabilityAttempts += 1;
        if (availabilityAttempts < 3) {
          return Promise.reject(new Error("Availability unavailable"));
        }
        return Promise.resolve({
          data: { available: true, path: "/blog", disabledLinks: [] },
        });
      }
      if (url.endsWith("/blog/posts")) return Promise.resolve({ data: { posts: [] } });
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const view = render(<AppRoutes userRole="customer" activePage="home" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to verify this page's availability. Please try again."
    );
    expect(reportAvailability).toHaveBeenLastCalledWith(
      "error",
      "Unable to verify this page's availability. Please try again.",
      "blog-route"
    );
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith("/blog/posts"))).toHaveLength(0);

    useStartupReadiness.mockReturnValue({
      routeId: "blog-route",
      reportResource: jest.fn(),
      reportAvailability,
      availabilityRetryKey: 1,
    });
    view.rerender(<AppRoutes userRole="customer" activePage="home" />);
    await waitFor(() => expect(availabilityAttempts).toBe(2));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to verify this page's availability. Please try again."
    );
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith("/blog/posts"))).toHaveLength(0);

    useStartupReadiness.mockReturnValue({
      routeId: "blog-route",
      reportResource: jest.fn(),
      reportAvailability,
      availabilityRetryKey: 2,
    });
    view.rerender(<AppRoutes userRole="customer" activePage="home" />);
    expect(await screen.findByRole("heading", { name: "Latest from the blog" })).toBeInTheDocument();
    await waitFor(() => expect(availabilityAttempts).toBe(3));
    expect(axios.get.mock.calls.filter(([url]) => url.includes("/pages/availability"))).toHaveLength(3);
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith("/blog/posts"))).toHaveLength(1);
    expect(reportAvailability).toHaveBeenLastCalledWith("ready", "", "blog-route");
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("disables only the selected link on its source page", async () => {
    mockLocation.pathname = "/pricing";
    mockLocation.search = "";
    axios.get.mockResolvedValue({
      data: {
        available: true,
        path: "/pricing",
        disabledLinks: [{ href: "http://localhost:3000/privacy", linkText: "Privacy Policy" }],
      },
    });

    render(<AppRoutes userRole="customer" activePage="home" />);

    const privacyLink = await screen.findByRole("link", { name: "Privacy Policy" });
    const termsLink = screen.getByRole("link", { name: "Terms" });
    expect(privacyLink).toHaveAttribute("aria-disabled", "true");
    expect(termsLink).not.toHaveAttribute("aria-disabled");
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    privacyLink.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/pages/availability"),
      { params: { path: "/pricing" } }
    );
  });
});
