<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
  exclude-result-prefixes="sitemap">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>GFXunlimit Sitemap</title>
        <style>
          :root { color-scheme: light; --ink: #172033; --muted: #64748b; --line: #e2e8f0; --blue: #2563eb; --surface: #ffffff; --soft: #f4f7fb; }
          * { box-sizing: border-box; }
          body { margin: 0; background: #f1f5f9; color: var(--ink); font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          main { width: min(100% - 32px, 1040px); margin: 54px auto; }
          header { padding: 34px 38px; border: 1px solid var(--line); border-radius: 20px 20px 0 0; background: linear-gradient(120deg, #fff 20%, #eff6ff); }
          .eyebrow { color: var(--blue); font-size: 12px; font-weight: 800; letter-spacing: .14em; }
          h1 { margin: 8px 0 4px; font-size: clamp(26px, 5vw, 38px); letter-spacing: -.04em; }
          header p { margin: 0; color: var(--muted); }
          .summary { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; }
          .pill { padding: 8px 12px; border: 1px solid #dbeafe; border-radius: 999px; background: #fff; color: #1e40af; font-size: 13px; font-weight: 700; }
          section { overflow: hidden; border: 1px solid var(--line); border-top: 0; border-radius: 0 0 20px 20px; background: var(--surface); box-shadow: 0 20px 50px #0f172a12; }
          .section-heading { padding: 22px 28px 12px; }
          h2 { margin: 0; font-size: 18px; }
          .section-heading p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
          .table-wrap { overflow-x: auto; padding: 0 20px 20px; }
          table { width: 100%; border-collapse: collapse; text-align: left; }
          th { padding: 12px 14px; background: var(--soft); color: var(--muted); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
          td { padding: 15px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
          tr:last-child td { border-bottom: 0; }
          td:first-child { width: 72%; overflow-wrap: anywhere; }
          a { color: #1d4ed8; font-weight: 650; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .date { color: var(--muted); white-space: nowrap; }
          footer { padding: 0 28px 22px; color: var(--muted); font-size: 12px; }
          @media (max-width: 600px) {
            main { width: min(100% - 20px, 1040px); margin: 20px auto; }
            header { padding: 25px 22px; }
            .section-heading { padding: 20px 20px 12px; }
            .table-wrap { padding: 0 12px 12px; }
            th, td { padding: 11px 10px; }
            td:first-child { min-width: 230px; }
          }
        </style>
      </head>
      <body>
        <main>
          <header>
            <span class="eyebrow">GFXUNLIMIT · SEARCH DISCOVERY</span>
            <h1>XML Sitemap</h1>
            <p>This file helps search engines discover and crawl pages on GFXunlimit.</p>
            <div class="summary">
              <span class="pill">
                <xsl:choose>
                  <xsl:when test="sitemap:urlset">
                    <xsl:value-of select="count(sitemap:urlset/sitemap:url)"/> URLs
                  </xsl:when>
                  <xsl:otherwise>
                    <xsl:value-of select="count(sitemap:sitemapindex/sitemap:sitemap)"/> sitemaps
                  </xsl:otherwise>
                </xsl:choose>
              </span>
              <span class="pill">XML format</span>
            </div>
          </header>
          <section>
            <div class="section-heading">
              <h2>
                <xsl:choose>
                  <xsl:when test="sitemap:urlset">Pages included</xsl:when>
                  <xsl:otherwise>Sitemap files</xsl:otherwise>
                </xsl:choose>
              </h2>
              <p>The underlying sitemap remains standard XML for search engines.</p>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Page URL</th>
                    <th>Last updated</th>
                  </tr>
                </thead>
                <tbody>
                  <xsl:for-each select="sitemap:urlset/sitemap:url | sitemap:sitemapindex/sitemap:sitemap">
                    <tr>
                      <td>
                        <a>
                          <xsl:attribute name="href"><xsl:value-of select="sitemap:loc"/></xsl:attribute>
                          <xsl:value-of select="sitemap:loc"/>
                        </a>
                      </td>
                      <td class="date"><xsl:value-of select="sitemap:lastmod"/></td>
                    </tr>
                  </xsl:for-each>
                </tbody>
              </table>
            </div>
            <footer>Generated for search engines. This styled view does not change the sitemap data.</footer>
          </section>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
