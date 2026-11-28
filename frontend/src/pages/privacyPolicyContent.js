export const DEFAULT_PRIVACY_POLICY_CONTENT = {
  hero: {
    eyebrow: "GFXunlimit · Legal",
    title: "Privacy Policy",
    description: "A clear guide to the information we handle, why we use it, and the choices available to you when you use GFXunlimit.",
    backgroundImage: "",
    updatedAt: "2026-11-28",
    contactLabel: "Questions? Contact us",
    contactEmail: "hello@gfxunlimit.com",
    cardVisible: true,
    cardIcon: "P",
    cardIconImage: "",
    cardTitle: "Your privacy matters",
    cardDescription: "Understand your data and your choices."
  },
  overview: {
    label: "The essentials",
    title: "How this Policy works",
    body: "This Policy explains how GFXunlimit collects, uses, and shares personal information when you browse the marketplace, create an account, upload or download content, make a purchase, or contact us. Some details depend on the features you use and the choices you make."
  },
  sections: [
    {
      id: "information-we-collect",
      title: "Information we collect",
      visible: true,
      paragraphs: [
        "The information we handle depends on how you use GFXunlimit. It may include information you provide, details about your activity on the marketplace, and technical data needed to operate and protect the service."
      ],
      points: [
        "Account and profile details, such as your name, email address, and information you choose to add to your profile.",
        "Marketplace and contributor activity, including searches, downloads, favorites, uploads, asset descriptions, and related account activity.",
        "Order and subscription details, such as the plan selected, transaction status, billing contact details, and receipts. Payment credentials may be handled by the payment provider used at checkout.",
        "Messages and information you send when requesting support or otherwise contacting us.",
        "Device and usage information, such as browser type, device details, approximate location derived from network information, pages visited, and diagnostic or event data."
      ],
      closing: ""
    },
    {
      id: "how-we-use-information",
      title: "How we use information",
      visible: true,
      paragraphs: [
        "We use information for purposes that support the features you choose to use, including to:"
      ],
      points: [
        "Provide, maintain, and improve GFXunlimit, user accounts, marketplace features, downloads, and contributor tools.",
        "Process orders and subscriptions, provide customer support, and send service, security, or account-related messages.",
        "Understand site performance and usage so we can improve reliability and the experience of the marketplace.",
        "Protect users and the service, detect misuse or fraud, troubleshoot problems, and meet legal obligations.",
        "Send promotional communications where permitted. You can opt out of marketing emails using the instructions in the message."
      ],
      closing: ""
    },
    {
      id: "cookies",
      title: "Cookies and similar technologies",
      visible: true,
      paragraphs: [
        "GFXunlimit and its service providers may use cookies, local storage, and similar technologies to keep the site working, remember preferences, understand usage, and help protect accounts. You can manage cookies through your browser settings. Blocking some cookies may affect site features or sign-in."
      ],
      points: [],
      closing: ""
    },
    {
      id: "sharing-information",
      title: "When information may be shared",
      visible: true,
      paragraphs: [
        "We may share information when it is needed to provide the service or for another purpose described in this Policy:"
      ],
      points: [
        "With service providers that support hosting, storage, payments, communications, analytics, customer support, and security.",
        "With other users when you choose to publish a profile, upload, or other content in a public area of the marketplace.",
        "When required by law, or when reasonably necessary to protect users, the public, or GFXunlimit and its rights.",
        "As part of a business reorganization, merger, or transfer, subject to appropriate safeguards."
      ],
      closing: "Service providers process information under their own privacy terms and the arrangements they have with us."
    },
    {
      id: "retention",
      title: "How long we keep information",
      visible: true,
      paragraphs: [
        "We keep information for as long as needed to provide the service and for legitimate business purposes such as maintaining records, resolving disputes, enforcing agreements, and meeting legal requirements. Retention periods depend on the type of information and why it was collected. When information is no longer needed, we take steps to delete or de-identify it where appropriate."
      ],
      points: [],
      closing: ""
    },
    {
      id: "your-choices",
      title: "Your choices and privacy rights",
      visible: true,
      paragraphs: [
        "You can update some account information in your profile and opt out of promotional emails using the unsubscribe instructions provided. Your browser may also let you control cookies and similar storage.",
        "Depending on where you live, applicable privacy laws may give you rights to request access to, correction or deletion of, or a copy of your personal information, or to object to or limit certain processing. To make a request, contact us using the details below. We may need to verify your identity and will respond as required by applicable law."
      ],
      points: [],
      closing: ""
    },
    {
      id: "security",
      title: "Security",
      visible: true,
      paragraphs: [
        "We use reasonable administrative, technical, and organizational safeguards designed to protect information. No website or method of transmission is completely secure, so please use a strong password and contact us if you believe your account may have been compromised."
      ],
      points: [],
      closing: ""
    },
    {
      id: "international",
      title: "International processing",
      visible: true,
      paragraphs: [
        "GFXunlimit and its service providers may process information in countries other than the one where you live. Where required, we use appropriate safeguards for cross-border transfers in accordance with applicable law."
      ],
      points: [],
      closing: ""
    },
    {
      id: "children",
      title: "Children's privacy",
      visible: true,
      paragraphs: [
        "If you are a parent or guardian and believe a child has provided personal information to GFXunlimit, please contact us. We will review the request and take appropriate steps under applicable law."
      ],
      points: [],
      closing: ""
    },
    {
      id: "policy-updates",
      title: "Changes to this Policy",
      visible: true,
      paragraphs: [
        "We may update this Policy as the service or our practices change. When we do, we will publish the revised version here and update the date shown at the top. If a change requires additional notice, we will provide it as required by law."
      ],
      points: [],
      closing: ""
    }
  ],
  contact: {
    label: "We’re here to help",
    title: "Contact us about privacy",
    body: "For privacy questions or requests about your personal information, email our team.",
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

export function copyPrivacyPolicyContent(content = DEFAULT_PRIVACY_POLICY_CONTENT) {
  return JSON.parse(JSON.stringify(content));
}
