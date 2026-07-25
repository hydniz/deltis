// User-configurable navigation order. The canonical item lists live in the
// Sidebar / Layout; here we only persist and apply a preferred ORDER (an array
// of route paths). It is a device-local preference (localStorage) so it needs
// no backend round-trip. Home is always pinned to the first position.
import { useState, useEffect } from 'react';

const KEY = 'deltis.navOrder';
const EVENT = 'deltis-nav-order';
export const HOME_PATH = '/dashboard';

export function loadOrder() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveOrder(paths) {
  localStorage.setItem(KEY, JSON.stringify(paths));
  // Notify the sidebar/tab bar in this tab (storage event only fires in others).
  window.dispatchEvent(new Event(EVENT));
}

// Sorts `items` (each with a `.to` path) by the saved order: Home first, then
// the saved order, then any items missing from the saved list (e.g. a newly
// added page) appended in their original order.
export function applyOrder(items) {
  const home = items.find(i => i.to === HOME_PATH);
  const rest = items.filter(i => i.to !== HOME_PATH);
  const order = loadOrder();
  let sortedRest = rest;
  if (order) {
    const byPath = new Map(rest.map(i => [i.to, i]));
    const out = [];
    for (const p of order) {
      const it = p !== HOME_PATH ? byPath.get(p) : undefined;
      if (it) { out.push(it); byPath.delete(p); }
    }
    for (const i of rest) if (byPath.has(i.to)) out.push(i);
    sortedRest = out;
  }
  return home ? [home, ...sortedRest] : sortedRest;
}

// Reactive ordered list that updates when the order changes (this tab or another).
export function useOrderedNav(items) {
  const [ordered, setOrdered] = useState(() => applyOrder(items));
  useEffect(() => {
    const refresh = () => setOrdered(applyOrder(items));
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [items]);
  return ordered;
}
