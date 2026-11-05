import { addDays, daysBetween, isLocalDate } from './dates.js';

/**
 * Goals, their steps and the timeline: pure functions over plain data, so every rule is testable without a browser.
 * Each change returns a new state and never alters the one it was given.
 *
 * A goal is reached exactly when it has steps and every step is done (as an achievement unlocks when its required
 * quests are complete in the Questline backend); undoing a step or adding a new one opens it again.
 *
 * `ctx` is `{ today: 'YYYY-MM-DD', now: epoch ms, newId: () => string }`, supplied by the app.
 */

export const SCHEMA_VERSION = 1;
export const MS_PER_DAY = 86_400_000;
export const CATEGORY_KEYS = Object.freeze(['study', 'health', 'independence', 'career', 'finance', 'custom']);
export const LIMITS = Object.freeze({ goalTitle: 120, why: 500, stepTitle: 120, note: 1000, goals: 500, stepsPerGoal: 500 });

export function emptyState() {
  return { schema: SCHEMA_VERSION, goals: [] };
}

/* ───────── Input from forms ───────── */

export const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
export const multiLine = (text) =>
  String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();

function optionalDate(value) {
  const text = String(value ?? '').trim();
  if (text === '') return { date: null };
  return isLocalDate(text) ? { date: text } : { date: null, error: 'Pick a date that exists.' };
}

function titleError(title, max, what) {
  if (title === '') return `Give ${what} a title.`;
  return title.length > max ? `Keep the title to ${max} characters.` : undefined;
}

function result(errors, value) {
  const found = Object.fromEntries(Object.entries(errors).filter(([, message]) => message !== undefined));
  return { ok: Object.keys(found).length === 0, errors: found, value };
}

export function validateGoalInput(input = {}) {
  const title = oneLine(input.title);
  const why = multiLine(input.why);
  const target = optionalDate(input.targetDate);
  return result(
    {
      title: titleError(title, LIMITS.goalTitle, 'your goal'),
      why: why.length > LIMITS.why ? `Keep this to ${LIMITS.why} characters.` : undefined,
      targetDate: target.error,
    },
    { title, why, category: CATEGORY_KEYS.includes(input.category) ? input.category : 'custom', targetDate: target.date },
  );
}

export function validateStepInput(input = {}) {
  const title = oneLine(input.title);
  const note = multiLine(input.note);
  const due = optionalDate(input.dueDate);
  return result(
    {
      title: titleError(title, LIMITS.stepTitle, 'the step'),
      dueDate: due.error,
      note: note.length > LIMITS.note ? `Keep the note to ${LIMITS.note} characters.` : undefined,
    },
    { title, dueDate: due.date, note },
  );
}

function requireValid(checked, what) {
  if (!checked.ok) throw new RangeError(`invalid ${what}: ${Object.values(checked.errors).join(' ')}`);
  return checked.value;
}

/* ───────── Lookups ───────── */

export function findGoal(state, goalId) {
  return state.goals.find((goal) => goal.id === goalId);
}

function stepIndex(goal, stepId) {
  const index = goal.steps.findIndex((step) => step.id === stepId);
  if (index === -1) throw new RangeError('no such step');
  return index;
}

function replaceGoal(state, goalId, change) {
  if (findGoal(state, goalId) === undefined) throw new RangeError('no such goal');
  return { ...state, goals: state.goals.map((goal) => (goal.id === goalId ? change(goal) : goal)) };
}

const isDone = (step) => step.doneOn !== null;

export function isComplete(goal) {
  return goal.steps.length > 0 && goal.steps.every(isDone);
}

/** Sets the reached date when the goal has just been reached and clears it when it is open again. */
function withCompletion(goal, today) {
  const completedOn = isComplete(goal) ? (goal.completedOn ?? today) : null;
  return completedOn === goal.completedOn ? goal : { ...goal, completedOn };
}

const newStep = (value, id) => ({ id, ...value, doneOn: null, doneAt: null });

/* ───────── Changes ───────── */

