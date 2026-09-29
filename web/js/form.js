// Pose-based boxing form analysis. Pure logic: feed it pose landmarks each frame,
// it counts/classifies punches, grades guard, stance and footwork, and emits live cues.
//
// Expects MediaPipe Pose landmark arrays:
//   world: 33 points in metres, hip-centred, y pointing down, z toward camera negative
//   image: 33 normalised points (0..1) with `visibility`

export const LM = {
  NOSE: 0,
  L_EAR: 7, R_EAR: 8,
  L_SH: 11, R_SH: 12,
  L_EL: 13, R_EL: 14,
  L_WR: 15, R_WR: 16,
  L_HIP: 23, R_HIP: 24,
  L_ANK: 27, R_ANK: 28,
};

export const PUNCH_NAMES = {
  jab: 'Jab', cross: 'Cross',
  leadHook: 'Lead hook', rearHook: 'Rear hook',
  leadUppercut: 'Lead uppercut', rearUppercut: 'Rear uppercut',
};

const REQUIRED = [LM.NOSE, LM.L_SH, LM.R_SH, LM.L_WR, LM.R_WR, LM.L_HIP, LM.R_HIP];

// Stance width (ankle distance / shoulder width) considered good.
export const STANCE_MIN = 0.9;
export const STANCE_MAX = 2.2;
export const BLADE_MIN_DEG = 12;

const CUE_COOLDOWN_MS = 7000;
const GLOBAL_CUE_GAP_MS = 2500;

const r2 = (x) => Math.round(x * 100) / 100;

export function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function angleDeg(a, b, c) {
  // angle at b formed by a-b-c
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const m = Math.hypot(v1.x, v1.y, v1.z) * Math.hypot(v2.x, v2.y, v2.z);
  if (!m) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180) / Math.PI;
}

// Pick which detected person is the boxer when more than one is in frame (pads, sparring).
// `prefer`: 'auto' (largest/closest), 'left' or 'right' as seen in the video. Once locked on,
// stay with the person nearest the previous position.
export function choosePose(people, prefer = 'auto', prev = null) {
  if (!people?.length) return -1;
  const info = people.map((pts, i) => {
    const hx = (pts[LM.L_HIP].x + pts[LM.R_HIP].x) / 2;
    const hy = (pts[LM.L_HIP].y + pts[LM.R_HIP].y) / 2;
    const top = Math.min(pts[LM.NOSE].y, pts[LM.L_SH].y, pts[LM.R_SH].y);
    const bottom = Math.max(pts[LM.L_ANK].y, pts[LM.R_ANK].y, hy);
    return { i, hx, hy, size: bottom - top };
  });
  if (prev) {
    const near = info.map((p) => ({ ...p, d: Math.hypot(p.hx - prev.x, p.hy - prev.y) })).sort((a, b) => a.d - b.d)[0];
    if (near.d < 0.2) return near.i;
  }
  if (prefer === 'left') return info.sort((a, b) => a.hx - b.hx)[0].i;
  if (prefer === 'right') return info.sort((a, b) => b.hx - a.hx)[0].i;
  return info.sort((a, b) => b.size - a.size)[0].i;
}

export function hipCenter(pts) {
  return { x: (pts[LM.L_HIP].x + pts[LM.R_HIP].x) / 2, y: (pts[LM.L_HIP].y + pts[LM.R_HIP].y) / 2 };
}

export function stanceRatio(world) {
  const la = world[LM.L_ANK], ra = world[LM.R_ANK];
  const sw = dist3(world[LM.L_SH], world[LM.R_SH]) || 1;
  return Math.hypot(la.x - ra.x, la.z - ra.z) / sw;
}

// Feet are crossed when the left ankle ends up on the right side of the right ankle
// along the hip line. Independent of orthodox/southpaw.
export function feetCrossed(world) {
  const lh = world[LM.L_HIP], rh = world[LM.R_HIP];
  const hx = lh.x - rh.x, hz = lh.z - rh.z;
  const hl = Math.hypot(hx, hz) || 1;
  const la = world[LM.L_ANK], ra = world[LM.R_ANK];
  const d = ((la.x - ra.x) * hx + (la.z - ra.z) * hz) / hl;
  return d < -0.02;
}

