import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { formatIndiaDate, formatIndiaDateTimeLocal, indiaDateTimeLocalToISOString } from "../utils/indiaTime";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import HomeSection from "./HomeSection";
import ExplorePage from "../pages/ExplorePage";
import FavoritesPage from "../pages/FavoritesPage";
import DownloadsPage from "../pages/DownloadsPage";
import UploadPage from "../pages/UploadPage";
import DashboardPage from "../pages/DashboardPage";
import ProfilePage from "../pages/ProfilePage";
import PublicProfilePage from "../pages/PublicProfilePage";
import PublicContributorPage from "../pages/PublicContributorPage";
import AccountSettingsPage from "../pages/AccountSettingsPage";
import PaymentsPage from "../pages/PaymentsPage";
import ContributorPage from "../pages/ContributorPage";
import MyUploadsPage from "../pages/MyUploadsPage";
import AdminPage from "../pages/AdminPage";
import AdminContributorsPage from "../pages/AdminContributorsPage";
import AdminEmailTemplates from "../pages/AdminEmailTemplates";
import AdminEmailScheduled from "../pages/AdminEmailScheduled";
import AdminAnalyticsPage from "../pages/AdminAnalyticsPage";
import BlogAnalyticsPanel from "../pages/BlogAnalyticsPanel";
import AdminOrdersPage from "../pages/AdminOrdersPage";
import AdminCommercePage from "../pages/AdminCommercePage";
import AdminCustomerCreditsPage from "../pages/AdminCustomerCreditsPage";
import AdminSubscribersPage from "../pages/AdminSubscribersPage";
import AdminCurrentPlansPage from "../pages/AdminCurrentPlansPage";
import SubscriptionCheckoutPage from "../pages/SubscriptionCheckoutPage";
import BulkUploadPage from "../pages/BulkUploadPage";
import OrderHistoryPage from "../pages/OrderHistoryPage";
import AssetPage from "../pages/AssetPage";
import CartPage from "../pages/CartPage";
import CheckoutPage from "../pages/CheckoutPage";
import CompanyPage from "./CompanyPage";
import { isAdminRole, isContributorRole } from "../utils/role";
import { resolveActivePage } from "../utils/routeState";
import ProtectedRoute from "./ProtectedRoute";
import MessagesPage from "../pages/MessagesPage";
import Pagination from "./Pagination";
import "./dashboard/TaxCenter.css";
import TaxW8BenForm from "./dashboard/TaxW8BenForm";
import TaxW9Form from "./dashboard/TaxW9Form";
import { getEffectiveAuthToken } from "../utils/authSession";
import { GOOGLE_FONT_FAMILIES } from "../data/googleFonts";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";
import PromotionalBannerPage from "./PromotionalBannerExperience";
import SearchConsolePage from "../pages/SearchConsolePage";
import GoogleAnalyticsPage from "../pages/GoogleAnalyticsPage";
import SitemapPage from "../pages/SitemapPage";
import PrivacyPolicyPage from "../pages/PrivacyPolicyPage";
import TermsAndConditionsPage from "../pages/TermsAndConditionsPage";
import CookiePolicyPage from "../pages/CookiePolicyPage";
import HelpCenterPage from "../pages/HelpCenterPage";
import DevelopersPage from "../pages/DevelopersPage";
import PartnersPage from "../pages/PartnersPage";
import "./PublicBlogPage.css";
import "./BlogAdmin.css";

const BLOG_DRAFTS_STORAGE_KEY = "gfx-blog-drafts";
const blogDraftHeaders = () => ({ Authorization: `Bearer ${getEffectiveAuthToken()}` });
const normalizeBlogDraft = (draft) => ({ ...draft, savedAt: draft.savedAt || draft.updatedAt || draft.createdAt });
const getScheduledTimeLeft = (publishAt, now) => {
  if (!publishAt) return { label: "Time unavailable", state: "unavailable" };
  const scheduledAt = new Date(publishAt).getTime();
  if (!Number.isFinite(scheduledAt)) return { label: "Time unavailable", state: "unavailable" };

  const totalMinutes = Math.ceil((scheduledAt - now) / 60000);
  if (totalMinutes <= 0) return { label: "Past due", state: "overdue" };

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    const dayLabel = `${days} ${days === 1 ? "day" : "days"}`;
    const hourLabel = hours > 0 ? `, ${hours} ${hours === 1 ? "hour" : "hours"}` : "";
    return { label: `${dayLabel}${hourLabel} left`, state: "upcoming" };
  }
  if (hours > 0) {
    const hourLabel = `${hours} ${hours === 1 ? "hour" : "hours"}`;
    const minuteLabel = minutes > 0 ? `, ${minutes} ${minutes === 1 ? "minute" : "minutes"}` : "";
    return { label: `${hourLabel}${minuteLabel} left`, state: "upcoming" };
  }
  return { label: `${minutes} ${minutes === 1 ? "minute" : "minutes"} left`, state: "upcoming" };
};
const slugifyBlogSegment = (value = "") => String(value)
  .toLowerCase()
  .trim()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "") || "blog";
const buildBlogPostUrl = (post) => {
  if (!post) return "/blog";
  const category = slugifyBlogSegment(post.category || "Blog");
  const title = slugifyBlogSegment(post.title || "Untitled Blog");
  return `/blog/${category}/${title}_${post.id}`;
};

const renderRichTextContent = (content) => {
  const raw = String(content || "").trim();
  if (!raw) return "No content available.";

  if (!/[<>]/.test(raw)) {
    const paragraphs = raw.split(/\n{2,}/).filter(Boolean);
    return paragraphs.length > 0
      ? paragraphs.map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`).join("")
      : `<p>${raw.replace(/\n/g, "<br />")}</p>`;
  }

  return raw;
};

const EMPTY_URL_DIALOG = {
  open: false,
  type: "link",
  value: "",
  text: "",
  openIn: "same-tab",
  relationship: "normal",
  existingRel: "",
  existingLink: false,
  mode: "url",
  assetSearch: "",
  assetResults: [],
  selectedAssetId: null,
  error: "",
};

const escapeHtml = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const normalizeLinkUrl = (value) => {
  const url = String(value || "").trim();
  if (/^www\./i.test(url)) return `https://${url}`;
  return url;
};

const validateLinkUrl = (value) => {
  const url = normalizeLinkUrl(value);
  if (!url) return { url: "", error: "Please enter a URL." };
  if (/^(javascript|data|vbscript):/i.test(url)) return { url, error: "This URL is not allowed." };
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^(https?:\/\/|mailto:|tel:)/i.test(url)) return { url, error: "This URL is not allowed." };
  if (/^(https?:\/\/|mailto:|tel:)/i.test(url) || /^\//.test(url) || /^#/.test(url) || /^\?/.test(url)) {
    return { url, error: "" };
  }
  return { url: `https://${url}`, error: "" };
};

const getLinkElement = (node, editor) => {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  const link = element?.closest?.("a");
  return link && editor?.contains(link) ? link : null;
};

const relationshipFromRel = (rel) => {
  const tokens = String(rel || "").split(/\s+/).filter(Boolean);
  return tokens.includes("nofollow") ? "nofollow" : tokens.includes("sponsored") ? "sponsored" : tokens.includes("ugc") ? "ugc" : "normal";
};

const applyAutomaticLinkStyle = (link, url) => {
  const isInternalLink = /^\//.test(String(url || ""));
  link.style.color = isInternalLink ? "#2563eb" : "#dc2626";
  link.style.fontWeight = "700";
  link.style.textDecoration = isInternalLink ? "none" : "underline";
};

