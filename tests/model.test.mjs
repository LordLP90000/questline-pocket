import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  addExampleGoal,
  addStep,
  createGoal,
  deleteGoal,
  deleteStep,
  emptyState,
  findGoal,
  goalLists,
  goalProgress,
  LIMITS,
  moveStep,
  setStepDone,
  sortStepsByDueDate,
  timeline,
  todaySections,
  updateGoal,
  updateStep,
  validateGoalInput,
  validateStepInput,
} from '../js/model.js';

const TODAY = '2026-11-05';

/** A context like the app's: today's date, the current instant and an ID source that never repeats. */
function context(today = TODAY, hour = 12) {
  let n = 0;
  return { today, now: Date.parse(`${today}T${String(hour).padStart(2, '0')}:00:00Z`), newId: () => `id${(n += 1)}` };
}

function at(ctx, today, hour = 12) {
  return { ...ctx, today, now: Date.parse(`${today}T${String(hour).padStart(2, '0')}:00:00Z`) };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** A goal "Run a race" with three steps A, B, C. */
function raceGoal(ctx = context(), steps = ['A', 'B', 'C']) {
  const { state, id } = createGoal(
    emptyState(),
    { title: 'Run a race', why: '', category: 'health', targetDate: '2026-12-31', steps: steps.map((title) => ({ title })) },
    ctx,
  );
  return { state: deepFreeze(state), id, ctx };
}

const stepIds = (state, goalId) => findGoal(state, goalId).steps.map((step) => step.id);

describe('validateGoalInput', () => {
  it('trims the title and collapses its inner whitespace', () => {
    const { ok, value } = validateGoalInput({ title: '  Run   my  race ', category: 'health' });
    assert.equal(ok, true);
    assert.equal(value.title, 'Run my race');
  });

  it('requires a title', () => {
    const { ok, errors } = validateGoalInput({ title: '   ' });
    assert.equal(ok, false);
    assert.match(errors.title, /title/i);
  });

  it('refuses a title that is too long', () => {
    const { errors } = validateGoalInput({ title: 'x'.repeat(LIMITS.goalTitle + 1) });
    assert.match(errors.title, new RegExp(String(LIMITS.goalTitle)));
  });

  it('takes an empty target date as none and refuses one that does not exist', () => {
    assert.equal(validateGoalInput({ title: 'Goal', targetDate: '' }).value.targetDate, null);
    assert.match(validateGoalInput({ title: 'Goal', targetDate: '2026-02-30' }).errors.targetDate, /date/i);
  });

  it('falls back to the custom category for an unknown one', () => {
    assert.equal(validateGoalInput({ title: 'Goal', category: 'nope' }).value.category, 'custom');
  });

  it('limits why it matters', () => {
    assert.equal(validateGoalInput({ title: 'Goal', why: 'x'.repeat(LIMITS.why) }).ok, true);
    assert.equal(validateGoalInput({ title: 'Goal', why: 'x'.repeat(LIMITS.why + 1) }).ok, false);
  });
});

describe('validateStepInput', () => {
  it('requires a title and keeps the line breaks of the note', () => {
    assert.equal(validateStepInput({ title: '' }).ok, false);
    const { value } = validateStepInput({ title: ' Buy shoes ', dueDate: '2026-11-10', note: ' Size 42\nBlue ' });
    assert.deepEqual(value, { title: 'Buy shoes', dueDate: '2026-11-10', note: 'Size 42\nBlue' });
  });

  it('refuses a due date that does not exist and a note that is too long', () => {
    const { errors } = validateStepInput({ title: 'Step', dueDate: '2026-13-01', note: 'x'.repeat(LIMITS.note + 1) });
    assert.ok(errors.dueDate);
    assert.ok(errors.note);
  });
});

describe('createGoal', () => {
  it('adds an active goal with its first steps in order', () => {
    const { state, id } = raceGoal();
    const goal = findGoal(state, id);
    assert.equal(goal.title, 'Run a race');
    assert.equal(goal.createdOn, TODAY);
    assert.equal(goal.completedOn, null);
    assert.deepEqual(
      goal.steps.map((step) => [step.title, step.doneOn]),
      [['A', null], ['B', null], ['C', null]],
    );
    assert.equal(new Set([id, ...stepIds(state, id)]).size, 4);
  });

  it('skips blank step rows of the form', () => {
    const { state, id } = raceGoal(context(), ['A', '  ', 'B']);
    assert.deepEqual(
      findGoal(state, id).steps.map((step) => step.title),
      ['A', 'B'],
    );
  });

  it('leaves the state it was given untouched', () => {
    const before = deepFreeze(emptyState());
    const { state } = createGoal(before, { title: 'Goal' }, context());
    assert.equal(before.goals.length, 0);
    assert.equal(state.goals.length, 1);
  });

  it('refuses invalid input', () => {
    assert.throws(() => createGoal(emptyState(), { title: '' }, context()), RangeError);
  });
});

describe('setStepDone', () => {
  it('marks a step done today and keeps the goal open while steps remain', () => {
    const { state, id, ctx } = raceGoal();
    const [a] = stepIds(state, id);
    const next = setStepDone(state, id, a, true, ctx);
    const goal = findGoal(next, id);
    assert.equal(goal.steps[0].doneOn, TODAY);
    assert.equal(goal.steps[0].doneAt, ctx.now);
    assert.equal(goal.completedOn, null);
  });

  it('reaches the goal when its last open step is done', () => {
    const { state, id, ctx } = raceGoal();
    const [a, b, c] = stepIds(state, id);
    let next = setStepDone(state, id, c, true, ctx);
    next = setStepDone(next, id, a, true, ctx);
    next = setStepDone(next, id, b, true, at(ctx, '2026-11-20'));
    assert.equal(findGoal(next, id).completedOn, '2026-11-20');
  });

  it('reopens a reached goal when a step is marked not done', () => {
    const { state, id, ctx } = raceGoal(context(), ['A']);
    const [a] = stepIds(state, id);
    const reached = setStepDone(state, id, a, true, ctx);
    const reopened = setStepDone(reached, id, a, false, ctx);
    assert.equal(findGoal(reopened, id).completedOn, null);
    assert.equal(findGoal(reopened, id).steps[0].doneOn, null);
    assert.equal(findGoal(reopened, id).steps[0].doneAt, null);
  });

  it('keeps the first done date when a done step is marked done again', () => {
    const { state, id, ctx } = raceGoal();
    const [a] = stepIds(state, id);
    const once = setStepDone(state, id, a, true, ctx);
    const twice = setStepDone(once, id, a, true, at(ctx, '2026-11-09'));
    assert.equal(findGoal(twice, id).steps[0].doneOn, TODAY);
  });

  it('refuses an unknown step', () => {
    const { state, id, ctx } = raceGoal();
    assert.throws(() => setStepDone(state, id, 'nope', true, ctx), RangeError);
    assert.throws(() => setStepDone(state, 'nope', 'nope', true, ctx), RangeError);
  });
});

describe('editing goals and steps', () => {
  it('updates the details of a goal and keeps its steps', () => {
    const { state, id } = raceGoal();
    const next = updateGoal(state, id, { title: 'Run a marathon', why: 'For me', category: 'custom', targetDate: '' });
    const goal = findGoal(next, id);
    assert.deepEqual([goal.title, goal.why, goal.category, goal.targetDate], ['Run a marathon', 'For me', 'custom', null]);
    assert.equal(goal.steps.length, 3);
  });

  it('deletes a goal', () => {
    const { state, id } = raceGoal();
    assert.equal(findGoal(deleteGoal(state, id), id), undefined);
  });

  it('adds a step at the end and reopens a reached goal', () => {
    const { state, id, ctx } = raceGoal(context(), ['A']);
    const reached = setStepDone(state, id, stepIds(state, id)[0], true, ctx);
    const { state: next, id: stepId } = addStep(reached, id, { title: 'Celebrate', dueDate: '2027-01-02' }, ctx);
    const goal = findGoal(next, id);
    assert.equal(goal.completedOn, null);
    assert.deepEqual(goal.steps.at(-1), { id: stepId, title: 'Celebrate', dueDate: '2027-01-02', note: '', doneOn: null, doneAt: null });
  });

  it('updates the title, due date and note of a step but not whether it is done', () => {
    const { state, id, ctx } = raceGoal();
    const [a] = stepIds(state, id);
    const done = setStepDone(state, id, a, true, ctx);
    const next = updateStep(done, id, a, { title: 'A2', dueDate: '2026-11-07', note: 'Hi' });
    assert.deepEqual(
      (({ title, dueDate, note, doneOn }) => ({ title, dueDate, note, doneOn }))(findGoal(next, id).steps[0]),
      { title: 'A2', dueDate: '2026-11-07', note: 'Hi', doneOn: TODAY },
    );
  });

  it('reaches the goal when the only open step is deleted', () => {
    const { state, id, ctx } = raceGoal(context(), ['A', 'B']);
    const [a, b] = stepIds(state, id);
    const next = deleteStep(setStepDone(state, id, a, true, ctx), id, b, ctx);
    assert.equal(findGoal(next, id).completedOn, TODAY);
  });

  it('leaves a goal without steps open', () => {
    const { state, id, ctx } = raceGoal(context(), ['A']);
    const [a] = stepIds(state, id);
    const next = deleteStep(setStepDone(state, id, a, true, ctx), id, a, ctx);
    assert.equal(findGoal(next, id).completedOn, null);
    assert.equal(goalProgress(findGoal(next, id)).complete, false);
  });

  it('moves a step one place and stops at either end', () => {
    const { state, id } = raceGoal();
    const [a, b, c] = stepIds(state, id);
    assert.deepEqual(stepIds(moveStep(state, id, c, -1), id), [a, c, b]);
    assert.deepEqual(stepIds(moveStep(state, id, a, 1), id), [b, a, c]);
    assert.deepEqual(stepIds(moveStep(state, id, a, -1), id), [a, b, c]);
    assert.deepEqual(stepIds(moveStep(state, id, c, 1), id), [a, b, c]);
  });

  it('sorts steps by due date, dated ones first, keeping the order of ties', () => {
    const { state, id } = raceGoal(context(), ['A', 'B', 'C', 'D']);
    const [a, b, c, d] = stepIds(state, id);
    let next = updateStep(state, id, b, { title: 'B', dueDate: '2026-12-01' });
    next = updateStep(next, id, c, { title: 'C', dueDate: '2026-11-10' });
    next = updateStep(next, id, d, { title: 'D', dueDate: '2026-12-01' });
    assert.deepEqual(stepIds(sortStepsByDueDate(next, id), id), [c, b, d, a]);
  });
});

describe('goalProgress', () => {
  it('counts done steps and names the current and the next due step', () => {
    const { state, id, ctx } = raceGoal(context(), ['A', 'B', 'C', 'D']);
    const [a, b, c, d] = stepIds(state, id);
    let next = setStepDone(state, id, a, true, ctx);
    next = updateStep(next, id, c, { title: 'C', dueDate: '2026-11-20' });
    next = updateStep(next, id, d, { title: 'D', dueDate: '2026-11-08' });
    const progress = goalProgress(findGoal(next, id));
    assert.equal(progress.total, 4);
    assert.equal(progress.done, 1);
    assert.equal(progress.progress, 0.25);
    assert.equal(progress.complete, false);
    assert.equal(progress.current.id, b);
    assert.equal(progress.nextDue.id, d);
  });

  it('keeps a goal without steps at 0 and open', () => {
    const { state, id } = raceGoal(context(), []);
    assert.deepEqual(goalProgress(findGoal(state, id)), { total: 0, done: 0, progress: 0, complete: false, current: null, nextDue: null });
  });
});

describe('timeline', () => {
  it('runs from the start through the steps to the goal', () => {
    const { state, id } = raceGoal();
    const items = timeline(findGoal(state, id));
    assert.deepEqual(
      items.map((item) => item.kind),
      ['start', 'step', 'step', 'step', 'goal'],
    );
    assert.equal(items[0].date, TODAY);
    assert.equal(items.at(-1).targetDate, '2026-12-31');
  });

  it('marks done steps, the first open one as current and the rest as open', () => {
    const { state, id, ctx } = raceGoal();
    const [a, , c] = stepIds(state, id);
    let next = setStepDone(state, id, a, true, ctx);
    next = setStepDone(next, id, c, true, ctx);
    assert.deepEqual(
      timeline(findGoal(next, id))
        .filter((item) => item.kind === 'step')
        .map((item) => item.state),
      ['done', 'current', 'done'],
    );
  });

  it('draws the line solid as far as the current step and dashed ahead', () => {
    const { state, id, ctx } = raceGoal();
    const next = setStepDone(state, id, stepIds(state, id)[0], true, ctx);
    const segments = timeline(findGoal(next, id)).map((item) => [Boolean(item.segTop), Boolean(item.segBottom)]);
    assert.deepEqual(segments, [
      [false, true], // start → A
      [true, true], // A (done) → B
      [true, false], // B (current) - - C
      [false, false], // C (open) - - goal
      [false, false], // goal
    ]);
  });

  it('closes the line to the goal once every step is done', () => {
    const { state, id, ctx } = raceGoal(context(), ['A']);
    const next = setStepDone(state, id, stepIds(state, id)[0], true, ctx);
    const items = timeline(findGoal(next, id));
    assert.equal(items[1].segBottom, true);
    assert.equal(items[2].segTop, true);
    assert.equal(items[2].completedOn, TODAY);
  });
});

describe('todaySections', () => {
  function twoGoals() {
    const ctx = context();
    let { state, id: race } = createGoal(
      emptyState(),
      { title: 'Race', steps: [{ title: 'Shoes', dueDate: '2026-11-03' }, { title: 'Run 5 km' }, { title: 'Sign up', dueDate: '2026-11-05' }] },
      ctx,
    );
    let flat;
    ({ state, id: flat } = createGoal(state, { title: 'Flat', steps: [{ title: 'Budget' }, { title: 'Visit flats', dueDate: '2026-11-20' }] }, ctx));
    return { state, race, flat, ctx };
  }

  it('lists open steps due today or earlier first, by due date', () => {
    const { state } = twoGoals();
    const { due } = todaySections(state, TODAY);
    assert.deepEqual(
      due.map(({ step }) => step.title),
      ['Shoes', 'Sign up'],
    );
  });

  it('adds the current step of every open goal that is not already due', () => {
    const { state } = twoGoals();
    const { upNext } = todaySections(state, TODAY);
    assert.deepEqual(
      upNext.map(({ goal, step }) => [goal.title, step.title]),
      [['Flat', 'Budget']],
    );
  });

  it('lists the steps done today, the latest first, and leaves reached goals out of the rest', () => {
    const { state, race, flat, ctx } = twoGoals();
    const [budget, visit] = stepIds(state, flat);
    let next = setStepDone(state, flat, budget, true, at(ctx, TODAY, 9));
    next = setStepDone(next, flat, visit, true, at(ctx, TODAY, 18));
    const sections = todaySections(next, TODAY);
    assert.deepEqual(
      sections.doneToday.map(({ step }) => step.title),
      ['Visit flats', 'Budget'],
    );
    assert.ok([...sections.due, ...sections.upNext].every(({ goal }) => goal.id === race));
  });
});

describe('goalLists', () => {
  it('splits open and reached goals, the latest reached first', () => {
    const ctx = context();
    let { state, id: first } = createGoal(emptyState(), { title: 'First', steps: [{ title: 'x' }] }, ctx);
    let second;
    let third;
    ({ state, id: second } = createGoal(state, { title: 'Second', steps: [{ title: 'y' }] }, ctx));
    ({ state, id: third } = createGoal(state, { title: 'Third', steps: [{ title: 'z' }] }, ctx));
    state = setStepDone(state, first, stepIds(state, first)[0], true, at(ctx, '2026-11-06'));
    state = setStepDone(state, second, stepIds(state, second)[0], true, at(ctx, '2026-11-08'));
    const { active, completed } = goalLists(state);
    assert.deepEqual(
      active.map((goal) => goal.id),
      [third],
    );
    assert.deepEqual(
      completed.map((goal) => goal.id),
      [second, first],
    );
  });
});

describe('addExampleGoal', () => {
  it('adds a goal whose timeline is already under way', () => {
    const { state, id } = addExampleGoal(emptyState(), context());
    const goal = findGoal(state, id);
    const states = timeline(goal)
      .filter((item) => item.kind === 'step')
      .map((item) => item.state);
    assert.ok(states.includes('done'));
    assert.ok(states.includes('current'));
    assert.ok(states.includes('open'));
    assert.ok(goal.createdOn < TODAY);
    assert.ok(goal.targetDate > TODAY);
  });
});
