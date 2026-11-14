import { render, screen } from "@testing-library/react";
import Footer from "./Footer";

test("renders a sitemap link in the Resources footer section", () => {
  render(<Footer />);

  const resourcesHeading = screen.getByRole("heading", { name: "Resources" });
  const resources = resourcesHeading.parentElement;
  const sitemapLink = screen.getByRole("link", { name: "Sitemap" });

  expect(resources).toContainElement(sitemapLink);
  expect(sitemapLink).toHaveAttribute("href", "/sitemap");
});
