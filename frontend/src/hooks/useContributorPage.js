import { getContributorStats } from "../utils/contributorUtils";

export default function useContributorPage(
  images,
  viewContributorPage
) {
  return getContributorStats(
    images,
    viewContributorPage
  );
}