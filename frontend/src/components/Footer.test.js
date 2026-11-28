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

test("links to the canonical Privacy Policy URL", () => {
  render(<Footer />);

  expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy-policy");
});

test("links to the canonical Help Center URL", () => {
  render(<Footer />);

  expect(screen.getByRole("link", { name: "Help Center" })).toHaveAttribute("href", "/help-center");
});
