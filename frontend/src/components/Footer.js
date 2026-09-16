import { useEffect, useState } from "react";
import "./Footer.css";

const FOOTER_LINKS = {
  company: [
    { label: "About Us", href: "/about" },
    { label: "Pricing", href: "/pricing" },
    { label: "Careers", href: "/careers" },
    { label: "Contact", href: "/contact" }
  ],
  legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms & Conditions", href: "/terms" },
    { label: "Cookie Policy", href: "/cookies" }
  ],
  resources: [
    { label: "Blog", href: "/blog" },
    { label: "Developers", href: "/developers" },
    { label: "Partners", href: "/partners" }
  ]
};

const FOOTER_LINK_LABELS = {
  twitter: "Twitter",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  pinterest: "Pinterest",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  reddit: "Reddit",
  telegram: "Telegram",
  discord: "Discord",
  github: "GitHub",
  dribbble: "Dribbble",
  behance: "Behance",
  medium: "Medium",
  mastodon: "Mastodon",
  x: "X"
};

const DEFAULT_SOCIAL_LINKS = [
  { platform: "instagram", url: "https://instagram.com/" },
  { platform: "facebook", url: "https://facebook.com/" },
  { platform: "twitter", url: "https://x.com/" }
];

const getIndianYear = () => {
  const now = new Date();
  const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return istTime.getFullYear();
};

const buildLinksHtml = (links) => links
  .map((link) => `<a href="${link.href}" style="color:#cfe8ff;text-decoration:none;font-size:14px;display:block;margin-bottom:8px;">${link.label}</a>`)
  .join("");

export function getFooterHtml() {
  const year = getIndianYear();
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1724;color:#e6eef8;font-family:Arial,sans-serif;">
      <tr>
        <td style="padding:32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:700px;margin:0 auto;">
            <tr>
              <td style="padding-bottom:24px;">
                <h3 style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.02em;">Stock Photo Website</h3>
                <p style="margin:10px 0 0;color:#cbd5e1;font-size:14px;line-height:1.7;max-width:520px;">Premium stock imagery for creators, designers and teams — delivered with a polished, elegant layout.</p>
              </td>
            </tr>
            <tr>
              <td>
                <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.8;color:#cfe8ff;">
                  <tr>
                    <td valign="top" style="padding-right:16px;vertical-align:top;min-width:140px;">
                      <strong style="display:block;margin-bottom:8px;color:#ffffff;">Company</strong>
                      ${buildLinksHtml(FOOTER_LINKS.company)}
                    </td>
                    <td valign="top" style="padding-right:16px;vertical-align:top;min-width:140px;">
                      <strong style="display:block;margin-bottom:8px;color:#ffffff;">Legal</strong>
                      ${buildLinksHtml(FOOTER_LINKS.legal)}
                    </td>
                    <td valign="top" style="vertical-align:top;min-width:140px;">
                      <strong style="display:block;margin-bottom:8px;color:#ffffff;">Resources</strong>
                      ${buildLinksHtml(FOOTER_LINKS.resources)}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid rgba(255,255,255,0.08);padding-top:18px;font-size:13px;color:#a9b4d0;">
                © ${year} Stock Photo Website. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function Footer({ onOpenLogin, onOpenJoin, isLoggedIn = false }) {
  const SOCIAL_LINKS_STORAGE_KEY = "footer-social-links";
  const SOCIAL_LINKS_EVENT = "footer-social-links-changed";

  const normalizeSocialUrl = (url) => {
    if (typeof url !== "string") return "";
    const trimmed = url.trim();
    if (!trimmed) return "";
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  };

  const getStoredSocialLinks = () => {
    const fallback = DEFAULT_SOCIAL_LINKS.map((link) => ({ ...link }));
    if (typeof window === "undefined") return fallback;
    try {
      const stored = localStorage.getItem(SOCIAL_LINKS_STORAGE_KEY);
      if (!stored) return fallback;
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return fallback;

      const normalized = parsed
        .map((item) => ({
          platform: item?.platform || "",
          url: normalizeSocialUrl(item?.url)
        }))
        .filter((item) => item.platform && item.url);

      return normalized.length > 0 ? normalized : fallback;
    } catch (err) {
      console.error("Failed to load footer social links", err);
      return fallback;
    }
  };

  const getIndianYear = () => {
    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    return istTime.getFullYear();
  };

  const [socialLinks, setSocialLinks] = useState(getStoredSocialLinks);
  const currentYear = getIndianYear();

  useEffect(() => {
    const updateSocialLinks = () => setSocialLinks(getStoredSocialLinks());
    updateSocialLinks();
    window.addEventListener(SOCIAL_LINKS_EVENT, updateSocialLinks);
    return () => window.removeEventListener(SOCIAL_LINKS_EVENT, updateSocialLinks);
  }, []);

  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div>
          <h4 style={{ margin: "0 0 8px 0" }}>About</h4>
          <p style={{ margin: 0, opacity: 0.9 }}>We provide high-quality stock images for creators, designers and teams.</p>
        </div>

        <div>
          <h4 style={{ margin: "0 0 8px 0" }}>Company</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            <li><a href="/about" style={{ color: "#cfe8ff" }}>About Us</a></li>
            <li><a href="/pricing" style={{ color: "#cfe8ff" }}>Pricing</a></li>
            <li><a href="/careers" style={{ color: "#cfe8ff" }}>Careers</a></li>
            <li><a href="/contact" style={{ color: "#cfe8ff" }}>Contact</a></li>
          </ul>
        </div>

        <div>
          <h4 style={{ margin: "0 0 8px 0" }}>Legal</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            <li><a href="/privacy" style={{ color: "#cfe8ff" }}>Privacy Policy</a></li>
            <li><a href="/terms" style={{ color: "#cfe8ff" }}>Terms & Conditions</a></li>
            <li><a href="/cookies" style={{ color: "#cfe8ff" }}>Cookie Policy</a></li>
          </ul>
        </div>

        <div>
          <h4 style={{ margin: "0 0 8px 0" }}>For You</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {!isLoggedIn && (
              <>
                <li>
                  <button
                    type="button"
                    onClick={onOpenLogin}
                    style={{
                      color: "#cfe8ff",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textDecoration: "underline"
                    }}
                  >
                    Login
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => onOpenJoin("contributor")}
                    style={{
                      color: "#cfe8ff",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textDecoration: "underline"
                    }}
                  >
                    Become a Contributor
                  </button>
                </li>
              </>
            )}
            <li><a href="/help" style={{ color: "#cfe8ff" }}>Help Center</a></li>
          </ul>
        </div>

        <div>
          <h4 style={{ margin: "0 0 8px 0" }}>Resources</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            <li><a href="/blog" style={{ color: "#cfe8ff" }}>Blog</a></li>
            <li><a href="/developers" style={{ color: "#cfe8ff" }}>Developers</a></li>
            <li><a href="/partners" style={{ color: "#cfe8ff" }}>Partners</a></li>
          </ul>
        </div>
      </div>

      <div className="site-footer-bottom">
        <div className="site-footer-bottom-row">
          <div style={{ opacity: 0.9 }}>© {currentYear} Stock Photo Website. All rights reserved.</div>
          <div className="site-footer-socials">
            {socialLinks.map((link) => (
              <a
                key={`${link.platform}-${link.url}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#cfe8ff" }}
              >
                {FOOTER_LINK_LABELS[link.platform] || link.platform}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;