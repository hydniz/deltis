import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Theme handling: 'light' | 'dark' | 'system'.
// The resolved theme toggles the `dark` class on <html>, which flips every
// CSS design token (see index.css). An inline script in index.html applies
// the stored preference before first paint so the app never flashes.

export const THEME_STORAGE_KEY = 'deltis-theme';
export const THEMES = ['light', 'dark', 'system'];

// Keeps the PWA status bar in sync with the app background.
const META_THEME_COLORS = { light: '#faf7f2', dark: '#17110d' };

const ThemeContext = createContext({
  theme: 'system',
  resolved: 'light',
  setTheme: () => {},
});

function getStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return THEMES.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyResolvedTheme(resolved) {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_THEME_COLORS[resolved]);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getStoredTheme);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    applyResolvedTheme(resolved);
  }, [resolved]);

  // Follow live OS theme changes while in 'system' mode.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode) — theme still applies for the session.
    }
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
