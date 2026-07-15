/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Terracotta brand palette – warm earth tones, no blue/violet
        brand: {
          50:  '#fdf4ef',
          100: '#fae4d5',
          200: '#f4c5a0',
          300: '#e89e70',
          400: '#d87c4e',
          500: '#c4623a',   // main brand tone
          600: '#a84e2a',
          700: '#8a3c1e',
          800: '#6e2e14',
          900: '#3c160a',
          950: '#1e0b05',
        },
        // Warm near-black ink for text on light surfaces
        ink: {
          50:  '#f7f4ef',
          100: '#ece6dc',
          200: '#dbd2c4',
          300: '#bfb4a3',
          400: '#a3988a',
          500: '#84796b',
          600: '#665c50',
          700: '#4a4238',
          800: '#332c24',
          900: '#211b14',
        },
        // Warm paper background tones
        paper: {
          DEFAULT: '#faf7f2',
          50:  '#fdfbf7',
          100: '#f5f0e7',
          200: '#ede5d8',
        },
        // Sage green – secondary accent
        sage: {
          100: '#e6ede2',
          200: '#cddcc5',
          300: '#9db894',
          400: '#7d9f74',
          500: '#5f8556',
          600: '#4a6b42',
          700: '#39522f',
        },
        // Warm ocher/amber accent
        ocher: {
          100: '#f7ecd4',
          200: '#eeda9f',
          300: '#e6c07a',
          400: '#d4a44e',
          500: '#b8892a',
          600: '#9a7020',
          700: '#7a581a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(60, 42, 24, 0.05), 0 8px 24px -8px rgba(60, 42, 24, 0.08)',
        'card-hover': '0 2px 4px rgba(60, 42, 24, 0.06), 0 16px 32px -8px rgba(60, 42, 24, 0.12)',
        pop: '0 4px 12px rgba(60, 42, 24, 0.08), 0 24px 48px -12px rgba(60, 42, 24, 0.18)',
      },
    }
  },
  plugins: []
};
