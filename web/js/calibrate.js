// Teaching the camera from a drilled combo. The boxer says which combo they were throwing on
// repeat; we line the detected punches up with it (lead/rear hand is read reliably, punch type
// less so), then learn where this boxer's straights and hooks separate for this kind of footage.
import { classifyPunch, punchAxis, DEFAULT_STRAIGHT_RATIO } from './form.js';
import { punchDigits } from './combos.js';

const ROLE = { 1: 'lead', 2: 'rear', 3: 'lead', 4: 'rear', 5: 'lead', 6: 'rear' };
const KIND = { 1: 'straight', 2: 'straight', 3: 'hook', 4: 'hook', 5: 'uppercut', 6: 'uppercut' };

// Best alignment of detected hands (['lead', 'rear', ...]) to a combo repeated over and over.
// Missed punches and extra detections are allowed at a cost. Returns the combo digit for each
// detected punch, or null for detections that don't fit.
export function alignToCombo(roles, digits) {
  const n = digits.length;
  const J = roles.length;
  if (!n || !J) return roles.map(() => null);
  const SKIP = 1, EXTRA = 1.2, WRONG = 2;
  // cost[j][s]: best cost after punch j with the last matched combo position s (n = none yet).
  const cost = Array.from({ length: J }, () => new Array(n + 1).fill(Infinity));
  const back = Array.from({ length: J }, () => new Array(n + 1).fill(null));
  const emit = (j, s) => (ROLE[digits[s]] === roles[j] ? 0 : WRONG);
  for (let s = 0; s < n; s++) { cost[0][s] = emit(0, s); back[0][s] = [n, s]; }
  cost[0][n] = EXTRA;
  back[0][n] = [n, null];
  for (let j = 1; j < J; j++) {
    for (let p = 0; p <= n; p++) {
      const c0 = cost[j - 1][p];
      if (c0 === Infinity) continue;
      // Extra detection: stay where we were.
      if (c0 + EXTRA < cost[j][p]) { cost[j][p] = c0 + EXTRA; back[j][p] = [p, null]; }
      for (let s = 0; s < n; s++) {
        const skipped = p === n ? 0 : (s - p - 1 + n) % n;
        const c = c0 + skipped * SKIP + emit(j, s);
        if (c < cost[j][s]) { cost[j][s] = c; back[j][s] = [p, s]; }
      }
    }
  }
  let s = 0;
  for (let k = 1; k <= n; k++) if (cost[J - 1][k] < cost[J - 1][s]) s = k;
  const out = new Array(J).fill(null);
  for (let j = J - 1; j >= 0; j--) {
    const [prev, lab] = back[j][s];
    out[j] = lab == null || ROLE[digits[lab]] !== roles[j] ? null : digits[lab];
    s = prev;
  }
  return out;
}

// punches: analyser punch events after reclassify() (with .f, .role, .axis, .type).
// Returns what matched and, when there are enough straights and hooks, a learned ratio.
export function calibrateFromCombo(punches, tokens, prior = null) {
  const digits = punchDigits(tokens);
  const labels = alignToCombo(punches.map((e) => e.role), digits);
  const kindOf = (e) => (e.type === 'jab' || e.type === 'cross' ? 'straight' : /Hook/.test(e.type) ? 'hook' : 'uppercut');
  const matched = [];
  punches.forEach((e, i) => { if (labels[i]) matched.push({ e, i, want: KIND[labels[i]] }); });
  const agree = matched.filter((m) => kindOf(m.e) === m.want).length;
  // Forward is where the known straights went: no guessing from the face or from hook-heavy averages.
  const straights = matched.filter((m) => m.want === 'straight');
  for (const e of punches) {
    const i = punches.indexOf(e);
    const near = straights.filter((m) => Math.abs(m.i - i) <= 15).map((m) => m.e.f.disp);
    const axis = punchAxis(near, 3);
    if (axis) { e.axisFixed = axis; e.axis = axis; }
  }
  const res = { total: punches.length, matched: matched.length, agree, ratio: null, before: prior?.ratio ?? DEFAULT_STRAIGHT_RATIO, labels };

  const sh = matched.filter((m) => m.want !== 'uppercut' && m.e.f.rise < 0.15 && m.e.axis);
  const nStraight = sh.filter((m) => m.want === 'straight').length;
  const nHook = sh.length - nStraight;
  if (nStraight >= 4 && nHook >= 4) {
    let best = null;
    for (let T = 1; T <= 4.001; T += 0.1) {
      const errors = sh.filter((m) => (classifyPunch(m.e.f, m.e.axis, { ratio: T }).kind === 'straight') !== (m.want === 'straight')).length;
      const score = errors + Math.abs(T - res.before) * 0.01; // ties go to the current setting
      if (!best || score < best.score) best = { T, score, errors };
    }
    // Blend with what was learned before so one clip doesn't swing it too far.
    const w = Math.min(prior?.n || 0, 60);
    const ratio = (res.before * w + best.T * sh.length) / (w + sh.length);
    res.ratio = Math.round(ratio * 100) / 100;
    res.n = Math.min(200, w + sh.length);
    res.errors = best.errors;
    res.checked = sh.length;
  }
  return res;
}

// A per-boxer calibration is only used once it has proven itself on a drilled combo.
export const trustedCal = (cal) => (cal?.acc >= 0.6 ? cal : null);
