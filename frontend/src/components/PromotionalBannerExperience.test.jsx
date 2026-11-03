import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import {
  PromotionalBannerPlacements
} from "./PromotionalBannerExperience";
import PromotionalBannerPage from "./PromotionalBannerExperience";
import { likeImageRequest } from "../services/imageService";
import { loadCartItems, saveCartItems } from "../utils/cartPersistence";

jest.mock("axios");
jest.mock("../services/imageService", () => ({
  likeImageRequest: jest.fn()
}));
jest.mock("../utils/cartPersistence", () => ({
  loadCartItems: jest.fn(),
  saveCartItems: jest.fn()
}));

const banner = {
  id: 12,
  name: "Summer Sale",
  slug: "summer-sale",
  placement: "left",
  icon_url: "/public/promotional-banners/summer-sale/icon",
  metadata: { popup_audience: null }
};

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.removeItem("token");
  axios.get.mockResolvedValue({ data: { banners: [banner] } });
  likeImageRequest.mockResolvedValue({ data: { likes: 1 } });
  loadCartItems.mockResolvedValue([]);
  saveCartItems.mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

test("shows active placement icons as links to readable banner pages", async () => {
  axios.get.mockResolvedValue({
    data: {
      banners: [{
        ...banner,
        metadata: { sparkle_style: "falling_sparkles" }
      }]
    }
  });
  render(
    <PromotionalBannerPlacements
      userRole="customer"
      pathname="/explore"
      authStatus="authenticated"
    />
  );

  const link = await screen.findByRole("link", { name: "Open promotion: Summer Sale" });
  expect(link).toHaveAttribute("href", "/promotionbanners/summer-sale");
  expect(link.querySelector("img")).toHaveAttribute(
    "src",
    expect.stringContaining("/public/promotional-banners/summer-sale/icon")
  );
  expect(link).toHaveClass("promotion-banner-placement-link--falling_sparkles");
});

test("supports disabling the sparkle animation for a banner", async () => {
  axios.get.mockResolvedValue({
    data: {
      banners: [{
        ...banner,
        metadata: { sparkle_style: "none" }
      }]
    }
  });
  render(
    <PromotionalBannerPlacements
      userRole="customer"
      pathname="/explore"
      authStatus="authenticated"
    />
  );
  const link = await screen.findByRole("link", { name: "Open promotion: Summer Sale" });
  expect(link).toHaveClass("promotion-banner-placement-link--none");
});

test.each([
  "snowfall",
  "shimmer_sweep",
  "fireflies",
  "star_trail",
  "pulsing_glow",
  "aurora_glow",
  "confetti_sparkles"
])("applies the %s animation to the selected banner", async (sparkleStyle) => {
  axios.get.mockResolvedValue({
    data: {
      banners: [{
        ...banner,
        metadata: { sparkle_style: sparkleStyle }
      }]
    }
  });
  render(
    <PromotionalBannerPlacements
      userRole="customer"
      pathname="/explore"
      authStatus="authenticated"
    />
  );
  const link = await screen.findByRole("link", { name: "Open promotion: Summer Sale" });
  expect(link).toHaveClass(`promotion-banner-placement-link--${sparkleStyle}`);
});

test("hides all promotional icons and avoids loading them for admins", () => {
  render(
    <PromotionalBannerPlacements
      userRole="admin"
      pathname="/"
      authStatus="authenticated"
    />
  );

  expect(screen.queryByRole("link", { name: /Open promotion/ })).not.toBeInTheDocument();
  expect(axios.get).not.toHaveBeenCalled();
});

test("shows popup banners only for the configured audience and allows dismissal", async () => {
  axios.get.mockResolvedValue({
    data: {
      banners: [{
        ...banner,
        placement: "popup",
        metadata: { popup_audience: "logged_in_customers" }
      }]
    }
  });
  const { rerender } = render(
    <PromotionalBannerPlacements userRole="" pathname="/" authStatus="anonymous" />
  );
  await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  rerender(
    <PromotionalBannerPlacements userRole="customer" pathname="/" authStatus="authenticated" />
  );
  const popup = await screen.findByRole("dialog", { name: "Summer Sale promotion" });
  fireEvent.click(screen.getByRole("button", { name: "Close promotion" }));
  expect(popup).not.toBeInTheDocument();
  expect(window.sessionStorage.getItem("promotionalBannerPopupRepeatDismissals")).toContain("\"12\"");
});

