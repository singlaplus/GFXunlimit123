import PrivacyPolicyPage from "./PrivacyPolicyPage";
import {
  copyDevelopersContent,
  DEFAULT_DEVELOPERS_CONTENT
} from "./developersContent";

const DEVELOPERS_PAGE_CONFIG = {
  pageName: "Developers",
  contentPath: "developers",
  sectionLabel: "Developer resources",
  dateLabel: "Last updated",
  datePrefix: "Updated:",
  summaryCardLabel: "Show developer summary card",
  defaultContent: DEFAULT_DEVELOPERS_CONTENT,
  copyContent: copyDevelopersContent
};

export default function DevelopersPage({ isAdmin = false }) {
  return <PrivacyPolicyPage isAdmin={isAdmin} pageConfig={DEVELOPERS_PAGE_CONFIG} />;
}
