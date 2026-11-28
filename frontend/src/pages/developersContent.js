export const DEFAULT_DEVELOPERS_CONTENT = {
  hero: {
    eyebrow: "GFXunlimit · Developer resources",
    title: "Developers",
    description: "Resources and guidance for building workflows around creative assets from GFXunlimit.",
    backgroundImage: "",
    updatedAt: "2026-11-28",
    contactLabel: "Contact our team",
    contactEmail: "hello@gfxunlimit.com",
    cardVisible: true,
    cardIcon: "</>",
    cardIconImage: "",
    cardTitle: "Build with confidence",
    cardDescription: "Review asset details, licensing, and available support before integrating assets into your workflow."
  },
  overview: {
    label: "Developer resources",
    title: "A practical starting point",
    body: "Use these guidelines when evaluating GFXunlimit assets for a product, website, or creative workflow. Availability of technical integrations may vary; contact our team to discuss your use case."
  },
  sections: [
    {
      id: "using-assets",
      title: "Using GFXunlimit assets in your workflow",
      visible: true,
      paragraphs: [
        "Browse the marketplace and open an asset's details page to review its available formats, download options, and any usage information provided for that asset."
      ],
      points: [
        "Use the download and purchase options shown on the asset page.",
        "Keep asset files and related metadata together in your project workflow.",
        "Check that the asset is suitable for the intended technical and visual requirements."
      ],
      closing: ""
    },
    {
      id: "licensing-and-attribution",
      title: "Licensing and attribution",
      visible: true,
      paragraphs: [
        "License terms can differ by asset and offer. Review the license information displayed with each asset and the Terms & Conditions before distributing, embedding, or incorporating it into an application."
      ],
      points: [
        "Do not assume that access to a file grants rights beyond the license shown for it.",
        "Follow any attribution or usage conditions that apply to the asset.",
        "Contact support if a license term is unclear before using the asset."
      ],
      closing: ""
    },
    {
      id: "integration-access",
      title: "Integration and API access",
      visible: true,
      paragraphs: [
        "For questions about APIs, integrations, or programmatic access, contact our team with a short description of your product, intended use, and expected requirements. We can confirm which options are currently available."
      ],
      points: [],
      closing: "Do not build against undocumented endpoints or automate access in a way that conflicts with the site's terms."
    },
    {
      id: "account-and-downloads",
      title: "Account access and downloads",
      visible: true,
      paragraphs: [
        "Sign in to access the options available to your account. Your plan, the asset, and its displayed license may affect download availability and usage."
      ],
      points: [],
      closing: "If an asset or download is unavailable, include its page link when contacting support."
    },
    {
      id: "security-and-privacy",
      title: "Security and privacy",
      visible: true,
      paragraphs: [
        "Protect account credentials and any access details shared with your team. Do not embed private credentials in client-side code or public repositories."
      ],
      points: [],
      closing: "For information about personal data and cookies, see the Privacy Policy and Cookie Policy."
    },
    {
      id: "technical-support",
      title: "Technical support",
      visible: true,
      paragraphs: [
        "When reporting an integration or download issue, include the affected page or asset, the steps you took, the result you expected, and relevant device or browser details."
      ],
      points: [],
      closing: "Never send passwords, payment-card information, or other sensitive credentials in a support request."
    }
  ],
  contact: {
    label: "Need developer support?",
    title: "Talk to our team",
    body: "Contact us with your integration questions or feedback. We will help clarify available options and relevant usage requirements.",
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

export function copyDevelopersContent(content = DEFAULT_DEVELOPERS_CONTENT) {
  return JSON.parse(JSON.stringify(content));
}
