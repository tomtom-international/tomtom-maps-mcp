export type Theme = "light" | "dark";

type ThemeListener = (theme: Theme) => void;

const listeners = new Set<ThemeListener>();

let currentTheme: Theme = window.matchMedia("(prefers-color-scheme: dark)").matches
  ? "dark"
  : "light";

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

applyTheme(currentTheme);

export function getTheme(): Theme {
  return currentTheme;
}

export function setTheme(theme: Theme): void {
  if (theme === currentTheme) return;
  currentTheme = theme;
  applyTheme(theme);
  listeners.forEach((listener) => listener(theme));
}

export function toggleTheme(): Theme {
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  setTheme(newTheme);
  return newTheme;
}

export function onThemeChange(listener: ThemeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  setTheme(e.matches ? "dark" : "light");
});
