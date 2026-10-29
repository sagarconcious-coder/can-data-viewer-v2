import { useCallback, useEffect, useState } from "react";

// Persisted the same way sidebar-collapsed is (see Sidebar.jsx) - a real
// Electron app with a stable origin, so this is a durable user preference.
const THEME_STORAGE_KEY = "cdv.theme.v1";

// Cycle order for the toggle button. Two green-energy (Aeidth brand) themes
// plus the original blue/purple palette kept as "Classic".
export const THEMES = [
  { id: "green-light", label: "Green (Light)", icon: "🌿" },
  { id: "green-dark", label: "Green (Dark)", icon: "🌙" },
  { id: "classic", label: "Classic", icon: "🎨" },
];

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (THEMES.some((t) => t.id === saved)) return saved;
  } catch {
    // ignore - fall through to default
  }
  return "green-light";
}

/**
 * Owns the app-wide theme selection, applied via `data-theme` on <html> so
 * every CSS var defined in theme.css re-skins the whole app at once.
 * Lives in Shell (App.jsx) so the theme toggle in the sidebar is available
 * everywhere and survives route/tab changes.
 */
export function useTheme() {
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore - theme just won't survive a restart
    }
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme((prev) => {
      const idx = THEMES.findIndex((t) => t.id === prev);
      return THEMES[(idx + 1) % THEMES.length].id;
    });
  }, []);

  return { theme, setTheme, cycleTheme };
}
