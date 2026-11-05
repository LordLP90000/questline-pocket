import { emptyState } from './model.js';
import { sanitizeState } from './validate.js';

/**
 * Keeps the state in this browser's storage on the phone; nothing leaves it. `storage` is `localStorage` in the app
 * and a stand-in in tests. Data that cannot be read is never overwritten: it is put aside under its own key, and when
 * there is no room for that copy, `loadState` says so (status `unreadable`) and the app must not save over it.
 */

export const STORAGE_KEY = 'questline-pocket/state';
const UNREADABLE_PREFIX = `${STORAGE_KEY}/unreadable-`;

/** `{ state, status, raw }`: status is ok, empty, recovered (put aside), unreadable (still in place) or unavailable. */
export function loadState(storage, nowMs) {
  let text;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return { state: emptyState(), status: 'unavailable', raw: null };
  }
  if (text === null) return { state: emptyState(), status: 'empty', raw: null };
  let raw = null;
  try {
    raw = JSON.parse(text);
  } catch {
    // Unreadable JSON: treated like invalid data below.
  }
  const checked = raw === null ? { ok: false } : sanitizeState(raw);
  if (checked.ok) return { state: checked.state, status: 'ok', raw: text };
  try {
    storage.setItem(`${UNREADABLE_PREFIX}${nowMs}`, text);
    return { state: emptyState(), status: 'recovered', raw: text };
  } catch {
    return { state: emptyState(), status: 'unreadable', raw: text };
  }
}

/** What is stored right now, to notice changes from another window; `undefined` when storage can't be read. */
export function readRaw(storage) {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return undefined;
  }
}

/** `{ ok: true, text }` with exactly what was stored, or `{ ok: false, error }`. */
export function saveState(storage, state) {
  const text = JSON.stringify(state);
  try {
    storage.setItem(STORAGE_KEY, text);
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: error && error.name ? `${error.name}: ${error.message}` : String(error) };
  }
}

/** Keys of the unreadable data put aside so far, the latest first. */
export function unreadableCopies(storage) {
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(UNREADABLE_PREFIX)) keys.push(key);
    }
    return keys.sort((a, b) => Number(b.slice(UNREADABLE_PREFIX.length)) - Number(a.slice(UNREADABLE_PREFIX.length)));
  } catch {
    return [];
  }
}
