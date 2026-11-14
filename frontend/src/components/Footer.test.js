import { render, screen } from "@testing-library/react";
import Footer from "./Footer";
import { API_BASE_URL } from "../utils/apiBaseUrl";

test("renders a sitemap link in the Resources footer section", () => {
  render(<Footer />);

  const resourcesHeading = screen.getByRole("heading", { name: "Resources" });
  const resources = resourcesHeading.parentElement;
  const sitemapLink = screen.getByRole("link", { name: "Sitemap" });

  expect(resources).toContainElement(sitemapLink);
  expect(sitemapLink).toHaveAttribute("href", `${API_BASE_URL}/sitemap`);
});
