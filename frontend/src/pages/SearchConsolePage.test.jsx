import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import SearchConsolePage from "./SearchConsolePage";

jest.mock("axios", () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
}));

const emptyOverviewResponse = {
  data: {
    siteUrl: "https://gfxunlimit.com/",
    startDate: "2026-10-10",
    endDate: "2026-11-06",
    totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    trend: [],
    topQueries: [],
    topPages: [],
    sitemaps: [],
  },
};

describe("SearchConsolePage", () => {
  beforeEach(() => {
    axios.get.mockResolvedValue({
      data: {
        configured: false,
        connected: false,
        missingConfiguration: ["GOOGLE_SEARCH_CONSOLE_CLIENT_ID"],
        values: {
          clientId: "prefilled-client-id",
          redirectUri: "https://example.com/search-console/oauth/callback",
          clientSecretConfigured: true,
          tokenKeyConfigured: true,
        },
      },
    });
    axios.post.mockReset();
    axios.put.mockReset();
    axios.delete.mockReset();
  });

  it("opens a dialog with Search Console setup options", async () => {
    render(<SearchConsolePage />);

    expect(screen.queryByText("Track clicks, impressions, CTR, rankings, queries, and top pages.")).not.toBeInTheDocument();
    expect(screen.queryByText("Verify domain ownership with DNS, HTML, Analytics, or Tag Manager.")).not.toBeInTheDocument();
    expect(screen.queryByText("Submit sitemaps and review their processing and indexing status.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Google OAuth Configuration" }));

    expect(screen.getByRole("dialog", { name: "Connect your website" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Google OAuth Configuration" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Google OAuth settings" })).toBeInTheDocument();
    expect(screen.getByText(/Google OAuth is not configured/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Google OAuth quick setup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Steps" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Google Cloud Console" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Steps" }));
    expect(screen.getByRole("button", { name: "Hide steps" })).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelectorAll(".search-console-quick-steps > li")).toHaveLength(5);
    expect(screen.getByText("OAuth 2.0 Client ID")).toBeInTheDocument();
    expect(screen.getAllByText("http://localhost:5000/search-console/oauth/callback")).toHaveLength(2);
    expect(screen.getAllByText("https://gfxunlimit.com/search-console/oauth/callback")).toHaveLength(2);
    expect(
      Array.from(document.querySelectorAll(".search-console-quick-steps li"))
        .some((item) => item.textContent.includes("not Authorized JavaScript origins"))
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Hide steps" }));
    expect(screen.queryByRole("link", { name: "Google Cloud Console" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Steps" }));
    const jsonUpload = screen.getByLabelText(/Import OAuth client JSON/);
    const redirectUri = screen.getByLabelText("Redirect URI");
    expect(jsonUpload.compareDocumentPosition(redirectUri) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(redirectUri.closest("label")).toHaveClass("search-console-redirect-field");
    expect(screen.getByText("http://localhost:3000")).toBeInTheDocument();
    expect(screen.getByText("https://gfxunlimit.com")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("Google client ID")).toHaveValue("prefilled-client-id");
    });
    expect(screen.getByLabelText("Google client secret")).toHaveValue("");
    expect(screen.getByLabelText("Google client secret")).toHaveAttribute("placeholder", "Saved securely — leave blank to keep current");
    expect(screen.getByLabelText("Token key")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Google account" }));
    expect(screen.getByRole("button", { name: "Connect with Google" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ownership verification" }));
    expect(screen.getByRole("heading", { name: "Verify website ownership" })).toBeInTheDocument();
    expect(screen.getByText("DNS TXT record")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Search performance" }));
    expect(screen.getByRole("button", { name: "Load performance" })).toBeInTheDocument();

    const setupDialog = screen.getByRole("dialog", { name: "Connect your website" });
    fireEvent.click(within(setupDialog).getByRole("button", { name: "Sitemaps" }));
    expect(within(setupDialog).getByLabelText("Sitemap URL")).toHaveValue("https://gfxunlimit.com/sitemap.xml");
    expect(within(setupDialog).getByLabelText("Sitemap URL")).toBeDisabled();
    expect(within(setupDialog).getByRole("button", { name: "Submit sitemap" })).toBeDisabled();
  });

  it("shows and loads the overview directly on the page", async () => {
    axios.get
      .mockResolvedValueOnce({
        data: {
          configured: true,
          connected: true,
          selectedProperty: "sc-domain:gfxunlimit.com",
          values: {},
        },
      })
      .mockResolvedValueOnce({
        data: { properties: [{ siteUrl: "sc-domain:gfxunlimit.com", permissionLevel: "siteOwner" }] },
      });
    axios.post.mockResolvedValue({
      data: {
        siteUrl: "sc-domain:gfxunlimit.com",
        startDate: "2026-10-10",
        endDate: "2026-11-06",
        totals: { clicks: 120, impressions: 4200, ctr: 0.0286, position: 5.4 },
        trend: [{ keys: ["2026-11-01"], clicks: 12, impressions: 300 }],
        topQueries: [{ keys: ["gfx graphics"], clicks: 24 }],
        topPages: [{ keys: ["https://gfxunlimit.com/photos"], clicks: 60 }],
        sitemaps: [{ path: "https://gfxunlimit.com/sitemap.xml", errors: 0, warnings: 0, isPending: false }],
      },
    });
    render(<SearchConsolePage />);

    const overviewMenuButton = await screen.findByRole("button", { name: "Overview" });
    expect(overviewMenuButton).toHaveAttribute("aria-current", "page");
    fireEvent.click(overviewMenuButton);
    expect(await screen.findByRole("heading", { name: "Search performance overview" })).toBeInTheDocument();
    expect(screen.getByText(/not real-time/i)).toBeInTheDocument();

    expect(await screen.findByText("4,200")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Performance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Indexing" })).toBeInTheDocument();
    expect(screen.getByText(/Page-level indexing coverage is not available through the Search Console API/)).toBeInTheDocument();
    expect(screen.getByText("Processed")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Daily clicks and impressions performance chart" })).toBeInTheDocument();
    expect(screen.getByText("Clicks", { selector: ".search-console-chart-legend span" })).toBeInTheDocument();
    expect(screen.getByText("Impressions", { selector: ".search-console-chart-legend span" })).toBeInTheDocument();
    expect(screen.getByText("gfx graphics")).toBeInTheDocument();
    expect(screen.getByText("https://gfxunlimit.com/photos")).toBeInTheDocument();
    expect(screen.getByText("https://gfxunlimit.com/sitemap.xml")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Insights" }));
    expect(await screen.findByRole("heading", { name: "Search insights" })).toBeInTheDocument();
    expect(screen.getByText("Top search query")).toBeInTheDocument();
    expect(screen.getByText("Top page by clicks")).toBeInTheDocument();
    expect(screen.getByText("No reported issues")).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/search-console/overview"),
      expect.objectContaining({ startDate: expect.any(String), endDate: expect.any(String) }),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("shows setup guidance and opens settings when there is no connection", async () => {
    render(<SearchConsolePage />);

    expect(await screen.findByText(/Connect a Google account and save a Search Console property/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set up Search Console" }));
    expect(screen.getByRole("dialog", { name: "Connect your website" })).toBeInTheDocument();
  });

  it("supports preset date ranges and reveals date inputs for a custom range", async () => {
    const now = new Date();
    const fiscalYearStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    axios.get
      .mockResolvedValueOnce({
        data: {
          configured: true,
          connected: true,
          selectedProperty: "https://gfxunlimit.com/",
          values: {},
        },
      })
      .mockResolvedValueOnce({ data: { properties: [{ siteUrl: "https://gfxunlimit.com/", permissionLevel: "siteOwner" }] } });
    axios.post.mockResolvedValue(emptyOverviewResponse);
    render(<SearchConsolePage />);

    const rangeSelect = await screen.findByRole("combobox", { name: "Overview date range" });
    expect(Array.from(rangeSelect.options).map((option) => option.textContent)).toEqual([
      "Today",
      "Yesterday",
      "Last 7 days",
      "Current month",
      "Last month",
      "Current quarter",
      "Last quarter",
      "Current FY",
      "Last FY",
      "Custom",
    ]);
    expect(screen.queryByLabelText("Overview start date")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Overview end date")).not.toBeInTheDocument();

    fireEvent.change(rangeSelect, { target: { value: "lastFY" } });
    await waitFor(() => {
      expect(axios.post).toHaveBeenLastCalledWith(
        expect.stringContaining("/admin/search-console/overview"),
        { startDate: `${fiscalYearStart - 1}-04-01`, endDate: `${fiscalYearStart}-03-31` },
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });

    fireEvent.change(rangeSelect, { target: { value: "custom" } });
    const startDate = screen.getByLabelText("Overview start date");
    const endDate = screen.getByLabelText("Overview end date");
    expect(startDate).toBeInTheDocument();
    expect(endDate).toBeInTheDocument();
    fireEvent.change(startDate, { target: { value: "2020-01-01" } });
    await waitFor(() => {
      expect(axios.post).toHaveBeenLastCalledWith(
        expect.stringContaining("/admin/search-console/overview"),
        { startDate: "2020-01-01", endDate: `${fiscalYearStart}-03-31` },
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
  });

  it("submits a sitemap for the saved property and refreshes its status", async () => {
    const sitemap = {
      path: "https://gfxunlimit.com/sitemap.xml",
      isPending: false,
      lastSubmitted: "2026-11-12T10:00:00Z",
      errors: 0,
      warnings: 0,
    };
    axios.get
      .mockResolvedValueOnce({
        data: {
          configured: true,
          connected: true,
          selectedProperty: "https://gfxunlimit.com/",
          values: {},
        },
      })
      .mockResolvedValueOnce({ data: { properties: [{ siteUrl: "https://gfxunlimit.com/", permissionLevel: "siteOwner" }] } })
      .mockResolvedValueOnce({ data: { sitemaps: [sitemap] } })
      .mockResolvedValueOnce({ data: { sitemaps: [sitemap] } });
    axios.post
      .mockResolvedValueOnce(emptyOverviewResponse)
      .mockResolvedValue({
        data: { message: "Sitemap submitted to Google Search Console." },
      });
    render(<SearchConsolePage />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Connect your website" })).getByRole("button", { name: "Sitemaps" }));

    const sitemapInput = await screen.findByLabelText("Sitemap URL");
    await waitFor(() => expect(sitemapInput).toBeEnabled());
    expect(sitemapInput).toHaveValue("https://gfxunlimit.com/sitemap.xml");
    fireEvent.click(screen.getByRole("button", { name: "Submit sitemap" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Sitemap submitted to Google Search Console.");
    expect(await screen.findByText("https://gfxunlimit.com/sitemap.xml")).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/search-console/sitemaps"),
      { sitemapUrl: "https://gfxunlimit.com/sitemap.xml" },
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("shows URL inspection controls and reports the API limitation", async () => {
    axios.get
      .mockResolvedValueOnce({
        data: { configured: true, connected: true, selectedProperty: "sc-domain:gfxunlimit.com", values: {} },
      })
      .mockResolvedValueOnce({
        data: { properties: [{ siteUrl: "sc-domain:gfxunlimit.com", permissionLevel: "siteOwner" }] },
      });
    axios.post.mockResolvedValue({
      data: {
        inspectionUrl: "https://gfxunlimit.com/gallery",
        siteUrl: "sc-domain:gfxunlimit.com",
        indexStatus: {
          verdict: "PASS",
          coverageState: "Submitted and indexed",
          indexingState: "INDEXING_ALLOWED",
          robotsTxtState: "ALLOWED",
          pageFetchState: "SUCCESSFUL",
          lastCrawlTime: "2026-01-02T03:04:05Z",
          googleCanonical: "https://gfxunlimit.com/gallery",
          userCanonical: "https://gfxunlimit.com/gallery",
          sitemap: ["https://gfxunlimit.com/sitemap.xml"],
        },
      },
    });
    render(<SearchConsolePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Pages" }));
    expect(screen.getByText(/does not provide the bulk Pages coverage report/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Page URL"), { target: { value: "https://gfxunlimit.com/gallery" } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect URL" }));

    expect(await screen.findByText("Submitted and indexed")).toBeInTheDocument();
    expect(screen.getByText("https://gfxunlimit.com/sitemap.xml")).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/search-console/url-inspection"),
      { inspectionUrl: "https://gfxunlimit.com/gallery" },
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("loads sitemap status in the left-side Sitemaps section", async () => {
    axios.get
      .mockResolvedValueOnce({
        data: { configured: true, connected: true, selectedProperty: "sc-domain:gfxunlimit.com", values: {} },
      })
      .mockResolvedValueOnce({
        data: { properties: [{ siteUrl: "sc-domain:gfxunlimit.com", permissionLevel: "siteOwner" }] },
      })
      .mockResolvedValueOnce({
        data: {
          siteUrl: "sc-domain:gfxunlimit.com",
          sitemaps: [{
            path: "https://gfxunlimit.com/sitemap.xml",
            isSitemapsIndex: false,
            isPending: false,
            lastSubmitted: "2026-11-12T10:00:00Z",
            lastDownloaded: "2026-11-13T10:00:00Z",
            errors: 1,
            warnings: 2,
            contents: [
              { type: "web", indexed: "14", submitted: "20" },
              { type: "video", indexed: "3", submitted: "4" },
            ],
          }],
        },
      });
    render(<SearchConsolePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Sitemaps" }));

    expect(await screen.findByRole("heading", { name: "Sitemaps" })).toBeInTheDocument();
    const sitemapTable = await screen.findByRole("table");
    expect(within(sitemapTable).getByRole("columnheader", { name: "Sitemap" })).toBeInTheDocument();
    expect(within(sitemapTable).getByRole("columnheader", { name: "Submitted" })).toBeInTheDocument();
    expect(within(sitemapTable).getByRole("columnheader", { name: "Last read" })).toBeInTheDocument();
    expect(within(sitemapTable).getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(within(sitemapTable).getByRole("columnheader", { name: "Discovered pages" })).toBeInTheDocument();
    expect(within(sitemapTable).getByRole("columnheader", { name: "Discovered videos" })).toBeInTheDocument();
    expect(within(sitemapTable).getByText("https://gfxunlimit.com/sitemap.xml")).toBeInTheDocument();
    expect(within(sitemapTable).getByText("Has errors")).toBeInTheDocument();
    expect(within(sitemapTable).getByText("20")).toBeInTheDocument();
    expect(within(sitemapTable).getByText("4")).toBeInTheDocument();
    expect(within(sitemapTable).queryByText("14")).not.toBeInTheDocument();
    expect(within(sitemapTable).queryByText("3")).not.toBeInTheDocument();
    expect(screen.getByText(/1 error · 2 warnings/)).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/admin/search-console/sitemaps"),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("closes the dialog with Escape", () => {
    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows OAuth as configured even before a Google account is connected", async () => {
    axios.get.mockResolvedValue({
      data: {
        configured: true,
        connected: false,
        missingConfiguration: [],
        values: {
          clientId: "configured-client-id",
          redirectUri: "https://example.com/search-console/oauth/callback",
          clientSecretConfigured: true,
          tokenKeyConfigured: true,
        },
      },
    });
    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Google OAuth Configuration" }));

    await waitFor(() => {
      expect(screen.getByText("Google OAuth is configured")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Google OAuth is not configured on the server/)).not.toBeInTheDocument();
  });

  it("explains when the connected Google account only granted read-only access", async () => {
    axios.get.mockResolvedValue({
      data: {
        configured: true,
        connected: true,
        accountEmail: "owner@example.com",
        writeScopeGranted: false,
        values: {},
      },
    });
    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Google account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/read-only Search Console access/);
    expect(screen.getByRole("alert")).toHaveTextContent(/remove this app from your Google Account's third-party connections/);
  });

  it("shows Google property access errors with a retry action", async () => {
    axios.get
      .mockResolvedValueOnce({
        data: {
          configured: true,
          connected: true,
          accountEmail: "admin@example.com",
          values: {},
        },
      })
      .mockRejectedValueOnce({
        response: { data: { error: "Google denied Search Console API access. Enable the API in the OAuth project's Cloud project." } },
      })
      .mockResolvedValueOnce({
        data: { properties: [{ siteUrl: "https://example.com/", permissionLevel: "siteOwner" }] },
      });

    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Property" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Enable the API in the OAuth project's Cloud project/);
    fireEvent.click(screen.getByRole("button", { name: "Retry loading properties" }));

    expect(await screen.findByRole("option", { name: "https://example.com/ · siteOwner" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("loads real performance metrics for the saved property and selected filters", async () => {
    axios.get.mockReset();
    axios.get
      .mockResolvedValueOnce({
        data: {
          configured: true,
          connected: true,
          accountEmail: "admin@example.com",
          selectedProperty: "https://example.com/",
          values: {},
        },
      })
      .mockResolvedValueOnce({ data: { properties: [{ siteUrl: "https://example.com/", permissionLevel: "siteOwner" }] } });
    axios.post
      .mockResolvedValueOnce(emptyOverviewResponse)
      .mockResolvedValue({
      data: {
        siteUrl: "https://example.com/",
        startDate: "2026-10-01",
        endDate: "2026-10-28",
        dimension: "query",
        totals: { clicks: 42, impressions: 1200, ctr: 0.035, position: 4.2 },
        rows: [{ keys: ["best query"], clicks: 12, impressions: 300, ctr: 0.04, position: 2.5 }],
        trend: [{ keys: ["2026-10-28"], clicks: 4, impressions: 100 }],
      },
      });

    render(<SearchConsolePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Performance" }));
    expect(await screen.findByRole("heading", { name: "Search performance" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Load performance" })).toBeEnabled();
    });
    expect(screen.getByRole("button", { name: "24 hours" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Queries" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Pages" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Countries" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Devices" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Search appearance" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.change(screen.getByLabelText("Performance start date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Performance end date"), { target: { value: "2026-10-28" } });
    fireEvent.click(screen.getByRole("button", { name: "Load performance" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/search-console/performance"),
        { startDate: "2026-10-01", endDate: "2026-10-28", dimension: "query" },
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(screen.getByText("1,200")).toBeInTheDocument();
      expect(screen.getByText("3.50%")).toBeInTheDocument();
      expect(screen.getByText("best query")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Daily clicks and impressions performance chart" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Days" }));
    expect(screen.getByRole("tab", { name: "Days" })).toHaveAttribute("aria-selected", "true");
  });

  it("saves and resets the selected Search Console property", async () => {
    axios.get.mockReset();
    axios.get
      .mockResolvedValueOnce({
        data: {
          configured: true,
          connected: true,
          accountEmail: "admin@example.com",
          selectedProperty: "",
          values: {},
        },
      })
      .mockResolvedValueOnce({
        data: { properties: [{ siteUrl: "https://example.com/", permissionLevel: "siteOwner" }] },
      });
    axios.put.mockResolvedValue({ data: { message: "Search Console property saved." } });
    axios.delete.mockResolvedValue({ data: { message: "Saved Search Console property reset." } });
    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Property" }));

    await screen.findByRole("option", { name: "https://example.com/ · siteOwner" });
    fireEvent.change(screen.getByLabelText("Property"), { target: { value: "https://example.com/" } });
    fireEvent.click(screen.getByRole("button", { name: "Save property" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/search-console/property"),
        { siteUrl: "https://example.com/" },
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(screen.getByText("Search Console property saved.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset property" }));
    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining("/admin/search-console/property"),
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(screen.getByLabelText("Property")).toHaveValue("");
      expect(screen.getByText("Saved Search Console property reset.")).toBeInTheDocument();
    });
  });

  it("saves Cloudflare settings and publishes Google's TXT verification record", async () => {
    axios.get.mockReset();
    axios.get
      .mockResolvedValueOnce({
        data: { configured: true, connected: false, values: {} },
      })
      .mockResolvedValueOnce({
        data: { configured: false, tokenConfigured: false, zoneId: "", zoneName: "" },
      });
    axios.post
      .mockResolvedValueOnce({
        data: {
          configured: true,
          tokenConfigured: true,
          zoneId: "a".repeat(32),
          zoneName: "example.com",
          message: "Cloudflare DNS settings saved securely.",
        },
      })
      .mockResolvedValueOnce({
        data: {
          created: true,
          message: "Google verification TXT record added to Cloudflare.",
        },
      });
    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Ownership verification" }));

    await screen.findByText("Cloudflare DNS access settings");
    fireEvent.change(screen.getByLabelText("TXT record content"), {
      target: { value: "google-site-verification=abc123" },
    });
    fireEvent.click(screen.getByText("Cloudflare DNS access settings"));
    fireEvent.change(screen.getByLabelText("Cloudflare API token"), {
      target: { value: "private-token" },
    });
    fireEvent.change(screen.getByLabelText("Cloudflare zone ID"), {
      target: { value: "a".repeat(32) },
    });
    fireEvent.change(screen.getByLabelText("Domain name"), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Cloudflare settings" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("/admin/search-console/ownership/cloudflare-config"),
        { apiToken: "private-token", zoneId: "a".repeat(32), zoneName: "example.com" },
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(screen.getByLabelText("Cloudflare API token")).toHaveValue("");
      expect(screen.getByLabelText("Cloudflare API token")).toHaveAttribute(
        "placeholder",
        "Saved securely — leave blank to keep current"
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Add TXT record to Cloudflare" }));
    await waitFor(() => {
      expect(axios.post).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("/admin/search-console/ownership/dns-record"),
        { name: "@", content: "google-site-verification=abc123" },
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(screen.getByText("Google verification TXT record added to Cloudflare.")).toBeInTheDocument();
    });
  });

  it("shows upload instructions for Google's HTML verification file", async () => {
    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Ownership verification" }));
    fireEvent.change(screen.getByLabelText("Verification method"), { target: { value: "html-file" } });
    const file = new File(["google-site-verification: abc123"], "google123.html", { type: "text/html" });
    fireEvent.change(screen.getByLabelText("Google verification HTML file"), { target: { files: [file] } });

    expect(await screen.findByText(/Selected: google123.html/)).toBeInTheDocument();
    expect(screen.getByText(/it is not sent or published by this form/)).toBeInTheDocument();
  });

  it("reports missing server OAuth configuration when starting Google sign-in", async () => {
    const popup = {
      location: { replace: jest.fn() },
      close: jest.fn(),
    };
    const openPopup = jest.spyOn(window, "open").mockReturnValue(popup);
    axios.post.mockRejectedValue({
      response: {
        data: {
          error: "Google Search Console OAuth is not configured on the server.",
          missingConfiguration: ["GOOGLE_SEARCH_CONSOLE_CLIENT_ID"],
        },
      },
    });
    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Google account" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Connect with Google" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect with Google" }));

    await waitFor(() => {
      expect(screen.getByText(/Configure these backend settings first/)).toHaveTextContent("GOOGLE_SEARCH_CONSOLE_CLIENT_ID");
    });
    expect(popup.close).toHaveBeenCalled();
    openPopup.mockRestore();
  });

  it("saves Google OAuth settings from the configuration form", async () => {
    axios.post.mockResolvedValue({
      data: { configured: true, message: "Google OAuth settings saved successfully." },
    });
    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Google OAuth Configuration" }));

    fireEvent.change(screen.getByLabelText("Google client ID"), { target: { value: "client-id" } });
    fireEvent.change(screen.getByLabelText("Google client secret"), { target: { value: "client-secret" } });
    fireEvent.change(screen.getByLabelText("Redirect URI"), { target: { value: "https://example.com/search-console/oauth/callback" } });
    fireEvent.change(screen.getByLabelText("Token key"), { target: { value: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Google OAuth settings" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/search-console/config"),
        {
          GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "client-id",
          GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "client-secret",
          GOOGLE_SEARCH_CONSOLE_REDIRECT_URI: "https://example.com/search-console/oauth/callback",
          GOOGLE_SEARCH_CONSOLE_TOKEN_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
  });

  it("requires confirmation and clears the saved Search Console configuration", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    axios.delete.mockResolvedValue({
      data: { configured: false, connected: false, message: "Configuration reset successfully." },
    });
    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Google OAuth Configuration" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Google client ID")).toHaveValue("prefilled-client-id");
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset Search Console configuration" }));
    expect(axios.delete).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset Search Console configuration" }));
    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining("/admin/search-console/config"),
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(screen.getByLabelText("Google client ID")).toHaveValue("");
      expect(screen.getByLabelText("Google client secret")).not.toHaveAttribute(
        "placeholder",
        "Saved securely — leave blank to keep current"
      );
      expect(screen.getByText("Configuration reset successfully.")).toBeInTheDocument();
    });

    confirm.mockRestore();
  });

  it("generates a valid 32-byte token key locally", () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(window, "crypto");
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: {
        getRandomValues: (bytes) => bytes.fill(7),
      },
    });
    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Google OAuth Configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate key" }));

    expect(screen.getByLabelText("Token key").value).toMatch(/^[a-f0-9]{64}$/);
    if (originalCrypto) {
      Object.defineProperty(window, "crypto", originalCrypto);
    } else {
      delete window.crypto;
    }
  });

  it("imports client ID and secret from a Google OAuth client JSON file", async () => {
    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Google OAuth Configuration" }));
    const file = new File(["{}"], "client_secret.json", { type: "application/json" });
    file.text = jest.fn().mockResolvedValue(JSON.stringify({
      web: {
        client_id: "imported-client-id",
        client_secret: "imported-client-secret",
      },
    }));

    fireEvent.change(screen.getByLabelText(/Import OAuth client JSON/), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Google client ID")).toHaveValue("imported-client-id");
      expect(screen.getByLabelText("Google client secret")).toHaveValue("imported-client-secret");
    });
  });

  it("opens the Google authorization URL in a popup", async () => {
    const popup = {
      location: { replace: jest.fn() },
      close: jest.fn(),
    };
    const openPopup = jest.spyOn(window, "open").mockReturnValue(popup);
    axios.post.mockResolvedValue({
      data: { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=test" },
    });
    render(<SearchConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Search Console" }));
    fireEvent.click(screen.getByRole("button", { name: "Google account" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Connect with Google" })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Connect with Google" }));

    expect(openPopup).toHaveBeenCalledWith(
      "about:blank",
      "google-search-console-oauth",
      "popup=yes,width=560,height=720,resizable=yes,scrollbars=yes"
    );
    await waitFor(() => {
      expect(popup.location.replace).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?client_id=test");
    });
    openPopup.mockRestore();
  });
});
