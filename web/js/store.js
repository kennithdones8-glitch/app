// Everything lives on the device in localStorage. Export/import gives you a backup.
import { emptyMemory } from './coach.js';

const KEY = 'boxcoach.v1';

export function defaultState() {
  return {
    version: 1,
    profile: {
      name: '', stance: 'orthodox', level: 'advanced', goal: 'compete', weeklyGoal: 6, sensitivity: 1,
      fight: { rounds: 6, roundSec: 180, restSec: 60 }, fightDate: '', opponentStyle: '', targetWeight: null, unit: 'kg',
    },
    settings: { voice: true, combos: true, comboInterval: 6, tracking: 'camera', cues: true },
    sessions: [],
    memory: emptyMemory(),
    weights: [],
    plans: {},
    observations: [], // { source: coach | self | ai, kind: issue | positive | note, text, tags }
    patterns: [], // combinations being developed, tracked from drilling to sparring
    decisions: [], // decision-drill answers
    hypotheses: [],
    checkins: [], // morning readiness: sleep, soreness, motivation, resting HR
    paused: [], // priorities parked to avoid skill interference
  };
}

const ARRAYS = ['sessions', 'weights', 'observations', 'patterns', 'decisions', 'hypotheses', 'checkins', 'paused'];

function merge(base, data) {
  return {
    ...base,
    ...data,
    profile: { ...base.profile, ...(data.profile || {}), fight: { ...base.profile.fight, ...(data.profile?.fight || {}) } },
    settings: { ...base.settings, ...(data.settings || {}) },
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

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
