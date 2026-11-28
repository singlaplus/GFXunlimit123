export const DEFAULT_COOKIE_POLICY_CONTENT = {
  hero: {
    eyebrow: "GFXunlimit · Legal",
    title: "Cookie Policy",
    description: "Learn how cookies and similar technologies may be used to keep GFXunlimit working, remember your choices, and understand site performance.",
    backgroundImage: "",
    updatedAt: "2026-11-28",
    contactLabel: "Questions? Contact us",
    contactEmail: "hello@gfxunlimit.com",
    cardVisible: true,
    cardIcon: "C",
    cardIconImage: "",
    cardTitle: "Your choices matter",
    cardDescription: "Manage cookies through your browser and available site controls."
  },
  overview: {
    label: "The essentials",
    title: "About cookies",
    body: "Cookies are small files stored by your browser. GFXunlimit and service providers may also use local storage, pixels, or similar technologies for purposes described below."
  },
  sections: [
    {
      id: "why-we-use-cookies",
      title: "Why cookies are used",
      visible: true,
      paragraphs: [
        "Depending on the features you use and your settings, cookies and similar technologies may help operate the marketplace, remember preferences, protect accounts, and measure how the site performs."
      ],
      points: [],
      closing: "The technologies actually used can change as GFXunlimit and its features change."
    },
    {
      id: "essential-technologies",
      title: "Essential technologies",
      visible: true,
      paragraphs: [
        "Some storage is needed for core functions such as keeping you signed in, maintaining security, remembering required settings, or completing a transaction. These technologies support the service you request."
      ],
      points: [],
      closing: "Blocking essential storage in your browser may prevent some parts of the site from working correctly."
    },
    {
      id: "preferences",
      title: "Preferences",
      visible: true,
      paragraphs: [
        "Preference technologies can remember choices such as display settings or other options, so you do not need to set them again on each visit."
      ],
      points: [],
      closing: ""
    },
    {
      id: "analytics",
      title: "Analytics and performance",
      visible: true,
      paragraphs: [
        "Where enabled, analytics technologies help us understand visits and site performance, such as which pages are used and whether features are working as expected. We use this information to improve the service."
      ],
      points: [],
      closing: "Analytics providers may process information under their own privacy notices and the arrangements they have with us."
    },
    {
      id: "third-party-technologies",
      title: "Third-party technologies",
      visible: true,
      paragraphs: [
        "Some features may rely on third-party services, such as payment, media, security, or analytics providers. Those providers may set or read their own technologies when their features are used, subject to their terms and settings."
      ],
      points: [],
      closing: "We do not control cookies or similar technologies operated directly by third parties."
    },
    {
      id: "manage-cookies",
      title: "Managing your choices",
      visible: true,
      paragraphs: [
        "You can use your browser settings to view, block, or delete cookies and to limit similar storage. If GFXunlimit presents cookie controls for your region or visit, you can also use those controls to update your choices."
      ],
      points: [
        "Browser controls differ by browser and device; consult the browser's help resources for instructions.",
        "Deleting cookies may sign you out or reset saved preferences.",
        "Where applicable law requires consent, non-essential technologies should be used in accordance with the choices you make."
      ],
      closing: ""
    },
    {
      id: "retention-and-security",
      title: "Retention and security",
      visible: true,
      paragraphs: [
        "Some cookies last only while your browser is open, while others may remain for a period set by the service that created them. We take reasonable steps to use site storage appropriately and protect related information."
      ],
      points: [],
      closing: ""
    },
    {
      id: "updates",
      title: "Updates to this policy",
      visible: true,
      paragraphs: [
        "We may update this Cookie Policy when our practices, technologies, or legal requirements change. The latest version and its update date will be posted on this page."
      ],
      points: [],
      closing: "Before publishing, review this policy against the technologies actually used on GFXunlimit and the requirements that apply to your visitors."
    }
  ],
  contact: {
    label: "We’re here to help",
    title: "Questions about cookies?",
    body: "Contact us if you have questions about this Cookie Policy or the technologies used on GFXunlimit.",
    email: "hello@gfxunlimit.com"
  },
  appearance: {
    heroStart: "#081a2b",
    heroEnd: "#164e82",
    accent: "#0f766e",
    surface: "#ffffff",
    density: "comfortable",
    showTableOfContents: true
  }
};

export function copyCookiePolicyContent(content = DEFAULT_COOKIE_POLICY_CONTENT) {
  return JSON.parse(JSON.stringify(content));
}
