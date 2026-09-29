// Recovery model: training load, readiness check-ins, and deload / overtraining detection. Pure logic.
import { BOXING_TYPES } from './coach.js';

const DAY = 86400000;
const mean = (xs) => {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// Session load = effort (RPE) × minutes, heavier for hard sparring (Foster's session-RPE).
export function sessionLoad(s) {
  const min = s.durationMin || Math.round((s.totalSec || s.workSec || 0) / 60);
  const rpe = s.rpe || 5;
  const spar = s.type === 'sparring' && (s.sparring?.intensity || 3) >= 4 ? 1.25 : 1;
  return Math.round(min * rpe * spar);
}

export function loadSummary(sessions, now = new Date()) {
  const t = +now;
  const inRange = (s, from, to) => +new Date(s.date) > t - from * DAY && +new Date(s.date) <= t - to * DAY;
  const acute = sessions.filter((s) => inRange(s, 7, 0)).reduce((a, s) => a + sessionLoad(s), 0);
  const chronicTotal = sessions.filter((s) => inRange(s, 28, 0)).reduce((a, s) => a + sessionLoad(s), 0);
  const chronic = chronicTotal / 4;
  const prevAcute = sessions.filter((s) => inRange(s, 14, 7)).reduce((a, s) => a + sessionLoad(s), 0);
  const ratio = chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null;
  const hasHistory = sessions.some((s) => +new Date(s.date) <= t - 21 * DAY);
  return { acute, chronic: Math.round(chronic), ratio: hasHistory ? ratio : null, prevAcute };
}

// Readiness from a morning check-in (0-100).
export function readinessOf(c, baselineHr = null) {
  if (!c) return null;
  const parts = [];
  if (c.sleep != null) parts.push(c.sleep >= 8 ? 100 : c.sleep >= 7 ? 85 : c.sleep >= 6 ? 60 : 35);
  if (c.soreness != null) parts.push([100, 100, 80, 55, 30, 10][c.soreness] ?? 60);
  if (c.motivation != null) parts.push([60, 30, 50, 70, 85, 100][c.motivation] ?? 60);
  if (c.hr && baselineHr) {
    const diff = c.hr - baselineHr;
    parts.push(diff <= 2 ? 100 : diff <= 5 ? 75 : diff <= 8 ? 50 : 25);
  }
  return parts.length ? Math.round(mean(parts)) : null;
}

export function baselineHr(checkins) {
  const hrs = checkins.filter((c) => c.hr).slice(-14).map((c) => c.hr);
  return hrs.length >= 3 ? Math.round(mean(hrs)) : null;
}

function perfSeries(sessions) {
  return sessions.filter((s) => s.type in BOXING_TYPES && s.scores?.overall != null).map((s) => ({ date: s.date, v: s.scores.overall }));
}

// Is recent performance dropping while load climbs?
export function recoveryStatus({ sessions = [], checkins = [] }, now = new Date()) {
  const load = loadSummary(sessions, now);
  const t = +now;
  const recent = checkins.filter((c) => +new Date(c.date + 'T12:00:00') > t - 7 * DAY);
  const hrBase = baselineHr(checkins);
  const today = checkins.find((c) => c.date === localDay(now)) || null;
  const readiness = readinessOf(today, hrBase);
  const recentReadiness = recent.map((c) => readinessOf(c, hrBase)).filter((x) => x != null);
  const lowDays = recentReadiness.filter((r) => r < 45).length;

  const perf = perfSeries(sessions);
  const last = perf.slice(-3), prior = perf.slice(-8, -3);
  const perfChange = last.length >= 2 && prior.length >= 3 ? Math.round(mean(last.map((p) => p.v)) - mean(prior.map((p) => p.v))) : null;
  const loadRising = load.prevAcute > 0 && load.acute > load.prevAcute * 1.1;

  const reasons = [];
  let status = 'normal';
  if (perfChange != null && perfChange <= -6 && loadRising) {
    status = 'deload';
    reasons.push(`Your recent performance is declining (${perfChange} points) despite increasing training volume.`);
  }
  if (load.ratio != null && load.ratio >= 1.5) {
    status = status === 'deload' ? 'deload' : 'strained';
    reasons.push(`This week's load is ${load.ratio}× your 4-week average — a spike that raises injury and burnout risk.`);
  }
  if (lowDays >= 3) {
    status = 'deload';
    reasons.push(`Readiness has been low on ${lowDays} of the last ${recent.length} check-ins.`);
  }
  if (readiness != null && readiness < 45 && status === 'normal') {
    status = 'strained';
    reasons.push(`Today's readiness is low (${readiness}/100).`);
  }
  if (status === 'normal' && readiness != null && readiness >= 80 && (load.ratio == null || load.ratio <= 1.2)) status = 'fresh';

  const advice = {
    deload: 'Deload: cut volume ~40% for the next 5–7 days, keep intensity short and sharp, no hard sparring.',
    strained: 'Go lighter today: technical work only, skip max-effort intervals and hard sparring.',
    normal: 'Train as planned.',
    fresh: 'Well recovered — a good day for your hardest session.',
  }[status];
  return { status, readiness, load, perfChange, reasons, advice, today };
}

export function localDay(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
