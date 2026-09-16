import { useEffect, useState } from "react";
import axios from "axios";
import { hasActiveSession } from "../utils/authSession";
import "./CompanyPage.css";

const createDefaultButtons = () => [
  {
    id: "default-button",
    label: "Explore Assets",
    link: "/explore",
    textColor: "#0f1724",
    backgroundColor: "#ffffff"
  }
];

const PLAN_DURATION_ORDER = ["monthly", "3_months", "6_months", "1_year", "yearly", "limited"];
const PLAN_DURATION_LABELS = {
  monthly: "Month",
  "3_months": "3 Months",
  "6_months": "6 Months",
  "1_year": "Yearly",
  yearly: "Yearly",
  limited: "Limited time"
};

const pageContent = {
  about: {
    title: "About GFXunlimit",
    eyebrow: "Trusted by creators, agencies, and global brands",
    intro:
      "GFXunlimit is a premium digital marketplace built for teams that need striking visuals, fast delivery, and reliable licensing. We combine curated content with a polished contributor experience so every asset feels professional and production-ready.",
    highlights: [
      "Curated collections for marketing, web, editorial, and product storytelling",
      "A global contributor network with strict quality standards",
      "Flexible access for businesses that need consistent visual output"
    ],
    stats: [
      { label: "Assets curated", value: "50K+" },
      { label: "Active contributors", value: "2.5K" },
      { label: "Global clients", value: "1.2K" }
    ],
    footerTitle: "Built for ambitious brands",
    heroImage: null,
    buttons: createDefaultButtons()
  },
  pricing: {
    title: "Simple pricing for every team",
    eyebrow: "Choose a plan that grows with your workflow",
    intro:
      "Whether you are a solo creator or a large marketing team, our pricing is designed to stay transparent, flexible, and simple. Start small and scale without friction.",
    highlights: [
      "Starter access for independent creators and freelancers",
      "Team plans with shared libraries and prioritized support",
      "Enterprise licensing for high-volume campaigns and multi-brand use"
    ],
    stats: [
      { label: "Starter", value: "$19/mo" },
      { label: "Team", value: "$99/mo" },
      { label: "Enterprise", value: "Custom" }
    ],
    footerTitle: "No hidden fees. No surprises.",
    heroImage: null,
    buttons: createDefaultButtons()
  },
  careers: {
    title: "Join the team at GFXunlimit",
    eyebrow: "Build the next generation of creative infrastructure",
    intro:
      "We are hiring world-class designers, developers, operations specialists, and community builders who want to shape the future of digital content creation.",
    highlights: [
      "Remote-first culture with global collaboration",
      "High-impact roles across product, engineering, and content",
      "Competitive compensation, mentorship, and growth opportunities"
    ],
    stats: [
      { label: "Open roles", value: "18" },
      { label: "Remote teams", value: "8" },
      { label: "Growth path", value: "Fast" }
    ],
    footerTitle: "Bring your talent to a company that scales with purpose.",
    heroImage: null,
    buttons: createDefaultButtons()
  },
  contact: {
    title: "Contact GFXunlimit",
    eyebrow: "Let's talk about your next creative launch",
    intro:
      "Need help choosing a plan, onboarding your team, or learning more about our marketplace? Reach out to our team and we will guide you through the right next step.",
    highlights: [
      "Email: hello@gfxunlimit.com",
      "Phone: +1 (800) 555-0148",
      "Hours: Mon–Fri, 8:00 AM to 6:00 PM UTC"
    ],
    stats: [
      { label: "Response time", value: "< 1 hr" },
      { label: "Support channels", value: "Email + Chat" },
      { label: "Coverage", value: "24/7" }
    ],
    footerTitle: "We are ready when you are.",
    heroImage: null,
    buttons: createDefaultButtons()
  }
};

const cloneContent = (source) => ({
  ...source,
  highlights: [...(source.highlights || [])],
  stats: (source.stats || []).map((item) => ({ ...item })),
  buttons: (source.buttons || []).map((button) => ({ ...button }))
});

