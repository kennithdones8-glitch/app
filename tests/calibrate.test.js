import test from 'node:test';
import assert from 'node:assert/strict';
import { FormAnalyzer, classifyPunch, punchAxis } from '../web/js/form.js';
import { alignToCombo, calibrateFromCombo } from '../web/js/calibrate.js';
import { parseCombo, punchDigits } from '../web/js/combos.js';

// The pad round: 1-3-2 roll 2-3 · 1 · 3(body) roll 6-3-2 roll 2
const PAD = parseCombo('1-3-2 roll 2-3 1 3b roll 6-3-2 roll 2');
const ROLE = { 1: 'lead', 2: 'rear', 3: 'lead', 4: 'rear', 5: 'lead', 6: 'rear' };

// Synthetic punch paths in the camera's ground plane. Forward is +x (side-on camera);
// hooks swing out sideways (lead hook toward +z, as the far side is compressed by depth).
function feats(digit, ratio = 3) {
  const d = String(digit);
  if (d === '1' || d === '2') {
    // Straights wobble sideways mid-punch but land nearly dead ahead (slightly inward).
    const s = d === '1' ? 1 : -1, w = 0.28 / ratio;
    return { angle: 118, ext: 0.72, rise: 0.02, path: [[0.14, s * w], [0.28, s * w * 0.3], [0.2, s * 0.02]], disp: [0.28, s * w * 0.3] };
  }
  if (d === '3' || d === '4') {
    const s = d === '3' ? 1 : -1;
    return { angle: 100, ext: 0.7, rise: 0.03, path: [[0.08, s * 0.14], [0.2, s * 0.22], [0.26, s * 0.12]], disp: [0.2, s * 0.22] };
  }
  return { angle: 95, ext: 0.62, rise: 0.22, path: [[0.05, 0], [0.1, 0.02]], disp: [0.1, 0.02] };
}

function analyserWith(digits, { face = [0, 1], ratio = 3 } = {}) {
  const an = new FormAnalyzer();
  an.events = digits.map((d, i) => ({ kind: 'punch', t: i * 400, conf: 60, round: 1, role: ROLE[d], type: 'rearHook', vis: 0.9, speed: 3, f: feats(d, ratio), face }));
  return an;
}

test('forward axis comes from the punches, not a face pointing the wrong way', () => {
  // A typical straight-heavy mix, no combo given.
  const digits = [];
  for (let r = 0; r < 6; r++) for (const c of ['1-2', '1-1-2', '1-2-3-2', '2-3-2', '1-6-3-2']) digits.push(...c.split('-'));
  const an = analyserWith(digits, { face: [0, 1] }); // face estimate 90° off, like the real report
  an.reclassify();
  const got = an.events.map((e) => e.type);
  const want = digits.map((d) => ({ 1: 'jab', 2: 'cross', 3: 'leadHook', 5: 'leadUppercut', 6: 'rearUppercut' })[d]);
  const right = got.filter((t, i) => t === want[i]).length;
  assert.ok(right / got.length >= 0.95, `${right}/${got.length} correct: ${got.slice(0, 11).join(',')}`);
  assert.ok(an.calib.faceDev >= 60, `face deviation reported: ${an.calib.faceDev}`);
  assert.equal(an.calib.vec.length, digits.length);
});

test('punchAxis needs a few punches and averages where they land', () => {
  assert.equal(punchAxis([[0.3, 0]]), null);
  const a = punchAxis([[0.3, 0.1], [0.3, -0.1], [0.2, 0.2], [0.2, -0.2]]);
  assert.ok(a.x > 0.99);
  assert.equal(classifyPunch(feats(2), { x: 1, z: 0 }).kind, 'straight');
  assert.equal(classifyPunch(feats(3), { x: 1, z: 0 }).kind, 'hook');
  assert.equal(classifyPunch(feats(6), { x: 1, z: 0 }).kind, 'uppercut');
});

test('aligns detected hands to a repeated combo despite missed and extra punches', () => {
  const digits = punchDigits(PAD); // 13223 1 36322 → 11 punches
  const truth = [];
  for (let r = 0; r < 6; r++) truth.push(...digits);
  // Drop two punches, insert one stray detection.
  const seen = truth.filter((_, i) => i !== 7 && i !== 30);
  seen.splice(15, 0, '2');
  const labels = alignToCombo(seen.map((d) => ROLE[d]), digits);
  const correct = labels.filter((l, i) => l === seen[i]).length;
  assert.ok(correct >= seen.length - 3, `${correct}/${seen.length}`);
});

test('learns a looser straight boundary for pad work where straights stay short and wide', () => {
  const digits = [];
  for (let r = 0; r < 6; r++) digits.push(...punchDigits(PAD));
  const an = analyserWith(digits, { ratio: 1.3 }); // straights only 1.3× more forward than sideways
  an.reclassify();
  const punches = an.events;
  const res = calibrateFromCombo(punches, PAD);
  assert.ok(res.matched >= digits.length - 2);
  assert.ok(res.agree < res.matched * 0.8, `default rule misreads many straights here: ${res.agree}/${res.matched}`);
  assert.ok(res.ratio < 1.8 && res.ratio > 0.8, `learned ratio ${res.ratio}`);
  an.cal = { ratio: res.ratio };
  an.reclassify();
  const after = calibrateFromCombo(an.events, PAD, an.cal);
  assert.ok(after.agree >= after.matched * 0.9, `${after.agree}/${after.matched} after learning`);
});

