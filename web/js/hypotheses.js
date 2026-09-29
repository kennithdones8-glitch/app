// Training hypotheses: form one from evidence, run an intervention, measure, conclude. Pure logic.
import { roundDims, hitShare } from './analysis.js';
import { returnScore } from './coach.js';

const DAY = 86400000;
const BASELINE_DAYS = 21;
const TEST_DAYS = 14;
const mean = (xs) => {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

function lateDrop(s, dim, profile) {
  const rounds = (s.form?.perRound || []).filter((r) => r.frames > 30);
  if (rounds.length < 3) return null;
  const d = rounds.map((r) => roundDims(r, s, profile));
  const e = mean(d.slice(0, 2).map((x) => x[dim])), l = mean(d.slice(-2).map((x) => x[dim]));
  return e != null && l != null ? Math.max(0, e - l) : null;
}

export const TEMPLATES = {
  fatigueDefense: {
    text: 'Your defensive breakdowns may be caused more by fatigue than by a lack of technical understanding.',
    trigger: (c) => c.decay.some((f) => f.kind === 'fatigue' && (f.dim === 'defense' || f.dim.endsWith('Return'))),
    metric: { label: 'late-round defensive drop', better: 'down', fn: (s, p) => lateDrop(s, 'defense', p) },
    intervention: 'Defensive recovery drills straight after conditioning: 10 min of slips, rolls and guard resets when you are already tired.',
    planBlock: 'Defense after conditioning (10 min)',
    result: (e) => `defensive errors ${e > 0 ? 'decreased' : 'increased'} ${Math.abs(e)}% after conditioning-specific defensive training`,
  },
  straightBackExits: {
    text: 'You get hit on the way out because you exit straight back. Training angle exits in every shadow round should cut those hits.',
    trigger: (c) => c.hits.top?.key === 'failedExit' && c.hits.top.pct >= 20,
    metric: { label: 'hits from straight-back exits', better: 'down', fn: (s) => hitShare(s, 'failedExit') },
    intervention: 'Every shadowboxing round uses the "every combo ends with an exit" constraint.',
    constraint: 'exitEvery',
    result: (e) => `straight-back exit hits ${e > 0 ? 'fell' : 'rose'} ${Math.abs(e)}% with exit-constraint training`,
  },
  technicalGuard: {
    text: 'Your guard problem is technical, not fatigue: fresh, isolated guard work should raise your early-round guard.',
    trigger: (c) => c.decay.some((f) => f.kind === 'technical' && f.dim === 'defense'),
    metric: { label: 'early-round guard', better: 'up', fn: (s) => { const r = (s.form?.perRound || []).filter((x) => x.frames > 30); return r.length ? mean(r.slice(0, 2).map((x) => x.guard)) : null; } },
    intervention: 'Open every session with 2 fresh rounds of guard-recovery work before anything else.',
    constraint: 'guardRecovery',
    result: (e) => `early-round guard ${e > 0 ? 'improved' : 'dropped'} ${Math.abs(e)}% with fresh isolated guard work`,
  },
  outputFade: {
    text: 'Your output fades late because your fight-specific conditioning is short, not because of pacing.',
    trigger: (c) => (c.memory?.insights?.outputFade?.count || 0) >= 2,
    metric: { label: 'last-round output retained', better: 'up', fn: (s) => { const pr = s.punches?.perRound || []; return pr.length >= 3 && pr[0] ? (pr[pr.length - 1] / pr[0]) * 100 : null; } },
    intervention: 'Two fight-pace interval runs per week (3-min hard / 1-min easy, fight-length).',
    result: (e) => `late-round output ${e > 0 ? 'improved' : 'dropped'} ${Math.abs(e)}% after adding fight-pace intervals`,
  },
  volumeQuality: {
    text: 'Capping jab volume at your quality threshold will keep your jab sharper than high-volume sessions.',
    trigger: (c) => c.med?.threshold != null,
    metric: { label: 'lead-hand recovery score', better: 'up', fn: (s) => returnScore(s.form?.leadReturnMs) },
    intervention: 'Stop jab-focused work at your quality threshold and switch stimulus.',
    result: (e) => `jab quality ${e > 0 ? 'improved' : 'dropped'} ${Math.abs(e)}% with capped volume`,
  },
  sleepPerformance: {
    observational: true,
    text: 'You perform noticeably better after 7+ hours of sleep.',
    trigger: (c) => (c.checkins?.length || 0) >= 6,
    result: (e) => `sessions after 7+ hours of sleep scored ${Math.abs(e)}% ${e > 0 ? 'higher' : 'lower'}`,
  },
};

export function proposeHypotheses(ctx, existing = []) {
  const taken = new Set(existing.filter((h) => h.status !== 'dismissed').map((h) => h.key));
  return Object.entries(TEMPLATES)
    .filter(([k, t]) => !taken.has(k) && t.trigger(ctx))
    .map(([k, t]) => ({ key: k, text: t.text, intervention: t.intervention || 'Observe only — no change to training.' }));
}

export function startHypothesis(key, existing, now = new Date()) {
  const t = TEMPLATES[key];
  const n = existing.reduce((m, h) => Math.max(m, h.n || 0), 0) + 1;
  return {
    id: `h${n}-${key}`, n, key, text: t.text, intervention: t.intervention || null,
    status: 'testing', created: now.toISOString(),
    endsAt: new Date(+now + TEST_DAYS * DAY).toISOString(), extended: false,
  };
}

function sessionsIn(sessions, a, b) {
  return sessions.filter((s) => +new Date(s.date) >= a && +new Date(s.date) < b);
}

export function evaluateHypothesis(h, state, now = new Date()) {
  const t = TEMPLATES[h.key];
  if (!t) return { verdict: null };
  const start = +new Date(h.created);
  if (t.observational) {
    const sleepBy = Object.fromEntries((state.checkins || []).map((c) => [c.date, c.sleep]));
    const scored = (state.sessions || []).filter((s) => s.scores?.overall != null).map((s) => ({ v: s.scores.overall, sleep: sleepBy[s.date.slice(0, 10)] }));
    const good = scored.filter((x) => x.sleep >= 7).map((x) => x.v), bad = scored.filter((x) => x.sleep != null && x.sleep < 7).map((x) => x.v);
    if (good.length < 3 || bad.length < 3) return { phase: 'collecting', baseline: { n: bad.length }, test: { n: good.length }, verdict: null };
    const effect = Math.round(((mean(good) - mean(bad)) / mean(bad)) * 100);
    return { baseline: { n: bad.length, mean: Math.round(mean(bad)) }, test: { n: good.length, mean: Math.round(mean(good)) }, effect, verdict: effect >= 8 ? 'supported' : effect <= -3 ? 'refuted' : 'inconclusive', text: t.result(effect) };
  }
  const p = state.profile;
  const base = sessionsIn(state.sessions || [], start - BASELINE_DAYS * DAY, start).map((s) => t.metric.fn(s, p)).filter((v) => v != null);
  const test = sessionsIn(state.sessions || [], start, +now).map((s) => t.metric.fn(s, p)).filter((v) => v != null);
  const out = { baseline: { n: base.length, mean: base.length ? Math.round(mean(base)) : null }, test: { n: test.length, mean: test.length ? Math.round(mean(test)) : null }, verdict: null };
  const ended = +now >= +new Date(h.endsAt);
  if (base.length < 2 || test.length < 2) {
    out.phase = ended ? 'insufficient' : 'testing';
    return out;
  }
  const b = mean(base), x = mean(test);
  // Positive effect = moved in the better direction.
  const effect = b === 0 ? (x === 0 ? 0 : t.metric.better === 'down' ? -100 : 100)
    : Math.round((t.metric.better === 'down' ? (b - x) / Math.abs(b) : (x - b) / Math.abs(b)) * 100);
  out.effect = effect;
  if (!ended && test.length < 4) { out.phase = 'testing'; return out; }
  out.verdict = effect >= 10 ? 'supported' : effect <= -5 ? 'refuted' : 'inconclusive';
  out.text = t.result(effect);
  return out;
}

// Advance a hypothesis: conclude it, extend once if data is short, or leave it running.
export function stepHypothesis(h, state, now = new Date()) {
  if (h.status !== 'testing') return h;
  const ev = evaluateHypothesis(h, state, now);
  if (ev.verdict) return { ...h, status: ev.verdict, result: { ...ev, date: now.toISOString() } };
  if (ev.phase === 'insufficient') {
    if (!h.extended) return { ...h, extended: true, endsAt: new Date(+now + TEST_DAYS * DAY).toISOString() };
    return { ...h, status: 'inconclusive', result: { ...ev, date: now.toISOString(), text: 'not enough data to judge' } };
  }
  return h;
}

export function activeInterventions(hypotheses = []) {
  return hypotheses.filter((h) => h.status === 'testing').map((h) => ({ n: h.n, key: h.key, ...TEMPLATES[h.key] }));
}

