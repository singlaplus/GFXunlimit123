import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  calculateReadinessProgress,
  StartupReadinessProvider,
  useStartupReadiness,
} from "./StartupReadinessProvider";

jest.mock("react-router-dom", () => {
  const React = require("react");
  const RouterContext = React.createContext(null);
  const toLocation = (path, key) => {
    const url = new URL(path, "http://localhost");
    return { pathname: url.pathname, search: url.search, key };
  };
  const MemoryRouter = ({ initialEntries, children }) => {
    const [location, setLocation] = React.useState(() => toLocation(initialEntries[0], "initial"));
    const navigate = React.useCallback((path) => {
      setLocation((current) => toLocation(path, `${current.key}-next`));
    }, []);
    return (
      <RouterContext.Provider value={{ location, navigate }}>
        {children}
      </RouterContext.Provider>
    );
  };
  return {
    MemoryRouter,
    useLocation: () => React.useContext(RouterContext).location,
    useNavigate: () => React.useContext(RouterContext).navigate,
  };
});

jest.mock("axios");

const HEALTH_RESPONSE = {
  status: 200,
  data: [{ now: "2026-11-01T12:00:00.000Z" }],
};

function ReadinessProbe({ autoAvailabilityReady = true }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const {
    auth,
    reportResource,
    reportAvailability,
    retryAvailability,
    retryKey,
    availabilityRetryKey,
    routeId,
  } = useStartupReadiness();

  useEffect(() => {
    if (autoAvailabilityReady) reportAvailability("ready", "", routeId);
  }, [autoAvailabilityReady, reportAvailability, routeId]);

  return (
    <main>
      <span data-testid="ready-app">{pathname}:{auth.status}</span>
      <button type="button" onClick={() => reportResource("catalog", "ready", "", routeId)}>Catalog ready</button>
      <button type="button" onClick={() => reportResource("hero", "ready", "", routeId)}>Hero ready</button>
      <button type="button" onClick={() => reportResource("dashboard", "ready", "", routeId)}>Dashboard ready</button>
      <button type="button" onClick={() => reportResource("adminDashboard", "ready", "", routeId)}>Admin dashboard ready</button>
      <button type="button" onClick={() => reportResource("adminDashboardUsers", "ready", "", routeId)}>Admin dashboard users ready</button>
      <button type="button" onClick={() => reportResource("adminDashboardCollections", "ready", "", routeId)}>Admin dashboard collections ready</button>
      <button type="button" onClick={() => reportResource("contributorDashboard", "ready", "", routeId)}>Contributor dashboard ready</button>
      <button type="button" onClick={() => reportResource("adminUsers", "ready", "", routeId)}>Admin users ready</button>
      <button type="button" onClick={() => reportResource("adminMyAccount", "ready", "", routeId)}>Admin account ready</button>
      <button type="button" onClick={() => reportResource("adminContributors", "ready", "", routeId)}>Admin contributors ready</button>
      <button type="button" onClick={() => reportResource("adminCommerce", "ready", "", routeId)}>Admin commerce ready</button>
      <button type="button" onClick={() => reportResource("adminOrders", "ready", "", routeId)}>Admin orders ready</button>
      <button type="button" onClick={() => reportResource("adminAnalytics", "ready", "", routeId)}>Admin analytics ready</button>
      <button type="button" onClick={() => reportResource("earnings", "ready", "", routeId)}>Earnings ready</button>
      <button type="button" onClick={() => reportResource("customerDashboard", "ready", "", routeId)}>Customer dashboard ready</button>
      <button type="button" onClick={() => reportResource("accountSettings", "ready", "", routeId)}>Account settings ready</button>
      <button type="button" onClick={() => reportResource("profile", "ready", "", routeId)}>Profile ready</button>
      <button type="button" onClick={() => reportResource("messages", "ready", "", routeId)}>Messages ready</button>
      <button type="button" onClick={() => reportResource("cartCheckout", "ready", "", routeId)}>Cart ready</button>
      <button type="button" onClick={() => reportResource("subscriptionCheckout", "ready", "", routeId)}>Subscription checkout ready</button>
      <button type="button" onClick={() => reportResource("orders", "ready", "", routeId)}>Orders ready</button>
      <button type="button" onClick={() => reportResource("payments", "ready", "", routeId)}>Payments ready</button>
      <button type="button" onClick={() => reportResource("adminRoute", "ready", "", routeId)}>Admin route ready</button>
      <button type="button" onClick={() => reportResource("favorites", "ready", "", routeId)}>Favorites ready</button>
      <button type="button" onClick={() => reportResource("downloads", "ready", "", routeId)}>Downloads ready</button>
      <button type="button" onClick={() => reportResource("myUploads", "ready", "", routeId)}>My uploads ready</button>
      <button type="button" onClick={() => reportResource("accountSettings", "error", "Account settings failed.", routeId)}>Account settings failed</button>
      <button type="button" onClick={() => reportResource("catalog", "error", "Catalog unavailable.", routeId)}>Catalog failed</button>
      <button type="button" onClick={() => reportResource("analytics", "error", "Optional analytics failed.", routeId)}>Analytics failed</button>
      <button type="button" onClick={() => reportAvailability("error", "Availability unavailable.", routeId)}>Availability failed</button>
      <button type="button" onClick={() => reportAvailability("ready", "", routeId)}>Report availability ready</button>
      <button type="button" onClick={retryAvailability}>Retry availability</button>
      <button type="button" onClick={() => navigate("/explore")}>Go to Explore</button>
      <span data-testid="retry-key">{retryKey}</span>
      <span data-testid="availability-retry-key">{availabilityRetryKey}</span>
    </main>
  );
}

