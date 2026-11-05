import { localDateOf } from './dates.js';
import {
  addExampleGoal,
  createGoal,
  deleteGoal,
  deleteStep,
  emptyState,
  findGoal,
  goalProgress,
  moveStep,
  setStepDone,
  sortStepsByDueDate,
  updateGoal,
  addStep,
  updateStep,
  validateGoalInput,
  validateStepInput,
} from './model.js';
import { brokenScreen, goalFormScreen, goalScreen, goalsScreen, overlayHtml, recoverScreen, settingsScreen, snackHtml, stepFormScreen, stepRowHtml, todayScreen } from './screens.js';
import { loadState, readRaw, saveState, STORAGE_KEY, unreadableCopies } from './store.js';
import { parseBackup, serializeBackup } from './validate.js';

/**
 * The app: state, navigation, rendering and every `data-action`. All data stays in this browser's storage on the
 * phone; the only files it ever writes are the backups the person asks for.
 */

export const VERSION = '1.0.0';
const SNACK_MS = 6000;
const MAX_FORM_STEPS = 30;
const MAX_IMPORT_BYTES = 20_000_000;
const LAST_BACKUP_KEY = 'questline-pocket/last-backup';

const html = document.documentElement;
const screenEl = document.getElementById('screen');
const scrollEl = document.getElementById('scroll');
const overlayEl = document.getElementById('overlay');
const importInput = document.getElementById('import-file');

/* ───────── Environment: platform look and the phone's accessibility settings ───────── */

const requested = new URLSearchParams(location.search).get('platform');
const PLATFORM = requested === 'ios' || requested === 'android' ? requested : /Android/i.test(navigator.userAgent) ? 'android' : 'ios';

const QUERIES = {
  dark: window.matchMedia('(prefers-color-scheme: dark)'),
  contrast: window.matchMedia('(prefers-contrast: more)'),
  transparency: window.matchMedia('(prefers-reduced-transparency: reduce)'),
  motion: window.matchMedia('(prefers-reduced-motion: reduce)'),
  standalone: window.matchMedia('(display-mode: standalone)'),
};

function applyEnvironment() {
  html.dataset.platform = PLATFORM;
  html.dataset.theme = QUERIES.dark.matches ? 'dark' : 'light';
  html.dataset.contrast = QUERIES.contrast.matches ? 'more' : 'standard';
  html.dataset.transparency = QUERIES.transparency.matches ? 'reduced' : 'standard';
  html.classList.toggle('reduce-motion', QUERIES.motion.matches);
}

const isInstalled = () => QUERIES.standalone.matches || navigator.standalone === true;

function haptic(pattern) {
  if (PLATFORM === 'android') navigator.vibrate?.(pattern);
}

/* ───────── Storage ───────── */

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const local = browserStorage();
const refusingStorage = {
  getItem() {
    throw new Error('storage unavailable');
  },
  setItem() {
    throw new Error('storage unavailable');
  },
  removeItem() {
    throw new Error('storage unavailable');
  },
};
const storageArea = local ?? refusingStorage;
const storage = { status: 'ok', saveError: null, persisted: null, asked: false };
/** Exactly what this window last read from or wrote to storage: any other value there came from another window. */
let baseline = null;

