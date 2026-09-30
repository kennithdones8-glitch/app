import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeek, planStatus, rebalance, weightStats, phaseFor, weekKey, weekCompletion } from '../web/js/plan.js';

const profile = { goal: 'compete', level: 'advanced', weeklyGoal: 6, fight: { rounds: 6, roundSec: 180, restSec: 60 }, unit: 'kg' };
const monday = new Date('2026-09-28T09:00:00'); // a Monday

const kindsByDay = (plan) => Array.from({ length: 7 }, (_, d) => plan.items.filter((i) => i.day === d).map((i) => i.kind));

test('week keys start on Monday', () => {
  assert.equal(weekKey(new Date('2026-10-04T20:00:00')), '2026-09-28'); // Sunday
  assert.equal(weekKey(monday), '2026-09-28');
});

test('builds a 6-day week around gym days with no back-to-back hard days where avoidable', () => {
  const plan = buildWeek({ profile, gymDays: [1, 3], now: monday }); // Tue, Thu
  const days = kindsByDay(plan);
  assert.deepEqual(days[1], ['gym']);
  assert.deepEqual(days[3], ['gym']);
  assert.equal(plan.items.filter((i) => i.kind === 'rest').length, 1);
  assert.ok(plan.items.some((i) => i.kind === 'fightSim'), 'has a fight sim');
  const fs = plan.items.find((i) => i.kind === 'fightSim');
  assert.equal(fs.preset.rounds, 6);
  assert.equal(fs.preset.roundSec, 180);
  // No free-day hard session sits right next to a gym day.
  for (const it of plan.items.filter((i) => i.load === 'hard' && i.kind !== 'gym')) {
    assert.ok(![1, 3].includes(it.day - 1) && ![1, 3].includes(it.day + 1), `${it.kind} on day ${it.day} is next to a gym day`);
  }
});

test('many gym days pushes bag volume down the list and all days still get a plan', () => {
  const plan = buildWeek({ profile, gymDays: [0, 2, 4, 5], now: monday });
  assert.equal(new Set(plan.items.map((i) => i.day)).size, 7);
  assert.ok(!plan.items.some((i) => i.kind === 'bagVolume'));
});

test('backs off when effort has been very high', () => {
  const sessions = [1, 2, 3].map((d) => ({ id: `s${d}`, type: 'bag', date: new Date(2026, 8, 24 + d, 18).toISOString(), rpe: 9 }));
  const plan = buildWeek({ profile, sessions, gymDays: [1], now: monday });
  assert.ok(plan.notes.some((n) => /effort/.test(n)));
  const hard = plan.items.filter((i) => i.load === 'hard' && i.kind !== 'gym').length;
  const normal = buildWeek({ profile, gymDays: [1], now: monday }).items.filter((i) => i.load === 'hard' && i.kind !== 'gym').length;
  assert.ok(hard < normal);
});

test('trims volume after a poor completion week', () => {
  const plan = buildWeek({ profile, gymDays: [], lastWeek: { planned: 6, done: 2 }, now: monday });
  assert.equal(plan.items.find((i) => i.kind === 'fightSim').preset.rounds, 5);
});

test('phases follow the fight date', () => {
  assert.equal(phaseFor(profile, monday).key, 'base');
  assert.equal(phaseFor({ fightDate: '2026-11-09' }, monday).key, 'camp');
  assert.equal(phaseFor({ fightDate: '2026-10-05' }, monday).key, 'taper');
  const taper = buildWeek({ profile: { ...profile, fightDate: '2026-10-05' }, gymDays: [], now: monday });
  assert.ok(!taper.items.some((i) => i.kind === 'intervals' || i.kind === 'bagVolume'));
});

