import { fireEvent, render, screen, within } from "@testing-library/react";
import axios from "axios";
import SitemapPage from "./SitemapPage";
import { API_BASE_URL } from "../utils/apiBaseUrl";

jest.mock("axios");
jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/sitemap" }),
  useNavigate: () => jest.fn(),
}));

test("loads and displays sitemap categories and the XML link", async () => {
  axios.get.mockResolvedValue({
    data: {
      groups: [{
        id: "main",
        title: "Main pages",
        entries: [
          { href: "https://gfxunlimit.com/", label: "Home", lastModified: "2026-11-14" },
          { href: "https://gfxunlimit.com/about", label: "About Us" },
          { href: "https://gfxunlimit.com/pricing", label: "Pricing" },
          { href: "https://gfxunlimit.com/careers", label: "Careers" },
          { href: "https://gfxunlimit.com/contact", label: "Contact" },
        ],
      }],
      totalUrls: 5,
      generatedAt: "2026-11-14T00:00:00.000Z",
    },
  });

  const { container } = render(<SitemapPage />);

  const categoryButton = await screen.findByRole("button", { name: /Main pages/ });
  expect(categoryButton).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();

  fireEvent.click(categoryButton);
  expect(categoryButton).toHaveAttribute("aria-expanded", "true");
  const pagesGrid = screen.getByRole("region", { name: "Main pages page grid" });
  expect(pagesGrid).toBeVisible();
  expect(within(pagesGrid).getAllByRole("link")).toHaveLength(2);
  expect(within(pagesGrid).getByRole("link", { name: /^Home/ })).toHaveAttribute("href", "https://gfxunlimit.com/");
  expect(screen.getByText("Total Pages: 5")).toBeInTheDocument();
  fireEvent.click(within(pagesGrid).getByRole("button", { name: /^Next/ }));
  expect(within(pagesGrid).getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "https://gfxunlimit.com/pricing");
  expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View XML sitemap" })).toHaveAttribute("href", "/sitemap.xml");
  expect(axios.get).toHaveBeenCalledWith(`${API_BASE_URL}/sitemap-page-data`);

  fireEvent.click(categoryButton);
  expect(categoryButton).toHaveAttribute("aria-expanded", "false");
  expect(container.querySelector("#public-sitemap-category-pages")).toHaveAttribute("hidden");
});
