export const THEME_KEY = "streamlion-theme-v1";
export function preferredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* A theme still works when browser storage is unavailable. */
  }
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
// Apply, remember and announce a theme so a mounted ThemeSwitch stays in sync.
export function saveTheme(theme) {
  applyTheme(theme);
  let saved = true;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    saved = false;
  }
  window.dispatchEvent(
    new window.CustomEvent("streamlion-theme-changed", { detail: theme }),
  );
  return saved;
}
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#101923" : "#f3f6f8");
}
