import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  addDays,
  daysBetween,
  fromDayNumber,
  isLocalDate,
  isoWeekday,
  localDateOf,
  toDayNumber,
} from '../js/dates.js';

describe('day numbers', () => {
  it('counts days from 1970-01-01', () => {
    assert.equal(toDayNumber('1970-01-01'), 0);
    assert.equal(toDayNumber('2000-03-01'), 11017);
    assert.equal(toDayNumber('1969-12-31'), -1);
  });

  it('round-trips every day across leap years and centuries', () => {
    for (let day = toDayNumber('1899-12-25'); day <= toDayNumber('2101-01-05'); day += 1) {
      assert.equal(toDayNumber(fromDayNumber(day)), day);
    }
  });

  it('refuses dates that do not exist', () => {
    assert.throws(() => toDayNumber('2026-02-29'), RangeError);
    assert.throws(() => toDayNumber('2026-13-01'), RangeError);
    assert.throws(() => toDayNumber('2026-11-5'), RangeError);
  });
});

describe('calendar arithmetic', () => {
  it('adds days across months, leap days and years', () => {
    assert.equal(addDays('2024-02-28', 1), '2024-02-29');
    assert.equal(addDays('2023-02-28', 1), '2023-03-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-11-05', -5), '2026-10-31');
  });

  it('measures days between two dates, negative when the second comes first', () => {
    assert.equal(daysBetween('2026-11-05', '2026-12-13'), 38);
    assert.equal(daysBetween('2026-12-13', '2026-11-05'), -38);
    assert.equal(daysBetween('2026-11-05', '2026-11-05'), 0);
  });

  it('names the ISO weekday, Monday = 1', () => {
    assert.equal(isoWeekday('2026-11-05'), 4);
    assert.equal(isoWeekday('2026-11-09'), 1);
    assert.equal(isoWeekday('2026-11-08'), 7);
  });
});

describe('isLocalDate', () => {
  it('accepts real calendar dates', () => {
    assert.equal(isLocalDate('2026-11-05'), true);
    assert.equal(isLocalDate('2024-02-29'), true);
  });

  it('rejects anything else', () => {
    for (const value of ['2026-02-29', '2026-00-10', '26-11-05', '2026-11-05T10:00', '', ' 2026-11-05', null, undefined, 20261105, {}]) {
      assert.equal(isLocalDate(value), false, String(value));
    }
  });
});

describe('localDateOf', () => {
  it('reads the calendar date of the phone, not of UTC', () => {
    assert.equal(localDateOf(new Date(2026, 10, 5, 23, 59)), '2026-11-05');
    assert.equal(localDateOf(new Date(2026, 10, 6, 0, 1)), '2026-11-06');
  });
});