function readLastBackup() {
  try {
    return local?.getItem(LAST_BACKUP_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Asks the browser not to clear this site's data to free up space (granted to installed apps). */
async function askToPersist() {
  if (storage.asked || storage.persisted === true || !navigator.storage?.persist) return;
  storage.asked = true;
  try {
    storage.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    storage.persisted = null;
  }
}

/* ───────── State ───────── */

let state;

const ui = {
  route: { name: 'today' },
  stack: [],
  overlay: null,
  snack: null,
  snackTimer: 0,
  flags: {},
  form: null,
  lastBackup: null,
  lastToday: '',
  unreadable: null,
};

function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function ctx() {
  const now = Date.now();
  return { now, today: localDateOf(new Date(now)), newId };
}

function setSnack(snack) {
  clearTimeout(ui.snackTimer);
  ui.snack = snack;
  if (snack) {
    ui.snackTimer = setTimeout(() => {
      ui.snack = null;
      renderOverlay();
    }, SNACK_MS);
  }
}

/** Takes what storage holds as the state. Data that can't be read and couldn't be put aside blocks the app. */
function applyLoaded(loaded) {
  state = loaded.state;
  storage.status = loaded.status;
  baseline = loaded.raw;
  ui.unreadable = loaded.status === 'unreadable' ? loaded.raw : null;
  if (loaded.status === 'unreadable') {
    ui.overlay = null;
    ui.stack = [];
    ui.route = { name: 'recover' };
  }
}

/** Another window (a browser tab next to the installed app) saved: show its data instead of overwriting it later. */
function adoptStored(message) {
  applyLoaded(loadState(storageArea, Date.now()));
  setSnack({ text: message, iconName: 'info' });
  render();
}

function syncWithStorage() {
  const stored = readRaw(storageArea);
  if (stored === undefined || stored === baseline) return;
  adoptStored('Updated with changes from another window.');
}

/**
 * Replaces the state, saves it and offers Undo when asked to; the caller renders. Returns false and changes nothing
 * when storage changed since this window last read or wrote it: that newer data is loaded instead of overwritten.
 */
function commit(next, { snack = null, flags = {} } = {}) {
  if (storage.status === 'unreadable') return false;
  const stored = readRaw(storageArea);
  if (stored !== undefined && stored !== baseline) {
    adoptStored('Changes from another window were loaded. Please try again.');
    return false;
  }
  const previous = state;
  state = next;
  ui.flags = flags;
  const saved = saveState(storageArea, state);
  storage.saveError = saved.ok ? null : saved.error;
  if (!saved.ok) {
    setSnack({ text: 'Couldn’t save on this phone. Download a backup in Settings.', iconName: 'triangle-alert' });
    return true;
  }
  baseline = saved.text;
  askToPersist();
  setSnack(snack ? { ...snack, undoState: snack.undo ? previous : null } : null);
  return true;
}

/* ───────── Navigation, in step with the browser history ─────────
   Every pushed screen and every open overlay has a history entry, so the Android back gesture closes the overlay or
   goes back a screen instead of leaving the app. In-app "back" goes through history too. Each entry carries this
   page session's ID and its depth, so entries left over from before a reload are recognised and skipped. */

const LABELS = { today: 'Today', goals: 'Goals', settings: 'Settings', goal: 'Goal' };
const isFormRoute = (route) => route.name === 'goal-form' || route.name === 'step-form';
const tabOf = () => (ui.stack[0] ?? ui.route).name;
const SESSION = newId();
const depth = () => ui.stack.length + (ui.overlay ? 1 : 0);
const pushEntry = () => history.pushState({ questline: SESSION, depth: depth() }, '');
let pending = null;

function go(route) {
  if (isFormRoute(ui.route)) captureDraft();
  ui.stack.push({ ...ui.route, form: ui.form });
  ui.route = route;
  ui.form = null;
  pushEntry();
  render({ navigated: true });
}

/** Swaps the current screen for another without a new history entry (after creating a goal). */
function replaceRoute(route) {
  ui.route = route;
  ui.form = null;
  render({ navigated: true });
}

function applyUnwind({ pops = 0, root = null }) {
  if (root) {
    ui.stack = [];
    ui.route = root;
    ui.form = null;
  } else {
    for (let i = 0; i < pops && ui.stack.length; i += 1) {
      const { form, ...route } = ui.stack.pop();
      ui.route = route;
      ui.form = form ?? null;
    }
  }
  render({ navigated: Boolean(root) || pops > 0 });
}

/** Leaves the open overlay and `pops` screens (or every screen, for a new tab) through history. */
function unwind({ pops = 0, root = null } = {}) {
  const entries = (ui.overlay ? 1 : 0) + (root ? ui.stack.length : Math.min(pops, ui.stack.length));
  ui.overlay = null;
  if (entries === 0) {
    applyUnwind({ pops, root });
    return;
  }
  pending = { pops, root };
  history.go(-entries);
}

const back = () => unwind({ pops: 1 });
const closeOverlay = () => unwind();

function openOverlay(overlay) {
  const opening = !ui.overlay;
  ui.overlay = overlay;
  if (opening) pushEntry();
  render();
}

/** One overlay leads to the next (menu → confirmation) on the same history entry. */
function swapOverlay(overlay) {
  ui.overlay = overlay;
  renderOverlay();
}

window.addEventListener('popstate', (event) => {
  if (pending) {
    const next = pending;
    pending = null;
    applyUnwind(next);
    return;
  }
  const entry = event.state;
  if (entry?.questline !== SESSION) {
    // Left over from before a reload: no screen of this session is behind it, so keep going back (out of the app).
    if (depth() === 0) history.back();
    return;
  }
  if (entry.depth > depth()) {
    // Forward: those screens are gone, so return to where the app is.
    pending = { pops: 0 };
    history.go(depth() - entry.depth);
    return;
  }
  // The system back gesture or button, possibly several entries at once.
  let levels = depth() - entry.depth;
  if (levels > 0 && ui.overlay) {
    ui.overlay = null;
    levels -= 1;
  }
  applyUnwind({ pops: levels });
});

/* ───────── Rendering ───────── */

const SCREENS = {
  today: todayScreen,
  goals: goalsScreen,
  settings: settingsScreen,
  goal: goalScreen,
  'goal-form': goalFormScreen,
  'step-form': stepFormScreen,
  recover: recoverScreen,
};

function view() {
  const previous = ui.stack[ui.stack.length - 1];
  return {
    state,
    today: localDateOf(new Date()),
    platform: PLATFORM,
    route: ui.route,
    flags: ui.flags,
    form: ui.form,
    overlay: ui.overlay,
    motion: !QUERIES.motion.matches,
    storage,
    installed: isInstalled(),
    lastBackup: ui.lastBackup,
    asideCopies: unreadableCopies(storageArea).length,
    backLabel: previous ? (LABELS[previous.name] ?? 'Back') : 'Back',
    version: VERSION,
  };
}

/** A form keeps what was typed when its screen is drawn again. */
function readForm(form) {
  const data = new FormData(form);
  const text = (name) => String(data.get(name) ?? '');
  return form.dataset.form === 'goal'
    ? { title: text('title'), why: text('why'), category: text('category'), targetDate: text('targetDate'), steps: data.getAll('step').map(String) }
    : { title: text('title'), dueDate: text('dueDate'), note: text('note') };
}

function captureDraft() {
  const form = scrollEl.querySelector('form[data-form]');
  if (form) ui.form = { values: readForm(form), errors: ui.form?.errors ?? {} };
}

function focusKeyOf(element) {
  if (!element || element === document.body || !scrollEl.contains(element)) return null;
  const { action, goal, step } = element.dataset;
  if (action) return `[data-action="${CSS.escape(action)}"]${goal ? `[data-goal="${CSS.escape(goal)}"]` : ''}${step ? `[data-step="${CSS.escape(step)}"]` : ''}`;
  return element.name ? `[name="${CSS.escape(element.name)}"]` : null;
}

/** A form for something that no longer exists (deleted, or undone) falls back to the goal. */
function checkRoute() {
  const { route } = ui;
  if (route.name === 'step-form' && route.stepId && !findGoal(state, route.goalId)?.steps.some((s) => s.id === route.stepId)) {
    ui.route = { name: 'goal', goalId: route.goalId, tab: tabOf() };
  } else if (route.name === 'goal-form' && route.goalId && !findGoal(state, route.goalId)) {
    ui.route = { name: 'goal', goalId: route.goalId, tab: tabOf() };
  }
}

function renderScreen({ navigated = false } = {}) {
  try {
    if (!navigated && isFormRoute(ui.route)) captureDraft();
    checkRoute();
    const focusKey = navigated ? null : focusKeyOf(document.activeElement);
    const top = scrollEl.scrollTop;
    const current = view();
    ui.lastToday = current.today;
    scrollEl.innerHTML = SCREENS[ui.route.name](current);
    if (navigated) {
      scrollEl.scrollTop = 0;
      screenEl.classList.remove('is-scrolled');
      const newItem = isFormRoute(ui.route) && !ui.route.stepId && !(ui.route.name === 'goal-form' && ui.route.goalId);
      const target = newItem ? scrollEl.querySelector('input[name="title"]') : scrollEl.querySelector('h1');
      target?.focus({ preventScroll: true });
    } else {
      scrollEl.scrollTop = top;
      if (focusKey) scrollEl.querySelector(focusKey)?.focus({ preventScroll: true });
    }
  } catch (error) {
    // Unexpected data must never leave a blank app: offer the backup and the other screens.
    console.error(error);
    scrollEl.innerHTML = brokenScreen(PLATFORM);
  }
  screenEl.classList.toggle('has-tabbar', scrollEl.querySelector('.tabbar') !== null);
  ui.flags = {};
}

function renderOverlay() {
  const hadDialog = overlayEl.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null;
  try {
    overlayEl.innerHTML = overlayHtml(view()) + snackHtml(ui.snack);
  } catch (error) {
    console.error(error);
    overlayEl.innerHTML = snackHtml({ text: 'Something went wrong. Please try again.', iconName: 'circle-alert' });
  }
  const dialog = overlayEl.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]');
  if (dialog && !hadDialog) (dialog.querySelector('[data-autofocus]') ?? dialog.querySelector('button'))?.focus({ preventScroll: true });
}

function render(options) {
  renderScreen(options);
  renderOverlay();
}

/* ───────── Actions ───────── */

function stepOf(element) {
  const goal = findGoal(state, element.dataset.goal);
  return { goal, step: goal?.steps.find((s) => s.id === element.dataset.step) };
}

function toggleStep(element) {
  const { goal, step } = stepOf(element);
  if (!step) return;
  const done = step.doneOn === null;
  const next = setStepDone(state, goal.id, step.id, done, ctx());
  const reached = done && !goalProgress(goal).complete && goalProgress(findGoal(next, goal.id)).complete;
  if (isFormRoute(ui.route)) captureDraft();
  const saved = commit(next, {
    flags: done ? (reached ? { justCompleted: step.id } : { justDone: step.id }) : {},
    snack: reached ? null : { text: done ? 'Step done' : 'Step marked as not done', undo: true },
  });
  if (!saved) return;
  if (done) haptic(reached ? [12, 60, 24] : 10);
  if (reached) openOverlay({ type: 'reached', goalId: goal.id });
  else render();
}

function addStepRow(form) {
  const rows = form.querySelector('#step-rows');
  const count = rows.querySelectorAll('input[name="step"]').length;
  if (count >= MAX_FORM_STEPS) return null;
  rows.insertAdjacentHTML('beforeend', stepRowHtml(count));
  return rows.lastElementChild.querySelector('input');
}

function showErrors(values, errors) {
  ui.form = { values, errors };
  renderScreen();
  scrollEl.querySelector('[aria-invalid="true"]')?.focus();
}

function submitGoal(form) {
  const values = readForm(form);
  const checked = validateGoalInput(values);
  if (!checked.ok) {
    showErrors(values, checked.errors);
    return;
  }
  const goalId = ui.route.goalId;
  if (goalId) {
    if (commit(updateGoal(state, goalId, values), { snack: { text: 'Goal saved', undo: true } })) back();
    return;
  }
  const created = createGoal(state, { ...values, steps: values.steps.map((title) => ({ title })) }, ctx());
  if (commit(created.state, { snack: { text: 'Goal created', undo: true } })) replaceRoute({ name: 'goal', goalId: created.id, tab: tabOf() });
}

function submitStep(form) {
  const values = readForm(form);
  const checked = validateStepInput(values);
  if (!checked.ok) {
    showErrors(values, checked.errors);
    return;
  }
  const { goalId, stepId } = ui.route;
  const wasComplete = goalProgress(findGoal(state, goalId)).complete;
  const saved = stepId
    ? commit(updateStep(state, goalId, stepId, values), { snack: { text: 'Step saved', undo: true } })
    : commit(addStep(state, goalId, values, ctx()).state, { snack: { text: wasComplete ? 'Step added. The goal is open again.' : 'Step added', undo: true } });
  if (saved) back();
}

function download(file) {
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** iOS saves files through the share sheet ("Save to Files"); elsewhere, or if sharing fails, a download. */
async function saveFile(file, title = 'Questline Pocket backup') {
  if (PLATFORM === 'ios' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
    }
  }
  download(file);
  return true;
}

/** Hands over data the app couldn't read, untouched, as a text file. */
async function saveUnreadable(text) {
  if (text === null || text === undefined) return;
  if (await saveFile(new File([text], `questline-unreadable-${ctx().today}.txt`, { type: 'text/plain' }), 'Questline Pocket data')) {
    setSnack({ text: 'Data saved' });
    renderOverlay();
  }
}

function readKey(key) {
  try {
    return storageArea.getItem(key);
  } catch {
    return null;
  }
}

async function exportBackup() {
  const { now, today } = ctx();
  const file = new File([serializeBackup(state, new Date(now).toISOString())], `questline-backup-${today}.json`, { type: 'application/json' });
  if (!(await saveFile(file))) return;
  try {
    local?.setItem(LAST_BACKUP_KEY, today);
  } catch {
    // Only the "last backup" note is lost.
  }
  ui.lastBackup = today;
  setSnack({ text: 'Backup saved' });
  render();
}

async function importBackup() {
  const file = importInput.files?.[0];
  importInput.value = '';
  if (!file) return;
  const parsed = file.size > MAX_IMPORT_BYTES ? { ok: false, error: 'This file is too large to be a Questline Pocket backup.' } : parseBackup(await file.text());
  if (!parsed.ok) {
    setSnack({ text: parsed.error, iconName: 'circle-alert' });
    renderOverlay();
    return;
  }
  openOverlay({ type: 'confirm-import', backup: parsed.state });
}

const ACTIONS = {
  tab: (el) => unwind({ root: { name: el.dataset.tab } }),
  back: () => back(),
  filter: (el) => {
    ui.route = { ...ui.route, filter: el.dataset.value };
    renderScreen();
  },
  'new-goal': () => go({ name: 'goal-form' }),
  'open-goal': (el) => go({ name: 'goal', goalId: el.dataset.goal, tab: tabOf() }),
  'edit-goal': (el) => go({ name: 'goal-form', goalId: el.dataset.goal }),
  'add-step': (el) => go({ name: 'step-form', goalId: el.dataset.goal }),
  'edit-step': (el) => go({ name: 'step-form', goalId: el.dataset.goal, stepId: el.dataset.step }),
  'toggle-step': toggleStep,
  'move-step': (el) => {
    const { goal, step } = stepOf(el);
    captureDraft();
    if (commit(moveStep(state, goal.id, step.id, Number(el.dataset.delta)))) renderScreen();
  },
  'add-example': () => {
    const added = addExampleGoal(state, ctx());
    if (commit(added.state, { snack: { text: 'Example goal added', undo: true } })) go({ name: 'goal', goalId: added.id, tab: tabOf() });
  },
  'goal-menu': (el) => openOverlay({ type: 'goal-menu', goalId: el.dataset.goal }),
  'sort-steps': (el) => {
    commit(sortStepsByDueDate(state, el.dataset.goal), { snack: { text: 'Steps sorted by due date', undo: true } });
    closeOverlay();
  },
  'delete-goal': (el) => swapOverlay({ type: 'confirm-delete-goal', goalId: el.dataset.goal }),
  'confirm-delete-goal': (el) => {
    const deleted = commit(deleteGoal(state, el.dataset.goal), { snack: { text: 'Goal deleted', undo: true } });
    unwind({ pops: deleted && ui.route.name === 'goal' ? 1 : 0 });
  },
  'delete-step': (el) => openOverlay({ type: 'confirm-delete-step', goalId: el.dataset.goal, stepId: el.dataset.step }),
  'confirm-delete-step': (el) => {
    const deleted = commit(deleteStep(state, el.dataset.goal, el.dataset.step, ctx()), { snack: { text: 'Step deleted', undo: true } });
    unwind({ pops: deleted && ui.route.name === 'step-form' ? 1 : 0 });
  },
  'pick-category': (el) => {
    const form = el.closest('form');
    form.querySelectorAll('[data-action="pick-category"]').forEach((chip) => chip.setAttribute('aria-checked', String(chip === el)));
    form.querySelector('input[name="category"]').value = el.dataset.value;
  },
  'add-step-row': (el) => addStepRow(el.closest('form'))?.focus(),
  'clear-field': (el) => {
    const input = document.getElementById(el.dataset.field);
    input.value = '';
    el.hidden = true;
  },
  'close-overlay': () => closeOverlay(),
  undo: () => {
    const previous = ui.snack?.undoState;
    if (previous && commit(previous)) render();
  },
  export: () => exportBackup(),
  import: () => importInput.click(),
  'confirm-import': () => {
    commit(ui.overlay.backup, { snack: { text: 'Backup restored', undo: true } });
    closeOverlay();
  },
  'delete-all': () => openOverlay({ type: 'confirm-delete-all' }),
  'confirm-delete-all': () => {
    commit(emptyState(), { snack: { text: 'All data deleted', undo: true } });
    closeOverlay();
  },
  'download-unreadable': () => saveUnreadable(ui.unreadable),
  'download-aside': () => saveUnreadable(readKey(unreadableCopies(storageArea)[0])),
  'start-fresh': () => openOverlay({ type: 'confirm-start-fresh' }),
  'confirm-start-fresh': () => {
    try {
      storageArea.removeItem(STORAGE_KEY);
    } catch {
      // Checked below: the data is still there.
    }
    const loaded = loadState(storageArea, Date.now());
    if (loaded.status === 'unreadable') {
      setSnack({ text: 'The data couldn’t be deleted.', iconName: 'circle-alert' });
      closeOverlay();
      return;
    }
    applyLoaded(loaded);
    unwind({ root: { name: 'today' } });
  },
};

function fail(error) {
  console.error(error);
  setSnack({ text: 'Something went wrong. Please try again.', iconName: 'circle-alert' });
  renderOverlay();
}

function run(task) {
  try {
    const result = task();
    if (result instanceof Promise) result.catch(fail);
  } catch (error) {
    fail(error);
  }
}

/* ───────── Events ───────── */

document.addEventListener('click', (event) => {
  const element = event.target.closest('[data-action]');
  const handler = element && ACTIONS[element.dataset.action];
  if (!handler) return;
  event.preventDefault();
  // A history step is under way: the screen on show is about to change, so a second tap would act on stale UI.
  if (pending) return;
  run(() => handler(element));
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (pending) return;
  run(() => (form.dataset.form === 'goal' ? submitGoal(form) : submitStep(form)));
});

function syncClearButton(event) {
  const input = event.target;
  if (input.type !== 'date') return;
  const clear = input.parentElement?.querySelector('.field__clear');
  if (clear) clear.hidden = input.value === '';
}
document.addEventListener('input', syncClearButton);
document.addEventListener('change', syncClearButton);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && ui.overlay) {
    closeOverlay();
    return;
  }
  if (event.key !== 'Enter' || event.isComposing) return;
  // In the new-goal form, Enter moves on: title → why, and from one step row to the next.
  const input = event.target;
  const form = input.closest?.('form[data-form="goal"]');
  if (!form || input.tagName !== 'INPUT') return;
  if (input.name === 'title') {
    event.preventDefault();
    form.querySelector('textarea[name="why"]')?.focus();
  } else if (input.name === 'step') {
    event.preventDefault();
    const rows = [...form.querySelectorAll('input[name="step"]')];
    const next = rows[rows.indexOf(input) + 1];
    if (next) next.focus();
    else if (input.value.trim() !== '') addStepRow(form)?.focus();
  }
});

