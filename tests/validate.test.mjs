import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createGoal, emptyState, findGoal, setStepDone } from '../js/model.js';
import { MAX_BACKUP_CHARS, parseBackup, sanitizeState, serializeBackup } from '../js/validate.js';

function context(today = '2026-11-05') {
  let n = 0;
  return { today, now: Date.parse(`${today}T12:00:00Z`), newId: () => `id${(n += 1)}` };
}

function sampleState() {
  const ctx = context();
  const { state, id } = createGoal(
    emptyState(),
    { title: 'Run a race', why: 'Because', category: 'health', targetDate: '2026-12-31', steps: [{ title: 'Shoes', note: 'Size 42' }, { title: 'Train', dueDate: '2026-11-20' }] },
    ctx,
  );
  return setStepDone(state, id, findGoal(state, id).steps[0].id, true, ctx);
}

/** A stored goal as the app writes it, for tests that break one field at a time. */
function rawGoal(overrides = {}) {
  return {
    id: 'g1',
    title: 'Goal',
    why: '',
    category: 'custom',
    targetDate: null,
    createdOn: '2026-11-01',
    createdAt: 1_793_000_000_000,
    completedOn: null,
    steps: [{ id: 's1', title: 'Step', dueDate: null, note: '', doneOn: null, doneAt: null }],
    ...overrides,
  };
}

describe('backups', () => {
  it('round-trips an exported backup', () => {
    const state = sampleState();
    const parsed = parseBackup(serializeBackup(state, '2026-11-05T18:40:00.000Z'));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.state, state);
  });

  it('marks the file as a Questline Pocket backup', () => {
    const backup = JSON.parse(serializeBackup(sampleState(), '2026-11-05T18:40:00.000Z'));
    assert.equal(backup.app, 'questline-pocket');
    assert.equal(backup.schema, 1);
    assert.equal(backup.exportedAt, '2026-11-05T18:40:00.000Z');
  });

  it('refuses text that is not a backup', () => {
    for (const text of ['', 'hello', '[]', 'null', '{"goals": 3}', JSON.stringify({ app: 'other', schema: 1, goals: [] })]) {
      const parsed = parseBackup(text);
      assert.equal(parsed.ok, false, text);
      assert.match(parsed.error, /backup/i);
    }
  });

  it('refuses a backup from a newer version of the app', () => {
    const parsed = parseBackup(JSON.stringify({ app: 'questline-pocket', schema: 2, goals: [] }));
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /newer/i);
  });

  it('refuses a file that is too large', () => {
    const parsed = parseBackup(' '.repeat(MAX_BACKUP_CHARS + 1));
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /large/i);
  });
});

describe('sanitizeState', () => {
  it('accepts what the app stores', () => {
    const state = sampleState();
    assert.deepEqual(sanitizeState(state), { ok: true, state });
  });

  it('names the goal and field of a broken entry', () => {
    const broken = [
      rawGoal({ title: '' }),
      rawGoal({ title: 42 }),
      rawGoal({ targetDate: '2026-02-30' }),
      rawGoal({ createdOn: 'yesterday' }),
      rawGoal({ category: 'sports' }),
      rawGoal({ steps: 'none' }),
      rawGoal({ steps: [{ id: 's1', title: '', dueDate: null, note: '', doneOn: null, doneAt: null }] }),
      rawGoal({ steps: [{ id: 's1', title: 'x', dueDate: null, note: '', doneOn: '2026-11-31', doneAt: null }] }),
      rawGoal({ id: '<img src=x onerror=alert(1)>' }),
      rawGoal({ createdAt: -5 }),
      rawGoal({ createdAt: 8_640_000_000_000_001 }),
      rawGoal({ steps: [{ id: 's1', title: 'x', dueDate: null, note: '', doneOn: '2026-11-05', doneAt: Number.MAX_SAFE_INTEGER }] }),
    ];
    for (const goal of broken) {
      const result = sanitizeState({ schema: 1, goals: [goal] });
      assert.equal(result.ok, false, JSON.stringify(goal));
      assert.match(result.error, /^Goal 1/);
    }
  });

  it('refuses duplicate IDs', () => {
    const twice = sanitizeState({ schema: 1, goals: [rawGoal(), rawGoal({ steps: [] })] });
    assert.equal(twice.ok, false);
    const stepTwice = sanitizeState({
      schema: 1,
      goals: [rawGoal({ steps: [rawGoal().steps[0], rawGoal().steps[0]] })],
    });
    assert.equal(stepTwice.ok, false);
  });

  it('keeps only the fields it knows', () => {
    const goal = JSON.parse(
      JSON.stringify({ ...rawGoal(), extra: 1, steps: [{ ...rawGoal().steps[0], color: 'red' }] }).replace('"extra":1', '"extra":1,"__proto__":{"polluted":true}'),
    );
    const result = sanitizeState({ schema: 1, goals: [goal] });
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.state.goals[0]).sort(), Object.keys(rawGoal()).sort());
    assert.deepEqual(Object.keys(result.state.goals[0].steps[0]).sort(), Object.keys(rawGoal().steps[0]).sort());
    assert.equal({}.polluted, undefined);
  });

  it('repairs the reached date from the steps', () => {
    const done = { id: 's1', title: 'x', dueDate: null, note: '', doneOn: '2026-11-03', doneAt: 1 };
    const later = { ...done, id: 's2', doneOn: '2026-11-04' };
    const reachedWithoutDate = sanitizeState({ schema: 1, goals: [rawGoal({ steps: [done, later] })] });
    assert.equal(reachedWithoutDate.state.goals[0].completedOn, '2026-11-04');
    const openWithDate = sanitizeState({ schema: 1, goals: [rawGoal({ completedOn: '2026-11-04' })] });
    assert.equal(openWithDate.state.goals[0].completedOn, null);
  });
});
