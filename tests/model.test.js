import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fatigueMap, decayFindings, medAnalysis, hitAnalysis, transferScores, opponentExposure } from '../web/js/analysis.js';
import { extractEvidence, skillReport, proofOfImprovement, styleProfile, developmentTimeline, compareThen } from '../web/js/skills.js';
import { recoveryStatus, readinessOf, sessionLoad } from '../web/js/recovery.js';
import { proposeHypotheses, startHypothesis, evaluateHypothesis, stepHypothesis } from '../web/js/hypotheses.js';
import { buildContext, rankProblems, priorities, generateRounds, trainToday, aiObservations, memoryTrace } from '../web/js/engine.js';
import { phaseFor } from '../web/js/plan.js';
import { emptyMemory } from '../web/js/coach.js';

const profile = { stance: 'orthodox', level: 'advanced', fight: { rounds: 6, roundSec: 180, restSec: 60 } };
const NOW = new Date('2026-09-28T12:00:00Z');
const daysAgo = (n) => new Date(+NOW - n * 86400000).toISOString();

// A camera round. Later rounds can be made worse to simulate fatigue.
function round(o = {}) {
  const jab = o.jab ?? 40;
  return {
    frames: 300, guard: 90, stance: 85, blade: 80, footwork: 50, head: 40,
    handReturnMs: 400, leadReturnMs: 380, rearReturnMs: 420, rearDropPct: 10,
    totalPunches: o.total ?? 150, punches: { jab, cross: 40, leadHook: 20, rearHook: 20, leadUppercut: 10, rearUppercut: 10 },
    comboShare: 60, avgComboLen: 2.4, sequences: { '1-2': 10 },
    ...o,
  };
}

function camSession(date, rounds, extra = {}) {
  const perRound = rounds;
  const sum = (k) => perRound.reduce((a, r) => a + (r[k] || 0), 0);
  const avg = (k) => Math.round(perRound.reduce((a, r) => a + r[k], 0) / perRound.length);
  const punches = {};
  for (const r of perRound) for (const [k, v] of Object.entries(r.punches)) punches[k] = (punches[k] || 0) + v;
  return {
    id: `s-${date}`, date, type: 'shadow', tracking: 'camera',
    plan: { rounds: perRound.length, roundSec: 180, restSec: 60 }, completedRounds: perRound.length,
    workSec: perRound.length * 180, rpe: 7,
    punches: { total: sum('totalPunches'), perRound: perRound.map((r) => r.totalPunches), byType: punches },
    form: {
      perRound, guard: avg('guard'), stance: avg('stance'), blade: avg('blade'), footwork: avg('footwork'), head: avg('head'),
      handReturnMs: avg('handReturnMs'), leadReturnMs: avg('leadReturnMs'), rearReturnMs: avg('rearReturnMs'), rearDropPct: avg('rearDropPct'),
      crossedPct: 0, punches, totalPunches: sum('totalPunches'), comboShare: 60, avgComboLen: 2.4, sequences: { '1-2': 30 },
    },
    scores: { overall: 75 },
    ...extra,
  };
}

// Defense falls apart from round 4 while pace holds.
const fading = (date) => camSession(date, [
  round(), round(), round({ guard: 86 }),
  round({ guard: 60, head: 15, leadReturnMs: 800 }),
  round({ guard: 52, head: 10, leadReturnMs: 900 }),
]);