function RichTextEditor({ value, onChange, placeholder, required = false }) {
  const editorRef = useRef(null);
  const dialogRef = useRef(null);
  const selectionRef = useRef(null);
  const existingLinkRef = useRef(null);
  const [urlDialog, setUrlDialog] = useState(EMPTY_URL_DIALOG);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== (value || "")) {
      editorRef.current.innerHTML = value || "";
    }
    editorRef.current.querySelectorAll("a[href]").forEach((link) => applyAutomaticLinkStyle(link, link.getAttribute("href")));
  }, [value]);

  useEffect(() => {
    if (!urlDialog.open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setUrlDialog(EMPTY_URL_DIALOG);
    };
    const handlePointerDown = (event) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target)) setUrlDialog(EMPTY_URL_DIALOG);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [urlDialog.open]);

  const saveSelection = () => {
    const editor = editorRef.current;
    const selection = typeof window !== "undefined" && typeof window.getSelection === "function" ? window.getSelection() : null;
    if (!editor || !selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return null;
    selectionRef.current = range.cloneRange();
    return range;
  };

  const restoreSelection = () => {
    const selection = typeof window !== "undefined" && typeof window.getSelection === "function" ? window.getSelection() : null;
    if (!selection || !selectionRef.current) return;
    selection.removeAllRanges();
    selection.addRange(selectionRef.current.cloneRange());
  };

  const fetchAssetSuggestions = async (query) => {
    const searchText = String(query || "").trim();
    try {
      const response = await axios.get(`${API_BASE_URL}/images?limit=50&page=1`);
      const images = Array.isArray(response?.data?.images) ? response.data.images : [];
      const normalized = searchText.toLowerCase();
      const results = normalized
        ? images.filter((image) => {
            const haystack = [image.title, image.description, image.category, image.keywords, image.filename].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(normalized);
          })
        : images;
      setUrlDialog((current) => ({
        ...current,
        assetResults: results.slice(0, 8),
        selectedAssetId: results[0]?.id ?? null,
        value: results[0] ? `/asset/${results[0].id}` : current.value,
      }));
    } catch (error) {
      setUrlDialog((current) => ({
        ...current,
        assetResults: [],
        selectedAssetId: null,
      }));
    }
  };

  const applyCommand = (command, option = null) => {
    const editor = editorRef.current;
    if (!editor) return;
    if (typeof document.execCommand !== "function") return;
    editor.focus();
    document.execCommand(command, false, option);
    onChange({ target: { name: "content", value: editor.innerHTML } });
  };

  const applyColor = (color, background = false) => {
    const editor = editorRef.current;
    if (!editor) return;
    if (typeof document.execCommand !== "function") return;
    if (background) {
      document.execCommand("hiliteColor", false, color);
    } else {
      document.execCommand("foreColor", false, color);
    }
    onChange({ target: { name: "content", value: editor.innerHTML } });
  };

  const closeUrlDialog = () => setUrlDialog(EMPTY_URL_DIALOG);

  const getRelationshipValue = () => {
    const relationship = urlDialog.relationship;
    const security = urlDialog.openIn === "new-tab" ? ["noopener", "noreferrer"] : [];
    if (relationship === "normal") {
      const existing = urlDialog.existingRel && urlDialog.existingRel.split(/\s+/).filter((token) => !["noopener", "noreferrer"].includes(token));
      return [...new Set([...security, ...(existing || [])])].join(" ");
    }
    return [...new Set([...security, relationship])].join(" ");
  };

  const applyLink = () => {
    const editor = editorRef.current;
    const text = String(urlDialog.text || "").trim();
    const validation = validateLinkUrl(urlDialog.value);
    if (!text) {
      setUrlDialog((current) => ({ ...current, error: "Please enter link text." }));
      return;
    }
    if (validation.error) {
      setUrlDialog((current) => ({ ...current, error: validation.error }));
      return;
    }
    if (!editor) return;

    const target = urlDialog.openIn === "new-tab" ? "_blank" : null;
    const rel = getRelationshipValue();
    restoreSelection();
    let link = existingLinkRef.current && editor.contains(existingLinkRef.current) ? existingLinkRef.current : null;
    if (link) {
      link.textContent = text;
    } else if (selectionRef.current && !selectionRef.current.collapsed && typeof document.execCommand === "function") {
      document.execCommand("createLink", false, validation.url);
      const selection = window.getSelection();
      link = getLinkElement(selection?.anchorNode, editor);
    } else if (typeof document.execCommand === "function") {
      document.execCommand("insertHTML", false, `<a href="${escapeHtml(validation.url)}">${escapeHtml(text)}</a>`);
      link = getLinkElement(window.getSelection()?.anchorNode, editor);
    }
    if (!link && selectionRef.current) {
      const range = selectionRef.current.cloneRange();
      const createdLink = document.createElement("a");
      createdLink.setAttribute("href", validation.url);
      createdLink.textContent = text;
      range.deleteContents();
      range.insertNode(createdLink);
      link = createdLink;
    }
    if (!link) {
      setUrlDialog((current) => ({ ...current, error: "Select text or enter link text before applying." }));
      return;
    }
    link.setAttribute("href", validation.url);
    if (target) link.setAttribute("target", target); else link.removeAttribute("target");
    if (rel) link.setAttribute("rel", rel); else link.removeAttribute("rel");
    applyAutomaticLinkStyle(link, validation.url);
    onChange({ target: { name: "content", value: editor.innerHTML } });
    closeUrlDialog();
  };

  const removeLink = () => {
    const editor = editorRef.current;
    const link = existingLinkRef.current && editor?.contains(existingLinkRef.current) ? existingLinkRef.current : null;
    if (!link) return;
    while (link.firstChild) link.parentNode.insertBefore(link.firstChild, link);
    link.remove();
    onChange({ target: { name: "content", value: editor.innerHTML } });
    closeUrlDialog();
  };

  const handleUrlDialogSubmit = () => {
    if (urlDialog.type === "image") {
      const url = String(urlDialog.value || "").trim();
      if (url) applyCommand("insertImage", url);
      closeUrlDialog();
      return;
    }
    applyLink();
  };

  const handleDialogKeyDown = (event) => {
    if (event.key === "Enter" && event.target.tagName !== "TEXTAREA") {
      event.preventDefault();
      handleUrlDialogSubmit();
    }
  };

  const handleEditorKeyDown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openUrlDialog("link");
    }
  };

  const openUrlDialog = (type) => {
    const editor = editorRef.current;
    let range = saveSelection();
    if (!range && editor) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selectionRef.current = range.cloneRange();
    }
    const selectedNode = range?.startContainer;
    const existingLink = type === "link" ? getLinkElement(selectedNode, editor) : null;
    existingLinkRef.current = existingLink;
    const selectedText = existingLink?.textContent || range?.toString() || "";
    if (type === "link") {
      setUrlDialog({
        ...EMPTY_URL_DIALOG,
        open: true,
        type,
        value: existingLink?.getAttribute("href") || "",
        text: selectedText,
        openIn: existingLink?.getAttribute("target") === "_blank" ? "new-tab" : "same-tab",
        relationship: relationshipFromRel(existingLink?.getAttribute("rel")),
        existingRel: existingLink?.getAttribute("rel") || "",
        existingLink: Boolean(existingLink),
      });
      return;
    }

    if (typeof window !== "undefined" && typeof window.prompt === "function") {
      const url = window.prompt("Enter an image URL", "https://");
      if (!url) return;
      applyCommand("insertImage", url);
      return;
    }

    setUrlDialog({ ...EMPTY_URL_DIALOG, open: true, type, value: "https://" });
  };

  const insertLink = () => {
    openUrlDialog("link");
  };

  const insertImage = () => {
    openUrlDialog("image");
  };

  const insertQuote = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const quoteHtml = '<blockquote style="margin: 1rem 0; padding-left: 1rem; border-left: 4px solid #cbd5e1; color: #475569;">Quote</blockquote>';
    document.execCommand("insertHTML", false, quoteHtml);
    onChange({ target: { name: "content", value: editor.innerHTML } });
  };

  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "8px 10px", border: "1px solid #cbd5e1", borderBottom: "none", borderRadius: "6px 6px 0 0", background: "#f8fafc" }}>
        <button type="button" onClick={() => applyCommand("bold")} aria-label="Bold" style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", fontWeight: 700, cursor: "pointer" }}>B</button>
        <button type="button" onClick={() => applyCommand("italic")} aria-label="Italic" style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", fontStyle: "italic", cursor: "pointer" }}>I</button>
        <button type="button" onClick={() => applyCommand("underline")} aria-label="Underline" style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", textDecoration: "underline", cursor: "pointer" }}>U</button>
        <button type="button" onClick={() => applyColor("#000000")} aria-label="Text color black" title="Text color black" style={{ minWidth: "24px", height: "30px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#000000", color: "#fff", fontSize: "10px", fontWeight: 700, cursor: "pointer" }}>A</button>
        <button type="button" onClick={() => applyColor("#0000ff")} aria-label="Text color blue" title="Text color blue" style={{ minWidth: "24px", height: "30px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#0000ff", color: "#fff", fontSize: "10px", fontWeight: 700, cursor: "pointer" }}>A</button>
        <button type="button" onClick={() => applyColor("#ff0000")} aria-label="Text color red" title="Text color red" style={{ minWidth: "24px", height: "30px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#ff0000", color: "#fff", fontSize: "10px", fontWeight: 700, cursor: "pointer" }}>A</button>
        <select aria-label="Font family" defaultValue="Open Sans" onChange={(event) => applyCommand("fontName", event.target.value)} style={{ minWidth: "110px", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff" }}>
          {GOOGLE_FONT_FAMILIES.map((family) => (
            <option key={family} value={family}>{family}</option>
          ))}
        </select>
        <select aria-label="Font size" defaultValue="2" onChange={(event) => applyCommand("fontSize", event.target.value)} style={{ minWidth: "72px", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff" }}>
          <option value="1">8</option>
          <option value="2">10</option>
          <option value="3">12</option>
          <option value="4">14</option>
          <option value="5">18</option>
          <option value="6">24</option>
        </select>
        <button type="button" onClick={() => applyCommand("justifyLeft")} aria-label="Align left" title="Align left" style={{ width: "30px", height: "30px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer" }}>≡</button>
        <button type="button" onClick={() => applyCommand("justifyCenter")} aria-label="Align center" title="Align center" style={{ width: "30px", height: "30px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer" }}>≣</button>
        <button type="button" onClick={() => applyCommand("justifyRight")} aria-label="Align right" title="Align right" style={{ width: "30px", height: "30px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer" }}>≣</button>
        <button type="button" onClick={() => applyCommand("insertUnorderedList")} aria-label="Bullet list" title="Bullet list" style={{ width: "30px", height: "30px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer" }}>•</button>
        <button type="button" onClick={() => applyCommand("insertOrderedList")} aria-label="Numbered list" title="Numbered list" style={{ width: "30px", height: "30px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer" }}>1.</button>
        <button type="button" onClick={insertQuote} aria-label="Quote" title="Quote" style={{ width: "30px", height: "30px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer" }}>❝</button>
        <button type="button" onMouseDown={saveSelection} onClick={insertLink} aria-label="Link" title="Link" style={{ width: "30px", height: "30px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer" }}>🔗</button>
        <button type="button" onClick={insertImage} aria-label="Image" title="Image" style={{ width: "30px", height: "30px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer" }}>🖼</button>
      </div>
      {urlDialog.open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label={`${urlDialog.type === "image" ? "Image" : "Link"} URL dialog`}
          onKeyDown={handleDialogKeyDown}
          style={{
            display: "grid",
            gap: "8px",
            padding: urlDialog.type === "link" ? "10px 10px 8px" : "12px",
            border: urlDialog.type === "link" ? "1px solid #2d6cdf" : "1px solid #cbd5e1",
            borderRadius: "8px",
            background: "#fff",
            boxShadow: urlDialog.type === "link" ? "0 0 0 1px rgba(45,108,223,0.08)" : "0 10px 24px rgba(15, 23, 42, 0.12)"
          }}
        >
          {urlDialog.type === "link" ? (
            <>
              <div style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
                <button type="button" aria-label="URL" onClick={() => setUrlDialog((current) => ({ ...current, mode: "url" }))} style={{ padding: "6px 10px", border: urlDialog.mode === "url" ? "1px solid #2d6cdf" : "1px solid #cbd5e1", borderRadius: "6px", background: urlDialog.mode === "url" ? "#eff6ff" : "#fff", color: "#1f2937", cursor: "pointer", fontWeight: 600 }}>URL</button>
                <button type="button" aria-label="Use asset" onClick={() => {
                  setUrlDialog((current) => ({ ...current, mode: "asset", value: "/asset/" }));
                  fetchAssetSuggestions("");
                }} style={{ padding: "6px 10px", border: urlDialog.mode === "asset" ? "1px solid #2d6cdf" : "1px solid #cbd5e1", borderRadius: "6px", background: urlDialog.mode === "asset" ? "#eff6ff" : "#fff", color: "#1f2937", cursor: "pointer", fontWeight: 600 }}>Use asset</button>
              </div>
              {urlDialog.mode === "url" ? (
                <div style={{ display: "grid", gap: "8px", border: "1px solid #2d6cdf", borderRadius: "6px", background: "#fff", padding: "8px" }}>
                  <label htmlFor="rich-text-link-text-input" style={{ fontWeight: 700 }}>Selected text</label>
                  <input id="rich-text-link-text-input" value={urlDialog.text} onChange={(event) => setUrlDialog((current) => ({ ...current, text: event.target.value, error: "" }))} placeholder="Text to link" style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px" }} />
                  <label htmlFor="rich-text-url-input" style={{ fontWeight: 700 }}>URL</label>
                  <input
                    id="rich-text-url-input"
                    value={urlDialog.value}
                    onChange={(event) => setUrlDialog((current) => ({ ...current, value: event.target.value, error: "" }))}
                    placeholder="Paste URL or type to search"
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", outline: "none", fontSize: "14px", color: "#1f2937" }}
                  />
                  <label htmlFor="rich-text-open-in" style={{ fontWeight: 700 }}>Open in</label>
                  <select id="rich-text-open-in" value={urlDialog.openIn} onChange={(event) => setUrlDialog((current) => ({ ...current, openIn: event.target.value }))} style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px" }}><option value="same-tab">Same tab</option><option value="new-tab">New tab</option></select>
                  <label htmlFor="rich-text-link-rel" style={{ fontWeight: 700 }}>Link relationship</label>
                  <select id="rich-text-link-rel" value={urlDialog.relationship} onChange={(event) => setUrlDialog((current) => ({ ...current, relationship: event.target.value }))} style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px" }}><option value="normal">Normal</option><option value="nofollow">Nofollow</option><option value="sponsored">Sponsored</option><option value="ugc">UGC</option></select>
                  {urlDialog.error ? <div role="alert" style={{ color: "#991b1b", fontSize: "13px" }}>{urlDialog.error}</div> : null}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}><button type="button" onClick={closeUrlDialog} style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer" }}>Cancel</button>{urlDialog.existingLink ? <button type="button" onClick={removeLink} style={{ padding: "8px 12px", border: "1px solid #fecaca", borderRadius: "6px", background: "#fff", color: "#991b1b", cursor: "pointer" }}>Remove Link</button> : null}<button type="button" onClick={handleUrlDialogSubmit} style={{ padding: "8px 12px", border: "none", borderRadius: "6px", background: "#2563eb", color: "#fff", cursor: "pointer" }}>Apply Link</button></div>
                </div>
              ) : (
                <div style={{ display: "grid", gap: "8px" }}>
                  <input
                    aria-label="Search internal asset"
                    value={urlDialog.assetSearch}
                    onChange={(event) => {
                      const query = event.target.value;
                      setUrlDialog((current) => ({ ...current, assetSearch: query }));
                      fetchAssetSuggestions(query);
                    }}
                    placeholder="Search internal asset"
                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                  />
                  <label htmlFor="rich-text-url-input" style={{ fontWeight: 700 }}>Link URL</label>
                  <input
                    id="rich-text-url-input"
                    value={urlDialog.value}
                    onChange={(event) => setUrlDialog((current) => ({ ...current, value: event.target.value, error: "" }))}
                    placeholder="/asset/42"
                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                  />
                  <div style={{ display: "grid", gap: "6px", maxHeight: "180px", overflowY: "auto" }}>
                    {urlDialog.assetResults.length > 0 ? urlDialog.assetResults.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => {
                          setUrlDialog((current) => ({ ...current, value: `/asset/${asset.id}`, selectedAssetId: asset.id, mode: "asset" }));
                        }}
                        style={{ display: "flex", justifyContent: "space-between", gap: "8px", padding: "8px 10px", border: "1px solid #dbeafe", borderRadius: "6px", background: urlDialog.selectedAssetId === asset.id ? "#eff6ff" : "#f8fafc", cursor: "pointer", textAlign: "left", color: "#0f172a" }}
                        aria-label={asset.title || `Asset ${asset.id}`}
                      >
                        <span style={{ fontWeight: 600 }}>{asset.title || "Untitled asset"}</span>
                        <span style={{ color: "#64748b", fontSize: "12px" }}>{asset.category || "Asset"}</span>
                      </button>
                    )) : (
                      <div style={{ padding: "8px 10px", color: "#64748b", fontSize: "13px", border: "1px dashed #cbd5e1", borderRadius: "6px" }}>No assets found.</div>
                    )}
                  </div>
                  {urlDialog.error ? <div role="alert" style={{ color: "#991b1b", fontSize: "13px" }}>{urlDialog.error}</div> : null}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                    <button type="button" onClick={closeUrlDialog} style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer" }}>Cancel</button>
                    {urlDialog.existingLink ? <button type="button" onClick={removeLink} style={{ padding: "8px 12px", border: "1px solid #fecaca", borderRadius: "6px", background: "#fff", color: "#991b1b", cursor: "pointer" }}>Remove Link</button> : null}
                    <button type="button" onClick={handleUrlDialogSubmit} style={{ padding: "8px 12px", border: "none", borderRadius: "6px", background: "#2563eb", color: "#fff", cursor: "pointer" }}>Apply Link</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <label htmlFor="rich-text-url-input" style={{ fontWeight: 700 }}>{urlDialog.type === "image" ? "Image URL" : "Link URL"}</label>
              <input
                id="rich-text-url-input"
                value={urlDialog.value}
                onChange={(event) => setUrlDialog((current) => ({ ...current, value: event.target.value }))}
                placeholder="https://example.com"
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button type="button" onClick={closeUrlDialog} style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", cursor: "pointer" }}>Cancel</button>
                <button type="button" onClick={handleUrlDialogSubmit} style={{ padding: "8px 12px", border: "none", borderRadius: "6px", background: "#2563eb", color: "#fff", cursor: "pointer" }}>{urlDialog.type === "image" ? "Insert image" : "Apply Link"}</button>
              </div>
            </>
          )}
        </div>
      )}
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        onKeyDown={handleEditorKeyDown}
        onInput={(event) => onChange({ target: { name: "content", value: event.currentTarget.innerHTML } })}
        placeholder={placeholder}
        data-placeholder={placeholder}
        required={required}
        style={{
          width: "100%",
          boxSizing: "border-box",
          minHeight: "220px",
          padding: "12px 14px",
          border: "1px solid #cbd5e1",
          borderRadius: "0 0 6px 6px",
          background: "#fff",
          color: "#0f172a",
          font: "inherit",
          lineHeight: 1.6,
          outline: "none",
          resize: "vertical",
        }}
      />
    </div>
  );
}

