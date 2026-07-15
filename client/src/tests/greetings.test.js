import { describe, it, expect, beforeEach } from 'vitest';
import {
  getGreetingTemplate, getSessionGreeting, clearSessionGreeting, splitGreeting,
} from '../utils/greetings';

// Fixed reference day (a Wednesday) so weekday extras don't interfere.
const at = (hour, base = new Date(2026, 6, 15)) => {
  const d = new Date(base);
  d.setHours(hour, 30, 0, 0);
  return d;
};

describe('getGreetingTemplate', () => {
  it('returns a template with a {name} placeholder for every hour of the day', () => {
    for (let hour = 0; hour < 24; hour++) {
      const template = getGreetingTemplate(at(hour));
      expect(template).toContain('{name}');
    }
  });

  it('picks different variants for different random values', () => {
    const first = getGreetingTemplate(at(9), () => 0);
    const second = getGreetingTemplate(at(9), () => 0.99);
    expect(first).not.toBe(second);
  });

  it('never overflows the pool even when rand returns 1', () => {
    expect(() => getGreetingTemplate(at(9), () => 1)).not.toThrow();
    expect(getGreetingTemplate(at(9), () => 1)).toContain('{name}');
  });

  it('does not say "Guten Morgen" from 10 o’clock on', () => {
    // The forenoon slot (10–12 h) has its own phrases.
    for (let i = 0; i <= 10; i++) {
      const template = getGreetingTemplate(at(10), () => i / 10);
      expect(template).not.toMatch(/Guten Morgen/);
    }
  });

  it('uses night phrases in the small hours', () => {
    const night = getGreetingTemplate(at(2), () => 0);
    const morning = getGreetingTemplate(at(9), () => 0);
    expect(night).not.toBe(morning);
  });

  it('includes weekday extras in the daytime pool', () => {
    // Monday, rand → last pool entry = a Monday extra.
    const monday = new Date(2026, 6, 13);
    const template = getGreetingTemplate(at(9, monday), () => 0.999);
    expect(template).toMatch(/Montag|Woche/);
  });

  it('does not use weekday extras at night', () => {
    // Monday night: pool has exactly the 5 night variants, no extras.
    const monday = new Date(2026, 6, 13);
    const template = getGreetingTemplate(at(2, monday), () => 0.999);
    expect(template).not.toMatch(/Montag|Woche/);
  });
});

describe('getSessionGreeting', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps the same greeting across repeated calls in one session', () => {
    const first = getSessionGreeting(at(9));
    for (let i = 0; i < 5; i++) {
      expect(getSessionGreeting(at(9))).toBe(first);
    }
  });

  it('returns the stored greeting instead of re-rolling', () => {
    // at(9) is a Wednesday (day 3) in the 8–10 h "morning" slot.
    sessionStorage.setItem(
      'deltis.greeting',
      JSON.stringify({ key: 'morning:3', template: 'Hallo Welt, {name}!' })
    );
    expect(getSessionGreeting(at(9))).toBe('Hallo Welt, {name}!');
  });

  it('re-picks when the time moves into another slot', () => {
    const morning = getSessionGreeting(at(9), () => 0);
    const evening = getSessionGreeting(at(19), () => 0);
    expect(evening).not.toBe(morning);
    // The evening pick is now the stored one.
    expect(getSessionGreeting(at(19))).toBe(evening);
  });

  it('survives corrupt storage content', () => {
    sessionStorage.setItem('deltis.greeting', 'not-json{');
    expect(getSessionGreeting(at(9))).toContain('{name}');
  });

  it('clearSessionGreeting removes the stored greeting', () => {
    getSessionGreeting(at(9));
    clearSessionGreeting();
    expect(sessionStorage.getItem('deltis.greeting')).toBeNull();
  });
});

describe('splitGreeting', () => {
  it('splits a template into before and after the name', () => {
    expect(splitGreeting('Guten Morgen, {name}.')).toEqual({
      before: 'Guten Morgen, ',
      after: '.',
    });
  });

  it('supports templates ending in a question mark', () => {
    expect(splitGreeting('Noch wach, {name}?')).toEqual({
      before: 'Noch wach, ',
      after: '?',
    });
  });
});