// Direction the boxer's face points, in the ground plane (x, z). Taken from the ear line so it
// works whatever angle the camera films from (front, 45°, side-on).
export function facing(world) {
  const le = world[LM.L_EAR], re = world[LM.R_EAR], nose = world[LM.NOSE];
  if (!le || !re) return null;
  const ex = le.x - re.x, ez = le.z - re.z;
  const len = Math.hypot(ex, ez);
  if (len < 0.03) {
    // Ears overlap when filmed exactly side-on: use shoulders → nose instead.
    const l = world[LM.L_SH], r = world[LM.R_SH];
    const nx = nose.x - (l.x + r.x) / 2, nz = nose.z - (l.z + r.z) / 2;
    const nl = Math.hypot(nx, nz);
    return nl > 0.03 ? { x: nx / nl, z: nz / nl } : null;
  }
  let fx = -ez / len, fz = ex / len;
  const ox = nose.x - (le.x + re.x) / 2, oz = nose.z - (le.z + re.z) / 2;
  if (fx * ox + fz * oz < 0) { fx = -fx; fz = -fz; }
  return { x: fx, z: fz };
}

// How far the shoulders are turned away from the face direction (0° = squared up).
export function bladeAngle(world) {
  const l = world[LM.L_SH], r = world[LM.R_SH];
  const sx = l.x - r.x, sz = l.z - r.z;
  const le = world[LM.L_EAR], re = world[LM.R_EAR];
  const ex = le ? le.x - re.x : 0, ez = le ? le.z - re.z : 0;
  const sl = Math.hypot(sx, sz), el = Math.hypot(ex, ez);
  if (el < 0.03 || !sl) return (Math.atan2(Math.abs(sz), Math.abs(sx)) * 180) / Math.PI;
  const cos = Math.min(1, Math.abs(sx * ex + sz * ez) / (sl * el));
  return (Math.acos(cos) * 180) / Math.PI;
}

// Which side leads, 'L' (orthodox), 'R' (southpaw) or null. Stance is defined by the lead foot
// (the one further toward where the boxer faces); shoulders are the fallback.
export function leadSide(world) {
  const f = facing(world);
  const along = (a, b) => (f ? (a.x - b.x) * f.x + (a.z - b.z) * f.z : b.z - a.z);
  const feet = along(world[LM.L_ANK], world[LM.R_ANK]);
  if (Math.abs(feet) > 0.08) return feet > 0 ? 'L' : 'R';
  const sh = along(world[LM.L_SH], world[LM.R_SH]);
  return Math.abs(sh) > 0.03 ? (sh > 0 ? 'L' : 'R') : null;
}

function emptyRound() {
  return {
    frames: 0, guardEligible: 0, guardUp: 0, stanceFrames: 0, stanceOk: 0,
    narrow: 0, wide: 0, crossed: 0, bladeOk: 0, moving: 0, headMoving: 0,
    punches: { jab: 0, cross: 0, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 },
    returnTimes: [], returnLead: [], returnRear: [], leadPunches: 0, rearDrops: 0,
    punchLog: [], leftCloser: 0, depthFrames: 0,
  };
}

// Punch numbers used by boxers: 1 jab, 2 cross, 3 lead hook, 4 rear hook, 5 lead uppercut, 6 rear uppercut.
export const PUNCH_DIGIT = { jab: 1, cross: 2, leadHook: 3, rearHook: 4, leadUppercut: 5, rearUppercut: 6 };

// Groups punches thrown within `gapMs` of each other into combinations, e.g. {"1-2": 4, "1-2-3": 2}.
export function sequencesFrom(punchLog, gapMs = 700) {
  const seqs = {};
  let cur = [];
  let last = -Infinity;
  const flush = () => {
    if (cur.length) {
      const k = cur.join('-');
      seqs[k] = (seqs[k] || 0) + 1;
    }
    cur = [];
  };
  for (const p of punchLog) {
    if (p.t - last > gapMs) flush();
    cur.push(PUNCH_DIGIT[p.type]);
    last = p.t;
  }
  flush();
  return seqs;
}

