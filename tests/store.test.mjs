import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createGoal, emptyState } from '../js/model.js';
import { loadState, readRaw, saveState, STORAGE_KEY, unreadableCopies } from '../js/store.js';

/** localStorage stand-in; `fail` makes one method throw like Safari in some private modes or a full disk. */
function fakeStorage({ fail = '' } = {}) {
  const items = new Map();
  const guard = (method) => {
    if (fail === method) throw new DOMException('refused', 'QuotaExceededError');
  };
  return {
    items,
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => (guard('getItem'), items.has(key) ? items.get(key) : null),
    setItem: (key, value) => (guard('setItem'), items.set(key, String(value))),
    removeItem: (key) => items.delete(key),
  };
}

const NOW = Date.parse('2026-11-05T18:40:00Z');

describe('store', () => {
  it('starts empty when nothing is stored yet', () => {
    assert.deepEqual(loadState(fakeStorage(), NOW), { state: emptyState(), status: 'empty', raw: null });
  });

  it('loads what it saved, and reports the text it stored', () => {
    const storage = fakeStorage();
    let n = 0;
    const { state } = createGoal(emptyState(), { title: 'Goal', steps: [{ title: 'Step' }] }, { today: '2026-11-05', now: NOW, newId: () => `id${(n += 1)}` });
    const saved = saveState(storage, state);
    assert.equal(saved.ok, true);
    assert.equal(saved.text, storage.items.get(STORAGE_KEY));
    assert.deepEqual(loadState(storage, NOW), { state, status: 'ok', raw: saved.text });
    assert.equal(readRaw(storage), saved.text);
  });

  it('puts unreadable data aside instead of overwriting it, and starts empty', () => {
    const storage = fakeStorage();
    storage.setItem(STORAGE_KEY, '{"schema":1,"goals":[{"broken":');
    const { state, status } = loadState(storage, NOW);
    assert.equal(status, 'recovered');
    assert.deepEqual(state, emptyState());
    assert.equal(storage.items.get(`${STORAGE_KEY}/unreadable-${NOW}`), '{"schema":1,"goals":[{"broken":');
    assert.deepEqual(unreadableCopies(storage), [`${STORAGE_KEY}/unreadable-${NOW}`]);
  });

  it('says so when there is no room to put unreadable data aside, and leaves it where it is', () => {
    const storage = fakeStorage({ fail: 'setItem' });
    storage.items.set(STORAGE_KEY, 'not json');
    const loaded = loadState(storage, NOW);
    assert.equal(loaded.status, 'unreadable');
    assert.equal(loaded.raw, 'not json');
    assert.equal(storage.items.get(STORAGE_KEY), 'not json');
    assert.equal(storage.items.size, 1);
  });

  it('reports a phone that refuses storage', () => {
    const { state, status } = loadState(fakeStorage({ fail: 'getItem' }), NOW);
    assert.equal(status, 'unavailable');
    assert.deepEqual(state, emptyState());
    assert.equal(readRaw(fakeStorage({ fail: 'getItem' })), undefined);
  });

  it('reports a save that failed', () => {
    const result = saveState(fakeStorage({ fail: 'setItem' }), emptyState());
    assert.equal(result.ok, false);
    assert.match(result.error, /QuotaExceededError|refused/);
  });
});
