import test from 'node:test';
import assert from 'node:assert/strict';
import { trainPersonal, harvest, addExamples, example } from '../web/js/personal.js';
import { load } from '../web/js/store.js';

// Your crosses land with a bent arm (pad-length), which the built-in reader calls hooks.
function set(rand = mulberry(1)) {
  const out = [];
  const j = (x, s) => x + (rand() - 0.5) * s;
  for (let i = 0; i < 20; i++) out.push({ kind: 'straight', base: 'hook', ext: j(0.8, 0.08), angle: j(122, 12), rise: j(0.02, 0.04), fwd: j(0.12, 0.08), lat: j(0.15, 0.08), e2: j(0.95, 0.15), a2: j(160, 20), dx: j(0.5, 0.2), dy: j(-0.1, 0.1), fore: j(1, 0.3), side: 0.1 });
  for (let i = 0; i < 20; i++) out.push({ kind: 'hook', base: 'hook', ext: j(0.72, 0.08), angle: j(98, 12), rise: j(0.03, 0.04), fwd: j(0.02, 0.06), lat: j(0.3, 0.1), e2: j(0.55, 0.15), a2: j(80, 20), dx: j(-0.3, 0.2), dy: j(0.05, 0.1), fore: j(0.8, 0.3), side: 0.1 });
  for (let i = 0; i < 10; i++) out.push({ kind: 'none', base: 'hook', ext: j(0.7, 0.05), angle: j(60, 10), rise: 0, fwd: 0, lat: j(0.05, 0.05), e2: j(0.35, 0.08), a2: j(45, 10), dx: j(0, 0.1), dy: j(0, 0.1), fore: j(0.6, 0.2), side: 0.1 });
  return out;
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('learns your punches from your labels and only takes over when it beats the built-in reader', () => {
  assert.equal(trainPersonal(set().slice(0, 10)), null, 'too few labels');
  const m = trainPersonal(set());
  assert.ok(m.acc >= 0.85, `own labels ${m.acc}`);
  assert.ok(m.baseAcc < 0.5 && m.use, `built-in ${m.baseAcc}, use ${m.use}`);
  assert.equal(m.predict({ ext: 0.81, angle: 125, rise: 0, fwd: 0.1, lat: 0.15, e2: 1, a2: 165, dx: 0.5, dy: -0.1, fore: 1, side: 0.1 }).kind, 'straight');
  assert.equal(m.predict({ ext: 0.7, angle: 58, rise: 0, fwd: 0, lat: 0.05, e2: 0.33, a2: 44, dx: 0, dy: 0, fore: 0.6, side: 0.1 }).kind, 'none');
  // When the built-in reader already agrees with you, it isn't replaced.
  assert.equal(trainPersonal(set().map((x) => ({ ...x, base: x.kind }))).use, false);
});

test('labels and fixes from a reviewed video become examples; the store keeps the newest', () => {
  const ev = (extra) => ({ kind: 'punch', f: { ext: 0.9, angle: 150, rise: 0 }, fwd: 0.2, lat: 0.1, i2: { ext: 1, angle: 170, dx: 0.4, dy: 0, fore: 1 }, face: [0.1, -1], baseKind: 'hook', keep: true, fix: 'cross', ...extra });
  const got = harvest([ev({ labelled: true }), ev({ edited: true, keep: false }), ev({}), { kind: 'guardDrop' }]);
  assert.deepEqual(got.map((x) => x.kind), ['straight', 'none']);
  assert.equal(got[0].base, 'hook');
  assert.equal(example(ev({}), 'hook').side, 0.1);
  assert.equal(addExamples(Array(799).fill({ kind: 'hook' }), got).length, 800);
});

test('older saves switch combo calls off once (voice gives fixes only); later choices stick', () => {
  const mem = (data) => ({ getItem: () => JSON.stringify(data) });
  assert.equal(load(mem({ settings: { combos: true } })).settings.combos, false);
  assert.equal(load(mem({ settings: { combos: true, voiceV2: true } })).settings.combos, true);
});
