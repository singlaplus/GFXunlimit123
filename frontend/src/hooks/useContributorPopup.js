import { getContributorPopupStats } from "../utils/leaderboardUtils";

export default function useContributorPopup(
  images,
  selectedContributor
) {
  return getContributorPopupStats(
    images,
    selectedContributor
  );
}