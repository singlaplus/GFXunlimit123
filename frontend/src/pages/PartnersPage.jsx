import PrivacyPolicyPage from "./PrivacyPolicyPage";
import {
  copyPartnersContent,
  DEFAULT_PARTNERS_CONTENT
} from "./partnersContent";

const PARTNERS_PAGE_CONFIG = {
  pageName: "Partners",
  contentPath: "partners",
  sectionLabel: "Partnership information",
  dateLabel: "Last updated",
  datePrefix: "Updated:",
  summaryCardLabel: "Show partnership summary card",
  defaultContent: DEFAULT_PARTNERS_CONTENT,
  copyContent: copyPartnersContent
};

export default function PartnersPage({ isAdmin = false }) {
  return <PrivacyPolicyPage isAdmin={isAdmin} pageConfig={PARTNERS_PAGE_CONFIG} />;
}
