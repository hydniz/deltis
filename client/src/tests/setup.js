import '@testing-library/jest-dom';

// Ensure localStorage is available in the jsdom test environment.
// Node.js 22+ exposes an experimental global `localStorage` that requires a
// CLI flag and is not backed by jsdom — we replace it unconditionally with an
// in-memory implementation so the React app can read/write it during tests.
const localStorageFactory = () => {
  let store = {};
  return {
    getItem: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
};

const storage = localStorageFactory();

try {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    writable: true,
    configurable: true,
  });
} catch {
  // Already defined and non-configurable — overwrite via assignment
  globalThis.localStorage = storage;
}