test('a hook-heavy drilled combo with a wrong face estimate still reads right after the combo check', () => {
  const digits = [];
  for (let r = 0; r < 8; r++) digits.push(...punchDigits(PAD));
  const an = analyserWith(digits, { face: [0, 1] });
  an.reclassify();
  const res = calibrateFromCombo(an.events, PAD);
  if (res.ratio != null) an.cal = { ratio: res.ratio };
  an.reclassify();
  const after = calibrateFromCombo(an.events, PAD, an.cal);
  assert.ok(after.agree >= after.matched * 0.95, `${after.agree}/${after.matched}`);
});

// ---------------------------------------------------------------------------
// End to end through FormAnalyzer.update: a boxer whose face estimate is 90° off (as on the real
// pad clip) still gets straights, hooks and stance right once a few punches have been thrown.
import { LM } from '../web/js/form.js';

function guard() {
  const w = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (i, x, y, z) => { w[i] = { x, y, z }; };
  // Forward is -z (toward the camera). The face landmarks are corrupted so the nose sits to the
  // boxer's side of the ears: facing() then points along -x, 90° off.
  set(LM.NOSE, -0.1, -0.62, 0.02);
  set(LM.L_EAR, 0, -0.63, 0.03);
  set(LM.R_EAR, 0, -0.63, 0.01);
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
  return w;
}
const lerp3 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
function moveHand(wr, el, points, elbows) {
  // points: wrist waypoints after the guard position; returns frames out and back.
  const g = guard();
  const out = [];
  let prevW = g[wr], prevE = g[el];
  points.forEach((p, k) => {
    for (let i = 1; i <= 2; i++) out.push({ [wr]: lerp3(prevW, p, i / 2), [el]: lerp3(prevE, elbows[k], i / 2) });
    prevW = p; prevE = elbows[k];
  });
  for (let i = 1; i <= 6; i++) out.push({ [wr]: lerp3(prevW, g[wr], i / 6), [el]: lerp3(prevE, g[el], i / 6) });
  return out.map((o) => { const w = guard(); for (const [k, v] of Object.entries(o)) w[k] = v; return w; });
}
// Pad-length straights: the mitt stops the arm before it locks out (elbow ~120°).
const JAB = () => moveHand(LM.L_WR, LM.L_EL, [{ x: 0.13, y: -0.52, z: -0.36 }, { x: 0.14, y: -0.5, z: -0.47 }], [{ x: 0.2, y: -0.3, z: -0.16 }, { x: 0.22, y: -0.33, z: -0.2 }]);
const CROSS = () => moveHand(LM.R_WR, LM.R_EL, [{ x: -0.04, y: -0.52, z: -0.28 }, { x: 0.0, y: -0.5, z: -0.42 }], [{ x: -0.16, y: -0.28, z: -0.06 }, { x: -0.16, y: -0.32, z: -0.12 }]);
// Lead hook: swings out to the lead side, then across in front of the face.
const HOOK = () => moveHand(LM.L_WR, LM.L_EL, [{ x: 0.38, y: -0.52, z: -0.3 }, { x: 0.12, y: -0.52, z: -0.45 }], [{ x: 0.4, y: -0.47, z: -0.05 }, { x: 0.36, y: -0.48, z: -0.2 }]);

test('end to end: wrong face direction, straights and hooks still read right, stance too', () => {
  const got = [];
  const an = new FormAnalyzer({ onPunch: (type) => got.push(type) });
  an.startRound();
  let t = 0;
  const run = (frames) => { for (const w of frames) { an.update(w, w.map((p) => ({ x: 0.5 + p.x * 0.3, y: 0.5 + p.y * 0.3, visibility: 0.99 })), t); t += 33; } };
  // One warm-up reach: the analyser learns arm length from the first punch it sees.
  run(JAB()); run(Array.from({ length: 12 }, guard));
  got.length = 0;
  const want = [];
  for (let r = 0; r < 6; r++) {
    for (const [f, name] of [[JAB, 'jab'], [CROSS, 'cross'], [HOOK, 'leadHook'], [CROSS, 'cross']]) {
      run(f()); want.push(name);
      run(Array.from({ length: 12 }, guard));
    }
  }
  const m = an.endRound();
  assert.equal(got.length, want.length, `punches seen: ${got.join(',')}`);
  const liveRight = got.slice(8).filter((x, i) => x === want[i + 8]).length;
  assert.ok(liveRight >= (want.length - 8) * 0.9, `live after warm-up: ${got.slice(8).join(',')}`);
  an.reclassify();
  const all = an.events.filter((e) => e.kind === 'punch').map((e) => e.type).slice(-want.length);
  const right = all.filter((x, i) => x === want[i]).length;
  assert.ok(right >= want.length * 0.95, `after re-read ${right}/${want.length}: ${all.join(',')}`);
  assert.ok(m.leftLeadPct > 50, `orthodox from the learned axis: ${m.leftLeadPct}%`);
});
