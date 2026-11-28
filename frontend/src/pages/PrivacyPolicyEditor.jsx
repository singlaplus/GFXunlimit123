import { useEffect, useRef, useState } from "react";

const MAX_CARD_ICON_FILE_SIZE = 1024 * 1024;
const MAX_HERO_IMAGE_FILE_SIZE = 3 * 1024 * 1024;

function TextField({ label, value, onChange, type = "text", maxLength }) {
  return (
    <label className="privacy-policy-editor-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextAreaField({ label, value, onChange, helpText }) {
  return (
    <label className="privacy-policy-editor-field">
      <span>{label}</span>
      <textarea value={value} rows={4} onChange={(event) => onChange(event.target.value)} />
      {helpText ? <small>{helpText}</small> : null}
    </label>
  );
}

function ColorField({ label, value, onChange }) {
  return (
    <label className="privacy-policy-editor-color">
      <span>{label}</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
      <code>{value}</code>
    </label>
  );
}

function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1])
    || date.getMonth() !== Number(match[2]) - 1
    || date.getDate() !== Number(match[3])
  ) return null;
  return date;
}

function toDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function DateField({ label, value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const date = parseDate(value) || new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const containerRef = useRef(null);
  const calendarRef = useRef(null);
  const triggerRef = useRef(null);
  const calendarId = "privacy-policy-date-picker";
  const selectedDate = parseDate(value);
  const today = new Date();
  const todayValue = toDateValue(today);
  const monthStart = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const dayCount = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const cellCount = Math.ceil((monthStart.getDay() + dayCount) / 7) * 7;
  const days = Array.from({ length: cellCount }, (_, index) => (
    new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index - monthStart.getDay() + 1)
  ));
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric"
  }).format(visibleMonth);
  const dateDialogLabel = label.toLowerCase().endsWith("date")
    ? label.toLowerCase()
    : `${label.toLowerCase()} date`;

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const scrollCalendarIntoView = () => calendarRef.current?.scrollIntoView?.({ block: "nearest" });
    scrollCalendarIntoView();
    window.addEventListener("resize", scrollCalendarIntoView);
    return () => window.removeEventListener("resize", scrollCalendarIntoView);
  }, [isOpen]);

  const closeCalendar = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const chooseDate = (date) => {
    onChange(toDateValue(date));
    closeCalendar();
  };

  const toggleCalendar = () => {
    if (!isOpen) {
      const date = selectedDate || new Date();
      setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
    setIsOpen((open) => !open);
  };

  return (
    <div className="privacy-policy-editor-date-field" ref={containerRef}>
      <span className="privacy-policy-editor-date-label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="privacy-policy-editor-date-trigger"
        aria-label={`${label}: ${selectedDate ? formatLongDate(selectedDate) : "Choose a date"}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={calendarId}
        onClick={toggleCalendar}
      >
        <span>{selectedDate ? formatLongDate(selectedDate) : "Choose a date"}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <rect x="3" y="5" width="14" height="12" rx="2" />
          <path d="M6.5 3.5v3M13.5 3.5v3M3 8.5h14" />
        </svg>
      </button>
      {isOpen ? (
        <div
          ref={calendarRef}
          id={calendarId}
          className="privacy-policy-editor-calendar"
          role="dialog"
          aria-label={`Choose ${dateDialogLabel}`}
        >
          <div className="privacy-policy-editor-calendar-header">
            <button type="button" aria-label="Previous month" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}>
              <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m12.5 4.5-5 5 5 5" /></svg>
            </button>
            <div>
              <h4>{monthLabel}</h4>
              <span>Select a date</span>
            </div>
            <button type="button" aria-label="Next month" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}>
              <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7.5 4.5 5 5-5 5" /></svg>
            </button>
          </div>
          <div className="privacy-policy-editor-calendar-weekdays" aria-hidden="true">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="privacy-policy-editor-calendar-days">
            {days.map((date) => {
              const dateValue = toDateValue(date);
              const isSelected = dateValue === value;
              const isToday = dateValue === todayValue;
              const isCurrentMonth = date.getMonth() === visibleMonth.getMonth();
              const classNames = [
                "privacy-policy-editor-calendar-day",
                isSelected ? "is-selected" : "",
                isToday ? "is-today" : "",
                isCurrentMonth ? "" : "is-outside"
              ].filter(Boolean).join(" ");
              return (
                <button
                  type="button"
                  className={classNames}
                  key={dateValue}
                  aria-label={formatLongDate(date)}
                  aria-pressed={isSelected}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => chooseDate(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="privacy-policy-editor-calendar-footer">
            <button type="button" className="privacy-policy-editor-calendar-clear" onClick={() => {
              onChange("");
              closeCalendar();
            }}>
              Clear
            </button>
            <button type="button" className="privacy-policy-editor-calendar-today" onClick={() => chooseDate(today)}>
              Today
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function splitParagraphs(value) {
  return value.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function splitPoints(value) {
  return value.split("\n").map((point) => point.trim()).filter(Boolean);
}

export default function PrivacyPolicyEditor({
  content,
  onChange,
  onSave,
  onResetToDefaults,
  onDiscard,
  isDirty,
  saving,
  saveMessage,
  saveError,
  pageTitle = "Privacy Policy",
  sectionLabel = "Policy sections",
  dateLabel = "Last updated",
  summaryCardLabel = "Show privacy summary card"
}) {
  const [activeMenu, setActiveMenu] = useState("hero");
  const [activeSectionId, setActiveSectionId] = useState(content.sections[0]?.id || "");
  const [cardIconUploadError, setCardIconUploadError] = useState("");
  const [heroImageUploadError, setHeroImageUploadError] = useState("");
  const editorSections = [
    { id: "hero", label: "Hero header" },
    { id: "overview", label: "Overview" },
    { id: "sections", label: sectionLabel },
    { id: "contact", label: "Contact details" },
    { id: "appearance", label: "Appearance" }
  ];
  const activeSection = content.sections.find((section) => section.id === activeSectionId);
  const activeIndex = content.sections.findIndex((section) => section.id === activeSectionId);

  useEffect(() => {
    if (!content.sections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId(content.sections[0]?.id || "");
    }
  }, [activeSectionId, content.sections]);

  const updateGroup = (group, key, value) => {
    onChange({
      ...content,
      [group]: { ...content[group], [key]: value }
    });
  };

  const updateSection = (sectionId, updates) => {
    onChange({
      ...content,
      sections: content.sections.map((section) => (
        section.id === sectionId ? { ...section, ...updates } : section
      ))
    });
  };

  const moveSection = (direction) => {
    const targetIndex = activeIndex + direction;
    if (targetIndex < 0 || targetIndex >= content.sections.length) return;
    const sections = [...content.sections];
    [sections[activeIndex], sections[targetIndex]] = [sections[targetIndex], sections[activeIndex]];
    onChange({ ...content, sections });
  };

  const addSection = () => {
    const id = `custom-section-${Date.now()}`;
    onChange({
      ...content,
      sections: [
        ...content.sections,
        { id, title: "New section", visible: true, paragraphs: [""], points: [], closing: "" }
      ]
    });
    setActiveMenu("sections");
    setActiveSectionId(id);
  };

  const removeSection = () => {
    const sections = content.sections.filter((section) => section.id !== activeSectionId);
    onChange({ ...content, sections });
    setActiveSectionId(sections[Math.max(0, activeIndex - 1)]?.id || "");
  };

  const uploadCardIcon = (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    if (file.type !== "image/png") {
      setCardIconUploadError("Choose a PNG image for the card icon.");
      return;
    }
    if (file.size > MAX_CARD_ICON_FILE_SIZE) {
      setCardIconUploadError("The PNG icon must be 1 MB or smaller.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string" || !reader.result.startsWith("data:image/png;base64,")) {
        setCardIconUploadError("The PNG could not be read. Please try another file.");
        return;
      }
      updateGroup("hero", "cardIconImage", reader.result);
      setCardIconUploadError("");
    };
    reader.onerror = () => setCardIconUploadError("The PNG could not be read. Please try another file.");
    reader.onabort = () => setCardIconUploadError("The PNG upload was interrupted. Please try again.");
    reader.readAsDataURL(file);
  };

  const uploadHeroImage = (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setHeroImageUploadError("Choose a JPG or PNG image for the hero header.");
      return;
    }
    if (file.size > MAX_HERO_IMAGE_FILE_SIZE) {
      setHeroImageUploadError("The hero image must be 3 MB or smaller.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string" || !/^data:image\/(?:png|jpeg);base64,/.test(reader.result)) {
        setHeroImageUploadError("The hero image could not be read. Please try another file.");
        return;
      }
      updateGroup("hero", "backgroundImage", reader.result);
      setHeroImageUploadError("");
    };
    reader.onerror = () => setHeroImageUploadError("The hero image could not be read. Please try another file.");
    reader.onabort = () => setHeroImageUploadError("The hero image upload was interrupted. Please try again.");
    reader.readAsDataURL(file);
  };

  return (
    <aside className="privacy-policy-editor" aria-label={`${pageTitle} customization`}>
      <div className="privacy-policy-editor-heading">
        <span className="privacy-policy-editor-kicker">Admin only</span>
        <h2>Customize this page</h2>
        <p>Changes are published for all visitors when you save.</p>
      </div>

      <nav className="privacy-policy-editor-menu" aria-label="Page customization menu">
        {editorSections.map((section) => (
          <button
            type="button"
            className={activeMenu === section.id ? "is-active" : ""}
            aria-current={activeMenu === section.id ? "page" : undefined}
            key={section.id}
            onClick={() => setActiveMenu(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <div className="privacy-policy-editor-fields">
        {activeMenu === "hero" ? (
          <div className="privacy-policy-editor-group">
            <h3>Hero header</h3>
            <TextField label="Eyebrow" value={content.hero.eyebrow} onChange={(value) => updateGroup("hero", "eyebrow", value)} />
            <TextField label="Page title" value={content.hero.title} onChange={(value) => updateGroup("hero", "title", value)} />
            <TextAreaField label="Description" value={content.hero.description} onChange={(value) => updateGroup("hero", "description", value)} />
            <div className="privacy-policy-editor-image-upload">
              <div className="privacy-policy-editor-field">
                <span>Hero background image (optional)</span>
                <div className="privacy-policy-editor-file-picker">
                  <input
                    id="privacy-policy-hero-background-upload"
                    className="privacy-policy-editor-file-input"
                    type="file"
                    accept="image/png,image/jpeg"
                    aria-label="Upload hero background image"
                    aria-describedby="privacy-policy-hero-background-help"
                    onChange={uploadHeroImage}
                  />
                  <label className="privacy-policy-editor-file-button" htmlFor="privacy-policy-hero-background-upload">
                    <svg aria-hidden="true" viewBox="0 0 20 20">
                      <path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 12.5v3A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-3" />
                    </svg>
                    <span>Choose image</span>
                  </label>
                  <span className="privacy-policy-editor-file-name">
                    {content.hero.backgroundImage ? "Image selected" : "No file chosen"}
                  </span>
                </div>
                <small id="privacy-policy-hero-background-help">Recommended: 1920 x 600 px (16:5). JPG or PNG, up to 3 MB; maximum 4096 x 2160 px. The image is cropped to fill the header.</small>
              </div>
              {heroImageUploadError ? <p className="privacy-policy-editor-error" role="alert">{heroImageUploadError}</p> : null}
              {content.hero.backgroundImage ? (
                <div className="privacy-policy-editor-image-preview privacy-policy-editor-image-preview--hero">
                  <img src={content.hero.backgroundImage} alt="Hero background preview" />
                  <button
                    type="button"
                    className="privacy-policy-editor-secondary"
                    onClick={() => updateGroup("hero", "backgroundImage", "")}
                  >
                    Remove image
                  </button>
                </div>
              ) : null}
            </div>
            <DateField label={dateLabel} value={content.hero.updatedAt} onChange={(value) => updateGroup("hero", "updatedAt", value)} />
            <TextField label="Contact link label" value={content.hero.contactLabel} onChange={(value) => updateGroup("hero", "contactLabel", value)} />
            <TextField label="Contact email" type="email" value={content.hero.contactEmail} onChange={(value) => updateGroup("hero", "contactEmail", value)} />
            <label className="privacy-policy-editor-checkbox">
              <input
                type="checkbox"
                checked={content.hero.cardVisible}
                onChange={(event) => updateGroup("hero", "cardVisible", event.target.checked)}
              />
              <span>{summaryCardLabel}</span>
            </label>
            {content.hero.cardVisible ? (
              <>
                <TextField label="Text icon" value={content.hero.cardIcon} onChange={(value) => updateGroup("hero", "cardIcon", value)} maxLength={3} />
                <div className="privacy-policy-editor-image-upload">
                  <div className="privacy-policy-editor-field">
                    <span>PNG icon (optional)</span>
                    <div className="privacy-policy-editor-file-picker">
                      <input
                        id="privacy-policy-card-icon-upload"
                        className="privacy-policy-editor-file-input"
                        type="file"
                        accept="image/png"
                        aria-label="Upload PNG card icon"
                        aria-describedby="privacy-policy-card-icon-help"
                        onChange={uploadCardIcon}
                      />
                      <label className="privacy-policy-editor-file-button" htmlFor="privacy-policy-card-icon-upload">
                        <svg aria-hidden="true" viewBox="0 0 20 20">
                          <path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 12.5v3A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-3" />
                        </svg>
                        <span>Choose PNG</span>
                      </label>
                      <span className="privacy-policy-editor-file-name">
                        {content.hero.cardIconImage ? "PNG selected" : "No file chosen"}
                      </span>
                    </div>
                    <small id="privacy-policy-card-icon-help">PNG only, up to 1 MB and 1024 x 1024 pixels. When uploaded, it appears instead of the text icon.</small>
                  </div>
                  {cardIconUploadError ? <p className="privacy-policy-editor-error" role="alert">{cardIconUploadError}</p> : null}
                  {content.hero.cardIconImage ? (
                    <div className="privacy-policy-editor-image-preview">
                      <img src={content.hero.cardIconImage} alt="Card icon preview" />
                      <button
                        type="button"
                        className="privacy-policy-editor-secondary"
                        onClick={() => updateGroup("hero", "cardIconImage", "")}
                      >
                        Remove PNG
                      </button>
                    </div>
                  ) : null}
                </div>
                <TextField label="Card title" value={content.hero.cardTitle} onChange={(value) => updateGroup("hero", "cardTitle", value)} />
                <TextAreaField label="Card description" value={content.hero.cardDescription} onChange={(value) => updateGroup("hero", "cardDescription", value)} />
              </>
            ) : null}
          </div>
        ) : null}

        {activeMenu === "overview" ? (
          <div className="privacy-policy-editor-group">
            <h3>Overview</h3>
            <TextField label="Label" value={content.overview.label} onChange={(value) => updateGroup("overview", "label", value)} />
            <TextField label="Heading" value={content.overview.title} onChange={(value) => updateGroup("overview", "title", value)} />
            <TextAreaField label="Overview text" value={content.overview.body} onChange={(value) => updateGroup("overview", "body", value)} />
            <label className="privacy-policy-editor-checkbox">
              <input
                type="checkbox"
                checked={content.appearance.showTableOfContents}
                onChange={(event) => updateGroup("appearance", "showTableOfContents", event.target.checked)}
              />
              <span>Show section navigation</span>
            </label>
          </div>
        ) : null}

        {activeMenu === "sections" ? (
          <div className="privacy-policy-editor-group">
            <h3>{sectionLabel}</h3>
            <p className="privacy-policy-editor-help">Choose a section to edit its text, visibility, or position.</p>
            <div className="privacy-policy-editor-section-list">
              {content.sections.map((section) => (
                <button
                  type="button"
                  className={section.id === activeSectionId ? "is-active" : ""}
                  key={section.id}
                  onClick={() => setActiveSectionId(section.id)}
                >
                  <span>{section.title || "Untitled section"}</span>
                  <small>{section.visible ? "Visible" : "Hidden"}</small>
                </button>
              ))}
            </div>
            <button type="button" className="privacy-policy-editor-secondary" onClick={addSection} disabled={content.sections.length >= 30}>
              Add section
            </button>
            {activeSection ? (
              <div className="privacy-policy-editor-section-form">
                <TextField label="Section heading" value={activeSection.title} onChange={(value) => updateSection(activeSection.id, { title: value })} />
                <label className="privacy-policy-editor-checkbox">
                  <input
                    type="checkbox"
                    checked={activeSection.visible}
                    onChange={(event) => updateSection(activeSection.id, { visible: event.target.checked })}
                  />
                  <span>Show this section to visitors</span>
                </label>
                <TextAreaField
                  label="Paragraphs"
                  value={activeSection.paragraphs.join("\n\n")}
                  onChange={(value) => updateSection(activeSection.id, { paragraphs: splitParagraphs(value) })}
                  helpText="Separate paragraphs with a blank line."
                />
                <TextAreaField
                  label="Bullet points"
                  value={activeSection.points.join("\n")}
                  onChange={(value) => updateSection(activeSection.id, { points: splitPoints(value) })}
                  helpText="Put each bullet point on its own line."
                />
                <TextAreaField
                  label="Closing text (optional)"
                  value={activeSection.closing}
                  onChange={(value) => updateSection(activeSection.id, { closing: value })}
                />
                <div className="privacy-policy-editor-inline-actions">
                  <button type="button" className="privacy-policy-editor-secondary" onClick={() => moveSection(-1)} disabled={activeIndex <= 0}>Move up</button>
                  <button type="button" className="privacy-policy-editor-secondary" onClick={() => moveSection(1)} disabled={activeIndex >= content.sections.length - 1}>Move down</button>
                  <button type="button" className="privacy-policy-editor-danger" onClick={removeSection}>Remove</button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeMenu === "contact" ? (
          <div className="privacy-policy-editor-group">
            <h3>Contact details</h3>
            <TextField label="Section label" value={content.contact.label} onChange={(value) => updateGroup("contact", "label", value)} />
            <TextField label="Heading" value={content.contact.title} onChange={(value) => updateGroup("contact", "title", value)} />
            <TextAreaField label="Message" value={content.contact.body} onChange={(value) => updateGroup("contact", "body", value)} />
            <TextField label="Email" type="email" value={content.contact.email} onChange={(value) => updateGroup("contact", "email", value)} />
          </div>
        ) : null}

        {activeMenu === "appearance" ? (
          <div className="privacy-policy-editor-group">
            <h3>Appearance</h3>
            <ColorField label="Hero start color" value={content.appearance.heroStart} onChange={(value) => updateGroup("appearance", "heroStart", value)} />
            <ColorField label="Hero end color" value={content.appearance.heroEnd} onChange={(value) => updateGroup("appearance", "heroEnd", value)} />
            <ColorField label="Accent color" value={content.appearance.accent} onChange={(value) => updateGroup("appearance", "accent", value)} />
            <ColorField label="Content surface color" value={content.appearance.surface} onChange={(value) => updateGroup("appearance", "surface", value)} />
            <label className="privacy-policy-editor-field">
              <span>Content density</span>
              <select
                value={content.appearance.density}
                onChange={(event) => updateGroup("appearance", "density", event.target.value)}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
          </div>
        ) : null}
      </div>

      <div className="privacy-policy-editor-footer">
        {saveError ? <p className="privacy-policy-editor-error" role="alert">{saveError}</p> : null}
        {saveMessage ? <p className="privacy-policy-editor-success" role="status">{saveMessage}</p> : null}
        {isDirty ? <p className="privacy-policy-editor-dirty">Unsaved changes</p> : null}
        <button type="button" className="privacy-policy-editor-save" onClick={onSave} disabled={!isDirty || saving}>
          {saving ? "Saving..." : "Save for all visitors"}
        </button>
        <div className="privacy-policy-editor-inline-actions">
          <button type="button" className="privacy-policy-editor-secondary" onClick={onDiscard} disabled={!isDirty || saving}>Discard</button>
          <button type="button" className="privacy-policy-editor-secondary" onClick={onResetToDefaults} disabled={saving}>Restore defaults</button>
        </div>
      </div>
    </aside>
  );
}
