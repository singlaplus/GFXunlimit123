import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";

const wizardPath = path.resolve(__dirname, "../../../restore-wizard/restore-wizard.html");
const wizardHtml = fs.readFileSync(wizardPath, "utf8");

function openWizard(platformProperties = {}) {
  return new JSDOM(wizardHtml, {
    runScripts: "dangerously",
    url: "http://127.0.0.1:43127/",
    beforeParse(window) {
      for (const [name, value] of Object.entries(platformProperties)) {
        Object.defineProperty(window.navigator, name, { configurable: true, value });
      }
    }
  });
}

describe("standalone Restore Wizard", () => {
  it("detects the host as a hint but requires an explicit restore target", () => {
    const dom = openWizard({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" });
    const { document, Event } = dom.window;
    const select = document.getElementById("targetPlatform");
    const steps = document.getElementById("wizardSteps");

    expect(document.getElementById("platform").textContent).toMatch(/appears to be on macOS.*only a hint/i);
    expect(select.value).toBe("");
    expect(steps.hidden).toBe(true);

    select.value = "Windows";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(steps.hidden).toBe(false);
    expect(document.getElementById("targetHelp").textContent).toMatch(/Selected restore target: Windows/);
    expect(document.querySelector('[data-target="Windows"]').hidden).toBe(false);
    expect(document.querySelector('[data-target="macOS"]').hidden).toBe(true);
    dom.window.close();
  });

  it("does not misidentify the helper's Darwin platform as Windows", async () => {
    const dom = openWizard({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    const { document, Event } = dom.window;
    const select = document.getElementById("targetPlatform");
    select.value = "macOS";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("token").value = "test-only-helper-token-long-enough";
    dom.window.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prerequisites: { platform: "darwin", checks: [] } })
    });

    document.getElementById("prerequisitesButton").click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById("platform").textContent).toMatch(/Helper is running on macOS/);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.getElementById("databaseFile").placeholder).toBe("/Users/you/StocksitePackage/stocksite.backup");
    dom.window.close();
  });

  it("does not guess when host detection is ambiguous and blocks a mismatched helper", async () => {
    const dom = openWizard({ platform: "", userAgent: "Unknown Browser" });
    const { document, Event } = dom.window;
    const select = document.getElementById("targetPlatform");

    expect(document.getElementById("platform").textContent).toMatch(/could not reliably identify/i);
    expect(select.value).toBe("");
    select.value = "macOS";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("token").value = "test-only-helper-token-long-enough";
    dom.window.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ prerequisites: { platform: "win32", checks: [] } })
    });

    document.getElementById("prerequisitesButton").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[role="alert"]').textContent).toMatch(/selected target is macOS.*helper is running on Windows/i);

    document.getElementById("configureButton").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById("configurationStatus").textContent).toMatch(/helper is running on Windows/i);
    expect(dom.window.fetch).toHaveBeenCalledTimes(1);
    dom.window.close();
  });

  it("keeps required source, destination, security, and approval controls in the guided flow", () => {
    const dom = openWizard();
    const { document } = dom.window;

    for (const id of [
      "databaseFile", "websiteArchive", "assetsArchive", "thumbnailsArchive",
      "websiteDestination", "assetsDestination", "thumbnailsDestination",
      "packageSigningPublicKey", "validateButton", "authorize", "startButton"
    ]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(document.body.textContent).toMatch(/trusted channel/i);
    expect(document.body.textContent).toMatch(/empty database/i);
    expect(document.body.textContent).toMatch(/does not decrypt or apply those settings/i);
    expect(document.body.textContent).toMatch(/each later action will still ask for separate approval/i);
    dom.window.close();
  });
});
