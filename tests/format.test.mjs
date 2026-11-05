import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { doneText, dueText, formatDate, formatDayMonth, percent, targetText, weekdayDate } from '../js/format.js';

const TODAY = '2026-11-05';

describe('dates for people', () => {
  it('writes dates the Swiss way', () => {
    assert.equal(formatDate('2026-11-05'), '05.11.2026');
    assert.equal(formatDayMonth('2026-11-05'), '05.11.');
    assert.equal(weekdayDate('2026-11-05'), 'Thursday, 05.11.2026');
  });
});

describe('dueText', () => {
  it('counts down to a due date in the coming week', () => {
    assert.equal(dueText('2026-11-05', TODAY), 'Due today');
    assert.equal(dueText('2026-11-06', TODAY), 'Due tomorrow');
    assert.equal(dueText('2026-11-12', TODAY), 'Due in 7 days');
  });

  it('shows the date when it is further away', () => {
    assert.equal(dueText('2026-11-13', TODAY), 'Due 13.11.2026');
  });

  it('words a passed due date neutrally', () => {
    assert.equal(dueText('2026-11-04', TODAY), 'Was due yesterday');
    assert.equal(dueText('2026-11-01', TODAY), 'Was due 01.11.2026');
  });
});

describe('targetText', () => {
  it('counts the days left to the target date', () => {
    assert.equal(targetText('2027-01-29', TODAY), '85 days left');
    assert.equal(targetText('2026-11-06', TODAY), '1 day left');
    assert.equal(targetText('2026-11-05', TODAY), 'Target date is today');
  });

  it('words a passed target date neutrally', () => {
    assert.equal(targetText('2026-11-01', TODAY), 'Target date was 01.11.2026');
  });
});

describe('doneText', () => {
  it('says when a step was done', () => {
    assert.equal(doneText('2026-11-05', TODAY), 'Done today');
    assert.equal(doneText('2026-11-04', TODAY), 'Done yesterday');
    assert.equal(doneText('2026-10-30', TODAY), 'Done 30.10.2026');
  });
});

describe('percent', () => {
  it('rounds down, so only a finished goal shows 100%', () => {
    assert.equal(percent(0), '0%');
    assert.equal(percent(0.29), '29%');
    assert.equal(percent(2 / 3), '66%');
    assert.equal(percent(499 / 500), '99%');
    assert.equal(percent(1), '100%');
  });
});
