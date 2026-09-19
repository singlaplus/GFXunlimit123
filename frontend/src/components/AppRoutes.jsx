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

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const BLOG_DRAFTS_STORAGE_KEY = "gfx-blog-drafts";
const blogDraftHeaders = () => ({ Authorization: `Bearer ${getEffectiveAuthToken()}` });
const normalizeBlogDraft = (draft) => ({ ...draft, savedAt: draft.savedAt || draft.updatedAt || draft.createdAt });
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
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

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
    { label: "Total blogs", value: animatedCounts.total, color: "#2563eb" },
    { label: "Live", value: animatedCounts.total - animatedCounts.drafts - animatedCounts.scheduled, color: "#16a34a" },
    { label: "Drafts", value: animatedCounts.drafts, color: "#d97706" },
    { label: "Scheduled blogs", value: animatedCounts.scheduled, color: "#7c3aed" }
  ];

  return (
    <section aria-labelledby="blog-dashboard-title" style={{ width: "100%", boxSizing: "border-box", padding: "34px clamp(22px, 4vw, 48px) 48px", color: "#0f172a" }}>
      <p style={{ margin: "0 0 6px", color: "#64748b", fontSize: "0.75rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Blog content</p>
      <h1 id="blog-dashboard-title" style={{ margin: 0, fontSize: "2rem" }}>Blog Dashboard</h1>
      <p style={{ margin: "8px 0 0", color: "#64748b" }}>A quick view of your blog publishing pipeline.</p>
      {error && <p role="alert" style={{ margin: "24px 0 0", color: "#b91c1c", fontWeight: 700 }}>{error}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "16px", marginTop: "28px" }}>
        {cards.map((card) => (
          <article key={card.label} style={{ padding: "22px", border: "1px solid #e2e8f0", borderTop: `4px solid ${card.color}`, borderRadius: "8px", background: "#fff", boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)" }}>
            <p style={{ margin: 0, color: "#64748b", fontSize: "0.85rem", fontWeight: 800 }}>{card.label}</p>
            <p aria-label={`${card.label} count`} style={{ margin: "10px 0 0", color: "#0f172a", fontSize: "2rem", fontWeight: 800 }}>{loading ? "..." : card.value}</p>
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
        const scheduledTime = new Date(form.publishAt);
        if (!form.publishAt || Number.isNaN(scheduledTime.getTime()) || scheduledTime <= new Date()) {
          setMessage("Choose a future date and time to schedule this post.");
          return;
        }
      }
      const draftPayload = action === "schedule"
        ? { ...form, status: "scheduled", publishAt: new Date(form.publishAt).toISOString() }
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

    const inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", color: "#0f172a", font: "inherit" };
    const labelStyle = { display: "grid", gap: "6px", color: "#334155", fontSize: "0.85rem", fontWeight: 700 };

    return (
      <section aria-labelledby="add-blog-title" style={{ maxWidth: "980px", padding: "34px 42px 48px", color: "#0f172a" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "20px", marginBottom: "24px" }}>
          <div>
            <p style={{ margin: "0 0 6px", color: "#64748b", fontSize: "0.75rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Blog content</p>
            <h1 id="add-blog-title" style={{ margin: 0, fontSize: "2rem" }}>Add New Blog</h1>
            <p style={{ margin: "8px 0 0", color: "#64748b" }}>Create, schedule, and optimize a new article.</p>
          </div>
          <button type="button" onClick={(event) => submitForm(event, "preview")} style={{ padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", color: "#334155", fontWeight: 700, cursor: "pointer" }}>Preview</button>
        </div>
        <form onSubmit={(event) => submitForm(event, "save")} style={{ display: "grid", gap: "18px" }}>
          <label style={labelStyle}>Title<input name="title" value={form.title} onChange={updateField} placeholder="Enter a compelling title" required style={inputStyle} /></label>
          <label style={labelStyle}>Slug<input name="slug" value={form.slug} onChange={updateField} placeholder="your-blog-post-slug" style={inputStyle} /></label>
          <label style={labelStyle}>Excerpt<textarea name="excerpt" value={form.excerpt} onChange={updateField} placeholder="Short summary shown in blog listings" rows="3" style={{ ...inputStyle, resize: "vertical" }} /></label>
          <label style={labelStyle}>Content<RichTextEditor value={form.content} onChange={updateField} placeholder="Write your blog content here..." required /></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "18px" }}>
            <label style={labelStyle}>Cover image<input name="coverImage" type="file" accept="image/*" onChange={updateField} style={{ ...inputStyle, padding: "8px" }} /></label>
            <label style={labelStyle}>Author<input name="author" value={form.author} onChange={updateField} placeholder="Author name" style={inputStyle} /></label>
            <label style={labelStyle}>Category<input name="category" value={form.category} onChange={updateField} placeholder="News, tutorials, inspiration..." style={inputStyle} /></label>
            <label style={labelStyle}>Tags<input name="tags" value={form.tags} onChange={updateField} placeholder="Separate tags with commas" style={inputStyle} /></label>
          </div>
          <fieldset style={{ display: "grid", gap: "10px", margin: 0, padding: "14px", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
            <legend style={{ padding: "0 6px", color: "#334155", fontSize: "0.85rem", fontWeight: 700 }}>Post settings</legend>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "#334155", fontSize: "0.9rem" }}><input name="allowComments" type="checkbox" checked={form.allowComments} onChange={updateField} /> Allow comments</label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "#334155", fontSize: "0.9rem" }}><input name="featured" type="checkbox" checked={form.featured} onChange={updateField} /> Feature this post</label>
          </fieldset>
          <div style={{ display: "grid", gap: "12px" }}>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>Search appearance</h2>
            <label style={labelStyle}>SEO title<input name="seoTitle" value={form.seoTitle} onChange={updateField} placeholder="Search-friendly title" style={inputStyle} /></label>
            <label style={labelStyle}>SEO description<textarea name="seoDescription" value={form.seoDescription} onChange={updateField} placeholder="Description for search engines" rows="3" style={{ ...inputStyle, resize: "vertical" }} /></label>
          </div>
          {scheduleOpen && <div style={{ display: "flex", alignItems: "end", gap: "10px", padding: "14px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#f8fafc" }}>
            <label style={{ ...labelStyle, flex: "1 1 260px" }}>Schedule publish date and time<input aria-label="Schedule publish date and time" name="publishAt" type="datetime-local" value={form.publishAt} onChange={updateField} min={formatDateTimeLocal(new Date())} style={inputStyle} /></label>
            <button type="button" onClick={() => setScheduleOpen(false)} style={{ padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#fff", color: "#334155", fontWeight: 700, cursor: "pointer" }}>Done</button>
          </div>}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", paddingTop: "4px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
              <button type="submit" style={{ padding: "11px 18px", border: 0, borderRadius: "6px", background: "#1976d2", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Save Draft</button>
              <button type="button" onClick={(event) => submitForm(event, form.publishAt ? "schedule" : "publish")} style={{ padding: "11px 18px", border: 0, borderRadius: "6px", background: "#2e7d32", color: "#fff", fontWeight: 800, cursor: "pointer" }}>{form.publishAt ? "Schedule Publish" : "Publish"}</button>
              {message && <span role="status" style={{ color: "#166534", fontSize: "0.9rem", fontWeight: 700 }}>{message}</span>}
            </div>
            <button type="button" onClick={() => setScheduleOpen((current) => !current)} style={{ padding: "11px 18px", border: "1px solid #1976d2", borderRadius: "6px", background: "#fff", color: "#1976d2", fontWeight: 800, cursor: "pointer" }}>{scheduleOpen ? "Close Schedule" : "Schedule"}</button>
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
    <section aria-labelledby="blog-drafts-title" style={{ width: "100%", boxSizing: "border-box", padding: "34px clamp(22px, 4vw, 48px) 48px", color: "#0f172a" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "end", gap: "20px", marginBottom: "22px" }}>
        <div>
          <p style={{ margin: "0 0 6px", color: "#64748b", fontSize: "0.75rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Blog content</p>
          <h1 id="blog-drafts-title" style={{ margin: 0, fontSize: "2rem" }}>Drafts</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b" }}>Saved blog drafts appear here until they are ready to publish.</p>
        </div>
        <label htmlFor="draft-blog-search" style={{ display: "grid", gap: "6px", width: "min(360px, 32vw)", minWidth: "220px", color: "#334155", fontSize: "0.82rem", fontWeight: 800 }}>Search blogs
          <input id="draft-blog-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search title, category, author, tags, or content" style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: "7px", background: "#fff", color: "#0f172a", fontSize: "0.9rem" }} />
        </label>
        <span style={{ padding: "8px 12px", border: "1px solid #bbf7d0", borderRadius: "999px", background: "#f0fdf4", color: "#166534", fontSize: "0.8rem", fontWeight: 800 }}>{filteredDrafts.length} {filteredDrafts.length === 1 ? "draft" : "drafts"}</span>
      </div>
      {message && <p role="status" style={{ margin: "0 0 14px", color: "#166534", fontWeight: 700 }}>{message}</p>}
      <div style={{ width: "100%", overflowX: "auto", border: "1px solid #dbe3ee", borderRadius: "10px", background: "#fff", boxShadow: "0 14px 34px rgba(15, 23, 42, 0.08)" }}>
          <table style={{ width: "100%", minWidth: "700px", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup><col style={{ width: "38%" }} /><col style={{ width: "13%" }} /><col style={{ width: "14%" }} /><col style={{ width: "11%" }} /><col style={{ width: "24%" }} /></colgroup>
            <thead>
              <tr style={{ background: "#0f172a", color: "#e2e8f0" }}>
                {[['Blog post', 'title'], ['Category', 'category'], ['Added by', 'addedBy'], ['Saved', 'savedAt'], ['Actions', null]].map(([heading, key]) => <th key={heading} scope="col" aria-sort={key && sortConfig.key === key ? sortConfig.direction === "asc" ? "ascending" : "descending" : undefined} style={{ padding: "14px 16px", textAlign: "left", fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>{key ? <button type="button" onClick={() => toggleSort(key)} style={{ padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", letterSpacing: "inherit", textTransform: "inherit", cursor: "pointer" }}>{heading} {sortConfig.key === key ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</button> : heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {drafts.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ height: "190px", padding: "28px", textAlign: "center", color: "#64748b", fontSize: "0.9rem" }}>No saved drafts yet.</td>
                </tr>
              ) : sortedDrafts.map((draft, index) => (
                <tr key={draft.id} style={{ background: index % 2 ? "#f8fafc" : "#fff", borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "17px 16px", verticalAlign: "top" }}><strong style={{ display: "block", color: "#0f172a", fontSize: "0.95rem" }}>{draft.title || "Untitled draft"}</strong><span style={{ display: "block", marginTop: "5px", overflow: "hidden", color: "#64748b", fontSize: "0.82rem", lineHeight: 1.4, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{draft.excerpt || "No excerpt added."}</span></td>
                  <td style={{ padding: "17px 16px", verticalAlign: "top", color: "#475569", fontSize: "0.84rem" }}>{draft.category || "-"}</td>
                  <td style={{ padding: "17px 16px", verticalAlign: "top", color: "#334155", fontSize: "0.84rem", fontWeight: 700 }}>{draft.addedBy || "Unknown username"}</td>
                  <td style={{ padding: "17px 16px", verticalAlign: "top", color: "#64748b", fontSize: "0.78rem" }}>{new Date(draft.savedAt).toLocaleDateString()}</td>
                  <td style={{ padding: "14px 16px", verticalAlign: "top" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                      <button type="button" aria-label="Edit" title="Edit" onClick={() => editDraft(draft)} style={{ width: "42px", height: "38px", border: "1px solid #bfdbfe", borderRadius: "6px", background: "#eff6ff", color: "#1d4ed8", fontSize: "1.15rem", fontWeight: 800, cursor: "pointer" }}>✎</button>
                      <button type="button" aria-label="Publish" title="Publish" onClick={() => publishDraft(draft.id)} style={{ width: "42px", height: "38px", border: 0, borderRadius: "6px", background: "#2e7d32", color: "#fff", fontSize: "1.15rem", fontWeight: 800, cursor: "pointer" }}>↗</button>
                      <button type="button" aria-label="Delete" title="Delete" onClick={() => deleteDraft(draft.id)} style={{ width: "42px", height: "38px", border: "1px solid #fecaca", borderRadius: "6px", background: "#fff", color: "#b91c1c", fontSize: "1.15rem", fontWeight: 800, cursor: "pointer" }}>×</button>
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
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const normalized = (pathname || "").replace(/^\/+|\/+$/g, "");
    const segments = normalized.split("/").filter(Boolean);
    const slugWithId = segments.length > 2 ? segments[segments.length - 1] : "";
    const idMatch = slugWithId.match(/_(\d+)$/);
    const postId = idMatch ? Number(idMatch[1]) : null;

    if (!postId || !Number.isFinite(postId)) {
      setError("Blog post not found.");
      setLoading(false);
      return;
    }

    axios.get(`${API_BASE_URL}/blog/posts/${postId}`)
      .then((response) => {
        const nextPost = response.data?.post || null;
        setPost(nextPost);
        setError(nextPost ? "" : "Blog post not found.");
      })
      .catch(() => setError("Blog post not found."))
      .finally(() => setLoading(false));
  }, [pathname]);

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
    <main style={{ minHeight: "70vh", background: "#f8fafc", color: "#0f172a" }}>
      <article style={{ width: "min(900px, 100%)", margin: "0 auto", padding: "72px 24px 90px", boxSizing: "border-box" }}>
        <div style={{ marginBottom: "22px" }}>
          <a href="/blog" style={{ color: "#2563eb", fontSize: "0.82rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none" }}>← Back to blog</a>
        </div>
        <p style={{ margin: "0 0 12px", color: "#2563eb", fontSize: "0.78rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>{post.category || "Blog"}</p>
        <h1 style={{ margin: "0 0 18px", fontSize: "clamp(2.2rem, 5vw, 4.4rem)", lineHeight: 1.08 }}>{post.title || "Untitled blog"}</h1>
        <p style={{ margin: "0 0 24px", color: "#64748b", fontSize: "1.08rem", lineHeight: 1.7 }}>{post.excerpt || "Read the latest from GFXunlimit."}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 18px", padding: "14px 0", borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontSize: "0.82rem" }}>
          <span>By {post.author || post.addedBy || "GFXunlimit"}</span>
          <span>•</span>
          <time dateTime={post.publishAt || post.updatedAt}>{new Date(post.publishAt || post.updatedAt).toLocaleDateString()}</time>
        </div>
        <div onClick={handleBlogContentClick} style={{ marginTop: "30px", fontSize: "1.06rem", lineHeight: 1.8, color: "#0f172a" }} dangerouslySetInnerHTML={{ __html: renderRichTextContent(post.content) }} />
      </article>
    </main>
  );
}

function PublicBlogPage() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const coverColors = ["#6d19c8", "#168be0", "#d81825", "#5213b5", "#13a8d8", "#d40fc8"];
  const pageSize = 10;

  useEffect(() => {
    axios.get(`${API_BASE_URL}/blog/posts`)
      .then((response) => setPosts(Array.isArray(response.data?.posts) ? response.data.posts : []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

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
    <main aria-labelledby="public-blog-title" style={{ minHeight: "70vh", padding: "42px 18px 72px", background: "#f8fafc", color: "#0f172a" }}>
      <div style={{ width: "100%", margin: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", justifyContent: "space-between", gap: "28px", marginBottom: "38px" }}>
          <div>
            <p style={{ margin: "0 0 8px", color: "#2563eb", fontSize: "0.78rem", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>GFXunlimit Journal</p>
            <h1 id="public-blog-title" style={{ margin: 0, fontSize: "clamp(2.3rem, 6vw, 4.8rem)", lineHeight: 1.02 }}>Latest from the blog</h1>
            <p style={{ maxWidth: "620px", margin: "16px 0 0", color: "#64748b", fontSize: "1.05rem", lineHeight: 1.6 }}>Ideas, stories, and practical inspiration from the creative community.</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: "12px" }}>
          <label htmlFor="public-blog-search" style={{ display: "grid", gap: "6px", width: "min(360px, 32vw)", minWidth: "220px", color: "#334155", fontSize: "0.82rem", fontWeight: 800 }}>Search blogs
            <input id="public-blog-search" type="search" value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setCurrentPage(1); }} placeholder="Search title, category, author, tags, or content" style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: "7px", background: "#fff", color: "#0f172a", fontSize: "0.9rem" }} />
          </label>
          <span style={{ padding: "8px 12px", border: "1px solid #bbf7d0", borderRadius: "999px", background: "#f0fdf4", color: "#166534", fontSize: "0.8rem", fontWeight: 800 }}>{filteredPosts.length} {filteredPosts.length === 1 ? "post" : "posts"}</span>
          </div>
        </div>
        {loading ? <p style={{ color: "#64748b" }}>Loading latest posts...</p> : posts.length === 0 ? <p style={{ color: "#64748b" }}>No published blog posts yet.</p> : filteredPosts.length === 0 ? <p style={{ color: "#64748b" }}>No blog posts match your search.</p> : <><div style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "18px" }}>{pagePosts.map((post, index) => (
          <a key={post.id} href={buildBlogPostUrl(post)} style={{ display: "block", minWidth: 0, border: "1px solid #e2e8f0", borderRadius: "3px", background: "#fff", boxShadow: "0 8px 20px rgba(15, 23, 42, 0.1)", textDecoration: "none", color: "inherit" }}>
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
                  <time dateTime={post.publishAt || post.updatedAt}>{new Date(post.publishAt || post.updatedAt).toLocaleDateString()}</time>
                </div>
              </div>
            </article>
          </a>
        ))}</div>{totalPages > 1 && <Pagination currentPage={currentPage} totalPages={totalPages} totalImages={posts.length} setCurrentPage={setCurrentPage} darkMode={false} />}</>}
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
  const postsPerPage = 5;
  const setViewPost = (post) => {
    if (post) {
      navigate(buildBlogPostUrl(post));
    } else {
      setViewPostModal(null);
    }
  };

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
    <section aria-labelledby="blog-published-title" style={{ width: "100%", boxSizing: "border-box", padding: "34px clamp(22px, 4vw, 48px) 48px", color: "#0f172a" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: "20px", marginBottom: "22px" }}>
        <div>
          <p style={{ margin: "0 0 6px", color: "#64748b", fontSize: "0.75rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Blog content</p>
          <h1 id="blog-published-title" style={{ margin: 0, fontSize: "2rem" }}>{isScheduled ? "Scheduled Blogs" : "Published Blogs"}</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b" }}>{isScheduled ? "Blog posts queued for future publication." : "Published blog posts visible to your audience."}</p>
        </div>
        <label htmlFor="published-blog-search" style={{ display: "grid", gap: "6px", width: "min(360px, 32vw)", minWidth: "220px", color: "#334155", fontSize: "0.82rem", fontWeight: 800 }}>Search blogs
          <input id="published-blog-search" type="search" value={searchTerm} onChange={(event) => { const nextTerm = event.target.value; const nextFilteredPosts = allPosts.filter((post) => matchesSearch(post, nextTerm)); setSearchTerm(nextTerm); setCurrentPage(1); setPosts(nextFilteredPosts.slice(0, postsPerPage)); }} placeholder="Search title, category, author, tags, or content" style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: "7px", background: "#fff", color: "#0f172a", fontSize: "0.9rem" }} />
        </label>
        <span style={{ padding: "8px 12px", border: "1px solid #bbf7d0", borderRadius: "999px", background: "#f0fdf4", color: "#166534", fontSize: "0.8rem", fontWeight: 800 }}>{filteredPosts.length} {filteredPosts.length === 1 ? "post" : "posts"}</span>
      </div>
      <div style={{ width: "100%", overflowX: "auto", border: "1px solid #dbe3ee", borderRadius: "10px", background: "#fff", boxShadow: "0 14px 34px rgba(15, 23, 42, 0.08)" }}>
        <table style={{ width: "100%", minWidth: "820px", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup><col style={{ width: "34%" }} /><col style={{ width: "16%" }} /><col style={{ width: "16%" }} /><col style={{ width: "17%" }} /><col style={{ width: "17%" }} /></colgroup>
          <thead><tr style={{ background: "#0f172a", color: "#e2e8f0" }}>{[["Blog post", "title"], ["Category", "category"], ["Added by", "addedBy"], ["Published", "published"], ["Actions", null]].map(([heading, key]) => <th key={heading} scope="col" aria-sort={key && sortConfig.key === key ? sortConfig.direction === "asc" ? "ascending" : "descending" : undefined} style={{ padding: "14px 16px", textAlign: "left", fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>{key ? <button type="button" onClick={() => sortBlogs(key)} style={{ padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}>{heading} {sortConfig.key === key ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</button> : heading}</th>)}</tr></thead>
          <tbody>{posts.length === 0 ? <tr><td colSpan="5" style={{ height: "190px", padding: "28px", textAlign: "center", color: "#64748b", fontSize: "0.9rem" }}>No published blogs yet.</td></tr> : posts.map((post, index) => <tr key={post.id} style={{ background: index % 2 ? "#f8fafc" : "#fff", borderTop: "1px solid #e2e8f0" }}><td style={{ padding: "17px 16px", verticalAlign: "top" }}><strong style={{ display: "block", fontSize: "0.95rem" }}>{post.title || "Untitled post"}</strong><span style={{ display: "block", marginTop: "5px", overflow: "hidden", color: "#64748b", fontSize: "0.82rem", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.excerpt || "No excerpt added."}</span></td><td style={{ padding: "17px 16px", verticalAlign: "top", color: "#475569", fontSize: "0.84rem" }}>{post.category || "-"}</td><td style={{ padding: "17px 16px", verticalAlign: "top", color: "#334155", fontSize: "0.84rem", fontWeight: 700 }}>{post.addedBy || "Unknown username"}</td><td style={{ padding: "17px 16px", verticalAlign: "top", color: "#64748b", fontSize: "0.78rem" }}>{new Date(post.publishAt || post.updatedAt || post.savedAt).toLocaleDateString()}</td><td style={{ padding: "14px 16px", verticalAlign: "top" }}><div style={{ display: "flex", gap: "7px" }}><button type="button" onClick={() => setViewPost(post)} aria-label={`View ${post.title || "published blog"}`} title="View" style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", border: "1px solid #cbd5e1", borderRadius: "7px", background: "#fff", color: "#334155", cursor: "pointer" }}><svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg></button><button type="button" onClick={() => onEditPost(post)} aria-label={`Edit ${post.title || "published blog"}`} title="Edit" style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", border: "1px solid #bfdbfe", borderRadius: "7px", background: "#eff6ff", color: "#1d4ed8", cursor: "pointer" }}><svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m4 16.5-.8 3.8 3.8-.8L18.5 8a2.1 2.1 0 0 0-3-3L4 16.5Z" /><path d="m14.5 6.5 3 3" /></svg></button><button type="button" onClick={() => deletePost(post.id)} aria-label={`Delete ${post.title || "published blog"}`} title="Delete" style={{ width: "34px", height: "34px", display: "grid", placeItems: "center", border: "1px solid #fecaca", borderRadius: "7px", background: "#fff", color: "#b91c1c", cursor: "pointer" }}><svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16" /><path d="M9 7V4.5h6V7" /><path d="m7 7 .8 13h8.4L17 7" /><path d="M10 11v5M14 11v5" /></svg></button></div></td></tr>)}</tbody>
        </table>
      </div>
      {totalPages > 1 && <Pagination currentPage={currentPage} totalPages={totalPages} totalImages={allPosts.length} setCurrentPage={changePage} darkMode={false} />}
      {viewPost && <div role="presentation" onClick={() => setViewPost(null)} style={{ position: "fixed", inset: 0, zIndex: 20, display: "grid", placeItems: "center", padding: "24px", background: "rgba(15, 23, 42, 0.55)" }}><article role="dialog" aria-labelledby="published-blog-title" onClick={(event) => event.stopPropagation()} style={{ width: "min(760px, 100%)", maxHeight: "80vh", overflow: "auto", padding: "28px", borderRadius: "10px", background: "#fff", color: "#0f172a" }}><h2 id="published-blog-title" style={{ margin: "0 0 8px" }}>{viewPost.title || "Untitled post"}</h2><p style={{ color: "#64748b" }}>{viewPost.excerpt}</p><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{viewPost.content || "No content available."}</div><button type="button" onClick={() => setViewPost(null)} style={{ marginTop: "22px", padding: "9px 14px", border: 0, borderRadius: "6px", background: "#0f172a", color: "#fff", cursor: "pointer" }}>Close</button></article></div>}
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
  const pathname = (loc && loc.pathname) || (typeof window !== 'undefined' ? window.location.pathname : '/');
  const search = (loc && loc.search) || (typeof window !== 'undefined' ? window.location.search : '');
  const [blogSection, setBlogSection] = useState(() => new URLSearchParams(search).get("section") || "");
  const [blogDraftId, setBlogDraftId] = useState(() => new URLSearchParams(search).get("draft") || "");
  const [selectedBlogDraft, setSelectedBlogDraft] = useState(null);

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

  const adminBasePath = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
  const explorePaths = new Set(["/explore", "/search", "/photos", "/vectors", "/psd", "/psds", "/videos", "/templates"]);

  if (pathname === "/profile" && search.includes("tab=controls")) {
    return <Navigate to={`${adminBasePath}?tab=controls`} replace />;
  }

  const normalizedUserRole = (props.userRole || "").toString();
  const resolvedActivePage = resolveActivePage(pathname) || "home";

  if (isContributorRole(normalizedUserRole) && explorePaths.has(pathname)) {
    return <Navigate to="/myuploads" replace />;
  }

  if (pathname === "/about") return <CompanyPage slug="about" />;
  if (pathname === "/blog") return <PublicBlogPage />;
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
        <div style={{ display: "flex", minHeight: "calc(100vh - 80px)", background: "#f8fafc" }}>
          <aside aria-label="Blog menu" style={{ width: "220px", flex: "0 0 220px", padding: "24px 14px", boxSizing: "border-box", background: "#0f172a", color: "#f8fafc" }}>
            <h2 style={{ margin: "0 10px 20px", fontSize: "1.1rem" }}>Blog</h2>
            <nav style={{ display: "grid", gap: "6px" }}>
              {[
                { label: "Dashboard", section: "dashboard" },
                { label: "Add New", section: "add-new" },
                { label: "Drafts", section: "drafts" },
                { label: "View", section: "view" },
                { label: "Schedule", section: "schedule" },
                { label: "Analytics", section: "analytics" }
              ].map((item) => (
                <button key={item.label} type="button" onClick={() => { setBlogSection(item.section); setBlogDraftId(""); setSelectedBlogDraft(null); window.history.pushState({}, "", `${adminBasePath}?tab=controls_blog&section=${item.section}`); }} style={{ display: "block", width: "100%", padding: "10px", border: 0, borderRadius: "6px", background: "transparent", color: "#e2e8f0", textAlign: "left", fontSize: "0.95rem", cursor: "pointer" }}>
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>
          <main aria-label="Blog content" style={{ flex: 1 }}>
            {blogSection === "dashboard" ? <BlogDashboard /> : null}
            {blogSection === "add-new" ? <BlogAddNewForm adminBasePath={adminBasePath} initialDraft={selectedBlogDraft || (blogDraftId ? JSON.parse(window.localStorage.getItem(BLOG_DRAFTS_STORAGE_KEY) || "[]").find((draft) => String(draft.id) === String(blogDraftId)) : null)} /> : null}
            {blogSection === "blog_preview" ? <BlogPreview /> : null}
            {blogSection === "drafts" ? <BlogDrafts onEditDraft={(draft) => { setSelectedBlogDraft(draft); setBlogDraftId(draft.id); setBlogSection("add-new"); window.history.pushState({}, "", `${adminBasePath}?tab=controls_blog&section=add-new&draft=${draft.id}`); }} /> : null}
            {blogSection === "view" ? <BlogPublished onEditPost={(post) => { setSelectedBlogDraft(post); setBlogDraftId(post.id); setBlogSection("add-new"); window.history.pushState({}, "", `${adminBasePath}?tab=controls_blog&section=add-new&draft=${post.id}`); }} /> : null}
            {blogSection === "schedule" ? <BlogPublished status="scheduled" onEditPost={(post) => { setSelectedBlogDraft(post); setBlogDraftId(post.id); setBlogSection("add-new"); window.history.pushState({}, "", `${adminBasePath}?tab=controls_blog&section=add-new&draft=${post.id}`); }} /> : null}
            {blogSection === "analytics" ? <div style={{ padding: "34px clamp(22px, 4vw, 48px) 48px" }}><BlogAnalyticsPanel /></div> : null}
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
        <PaymentsPage />
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