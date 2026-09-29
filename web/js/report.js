// Compact text report of a session that the boxer can paste into a chat with their coach (or Claude).
// No video, no images — just the measurements, so it is small and private.
import { fatigueMap } from './analysis.js';

const r = (x) => (x == null ? null : Math.round(x * 10) / 10);
const FORM_KEYS = ['guard', 'stance', 'blade', 'footwork', 'head', 'handReturnMs', 'leadReturnMs', 'rearReturnMs',
  'rearDropPct', 'crossedPct', 'narrowPct', 'widePct', 'comboShare', 'avgComboLen', 'leftLeadPct'];
const ROUND_KEYS = ['guard', 'stance', 'blade', 'footwork', 'head', 'leadReturnMs', 'rearReturnMs', 'rearDropPct', 'totalPunches'];

export function buildReport(session, state = {}, version = null) {
  const f = session.form;
  const rounds = (f?.perRound || []).filter((x) => x.frames > 30);
  const fm = fatigueMap(session, state.profile);
  const topSeq = Object.entries(f?.sequences || {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const data = {
    v: 1,
    app: version || undefined,
    date: session.date,
    type: session.type,
    source: session.source || (session.manual ? 'manual' : 'live'),
    tracking: session.tracking,
    profile: state.profile ? { stance: state.profile.stance, level: state.profile.level, fight: state.profile.fight, sensitivity: state.profile.sensitivity } : undefined,
    plan: session.plan,
    rounds: session.completedRounds,
    workSec: session.workSec,
    rpe: session.rpe,
    punches: session.punches ? { total: session.punches.total, perRound: session.punches.perRound, byType: session.punches.byType } : undefined,
    form: f ? Object.fromEntries(FORM_KEYS.map((k) => [k, r(f[k])]).filter(([, v]) => v != null)) : undefined,
    perRound: rounds.length ? { keys: ROUND_KEYS, rows: rounds.map((x) => ROUND_KEYS.map((k) => r(x[k]))) } : undefined,
    combos: topSeq.length ? Object.fromEntries(topSeq) : undefined,
    fatigue: fm ? fm.conclusion : undefined,
    constraints: session.constraints?.map((c) => [c.key, c.opponent || null, c.compliance]),
    hits: session.hits,
    positives: session.positives,
    corrections: session.corrections,
    calib: session.calib,
    notes: session.notes || undefined,
  };
  const json = JSON.stringify(data, (k, v) => (v === undefined ? undefined : v));
  return `BOXCOACH REPORT v1 · ${new Date(session.date).toLocaleDateString()} · ${session.type}\n${json}`;
}

export function reportSize(text) {
  return text.length < 1024 ? `${text.length} characters` : `${Math.round(text.length / 1024)} KB`;
}
