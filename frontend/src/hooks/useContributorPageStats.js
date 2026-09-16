import { getContributorStats } from "../utils/contributorUtils";

export default function useContributorPageStats(
  images,
  viewContributorPage
) {
  return getContributorStats(
    images,
    viewContributorPage
  );
}