importInput.addEventListener('change', () => run(importBackup));

scrollEl.addEventListener('scroll', () => screenEl.classList.toggle('is-scrolled', scrollEl.scrollTop > 4), { passive: true });

Object.values(QUERIES).forEach((query) =>
  query.addEventListener?.('change', () => {
    applyEnvironment();
    if (!isFormRoute(ui.route)) render();
  }),
);

/** A new day changes what is due: redraw when the app comes back or the date turns while it is open. */
function refreshIfNewDay() {
  if (localDateOf(new Date()) !== ui.lastToday && !isFormRoute(ui.route)) render();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  syncWithStorage();
  refreshIfNewDay();
});
setInterval(refreshIfNewDay, 60_000);

/* Another window of this app (a browser tab next to the installed app) changed the data. */
window.addEventListener('storage', (event) => {
  if (event.key === null || event.key === STORAGE_KEY) syncWithStorage();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) syncWithStorage();
});

/* ───────── Start ───────── */

applyEnvironment();
applyLoaded(loadState(storageArea, Date.now()));
ui.lastBackup = readLastBackup();
history.replaceState({ questline: SESSION, depth: 0 }, '');
render({ navigated: true });

navigator.storage
  ?.persisted?.()
  .then((persisted) => {
    storage.persisted = persisted;
    if (ui.route.name === 'settings') renderScreen();
  })
  .catch(() => {});

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
