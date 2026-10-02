// Punch test: the voice tells you exactly what to throw, so every punch the camera sees can be
// checked (was it counted? read as the right punch?) and becomes a labelled example that tunes
// punch reading to you and your camera spot.
import { KIND_OF, example } from './personal.js';

export const TEST_N = 10; // punches per step
const ANNOUNCE_MS = 3000; // the call, before "go"
const PER_PUNCH_MS = 1700; // one at a time, with a reset in between
const GAP_MS = 2500; // "stop" → next call
const GUARD_MS = 15000;
const LEAD = { jab: 1, leadHook: 1, leadUppercut: 1 };

// `only`: just these punches (a retest of the ones it read badly), without the guard step.
export function testPlan(stance = 'orthodox', only = null) {
  const [lead, rear] = stance === 'southpaw' ? ['right', 'left'] : ['left', 'right'];
  const punches = [
    ['jab', 'jabs'], ['cross', 'crosses'],
    ['leadHook', `${lead} hooks`], ['rearHook', `${rear} hooks`],
    ['leadUppercut', `${lead} uppercuts`], ['rearUppercut', `${rear} uppercuts`],
  ];
  const steps = [];
  let at = 0;
  for (const [want, name] of punches.filter(([w]) => !only || only.includes(w))) {
    const go = at + ANNOUNCE_MS, end = go + TEST_N * PER_PUNCH_MS;
    steps.push({ want, name, n: TEST_N, say: `${TEST_N} ${name}. One at a time. Go.`, at, go, end });
    at = end + GAP_MS;
  }
  if (!only) steps.push({ want: null, name: 'guard only', n: 0, say: 'Now just move in your guard. Bounce, slip, roll. No punches.', at, go: at + 4000, end: at + 4000 + GUARD_MS });
  return { steps, totalSec: Math.ceil((steps.at(-1).end + 1500) / 1000) };
}

const roleOf = (want) => (LEAD[want] ? 'lead' : 'rear');
// Detections that belong to a step: from "go" until just after "stop" (the last punch lands late).
const inStep = (s, t0) => (e) => e.kind === 'punch' && e.t >= t0 + s.go - 300 && e.t <= t0 + s.end + 900;

// Per step: how many the camera counted with the right hand, how many it read as the right
// punch, and how many came from the other hand (fakes). The guard step should count none.
export function scoreTest(steps, events, t0) {
  const rows = steps.map((s) => {
    const es = events.filter(inStep(s, t0));
    if (!s.want) return { want: null, n: 0, got: 0, right: 0, fake: es.length };
    const mine = es.filter((e) => e.role === roleOf(s.want));
    // What the wrong reads were, e.g. { leadHook: 3 }.
    const as = {};
    for (const e of mine) if (e.type !== s.want) as[e.type] = (as[e.type] || 0) + 1;
    return { want: s.want, n: s.n, got: mine.length, right: mine.filter((e) => e.type === s.want).length, fake: es.length - mine.length, as };
  });
  const punch = rows.filter((r) => r.want);
  const thrown = punch.reduce((a, r) => a + r.n, 0);
  const counted = rows.reduce((a, r) => a + r.got + r.fake, 0);
  // Count accuracy: 100% when it counted exactly what you threw, less for each miss or extra.
  const off = punch.reduce((a, r) => a + Math.abs(r.got - r.n) + r.fake, 0) + rows.filter((r) => !r.want).reduce((a, r) => a + r.fake, 0);
  const typed = punch.reduce((a, r) => a + Math.min(r.right, r.n), 0);
  return {
    rows, thrown, counted,
    countPct: Math.max(0, Math.round(100 * (1 - off / thrown))),
    typePct: Math.round((100 * typed) / thrown),
  };
}

// Every detection during the test becomes a labelled example: the hand you were told to use
// gets that punch's kind, the other hand (and anything in the guard step) is "not a punch".
export function testLabels(steps, events, t0) {
  const out = [];
  for (const s of steps) {
    for (const e of events.filter(inStep(s, t0))) {
      if (!e.f) continue;
      out.push(example(e, s.want && e.role === roleOf(s.want) ? KIND_OF[s.want] : 'none'));
    }
  }
  return out;
}

// Where the phone was, in words, from the camera spot the analyser measured.
export function spotName(sig) {
  if (!sig || sig.ratio == null) return 'camera spot not recorded';
  const height = sig.ratio > 2.1 ? 'low / floor' : 'chest height';
  return `${height}${sig.side > 0.6 ? ', side-on' : ', front-on'}`;
}

// Every punch test so far, newest first, for the progress card.
export function testHistory(sessions) {
  return sessions.filter((s) => s.test).map((s) => ({
    date: s.date, spot: spotName(s.test.spot), thrown: s.test.thrown, counted: s.test.counted,
    typePct: s.test.typePct, fake: s.test.rows.reduce((a, r) => a + r.fake, 0),
  })).reverse();
}

const NAME = { jab: 'jab', cross: 'cross', leadHook: 'lead hook', rearHook: 'rear hook', leadUppercut: 'lead uppercut', rearUppercut: 'rear uppercut' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : /(s|ch|sh)$/.test(w) ? 'es' : 's'}`;

// One plain line per punch that went wrong ("Crosses: 5 not counted, 3 read as rear hooks"), and
// the punches worth testing again (under 8 of 10 read right).
export function testProblems(test) {
  const lines = [], retest = [];
  for (const r of test?.rows || []) {
    const bits = [];
    if (!r.want) { if (r.fake) bits.push(`${r.fake} counted with no punch thrown`); } else {
      if (r.got < r.n) bits.push(`${r.n - r.got} not counted`);
      if (r.got > r.n) bits.push(`${r.got - r.n} extra`);
      const top = Object.entries(r.as || {}).sort((a, b) => b[1] - a[1])[0];
      if (top) bits.push(`${top[1]} read as ${plural(top[1], NAME[top[0]] || top[0]).replace(/^\d+ /, '')}`);
      if (r.fake >= 3) bits.push(`${r.fake} from the other hand`);
      if (Math.min(r.right, r.n) < r.n * 0.8) retest.push(r.want);
    }
    if (bits.length) lines.push({ want: r.want, text: bits.join(', ') });
  }
  return { lines, retest };
}