export function comboStats(seqs) {
  let punches = 0, inCombos = 0, combos = 0, comboLen = 0;
  for (const [k, n] of Object.entries(seqs)) {
    const len = k.split('-').length;
    punches += len * n;
    if (len >= 2) { inCombos += len * n; combos += n; comboLen += len * n; }
  }
  return {
    comboShare: punches ? Math.round((inCombos / punches) * 100) : null,
    avgComboLen: combos ? Math.round((comboLen / combos) * 10) / 10 : null,
    combos,
  };
}

function pct(n, d) {
  return d ? Math.round((n / d) * 100) : null;
}

export function roundMetrics(r) {
  const total = Object.values(r.punches).reduce((a, b) => a + b, 0);
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const avgReturn = avg(r.returnTimes);
  const sequences = sequencesFrom(r.punchLog);
  return {
    frames: r.frames,
    guard: pct(r.guardUp, r.guardEligible),
    stance: pct(r.stanceOk, r.stanceFrames),
    crossedPct: pct(r.crossed, r.stanceFrames),
    narrowPct: pct(r.narrow, r.stanceFrames),
    widePct: pct(r.wide, r.stanceFrames),
    blade: pct(r.bladeOk, r.frames),
    footwork: pct(r.moving, r.frames),
    head: pct(r.headMoving, r.frames),
    handReturnMs: avgReturn,
    leadReturnMs: avg(r.returnLead),
    rearReturnMs: avg(r.returnRear),
    rearDropPct: pct(r.rearDrops, r.leadPunches),
    punches: { ...r.punches },
    totalPunches: total,
    sequences,
    ...comboStats(sequences),
    leftLeadPct: pct(r.leftCloser, r.depthFrames),
  };
}

// Combine per-round metrics into a session-level summary, weighting by frames.
export function combineRounds(rounds) {
  const valid = rounds.filter((r) => r.frames > 0);
  const out = { perRound: rounds };
  const keys = ['guard', 'stance', 'crossedPct', 'narrowPct', 'widePct', 'blade', 'footwork', 'head', 'handReturnMs', 'leadReturnMs', 'rearReturnMs', 'rearDropPct', 'leftLeadPct'];
  for (const k of keys) {
    let sum = 0, w = 0;
    for (const r of valid) {
      if (r[k] == null) continue;
      sum += r[k] * r.frames;
      w += r.frames;
    }
    out[k] = w ? Math.round(sum / w) : null;
  }
  out.punches = { jab: 0, cross: 0, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 };
  for (const r of rounds) for (const k in r.punches) out.punches[k] += r.punches[k];
  out.totalPunches = Object.values(out.punches).reduce((a, b) => a + b, 0);
  out.sequences = {};
  for (const r of rounds) for (const [k, n] of Object.entries(r.sequences || {})) out.sequences[k] = (out.sequences[k] || 0) + n;
  Object.assign(out, comboStats(out.sequences));
  return out;
}

export class FormAnalyzer {
  constructor({ stance = 'orthodox', sensitivity = 1, onCue = () => {}, onPunch = () => {}, minVis = 0.5 } = {}) {
    this.stance = stance;
    this.minVis = minVis; // video filmed side-on hides the far arm, so video analysis accepts lower visibility
    this.vTh = 1.6 / Math.max(0.3, sensitivity); // wrist speed (m/s) that starts a punch
    this.onCue = onCue;
    this.onPunch = onPunch;
    const leadLeft = stance !== 'southpaw';
    this.hands = {
      lead: this._hand(leadLeft ? 'L' : 'R'),
      rear: this._hand(leadLeft ? 'R' : 'L'),
    };
    this.rearName = leadLeft ? 'right' : 'left';
    this.round = emptyRound();
    this.active = false;
    this.hipTrail = [];
    this.headTrail = [];
    this.since = {};
    this.lastCue = {};
    this.lastAnyCue = -Infinity;
    this.lastSeen = null;
    this.events = []; // detections with confidence, used for video review
    this.roundNo = 0;
    // Raw measurements behind each punch decision, for tuning thresholds to a real boxer.
    this.calib = { vTh: Math.round(this.vTh * 100) / 100, punches: [], rejected: [], nearMiss: [], frames: 0, tracked: 0 };
  }