function renderReadiness(path = "/about", probeProps = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StartupReadinessProvider>
        <ReadinessProbe {...probeProps} />
      </StartupReadinessProvider>
    </MemoryRouter>
  );
}

function clickButton(container, label) {
  const button = Array.from(container.querySelectorAll("button"))
    .find((element) => element.textContent === label);
  fireEvent.click(button);
}

describe("StartupReadinessProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) return Promise.reject({ response: { status: 401 } });
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
  });

  it("verifies PostgreSQL health and permits anonymous public routes", async () => {
    renderReadiness();

    expect(await screen.findByTestId("ready-app")).toHaveTextContent("/about:anonymous");
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/health"),
      expect.objectContaining({ timeout: 15000 })
    );
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/me"),
      expect.objectContaining({ withCredentials: true })
    );
    expect(localStorage.getItem("userRole")).toBeNull();
  });

  it("uses the configured website logo on the loading screen without delaying startup", async () => {
    let resolveHealth;
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) {
        return new Promise((resolve) => {
          resolveHealth = resolve;
        });
      }
      if (url.endsWith("/branding")) {
        return Promise.resolve({ data: { logo: "/uploads/site-logo.png" } });
      }
      if (url.endsWith("/me")) return Promise.reject({ response: { status: 401 } });
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderReadiness();

    await waitFor(() => {
      expect(screen.getByAltText("GFXunlimit logo")).toHaveAttribute(
        "src",
        expect.stringContaining("/uploads/site-logo.png")
      );
    });
    const logo = screen.getByAltText("GFXunlimit logo");
    fireEvent.load(logo);
    expect(logo).toHaveStyle({ visibility: "visible" });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.queryByText("Checking backend and PostgreSQL...")).not.toBeInTheDocument();
    expect(screen.queryByText("G", { selector: ".startup-readiness-mark" })).not.toBeInTheDocument();

    await act(async () => {
      resolveHealth(HEALTH_RESPONSE);
    });
    expect(await screen.findByTestId("ready-app")).toHaveTextContent("/about:anonymous");
  });

  it("shows the existing configured logo path immediately before branding resolves", async () => {
    let resolveHealth;
    let resolveBranding;
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) {
        return new Promise((resolve) => { resolveHealth = resolve; });
      }
      if (url.endsWith("/branding")) {
        return new Promise((resolve) => { resolveBranding = resolve; });
      }
      if (url.endsWith("/me")) return Promise.reject({ response: { status: 401 } });
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderReadiness();

    expect(screen.getByAltText("GFXunlimit logo")).toHaveAttribute(
      "src",
      expect.stringContaining("/api/files/branding/logo.png")
    );
    const initialLogo = screen.getByAltText("GFXunlimit logo");
    fireEvent.error(initialLogo);
    expect(initialLogo).toHaveStyle({ visibility: "hidden" });
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.queryByText("Checking backend and PostgreSQL...")).not.toBeInTheDocument();

    await act(async () => {
      resolveBranding({ data: { logo: "/uploads/site-logo.png" } });
    });
    const configuredLogo = screen.getByAltText("GFXunlimit logo");
    expect(configuredLogo).toHaveAttribute(
      "src",
      expect.stringContaining("/uploads/site-logo.png")
    );
    fireEvent.load(configuredLogo);
    expect(configuredLogo).toHaveStyle({ visibility: "visible" });
    await act(async () => {
      resolveHealth(HEALTH_RESPONSE);
    });
  });

  it("calculates progress only from completed readiness milestones", () => {
    const common = {
      availabilityRequired: true,
      requiredResources: ["catalog", "hero"],
      resourceStates: {
        catalog: { status: "error" },
        hero: { status: "error" },
      },
    };

    expect(calculateReadinessProgress({
      ...common,
      healthReady: false,
      sessionReady: false,
      availabilityReady: false,
      pageReady: false,
    })).toBe(0);
    expect(calculateReadinessProgress({
      ...common,
      healthReady: true,
      sessionReady: false,
      availabilityReady: false,
      pageReady: false,
    })).toBe(20);
    expect(calculateReadinessProgress({
      ...common,
      healthReady: true,
      sessionReady: true,
      availabilityReady: true,
      resourceStates: {
        catalog: { status: "ready" },
        hero: { status: "error" },
      },
      pageReady: false,
    })).toBe(80);
    expect(calculateReadinessProgress({
      ...common,
      healthReady: true,
      sessionReady: true,
      availabilityReady: true,
      resourceStates: {
        catalog: { status: "ready" },
        hero: { status: "error" },
      },
      pageReady: true,
    })).toBe(80);
    expect(calculateReadinessProgress({
      ...common,
      resourceStates: {
        catalog: { status: "ready" },
        hero: { status: "ready" },
      },
      healthReady: true,
      sessionReady: true,
      availabilityReady: true,
      pageReady: false,
    })).toBe(99);
    expect(calculateReadinessProgress({
      ...common,
      resourceStates: {
        catalog: { status: "ready" },
        hero: { status: "ready" },
      },
      healthReady: true,
      sessionReady: true,
      availabilityReady: true,
      pageReady: true,
    })).toBe(100);
  });

  it("advances the homepage loading bar through readiness milestones without reaching 100 early", async () => {
    const { container } = renderReadiness("/", { autoAvailabilityReady: false });
    await screen.findByTestId("ready-app");

    const getProgress = () => Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
    expect(getProgress()).toBe(40);

    clickButton(container, "Report availability ready");
    await waitFor(() => expect(getProgress()).toBe(60));
    clickButton(container, "Catalog ready");
    await waitFor(() => expect(getProgress()).toBe(80));
    expect(getProgress()).toBeLessThan(100);
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, "Hero ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the route loading cover without the route loading text", async () => {
    renderReadiness("/account-settings");

    await screen.findByTestId("ready-app");
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Loading the information for this page...")).not.toBeInTheDocument();
  });

  it("shows a clear failure for PostgreSQL unavailable and retries successfully", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) {
        return Promise.reject({ response: { status: 500, data: { error: "Database connection error" } } });
      }
      return Promise.reject({ response: { status: 401 } });
    });

    renderReadiness();
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 500");

    let resolveRetryHealth;
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) {
        return new Promise((resolve) => { resolveRetryHealth = resolve; });
      }
      if (url.endsWith("/me")) return Promise.reject({ response: { status: 401 } });
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    await act(async () => {
      resolveRetryHealth(HEALTH_RESPONSE);
    });
    expect(await screen.findByTestId("ready-app")).toHaveTextContent("/about:anonymous");
  });

  it("keeps network failures as errors instead of successful responses", async () => {
    axios.get.mockRejectedValueOnce(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }));

    renderReadiness();
    expect(await screen.findByRole("alert")).toHaveTextContent("Network Error");
  });

  it.each([401, 403])("continues anonymously after /me returns %s", async (status) => {
    localStorage.setItem("token", "stale-token");
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) return Promise.reject({ response: { status } });
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderReadiness();
    expect(await screen.findByTestId("ready-app")).toHaveTextContent("/about:anonymous");
    expect(localStorage.getItem("token")).toBeNull();
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith("/me"))).toHaveLength(1);
  });

  it("clears only the deleted-user session and continues anonymously", async () => {
    localStorage.setItem("token", "deleted-user-token");
    localStorage.setItem("username", "stale-user");
    localStorage.setItem("userRole", "admin");
    localStorage.setItem("userPermissions", JSON.stringify({ manage_users: true }));
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) {
        return Promise.reject({
          response: { status: 404, data: { error: "User not found" } },
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderReadiness();
    expect(await screen.findByTestId("ready-app")).toHaveTextContent("/about:anonymous");
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("username")).toBeNull();
    expect(localStorage.getItem("userRole")).toBeNull();
    expect(localStorage.getItem("userPermissions")).toBeNull();
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith("/me"))).toHaveLength(1);
  });

  it("does not treat unrelated /me 404 responses as anonymous sessions", async () => {
    localStorage.setItem("token", "token-with-unexpected-404");
    localStorage.setItem("userRole", "contributor");
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) {
        return Promise.reject({
          response: { status: 404, data: { error: "Profile endpoint missing" } },
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderReadiness();
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 404");
    expect(localStorage.getItem("token")).toBe("token-with-unexpected-404");
    expect(localStorage.getItem("userRole")).toBe("contributor");
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith("/me"))).toHaveLength(1);
  });

  it("rejects malformed health responses", async () => {
    axios.get.mockResolvedValueOnce({ status: 200, data: [] });

    renderReadiness();
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid response");
  });

  it("waits for home essentials but does not wait for optional analytics", async () => {
    const { container } = renderReadiness("/");
    await screen.findByTestId("ready-app");

    clickButton(container, "Catalog ready");
    clickButton(container, "Analytics failed");
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, "Hero ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it.each([
    ["/account-settings", "Account settings ready"],
    ["/favorites", "Favorites ready"],
    ["/downloads", "Downloads ready"],
    ["/myuploads", "My uploads ready"],
  ])("gates %s on its page-owned essential request", async (path, readyButton) => {
    const { container } = renderReadiness(path);
    await screen.findByTestId("ready-app");

    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");
    clickButton(container, readyButton);
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it("gates the admin asset route after restoring the administrator role", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) {
        return Promise.resolve({ status: 200, data: { id: 10, username: "admin", role: "admin" } });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const { container } = renderReadiness("/admin");
    await waitFor(() => expect(localStorage.getItem("userRole")).toBe("admin"));
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, "Admin route ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it("gates the selected admin users tab after restoring the administrator role", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) {
        return Promise.resolve({ status: 200, data: { id: 10, username: "admin", role: "admin" } });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const { container } = renderReadiness("/admin?tab=users");
    await waitFor(() => expect(localStorage.getItem("userRole")).toBe("admin"));
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, "Admin users ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it("gates the selected admin account tab after restoring the administrator role", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) {
        return Promise.resolve({ status: 200, data: { id: 10, username: "admin", role: "admin" } });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const { container } = renderReadiness("/admin?tab=myaccount");
    await waitFor(() => expect(localStorage.getItem("userRole")).toBe("admin"));
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, "Admin account ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it("replaces a prior resource success with a later failure", async () => {
    const { container } = renderReadiness("/account-settings");
    await screen.findByTestId("ready-app");
    clickButton(container, "Account settings ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });

    clickButton(container, "Account settings failed");
    expect(await screen.findByRole("alert")).toHaveTextContent("Account settings failed.");
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");
  });

  it("waits for catalog data on Explore and safely gates a route change", async () => {
    const { container } = renderReadiness("/");
    await screen.findByTestId("ready-app");

    clickButton(container, "Go to Explore");
    await screen.findByText("/explore:anonymous");
    clickButton(container, "Catalog ready");
    await waitFor(() => expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false"));
  });

  it("restores authenticated state before revealing a protected dashboard", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) {
        return Promise.resolve({
          status: 200,
          data: {
            id: 8,
            username: "contributor",
            role: "contributor",
            customPermissions: { bulk_upload: true },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const { container } = renderReadiness("/contributor");
    await waitFor(() => expect(localStorage.getItem("userRole")).toBe("contributor"));
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, "Dashboard ready");
    clickButton(container, "Earnings ready");
    clickButton(container, "Contributor dashboard ready");
    await waitFor(() => expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false"));
    expect(JSON.parse(localStorage.getItem("userPermissions"))).toEqual({ bulk_upload: true });
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith("/me"))).toHaveLength(1);
  });

  it("waits for customer dashboard data after restoring the customer session", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) {
        return Promise.resolve({ status: 200, data: { id: 9, username: "buyer", role: "customer" } });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const { container } = renderReadiness("/customer");
    await waitFor(() => expect(localStorage.getItem("userRole")).toBe("customer"));
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, "Customer dashboard ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it("waits for administrator dashboard data after restoring the admin session", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) {
        return Promise.resolve({ status: 200, data: { id: 10, username: "admin", role: "admin" } });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const { container } = renderReadiness("/dashboard");
    await waitFor(() => expect(localStorage.getItem("userRole")).toBe("admin"));
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, "Admin dashboard ready");
    clickButton(container, "Admin dashboard users ready");
    clickButton(container, "Admin dashboard collections ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it("waits for the selected administrator contributors tab", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) {
        return Promise.resolve({ status: 200, data: { id: 10, username: "admin", role: "admin" } });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const adminBasePath = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    const { container } = renderReadiness(`${adminBasePath}?tab=viewcontributor`);
    await waitFor(() => expect(localStorage.getItem("userRole")).toBe("admin"));
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, "Admin contributors ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it("waits for administrator commerce data", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) {
        return Promise.resolve({ status: 200, data: { id: 10, username: "admin", role: "admin" } });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const { container } = renderReadiness("/admin/commerce");
    await waitFor(() => expect(localStorage.getItem("userRole")).toBe("admin"));
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, "Admin commerce ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it("waits for administrator orders data", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) {
        return Promise.resolve({ status: 200, data: { id: 10, username: "admin", role: "admin" } });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const { container } = renderReadiness("/admin/orders");
    await waitFor(() => expect(localStorage.getItem("userRole")).toBe("admin"));
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, "Admin orders ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it("waits for administrator analytics data", async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) return Promise.resolve(HEALTH_RESPONSE);
      if (url.endsWith("/me")) {
        return Promise.resolve({ status: 200, data: { id: 10, username: "admin", role: "admin" } });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const { container } = renderReadiness("/admin/analytics");
    await waitFor(() => expect(localStorage.getItem("userRole")).toBe("admin"));
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, "Admin analytics ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it("waits for profile data before revealing the profile route", async () => {
    const { container } = renderReadiness("/profile");
    await screen.findByTestId("ready-app");

    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");
    clickButton(container, "Profile ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it.each([
    ["/messages", "Messages ready"],
    ["/cart", "Cart ready"],
    ["/checkout", "Cart ready"],
    ["/checkout/subscription?plan=1", "Subscription checkout ready"],
    ["/orders", "Orders ready"],
    ["/orders/42", "Orders ready"],
    ["/payments", "Payments ready"],
  ])("gates %s on its essential page resource", async (path, readyButton) => {
    const { container } = renderReadiness(path);
    await screen.findByTestId("ready-app");
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");

    clickButton(container, readyButton);
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });

  it("offers a working retry after an essential route resource fails", async () => {
    const { container } = renderReadiness("/explore");
    await screen.findByTestId("ready-app");

    clickButton(container, "Catalog ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
    clickButton(container, "Catalog failed");
    expect(await screen.findByRole("alert")).toHaveTextContent("Catalog unavailable.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("retry-key")).toHaveTextContent("1"));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
    clickButton(container, "Catalog ready");
    await waitFor(() => expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false"));
  });

  it("retries availability independently and keeps the route covered across repeated failures", async () => {
    const { container } = renderReadiness("/", { autoAvailabilityReady: false });
    await screen.findByTestId("ready-app");

    clickButton(container, "Availability failed");
    expect(await screen.findByRole("alert")).toHaveTextContent("Availability unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByTestId("availability-retry-key")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("retry-key")).toHaveTextContent("0");

    clickButton(container, "Availability failed");
    expect(await screen.findByRole("alert")).toHaveTextContent("Availability unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByTestId("availability-retry-key")).toHaveTextContent("2");
    });

    clickButton(container, "Catalog ready");
    clickButton(container, "Hero ready");
    expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "true");
    clickButton(container, "Report availability ready");
    await waitFor(() => {
      expect(container.querySelector(".startup-readiness-content")).toHaveAttribute("aria-hidden", "false");
    });
  });
});
