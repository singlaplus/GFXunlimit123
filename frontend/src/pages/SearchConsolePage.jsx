import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { buildAuthHeaders } from "../utils/authSession";
import "./SearchConsolePage.css";

const SETUP_TABS = [
  { id: "configuration", label: "Google OAuth Configuration" },
  { id: "account", label: "Google account" },
  { id: "property", label: "Property" },
  { id: "verification", label: "Ownership verification" },
  { id: "performance", label: "Search performance" },
  { id: "sitemap", label: "Sitemaps" },
];

const GOOGLE_SEARCH_CONSOLE_CALLBACK_PATH = "/search-console/oauth/callback";
const DEFAULT_SITEMAP_URL = "https://gfxunlimit.com/sitemap.xml";
const GOOGLE_OAUTH_CLIENT_ORIGINS = [
  { label: "Local", value: "http://localhost:3000" },
  { label: "Live", value: "https://gfxunlimit.com" },
  { label: "Live (www)", value: "https://www.gfxunlimit.com" },
];
const GOOGLE_OAUTH_REDIRECT_URIS = [
  { label: "Local backend", value: `http://localhost:5000${GOOGLE_SEARCH_CONSOLE_CALLBACK_PATH}` },
  { label: "Live backend", value: `https://gfxunlimit.com${GOOGLE_SEARCH_CONSOLE_CALLBACK_PATH}` },
];
const SEARCH_PERFORMANCE_DIMENSIONS = [
  { value: "query", label: "Queries" },
  { value: "page", label: "Pages" },
  { value: "country", label: "Countries" },
  { value: "device", label: "Devices" },
  { value: "searchAppearance", label: "Search appearance" },
  { value: "date", label: "Days" },
];

const PERFORMANCE_DATE_PRESETS = [
  { value: "24hours", label: "24 hours" },
  { value: "7days", label: "7 days" },
  { value: "28days", label: "28 days" },
  { value: "3months", label: "3 months" },
];

const OVERVIEW_DATE_RANGES = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7Days", label: "Last 7 days" },
  { value: "currentMonth", label: "Current month" },
  { value: "lastMonth", label: "Last month" },
  { value: "currentQuarter", label: "Current quarter" },
  { value: "lastQuarter", label: "Last quarter" },
  { value: "currentFY", label: "Current FY" },
  { value: "lastFY", label: "Last FY" },
  { value: "custom", label: "Custom" },
];

function formatLocalDate(date) {
  return {
    year: date.getFullYear(),
    month: String(date.getMonth() + 1).padStart(2, "0"),
    day: String(date.getDate()).padStart(2, "0"),
  };
}

function getDateString(date) {
  const { year, month, day } = formatLocalDate(date);
  return `${year}-${month}-${day}`;
}

function getDateRangeForPreset(preset, today = new Date()) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);

  switch (preset) {
    case "today":
      break;
    case "yesterday":
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      break;
    case "last7Days":
      start.setDate(start.getDate() - 6);
      break;
    case "currentMonth":
      start.setDate(1);
      break;
    case "lastMonth":
      start.setDate(1);
      start.setMonth(start.getMonth() - 1);
      end.setDate(0);
      break;
    case "currentQuarter": {
      const quarterStartMonth = Math.floor(end.getMonth() / 3) * 3;
      start.setMonth(quarterStartMonth, 1);
      end.setMonth(quarterStartMonth + 3, 0);
      break;
    }
    case "lastQuarter": {
      const quarterStartMonth = Math.floor(end.getMonth() / 3) * 3;
      end.setMonth(quarterStartMonth, 0);
      start.setFullYear(end.getFullYear(), end.getMonth() - 2, 1);
      break;
    }
    case "currentFY":
    case "lastFY": {
      const fiscalYearStart = end.getMonth() >= 3 ? end.getFullYear() : end.getFullYear() - 1;
      const yearOffset = preset === "lastFY" ? -1 : 0;
      start.setFullYear(fiscalYearStart + yearOffset, 3, 1);
      end.setFullYear(fiscalYearStart + yearOffset + 1, 2, 31);
      break;
    }
    default:
      return null;
  }

  return { startDate: getDateString(start), endDate: getDateString(end) };
}