function StartTaxFormMenu() {
  const location = useLocation();
  const navigate = useNavigate();
  const [earningsOpen, setEarningsOpen] = useState(true);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const navGroups = [
    { label: "", items: [["/dashboard", "Home"]] },
    { label: "Earnings", open: earningsOpen, setOpen: setEarningsOpen, items: [["/dashboard?tab=earningssummary", "Earnings summary"], ["/dashboard?tab=paymenthistory", "Payment history"], ["/dashboard?tab=taxcenter", "Tax center"]] },
    { label: "Insights", open: insightsOpen, setOpen: setInsightsOpen, items: [["/dashboard?tab=analytics", "Analytics"], ["/dashboard?tab=top-performer", "Top performer"], ["/dashboard?tab=blog", "Blog"], ["/dashboard?tab=trending-content", "Trending content"]] },
    { label: "", items: [["/dashboard?tab=portfolio", "Portfolio"]] },
    { label: "Account", open: accountOpen, setOpen: setAccountOpen, items: [["/dashboard?tab=account", "Account settings"], ["/public-profile", "Public profile"]] },
    { label: "", items: [["/contact", "Help"]] },
  ];
  const activeTab = new URLSearchParams(location.search).get("tab");

  return (
    <aside className="contributor-sidebar starttaxform-sidebar" aria-label="Contributor menu">
      <div className="contributor-nav">
        {navGroups.map((group, index) => (
          <div key={`${group.label || "main"}-${index}`}>
            {group.label ? <button type="button" className={group.open ? "is-active" : ""} onClick={() => group.setOpen((open) => !open)} aria-expanded={group.open}>{group.label}<span aria-hidden="true">{group.open ? "−" : "+"}</span></button> : null}
            {(!group.label || group.open) && <div className={group.label ? "contributor-subnav" : ""}>{group.items.map(([path, label]) => <button key={path} type="button" className={path === "/dashboard" && activeTab === null ? "is-active" : ""} onClick={() => navigate(path)}>{label}</button>)}</div>}
          </div>
        ))}
      </div>
    </aside>
  );
}

function StartTaxFormOptions() {
  const navigate = useNavigate();
  const [isUsPerson, setIsUsPerson] = useState("");
  const [entityType, setEntityType] = useState("");
  const isUsPersonSelect = useRef(null);
  const entityTypeSelect = useRef(null);
  const handleSubmit = () => {
    const selectedIsUsPerson = isUsPersonSelect.current?.value || isUsPerson;
    const selectedEntityType = entityTypeSelect.current?.value || entityType;
    if (!selectedIsUsPerson || !selectedEntityType) return;
    setIsUsPerson(selectedIsUsPerson);
    setEntityType(selectedEntityType);
    const useW9Form = selectedIsUsPerson === "Yes" || selectedEntityType === "Business";
    navigate(`/dashboard?tab=${useW9Form ? "filltaxform1" : "filltaxform"}`);
  };

  return (
    <main className="starttaxform-options-panel">
      <h1>Tax center</h1>
      <p>Before we can pay you, <strong>GFXunlimit</strong> needs to have your correct tax form on file.</p>
      <p>While we can't give you tax or legal advice, we've created the following questions to help you choose the best tax form and make your own decision about how to comply with applicable U.S. tax laws. If you still have questions after reviewing the information we've provided, please contact your legal and/or tax advisor.</p>
      <p>Please answer the following questions to help us determine which tax form is appropriate for you:</p>
      <div className="starttaxform-options-box">
        <label><span>For U.S. tax purposes, are you a U.S. person?</span><em>*</em><select ref={isUsPersonSelect} value={isUsPerson} onChange={(event) => setIsUsPerson(event.target.value)}><option value="">Select</option><option value="No">No</option><option value="Yes">Yes</option></select></label>
        <label><span>Are you contributing to <strong>GFXunlimit</strong> as an individual or as a business?</span><em>*</em><select ref={entityTypeSelect} value={entityType} onChange={(event) => setEntityType(event.target.value)}><option value="">Select</option><option value="Individual">Individual</option><option value="Business">Business</option></select></label>
      </div>
      <div className="starttaxform-options-submit"><button type="button" disabled={!isUsPerson || !entityType} onClick={handleSubmit}>Submit</button></div>
    </main>
  );
}

const formatDateTimeLocal = (value) => {
  if (!value) return "";
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;
  return formatIndiaDateTimeLocal(raw);
};

const parseDateTimeLocalParts = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    date: `${match[1]}-${match[2]}-${match[3]}`
  };
};

const padDateTimePart = (value) => String(value).padStart(2, "0");

const formatScheduleDate = ({ year, month, day }) => {
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
  return `${day} ${monthName} ${year}`;
};

const formatScheduleTime = ({ hour, minute }) => {
  const displayHour = hour % 12 || 12;
  return `${padDateTimePart(displayHour)}:${padDateTimePart(minute)} ${hour >= 12 ? "PM" : "AM"} IST`;
};

