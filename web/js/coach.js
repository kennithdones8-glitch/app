// The coach: scores sessions, writes feedback, remembers recurring habits,
// picks what to work on next, and suggests the next workout. Pure logic, no DOM.

export const BOXING_TYPES = {
  shadow: 'Shadowboxing',
  bag: 'Heavy bag',
  mitts: 'Mitts / pads',
  sparring: 'Sparring',
};

export const OTHER_TYPES = {
  rope: 'Jump rope',
  run: 'Roadwork / run',
  strength: 'Strength',
  conditioning: 'Conditioning',
  mobility: 'Mobility / recovery',
};

export const ALL_TYPES = { ...BOXING_TYPES, ...OTHER_TYPES };

export const AREAS = {
  guard: 'Guard',
  stance: 'Stance',
  blade: 'Bladed stance',
  footwork: 'Footwork',
  head: 'Head movement',
  handReturn: 'Hand return',
  output: 'Output',
};

// Score (0-100) below which an area needs work.
export const TARGETS = { guard: 80, stance: 80, blade: 75, footwork: 60, head: 55, handReturn: 70, output: 70 };

const PPM_TARGET = { beginner: 40, intermediate: 60, advanced: 80 };

export const DRILLS = {
  guard: [
    'Shadowbox 2 rounds touching your gloves to your cheekbones after every punch.',
    'Tennis-ball-under-chin drill: 1 round of jabs without dropping the ball.',
    'Partner/mirror check: freeze on every beep and check both hands are at eye level.',
  ],
  stance: [
    'Stance-and-step: 3 min of step-drag forward/back keeping feet shoulder-width apart.',
    'Tape a line on the floor and keep your feet either side of it for a full round.',
  ],
  blade: [
    'Stand side-on to a mirror, lead shoulder pointed at the target, jab 50 times holding the angle.',
    'Pivot drill: pivot on the lead foot 20 times each way, finishing bladed every time.',
  ],
  footwork: [
    'Box-step drill: 4 steps around a square, punch at each corner, 2 rounds.',
    'Jump rope 3x2 min, staying on the balls of your feet.',
    'Angle-out drill: throw a 1-2 then step off at 45° every time.',
  ],
  head: [
    'Slip-rope: 3 rounds slipping and rolling under a rope line.',
    'Every combo ends with a slip or roll — punch, then move your head.',
  ],
  handReturn: [
    'Snap jabs: 3x30 jabs as fast back as out; the return is the punch.',
    'Resistance-band jabs: 2 rounds, focus on pulling the hand straight back to the face.',
  ],
  output: [
    'Tabata punches: 8 x 20s all-out straights / 10s rest.',
    'Add one round to your next session and keep punches per minute steady.',
  ],
};

// ---------------------------------------------------------------------------
// Scoring

export function outputPpm(session) {
  const workMin = (session.workSec || 0) / 60;
  if (!workMin || !session.punches?.total) return null;
  return Math.round(session.punches.total / workMin);
}

