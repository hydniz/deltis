import { useTheme } from '../../contexts/ThemeContext';

// Shared recharts styling. Recharts needs concrete colour values (SVG
// attributes can't resolve CSS variables), so both themes are defined here
// and useChart() picks the palette matching the resolved theme.

export const CHART_LIGHT = {
  grid: '#ece4d6',
  tick: { fill: '#a3988a', fontSize: 10 },
  tickLg: { fill: '#a3988a', fontSize: 11 },
  tooltip: {
    background: '#ffffff',
    border: '1px solid #ece4d6',
    borderRadius: 12,
    color: '#211b14',
    fontSize: 12,
    boxShadow: '0 8px 24px rgba(60, 42, 24, 0.12)',
  },
  line: '#c4623a',        // brand terracotta
  lineMuted: '#dbd2c4',   // reference / target lines
  dotMuted: '#bfb4a3',    // default-value dots
};

export const CHART_DARK = {
  grid: '#382c21',
  tick: { fill: '#8a7d6b', fontSize: 10 },
  tickLg: { fill: '#8a7d6b', fontSize: 11 },
  tooltip: {
    background: '#2a2119',
    border: '1px solid #443628',
    borderRadius: 12,
    color: '#f2ece3',
    fontSize: 12,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
  },
  line: '#e0895a',        // glowing ember terracotta
  lineMuted: '#5d5548',   // reference / target lines
  dotMuted: '#8a7d6b',    // default-value dots
};

export function useChart() {
  const { resolved } = useTheme();
  return resolved === 'dark' ? CHART_DARK : CHART_LIGHT;
}
