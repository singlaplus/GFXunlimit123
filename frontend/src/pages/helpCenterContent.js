export const DEFAULT_HELP_CENTER_CONTENT = {
  hero: {
    eyebrow: "GFXunlimit · Support",
    title: "Help Center",
    description: "Find answers to common questions about your account, downloads, licenses, and using GFXunlimit.",
    backgroundImage: "",
    updatedAt: "2026-11-28",
    contactLabel: "Contact support",
    contactEmail: "hello@gfxunlimit.com",
    cardVisible: true,
    cardIcon: "?",
    cardIconImage: "",
    cardTitle: "How can we help?",
    cardDescription: "Browse the answers below or get in touch with our support team."
  },
  overview: {
    label: "Support and answers",
    title: "What do you need help with?",
    body: "Explore the topics below for help with GFXunlimit. If you still need assistance, contact our support team and include the page or asset you are asking about."
  },
  sections: [
    {
      id: "create-or-access-account",
      title: "How do I create or access my account?",
      visible: true,
      paragraphs: [
        "Choose Join Free to create an account, or Login if you already have one. If you cannot sign in, check your email and password and use the account recovery options shown on the login screen."
      ],
      points: [],
      closing: ""
    },
    {
      id: "download-assets",
      title: "How do I download an asset?",
      visible: true,
      paragraphs: [
        "Open the asset page and follow its available download or purchase options. Access can depend on the asset, your account, and the plan or license shown on the site."
      ],
      points: [],
      closing: ""
    },
    {
      id: "find-downloads",
      title: "Where can I find my previous downloads?",
      visible: true,
      paragraphs: [
        "Sign in and open your account's downloads area to review items associated with your account. If a recent download is missing, contact support with the asset link and the approximate download date."
      ],
      points: [],
      closing: ""
    },
    {
      id: "asset-usage-rights",
      title: "What usage rights apply to an asset?",
      visible: true,
      paragraphs: [
        "Usage rights can vary by asset and license. Review the license information displayed with the asset before using it, and contact support if a license term is unclear."
      ],
      points: [],
      closing: ""
    },
    {
      id: "plans-and-credits",
      title: "How do plans, credits, and pricing work?",
      visible: true,
      paragraphs: [
        "Available plans, prices, and included features are listed on the Pricing page. Review the details there before purchasing, since access and limits may differ between offers."
      ],
      points: [],
      closing: ""
    },
    {
      id: "become-contributor",
      title: "How can I become a contributor?",
      visible: true,
      paragraphs: [
        "Choose Become a Contributor to learn about joining and submitting your work. Follow the instructions in your account to complete the contributor setup."
      ],
      points: [],
      closing: ""
    },
    {
      id: "contact-support",
      title: "What should I include when contacting support?",
      visible: true,
      paragraphs: [
        "Describe what you were trying to do, what happened, and the page or asset involved. Do not include your password or payment-card details."
      ],
      points: [],
      closing: ""
    }
  ],
  contact: {
    label: "We’re here to help",
    title: "Still need help?",
    body: "Send our team a message and include enough detail for us to understand your question.",
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

export function copyHelpCenterContent(content = DEFAULT_HELP_CENTER_CONTENT) {
  return JSON.parse(JSON.stringify(content));
}