export function createGoal(state, input, ctx) {
  const value = requireValid(validateGoalInput(input), 'goal');
  if (state.goals.length >= LIMITS.goals) throw new RangeError(`at most ${LIMITS.goals} goals`);
  const rows = (input.steps ?? []).filter((row) => oneLine(row?.title) !== '');
  if (rows.length > LIMITS.stepsPerGoal) throw new RangeError(`at most ${LIMITS.stepsPerGoal} steps`);
  const id = ctx.newId();
  const steps = rows.map((row) => newStep(requireValid(validateStepInput(row), 'step'), ctx.newId()));
  const goal = { id, ...value, createdOn: ctx.today, createdAt: ctx.now, completedOn: null, steps };
  return { state: { ...state, goals: [...state.goals, goal] }, id };
}

export function updateGoal(state, goalId, input) {
  const value = requireValid(validateGoalInput(input), 'goal');
  return replaceGoal(state, goalId, (goal) => ({ ...goal, ...value }));
}

export function deleteGoal(state, goalId) {
  if (findGoal(state, goalId) === undefined) throw new RangeError('no such goal');
  return { ...state, goals: state.goals.filter((goal) => goal.id !== goalId) };
}

export function addStep(state, goalId, input, ctx) {
  const value = requireValid(validateStepInput(input), 'step');
  const id = ctx.newId();
  const next = replaceGoal(state, goalId, (goal) => {
    if (goal.steps.length >= LIMITS.stepsPerGoal) throw new RangeError(`at most ${LIMITS.stepsPerGoal} steps`);
    return withCompletion({ ...goal, steps: [...goal.steps, newStep(value, id)] }, ctx.today);
  });
  return { state: next, id };
}

/** Title, due date and note; whether the step is done changes only through `setStepDone`. */
export function updateStep(state, goalId, stepId, input) {
  const value = requireValid(validateStepInput(input), 'step');
  return replaceGoal(state, goalId, (goal) => {
    const index = stepIndex(goal, stepId);
    return { ...goal, steps: goal.steps.map((step, i) => (i === index ? { ...step, ...value } : step)) };
  });
}

export function deleteStep(state, goalId, stepId, ctx) {
  return replaceGoal(state, goalId, (goal) => {
    stepIndex(goal, stepId);
    return withCompletion({ ...goal, steps: goal.steps.filter((step) => step.id !== stepId) }, ctx.today);
  });
}

/** Moves a step `delta` places along the timeline; it stops at either end. */
export function moveStep(state, goalId, stepId, delta) {
  return replaceGoal(state, goalId, (goal) => {
    const from = stepIndex(goal, stepId);
    const to = Math.min(goal.steps.length - 1, Math.max(0, from + delta));
    if (to === from) return goal;
    const steps = goal.steps.filter((step) => step.id !== stepId);
    return { ...goal, steps: [...steps.slice(0, to), goal.steps[from], ...steps.slice(to)] };
  });
}

/** Dated steps first, earliest first; ties and undated steps keep their order. */
export function sortStepsByDueDate(state, goalId) {
  const rank = (step) => step.dueDate ?? '\uffff';
  return replaceGoal(state, goalId, (goal) => ({
    ...goal,
    steps: goal.steps
      .map((step, index) => ({ step, index }))
      .sort((a, b) => (rank(a.step) < rank(b.step) ? -1 : rank(a.step) > rank(b.step) ? 1 : a.index - b.index))
      .map(({ step }) => step),
  }));
}

/** Done keeps the first done date; not done clears it. Reaching or reopening the goal follows. */
export function setStepDone(state, goalId, stepId, done, ctx) {
  return replaceGoal(state, goalId, (goal) => {
    const index = stepIndex(goal, stepId);
    const step = goal.steps[index];
    if (done === isDone(step)) return goal;
    const changed = done ? { ...step, doneOn: ctx.today, doneAt: ctx.now } : { ...step, doneOn: null, doneAt: null };
    return withCompletion({ ...goal, steps: goal.steps.map((s, i) => (i === index ? changed : s)) }, ctx.today);
  });
}

/* ───────── Views ───────── */

export function goalProgress(goal) {
  const open = goal.steps.filter((step) => !isDone(step));
  const total = goal.steps.length;
  const done = total - open.length;
  const nextDue = open
    .filter((step) => step.dueDate !== null)
    .reduce((best, step) => (best === null || step.dueDate < best.dueDate ? step : best), null);
  return { total, done, progress: total === 0 ? 0 : done / total, complete: isComplete(goal), current: open[0] ?? null, nextDue };
}

