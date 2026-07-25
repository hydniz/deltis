import { describe, it, expect } from 'vitest';
import { isHoursUnit, formatNumber, formatHoursMinutes, formatValueUnit, isHmUnit, formatHM, parseHM, hoursToTimeInput } from '../utils/metricFormat';
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

  it('treats HH:MM as a duration in hours, shown as elapsed h:mm', () => {
    expect(isHmUnit('HH:MM')).toBe(true);
    expect(isHmUnit('h')).toBe(false);
    // 8.2667 h = 8:16 (the sleep case that used to render as a raw decimal)
    expect(formatHM(8.266666666666667)).toBe('8:16');
    expect(formatHM(8)).toBe('8:00');
    expect(formatHM(0.0833333)).toBe('0:05');
    expect(formatHM(null)).toBe('–');
  });

  it('round-trips HH:MM input through hours', () => {
    expect(parseHM('08:16')).toBeCloseTo(8.2667, 3);
    expect(parseHM('08:00')).toBe(8);
    expect(parseHM('nonsense')).toBeNull();
    expect(hoursToTimeInput(8.266666666666667)).toBe('08:16');
    expect(hoursToTimeInput(8)).toBe('08:00');
    expect(formatHM(parseHM('07:30'))).toBe('7:30');
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
