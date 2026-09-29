// The boxing development model: attribute ratings computed from training evidence,
// proof of improvement, development timeline and style discovery. Pure logic.
import { SKILLS, HIT_REASONS, POSITIVES, CONSTRAINTS, SCENARIOS } from './library.js';
import { returnScore, clamp, outputPpm } from './coach.js';
import { roundDims, hitShare } from './analysis.js';

const DAY = 86400000;
const HALF_LIFE_DAYS = 45;
const PRIOR = 50;
const PRIOR_WEIGHT = 2;

const mean = (xs) => {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const scenarioById = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

function camRounds(s) {
  return (s.form?.perRound || []).filter((r) => r.frames > 30);
}

// ---------------------------------------------------------------------------
// Evidence extraction

export function extractEvidence(state) {
  const ev = [];
  const add = (skill, value, weight, date, source, detail, sessionId) => {
    if (value == null || Number.isNaN(value) || !SKILLS[skill]) return;
    ev.push({ skill, value: clamp(Math.round(value), 0, 100), weight, date, source, detail, sessionId });
  };
  const profile = state.profile || {};
  const patterns = state.patterns || [];

  for (const s of state.sessions || []) {
    const d = s.date;
    const f = s.form;
    const rounds = camRounds(s);
    const src = s.source === 'video' ? 'video' : 'camera';
    if (f && rounds.length) {
      add('footwork', mean([f.stance, f.footwork != null ? Math.min(100, f.footwork * 1.6) : null, f.crossedPct != null ? 100 - f.crossedPct * 4 : null]), 1, d, src, 'stance, movement, crossed feet', s.id);
      if (f.head != null) add('headMovement', Math.min(100, f.head * 1.6), 1, d, src, 'head off the centre line', s.id);
      add('defense', mean([f.guard, returnScore(f.handReturnMs), f.rearDropPct != null ? 100 - f.rearDropPct : null]), 1, d, src, 'guard, hand return, rear-hand discipline', s.id);
      if (f.blade != null) add('angles', f.blade, 0.3, d, src, 'bladed stance', s.id);

      const by = f.punches || {};
      const q = (r, lead) => mean([returnScore(lead ? r.leadReturnMs : r.rearReturnMs), r.guard, lead && r.rearDropPct != null ? 100 - r.rearDropPct : null]);
      const fatigueAdj = (lead) => {
        if (rounds.length < 3) return 0;
        const early = mean(rounds.slice(0, 2).map((r) => q(r, lead)));
        const late = mean(rounds.slice(-2).map((r) => q(r, lead)));
        return early != null && late != null ? clamp((late - early) / 2, -10, 5) : 0;
      };
      if (by.jab >= 10) {
        add('jab', mean([returnScore(f.leadReturnMs), f.rearDropPct != null ? 100 - f.rearDropPct : null, f.guard]) + fatigueAdj(true),
          Math.min(1.5, by.jab / 80), d, src, `${by.jab} jabs`, s.id);
      }
      if (by.cross >= 10) add('cross', mean([returnScore(f.rearReturnMs), f.guard, f.blade]) + fatigueAdj(false), Math.min(1.2, by.cross / 80), d, src, `${by.cross} crosses`, s.id);
      const hooks = (by.leadHook || 0) + (by.rearHook || 0);
      if (hooks >= 6) add('hooks', mean([f.guard, returnScore(f.handReturnMs)]), Math.min(1, hooks / 40), d, src, `${hooks} hooks`, s.id);
      const ups = (by.leadUppercut || 0) + (by.rearUppercut || 0);
      if (ups >= 6) add('uppercuts', mean([f.guard, returnScore(f.handReturnMs)]), Math.min(1, ups / 40), d, src, `${ups} uppercuts`, s.id);
      if (f.comboShare != null && f.totalPunches >= 30) {
        add('combinations', f.comboShare * 0.8 + ((f.avgComboLen || 1) - 1) * 25, 1, d, src, `${f.comboShare}% of punches in combinations`, s.id);
      }
      if (rounds.length >= 3) {
        const dims = rounds.map((r) => roundDims(r, s, profile));
        const first = rounds[0].totalPunches, last = rounds[rounds.length - 1].totalPunches;
        const held = (k) => {
          const e = mean(dims.slice(0, 2).map((x) => x[k])), l = mean(dims.slice(-2).map((x) => x[k]));
          return e ? Math.min(100, (l / e) * 100) : null;
        };
        // Conditioning = keeping output, technique AND defense when tired.
        add('conditioning', mean([first ? Math.min(100, (last / first) * 100) : null, held('technique'), held('defense'), held('defense')]), 1, d, src, 'output, technique and defense held late', s.id);
      }
    } else if ((s.punches?.perRound || []).length >= 3) {
      const pr = s.punches.perRound;
      if (pr[0] > 0) add('conditioning', Math.min(100, (pr[pr.length - 1] / pr[0]) * 100), 0.7, d, 'motion', 'output held late', s.id);
    }
    if (s.plan?.rounds && s.completedRounds != null && !s.manual) {
      add('conditioning', (s.completedRounds / s.plan.rounds) * 90, 0.3, d, 'timer', `${s.completedRounds}/${s.plan.rounds} rounds`, s.id);
    }

    // Sparring: why you got hit, what went right.
    const rds = s.sparring?.rounds || s.completedRounds || 3;
    for (const [k, n] of Object.entries(s.hits || {})) {
      if (!n || !HIT_REASONS[k]) continue;
      for (const sk of HIT_REASONS[k].skills) add(sk, 90 - (n / rds) * 30, 1.2, d, 'sparring', `${n}× hit: ${HIT_REASONS[k].name.toLowerCase()}`, s.id);
    }
    for (const k of s.positives || []) {
      for (const sk of POSITIVES[k]?.skills || []) add(sk, 80, 0.8, d, 'sparring', POSITIVES[k].name, s.id);
    }
    // Constraint compliance.
    for (const c of s.constraints || []) {
      if (c.compliance == null || !CONSTRAINTS[c.key]) continue;
      for (const sk of CONSTRAINTS[c.key].skills) add(sk, c.compliance, c.auto ? 0.8 : 0.6, d, c.auto ? src : 'self', `${CONSTRAINTS[c.key].name}: ${c.compliance}%`, s.id);
    }
    // Pattern usage under pressure.
    if (s.type === 'sparring') {
      for (const [pid, u] of Object.entries(s.patternUse || {})) {
        const p = patterns.find((x) => x.id === pid);
        if (!p || !u.used) continue;
        const land = u.landed != null ? u.landed / u.used : 0.5;
        for (const sk of p.skills || ['combinations']) add(sk, 50 + 40 * land, 0.6, d, 'sparring', `${p.name}: ${u.landed ?? '?'}/${u.used} landed`, s.id);
      }
    }
  }

  for (const dec of state.decisions || []) {
    const sc = scenarioById[dec.id];
    if (!sc) continue;
    const v = dec.correct ? 85 + (dec.ms < 4000 ? 10 : 0) : dec.ok ? 62 : 30;
    add('fightIQ', v, 0.25, dec.date, 'decision', sc.text);
    for (const t of sc.tags) add(t, v, 0.12, dec.date, 'decision', sc.text);
  }

  for (const o of state.observations || []) {
    if (o.source !== 'coach' && o.source !== 'self') continue;
    const w = o.source === 'coach' ? 0.8 : 0.4;
    const v = o.kind === 'positive' ? 80 : o.kind === 'issue' ? 40 : null;
    if (v == null) continue;
    for (const t of o.tags || []) {
      if (SKILLS[t]) add(t, v, w, o.date, o.source, o.text);
      else if (t.startsWith('hit:')) for (const sk of HIT_REASONS[t.slice(4)]?.skills || []) add(sk, v, w * 0.7, o.date, o.source, o.text);
    }
  }
  return ev;
}

// ---------------------------------------------------------------------------
// Ratings

export function ratingAt(evidence, skill, asOf = new Date()) {
  const t = +asOf;
  let num = PRIOR * PRIOR_WEIGHT, den = PRIOR_WEIGHT, raw = 0, n = 0;
  for (const e of evidence) {
    if (e.skill !== skill) continue;
    const et = +new Date(e.date);
    if (et > t) continue;
    const decay = Math.pow(0.5, (t - et) / DAY / HALF_LIFE_DAYS);
    num += e.value * e.weight * decay;
    den += e.weight * decay;
    raw += e.weight * decay;
    n++;
  }
  return { rating: Math.round(num / den), weight: raw, n };
}

function confidenceOf(w) {
  return w >= 8 ? 'high' : w >= 3 ? 'medium' : w > 0 ? 'low' : 'none';
}

export function skillReport(state, now = new Date(), evidence = extractEvidence(state)) {
  const prevDate = new Date(+now - 28 * DAY);
  return Object.entries(SKILLS).map(([key, meta]) => {
    const cur = ratingAt(evidence, key, now);
    const prev = ratingAt(evidence, key, prevDate);
    const mine = evidence.filter((e) => e.skill === key && +new Date(e.date) <= +now);
    const sessions = new Set(mine.map((e) => e.sessionId).filter(Boolean)).size;
    const last = mine.length ? mine.map((e) => e.date).sort().pop() : null;
    return {
      key, name: meta.name, group: meta.group,
      rating: cur.rating, prev: prev.n ? prev.rating : null, delta: prev.n ? cur.rating - prev.rating : null,
      confidence: confidenceOf(cur.weight), evidence: mine.length, sessions, last,
      summary: evidenceSummary(key, mine, state),
    };
  });
}

function evidenceSummary(key, items, state) {
  if (!items.length) return 'No evidence yet.';
  const sessions = new Set(items.map((e) => e.sessionId).filter(Boolean)).size;
  const bySource = {};
  for (const e of items) bySource[e.source] = (bySource[e.source] || 0) + 1;
  const src = Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ');
  const avg = Math.round(mean(items.map((e) => e.value)));
  if (key === 'jab' || key === 'cross') {
    const ids = new Set(items.map((e) => e.sessionId));
    const count = (state.sessions || []).filter((s) => ids.has(s.id)).reduce((a, s) => a + (s.form?.punches?.[key] || 0), 0);
    if (count) return `${sessions} sessions, ${count} recorded ${key === 'jab' ? 'jabs' : 'crosses'}, ${avg}% average technique score.`;
  }
  return `${items.length} pieces of evidence${sessions ? ` from ${sessions} sessions` : ''} (${src}); average ${avg}.`;
}

export function evidenceFor(evidence, skill, limit = 8) {
  return evidence.filter((e) => e.skill === skill).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Proof of improvement: skill change plus the measured metrics behind it.

const DOWN = 'down', UP = 'up';
const early = (s, dim, profile) => {
  const r = camRounds(s);
  if (r.length < 3) return null;
  const dims = r.map((x) => roundDims(x, s, profile));
  const e = mean(dims.slice(0, 2).map((x) => x[dim])), l = mean(dims.slice(-2).map((x) => x[dim]));
  return e != null && l != null ? e - l : null;
};

export const PROOF_METRICS = {
  defense: [
    { label: 'guard up', better: UP, fn: (s) => s.form?.guard },
    { label: 'rear-hand drops on the jab', better: DOWN, fn: (s) => s.form?.rearDropPct },
    { label: 'hits from hands down', better: DOWN, fn: (s) => hitShare(s, 'handsDown') },
    { label: 'defensive fade under fatigue', better: DOWN, fn: (s, p) => early(s, 'defense', p) },
  ],
  angles: [
    { label: 'straight-back exits', better: DOWN, fn: (s) => hitShare(s, 'failedExit') },
    { label: 'exit-constraint compliance', better: UP, fn: (s) => mean((s.constraints || []).filter((c) => c.key === 'exitEvery').map((c) => c.compliance)) },
  ],
  footwork: [
    { label: 'time moving', better: UP, fn: (s) => s.form?.footwork },
    { label: 'crossed feet', better: DOWN, fn: (s) => s.form?.crossedPct },
    { label: 'hits from footwork errors', better: DOWN, fn: (s) => hitShare(s, 'footworkError') },
  ],
  headMovement: [
    { label: 'head movement', better: UP, fn: (s) => s.form?.head },
    { label: 'hits with head on the centre line', better: DOWN, fn: (s) => hitShare(s, 'headPosition') },
  ],
  jab: [
    { label: 'jabs per session', better: UP, fn: (s) => s.form?.punches?.jab },
    { label: 'jab share of punches', better: UP, fn: (s) => (s.form?.totalPunches ? (s.form.punches.jab / s.form.totalPunches) * 100 : null) },
    { label: 'lead-hand return time', better: DOWN, fn: (s) => s.form?.leadReturnMs },
  ],
  cross: [{ label: 'rear-hand return time', better: DOWN, fn: (s) => s.form?.rearReturnMs }],
  conditioning: [
    { label: 'technique fade late in sessions', better: DOWN, fn: (s, p) => early(s, 'technique', p) },
    { label: 'output held in the last round', better: UP, fn: (s) => { const pr = s.punches?.perRound || []; return pr.length >= 3 && pr[0] ? (pr[pr.length - 1] / pr[0]) * 100 : null; } },
    { label: 'hits from fatigue', better: DOWN, fn: (s) => hitShare(s, 'fatigue') },
  ],
  combinations: [
    { label: 'punches thrown in combinations', better: UP, fn: (s) => s.form?.comboShare },
    { label: 'average combination length', better: UP, fn: (s) => s.form?.avgComboLen },
  ],
  distance: [
    { label: 'hits from poor distance', better: DOWN, fn: (s) => hitShare(s, 'distance') },
    { label: 'hits from overextending', better: DOWN, fn: (s) => hitShare(s, 'overextended') },
  ],
  counters: [
    { label: 'missed counters', better: DOWN, fn: (s) => hitShare(s, 'missedCounter') },
    { label: 'counter-constraint compliance', better: UP, fn: (s) => mean((s.constraints || []).filter((c) => c.key === 'counterOnly').map((c) => c.compliance)) },
  ],
  rhythm: [{ label: 'hits from predictable rhythm', better: DOWN, fn: (s) => hitShare(s, 'rhythm') }],
  timing: [{ label: 'missed counters', better: DOWN, fn: (s) => hitShare(s, 'missedCounter') }],
  fightIQ: [{ label: 'tactical-mistake hits', better: DOWN, fn: (s) => hitShare(s, 'tactical') }],
};

export function proofOfImprovement(state, skill, now = new Date(), weeks = 8, evidence = extractEvidence(state)) {
  const start = new Date(+now - weeks * 7 * DAY);
  // Baseline: the rating at the window start, or after its first 3 weeks if history starts inside it.
  let then = ratingAt(evidence, skill, start);
  if (!then.n) then = ratingAt(evidence, skill, new Date(+start + 21 * DAY));
  const cur = ratingAt(evidence, skill, now);
  const change = then.n ? Math.round(((cur.rating - then.rating) / then.rating) * 100) : null;
  const inWin = (s, a, b) => +new Date(s.date) >= +a && +new Date(s.date) <= +b;
  const firstWin = [start, new Date(+start + 21 * DAY)];
  const lastWin = [new Date(+now - 21 * DAY), now];
  const lines = [];
  for (const m of PROOF_METRICS[skill] || []) {
    const a = mean((state.sessions || []).filter((s) => inWin(s, ...firstWin)).map((s) => m.fn(s, state.profile)));
    const b = mean((state.sessions || []).filter((s) => inWin(s, ...lastWin)).map((s) => m.fn(s, state.profile)));
    if (a == null || b == null || a === 0) continue;
    const rel = Math.round(((b - a) / Math.abs(a)) * 100);
    if (!rel) continue;
    const good = (m.better === UP) === rel > 0;
    lines.push({ label: m.label, change: rel, good, text: `${rel > 0 ? '↑' : '↓'} ${Math.abs(rel)}% ${m.label}` });
  }
  if (skill === 'fightIQ') {
    const decs = state.decisions || [];
    const acc = (a, b) => { const xs = decs.filter((d) => +new Date(d.date) >= +a && +new Date(d.date) <= +b); return xs.length >= 3 ? (xs.filter((d) => d.correct).length / xs.length) * 100 : null; };
    const a = acc(...firstWin), b = acc(...lastWin);
    if (a != null && b != null && a > 0) {
      const rel = Math.round(((b - a) / a) * 100);
      if (rel) lines.push({ label: 'decision accuracy', change: rel, good: rel > 0, text: `${rel > 0 ? '↑' : '↓'} ${Math.abs(rel)}% decision accuracy` });
    }
  }
  return { skill, weeks, from: then.n ? then.rating : null, to: cur.rating, change, lines };
}

// ---------------------------------------------------------------------------
// Development timeline

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function levelWord(r) {
  return r >= 75 ? 'strong' : r >= 60 ? 'solid' : r >= 45 ? 'developing' : 'inconsistent';
}

export function developmentTimeline(state, now = new Date(), months = 6, evidence = extractEvidence(state)) {
  const out = [];
  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const insights = state.memory?.insights || {};
  for (let i = 0; i < months; i++) {
    const m0 = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const m1 = new Date(m0.getFullYear(), m0.getMonth() + 1, 1);
    const end = m1 > now ? now : new Date(+m1 - 1);
    const inMonth = (d) => +new Date(d) >= +m0 && +new Date(d) < +m1;
    const sessions = (state.sessions || []).filter((s) => inMonth(s.date));
    const monthEvidence = evidence.filter((e) => inMonth(e.date));
    if (!sessions.length && !monthEvidence.length) continue;

    const moves = Object.keys(SKILLS).map((k) => {
      const a = ratingAt(evidence, k, m0), b = ratingAt(evidence, k, end);
      return { key: k, from: a.rating, to: b.rating, delta: b.rating - a.rating, n: b.n - a.n };
    }).filter((x) => x.n > 0);
    const events = [];
    // Blocks: the constraint you trained most that month.
    const cons = {};
    for (const s of sessions) for (const c of s.constraints || []) cons[c.key] = (cons[c.key] || 0) + 1;
    const block = Object.entries(cons).sort((a, b) => b[1] - a[1])[0];
    if (block && block[1] >= 3) events.push(`${CONSTRAINTS[block[0]]?.name || block[0]} block (${block[1]} rounds)`);
    for (const [k, v] of Object.entries(insights)) if (v.count >= 2 && inMonth(v.firstSeen)) events.push(`Weakness identified: ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
    for (const r of state.memory?.resolved || []) if (inMonth(r.date)) events.push(`Fixed: ${r.key.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
    for (const h of state.hypotheses || []) if (h.result && inMonth(h.result.date)) events.push(`Hypothesis #${h.n} ${h.status}`);
    const coach = (state.observations || []).filter((o) => o.source === 'coach' && inMonth(o.date)).length;
    if (coach) events.push(`${coach} coach note${coach > 1 ? 's' : ''}`);
    const hitTop = {};
    for (const s of sessions) for (const [k, n] of Object.entries(s.hits || {})) hitTop[k] = (hitTop[k] || 0) + n;
    const topHit = Object.entries(hitTop).sort((a, b) => b[1] - a[1])[0];

    const up = [...moves].sort((a, b) => b.delta - a.delta)[0];
    const down = [...moves].sort((a, b) => a.to - b.to)[0];
    let headline;
    if (topHit && topHit[1] >= 3) headline = `${HIT_REASONS[topHit[0]].name} → major weakness identified`;
    else if (up && up.delta >= 3) headline = `${SKILLS[up.key].name} development → improving`;
    else if (down) headline = `${SKILLS[down.key].name} → ${levelWord(down.to)}`;
    else headline = `${sessions.length} sessions logged`;
    out.push({
      month: `${m0.getFullYear()}-${String(m0.getMonth() + 1).padStart(2, '0')}`,
      label: MONTHS[m0.getMonth()], headline, sessions: sessions.length,
      improving: moves.filter((x) => x.delta >= 3).sort((a, b) => b.delta - a.delta).slice(0, 3),
      declining: moves.filter((x) => x.delta <= -3).sort((a, b) => a.delta - b.delta).slice(0, 2),
      events,
    });
  }
  return out;
}

export function compareThen(state, now = new Date(), days = 90, evidence = extractEvidence(state)) {
  const then = new Date(+now - days * DAY);
  return Object.keys(SKILLS).map((k) => {
    const a = ratingAt(evidence, k, then), b = ratingAt(evidence, k, now);
    return { key: k, name: SKILLS[k].name, then: a.n ? a.rating : null, now: b.n ? b.rating : null };
  }).filter((x) => x.now != null);
}

// ---------------------------------------------------------------------------
// Style discovery

export function styleProfile(state, now = new Date(), days = 30) {
  const end = +now, start = end - days * DAY;
  const ss = (state.sessions || []).filter((s) => +new Date(s.date) > start && +new Date(s.date) <= end);
  const cam = ss.filter((s) => s.form?.totalPunches);
  const traits = [];
  const level = (v, hi, lo) => (v >= hi ? 'High' : v < lo ? 'Low' : 'Moderate');
  const sum = (arr, fn) => arr.reduce((a, x) => a + (fn(x) || 0), 0);

  const punches = sum(cam, (s) => s.form.totalPunches);
  const jabShare = punches ? (sum(cam, (s) => s.form.punches.jab) / punches) * 100 : null;
  if (jabShare != null && punches >= 50) traits.push({ key: 'jab', label: 'jab usage', level: level(jabShare, 35, 20), detail: `${Math.round(jabShare)}% of punches` });
  const moving = mean(cam.map((s) => s.form.footwork));
  if (moving != null) traits.push({ key: 'movement', label: 'lateral movement', level: level(moving, 55, 30), detail: `moving ${Math.round(moving)}% of the time` });
  const combo = mean(cam.map((s) => s.form.comboShare));
  if (combo != null) traits.push({ key: 'combos', label: 'combination volume', level: level(combo, 60, 35), detail: `${Math.round(combo)}% of punches in combinations` });
  const ppm = mean(ss.filter((s) => s.type === 'bag' || s.type === 'shadow').map(outputPpm));
  if (ppm != null) traits.push({ key: 'output', label: 'output', level: level(ppm, 70, 40), detail: `${Math.round(ppm)} punches/min` });
  const guard = mean(cam.map((s) => s.form.guard));
  if (guard != null) traits.push({ key: 'guard', label: 'guard discipline', level: level(guard, 80, 60), detail: `hands up ${Math.round(guard)}%` });
  const head = mean(cam.map((s) => s.form.head));
  if (head != null) traits.push({ key: 'head', label: 'head movement', level: level(head, 45, 25), detail: `head off the line ${Math.round(head)}%` });
  const spar = ss.filter((s) => s.type === 'sparring');
  const bodyRounds = sum(ss, (s) => (s.constraints || []).filter((c) => c.key === 'bodyHead').length) + sum(spar, (s) => (s.positives || []).includes('bodyWork'));
  if (spar.length >= 2 || bodyRounds) traits.push({ key: 'body', label: 'body-shot frequency', level: bodyRounds >= 4 ? 'High' : bodyRounds >= 2 ? 'Moderate' : 'Low', detail: `${bodyRounds} body-focused rounds/sessions` });
  const hits = {};
  for (const s of spar) for (const [k, n] of Object.entries(s.hits || {})) hits[k] = (hits[k] || 0) + n;
  const hitTotal = Object.values(hits).reduce((a, b) => a + b, 0);
  if (hitTotal >= 5) {
    const exitShare = ((hits.failedExit || 0) / hitTotal) * 100;
    traits.push({ key: 'exits', label: 'exits after combinations', level: exitShare >= 20 ? 'Weak' : exitShare >= 10 ? 'Moderate' : 'Strong', detail: `${Math.round(exitShare)}% of hits from failed exits` });
  }
  const counters = sum(spar, (s) => (s.positives || []).includes('counterLanded')) + sum(ss, (s) => (s.constraints || []).filter((c) => c.key === 'counterOnly' && c.compliance >= 60).length);
  if (spar.length >= 2 || counters) traits.push({ key: 'counters', label: 'counterpunching', level: counters >= 4 ? 'High' : counters >= 2 ? 'Moderate' : 'Low', detail: `${counters} counter-focused successes` });

  const t = Object.fromEntries(traits.map((x) => [x.key, x.level]));
  const score = (k, map) => map[t[k]] ?? 0;
  const hi = { High: 2, Moderate: 1, Low: 0 };
  const leans = {
    'Out-boxer': score('jab', hi) + score('movement', hi),
    'Pressure fighter': score('output', hi) + (2 - score('movement', hi)) + score('body', hi),
    Counterpuncher: score('counters', hi) * 1.5 + score('head', hi),
    'Boxer-puncher': score('combos', hi) + score('output', hi) * 0.5 + score('jab', hi) * 0.5,
  };
  const best = Object.entries(leans).sort((a, b) => b[1] - a[1])[0];
  return {
    traits,
    lean: traits.length >= 3 && best[1] > 0 ? best[0] : null,
    sessions: ss.length,
  };
}

