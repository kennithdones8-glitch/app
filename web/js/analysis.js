// Session analysis: fatigue maps, technique decay, minimum effective dose, training transfer,
// "why did you get hit", and opponent exposure. Pure logic.
import { returnScore, clamp } from './coach.js';
import { HIT_REASONS, OPPONENTS } from './library.js';

const PPM_TARGET = { beginner: 40, intermediate: 60, advanced: 80 };
const mean = (xs) => {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const r0 = (x) => (x == null ? null : Math.round(x));

export function isCamera(s) {
  return (s.form?.perRound || []).filter((r) => r.frames > 30).length > 0;
}

export function leadHandName(profile = {}) {
  return profile.stance === 'southpaw' ? 'right' : 'left';
}

// Per-round development dimensions (0–100).
export function roundDims(r, session, profile = {}) {
  const roundMin = (session.plan?.roundSec || 180) / 60;
  const target = PPM_TARGET[profile.level] || PPM_TARGET.advanced;
  return {
    technique: r0(mean([r.stance, r.blade, returnScore(r.handReturnMs)])),
    pace: r.totalPunches != null ? clamp(Math.round((r.totalPunches / roundMin / target) * 100), 0, 100) : null,
    defense: r0(mean([r.guard, r.head != null ? Math.min(100, r.head * 1.6) : null])),
    footwork: r.footwork != null ? Math.min(100, Math.round(r.footwork * 1.6)) : null,
    leadReturn: returnScore(r.leadReturnMs),
    rearReturn: returnScore(r.rearReturnMs),
  };
}

export const DIM_NAMES = { technique: 'Technique', pace: 'Pace', defense: 'Defense', footwork: 'Footwork', leadReturn: 'Lead-hand recovery', rearReturn: 'Rear-hand recovery' };

function breakRound(rows, dim) {
  const base = mean(rows.slice(0, 2).map((r) => r[dim]));
  if (base == null) return null;
  for (let i = 2; i < rows.length; i++) {
    if (rows[i][dim] != null && rows[i][dim] < base - 10) return i + 1;
  }
  return null;
}

// Round-by-round fatigue map for one session.
export function fatigueMap(session, profile = {}) {
  const rounds = (session.form?.perRound || []).filter((r) => r.frames > 30);
  if (rounds.length < 3) return null;
  const rows = rounds.map((r, i) => ({ round: i + 1, ...roundDims(r, session, profile) }));
  const dims = ['technique', 'pace', 'defense', 'footwork'];
  const breaks = Object.fromEntries(dims.map((d) => [d, breakRound(rows, d)]));
  const broken = dims.filter((d) => breaks[d] != null).sort((a, b) => breaks[a] - breaks[b]);
  let conclusion;
  if (!broken.length) conclusion = 'You held your form across every round. Time to add rounds or intensity.';
  else {
    const first = broken[0];
    if (first === 'pace') conclusion = `Output drops first (round ${breaks.pace}) — conditioning is the limiter here.`;
    else if (breaks.pace == null || breaks.pace > breaks[first]) {
      conclusion = `Conditioning isn't limiting your output — ${DIM_NAMES[first].toLowerCase()} breaks down first (round ${breaks[first]}) while pace ${breaks.pace ? 'holds longer' : 'holds'}. Train ${DIM_NAMES[first].toLowerCase()} under fatigue.`;
    } else conclusion = `${DIM_NAMES[first]} and pace break down together from round ${breaks[first]}.`;
  }
  return { rows, breaks, firstBreak: broken[0] || null, conclusion };
}

// Technique decay across recent sessions: technical weakness vs fatigue-induced weakness.
export function decayFindings(sessions, profile = {}, n = 6) {
  const cams = sessions.filter((s) => (s.form?.perRound || []).filter((r) => r.frames > 30).length >= 3).slice(-n);
  if (cams.length < 2) return [];
  const lead = leadHandName(profile);
  const rear = lead === 'left' ? 'right' : 'left';
  const labels = {
    technique: 'technique', defense: 'defense', footwork: 'footwork',
    leadReturn: `${lead}-hand recovery`, rearReturn: `${rear}-hand recovery`,
  };
  const findings = [];
  for (const dim of Object.keys(labels)) {
    let fatigue = 0, technical = 0, total = 0;
    const brs = [], fresh = [];
    for (const s of cams) {
      const rows = s.form.perRound.filter((r) => r.frames > 30).map((r) => roundDims(r, s, profile));
      const early = mean(rows.slice(0, 2).map((r) => r[dim]));
      const late = mean(rows.slice(-2).map((r) => r[dim]));
      if (early == null || late == null) continue;
      total++;
      fresh.push(early);
      if (early < 65) technical++;
      else if (early - late >= 12) {
        fatigue++;
        const br = breakRound(rows.map((r, i) => ({ ...r, round: i + 1 })), dim);
        if (br) brs.push(br);
      }
    }
    if (total < 2) continue;
    const br = brs.length ? brs.sort((a, b) => a - b)[Math.floor(brs.length / 2)] : null;
    if (fatigue >= Math.max(2, Math.ceil(total / 2))) {
      const isDefense = dim === 'defense' || dim.endsWith('Return');
      findings.push({
        key: `decay:${dim}`, dim, kind: 'fatigue', sessions: fatigue, total, breakRound: br,
        text: dim === 'technique' && br
          ? `Your technique is good during the first ${br - 1} rounds but deteriorates significantly from round ${br} (${fatigue} of ${total} sessions).`
          : `Your ${labels[dim]} is consistently worse in high-fatigue rounds${br ? ` (from round ${br})` : ''} — ${fatigue} of ${total} sessions.`,
        advice: isDefense
          ? 'This is fatigue-induced, not a lack of skill. Add defensive recovery drills straight after conditioning rather than simply more punching volume.'
          : dim === 'footwork'
            ? 'Fatigue-induced. Do footwork drills (ladder, rope, angle steps) right after intervals so your feet learn to work tired.'
            : 'Fatigue-induced. Finish sessions with slow, perfect technical rounds while tired so your shape holds under fatigue.',
      });
    } else if (technical >= Math.max(2, Math.ceil(total / 2))) {
      findings.push({
        key: `weak:${dim}`, dim, kind: 'technical', sessions: technical, total, fresh: r0(mean(fresh)),
        text: `Your ${labels[dim]} is weak even in fresh rounds (avg ${r0(mean(fresh))} in rounds 1–2) — a technical problem, not fatigue.`,
        advice: 'Drill it fresh, first in the session, slow and perfect, before adding speed or volume.',
      });
    }
  }
  return findings;
}

// Minimum effective dose: at what per-session volume does quality fall off?
export function medAnalysis(sessions, type = 'jab', profile = {}) {
  const isLead = type === 'jab' || type === 'leadHook' || type === 'leadUppercut';
  const points = [];
  let used = 0;
  for (const s of sessions) {
    const rounds = (s.form?.perRound || []).filter((r) => r.frames > 30);
    if (rounds.length < 2) continue;
    const q = (r) => mean([returnScore(isLead ? r.leadReturnMs : r.rearReturnMs), r.guard, isLead && r.rearDropPct != null ? 100 - r.rearDropPct : null]);
    const q0 = q(rounds[0]);
    if (!q0) continue;
    let cum = 0, any = false;
    for (const r of rounds) {
      const n = r.punches?.[type] || 0;
      if (n < 5) continue;
      cum += n;
      const qr = q(r);
      if (qr == null) continue;
      points.push({ cum, ratio: qr / q0 });
      any = true;
    }
    if (any) used++;
  }
  const name = { jab: 'jab', cross: 'cross', leadHook: 'lead hook', rearHook: 'rear hook' }[type] || type;
  if (used < 3) {
    return { type, threshold: null, sessionsUsed: used, message: `Need ${3 - used} more camera session${3 - used === 1 ? '' : 's'} with plenty of ${name}s to find your ${name} dose.` };
  }
  const bins = {};
  for (const p of points) (bins[Math.floor(p.cum / 50) * 50] ||= []).push(p.ratio);
  const keys = Object.keys(bins).map(Number).sort((a, b) => a - b);
  for (const k of keys) {
    if (bins[k].length < 2) continue;
    const m = mean(bins[k]);
    if (m < 0.9) {
      const drop = Math.round((1 - m) * 100);
      return {
        type, threshold: k, drop, sessionsUsed: used,
        message: `Your ${name} quality holds up to ~${k} reps per session, then drops ~${drop}%. Stop at ~${k} quality reps and move to another stimulus.`,
      };
    }
  }
  const maxCum = Math.max(...points.map((p) => p.cum));
  return { type, threshold: null, sessionsUsed: used, message: `No quality drop found up to ~${maxCum} ${name}s per session yet — volume isn't hurting quality.` };
}

// "Why did you get hit?" across the last n sessions with hit data.
export function hitAnalysis(sessions, n = 10) {
  const withHits = sessions.filter((s) => s.hits && Object.values(s.hits).some((v) => v > 0)).slice(-n);
  const counts = {};
  for (const s of withHits) for (const [k, v] of Object.entries(s.hits)) counts[k] = (counts[k] || 0) + v;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const shares = Object.entries(counts)
    .filter(([k, v]) => v > 0 && HIT_REASONS[k])
    .map(([k, v]) => ({ key: k, name: HIT_REASONS[k].name, count: v, pct: Math.round((v / total) * 100) }))
    .sort((a, b) => b.count - a.count);
  return { sessions: withHits.length, total, shares, top: shares[0] || null };
}

// Share of hits for one reason in a single session (for trends).
export function hitShare(session, key) {
  if (!session.hits) return null;
  const total = Object.values(session.hits).reduce((a, b) => a + b, 0);
  return total ? Math.round(((session.hits[key] || 0) / total) * 100) : null;
}

function contextOf(s) {
  if (s.type === 'sparring') return 'sparring';
  if (s.type === 'bag') return 'bag';
  if (s.type === 'shadow') return 'shadow';
  return 'drill'; // mitts and isolated drilling
}

// How often a pattern shows up, per context. Camera sequences count automatically.
export function patternUse(pattern, s) {
  const manual = s.patternUse?.[pattern.id];
  if (manual) return manual;
  if (pattern.seq && !pattern.counter && s.form?.sequences && contextOf(s) !== 'sparring') {
    const n = s.form.sequences[pattern.seq] || 0;
    return n ? { used: n, auto: true } : null;
  }
  return null;
}

// Training transfer: does something practised in isolation show up under pressure?
export function transferScores(patterns, sessions, now = new Date(), days = 60) {
  const since = new Date(now.getTime() - days * 86400000);
  const recent = sessions.filter((s) => new Date(s.date) >= since);
  return patterns.filter((p) => p.active !== false).map((p) => {
    const ctx = { drill: { reps: 0, sessions: 0 }, shadow: { uses: 0, sessions: 0 }, bag: { uses: 0, sessions: 0 }, sparring: { used: 0, landed: 0, sessions: 0 } };
    for (const s of recent) {
      const c = contextOf(s);
      const u = patternUse(p, s);
      if (c === 'sparring') {
        ctx.sparring.sessions++;
        if (u) { ctx.sparring.used += u.used || 0; ctx.sparring.landed += u.landed || 0; }
      } else if (c === 'drill') {
        if (u) { ctx.drill.reps += (u.reps || 0) + (u.used || 0); ctx.drill.sessions++; }
      } else {
        ctx[c].sessions++;
        if (u) ctx[c].uses += u.used || 0;
      }
      if (u?.reps && c !== 'drill') ctx.drill.reps += u.reps;
    }
    const rate = (uses, sess, per) => (sess ? Math.min(1, uses / sess / per) : 0);
    const shadow = rate(ctx.shadow.uses, ctx.shadow.sessions, 4);
    const bag = rate(ctx.bag.uses, ctx.bag.sessions, 4);
    const spar = rate(ctx.sparring.used, ctx.sparring.sessions, 2);
    const land = ctx.sparring.used ? ctx.sparring.landed / ctx.sparring.used : 0;
    const practised = ctx.drill.reps + ctx.shadow.uses + ctx.bag.uses;
    const transfer = Math.round(100 * (0.2 * shadow + 0.2 * bag + 0.35 * spar + 0.25 * land));
    let message;
    if (!practised && !ctx.sparring.used) message = 'No reps recorded yet. Drill it, then log how often it shows up.';
    else if (!ctx.sparring.sessions) message = 'Being practised — log sparring to see if it holds up under pressure.';
    else if (!ctx.sparring.used) message = "You're practising this, but it's not appearing under pressure yet.";
    else if (land < 0.4) message = `Showing up in sparring but landing only ${Math.round(land * 100)}% — work on the set-up.`;
    else if (transfer >= 70) message = 'Transferring well: it holds up under pressure.';
    else message = "It's appearing in sparring, but not consistently yet.";
    return { id: p.id, name: p.name, ctx, practised, transfer, message };
  });
}

// Which opponent styles have you prepared for recently?
export function opponentExposure(sessions, now = new Date(), days = 45) {
  const since = new Date(now.getTime() - days * 86400000);
  const counts = Object.fromEntries(Object.keys(OPPONENTS).map((k) => [k, 0]));
  for (const s of sessions) {
    if (new Date(s.date) < since) continue;
    for (const c of s.constraints || []) if (c.opponent && counts[c.opponent] != null) counts[c.opponent]++;
    const style = s.sparring?.partnerStyle;
    if (style && counts[style] != null) counts[style] += s.sparring.rounds || 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(counts).sort((a, b) => a[1] - b[1]);
  const under = sorted.filter(([, n]) => n <= Math.max(0, sorted[0][1])).map(([k]) => k);
  const most = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  let message = 'Train some opponent-specific rounds to build your exposure map.';
  if (total >= 4) {
    message = `You've been training mostly against ${OPPONENTS[most[0]].name.toLowerCase()} scenarios. You're underexposed to ${under.slice(0, 2).map((k) => OPPONENTS[k].name.toLowerCase()).join(' and ')}.`;
  }
  return { counts, total, under, message };
}
