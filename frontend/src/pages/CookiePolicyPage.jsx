import PrivacyPolicyPage from "./PrivacyPolicyPage";
import {
  copyCookiePolicyContent,
  DEFAULT_COOKIE_POLICY_CONTENT
} from "./cookiePolicyContent";

const COOKIE_POLICY_PAGE_CONFIG = {
  pageName: "Cookie Policy",
  contentPath: "cookie-policy",
  sectionLabel: "Cookie sections",
  dateLabel: "Last updated",
  datePrefix: "Last updated:",
  summaryCardLabel: "Show cookie summary card",
  defaultContent: DEFAULT_COOKIE_POLICY_CONTENT,
  copyContent: copyCookiePolicyContent
};

export default function CookiePolicyPage({ isAdmin = false }) {
  return <PrivacyPolicyPage isAdmin={isAdmin} pageConfig={COOKIE_POLICY_PAGE_CONFIG} />;
}
