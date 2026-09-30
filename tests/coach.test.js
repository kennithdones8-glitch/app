import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreSession, detectPatterns, updateMemory, emptyMemory, feedback, suggestWorkout,
  nextCombo, comboToSpeech, weekSummary, pickFocus,
} from '../web/js/coach.js';

function session(over = {}) {
  return {
    id: Math.random().toString(36),
    date: '2026-09-01T18:00:00.000Z',
    type: 'shadow',
    plan: { rounds: 3, roundSec: 120, restSec: 60 },
    completedRounds: 3,
    workSec: 360,
    punches: { total: 240, perRound: [80, 80, 80], byType: null },
    form: {
      guard: 90, stance: 90, blade: 85, footwork: 50, head: 45, handReturnMs: 400,
      crossedPct: 0, narrowPct: 0, widePct: 0, rearDropPct: 5,
      perRound: [{ frames: 100, guard: 92 }, { frames: 100, guard: 90 }, { frames: 100, guard: 88 }],
    },
    rpe: 6,
    ...over,
  };
}

const sloppy = (over = {}) => session({
  punches: { total: 150, perRound: [70, 50, 30], byType: null },
  form: {
    guard: 55, stance: 60, blade: 40, footwork: 15, head: 10, handReturnMs: 800,
    crossedPct: 12, narrowPct: 5, widePct: 0, rearDropPct: 40,
    perRound: [{ frames: 100, guard: 75 }, { frames: 100, guard: 55 }, { frames: 100, guard: 35 }],
  },
  ...over,
});

test('scoreSession produces 0-100 scores and an overall', () => {
  const s = scoreSession(session(), { level: 'beginner' });
  assert.equal(s.guard, 90);
  assert.equal(s.output, 100); // 40 ppm vs 40 target
  assert.equal(s.handReturn, 93);
  assert.ok(s.overall > 70 && s.overall <= 100);
  const other = scoreSession({ type: 'run', workSec: 1800 });
  assert.equal(other.overall, null);
});

test('detectPatterns finds the habits in a sloppy session', () => {
  const found = detectPatterns(sloppy());
  for (const k of ['lateGuardFade', 'rearDrop', 'crossFeet', 'squared', 'flatFeet', 'staticHead', 'slowReturn', 'outputFade']) {
    assert.ok(found.includes(k), k);
  }
  assert.deepEqual(detectPatterns(session()), []);
});

test('memory confirms a habit on the 2nd sighting and resolves it after 4 clean sessions', () => {
  let mem = emptyMemory();
  let r = updateMemory(mem, sloppy({ date: '2026-09-01T18:00:00Z' }));
  assert.equal(r.events.confirmed.length, 0);
  r = updateMemory(r.memory, sloppy({ date: '2026-09-02T18:00:00Z' }));
  assert.ok(r.events.confirmed.includes('crossFeet'));
  assert.equal(r.memory.insights.crossFeet.count, 2);
  assert.equal(r.memory.streak.count, 2);
  mem = r.memory;
  for (let d = 3; d <= 6; d++) {
    r = updateMemory(mem, session({ date: `2026-09-0${d}T18:00:00Z` }));
    mem = r.memory;
  }
  assert.ok(r.events.resolved.includes('crossFeet'));
  assert.equal(mem.insights.crossFeet, undefined);
  assert.ok(mem.resolved.some((x) => x.key === 'crossFeet'));
});

test('memory tracks personal records and focus on the weakest area', () => {
  let r = updateMemory(emptyMemory(), sloppy());
  assert.equal(r.memory.prs.mostPunches.value, 150);
  assert.ok(r.memory.focus);
  r = updateMemory(r.memory, session({ date: '2026-09-02T18:00:00Z' }));
  assert.ok(r.events.newPRs.includes('Most punches in a session'));
});

test('focus sticks while below target, then moves on', () => {
  const mem = { ...emptyMemory(), ema: { guard: 50, stance: 90 } };
  const f1 = pickFocus(mem);
  assert.equal(f1.area, 'guard');
  const f2 = pickFocus({ ...mem, focus: f1 });
  assert.equal(f2.sessions, 2);
  const fixed = pickFocus({ ...mem, ema: { guard: 95, stance: 70 }, focus: f2 });
  assert.equal(fixed.area, 'stance');
});

