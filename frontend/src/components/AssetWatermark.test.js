import { render, screen, waitFor } from "@testing-library/react";
import AssetWatermark from "./AssetWatermark";
import { assetWatermark } from "../utils/assetWatermark";

describe("AssetWatermark", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("exposes the canonical assetWatermark pattern and opacity settings", () => {
    expect(assetWatermark).toEqual({
      opacity: 0.28,
      rotation: -30,
      fontSizeRatio: 0.055,
      minimumFontSize: 22,
      patternFontSizeMultiplier: 10,
      minimumPatternSize: 240,
      logoSizeRatio: 0.72,
      faviconSizeRatio: 0.22,
      minimumFaviconSize: 20,
      faviconInset: 6,
    });
  });

  it("uses configured branding assets in a repeated, diagonal, low-opacity pattern", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        logo: "/api/files/branding/site-logo.png",
        favicon: "/api/files/branding/site-favicon.png",
        watermarkLogo: "/api/files/branding/watermark-logo.png",
        watermarkFavicon: "/api/files/branding/watermark-favicon.png",
      }),
    });

    render(<AssetWatermark width={1281} height={1920} />);

    const pattern = await screen.findByTestId("asset-watermark");
    await waitFor(() => {
      expect(pattern.querySelectorAll("image").length).toBeGreaterThan(0);
    });
    expect(pattern).toHaveAttribute("viewBox", "0 0 1281 1920");
    const tile = screen.getByTestId("asset-watermark-pattern");
    expect(tile).toHaveAttribute("patternTransform", "rotate(-30)");
    expect(pattern.querySelectorAll("image")).toHaveLength(5);
    expect(pattern.querySelector('image[href="http://localhost:5000/api/files/branding/watermark-logo.png"]'))
      .toHaveAttribute("width", "504");
    expect(pattern.querySelector('image[href="http://localhost:5000/api/files/branding/watermark-favicon.png"]'))
      .toHaveAttribute("opacity", "0.28");
    expect(tile).toHaveAttribute("width", "700");
    expect(tile).toHaveAttribute("height", "700");
    expect(tile).toHaveAttribute("patternUnits", "userSpaceOnUse");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/branding",
      expect.objectContaining({ credentials: "include" })
    );
  });
});
