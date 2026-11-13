import {
  extractGoogleTagIdsFromSnippet,
  installGoogleAnalyticsTags,
  normalizeGoogleAnalyticsMeasurementId,
  normalizeGoogleTagManagerId,
} from "./googleAnalyticsTag";

describe("Google Analytics tag helpers", () => {
  beforeEach(() => {
    document.getElementById("gfx-google-analytics-script")?.remove();
    document.getElementById("gfx-google-tag-manager-script")?.remove();
    document.getElementById("gfx-google-tag-manager-noscript")?.remove();
    document.getElementById("gfx-google-analytics-gtag-script")?.remove();
    window.dataLayer = undefined;
    window.gtag = undefined;
  });

  it("validates the GA4 and Google Tag Manager fields independently", () => {
    expect(normalizeGoogleAnalyticsMeasurementId(" g-abc1234567 ")).toBe("G-ABC1234567");
    expect(normalizeGoogleAnalyticsMeasurementId("GTM-T2NG27X8")).toBeNull();
    expect(normalizeGoogleTagManagerId(" gtm-t2ng27x8 ")).toBe("GTM-T2NG27X8");
    expect(normalizeGoogleTagManagerId("G-ABC1234567")).toBeNull();
  });

  it("extracts IDs only from snippets referencing Google's tag manager host", () => {
    const snippet = [
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>',
      "<script>gtag('config', 'G-ABC1234567');</script>",
      '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-T2NG27X8"></script>',
    ].join("");

    expect(extractGoogleTagIdsFromSnippet(snippet)).toEqual({
      measurementId: "G-ABC1234567",
      tagManagerId: "GTM-T2NG27X8",
    });
    expect(() => extractGoogleTagIdsFromSnippet("<script>alert('G-ABC1234567')</script>"))
      .toThrow("official Google tag snippet");
  });

  it("installs both Google tags together when both IDs are provided", () => {
    installGoogleAnalyticsTags({
      measurementId: "G-ABC1234567",
      tagManagerId: "GTM-T2NG27X8",
    });

    expect(document.getElementById("gfx-google-analytics-script").src).toContain(
      "https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"
    );
    expect(document.getElementById("gfx-google-tag-manager-script").src).toContain(
      "https://www.googletagmanager.com/gtm.js?id=GTM-T2NG27X8"
    );
    expect(document.querySelector("#gfx-google-tag-manager-noscript iframe").src).toContain(
      "https://www.googletagmanager.com/ns.html?id=GTM-T2NG27X8"
    );
    expect(window.dataLayer[1]).toMatchObject({ 0: "config", 1: "G-ABC1234567" });
  });

  it("removes integrations that are cleared and replaces updated IDs", () => {
    installGoogleAnalyticsTags({
      measurementId: "G-ABC1234567",
      tagManagerId: "GTM-T2NG27X8",
    });
    installGoogleAnalyticsTags({
      measurementId: "",
      tagManagerId: "GTM-XYZ9876543",
    });

    expect(document.getElementById("gfx-google-analytics-script")).not.toBeInTheDocument();
    expect(document.getElementById("gfx-google-tag-manager-script").src).toContain("GTM-XYZ9876543");
    expect(document.querySelectorAll("#gfx-google-tag-manager-script")).toHaveLength(1);

    installGoogleAnalyticsTags({ measurementId: "", tagManagerId: "" });
    expect(document.getElementById("gfx-google-tag-manager-script")).not.toBeInTheDocument();
    expect(document.getElementById("gfx-google-tag-manager-noscript")).not.toBeInTheDocument();
  });
});
