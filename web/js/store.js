// Everything lives on the device in localStorage. Export/import gives you a backup.
import { emptyMemory } from './coach.js';

const KEY = 'boxcoach.v1';

export function defaultState() {
  return {
    version: 1,
    profile: {
      name: '', stance: 'orthodox', level: 'advanced', goal: 'compete', weeklyGoal: 6, sensitivity: 1,
      fight: { rounds: 6, roundSec: 180, restSec: 60 }, fightDate: '', opponentStyle: '', targetWeight: null, unit: 'lb',
    },
    settings: { voice: true, combos: false, comboInterval: 6, tracking: 'camera', cues: true, voiceV2: true },
    sessions: [],
    memory: emptyMemory(),
    weights: [],
    plans: {},
    observations: [], // { source: coach | self | ai, kind: issue | positive | note, text, tags }
    patterns: [], // combinations being developed, tracked from drilling to sparring
    combos: [], // your own combos: { id, tokens, name, created }
    refVideos: [], // YouTube links to study: { id, yt, name, added }
    references: [], // analysed pro clips to compare against: { id, name, date, metrics, byType }
    decisions: [], // decision-drill answers
    hypotheses: [],
    checkins: [], // morning readiness: sleep, soreness, motivation, resting HR
    paused: [], // priorities parked to avoid skill interference
    coach: { equipment: [], levels: {}, overrides: [], assigned: {} }, // Coach me: drill ladder, coach overrides, gear
  };
}

const ARRAYS = ['sessions', 'weights', 'observations', 'patterns', 'combos', 'refVideos', 'references', 'decisions', 'hypotheses', 'checkins', 'paused'];

function merge(base, data) {
  // Earlier versions defaulted to kg; switch to lb if no weights were logged in kg yet.
  if (data.profile?.unit === 'kg' && !(data.weights || []).length) data.profile.unit = 'lb';
  // The voice now gives form fixes only; combo calls are opt-in (once, for older saves).
  if (data.settings && !data.settings.voiceV2) data.settings = { ...data.settings, combos: false, voiceV2: true };
  return {
    ...base,
    ...data,
    profile: { ...base.profile, ...(data.profile || {}), fight: { ...base.profile.fight, ...(data.profile?.fight || {}) } },
    settings: { ...base.settings, ...(data.settings || {}) },
    coach: { ...base.coach, ...(data.coach || {}) },
    memory: { ...base.memory, ...(data.memory || {}) },
    ...Object.fromEntries(ARRAYS.map((k) => [k, Array.isArray(data[k]) ? data[k] : []])),
    plans: data.plans && typeof data.plans === 'object' ? data.plans : {},
  };
}

export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return defaultState();
    return merge(defaultState(), JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function save(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function exportJSON(state) {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.sessions)) {
    throw new Error('That file is not a BoxCoach backup.');
  }
  return merge(defaultState(), data);
}

// Per-punch diagnostics (calib) are only needed for recent coach reports. Keep them on the latest
// few sessions and slim older ones, so months of camera sessions don't fill the phone's storage.
export function trimDiagnostics(sessions, keep = 12) {
  let seen = 0;
  for (let i = sessions.length - 1; i >= 0; i--) {
    const c = sessions[i].calib;
    if (!c) continue;
    if (++seen <= keep) continue;
    for (const k of ['punches', 'vec', 'vec2', 'rejected', 'nearMiss', 'fixes', 'labels', 'track', 'motion', 'pt']) delete c[k];
  }
  return sessions;
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
