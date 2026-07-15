import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

// Icon-only theme toggle for public pages (landing, login) where the user
// menu isn't available. Toggles explicitly between light and dark; the
// three-way control including 'system' lives in Einstellungen and the
// user menu.
export default function ThemeToggle({ className = '' }) {
  const { resolved, setTheme } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Dunkles Design aktivieren' : 'Helles Design aktivieren';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className={`p-2 rounded-full text-ink-400 hover:text-ink-900 hover:bg-ink-900/[.05]
        transition-colors ${className}`}
    >
      {resolved === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
