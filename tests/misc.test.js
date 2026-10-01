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

test('old sessions lose their per-punch diagnostics, recent ones keep them', async () => {
  const { trimDiagnostics } = await import('../web/js/store.js');
  const sessions = Array.from({ length: 15 }, (_, i) => ({ id: i, calib: { vTh: 1.6, frames: 100, punches: [[1]], vec: [[1]], vec2: [[1]] } }));
  sessions.splice(5, 0, { id: 'run' });
  trimDiagnostics(sessions, 12);
  const withData = sessions.filter((s) => s.calib?.punches).map((s) => s.id);
  assert.equal(withData.length, 12);
  assert.deepEqual(withData.slice(0, 2), [3, 4]);
  assert.equal(sessions[0].calib.frames, 100, 'summary numbers stay');
  assert.equal(sessions[0].calib.punches, undefined);
});

test('round timer: time the phone was asleep carries over correctly', async () => {
  const { RoundTimer } = await import('../web/js/timer.js');
  const phases = [];
  const t = new RoundTimer({ rounds: 3, roundSec: 180, restSec: 60, prepSec: 10, onPhase: (p, r) => phases.push(`${p}${r}`) });
  t._enter('prep');
  // Asleep for 10 s prep + a 180 s round + 30 s of rest.
  t._last = performance.now() - 220000;
  t._loop();
  assert.equal(t.phase, 'rest');
  assert.equal(t.round, 1);
  assert.ok(Math.abs(t.remainingMs - 30000) < 200, `rest left ${t.remainingMs}`);
  assert.ok(Math.abs(t.workMs - 180000) < 200, `work ${t.workMs}`);
  // Asleep through everything else: finishes, work counts only the rounds.
  t._last = performance.now() - 1e6;
  t._loop();
  assert.equal(t.phase, 'done');
  assert.ok(Math.abs(t.workMs - 540000) < 400, `total work ${t.workMs}`);
  assert.deepEqual(phases, ['prep0', 'work1', 'rest1', 'work2', 'rest2', 'work3', 'done3']);
});

test('live camera uses the full model unless this phone proved too slow for it', async () => {
  const { pickLiveModel, tooSlow, LIVE_SLOW_MS } = await import('../web/js/pose.js');
  const m = new Map();
  const st = { getItem: (k) => m.get(k) ?? null };
  assert.equal(pickLiveModel(st), 'full');
  const now = Date.now();
  m.set('boxcoach.liveModel', `lite@${now - 3 * 86400000}`);
  assert.equal(pickLiveModel(st, now), 'lite');
  m.set('boxcoach.liveModel', `lite@${now - 15 * 86400000}`);
  assert.equal(pickLiveModel(st, now), 'full', 'tries the full model again after two weeks');
  assert.equal(tooSlow(Array(10).fill(80)), null, 'not enough frames to judge');
  assert.equal(tooSlow(Array(40).fill(LIVE_SLOW_MS - 10)), false);
  assert.equal(tooSlow([...Array(25).fill(20), ...Array(15).fill(90)]), false, 'a few slow frames at start-up are fine');
  assert.equal(tooSlow(Array(40).fill(70)), true);
});

test('every module the first screen preloads exists and is cached for offline use', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const sw = fs.readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8');
  const pre = [...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(pre.length > 10);
  for (const f of pre) {
    assert.ok(fs.existsSync(new URL(`../web/${f}`, import.meta.url)), `${f} missing`);
    assert.ok(sw.includes(`'${f}'`), `${f} not in the offline cache list`);
  }
});