  _hand(side) {
    return {
      side,
      sh: side === 'L' ? LM.L_SH : LM.R_SH,
      el: side === 'L' ? LM.L_EL : LM.R_EL,
      wr: side === 'L' ? LM.L_WR : LM.R_WR,
      prev: null, prevT: 0, speed: 0, prevNoseD: 0,
      state: 'idle', start: null, startT: 0, peakExt: 0, peakAngle: 0, maxNoseD: 0, maxRise: 0, maxLat: 0,
      armLen: 0, lastEnd: -Infinity, returnSince: null,
    };
  }

  startRound() {
    this.roundNo++;
    this.round = emptyRound();
    this.active = true;
    this.since = {};
  }

  endRound() {
    this.active = false;
    return roundMetrics(this.round);
  }

  event(kind, t, conf, extra = {}) {
    if (this.active) this.events.push({ kind, t: Math.round(t), conf: Math.round(conf), round: this.roundNo, ...extra });
  }

  cue(key, text, t) {
    if (t - this.lastAnyCue < GLOBAL_CUE_GAP_MS) return;
    if (t - (this.lastCue[key] ?? -Infinity) < CUE_COOLDOWN_MS) return;
    this.lastCue[key] = t;
    this.lastAnyCue = t;
    this.onCue(key, text);
  }

  // Tracks how long a condition has been continuously true.
  held(key, cond, t) {
    if (!cond) {
      delete this.since[key];
      return 0;
    }
    if (this.since[key] == null) this.since[key] = t;
    return t - this.since[key];
  }

  update(world, image, t) {
    if (!world || !image) {
      if (this.active && this.held('nobody', true, t) > 3000) this.cue('visibility', 'Step back so I can see your whole body', t);
      return null;
    }
    const visible = REQUIRED.every((i) => (image[i]?.visibility ?? 1) > this.minVis);
    if (this.active) {
      this.calib.frames++;
      if (visible) this.calib.tracked++;
    }
    if (!visible) {
      if (this.active && this.held('nobody', true, t) > 3000) this.cue('visibility', 'Step back so I can see your whole body', t);
      return null;
    }
    this.held('nobody', false, t);
    const r = this.round;
    const shMidY = (world[LM.L_SH].y + world[LM.R_SH].y) / 2;
    const nose = world[LM.NOSE];

    // --- Punch tracking per hand -------------------------------------------
    this.image = image;
    for (const role of ['lead', 'rear']) this._trackHand(role, world, nose, t);

    if (!this.active) return this.snapshot(world, image);
    r.frames++;

    // --- Guard ---------------------------------------------------------------
    let bothUp = true, eligible = true;
    for (const role of ['lead', 'rear']) {
      const h = this.hands[role];
      const recovering = h.returnSince != null && t - h.returnSince < 700;
      if (h.state !== 'idle' || recovering) { eligible = false; continue; }
      if (world[h.wr].y > shMidY + 0.06) bothUp = false;
    }
    if (eligible) {
      r.guardEligible++;
      if (bothUp) r.guardUp++;
    }
    const downFor = this.held('guardDown', eligible && !bothUp, t);
    if (downFor > 1200) {
      if (!this.guardEventOpen) {
        this.guardEventOpen = true;
        this.event('guardDrop', this.since.guardDown, 100 * this._vis([LM.L_WR, LM.R_WR, LM.L_SH, LM.R_SH]));
      }
      this.cue('guard', 'Hands up', t);
    } else if (!downFor) this.guardEventOpen = false;

    // --- Stance / feet -------------------------------------------------------
    const anklesVisible = (image[LM.L_ANK]?.visibility ?? 1) > 0.5 && (image[LM.R_ANK]?.visibility ?? 1) > 0.5;
    if (anklesVisible) {
      r.stanceFrames++;
      const ratio = stanceRatio(world);
      const crossed = feetCrossed(world);
      const narrow = !crossed && ratio < STANCE_MIN;
      const wide = ratio > STANCE_MAX;
      if (crossed) r.crossed++;
      if (narrow) r.narrow++;
      if (wide) r.wide++;
      if (!crossed && !narrow && !wide) r.stanceOk++;
      const crossedFor = this.held('crossed', crossed, t);
      if (crossedFor > 400) {
        if (!this.crossEventOpen) {
          this.crossEventOpen = true;
          this.event('crossedFeet', this.since.crossed, 100 * this._vis([LM.L_ANK, LM.R_ANK]));
        }
        this.cue('crossed', "Don't cross your feet", t);
      } else if (!crossedFor) this.crossEventOpen = false;
      if (this.held('narrow', narrow, t) > 1500) this.cue('narrow', 'Widen your stance', t);
      if (this.held('wide', wide, t) > 1500) this.cue('wide', 'Tighten up your stance', t);
    }

    // --- Blade (not squared up) ---------------------------------------------
    const bladed = bladeAngle(world) >= BLADE_MIN_DEG;
    if (bladed) r.bladeOk++;
    const lead = leadSide(world);
    if (lead) {
      r.depthFrames++;
      if (lead === 'L') r.leftCloser++;
    }
    if (this.held('squared', !bladed, t) > 2500) this.cue('squared', 'Turn your lead shoulder, stay bladed', t);

    // --- Footwork: hip centre movement in the image -------------------------
    const hip = { x: (image[LM.L_HIP].x + image[LM.R_HIP].x) / 2, y: (image[LM.L_HIP].y + image[LM.R_HIP].y) / 2, t };
    const moving = this._trailRange(this.hipTrail, hip, 1500) > 0.04;
    if (moving) r.moving++;
    if (this.held('static', !moving, t) > 7000) this.cue('static', 'Move your feet', t);

    // --- Head movement: nose off the hip line in the ground plane (camera-angle independent)
    const head = { x: nose.x, y: nose.z, t };
    const headMoving = this._trailRange(this.headTrail, head, 2000) > 0.07;
    if (headMoving) r.headMoving++;
    if (this.held('headStill', !headMoving, t) > 9000) this.cue('head', 'Move your head, slip after you punch', t);

    return this.snapshot(world, image);
  }

