// Compact text report of a session that the boxer can paste into a chat with their coach (or Claude).
// No video, no images — just the measurements, so it is small and private.
import { fatigueMap } from './analysis.js';
import { sessionStream, sessionCombos, comboText } from './combos.js';
import { personalFor } from './personal.js';

// The reader trained on your labels: [labels, its % right, built-in % right, in use].
const taughtStats = (p) => { const m = personalFor(p); return m ? [m.n, Math.round(m.acc * 100), Math.round(m.baseAcc * 100), m.use ? 1 : 0] : p?.punchLabels?.length ? [p.punchLabels.length] : undefined; };

const r = (x) => (x == null ? null : Math.round(x * 10) / 10);
const FORM_KEYS = ['guard', 'stance', 'blade', 'footwork', 'head', 'handReturnMs', 'leadReturnMs', 'rearReturnMs',
  'rearDropPct', 'crossedPct', 'narrowPct', 'widePct', 'comboShare', 'avgComboLen', 'leftLeadPct', 'sidePct', 'headPerMin'];
const ROUND_KEYS = ['guard', 'stance', 'blade', 'footwork', 'head', 'leadReturnMs', 'rearReturnMs', 'rearDropPct', 'totalPunches'];

export function buildReport(session, state = {}, version = null) {
  const f = session.form;
  const rounds = (f?.perRound || []).filter((x) => x.frames > 30);
  const fm = fatigueMap(session, state.profile);
  const mine = sessionCombos(session, state.combos || []).mine;
  const topSeq = Object.entries(f?.sequences || {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const data = {
    v: 1,
    app: version || undefined,
    date: session.date,
    type: session.type,
    source: session.source || (session.manual ? 'manual' : 'live'),
    tracking: session.tracking,
    profile: state.profile ? { stance: state.profile.stance, level: state.profile.level, fight: state.profile.fight, sensitivity: state.profile.sensitivity, taught: taughtStats(state.profile) } : undefined,
    plan: session.plan,
    rounds: session.completedRounds,
    workSec: session.workSec,
    rpe: session.rpe,
    punches: session.punches ? { total: session.punches.total, perRound: session.punches.perRound, byType: session.punches.byType } : undefined,
    form: f ? Object.fromEntries(FORM_KEYS.map((k) => [k, r(f[k])]).filter(([, v]) => v != null)) : undefined,
    perRound: rounds.length ? { keys: ROUND_KEYS, rows: rounds.map((x) => ROUND_KEYS.map((k) => r(x[k]))) } : undefined,
    combos: topSeq.length ? Object.fromEntries(topSeq) : undefined,
    // Punch order with gaps: '-' same combination, '~' after a pause of up to 1.6 s, ' ' new exchange.
    stream: f ? sessionStream(session).slice(0, 2500) || undefined : undefined,
    myCombos: mine.length ? Object.fromEntries(mine.map((m) => [comboText(m.combo.tokens), m.close ? [m.exact, m.close] : m.exact])) : undefined,
    calls: session.comboCalls?.length ? session.comboCalls.slice(0, 120) : undefined,
    fatigue: fm ? fm.conclusion : undefined,
    constraints: session.constraints?.map((c) => [c.key, c.opponent || null, c.compliance]),
    hits: session.hits,
    positives: session.positives,
    corrections: session.corrections,
    coach: session.coach ? { root: session.coach.root, level: session.coach.level, drill: session.coach.drill, eval: session.coach.eval ? [session.coach.eval.metric, session.coach.eval.value, session.coach.eval.target, session.coach.eval.pass] : undefined } : undefined,
    adjustments: session.adjustments,
    benchmark: session.benchmark || undefined,
    calib: session.calib,
    notes: session.notes || undefined,
  };
  const json = JSON.stringify(data, (k, v) => (v === undefined ? undefined : v));
  return `BOXCOACH REPORT v1 · ${new Date(session.date).toLocaleDateString()} · ${session.type}\n${json}`;
}

export function reportSize(text) {
  return text.length < 1024 ? `${text.length} characters` : `${Math.round(text.length / 1024)} KB`;
}
