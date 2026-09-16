import {
  INACTIVITY_TIMEOUT_MS,
  getRemainingInactivityMs,
  isPageVisible,
} from "./inactivitySession";

describe("inactivity session visibility handling", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("pauses the inactivity countdown while the tab is hidden", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    expect(isPageVisible()).toBe(false);
    expect(getRemainingInactivityMs(Date.now() - INACTIVITY_TIMEOUT_MS)).toBe(INACTIVITY_TIMEOUT_MS);
  });

  it("resumes the inactivity countdown when the tab becomes visible again", () => {
    const lastActivityAt = Date.now() - 5000;

    expect(isPageVisible()).toBe(true);
    expect(getRemainingInactivityMs(lastActivityAt)).toBeLessThan(INACTIVITY_TIMEOUT_MS);
    expect(getRemainingInactivityMs(lastActivityAt)).toBeGreaterThanOrEqual(0);
  });
});
