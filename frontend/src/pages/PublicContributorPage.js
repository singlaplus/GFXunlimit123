import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { getAssetPreviewUrl } from "../utils/assetPreview";
import Pagination from "../components/Pagination";
import "./PublicContributorPage.css";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const PAGE_SIZE = 12;

export default function PublicContributorPage({ darkMode, username }) {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("images");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("top");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    axios.get(`${API_BASE_URL}/public-contributors/${encodeURIComponent(username || "")}`)
      .then((response) => { if (mounted) setData(response.data); })
      .catch(() => { if (mounted) setError("Contributor profile not found."); });
    return () => { mounted = false; };
  }, [username]);

  const assets = useMemo(() => {
    const allAssets = Array.isArray(data?.assets) ? data.assets : [];
    const filtered = allAssets.filter((asset) => {
      const isVideo = String(asset.type || "").toLowerCase().includes("video");
      if (activeTab === "videos" && !isVideo) return false;
      if (activeTab === "images" && isVideo) return false;
      const term = search.trim().toLowerCase();
      return !term || String(asset.title || "").toLowerCase().includes(term);
    });
    return [...filtered].sort((first, second) => {
      if (sort === "newest") return new Date(second.created_at || 0) - new Date(first.created_at || 0);
      return Number(second.downloads || 0) - Number(first.downloads || 0);
    });
  }, [activeTab, data, search, sort]);

  const totalPages = Math.max(1, Math.ceil(assets.length / PAGE_SIZE));
  const visibleAssets = assets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const contributor = data?.contributor || {};
  const displayName = contributor.full_name || contributor.username || username || "Contributor";
  const imageCount = (data?.assets || []).filter((asset) => !String(asset.type || "").toLowerCase().includes("video")).length;
  const videoCount = (data?.assets || []).length - imageCount;

  if (error) return <main className={`public-contributor-page ${darkMode ? "is-dark" : ""}`}><div className="public-contributor-error">{error}</div></main>;
  if (!data) return <main className={`public-contributor-page ${darkMode ? "is-dark" : ""}`}><div className="public-contributor-loading">Loading contributor profile...</div></main>;

  return (
    <main className={`public-contributor-page ${darkMode ? "is-dark" : ""}`}>
      <section className="public-contributor-hero">
        <div className="public-contributor-avatar">{displayName.charAt(0).toUpperCase()}</div>
        <div className="public-contributor-identity">
          <div className="public-contributor-title-row"><h1>{displayName}</h1><button type="button" className="public-contributor-share" onClick={() => navigator.clipboard?.writeText(window.location.href)}>♧ Share</button></div>
          <div className="public-contributor-counts"><span><strong>{imageCount}</strong> Images</span><span><strong>{videoCount}</strong> Videos</span></div>
          <div className="public-contributor-badges"><span>★ Contributor</span><span>↥ {data.assets.length} Assets</span></div>
        </div>
      </section>

      <nav className="public-contributor-tabs" aria-label="Contributor profile sections">
        <button className={activeTab === "images" ? "is-active" : ""} type="button" onClick={() => { setActiveTab("images"); setPage(1); }}>▧ Images ({imageCount})</button>
        <button className={activeTab === "videos" ? "is-active" : ""} type="button" onClick={() => { setActiveTab("videos"); setPage(1); }}>▷ Videos ({videoCount})</button>
        <button className={activeTab === "about" ? "is-active" : ""} type="button" onClick={() => { setActiveTab("about"); setPage(1); }}>♙ About</button>
      </nav>

      {activeTab === "about" ? <section className="public-contributor-about"><h2>About {displayName}</h2><p>{displayName} is a contributor on GFXunlimit.</p></section> : <>
        <section className="public-contributor-tools"><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search this contributor" aria-label="Search this contributor" /><label>Sort by <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="top">Top images</option><option value="newest">Newest</option></select></label></section>
        <section className="public-contributor-results"><h2>{activeTab === "videos" ? `Top videos by ${displayName}` : `Top images by ${displayName}`}</h2><p>{assets.length} live assets from {displayName}.</p><div className="public-contributor-grid">{visibleAssets.map((asset) => <article className="public-contributor-asset" key={asset.id}><img src={getAssetPreviewUrl(asset, { quality: 65, watermark: false })} alt={asset.title || "Contributor asset"} /><strong>{asset.title || "Untitled asset"}</strong></article>)}</div>{assets.length === 0 && <p className="public-contributor-empty">No live assets found.</p>}{totalPages > 1 && <Pagination currentPage={page} totalPages={totalPages} totalImages={assets.length} setCurrentPage={setPage} darkMode={darkMode} />}</section>
      </>}
    </main>
  );
}
