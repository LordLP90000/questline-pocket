import { daysBetween, toDayNumber } from './dates.js';

/** How dates and numbers read in the app: Swiss formats (05.11.2026), English words, neutral about setbacks. */

const LOCALE = 'en-CH';
const MS_PER_DAY = 86_400_000;
/** Due dates up to a week ahead count down in days; later ones show their date. */
const COUNTDOWN_DAYS = 7;

/** Intl formats instants; a calendar date becomes the UTC midnight of that day, formatted in UTC. */
const asUtcInstant = (date) => toDayNumber(date) * MS_PER_DAY;

const DATE = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const WEEKDAY_DATE = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const TIME = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function formatDate(date) {
  return DATE.format(asUtcInstant(date));
}

export function formatDayMonth(date) {
  const [, month, day] = date.split('-');
  return `${day}.${month}.`;
}

export function weekdayDate(date) {
  return WEEKDAY_DATE.format(asUtcInstant(date));
}

/** The time of an instant on this phone, e.g. 18:40. */
export function formatTime(instantMs) {
  return TIME.format(instantMs);
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function dueText(dueDate, today) {
  const days = daysBetween(today, dueDate);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days > 1 && days <= COUNTDOWN_DAYS) return `Due in ${days} days`;
  if (days > COUNTDOWN_DAYS) return `Due ${formatDate(dueDate)}`;
  return days === -1 ? 'Was due yesterday' : `Was due ${formatDate(dueDate)}`;
}

export function targetText(targetDate, today) {
  const days = daysBetween(today, targetDate);
  if (days > 0) return `${plural(days, 'day')} left`;
  if (days === 0) return 'Target date is today';
  return `Target date was ${formatDate(targetDate)}`;
}

export function doneText(doneOn, today) {
  const days = daysBetween(doneOn, today);
  if (days === 0) return 'Done today';
  if (days === 1) return 'Done yesterday';
  return `Done ${formatDate(doneOn)}`;
}

/** Whole percent, rounded down so that only a finished goal reads 100%; the inner rounding absorbs float noise. */
export function percent(fraction) {
  return `${Math.floor(Math.round(fraction * 10_000) / 100)}%`;
}

export { plural };
