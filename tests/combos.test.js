import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCombo, comboText, comboSpeech, streamFrom, countCombo, judgeCall, judgeCalls, sessionStream,
  comboHistory, spottedCombos, sessionCombos, punchDigits, pickCombo, STARTERS, comboKey,
} from '../web/js/combos.js';
import { roundMetrics, combineRounds } from '../web/js/form.js';

const T = { 1: 'jab', 2: 'cross', 3: 'leadHook', 4: 'rearHook', 5: 'leadUppercut', 6: 'rearUppercut' };
// Build a punch log from "1-3-2~2 1": '-' 0.3 s gap, '~' 1.1 s, ' ' 3 s.
function log(stream, t = 1000) {
  const out = [];
  for (const ch of stream) {
    if (ch === '-') t += 300; else if (ch === '~') t += 1100; else if (ch === ' ') t += 3000; else out.push({ t, type: T[ch] });
  }
  return out;
}

test('parses and prints combos in the usual notations', () => {
  assert.deepEqual(parseCombo('1-3(body)-2 roll 2'), ['1', '3b', '2', 'roll', '2']);
  assert.deepEqual(parseCombo('jab, cross, slip, cross'), ['1', '2', 'slip', '2']);
  assert.deepEqual(parseCombo('hook body, right hand'), ['3b', '2']);
  assert.equal(parseCombo('Double jab, step back'), null);
  assert.equal(parseCombo('slip, roll'), null, 'needs a punch');
  assert.equal(comboText(['1', '3b', '2', 'roll', '2']), '1-3b-2 roll 2');
  assert.equal(comboSpeech(['1', '3b', 'roll', '6']), 'jab, hook body, roll, rear uppercut');
  assert.equal(punchDigits(['1', '3b', '2', 'roll', '2']), '1322');
  for (const s of STARTERS) assert.ok(parseCombo(s), s);
});

test('stream keeps punch order and gaps', () => {
  assert.equal(streamFrom(log('1-3-2~2-3 1')), '1-3-2~2-3 1');
});

test('counts a combo only when thrown as its own combination', () => {
  const one2 = ['1', '2'];
  assert.deepEqual(countCombo('1-2 1-2-3 1-2~3', one2), { exact: 2, close: 0 }, '1-2 inside 1-2-3 is not a 1-2');
  // A defence move between punches allows the longer gap; a tight combo does not.
  const roll = parseCombo('1-3-2 roll 2');
  assert.equal(countCombo('1-3-2~2 1-3-2-2', roll).exact, 2);
  assert.equal(countCombo('1-3~2-2', roll).exact, 0);
  // One punch misread counts as close, not exact.
  assert.deepEqual(countCombo('1-4-2~2 5', roll), { exact: 0, close: 1 });
  assert.deepEqual(countCombo('', one2), { exact: 0, close: 0 });
});

test('finds your pad-round combo in a realistic stream', () => {
  const s = streamFrom(log('1-3-2~2-3 1 3~6-3-2~2 1-3-2~2-3 1 3~6-3-2~2'));
  assert.equal(countCombo(s, parseCombo('1-3-2 roll 2-3')).exact, 2);
  assert.equal(countCombo(s, parseCombo('3b roll 6-3-2 roll 2')).exact, 2);
});

test('judges a called combo against what was thrown next', () => {
  const l = log('1-2-3 3-2', 10000); // 1-2-3 at 10 s, then 3-2 at ~13.6 s
  assert.deepEqual(judgeCall('123', l, 9500), { result: 'exact', thrown: '123' });
  assert.equal(judgeCall('124', l, 9500).result, 'close');
  assert.equal(judgeCall('12', l, 9500).result, 'miss');
  assert.equal(judgeCall('12', l, 20000).result, 'none');
  const r = judgeCalls([{ t: 9500, key: '1-2-3', digits: '123' }, { t: 13000, key: '3-2', digits: '32' }], l);
  assert.deepEqual(r, [['1-2-3', 'exact', '123'], ['3-2', 'exact', '32']]);
});

function camSession(stream, daysAgo = 1, extra = {}) {
  const r = { ...emptyRoundLike(), punchLog: log(stream) };
  const form = combineRounds([roundMetrics(r)]);
  return { date: new Date(Date.now() - daysAgo * 86400000).toISOString(), type: 'mitts', tracking: 'camera', form, ...extra };
}
function emptyRoundLike() {
  return {
    frames: 100, guardUp: 0, guardEligible: 0, stanceOk: 0, stanceFrames: 0, narrow: 0, wide: 0, crossed: 0, bladeOk: 0, moving: 0, headMoving: 0,
    punches: { jab: 0, cross: 0, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 },
    returnTimes: [], returnLead: [], returnRear: [], leadPunches: 0, rearDrops: 0, leftCloser: 0, depthFrames: 0,
  };
}

test('history, spotted combos and per-session summary', () => {
  const combo = { id: 'a', tokens: parseCombo('1-3-2 roll 2') };
  const sessions = [
    camSession('1-3-2~2 1-3-2~2 1-2 1-2 1-2', 3, { comboCalls: [['1-3-2 roll 2', 'exact', '1322'], ['1-3-2 roll 2', 'miss', '12']] }),
    camSession('1-3-2~2', 60),
    { date: new Date().toISOString(), type: 'run' },
  ];
  const h = comboHistory(combo, sessions);
  assert.equal(h.exact, 2);
  assert.equal(h.sessions, 1);
  assert.equal(h.called, 2);
  assert.equal(h.calledClean, 1);
  const spotted = spottedCombos(sessions, [combo]);
  assert.deepEqual(spotted.map((s) => s.tokens.join('-')), ['1-2'], '1-3-2 is saved (ignoring the roll); 1-2 is new');
  const sc = sessionCombos(sessions[0], [combo]);
  assert.equal(sc.mine[0].exact, 2);
  assert.equal(sc.calls.called, 2);
  assert.equal(sc.calls.exact, 1);
});

test('older sessions without a stream fall back to grouped sequences', () => {
  const s = { form: { perRound: [{ frames: 10 }], sequences: { '1-2': 2, '3-2': 1 } } };
  assert.equal(sessionStream(s), '1-2 1-2 3-2');
});

test('picks combos without repeating the last one', () => {
  const cs = [{ id: 'a' }, { id: 'b' }];
  for (let i = 0; i < 20; i++) assert.equal(pickCombo(cs, 'a').id, 'b');
  assert.equal(pickCombo([], null), null);
  assert.equal(comboKey(['1', '2']), '1-2');
});

test('a pause in a combo allows any gap there', () => {
  const full = parseCombo('1-3-2 roll 2-3 pause 1 pause 3b roll 6-3-2 roll 2');
  assert.equal(countCombo('1-3-2~2-3 1 3~6-3-2~2 1-3-2~2-3~1~3~6-3-2~2', full).exact, 2);
  assert.equal(countCombo('1-3-2~2-3 1-3~6-3-2~2', full).exact, 1, 'no pause needed, but allowed');
  assert.equal(countCombo('1-3 2~2', parseCombo('1-3-2 roll 2')).exact, 0, 'a real break still splits a tight combo');
});
