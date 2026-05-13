/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Terrakotta-Erdpalette – kein Blau/Violett
        brand: {
          50:  '#fdf4ef',
          100: '#fae4d5',
          200: '#f4c5a0',
          300: '#e89e70',   // helles Terrakotta
          400: '#d87c4e',   // mittelhelles Terrakotta
          500: '#c4623a',   // Hauptfarbe – warmes Ton
          600: '#a84e2a',   // Primär-Button
          700: '#8a3c1e',   // dunkel
          800: '#6e2e14',
          900: '#3c160a',
          950: '#1e0b05',
        },
        // Salbei-Grün als zweite Akzentfarbe
        sage: {
          300: '#9db894',
          400: '#7d9f74',
          500: '#5f8556',
          600: '#4a6b42',
        },
        // Warmes Amber/Ocker
        ocher: {
          300: '#e6c07a',
          400: '#d4a44e',
          500: '#b8892a',
          600: '#9a7020',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    }
  },
  plugins: []
};
