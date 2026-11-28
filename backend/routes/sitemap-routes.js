const express = require("express");
const path = require("node:path");
const fs = require("node:fs/promises");
const { SaxesParser } = require("saxes");
const { SitemapGenerationError } = require("../services/sitemapGenerator");

const SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9";
const SITEMAP_PAGE_GROUPS = [
  { id: "main", title: "Main pages" },
  { id: "browse", title: "Explore and browse" },
  { id: "blog", title: "Blog" },
  { id: "assets", title: "Creative assets" },
  { id: "contributors", title: "Contributors" },
  { id: "other", title: "Other pages" },
];
const READABLE_SITEMAP_GROUPS = SITEMAP_PAGE_GROUPS.filter(({ id }) => id !== "contributors");

function acceptsHtmlDocument(req) {
  return (req.get("accept") || "")
    .split(",")
    .some((mediaType) => mediaType.split(";")[0].trim().toLowerCase() === "text/html");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function readSitemapEntries(filePath) {
  const xml = await fs.readFile(filePath, "utf8");
  const parser = new SaxesParser({ xmlns: true });
  const entries = [];
  let rootName = "";
  let currentEntry = null;
  let currentField = "";
  let fieldValue = "";
  let parseError = null;

  parser.on("error", (error) => {
    parseError = error;
  });
  parser.on("opentag", (tag) => {
    if (!rootName) {
      rootName = tag.local;
      if (tag.uri !== SITEMAP_NAMESPACE || !["urlset", "sitemapindex"].includes(tag.local)) {
        parseError = new Error("Published sitemap has an invalid root element.");
      }
      return;
    }
    if (
      tag.uri === SITEMAP_NAMESPACE
      && ((rootName === "urlset" && tag.local === "url")
        || (rootName === "sitemapindex" && tag.local === "sitemap"))
    ) {
      currentEntry = {};
    } else if (currentEntry && tag.uri === SITEMAP_NAMESPACE && ["loc", "lastmod"].includes(tag.local)) {
      currentField = tag.local;
      fieldValue = "";
    }
  });
  parser.on("text", (text) => {
    if (currentField) fieldValue += text;
  });
  parser.on("closetag", (tag) => {
    if (tag.uri === SITEMAP_NAMESPACE && currentField === tag.local) {
      currentEntry[currentField] = fieldValue.trim();
      currentField = "";
      fieldValue = "";
    }
    if (
      currentEntry
      && tag.uri === SITEMAP_NAMESPACE
      && ((rootName === "urlset" && tag.local === "url")
        || (rootName === "sitemapindex" && tag.local === "sitemap"))
    ) {
      entries.push(currentEntry);
      currentEntry = null;
    }
  });
  parser.write(xml).close();
  if (parseError) throw parseError;
  return { rootName, entries };
}

function categorizeSitemapEntry(entry, siteOrigin) {
  let url;
  try {
    url = new URL(entry.loc);
  } catch {
    throw new Error("Published sitemap contains an invalid URL.");
  }
  if (url.protocol !== "https:" || url.origin !== siteOrigin) {
    throw new Error("Published sitemap contains a URL outside the configured website.");
  }

  const pathname = url.pathname;
  const topLevel = pathname.split("/")[1] || "";
  let groupId = "other";
  if (["", "about", "pricing", "careers", "contact"].includes(topLevel)) {
    groupId = "main";
  } else if (/^(explore|photos|vectors|psd|psds|videos|templates)$/.test(topLevel)) {
    groupId = "browse";
  } else if (topLevel === "blog") {
    groupId = "blog";
  } else if (topLevel === "asset") {
    groupId = "assets";
  } else if (topLevel === "c") {
    groupId = "contributors";
  }

  const knownLabels = {
    "": "Home",
    about: "About us",
    pricing: "Pricing",
    careers: "Careers",
    contact: "Contact",
    explore: "Explore",
    photos: "Photos",
    vectors: "Vectors",
    psd: "PSD",
    psds: "PSD files",
    videos: "Videos",
    templates: "Templates",
    blog: "Blog",
  };
  let label = knownLabels[topLevel];
  if (topLevel === "blog") {
    const blogSlug = pathname.split("/").filter(Boolean).at(-1);
    if (blogSlug && blogSlug !== "blog") {
      label = blogSlug.replace(/_\d+$/, "").replace(/[-_]+/g, " ");
    }
  } else if (topLevel === "asset") {
    label = `Asset ${pathname.split("/")[2] || ""}`.trim();
  } else if (topLevel === "c") {
    label = `Contributor ${pathname.split("/")[2] || ""}`.trim();
  } else if (!label) {
    label = pathname.split("/").filter(Boolean).map((part) => {
      try {
        return decodeURIComponent(part).replace(/[-_]+/g, " ");
      } catch {
        return part.replace(/[-_]+/g, " ");
      }
    }).join(" / ");
  }
  label = label.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return {
    groupId,
    href: url.href,
    label,
    lastModified: entry.lastmod || "",
  };
}

function getSitemapEntityId(entry, groupId) {
  const pathname = new URL(entry.href).pathname;
  return groupId === "blog"
    ? pathname.match(/_(\d+)$/)?.[1]
    : pathname.match(/\/(\d+)$/)?.[1];
}

async function applyDatabaseTitles(entries, groupId, pool, query) {
  const matchingEntries = entries
    .filter((entry) => entry.groupId === groupId)
    .map((entry) => ({ entry, id: getSitemapEntityId(entry, groupId) }))
    .filter(({ id }) => id);
  const ids = [...new Set(matchingEntries.map(({ id }) => id))];
  if (!ids.length) return;
  if (!pool) throw new Error(`Titles cannot be loaded for ${groupId} sitemap entries without a database connection.`);

  const result = await pool.query(query, [ids]);
  const titlesById = new Map(result.rows.map((row) => [String(row.id), String(row.title || "").trim()]));
  matchingEntries.forEach(({ entry, id }) => {
    const title = titlesById.get(id);
    if (title) entry.label = title;
  });
}

function renderSitemapPage(groups, totalUrls, generatedAt) {
  const groupMarkup = READABLE_SITEMAP_GROUPS
    .map((group) => {
      const entries = groups.get(group.id) || [];
      if (!entries.length) return "";
      const links = entries
        .map((entry) => `<li><a href="${escapeHtml(entry.href)}">${escapeHtml(entry.label)}</a>${entry.lastModified ? `<time datetime="${escapeHtml(entry.lastModified)}">${escapeHtml(entry.lastModified.slice(0, 10))}</time>` : ""}</li>`)
        .join("");
      return `<details class="sitemap-category"><summary><span>${escapeHtml(group.title)}</span><span class="category-count">${entries.length} pages</span></summary><ul>${links}</ul></details>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Browse pages, creative assets, and resources across GFXunlimit.">
  <title>Site Map | GFXunlimit</title>
  <style>
    :root{color-scheme:light;--ink:#141b2d;--muted:#64748b;--line:#e2e8f0;--blue:#2459d3;--soft:#f6f8fc;--white:#fff}
    *{box-sizing:border-box}
    body{margin:0;background:#f4f6fb;color:var(--ink);font:16px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    a{color:inherit;text-decoration:none}
    a:hover{color:var(--blue);text-decoration:underline}
    .site-header{position:sticky;top:0;z-index:10;height:76px;display:flex;align-items:center;justify-content:space-between;gap:32px;padding:0 max(24px,calc((100vw - 1200px)/2));background:rgba(255,255,255,.94);border-bottom:1px solid var(--line);box-shadow:0 8px 30px rgba(15,23,42,.06);backdrop-filter:blur(16px)}
    .brand{flex:none;font-size:22px;font-weight:900;letter-spacing:-.065em}.brand span{color:var(--blue)}
    .header-nav{display:flex;align-items:center;gap:30px}
    .header-nav a,.header-link{color:#334155;font-size:14px;font-weight:650;transition:color .18s ease}
    .header-nav a:hover,.header-link:hover{color:var(--blue)}
    .header-link{padding:10px 16px;border:1px solid #dbe5f6;border-radius:999px;background:#fff}
    main{width:min(100% - 32px,960px);margin:48px auto 72px}
    .hero{padding:42px 44px;border:1px solid var(--line);border-radius:22px;background:linear-gradient(120deg,#fff 25%,#edf3ff);box-shadow:0 12px 32px #1e293b0a}
    .eyebrow{color:var(--blue);font-size:12px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}
    h1{margin:9px 0 8px;font-size:clamp(34px,6vw,52px);line-height:1.05;letter-spacing:-.055em}
    .intro{max-width:620px;margin:0;color:var(--muted);font-size:16px}
    .stats{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
    .stat{padding:8px 13px;border:1px solid #dbe5f6;border-radius:999px;background:#fff;color:#294879;font-size:13px;font-weight:700}
    .directory{margin-top:24px;padding:12px 28px;border:1px solid var(--line);border-radius:20px;background:#fff;box-shadow:0 16px 40px #1e293b0a}
    .directory-heading{padding:16px 0 12px}.directory-heading h2{margin:0;font-size:20px;letter-spacing:-.025em}.directory-heading p{margin:4px 0 0;color:var(--muted);font-size:13px}
    .sitemap-category{border-top:1px solid var(--line)}
    .sitemap-category summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 2px;cursor:pointer;list-style:none;font-size:18px;font-weight:750}
    .sitemap-category summary::-webkit-details-marker{display:none}
    .sitemap-category summary:after{content:"+";order:2;color:var(--blue);font-size:25px;font-weight:400;line-height:1}
    .sitemap-category[open] summary:after{content:"−"}
    .category-count{margin-left:auto;color:var(--muted);font-size:12px;font-weight:600}
    .sitemap-category ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 28px;margin:0;padding:0 4px 18px;list-style:none}
    .sitemap-category li{display:flex;justify-content:space-between;gap:14px;padding:11px 0;border-top:1px solid #f0f2f6;font-size:14px}
    .sitemap-category li a{overflow-wrap:anywhere}
    time{flex:none;color:#94a3b8;font-size:11px}
    .directory-footer{display:flex;justify-content:space-between;gap:16px;padding:20px 4px;color:var(--muted);font-size:12px}
    .directory-footer a{color:var(--blue);font-weight:650}
    .site-footer{padding:42px max(24px,calc((100vw - 1200px)/2)) 24px;background:#0f1724;color:#e6eef8}
    .footer-grid{display:grid;grid-template-columns:1.5fr repeat(4,minmax(0,1fr));gap:32px}
    .footer-grid h2,.footer-grid h3{margin:0 0 12px;color:#fff;font-size:14px;font-weight:750}
    .footer-about p{max-width:260px;margin:0;color:#cbd5e1;font-size:13px;line-height:1.75}
    .footer-links{display:grid;gap:10px;margin:0;padding:0;list-style:none}
    .footer-links a,.footer-socials a{color:#cfe8ff;font-size:13px;text-decoration:none}
    .footer-links a:hover,.footer-socials a:hover{color:#fff;text-decoration:underline}
    .footer-bottom{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,.08);color:#cbd5e1;font-size:12px}
    .footer-socials{display:flex;flex-wrap:wrap;gap:18px}
    @media(max-width:760px){.footer-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}.footer-about{grid-column:1/-1}}
    @media(max-width:640px){.site-header{height:64px;gap:14px;padding:0 16px}.brand{font-size:20px}.header-nav{gap:14px}.header-nav a{font-size:12px}.header-nav a:nth-child(n+3){display:none}.header-link{padding:8px 11px;font-size:12px}main{width:min(100% - 20px,960px);margin:24px auto 44px}.hero{padding:30px 24px}.directory{padding:8px 18px}.sitemap-category summary{font-size:16px}.sitemap-category ul{grid-template-columns:1fr}.directory-footer{flex-direction:column}.site-footer{padding:30px 18px 22px}.footer-grid{gap:24px 18px}.footer-bottom{align-items:flex-start;flex-direction:column;gap:14px}}
    @media(max-width:380px){.header-nav{display:none}.header-link{margin-left:auto}}
  </style>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/" aria-label="GFXunlimit home">GFX<span>unlimit</span></a>
    <nav class="header-nav" aria-label="Main navigation">
      <a href="/explore">Explore</a>
      <a href="/blog">Blog</a>
      <a href="/pricing">Pricing</a>
      <a href="/contact">Contact</a>
    </nav>
    <a class="header-link" href="/">Back to home</a>
  </header>
  <main>
    <section class="hero"><span class="eyebrow">GFXunlimit · Discover</span><h1>Site Map</h1><p class="intro">Find your way around GFXunlimit. Explore our pages, creative resources, and latest articles.</p><div class="stats"><span class="stat">${totalUrls.toLocaleString("en-US")} pages</span><span class="stat">Organized by category</span></div></section>
    <section class="directory" aria-labelledby="directory-title"><div class="directory-heading"><h2 id="directory-title">Browse all pages</h2><p>Choose a category to see its pages.</p></div>${groupMarkup}</section>
    <div class="directory-footer"><span>${generatedAt ? `Sitemap updated ${escapeHtml(generatedAt.slice(0, 10))}` : "GFXunlimit site directory"}</span><a href="/sitemap.xml">View XML sitemap</a></div>
  </main>
  <footer class="site-footer">
    <div class="footer-grid">
      <section class="footer-about">
        <h2>About</h2>
        <p>We provide high-quality stock images for creators, designers and teams.</p>
      </section>
      <nav aria-label="Company">
        <h3>Company</h3>
        <ul class="footer-links">
          <li><a href="/about">About Us</a></li>
          <li><a href="/pricing">Pricing</a></li>
          <li><a href="/careers">Careers</a></li>
          <li><a href="/contact">Contact</a></li>
        </ul>
      </nav>
      <nav aria-label="Legal">
        <h3>Legal</h3>
        <ul class="footer-links">
          <li><a href="/privacy-policy">Privacy Policy</a></li>
          <li><a href="/terms-and-conditions">Terms &amp; Conditions</a></li>
          <li><a href="/cookie-policy">Cookie Policy</a></li>
        </ul>
      </nav>
      <nav aria-label="For You">
        <h3>For You</h3>
        <ul class="footer-links">
          <li><a href="/help-center">Help Center</a></li>
        </ul>
      </nav>
      <nav aria-label="Resources">
        <h3>Resources</h3>
        <ul class="footer-links">
          <li><a href="/blog">Blog</a></li>
          <li><a href="/developers">Developers</a></li>
          <li><a href="/partners">Partners</a></li>
          <li><a href="/sitemap">Sitemap</a></li>
        </ul>
      </nav>
    </div>
    <div class="footer-bottom">
      <span>© ${new Date().getFullYear()} Stock Photo Website. All rights reserved.</span>
      <nav class="footer-socials" aria-label="Social media">
        <a href="https://twitter.com">Twitter</a>
        <a href="https://instagram.com/gfxunlimit">Instagram</a>
        <a href="https://facebook.com/gfxunlimit">Facebook</a>
      </nav>
    </div>
  </footer>
</body>
</html>`;
}

async function getSitemapPageData(generator, pool) {
  const published = await generator.getPublished();
  if (!published) return null;

  const sitemapFiles = [published.primaryPath];
  if (published.rootElement === "sitemapindex") {
    for (const filename of published.childFilenames || []) {
      const filePath = await generator.getArchiveFile(published.archiveId, filename);
      if (!filePath) throw new Error("A published sitemap child file is unavailable.");
      sitemapFiles.push(filePath);
    }
  }

  const entries = [];
  for (const filePath of sitemapFiles) {
    const parsed = await readSitemapEntries(filePath);
    if (parsed.rootName !== "urlset") throw new Error("Published sitemap index did not resolve to URL entries.");
    entries.push(...parsed.entries.map((entry) => categorizeSitemapEntry(entry, published.siteOrigin)));
  }
  await Promise.all([
    applyDatabaseTitles(
      entries,
      "blog",
      pool,
      "SELECT id, title FROM blog_drafts WHERE status = 'published' AND id = ANY($1::bigint[])"
    ),
    applyDatabaseTitles(
      entries,
      "assets",
      pool,
      "SELECT id, title FROM images WHERE LOWER(COALESCE(status, '')) = 'approved' AND id = ANY($1::bigint[])"
    ),
  ]);
  entries.sort((a, b) => a.label.localeCompare(b.label));
  const groups = new Map(SITEMAP_PAGE_GROUPS.map(({ id }) => [id, []]));
  entries.forEach((entry) => groups.get(entry.groupId).push(entry));

  return {
    published,
    entries,
    groups,
    data: {
      groups: READABLE_SITEMAP_GROUPS
        .map((group) => ({ ...group, entries: groups.get(group.id) }))
        .filter((group) => group.entries.length > 0),
      totalUrls: entries.length,
      generatedAt: published.generatedAt,
    },
  };
}

function createSitemapRouter({ generator, schedule, verifyAdmin, pool }) {
  const router = express.Router();

  router.get("/admin/sitemap-schedule", verifyAdmin, (req, res) => {
    try {
      return res.json(schedule.getSettings());
    } catch (error) {
      console.error("Unable to load sitemap schedule", error);
      return res.status(500).json({ error: "Unable to load sitemap schedule." });
    }
  });

  router.put("/admin/sitemap-schedule", verifyAdmin, (req, res) => {
    try {
      return res.json(schedule.save(req.body));
    } catch (error) {
      if (error instanceof TypeError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("Unable to save sitemap schedule", error);
      return res.status(500).json({ error: "Unable to save sitemap schedule." });
    }
  });

  router.post("/admin/sitemap/generation", verifyAdmin, (req, res) => {
    try {
      return res.status(202).json({ job: generator.start() });
    } catch (error) {
      if (error instanceof SitemapGenerationError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error("Unable to start sitemap generation", error);
      return res.status(500).json({ error: "Unable to start sitemap generation." });
    }
  });

  router.get("/admin/sitemap/generation", verifyAdmin, async (req, res) => {
    try {
      return res.json({ job: await generator.getCurrent() });
    } catch (error) {
      console.error("Unable to load sitemap generation status", error);
      return res.status(500).json({ error: "Unable to load sitemap generation status." });
    }
  });

  router.get("/admin/sitemap/generation/:jobId", verifyAdmin, (req, res) => {
    const job = generator.getStatus(req.params.jobId);
    return job
      ? res.json({ job })
      : res.status(404).json({ error: "Sitemap generation job not found." });
  });

  const downloadLatest = async (req, res, jobId) => {
    try {
      const filePath = await generator.getDownloadPath(jobId);
      if (!filePath) {
        return res.status(404).json({
          error: jobId ? "Completed sitemap not found." : "No sitemap has been generated yet.",
        });
      }
      res.type("application/xml");
      res.set("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
      return res.sendFile(filePath, (error) => {
        if (error && !res.headersSent) {
          console.error("Unable to download the generated sitemap", error);
          res.status(500).json({ error: "Unable to download the generated sitemap." });
        }
      });
    } catch (error) {
      console.error("Unable to download the generated sitemap", error);
      return res.status(500).json({ error: "Unable to download the generated sitemap." });
    }
  };

  router.get("/admin/sitemap/download", verifyAdmin, (req, res) => downloadLatest(req, res));
  router.get("/admin/sitemap/download/:jobId", verifyAdmin, (req, res) => downloadLatest(req, res, req.params.jobId));

  router.get("/sitemap.xml", async (req, res) => {
    try {
      const published = await generator.getPublished();
      if (!published) {
        return res.status(404).type("text/plain").send("A sitemap has not been generated yet.");
      }
      res.type("application/xml");
      res.set("Cache-Control", "public, max-age=300");
      return res.sendFile(published.primaryPath, (error) => {
        if (error && !res.headersSent) {
          console.error("Unable to serve the published sitemap", error);
          res.status(404).type("text/plain").send("The published sitemap is unavailable.");
        }
      });
    } catch (error) {
      console.error("Unable to serve the published sitemap", error);
      return res.status(500).type("text/plain").send("Unable to serve the published sitemap.");
    }
  });

  router.get("/sitemap-page-data", async (_req, res) => {
    try {
      const sitemap = await getSitemapPageData(generator, pool);
      if (!sitemap) return res.status(404).json({ error: "A sitemap has not been generated yet." });
      return res.set("Cache-Control", "public, max-age=300").json(sitemap.data);
    } catch (error) {
      console.error("Unable to load public sitemap data", error);
      return res.status(500).json({ error: "Unable to load the public sitemap." });
    }
  });

  router.get(["/sitemap", "/sitemap/"], async (req, res, next) => {
    if (process.env.NODE_ENV === "production" && acceptsHtmlDocument(req)) {
      return next();
    }
    try {
      const sitemap = await getSitemapPageData(generator, pool);
      if (!sitemap) return res.status(404).type("text/plain").send("A sitemap has not been generated yet.");

      res.type("html");
      res.set("Cache-Control", "public, max-age=300");
      return res.send(renderSitemapPage(sitemap.groups, sitemap.entries.length, sitemap.published.generatedAt));
    } catch (error) {
      console.error("Unable to render the public sitemap page", error);
      return res.status(500).type("text/plain").send("Unable to display the site map.");
    }
  });

  router.get("/sitemap.xsl", (_req, res) => {
    res.type("application/xslt+xml");
    res.set("Cache-Control", "public, max-age=3600");
    return res.sendFile(path.join(__dirname, "..", "views", "sitemap.xsl"), (error) => {
      if (error && !res.headersSent) {
        console.error("Unable to serve the sitemap stylesheet", error);
        res.status(500).type("text/plain").send("Unable to display the sitemap.");
      }
    });
  });

  router.get("/sitemap-archive/:archiveId/:filename", async (req, res) => {
    try {
      const filePath = await generator.getArchiveFile(req.params.archiveId, req.params.filename);
      if (!filePath) return res.status(404).type("text/plain").send("Sitemap file not found.");
      res.type("application/xml");
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      return res.sendFile(filePath, (error) => {
        if (error && !res.headersSent) {
          console.error("Unable to serve an archived sitemap", error);
          res.status(404).type("text/plain").send("Sitemap file not found.");
        }
      });
    } catch (error) {
      console.error("Unable to serve an archived sitemap", error);
      return res.status(500).type("text/plain").send("Unable to serve the sitemap file.");
    }
  });

  return router;
}

module.exports = { createSitemapRouter, categorizeSitemapEntry, readSitemapEntries, renderSitemapPage };
