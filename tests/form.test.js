import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormAnalyzer, LM, stanceRatio, feetCrossed, bladeAngle, combineRounds } from '../web/js/form.js';

// A synthetic orthodox boxer standing in guard, facing the camera.
function pose(over = {}) {
  const w = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (i, x, y, z) => { w[i] = { x, y, z }; };
  set(LM.NOSE, 0, -0.62, -0.05);
  set(LM.L_EAR, 0.07, -0.63, 0.02);
  set(LM.R_EAR, -0.07, -0.63, 0.02);
  set(LM.L_SH, 0.18, -0.45, -0.05);
  set(LM.R_SH, -0.15, -0.45, 0.08);
  set(LM.L_EL, 0.2, -0.2, -0.12);
  set(LM.R_EL, -0.17, -0.2, 0.0);
  set(LM.L_WR, 0.12, -0.55, -0.25);
  set(LM.R_WR, -0.08, -0.55, -0.15);
  set(LM.L_HIP, 0.1, 0, 0);
  set(LM.R_HIP, -0.1, 0, 0);
  set(LM.L_ANK, 0.2, 0.85, -0.2);
  set(LM.R_ANK, -0.2, 0.85, 0.2);
  for (const [k, v] of Object.entries(over)) w[k] = { ...w[k], ...v };
  return w;
}

