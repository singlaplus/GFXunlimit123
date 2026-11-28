export const DEFAULT_PARTNERS_CONTENT = {
  hero: {
    eyebrow: "GFXunlimit · Partnership inquiries",
    title: "Partners",
    description: "Explore thoughtful partnerships that help creators and creative teams discover and use visual assets.",
    backgroundImage: "",
    updatedAt: "2026-11-28",
    contactLabel: "Discuss a partnership",
    contactEmail: "hello@gfxunlimit.com",
    cardVisible: true,
    cardIcon: "+",
    cardIconImage: "",
    cardTitle: "Better creative together",
    cardDescription: "Tell us what you are building and explore whether there is a good fit."
  },
  overview: {
    label: "Partnerships",
    title: "Let's create more value together",
    body: "GFXunlimit welcomes conversations with creators, organizations, and products that support the creative community. We review partnership ideas individually; available options, terms, and timelines depend on the proposal and any written agreement."
  },
  sections: [
    {
      id: "partnership-opportunities",
      title: "Ways to work together",
      visible: true,
      paragraphs: [
        "We are open to exploring collaborations that make useful creative resources easier to discover and use. The right approach depends on the goals, rights, and practical scope of each proposal."
      ],
      points: [
        "Creator and contributor initiatives.",
        "Resources or events for creative and educational communities.",
        "Campaigns and content collaborations with aligned organizations.",
        "Platform or product discussions, subject to current technical capabilities."
      ],
      closing: "These are possible areas of discussion, not guaranteed programs or services."
    },
    {
      id: "partner-community",
      title: "Who can reach out",
      visible: true,
      paragraphs: [
        "We welcome inquiries from individuals and organizations with a clear idea and a shared interest in serving creators."
      ],
      points: [
        "Creators, photographers, and contributors.",
        "Design agencies, studios, and creative teams.",
        "Educators and creative communities.",
        "Brands, platforms, and product teams."
      ],
      closing: ""
    },
    {
      id: "discussion-process",
      title: "How partnership discussions work",
      visible: true,
      paragraphs: [
        "Start by sending a short outline of your idea. Our team can review the proposal and, if there is a potential fit, discuss scope and next steps with you."
      ],
      points: [
        "Share your goals, audience, and the kind of collaboration you have in mind.",
        "We review the proposal against current priorities, rights, and capabilities.",
        "Any approved collaboration is confirmed in writing before it is announced or launched."
      ],
      closing: "Submitting an inquiry does not guarantee acceptance or a particular response time."
    },
    {
      id: "proposal-details",
      title: "What to include in your proposal",
      visible: true,
      paragraphs: [
        "A concise introduction helps us understand your idea and determine whether a follow-up would be useful."
      ],
      points: [
        "Your organization, project, or portfolio link.",
        "The audience and goals you hope to reach.",
        "The proposed collaboration, assets, channels, and expected timeline.",
        "Any permissions, technical needs, or other requirements to consider."
      ],
      closing: "Do not include passwords, API keys, payment details, or confidential personal information."
    },
    {
      id: "brand-and-licensing",
      title: "Brand, content, and licensing",
      visible: true,
      paragraphs: [
        "Use GFXunlimit names, logos, and content only where you have permission or the applicable asset license allows it. Do not describe a proposed collaboration as an active partnership until it has been approved and confirmed in writing."
      ],
      points: [],
      closing: "Each party remains responsible for confirming the rights and approvals needed for its contribution."
    },
    {
      id: "partnership-faq",
      title: "Common questions",
      visible: true,
      paragraphs: [
        "Are there standard fees, commissions, or requirements? Terms depend on the specific proposal and are discussed directly if there is a potential fit.",
        "Can we build an integration? Contact us with your use case; technical options depend on current capabilities and must be agreed in advance."
      ],
      points: [],
      closing: ""
    }
  ],
  contact: {
    label: "Interested in partnering?",
    title: "Tell us what you have in mind",
    body: "Send our team a brief introduction and proposal. We will follow up if it aligns with current priorities.",
    email: "hello@gfxunlimit.com"
  },
  appearance: {
    heroStart: "#172554",
    heroEnd: "#0f766e",
    accent: "#0f766e",
    surface: "#ffffff",
    density: "comfortable",
    showTableOfContents: true
  }
};

export function copyPartnersContent(content = DEFAULT_PARTNERS_CONTENT) {
  return JSON.parse(JSON.stringify(content));
}