function BlogScheduleDateTimePicker({ value, minValue, onChange }) {
  const minParts = parseDateTimeLocalParts(minValue);
  const valueParts = parseDateTimeLocalParts(value);
  const activeParts = valueParts && valueParts.date >= minParts.date ? valueParts : minParts;
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => ({ year: activeParts.year, month: activeParts.month }));

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const openPicker = () => {
    setVisibleMonth({ year: activeParts.year, month: activeParts.month });
    setIsOpen(true);
  };

  const changeMonth = (amount) => {
    const nextMonth = new Date(Date.UTC(visibleMonth.year, visibleMonth.month - 1 + amount, 1));
    setVisibleMonth({ year: nextMonth.getUTCFullYear(), month: nextMonth.getUTCMonth() + 1 });
  };

  const dateForTime = activeParts.date;
  const displayHour = activeParts.hour % 12 || 12;
  const period = activeParts.hour >= 12 ? "PM" : "AM";
  const updateTime = (nextHour, nextMinute, nextPeriod) => {
    let hour = (Number(nextHour) % 12) + (nextPeriod === "PM" ? 12 : 0);
    let minute = Number(nextMinute);
    if (dateForTime === minParts.date && (hour < minParts.hour || (hour === minParts.hour && minute < minParts.minute))) {
      hour = minParts.hour;
      minute = minParts.minute;
    }
    onChange(`${dateForTime}T${padDateTimePart(hour)}:${padDateTimePart(minute)}`);
  };

  const firstWeekday = new Date(Date.UTC(visibleMonth.year, visibleMonth.month - 1, 1)).getUTCDay();
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(visibleMonth.year, visibleMonth.month - 1, 1 - firstWeekday + index));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return {
      date,
      dateValue: `${year}-${padDateTimePart(month)}-${padDateTimePart(day)}`,
      label: date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }),
      day,
      isCurrentMonth: month === visibleMonth.month && year === visibleMonth.year
    };
  });

  const chooseDate = (dateValue, date) => {
    onChange(`${dateValue}T${padDateTimePart(activeParts.hour)}:${padDateTimePart(activeParts.minute)}`);
    if (!date.isCurrentMonth) {
      setVisibleMonth({ year: date.date.getUTCFullYear(), month: date.date.getUTCMonth() + 1 });
    }
  };

  const selectToday = () => {
    const nextSlot = parseDateTimeLocalParts(formatDateTimeLocal(new Date(Date.now() + 5 * 60 * 1000)));
    onChange(`${nextSlot.date}T${padDateTimePart(nextSlot.hour)}:${padDateTimePart(nextSlot.minute)}`);
    setVisibleMonth({ year: nextSlot.year, month: nextSlot.month });
  };

  const monthTitle = new Date(Date.UTC(visibleMonth.year, visibleMonth.month - 1, 1))
    .toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const formattedValue = valueParts
    ? `${formatScheduleDate(valueParts)} · ${formatScheduleTime(valueParts)}`
    : "Choose a date and time";

  return (
    <div className="blog-admin-schedule-picker">
      <button
        className="blog-admin-schedule-picker-trigger"
        type="button"
        aria-label="Schedule publish date and time"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={openPicker}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
          <path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17" />
        </svg>
        <span>
          <strong>          {valueParts ? formatScheduleDate(valueParts) : "Choose a date and time"}</strong>
          {valueParts && <small>{formatScheduleTime(valueParts)}</small>}
        </span>
        <span className="blog-admin-schedule-picker-chevron" aria-hidden="true">⌄</span>
      </button>
      {isOpen && (
        <div className="blog-admin-schedule-picker-backdrop">
          <button className="blog-admin-schedule-picker-dismiss" type="button" aria-label="Close date picker" onClick={() => setIsOpen(false)} />
          <section
            className="blog-admin-schedule-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Choose schedule date and time"
          >
            <header className="blog-admin-schedule-picker-dialog-header">
              <div>
                <span>Schedule publish</span>
                <strong>{formattedValue}</strong>
              </div>
              <button type="button" aria-label="Close calendar" onClick={() => setIsOpen(false)}>×</button>
            </header>
            <div className="blog-admin-schedule-picker-content">
              <div className="blog-admin-schedule-calendar">
                <div className="blog-admin-schedule-calendar-header">
                  <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button>
                  <strong aria-live="polite">{monthTitle}</strong>
                  <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}>›</button>
                </div>
                <div className="blog-admin-schedule-calendar-weekdays" aria-hidden="true">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="blog-admin-schedule-calendar-days">
                  {calendarDays.map((date) => {
                    const isSelected = valueParts?.date === date.dateValue;
                    const isToday = minParts.date === date.dateValue;
                    const isDisabled = date.dateValue < minParts.date;
                    return (
                      <button
                        key={date.dateValue}
                        type="button"
                        aria-label={`Select ${date.label}`}
                        aria-pressed={Boolean(isSelected)}
                        className={[
                          "blog-admin-schedule-calendar-day",
                          !date.isCurrentMonth && "is-outside-month",
                          isToday && "is-today",
                          isSelected && "is-selected"
                        ].filter(Boolean).join(" ")}
                        disabled={isDisabled}
                        onClick={() => chooseDate(date.dateValue, date)}
                      >
                        {date.day}
                      </button>
                    );
                  })}
                </div>
              </div>
              <section className="blog-admin-schedule-time" aria-label="Publish time">
                <div className="blog-admin-schedule-time-heading">
                  <strong>Publish time</strong>
                  <span>IST</span>
                </div>
                <div className="blog-admin-schedule-time-fields">
                  <label>Hour
                    <select aria-label="Schedule hour" value={displayHour} onChange={(event) => updateTime(event.target.value, activeParts.minute, period)}>
                      {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => <option key={hour} value={hour}>{padDateTimePart(hour)}</option>)}
                    </select>
                  </label>
                  <label>Minute
                    <select aria-label="Schedule minute" value={activeParts.minute} onChange={(event) => updateTime(displayHour, event.target.value, period)}>
                      {Array.from({ length: 60 }, (_, minute) => minute).map((minute) => <option key={minute} value={minute}>{padDateTimePart(minute)}</option>)}
                    </select>
                  </label>
                  <label>Period
                    <select aria-label="Schedule period" value={period} onChange={(event) => updateTime(displayHour, activeParts.minute, event.target.value)}>
                      <option value="AM">AM</option>
                      <option value="PM">PM</option>
                    </select>
                  </label>
                </div>
                <p>Times are shown in Indian Standard Time.</p>
              </section>
            </div>
            <footer className="blog-admin-schedule-picker-footer">
              <button className="is-clear" type="button" onClick={() => onChange("")}>Clear</button>
              <div>
                <button className="is-today" type="button" onClick={selectToday}>Today</button>
                <button className="is-done" type="button" onClick={() => setIsOpen(false)}>Done</button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function BlogDashboard() {
  const [counts, setCounts] = useState({ total: 0, drafts: 0, scheduled: 0 });
  const [animatedCounts, setAnimatedCounts] = useState({ total: 0, drafts: 0, scheduled: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all(["published", "draft", "scheduled"].map((status) => (
      axios.get(`${API_BASE_URL}/admin/blog/drafts?status=${status}`, { headers: blogDraftHeaders() })
    ))).then((responses) => {
      if (!active) return;
      const publishedCount = Array.isArray(responses[0].data?.drafts) ? responses[0].data.drafts.length : 0;
      const draftCount = Array.isArray(responses[1].data?.drafts) ? responses[1].data.drafts.length : 0;
      const scheduledCount = Array.isArray(responses[2].data?.drafts) ? responses[2].data.drafts.length : 0;
      setCounts({ total: publishedCount + draftCount + scheduledCount, drafts: draftCount, scheduled: scheduledCount });
    }).catch(() => {
      if (active) setError("Unable to load blog totals.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loading) return undefined;
    const startTime = performance.now();
    const duration = 700;
    let frameId;
    const animate = (currentTime) => {
      const progress = Math.min((currentTime - startTime) / duration, 1);
      const easedProgress = 1 - ((1 - progress) ** 3);
      setAnimatedCounts({
        total: Math.round(counts.total * easedProgress),
        drafts: Math.round(counts.drafts * easedProgress),
        scheduled: Math.round(counts.scheduled * easedProgress)
      });
      if (progress < 1) frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [counts, loading]);

  const cards = [
    { label: "Total blogs", value: animatedCounts.total, tone: "blue" },
    { label: "Live", value: animatedCounts.total - animatedCounts.drafts - animatedCounts.scheduled, tone: "green" },
    { label: "Drafts", value: animatedCounts.drafts, tone: "amber" },
    { label: "Scheduled blogs", value: animatedCounts.scheduled, tone: "violet" }
  ];

  return (
    <section className="blog-dashboard" aria-labelledby="blog-dashboard-title">
      <header className="blog-dashboard-hero">
        <div>
          <p className="blog-dashboard-eyebrow">Publishing overview</p>
          <h1 id="blog-dashboard-title">Blog Dashboard</h1>
          <p className="blog-dashboard-description">A quick view of your blog publishing pipeline.</p>
        </div>
        <span className="blog-dashboard-hero-mark" aria-hidden="true">BLOG</span>
      </header>
      {error && <p className="blog-dashboard-error" role="alert">{error}</p>}
      <div className="blog-dashboard-grid">
        {cards.map((card) => (
          <article key={card.label} className={`blog-dashboard-card blog-dashboard-card--${card.tone}`}>
            <div className="blog-dashboard-card-label">
              <span className="blog-dashboard-card-dot" aria-hidden="true" />
              <p>{card.label}</p>
            </div>
            <p className="blog-dashboard-card-value" aria-label={`${card.label} count`}>{loading ? "..." : card.value}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function BlogAddNewForm({ initialDraft = null, adminBasePath }) {
  const [form, setForm] = useState(() => initialDraft ? { ...initialDraft, publishAt: formatDateTimeLocal(initialDraft.publishAt) } : {
      title: "",
      slug: "",
      excerpt: "",
      content: "",
      category: "",
      tags: "",
      author: "",
      status: "draft",
      publishAt: "",
      seoTitle: "",
      seoDescription: "",
      canonicalUrl: "",
      allowComments: true,
      featured: false
    });
    const [message, setMessage] = useState("");
    const [scheduleOpen, setScheduleOpen] = useState(false);

    const updateField = (event) => {
      const { name, value, type, checked } = event.target;
      setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
      setMessage("");
    };

    const submitForm = async (event, action) => {
      event.preventDefault();
      if (action === "schedule") {
        const scheduledTime = indiaDateTimeLocalToISOString(form.publishAt);
        if (!scheduledTime || new Date(scheduledTime) <= new Date()) {
          setMessage("Choose a future date and time to schedule this post.");
          return;
        }
      }
      const draftPayload = action === "schedule"
        ? { ...form, status: "scheduled", publishAt: indiaDateTimeLocalToISOString(form.publishAt) }
        : form;
      if (action === "preview") {
        try {
          const saveResponse = await axios.post(`${API_BASE_URL}/admin/blog/drafts`, { ...draftPayload, id: initialDraft?.id || undefined }, { headers: blogDraftHeaders() });
          const draftId = saveResponse.data?.draft?.id || initialDraft?.id;
          if (draftId) {
            window.open(`${adminBasePath}?tab=controls_blog&section=blog_preview&draft=${draftId}`, "_blank", "noopener,noreferrer");
            setMessage("Preview opened in a new page.");
            return;
          }
        } catch (error) {
          setMessage("Unable to open preview. Please save the blog and try again.");
          return;
        }
      }
      if (action === "save") {
        try {
          await axios.post(`${API_BASE_URL}/admin/blog/drafts`, { ...draftPayload, id: initialDraft?.id || undefined }, { headers: blogDraftHeaders() });
        } catch (error) {
          const existingDrafts = JSON.parse(window.localStorage.getItem(BLOG_DRAFTS_STORAGE_KEY) || "[]");
          const draft = normalizeBlogDraft({ ...form, id: initialDraft?.id || Date.now(), savedAt: new Date().toISOString(), status: "draft" });
          const savedDrafts = initialDraft?.id
            ? existingDrafts.map((savedDraft) => savedDraft.id === initialDraft.id ? draft : savedDraft)
            : [draft, ...existingDrafts];
          window.localStorage.setItem(BLOG_DRAFTS_STORAGE_KEY, JSON.stringify(savedDrafts));
          setMessage("Draft saved locally; it will sync when the server is available.");
          return;
        }
      } else if (action === "publish") {
        try {
          const saveResponse = await axios.post(`${API_BASE_URL}/admin/blog/drafts`, { ...draftPayload, id: initialDraft?.id || undefined }, { headers: blogDraftHeaders() });
          const draftId = saveResponse.data?.draft?.id || initialDraft?.id;
          if (draftId) {
            await axios.post(`${API_BASE_URL}/admin/blog/drafts/${draftId}/publish`, {}, { headers: blogDraftHeaders() });
          }
        } catch (error) {
          setMessage("Unable to publish blog post. Please try again.");
          return;
        }
      } else if (action === "schedule") {
        try {
          await axios.post(`${API_BASE_URL}/admin/blog/drafts`, { ...draftPayload, id: initialDraft?.id || undefined }, { headers: blogDraftHeaders() });
        } catch (error) {
          setMessage("Unable to schedule blog post. Please try again.");
          return;
        }
      }
      setMessage(action === "publish" ? "Blog post published." : action === "schedule" ? "Blog post scheduled." : action === "preview" ? "Preview is ready." : "Blog post saved.");
    };

    return (
      <section className="blog-admin-add-section" aria-labelledby="add-blog-title">
        <div className="blog-admin-add-header">
          <div>
            <p style={{ margin: "0 0 6px", color: "#64748b", fontSize: "0.75rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Blog content</p>
            <h1 id="add-blog-title" style={{ margin: 0, fontSize: "clamp(1.6rem, 6vw, 2rem)" }}>Add New Blog</h1>
            <p style={{ margin: "8px 0 0", color: "#64748b" }}>Create, schedule, and optimize a new article.</p>
          </div>
          <button className="blog-admin-preview-button" type="button" onClick={(event) => submitForm(event, "preview")}>Preview</button>
        </div>
        <form className="blog-admin-post-form" onSubmit={(event) => submitForm(event, "save")}>
          <section className="blog-admin-form-card" aria-labelledby="blog-article-details-title">
            <div className="blog-admin-form-card-heading">
              <span aria-hidden="true">01</span>
              <div>
                <h2 id="blog-article-details-title">Article content</h2>
                <p>Start with a clear title, then shape your story.</p>
              </div>
            </div>
            <div className="blog-admin-article-fields">
              <label className="blog-admin-field">Title<input className="blog-admin-input" name="title" value={form.title} onChange={updateField} placeholder="Enter a compelling title" required /></label>
              <label className="blog-admin-field">Slug<input className="blog-admin-input" name="slug" value={form.slug} onChange={updateField} placeholder="your-blog-post-slug" /></label>
              <label className="blog-admin-field blog-admin-field--wide">Excerpt<textarea className="blog-admin-input blog-admin-textarea" name="excerpt" value={form.excerpt} onChange={updateField} placeholder="Short summary shown in blog listings" rows="3" /></label>
              <label className="blog-admin-field blog-admin-field--wide">Content<RichTextEditor value={form.content} onChange={updateField} placeholder="Write your blog content here..." required /></label>
            </div>
          </section>
          <section className="blog-admin-form-card" aria-labelledby="blog-post-details-title">
            <div className="blog-admin-form-card-heading">
              <span aria-hidden="true">02</span>
              <div>
                <h2 id="blog-post-details-title">Post details</h2>
                <p>Add the details readers use to discover and recognize your post.</p>
              </div>
            </div>
            <div className="blog-admin-metadata-grid">
              <label className="blog-admin-field">Cover image<input className="blog-admin-input blog-admin-file-input" name="coverImage" type="file" accept="image/*" onChange={updateField} /></label>
              <label className="blog-admin-field">Author<input className="blog-admin-input" name="author" value={form.author} onChange={updateField} placeholder="Author name" /></label>
              <label className="blog-admin-field">Category<input className="blog-admin-input" name="category" value={form.category} onChange={updateField} placeholder="News, tutorials, inspiration..." /></label>
              <label className="blog-admin-field">Tags<input className="blog-admin-input" name="tags" value={form.tags} onChange={updateField} placeholder="Separate tags with commas" /></label>
            </div>
          </section>
          <fieldset className="blog-admin-settings-card">
            <legend>Post settings</legend>
            <div className="blog-admin-settings-options">
              <label><input name="allowComments" type="checkbox" checked={form.allowComments} onChange={updateField} /> Allow comments</label>
              <label><input name="featured" type="checkbox" checked={form.featured} onChange={updateField} /> Feature this post</label>
            </div>
          </fieldset>
          <section className="blog-admin-form-card" aria-labelledby="blog-seo-title">
            <div className="blog-admin-form-card-heading">
              <span aria-hidden="true">03</span>
              <div>
                <h2 id="blog-seo-title">Search appearance</h2>
                <p>Fine-tune how this post appears in search results.</p>
              </div>
            </div>
            <div className="blog-admin-seo-fields">
              <label className="blog-admin-field">SEO title<input className="blog-admin-input" name="seoTitle" value={form.seoTitle} onChange={updateField} placeholder="Search-friendly title" /></label>
              <label className="blog-admin-field">SEO description<textarea className="blog-admin-input blog-admin-textarea" name="seoDescription" value={form.seoDescription} onChange={updateField} placeholder="Description for search engines" rows="3" /></label>
            </div>
          </section>
          {scheduleOpen && <div className="blog-admin-schedule-panel">
            <div className="blog-admin-field">
              <span>Schedule publish date and time (IST)</span>
              <BlogScheduleDateTimePicker
                value={form.publishAt}
                minValue={formatDateTimeLocal(new Date())}
                onChange={(publishAt) => {
                  setForm((current) => ({ ...current, publishAt }));
                  setMessage("");
                }}
              />
            </div>
            <button className="blog-admin-secondary-button" type="button" onClick={() => setScheduleOpen(false)}>Done</button>
          </div>}
          <div className="blog-admin-form-actions">
            <div className="blog-admin-form-primary-actions">
              <button className="blog-admin-secondary-button" type="submit">Save Draft</button>
              <button className="blog-admin-publish-button" type="button" onClick={(event) => submitForm(event, form.publishAt ? "schedule" : "publish")}>{form.publishAt ? "Schedule Publish" : "Publish"}</button>
              {message && <span className="blog-admin-form-message" role="status">{message}</span>}
            </div>
            <button className="blog-admin-schedule-button" type="button" onClick={() => setScheduleOpen((current) => !current)}>{scheduleOpen ? "Close Schedule" : "Schedule"}</button>
          </div>
        </form>
      </section>
    );
  }

function BlogDrafts({ onEditDraft }) {
  const [drafts, setDrafts] = useState(() => JSON.parse(window.localStorage.getItem(BLOG_DRAFTS_STORAGE_KEY) || "[]"));
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "savedAt", direction: "desc" });

  useEffect(() => {
    let active = true;
    const localDrafts = JSON.parse(window.localStorage.getItem(BLOG_DRAFTS_STORAGE_KEY) || "[]").map(normalizeBlogDraft);
    Promise.resolve(axios.get(`${API_BASE_URL}/admin/blog/drafts`, { headers: blogDraftHeaders() }))
      .then((response) => {
        if (!active || !Array.isArray(response.data?.drafts)) return;
        const serverDrafts = response.data.drafts.map(normalizeBlogDraft);
        if (serverDrafts.length > 0 || localDrafts.length === 0) {
          setDrafts(serverDrafts);
          return;
        }
        setDrafts(localDrafts);
        Promise.all(localDrafts.map((draft) => axios.post(`${API_BASE_URL}/admin/blog/drafts`, { ...draft, id: undefined }, { headers: blogDraftHeaders() })))
          .then(() => {
            window.localStorage.removeItem(BLOG_DRAFTS_STORAGE_KEY);
            return axios.get(`${API_BASE_URL}/admin/blog/drafts`, { headers: blogDraftHeaders() });
          })
          .then((syncedResponse) => {
            if (active && Array.isArray(syncedResponse.data?.drafts)) setDrafts(syncedResponse.data.drafts.map(normalizeBlogDraft));
          })
          .catch(() => {});
      })
      .catch(() => {
        if (active) setDrafts(localDrafts);
      });
    return () => { active = false; };
  }, []);

  const deleteDraft = async (id) => {
    if (!window.confirm("Delete this draft? This action cannot be undone.")) return;
    const remainingDrafts = drafts.filter((draft) => draft.id !== id);
    setDrafts(remainingDrafts);
    try {
      await axios.delete(`${API_BASE_URL}/admin/blog/drafts/${id}`, { headers: blogDraftHeaders() });
    } catch (error) {
      window.localStorage.setItem(BLOG_DRAFTS_STORAGE_KEY, JSON.stringify(remainingDrafts));
    }
  };

  const editDraft = (draft) => {
    onEditDraft(draft);
  };

  const filteredDrafts = drafts.filter((draft) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return [draft.title, draft.excerpt, draft.category, draft.addedBy, draft.author, draft.tags]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });

  const sortedDrafts = [...filteredDrafts].sort((first, second) => {
    const firstValue = sortConfig.key === "savedAt"
      ? new Date(first.savedAt || 0).getTime()
      : String(first[sortConfig.key] || (sortConfig.key === "addedBy" ? "Unknown username" : "")).toLowerCase();
    const secondValue = sortConfig.key === "savedAt"
      ? new Date(second.savedAt || 0).getTime()
      : String(second[sortConfig.key] || (sortConfig.key === "addedBy" ? "Unknown username" : "")).toLowerCase();
    if (firstValue === secondValue) return 0;
    const comparison = firstValue > secondValue ? 1 : -1;
    return sortConfig.direction === "asc" ? comparison : -comparison;
  });

  const toggleSort = (key) => {
    setSortConfig((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "savedAt" ? "desc" : "asc" });
  };

  const selectSort = (key) => {
    setSortConfig((current) => current.key === key
      ? current
      : { key, direction: key === "savedAt" ? "desc" : "asc" });
  };

  const publishDraft = async (id) => {
    const remainingDrafts = drafts.filter((draft) => draft.id !== id);
    setDrafts(remainingDrafts);
    try {
      await axios.post(`${API_BASE_URL}/admin/blog/drafts/${id}/publish`, {}, { headers: blogDraftHeaders() });
    } catch (error) {
      window.localStorage.setItem(BLOG_DRAFTS_STORAGE_KEY, JSON.stringify(remainingDrafts));
    }
    setMessage("Blog post published.");
  };

  return (
    <section className="blog-admin-list-section blog-admin-drafts-section" aria-labelledby="blog-drafts-title">
      <div className="blog-admin-drafts-header">
        <div className="blog-admin-drafts-heading">
          <p>Blog content</p>
          <h1 id="blog-drafts-title">Drafts</h1>
          <span>Saved blog drafts appear here until they are ready to publish.</span>
        </div>
        <div className="blog-admin-drafts-tools">
          <label htmlFor="draft-blog-search" className="blog-admin-drafts-search">Search blogs
            <input id="draft-blog-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search title, category, author, tags, or content" />
          </label>
          <span className="blog-admin-drafts-count">{filteredDrafts.length} {filteredDrafts.length === 1 ? "draft" : "drafts"}</span>
        </div>
      </div>
      <div className="blog-admin-drafts-mobile-sort">
        <label htmlFor="draft-sort-mobile">Sort drafts
          <select id="draft-sort-mobile" value={sortConfig.key} onChange={(event) => selectSort(event.target.value)}>
            <option value="title">Blog post</option>
            <option value="category">Category</option>
            <option value="addedBy">Added by</option>
            <option value="savedAt">Saved date</option>
          </select>
        </label>
        <button type="button" aria-label={sortConfig.direction === "asc" ? "Sort descending" : "Sort ascending"} title={sortConfig.direction === "asc" ? "Sort descending" : "Sort ascending"} onClick={() => toggleSort(sortConfig.key)}>{sortConfig.direction === "asc" ? "↑" : "↓"}</button>
      </div>
      {message && <p className="blog-admin-drafts-message" role="status">{message}</p>}
      <div className="blog-admin-drafts-table-wrap">
          <table className="blog-admin-drafts-table">
            <colgroup><col style={{ width: "32%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /><col style={{ width: "14%" }} /><col style={{ width: "30%" }} /></colgroup>
            <thead>
              <tr>
                {[['Blog post', 'title'], ['Category', 'category'], ['Added by', 'addedBy'], ['Saved', 'savedAt'], ['Actions', null]].map(([heading, key]) => <th className="blog-admin-drafts-th" key={heading} scope="col" aria-sort={key && sortConfig.key === key ? sortConfig.direction === "asc" ? "ascending" : "descending" : undefined}>{key ? <button className="blog-admin-drafts-sort" type="button" onClick={() => toggleSort(key)}>{heading} {sortConfig.key === key ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</button> : heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {drafts.length === 0 ? (
                <tr>
                  <td className="blog-admin-drafts-empty" colSpan="5">No saved drafts yet.</td>
                </tr>
              ) : sortedDrafts.map((draft) => (
                <tr key={draft.id}>
                  <td className="blog-admin-draft-title-cell"><strong>{draft.title || "Untitled draft"}</strong><span>{draft.excerpt || "No excerpt added."}</span></td>
                  <td className="blog-admin-draft-category-cell" data-label="Category"><span>{draft.category || "-"}</span></td>
                  <td className="blog-admin-draft-author-cell" data-label="Added by">{draft.addedBy || "Unknown username"}</td>
                  <td className="blog-admin-draft-date-cell" data-label="Saved">{formatIndiaDate(draft.savedAt)}</td>
                  <td className="blog-admin-draft-actions-cell" data-label="Actions">
                    <div>
                      <button className="blog-admin-draft-action blog-admin-draft-action--edit" type="button" aria-label="Edit" title="Edit" onClick={() => editDraft(draft)}><span aria-hidden="true">✎</span><span className="blog-admin-draft-action-text">Edit</span></button>
                      <button className="blog-admin-draft-action blog-admin-draft-action--publish" type="button" aria-label="Publish" title="Publish" onClick={() => publishDraft(draft.id)}><span aria-hidden="true">↗</span><span className="blog-admin-draft-action-text">Publish</span></button>
                      <button className="blog-admin-draft-action blog-admin-draft-action--delete" type="button" aria-label="Delete" title="Delete" onClick={() => deleteDraft(draft.id)}><span aria-hidden="true">×</span><span className="blog-admin-draft-action-text">Delete</span></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      </div>
    </section>
  );
}

function BlogPreview() {
  const location = useLocation();
  const search = location.search;
  const searchParams = new URLSearchParams(search);
  const [post, setPost] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const draftId = searchParams.get("draft");
    if (!draftId) return;
    axios.get(`${API_BASE_URL}/admin/blog/drafts/${draftId}`, { headers: blogDraftHeaders() })
      .then((response) => {
        const loadedPost = response.data?.draft || null;
        setPost(loadedPost);
        if (loadedPost?.title) document.title = `${loadedPost.title}_preview`;
      })
      .catch(() => setError("Unable to load blog preview."));
    return () => { document.title = "GFXunlimit"; };
  }, [search]);

  if (error) return <main style={{ minHeight: "100vh", padding: "64px 24px", textAlign: "center", color: "#991b1b" }}>{error}</main>;
  if (!post) return <main style={{ minHeight: "100vh", padding: "64px 24px", textAlign: "center", color: "#64748b" }}>Loading blog preview...</main>;

  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", color: "#0f172a" }}>
      <article style={{ width: "min(900px, 100%)", boxSizing: "border-box", margin: "0 auto", padding: "72px 28px 90px", background: "#fff" }}>
        <p style={{ margin: "0 0 12px", color: "#2563eb", fontSize: "0.78rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>{post.category || "Blog"}</p>
        <h1 style={{ margin: "0 0 16px", fontSize: "clamp(2rem, 5vw, 4rem)", lineHeight: 1.05 }}>{post.title || "Untitled blog"}</h1>
        <p style={{ margin: "0 0 26px", color: "#64748b", fontSize: "1.1rem", lineHeight: 1.6 }}>{post.excerpt}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", padding: "14px 0", borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontSize: "0.82rem" }}><span>By {post.author || post.addedBy || "Unknown author"}</span><span>{post.tags || ""}</span><span>Preview</span></div>
        <div style={{ marginTop: "32px", fontSize: "1.05rem", lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: renderRichTextContent(post.content) }} />
      </article>
    </main>
  );
}

const getBrowserAnalyticsId = (storageKey) => {
  if (typeof window === "undefined" || !window[storageKey]) return "";
  const storage = window[storageKey];
  const key = storageKey === "localStorage" ? "gfx-blog-visitor-id" : "gfx-blog-session-id";
  let value = storage.getItem(key);
  if (!value) {
    value = `${key}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    storage.setItem(key, value);
  }
  return value;
};

const trackBlogAnalyticsEvent = (eventType, post, metadata = {}) => {
  if (typeof window === "undefined" || typeof window.fetch !== "function" || !post?.id) return;
  window.fetch(`${API_BASE_URL}/analytics/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      eventType,
      blogId: post.id,
      visitorId: getBrowserAnalyticsId("localStorage"),
      sessionId: getBrowserAnalyticsId("sessionStorage"),
      pageUrl: window.location.href,
      referrer: document.referrer,
      deviceType: window.innerWidth < 768 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop",
      metadata,
    }),
  }).catch(() => {});
};

function PublicBlogDetailPage({ pathname }) {
  const { reportResource, retryKey, routeId } = useStartupReadiness();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    reportResource("publicBlogDetail", "loading", "", routeId);
    const normalized = (pathname || "").replace(/^\/+|\/+$/g, "");
    const segments = normalized.split("/").filter(Boolean);
    const slugWithId = segments.length > 2 ? segments[segments.length - 1] : "";
    const idMatch = slugWithId.match(/_(\d+)$/);
    const postId = idMatch ? Number(idMatch[1]) : null;

    if (!postId || !Number.isFinite(postId)) {
      setError("Blog post not found.");
      setLoading(false);
      reportResource("publicBlogDetail", "ready", "", routeId);
      return () => { active = false; };
    }

    axios.get(`${API_BASE_URL}/blog/posts/${postId}`)
      .then((response) => {
        if (!active) return;
        const nextPost = response.data?.post || null;
        if (!nextPost || typeof nextPost !== "object" || Array.isArray(nextPost)) {
          throw new Error("Blog post response was invalid.");
        }
        setPost(nextPost);
        setError("");
        reportResource("publicBlogDetail", "ready", "", routeId);
      })
      .catch((error) => {
        if (!active) return;
        if (error?.response?.status === 404) {
          setError("Blog post not found.");
          reportResource("publicBlogDetail", "ready", "", routeId);
        } else {
          console.error("Failed to load public blog post", error);
          setError("Unable to load blog post.");
          reportResource("publicBlogDetail", "error", "Unable to load this blog post. Please retry.", routeId);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [pathname, reportResource, retryKey, routeId]);

  useEffect(() => {
    if (!post) return undefined;
    trackBlogAnalyticsEvent("BLOG_VIEW", post);
    const trackedMilestones = new Set();
    const startedAt = Date.now();
    let readingTracked = false;
    const trackReadingTime = () => {
      if (readingTracked) return;
      readingTracked = true;
      trackBlogAnalyticsEvent("BLOG_READING_TIME", post, { duration_seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)) });
    };
    const handleScroll = () => {
      const documentHeight = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      const progress = Math.round((window.scrollY / documentHeight) * 100);
      [25, 50, 75, 90, 100].forEach((milestone) => {
        if (progress >= milestone && !trackedMilestones.has(milestone)) {
          trackedMilestones.add(milestone);
          trackBlogAnalyticsEvent("BLOG_SCROLL", post, { milestone });
        }
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") trackReadingTime();
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", trackReadingTime);
    return () => {
      trackReadingTime();
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", trackReadingTime);
    };
  }, [post]);

  const handleBlogContentClick = (event) => {
    const link = event.target.closest?.("a");
    if (!link) return;
    const destination = link.getAttribute("href") || "";
    const isInternal = destination.startsWith("/");
    trackBlogAnalyticsEvent(isInternal ? "INTERNAL_LINK_CLICK" : "EXTERNAL_LINK_CLICK", post, {
      link_text: link.textContent?.trim() || "",
      destination,
      link_type: isInternal ? "Internal" : "External",
    });
    if (isInternal && /\/(pricing|login|signup|register|stock-assets|assets|download)/i.test(destination)) {
      trackBlogAnalyticsEvent("BLOG_CTA_CLICK", post, { cta_text: link.textContent?.trim() || "", destination });
    }
  };

  if (loading) {
    return <main style={{ minHeight: "60vh", padding: "64px 24px", textAlign: "center", color: "#64748b" }}>Loading blog post...</main>;
  }

  if (error || !post) {
    return <main style={{ minHeight: "60vh", padding: "64px 24px", textAlign: "center", color: "#991b1b" }}>{error || "Blog post not found."}</main>;
  }

  return (
    <main className="public-blog-article-page" style={{ minHeight: "70vh" }}>
      <article className="public-blog-article" style={{ width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ marginBottom: "22px" }}>
          <a href="/blog" style={{ color: "#2563eb", fontSize: "0.82rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none" }}>← Back to blog</a>
        </div>
        <p className="public-blog-article__category" style={{ margin: "0 0 12px", color: "#2563eb", fontSize: "0.78rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>{post.category || "Blog"}</p>
        <h1 style={{ margin: "0 0 18px", fontSize: "clamp(2.2rem, 5vw, 4.4rem)", lineHeight: 1.08 }}>{post.title || "Untitled blog"}</h1>
        <p className="public-blog-article__excerpt" style={{ margin: "0 0 24px", color: "#64748b", fontSize: "1.08rem", lineHeight: 1.7 }}>{post.excerpt || "Read the latest from GFXunlimit."}</p>
        <div className="public-blog-article__meta" style={{ display: "flex", flexWrap: "wrap", gap: "12px 18px", padding: "14px 0", borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontSize: "0.82rem" }}>
          <span>By {post.author || post.addedBy || "GFXunlimit"}</span>
          <span>•</span>
          <time dateTime={post.publishAt || post.updatedAt}>{formatIndiaDate(post.publishAt || post.updatedAt)}</time>
        </div>
        <div className="public-blog-article__content" onClick={handleBlogContentClick} style={{ marginTop: "30px", fontSize: "1.06rem", lineHeight: 1.8, color: "#0f172a" }} dangerouslySetInnerHTML={{ __html: renderRichTextContent(post.content) }} />
      </article>
    </main>
  );
}

function PublicBlogPage({ darkMode }) {
  const { reportResource, retryKey, routeId } = useStartupReadiness();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const coverColors = ["#6d19c8", "#168be0", "#d81825", "#5213b5", "#13a8d8", "#d40fc8"];
  const pageSize = 10;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    reportResource("publicBlog", "loading", "", routeId);
    axios.get(`${API_BASE_URL}/blog/posts`)
      .then((response) => {
        if (!Array.isArray(response.data?.posts)) {
          throw new Error("Blog list response was invalid.");
        }
        if (!active) return;
        setPosts(response.data.posts);
        reportResource("publicBlog", "ready", "", routeId);
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load public blog posts", error);
        setLoadError("Unable to load blog posts.");
        reportResource("publicBlog", "error", "Unable to load blog posts. Please retry.", routeId);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [reportResource, retryKey, routeId]);

  const filteredPosts = posts.filter((post) => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return true;
    return [post.title, post.excerpt, post.category, post.tags, post.author, post.addedBy, post.content]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / pageSize));
  const pagePosts = filteredPosts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <main className="public-blog-list" aria-labelledby="public-blog-title" style={{ minHeight: "70vh" }}>
      <div style={{ width: "100%", margin: 0 }}>
        <div className="public-blog-list__header">
          <div className="public-blog-list__intro">
            <p style={{ margin: "0 0 8px", color: "#2563eb", fontSize: "0.78rem", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>GFXunlimit Journal</p>
            <h1 id="public-blog-title" style={{ margin: 0, fontSize: "clamp(2.3rem, 6vw, 4.8rem)", lineHeight: 1.02 }}>Latest from the blog</h1>
            <p style={{ maxWidth: "620px", margin: "16px 0 0", color: "#64748b", fontSize: "1.05rem", lineHeight: 1.6 }}>Ideas, stories, and practical inspiration from the creative community.</p>
          </div>
          <div className="public-blog-list__tools">
          <label className="public-blog-list__search" htmlFor="public-blog-search">Search blogs
            <input id="public-blog-search" type="search" value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setCurrentPage(1); }} placeholder="Search title, category, author, tags, or content" style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: "7px", background: "#fff", color: "#0f172a", fontSize: "0.9rem" }} />
          </label>
          <span className="public-blog-list__count" style={{ padding: "8px 12px", border: "1px solid #bbf7d0", borderRadius: "999px", background: "#f0fdf4", color: "#166534", fontSize: "0.8rem", fontWeight: 800 }}>{filteredPosts.length} {filteredPosts.length === 1 ? "post" : "posts"}</span>
          </div>
        </div>
        {loading ? <p style={{ color: "#64748b" }}>Loading latest posts...</p> : loadError ? <p role="alert" style={{ color: "#991b1b" }}>{loadError}</p> : posts.length === 0 ? <p style={{ color: "#64748b" }}>No published blog posts yet.</p> : filteredPosts.length === 0 ? <p style={{ color: "#64748b" }}>No blog posts match your search.</p> : <><div className="public-blog-list__grid">{pagePosts.map((post, index) => (
          <a className="public-blog-list__card" key={post.id} href={buildBlogPostUrl(post)} style={{ display: "block", minWidth: 0, border: "1px solid #e2e8f0", borderRadius: "3px", background: "#fff", boxShadow: "0 8px 20px rgba(15, 23, 42, 0.1)", textDecoration: "none", color: "inherit" }}>
            <article style={{ overflow: "hidden" }}>
              <div style={{ position: "relative", aspectRatio: "16 / 9", display: "grid", placeItems: "center", overflow: "hidden", background: post.coverImage || post.cover_image ? "#e2e8f0" : coverColors[index % coverColors.length] }}>
                {post.coverImage || post.cover_image ? <img src={post.coverImage || post.cover_image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ padding: "14px", color: "rgba(255,255,255,0.92)", fontSize: "0.72rem", fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", textAlign: "center" }}>GFXunlimit<br />Journal</span>}
              </div>
              <div style={{ minHeight: "164px", padding: "16px 18px 14px" }}>
                <p style={{ margin: "0 0 8px", color: "#64748b", fontSize: "0.62rem", fontWeight: 800, textTransform: "uppercase" }}>{post.category || "Blog"}</p>
                <h2 style={{ margin: 0, display: "-webkit-box", overflow: "hidden", color: "#1e293b", fontSize: "1rem", lineHeight: 1.2, WebkitBoxOrient: "vertical", WebkitLineClamp: 2 }}>{post.title || "Untitled post"}</h2>
                <p style={{ margin: "9px 0 14px", display: "-webkit-box", overflow: "hidden", color: "#64748b", fontSize: "0.78rem", lineHeight: 1.35, WebkitBoxOrient: "vertical", WebkitLineClamp: 2 }}>{post.excerpt || "Read the latest from GFXunlimit."}</p>
                <div style={{ display: "flex", gap: "5px", color: "#94a3b8", fontSize: "0.65rem" }}>
                  <span>By {post.author || post.addedBy || "GFXunlimit"}</span>
                  <span>on</span>
                  <time dateTime={post.publishAt || post.updatedAt}>{formatIndiaDate(post.publishAt || post.updatedAt)}</time>
                </div>
              </div>
            </article>
          </a>
        ))}</div>{totalPages > 1 && <Pagination currentPage={currentPage} totalPages={totalPages} totalImages={posts.length} setCurrentPage={setCurrentPage} darkMode={darkMode} totalLabel="Total Blogs" />}</>}
      </div>
    </main>
  );
}

function BlogPublished({ onEditPost, status = "published" }) {
  const isScheduled = status === "scheduled";
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [allPosts, setAllPosts] = useState([]);
  const [viewPost, setViewPostModal] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState({ key: "published", direction: "desc" });
  const [searchTerm, setSearchTerm] = useState("");
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const postsPerPage = 5;
  const setViewPost = (post) => {
    if (post) {
      navigate(buildBlogPostUrl(post));
    } else {
      setViewPostModal(null);
    }
  };

  useEffect(() => {
    if (!isScheduled) return undefined;
    const intervalId = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, [isScheduled]);

  useEffect(() => {
    let active = true;
    Promise.resolve(axios.get(`${API_BASE_URL}/admin/blog/drafts?status=${status}`, { headers: blogDraftHeaders() }))
      .then((response) => {
        if (active && Array.isArray(response.data?.drafts)) {
          const loadedPosts = sortPosts(response.data.drafts.map(normalizeBlogDraft), sortConfig);
          setAllPosts(loadedPosts);
          setPosts(loadedPosts.slice(0, postsPerPage));
          setCurrentPage(1);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const deletePost = async (id) => {
    if (!window.confirm(`Delete this ${isScheduled ? "scheduled" : "published"} blog? This action cannot be undone.`)) return;
    await axios.delete(`${API_BASE_URL}/admin/blog/drafts/${id}`, { headers: blogDraftHeaders() });
    const remainingPosts = allPosts.filter((post) => post.id !== id);
    setAllPosts(remainingPosts);
    setCurrentPage((page) => {
      const nextPage = Math.max(1, Math.min(page, Math.ceil(remainingPosts.length / postsPerPage) || 1));
      setPosts(remainingPosts.filter((post) => matchesSearch(post)).slice((nextPage - 1) * postsPerPage, nextPage * postsPerPage));
      return nextPage;
    });
  };

  const matchesSearch = (post, term = searchTerm) => {
    const normalizedTerm = String(term || "").trim().toLowerCase();
    if (!normalizedTerm) return true;
    return [post.title, post.excerpt, post.category, post.tags, post.author, post.addedBy, post.content]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedTerm);
  };
  const filteredPosts = allPosts.filter((post) => matchesSearch(post));
  const totalPages = Math.ceil(filteredPosts.length / postsPerPage);
  const changePage = (page) => {
    setCurrentPage(page);
    setPosts(filteredPosts.slice((page - 1) * postsPerPage, page * postsPerPage));
  };
  const sortPosts = (items, config) => [...items].sort((first, second) => {
    const firstValue = config.key === "published" ? new Date(first.publishAt || first.updatedAt || first.savedAt).getTime() : String(first[config.key] || "").toLowerCase();
    const secondValue = config.key === "published" ? new Date(second.publishAt || second.updatedAt || second.savedAt).getTime() : String(second[config.key] || "").toLowerCase();
    const comparison = typeof firstValue === "number" ? firstValue - secondValue : firstValue.localeCompare(secondValue);
    return config.direction === "asc" ? comparison : -comparison;
  });
  const sortBlogs = (key) => {
    const nextConfig = sortConfig.key === key
      ? { key, direction: sortConfig.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" };
    const sortedPosts = sortPosts(allPosts, nextConfig);
    setSortConfig(nextConfig);
    setAllPosts(sortedPosts);
    setCurrentPage(1);
    setPosts(sortedPosts.filter((post) => matchesSearch(post)).slice(0, postsPerPage));
  };

  return (
    <section className={`blog-admin-list-section blog-admin-published-section${isScheduled ? " is-scheduled" : ""}`} aria-labelledby="blog-published-title">
      <div className="blog-admin-published-header">
        <div className="blog-admin-published-heading">
          <p>{isScheduled ? "Publishing queue" : "Blog content"}</p>
          <h1 id="blog-published-title">{isScheduled ? "Scheduled Blogs" : "Published Blogs"}</h1>
          <span>{isScheduled ? "Upcoming articles, ready to reach your audience." : "Published blog posts visible to your audience."}</span>
        </div>
        <div className="blog-admin-published-tools">
          <label htmlFor="published-blog-search" className="blog-admin-published-search">Search blogs
            <input
              id="published-blog-search"
              type="search"
              value={searchTerm}
              onChange={(event) => {
                const nextTerm = event.target.value;
                const nextFilteredPosts = allPosts.filter((post) => matchesSearch(post, nextTerm));
                setSearchTerm(nextTerm);
                setCurrentPage(1);
                setPosts(nextFilteredPosts.slice(0, postsPerPage));
              }}
              placeholder="Search title, category, author, tags, or content"
            />
          </label>
          <span className="blog-admin-published-count">{filteredPosts.length} {filteredPosts.length === 1 ? "post" : "posts"}</span>
        </div>
      </div>
      <div className="blog-admin-published-mobile-sort">
        <label htmlFor="published-blog-sort">Sort posts
          <select id="published-blog-sort" value={sortConfig.key} onChange={(event) => sortBlogs(event.target.value)}>
            <option value="title">Blog post</option>
            <option value="category">Category</option>
            <option value="addedBy">Added by</option>
            <option value="published">{isScheduled ? "Scheduled date" : "Published date"}</option>
          </select>
        </label>
        <button
          type="button"
          aria-label={sortConfig.direction === "asc" ? "Sort descending" : "Sort ascending"}
          title={sortConfig.direction === "asc" ? "Sort descending" : "Sort ascending"}
          onClick={() => sortBlogs(sortConfig.key)}
        >
          {sortConfig.direction === "asc" ? "↑" : "↓"}
        </button>
      </div>
      <div className="blog-admin-published-table-wrap">
        <table className="blog-admin-published-table">
          <colgroup>
            <col style={{ width: "34%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "17%" }} />
          </colgroup>
          <thead>
            <tr>
              {[["Blog post", "title"], ["Category", "category"], ["Added by", "addedBy"], [isScheduled ? "Scheduled" : "Published", "published"], ["Actions", null]].map(([heading, key]) => (
                <th
                  key={heading}
                  scope="col"
                  aria-sort={key && sortConfig.key === key ? sortConfig.direction === "asc" ? "ascending" : "descending" : undefined}
                >
                  {key ? (
                    <button className="blog-admin-published-sort" type="button" onClick={() => sortBlogs(key)}>
                      {heading} {sortConfig.key === key ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}
                    </button>
                  ) : heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {posts.length === 0 ? (
              <tr>
                <td className="blog-admin-published-empty" colSpan="5">{isScheduled ? "No scheduled blogs yet." : "No published blogs yet."}</td>
              </tr>
            ) : posts.map((post, index) => {
              const timeLeft = isScheduled ? getScheduledTimeLeft(post.publishAt, currentTime) : null;
              return (
                <tr key={post.id} className={index % 2 ? "is-even" : undefined}>
                  <td className="blog-admin-published-title-cell">
                    {isScheduled ? (
                      <div className="blog-admin-scheduled-title-row">
                        <strong>{post.title || "Untitled post"}</strong>
                        <span className="blog-admin-scheduled-status"><span aria-hidden="true" />Scheduled</span>
                      </div>
                    ) : <strong>{post.title || "Untitled post"}</strong>}
                    <span>{post.excerpt || "No excerpt added."}</span>
                  </td>
                  <td className="blog-admin-published-category-cell" data-label="Category"><span>{post.category || "-"}</span></td>
                  <td className="blog-admin-published-author-cell" data-label="Added by">{post.addedBy || "Unknown username"}</td>
                  <td className={`blog-admin-published-date-cell${isScheduled ? " blog-admin-scheduled-date-cell" : ""}`} data-label={isScheduled ? "Scheduled" : "Published"}>
                    {isScheduled ? (
                      <div className="blog-admin-scheduled-date">
                        <span className="blog-admin-scheduled-date-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
                            <path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17" />
                          </svg>
                        </span>
                        <span>
                          <strong>{formatIndiaDate(post.publishAt || post.updatedAt || post.savedAt)}</strong>
                          <small>Scheduled for publication</small>
                          <span className={`blog-admin-scheduled-time-left is-${timeLeft?.state || "unavailable"}`}>
                            {timeLeft?.label || "Time unavailable"}
                          </span>
                        </span>
                      </div>
                    ) : formatIndiaDate(post.publishAt || post.updatedAt || post.savedAt)}
                  </td>
                  <td className="blog-admin-published-actions-cell" data-label="Actions">
                    <div className="blog-admin-published-actions">
                      <button
                        className="blog-admin-published-action blog-admin-published-action--view"
                        type="button"
                        onClick={() => setViewPost(post)}
                        aria-label={`View ${post.title || "published blog"}`}
                        title="View"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                          <circle cx="12" cy="12" r="2.5" />
                        </svg>
                        <span className="blog-admin-published-action-text">View</span>
                      </button>
                      <button
                        className="blog-admin-published-action blog-admin-published-action--edit"
                        type="button"
                        onClick={() => onEditPost(post)}
                        aria-label={`Edit ${post.title || "published blog"}`}
                        title="Edit"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m4 16.5-.8 3.8 3.8-.8L18.5 8a2.1 2.1 0 0 0-3-3L4 16.5Z" />
                          <path d="m14.5 6.5 3 3" />
                        </svg>
                        <span className="blog-admin-published-action-text">Edit</span>
                      </button>
                      <button
                        className="blog-admin-published-action blog-admin-published-action--delete"
                        type="button"
                        onClick={() => deletePost(post.id)}
                        aria-label={`Delete ${post.title || "published blog"}`}
                        title="Delete"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 7h16" />
                          <path d="M9 7V4.5h6V7" />
                          <path d="m7 7 .8 13h8.4L17 7" />
                          <path d="M10 11v5M14 11v5" />
                        </svg>
                        <span className="blog-admin-published-action-text">Delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && <Pagination currentPage={currentPage} totalPages={totalPages} totalImages={allPosts.length} setCurrentPage={changePage} darkMode={false} totalLabel="Total Blogs" />}
      {viewPost && (
        <div className="blog-admin-published-modal-backdrop" role="presentation" onClick={() => setViewPost(null)}>
          <article className="blog-admin-published-modal" role="dialog" aria-labelledby="published-blog-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="published-blog-title">{viewPost.title || "Untitled post"}</h2>
            <p>{viewPost.excerpt}</p>
            <div>{viewPost.content || "No content available."}</div>
            <button type="button" onClick={() => setViewPost(null)}>Close</button>
          </article>
        </div>
      )}
    </section>
  );
}

function FillTaxFormPage() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <TaxW8BenForm
      onBack={() => navigate("/dashboard?tab=starttaxform")}
      initialValues={location.state?.formData}
      onSubmit={(formData) => navigate("/dashboard?tab=filltaxform_review", { state: { formType: "W-8BEN", formData } })}
    />
  );
}

function FillTaxFormW9Page() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <TaxW9Form
      onBack={() => navigate("/dashboard?tab=starttaxform")}
      initialValues={location.state?.formData}
      onSubmit={(formData) => navigate("/dashboard?tab=filltaxform_review", { state: { formType: "W-9", formData } })}
    />
  );
}

function TaxFormReviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const formData = location.state?.formData || {};
  const formType = location.state?.formType || "Tax form";
  const readOnly = Boolean(location.state?.readOnly);
  const detailEntries = Object.entries(formData).filter(([key, value]) => {
    if (key === "certification" || key === "certifications") return false;
    if (value === null || value === undefined || value === "") return false;
    if (Array.isArray(value)) return false;
    return true;
  });
  const submitTaxForm = async () => {
    setIsSubmitting(true);
    setSubmitError("");
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      await axios.post(`${API_BASE_URL}/profile/tax-form`, { ...formData, formType }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      navigate("/dashboard?tab=taxcenter");
    } catch (error) {
      console.error("Failed to submit tax form", error);
      setSubmitError("Unable to submit your tax form. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="starttaxform-layout">
      <StartTaxFormMenu />
      <main className="tax-form-review-panel">
        <div className="tax-form-review-header">
          <div>
            <p className="tax-form-review-kicker">Tax form review</p>
            <h1>Review tax form</h1>
          </div>
          <div className="tax-form-review-actions">
            <button type="button" className="tax-form-review-back" onClick={() => navigate("/dashboard?tab=starttaxform")}>Back</button>
            {!readOnly && <button type="button" className="tax-form-review-submit" onClick={submitTaxForm} disabled={isSubmitting}>{isSubmitting ? "Submitting..." : "Submit"}</button>}
          </div>
        </div>

        <p className="tax-form-review-subtitle">Please confirm the details below before submitting your {formType} form.</p>
        {submitError && <p role="alert" className="tax-form-review-error">{submitError}</p>}

        <section className="tax-form-review-card">
          <h2>{formType}</h2>
          <dl className="tax-form-review-list">
            {detailEntries.map(([key, value]) => (
              <div key={key} className="tax-form-review-item">
                <dt>{key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase())}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  );
}

export default function AppRoutes(props) {
  const loc = useLocation();
  const navigate = useNavigate();
  const {
    auth,
    routeId,
    reportAvailability,
    availabilityRetryKey,
  } = useStartupReadiness();
  const pathname = (loc && loc.pathname) || (typeof window !== 'undefined' ? window.location.pathname : '/');
  const search = (loc && loc.search) ?? (typeof window !== 'undefined' ? window.location.search : '');
  const sessionRole = (
    auth?.status === "authenticated"
      ? auth.role || props.userRole
      : auth?.status === "anonymous"
        ? ""
        : props.userRole
  );
  const normalizedUserRole = String(sessionRole || "").trim();
  const isAdmin = isAdminRole(normalizedUserRole);
  const isVerifiedAdmin = auth?.status === "authenticated" && isAdminRole(auth.role);
  const promotionBannerMatch = pathname.match(/^\/promotionbanners\/([^/]+)\/?$/);
  const isPromotionBannerRoute = Boolean(promotionBannerMatch);
  const isSitemapRoute = pathname === "/sitemap" || pathname === "/sitemap/";
  let promotionBannerSlug = "";
  if (promotionBannerMatch) {
    try {
      promotionBannerSlug = decodeURIComponent(promotionBannerMatch[1]);
    } catch (error) {
      console.error("Invalid promotional banner URL", error);
    }
  }
  const [pageAvailability, setPageAvailability] = useState(null);
  const [blogSection, setBlogSection] = useState(() => new URLSearchParams(search).get("section") || "");
  const [blogDraftId, setBlogDraftId] = useState(() => new URLSearchParams(search).get("draft") || "");
  const [selectedBlogDraft, setSelectedBlogDraft] = useState(null);
  const adminBasePath = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";

  useEffect(() => {
    let active = true;
    const currentUrl = `${pathname}${search}`;
    axios.get(`${API_BASE_URL}/redirect-rules/resolve`, { params: { path: currentUrl } })
      .then(({ data }) => {
        if (!active || !data?.target || data.target === currentUrl) return;
        window.location.replace(data.target);
      })
      .catch((error) => {
        console.error("Unable to resolve redirect rules", error);
      });

    return () => {
      active = false;
    };
  }, [pathname, search]);

  useEffect(() => {
    let active = true;
    setPageAvailability(null);
    reportAvailability("loading", "", routeId);
    if (isPromotionBannerRoute || isSitemapRoute) {
      setPageAvailability({ pathname, available: true, sourcePath: "", disabledLinks: [] });
      reportAvailability("ready", "", routeId);
      return () => { active = false; };
    }
    axios.get(`${API_BASE_URL}/pages/availability`, { params: { path: `${pathname}${search}` } })
      .then(({ data }) => {
        if (typeof data?.available !== "boolean") {
          throw new Error("Page availability response was invalid.");
        }
        if (!Array.isArray(data.disabledLinks)) {
          throw new Error("Disabled link response was invalid.");
        }
        if (active) {
          setPageAvailability({
            pathname,
            available: isAdmin || data.available,
            sourcePath: data.path,
            disabledLinks: data.disabledLinks,
          });
          reportAvailability("ready", "", routeId);
        }
      })
      .catch((error) => {
        console.error("Unable to verify app page availability", error);
        if (active) {
          const message = "Unable to verify this page's availability. Please try again.";
          setPageAvailability({ pathname, error: message });
          reportAvailability("error", message, routeId);
        }
      });

    return () => { active = false; };
  }, [availabilityRetryKey, isAdmin, isPromotionBannerRoute, isSitemapRoute, pathname, reportAvailability, routeId, search]);

  useEffect(() => {
    if (pageAvailability?.pathname !== pathname || !pageAvailability.sourcePath) return undefined;

    const disabledLinkKeys = new Set(pageAvailability.disabledLinks.map((link) => (
      JSON.stringify([pageAvailability.sourcePath, link.href, link.linkText])
    )));
    const originalAttributes = new Map();
    const getAnchorText = (anchor) => String(
      anchor.innerText || anchor.textContent || anchor.getAttribute("aria-label") || anchor.title || ""
    ).trim().replace(/\s+/g, " ") || "Unlabeled link";
    const updateDisabledLinkMarkers = () => {
      document.querySelectorAll("a[href]").forEach((anchor) => {
        let href;
        try {
          href = new URL(anchor.href, window.location.origin).href;
        } catch {
          return;
        }
        const isDisabled = disabledLinkKeys.has(JSON.stringify([
          pageAvailability.sourcePath,
          href,
          getAnchorText(anchor),
        ]));
        if (isDisabled && !originalAttributes.has(anchor)) {
          originalAttributes.set(anchor, {
            ariaDisabled: anchor.getAttribute("aria-disabled"),
            title: anchor.getAttribute("title"),
            pointerEvents: anchor.style.pointerEvents,
            opacity: anchor.style.opacity,
            textDecoration: anchor.style.textDecoration,
          });
        }
        if (isDisabled) {
          anchor.dataset.appLinkDisabled = "true";
          anchor.setAttribute("aria-disabled", "true");
          anchor.setAttribute("title", "This link has been disabled.");
          anchor.style.pointerEvents = "none";
          anchor.style.opacity = "0.55";
          anchor.style.textDecoration = "line-through";
        }
      });
    };
    const preventDisabledLinkNavigation = (event) => {
      if (!event.target.closest?.('a[data-app-link-disabled="true"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const preventDisabledLinkKeyboardNavigation = (event) => {
      if (event.key === "Enter") preventDisabledLinkNavigation(event);
    };
    updateDisabledLinkMarkers();
    const observer = new MutationObserver(updateDisabledLinkMarkers);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["href"] });
    document.addEventListener("click", preventDisabledLinkNavigation, true);
    document.addEventListener("keydown", preventDisabledLinkKeyboardNavigation, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", preventDisabledLinkNavigation, true);
      document.removeEventListener("keydown", preventDisabledLinkKeyboardNavigation, true);
      document.querySelectorAll('a[data-app-link-disabled="true"]').forEach((anchor) => {
        const original = originalAttributes.get(anchor);
        delete anchor.dataset.appLinkDisabled;
        if (!original) return;
        if (original.ariaDisabled === null) anchor.removeAttribute("aria-disabled");
        else anchor.setAttribute("aria-disabled", original.ariaDisabled);
        if (original.title === null) anchor.removeAttribute("title");
        else anchor.setAttribute("title", original.title);
        anchor.style.pointerEvents = original.pointerEvents;
        anchor.style.opacity = original.opacity;
        anchor.style.textDecoration = original.textDecoration;
      });
    };
  }, [pageAvailability, pathname]);

  if (pathname === `${adminBasePath}/search_console`) {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <SearchConsolePage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/google_analytics`) {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <GoogleAnalyticsPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (isPromotionBannerRoute) {
    return <PromotionalBannerPage slug={promotionBannerSlug} userRole={normalizedUserRole} />;
  }
  if (isSitemapRoute) return <SitemapPage darkMode={props.darkMode} />;
  if (pathname === "/privacy" || pathname === "/privacy/") {
    return <Navigate to="/privacy-policy" replace />;
  }
  if (pathname === "/privacy-policy/") {
    return <Navigate to="/privacy-policy" replace />;
  }
  if (pathname === "/terms" || pathname === "/terms/") {
    return <Navigate to="/terms-and-conditions" replace />;
  }
  if (pathname === "/terms-and-conditions/") {
    return <Navigate to="/terms-and-conditions" replace />;
  }
  if (pathname === "/cookies" || pathname === "/cookies/") {
    return <Navigate to="/cookie-policy" replace />;
  }
  if (pathname === "/cookie-policy/") {
    return <Navigate to="/cookie-policy" replace />;
  }
  if (pathname === "/help" || pathname === "/help/") {
    return <Navigate to="/help-center" replace />;
  }
  if (pathname === "/help-center/") {
    return <Navigate to="/help-center" replace />;
  }

  if (!isAdmin && pageAvailability?.pathname !== pathname) {
    return <main aria-live="polite" aria-busy="true" style={{ minHeight: "60vh" }} />;
  }

  if (!isAdmin && pageAvailability?.error) {
    return <main role="alert" style={{ minHeight: "60vh", padding: "64px 24px", textAlign: "center", color: "#991b1b" }}>{pageAvailability.error}</main>;
  }

  if (!isAdmin && pageAvailability?.available === false) {
    return (
      <main role="status" style={{ minHeight: "60vh", display: "grid", placeContent: "center", padding: "40px 24px", textAlign: "center", color: "#334155" }}>
        <h1 style={{ margin: "0 0 10px", fontSize: "clamp(1.7rem, 4vw, 2.4rem)" }}>This page is temporarily unavailable</h1>
        <p style={{ margin: 0, color: "#64748b" }}>Please check back later.</p>
      </main>
    );
  }

  const dashboardTab = new URLSearchParams(search).get("tab");
  if (pathname === "/dashboard" && dashboardTab === "filltaxform1") {
    return <div className="starttaxform-layout"><StartTaxFormMenu /><FillTaxFormW9Page /></div>;
  }

  if (pathname === "/dashboard" && dashboardTab === "filltaxform") {
    return <div className="starttaxform-layout"><StartTaxFormMenu /><FillTaxFormPage /></div>;
  }

  if (pathname === "/dashboard" && dashboardTab === "filltaxform_review") {
    return <TaxFormReviewPage />;
  }

  if (pathname === "/dashboard" && dashboardTab === "starttaxform") {
    return <div className="starttaxform-layout"><StartTaxFormMenu /><StartTaxFormOptions /></div>;
  }

  const isExplorePath = pathname === "/explore" || /^\/explore\/\d+$/.test(pathname);
  const explorePaths = new Set(["/explore", "/search", "/photos", "/vectors", "/psd", "/psds", "/videos", "/templates"]);

  if (pathname === "/profile" && search.includes("tab=controls")) {
    return <Navigate to={`${adminBasePath}?tab=controls`} replace />;
  }

  const resolvedActivePage = resolveActivePage(pathname) || "home";

  if (isContributorRole(normalizedUserRole) && (explorePaths.has(pathname) || isExplorePath)) {
    return <Navigate to="/myuploads" replace />;
  }

  if (pathname === "/privacy-policy") return <PrivacyPolicyPage isAdmin={isVerifiedAdmin} />;
  if (pathname === "/terms-and-conditions") return <TermsAndConditionsPage isAdmin={isVerifiedAdmin} />;
  if (pathname === "/cookie-policy") return <CookiePolicyPage isAdmin={isVerifiedAdmin} />;
  if (pathname === "/help-center") return <HelpCenterPage isAdmin={isVerifiedAdmin} />;
  if (pathname === "/developers") return <DevelopersPage isAdmin={isVerifiedAdmin} />;
  if (pathname === "/partners") return <PartnersPage isAdmin={isVerifiedAdmin} />;
  if (pathname === "/about") return <CompanyPage slug="about" />;
  if (pathname === "/blog") return <PublicBlogPage darkMode={props.darkMode} />;
  if (pathname.startsWith("/blog/")) return <PublicBlogDetailPage pathname={pathname} />;
  if (pathname === "/pricing") return <CompanyPage slug="pricing" />;
  if (pathname === "/account-settings") return <AccountSettingsPage darkMode={props.darkMode} username={props.username} />;
  if (pathname === "/messages") {
    return (
      <ProtectedRoute allowedRoles={["customer", "buyer", "contributor", "admin"]} userRole={normalizedUserRole}>
        <MessagesPage darkMode={props.darkMode} userRole={normalizedUserRole} />
      </ProtectedRoute>
    );
  }
  if (pathname.startsWith("/c/c/c/c/")) return <PublicContributorPage darkMode={props.darkMode} username={decodeURIComponent(pathname.replace("/c/c/c/c/", ""))} />;
  if (pathname === "/public-profile") return <PublicProfilePage darkMode={props.darkMode} username={props.username} />;
  if (pathname === "/careers") return <CompanyPage slug="careers" />;
  if (pathname === "/contact") return <CompanyPage slug="contact" />;
  if (pathname === `${adminBasePath}/email/templates` || pathname === "/admin/email/templates") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminEmailTemplates />
      </ProtectedRoute>
    );
  }

  if (pathname === adminBasePath && new URLSearchParams(search).get("tab") === "controls_blog") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <div className="blog-admin-shell">
          <aside className="blog-admin-sidebar" aria-label="Blog menu">
            <div className="blog-admin-brand">
              <span className="blog-admin-brand-mark" aria-hidden="true">B</span>
              <div>
                <p>CONTENT STUDIO</p>
                <h2>Blog</h2>
              </div>
            </div>
            <p className="blog-admin-menu-label">Workspace</p>
            <nav className="blog-admin-menu">
              {[
                { label: "Dashboard", section: "dashboard" },
                { label: "Add New", section: "add-new" },
                { label: "Drafts", section: "drafts" },
                { label: "View", section: "view" },
                { label: "Schedule", section: "schedule" },
                { label: "Analytics", section: "analytics" }
              ].map((item) => (
                <button key={item.label} type="button" aria-current={blogSection === item.section ? "page" : undefined} className={`blog-admin-nav-link${blogSection === item.section ? " is-active" : ""}`} onClick={() => { setBlogSection(item.section); setBlogDraftId(""); setSelectedBlogDraft(null); window.history.pushState({}, "", `${adminBasePath}?tab=controls_blog&section=${item.section}`); }}>
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>
          <main className="blog-admin-content" aria-label="Blog content">
            {blogSection === "dashboard" ? <BlogDashboard /> : null}
            {blogSection === "add-new" ? <BlogAddNewForm adminBasePath={adminBasePath} initialDraft={selectedBlogDraft || (blogDraftId ? JSON.parse(window.localStorage.getItem(BLOG_DRAFTS_STORAGE_KEY) || "[]").find((draft) => String(draft.id) === String(blogDraftId)) : null)} /> : null}
            {blogSection === "blog_preview" ? <BlogPreview /> : null}
            {blogSection === "drafts" ? <BlogDrafts onEditDraft={(draft) => { setSelectedBlogDraft(draft); setBlogDraftId(draft.id); setBlogSection("add-new"); window.history.pushState({}, "", `${adminBasePath}?tab=controls_blog&section=add-new&draft=${draft.id}`); }} /> : null}
            {blogSection === "view" ? <BlogPublished onEditPost={(post) => { setSelectedBlogDraft(post); setBlogDraftId(post.id); setBlogSection("add-new"); window.history.pushState({}, "", `${adminBasePath}?tab=controls_blog&section=add-new&draft=${post.id}`); }} /> : null}
            {blogSection === "schedule" ? <BlogPublished status="scheduled" onEditPost={(post) => { setSelectedBlogDraft(post); setBlogDraftId(post.id); setBlogSection("add-new"); window.history.pushState({}, "", `${adminBasePath}?tab=controls_blog&section=add-new&draft=${post.id}`); }} /> : null}
            {blogSection === "analytics" ? <div className="blog-admin-analytics"><BlogAnalyticsPanel /></div> : null}
          </main>
        </div>
      </ProtectedRoute>
    );
  }

  if (pathname === adminBasePath && new URLSearchParams(search).get("tab") === "viewcontributor") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminContributorsPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/email/scheduled` || pathname === "/admin/email/scheduled") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminEmailScheduled />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/email/daily-report-settings` || pathname === "/admin/email/daily-report-settings") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminPage initialDailyReportSettingsPage />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/email/daily-report-preview` || pathname === "/admin/email/daily-report-preview") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminPage initialDailyReportPreviewPage />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/analytics` || pathname === "/admin/analytics") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminAnalyticsPage />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/commerce` || pathname === "/admin/commerce") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminCommercePage />
      </ProtectedRoute>
    );
  }

  if (pathname === `${adminBasePath}/orders` || pathname === "/admin/orders") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminOrdersPage />
      </ProtectedRoute>
    );
  }

  if (pathname === "/admin/customer-credits") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminCustomerCreditsPage />
      </ProtectedRoute>
    );
  }

  if (pathname === "/admin/subscribers") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminSubscribersPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/admin/custom-subscriptions") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminSubscribersPage
          darkMode={props.darkMode}
          pageTitle="Custom Subscriptions"
          pageSubtitle="Customer custom pricing requests and subscription approvals."
          pageMode="custom-requests"
        />
      </ProtectedRoute>
    );
  }

  if (pathname === "/admin/current-plans") {
    return (
      <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
        <AdminCurrentPlansPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/checkout/subscription") {
    return (
      <ProtectedRoute allowedRoles={["customer", "buyer", "admin"]} userRole={normalizedUserRole}>
        <SubscriptionCheckoutPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/orders" || pathname.startsWith("/orders/")) {
    return (
      <ProtectedRoute allowedRoles={["customer", "buyer", "contributor"]} userRole={normalizedUserRole}>
        <OrderHistoryPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/cart") {
    return (
      <ProtectedRoute allowedRoles={["customer", "buyer"]} userRole={normalizedUserRole}>
        <CartPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/checkout") {
    return (
      <ProtectedRoute allowedRoles={["customer", "buyer"]} userRole={normalizedUserRole}>
        <CheckoutPage darkMode={props.darkMode} />
      </ProtectedRoute>
    );
  }

  if (pathname === "/bulk-upload") {
    return (
      <ProtectedRoute
        allowedRoles={["contributor"]}
        allowedPermissions={["bulk_upload"]}
        userRole={normalizedUserRole}
        userPermissions={props.userPermissions}
        fallback={<Navigate to="/myuploads" replace />}
      >
        <BulkUploadPage darkMode={props.darkMode} username={props.username} />
      </ProtectedRoute>
    );
  }

  if (pathname.startsWith("/asset/")) {
    const assetSlug = pathname.replace("/asset/", "");
    const parts = assetSlug.split("-");
    const assetId = parts.length > 0 ? parts[parts.length - 1] : assetSlug;
    return <AssetPage imageId={assetId} darkMode={props.darkMode} />;
  }

  return (
    <>
      {/* HOME */}
      {resolvedActivePage === "home" && (
        <HomeSection
          homePageProps={props.homeSectionProps.homePageProps}
        />
      )}

      {/* EXPLORE */}
      {resolvedActivePage === "explore" && (
        <ExplorePage
          galleryProps={props.homeSectionProps.galleryProps}

          loading={props.homeSectionProps.containerProps.loading}

          filteredImages={props.homeSectionProps.containerProps.filteredImages}

          currentPage={props.homeSectionProps.containerProps.currentPage}

          totalPages={props.homeSectionProps.containerProps.totalPages}

          loadMoreImages={props.homeSectionProps.containerProps.loadMoreImages}

          hasMoreImages={props.homeSectionProps.containerProps.hasMoreImages}

          loadingMoreImages={props.homeSectionProps.containerProps.loadingMoreImages}

          loadMoreImagesError={props.homeSectionProps.containerProps.loadMoreImagesError}

          totalImages={props.homeSectionProps.containerProps.totalImages}

          setCurrentPage={props.homeSectionProps.containerProps.setCurrentPage}

          selectedImage={props.homeSectionProps.containerProps.selectedImage}

          setSelectedImage={props.homeSectionProps.containerProps.setSelectedImage}

          darkMode={props.homeSectionProps.containerProps.darkMode}

          relatedImages={props.homeSectionProps.containerProps.relatedImages}

          fetchSingleImage={props.homeSectionProps.containerProps.fetchSingleImage}

          goToPreviousImage={props.homeSectionProps.containerProps.goToPreviousImage}

          goToNextImage={props.homeSectionProps.containerProps.goToNextImage}

          likeImage={props.homeSectionProps.containerProps.likeImage}

          addFavorite={props.homeSectionProps.containerProps.addFavorite}

          downloadImage={props.homeSectionProps.containerProps.downloadImage}

          shareImage={props.homeSectionProps.containerProps.shareImage}

          selectedContributor={props.homeSectionProps.popupProps.selectedContributor}

          setSelectedContributor={props.homeSectionProps.popupProps.setSelectedContributor}

          contributorImages={props.homeSectionProps.popupProps.contributorImages}

          contributorLikes={props.homeSectionProps.popupProps.contributorLikes}

          contributorViews={props.homeSectionProps.popupProps.contributorViews}

          contributorDownloads={props.homeSectionProps.popupProps.contributorDownloads}

          contributorBestImage={props.homeSectionProps.popupProps.contributorBestImage}

          filtersOpen={props.exploreFiltersOpen}

          setFiltersOpen={props.setExploreFiltersOpen}
        />
      )}

      {/* DASHBOARD */}
      {(resolvedActivePage === "dashboard" || resolvedActivePage === "customer") && (
        <DashboardPage
          dashboardProps={props.dashboardProps}
          darkMode={props.darkMode}
          userRole={props.userRole}
        />
      )}

      {/* FAVORITES */}
      {resolvedActivePage === "favorites" && (
        <FavoritesPage
          darkMode={props.darkMode}
          username={props.username}
        />
      )}

      {/* DOWNLOADS */}
      {resolvedActivePage === "downloads" && (
        <DownloadsPage
          darkMode={props.darkMode}
          username={props.username}
        />
      )}

      {/* UPLOAD */}
      {resolvedActivePage === "upload" && (
        <UploadPage
          darkMode={props.darkMode}
          username={props.username}
          fetchImages={props.fetchImages}
        />
      )}

      {/* PROFILE */}
      {resolvedActivePage === "profile" && (
        <ProfilePage
          darkMode={props.darkMode}
          username={props.username}
        />
      )}
      {resolvedActivePage === "payments" && (
        <PaymentsPage darkMode={props.darkMode} />
      )}
      {resolvedActivePage === "myuploads" && (
        <MyUploadsPage darkMode={props.darkMode} />
      )}
      {resolvedActivePage === "admin" && (
        <ProtectedRoute allowedRoles={["admin"]} userRole={normalizedUserRole}>
          <AdminPage />
        </ProtectedRoute>
      )}
      {window.location.pathname === `${adminBasePath}/email/templates` && isAdminRole(normalizedUserRole) && (
        <AdminEmailTemplates />
      )}
      {resolvedActivePage === "contributor" && (
        <ProtectedRoute allowedRoles={["contributor"]} userRole={normalizedUserRole}>
          <ContributorPage dashboardProps={props.dashboardProps} />
        </ProtectedRoute>
      )}
    </>
  );
}