function image(world, shift = 0) {
  return world.map((p) => ({ x: 0.5 + shift + p.x * 0.3, y: 0.5 + p.y * 0.3, visibility: 0.99 }));
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

// Feeds frames at 30fps; `frames` is an array of world poses.
function feed(an, frames, t0) {
  let t = t0;
  for (const w of frames) {
    an.update(w, image(w, Math.sin(t / 300) * 0.05), t);
    t += 33;
  }
  return t;
}

function still(n, over) {
  return Array.from({ length: n }, () => pose(over));
}

function punch(wrist, elbow, target, targetElbow, out = 5, back = 6) {
  const base = pose();
  const frames = [];
  for (let i = 1; i <= out; i++) {
    frames.push(pose({ [wrist]: lerp(base[wrist], target, i / out), [elbow]: lerp(base[elbow], targetElbow, i / out) }));
  }
  for (let i = 1; i <= back; i++) {
    frames.push(pose({ [wrist]: lerp(target, base[wrist], i / back), [elbow]: lerp(targetElbow, base[elbow], i / back) }));
  }
  return frames;
}

test('geometry helpers read a good stance', () => {
  const w = pose();
  const r = stanceRatio(w);
  assert.ok(r > 1.2 && r < 2, `stance ratio ${r}`);
  assert.equal(feetCrossed(w), false);
  assert.ok(bladeAngle(w) > 12);
  const crossed = pose({ [LM.L_ANK]: { x: -0.25 }, [LM.R_ANK]: { x: 0.25 } });
  assert.equal(feetCrossed(crossed), true);
});

test('counts a jab and a lead hook and classifies them', () => {
  const punches = [];
  const an = new FormAnalyzer({ onPunch: (p) => punches.push(p) });
  an.startRound();
  let t = feed(an, still(10), 0);
  t = feed(an, punch(LM.L_WR, LM.L_EL, { x: 0.16, y: -0.49, z: -0.61 }, { x: 0.17, y: -0.47, z: -0.33 }), t);
  t = feed(an, still(15), t);
  t = feed(an, punch(LM.R_WR, LM.R_EL, { x: 0.02, y: -0.5, z: -0.5 }, { x: -0.1, y: -0.45, z: -0.2 }), t);
  t = feed(an, still(15), t);
  t = feed(an, punch(LM.L_WR, LM.L_EL, { x: 0.5, y: -0.5, z: -0.35 }, { x: 0.42, y: -0.42, z: -0.02 }, 4, 6), t);
  feed(an, still(15), t);
  const m = an.endRound();
  assert.deepEqual(punches, ['jab', 'cross', 'leadHook']);
  assert.equal(m.totalPunches, 3);
  assert.ok(m.handReturnMs > 0 && m.handReturnMs < 600, `return ${m.handReturnMs}`);
});

test('good guard scores high; dropped hands score low and trigger a cue', () => {
  const good = new FormAnalyzer();
  good.startRound();
  feed(good, still(90), 0);
  assert.equal(good.endRound().guard, 100);

  const cues = [];
  const bad = new FormAnalyzer({ onCue: (k) => cues.push(k) });
  bad.startRound();
  feed(bad, still(90, { [LM.L_WR]: { y: -0.1 }, [LM.R_WR]: { y: -0.1 } }), 0);
  assert.equal(bad.endRound().guard, 0);
  assert.ok(cues.includes('guard'));
});

test('crossed feet and squaring up are flagged', () => {
  const cues = [];
  const an = new FormAnalyzer({ onCue: (k) => cues.push(k) });
  an.startRound();
  feed(an, still(120, {
    [LM.L_ANK]: { x: -0.25 }, [LM.R_ANK]: { x: 0.25 },
    [LM.L_SH]: { z: 0 }, [LM.R_SH]: { z: 0 },
  }), 0);
  const m = an.endRound();
  assert.equal(m.crossedPct, 100);
  assert.equal(m.blade, 0);
  assert.ok(cues.includes('crossed'));
  assert.ok(cues.includes('squared'));
});

test('no cues or counts outside a round, and hidden body asks to step back', () => {
  const cues = [];
  const an = new FormAnalyzer({ onCue: (k) => cues.push(k) });
  feed(an, still(30, { [LM.L_WR]: { y: -0.1 } }), 0);
  assert.equal(cues.length, 0);
  an.startRound();
  for (let t = 0; t < 4000; t += 100) an.update(null, null, t);
  assert.ok(cues.includes('visibility'));
});

test('combineRounds weights by frames and sums punches', () => {
  const a = { frames: 100, guard: 90, stance: 80, punches: { jab: 5, cross: 3, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 } };
  const b = { frames: 300, guard: 50, stance: 80, punches: { jab: 1, cross: 1, leadHook: 1, rearHook: 0, leadUppercut: 0, rearUppercut: 0 } };
  const c = combineRounds([a, b]);
  assert.equal(c.guard, 60);
  assert.equal(c.totalPunches, 11);
  assert.equal(c.perRound.length, 2);
});

test('sequences group punches into combinations', async () => {
  const { sequencesFrom, comboStats } = await import('../web/js/form.js');
  const log = [
    { t: 0, type: 'jab' }, { t: 300, type: 'cross' },
    { t: 2000, type: 'jab' },
    { t: 4000, type: 'jab' }, { t: 4300, type: 'cross' }, { t: 4600, type: 'leadHook' },
  ];
  const seqs = sequencesFrom(log);
  assert.deepEqual(seqs, { '1-2': 1, 1: 1, '1-2-3': 1 });
  const c = comboStats(seqs);
  assert.equal(c.comboShare, 83);
  assert.equal(c.avgComboLen, 2.5);
});

test('punch events carry confidence and per-hand return times', () => {
  const an = new FormAnalyzer();
  an.startRound();
  let t = feed(an, still(10), 0);
  t = feed(an, punch(LM.L_WR, LM.L_EL, { x: 0.16, y: -0.49, z: -0.61 }, { x: 0.17, y: -0.47, z: -0.33 }), t);
  feed(an, still(15), t);
  const m = an.endRound();
  const ev = an.events.find((e) => e.kind === 'punch');
  assert.equal(ev.type, 'jab');
  assert.ok(ev.conf > 50 && ev.conf <= 100, `conf ${ev.conf}`);
  assert.ok(m.leadReturnMs > 0);
  assert.equal(m.rearReturnMs, null);
  assert.equal(m.leftLeadPct, 100); // orthodox: left shoulder closer to camera
  assert.deepEqual(m.sequences, { 1: 1 });
});

test('choosePose picks the boxer among several people and stays locked on', async () => {
  const { choosePose } = await import('../web/js/form.js');
  const person = (x, scale = 1) => {
    const pts = Array.from({ length: 33 }, () => ({ x, y: 0.5 }));
    pts[LM.NOSE] = { x, y: 0.5 - 0.3 * scale };
    pts[LM.L_SH] = { x: x + 0.03, y: 0.5 - 0.22 * scale }; pts[LM.R_SH] = { x: x - 0.03, y: 0.5 - 0.22 * scale };
    pts[LM.L_HIP] = { x: x + 0.02, y: 0.5 }; pts[LM.R_HIP] = { x: x - 0.02, y: 0.5 };
    pts[LM.L_ANK] = { x: x + 0.04, y: 0.5 + 0.3 * scale }; pts[LM.R_ANK] = { x: x - 0.04, y: 0.5 + 0.3 * scale };
    return pts;
  };
  const people = [person(0.3, 1.2), person(0.7, 1)];
  assert.equal(choosePose(people, 'auto'), 0); // bigger = closer
  assert.equal(choosePose(people, 'right'), 1);
  assert.equal(choosePose(people, 'left'), 0);
  // Locked on to the right person even if the order swaps.
  assert.equal(choosePose([people[1], people[0]], 'left', { x: 0.7, y: 0.5 }), 0);
  assert.equal(choosePose([], 'auto'), -1);
});

test('stance and blade work from a side-on camera too', async () => {
  const { bladeAngle, leadSide } = await import('../web/js/form.js');
  // Rotate the standard front-facing boxer 90° so the camera sees them side-on.
  const rot = (w) => w.map((p) => ({ x: -p.z, y: p.y, z: p.x }));
  const front = pose();
  const side = rot(front);
  assert.equal(leadSide(front), 'L');
  assert.equal(leadSide(side), 'L');
  assert.ok(Math.abs(bladeAngle(front) - bladeAngle(side)) < 0.5);
  assert.ok(bladeAngle(side) > 12);
  const squared = rot(pose({ [LM.L_SH]: { z: 0 }, [LM.R_SH]: { z: 0 } }));
  assert.ok(bladeAngle(squared) < 5);
});

test('stance is found side-on even when the ears overlap', async () => {
  const { leadSide } = await import('../web/js/form.js');
  // Boxer facing left in the image, ears stacked in depth.
  const w = pose({
    [LM.NOSE]: { x: -0.12, y: -0.62, z: 0 },
    [LM.L_EAR]: { x: -0.02, y: -0.63, z: 0.01 }, [LM.R_EAR]: { x: -0.02, y: -0.63, z: -0.01 },
    [LM.L_SH]: { x: -0.1, y: -0.45, z: 0.02 }, [LM.R_SH]: { x: 0.1, y: -0.45, z: -0.02 },
    [LM.L_ANK]: { x: -0.25, y: 0.85, z: 0 }, [LM.R_ANK]: { x: 0.2, y: 0.85, z: 0.05 },
  });
  assert.equal(leadSide(w), 'L');
  // Squared shoulders but left foot forward: still orthodox (stance is the feet).
  w[LM.L_SH] = { x: 0, y: -0.45, z: -0.15 };
  w[LM.R_SH] = { x: 0, y: -0.45, z: 0.15 };
  assert.equal(leadSide(w), 'L');
});

test('punches are classified correctly from a side-on camera', () => {
  // Same jab and lead hook as the front-on test, but the boxer is filmed from the side.
  const rot = (w) => w.map((p) => ({ x: -p.z, y: p.y, z: p.x }));
  const punches = [];
  const an = new FormAnalyzer({ onPunch: (p) => punches.push(p) });
  an.startRound();
  let t = feed(an, still(10).map(rot), 0);
  t = feed(an, punch(LM.L_WR, LM.L_EL, { x: 0.16, y: -0.49, z: -0.61 }, { x: 0.17, y: -0.47, z: -0.33 }).map(rot), t);
  t = feed(an, still(15).map(rot), t);
  t = feed(an, punch(LM.R_WR, LM.R_EL, { x: 0.02, y: -0.5, z: -0.5 }, { x: -0.1, y: -0.45, z: -0.2 }).map(rot), t);
  t = feed(an, still(15).map(rot), t);
  t = feed(an, punch(LM.L_WR, LM.L_EL, { x: 0.5, y: -0.5, z: -0.35 }, { x: 0.42, y: -0.42, z: -0.02 }, 4, 6).map(rot), t);
  feed(an, still(15).map(rot), t);
  an.endRound();
  assert.deepEqual(punches, ['jab', 'cross', 'leadHook']);
});
