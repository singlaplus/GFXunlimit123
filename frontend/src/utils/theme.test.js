import { applyTheme, getInitialDarkMode, THEME_STORAGE_KEY } from "./theme";

describe("theme persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.body.classList.remove("dark-mode");
  });

  it("applies dark mode and stores the preference", () => {
    applyTheme(true);

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.body.classList.contains("dark-mode")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("reads a saved preference on startup", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");

    expect(getInitialDarkMode()).toBe(true);
  });
});
