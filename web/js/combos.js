// Your own combinations: build them, have them called out, and count them from camera and video.
// A combo is a list of tokens: punch numbers '1'–'6' ('3b' = to the body) and defence moves.
import { PUNCH_DIGIT, streamFrom } from './form.js';

export { streamFrom };

export const PUNCH_WORDS = { 1: 'Jab', 2: 'Cross', 3: 'Hook', 4: 'Rear hook', 5: 'Uppercut', 6: 'Rear uppercut' };
export const DEFENSE = ['slip', 'roll', 'pull', 'pivot', 'step out', 'feint', 'pause'];

// Quick adds. The last three are from your pad round (the last one is the whole round).
export const STARTERS = [
  '1-2', '1-1-2', '1-2-3', '1-2-3-2', '2-3-2', '1-6-3-2', '3b-3', '1-2 slip 2', '1-2 roll 3-2', '5-2-3',
  '1-3-2 roll 2-3', '3b roll 6-3-2 roll 2', '1-3-2 roll 2-3 pause 1 pause 3b roll 6-3-2 roll 2',
];

export const isPunch = (t) => /^[1-6]b?$/.test(t);

// "1-3(body)-2 roll 2", "1, 2, slip, 2", "jab cross hook" → tokens. Returns null if anything is not understood.
export function parseCombo(text) {
  const words = { jab: '1', cross: '2', 'right hand': '2', straight: '2', hook: '3', 'rear hook': '4', uppercut: '5', 'rear uppercut': '6' };
  let s = String(text || '').toLowerCase().trim();
  s = s.replace(/\s*\(body\)|\s+body\b/g, 'b').replace(/step out/g, 'stepout')
    .replace(/rear hook|rear uppercut|right hand/g, (m) => m.replace(' ', '_'));
  const out = [];
  for (let w of s.split(/[\s,\-·]+/).filter(Boolean)) {
    const body = w.endsWith('b') && w.length > 1 && w !== 'jab';
    if (body && !/^[1-6]b$/.test(w)) w = w.slice(0, -1);
    w = w.replace('_', ' ');
    if (/^[1-6]b?$/.test(w)) out.push(w);
    else if (words[w]) out.push(words[w] + (body ? 'b' : ''));
    else if (w === 'stepout') out.push('step out');
    else if (DEFENSE.includes(w)) out.push(w);
    else return null;
  }
  return out.some(isPunch) ? out : null;
}

// Tokens → "1-3b-2 roll 2": punches back to back are joined with dashes.
export function comboText(tokens) {
  let s = '';
  tokens.forEach((t, i) => {
    if (i) s += isPunch(t) && isPunch(tokens[i - 1]) ? '-' : ' ';
    s += t;
  });
  return s;
}

// For reading: body shots written the way boxers write them, "3(body)".
export const comboLabel = (tokens) => comboText(tokens).replace(/([1-6])b/g, '$1(body)');

// What the coach says: "jab, hook body, cross, roll, cross".
export function comboSpeech(tokens) {
  return tokens.map((t) => (isPunch(t) ? `${PUNCH_WORDS[t[0]].toLowerCase()}${t.endsWith('b') ? ' body' : ''}` : t)).join(', ');
}

// Punches only, with whether a defence move sits before each one.
function plan(tokens) {
  const out = [];
  let def = false, pause = false;
  for (const t of tokens) {
    if (isPunch(t)) { out.push({ d: t[0], def, pause }); def = pause = false; } else if (out.length) { def = true; pause ||= t === 'pause'; }
  }
  return out;
}

export const punchDigits = (tokens) => plan(tokens).map((p) => p.d).join('');

// Session stream. Older sessions only kept grouped sequences, which still match combos without defence moves.
export function sessionStream(s) {
  const rounds = s.form?.perRound || [];
  if (rounds.some((r) => r.stream != null)) return rounds.map((r) => r.stream || '').filter(Boolean).join(' ');
  return Object.entries(s.form?.sequences || {}).flatMap(([k, n]) => Array(n).fill(k)).join(' ');
}