test('fatigue map spots defense breaking before pace', () => {
  const fm = fatigueMap(fading(daysAgo(1)), profile);
  assert.equal(fm.rows.length, 5);
  assert.equal(fm.firstBreak, 'defense');
  assert.equal(fm.breaks.defense, 4);
  assert.match(fm.conclusion, /Conditioning isn't limiting your output/);
});

test('decay findings separate fatigue from technical weakness', () => {
  const f = decayFindings([fading(daysAgo(5)), fading(daysAgo(3)), fading(daysAgo(1))], profile);
  const d = f.find((x) => x.dim === 'defense');
  assert.equal(d.kind, 'fatigue');
  assert.equal(d.breakRound, 4);
  const lead = f.find((x) => x.dim === 'leadReturn');
  assert.match(lead.text, /left-hand recovery/);
  assert.match(lead.advice, /after conditioning/);

  const weakGuard = (date) => camSession(date, [round({ guard: 40, head: 10 }), round({ guard: 42, head: 10 }), round({ guard: 41, head: 10 })]);
  const t = decayFindings([weakGuard(daysAgo(3)), weakGuard(daysAgo(1))], profile).find((x) => x.dim === 'defense');
  assert.equal(t.kind, 'technical');
});

test('minimum effective dose finds where jab quality drops', () => {
  // Quality holds for the first ~150 jabs, then the lead hand gets slow.
  const s = (date) => camSession(date, [
    round({ jab: 75 }), round({ jab: 75 }),
    round({ jab: 75, leadReturnMs: 900, guard: 70, rearDropPct: 40 }),
    round({ jab: 75, leadReturnMs: 1000, guard: 65, rearDropPct: 45 }),
  ]);
  const med = medAnalysis([s(daysAgo(5)), s(daysAgo(3)), s(daysAgo(1))], 'jab', profile);
  assert.equal(med.threshold, 200);
  assert.match(med.message, /holds up to ~200 reps/);
  assert.match(medAnalysis([s(daysAgo(1))], 'jab').message, /Need 2 more/);
});

test('hit analysis and training transfer', () => {
  const spar = (date, hits, use) => ({ id: `sp-${date}`, date, type: 'sparring', rpe: 8, durationMin: 30, sparring: { rounds: 4, intensity: 4, partnerStyle: 'pressure' }, hits, patternUse: use });
  const sessions = [
    spar(daysAgo(10), { failedExit: 4, handsDown: 2, rhythm: 1 }, { p1: { used: 3, landed: 1 } }),
    spar(daysAgo(3), { failedExit: 3, handsDown: 2, distance: 1 }, { p1: { used: 2, landed: 2 } }),
    { id: 'sh', date: daysAgo(5), type: 'shadow', form: { sequences: { '1-2': 12 } } },
    { id: 'bg', date: daysAgo(4), type: 'bag', patternUse: { p1: { used: 8 } } },
    { id: 'dr', date: daysAgo(6), type: 'mitts', patternUse: { p1: { reps: 85 } } },
  ];
  const h = hitAnalysis(sessions);
  assert.equal(h.top.key, 'failedExit');
  assert.equal(h.top.pct, 54);
  const [t] = transferScores([{ id: 'p1', name: '1-2 exit', seq: '1-2' }], sessions, NOW);
  assert.equal(t.ctx.shadow.uses, 12);
  assert.equal(t.ctx.sparring.used, 5);
  assert.ok(t.transfer > 50 && t.transfer <= 100, `transfer ${t.transfer}`);
  const exp = opponentExposure(sessions, NOW);
  assert.equal(exp.counts.pressure, 8);
});

test('skill ratings come from evidence, with proof of improvement', () => {
  const early = Array.from({ length: 3 }, (_, i) => camSession(daysAgo(55 - i * 2), [round({ guard: 60 }), round({ guard: 60 }), round({ guard: 55 })]));
  const late = Array.from({ length: 3 }, (_, i) => camSession(daysAgo(10 - i * 3), [round({ guard: 92 }), round({ guard: 92 }), round({ guard: 90 })]));
  const state = { profile, sessions: [...early, ...late], observations: [], decisions: [] };
  const report = skillReport(state, NOW);
  const def = report.find((s) => s.key === 'defense');
  assert.ok(def.rating > 60, `defense ${def.rating}`);
  assert.notEqual(def.confidence, 'none');
  const jab = report.find((s) => s.key === 'jab');
  assert.match(jab.summary, /recorded jabs/);
  const proof = proofOfImprovement(state, 'defense', NOW);
  assert.ok(proof.change > 0);
  assert.ok(proof.lines.some((l) => l.label === 'guard up' && l.good));
  // No evidence → prior 50, no confidence.
  assert.equal(report.find((s) => s.key === 'clinch').confidence, 'none');
  // Sparring hits pull the related skills down.
  const hit = { ...state, sessions: [...state.sessions, { id: 'x', date: daysAgo(1), type: 'sparring', sparring: { rounds: 3 }, hits: { failedExit: 6 } }] };
  const angles = (st) => skillReport(st, NOW).find((s) => s.key === 'angles').rating;
  assert.ok(angles(hit) < angles(state) - 5);
  assert.ok(developmentTimeline(state, NOW).length >= 1);
  assert.ok(compareThen(state, NOW).length > 3);
  assert.ok(extractEvidence(state).length > 10);
});

test('style profile discovers tendencies', () => {
  const s = camSession(daysAgo(3), [round({ jab: 70, footwork: 70 }), round({ jab: 70, footwork: 70 }), round({ jab: 70, footwork: 70 })]);
  s.form.footwork = 70;
  const st = styleProfile({ profile, sessions: [s] }, NOW);
  assert.equal(st.traits.find((t) => t.key === 'jab').level, 'High');
  assert.equal(st.traits.find((t) => t.key === 'movement').level, 'High');
  assert.equal(st.lean, 'Out-boxer');
});

test('recovery detects a deload need and scores readiness', () => {
  assert.equal(readinessOf({ sleep: 8, soreness: 1, motivation: 5 }), 100);
  assert.ok(readinessOf({ sleep: 5, soreness: 5, motivation: 1 }) < 40);
  assert.equal(sessionLoad({ durationMin: 30, rpe: 8, type: 'sparring', sparring: { intensity: 5 } }), 300);
  const mk = (d, overall, min) => ({ id: `r${d}`, date: daysAgo(d), type: 'bag', durationMin: min, rpe: 8, scores: { overall } });
  const sessions = [mk(30, 70, 40), mk(25, 80, 40), mk(20, 80, 40), mk(16, 81, 40), mk(12, 80, 40), mk(10, 79, 40), mk(5, 70, 90), mk(3, 68, 90), mk(1, 66, 90)];
  const r = recoveryStatus({ sessions, checkins: [] }, NOW);
  assert.equal(r.status, 'deload');
  assert.match(r.reasons[0], /declining/);
});

test('hypotheses: proposed from evidence, tested, concluded', () => {
  const before = [fading(daysAgo(18)), fading(daysAgo(12)), fading(daysAgo(8))];
  const ctx = { decay: decayFindings(before, profile), hits: { top: null }, memory: emptyMemory(), checkins: [], med: {} };
  const props = proposeHypotheses(ctx, []);
  assert.ok(props.some((p) => p.key === 'fatigueDefense'));
  const h = startHypothesis('fatigueDefense', [], new Date(daysAgo(7)));
  assert.equal(h.n, 1);
  const better = (d) => camSession(d, [round(), round(), round(), round({ guard: 85 }), round({ guard: 82 })]);
  const state = { profile, sessions: [...before, better(daysAgo(6)), better(daysAgo(4)), better(daysAgo(2)), better(daysAgo(1))] };
  const ev = evaluateHypothesis(h, state, NOW);
  assert.equal(ev.verdict, 'supported');
  assert.ok(ev.effect >= 10);
  assert.match(ev.text, /decreased/);
  assert.equal(stepHypothesis(h, state, NOW).status, 'supported');
  assert.equal(proposeHypotheses(ctx, [h]).some((p) => p.key === 'fatigueDefense'), false);
});

test('engine ranks problems, detects congestion, generates rounds and a day', () => {
  const sessions = [fading(daysAgo(6)), fading(daysAgo(4)), fading(daysAgo(2)),
    { id: 'sp', date: daysAgo(1), type: 'sparring', rpe: 7, durationMin: 30, sparring: { rounds: 4 }, hits: { failedExit: 5, handsDown: 2, distance: 1 } }];
  const state = {
    profile, sessions, memory: emptyMemory(), checkins: [], hypotheses: [], decisions: [],
    observations: [{ id: 'o1', date: daysAgo(3), source: 'coach', kind: 'issue', text: "You're backing straight up.", tags: ['hit:failedExit'] }],
    patterns: [{ id: 'a', name: 'A', active: true }, { id: 'b', name: 'B', active: true }],
  };
  const ctx = buildContext(state, NOW);
  const probs = rankProblems(ctx, state);
  assert.equal(probs[0].key, 'hit:failedExit'); // coach + measured agree
  assert.ok(probs[0].why.some((w) => w.startsWith('Coach said')));
  const pr = priorities(probs, state);
  assert.equal(pr.congested, true);
  assert.equal(pr.active.length, 3);
  const rounds = generateRounds({ n: 6, active: pr.active, exposure: ctx.exposure, rand: () => 0 });
  assert.equal(rounds[0].constraint, 'jabFootwork');
  assert.equal(rounds[1].constraint, 'exitEvery');
  assert.equal(rounds[5].constraint, 'fatigueSim');
  assert.ok(rounds.some((r) => r.opponent));
  const day = trainToday(state, ctx, { planItems: [{ kind: 'fightSim', title: 'Fight sim', detail: 'x', load: 'hard' }], tomorrowItems: [{ load: 'hard' }] });
  assert.match(day.objective, /exits/);
  assert.ok(day.avoid.some((a) => /upper-body/.test(a)));
  assert.ok(day.blocks.some((b) => b.name === 'Defense after conditioning'));
  assert.ok(day.minutes > 30);
  assert.ok(aiObservations(ctx, state).some((o) => o.key.startsWith('decay:')));
  assert.match(memoryTrace(state.observations[0], state, ctx), /Still appears under fatigue/);
});

test('fight camp phases', () => {
  const at = (days) => phaseFor({ fightDate: new Date(+NOW + days * 86400000).toISOString().slice(0, 10) }, NOW).key;
  assert.equal(at(70), 'build');
  assert.equal(at(50), 'camp');
  assert.equal(at(30), 'tactical');
  assert.equal(at(14), 'specific');
  assert.equal(at(5), 'taper');
});