  _vis(idx) {
    if (!this.image) return 1;
    return idx.reduce((a, i) => a + (this.image[i]?.visibility ?? 1), 0) / idx.length;
  }

  _trailRange(trail, p, windowMs) {
    trail.push(p);
    while (trail.length && p.t - trail[0].t > windowMs) trail.shift();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of trail) {
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    }
    return Math.max(maxX - minX, maxY - minY);
  }

  _trackHand(role, world, nose, t) {
    const h = this.hands[role];
    const w = world[h.wr], sh = world[h.sh], el = world[h.el];
    const arm = dist3(sh, el) + dist3(el, w);
    h.armLen = Math.max(h.armLen * 0.995, arm);
    const noseD = dist3(w, nose);
    if (h.prev) {
      const dt = Math.max(1, t - h.prevT) / 1000;
      const inst = dist3(w, h.prev) / dt;
      h.speed = h.speed * 0.4 + inst * 0.6;
    }
    const away = noseD > h.prevNoseD;
    const shMidY = (world[LM.L_SH].y + world[LM.R_SH].y) / 2;

    if (h.state === 'idle') {
      // Near-misses: fast hand movements that stayed under the punch threshold.
      if (h.speed > this.vTh * 0.6 && h.speed <= this.vTh && away) h.nearPeak = Math.max(h.nearPeak || 0, h.speed);
      else if (h.nearPeak && h.speed < this.vTh * 0.4) {
        this._calibPush('nearMiss', [role === 'lead' ? 'L' : 'R', r2(h.nearPeak)]);
        h.nearPeak = 0;
      }
      if (h.speed > this.vTh && away && t - h.lastEnd > 180) {
        h.nearPeak = 0;
        h.state = 'punch';
        h.start = h.prev || w;
        h.startT = t;
        h.peakExt = 0; h.peakAngle = 0; h.maxNoseD = noseD; h.maxRise = 0; h.maxLat = 0; h.peakSpeed = 0;
        h.rearDropped = false;
      }
    }
    if (h.state === 'punch') {
      h.peakSpeed = Math.max(h.peakSpeed, h.speed);
      h.peakExt = Math.max(h.peakExt, dist3(sh, w) / (h.armLen || 1));
      h.peakAngle = Math.max(h.peakAngle, angleDeg(sh, el, w));
      h.maxNoseD = Math.max(h.maxNoseD, noseD);
      h.maxRise = Math.max(h.maxRise, h.start.y - w.y);
      h.maxLat = Math.max(h.maxLat, Math.abs(w.x - h.start.x));
      if (role === 'lead' && this.active && !h.rearDropped) {
        const rear = world[this.hands.rear.wr];
        if (rear.y > shMidY + 0.1) h.rearDropped = true;
      }
      const retracting = noseD < h.maxNoseD - 0.04;
      const slowed = h.speed < this.vTh * 0.5;
      if (retracting || slowed || t - h.startT > 700) {
        h.state = 'idle';
        h.lastEnd = t;
        const travel = h.maxNoseD - dist3(h.start, nose);
        if (travel > 0.1 || h.peakExt > 0.85) this._registerPunch(role, h, t);
        else this._calibPush('rejected', [role === 'lead' ? 'L' : 'R', r2(h.peakSpeed), r2(h.peakExt), Math.round(h.peakAngle), r2(travel)]);
      }
    }
    // Hand return: back in guard near the face.
    if (h.returnSince != null && h.state === 'idle') {
      const done = w.y <= shMidY + 0.06 && noseD < 0.38 ? t - h.returnSince : t - h.returnSince > 1500 ? 1500 : null;
      if (done != null) {
        if (this.active) {
          this.round.returnTimes.push(done);
          this.round[role === 'lead' ? 'returnLead' : 'returnRear'].push(done);
        }
        h.returnSince = null;
      }
    }
    h.prev = { x: w.x, y: w.y, z: w.z };
    h.prevT = t;
    h.prevNoseD = noseD;
  }

  _registerPunch(role, h, t) {
    let kind, margin;
    if (h.peakAngle >= 145 && h.peakExt >= 0.8) {
      kind = 'straight';
      margin = Math.min(1, (h.peakAngle - 135) / 35);
    } else if (h.maxRise > 0.12 && h.maxRise > h.maxLat) {
      kind = 'uppercut';
      margin = Math.min(1, 0.4 + (h.maxRise - h.maxLat) / 0.15);
    } else {
      kind = 'hook';
      margin = Math.min(1, 0.4 + Math.max(0, 145 - h.peakAngle) / 50);
    }
    const vis = this._vis([h.sh, h.el, h.wr]);
    const conf = 100 * vis * (0.55 + 0.45 * Math.min(1, h.peakSpeed / (this.vTh * 1.8))) * (0.6 + 0.4 * Math.max(0, margin));
    const type =
      kind === 'straight' ? (role === 'lead' ? 'jab' : 'cross')
        : kind === 'hook' ? (role === 'lead' ? 'leadHook' : 'rearHook')
          : role === 'lead' ? 'leadUppercut' : 'rearUppercut';
    h.returnSince = t;
    if (!this.active) return;
    this.round.punches[type]++;
    this.round.punchLog.push({ t, type });
    this.event('punch', t, conf, { type });
    this._calibPush('punches', [PUNCH_DIGIT[type], r2(h.peakSpeed), r2(h.peakExt), Math.round(h.peakAngle), r2(h.maxRise), r2(h.maxLat), Math.round(conf)]);
    if (role === 'lead') {
      this.round.leadPunches++;
      if (h.rearDropped) {
        this.round.rearDrops++;
        this.cue('rearDrop', `Keep your ${this.rearName} hand home when you jab`, t);
      }
    }
    this.onPunch(type, { t, conf });
  }

  _calibPush(list, row) {
    if (this.active && this.calib[list].length < 300) this.calib[list].push(row);
  }

  snapshot() {
    const m = roundMetrics(this.round);
    return m;
  }
}
