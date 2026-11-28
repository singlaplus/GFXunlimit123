import PrivacyPolicyPage from "./PrivacyPolicyPage";
import {
  copyTermsAndConditionsContent,
  DEFAULT_TERMS_AND_CONDITIONS_CONTENT
} from "./termsAndConditionsContent";

const TERMS_AND_CONDITIONS_PAGE_CONFIG = {
  pageName: "Terms & Conditions",
  contentPath: "terms-and-conditions",
  sectionLabel: "Terms sections",
  dateLabel: "Effective date",
  datePrefix: "Effective:",
  summaryCardLabel: "Show terms summary card",
  defaultContent: DEFAULT_TERMS_AND_CONDITIONS_CONTENT,
  copyContent: copyTermsAndConditionsContent
};

export default function TermsAndConditionsPage({ isAdmin = false }) {
  return <PrivacyPolicyPage isAdmin={isAdmin} pageConfig={TERMS_AND_CONDITIONS_PAGE_CONFIG} />;
}
