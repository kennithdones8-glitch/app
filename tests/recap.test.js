import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyRecap } from '../web/js/recap.js';

const s = (date, form, extra = {}) => ({ date, type: 'shadow', workSec: 600, totalSec: 900, punches: { total: 500 }, form, ...extra });

test('weekly recap: last week totals, the biggest gain and the biggest slip against the week before', () => {
  const now = new Date('2026-10-05T09:00:00'); // a Monday
  const sessions = [
    s('2026-09-22T18:00:00', { guard: 60, head: 30, handReturnMs: 300 }), // week before last
    s('2026-09-24T18:00:00', { guard: 64, head: 34, handReturnMs: 280 }),
    s('2026-09-29T18:00:00', { guard: 72, head: 25, handReturnMs: 285 }), // last week
    s('2026-10-02T18:00:00', { guard: 76, head: 23, handReturnMs: 295 }),
    s('2026-10-05T07:00:00', { guard: 10 }), // this week: not part of the recap
  ];
  const r = weeklyRecap(sessions, now);
  assert.equal(r.weekOf.slice(0, 10) <= '2026-09-29', true);
  assert.equal(r.sessions, 2);
  assert.equal(r.days, 2);
  assert.equal(r.minutes, 30);
  assert.equal(r.punches, 1000);
  assert.deepEqual([r.best.key, r.best.from, r.best.to], ['guard', 62, 74]);
  assert.deepEqual([r.worst.key, r.worst.from, r.worst.to], ['head', 32, 24]);
  assert.equal(r.best.get, undefined);
});

test('no recap without sessions last week; small wobbles are not called changes', () => {
  assert.equal(weeklyRecap([s('2026-09-01T10:00:00', { guard: 70 })], new Date('2026-10-05T09:00:00')), null);
  const r = weeklyRecap([s('2026-09-23T10:00:00', { guard: 70 }), s('2026-09-30T10:00:00', { guard: 71 })], new Date('2026-10-05T09:00:00'));
  assert.equal(r.best, null);
  assert.equal(r.worst, null);
});
