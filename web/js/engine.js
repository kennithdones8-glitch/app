// Decision engine: turns the development model into priorities and a concrete session. Pure logic.
import { SKILLS, HIT_REASONS, CONSTRAINTS, OPPONENTS } from './library.js';
import { INSIGHTS } from './coach.js';
import { extractEvidence, skillReport, ratingAt } from './skills.js';
import { decayFindings, hitAnalysis, medAnalysis, opponentExposure, transferScores, hitShare } from './analysis.js';
import { recoveryStatus } from './recovery.js';
import { activeInterventions, proposeHypotheses } from './hypotheses.js';
import { phaseFor } from './plan.js';

const DAY = 86400000;
const mean = (xs) => {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// Everything the engine needs, computed once.
export function buildContext(state, now = new Date()) {
  const evidence = extractEvidence(state);
  const sessions = state.sessions || [];
  const decay = decayFindings(sessions, state.profile);
  const hits = hitAnalysis(sessions);
  const med = medAnalysis(sessions, 'jab', state.profile);
  const ctx = {
    now, evidence, decay, hits, med,
    skills: skillReport(state, now, evidence),
    memory: state.memory, checkins: state.checkins || [],
    recovery: recoveryStatus(state, now),
    exposure: opponentExposure(sessions, now),
    transfer: transferScores(state.patterns || [], sessions, now),
    interventions: activeInterventions(state.hypotheses),
    phase: phaseFor(state.profile, now),
  };
  ctx.proposals = proposeHypotheses(ctx, state.hypotheses || []);
  return ctx;
}

const HIT_OBJECTIVE = {
  failedExit: 'Improve your exits: angles, not straight back',
  handsDown: 'Keep your hands home',
  distance: 'Control distance',
  rhythm: 'Break your rhythm',
  overextended: 'Stay balanced — stop overreaching',
  missedCounter: 'See and beat the counter',
  headPosition: 'Get your head off the centre line',
  footworkError: 'Clean up your footwork',
  fatigue: 'Hold your form when tired',
  tactical: 'Make better decisions under pressure',
};

const INSIGHT_CONSTRAINT = {
  lateGuardFade: 'guardRecovery', rearDrop: 'guardRecovery', crossFeet: 'jabFootwork', narrowStance: 'jabFootwork',
  wideStance: 'inOut', squared: 'jabFootwork', flatFeet: 'inOut', staticHead: 'headMove', slowReturn: 'guardRecovery',
  outputFade: 'fatigueSim', lightJab: 'jabFootwork', oneHanded: 'bodyHead',
};

const DIM_CONSTRAINT = { defense: 'guardRecovery', leadReturn: 'guardRecovery', rearReturn: 'guardRecovery', footwork: 'inOut', technique: 'jabFootwork' };
const DIM_SKILLS = { defense: ['defense'], leadReturn: ['defense', 'jab'], rearReturn: ['defense', 'cross'], footwork: ['footwork'], technique: ['jab', 'cross', 'defense'] };

function constraintForSkill(skill) {
  const hit = Object.entries(CONSTRAINTS).find(([, c]) => c.skills[0] === skill) || Object.entries(CONSTRAINTS).find(([, c]) => c.skills.includes(skill));
  return hit ? hit[0] : 'jabFootwork';
}

export const CATEGORY = {
  defense: 'Defense', headMovement: 'Defense', clinch: 'Defense',
  footwork: 'Footwork', angles: 'Footwork', distance: 'Footwork', ringCutting: 'Footwork',
  conditioning: 'Conditioning',
  jab: 'Offense', cross: 'Offense', hooks: 'Offense', uppercuts: 'Offense', combinations: 'Offense',
  counters: 'Ring IQ', feints: 'Ring IQ', timing: 'Ring IQ', rhythm: 'Ring IQ', fightIQ: 'Ring IQ',
};

// Ranked list of problems worth training, with the evidence behind each.
export function rankProblems(ctx, state) {
  const list = [];
  const add = (p) => {
    const existing = list.find((x) => x.key === p.key);
    if (existing) {
      existing.score = Math.max(existing.score, p.score) + 0.5;
      existing.why.push(...p.why);
    } else list.push({ ...p, why: [...p.why] });
  };
  const now = +ctx.now;

  for (const iv of ctx.interventions) {
    add({ key: `hyp:${iv.key}`, label: `Hypothesis #${iv.n} test`, objective: iv.planBlock ? 'Defense under fatigue (hypothesis test)' : `Run hypothesis #${iv.n}`, score: 7, why: [`Hypothesis #${iv.n} is being tested: ${iv.intervention}`], constraint: iv.constraint || 'guardRecovery', skills: ['defense'], source: 'hypothesis' });
  }
  if (ctx.hits.total >= 5) {
    for (const h of ctx.hits.shares.filter((x) => x.pct >= 15)) {
      const r = HIT_REASONS[h.key];
      add({ key: `hit:${h.key}`, label: r.name, objective: HIT_OBJECTIVE[h.key], score: 3 + h.pct / 10, why: [`${h.pct}% of your defensive failures in the last ${ctx.hits.sessions} sessions: ${r.name.toLowerCase()}.`], constraint: r.constraint, skills: r.skills, source: 'measured' });
    }
  }
  for (const f of ctx.decay) {
    add({
      key: `${f.kind}:${f.dim}`, label: f.kind === 'fatigue' ? `${f.dim} under fatigue` : `${f.dim} (technical)`,
      objective: f.kind === 'fatigue' ? (f.dim === 'technique' ? 'Hold technique in the late rounds' : `Improve ${f.dim === 'footwork' ? 'footwork' : 'defense'} under fatigue`) : `Rebuild your ${f.dim === 'defense' ? 'defense' : f.dim} fresh`,
      score: f.kind === 'fatigue' ? 4.5 + f.sessions * 0.3 : 4, why: [f.text], advice: f.advice,
      constraint: DIM_CONSTRAINT[f.dim] || 'guardRecovery', skills: DIM_SKILLS[f.dim] || ['defense'], source: 'measured',
    });
  }
  for (const [k, v] of Object.entries(state.memory?.insights || {})) {
    if (v.count < 2 || !INSIGHTS[k]) continue;
    const c = INSIGHT_CONSTRAINT[k] || 'jabFootwork';
    add({ key: `habit:${k}`, label: INSIGHTS[k].text.replace(/\.$/, ''), objective: `Fix: ${INSIGHTS[k].text.replace(/^Your |^You /, '').replace(/\.$/, '').toLowerCase()}`, score: 3 + Math.min(2, v.count * 0.3), why: [`${INSIGHTS[k].text} (seen in ${v.count} sessions)`], constraint: c, skills: CONSTRAINTS[c].skills, source: 'ai' });
  }
  for (const o of (state.observations || []).filter((x) => x.source === 'coach' && x.kind === 'issue' && x.status !== 'resolved' && now - +new Date(x.date) < 60 * DAY)) {
    const tag = (o.tags || [])[0];
    const hitKey = tag?.startsWith('hit:') ? tag.slice(4) : null;
    const skill = hitKey ? HIT_REASONS[hitKey]?.skills[0] : SKILLS[tag] ? tag : null;
    add({
      key: hitKey ? `hit:${hitKey}` : `skill:${skill || 'coach'}`, label: hitKey ? HIT_REASONS[hitKey].name : skill ? SKILLS[skill].name : 'Coach note',
      objective: hitKey ? HIT_OBJECTIVE[hitKey] : `Work on what your coach flagged${skill ? `: ${SKILLS[skill].name.toLowerCase()}` : ''}`,
      score: 6, why: [`Coach said: "${o.text}"`], constraint: hitKey ? HIT_REASONS[hitKey].constraint : skill ? constraintForSkill(skill) : 'jabFootwork',
      skills: hitKey ? HIT_REASONS[hitKey].skills : skill ? [skill] : [], source: 'coach',
    });
  }
  for (const s of ctx.skills) {
    if (s.confidence === 'none' || s.confidence === 'low' || s.rating >= 55) continue;
    add({ key: `skill:${s.key}`, label: s.name, objective: `Develop your ${s.name.toLowerCase()}`, score: 2 + (55 - s.rating) / 5, why: [`${s.name} rated ${s.rating} (${s.confidence} confidence).`], constraint: constraintForSkill(s.key), skills: [s.key], source: 'measured' });
  }
  const core = ['defense', 'footwork', 'jab', 'headMovement', 'counters', 'conditioning'];
  for (const k of core) {
    const last = ctx.evidence.filter((e) => e.skill === k).map((e) => +new Date(e.date)).sort((a, b) => b - a)[0];
    if (last && now - last > 21 * DAY) {
      add({ key: `neglect:${k}`, label: `${SKILLS[k].name} (neglected)`, objective: `Revisit your ${SKILLS[k].name.toLowerCase()}`, score: 1.5, why: [`No ${SKILLS[k].name.toLowerCase()} work recorded in ${Math.round((now - last) / DAY)} days.`], constraint: constraintForSkill(k), skills: [k], source: 'measured' });
    }
  }
  return list.sort((a, b) => b.score - a.score);
}

// Skill interference: too many simultaneous technical priorities.
export function priorities(problems, state) {
  const paused = new Set(state.paused || []);
  const patterns = (state.patterns || []).filter((p) => p.active !== false).map((p) => ({ key: `pattern:${p.id}`, label: p.name, score: 2.5, source: 'pattern', why: ['Pattern you are developing'], skills: p.skills || [] }));
  const all = [...problems.filter((p) => p.score >= 3), ...patterns].sort((a, b) => b.score - a.score);
  const live = all.filter((p) => !paused.has(p.key));
  return {
    all, active: live.slice(0, 3), paused: all.filter((p) => paused.has(p.key)),
    congested: live.length > 3,
    message: live.length > 3 ? `Training congestion detected: ${live.length} active technical priorities may be reducing repetition quality. Focus on the top 3 and pause the rest.` : null,
  };
}

// Constraint-based, opponent-aware shadowboxing rounds.
export function generateRounds({ n = 6, active = [], exposure = null, phase = null, profile = {}, recovery = null, rand = Math.random }) {
  const rounds = [];
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const problemCons = [...new Set(active.map((p) => p.constraint).filter((c) => CONSTRAINTS[c]))];
  const campOpp = (phase?.key === 'tactical' || phase?.key === 'specific' || phase?.key === 'camp') && OPPONENTS[profile.opponentStyle] ? profile.opponentStyle : null;
  const under = (exposure?.under || []).filter((k) => k !== campOpp);
  const strained = recovery?.status === 'strained' || recovery?.status === 'deload';

  for (let i = 0; i < n; i++) {
    let constraint, opponent = null, why;
    if (i === 0 && n > 2) { constraint = 'jabFootwork'; why = 'Warm-up round: rhythm and range.'; }
    else if (i === n - 1 && n >= 5 && !strained) { constraint = 'fatigueSim'; why = 'Fatigue simulation: hold form when tired.'; }
    else {
      const slot = i - (n > 2 ? 1 : 0);
      if (problemCons.length && slot < problemCons.length + 1) {
        constraint = problemCons[slot % problemCons.length];
        const p = active.find((x) => x.constraint === constraint);
        why = p ? `Attacks: ${p.label.toLowerCase()}` : 'Priority work.';
      } else {
        opponent = campOpp || (under.length ? under[(slot) % under.length] : pick(Object.keys(OPPONENTS)));
        constraint = OPPONENTS[opponent].constraint;
        why = campOpp ? `Fight camp: rounds against a ${OPPONENTS[opponent].name.toLowerCase()}.` : `You're underexposed to ${OPPONENTS[opponent].name.toLowerCase()}s.`;
      }
    }
    if (!opponent && campOpp && i > 0) opponent = campOpp;
    rounds.push({ round: i + 1, constraint, opponent, why });
  }
  return rounds;
}

// Observations the AI draws from the data — stored separately from coach and self notes.
export function aiObservations(ctx, state) {
  const out = [];
  for (const f of ctx.decay) out.push({ key: f.key, text: `${f.text} ${f.advice}`, tags: DIM_SKILLS[f.dim] || [] });
  if (ctx.hits.top && ctx.hits.total >= 5 && ctx.hits.top.pct >= 20) {
    out.push({ key: `hits:${ctx.hits.top.key}`, text: `${ctx.hits.top.pct}% of the times you get hit come from: ${ctx.hits.top.name.toLowerCase()}.`, tags: [`hit:${ctx.hits.top.key}`] });
  }
  for (const [k, v] of Object.entries(state.memory?.insights || {})) {
    if (v.count >= 2 && INSIGHTS[k]) out.push({ key: `habit:${k}`, text: `${INSIGHTS[k].text} (seen in ${v.count} sessions)`, tags: [INSIGHTS[k].area].filter((t) => SKILLS[t]) });
  }
  if (ctx.med?.threshold) out.push({ key: 'med:jab', text: ctx.med.message, tags: ['jab'] });
  for (const t of ctx.transfer) if (t.ctx.sparring.sessions && !t.ctx.sparring.used && t.practised >= 20) out.push({ key: `transfer:${t.id}`, text: `${t.name}: ${t.message}`, tags: ['combinations'] });
  if (ctx.recovery.status === 'deload') out.push({ key: `deload:${new Date(ctx.now).toISOString().slice(0, 10)}`, text: ctx.recovery.reasons.join(' '), tags: ['conditioning'] });
  return out;
}

// Longitudinal trace for a tagged note: "since July, improved from 42% to 28%, still appears under fatigue".
export function memoryTrace(obs, state, ctx) {
  const tag = (obs.tags || [])[0];
  if (!tag) return null;
  const related = (state.observations || []).filter((o) => (o.tags || []).includes(tag)).sort((a, b) => a.date.localeCompare(b.date));
  const since = related[0]?.date || obs.date;
  const month = new Date(since).toLocaleDateString(undefined, { month: 'long' });
  const bits = [];
  if (related.length > 1) bits.push(`Recurring since ${month} (${related.length} notes).`);
  if (tag.startsWith('hit:')) {
    const key = tag.slice(4);
    const series = (state.sessions || []).filter((s) => s.date >= since && s.hits).map((s) => hitShare(s, key)).filter((x) => x != null);
    if (series.length >= 3) {
      const a = Math.round(mean(series.slice(0, 2))), b = Math.round(mean(series.slice(-2)));
      bits.push(`Measured: ${a}% → ${b}% of hits.`);
    }
    const underFatigue = ctx.decay.some((f) => f.kind === 'fatigue') && ['failedExit', 'handsDown', 'footworkError', 'headPosition'].includes(key);
    if (underFatigue) bits.push('Still appears under fatigue.');
  } else if (SKILLS[tag]) {
    const a = ratingAt(ctx.evidence, tag, new Date(since)), b = ratingAt(ctx.evidence, tag, ctx.now);
    if (b.n > a.n) bits.push(`${SKILLS[tag].name}: ${a.rating} → ${b.rating} since then.`);
  }
  return bits.length ? bits.join(' ') : null;
}

// "What should I train today?"
export function trainToday(state, ctx, { planItems = [], tomorrowItems = [] } = {}) {
  const problems = rankProblems(ctx, state);
  const pr = priorities(problems, state);
  const top = pr.active.find((p) => p.objective) || null;
  const rec = ctx.recovery;
  const phase = ctx.phase;
  const main = planItems.find((i) => i.kind !== 'rest') || null;
  const restDay = planItems.length && planItems.every((i) => i.kind === 'rest');
  const why = [];
  const blocks = [];
  const avoid = [];

  let objective = top ? top.objective : 'Build your baseline: a camera session so I can measure you';
  if (top) why.push(...top.why.slice(0, 2));
  if (rec.status === 'deload') {
    objective = 'Recover and absorb the training';
    why.unshift(...rec.reasons);
  } else if (rec.status === 'strained') why.unshift(...rec.reasons);
  if (restDay && rec.status !== 'fresh') objective = 'Rest day — recover';

  const nRounds = rec.status === 'deload' ? 3 : rec.status === 'strained' ? 3 : phase.key === 'taper' ? 3 : 5;
  const rounds = generateRounds({ n: nRounds, active: pr.active, exposure: ctx.exposure, phase, profile: state.profile, recovery: rec });

  if (restDay || rec.status === 'deload') {
    blocks.push({ name: 'Mobility & easy movement', minutes: 20, detail: 'Hips, thoracic spine, shoulders; an easy walk.' });
    if (!restDay) blocks.push({ name: 'Light technical shadowboxing', minutes: 12, detail: `${nRounds} easy rounds: ${rounds.map((r) => CONSTRAINTS[r.constraint].name.toLowerCase()).join(', ')}.` });
  } else {
    blocks.push({ name: 'Warm-up', minutes: 8, detail: 'Jump rope 2 × 3 min, dynamic mobility.' });
    if (main?.kind === 'gym') {
      blocks.push({ name: 'Before gym: constraint shadowboxing', minutes: 12, detail: `3 rounds on "${CONSTRAINTS[rounds[1]?.constraint || 'exitEvery'].name}". Take this objective into the gym session.` });
      blocks.push({ name: 'Gym session', minutes: 60, detail: 'Log it afterwards: rounds, intensity, why you got hit, what worked.' });
    } else {
      blocks.push({ name: 'Technical block: constraint rounds', minutes: nRounds * 4, detail: rounds.map((r) => `R${r.round} ${CONSTRAINTS[r.constraint].name}${r.opponent ? ` vs ${OPPONENTS[r.opponent].name.toLowerCase()}` : ''}`).join(' · ') });
      if (main && main.kind !== 'shadowTech') blocks.push({ name: main.title, minutes: main.kind === 'strength' ? 45 : main.kind === 'easyRun' ? 35 : 30, detail: main.detail });
    }
    const fatigueDef = ctx.interventions.some((i) => i.planBlock) || ctx.decay.some((f) => f.kind === 'fatigue' && (f.dim === 'defense' || f.dim.endsWith('Return')));
    if (fatigueDef) blocks.push({ name: 'Defense after conditioning', minutes: 10, detail: 'While tired: slips, rolls, guard resets, exits. Quality over speed.' });
    blocks.push({ name: 'Cool-down', minutes: 5, detail: 'Easy movement and breathing.' });
  }

  // Priority order by category.
  const cats = [];
  for (const p of pr.active) for (const s of p.skills || []) { const c = CATEGORY[s]; if (c && !cats.includes(c)) cats.push(c); }
  if (!cats.includes('Conditioning') && main && ['fightSim', 'intervals', 'bagVolume'].includes(main.kind)) cats.push('Conditioning');

  const tomorrowHard = tomorrowItems.some((i) => i.load === 'hard');
  if (tomorrowHard || main?.kind === 'gym') avoid.push('Heavy upper-body lifting today (hard boxing is close).');
  if (rec.status === 'strained' || rec.status === 'deload') avoid.push('Hard sparring and max-effort intervals.');
  if (rec.today?.soreness >= 4) avoid.push('Plyometrics and hard running — you are sore.');
  if (ctx.med?.threshold) avoid.push(`More than ~${ctx.med.threshold} jabs — your quality drops past that.`);
  if (pr.congested) avoid.push('New techniques outside your top 3 priorities.');
  if (phase.key === 'taper') avoid.push('New skills and hard sparring (taper).');

  return {
    objective, why: [...new Set(why)].slice(0, 4), priorityOrder: cats.slice(0, 3), avoid,
    minutes: blocks.reduce((a, b) => a + b.minutes, 0), blocks, rounds, priorities: pr,
    readiness: rec.readiness, recovery: rec, main,
  };
}
