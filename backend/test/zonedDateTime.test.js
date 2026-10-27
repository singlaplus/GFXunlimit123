const test = require('node:test');
const assert = require('node:assert/strict');
const { getZonedDateKey, getZonedTimeKey } = require('../utils/zonedDateTime');

const INDIA_TIME_ZONE = 'Asia/Kolkata';

test('formats daily report date and time using IST across UTC midnight', () => {
  const now = new Date('2026-10-27T18:00:00.000Z');

  assert.equal(getZonedDateKey(now, INDIA_TIME_ZONE), '2026-10-27');
  assert.equal(getZonedTimeKey(now, INDIA_TIME_ZONE), '23:30');
});

test('formats the next IST calendar day when UTC has not reached midnight', () => {
  const now = new Date('2026-10-27T20:00:00.000Z');

  assert.equal(getZonedDateKey(now, INDIA_TIME_ZONE), '2026-10-28');
  assert.equal(getZonedTimeKey(now, INDIA_TIME_ZONE), '01:30');
});
