import { describe, it, expect } from 'vitest';
import { levelFor, EMPTY_CELL } from '../utils/heatmap';

describe('levelFor', () => {
  it('maps fulfilled targets to the strongest level', () => {
    expect(levelFor(1)).toBe(3);
    expect(levelFor(1.5)).toBe(3);
  });

  it('maps partial progress to intermediate levels', () => {
    expect(levelFor(0.99)).toBe(2);
    expect(levelFor(0.65)).toBe(2);
    expect(levelFor(0.64)).toBe(1);
    expect(levelFor(0.35)).toBe(1);
  });

  it('maps low progress to the dimmest level', () => {
    expect(levelFor(0.34)).toBe(0);
    expect(levelFor(0)).toBe(0);
  });
});

describe('EMPTY_CELL', () => {
  it('is a stable class literal so Tailwind JIT picks it up', () => {
    expect(EMPTY_CELL).toBe('bg-ink-900/[.07]');
  });
});
