import { useEffect, useState } from "react";

export default function useContributorNavigation() {
  const [viewContributorPage, setViewContributorPage] =
    useState(null);

  const testSetContributor = (name) => {
    console.log("FUNCTION CALLED:", name);
    setViewContributorPage(name);
  };

  useEffect(() => {
    console.log(
      "VIEW CONTRIBUTOR CHANGED:",
      viewContributorPage
    );
  }, [viewContributorPage]);

  return {
    viewContributorPage,
    setViewContributorPage,
    testSetContributor,
  };
}