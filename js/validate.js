import { isLocalDate } from './dates.js';
import { CATEGORY_KEYS, LIMITS, multiLine, oneLine, SCHEMA_VERSION } from './model.js';

/**
 * Reading data the app did not just make: a backup file chosen by the person, or what was stored on this phone. It
 * is untrusted, so every field is checked and only known fields are copied into a fresh object; anything else is
 * dropped. IDs are restricted to a plain alphabet, so they are safe in HTML attributes and selectors.
 */

export const BACKUP_APP = 'questline-pocket';
export const MAX_BACKUP_CHARS = 5_000_000;
/** The last instant a JavaScript Date can hold; later "times" would break every date shown. */
const MAX_INSTANT_MS = 8_640_000_000_000_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const NOT_A_BACKUP = 'This file is not a Questline Pocket backup.';

class Invalid extends Error {}

const fail = (message) => {
  throw new Invalid(message);
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function title(value, label, max) {
  if (typeof value !== 'string') fail(`${label}: the title is not text.`);
  const text = oneLine(value);
  if (text === '') fail(`${label}: the title is empty.`);
  if (text.length > max) fail(`${label}: the title is longer than ${max} characters.`);
  return text;
}

function longText(value, label, field, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') fail(`${label}: the ${field} is not text.`);
  const text = multiLine(value);
  if (text.length > max) fail(`${label}: the ${field} is longer than ${max} characters.`);
  return text;
}

function date(value, label, field, { optional }) {
  if (optional && (value === undefined || value === null)) return null;
  if (!isLocalDate(value)) fail(`${label}: the ${field} is not a date.`);
  return value;
}

function instant(value, label, field, { optional }) {
  if (optional && (value === undefined || value === null)) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INSTANT_MS) fail(`${label}: the ${field} is not a time.`);
  return value;
}

function id(value, seen, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${label} has an invalid ID.`);
  if (seen.has(value)) fail(`${label} has an ID that is used twice.`);
  seen.add(value);
  return value;
}

function step(raw, seen, label) {
  if (!isPlainObject(raw)) fail(`${label} is not a step.`);
  const doneOn = date(raw.doneOn, label, 'done date', { optional: true });
  return {
    id: id(raw.id, seen, label),
    title: title(raw.title, label, LIMITS.stepTitle),
    dueDate: date(raw.dueDate, label, 'due date', { optional: true }),
    note: longText(raw.note, label, 'note', LIMITS.note),
    doneOn,
    doneAt: doneOn === null ? null : instant(raw.doneAt, label, 'done time', { optional: true }),
  };
}

function goal(raw, seen, label) {
  if (!isPlainObject(raw)) fail(`${label} is not a goal.`);
  const goalId = id(raw.id, seen, label);
  const checked = {
    title: title(raw.title, label, LIMITS.goalTitle),
    why: longText(raw.why, label, 'reason', LIMITS.why),
    category: CATEGORY_KEYS.includes(raw.category) ? raw.category : fail(`${label}: the category is unknown.`),
    targetDate: date(raw.targetDate, label, 'target date', { optional: true }),
    createdOn: date(raw.createdOn, label, 'start date', { optional: false }),
    createdAt: instant(raw.createdAt, label, 'creation time', { optional: false }),
    completedOn: date(raw.completedOn, label, 'reached date', { optional: true }),
  };
  if (!Array.isArray(raw.steps)) fail(`${label}: the steps are missing.`);
  if (raw.steps.length > LIMITS.stepsPerGoal) fail(`${label} has more than ${LIMITS.stepsPerGoal} steps.`);
  const steps = raw.steps.map((s, index) => step(s, seen, `${label}, step ${index + 1}`));
  // The reached date follows the steps (see model.js): repair it rather than refuse an otherwise good backup.
  const complete = steps.length > 0 && steps.every((s) => s.doneOn !== null);
  const latestDone = steps.reduce((latest, s) => (s.doneOn !== null && s.doneOn > latest ? s.doneOn : latest), '');
  return { id: goalId, ...checked, completedOn: complete ? (checked.completedOn ?? latestDone) : null, steps };
}

/** `{ ok: true, state }` with a clean copy, or `{ ok: false, error }` naming the first problem. */
export function sanitizeState(raw) {
  try {
    if (!isPlainObject(raw)) fail(NOT_A_BACKUP);
    if (raw.schema !== SCHEMA_VERSION) {
      fail(Number.isInteger(raw.schema) && raw.schema > SCHEMA_VERSION ? 'This backup comes from a newer version of the app. Update the app first.' : NOT_A_BACKUP);
    }
    if (!Array.isArray(raw.goals)) fail(NOT_A_BACKUP);
    if (raw.goals.length > LIMITS.goals) fail(`A backup holds at most ${LIMITS.goals} goals.`);
    const seen = new Set();
    return { ok: true, state: { schema: SCHEMA_VERSION, goals: raw.goals.map((g, index) => goal(g, seen, `Goal ${index + 1}`)) } };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
}

export function serializeBackup(state, exportedAt) {
  return `${JSON.stringify({ app: BACKUP_APP, schema: SCHEMA_VERSION, exportedAt, goals: state.goals }, null, 2)}\n`;
}

export function parseBackup(text) {
  if (typeof text !== 'string') return { ok: false, error: NOT_A_BACKUP };
  if (text.length > MAX_BACKUP_CHARS) return { ok: false, error: 'This file is too large to be a Questline Pocket backup.' };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: NOT_A_BACKUP };
  }
  if (!isPlainObject(raw) || raw.app !== BACKUP_APP) return { ok: false, error: NOT_A_BACKUP };
  const checked = sanitizeState({ schema: raw.schema, goals: raw.goals });
  return checked.ok || !checked.error.startsWith('Goal') ? checked : { ok: false, error: `This backup can’t be used. ${checked.error}` };
}
