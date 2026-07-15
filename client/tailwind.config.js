/** @type {import('tailwindcss').Config} */

// Every palette value lives in src/index.css as a `--c-*` RGB triplet with a
// light set on :root and a dark set on :root.dark. Routing the colours
// through variables lets the exact same utility class (e.g. `bg-brand-50`)
// render correctly in both themes — no `dark:` variant needed at call sites.
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const scale = (name, shades) =>
  Object.fromEntries(shades.map((s) => [s, v(`${name}-${s}`)]));

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Terracotta brand palette – warm earth tones, no blue/violet
        brand: scale('brand', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        // Warm near-black ink for text — inverts to warm cream in dark mode
        ink: scale('ink', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        // Warm paper background tones
        paper: { DEFAULT: v('paper'), ...scale('paper', [50, 100, 200]) },
        // Sage green – secondary accent
        sage: scale('sage', [100, 200, 300, 400, 500, 600, 700]),
        // Warm ocher/amber accent
        ocher: scale('ocher', [100, 200, 300, 400, 500, 600, 700]),

        // Semantic surfaces
        surface: v('surface'),   // card/sheet background: white ↔ warm charcoal
        charcoal: v('charcoal'), // always-dark surfaces (admin bar, terminal)
        cream: v('cream'),       // always-light text on charcoal surfaces
        scrim: v('scrim'),       // modal overlay tint

        // Status palettes — theme-aware overrides of the Tailwind defaults
        // (light values match Tailwind, dark values are hand-tuned).
        red: scale('red', [50, 100, 200, 300, 400, 500, 600, 700, 800]),
        rose: scale('rose', [50, 100, 200, 300, 400, 500, 600]),
        emerald: scale('emerald', [50, 200, 400, 500, 600, 700, 800]),
        lime: scale('lime', [50, 100, 200, 500, 600, 700, 800]),
        amber: scale('amber', [50, 200, 400, 500, 700, 900]),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        pop: 'var(--shadow-pop)',
      },
    }
  },
  plugins: []
};