test.each([
  ["customer", "logged_in_customers"],
  ["contributor", "logged_in_contributors"]
])("%s popup repeats after two minutes only after visiting another page", async (role, audience) => {
  axios.get.mockResolvedValue({
    data: {
      banners: [{
        ...banner,
        placement: "popup",
        metadata: { popup_audience: audience }
      }]
    }
  });
  jest.useFakeTimers();
  const { rerender } = render(
    <PromotionalBannerPlacements userRole={role} pathname="/" authStatus="authenticated" />
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole("dialog", { name: "Summer Sale promotion" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Close promotion" }));
  act(() => {
    jest.advanceTimersByTime(2 * 60 * 1000);
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  rerender(
    <PromotionalBannerPlacements userRole={role} pathname="/explore" authStatus="authenticated" />
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  rerender(
    <PromotionalBannerPlacements userRole={role} pathname="/" authStatus="authenticated" />
  );
  expect(screen.getByRole("dialog", { name: "Summer Sale promotion" })).toBeInTheDocument();
});

test("waits for the full repeat delay after a customer returns home early", async () => {
  axios.get.mockResolvedValue({
    data: {
      banners: [{
        ...banner,
        placement: "popup",
        metadata: { popup_audience: "logged_in_customers" }
      }]
    }
  });
  jest.useFakeTimers();
  const { rerender } = render(
    <PromotionalBannerPlacements userRole="customer" pathname="/" authStatus="authenticated" />
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole("dialog", { name: "Summer Sale promotion" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Close promotion" }));
  rerender(
    <PromotionalBannerPlacements userRole="customer" pathname="/explore" authStatus="authenticated" />
  );
  rerender(
    <PromotionalBannerPlacements userRole="customer" pathname="/" authStatus="authenticated" />
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  act(() => {
    jest.advanceTimersByTime(2 * 60 * 1000);
  });
  expect(screen.getByRole("dialog", { name: "Summer Sale promotion" })).toBeInTheDocument();
});

test("shows selected live assets on the promotional banner page", async () => {
  axios.get.mockResolvedValue({
    data: {
      banner: {
        ...banner,
        assets: [{
          id: 193,
          title: "Featured photo",
          filename: "featured-photo.jpg",
          thumbnail_generated_at: "2026-10-30T12:00:00.000Z"
        }]
      }
    }
  });

  render(<PromotionalBannerPage slug="summer-sale" />);

  expect(await screen.findByRole("heading", { name: "Promotional assets" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Summer Sale promotion" })).toContainElement(
    screen.getByRole("img", { name: "Summer Sale" })
  );
  const assetLink = screen.getByRole("link", { name: /Featured photo/ });
  expect(assetLink).toHaveAttribute("href", "/asset/featured-photo-193");
  expect(assetLink.querySelector("img")).toHaveAttribute(
    "src",
    expect.stringContaining("/api/assets/193/thumbnail")
  );
  expect(screen.queryByRole("button", { name: /Like|Share|Add to cart/ })).not.toBeInTheDocument();
});

const promotionalAsset = {
  id: 193,
  title: "Featured photo",
  filename: "featured-photo.jpg",
  thumbnail_generated_at: "2026-10-30T12:00:00.000Z"
};

const renderPromotionalAssetPage = (userRole = "") => {
  axios.get.mockResolvedValue({
    data: {
      banner: {
        ...banner,
        slug: "summer-sale",
        assets: [promotionalAsset]
      }
    }
  });
  return render(<PromotionalBannerPage slug="summer-sale" userRole={userRole} />);
};

test("contributors can view promotional assets but cannot click images or use asset actions", async () => {
  renderPromotionalAssetPage("contributor");

  await screen.findByRole("heading", { name: "Promotional assets" });
  expect(screen.queryByRole("link", { name: /Featured photo/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Like|Share|Add to cart/ })).not.toBeInTheDocument();
});

test("logged-in customers can like, share, and add promotional assets to cart for free", async () => {
  window.localStorage.setItem("token", "customer-token");
  renderPromotionalAssetPage("customer");

  await screen.findByRole("heading", { name: "Promotional assets" });
  expect(screen.getByRole("link", { name: /Featured photo/ })).toHaveAttribute(
    "href",
    "/asset/featured-photo-193"
  );
  fireEvent.click(screen.getByRole("button", { name: "Like" }));
  await waitFor(() => expect(likeImageRequest).toHaveBeenCalledWith(193));

  const originalShare = navigator.share;
  const shareMock = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "share", { configurable: true, value: shareMock });
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  await waitFor(() => expect(shareMock).toHaveBeenCalledWith({
    title: "Featured photo",
    url: expect.stringContaining("/asset/featured-photo-193")
  }));
  if (originalShare === undefined) delete navigator.share;
  else Object.defineProperty(navigator, "share", { configurable: true, value: originalShare });

  fireEvent.click(screen.getByRole("button", { name: "Add to cart · Free" }));
  await waitFor(() => expect(saveCartItems).toHaveBeenCalledTimes(1));
  expect(saveCartItems.mock.calls[0][0][0]).toMatchObject({
    id: 193,
    price: 0,
    unitPrice: 0,
    freeAsset: true,
    promotionalBannerSlug: "summer-sale"
  });
});
