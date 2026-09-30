// "Coach me": find the root problems holding the boxer back, build today's session around the time,
// equipment and energy they have, adjust it round by round, judge it afterwards and move the
// drill ladder up or down. Pure logic (no DOM), so it is fully testable.
import { CONSTRAINTS, HIT_REASONS } from './library.js';
import { INSIGHTS, outputPpm, BOXING_TYPES } from './coach.js';

const DAY = 86400000;
const mean = (xs) => {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const round = (x) => (x == null ? null : Math.round(x));

// ---------------------------------------------------------------------------
// Measurements a drill can be judged on. `better`: which way is good.

export const METRICS = {
  guard: { name: 'Guard up', unit: '%', better: 'up' },
  footwork: { name: 'Moving your feet', unit: '%', better: 'up' },
  headPerMin: { name: 'Head movements', unit: '/min', better: 'up' },
  stance: { name: 'Stance held', unit: '%', better: 'up' },
  rearDropPct: { name: 'Rear hand dropping on the jab', unit: '%', better: 'down' },
  handReturnMs: { name: 'Hand return', unit: ' ms', better: 'down' },
  guardFade: { name: 'Guard lost from first to last round', unit: ' pts', better: 'down' },
  opener: { name: 'Combos starting with the same punch', unit: '%', better: 'down' },
  callsExact: { name: 'Called combos thrown right', unit: '%', better: 'up' },
};

const cameraForm = (s) => (s.form && (s.tracking === 'camera' || s.source === 'video') && s.form.perRound?.some((r) => r.frames > 30) ? s.form : null);

// One number for a session, or null when it wasn't measured.
export function metricOf(s, key) {
  const f = cameraForm(s);
  if (key === 'callsExact') {
    const calls = s.comboCalls || [];
    return calls.length >= 4 ? round((calls.filter((c) => c[1] === 'exact').length / calls.length) * 100) : null;
  }
  if (!f) return null;
  if (key === 'guardFade') {
    const g = (f.perRound || []).filter((r) => r.frames > 30 && r.guard != null).map((r) => r.guard);
    return g.length >= 2 ? Math.max(0, g[0] - g[g.length - 1]) : null;
  }
  if (key === 'opener') {
    const seqs = Object.entries(f.sequences || {});
    const total = seqs.reduce((a, [, n]) => a + n, 0);
    if (total < 8) return null;
    const by = {};
    for (const [k, n] of seqs) by[k[0]] = (by[k[0]] || 0) + n;
    return round((Math.max(...Object.values(by)) / total) * 100);
  }
  return f[key] ?? null;
}

const meets = (key, value, target) => (value == null ? null : METRICS[key].better === 'down' ? value <= target : value >= target);

// ---------------------------------------------------------------------------
// Root problems. Symptoms are what shows up (getting hit backing up, a dropped hand in one
// session); the root is the habit that produces them. Each root has a replacement behaviour,
// a measurement that tests it, and a drill ladder (level 1 = easiest).

const L = (name, purpose, detail, target) => ({ name, purpose, detail, target });

export const ROOTS = {
  handsHome: {
    name: "Your hands don't come home", plain: 'hands staying out after you punch',
    symptoms: { hit: ['handsDown'], insight: ['rearDrop', 'slowReturn', 'lateGuardFade'], metric: [['guard', '<', 75], ['rearDropPct', '>', 25], ['handReturnMs', '>', 450]], decay: ['defense', 'leadReturn', 'rearReturn'] },
    not: 'Leaving the punch out there, or dropping the other hand while you throw',
    do: 'Punch → both gloves back to your cheekbones → then move',
    metric: 'guard', constraint: 'guardRecovery', finisher: 'hands home',
    ladder: [
      L('Freeze-check jabs', 'Build the habit slowly', 'Jab at half speed, freeze, check both gloves are on your cheekbones, reset. Then the same with 1-2.', 70),
      L('Hands-home combos', 'Keep it at combination speed', '1-2 and 1-2-3: say "home" in your head as each hand comes back before the next punch.', 78),
      L('Hands home at pace', 'Keep it at full speed', 'Full-speed 3–4 punch combos. The hand that isn\'t punching stays glued to your face.', 82),
      L('Hands home when tired', 'Keep it when it matters', '30 seconds of rope or burpees, then straight into a round: hands home on every punch.', 82),
    ],
  },
  squareAfter: {
    name: 'You stay square after your combinations', plain: 'standing in front after you punch',
    symptoms: { hit: ['failedExit'], insight: ['squared'], metric: [['footwork', '<', 25]] },
    not: 'Backing straight up (or standing there) after a combination',
    do: 'Combination → pivot or L-step off the line → reset your stance',
    metric: 'footwork', constraint: 'exitEvery', finisher: 'then pivot out',
    ladder: [
      L('Pivot after the 1-2', 'Learn the exit', '1-2, then pivot 45° on your lead foot. Slowly, 10 reps each side, then keep flowing.', 25),
      L('L-step exits', 'Exit without backing straight up', '1-2-3, then L-step: one step back, one step to the side. Never straight back.', 32),
      L('Exit, reset, re-enter', 'Exit and come straight back', 'Combination → exit on an angle → re-enter with a jab straight away.', 38),
      L('Exits under pressure', 'Keep it when pushed', 'Picture him walking you down: every exit is an angle, and every third one goes to your weaker side.', 42),
    ],
  },
  flatFeet: {
    name: 'You plant your feet between punches', plain: 'standing still to punch',
    symptoms: { hit: ['distance', 'footworkError', 'overextended'], insight: ['flatFeet', 'wideStance'], metric: [['footwork', '<', 25]], decay: ['footwork'] },
    not: 'Standing still to punch and reaching for range',
    do: 'Small step in with the jab, step out after the last punch',
    metric: 'footwork', constraint: 'inOut', finisher: 'then step out',
    ladder: [
      L('Step-jab', 'Feet and hands together', 'Step in as the jab lands, step back out. Light and bouncy, 2 minutes.', 25),
      L('In-out 1-2', 'Attack from range and leave', 'Step in 1-2, step out. Never stay in range after the last punch.', 32),
      L('Rhythm and combos', 'Keep the feet alive', 'Stay on the balls of your feet between every combo; never flat-footed for more than a second.', 38),
      L('Range changes', 'Control distance', 'Every combination changes range: long jab, step in to hook range, step back out.', 42),
    ],
  },
  staticHead: {
    name: 'Your head stays on the centre line', plain: 'your head not moving',
    symptoms: { hit: ['headPosition', 'missedCounter'], insight: ['staticHead'], metric: [['headPerMin', '<', 12]] },
    not: 'Punching and staying right in front of him',
    do: 'Last punch → slip or roll → then punch again',
    metric: 'headPerMin', constraint: 'headMove', finisher: 'then slip',
    ladder: [
      L('Slip line', 'Head movement on its own', 'Slip left and right under a line or rope, no punches. Eyes forward.', 8),
      L('Punch then slip', 'Tie defence to offence', 'After every combination: slip or roll once.', 12),
      L('Slip-counter', 'Move and answer', 'Slip his imaginary jab, then counter 2-3. Roll under his hook, then 3-2.', 15),
      L('Defence after every combo', 'Make it automatic', 'Full-pace combinations, and every one ends with head movement. No exceptions.', 18),
    ],
  },
  gasTank: {
    name: 'Your technique breaks down when tired', plain: 'form falling apart as you tire',
    symptoms: { hit: ['fatigue'], insight: ['outputFade', 'lateGuardFade'], metric: [['guardFade', '>', 12]], fatigue: true },
    not: 'Going hard early, then dropping your hands and planting your feet',
    do: 'Breathe out on every punch, slow the pace down, keep the form',
    metric: 'guardFade', constraint: 'fatigueSim', finisher: 'breathe, hands home',
    ladder: [
      L('Short rounds, full form', 'Form first', 'Four 1-minute rounds at a pace where your form stays perfect.', 15),
      L('Two-minute rounds', 'Hold it longer', 'Same quality over 2 minutes: when form slips, slow down, don\'t stop.', 12),
      L('Rounds with bursts', 'Recover your form after a burst', '10-second all-out bursts, then straight back to clean technique.', 10),
      L('Fight pace', 'Keep it for a full fight', 'Full 3-minute rounds at fight pace, hands home in the last 30 seconds.', 8),
    ],
  },
  predictable: {
    name: "You're predictable", plain: 'always starting the same way',
    symptoms: { hit: ['rhythm'], insight: ['lightJab', 'oneHanded'], metric: [['opener', '>', 60]] },
    not: 'Opening with the same punch at the same rhythm every time',
    do: 'Change your first shot: feint, body jab, double jab or lead with the hook',
    metric: 'opener', constraint: 'rhythmBreak', finisher: null,
    ladder: [
      L('Three openers', 'Have more than one way in', 'Rotate three openers: jab, body jab, double jab. Never the same one twice in a row.', 60),
      L('Feint first', 'Make him guess', 'Every attack starts with a feint: shoulder, hand, foot or level change.', 52),
      L('Change the rhythm', 'Break the beat', 'Half-beat punches, pauses, doubled-up shots. Never the same tempo twice.', 46),
      L('Never repeat', 'Stay unreadable', 'No combination twice in a row for a whole round.', 40),
    ],
  },
  balance: {
    name: 'Your base gets narrow or crossed', plain: 'feet getting too close or crossed',
    symptoms: { insight: ['crossFeet', 'narrowStance'], metric: [['stance', '<', 70]] },
    not: 'Crossing your feet or letting them drift together',
    do: 'Step with the near foot first, then the other; shoulder-width always',
    metric: 'stance', constraint: 'jabFootwork', finisher: 'reset your feet',
    ladder: [
      L('Line drill', 'Feel the width', 'Tape or picture a line: keep one foot either side of it for a whole round.', 70),
      L('Step-drag every direction', 'Move without losing it', 'Step-drag forward, back, left, right: the near foot always moves first.', 75),
      L('Pivots holding width', 'Turn without losing it', 'Pivot both ways after combinations and land in your stance every time.', 80),
      L('Balance under combos', 'Keep it while punching', 'Long combinations while moving; check your base at the end of every one.', 84),
    ],
  },
};

// Coach notes tagged with a skill point at these roots.
const SKILL_ROOT = { defense: 'handsHome', angles: 'squareAfter', footwork: 'flatFeet', distance: 'flatFeet', headMovement: 'staticHead', conditioning: 'gasTank', rhythm: 'predictable', feints: 'predictable' };

// The biggest root problems, with the symptoms behind each. Needs a few sessions of evidence;
// a single symptom must be strong to count, so one odd session doesn't set the plan.
export function detectWeaknesses(state, ctx, now = new Date()) {
  const overridden = new Set((state.coach?.overrides || []).map((o) => o.key));
  const sessions = (state.sessions || []).filter((s) => s.type in BOXING_TYPES);
  const recentCam = sessions.filter((s) => cameraForm(s)).slice(-5);
  const found = {};
  const add = (root, weight, text, kind) => {
    if (!ROOTS[root] || overridden.has(`root:${root}`)) return;
    const f = (found[root] ||= { key: root, score: 0, symptoms: [] });
    f.score += weight;
    f.symptoms.push({ text, kind, weight: Math.round(weight * 10) / 10 });
  };

  for (const [root, def] of Object.entries(ROOTS)) {
    const sy = def.symptoms;
    if (ctx?.hits?.total >= 5) {
      for (const h of ctx.hits.shares || []) {
        if (h.pct >= 15 && sy.hit?.includes(h.key)) add(root, h.pct / 10, `${h.pct}% of the times you got hit: ${HIT_REASONS[h.key].name.toLowerCase()}`, 'hits');
      }
    }
    for (const k of sy.insight || []) {
      const v = state.memory?.insights?.[k];
      if (v?.count >= 2 && INSIGHTS[k]) add(root, 1 + Math.min(1.5, v.count * 0.3), `${INSIGHTS[k].text.replace(/\.$/, '')} (${v.count} sessions)`, 'habit');
    }
    if (recentCam.length >= 2) {
      for (const [key, op, lim] of sy.metric || []) {
        const vals = recentCam.map((s) => metricOf(s, key)).filter((v) => v != null);
        if (vals.length < 2) continue;
        const avg = round(mean(vals));
        const bad = op === '<' ? avg < lim : avg > lim;
        if (bad) add(root, 1.5 + Math.min(1.5, Math.abs(avg - lim) / Math.max(5, lim * 0.2)), `${METRICS[key].name}: ${avg}${METRICS[key].unit} over your last ${vals.length} camera sessions`, 'measured');
      }
    }
    for (const d of ctx?.decay || []) {
      if (d.kind === 'fatigue' && sy.fatigue) add(root, 2, d.text, 'fatigue');
      else if (sy.decay?.includes(d.dim) && d.kind !== 'fatigue') add(root, 1.5, d.text, 'measured');
    }
  }
  for (const o of (state.observations || []).filter((x) => x.source === 'coach' && x.kind === 'issue' && x.status !== 'resolved' && +now - +new Date(x.date) < 60 * DAY)) {
    const tag = (o.tags || [])[0];
    const hit = tag?.startsWith('hit:') ? tag.slice(4) : null;
    const root = hit ? Object.keys(ROOTS).find((r) => ROOTS[r].symptoms.hit?.includes(hit)) : SKILL_ROOT[tag];
    if (root) add(root, 3, `Your coach: "${o.text}"`, 'coach');
  }

  return Object.values(found)
    .filter((f) => f.score >= 2.5 || f.symptoms.some((s) => s.kind === 'coach'))
    .map((f) => {
      const def = ROOTS[f.key];
      f.symptoms.sort((a, b) => b.weight - a.weight);
      const lead = f.symptoms[0];
      // Symptom vs root, in one line: the thing you notice isn't the thing to fix.
      const explain = lead.kind === 'measured' || lead.kind === 'habit'
        ? `${def.name}. Seen as: ${f.symptoms.slice(0, 2).map((s) => s.text.charAt(0).toLowerCase() + s.text.slice(1)).join('; ')}.`
        : `${lead.text.replace(/^(\d+% of the times you got hit): /, 'Getting hit from ')} isn't the root problem; ${def.name.charAt(0).toLowerCase() + def.name.slice(1)}.`;
      return { ...f, name: def.name, plain: def.plain, explain, not: def.not, do: def.do, metric: def.metric, sources: new Set(f.symptoms.map((s) => s.kind)).size, score: Math.round(f.score * 10) / 10 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// "Do this, not that": has the replacement caught on since it was assigned?
export function adoption(state, root, now = new Date()) {
  const since = state.coach?.assigned?.[root];
  const key = ROOTS[root]?.metric;
  if (!since || !key) return null;
  const cam = (state.sessions || []).filter((s) => cameraForm(s) || s.comboCalls);
  const before = cam.filter((s) => s.date < since).slice(-5).map((s) => metricOf(s, key)).filter((v) => v != null);
  const after = cam.filter((s) => s.date >= since && +new Date(s.date) <= +now).map((s) => metricOf(s, key)).filter((v) => v != null);
  if (!after.length) return { sessions: 0, text: 'Not tested yet: do a camera session with this focus.' };
  const a = before.length ? round(mean(before)) : null, b = round(mean(after.slice(-3)));
  const m = METRICS[key];
  const target = ROOTS[root].ladder[0].target;
  const better = a == null ? null : m.better === 'up' ? b - a : a - b;
  const status = better == null ? (meets(key, b, target) ? 'good' : 'early') : better >= 5 ? 'taking' : better <= -5 ? 'worse' : 'flat';
  const word = { good: 'looking good', early: 'early days', taking: 'taking hold', worse: 'slipping', flat: 'not changed yet' }[status];
  return { sessions: after.length, before: a, after: b, status, text: `${m.name}: ${a != null ? `${a}${m.unit} → ` : ''}${b}${m.unit} over ${after.length} session${after.length === 1 ? '' : 's'}, ${word}.` };
}

// ---------------------------------------------------------------------------
// Drill ladder: level per root, moved by results.

export function levelOf(state, root) {
  return Math.min(4, Math.max(1, state.coach?.levels?.[root]?.level || 1));
}

export function drillFor(root, level, equipment = []) {
  const def = ROOTS[root];
  const d = def.ladder[level - 1];
  const onBag = equipment.includes('bag') || equipment.includes('gym');
  return {
    root, level, name: d.name, purpose: d.purpose,
    detail: `${d.detail} ${onBag ? 'Do it on the bag.' : 'Shadowbox it.'}`,
    success: { metric: def.metric, target: d.target, text: `${METRICS[def.metric].name} ${METRICS[def.metric].better === 'down' ? '≤' : '≥'} ${d.target}${METRICS[def.metric].unit}` },
    progression: def.ladder[level] ? `Next level: ${def.ladder[level].name}` : 'Top level: keep it here and add pace.',
    regression: level > 1 ? `Easier: ${def.ladder[level - 2].name}` : 'Easiest version: slow it right down.',
  };
}

// After a session: did the drill's success condition hold? Moves the ladder after two in a row.
export function evaluateCoached(session, coach) {
  if (!coach?.root) return null;
  const { metric, target } = drillFor(coach.root, coach.level).success;
  const value = metricOf(session, metric);
  const pass = meets(metric, value, target);
  const m = METRICS[metric];
  const text = value == null
    ? `${m.name} wasn't measured (camera off or out of frame), so the level stays.`
    : `${m.name}: ${value}${m.unit} (target ${METRICS[metric].better === 'down' ? '≤' : '≥'} ${target}${m.unit}): ${pass ? 'passed' : 'not yet'}.`;
  return { root: coach.root, level: coach.level, metric, target, value, pass, text };
}

export function applyEvaluation(coachState, ev, date = new Date().toISOString()) {
  const c = structuredClone(coachState || {});
  c.levels ||= {};
  c.assigned ||= {};
  if (!ev) return c;
  c.assigned[ev.root] ||= date;
  const l = (c.levels[ev.root] ||= { level: 1, pass: 0, fail: 0, history: [] });
  if (ev.pass == null) return c;
  l.history = [...(l.history || []), [date.slice(0, 10), ev.level, ev.value, ev.pass ? 1 : 0]].slice(-20);
  if (ev.pass) { l.pass++; l.fail = 0; } else { l.fail++; l.pass = 0; }
  if (l.pass >= 2 && l.level < 4) { l.level++; l.pass = 0; l.moved = 'up'; }
  else if (l.fail >= 2 && l.level > 1) { l.level--; l.fail = 0; l.moved = 'down'; }
  else l.moved = null;
  return c;
}

// ---------------------------------------------------------------------------
// Today's session from time, equipment and how the boxer feels.

export const EQUIPMENT = { none: 'Nothing', rope: 'Jump rope', bag: 'Heavy bag', gloves: 'Gloves', dumbbells: 'Dumbbells', gym: 'Full gym' };
export const FEELINGS = { great: 'Great', good: 'Good', tired: 'Tired', sore: 'Sore' };

function conditioningFor(eq, minutes) {
  if (eq.includes('rope') || eq.includes('gym')) return { name: 'Rope intervals', detail: `${Math.max(2, Math.round(minutes))} × 30 s fast / 30 s easy on the rope.` };
  if (eq.includes('bag')) return { name: 'Bag bursts', detail: `${Math.max(3, Math.round(minutes * 2))} × 15 s all-out straights / 15 s off.` };
  if (eq.includes('dumbbells')) return { name: 'Dumbbell circuit', detail: 'Thrusters, bent-over rows and light-weight shadowboxing: 40 s each, 20 s rest, repeat.' };
  return { name: 'Burpee–shadow ladder', detail: '5 burpees → 20 s fast straight punches, repeat. Keep your hands home in the punches.' };
}

// Technical quality over the last few measured sessions vs the ones before.
export function qualityTrend(sessions) {
  const v = sessions.filter((s) => s.scores?.overall != null && cameraForm(s)).map((s) => s.scores.overall);
  if (v.length < 5) return null;
  return Math.round(mean(v.slice(-3)) - mean(v.slice(-8, -3)));
}

export function daysSinceLast(sessions, now = new Date()) {
  const last = sessions.filter((s) => s.type in BOXING_TYPES || s.type === 'rope').map((s) => +new Date(s.date)).sort((a, b) => b - a)[0];
  return last ? Math.floor((+now - last) / DAY) : null;
}

export function benchmarkDue(sessions, now = new Date()) {
  const b = sessions.filter((s) => s.benchmark).map((s) => +new Date(s.date)).sort((a, c) => c - a)[0];
  if (!b) return sessions.filter((s) => cameraForm(s)).length >= 2;
  return +now - b >= 28 * DAY;
}

export function buildCoachSession({ state, ctx, minutes = 30, equipment = [], feel = 'good', now = new Date() }) {
  const sessions = state.sessions || [];
  const weaknesses = detectWeaknesses(state, ctx, now);
  const top = weaknesses[0] || null;
  const adjust = []; // what changed today, and why
  let volume = 1;
  let hardOk = true;

  const rec = ctx?.recovery;
  if (rec?.status === 'deload') { volume = Math.min(volume, 0.6); hardOk = false; adjust.push(`Recovery: ${rec.reasons[0] || 'your body needs a lighter week'}. Volume down 40%, no all-out work.`); }
  else if (rec?.status === 'strained') { volume = Math.min(volume, 0.75); hardOk = false; adjust.push(`Recovery: ${rec.reasons[0] || 'load is high'}. Lighter today, no all-out work.`); }
  const trend = qualityTrend(sessions);
  if (trend != null && trend <= -8) { volume = Math.min(volume, 0.7); hardOk = false; adjust.push(`Your technical quality dropped ${-trend} points over your last 3 measured sessions, so high-intensity work is cut by 30% today. Quality first.`); }
  const gap = daysSinceLast(sessions, now);
  if (gap != null && gap >= 5) { volume = Math.min(volume, gap >= 14 ? 0.65 : 0.8); adjust.push(`First session in ${gap} days: we pick up where you left off at a lighter volume. Nothing is lost.`); }
  if (feel === 'tired') { volume = Math.min(volume, 0.75); hardOk = false; adjust.push('You feel tired: shorter rounds of work, no all-out bursts.'); }
  if (feel === 'sore') { volume = Math.min(volume, 0.7); hardOk = false; adjust.push('You feel sore: no jumping or all-out work; technique and movement only.'); }

  const eq = equipment.length ? equipment : ['none'];
  const type = eq.includes('bag') || eq.includes('gym') ? 'bag' : 'shadow';
  const M = Math.max(10, Math.min(90, minutes));
  const warm = M <= 20 ? 3 : M <= 35 ? 5 : 8;
  const cool = M >= 30 ? 3 : 2;
  const level = top ? levelOf(state, top.key) - (gap >= 14 ? 1 : 0) : 1;
  const drill = top ? drillFor(top.key, Math.max(1, level), eq) : null;
  const drillMin = drill ? Math.max(3, Math.min(12, Math.round((M - warm - cool) * 0.3))) : 0;
  const condSlot = M >= 30 && top?.key !== 'gasTank' ? Math.min(8, Math.round(M * 0.15)) : 0;
  const condMin = hardOk ? condSlot : 0; // a lighter day drops it, it doesn't turn into more rounds
  const roundSec = M < 25 ? 120 : 180;
  const restSec = M < 25 ? 30 : 60;
  const roundsTime = Math.max(0, M - warm - cool - drillMin - condSlot) * volume;
  const nRounds = Math.max(1, Math.floor((roundsTime * 60 + restSec) / (roundSec + restSec)));

  // Rounds attack the root problems, weakest first; the last one tests it under fatigue.
  const cons = weaknesses.map((w) => ROOTS[w.key].constraint).filter((c) => CONSTRAINTS[c]);
  const rounds_ = Array.from({ length: nRounds }, (_, i) => {
    let constraint = cons[i % Math.max(1, cons.length)] || 'jabFootwork';
    let why = weaknesses[i % Math.max(1, weaknesses.length)] ? `Attacks: ${weaknesses[i % weaknesses.length].plain}` : 'Rhythm and range.';
    if (i === nRounds - 1 && nRounds >= 4 && hardOk && feel !== 'tired') { constraint = 'fatigueSim'; why = 'Last round: hold the fix while tired.'; }
    // No all-out bursts on a lighter day: keep the form work, drop the bursts.
    if (!hardOk && CONSTRAINTS[constraint].burst) { constraint = 'guardRecovery'; why = 'Form work without all-out bursts today.'; }
    return { round: i + 1, constraint, opponent: null, why };
  });

  const blocks = [];
  blocks.push({ kind: 'warmup', name: eq.includes('rope') || eq.includes('gym') ? 'Jump rope + mobility' : 'Shadow + mobility', minutes: warm, purpose: 'Get warm so the first round is quality.', detail: eq.includes('rope') || eq.includes('gym') ? 'Easy rope, then hips, shoulders and thoracic spine.' : 'Easy shadowboxing, then hips, shoulders and thoracic spine.' });
  if (drill) blocks.push({ kind: 'drill', name: `Drill: ${drill.name}`, minutes: drillMin, purpose: drill.purpose, detail: drill.detail, success: drill.success.text, progression: drill.progression, regression: drill.regression, why: top.explain });
  blocks.push({ kind: 'rounds', name: `${nRounds} × ${roundSec / 60} min ${type === 'bag' ? 'bag' : 'shadow'} rounds`, minutes: Math.round((nRounds * roundSec + (nRounds - 1) * restSec) / 60), purpose: top ? `Use the fix in real rounds: ${top.do.toLowerCase()}.` : 'Rounds so the camera can measure you.', detail: rounds_.map((r) => `R${r.round} ${CONSTRAINTS[r.constraint].name}`).join(' · '), why: top ? top.explain : null });
  if (condMin) {
    const c = conditioningFor(eq, condMin);
    blocks.push({ kind: 'conditioning', name: c.name, minutes: condMin, purpose: 'Build the engine that keeps your form late.', detail: c.detail });
  }
  blocks.push({ kind: 'cooldown', name: 'Cool-down', minutes: cool, purpose: 'Bring your heart rate down.', detail: 'Easy movement and slow breathing.' });

  const headline = top
    ? `Today we're working on ${top.plain} because ${top.symptoms[0].text.charAt(0).toLowerCase() + top.symptoms[0].text.slice(1)}.`
    : 'Today is a measuring session: I need a couple of camera sessions to find what holds you back.';

  return {
    minutes: blocks.reduce((a, b) => a + b.minutes, 0), asked: M, volume, feel, equipment: eq,
    weaknesses, top, drill, adjust, headline, blocks,
    benchmarkDue: benchmarkDue(sessions, now),
    live: {
      type, rounds: nRounds, roundSec, restSec, combos: true,
      comboLevel: !drill ? 2 : drill.level >= 3 ? 3 : drill.level === 2 ? 2 : 1,
      rounds_,
      coach: top ? { root: top.key, level: drill.level, finisher: ROOTS[top.key].finisher, metric: ROOTS[top.key].metric, drill: drill.name } : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Live: after each round, simplify, push harder, or switch the stimulus.

export function adjustNextRound({ form, first, calls = [], coach = null, comboLevel = 2 }) {
  const called = calls.length;
  const exact = calls.filter((c) => c[1] === 'exact').length;
  const rate = called >= 3 ? exact / called : null;
  const measured = form && form.frames > 30;
  const lvl = typeof comboLevel === 'number' ? comboLevel : 2;
  // Fatigue is wrecking the technique: stop adding difficulty, rebuild the guard.
  if (measured && first?.guard != null && form.guard != null && first.guard - form.guard >= 15) {
    return { action: 'switch', switchTo: 'guardRecovery', comboLevel: Math.max(1, lvl - 1), maxLen: 3, say: `Your guard dropped from ${first.guard} to ${form.guard} percent. Next round: guard recovery only, at 70 percent pace.` };
  }
  const key = coach?.metric;
  const target = coach ? drillFor(coach.root, coach.level).success.target : null;
  const value = measured && key && key !== 'guardFade' && key !== 'opener' ? form[key] : null;
  const ok = value == null ? null : meets(key, value, target);
  if ((rate != null && rate < 0.4) || ok === false) {
    const bits = [];
    if (rate != null && rate < 0.4) bits.push(`you threw ${exact} of ${called} called combos right`);
    if (ok === false) bits.push(`${METRICS[key].name.toLowerCase()} was ${value}${METRICS[key].unit.trim() === '%' ? ' percent' : ''}`);
    return { action: 'simplify', comboLevel: Math.max(1, lvl - 1), maxLen: 2, say: `Simplify: ${bits.join(' and ')}. Next round, two-punch combos${coach?.finisher ? `, and ${coach.finisher} every time` : ''}.` };
  }
  if ((rate == null || rate >= 0.75) && (ok === true || (ok == null && rate != null))) {
    return { action: 'progress', comboLevel: Math.min(3, lvl + 1), maxLen: null, say: 'That was clean. Harder next round: longer combinations.' };
  }
  return { action: 'keep', comboLevel: lvl, maxLen: null, say: null };
}

// Standard test every 4 weeks: same rounds, same calls, so results compare.
export const BENCHMARK = {
  type: 'shadow', rounds: 3, roundSec: 120, restSec: 60, combos: true, comboLevel: 2, benchmark: true,
  rounds_: [
    { round: 1, constraint: 'jabFootwork', opponent: null, why: 'Benchmark 1 of 3: jab and move.' },
    { round: 2, constraint: 'bodyHead', opponent: null, why: 'Benchmark 2 of 3: combinations.' },
    { round: 3, constraint: 'headMove', opponent: null, why: 'Benchmark 3 of 3: defence after every combo.' },
  ],
};

export function benchmarkResults(sessions) {
  const b = sessions.filter((s) => s.benchmark && cameraForm(s));
  if (!b.length) return null;
  const keys = ['guard', 'footwork', 'headPerMin', 'handReturnMs', 'callsExact'];
  const row = (s) => ({ date: s.date, ppm: outputPpm(s), ...Object.fromEntries(keys.map((k) => [k, metricOf(s, k)])) });
  return { first: row(b[0]), previous: b.length > 2 ? row(b[b.length - 2]) : null, latest: row(b[b.length - 1]), count: b.length, keys: ['ppm', ...keys] };
}

// ---------------------------------------------------------------------------
// Combinations built around the boxer: take what they already throw most (it's grooved) and bolt
// on the fix for each root problem, or a way to stop it being predictable.

const COMBO_FIX = {
  squareAfter: (c) => [`${c} pivot`, `Your ${c} ends square. Finish it with a pivot off the line.`],
  flatFeet: (c) => [`${c} step out`, `Throw your ${c}, then step out instead of standing there.`],
  staticHead: (c) => [`${c} slip 2`, `After your ${c}, slip and come back with a cross.`],
  handsHome: (c) => [c.split('-').slice(0, 2).join('-'), `Short and sharp: two punches, both hands home, then move.`],
  gasTank: (c) => [`${c} pause ${c}`, 'Same combo twice with a breath in between: hold the form on the second one.'],
  balance: () => ['1 pivot 2', 'Jab, pivot, cross: land in your stance after the pivot.'],
  predictable: (c) => [c.startsWith('1') ? `feint 3b-3` : `feint 1-2`, `You open with ${c.split('-')[0] === '1' ? 'the jab' : 'the same punch'} most of the time. Start with a feint and a different first shot.`],
};

export function personalCombos(state, weaknesses, parse, text) {
  const seqCount = {};
  for (const s of (state.sessions || []).slice(-10)) for (const [k, n] of Object.entries(s.form?.sequences || {})) if (k.includes('-')) seqCount[k] = (seqCount[k] || 0) + n;
  const grooved = Object.entries(seqCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '1-2';
  const saved = new Set((state.combos || []).map((c) => text(c.tokens)));
  const out = [];
  for (const w of weaknesses) {
    const f = COMBO_FIX[w.key];
    if (!f) continue;
    const [src, why] = f(grooved);
    const tokens = parse(src);
    if (!tokens || saved.has(text(tokens)) || out.some((o) => text(o.tokens) === text(tokens))) continue;
    out.push({ tokens, why, root: w.key });
  }
  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Beginner setup: plain questions in, boxing settings out.

export const ONBOARD = {
  want: { defend: 'Defend myself', punch: 'Hit harder and faster', fitness: 'Get fit', fight: 'Get ready for a fight' },
  experience: { new: "I'm new to boxing", some: "I've trained a bit", lots: "I've trained a lot" },
  hand: { right: 'Right', left: 'Left' },
};

export function applyOnboarding(profile, answers) {
  return {
    ...profile,
    goal: { defend: 'self-defence', punch: 'technique', fitness: 'fitness', fight: 'compete' }[answers.want] || profile.goal,
    level: { new: 'beginner', some: 'intermediate', lots: 'advanced' }[answers.experience] || profile.level,
    stance: answers.hand === 'left' ? 'southpaw' : 'orthodox',
    weeklyGoal: Math.min(7, Math.max(1, +answers.days || profile.weeklyGoal || 3)),
    onboarded: true,
  };
}
