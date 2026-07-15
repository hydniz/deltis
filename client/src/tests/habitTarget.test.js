import { describe, it, expect } from 'vitest';
import { meetsTarget, progressRatio, formatTarget } from '../utils/habitTarget';

const amount = (targetCondition, targetValue) => ({
  type: 'amount', unitSymbol: 'ml', targetCondition, targetValue,
});

describe('meetsTarget', () => {
  it('treats any log as fulfilled without a target', () => {
    expect(meetsTarget(amount('none', 0), 3)).toBe(true);
    expect(meetsTarget(amount(undefined, undefined), 0)).toBe(true);
  });

  it('returns false when nothing is logged', () => {
    expect(meetsTarget(amount('none', 0), null)).toBe(false);
    expect(meetsTarget(amount('min', 5), undefined)).toBe(false);
  });

  it('handles min targets', () => {
    expect(meetsTarget(amount('min', 8), 8)).toBe(true);
    expect(meetsTarget(amount('min', 8), 12)).toBe(true);
    expect(meetsTarget(amount('min', 8), 7.5)).toBe(false);
  });

  it('handles max targets (0 allowed, e.g. no cigarettes)', () => {
    expect(meetsTarget(amount('max', 3), 3)).toBe(true);
    expect(meetsTarget(amount('max', 3), 4)).toBe(false);
    expect(meetsTarget(amount('max', 0), 0)).toBe(true);
  });

  it('handles exact targets', () => {
    expect(meetsTarget(amount('exact', 2), 2)).toBe(true);
    expect(meetsTarget(amount('exact', 2), 3)).toBe(false);
  });

  it('boolean habits are fulfilled by any value >= 1', () => {
    const bool = { type: 'boolean', unitSymbol: '✓' };
    expect(meetsTarget(bool, 1)).toBe(true);
    expect(meetsTarget(bool, 0)).toBe(false);
    expect(meetsTarget(bool, null)).toBe(false);
  });
});

describe('progressRatio', () => {
  it('is null without a log and 1 when fulfilled', () => {
    expect(progressRatio(amount('min', 8), null)).toBeNull();
    expect(progressRatio(amount('min', 8), 8)).toBe(1);
    expect(progressRatio(amount('none', 0), 1)).toBe(1);
  });

  it('scales partial progress towards min targets', () => {
    const ratio = progressRatio(amount('min', 8), 4);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it('clamps tiny progress to a visible minimum', () => {
    expect(progressRatio(amount('min', 100), 1)).toBeGreaterThanOrEqual(0.15);
  });

  it('dims an exceeded max target', () => {
    expect(progressRatio(amount('max', 3), 10)).toBe(0.25);
  });
});

describe('formatTarget', () => {
  it('renders a compact label', () => {
    expect(formatTarget(amount('min', 8))).toBe('mind. 8 ml');
    expect(formatTarget(amount('max', 3))).toBe('max. 3 ml');
    expect(formatTarget(amount('exact', 2))).toBe('genau 2 ml');
    expect(formatTarget(amount('none', 0))).toBe('');
  });
});
