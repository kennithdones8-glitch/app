import test from 'node:test';
import assert from 'node:assert/strict';
import { readAnswer, applyAi, aiType, promptText, cropBox, aiKey, aiModel, setAi } from '../web/js/aicheck.js';

const detected = [
  { id: 0, t: 1000, role: 'lead', type: 'leadHook' },
  { id: 1, t: 1400, role: 'rear', type: 'cross' },
  { id: 2, t: 2000, role: 'rear', type: 'rearHook' },
];

test('maps hand + kind to the app punch types', () => {
  assert.equal(aiType('lead', 'straight'), 'jab');
  assert.equal(aiType('rear', 'uppercut'), 'rearUppercut');
  assert.equal(aiType('rear', 'swing'), null);
});

test("reads Claude's answer: retypes, removes, adds missed punches without duplicates", () => {
  const r = readAnswer({
    detected: [
      { id: 0, verdict: 'punch', hand: 'lead', kind: 'straight' },
      { id: 1, verdict: 'punch', hand: 'rear', kind: 'straight' },
      { id: 2, verdict: 'not_a_punch' },
      { id: 99, verdict: 'punch', hand: 'lead', kind: 'hook' }, // not ours: ignored
    ],
    missed: [
      { t: 1.05, hand: 'lead', kind: 'straight' }, // same as #0: skipped
      { t: 2.0, hand: 'rear', kind: 'hook' }, // #2 was not a punch, so this one is new
      { t: 3.2, hand: 'lead', kind: 'uppercut', sure: false },
      { t: 3.3, hand: 'lead', kind: 'uppercut' }, // duplicate of the one above
      { t: 'x', hand: 'lead', kind: 'hook' },
    ],
  }, detected);
  assert.deepEqual(r.verdicts, { 0: 'jab', 1: 'cross', 2: null });
  assert.deepEqual(r.added.map((a) => [a.t, a.type, a.sure]), [[2000, 'rearHook', true], [3200, 'leadUppercut', false]]);
  assert.deepEqual(readAnswer(null, detected), { verdicts: {}, added: [] });
});

test('applies verdicts to the review list and counts them', () => {
  const j = {
    roundSec: 2, durMs: 4000, rounds: [{}, {}],
    events: [
      { kind: 'punch', i: 0, t: 1000, type: 'leadHook', fix: 'leadHook', keep: true, conf: 60, round: 1 },
      { kind: 'guardDrop', i: 1, t: 1200, conf: 70 },
      { kind: 'punch', i: 2, t: 1400, type: 'cross', fix: 'cross', keep: false, conf: 40, round: 1 },
      { kind: 'punch', i: 3, t: 2000, type: 'rearHook', fix: 'rearHook', keep: true, conf: 90, round: 1 },
    ],
  };
  const tally = applyAi(j, { verdicts: { 0: 'jab', 2: 'cross', 3: null }, added: [{ t: 3500, type: 'jab', role: 'lead', sure: true }] });
  assert.deepEqual(tally, { same: 1, retyped: 1, removed: 1, added: 1 });
  assert.equal(j.events[0].fix, 'jab');
  assert.equal(j.events[0].type, 'leadHook', "the camera's own reading is kept for the report");
  assert.equal(j.events[2].keep, true, 'a low-confidence detection Claude confirms is ticked');
  assert.equal(j.events[3].keep, false);
  assert.deepEqual([j.events[4].i, j.events[4].round, j.events[4].fix], [4, 2, 'jab']);
});

test('prompt names the lead hand for the stance and lists detections', () => {
  const p = promptText({ stance: 'southpaw', punches: detected, drill: '1-2' });
  assert.match(p, /lead hand = right hand/);
  assert.match(p, /#1: 1\.4s, rear, cross/);
  assert.match(p, /1-2\. Use it only as a hint/);
  assert.match(promptText({ punches: [] }), /detected no punches/);
});

test('crop box: upper body with a full reach either side; none without shoulders and hips', () => {
  const pts = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  pts[0] = { x: 0.5, y: 0.2 }; pts[11] = { x: 0.55, y: 0.3 }; pts[12] = { x: 0.45, y: 0.3 };
  pts[23] = { x: 0.53, y: 0.5 }; pts[24] = { x: 0.47, y: 0.5 };
  const b = cropBox(pts, 1000, 1000); // torso 200 px
  assert.equal(b.cx, 500);
  const w = (b.h * 240) / 180;
  assert.ok(w / 2 >= 1.4 * 200, `half width ${w / 2}`);
  assert.ok(b.cy - b.h / 2 < 200 && b.cy + b.h / 2 > 500, 'head to hips');
  assert.equal(cropBox(pts.map((p) => ({ ...p, visibility: 0.1 })), 1000, 1000), null);
});

test('API key is stored apart from app data and can be removed', () => {
  const m = new Map();
  const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  assert.equal(aiKey(st), '');
  setAi(' sk-ant-test ', 'claude-opus-5-5', st);
  assert.equal(aiKey(st), 'sk-ant-test');
  assert.equal(aiModel(st), 'claude-opus-5-5');
  assert.ok(![...m.keys()].includes('boxcoach.v1'));
  setAi('', null, st);
  assert.equal(aiKey(st), '');
});
