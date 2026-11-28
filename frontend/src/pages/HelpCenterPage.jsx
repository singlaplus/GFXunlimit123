import PrivacyPolicyPage from "./PrivacyPolicyPage";
import {
  copyHelpCenterContent,
  DEFAULT_HELP_CENTER_CONTENT
} from "./helpCenterContent";

const HELP_CENTER_PAGE_CONFIG = {
  pageName: "Help Center",
  contentPath: "help-center",
  sectionLabel: "Help questions",
  dateLabel: "Last updated",
  datePrefix: "Updated:",
  summaryCardLabel: "Show help summary card",
  defaultContent: DEFAULT_HELP_CENTER_CONTENT,
  copyContent: copyHelpCenterContent
};

export default function HelpCenterPage({ isAdmin = false }) {
  return <PrivacyPolicyPage isAdmin={isAdmin} pageConfig={HELP_CENTER_PAGE_CONFIG} />;
}
