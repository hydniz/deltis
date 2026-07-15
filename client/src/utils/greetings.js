// Time-aware greeting templates for the dashboard header.
// Every template contains a {name} placeholder so phrases can vary their
// structure (question, exclamation, mid-sentence name, …).
// A phrase is picked at random on every dashboard visit (stable per mount —
// the caller memoises it) so the greeting feels alive.

const SLOTS = [
  {
    key: 'night', from: 0, to: 5,
    variants: [
      'Nachteule, {name}?',
      'Mitten in der Nacht, {name} …',
      'Schlaf ist auch eine Gewohnheit, {name}.',
      'Die Sterne sind noch wach – du auch, {name}.',
      'Psst, {name} – morgen ist auch noch ein Tag.',
    ],
  },
  {
    key: 'earlyMorning', from: 5, to: 8,
    variants: [
      'Früher Vogel, {name}!',
      'Der Tag gehört dir, {name}.',
      'Frisch ans Werk, {name}.',
      'Guten Morgen, {name} – vor allen anderen.',
      'Erst der Kaffee, dann die Ziele, {name}.',
    ],
  },
  {
    key: 'morning', from: 8, to: 10,
    variants: [
      'Guten Morgen, {name}.',
      'Schönen guten Morgen, {name}.',
      'Auf geht’s, {name}!',
      'Bereit für heute, {name}?',
      'Ein neuer Tag, ein neues Häkchen, {name}.',
    ],
  },
  {
    key: 'forenoon', from: 10, to: 12,
    variants: [
      'Schönen Vormittag, {name}.',
      'Der Vormittag läuft, {name}.',
      'Schon im Flow, {name}?',
      'Beste Zeit, etwas abzuhaken, {name}.',
      'Der Tag nimmt Fahrt auf, {name}.',
    ],
  },
  {
    key: 'noon', from: 12, to: 14,
    variants: [
      'Mahlzeit, {name}!',
      'Guten Tag, {name}.',
      'Halbzeit, {name} – gut unterwegs?',
      'Schönen Mittag, {name}.',
      'Kleine Pause verdient, {name}.',
    ],
  },
  {
    key: 'afternoon', from: 14, to: 17,
    variants: [
      'Guten Nachmittag, {name}.',
      'Schön, dich zu sehen, {name}.',
      'Weiter geht’s, {name}!',
      'Bleib dran, {name} – der Tag läuft noch.',
      'Noch Luft nach oben, {name}?',
    ],
  },
  {
    key: 'evening', from: 17, to: 21,
    variants: [
      'Guten Abend, {name}.',
      'Schönen Feierabend, {name}.',
      'Zeit für dich, {name}.',
      'Lass den Tag ausklingen, {name}.',
      'Gut gemacht heute, {name}.',
    ],
  },
  {
    key: 'late', from: 21, to: 24,
    variants: [
      'Späte Stunde, {name}.',
      'Noch wach, {name}?',
      'Der Tag ist fast geschafft, {name}.',
      'Zeit, runterzufahren, {name}.',
      'Ein letzter Blick auf heute, {name}?',
    ],
  },
];

// Weekday flavour joins the regular pool during daytime slots (5–21 h).
const WEEKDAY_EXTRAS = {
  1: ['Neue Woche, frische Ziele, {name}.', 'Montag – dein Zug, {name}.'],
  5: ['Endspurt, {name} – das Wochenende wartet.'],
  6: ['Schönes Wochenende, {name}.', 'Samstag gehört dir, {name}.'],
  0: ['Entspannten Sonntag, {name}.', 'Sonntag – Zeit zum Durchatmen, {name}.'],
};

function findSlot(hour) {
  return SLOTS.find(s => hour >= s.from && hour < s.to) ?? SLOTS[0];
}

// `rand` is injectable for tests; defaults to Math.random.
export function getGreetingTemplate(date = new Date(), rand = Math.random) {
  const hour = date.getHours();
  const slot = findSlot(hour);

  const pool = [...slot.variants];
  const isDaytime = hour >= 5 && hour < 21;
  if (isDaytime) {
    pool.push(...(WEEKDAY_EXTRAS[date.getDay()] ?? []));
  }

  const index = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
  return pool[index];
}

// Session-stable greeting: picked once per browser tab and kept for the
// whole visit (sessionStorage survives in-app navigation and tab switches,
// but not closing the tab or opening a new one). Re-picks only when the
// time slot or weekday changes so a long-lived tab still matches the clock.
const STORAGE_KEY = 'deltis.greeting';

export function getSessionGreeting(date = new Date(), rand = Math.random) {
  const slotKey = `${findSlot(date.getHours()).key}:${date.getDay()}`;

  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (stored?.key === slotKey && typeof stored.template === 'string' && stored.template.includes('{name}')) {
      return stored.template;
    }
  } catch { /* corrupt or unavailable storage — fall through to a fresh pick */ }

  const template = getGreetingTemplate(date, rand);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ key: slotKey, template }));
  } catch { /* storage unavailable (e.g. privacy mode) — greeting just rotates */ }
  return template;
}

// Called on logout so the next login starts with a fresh phrase.
export function clearSessionGreeting() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

// Splits a template into the parts before and after the styled name.
export function splitGreeting(template) {
  const [before, after = ''] = template.split('{name}');
  return { before, after };
}
