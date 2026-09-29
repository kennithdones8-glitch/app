// Weekly training plan and bodyweight tracking for a competing boxer. Pure logic, no DOM.
import { BOXING_TYPES, AREAS } from './coach.js';

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function localDay(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function weekStart(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function weekKey(d = new Date()) {
  return localDay(weekStart(d));
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// ---------------------------------------------------------------------------
// Training phase (only when a fight date is set)

export function phaseFor(profile = {}, now = new Date()) {
  const date = profile.fightDate ? new Date(profile.fightDate + 'T12:00:00') : null;
  if (!date || date < weekStart(now)) {
    return {
      key: 'base', name: 'Competitive base', volume: 1, camp: false,
      note: 'Building your engine and fixing habits so you are always close to fight-ready.',
      priorities: ['Fix your biggest recurring problem', 'Build skills you are underexposed to', 'Aerobic base'],
    };
  }
  const days = Math.round((date - now) / 86400000);
  const weeksOut = Math.max(0, Math.round(days / 7));
  const base = { weeksOut, days, camp: true };
  if (days <= 7) {
    return { ...base, key: 'taper', name: 'Fight week · taper', volume: 0.6, note: 'Sharpness and recovery. Short, crisp sessions; no new skills; no hard sparring.', priorities: ['Sharpness', 'Recovery', 'Make weight safely'] };
  }
  if (days <= 21) {
    return { ...base, key: 'specific', name: 'Fight camp · fight-specific', volume: 0.9, note: 'Fight-specific intensity at full fight length. Cut every bit of unnecessary volume.', priorities: ['Fight-pace rounds', 'Game plan vs your opponent', 'Reduced volume'] };
  }
  if (days <= 35) {
    return { ...base, key: 'tactical', name: 'Fight camp · tactical', volume: 1.05, note: 'Tactical development and specific conditioning: rounds built around your opponent’s style.', priorities: ['Opponent-specific tactics', 'Specific conditioning', 'Sparring quality'] };
  }
  if (days <= 56) {
    return { ...base, key: 'camp', name: 'Fight camp · base', volume: 1.1, note: 'Skill acquisition, conditioning base and volume. The hardest training block.', priorities: ['Skill acquisition', 'Conditioning base', 'Volume'] };
  }
  return { ...base, camp: false, key: 'build', name: 'Pre-camp build', volume: 1, note: 'Develop skills and the engine before camp starts at 8 weeks out.', priorities: ['Skill development', 'Strength', 'Aerobic base'] };
}

// ---------------------------------------------------------------------------
// Session templates

const LOAD = { hard: 3, moderate: 2, easy: 1, rest: 0 };

// Priority when filling free days (lower index = more important).
const PRIORITY = ['fightSim', 'shadowTech', 'intervals', 'strength', 'bagVolume', 'easyRun', 'mobility'];

function templates(profile, memory, phase, adjust) {
  const fight = profile.fight || { rounds: 6, roundSec: 180, restSec: 60 };
  const focus = memory?.focus?.area;
  const bestPpm = memory?.prs?.bestPpm?.value;
  const vol = (n) => Math.max(2, Math.round(n * phase.volume) - adjust);
  const simRounds = phase.key === 'camp' || phase.key === 'tactical' ? fight.rounds + 1 : phase.key === 'taper' ? Math.max(2, Math.ceil(fight.rounds / 2)) : fight.rounds;
  const pace = bestPpm ? Math.round(bestPpm * 0.85) : null;
  const min = Math.round(fight.roundSec / 60 * 10) / 10;

  return {
    fightSim: {
      title: 'Fight simulation · bag', load: 'hard', category: 'boxing',
      detail: `${vol(simRounds)} × ${min} min at fight pace, ${fight.restSec}s rest. Treat every round like it's scored.${pace ? ` Hold ${pace}+ punches/min to the final bell.` : ''}`,
      preset: { type: 'bag', rounds: vol(simRounds), roundSec: fight.roundSec, restSec: fight.restSec, tracking: 'motion', comboLevel: 3 },
    },
    bagVolume: {
      title: 'Power & volume · bag', load: 'hard', category: 'boxing',
      detail: `${vol(Math.min(12, fight.rounds + 2))} × 3 min. Odd rounds: sit down on power shots. Even rounds: non-stop volume.`,
      preset: { type: 'bag', rounds: vol(Math.min(12, fight.rounds + 2)), roundSec: 180, restSec: 60, tracking: 'motion', comboLevel: 3 },
    },
    shadowTech: {
      title: `Technique · shadowboxing${focus ? ` (${AREAS[focus].toLowerCase()})` : ''}`, load: 'moderate', category: 'boxing',
      detail: `${vol(5)} × 3 min with the camera coach${focus ? `, focused on ${AREAS[focus].toLowerCase()}` : ''}. Crisp, relaxed, perfect reps.`,
      preset: { type: 'shadow', rounds: vol(5), roundSec: 180, restSec: 60, tracking: 'camera', comboLevel: 3, focus: focus || null },
    },
    intervals: {
      title: 'Fight-pace intervals · run', load: 'hard', category: 'run',
      detail: `10 min easy, then ${fight.rounds} × ${min} min hard / ${fight.restSec}s walk, 10 min cool-down. Mirrors your fight's rounds.`,
    },
    easyRun: {
      title: 'Easy roadwork', load: 'easy', category: 'run',
      detail: '30–40 min at conversational pace. Builds the aerobic base that lets you recover between rounds.',
    },
    strength: {
      title: 'Strength & power', load: 'moderate', category: 'strength',
      detail: 'Trap-bar deadlift or squat 4×4, split squats 3×6, push-ups or bench 3×6, rows 3×8, rotational med-ball throws 4×5 each side, core. Leave 2 reps in the tank.',
    },
    mobility: {
      title: 'Mobility & recovery', load: 'easy', category: 'mobility',
      detail: '20–30 min: hips, thoracic spine, shoulders, plus a walk. Keeps you fresh for the hard days.',
    },
    gym: {
      title: 'Boxing gym', load: 'hard', category: 'boxing',
      detail: 'Coach-led session. Log it afterwards with effort and notes (who you sparred, what worked).',
    },
    rest: { title: 'Rest', load: 'rest', category: 'rest', detail: 'Full rest. Sleep, eat well, hydrate.' },
  };
}

// ---------------------------------------------------------------------------
// Load / readiness signals

export function recentLoad(sessions, now = new Date()) {
  const since = addDays(now, -7);
  const recent = sessions.filter((s) => new Date(s.date) >= since && new Date(s.date) <= now && s.rpe);
  const avgRpe = recent.length ? recent.reduce((a, s) => a + s.rpe, 0) / recent.length : null;
  return { avgRpe, count: recent.length };
}

// ---------------------------------------------------------------------------
// Build the week

// `fromDay` (0 = Mon) is the first day to schedule; earlier days keep `keep` items (from the
// previous version of this week's plan) so rebuilding mid-week never rewrites the past.
export function buildWeek({ profile = {}, memory = {}, sessions = [], weights = [], gymDays = [], lastWeek = null, now = new Date(), fromDay = 0, keep = [], recovery = null, interventions = [] }) {
  const start = weekStart(now);
  const deload = recovery?.status === 'deload';
  const basePhase = phaseFor(profile, now);
  const phase = deload ? { ...basePhase, volume: basePhase.volume * 0.7 } : basePhase;
  const notes = [];
  const gym = [...new Set(gymDays)].filter((d) => d >= 0 && d <= 6).sort();

  // Adapt to how the previous week went.
  let adjust = 0;
  if (lastWeek && lastWeek.planned >= 3 && lastWeek.done / lastWeek.planned < 0.6) {
    adjust = 1;
    notes.push(`Last week you completed ${lastWeek.done} of ${lastWeek.planned} sessions — trimmed a round off the bag work so this week is doable.`);
  }
  const load = recentLoad(sessions, now);
  const overreached = deload || (load.avgRpe != null && load.avgRpe >= 8.5 && load.count >= 3);
  if (deload) notes.push(`Deload week: ${recovery.reasons[0] || 'recovery markers are down'} Volume cut ~30% and one hard day swapped for easy work.`);
  if (overreached && !deload) notes.push(`Your effort has averaged ${load.avgRpe.toFixed(1)}/10 this past week — swapped one hard session for easy roadwork to let you absorb the work.`);

  const T = templates(profile, memory, phase, adjust);
  const trainingDays = Math.min(7, Math.max(gym.length, profile.weeklyGoal || 6));
  const past = keep.filter((i) => i.day < fromDay && i.kind !== 'gym');
  const pastTrained = new Set([...past.filter((i) => i.kind !== 'rest').map((i) => i.day), ...gym.filter((d) => d < fromDay)]).size;
  const future = [0, 1, 2, 3, 4, 5, 6].filter((d) => d >= fromDay);
  const free = future.filter((d) => !gym.includes(d));
  const futureGym = gym.filter((d) => d >= fromDay).length;
  const wantFree = Math.max(0, trainingDays - pastTrained - futureGym);
  const restCount = Math.max(0, free.length - wantFree);

  // Pick rest days: prefer Sunday and days next to gym days.
  const restScore = (d) => (d === 6 ? 2 : 0) + (gym.includes(d - 1) ? 1 : 0) + (gym.includes(d + 1) ? 1 : 0) + (d === 3 ? 0.5 : 0);
  const restDays = [...free].sort((a, b) => restScore(b) - restScore(a) || b - a).slice(0, restCount);
  const trainFree = free.filter((d) => !restDays.includes(d));

  // Queue of sessions for free days, most important first (skipping what's already been scheduled this week).
  const already = new Set(past.map((i) => i.kind));
  let queue = PRIORITY.filter((k) => !already.has(k));
  if (gym.length >= 3) queue = queue.filter((k) => k !== 'bagVolume').concat('bagVolume'); // gym already gives bag volume
  if (phase.key === 'taper') queue = queue.filter((k) => !['bagVolume', 'intervals'].includes(k)).concat(['easyRun', 'mobility']);
  if (phase.key === 'specific') queue = queue.filter((k) => k !== 'bagVolume').concat('mobility');
  if (phase.key === 'camp') queue = ['fightSim', 'bagVolume', ...queue.filter((k) => k !== 'fightSim' && k !== 'bagVolume')];
  const focus = memory?.focus?.area;
  if (focus === 'output') queue = ['fightSim', 'bagVolume', ...queue.filter((k) => k !== 'fightSim' && k !== 'bagVolume')];

  const byDay = Array.from({ length: 7 }, () => []);
  for (const d of gym) byDay[d].push('gym');
  if (fromDay > 0) notes.push(`Planned from ${DAY_NAMES[fromDay]} onward.`);
  for (const d of restDays) byDay[d].push('rest');

  const loadOf = (d) => (d < 0 || d > 6 ? 0 : Math.max(0, ...byDay[d].map((k) => LOAD[T[k].load])));
  for (const d of trainFree) {
    const prevHard = loadOf(d - 1) >= 3;
    const nextHard = gym.includes(d + 1);
    let idx = queue.findIndex((k) => !((prevHard || nextHard) && T[k].load === 'hard'));
    if (idx < 0) idx = 0;
    const kind = queue.length ? queue.splice(idx, 1)[0] : 'easyRun';
    byDay[d].push(kind);
  }

  // Too much accumulated fatigue: the least important hard free-day session becomes easy roadwork.
  if (overreached) {
    const placed = trainFree.map((d) => [d, byDay[d][0]]).filter(([, k]) => T[k].load === 'hard');
    placed.sort((a, b) => PRIORITY.indexOf(b[1]) - PRIORITY.indexOf(a[1]));
    if (placed.length) byDay[placed[0][0]] = ['easyRun'];
  }

  // Weight: behind target → extra easy roadwork on a gym day morning.
  const ws = weightStats(weights, profile, now);
  if (ws?.status === 'behind') {
    const d = gym.find((x) => x >= fromDay) ?? trainFree.find((x) => byDay[x].every((k) => T[k].load !== 'hard'));
    if (d != null) {
      byDay[d].unshift('easyRun');
      notes.push('Weight is trending above target — added an extra easy morning run.');
    }
  }

  // Running experiments change the prescription (e.g. defense drills straight after conditioning).
  const after = interventions.filter((iv) => iv.planBlock);
  if (after.length) {
    for (const k of ['fightSim', 'bagVolume', 'intervals']) {
      T[k] = { ...T[k], detail: `${T[k].detail} Then: ${after[0].planBlock.toLowerCase()} while tired (hypothesis #${after[0].n}).` };
    }
  }
  const items = past.map((i) => ({ ...i }));
  byDay.forEach((kinds, day) => {
    kinds.forEach((kind, i) => {
      items.push({
        id: `${localDay(addDays(start, day))}-${kind}-${i}`,
        day, date: localDay(addDays(start, day)), kind, ...T[kind],
      });
    });
  });
  return { week: localDay(start), gymDays: gym, phase, notes, items };
}

// ---------------------------------------------------------------------------
// Completion and rescheduling

function categoryOf(session) {
  if (session.type in BOXING_TYPES) return 'boxing';
  if (session.type === 'run' || session.type === 'rope' || session.type === 'conditioning') return 'run';
  if (session.type === 'strength') return 'strength';
  if (session.type === 'mobility') return 'mobility';
  return 'other';
}

function fits(item, session) {
  if (categoryOf(session) !== item.category) return false;
  if (item.kind === 'shadowTech') return session.type === 'shadow';
  if (item.kind === 'fightSim' || item.kind === 'bagVolume') return session.type === 'bag' || session.type === 'mitts';
  return true;
}

// Returns a map of item id → 'done' | 'missed' | 'today' | 'upcoming' | 'moved'.
export function planStatus(plan, sessions, now = new Date()) {
  const today = localDay(now);
  const status = {};
  const used = new Set();
  const byDate = {};
  for (const s of sessions) (byDate[localDay(s.date)] ||= []).push(s);
  // Match specific items first (fightSim/bag/shadow before generic gym).
  const order = ['fightSim', 'bagVolume', 'shadowTech', 'intervals', 'strength', 'gym', 'easyRun', 'mobility', 'rest'];
  const items = [...plan.items].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const it of items) {
    if (it.moved) { status[it.id] = 'moved'; continue; }
    if (it.kind === 'rest') { status[it.id] = it.date < today ? 'done' : it.date === today ? 'today' : 'upcoming'; continue; }
    const match = (byDate[it.date] || []).find((s) => !used.has(s.id) && fits(it, s));
    if (match) { used.add(match.id); status[it.id] = 'done'; continue; }
    status[it.id] = it.date < today ? 'missed' : it.date === today ? 'today' : 'upcoming';
  }
  return status;
}

// Missed key sessions get moved onto a later, lighter day this week.
export function rebalance(plan, sessions, now = new Date()) {
  const status = planStatus(plan, sessions, now);
  const today = localDay(now);
  const key = ['fightSim', 'intervals', 'bagVolume', 'shadowTech'];
  const swappable = ['easyRun', 'mobility', 'strength'];
  const items = plan.items.map((i) => ({ ...i }));
  const moves = [];
  for (const it of items) {
    if (status[it.id] !== 'missed' || !key.includes(it.kind) || it.rescheduled) continue;
    const loadNear = (day) => items.some((x) => (x.day === day - 1 || x.day === day + 1) && x.load === 'hard' && !x.moved);
    const target = items.find((x) => x.date >= today && !x.moved && swappable.includes(x.kind) && status[x.id] !== 'done'
      && (it.load !== 'hard' || !loadNear(x.day)))
      || items.find((x) => x.date >= today && !x.moved && swappable.includes(x.kind) && status[x.id] !== 'done');
    if (!target) continue;
    const { id, day, date } = target;
    Object.assign(target, { ...it, id, day, date, rescheduled: true, from: it.date });
    it.moved = true;
    moves.push({ kind: it.kind, title: it.title, from: it.date, to: date });
  }
  return { plan: { ...plan, items }, moves };
}

export function weekCompletion(plan, sessions, now = new Date()) {
  const status = planStatus(plan, sessions, now);
  const counted = plan.items.filter((i) => i.kind !== 'rest' && !i.moved);
  return { planned: counted.length, done: counted.filter((i) => status[i.id] === 'done').length };
}

// ---------------------------------------------------------------------------
// Bodyweight

export function weightStats(weights = [], profile = {}, now = new Date()) {
  const list = [...weights].filter((w) => w.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return null;
  const at = (daysAgoFrom, daysAgoTo) => {
    const from = localDay(addDays(now, -daysAgoFrom)), to = localDay(addDays(now, -daysAgoTo));
    const xs = list.filter((w) => w.date > from && w.date <= to).map((w) => w.value);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const latest = list[list.length - 1];
  const avg7 = at(7, 0) ?? latest.value;
  const avgPrev = at(14, 7);
  const weeklyChange = avgPrev != null ? avg7 - avgPrev : null;
  const pctPerWeek = weeklyChange != null ? (weeklyChange / avgPrev) * 100 : null;
  const target = profile.targetWeight > 0 ? profile.targetWeight : null;
  const toTarget = target != null ? avg7 - target : null;
  let requiredPerWeek = null;
  if (target != null && profile.fightDate) {
    const weeks = (new Date(profile.fightDate + 'T12:00:00') - now) / (7 * 86400000);
    if (weeks > 0) requiredPerWeek = toTarget / weeks;
  }

  let status = 'ok';
  let message = 'Log your weight a few mornings a week, same time and conditions.';
  if (pctPerWeek != null && pctPerWeek < -1) {
    status = 'fast';
    message = `You're losing about ${Math.abs(pctPerWeek).toFixed(1)}% of bodyweight per week. Over ~1%/week tends to cost power and recovery — eat a bit more on hard training days.`;
  } else if (toTarget != null && toTarget > 0.2 && (weeklyChange == null || weeklyChange > -0.1)) {
    status = weeklyChange == null ? 'ok' : 'behind';
    message = weeklyChange == null
      ? `${toTarget.toFixed(1)} ${profile.unit || 'kg'} above target. Keep logging so I can see your trend.`
      : `${toTarget.toFixed(1)} ${profile.unit || 'kg'} above target and not trending down. Tighten up food on rest days; I've added easy roadwork.`;
  } else if (toTarget != null && toTarget > 0.2) {
    status = 'ontrack';
    message = `${toTarget.toFixed(1)} ${profile.unit || 'kg'} to go, trending the right way${requiredPerWeek ? ` (need ~${requiredPerWeek.toFixed(2)}/week)` : ''}.`;
  } else if (toTarget != null) {
    status = 'at';
    message = 'At or under target weight. Hold it steady — no need to cut further.';
  }
  if (requiredPerWeek != null && avgPrev != null && requiredPerWeek / avg7 > 0.01) {
    message += ' The pace needed to make weight by fight day is over 1% a week. Talk to your coach; never rely on dehydration without proper supervision.';
  }
  return {
    latest, avg7: Math.round(avg7 * 10) / 10,
    weeklyChange: weeklyChange != null ? Math.round(weeklyChange * 100) / 100 : null,
    pctPerWeek: pctPerWeek != null ? Math.round(pctPerWeek * 10) / 10 : null,
    target, toTarget: toTarget != null ? Math.round(toTarget * 10) / 10 : null,
    requiredPerWeek, status, message,
  };
}

