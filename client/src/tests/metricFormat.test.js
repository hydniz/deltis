import { describe, it, expect } from 'vitest';
import { isHoursUnit, formatNumber, formatHoursMinutes, formatValueUnit } from '../utils/metricFormat';
import { weekKey, weekLabel, markWeekStarts } from '../utils/weekGroups';

describe('metricFormat', () => {
  it('recognises hour units', () => {
    expect(isHoursUnit('h')).toBe(true);
    expect(isHoursUnit('Stunden')).toBe(true);
    expect(isHoursUnit('min')).toBe(false);
    expect(isHoursUnit('')).toBe(false);
  });

  it('formats plain numbers to precision', () => {
    expect(formatNumber(52, 0)).toBe('52');
    expect(formatNumber(16.25, 1)).toBe('16,3');
    expect(formatNumber(null)).toBe('–');
  });

  it('formats hours as h/min', () => {
    expect(formatHoursMinutes(7.5)).toBe('7 h 30 min');
    expect(formatHoursMinutes(8)).toBe('8 h');
    expect(formatHoursMinutes(0.5)).toBe('30 min');
    expect(formatHoursMinutes(0)).toBe('0 min');
    expect(formatHoursMinutes(null)).toBe('–');
  });

  it('routes hour units through the h/min formatter and drops the unit', () => {
    expect(formatValueUnit(7.5, { unit: 'h' })).toEqual({ text: '7 h 30 min', unit: '' });
    expect(formatValueUnit(52, { unit: 'bpm', decimals: 0 })).toEqual({ text: '52', unit: 'bpm' });
  });
});

describe('weekGroups', () => {
  it('keys a date by ISO week-year', () => {
    expect(weekKey('2026-05-04')).toBe(weekKey('2026-05-08')); // same ISO week
    expect(weekKey('2026-05-04')).not.toBe(weekKey('2026-05-11'));
    expect(weekKey('nonsense')).toBe('unknown');
  });

  it('labels the current and previous week specially', () => {
    expect(weekLabel(new Date())).toBe('Diese Woche');
    const lastWeek = new Date(Date.now() - 7 * 86400000);
    expect(weekLabel(lastWeek)).toBe('Letzte Woche');
    expect(weekLabel('2026-05-05')).toMatch(/^Woche vom/);
  });

  it('marks only the first item of each week', () => {
    const items = [
      { d: '2026-05-11' }, // week A
      { d: '2026-05-09' }, // week B
      { d: '2026-05-08' }, // week B
    ];
    const marked = markWeekStarts(items, i => i.d);
    expect(marked.map(m => m.newWeek)).toEqual([true, true, false]);
    expect(marked[2].weekLabel).toBeNull();
  });
});
