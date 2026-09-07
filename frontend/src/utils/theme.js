export const THEME_STORAGE_KEY = "gfxunlimit-theme";

export const getInitialDarkMode = () => {
  if (typeof window === "undefined") return false;

  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "dark") return true;
  if (storedTheme === "light") return false;

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
};

export const applyTheme = (isDarkMode) => {
  if (typeof document === "undefined") return;

  document.documentElement.setAttribute("data-theme", isDarkMode ? "dark" : "light");
  document.body.classList.toggle("dark-mode", isDarkMode);
  document.body.style.background = isDarkMode ? "#121212" : "#f5f5f5";
  document.body.style.color = isDarkMode ? "#f5f5f5" : "#1f2937";
  document.documentElement.style.colorScheme = isDarkMode ? "dark" : "light";

  if (typeof window !== "undefined") {
    localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? "dark" : "light");
  }
};