// How many times a combo was thrown as its own combination (not buried inside a longer one).
// "close" = same length with one punch read differently, usually a detection slip.
export function countCombo(stream, tokens) {
  const p = plan(tokens);
  const n = p.length;
  const D = [], S = [];
  for (const ch of stream || '') {
    if (/[1-6]/.test(ch)) D.push(ch);
    else if (D.length && S.length < D.length) S.push(ch);
  }
  let exact = 0, close = 0;
  if (!n) return { exact, close };
  let i = 0;
  while (i + n <= D.length) {
    const bounded = (i === 0 || S[i - 1] !== '-') && (i + n === D.length || S[i + n - 1] !== '-');
    let fits = bounded;
    for (let k = 1; fits && k < n; k++) {
      const g = S[i + k - 1];
      // A pause allows any gap; a slip or roll up to 1.6 s; otherwise punches come back to back.
      if ((g === ' ' && !p[k].pause) || (!p[k].def && g !== '-')) fits = false;
    }
    if (fits) {
      let diff = 0;
      for (let k = 0; k < n; k++) if (D[i + k] !== p[k].d) diff++;
      if (diff === 0) { exact++; i += n; continue; }
      if (diff === 1 && n >= 3) { close++; i += n; continue; }
    }
    i++;
  }
  return { exact, close };
}

// After a combo is called: did the boxer throw it? Looks at the first burst of punches after the call.
export function judgeCall(digits, punchLog, t0, tEnd = t0 + 6000, loose = 1600) {
  let thrown = '', last = null;
  for (const p of punchLog) {
    if (p.t <= t0 + 250 || p.t >= tEnd) continue;
    if (last != null && p.t - last > loose) break;
    thrown += PUNCH_DIGIT[p.type] || '';
    last = p.t;
  }
  let result = 'none';
  if (thrown === digits) result = 'exact';
  else if (thrown && thrown.length === digits.length && [...thrown].filter((c, i) => c !== digits[i]).length === 1 && digits.length >= 3) result = 'close';
  else if (thrown) result = 'miss';
  return { result, thrown };
}

// Score every call made during a round against that round's punches.
export function judgeCalls(calls, punchLog) {
  return calls.map((c, i) => {
    const { result, thrown } = judgeCall(c.digits, punchLog, c.t, Math.min(calls[i + 1]?.t ?? Infinity, c.t + 6000));
    return [c.key, result, thrown];
  });
}

export const comboKey = (tokens) => comboText(tokens);

const trackedSession = (s) => s.form && (s.tracking === 'camera' || s.source === 'video');

// Per-combo history over the last `days`: camera/video counts and how often it was thrown when called.
export function comboHistory(combo, sessions, now = new Date(), days = 30) {
  const since = +now - days * 86400000;
  const key = comboKey(combo.tokens);
  const out = { exact: 0, close: 0, sessions: 0, lastSeen: null, called: 0, calledClean: 0, perSession: [] };
  for (const s of sessions) {
    if (+new Date(s.date) < since) continue;
    if (trackedSession(s)) {
      const c = countCombo(sessionStream(s), combo.tokens);
      out.sessions++;
      out.exact += c.exact;
      out.close += c.close;
      out.perSession.push({ date: s.date, n: c.exact });
      if (c.exact) out.lastSeen = s.date;
    }
    for (const [k, r] of s.comboCalls || []) {
      if (k !== key) continue;
      out.called++;
      if (r === 'exact') out.calledClean++;
    }
  }
  return out;
}

// Combos you throw a lot on camera that aren't saved yet.
export function spottedCombos(sessions, saved, now = new Date(), days = 30, limit = 6) {
  const since = +now - days * 86400000;
  const have = new Set(saved.map((c) => punchDigits(c.tokens)));
  const counts = {};
  for (const s of sessions) {
    if (+new Date(s.date) < since || !trackedSession(s)) continue;
    for (const [k, n] of Object.entries(s.form.sequences || {})) if (k.includes('-')) counts[k] = (counts[k] || 0) + n;
  }
  return Object.entries(counts)
    .filter(([k, n]) => n >= 3 && !have.has(k.replace(/-/g, '')))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, n]) => ({ tokens: k.split('-'), n }));
}

// Per-session summary of your combos and of called combos.
export function sessionCombos(s, combos) {
  const stream = trackedSession(s) ? sessionStream(s) : '';
  const mine = stream ? combos.map((c) => ({ combo: c, ...countCombo(stream, c.tokens) })).filter((x) => x.exact || x.close) : [];
  const calls = s.comboCalls || [];
  const tally = { called: calls.length, exact: 0, close: 0, miss: 0, none: 0 };
  for (const [, r] of calls) tally[r]++;
  return { mine, calls: tally };
}

// Pick the next combo to call, avoiding an immediate repeat.
export function pickCombo(combos, lastId, rand = Math.random) {
  if (!combos.length) return null;
  const pool = combos.length > 1 ? combos.filter((c) => c.id !== lastId) : combos;
  return pool[Math.floor(rand() * pool.length)];
}