function getDefaultPerformanceDateRange() {
  const end = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 27 * 24 * 60 * 60 * 1000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function getPerformanceDateRange(preset) {
  const end = new Date();
  end.setDate(end.getDate() - 3);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  if (preset === "7days") start.setDate(start.getDate() - 6);
  else if (preset === "28days") start.setDate(start.getDate() - 27);
  else if (preset === "3months") start.setMonth(start.getMonth() - 3);
  return { startDate: getDateString(start), endDate: getDateString(end) };
}

const VERIFICATION_METHODS = [
  { id: "dns", label: "DNS TXT record" },
  { id: "html-file", label: "HTML verification file" },
  { id: "meta-tag", label: "HTML meta tag" },
  { id: "analytics", label: "Google Analytics" },
  { id: "tag-manager", label: "Google Tag Manager" },
];

const GOOGLE_OAUTH_SETUP_STEPS = [
  { text: "Select or create a Google Cloud project, then enable the Google Search Console API." },
  { text: "Configure the OAuth consent screen and add test users if the app is in testing mode." },
  { text: "Under APIs & Services → Credentials, create an OAuth client ID and choose Web application." },
  {
    text: "Add the authorized redirect URIs:",
    details: [
      <>Open <strong>Google Cloud Console</strong> and select your project.</>,
      <>Go to <strong>APIs &amp; Services → Credentials</strong>.</>,
      <>Click your <strong>OAuth 2.0 Client ID</strong>.</>,
      <>Under <strong>Authorized redirect URIs</strong>, click <strong>Add URI</strong> and add both:</>,
      <code>http://localhost:5000/search-console/oauth/callback</code>,
      <code>https://gfxunlimit.com/search-console/oauth/callback</code>,
      <>Click <strong>Save</strong>. Add these under <strong>Authorized redirect URIs</strong>, not <strong>Authorized JavaScript origins</strong>.</>,
    ],
  },
  { text: "Copy the Client ID and Client Secret below. Generate a 32-byte token key with `openssl rand -hex 32`, save, then connect from the Google account tab." },
];

function SearchConsoleOverview({
  connection,
  selectedProperty,
  overviewRange,
  onOverviewRangeChange,
  overviewDates,
  onOverviewDateChange,
  overviewData,
  overviewLoading,
  overviewError,
  onLoadOverview,
  onOpenSettings,
}) {
  return (
    <section className="search-console-overview" aria-labelledby="search-console-overview-title">
      <div className="search-console-overview-heading">
        <div>
          <span className="search-console-eyebrow">GOOGLE SEARCH CONSOLE</span>
          <h2 id="search-console-overview-title">Search performance overview</h2>
          <p>Performance and sitemap health for your saved property. Search data is delayed by Google, not real-time.</p>
        </div>
        <div className="search-console-overview-actions">
          <label className="search-console-field search-console-overview-range">
            Date range
            <select
              aria-label="Overview date range"
              value={overviewRange}
              onChange={(event) => onOverviewRangeChange(event.target.value)}
            >
              {OVERVIEW_DATE_RANGES.map((range) => (
                <option key={range.value} value={range.value}>{range.label}</option>
              ))}
            </select>
          </label>
          {overviewRange === "custom" && (
            <>
              <label className="search-console-field">
                From
                <input
                  type="date"
                  aria-label="Overview start date"
                  value={overviewDates.startDate}
                  max={overviewDates.endDate}
                  onChange={(event) => onOverviewDateChange("startDate", event.target.value)}
                />
              </label>
              <label className="search-console-field">
                To
                <input
                  type="date"
                  aria-label="Overview end date"
                  value={overviewDates.endDate}
                  min={overviewDates.startDate}
                  onChange={(event) => onOverviewDateChange("endDate", event.target.value)}
                />
              </label>
            </>
          )}
          <button
            type="button"
            className="search-console-primary-button"
            onClick={onLoadOverview}
            disabled={!connection.connected || !selectedProperty || overviewLoading}
          >
            {overviewLoading ? "Refreshing..." : "Refresh overview"}
          </button>
        </div>
      </div>
      {connection.loading && <p className="search-console-help" role="status">Checking your Google Search Console connection...</p>}
      {!connection.loading && !connection.connected && (
        <div className="search-console-overview-empty">
          <p>Connect a Google account and save a Search Console property to see its overview here.</p>
          <button type="button" className="search-console-primary-button" onClick={onOpenSettings}>Set up Search Console</button>
        </div>
      )}
      {connection.connected && !selectedProperty && (
        <p className="search-console-help">Choose and save a Search Console property in the Property tab to load its overview.</p>
      )}
      {overviewError && <p className="search-console-inline-notice" role="alert">{overviewError}</p>}
      {overviewLoading && !overviewData && <p className="search-console-help" role="status">Loading Search Console overview…</p>}
      {overviewData && (
        <div className="search-console-overview-results">
          <div className="search-console-performance-property">
            <strong>{overviewData.siteUrl}</strong>
            <span>{overviewData.startDate} – {overviewData.endDate}</span>
          </div>
          <section className="search-console-overview-performance" aria-labelledby="search-console-performance-chart-title">
            <div className="search-console-overview-performance-heading">
              <h3 id="search-console-performance-chart-title">Performance</h3>
              <div className="search-console-chart-legend" aria-label="Chart series">
                <span><i className="is-clicks" aria-hidden="true" /> Clicks</span>
                <span><i className="is-impressions" aria-hidden="true" /> Impressions</span>
              </div>
            </div>
            {overviewData.trend.length ? (
              <div className="search-console-performance-chart" role="img" aria-label="Daily clicks and impressions performance chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={overviewData.trend.map((row) => ({
                      date: row.keys?.[0] || "",
                      clicks: Number(row.clicks || 0),
                      impressions: Number(row.impressions || 0),
                    }))}
                    margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid stroke="var(--search-console-chart-grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date) => date.slice(5)}
                      tick={{ fill: "var(--search-console-chart-text)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      yAxisId="clicks"
                      tick={{ fill: "var(--search-console-chart-text)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                    />
                    <YAxis
                      yAxisId="impressions"
                      orientation="right"
                      tick={{ fill: "var(--search-console-chart-text)", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip
                      labelFormatter={(date) => `Date: ${date}`}
                      formatter={(value, name) => [Number(value).toLocaleString(), name === "clicks" ? "Clicks" : "Impressions"]}
                      contentStyle={{
                        border: "1px solid var(--search-console-chart-grid)",
                        borderRadius: 10,
                        background: "var(--search-console-chart-surface)",
                        color: "var(--search-console-chart-text)",
                      }}
                    />
                    <Line yAxisId="clicks" type="monotone" dataKey="clicks" name="clicks" stroke="#2563eb" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                    <Line yAxisId="impressions" type="monotone" dataKey="impressions" name="impressions" stroke="#0f9f8f" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="search-console-report-empty">
                <svg aria-hidden="true" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="17" stroke="currentColor" strokeWidth="3.5" />
                  <path d="M24 13v12l8 5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p>No performance data for this date range.</p>
              </div>
            )}
            <div className="search-console-performance-metrics">
              <article><span>Total clicks</span><strong>{Number(overviewData.totals.clicks).toLocaleString()}</strong></article>
              <article><span>Total impressions</span><strong>{Number(overviewData.totals.impressions).toLocaleString()}</strong></article>
              <article><span>Average CTR</span><strong>{(Number(overviewData.totals.ctr) * 100).toFixed(2)}%</strong></article>
              <article><span>Average position</span><strong>{Number(overviewData.totals.position).toFixed(1)}</strong></article>
            </div>
          </section>
          <section className="search-console-indexing-report" aria-labelledby="search-console-indexing-title">
            <div className="search-console-indexing-heading">
              <div>
                <h3 id="search-console-indexing-title">Indexing</h3>
                <p>This panel reports sitemap processing. Page-level indexing coverage is not available through the Search Console API.</p>
              </div>
            </div>
            {overviewData.sitemaps.length ? (
              <ul className="search-console-indexing-list">
                {overviewData.sitemaps.map((sitemap) => {
                  const errorCount = Number(sitemap.errors || 0);
                  const warningCount = Number(sitemap.warnings || 0);
                  return (
                    <li key={sitemap.path}>
                      <a href={sitemap.path} target="_blank" rel="noreferrer">{sitemap.path}</a>
                      <span className={errorCount > 0 ? "has-errors" : ""}>
                        {errorCount > 0
                          ? `${errorCount} errors`
                          : sitemap.isPending ? "Processing" : "Processed"}
                        {warningCount > 0 ? ` · ${warningCount} warnings` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="search-console-report-empty">
                <svg aria-hidden="true" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="17" stroke="currentColor" strokeWidth="3.5" />
                  <path d="M24 13v12l8 5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p>No sitemap data available for this property.</p>
              </div>
            )}
          </section>
          <div className="search-console-overview-grid">
            <section>
              <h3>Daily search trend</h3>
              {overviewData.trend.length ? (
                <div className="search-console-overview-table-wrap">
                  <table className="search-console-overview-table">
                    <thead><tr><th scope="col">Date</th><th scope="col">Clicks</th><th scope="col">Impressions</th></tr></thead>
                    <tbody>
                      {overviewData.trend.slice(-31).map((row) => (
                        <tr key={row.keys?.[0]}>
                          <td>{row.keys?.[0] || "—"}</td>
                          <td>{Number(row.clicks || 0).toLocaleString()}</td>
                          <td>{Number(row.impressions || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="search-console-help">No daily data for this date range.</p>}
            </section>
            <section>
              <h3>Top search queries</h3>
              {overviewData.topQueries.length ? (
                <ol className="search-console-overview-list">
                  {overviewData.topQueries.slice(0, 5).map((row, index) => (
                    <li key={`${row.keys?.[0] || "query"}-${index}`}>
                      <span>{row.keys?.[0] || "—"}</span><strong>{Number(row.clicks || 0).toLocaleString()} clicks</strong>
                    </li>
                  ))}
                </ol>
              ) : <p className="search-console-help">No query data for this date range.</p>}
            </section>
            <section>
              <h3>Top pages</h3>
              {overviewData.topPages.length ? (
                <ol className="search-console-overview-list">
                  {overviewData.topPages.slice(0, 5).map((row, index) => (
                    <li key={`${row.keys?.[0] || "page"}-${index}`}>
                      <a href={row.keys?.[0]} target="_blank" rel="noreferrer">{row.keys?.[0] || "—"}</a>
                      <strong>{Number(row.clicks || 0).toLocaleString()} clicks</strong>
                    </li>
                  ))}
                </ol>
              ) : <p className="search-console-help">No page data for this date range.</p>}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}

function SearchConsoleInsights({ overviewData, overviewLoading, overviewError }) {
  const topQuery = overviewData?.topQueries?.[0];
  const topPage = overviewData?.topPages?.[0];
  const sitemapsWithIssues = overviewData?.sitemaps?.filter(
    (sitemap) => Number(sitemap.errors) > 0 || Number(sitemap.warnings) > 0
  ) || [];

  return (
    <section className="search-console-overview" aria-labelledby="search-console-insights-title">
      <div className="search-console-overview-heading">
        <div>
          <span className="search-console-eyebrow">GOOGLE SEARCH CONSOLE</span>
          <h2 id="search-console-insights-title">Search insights</h2>
          <p>Highlights from your Search Console data for the selected date range.</p>
        </div>
      </div>
      {overviewLoading && !overviewData && <p className="search-console-help" role="status">Loading Search Console insights...</p>}
      {overviewError && <p className="search-console-inline-notice" role="alert">{overviewError}</p>}
      {!overviewLoading && !overviewError && !overviewData && (
        <p className="search-console-help">Connect and save a Search Console property to see its insights.</p>
      )}
      {overviewData && (
        <>
          <div className="search-console-performance-property">
            <strong>{overviewData.siteUrl}</strong>
            <span>{overviewData.startDate} – {overviewData.endDate}</span>
          </div>
          <div className="search-console-insights-grid">
            <article>
              <span>Top search query</span>
              <strong>{topQuery?.keys?.[0] || "No query data"}</strong>
              {topQuery && <small>{Number(topQuery.clicks || 0).toLocaleString()} clicks</small>}
            </article>
            <article>
              <span>Top page by clicks</span>
              <strong>{topPage?.keys?.[0] || "No page data"}</strong>
              {topPage && <small>{Number(topPage.clicks || 0).toLocaleString()} clicks</small>}
            </article>
            <article>
              <span>Sitemap status</span>
              <strong>
                {sitemapsWithIssues.length
                  ? `${sitemapsWithIssues.length} sitemap${sitemapsWithIssues.length === 1 ? "" : "s"} need attention`
                  : overviewData.sitemaps.length ? "No reported issues" : "No submitted sitemaps"}
              </strong>
              {sitemapsWithIssues.length > 0 && (
                <small>
                  {sitemapsWithIssues.reduce((total, sitemap) => total + Number(sitemap.errors || 0), 0)} errors,{" "}
                  {sitemapsWithIssues.reduce((total, sitemap) => total + Number(sitemap.warnings || 0), 0)} warnings
                </small>
              )}
            </article>
          </div>
        </>
      )}
    </section>
  );
}

function SearchConsolePagesPanel({
  connection,
  selectedProperty,
  inspectionUrl,
  onInspectionUrlChange,
  onInspect,
  result,
  loading,
  error,
}) {
  return (
    <section className="search-console-report" aria-labelledby="search-console-pages-title">
      <div className="search-console-report-heading">
        <div>
          <span className="search-console-eyebrow">INDEXING</span>
          <h2 id="search-console-pages-title">Pages</h2>
          <p>Inspect an individual URL in Google’s index and review its latest crawl information.</p>
        </div>
      </div>
      <p className="search-console-pages-limitation">
        Google’s API provides URL inspection one page at a time; it does not provide the bulk Pages coverage report shown in Search Console.
      </p>
      <form
        className="search-console-inspection-form"
        onSubmit={(event) => {
          event.preventDefault();
          onInspect();
        }}
      >
        <label className="search-console-field">
          Page URL
          <input
            type="url"
            value={inspectionUrl}
            onChange={(event) => onInspectionUrlChange(event.target.value)}
            placeholder="https://example.com/page"
            disabled={!connection.connected || !selectedProperty || loading}
            required
          />
        </label>
        <button
          type="submit"
          className="search-console-primary-button"
          disabled={!connection.connected || !selectedProperty || !inspectionUrl.trim() || loading}
        >
          {loading ? "Inspecting..." : "Inspect URL"}
        </button>
      </form>
      {!connection.connected && <p className="search-console-help">Connect a Google account first, then choose and save its Search Console property.</p>}
      {connection.connected && !selectedProperty && <p className="search-console-help">Choose and save a Search Console property before inspecting a page.</p>}
      {error && <p className="search-console-inline-notice" role="alert">{error}</p>}
      {result && (
        <div className="search-console-inspection-results" aria-live="polite">
          <h3>Inspection result</h3>
          <p className="search-console-inspection-verdict">{result.indexStatus.verdict || "No verdict returned"}</p>
          <dl>
            <div><dt>Coverage</dt><dd>{result.indexStatus.coverageState || "Not available"}</dd></div>
            <div><dt>Indexing</dt><dd>{result.indexStatus.indexingState || "Not available"}</dd></div>
            <div><dt>Robots.txt</dt><dd>{result.indexStatus.robotsTxtState || "Not available"}</dd></div>
            <div><dt>Page fetch</dt><dd>{result.indexStatus.pageFetchState || "Not available"}</dd></div>
            <div><dt>Last crawl</dt><dd>{result.indexStatus.lastCrawlTime ? new Date(result.indexStatus.lastCrawlTime).toLocaleString() : "Not available"}</dd></div>
            <div><dt>Google canonical</dt><dd>{result.indexStatus.googleCanonical || "Not available"}</dd></div>
            <div><dt>User canonical</dt><dd>{result.indexStatus.userCanonical || "Not available"}</dd></div>
            <div><dt>Sitemaps</dt><dd>{result.indexStatus.sitemap.length ? result.indexStatus.sitemap.join(", ") : "None reported"}</dd></div>
          </dl>
        </div>
      )}
    </section>
  );
}

function SearchConsoleSitemapsPanel({
  connection,
  selectedProperty,
  sitemapUrl,
  onSitemapUrlChange,
  onSubmitSitemap,
  onLoadSitemaps,
  sitemapData,
  loading,
  submitting,
  error,
  notice,
}) {
  return (
    <section className="search-console-report" aria-labelledby="search-console-sitemaps-title">
      <div className="search-console-report-heading">
        <div>
          <span className="search-console-eyebrow">INDEXING</span>
          <h2 id="search-console-sitemaps-title">Sitemaps</h2>
          <p>Submit a sitemap to your saved property and review Google’s processing status.</p>
        </div>
      </div>
      <label className="search-console-field">
        Sitemap URL
        <input
          type="url"
          value={sitemapUrl}
          onChange={(event) => onSitemapUrlChange(event.target.value)}
          placeholder="https://example.com/sitemap.xml"
          disabled={!connection.connected || !selectedProperty || submitting}
        />
      </label>
      <div className="search-console-property-actions">
        <button
          type="button"
          className="search-console-primary-button"
          onClick={onSubmitSitemap}
          disabled={!connection.connected || !selectedProperty || !sitemapUrl.trim() || submitting}
        >
          {submitting ? "Submitting sitemap..." : "Submit sitemap"}
        </button>
        <button
          type="button"
          className="search-console-secondary-button"
          onClick={onLoadSitemaps}
          disabled={!connection.connected || !selectedProperty || loading}
        >
          {loading ? "Refreshing..." : "Refresh status"}
        </button>
      </div>
      {!connection.connected && <p className="search-console-help">Connect a Google account first, then choose and save its Search Console property.</p>}
      {connection.connected && !selectedProperty && <p className="search-console-help">Choose and save a Search Console property before managing sitemaps.</p>}
      {error && <p className="search-console-inline-notice" role="alert">{error}</p>}
      {notice && <p className="search-console-inline-notice" role="status">{notice}</p>}
      {sitemapData && (
        <div className="search-console-sitemap-results" aria-live="polite">
          <div className="search-console-sitemap-table-wrap">
            <table className="search-console-sitemap-table">
              <thead>
                <tr>
                  <th scope="col">Sitemap</th>
                  <th scope="col">Type</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Last read</th>
                  <th scope="col">Status</th>
                  <th scope="col">Discovered pages</th>
                  <th scope="col">Discovered videos</th>
                </tr>
              </thead>
              <tbody>
                {sitemapData.length === 0 ? (
                  <tr><td className="search-console-sitemap-empty" colSpan="7">No sitemaps have been submitted for this property.</td></tr>
                ) : sitemapData.map((sitemap) => {
                  const contents = Array.isArray(sitemap.contents) ? sitemap.contents : [];
                  const hasContentCounts = contents.length > 0;
                  const countSubmitted = (type) => contents
                    .filter((content) => String(content.type || "").toLowerCase() === type)
                    .reduce((total, content) => total + Number(content.submitted || 0), 0);
                  const status = Number(sitemap.errors) > 0
                    ? "Has errors"
                    : Number(sitemap.warnings) > 0
                      ? "Has warnings"
                      : sitemap.isPending
                        ? "Pending"
                        : "Success";
                  return (
                    <tr key={sitemap.path}>
                      <td className="search-console-sitemap-path">{sitemap.path}</td>
                      <td>{sitemap.isSitemapsIndex ? "Sitemap index" : "Sitemap"}</td>
                      <td>{sitemap.lastSubmitted ? new Date(sitemap.lastSubmitted).toLocaleDateString() : "—"}</td>
                      <td>{sitemap.lastDownloaded ? new Date(sitemap.lastDownloaded).toLocaleDateString() : "—"}</td>
                      <td>
                        <span className={`search-console-sitemap-status${status === "Success" ? " is-success" : status === "Pending" ? " is-pending" : " is-issue"}`}>
                          {status}
                        </span>
                        {(Number(sitemap.errors) > 0 || Number(sitemap.warnings) > 0) && (
                          <small className="search-console-sitemap-issue-counts">
                            {Number(sitemap.errors) > 0 && `${sitemap.errors} ${Number(sitemap.errors) === 1 ? "error" : "errors"}`}
                            {Number(sitemap.errors) > 0 && Number(sitemap.warnings) > 0 ? " · " : ""}
                            {Number(sitemap.warnings) > 0 && `${sitemap.warnings} ${Number(sitemap.warnings) === 1 ? "warning" : "warnings"}`}
                          </small>
                        )}
                      </td>
                      <td>{hasContentCounts ? countSubmitted("web").toLocaleString() : "—"}</td>
                      <td>{hasContentCounts ? countSubmitted("video").toLocaleString() : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function SearchConsolePerformanceReport({
  connection,
  selectedProperty,
  dates,
  onDateChange,
  dimension,
  onDimensionChange,
  data,
  loading,
  error,
  onLoad,
}) {
  const [rangePreset, setRangePreset] = useState("28days");
  const [showCustomRange, setShowCustomRange] = useState(false);
  const dimensionLabel = SEARCH_PERFORMANCE_DIMENSIONS.find((item) => item.value === dimension)?.label || "Queries";

  const selectPreset = (preset) => {
    setRangePreset(preset);
    setShowCustomRange(false);
    const range = getPerformanceDateRange(preset);
    onDateChange("startDate", range.startDate);
    onDateChange("endDate", range.endDate);
  };

  return (
    <section className="search-console-overview" aria-labelledby="search-console-performance-title">
      <div className="search-console-overview-heading">
        <div>
          <span className="search-console-eyebrow">GOOGLE SEARCH CONSOLE</span>
          <h2 id="search-console-performance-title">Search performance</h2>
          <p>Analyze clicks, impressions, click-through rate, and average search position.</p>
        </div>
      </div>
      <div className="search-console-performance-toolbar">
        <div className="search-console-performance-date-controls" role="group" aria-label="Performance date presets">
          <button type="button" disabled title="Hourly Search Console data is not available through this API">24 hours</button>
          {PERFORMANCE_DATE_PRESETS.filter((preset) => preset.value !== "24hours").map((preset) => (
            <button
              type="button"
              key={preset.value}
              className={rangePreset === preset.value && !showCustomRange ? "is-active" : ""}
              aria-pressed={rangePreset === preset.value && !showCustomRange}
              onClick={() => selectPreset(preset.value)}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            className={showCustomRange ? "is-active" : ""}
            aria-expanded={showCustomRange}
            onClick={() => setShowCustomRange((current) => !current)}
          >
            More
          </button>
        </div>
        <span className="search-console-performance-search-type">Search type: Web</span>
        <button type="button" className="search-console-primary-button" onClick={onLoad} disabled={!connection.connected || !selectedProperty || loading}>
          {loading ? "Loading..." : "Load performance"}
        </button>
      </div>
      {showCustomRange && (
        <div className="search-console-performance-filters search-console-performance-custom-range">
          <label className="search-console-field">
            From
            <input
              type="date"
              aria-label="Performance start date"
              value={dates.startDate}
              max={dates.endDate}
              onChange={(event) => {
                setRangePreset("custom");
                onDateChange("startDate", event.target.value);
              }}
            />
          </label>
          <label className="search-console-field">
            To
            <input
              type="date"
              aria-label="Performance end date"
              value={dates.endDate}
              min={dates.startDate}
              onChange={(event) => {
                setRangePreset("custom");
                onDateChange("endDate", event.target.value);
              }}
            />
          </label>
        </div>
      )}
      {!selectedProperty && (
        <p className="search-console-help">Connect a Google account and save a property in the Property tab before loading performance data.</p>
      )}
      {error && <p className="search-console-inline-notice" role="alert">{error}</p>}
      {loading && !data && <p className="search-console-help" role="status">Loading Search Console performance data...</p>}
      <div className="search-console-performance-dimensions" role="tablist" aria-label="Performance report dimension">
        {SEARCH_PERFORMANCE_DIMENSIONS.map((item) => (
          <button
            type="button"
            role="tab"
            key={item.value}
            aria-selected={dimension === item.value}
            className={dimension === item.value ? "is-active" : ""}
            onClick={() => onDimensionChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {data && (
        <div className="search-console-performance-results">
          <p className="search-console-performance-property">
            <strong>{data.siteUrl}</strong>
            <span>{data.startDate} – {data.endDate}</span>
          </p>
          <section className="search-console-overview-performance" aria-labelledby="search-console-performance-chart-title">
            <div className="search-console-overview-performance-heading">
              <h3 id="search-console-performance-chart-title">Performance</h3>
              <div className="search-console-chart-legend" aria-label="Chart series">
                <span><i className="is-clicks" aria-hidden="true" /> Clicks</span>
                <span><i className="is-impressions" aria-hidden="true" /> Impressions</span>
              </div>
            </div>
            {data.trend?.length ? (
              <div className="search-console-performance-chart" role="img" aria-label="Daily clicks and impressions performance chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend.map((row) => ({
                    date: row.keys?.[0] || "",
                    clicks: Number(row.clicks || 0),
                    impressions: Number(row.impressions || 0),
                  }))}>
                    <CartesianGrid stroke="var(--search-console-chart-grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(date) => date.slice(5)} tick={{ fill: "var(--search-console-chart-text)", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="clicks" tick={{ fill: "var(--search-console-chart-text)", fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                    <YAxis yAxisId="impressions" orientation="right" tick={{ fill: "var(--search-console-chart-text)", fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
                    <Tooltip
                      labelFormatter={(date) => `Date: ${date}`}
                      formatter={(value, name) => [Number(value).toLocaleString(), name === "clicks" ? "Clicks" : "Impressions"]}
                    />
                    <Line yAxisId="clicks" type="monotone" dataKey="clicks" name="clicks" stroke="#2563eb" strokeWidth={2.5} dot={false} />
                    <Line yAxisId="impressions" type="monotone" dataKey="impressions" name="impressions" stroke="#0f9f8f" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="search-console-help">Search Console has no daily performance data for this date range yet.</p>
            )}
          </section>
          <div className="search-console-performance-metrics">
            <article><span>Total clicks</span><strong>{Number(data.totals.clicks).toLocaleString()}</strong></article>
            <article><span>Total impressions</span><strong>{Number(data.totals.impressions).toLocaleString()}</strong></article>
            <article><span>Average CTR</span><strong>{(Number(data.totals.ctr) * 100).toFixed(2)}%</strong></article>
            <article><span>Average position</span><strong>{Number(data.totals.position).toFixed(1)}</strong></article>
          </div>
          {data.rows.length ? (
            <div className="search-console-performance-table-wrap">
              <table className="search-console-performance-table">
                <thead>
                  <tr>
                    <th scope="col">{dimensionLabel}</th>
                    <th scope="col">Clicks</th>
                    <th scope="col">Impressions</th>
                    <th scope="col">CTR</th>
                    <th scope="col">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, index) => (
                    <tr key={`${row.keys?.join("-") || "row"}-${index}`}>
                      <td>{row.keys?.join(" · ") || "—"}</td>
                      <td>{Number(row.clicks || 0).toLocaleString()}</td>
                      <td>{Number(row.impressions || 0).toLocaleString()}</td>
                      <td>{(Number(row.ctr || 0) * 100).toFixed(2)}%</td>
                      <td>{Number(row.position || 0).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="search-console-help">No Search Console data is available for this date range.</p>
          )}
        </div>
      )}
    </section>
  );
}

function SearchConsoleSetupDialog({
  onClose,
  darkMode,
  connection,
  properties,
  propertiesLoading,
  propertyLoadError,
  onReloadProperties,
  selectedProperty,
  onPropertyChange,
  onSaveSelectedProperty,
  onResetSelectedProperty,
  propertySaving,
  propertyNotice,
  ownershipMethod,
  onOwnershipMethodChange,
  dnsRecordName,
  onDnsRecordNameChange,
  dnsRecordContent,
  onDnsRecordContentChange,
  htmlVerificationFile,
  onHtmlVerificationFileChange,
  metaVerificationCode,
  onMetaVerificationCodeChange,
  cloudflareConfig,
  onCloudflareConfigChange,
  cloudflareConfigSaving,
  onSaveCloudflareConfig,
  cloudflareConfigNotice,
  dnsRecordPublishing,
  onPublishDnsRecord,
  verificationNotice,
  onVerificationTabOpen,
  performanceDates,
  onPerformanceDateChange,
  performanceDimension,
  onPerformanceDimensionChange,
  performanceData,
  performanceLoading,
  performanceError,
  onLoadPerformance,
  sitemapUrl,
  onSitemapUrlChange,
  sitemapData,
  sitemapsLoading,
  sitemapsError,
  sitemapsNotice,
  onLoadSitemaps,
  onSubmitSitemap,
  sitemapSubmitting,
  onSitemapsTabOpen,
  onConnect,
  onDisconnect,
  config,
  updateConfigValue,
  saveGoogleConfig,
  resetGoogleConfig,
  importOAuthJson,
  savedSecrets,
  configSaving,
  configResetting,
  busy,
  notice,
}) {
  const [activeTab, setActiveTab] = useState("configuration");
  const [showQuickSetupSteps, setShowQuickSetupSteps] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className={`search-console-backdrop${darkMode ? " is-dark" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="search-console-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-console-dialog-title"
      >
        <header className="search-console-dialog-header">
          <div>
            <span className="search-console-eyebrow">GOOGLE SEARCH CONSOLE</span>
            <h2 id="search-console-dialog-title">Connect your website</h2>
            <p>Manage account access, site ownership, search data, and sitemaps.</p>
          </div>
          <button type="button" className="search-console-close" aria-label="Close dialog" onClick={onClose}>×</button>
        </header>

        <div className="search-console-dialog-body">
          <nav className="search-console-tabs" aria-label="Search Console setup options">
            {SETUP_TABS.map((tab) => (
              <button
                type="button"
                key={tab.id}
                className={activeTab === tab.id ? "is-active" : ""}
                aria-current={activeTab === tab.id ? "step" : undefined}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === "verification") onVerificationTabOpen();
                  if (tab.id === "sitemap" && connection.connected && selectedProperty) onSitemapsTabOpen();
                }}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="search-console-tab-panel" aria-live="polite">
            {activeTab === "configuration" && (
              <section aria-labelledby="search-console-config-title">
                <h3 id="search-console-config-title">Google OAuth configuration</h3>
                <p>Quick setup: create a Google OAuth client, enter its details below, and save.</p>

                <div className="search-console-help-box">
                  <div className="search-console-help-heading">
                    <h4>Google OAuth quick setup</h4>
                    <button
                      type="button"
                      className="search-console-secondary-button"
                      aria-expanded={showQuickSetupSteps}
                      aria-controls="google-oauth-quick-steps"
                      onClick={() => setShowQuickSetupSteps((isVisible) => !isVisible)}
                    >
                      {showQuickSetupSteps ? "Hide steps" : "Steps"}
                    </button>
                  </div>
                  {showQuickSetupSteps && (
                    <div id="google-oauth-quick-steps">
                      <p>
                        Start in <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a>.
                      </p>
                      <p className="search-console-oauth-values">
                        Add all of these under the OAuth client’s authorized JavaScript origins and redirect URIs:
                      </p>
                      <div className="search-console-oauth-value-list">
                        <div>
                          <strong>Authorized JavaScript origins</strong>
                          {GOOGLE_OAUTH_CLIENT_ORIGINS.map((origin) => (
                            <span key={origin.value}>{origin.label}: <code>{origin.value}</code></span>
                          ))}
                        </div>
                        <div>
                          <strong>Authorized redirect URIs</strong>
                          {GOOGLE_OAUTH_REDIRECT_URIS.map((redirect) => (
                            <span key={redirect.value}>{redirect.label}: <code>{redirect.value}</code></span>
                          ))}
                        </div>
                      </div>
                      <p className="search-console-oauth-values">
                        The Redirect URI field below must match the backend you’re saving to: local uses the local backend URL; live uses the live backend URL. Save the settings separately in each environment.
                      </p>
                      <ol className="search-console-quick-steps">
                        {GOOGLE_OAUTH_SETUP_STEPS.map((step) => (
                          <li key={step.text}>
                            {step.text}
                            {step.details && (
                              <ol>
                                {step.details.map((detail, detailIndex) => (
                                  <li key={`redirect-instruction-${detailIndex}`}>{detail}</li>
                                ))}
                              </ol>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>

                <div className="search-console-config-grid">
                  <label className="search-console-field search-console-client-id-field">
                    Google client ID
                    <input
                      type="text"
                      value={config.clientId}
                      onChange={(event) => updateConfigValue("clientId", event.target.value)}
                      placeholder="your-google-client-id"
                    />
                  </label>
                  <label className="search-console-field search-console-client-secret-field">
                    Google client secret
                    <input
                      type="password"
                      aria-label="Google client secret"
                      value={config.clientSecret}
                      onChange={(event) => updateConfigValue("clientSecret", event.target.value)}
                      placeholder={savedSecrets.clientSecret ? "Saved securely — leave blank to keep current" : "your-google-client-secret"}
                    />
                    {savedSecrets.clientSecret && <small className="search-console-field-help">A client secret is saved. Enter a new one only to replace it.</small>}
                  </label>
                  <label className="search-console-json-upload">
                    <input
                      type="file"
                      accept=".json,application/json"
                      aria-label="Import OAuth client JSON (optional)"
                      onChange={importOAuthJson}
                    />
                    <span className="search-console-json-upload-icon" aria-hidden="true">↑</span>
                    <span className="search-console-json-upload-copy">
                      <strong>Import OAuth client JSON <em>Optional</em></strong>
                      <small>Choose the downloaded Google credentials file</small>
                    </span>
                    <span className="search-console-json-upload-action">Choose file</span>
                    <span className="search-console-json-upload-note">Fills Client ID and Client Secret only</span>
                  </label>
                  <label className="search-console-field search-console-redirect-field">
                    Redirect URI
                    <input
                      type="url"
                      value={config.redirectUri}
                      onChange={(event) => updateConfigValue("redirectUri", event.target.value)}
                      placeholder="https://your-domain.com/search-console/oauth/callback"
                    />
                  </label>
                  <label className="search-console-field search-console-token-key-field">
                    Token key
                    <span className="search-console-token-key-input">
                      <input
                        type="password"
                        aria-label="Token key"
                        value={config.tokenKey}
                        onChange={(event) => updateConfigValue("tokenKey", event.target.value)}
                        placeholder={savedSecrets.tokenKey ? "Saved securely — leave blank to keep current" : "32-byte hex or base64 secret"}
                      />
                      <button
                        type="button"
                        className="search-console-secondary-button"
                        onClick={() => {
                          const bytes = new Uint8Array(32);
                          window.crypto.getRandomValues(bytes);
                          updateConfigValue("tokenKey", Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""));
                        }}
                      >
                        Generate key
                      </button>
                    </span>
                    {savedSecrets.tokenKey && <small className="search-console-field-help">A token key is saved. Enter a new one only to replace it.</small>}
                    <small className="search-console-field-help">Generate a private 32-byte key here, then save it with your OAuth settings.</small>
                  </label>
                </div>

                <button
                  type="button"
                  className="search-console-primary-button"
                  onClick={saveGoogleConfig}
                  disabled={configSaving || busy}
                >
                  {configSaving ? "Saving OAuth settings..." : "Save Google OAuth settings"}
                </button>
                <button
                  type="button"
                  className="search-console-reset-button"
                  onClick={resetGoogleConfig}
                  disabled={configResetting || configSaving || busy}
                >
                  {configResetting ? "Resetting configuration..." : "Reset Search Console configuration"}
                </button>
                <p className="search-console-field-help">
                  Reset deletes the saved OAuth values and disconnects the current Google account.
                </p>

                {!connection.configured && (
                  <div className="search-console-setup-notice" role="status">
                    Google OAuth is not configured on the server. Add the required Google OAuth settings to the backend environment before connecting.
                    {connection.missingConfiguration?.length > 0 && (
                      <small>Missing settings: {connection.missingConfiguration.join(", ")}</small>
                    )}
                  </div>
                )}

                {connection.configured ? (
                  <div className="search-console-connected-card" role="status">
                    <span className="search-console-connected-indicator" aria-hidden="true" />
                    <div>
                      <strong>Google OAuth is configured</strong>
                      <span>Backend settings are ready for account authorization.</span>
                    </div>
                  </div>
                ) : null}

                {notice && <p className="search-console-inline-notice" role="status">{notice}</p>}
              </section>
            )}

            {activeTab === "account" && (
              <section aria-labelledby="search-console-account-title">
                <h3 id="search-console-account-title">Connect a Google account</h3>
                <p>Authorize a Google account that has access to the Search Console property you want to manage.</p>
                {connection.connected ? (
                  <>
                    <div className="search-console-connected-card" role="status">
                      <span className="search-console-connected-indicator" aria-hidden="true" />
                      <div>
                        <strong>Google account connected</strong>
                        <span>{connection.accountEmail || "Google account authorized"}</span>
                      </div>
                      <button type="button" className="search-console-secondary-button" onClick={onDisconnect} disabled={busy}>
                        {busy ? "Working..." : "Disconnect"}
                      </button>
                    </div>
                    {connection.writeScopeGranted === false && (
                      <div className="search-console-setup-notice" role="alert">
                        This connection has read-only Search Console access. Disconnect it, remove this app from your Google Account's third-party connections, then reconnect and approve Search Console manage access.
                      </div>
                    )}
                    {connection.writeScopeGranted === true && (
                      <p className="search-console-help" role="status">Search Console read/write access is granted for this connection.</p>
                    )}
                    {connection.writeScopeGranted === null && (
                      <p className="search-console-help" role="status">Write access has not been verified for this connection. Reconnect if sitemap submission is denied.</p>
                    )}
                  </>
                ) : (
                  <>
                    {!connection.configured && (
                      <div className="search-console-setup-notice" role="status">
                        Google OAuth is not configured on the server. Add the required Google OAuth settings to the backend environment before connecting.
                        {connection.missingConfiguration?.length > 0 && (
                          <small>Missing settings: {connection.missingConfiguration.join(", ")}</small>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      className="search-console-primary-button"
                      onClick={onConnect}
                      disabled={connection.loading || busy}
                    >
                      {busy ? "Starting Google sign-in..." : "Connect with Google"}
                    </button>
                  </>
                )}
                {notice && <p className="search-console-inline-notice" role="status">{notice}</p>}
              </section>
            )}

            {activeTab === "property" && (
              <section aria-labelledby="search-console-property-title">
                <h3 id="search-console-property-title">Choose a Search Console property</h3>
                <p>After Google authorization, select a verified domain property or URL-prefix property.</p>
                <label className="search-console-field">
                  Property
                  <select
                    disabled={!connection.connected || propertiesLoading || properties.length === 0}
                    value={selectedProperty}
                    onChange={(event) => onPropertyChange(event.target.value)}
                  >
                    <option value="">{propertiesLoading ? "Loading properties..." : connection.connected ? "Select a property" : "Connect a Google account first"}</option>
                    {properties.map((property) => (
                      <option key={property.siteUrl} value={property.siteUrl}>
                        {property.siteUrl} · {property.permissionLevel}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="search-console-property-actions">
                  <button
                    type="button"
                    className="search-console-primary-button"
                    onClick={onSaveSelectedProperty}
                    disabled={!connection.connected || !selectedProperty || propertiesLoading || propertySaving}
                  >
                    {propertySaving ? "Saving property..." : "Save property"}
                  </button>
                  <button
                    type="button"
                    className="search-console-property-reset-button"
                    onClick={onResetSelectedProperty}
                    disabled={!connection.connected || !selectedProperty || propertySaving}
                  >
                    Reset property
                  </button>
                </div>
                {propertyNotice && <p className="search-console-inline-notice" role="status">{propertyNotice}</p>}
                {propertyLoadError && (
                  <div className="search-console-setup-notice" role="alert">
                    {propertyLoadError}
                    <button
                      type="button"
                      className="search-console-secondary-button"
                      onClick={onReloadProperties}
                      disabled={propertiesLoading}
                    >
                      {propertiesLoading ? "Refreshing..." : "Retry loading properties"}
                    </button>
                  </div>
                )}
                {connection.connected && !propertiesLoading && !propertyLoadError && properties.length === 0 && (
                  <p className="search-console-help">No Search Console properties are available to this Google account. Add or verify a property in Google Search Console, then reconnect.</p>
                )}
                {!connection.connected && (
                  <p className="search-console-help">Examples: <code>example.com</code> (domain) or <code>https://www.example.com/</code> (URL prefix).</p>
                )}
              </section>
            )}

            {activeTab === "verification" && (
              <section className="search-console-verification-section" aria-labelledby="search-console-verification-title">
                <div className="search-console-verification-heading">
                  <span className="search-console-verification-step">OWNERSHIP VERIFICATION</span>
                  <h3 id="search-console-verification-title">Verify website ownership</h3>
                  <p>Choose the method Google provided for your property. After publishing the record or file, finish verification in Search Console.</p>
                </div>
                <label className="search-console-field">
                  Verification method
                  <select value={ownershipMethod} onChange={(event) => onOwnershipMethodChange(event.target.value)}>
                    {VERIFICATION_METHODS.map((method) => (
                      <option key={method.id} value={method.id}>{method.label}</option>
                    ))}
                  </select>
                </label>

                {ownershipMethod === "dns" && (
                  <div className="search-console-verification-card">
                    <h4>Publish Google's DNS TXT record</h4>
                    <p>Copy the exact TXT value from Search Console. With Cloudflare configured below, this app can add the record to your zone.</p>
                    <label className="search-console-field">
                      TXT record name
                      <input value={dnsRecordName} onChange={(event) => onDnsRecordNameChange(event.target.value)} placeholder="@" />
                      <small className="search-console-field-help">Use @ for the root domain, or enter the host Google provides.</small>
                    </label>
                    <label className="search-console-field">
                      TXT record content
                      <input value={dnsRecordContent} onChange={(event) => onDnsRecordContentChange(event.target.value)} placeholder="google-site-verification=..." />
                    </label>

                    <details className="search-console-cloudflare-settings">
                      <summary>Cloudflare DNS access settings</summary>
                      <p>Create a Cloudflare API token limited to this zone with <strong>Zone → DNS → Edit</strong>. The token is stored on the backend and never shown again.</p>
                      <label className="search-console-field">
                        Cloudflare API token
                        <input
                          type="password"
                          value={cloudflareConfig.apiToken}
                          onChange={(event) => onCloudflareConfigChange("apiToken", event.target.value)}
                          placeholder={cloudflareConfig.tokenConfigured ? "Saved securely — leave blank to keep current" : "Paste a scoped Cloudflare API token"}
                        />
                      </label>
                      <label className="search-console-field">
                        Cloudflare zone ID
                        <input value={cloudflareConfig.zoneId} onChange={(event) => onCloudflareConfigChange("zoneId", event.target.value)} placeholder="32-character zone ID" />
                      </label>
                      <label className="search-console-field">
                        Domain name
                        <input value={cloudflareConfig.zoneName} onChange={(event) => onCloudflareConfigChange("zoneName", event.target.value)} placeholder="example.com" />
                      </label>
                      <button type="button" className="search-console-secondary-button" onClick={onSaveCloudflareConfig} disabled={cloudflareConfigSaving}>
                        {cloudflareConfigSaving ? "Saving Cloudflare settings..." : "Save Cloudflare settings"}
                      </button>
                      {cloudflareConfigNotice && <p className="search-console-inline-notice" role="status">{cloudflareConfigNotice}</p>}
                    </details>

                    <button
                      type="button"
                      className="search-console-primary-button"
                      onClick={onPublishDnsRecord}
                      disabled={!cloudflareConfig.configured || !dnsRecordContent.trim() || dnsRecordPublishing}
                    >
                      {dnsRecordPublishing ? "Publishing TXT record..." : "Add TXT record to Cloudflare"}
                    </button>
                    {verificationNotice && <p className="search-console-inline-notice" role="status">{verificationNotice}</p>}
                    <p className="search-console-help">After the record is added, return to Google Search Console and click Verify. DNS updates may take time to appear.</p>
                  </div>
                )}

                {ownershipMethod === "html-file" && (
                  <div className="search-console-verification-card">
                    <span className="search-console-verification-card-label">URL PREFIX PROPERTY</span>
                    <h4>Upload Google's HTML verification file</h4>
                    <p>Select the exact HTML file downloaded from Google. It must be uploaded to your website's root directory.</p>
                    <label className="search-console-field">
                      Google verification HTML file
                      <input type="file" accept=".html,.htm,text/html" onChange={onHtmlVerificationFileChange} />
                    </label>
                    {htmlVerificationFile && (
                      <p className="search-console-field-help" role="status">
                        Selected: {htmlVerificationFile.name}. Upload this exact file to the root of your website using your hosting or deployment tools, then click Verify in Google Search Console.
                      </p>
                    )}
                    <p className="search-console-help">This app cannot deploy files to your website host. The file is selected locally only; it is not sent or published by this form.</p>
                  </div>
                )}

                {ownershipMethod === "meta-tag" && (
                  <div className="search-console-verification-card">
                    <span className="search-console-verification-card-label">URL PREFIX PROPERTY</span>
                    <h4>Add Google's meta tag</h4>
                    <p>Paste the content value from Google's verification meta tag. The generated tag can then be added to your homepage's <code>&lt;head&gt;</code>.</p>
                    <label className="search-console-field">
                      Verification code
                      <input value={metaVerificationCode} onChange={(event) => onMetaVerificationCodeChange(event.target.value)} placeholder="Paste the code from Google's meta tag" />
                    </label>
                    {metaVerificationCode.trim() && (
                      <div className="search-console-verification-copy">
                        <span>Place this inside the homepage <code>&lt;head&gt;</code> using your site editor/deployment:</span>
                        <code>{`<meta name="google-site-verification" content="${metaVerificationCode.trim()}" />`}</code>
                      </div>
                    )}
                    <p className="search-console-help">This app cannot publish changes to your website files. After adding the tag, click Verify in Google Search Console.</p>
                  </div>
                )}

                {ownershipMethod === "analytics" && (
                  <div className="search-console-verification-card">
                    <h4>Google Analytics verification</h4>
                    <p>Install Google Analytics on your site's homepage and ensure the connected Google account has edit access to that Analytics property. Then choose this method in Search Console and click Verify.</p>
                  </div>
                )}

                {ownershipMethod === "tag-manager" && (
                  <div className="search-console-verification-card">
                    <h4>Google Tag Manager verification</h4>
                    <p>Install the Tag Manager container snippet on your site and ensure the connected Google account has publish access to that container. Then choose this method in Search Console and click Verify.</p>
                  </div>
                )}
              </section>
            )}

            {activeTab === "performance" && (
              <SearchConsolePerformanceReport
                connection={connection}
                selectedProperty={selectedProperty}
                dates={performanceDates}
                onDateChange={onPerformanceDateChange}
                dimension={performanceDimension}
                onDimensionChange={onPerformanceDimensionChange}
                data={performanceData}
                loading={performanceLoading}
                error={performanceError}
                onLoad={onLoadPerformance}
              />
            )}

            {activeTab === "sitemap" && (
              <section aria-labelledby="search-console-sitemap-title">
                <h3 id="search-console-sitemap-title">Submit a sitemap</h3>
                <p>Submit a sitemap URL to the saved Search Console property and review its processing status.</p>
                <label className="search-console-field">
                  Sitemap URL
                  <input
                    type="url"
                    value={sitemapUrl}
                    onChange={(event) => onSitemapUrlChange(event.target.value)}
                    placeholder="https://example.com/sitemap.xml"
                    disabled={!connection.connected || !selectedProperty || sitemapSubmitting}
                  />
                </label>
                <div className="search-console-property-actions">
                  <button
                    type="button"
                    className="search-console-primary-button"
                    onClick={onSubmitSitemap}
                    disabled={!connection.connected || !selectedProperty || !sitemapUrl.trim() || sitemapSubmitting}
                  >
                    {sitemapSubmitting ? "Submitting sitemap..." : "Submit sitemap"}
                  </button>
                  <button
                    type="button"
                    className="search-console-secondary-button"
                    onClick={onLoadSitemaps}
                    disabled={!connection.connected || !selectedProperty || sitemapsLoading}
                  >
                    {sitemapsLoading ? "Refreshing..." : "Refresh status"}
                  </button>
                </div>
                {!connection.connected && (
                  <p className="search-console-help">Connect a Google account first, then choose and save its Search Console property.</p>
                )}
                {connection.connected && !selectedProperty && (
                  <p className="search-console-help">Choose and save a Search Console property in the Property tab before submitting a sitemap.</p>
                )}
                {sitemapsError && <p className="search-console-inline-notice" role="alert">{sitemapsError}</p>}
                {sitemapsNotice && <p className="search-console-inline-notice" role="status">{sitemapsNotice}</p>}
                {sitemapData && (
                  <div className="search-console-sitemap-results" aria-live="polite">
                    <h4>Submitted sitemaps</h4>
                    {sitemapData.length === 0 ? (
                      <p className="search-console-help">Google has no submitted sitemaps for this property yet.</p>
                    ) : (
                      <ul>
                        {sitemapData.map((sitemap) => (
                          <li key={sitemap.path}>
                            <strong>{sitemap.path}</strong>
                            <span>
                              {sitemap.isPending ? "Pending" : "Processed"}
                              {sitemap.lastSubmitted ? ` · Submitted ${new Date(sitemap.lastSubmitted).toLocaleDateString()}` : ""}
                            </span>
                            {Number(sitemap.errors) > 0 && <span role="alert">{sitemap.errors} errors</span>}
                            {Number(sitemap.warnings) > 0 && <span>{sitemap.warnings} warnings</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default function SearchConsolePage({ darkMode = false }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const oauthPopupRef = useRef(null);
  const [connection, setConnection] = useState({
    loading: true,
    configured: false,
    connected: false,
    accountEmail: null,
    selectedProperty: "",
    missingConfiguration: [],
  });
  const [config, setConfig] = useState({
    clientId: "",
    clientSecret: "",
    redirectUri: `${API_BASE_URL}${GOOGLE_SEARCH_CONSOLE_CALLBACK_PATH}`,
    tokenKey: "",
  });
  const [savedSecrets, setSavedSecrets] = useState({
    clientSecret: false,
    tokenKey: false,
  });
  const [properties, setProperties] = useState([]);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertyLoadError, setPropertyLoadError] = useState("");
  const [selectedProperty, setSelectedProperty] = useState("");
  const [propertySaving, setPropertySaving] = useState(false);
  const [propertyNotice, setPropertyNotice] = useState("");
  const [ownershipMethod, setOwnershipMethod] = useState("dns");
  const [dnsRecordName, setDnsRecordName] = useState("@");
  const [dnsRecordContent, setDnsRecordContent] = useState("");
  const [htmlVerificationFile, setHtmlVerificationFile] = useState(null);
  const [metaVerificationCode, setMetaVerificationCode] = useState("");
  const [cloudflareConfig, setCloudflareConfig] = useState({
    apiToken: "",
    tokenConfigured: false,
    zoneId: "",
    zoneName: "",
    configured: false,
  });
  const [cloudflareConfigSaving, setCloudflareConfigSaving] = useState(false);
  const [cloudflareConfigNotice, setCloudflareConfigNotice] = useState("");
  const [dnsRecordPublishing, setDnsRecordPublishing] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState("");
  const [performanceDates, setPerformanceDates] = useState(getDefaultPerformanceDateRange);
  const [performanceDimension, setPerformanceDimension] = useState("query");
  const [performanceData, setPerformanceData] = useState(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceError, setPerformanceError] = useState("");
  const [overviewRange, setOverviewRange] = useState("last7Days");
  const [overviewDates, setOverviewDates] = useState(() => getDateRangeForPreset("last7Days"));
  const [overviewData, setOverviewData] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const overviewRequestRef = useRef("");
  const [sitemapUrl, setSitemapUrl] = useState(DEFAULT_SITEMAP_URL);
  const [sitemapData, setSitemapData] = useState(null);
  const [sitemapsLoading, setSitemapsLoading] = useState(false);
  const [sitemapsError, setSitemapsError] = useState("");
  const [sitemapsNotice, setSitemapsNotice] = useState("");
  const [sitemapSubmitting, setSitemapSubmitting] = useState(false);
  const [inspectionUrl, setInspectionUrl] = useState("");
  const [inspectionResult, setInspectionResult] = useState(null);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [inspectionError, setInspectionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configResetting, setConfigResetting] = useState(false);
  const [notice, setNotice] = useState("");

  const updateConfigValue = (field, value) => {
    setConfig((current) => ({ ...current, [field]: value }));
  };

  const loadProperties = useCallback(async () => {
    setPropertiesLoading(true);
    setPropertyLoadError("");
    try {
      const propertyResponse = await axios.get(`${API_BASE_URL}/admin/search-console/properties`, {
        headers: buildAuthHeaders(),
      });
      const nextProperties = Array.isArray(propertyResponse.data?.properties) ? propertyResponse.data.properties : [];
      setProperties(nextProperties);
      setSelectedProperty((current) => (
        nextProperties.some((property) => property.siteUrl === current) ? current : ""
      ));
    } catch (error) {
      console.error("Unable to load Google Search Console properties", error);
      setProperties([]);
      setPropertyLoadError(error.response?.data?.error || "Unable to load Search Console properties. Please try again.");
    } finally {
      setPropertiesLoading(false);
    }
  }, []);

  const loadCloudflareConfig = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/admin/search-console/ownership/cloudflare-status`, {
        headers: buildAuthHeaders(),
      });
      setCloudflareConfig((current) => ({
        ...current,
        ...response.data,
        apiToken: "",
      }));
    } catch (error) {
      console.error("Unable to load Cloudflare DNS configuration status", error);
      setCloudflareConfigNotice(error.response?.data?.error || "Unable to load Cloudflare DNS configuration status.");
    }
  }, []);

  const loadConnection = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/admin/search-console/status`, {
        headers: buildAuthHeaders(),
      });
      const nextConnection = { loading: false, ...response.data };
      const configValues = response.data?.values || {};
      setConnection(nextConnection);
      setSelectedProperty(nextConnection.selectedProperty || "");
      setConfig({
        clientId: configValues.clientId || "",
        clientSecret: "",
        redirectUri: configValues.redirectUri || `${API_BASE_URL}${GOOGLE_SEARCH_CONSOLE_CALLBACK_PATH}`,
        tokenKey: "",
      });
      setSavedSecrets({
        clientSecret: Boolean(configValues.clientSecretConfigured),
        tokenKey: Boolean(configValues.tokenKeyConfigured),
      });
      if (nextConnection.connected) {
        await loadProperties();
      } else {
        setProperties([]);
        setSelectedProperty("");
        setPropertyLoadError("");
      }
    } catch (error) {
      console.error("Unable to load Google Search Console connection", error);
      setConnection((current) => ({ ...current, loading: false }));
      setNotice(error.response?.data?.error || "Unable to load Google Search Console status.");
    }
  }, [loadProperties]);

  const saveSelectedProperty = async () => {
    if (!selectedProperty) return;
    setPropertySaving(true);
    setPropertyNotice("");
    try {
      const response = await axios.put(
        `${API_BASE_URL}/admin/search-console/property`,
        { siteUrl: selectedProperty },
        { headers: buildAuthHeaders() }
      );
      setConnection((current) => ({ ...current, selectedProperty }));
      setOverviewData(null);
      setPropertyNotice(response.data?.message || "Search Console property saved.");
    } catch (error) {
      console.error("Unable to save selected Search Console property", error);
      setPropertyNotice(error.response?.data?.error || "Unable to save the selected Search Console property.");
    } finally {
      setPropertySaving(false);
    }
  };

  const resetSelectedProperty = async () => {
    setPropertySaving(true);
    setPropertyNotice("");
    try {
      const response = await axios.delete(`${API_BASE_URL}/admin/search-console/property`, {
        headers: buildAuthHeaders(),
      });
      setSelectedProperty("");
      setConnection((current) => ({ ...current, selectedProperty: "" }));
      setOverviewData(null);
      setPropertyNotice(response.data?.message || "Saved Search Console property reset.");
    } catch (error) {
      console.error("Unable to reset selected Search Console property", error);
      setPropertyNotice(error.response?.data?.error || "Unable to reset the saved Search Console property.");
    } finally {
      setPropertySaving(false);
    }
  };

  const updatePerformanceDate = (field, value) => {
    setPerformanceDates((current) => ({ ...current, [field]: value }));
    setPerformanceData(null);
    setPerformanceError("");
  };

  const updateOverviewDate = (field, value) => {
    setOverviewDates((current) => ({ ...current, [field]: value }));
    setOverviewData(null);
    setOverviewError("");
  };

  const updateOverviewRange = (preset) => {
    setOverviewRange(preset);
    const dateRange = getDateRangeForPreset(preset);
    if (dateRange) {
      setOverviewDates(dateRange);
      setOverviewData(null);
      setOverviewError("");
    }
  };

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/search-console/overview`,
        overviewDates,
        { headers: buildAuthHeaders() }
      );
      setOverviewData(response.data);
    } catch (error) {
      console.error("Unable to load Google Search Console overview", error);
      setOverviewData(null);
      setOverviewError(error.response?.data?.error || "Unable to load the Search Console overview.");
    } finally {
      setOverviewLoading(false);
    }
  }, [overviewDates]);

  useEffect(() => {
    if (!connection.connected || !connection.selectedProperty) {
      overviewRequestRef.current = "";
      return;
    }
    const requestKey = `${connection.selectedProperty}:${overviewDates.startDate}:${overviewDates.endDate}`;
    if (overviewRequestRef.current === requestKey) return;
    overviewRequestRef.current = requestKey;
    void loadOverview();
  }, [connection.connected, connection.selectedProperty, overviewDates, loadOverview]);

  const loadPerformance = async () => {
    setPerformanceLoading(true);
    setPerformanceError("");
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/search-console/performance`,
        {
          ...performanceDates,
          dimension: performanceDimension,
        },
        { headers: buildAuthHeaders() }
      );
      setPerformanceData(response.data);
    } catch (error) {
      console.error("Unable to load Google Search Console performance data", error);
      setPerformanceData(null);
      setPerformanceError(error.response?.data?.error || "Unable to load Search Console performance data.");
    } finally {
      setPerformanceLoading(false);
    }
  };

  const loadSitemaps = useCallback(async () => {
    setSitemapsLoading(true);
    setSitemapsError("");
    try {
      const response = await axios.get(`${API_BASE_URL}/admin/search-console/sitemaps`, {
        headers: buildAuthHeaders(),
      });
      setSitemapData(Array.isArray(response.data?.sitemaps) ? response.data.sitemaps : []);
    } catch (error) {
      console.error("Unable to load Google Search Console sitemaps", error);
      setSitemapData(null);
      setSitemapsError(error.response?.data?.error || "Unable to load Search Console sitemaps.");
    } finally {
      setSitemapsLoading(false);
    }
  }, []);

  const submitSitemap = async () => {
    setSitemapSubmitting(true);
    setSitemapsError("");
    setSitemapsNotice("");
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/search-console/sitemaps`,
        { sitemapUrl: sitemapUrl.trim() },
        { headers: buildAuthHeaders() }
      );
      setSitemapsNotice(response.data?.message || "Sitemap submitted to Google Search Console.");
      await loadSitemaps();
    } catch (error) {
      console.error("Unable to submit Google Search Console sitemap", error);
      setSitemapsError(error.response?.data?.error || "Unable to submit the sitemap to Search Console.");
    } finally {
      setSitemapSubmitting(false);
    }
  };

  const inspectUrl = async () => {
    setInspectionLoading(true);
    setInspectionError("");
    setInspectionResult(null);
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/search-console/url-inspection`,
        { inspectionUrl: inspectionUrl.trim() },
        { headers: buildAuthHeaders() }
      );
      setInspectionResult(response.data);
    } catch (error) {
      console.error("Unable to inspect Google Search Console URL", error);
      setInspectionError(error.response?.data?.error || "Unable to inspect this URL in Search Console.");
    } finally {
      setInspectionLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection === "sitemaps" && connection.connected && connection.selectedProperty) {
      void loadSitemaps();
    }
  }, [activeSection, connection.connected, connection.selectedProperty, loadSitemaps]);

  useEffect(() => {
    const callbackOrigin = new URL(API_BASE_URL).origin;
    const handleOAuthMessage = (event) => {
      if (event.origin !== callbackOrigin || event.source !== oauthPopupRef.current) return;
      const { type, result } = event.data || {};
      if (type !== "google-search-console-oauth") return;
      if (!["connected", "denied", "error"].includes(result)) return;
      oauthPopupRef.current = null;
      setBusy(false);
      setIsDialogOpen(true);
      if (result === "connected") {
        setNotice("Google Search Console connected successfully.");
        void loadConnection();
      } else if (result === "denied") {
        setNotice("Google account authorization was cancelled.");
      } else {
        setNotice("Google Search Console connection failed. Please try again.");
      }
    };
    window.addEventListener("message", handleOAuthMessage);
    void loadConnection();
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [loadConnection, loadCloudflareConfig]);

  const updateCloudflareConfig = (field, value) => {
    setCloudflareConfig((current) => ({ ...current, [field]: value }));
  };

  const saveCloudflareConfig = async () => {
    setCloudflareConfigSaving(true);
    setCloudflareConfigNotice("");
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/search-console/ownership/cloudflare-config`,
        {
          apiToken: cloudflareConfig.apiToken.trim(),
          zoneId: cloudflareConfig.zoneId.trim(),
          zoneName: cloudflareConfig.zoneName.trim(),
        },
        { headers: buildAuthHeaders() }
      );
      setCloudflareConfig((current) => ({
        ...current,
        ...response.data,
        apiToken: "",
        tokenConfigured: true,
        configured: true,
      }));
      setCloudflareConfigNotice(response.data?.message || "Cloudflare DNS settings saved securely.");
    } catch (error) {
      console.error("Unable to save Cloudflare DNS settings", error);
      setCloudflareConfigNotice(error.response?.data?.error || "Unable to save Cloudflare DNS settings.");
    } finally {
      setCloudflareConfigSaving(false);
    }
  };

  const publishDnsVerificationRecord = async () => {
    setDnsRecordPublishing(true);
    setVerificationNotice("");
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/search-console/ownership/dns-record`,
        { name: dnsRecordName.trim(), content: dnsRecordContent.trim() },
        { headers: buildAuthHeaders() }
      );
      setVerificationNotice(response.data?.message || "Google verification TXT record added.");
    } catch (error) {
      console.error("Unable to publish Google verification TXT record", error);
      setVerificationNotice(error.response?.data?.error || "Unable to publish the Google verification TXT record.");
    } finally {
      setDnsRecordPublishing(false);
    }
  };

  const selectHtmlVerificationFile = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) {
      setVerificationNotice("Choose Google's .html verification file.");
      return;
    }
    setHtmlVerificationFile(file);
    setVerificationNotice("");
  };

  const saveGoogleConfig = async () => {
    setConfigSaving(true);
    setNotice("");
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/search-console/config`,
        {
          GOOGLE_SEARCH_CONSOLE_CLIENT_ID: config.clientId.trim(),
          GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: config.clientSecret.trim(),
          GOOGLE_SEARCH_CONSOLE_REDIRECT_URI: config.redirectUri.trim(),
          GOOGLE_SEARCH_CONSOLE_TOKEN_KEY: config.tokenKey.trim(),
        },
        { headers: buildAuthHeaders() }
      );
      const nextConnection = { ...connection, ...response.data };
      setConnection((current) => ({ ...current, ...nextConnection, loading: false }));
      setConfig((current) => ({ ...current, clientSecret: "", tokenKey: "" }));
      setNotice(response.data?.message || "Google OAuth settings saved.");
      void loadConnection();
    } catch (error) {
      console.error("Unable to save Google Search Console config", error);
      const missing = error.response?.data?.missingConfiguration;
      setNotice(
        Array.isArray(missing) && missing.length
          ? `Configure these backend settings first: ${missing.join(", ")}.`
          : error.response?.data?.error || error.message || "Unable to save Google OAuth settings."
      );
    } finally {
      setConfigSaving(false);
    }
  };

  const resetGoogleConfig = async () => {
    const confirmed = window.confirm(
      "Reset Search Console configuration? This deletes the saved OAuth values and disconnects the current Google account."
    );
    if (!confirmed) return;

    setConfigResetting(true);
    setNotice("");
    try {
      const response = await axios.delete(`${API_BASE_URL}/admin/search-console/config`, {
        headers: buildAuthHeaders(),
      });
      setConnection((current) => ({
        ...current,
        loading: false,
        configured: false,
        connected: false,
        accountEmail: null,
        selectedProperty: "",
        missingConfiguration: [
          "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
          "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
          "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI",
          "GOOGLE_SEARCH_CONSOLE_TOKEN_KEY (32-byte hex or base64 key)",
        ],
      }));
      setConfig({
        clientId: "",
        clientSecret: "",
        redirectUri: `${API_BASE_URL}${GOOGLE_SEARCH_CONSOLE_CALLBACK_PATH}`,
        tokenKey: "",
      });
      setSavedSecrets({ clientSecret: false, tokenKey: false });
      setProperties([]);
      setPropertyLoadError("");
      setSelectedProperty("");
      setPropertyNotice("");
      setPerformanceData(null);
      setOverviewData(null);
      setNotice(response.data?.message || "Search Console configuration reset.");
    } catch (error) {
      console.error("Unable to reset Google Search Console configuration", error);
      setNotice(error.response?.data?.error || error.message || "Unable to reset Search Console configuration.");
    } finally {
      setConfigResetting(false);
    }
  };

  const importOAuthJson = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const contents = JSON.parse(await file.text());
      const credentials = contents?.web || contents?.installed || contents;
      if (
        !credentials
        || typeof credentials !== "object"
        || typeof credentials.client_id !== "string"
        || !credentials.client_id.trim()
        || typeof credentials.client_secret !== "string"
        || !credentials.client_secret.trim()
      ) {
        throw new Error("The JSON must contain client_id and client_secret (Google OAuth client JSON).");
      }
      setConfig((current) => ({
        ...current,
        clientId: credentials.client_id.trim(),
        clientSecret: credentials.client_secret.trim(),
      }));
      setNotice("Client ID and Client Secret imported. Review the other settings, then save.");
    } catch (error) {
      setNotice(error instanceof SyntaxError
        ? "Could not read that file as JSON. Choose the OAuth client JSON downloaded from Google Cloud."
        : error.message || "Unable to import the OAuth client JSON.");
    }
  };

  const connectGoogle = async () => {
    const popup = window.open(
      "about:blank",
      "google-search-console-oauth",
      "popup=yes,width=560,height=720,resizable=yes,scrollbars=yes"
    );
    if (!popup) {
      setNotice("The Google sign-in popup was blocked. Allow popups for this site and try again.");
      return;
    }

    oauthPopupRef.current = popup;
    setBusy(true);
    setNotice("");
    try {
      const response = await axios.post(
        `${API_BASE_URL}/admin/search-console/connect`,
        {},
        { headers: buildAuthHeaders() }
      );
      const authorizationUrl = new URL(response.data?.authorizationUrl);
      if (authorizationUrl.origin !== "https://accounts.google.com") {
        throw new Error("The server returned an invalid Google authorization URL.");
      }
      popup.location.replace(authorizationUrl.toString());
    } catch (error) {
      console.error("Unable to start Google Search Console connection", error);
      popup.close();
      oauthPopupRef.current = null;
      const missing = error.response?.data?.missingConfiguration;
      setNotice(
        Array.isArray(missing) && missing.length
          ? `Configure these backend settings first: ${missing.join(", ")}.`
          : error.response?.data?.error || error.message || "Unable to start Google sign-in."
      );
      setBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    setBusy(true);
    setNotice("");
    try {
      await axios.delete(`${API_BASE_URL}/admin/search-console/connection`, {
        headers: buildAuthHeaders(),
      });
      setConnection((current) => ({ ...current, connected: false, accountEmail: null }));
      setProperties([]);
      setPropertyLoadError("");
      setSelectedProperty("");
      setPropertyNotice("");
      setPerformanceData(null);
      setOverviewData(null);
    } catch (error) {
      console.error("Unable to disconnect Google Search Console", error);
      setNotice(error.response?.data?.error || "Unable to disconnect Google Search Console.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={`search-console-page${darkMode ? " is-dark" : ""}`}>
      <div className="search-console-page-inner">
        <div className="search-console-page-heading">
          <div>
            <span className="search-console-eyebrow">GROWTH &amp; DISCOVERY</span>
            <h1>Search integrations</h1>
          </div>
          <span className={`search-console-connection-status${connection.connected ? " is-connected" : ""}`}>
            <span aria-hidden="true" />
            {connection.loading ? "Checking connection..." : connection.connected ? "Connected" : "Not connected"}
          </span>
        </div>

        <section className="search-console-card" aria-labelledby="search-console-page-title">
          <div className="search-console-card-glow" aria-hidden="true" />
          <div className="search-console-card-topline">
            <div className="search-console-card-icon" aria-hidden="true">G</div>
            <span className="search-console-card-label">GOOGLE SEARCH CONSOLE</span>
          </div>
          <div className="search-console-card-content">
            <div className="search-console-card-copy">
              <h2 id="search-console-page-title">Make your search presence measurable.</h2>
              <p>Connect Google Search Console to understand how people discover your website and keep your pages visible in Google Search.</p>
              <div className="search-console-benefit-tags" aria-label="Integration benefits">
                <span>Search insights</span>
                <span>Verified properties</span>
                <span>Sitemap health</span>
              </div>
            </div>
            <div className="search-console-connect-action">
              <button
                type="button"
                className="search-console-primary-button"
                onClick={() => {
                  setIsDialogOpen(true);
                }}
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                  <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                Connect Search Console
              </button>
              <span>Secure Google authorization</span>
            </div>
          </div>
          <div className="search-console-card-footer">
            <span><i aria-hidden="true" /> {connection.connected ? connection.accountEmail || "Google account connected" : "No property connected"}</span>
            <span>Setup takes just a few steps</span>
          </div>
        </section>

        <div className="search-console-content-layout">
          <nav className="search-console-side-menu" aria-label="Search integrations menu">
            <span className="search-console-side-menu-title">Search Console</span>
            <button
              type="button"
              className={activeSection === "overview" ? "is-active" : ""}
              aria-current={activeSection === "overview" ? "page" : undefined}
              onClick={() => setActiveSection("overview")}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                <path d="M3 16V4m0 12h14M6 12l3-4 3 2 4-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Overview
            </button>
            <button
              type="button"
              className={activeSection === "insights" ? "is-active" : ""}
              aria-current={activeSection === "insights" ? "page" : undefined}
              onClick={() => setActiveSection("insights")}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                <path d="M10 2.5a6.25 6.25 0 0 0-3.8 11.2c.7.5 1.05 1.1 1.05 1.8h5.5c0-.7.35-1.3 1.05-1.8A6.25 6.25 0 0 0 10 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M7.5 17h5M8.25 19h3.5M10 5.5v3m-2.5 1.75L10 8.5l2.5 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Insights
            </button>
            <button
              type="button"
              className={activeSection === "performance" ? "is-active" : ""}
              aria-current={activeSection === "performance" ? "page" : undefined}
              onClick={() => setActiveSection("performance")}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                <path d="M3 16V4m0 12h14M5.5 12.5 8.5 9l3 2 4-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Performance
            </button>
            <button
              type="button"
              className={activeSection === "pages" ? "is-active" : ""}
              aria-current={activeSection === "pages" ? "page" : undefined}
              onClick={() => setActiveSection("pages")}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                <path d="M5 2.75h6l4 4v10.5H5V2.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M11 2.75v4h4M7.5 10h5M7.5 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Pages
            </button>
            <button
              type="button"
              className={activeSection === "sitemaps" ? "is-active" : ""}
              aria-current={activeSection === "sitemaps" ? "page" : undefined}
              onClick={() => setActiveSection("sitemaps")}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="5" cy="5" r="1" fill="currentColor" />
                <circle cx="5" cy="10" r="1" fill="currentColor" />
                <circle cx="5" cy="15" r="1" fill="currentColor" />
              </svg>
              Sitemaps
            </button>
          </nav>
          <div className="search-console-content-panel">
            {activeSection === "overview" && (
              <SearchConsoleOverview
                connection={connection}
                selectedProperty={connection.selectedProperty}
                overviewRange={overviewRange}
                onOverviewRangeChange={updateOverviewRange}
                overviewDates={overviewDates}
                onOverviewDateChange={updateOverviewDate}
                overviewData={overviewData}
                overviewLoading={overviewLoading}
                overviewError={overviewError}
                onLoadOverview={loadOverview}
                onOpenSettings={() => setIsDialogOpen(true)}
              />
            )}
            {activeSection === "insights" && (
              <SearchConsoleInsights
                overviewData={overviewData}
                overviewLoading={overviewLoading}
                overviewError={overviewError}
              />
            )}
            {activeSection === "performance" && (
              <SearchConsolePerformanceReport
                connection={connection}
                selectedProperty={connection.selectedProperty}
                dates={performanceDates}
                onDateChange={updatePerformanceDate}
                dimension={performanceDimension}
                onDimensionChange={(dimension) => {
                  setPerformanceDimension(dimension);
                  setPerformanceData(null);
                }}
                data={performanceData}
                loading={performanceLoading}
                error={performanceError}
                onLoad={loadPerformance}
              />
            )}
            {activeSection === "pages" && (
              <SearchConsolePagesPanel
                connection={connection}
                selectedProperty={connection.selectedProperty}
                inspectionUrl={inspectionUrl}
                onInspectionUrlChange={(value) => {
                  setInspectionUrl(value);
                  setInspectionResult(null);
                  setInspectionError("");
                }}
                onInspect={inspectUrl}
                result={inspectionResult}
                loading={inspectionLoading}
                error={inspectionError}
              />
            )}
            {activeSection === "sitemaps" && (
              <SearchConsoleSitemapsPanel
                connection={connection}
                selectedProperty={connection.selectedProperty}
                sitemapUrl={sitemapUrl}
                onSitemapUrlChange={(value) => {
                  setSitemapUrl(value);
                  setSitemapsNotice("");
                }}
                onSubmitSitemap={submitSitemap}
                onLoadSitemaps={loadSitemaps}
                sitemapData={sitemapData}
                loading={sitemapsLoading}
                submitting={sitemapSubmitting}
                error={sitemapsError}
                notice={sitemapsNotice}
              />
            )}
          </div>
        </div>
      </div>
      {notice && !isDialogOpen && <p className="search-console-page-notice" role="status">{notice}</p>}
      {isDialogOpen && (
        <SearchConsoleSetupDialog
          onClose={() => setIsDialogOpen(false)}
          darkMode={darkMode}
          connection={connection}
          properties={properties}
          propertiesLoading={propertiesLoading}
          propertyLoadError={propertyLoadError}
          onReloadProperties={loadProperties}
          selectedProperty={selectedProperty}
          onPropertyChange={setSelectedProperty}
          onSaveSelectedProperty={saveSelectedProperty}
          onResetSelectedProperty={resetSelectedProperty}
          propertySaving={propertySaving}
          propertyNotice={propertyNotice}
          ownershipMethod={ownershipMethod}
          onOwnershipMethodChange={setOwnershipMethod}
          dnsRecordName={dnsRecordName}
          onDnsRecordNameChange={setDnsRecordName}
          dnsRecordContent={dnsRecordContent}
          onDnsRecordContentChange={setDnsRecordContent}
          htmlVerificationFile={htmlVerificationFile}
          onHtmlVerificationFileChange={selectHtmlVerificationFile}
          metaVerificationCode={metaVerificationCode}
          onMetaVerificationCodeChange={setMetaVerificationCode}
          cloudflareConfig={cloudflareConfig}
          onCloudflareConfigChange={updateCloudflareConfig}
          cloudflareConfigSaving={cloudflareConfigSaving}
          onSaveCloudflareConfig={saveCloudflareConfig}
          cloudflareConfigNotice={cloudflareConfigNotice}
          dnsRecordPublishing={dnsRecordPublishing}
          onPublishDnsRecord={publishDnsVerificationRecord}
          verificationNotice={verificationNotice}
          onVerificationTabOpen={loadCloudflareConfig}
          performanceDates={performanceDates}
          onPerformanceDateChange={updatePerformanceDate}
          performanceDimension={performanceDimension}
          onPerformanceDimensionChange={(dimension) => {
            setPerformanceDimension(dimension);
            setPerformanceData(null);
          }}
          performanceData={performanceData}
          performanceLoading={performanceLoading}
          performanceError={performanceError}
          onLoadPerformance={loadPerformance}
          sitemapUrl={sitemapUrl}
          onSitemapUrlChange={(value) => {
            setSitemapUrl(value);
            setSitemapsNotice("");
          }}
          sitemapData={sitemapData}
          sitemapsLoading={sitemapsLoading}
          sitemapsError={sitemapsError}
          sitemapsNotice={sitemapsNotice}
          onLoadSitemaps={loadSitemaps}
          onSubmitSitemap={submitSitemap}
          sitemapSubmitting={sitemapSubmitting}
          onSitemapsTabOpen={loadSitemaps}
          onConnect={connectGoogle}
          onDisconnect={disconnectGoogle}
          config={config}
          updateConfigValue={updateConfigValue}
          saveGoogleConfig={saveGoogleConfig}
          resetGoogleConfig={resetGoogleConfig}
          importOAuthJson={importOAuthJson}
          savedSecrets={savedSecrets}
          configSaving={configSaving}
          configResetting={configResetting}
          busy={busy}
          notice={notice}
        />
      )}
    </main>
  );
}
