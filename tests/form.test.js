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
  // 12 s: reminders are spaced out (at most one every 8 s), so both need time to come up.
  feed(an, still(360, {
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

test('a camera tilted up (phone on the floor) still reads straights as straights', () => {
  // Pitched up 30°: punches toward the camera look like they rise in camera coordinates.
  let guard0 = null;
  for (const deg of [0, 30, 45]) {
    const a = (deg * Math.PI) / 180;
    const tilt = (w) => w.map((p) => ({ x: p.x, y: p.y * Math.cos(a) + p.z * Math.sin(a), z: -p.y * Math.sin(a) + p.z * Math.cos(a) }));
    const punches = [];
    const an = new FormAnalyzer({ onPunch: (p) => punches.push(p) });
    an.startRound();
    let t = feed(an, still(10).map(tilt), 0);
    t = feed(an, punch(LM.L_WR, LM.L_EL, { x: 0.16, y: -0.49, z: -0.61 }, { x: 0.17, y: -0.47, z: -0.33 }).map(tilt), t);
    t = feed(an, still(15).map(tilt), t);
    t = feed(an, punch(LM.R_WR, LM.R_EL, { x: 0.02, y: -0.5, z: -0.5 }, { x: -0.1, y: -0.45, z: -0.2 }).map(tilt), t);
    t = feed(an, still(15).map(tilt), t);
    t = feed(an, punch(LM.L_WR, LM.L_EL, { x: 0.5, y: -0.5, z: -0.35 }, { x: 0.42, y: -0.42, z: -0.02 }, 4, 6).map(tilt), t);
    feed(an, still(15).map(tilt), t);
    const m = an.endRound();
    assert.deepEqual(punches, ['jab', 'cross', 'leadHook'], `tilted ${deg}°`);
    guard0 ??= m.guard;
    assert.equal(m.guard, guard0, `guard ${m.guard}% tilted ${deg}° vs ${guard0}% level`);
    assert.ok(Math.abs(an.calib.tilt - deg) <= 3, `measured tilt ${an.calib.tilt}° for ${deg}°`);
  }
});

test('dropped hands held forward still read as dropped with the camera tilted up', () => {
  for (const deg of [0, 30]) {
    const a = (deg * Math.PI) / 180;
    const tilt = (w) => w.map((p) => ({ x: p.x, y: p.y * Math.cos(a) + p.z * Math.sin(a), z: -p.y * Math.sin(a) + p.z * Math.cos(a) }));
    const an = new FormAnalyzer();
    an.startRound();
    // Hands 12 cm below the shoulders and 30 cm out in front: a lazy guard.
    feed(an, still(60, { [LM.L_WR]: { y: -0.33, z: -0.3 }, [LM.R_WR]: { y: -0.33, z: -0.3 } }).map(tilt), 0);
    const m = an.endRound();
    assert.ok(m.guard < 20, `guard ${m.guard}% tilted ${deg}°`);
  }
});

test('a left/right arm swap for a frame or two is undone, so it starts no false punches', () => {
  const swapArms = (w) => { const o = w.slice(); for (const [a, b] of [[13, 14], [15, 16]]) { o[a] = w[b]; o[b] = w[a]; } return o; };
  for (const step of [33, 66, 100]) {
    const an = new FormAnalyzer();
    an.startRound();
    let t = 0;
    const f = (frames) => { for (const w of frames) { an.update(w, image(w), t); t += step; } };
    f(still(30));
    f(still(2).map(swapArms));
    f(still(20));
    an.endRound();
    const c = an.calib;
    assert.deepEqual([c.punches.length, c.rejected.length, c.nearMiss.length], [0, 0, 0], `${step} ms/frame`);
    assert.ok(c.swaps >= 1, 'swap counted for the report');
  }
});

test('hand wobble starts no more false punches at 60 fps than at 30 fps', () => {
  // The tracker jitters a centimetre or two; per-frame speed made that look fast at 60 fps.
  const falseStarts = (fps) => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const an = new FormAnalyzer();
    an.startRound();
    for (let i = 0, t = 0; i < fps * 30; i++, t += 1000 / fps) {
      const w = pose();
      for (const k of [LM.L_WR, LM.R_WR, LM.L_EL, LM.R_EL]) w[k] = { x: w[k].x + rnd() * 0.015, y: w[k].y + rnd() * 0.015, z: w[k].z + rnd() * 0.03 };
      an.update(w, image(w), t);
    }
    an.endRound();
    return an.calib.punches.length + an.calib.rejected.length;
  };
  const at30 = falseStarts(30), at60 = falseStarts(60);
  assert.ok(at60 <= Math.max(3, at30 * 1.5), `30 fps: ${at30}, 60 fps: ${at60}`);
});

test('a sharp, fast jab counts; a fast jump of a bent arm is still a glitch', () => {
  const run = (frames) => {
    const an = new FormAnalyzer();
    an.startRound();
    let t = 0;
    for (const w of [...still(20), ...frames, ...still(20)]) { an.update(w, image(w), t); t += 16; } // 60 fps
    an.endRound();
    return an.calib;
  };
  // Jab: fist travels ~45 cm to full extension in ~50 ms (about 9 m/s), then back.
  const jab = punch(LM.L_WR, LM.L_EL, { x: 0.16, y: -0.49, z: -0.7 }, { x: 0.17, y: -0.47, z: -0.38 }, 3, 8);
  const c = run(jab);
  assert.deepEqual(c.punches.map((p) => p[0]), [1], `rejected: ${JSON.stringify(c.rejected)}`);
  assert.ok(c.punches[0][1] > 6.5, `fast enough to test the cap: ${c.punches[0][1]} m/s`);
  // Glitch: the wrist teleports 50 cm sideways with the elbow still bent, and back.
  const glitch = [pose({ [LM.R_WR]: { x: -0.6, y: -0.5, z: -0.15 } }), pose({ [LM.R_WR]: { x: -0.6, y: -0.5, z: -0.15 } })];
  assert.equal(run(glitch).punches.length, 0);
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

test('facing is right on real side-on pad footage landmarks', async () => {
  const { facing, leadSide } = await import('../web/js/form.js');
  // World landmarks MediaPipe produced for a boxer facing left in a real pad-work frame.
  const w = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  Object.assign(w, {
    [LM.NOSE]: { x: -0.306, y: -0.563, z: -0.069 },
    [LM.L_EAR]: { x: -0.196, y: -0.593, z: -0.155 }, [LM.R_EAR]: { x: -0.206, y: -0.628, z: -0.01 },
    [LM.L_SH]: { x: -0.135, y: -0.448, z: -0.215 }, [LM.R_SH]: { x: -0.156, y: -0.498, z: 0.087 },
    [LM.L_HIP]: { x: 0.012, y: 0.002, z: -0.11 }, [LM.R_HIP]: { x: -0.013, y: -0.003, z: 0.111 },
    [LM.L_ANK]: { x: -0.236, y: 0.662, z: -0.104 }, [LM.R_ANK]: { x: 0.11, y: 0.543, z: 0.442 },
  });
  const f = facing(w);
  assert.ok(f.x < -0.9, `facing ${JSON.stringify(f)}`);
  assert.equal(leadSide(w), 'L'); // orthodox, left foot forward
});

test('PersonTracker follows the boxer through side swaps and occlusion', async () => {
  const { PersonTracker, personAt } = await import('../web/js/form.js');
  const person = (x, scale = 1) => {
    const pts = Array.from({ length: 33 }, () => ({ x, y: 0.5 }));
    pts[LM.NOSE] = { x, y: 0.5 - 0.3 * scale };
    pts[LM.L_SH] = { x: x + 0.03, y: 0.5 - 0.22 * scale }; pts[LM.R_SH] = { x: x - 0.03, y: 0.5 - 0.22 * scale };
    pts[LM.L_HIP] = { x: x + 0.02, y: 0.5 }; pts[LM.R_HIP] = { x: x - 0.02, y: 0.5 };
    pts[LM.L_ANK] = { x: x + 0.04, y: 0.5 + 0.3 * scale }; pts[LM.R_ANK] = { x: x - 0.04, y: 0.5 + 0.3 * scale };
    return pts;
  };
  const RED = [200, 40, 40], BLACK = [30, 30, 35];
  // Boxer (red) starts on the left, coach (black) on the right; user taps the boxer.
  const start = [person(0.3), person(0.7)];
  assert.equal(personAt(start, 0.31, 0.4), 0);
  const tr = new PersonTracker();
  tr.lockOn(start[0], RED);
  let t = 0;
  // They circle and swap sides over 30 frames; detector order also flips halfway.
  for (let i = 0; i <= 30; i++) {
    const bx = 0.3 + (0.4 * i) / 30, cx = 0.7 - (0.4 * i) / 30;
    const people = i < 15 ? [person(bx), person(cx)] : [person(cx), person(bx)];
    const colors = i < 15 ? [RED, BLACK] : [BLACK, RED];
    const idx = tr.pick(people, colors, (t += 33));
    assert.equal(colors[idx], RED, `frame ${i} picked the wrong person`);
  }
  // The boxer is hidden for a few frames: only the coach is detected -> nobody, not the coach.
  for (let i = 0; i < 10; i++) assert.equal(tr.pick([person(0.3)], [BLACK], (t += 33)), -1);
  // Boxer reappears somewhere else: picked back up by appearance.
  t += 1500;
  const back = tr.pick([person(0.3), person(0.55)], [BLACK, RED], t);
  assert.equal(back, 1);

  // Alone in the video: a bad first look (wrong colour, other spot) never loses the boxer.
  const solo = new PersonTracker();
  solo.lockOn(person(0.2, 0.6), BLACK);
  for (let i = 0; i < 20; i++) assert.equal(solo.pick([person(0.7)], [RED], i * 33), 0, `solo frame ${i}`);
  assert.equal(solo.pick([], [], 700), -1);
});

test('head movement: punching alone is not head movement, slips are', () => {
  const run = (withSlips) => {
    const an = new FormAnalyzer();
    an.startRound();
    let t = 0;
    for (let rep = 0; rep < 8; rep++) {
      t = feed(an, punch(LM.L_WR, LM.L_EL, { x: 0.16, y: -0.49, z: -0.61 }, { x: 0.17, y: -0.47, z: -0.33 }), t);
      if (withSlips) {
        // Slip: head and shoulders move ~20 cm to the side, feet stay put.
        const slip = (dx) => pose({ [LM.NOSE]: { x: dx }, [LM.L_EAR]: { x: 0.07 + dx }, [LM.R_EAR]: { x: -0.07 + dx }, [LM.L_SH]: { x: 0.18 + dx * 0.7 }, [LM.R_SH]: { x: -0.15 + dx * 0.7 } });
        t = feed(an, [slip(0.1), slip(0.2), slip(0.2), slip(0.1), pose()], t);
      }
      t = feed(an, still(20), t);
    }
    return an.endRound();
  };
  const still_ = run(false), slipping = run(true);
  assert.ok(still_.head < 25, `punching only: ${still_.head}%`);
  assert.ok(slipping.head > still_.head + 15, `with slips: ${slipping.head}% vs ${still_.head}%`);
});

test('side-on footage leaves blade and stance width unmeasured; front-on measures them', () => {
  const front = new FormAnalyzer();
  front.startRound();
  feed(front, still(60), 0);
  const f = front.endRound();
  assert.ok(f.blade != null && f.stance != null, 'front view measured');
  assert.equal(f.sidePct, 0);

  // Same boxer, face pointing across the picture (camera at the side).
  const side = new FormAnalyzer();
  side.startRound();
  const prof = (w) => { w[LM.NOSE] = { x: 0.12, y: -0.62, z: 0.02 }; w[LM.L_EAR] = { x: 0.0, y: -0.63, z: 0.03 }; w[LM.R_EAR] = { x: 0.0, y: -0.63, z: 0.01 }; return w; };
  feed(side, still(60).map(prof), 0);
  const sd = side.endRound();
  assert.equal(sd.blade, null);
  assert.equal(sd.stance, null);
  assert.ok(sd.sidePct > 90);
  assert.ok(sd.crossedPct != null, 'crossed feet still checked');
  assert.ok(combineRounds([sd]).sidePct > 90, 'carried into the session');
});

test('a few front-on moments in a side-on clip are not enough to judge blade or stance', async () => {
  const { roundMetrics } = await import('../web/js/form.js');
  const base = { frames: 100, guardEligible: 0, guardUp: 0, stanceOk: 5, footFrames: 100, narrow: 3, wide: 1, crossed: 0, bladeOk: 1, moving: 0, headMoving: 0, sideFrames: 90,
    punches: { jab: 0, cross: 0, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 }, returnTimes: [], returnLead: [], returnRear: [], leadPunches: 0, rearDrops: 0, punchLog: [], leftCloser: 0, depthFrames: 0 };
  const few = roundMetrics({ ...base, stanceFrames: 10, bladeFrames: 10 });
  assert.equal(few.blade, null);
  assert.equal(few.stance, null);
  assert.equal(few.narrowPct, null);
  const many = roundMetrics({ ...base, stanceFrames: 40, bladeFrames: 40, stanceOk: 30, bladeOk: 30, sideFrames: 60 });
  assert.equal(many.blade, 75);
  assert.equal(many.stance, 75);
});

test('hand return is timed from full extension, and a hidden rear hand is not judged', () => {
  const an = new FormAnalyzer();
  an.startRound();
  let t = feed(an, still(10), 0);
  t = feed(an, punch(LM.L_WR, LM.L_EL, { x: 0.16, y: -0.49, z: -0.61 }, { x: 0.17, y: -0.47, z: -0.33 }, 5, 8), t);
  feed(an, still(15), t);
  const m = an.endRound();
  // 8 frames back at 33 ms: the hand is home ~200+ ms after full extension, not one frame later.
  assert.ok(m.leadReturnMs >= 150, `lead return ${m.leadReturnMs} ms`);
  assert.ok(an.calib.track.length > 20);

  // Rear hand hidden (low visibility) while jabbing: rear-drop is not judged at all.
  const hid = new FormAnalyzer();
  hid.startRound();
  const hide = (w) => w.map((p, i) => ({ x: 0.5 + p.x * 0.3, y: 0.5 + p.y * 0.3, visibility: i === LM.R_WR ? 0.1 : 0.99 }));
  let t2 = 0;
  for (const w of [...still(10), ...punch(LM.L_WR, LM.L_EL, { x: 0.16, y: -0.49, z: -0.61 }, { x: 0.17, y: -0.47, z: -0.33 }), ...still(15)]) { hid.update(w, hide(w), t2); t2 += 33; }
  assert.equal(hid.endRound().rearDropPct, null);
});

test('rolling in place is head movement, not footwork', () => {
  const an = new FormAnalyzer();
  an.startRound();
  // A roll: head and shoulders dip and come back while the hips and feet stay put. Seen in the
  // picture, the torso looks shorter at the bottom of the roll.
  const roll = (k) => pose({ [LM.NOSE]: { x: 0.12 * k, y: -0.62 + 0.3 * k }, [LM.L_EAR]: { y: -0.63 + 0.3 * k }, [LM.R_EAR]: { y: -0.63 + 0.3 * k },
    [LM.L_SH]: { y: -0.45 + 0.2 * k }, [LM.R_SH]: { y: -0.45 + 0.2 * k } });
  let t = 0;
  const run = (frames) => { for (const w of frames) { an.update(w, w.map((p) => ({ x: 0.5 + p.x * 0.3, y: 0.5 + p.y * 0.3, visibility: 0.99 })), t); t += 33; } };
  for (let rep = 0; rep < 10; rep++) {
    run([0.3, 0.6, 1, 1, 0.6, 0.3, 0].map(roll));
    run(still(40));
  }
  const m = an.endRound();
  assert.ok(m.footwork < 10, `footwork ${m.footwork}%`);
  assert.ok(m.headPerMin >= 8, `head moves/min ${m.headPerMin}`);
  assert.ok(m.head > 40, `head ${m.head}%`);
});

test('a jab that jolts the rear hand forward counts once; a fast one-two still counts two', () => {
  const run = (frames) => {
    const got = [];
    const an = new FormAnalyzer({ onPunch: (p) => got.push(p) });
    an.startRound();
    let t = feed(an, still(10), 0);
    t = feed(an, frames, t);
    feed(an, still(15), t);
    an.endRound();
    return { got, calib: an.calib };
  };
  const jab = punch(LM.L_WR, LM.L_EL, { x: 0.16, y: -0.49, z: -0.61 }, { x: 0.17, y: -0.47, z: -0.33 });
  // The body turns with the jab and shoves the bent rear hand forward at the same moment.
  const jolt = punch(LM.R_WR, LM.R_EL, { x: -0.02, y: -0.5, z: -0.45 }, { x: -0.14, y: -0.3, z: -0.12 });
  const both = jab.map((w, i) => { const o = [...w]; o[LM.R_WR] = jolt[i][LM.R_WR]; o[LM.R_EL] = jolt[i][LM.R_EL]; return o; });
  const a = run(both);
  assert.deepEqual(a.got, ['jab'], `rejected: ${JSON.stringify(a.calib.rejected)}`);
  assert.ok(a.calib.rejected.some((r) => r[5] === 'pair'));
  // Jab, then the cross a quarter of a second later: two punches.
  const cross = punch(LM.R_WR, LM.R_EL, { x: 0.02, y: -0.5, z: -0.5 }, { x: -0.1, y: -0.45, z: -0.2 });
  const oneTwo = [...jab.slice(0, 7), ...jab.slice(7).map((w, i) => { const o = [...w]; o[LM.R_WR] = cross[i][LM.R_WR]; o[LM.R_EL] = cross[i][LM.R_EL]; return o; }), ...cross.slice(4)];
  assert.deepEqual(run(oneTwo).got, ['jab', 'cross']);
});

test('a locked-out arm reads as a straight even when a low camera makes it seem to rise', async () => {
  const { classifyFeatures } = await import('../web/js/form.js');
  assert.equal(classifyFeatures({ ext: 0.97, angle: 162, rise: 0.25 }, 0.05, 0.2).kind, 'straight');
  // A bent arm that rises is still an uppercut.
  assert.equal(classifyFeatures({ ext: 0.75, angle: 95, rise: 0.25 }, 0.05, 0.1).kind, 'uppercut');
});
