import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/apiBaseUrl";
import Pagination from "../components/Pagination";
import "./SitemapPage.css";

const EMPTY_SITEMAP = { groups: [], totalUrls: 0, generatedAt: "" };

export default function SitemapPage({ darkMode = false }) {
  const [sitemap, setSitemap] = useState(EMPTY_SITEMAP);
  const [error, setError] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [gridColumnCount, setGridColumnCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const entriesGridRef = useRef(null);
  const selectedGroup = sitemap.groups.find(({ id }) => id === selectedGroupId);
  const pageSize = gridColumnCount * 2;
  const pageCount = selectedGroup ? Math.ceil(selectedGroup.entries.length / pageSize) : 0;
  const visibleEntries = selectedGroup
    ? selectedGroup.entries.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : [];

  useEffect(() => {
    let active = true;
    axios.get(`${API_BASE_URL}/sitemap-page-data`)
      .then(({ data }) => {
        if (!Array.isArray(data?.groups) || typeof data?.totalUrls !== "number") {
          throw new Error("Sitemap response was invalid.");
        }
        if (active) setSitemap(data);
      })
      .catch((requestError) => {
        console.error("Unable to load public sitemap", requestError);
        if (active) setError("Unable to load the sitemap right now. Please try again later.");
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    const grid = entriesGridRef.current;
    if (!selectedGroup || !grid) return undefined;

    const updateColumnCount = () => {
      const tracks = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/);
      const count = tracks[0] && tracks[0] !== "none" ? tracks.length : 1;
      setGridColumnCount((current) => (current === count ? current : count));
    };

    updateColumnCount();
    if (typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(updateColumnCount);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [selectedGroup]);

  useEffect(() => {
    if (pageCount > 0 && currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  return (
    <main className="public-sitemap">
      <section className="public-sitemap-hero">
        <span className="public-sitemap-eyebrow">GFXunlimit · Discover</span>
        <h1>Site Map</h1>
        <p>Find your way around GFXunlimit. Explore our pages, creative resources, and latest articles.</p>
        <div className="public-sitemap-stats">
          <span>{sitemap.totalUrls.toLocaleString("en-US")} pages</span>
          <span>Organized by category</span>
        </div>
      </section>

      <section className="public-sitemap-directory" aria-labelledby="public-sitemap-title">
        <div className="public-sitemap-directory-heading">
          <h2 id="public-sitemap-title">Browse all pages</h2>
          <p>Choose a category to see its pages.</p>
        </div>
        {error ? (
          <p className="public-sitemap-error" role="alert">{error}</p>
        ) : sitemap.groups.length ? (
          <>
            {sitemap.groups.map((group) => {
              const isSelected = group.id === selectedGroupId;
              return (
                <button
                  type="button"
                  className="public-sitemap-category"
                  key={group.id}
                  aria-expanded={isSelected}
                  aria-controls="public-sitemap-category-pages"
                  onClick={() => {
                    setCurrentPage(1);
                    setSelectedGroupId((current) => (current === group.id ? "" : group.id));
                  }}
                >
                  <span>{group.title}</span>
                  <span className="public-sitemap-category-count">{group.entries.length} pages</span>
                </button>
              );
            })}
            <section
              id="public-sitemap-category-pages"
              className="public-sitemap-pages"
              aria-label={selectedGroup ? `${selectedGroup.title} page grid` : "Category page grid"}
              hidden={!selectedGroup}
            >
              {selectedGroup && (
                <>
                  <div className="public-sitemap-pages-heading">
                    <h3>{selectedGroup.title}</h3>
                    <span>{selectedGroup.entries.length} pages</span>
                  </div>
                  <ul ref={entriesGridRef}>
                    {visibleEntries.map((entry) => (
                      <li key={entry.href}>
                        <a href={entry.href}>
                          <span>{entry.label}</span>
                          {entry.lastModified && (
                            <time dateTime={entry.lastModified}>{entry.lastModified.slice(0, 10)}</time>
                          )}
                        </a>
                      </li>
                    ))}
                  </ul>
                  {pageCount > 1 && (
                    <Pagination
                      currentPage={currentPage}
                      totalPages={pageCount}
                      totalImages={selectedGroup.entries.length}
                      setCurrentPage={setCurrentPage}
                      darkMode={darkMode}
                      totalLabel="Total Pages"
                      scrollToTop={false}
                    />
                  )}
                </>
              )}
            </section>
          </>
        ) : (
          <p className="public-sitemap-loading" role="status">Loading sitemap pages…</p>
        )}
      </section>

      <div className="public-sitemap-meta">
        <span>{sitemap.generatedAt ? `Sitemap updated ${sitemap.generatedAt.slice(0, 10)}` : "GFXunlimit site directory"}</span>
        <a href="/sitemap.xml">View XML sitemap</a>
      </div>
    </main>
  );
}
