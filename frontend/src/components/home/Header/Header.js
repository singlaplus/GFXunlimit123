import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { hasActiveSession } from "../../../utils/authSession";
import "./Header.css";

function Header({
  totalImages,
  heroStats,
  trendingKeywords,
  setSearch,
  setShowJoinModal,
  setJoinModalAccountType,
  setCurrentPage = () => {},
  setSortType = () => {},
  branding,
}) {

  const keywords = Array.isArray(trendingKeywords) ? trendingKeywords : [];
  const heroBannerUrl = branding?.heroBanner
    ? `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}${branding.heroBanner}`
    : null;
  const showHeroAnimation = !heroBannerUrl;
  const heroStyle = heroBannerUrl
    ? {
        background: `url(${heroBannerUrl}) center/cover no-repeat`,
      }
    : {};
  const [searchText, setSearchText] = useState("");
  const navigate = useNavigate();
  const heroCanvasRef = useRef(null);
  const isLoggedIn = hasActiveSession();
  const storedRole = String(
    typeof window !== "undefined" ? localStorage.getItem("userRole") || "" : ""
  ).toLowerCase();
  const isContributorUser = isLoggedIn && storedRole === "contributor";

  const handleSearch = () => {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    
    // Track the search keyword
    axios.post(
      `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/search-keyword`,
      { keyword: trimmed }
    ).catch((err) => console.log("Search tracking error:", err));
    
    setSearch(trimmed);
    if (window.setActivePage) {
      window.setActivePage("explore");
    }
    navigate(`/search?type=${encodeURIComponent(trimmed)}`);
  };

  const handleExplore = () => {
    setSearch("");
    setCurrentPage(1);
    setSortType("newest");
    if (window.setActivePage) {
      window.setActivePage("explore");
    }
    navigate("/explore");
  };

  const handleContributorClick = () => {
    if (setJoinModalAccountType) {
      setJoinModalAccountType("contributor");
    }
    if (setShowJoinModal) {
      setShowJoinModal(true);
    }
  };

  useEffect(() => {
    const canvas = heroCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let animationFrame = null;
    let points = [];
    const resolutionScale = 4;
    const maxLineDistance = 65;
    const minPoints = 120;
    const maxPoints = 220;

    const createPoints = () => {
      points = [];
      const targetCount = Math.floor((width * height) / 9000);
      const count = Math.max(minPoints, Math.min(maxPoints, targetCount));
      for (let i = 0; i < count; i += 1) {
        points.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.11,
          vy: (Math.random() - 0.5) * 0.11,
          r: 1.8 + Math.random() * 1.4,
        });
      }
    };

    let pulsePhase = 0;

    const resizeCanvas = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * resolutionScale);
      canvas.height = Math.floor(height * resolutionScale);
      ctx.setTransform(resolutionScale, 0, 0, resolutionScale, 0, 0);
      createPoints();
    };

    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      const pulse = 0.75 + Math.sin(pulsePhase) * 0.12;
      ctx.fillStyle = `rgba(255,255,255,${0.16 * pulse})`;
      ctx.lineWidth = 1;

      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        point.x += point.vx;
        point.y += point.vy;

        if (point.x < 0 || point.x > width) point.vx *= -1;
        if (point.y < 0 || point.y > height) point.vy *= -1;
      }

      for (let i = 0; i < points.length; i += 1) {
        const p1 = points[i];
        let connections = 0;
        for (let j = i + 1; j < points.length; j += 1) {
          const p2 = points[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > maxLineDistance * maxLineDistance) continue;
          const baseAlpha = 0.5 - distSq / (maxLineDistance * maxLineDistance * 0.9);
          if (baseAlpha <= 0) continue;
          const alpha = Math.max(0.1, baseAlpha * 0.48 * pulse);
          ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          connections += 1;
          if (connections >= 4) break;
        }
      }

      points.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.r, 0, Math.PI * 2);
        ctx.fill();
      });

      pulsePhase += 0.009;
      animationFrame = requestAnimationFrame(animate);
    };

    resizeCanvas();
    animationFrame = requestAnimationFrame(animate);
    window.addEventListener("resize", resizeCanvas);

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  return (
    <section className="hero" style={heroStyle}>

      {showHeroAnimation && (
        <div className="hero-network" aria-hidden="true">
          <canvas ref={heroCanvasRef} className="hero-network-canvas" />
          <div className="hero-network-fog" />
        </div>
      )}

      <div className="hero-content">

        <div className="hero-badge">
            {branding?.heroBadge || "✨ World's Next Creative Marketplace"}
          </div>

          <h1>
            {branding?.heroHeadingLine1 || "Discover Millions of"}
            <br />
            {branding?.heroHeadingLine2 || "Creative Stock Assets"}
          </h1>

          <p>
            {(() => {
              const raw = branding?.heroParagraph || `Browse {totalImages}+ royalty-free photos, vectors, illustrations, PSD files, templates and creative assets from creators around the world.`;
              return raw.replace("{totalImages}", Number(totalImages).toLocaleString());
            })()}
          </p>

        <div className="hero-search">

          <input
            value={searchText}
            placeholder="Search photos, vectors, illustrations, PSD, templates..."
            onChange={(e) =>
              setSearchText(e.target.value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSearch();
              }
            }}
          />

          <button
            onClick={handleSearch}
          >
            🔍 Search
          </button>

        </div>

        {keywords.length > 0 && (

          <div className="hero-tags">

            <span className="tag-title">
              Trending
            </span>

            {keywords.map((item) => (

              <button
                key={item.keyword}
                className="hero-tag"
                onClick={() => {
                  // Track the search keyword
                  axios.post(
                    `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/search-keyword`,
                    { keyword: item.keyword }
                  ).catch((err) => console.log("Search tracking error:", err));
                  
                  setSearch(item.keyword);
                  if (window.setActivePage) {
                    window.setActivePage("explore");
                  }
                  navigate(`/search?type=${encodeURIComponent(item.keyword)}`);
                }}
              >
                {item.keyword}
              </button>

            ))}

          </div>

        )}

        <div className="hero-actions">

          {!isContributorUser && (
            <button
              className="primary-btn"
              onClick={handleExplore}
            >
              Explore Assets
            </button>
          )}

          {!isLoggedIn && (
            <button className="secondary-btn" onClick={handleContributorClick}>
              Become a Contributor
            </button>
          )}

        </div>

        <div className="hero-stats">

  <div>
    <h2>
      {heroStats?.totalAssets?.toLocaleString() || 0}
    </h2>
    <span>Total Assets</span>
  </div>

  <div>
    <h2>
      {heroStats?.totalSearches?.toLocaleString() || 0}
    </h2>
    <span>Total Searches</span>
  </div>

  <div>
    <h2>
      {heroStats?.totalDownloads?.toLocaleString() || 0}
    </h2>
    <span>Total Downloads</span>
  </div>

  <div>
    <h2>
      {heroStats?.todayVisitors?.toLocaleString() || 0}
    </h2>
    <span>Today's Visitors</span>
  </div>

</div>

      </div>

    </section>
  );
}

export default Header;