test('feedback gives wins, fixes and drills', () => {
  const mem = updateMemory(updateMemory(emptyMemory(), sloppy()).memory, sloppy()).memory;
  const fb = feedback(sloppy(), [session({ scores: scoreSession(session()) })], mem);
  assert.ok(fb.fixes.length > 0);
  assert.ok(fb.fixes.some((f) => f.startsWith('Recurring:')));
  assert.ok(fb.drills.length > 0);
  assert.ok(fb.wins.length > 0);
  const run = feedback({ type: 'run', durationMin: 30 }, [], mem);
  assert.match(run.wins[0], /30 min/);
});

test('suggestWorkout progresses rounds and backs off after a brutal session', () => {
  const now = new Date('2026-09-02T18:00:00Z');
  const easy = [session({ date: '2026-09-01T10:00:00Z', rpe: 6 })];
  assert.equal(suggestWorkout(easy, emptyMemory(), {}, now).rounds, 4);
  const hard = [session({ date: '2026-09-02T10:00:00Z', rpe: 10 })];
  const s = suggestWorkout(hard, emptyMemory(), {}, now);
  assert.equal(s.rounds, 3);
  assert.match(s.reason, /recover/);
  const unfinished = [session({ date: '2026-09-01T10:00:00Z', plan: { rounds: 6, roundSec: 180, restSec: 60 }, completedRounds: 4 })];
  assert.equal(suggestWorkout(unfinished, emptyMemory(), {}, now).rounds, 4);
});

test('combos use the level and speak punch names', () => {
  const c = nextCombo(1, null, () => 0);
  assert.equal(c, '1');
  assert.equal(comboToSpeech('1, 2, 3'), 'jab, cross, hook');
  const withFocus = nextCombo(1, 'head', () => 0.1);
  assert.match(withFocus, /slip|roll/);
});

test('weekSummary counts this week only', () => {
  const now = new Date('2026-09-03T12:00:00'); // Thursday
  const h = [
    session({ date: new Date('2026-08-30T12:00:00').toISOString() }), // previous Sunday
    session({ date: new Date('2026-09-01T12:00:00').toISOString() }),
    { type: 'run', date: new Date('2026-09-02T12:00:00').toISOString(), durationMin: 30 },
  ];
  const w = weekSummary(h, now);
  assert.equal(w.sessions, 2);
  assert.equal(w.days, 2);
  assert.equal(w.punches, 240);
  assert.equal(w.minutes, 36);
});

test('a back-dated session does not reset the streak', async () => {
  const { updateMemory, emptyMemory } = await import('../web/js/coach.js');
  let mem = emptyMemory();
  const at = (d) => ({ id: d, date: `${d}T18:00:00`, type: 'run', durationMin: 30, rpe: 6 });
  for (const d of ['2026-09-27', '2026-09-28', '2026-09-29']) mem = updateMemory(mem, at(d)).memory;
  assert.equal(mem.streak.count, 3);
  mem = updateMemory(mem, at('2026-09-23')).memory; // an old video analysed today
  assert.equal(mem.streak.count, 3);
  assert.equal(mem.streak.lastDay, '2026-09-29');
  mem = updateMemory(mem, at('2026-09-30')).memory;
  assert.equal(mem.streak.count, 4);
});

test('pad work and drilled combos do not produce punch-mix habits', async () => {
  const { detectPatterns } = await import('../web/js/coach.js');
  const by = { jab: 4, cross: 40, leadHook: 30, rearHook: 0, leadUppercut: 0, rearUppercut: 6 };
  assert.ok(detectPatterns({ type: 'bag', punches: { byType: by } }).includes('lightJab'));
  assert.ok(!detectPatterns({ type: 'mitts', punches: { byType: by } }).includes('lightJab'));
  assert.ok(!detectPatterns({ type: 'shadow', calib: { labels: '12..' }, punches: { byType: by } }).includes('lightJab'));
});
