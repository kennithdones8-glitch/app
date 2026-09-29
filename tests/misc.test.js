import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PunchDetector } from '../web/js/motion.js';
import * as store from '../web/js/store.js';
import { fmt } from '../web/js/timer.js';

test('PunchDetector counts spikes with a refractory period', () => {
  const d = new PunchDetector({ threshold: 18, refractoryMs: 200 });
  const hits = [];
  const signal = [0, 5, 25, 30, 10, 2, 0, 22, 8, 0];
  signal.forEach((a, i) => { const h = d.push(a, 0, 0, i * 20); if (h) hits.push(h); });
  assert.equal(hits.length, 1); // second spike is inside the refractory window
  assert.equal(hits[0].peak, 30);
  const h2 = [];
  [0, 25, 5, 0].forEach((a, i) => { const h = d.push(a, 0, 0, 1000 + i * 20); if (h) h2.push(h); });
  assert.equal(h2.length, 1);
});

test('store round-trips and survives bad data', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = store.defaultState();
  s.profile.name = 'Ken';
  s.sessions.push({ id: 'a', type: 'shadow', date: '2026-09-01' });
  store.save(s, storage);
  const back = store.load(storage);
  assert.equal(back.profile.name, 'Ken');
  assert.equal(back.sessions.length, 1);
  assert.equal(back.settings.voice, true);
  mem.set('boxcoach.v1', '{not json');
  assert.equal(store.load(storage).sessions.length, 0);
  assert.throws(() => store.importJSON('{"foo":1}'));
  assert.equal(store.importJSON(store.exportJSON(s)).sessions.length, 1);
});

test('fmt formats seconds', () => {
  assert.equal(fmt(180), '3:00');
  assert.equal(fmt(65), '1:05');
  assert.equal(fmt(-3), '0:00');
});

test('coach report is compact JSON with calibration data', async () => {
  const { buildReport } = await import('../web/js/report.js');
  const round = { frames: 300, guard: 88.123, stance: 80, blade: 75, footwork: 40, head: 30, leadReturnMs: 410, rearReturnMs: 450, rearDropPct: 12, totalPunches: 120 };
  const s = {
    date: '2026-09-29T18:00:00Z', type: 'shadow', source: 'video', completedRounds: 3, workSec: 540, rpe: 7,
    plan: { rounds: 3, roundSec: 180, restSec: 60 },
    punches: { total: 360, perRound: [120, 120, 120], byType: { jab: 150 } },
    form: { guard: 87.66, perRound: [round, round, round], sequences: { '1-2': 30, 1: 50 } },
    calib: { vTh: 1.6, punches: [[1, 2.4, 0.9, 160, 0.02, 0.05, 88]], rejected: [], nearMiss: [['L', 1.2]], frames: 900, tracked: 850 },
    notes: 'felt slow',
  };
  const text = buildReport(s, { profile: { stance: 'orthodox', level: 'advanced', fight: { rounds: 6 }, sensitivity: 1 } });
  assert.match(text, /^BOXCOACH REPORT v1/);
  const data = JSON.parse(text.split('\n')[1]);
  assert.equal(data.form.guard, 87.7);
  assert.equal(data.perRound.rows.length, 3);
  assert.equal(data.perRound.rows[0][0], 88.1);
  assert.deepEqual(data.combos, { 1: 50, '1-2': 30 });
  assert.equal(data.calib.punches[0][1], 2.4);
  assert.match(data.fatigue, /held your form/);
  assert.ok(text.length < 4000);
});