/**
 * The goal as a path: its start, every step in order, the goal itself. The line is solid as far as the person has
 * come — through done steps up to the current one (the first open step) — and dashed ahead; it reaches the goal
 * once every step is done.
 */
export function timeline(goal) {
  const { current, complete } = goalProgress(goal);
  const walked = (step) => step !== undefined && (isDone(step) || step === current);
  const last = goal.steps.length - 1;
  return [
    { kind: 'start', date: goal.createdOn, segTop: false, segBottom: walked(goal.steps[0]) },
    ...goal.steps.map((step, index) => ({
      kind: 'step',
      step,
      index,
      state: isDone(step) ? 'done' : step === current ? 'current' : 'open',
      segTop: walked(step),
      segBottom: index === last ? complete : walked(goal.steps[index + 1]),
    })),
    { kind: 'goal', complete, completedOn: goal.completedOn, targetDate: goal.targetDate, segTop: complete, segBottom: false },
  ];
}

const byDueDate = (a, b) => (a.step.dueDate < b.step.dueDate ? -1 : a.step.dueDate > b.step.dueDate ? 1 : 0);

/**
 * Today: open steps due today or earlier (by due date), then "up next" — the current step of every open goal that
 * is not due yet, dated ones first — and the steps done today, the latest first.
 */
export function todaySections(state, today) {
  const open = state.goals.filter((goal) => !isComplete(goal));
  const due = open
    .flatMap((goal) => goal.steps.filter((step) => !isDone(step) && step.dueDate !== null && daysBetween(step.dueDate, today) >= 0).map((step) => ({ goal, step })))
    .sort(byDueDate);
  const dueIds = new Set(due.map(({ step }) => step.id));
  const upNext = open
    .map((goal) => ({ goal, step: goalProgress(goal).current }))
    .filter(({ step }) => step !== null && !dueIds.has(step.id))
    .sort((a, b) => (a.step.dueDate === null || b.step.dueDate === null ? Number(a.step.dueDate === null) - Number(b.step.dueDate === null) : byDueDate(a, b)));
  const doneToday = state.goals
    .flatMap((goal) => goal.steps.filter((step) => step.doneOn === today).map((step) => ({ goal, step })))
    .sort((a, b) => (b.step.doneAt ?? 0) - (a.step.doneAt ?? 0));
  return { due, upNext, doneToday };
}

/** Open goals in the order they were made; reached goals, the latest reached first. */
export function goalLists(state) {
  const active = state.goals.filter((goal) => !isComplete(goal));
  const completed = state.goals
    .filter(isComplete)
    .sort((a, b) => (a.completedOn < b.completedOn ? 1 : a.completedOn > b.completedOn ? -1 : b.createdAt - a.createdAt));
  return { active, completed };
}

/* ───────── Example ───────── */

/** A goal that is already under way, so the timeline can be tried out at once; it is an ordinary goal. */
export function addExampleGoal(state, ctx) {
  const day = (offset) => addDays(ctx.today, offset);
  const back = (offset) => ({ ...ctx, today: day(offset), now: ctx.now + offset * MS_PER_DAY });
  const created = createGoal(
    state,
    {
      title: 'Run my first 10 km race',
      why: 'Prove to myself that I can stick with something for two months.',
      category: 'health',
      targetDate: day(45),
      steps: [
        { title: 'Buy proper running shoes', note: 'Get fitted at a running shop.' },
        { title: 'Run 3 km without stopping', dueDate: day(-2) },
        { title: 'Run 5 km without stopping', dueDate: day(4) },
        { title: 'Sign up for the race', dueDate: day(10) },
        { title: 'Run 8 km in training', dueDate: day(28) },
        { title: 'Run the race', dueDate: day(45) },
      ],
    },
    back(-10),
  );
  const [shoes, threeK] = findGoal(created.state, created.id).steps;
  const withShoes = setStepDone(created.state, created.id, shoes.id, true, back(-8));
  return { state: setStepDone(withShoes, created.id, threeK.id, true, back(-3)), id: created.id };
}
