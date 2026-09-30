import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectWeaknesses, buildCoachSession, evaluateCoached, applyEvaluation, adjustNextRound, adoption,
  metricOf, drillFor, benchmarkDue, benchmarkResults, ROOTS, BENCHMARK,
} from '../web/js/coachme.js';

const now = new Date('2026-10-10T12:00:00Z');
const daysAgo = (d) => new Date(+now - d * 86400000).toISOString();
// A camera session with per-round form (guard by round) and a few overall numbers.
function cam(d, { guard = [85, 85, 85], footwork = 40, headPerMin = 18, stance = 85, overall = 70, extra = {} } = {}) {
  const perRound = guard.map((g) => ({ frames: 200, guard: g }));
  return {
    date: daysAgo(d), type: 'shadow', tracking: 'camera', source: 'live',
    form: { perRound, guard: Math.round(guard.reduce((a, b) => a + b, 0) / guard.length), footwork, headPerMin, stance, sequences: { '1-2': 4, '2-3': 3, '3-2': 3 } },
    scores: { overall }, workSec: 540, ...extra,
  };
}
const ctx0 = { hits: { total: 0, shares: [] }, decay: [], recovery: { status: 'normal', reasons: [] } };

test('finds the root behind the symptoms, and needs real evidence', () => {
  const state = {
    sessions: [cam(6, { footwork: 15 }), cam(4, { footwork: 18 }), cam(2, { footwork: 12 })],
    memory: { insights: { squared: { count: 3 } } },
  };
  const ctx = { ...ctx0, hits: { total: 12, shares: [{ key: 'failedExit', pct: 45 }] } };
  const w = detectWeaknesses(state, ctx, now);
  assert.equal(w[0].key, 'squareAfter');
  assert.match(w[0].explain, /Getting hit from failed exit .* isn't the root problem; you stay square after your combinations/i);
  assert.ok(w[0].sources >= 3, 'hits, habit and measurements all point at it');
  // One mild measurement on its own is not a weakness.
  assert.deepEqual(detectWeaknesses({ sessions: [cam(3, { footwork: 23 }), cam(1)], memory: { insights: {} } }, ctx0, now), []);
});

test('a coach override removes a root the coach disagrees with', () => {
  const state = { sessions: [cam(4, { footwork: 10 }), cam(2, { footwork: 10 })], memory: { insights: { flatFeet: { count: 4 } } } };
  assert.ok(detectWeaknesses(state, ctx0, now).some((w) => w.key === 'flatFeet'));
  state.coach = { overrides: [{ key: 'root:flatFeet', note: 'Planted on purpose for this drill', date: daysAgo(1) }] };
  assert.ok(!detectWeaknesses(state, ctx0, now).some((w) => w.key === 'flatFeet'));
});

test('session fits the time, the equipment and how you feel', () => {
  const state = { sessions: [cam(3, { guard: [70, 62, 55] }), cam(1, { guard: [72, 64, 58] })], memory: { insights: { rearDrop: { count: 3 } } } };
  const s15 = buildCoachSession({ state, ctx: ctx0, minutes: 15, equipment: [], feel: 'good', now });
  const s60 = buildCoachSession({ state, ctx: ctx0, minutes: 60, equipment: ['bag', 'rope'], feel: 'great', now });
  assert.ok(s15.minutes <= 16 && s60.minutes <= 61 && s60.minutes >= 45, `${s15.minutes} / ${s60.minutes} min`);
  assert.equal(s15.live.type, 'shadow');
  assert.equal(s60.live.type, 'bag');
  assert.ok(s60.live.rounds > s15.live.rounds);
  assert.ok(s60.blocks.some((b) => b.name === 'Rope intervals'), 'rope conditioning with a rope');
  assert.ok(!s15.blocks.some((b) => b.kind === 'conditioning'), 'no conditioning block in 15 minutes');
  const drill = s15.blocks.find((b) => b.kind === 'drill');
  assert.ok(drill.purpose && drill.success && drill.progression && drill.regression);
  assert.match(s15.headline, /^Today we're working on/);
  // Tired: less volume and no all-out last round.
  const tired = buildCoachSession({ state, ctx: ctx0, minutes: 60, equipment: ['bag'], feel: 'tired', now });
  assert.ok(tired.live.rounds < s60.live.rounds);
  assert.ok(!tired.live.rounds_.some((r) => r.constraint === 'fatigueSim'));
  // Even when the root problem is fatigue, a tired day gets no all-out bursts.
  const gas = { sessions: [cam(3, { guard: [88, 75, 60] }), cam(1, { guard: [86, 72, 58] })], memory: { insights: { outputFade: { count: 3 } } } };
  const g = buildCoachSession({ state: gas, ctx: ctx0, minutes: 30, equipment: [], feel: 'tired', now });
  assert.equal(g.top.key, 'gasTank');
  assert.ok(!g.live.rounds_.some((r) => r.constraint === 'fatigueSim'), g.live.rounds_.map((r) => r.constraint).join());
  assert.ok(tired.adjust.some((a) => /tired/.test(a)));
});

test('cuts intensity when technical quality drops, and eases back in after a break', () => {
  const drop = { sessions: [70, 72, 71, 70, 69, 60, 58, 57].map((o, i) => cam(20 - i * 2, { overall: o })), memory: { insights: {} } };
  const s = buildCoachSession({ state: drop, ctx: ctx0, minutes: 45, now });
  assert.ok(s.adjust.some((a) => /quality dropped \d+ points/.test(a) && /30%/.test(a)), s.adjust.join(' | '));
  const gap = { sessions: [cam(9)], memory: { insights: {} } };
  assert.ok(buildCoachSession({ state: gap, ctx: ctx0, minutes: 45, now }).adjust.some((a) => /First session in 9 days/.test(a)));
});

test('drill ladder: two passes move up, two misses move down, unmeasured changes nothing', () => {
  const coach = { root: 'handsHome', level: 1 };
  const good = cam(0, { guard: [80, 80, 80] }), bad = cam(0, { guard: [50, 50, 50] });
  const e1 = evaluateCoached(good, coach);
  assert.equal(e1.pass, true);
  let c = applyEvaluation({}, e1, daysAgo(2));
  assert.equal(c.levels.handsHome.level, 1);
  c = applyEvaluation(c, evaluateCoached(good, coach), daysAgo(1));
  assert.equal(c.levels.handsHome.level, 2);
  assert.equal(c.assigned.handsHome, daysAgo(2));
  const coach2 = { root: 'handsHome', level: 2 };
  c = applyEvaluation(c, evaluateCoached(bad, coach2));
  c = applyEvaluation(c, evaluateCoached(bad, coach2));
  assert.equal(c.levels.handsHome.level, 1);
  const noCam = { date: daysAgo(0), type: 'shadow', tracking: 'none' };
  const e = evaluateCoached(noCam, coach);
  assert.equal(e.pass, null);
  assert.deepEqual(applyEvaluation(c, e).levels, c.levels);
  assert.equal(drillFor('handsHome', 4).progression, 'Top level: keep it here and add pace.');
});

test('live adjuster: switch when fatigue wrecks form, simplify when struggling, progress when clean', () => {
  const coach = { root: 'handsHome', level: 2, metric: 'guard', finisher: 'hands home' };
  const first = { frames: 200, guard: 85 };
  assert.equal(adjustNextRound({ form: { frames: 200, guard: 65 }, first, coach }).action, 'switch');
  const calls = [['1-2', 'miss'], ['1-2-3', 'miss'], ['1-2', 'exact'], ['2-3', 'miss']];
  const simp = adjustNextRound({ form: { frames: 200, guard: 84 }, first, calls, coach, comboLevel: 3 });
  assert.equal(simp.action, 'simplify');
  assert.equal(simp.maxLen, 2);
  assert.deepEqual([simp.why.exact, simp.why.called], [1, 4]);
  assert.ok(simp.say.split(' ').length <= 8, `short: "${simp.say}"`);
  const clean = adjustNextRound({ form: { frames: 200, guard: 86 }, first, calls: calls.map((c) => [c[0], 'exact']), coach, comboLevel: 2 });
  assert.equal(clean.action, 'progress');
  assert.equal(clean.comboLevel, 3);
});

test('"do this, not that" adoption compares before and after the fix was assigned', () => {
  const state = {
    sessions: [cam(20, { guard: [60, 60, 60] }), cam(15, { guard: [62, 62, 62] }), cam(5, { guard: [75, 75, 75] }), cam(2, { guard: [80, 80, 80] })],
    coach: { assigned: { handsHome: daysAgo(10) } },
  };
  const a = adoption(state, 'handsHome', now);
  assert.equal(a.status, 'taking');
  assert.match(a.text, /Guard up: 61% → 78% over 2 sessions, taking hold/);
  assert.equal(adoption({ sessions: [], coach: {} }, 'handsHome', now), null);
});

test('metrics: guard fade and predictable openers', () => {
  const s = cam(0, { guard: [88, 80, 70] });
  assert.equal(metricOf(s, 'guardFade'), 18);
  s.form.sequences = { '1-2': 8, '1-2-3': 4, '3-2': 2 };
  assert.equal(metricOf(s, 'opener'), 86);
  assert.equal(metricOf({ ...s, tracking: 'none', source: 'live' }, 'guard'), null);
  for (const r of Object.values(ROOTS)) assert.equal(r.ladder.length, 4);
});

test('benchmark every 4 weeks, compared with the first and the last one', () => {
  const b1 = { ...cam(40, { guard: [70, 70, 70] }), benchmark: true };
  const b2 = { ...cam(10, { guard: [82, 82, 82] }), benchmark: true };
  assert.equal(benchmarkDue([b1], now), true);
  assert.equal(benchmarkDue([b1, b2], now), false);
  const r = benchmarkResults([b1, cam(20), b2]);
  assert.equal(r.first.guard, 70);
  assert.equal(r.latest.guard, 82);
  assert.equal(BENCHMARK.rounds_.length, BENCHMARK.rounds);
});

test('combos built on what you already throw, with the fix for your root problem', async () => {
  const { personalCombos } = await import('../web/js/coachme.js');
  const { parseCombo, comboText } = await import('../web/js/combos.js');
  const state = { sessions: [cam(2), cam(1)], combos: [{ tokens: parseCombo('1-2 slip 2') }] };
  state.sessions[1].form.sequences = { '1-2': 9, '2-3': 3 };
  const out = personalCombos(state, [{ key: 'squareAfter' }, { key: 'staticHead' }, { key: 'predictable' }], parseCombo, comboText);
  assert.deepEqual(out.map((o) => comboText(o.tokens)), ['1-2 pivot', 'feint 3b-3'], 'the slip one is already saved');
  assert.match(out[0].why, /1-2 ends square/);
});

test('beginner answers become settings', async () => {
  const { applyOnboarding } = await import('../web/js/coachme.js');
  const p = applyOnboarding({ goal: 'compete', level: 'advanced', stance: 'orthodox', weeklyGoal: 6 }, { want: 'fitness', experience: 'new', hand: 'left', days: '3' });
  assert.deepEqual(p, { goal: 'fitness', level: 'beginner', stance: 'southpaw', weeklyGoal: 3, onboarded: true });
});