const getStoredPageContent = (slug) => {
  try {
    const raw = localStorage.getItem("company-page-content");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.[slug] || null;
  } catch (err) {
    console.error("Failed to load company page content", err);
    return null;
  }
};

const buildContentState = (slug) => {
  const baseContent = pageContent[slug] || pageContent.about;
  const savedContent = getStoredPageContent(slug);
  const merged = savedContent ? { ...baseContent, ...savedContent } : baseContent;
  return cloneContent({
    ...merged,
    highlights: savedContent?.highlights || baseContent.highlights || [],
    stats: savedContent?.stats || baseContent.stats || [],
    buttons: savedContent?.buttons || baseContent.buttons || createDefaultButtons(),
    heroImage: savedContent?.heroImage || baseContent.heroImage || null
  });
};

export default function CompanyPage({ slug = "about" }) {
  const [content, setContent] = useState(() => buildContentState(slug));
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [selectedPlanDurations, setSelectedPlanDurations] = useState({});
  const [selectedCurrency, setSelectedCurrency] = useState("INR");
  const [saveMessage, setSaveMessage] = useState("");
  const [showCustomPlansModal, setShowCustomPlansModal] = useState(false);
  const [customPlanForm, setCustomPlanForm] = useState({
    name: "",
    mobileNumber: "",
    email: "",
    assetsPerMonth: "",
    assetPrice: "",
    teamSize: "",
    planDuration: "1_month"
  });
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpMessage, setOtpMessage] = useState("");
  const [otpVerificationToken, setOtpVerificationToken] = useState("");
  const isLoggedIn = hasActiveSession();
  const storedRole = String(
    typeof window !== "undefined" ? localStorage.getItem("userRole") || "" : ""
  ).toLowerCase();
  const isContributor = Boolean(isLoggedIn && storedRole === "contributor");
  const visibleButtons = (content.buttons || []).filter((button) => {
    const label = String(button.label || "").toLowerCase();
    const isExploreButton = button.link === "/explore" || label.includes("explore");
    return !isContributor || !isExploreButton;
  });

  useEffect(() => {
    setContent(buildContentState(slug));
  }, [slug]);

  useEffect(() => {
    if (slug !== "pricing") return;
    axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/subscription-plans`)
      .then((response) => {
        const plans = Array.isArray(response.data) ? response.data : [];
        setSubscriptionPlans(plans);
        const availableCurrencies = [...new Set(plans.flatMap((plan) => Object.keys(plan.pricing?.currency_prices || {}).concat(plan.pricing?.currency || [])))];
        setSelectedCurrency((previous) => availableCurrencies.includes(previous) ? previous : (availableCurrencies[0] || "INR"));
        setSelectedPlanDurations((previous) => Object.fromEntries(plans.map((plan) => {
          const durations = Object.keys(plan.plan_settings?.durations || {});
          return [plan.id, previous[plan.id] || durations[0] || plan.plan_settings?.duration || "monthly"];
        })));
      })
      .catch((err) => console.error("Failed to load subscription plans", err));
  }, [slug]);

  const isAdmin = isLoggedIn && String(localStorage.getItem("userRole") || "").toLowerCase() === "admin";

  const handleFieldChange = (field, value) => {
    setContent((prev) => ({ ...prev, [field]: value }));
  };

  const handleHighlightsChange = (value) => {
    const nextHighlights = value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

    setContent((prev) => ({ ...prev, highlights: nextHighlights }));
  };

  const handleStatChange = (index, field, value) => {
    setContent((prev) => ({
      ...prev,
      stats: prev.stats.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item))
    }));
  };

  const handleButtonChange = (index, field, value) => {
    setContent((prev) => ({
      ...prev,
      buttons: prev.buttons.map((button, buttonIndex) => (buttonIndex === index ? { ...button, [field]: value } : button))
    }));
  };

  const addButton = () => {
    setContent((prev) => ({
      ...prev,
      buttons: [
        ...prev.buttons,
        {
          id: `button-${Date.now()}`,
          label: "New Button",
          link: "/",
          textColor: "#ffffff",
          backgroundColor: "#2563eb"
        }
      ]
    }));
  };

  const removeButton = (index) => {
    setContent((prev) => ({
      ...prev,
      buttons: prev.buttons.filter((_, buttonIndex) => buttonIndex !== index)
    }));
  };

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setContent((prev) => ({ ...prev, heroImage: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  const saveContent = () => {
    try {
      const raw = localStorage.getItem("company-page-content");
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[slug] = cloneContent(content);
      localStorage.setItem("company-page-content", JSON.stringify(parsed));
      setSaveMessage("Page content saved.");
      setTimeout(() => setSaveMessage(""), 1800);
    } catch (err) {
      console.error("Failed to save company page content", err);
      setSaveMessage("Could not save changes.");
    }
  };

  const resetContent = () => {
    setContent(buildContentState(slug));
    setSaveMessage("Restored the default page content.");
    setTimeout(() => setSaveMessage(""), 1800);
  };

  const handleCustomPlanChange = (field, value) => {
    setCustomPlanForm((previous) => ({ ...previous, [field]: value }));
  };

  const handleSendOtp = async () => {
    if (!customPlanForm.email.trim()) {
      setOtpMessage("Please enter your email address first.");
      return;
    }

    try {
      await axios.post(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/custom-subscriptions/otp/send`, { email: customPlanForm.email, name: customPlanForm.name }, { withCredentials: true });
      setOtpSent(true);
      setOtpVerified(false);
      setOtpVerificationToken("");
      setOtpMessage("Verification code sent to your email. Please enter it below.");
    } catch (error) {
      setOtpMessage(error.response?.data?.error || "Unable to send the verification email.");
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode.trim()) {
      setOtpMessage("Please enter the OTP sent to your email.");
      return;
    }

    try {
      const response = await axios.post(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/custom-subscriptions/otp/verify`, { email: customPlanForm.email, code: otpCode }, { withCredentials: true });
      setOtpVerified(true);
      setOtpVerificationToken(response.data.verification_token || "");
      setOtpMessage("Email verified successfully.");
    } catch (error) {
      setOtpVerified(false);
      setOtpMessage(error.response?.data?.error || "Unable to verify the code.");
    }
  };

  const handleCustomPlanSubmit = (event) => {
    event.preventDefault();

    if (!otpVerified) {
      setOtpMessage("Please verify your email before submitting the form.");
      return;
    }

    const payload = {
      customer_name: customPlanForm.name,
      customer_email: customPlanForm.email,
      customer_phone: customPlanForm.mobileNumber,
      base_plan: "Custom Subscription",
      custom_duration: customPlanForm.planDuration,
      custom_start_date: new Date().toISOString().slice(0, 10),
      custom_end_date: null,
      custom_pricing: {
        requested_assets_per_month: Number(customPlanForm.assetsPerMonth) || 0,
        requested_asset_price: Number(customPlanForm.assetPrice) || 0,
        team_size: Number(customPlanForm.teamSize) || 0,
        mobile_number: customPlanForm.mobileNumber,
        source: "pricing_page",
        submitted_at: new Date().toISOString()
      },
      custom_permissions: {
        download_limit: null,
        note: "Submitted via pricing page custom subscription request"
      },
      status: "pending",
      admin_notes: {
        remarks: "Submitted via pricing page custom plan request",
        source: "website"
      },
      activity_log: [{
        event: "custom_subscription_requested",
        submitted_at: new Date().toISOString(),
        source: "pricing_page"
      }],
      verification_token: otpVerificationToken
    };

    axios.post(
      `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/custom-subscriptions`,
      payload,
      { withCredentials: true }
    )
      .then(() => {
        setShowCustomPlansModal(false);
        setCustomPlanForm({
          name: "",
          mobileNumber: "",
          email: "",
          assetsPerMonth: "",
          assetPrice: "",
          teamSize: "",
          planDuration: "1_month"
        });
        setOtpCode("");
        setOtpSent(false);
        setOtpVerified(false);
        setOtpVerificationToken("");
        setOtpMessage("Request sent successfully. Our team will review it shortly.");
      })
      .catch((error) => {
        console.error("Failed to create custom subscription request", error);
        setOtpMessage(error.response?.data?.error || "Unable to submit your request right now. Please try again.");
      });
  };

  const closeCustomPlanModal = () => {
    setShowCustomPlansModal(false);
    setOtpCode("");
    setOtpSent(false);
    setOtpVerified(false);
    setOtpVerificationToken("");
    setOtpMessage("");
  };

  return (
    <div className="company-page-shell">
      <div className={`company-page-grid${isAdmin ? " admin-layout" : ""}`}>
        {isAdmin && (
          <aside className="company-page-sidebar">
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: "linear-gradient(135deg, #2563eb, #4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 800 }}>✦</div>
              <div>
                <div style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: "#2563eb" }}>Page Editor</div>
                <h2 style={{ margin: "2px 0 0", fontSize: "1.05rem", color: "#0f1724" }}>{content.title}</h2>
              </div>
            </div>
            <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "0.92rem", lineHeight: 1.5 }}>Edit this page only. Changes appear instantly in the live preview.</p>

            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ padding: "12px", borderRadius: "14px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>Title</span>
                  <input value={content.title} onChange={(e) => handleFieldChange("title", e.target.value)} style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "white" }} />
                </label>
              </div>

              <div style={{ padding: "12px", borderRadius: "14px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>Eyebrow</span>
                  <input value={content.eyebrow} onChange={(e) => handleFieldChange("eyebrow", e.target.value)} style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "white" }} />
                </label>
              </div>

              <div style={{ padding: "12px", borderRadius: "14px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>Intro</span>
                  <textarea value={content.intro} onChange={(e) => handleFieldChange("intro", e.target.value)} rows={4} style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #cbd5e1", resize: "vertical", background: "white" }} />
                </label>
              </div>

              <div style={{ padding: "12px", borderRadius: "14px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>Highlights</span>
                  <textarea value={content.highlights.join("\n")} onChange={(e) => handleHighlightsChange(e.target.value)} rows={6} style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #cbd5e1", resize: "vertical", background: "white" }} />
                </label>
              </div>

              <div style={{ padding: "12px", borderRadius: "14px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>Stats</span>
                </div>
                <div style={{ display: "grid", gap: "8px" }}>
                  {content.stats.map((stat, index) => (
                    <div key={`${stat.label}-${index}`} style={{ display: "grid", gap: "6px" }}>
                      <input value={stat.label} onChange={(e) => handleStatChange(index, "label", e.target.value)} placeholder="Label" style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "white" }} />
                      <input value={stat.value} onChange={(e) => handleStatChange(index, "value", e.target.value)} placeholder="Value" style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "white" }} />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ padding: "12px", borderRadius: "14px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>Footer Message</span>
                  <input value={content.footerTitle} onChange={(e) => handleFieldChange("footerTitle", e.target.value)} style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "white" }} />
                </label>
              </div>

              <div style={{ padding: "12px", borderRadius: "14px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <label style={{ display: "grid", gap: "6px" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>Hero Image</span>
                  <input type="file" accept="image/*" onChange={handleImageUpload} style={{ padding: "8px 0" }} />
                  {content.heroImage ? <img src={content.heroImage} alt="Hero preview" style={{ width: "100%", borderRadius: "10px", border: "1px solid #e2e8f0", objectFit: "cover", maxHeight: "140px" }} /> : null}
                </label>
              </div>

              <div style={{ padding: "12px", borderRadius: "14px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>Buttons</span>
                  <button type="button" onClick={addButton} style={{ background: "#2563eb", color: "white", border: "none", padding: "8px 10px", borderRadius: "8px", cursor: "pointer", fontWeight: 700 }}>Add</button>
                </div>
                <div style={{ display: "grid", gap: "8px" }}>
                  {(content.buttons || []).map((button, index) => (
                    <div key={button.id || index} style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", display: "grid", gap: "8px", background: "white" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ fontSize: "0.9rem", color: "#0f1724" }}>Button {index + 1}</strong>
                        {(content.buttons || []).length > 1 ? <button type="button" onClick={() => removeButton(index)} style={{ background: "#ef4444", color: "white", border: "none", padding: "6px 8px", borderRadius: "8px", cursor: "pointer" }}>Remove</button> : null}
                      </div>
                      <input value={button.label} onChange={(e) => handleButtonChange(index, "label", e.target.value)} placeholder="Button label" style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #cbd5e1" }} />
                      <input value={button.link} onChange={(e) => handleButtonChange(index, "link", e.target.value)} placeholder="Button link" style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #cbd5e1" }} />
                      <div style={{ display: "grid", gap: "6px" }}>
                        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                          <span style={{ fontSize: "0.85rem", color: "#475569" }}>Text color</span>
                          <input type="color" value={button.textColor || "#ffffff"} onChange={(e) => handleButtonChange(index, "textColor", e.target.value)} />
                        </label>
                        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                          <span style={{ fontSize: "0.85rem", color: "#475569" }}>Background</span>
                          <input type="color" value={button.backgroundColor || "#2563eb"} onChange={(e) => handleButtonChange(index, "backgroundColor", e.target.value)} />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button type="button" onClick={saveContent} style={{ background: "linear-gradient(135deg, #2563eb, #4f46e5)", color: "white", border: "none", padding: "10px 14px", borderRadius: "10px", cursor: "pointer", fontWeight: 700 }}>Save</button>
                <button type="button" onClick={resetContent} style={{ background: "#e2e8f0", color: "#0f1724", border: "none", padding: "10px 14px", borderRadius: "10px", cursor: "pointer", fontWeight: 700 }}>Reset</button>
              </div>
              {saveMessage ? <div style={{ color: "#2563eb", fontSize: "0.9rem", fontWeight: 600 }}>{saveMessage}</div> : null}
            </div>
          </aside>
        )}

        <div className="company-page-main">
          <section className="company-page-hero">
            <div className="company-page-hero-row">
              <div className="company-page-hero-copy">
                <div style={{ display: "inline-block", padding: "8px 12px", borderRadius: "999px", background: "rgba(255,255,255,0.16)", fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "12px" }}>
                  {content.eyebrow}
                </div>
                <h1 style={{ fontSize: "clamp(2rem, 3vw, 3rem)", margin: "0 0 12px", lineHeight: 1.15 }}>{content.title}</h1>
                <p style={{ fontSize: "1.05rem", lineHeight: 1.7, margin: 0, opacity: 0.95 }}>{content.intro}</p>
              </div>
              {visibleButtons.length > 0 ? (
                <div className="company-page-hero-actions">
                  {visibleButtons.map((button, index) => (
                    <a
                      key={button.id || index}
                      href={button.link || "/"}
                      style={{
                        background: button.backgroundColor || "#ffffff",
                        color: button.textColor || "#0f1724",
                        textDecoration: "none",
                        padding: "12px 18px",
                        borderRadius: "999px",
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}
                    >
                      {button.label || "Button"}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className="company-page-stats">
            {content.stats.map((item) => (
              <div key={item.label} className="company-page-stat-card">
                <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#1d4ed8", marginBottom: "6px" }}>{item.value}</div>
                <div style={{ color: "#475569", fontWeight: 600 }}>{item.label}</div>
              </div>
            ))}
          </section>

          {slug === "pricing" && subscriptionPlans.length > 0 ? (
            <>
            <div className="company-page-currency-control">
              <label htmlFor="pricing-currency">Display currency</label>
              <select id="pricing-currency" value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value)}>
                {[...new Set(subscriptionPlans.flatMap((plan) => Object.keys(plan.pricing?.currency_prices || {}).concat(plan.pricing?.currency || [])))].map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </div>
            <section className="company-page-plans" aria-label="Subscription plans">
              {subscriptionPlans.map((plan) => {
                const prices = plan.pricing?.prices || {};
                const configuredDurations = Object.keys(plan.plan_settings?.durations || {});
                const durations = PLAN_DURATION_ORDER.filter((duration) => configuredDurations.includes(duration));
                const visibleDurations = durations.length > 0 ? durations : [plan.plan_settings?.duration || "monthly"];
                const selectedDuration = selectedPlanDurations[plan.id] || visibleDurations[0];
                const currencyPrices = plan.pricing?.currency_prices?.[selectedCurrency] || {};
                const selectedPrice = currencyPrices[selectedDuration] ?? (selectedCurrency === (plan.pricing?.currency || "USD") ? prices[selectedDuration] : null);
                return (
                  <div key={plan.id} className="company-page-plan-offer">
                  <article className="company-page-plan-card">
                    <div className="company-page-plan-heading">
                      <h2>{plan.name}</h2>
                      {plan.recommended ? <span>Most Popular</span> : null}
                    </div>
                    <div className="company-page-plan-duration-toggle" role="group" aria-label={`${plan.name} duration`}>
                      {visibleDurations.map((duration) => (
                        <button key={duration} type="button" className={selectedDuration === duration ? "is-selected" : ""} onClick={() => setSelectedPlanDurations((previous) => ({ ...previous, [plan.id]: duration }))}>
                          {PLAN_DURATION_LABELS[duration] || duration.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                    <div className="company-page-plan-prices">
                      <div className="company-page-plan-selected-price">
                        <span>{PLAN_DURATION_LABELS[selectedDuration] || selectedDuration.replace("_", " ")}</span>
                        <strong>{selectedPrice != null ? `${selectedPrice} ${selectedCurrency}` : "Price not available"}</strong>
                      </div>
                    </div>
                    <div className="company-page-plan-meta">
                      {plan.download_limits?.downloads != null ? `${plan.download_limits.downloads} downloads` : "Downloads included"}
                    </div>
                    {plan.short_description ? <ul className="company-page-plan-description">{String(plan.short_description).split(/\r?\n|\s*•\s*/).map((item) => item.trim()).filter(Boolean).map((item, index) => <li key={`${plan.id}-description-${index}`}>{item.replace(/^[-*]\s*/, "")}</li>)}</ul> : <p>Flexible access for your creative workflow.</p>}
                  </article>
                    <a className="company-page-plan-buy" href={`/checkout/subscription?plan=${encodeURIComponent(plan.id)}&duration=${encodeURIComponent(selectedDuration)}&currency=${encodeURIComponent(selectedCurrency)}`}>
                      Buy this plan
                    </a>
                  </div>
                );
              })}
            </section>
            </>
          ) : null}

          <section className="company-page-cta-banner" aria-label="Pricing banner">
            <button type="button" className="company-page-cta-button" onClick={() => setShowCustomPlansModal(true)}>
              Need Custom Plans?
            </button>
          </section>

          {showCustomPlansModal ? (
            <div className="company-page-cta-modal-backdrop" onClick={closeCustomPlanModal} role="presentation">
              <div className="company-page-cta-modal" role="dialog" aria-modal="true" aria-labelledby="custom-plans-title" onClick={(event) => event.stopPropagation()}>
                <button type="button" className="company-page-cta-modal-close" aria-label="Close custom plans modal" onClick={closeCustomPlanModal}>
                  ×
                </button>
                <h3 id="custom-plans-title">Need a custom plan?</h3>
                <p className="company-page-cta-modal-subtitle">Tell us about your team, usage, and asset needs. We will help you build a pricing plan that matches your workflow.</p>

                <form className="company-page-custom-form" onSubmit={handleCustomPlanSubmit}>
                  <div className="company-page-custom-form-grid">
                    <label>
                      <span>Name</span>
                      <input type="text" value={customPlanForm.name} onChange={(event) => handleCustomPlanChange("name", event.target.value)} required />
                    </label>

                    <label>
                      <span>Mobile Number</span>
                      <input type="tel" value={customPlanForm.mobileNumber} onChange={(event) => handleCustomPlanChange("mobileNumber", event.target.value)} required />
                    </label>

                    <label className="company-page-form-email-field">
                      <span>Email ID</span>
                      <div className="company-page-email-row">
                        <input type="email" value={customPlanForm.email} onChange={(event) => handleCustomPlanChange("email", event.target.value)} required />
                        <button type="button" className="company-page-otp-button" onClick={handleSendOtp}>
                          {otpSent ? "Resend OTP" : "Send OTP"}
                        </button>
                      </div>
                    </label>

                    {otpSent ? (
                      <label className="company-page-form-otp-field">
                        <span>OTP Verification</span>
                        <div className="company-page-email-row">
                          <input type="text" inputMode="numeric" value={otpCode} onChange={(event) => setOtpCode(event.target.value)} placeholder="Enter OTP" />
                          <button type="button" className="company-page-otp-button" onClick={handleVerifyOtp}>
                            {otpVerified ? "Verified" : "Verify"}
                          </button>
                        </div>
                      </label>
                    ) : null}

                    <label>
                      <span>Assets required per month</span>
                      <input type="number" min="1" value={customPlanForm.assetsPerMonth} onChange={(event) => handleCustomPlanChange("assetsPerMonth", event.target.value)} required />
                    </label>

                    <label>
                      <span>Per asset price want</span>
                      <input type="number" min="0" step="0.01" value={customPlanForm.assetPrice} onChange={(event) => handleCustomPlanChange("assetPrice", event.target.value)} required />
                    </label>

                    <label>
                      <span>Team Size</span>
                      <input type="number" min="1" value={customPlanForm.teamSize} onChange={(event) => handleCustomPlanChange("teamSize", event.target.value)} required />
                    </label>

                    <label>
                      <span>How long plan they want</span>
                      <select value={customPlanForm.planDuration} onChange={(event) => handleCustomPlanChange("planDuration", event.target.value)}>
                        <option value="1_month">1 month</option>
                        <option value="3_month">3 months</option>
                        <option value="6_month">6 months</option>
                        <option value="1_year">1 year</option>
                        <option value="2_year">2 year</option>
                        <option value="5_year">5 year</option>
                        <option value="10_year">10 year</option>
                      </select>
                    </label>
                  </div>

                  {otpMessage ? <div className={`company-page-otp-status ${otpVerified ? "is-verified" : ""}`}>{otpMessage}</div> : null}

                  <div className="company-page-cta-modal-actions">
                    <button type="button" className="company-page-form-cancel" onClick={closeCustomPlanModal}>Cancel</button>
                    <button type="submit" className="company-page-form-submit">Submit</button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          <section className="company-page-features">
            <div className="company-page-highlight-card">
              <h2 style={{ margin: "0 0 12px", fontSize: "1.25rem" }}>Why teams choose us</h2>
              <ul style={{ margin: 0, paddingLeft: "18px", color: "#334155", display: "grid", gap: "10px", lineHeight: 1.7 }}>
                {content.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="company-page-promise-card">
              <h2 style={{ margin: "0 0 10px", fontSize: "1.25rem" }}>Company promise</h2>
              <p style={{ margin: 0, lineHeight: 1.7, opacity: 0.9 }}>{content.footerTitle}</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
