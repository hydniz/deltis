import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ThemeProvider, useTheme, THEME_STORAGE_KEY, THEMES,
} from '../contexts/ThemeContext';
import ThemeToggle from '../components/ThemeToggle';
import { useChart, CHART_LIGHT, CHART_DARK } from '../components/ui/chartTheme';

// Controllable matchMedia mock — lets tests flip the simulated OS theme.
function installMatchMedia(initialMatches = false) {
  const listeners = new Set();
  const mql = {
    matches: initialMatches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_event, fn) => listeners.add(fn),
    removeEventListener: (_event, fn) => listeners.delete(fn),
  };
  window.matchMedia = vi.fn(() => mql);
  return {
    setMatches(next) {
      mql.matches = next;
      listeners.forEach(fn => fn({ matches: next }));
    },
    listeners,
  };
}

function Probe() {
  const { theme, resolved, setTheme } = useTheme();
  const chart = useChart();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolved}</span>
      <span data-testid="chart-line">{chart.line}</span>
      <button onClick={() => setTheme('light')}>set-light</button>
      <button onClick={() => setTheme('dark')}>set-dark</button>
      <button onClick={() => setTheme('system')}>set-system</button>
      <button onClick={() => setTheme('neon')}>set-invalid</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
}

beforeEach(() => {
  installMatchMedia(false);
  if (!document.querySelector('meta[name="theme-color"]')) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#faf7f2');
    document.head.appendChild(meta);
  }
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete window.matchMedia;
});

describe('ThemeContext – defaults', () => {
  it('exports the three valid themes', () => {
    expect(THEMES).toEqual(['light', 'dark', 'system']);
  });

  it('defaults to system/light when nothing is stored', () => {
    renderWithProvider();
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('falls back to system when the stored value is invalid', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    renderWithProvider();
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
  });

  it('resolves dark when system prefers dark', () => {
    installMatchMedia(true);
    renderWithProvider();
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('works without matchMedia support', () => {
    delete window.matchMedia;
    renderWithProvider();
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });
});

describe('ThemeContext – stored preference', () => {
  it('applies a stored dark preference on mount', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderWithProvider();
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('ThemeContext – setTheme', () => {
  it('persists the choice and toggles the dark class', async () => {
    const user = userEvent.setup();
    renderWithProvider();

    await user.click(screen.getByText('set-dark'));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await user.click(screen.getByText('set-light'));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('updates the theme-color meta tag', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    const meta = document.querySelector('meta[name="theme-color"]');

    await user.click(screen.getByText('set-dark'));
    expect(meta.getAttribute('content')).toBe('#17110d');

    await user.click(screen.getByText('set-light'));
    expect(meta.getAttribute('content')).toBe('#faf7f2');
  });

  it('ignores invalid theme values', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('set-invalid'));
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});

describe('ThemeContext – system mode follows the OS', () => {
  it('reacts to live OS theme changes', () => {
    const media = installMatchMedia(false);
    renderWithProvider();
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');

    act(() => media.setMatches(true));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => media.setMatches(false));
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  it('ignores OS changes while an explicit theme is set', async () => {
    const media = installMatchMedia(false);
    const user = userEvent.setup();
    renderWithProvider();

    await user.click(screen.getByText('set-light'));
    act(() => media.setMatches(true));
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  it('removes the media listener on unmount', () => {
    const media = installMatchMedia(false);
    const { unmount } = renderWithProvider();
    expect(media.listeners.size).toBe(1);
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});

describe('ThemeContext – chart palette', () => {
  it('returns the light chart palette by default', () => {
    renderWithProvider();
    expect(screen.getByTestId('chart-line')).toHaveTextContent(CHART_LIGHT.line);
  });

  it('returns the dark chart palette in dark mode', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('set-dark'));
    expect(screen.getByTestId('chart-line')).toHaveTextContent(CHART_DARK.line);
  });
});

describe('ThemeToggle (public pages)', () => {
  it('switches to dark and back to light', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Dunkles Design aktivieren' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Helles Design aktivieren' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});

describe('useTheme outside a provider', () => {
  it('falls back to safe defaults', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    // setTheme is a no-op without a provider — must not throw.
    await user.click(screen.getByText('set-dark'));
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
  });
});