export function returnScore(ms) {
  if (ms == null) return null;
  // <=350ms is excellent, >=1100ms is poor.
  return clamp(Math.round(100 - ((ms - 350) / 750) * 100), 0, 100);
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function scoreSession(session, profile = {}) {
  const scores = {};
  const f = session.form;
  if (f) {
    scores.guard = f.guard;
    scores.stance = f.stance;
    scores.blade = f.blade;
    scores.footwork = f.footwork == null ? null : clamp(Math.round(f.footwork * 1.6), 0, 100);
    scores.head = f.head == null ? null : clamp(Math.round(f.head * 1.6), 0, 100);
    scores.handReturn = returnScore(f.handReturnMs);
  }
  const ppm = outputPpm(session);
  if (ppm != null && session.type !== 'sparring') {
    const target = PPM_TARGET[profile.level] || PPM_TARGET.beginner;
    scores.output = clamp(Math.round((ppm / target) * 100), 0, 100);
  }
  for (const k of Object.keys(scores)) if (scores[k] == null) delete scores[k];
  const vals = Object.values(scores);
  scores.overall = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  return scores;
}

// ---------------------------------------------------------------------------
// Pattern detection: habits seen in one session. The memory counts repeats.

export const INSIGHTS = {
  lateGuardFade: { area: 'guard', text: 'Your guard drops as you get tired in later rounds.' },
  outputFade: { area: 'output', text: 'Your punch output fades in the last round — conditioning is limiting you.' },
  rearDrop: { area: 'guard', text: 'Your rear hand drops when you throw the jab.' },
  crossFeet: { area: 'stance', text: 'You cross your feet when moving.' },
  narrowStance: { area: 'stance', text: 'Your feet get too close together.' },
  wideStance: { area: 'stance', text: 'Your stance gets too wide, which slows your feet.' },
  squared: { area: 'blade', text: 'You square up to your opponent instead of staying bladed.' },
  flatFeet: { area: 'footwork', text: 'You plant your feet and stop moving between punches.' },
  staticHead: { area: 'head', text: 'Your head stays on the centre line too long.' },
  slowReturn: { area: 'handReturn', text: 'Your hands are slow to come back to your face after punching.' },
  lightJab: { area: 'output', text: "You don't lead with the jab enough." },
  oneHanded: { area: 'output', text: 'You rely heavily on one hand.' },
};

export function detectPatterns(session) {
  const found = [];
  const f = session.form;
  if (f) {
    const rounds = (f.perRound || []).filter((r) => r.frames > 0);
    if (rounds.length >= 3) {
      const first = rounds[0].guard, last = rounds[rounds.length - 1].guard;
      if (first != null && last != null && first - last >= 15) found.push('lateGuardFade');
    }
    if (f.rearDropPct != null && f.rearDropPct >= 25) found.push('rearDrop');
    if (f.crossedPct != null && f.crossedPct >= 5) found.push('crossFeet');
    if (f.narrowPct != null && f.narrowPct >= 25) found.push('narrowStance');
    if (f.widePct != null && f.widePct >= 25) found.push('wideStance');
    if (f.blade != null && f.blade < 60) found.push('squared');
    if (f.footwork != null && f.footwork < 30 && session.type !== 'bag') found.push('flatFeet');
    if (f.head != null && f.head < 25) found.push('staticHead');
    if (f.handReturnMs != null && f.handReturnMs > 650) found.push('slowReturn');
  }
  const per = session.punches?.perRound || [];
  if (per.length >= 3 && per[0] >= 20 && per[per.length - 1] < per[0] * 0.7) found.push('outputFade');
  // Punch mix on pads or in a drilled combo is set by the holder or the combo, not your habits.
  const by = session.type === 'mitts' || session.calib?.labels ? null : session.punches?.byType;
  if (by) {
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    if (total >= 40) {
      const lead = by.jab + by.leadHook + by.leadUppercut;
      if (by.jab / total < 0.2) found.push('lightJab');
      if (lead / total > 0.75 || lead / total < 0.25) found.push('oneHanded');
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Memory

export function emptyMemory() {
  return {
    ema: {},
    analyzed: 0,
    insights: {},
    resolved: [],
    focus: null,
    prs: {},
    streak: { count: 0, lastDay: null },
  };
}

const EMA_ALPHA = 0.35;
const RESOLVE_AFTER = 4; // analysed sessions without seeing a habit

function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
}

export function updateMemory(prev, session, profile = {}) {
  const mem = structuredClone(prev || emptyMemory());
  const today = dayKey(session.date);
  const events = { newPRs: [], resolved: [], confirmed: [] };

  // Streak counts consecutive days with any training.
  // A back-dated session (an old video, yesterday's gym logged today) doesn't touch the streak.
  if (mem.streak.lastDay !== today && !(mem.streak.lastDay && today < mem.streak.lastDay)) {
    const gap = mem.streak.lastDay ? daysBetween(mem.streak.lastDay, today) : null;
    mem.streak.count = gap === 1 ? mem.streak.count + 1 : 1;
    mem.streak.lastDay = today;
  }

  const boxing = session.type in BOXING_TYPES;
  if (!boxing) return { memory: mem, events };

  const scores = session.scores || scoreSession(session, profile);
  for (const [k, v] of Object.entries(scores)) {
    if (k === 'overall' || v == null) continue;
    mem.ema[k] = mem.ema[k] == null ? v : Math.round(mem.ema[k] * (1 - EMA_ALPHA) + v * EMA_ALPHA);
  }

  const analyzed = session.form != null || session.punches?.total > 0;
  if (analyzed) {
    mem.analyzed++;
    const seen = detectPatterns(session);
    for (const key of seen) {
      const cur = mem.insights[key] || { count: 0, firstSeen: session.date };
      cur.count++;
      cur.lastSeen = session.date;
      cur.lastSeenAt = mem.analyzed;
      if (cur.count === 2) events.confirmed.push(key);
      mem.insights[key] = cur;
    }
    for (const [key, info] of Object.entries(mem.insights)) {
      if (seen.includes(key)) continue;
      if (info.count >= 2 && mem.analyzed - info.lastSeenAt >= RESOLVE_AFTER) {
        mem.resolved.unshift({ key, date: session.date });
        mem.resolved = mem.resolved.slice(0, 20);
        delete mem.insights[key];
        events.resolved.push(key);
      } else if (info.count < 2 && mem.analyzed - info.lastSeenAt >= RESOLVE_AFTER) {
        delete mem.insights[key]; // one-off, forget it
      }
    }
  }

  // Personal records.
  const ppm = outputPpm(session);
  const checks = [
    ['mostPunches', session.punches?.total, 'Most punches in a session'],
    ['bestPpm', ppm, 'Best punches per minute'],
    ['bestForm', scores.overall, 'Best overall score'],
    ['mostRounds', session.completedRounds, 'Most rounds completed'],
  ];
  for (const [key, val, label] of checks) {
    if (val == null || val <= 0) continue;
    if (mem.prs[key] == null || val > mem.prs[key].value) {
      if (mem.prs[key] != null) events.newPRs.push(label);
      mem.prs[key] = { value: val, date: session.date, label };
    }
  }

  mem.focus = pickFocus(mem, session.date);
  return { memory: mem, events };
}

// The focus sticks for a few sessions so you actually work on it, then moves on
// once the area reaches its target.
export function pickFocus(mem, date = new Date().toISOString()) {
  const cur = mem.focus;
  const gaps = Object.entries(mem.ema)
    .filter(([k]) => k in TARGETS)
    .map(([k, v]) => {
      const repeats = Object.entries(INSIGHTS).filter(([key, i]) => i.area === k && mem.insights[key]?.count >= 2).length;
      return { area: k, gap: TARGETS[k] - v + repeats * 8 };
    })
    .sort((a, b) => b.gap - a.gap);
  if (!gaps.length) return cur || null;
  if (cur && mem.ema[cur.area] != null && mem.ema[cur.area] < TARGETS[cur.area] && cur.sessions < 4) {
    return { ...cur, sessions: cur.sessions + 1 };
  }
  const next = gaps.find((g) => g.gap > 0) || gaps[0];
  if (cur && cur.area === next.area) return { ...cur, sessions: cur.sessions + 1 };
  return { area: next.area, since: date, sessions: 1 };
}

// ---------------------------------------------------------------------------
// Feedback

export function feedback(session, history, mem, profile = {}) {
  const wins = [];
  const fixes = [];
  const scores = session.scores || scoreSession(session, profile);
  const prevBoxing = history.filter((s) => s.id !== session.id && s.type in BOXING_TYPES && s.scores).slice(-5);

  if (!(session.type in BOXING_TYPES)) {
    const mins = session.durationMin || Math.round((session.workSec || 0) / 60);
    wins.push(`${mins} min of ${ALL_TYPES[session.type] || session.type} logged — this builds the engine your boxing runs on.`);
    return { wins, fixes, drills: [] };
  }

  if (session.completedRounds && session.plan && session.completedRounds >= session.plan.rounds) {
    wins.push(`Finished all ${session.plan.rounds} rounds.`);
  }

  // Compare each area with your recent average.
  for (const area of Object.keys(AREAS)) {
    const v = scores[area];
    if (v == null) continue;
    const past = prevBoxing.map((s) => s.scores[area]).filter((x) => x != null);
    const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;
    if (avg != null && v - avg >= 8) wins.push(`${AREAS[area]} up ${Math.round(v - avg)} points on your recent average (${v}).`);
    else if (v >= TARGETS[area] + 10) wins.push(`${AREAS[area]} is solid at ${v}.`);
    if (avg != null && avg - v >= 10) fixes.push(`${AREAS[area]} slipped to ${v} (you usually sit around ${Math.round(avg)}).`);
  }

  const f = session.form;
  if (f) {
    if (f.guard != null && f.guard < TARGETS.guard) fixes.push(`Hands were up ${f.guard}% of the time between punches. Aim for 80%+.`);
    if (f.rearDropPct != null && f.rearDropPct >= 25) fixes.push(`Your rear hand dropped on ${f.rearDropPct}% of lead-hand punches.`);
    if (f.crossedPct != null && f.crossedPct >= 5) fixes.push(`Feet crossed ${f.crossedPct}% of the time — step with the foot closest to where you're going.`);
    if (f.narrowPct != null && f.narrowPct >= 25) fixes.push('Stance got too narrow — keep feet roughly shoulder-width for balance.');
    if (f.widePct != null && f.widePct >= 25) fixes.push('Stance got too wide — it roots you in place.');
    if (f.blade != null && f.blade < 60) fixes.push('You squared up a lot — keep your lead shoulder turned toward the target.');
    if (f.handReturnMs != null && f.handReturnMs > 650) fixes.push(`Hands took ~${f.handReturnMs}ms to get back to your face. Snap them back.`);
    else if (f.handReturnMs != null && f.handReturnMs <= 450) wins.push(`Fast hand return (~${f.handReturnMs}ms).`);
    if (f.footwork != null && f.footwork < 30 && session.type !== 'bag') fixes.push('You stood still a lot — move after every combination.');
  }

  const per = session.punches?.perRound || [];
  if (per.length >= 3 && per[0] >= 20) {
    const drop = Math.round((1 - per[per.length - 1] / per[0]) * 100);
    if (drop >= 30) fixes.push(`Output dropped ${drop}% from round 1 to the last round — pace yourself or build conditioning.`);
    else if (drop <= 10) wins.push('You kept your output steady through the last round.');
  }

  // Memory: habits that keep coming back go to the top of the list.
  const recurring = [];
  for (const key of detectPatterns(session)) {
    const seen = mem?.insights?.[key]?.count || 0;
    if (seen >= 2) recurring.push(`Recurring: ${INSIGHTS[key].text} (seen in ${seen} sessions)`);
  }
  fixes.unshift(...recurring);

  const focusArea = mem?.focus?.area;
  const drills = focusArea ? DRILLS[focusArea].slice(0, 2) : [];
  if (!wins.length) wins.push('You showed up and put the work in. That compounds.');
  return { wins: dedupe(wins), fixes: dedupe(fixes).slice(0, 6), drills };
}

function dedupe(a) {
  return [...new Set(a)];
}

// ---------------------------------------------------------------------------
// Next-workout suggestion

export function suggestWorkout(history, mem, profile = {}, now = new Date()) {
  const boxing = history.filter((s) => s.type in BOXING_TYPES && !s.manual);
  const last = history[history.length - 1];
  const hoursSince = last ? (now - new Date(last.date)) / 3600000 : Infinity;
  const level = profile.level || 'beginner';
  const base = { beginner: 3, intermediate: 5, advanced: 8 }[level];
  const focus = mem?.focus?.area || null;

  if (last && hoursSince < 20 && (last.rpe || 0) >= 9) {
    return {
      type: 'shadow', rounds: 3, roundSec: 120, restSec: 60, comboLevel: 1, focus,
      reason: 'Your last session was brutal. Easy technical shadowboxing today to recover while you drill your focus.',
    };
  }

  const lastBox = boxing[boxing.length - 1];
  let rounds = lastBox?.plan?.rounds || base;
  let reason = lastBox ? `Built from your last ${ALL_TYPES[lastBox.type].toLowerCase()} session.` : 'A starting point for your level.';
  if (lastBox && lastBox.completedRounds >= lastBox.plan.rounds && (lastBox.rpe || 7) <= 7) {
    rounds = Math.min(12, rounds + 1);
    reason = 'You finished every round last time with gas left — adding a round.';
  } else if (lastBox && lastBox.completedRounds < lastBox.plan.rounds) {
    rounds = Math.max(2, lastBox.completedRounds);
    reason = "You didn't finish every round last time — let's own this many first.";
  }

  const sessionsDone = boxing.length;
  const comboLevel = sessionsDone < 5 ? 1 : sessionsDone < 15 ? 2 : 3;
  const type = focus === 'footwork' || focus === 'head' || focus === 'blade' ? 'shadow' : lastBox?.type || 'shadow';
  if (focus) reason += ` Focus: ${AREAS[focus].toLowerCase()}.`;
  return {
    type, rounds, roundSec: level === 'beginner' ? 120 : 180, restSec: 60, comboLevel, focus, reason,
  };
}

// ---------------------------------------------------------------------------
// Combo caller

const COMBOS = {
  1: ['1', '1, 1', '1, 2', '2', '1, 2, 1', '1, 1, 2', 'Double jab, step back'],
  2: ['1, 2, 3', '1, 2, 3, 2', '2, 3, 2', '1, 6, 3, 2', '3, 2', '1, 2, slip, 2', '5, 2', '1, 1, 2, 3'],
  3: ['1, 2, 3, 2, pivot', '1, 2, 5, 2, 3', '3, 3, 2', '2, 3, 6, 3', '1, 2, roll, 3, 2', '1, 6, 3, 2, slip slip', '4, 3, 2', 'Slip, 2, 3, 2, step out'],
};

const FOCUS_ADDONS = {
  guard: ['hands home', 'reset your guard'],
  footwork: ['step out', 'pivot', 'circle away'],
  head: ['slip', 'roll', 'slip, slip'],
  blade: ['pivot', 'turn the shoulder'],
  stance: ['step out', 'reset your stance'],
  handReturn: ['snap it back'],
  output: ['double up', 'throw three more'],
};

export function nextCombo(level = 1, focus = null, rand = Math.random) {
  const pool = [];
  for (let l = 1; l <= level; l++) pool.push(...COMBOS[l]);
  let combo = pool[Math.floor(rand() * pool.length)];
  if (focus && FOCUS_ADDONS[focus] && rand() < 0.5) {
    const add = FOCUS_ADDONS[focus];
    combo += `, ${add[Math.floor(rand() * add.length)]}`;
  }
  return combo;
}

export function comboToSpeech(combo) {
  const words = { 1: 'jab', 2: 'cross', 3: 'hook', 4: 'rear hook', 5: 'uppercut', 6: 'rear uppercut' };
  return combo.replace(/\b([1-6])\b/g, (m) => words[m]);
}

// ---------------------------------------------------------------------------
// Weekly stats for the dashboard

export function weekSummary(history, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
  const week = history.filter((s) => new Date(s.date) >= start);
  const minutes = week.reduce((a, s) => a + (s.durationMin || Math.round((s.totalSec || s.workSec || 0) / 60)), 0);
  const punches = week.reduce((a, s) => a + (s.punches?.total || 0), 0);
  const days = new Set(week.map((s) => dayKey(s.date))).size;
  return { sessions: week.length, minutes, punches, days };
}