test('status matches logged sessions and rebalance moves missed key work later', () => {
  const plan = buildWeek({ profile, gymDays: [1, 3], now: monday });
  const monItem = plan.items.find((i) => i.day === 0);
  const wed = new Date('2026-09-30T08:00:00');
  // Nothing logged Monday → Monday's key session is missed on Wednesday.
  let st = planStatus(plan, [], wed);
  assert.equal(st[monItem.id], 'missed');
  // A gym session on Tuesday counts as done.
  const tueGym = plan.items.find((i) => i.day === 1);
  st = planStatus(plan, [{ id: 'g', type: 'sparring', date: new Date('2026-09-29T19:00:00').toISOString() }], wed);
  assert.equal(st[tueGym.id], 'done');

  const { plan: moved, moves } = rebalance(plan, [], wed);
  if (['fightSim', 'intervals', 'bagVolume', 'shadowTech'].includes(monItem.kind)) {
    assert.equal(moves.length >= 1, true);
    const relocated = moved.items.find((i) => i.kind === monItem.kind && i.rescheduled);
    assert.ok(relocated.date >= '2026-09-30');
    assert.equal(planStatus(moved, [], wed)[monItem.id], 'moved');
  }
  const c = weekCompletion(moved, [], wed);
  assert.ok(c.planned >= 5);
});

test('weight stats: trend, target and too-fast warning', () => {
  const w = (date, value) => ({ date, value });
  const now = new Date('2026-09-28T09:00:00');
  const steady = [w('2026-09-16', 80), w('2026-09-18', 80.2), w('2026-09-23', 80.1), w('2026-09-26', 80.2)];
  const s1 = weightStats(steady, { targetWeight: 76.2, unit: 'kg' }, now);
  assert.equal(s1.status, 'behind');
  const fast = [w('2026-09-16', 80), w('2026-09-18', 80), w('2026-09-23', 78.5), w('2026-09-26', 78.3)];
  assert.equal(weightStats(fast, { targetWeight: 76.2 }, now).status, 'fast');
  const good = [w('2026-09-16', 80), w('2026-09-23', 79.5)];
  assert.equal(weightStats(good, { targetWeight: 76.2 }, now).status, 'ontrack');
  assert.equal(weightStats([], {}, now), null);
  // Behind on weight adds an extra easy run.
  const plan = buildWeek({ profile: { ...profile, targetWeight: 76.2 }, weights: steady, gymDays: [1], now });
  assert.equal(plan.items.filter((i) => i.kind === 'easyRun').length >= 1, true);
  assert.ok(plan.notes.some((n) => /Weight/.test(n)));
});

test('mid-week plans schedule from today and keep past days on rebuild', () => {
  const wed = new Date('2026-09-30T08:00:00');
  const plan = buildWeek({ profile, gymDays: [3], now: wed, fromDay: 2 });
  assert.equal(plan.items.filter((i) => i.day < 2).length, 0);
  assert.deepEqual(planStatus(plan, [], wed)[plan.items[0].id] === 'missed', false);
  // Training days still add up to the weekly goal minus what can't be scheduled.
  assert.equal(new Set(plan.items.filter((i) => i.kind !== 'rest').map((i) => i.day)).size, 5);

  const full = buildWeek({ profile, gymDays: [1], now: monday });
  const rebuilt = buildWeek({ profile, gymDays: [1, 4], now: wed, fromDay: 2, keep: full.items });
  const monKept = full.items.find((i) => i.day === 0);
  assert.ok(rebuilt.items.some((i) => i.id === monKept.id), 'Monday kept');
  assert.ok(rebuilt.items.some((i) => i.day === 1 && i.kind === 'gym'));
  // A kind already done earlier in the week isn't scheduled again.
  const counts = {};
  for (const i of rebuilt.items) counts[i.kind] = (counts[i.kind] || 0) + 1;
  assert.ok((counts.fightSim || 0) <= 1);
});

test('after the fight date the app leaves fight-week mode', async () => {
  const { phaseFor } = await import('../web/js/plan.js');
  const now = new Date('2026-10-08T12:00:00'); // Thursday
  assert.equal(phaseFor({ fightDate: '2026-10-06' }, now).key, 'base', 'fight was Tuesday');
  assert.equal(phaseFor({ fightDate: '2026-10-08' }, now).key, 'taper', 'fight day itself');
  assert.equal(phaseFor({ fightDate: '2026-10-10' }, now).key, 'taper');
});
