import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { buildAuthHeaders } from "../utils/authSession";
import PrivacyPolicyEditor from "./PrivacyPolicyEditor";
import { copyPrivacyPolicyContent, DEFAULT_PRIVACY_POLICY_CONTENT } from "./privacyPolicyContent";
import "./PrivacyPolicyPage.css";

const PRIVACY_POLICY_PAGE_CONFIG = {
  pageName: "Privacy Policy",
  contentPath: "privacy-policy",
  sectionLabel: "Policy sections",
  dateLabel: "Last updated",
  datePrefix: "Last updated:",
  summaryCardLabel: "Show privacy summary card",
  defaultContent: DEFAULT_PRIVACY_POLICY_CONTENT,
  copyContent: copyPrivacyPolicyContent
};

function formatUpdatedAt(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

export default function PrivacyPolicyPage({ isAdmin = false, pageConfig = PRIVACY_POLICY_PAGE_CONFIG }) {
  const [content, setContent] = useState(() => pageConfig.copyContent());
  const [savedContent, setSavedContent] = useState(() => pageConfig.copyContent());
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const visibleSections = useMemo(
    () => content.sections.filter((section) => section.visible),
    [content.sections]
  );
  const isDirty = JSON.stringify(content) !== JSON.stringify(savedContent);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${content.hero.title || pageConfig.pageName} | GFXunlimit`;
    return () => {
      document.title = previousTitle;
    };
  }, [content.hero.title, pageConfig.pageName]);

  useEffect(() => {
    let active = true;
    axios.get(`${API_BASE_URL}/${pageConfig.contentPath}/content`)
      .then(({ data }) => {
        if (!active) return;
        if (data?.content) {
          setContent(data.content);
          setSavedContent(pageConfig.copyContent(data.content));
        }
        setLoadError("");
      })
      .catch((error) => {
        console.error(`Failed to load published ${pageConfig.pageName} content`, error);
        if (active) setLoadError(`The published page could not be loaded. Showing the built-in ${pageConfig.pageName} version.`);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [pageConfig]);

  const saveContent = async () => {
    setSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      const { data } = await axios.put(
        `${API_BASE_URL}/admin/${pageConfig.contentPath}/content`,
        content,
        { headers: buildAuthHeaders() }
      );
      setContent(data.content);
      setSavedContent(pageConfig.copyContent(data.content));
      setSaveMessage("Published. All visitors will see these changes.");
    } catch (error) {
      console.error(`Failed to save ${pageConfig.pageName} content`, error);
      setSaveError(error.response?.data?.error || `Could not save ${pageConfig.pageName}. Please try again.`);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    setContent(pageConfig.copyContent(pageConfig.defaultContent));
    setSaveError("");
    setSaveMessage("");
  };

  const discardChanges = () => {
    setContent(pageConfig.copyContent(savedContent));
    setSaveError("");
    setSaveMessage("");
  };

  return (
    <main
      className={`privacy-policy-page privacy-policy-page--${content.appearance.density} privacy-policy-page--${pageConfig.contentPath}`}
      style={{
        "--privacy-policy-hero-start": content.appearance.heroStart,
        "--privacy-policy-hero-end": content.appearance.heroEnd,
        "--privacy-policy-accent": content.appearance.accent,
        "--privacy-policy-surface": content.appearance.surface
      }}
    >
      {loadError ? <p className="privacy-policy-load-error" role="status">{loadError}</p> : null}
      <header className={`privacy-policy-hero${content.hero.backgroundImage ? " privacy-policy-hero--with-image" : ""}`}>
        {content.hero.backgroundImage ? (
          <img className="privacy-policy-hero-background" src={content.hero.backgroundImage} alt="" aria-hidden="true" />
        ) : null}
        <div className="privacy-policy-hero-copy">
          <span className="privacy-policy-eyebrow">{content.hero.eyebrow}</span>
          <h1>{content.hero.title}</h1>
          <p>{content.hero.description}</p>
          <div className="privacy-policy-meta">
            <span>
              {pageConfig.datePrefix} <time dateTime={content.hero.updatedAt}>{formatUpdatedAt(content.hero.updatedAt)}</time>
            </span>
            <a href={`mailto:${content.hero.contactEmail}`}>{content.hero.contactLabel}</a>
          </div>
        </div>
        {content.hero.cardVisible ? (
          <div className="privacy-policy-hero-card" aria-hidden="true">
            <span className="privacy-policy-hero-card-icon">
              {content.hero.cardIconImage ? (
                <img src={content.hero.cardIconImage} alt="" />
              ) : content.hero.cardIcon}
            </span>
            <strong>{content.hero.cardTitle}</strong>
            <span>{content.hero.cardDescription}</span>
          </div>
        ) : null}
      </header>

      <div className={`privacy-policy-layout${isAdmin ? " privacy-policy-layout--admin" : content.appearance.showTableOfContents ? "" : " privacy-policy-layout--no-toc"}`}>
        {isAdmin ? (
          <PrivacyPolicyEditor
            content={content}
            onChange={(nextContent) => {
              setContent(nextContent);
              setSaveMessage("");
              setSaveError("");
            }}
            onSave={saveContent}
            onResetToDefaults={resetToDefaults}
            onDiscard={discardChanges}
            isDirty={isDirty}
            saving={saving}
            saveMessage={saveMessage}
            saveError={saveError}
            pageTitle={pageConfig.pageName}
            sectionLabel={pageConfig.sectionLabel}
            dateLabel={pageConfig.dateLabel}
            summaryCardLabel={pageConfig.summaryCardLabel}
          />
        ) : content.appearance.showTableOfContents ? (
          <nav className="privacy-policy-toc" aria-label={`${pageConfig.pageName} sections`}>
            <h2>On this page</h2>
            <a href="#overview">Overview</a>
            {visibleSections.map((section) => (
              <a href={`#${section.id}`} key={section.id}>{section.title}</a>
            ))}
            <a href="#contact">{content.contact.title}</a>
          </nav>
        ) : null}

        <article className="privacy-policy-article">
          <section id="overview" className="privacy-policy-overview">
            <span className="privacy-policy-section-label">{content.overview.label}</span>
            <h2>{content.overview.title}</h2>
            <p>{content.overview.body}</p>
          </section>

          {visibleSections.map((section, index) => (
            <section className="privacy-policy-section" id={section.id} key={section.id}>
              <span className="privacy-policy-section-number">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph, paragraphIndex) => (
                  paragraph ? <p key={`${section.id}-paragraph-${paragraphIndex}`}>{paragraph}</p> : null
                ))}
                {section.points.length > 0 ? (
                  <ul>
                    {section.points.map((point, pointIndex) => (
                      point ? <li key={`${section.id}-point-${pointIndex}`}>{point}</li> : null
                    ))}
                  </ul>
                ) : null}
                {section.closing ? <p>{section.closing}</p> : null}
              </div>
            </section>
          ))}

          <section id="contact" className="privacy-policy-contact">
            <span className="privacy-policy-section-label">{content.contact.label}</span>
            <h2>{content.contact.title}</h2>
            <p>{content.contact.body}</p>
            <a href={`mailto:${content.contact.email}`}>{content.contact.email}</a>
          </section>
        </article>
      </div>
      {isAdmin && isLoading ? <span className="privacy-policy-loading" role="status">Loading published settings…</span> : null}
    </main>
  );
}
