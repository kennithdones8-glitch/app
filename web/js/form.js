// Pose-based boxing form analysis. Pure logic: feed it pose landmarks each frame,
// it counts/classifies punches, grades guard, stance and footwork, and emits live cues.
//
// Expects MediaPipe Pose landmark arrays:
//   world: 33 points in metres, hip-centred, y pointing down, z toward camera negative
//   image: 33 normalised points (0..1) with `visibility`

export const LM = {
  NOSE: 0,
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

export function bladeAngle(world) {
  const l = world[LM.L_SH], r = world[LM.R_SH];
  return (Math.atan2(Math.abs(l.z - r.z), Math.abs(l.x - r.x)) * 180) / Math.PI;
}

function emptyRound() {
  return {
    frames: 0, guardEligible: 0, guardUp: 0, stanceFrames: 0, stanceOk: 0,
    narrow: 0, wide: 0, crossed: 0, bladeOk: 0, moving: 0, headMoving: 0,
    punches: { jab: 0, cross: 0, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 },
    returnTimes: [], leadPunches: 0, rearDrops: 0,
  };
}

function pct(n, d) {
  return d ? Math.round((n / d) * 100) : null;
}

export function roundMetrics(r) {
  const total = Object.values(r.punches).reduce((a, b) => a + b, 0);
  const avgReturn = r.returnTimes.length
    ? Math.round(r.returnTimes.reduce((a, b) => a + b, 0) / r.returnTimes.length)
    : null;
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
    rearDropPct: pct(r.rearDrops, r.leadPunches),
    punches: { ...r.punches },
    totalPunches: total,
  };
}

// Combine per-round metrics into a session-level summary, weighting by frames.
export function combineRounds(rounds) {
  const valid = rounds.filter((r) => r.frames > 0);
  const out = { perRound: rounds };
  const keys = ['guard', 'stance', 'crossedPct', 'narrowPct', 'widePct', 'blade', 'footwork', 'head', 'handReturnMs', 'rearDropPct'];
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
  return out;
}

export class FormAnalyzer {
  constructor({ stance = 'orthodox', sensitivity = 1, onCue = () => {}, onPunch = () => {} } = {}) {
    this.stance = stance;
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
    this.round = emptyRound();
    this.active = true;
    this.since = {};
  }

  endRound() {
    this.active = false;
    return roundMetrics(this.round);
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
    const visible = REQUIRED.every((i) => (image[i]?.visibility ?? 1) > 0.5);
    if (!visible) {
      if (this.active && this.held('nobody', true, t) > 3000) this.cue('visibility', 'Step back so I can see your whole body', t);
      return null;
    }
    this.held('nobody', false, t);
    const r = this.round;
    const shMidY = (world[LM.L_SH].y + world[LM.R_SH].y) / 2;
    const nose = world[LM.NOSE];

    // --- Punch tracking per hand -------------------------------------------
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
    if (this.held('guardDown', eligible && !bothUp, t) > 1200) this.cue('guard', 'Hands up', t);

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
      if (this.held('crossed', crossed, t) > 400) this.cue('crossed', "Don't cross your feet", t);
      if (this.held('narrow', narrow, t) > 1500) this.cue('narrow', 'Widen your stance', t);
      if (this.held('wide', wide, t) > 1500) this.cue('wide', 'Tighten up your stance', t);
    }

    // --- Blade (not squared up) ---------------------------------------------
    const bladed = bladeAngle(world) >= BLADE_MIN_DEG;
    if (bladed) r.bladeOk++;
    if (this.held('squared', !bladed, t) > 2500) this.cue('squared', 'Turn your lead shoulder, stay bladed', t);

    // --- Footwork: hip centre movement in the image -------------------------
    const hip = { x: (image[LM.L_HIP].x + image[LM.R_HIP].x) / 2, y: (image[LM.L_HIP].y + image[LM.R_HIP].y) / 2, t };
    const moving = this._trailRange(this.hipTrail, hip, 1500) > 0.04;
    if (moving) r.moving++;
    if (this.held('static', !moving, t) > 7000) this.cue('static', 'Move your feet', t);

    // --- Head movement: nose lateral offset from hip centre ------------------
    const head = { x: nose.x, y: 0, t };
    const headMoving = this._trailRange(this.headTrail, head, 2000) > 0.07;
    if (headMoving) r.headMoving++;
    if (this.held('headStill', !headMoving, t) > 9000) this.cue('head', 'Move your head, slip after you punch', t);

    return this.snapshot(world, image);
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
      if (h.speed > this.vTh && away && t - h.lastEnd > 180) {
        h.state = 'punch';
        h.start = h.prev || w;
        h.startT = t;
        h.peakExt = 0; h.peakAngle = 0; h.maxNoseD = noseD; h.maxRise = 0; h.maxLat = 0;
        h.rearDropped = false;
      }
    }
    if (h.state === 'punch') {
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
      }
    }
    // Hand return: back in guard near the face.
    if (h.returnSince != null && h.state === 'idle') {
      if (w.y <= shMidY + 0.06 && noseD < 0.38) {
        if (this.active) this.round.returnTimes.push(t - h.returnSince);
        h.returnSince = null;
      } else if (t - h.returnSince > 1500) {
        if (this.active) this.round.returnTimes.push(1500);
        h.returnSince = null;
      }
    }
    h.prev = { x: w.x, y: w.y, z: w.z };
    h.prevT = t;
    h.prevNoseD = noseD;
  }

  _registerPunch(role, h, t) {
    let kind;
    if (h.peakAngle >= 145 && h.peakExt >= 0.8) kind = 'straight';
    else if (h.maxRise > 0.12 && h.maxRise > h.maxLat) kind = 'uppercut';
    else kind = 'hook';
    const type =
      kind === 'straight' ? (role === 'lead' ? 'jab' : 'cross')
        : kind === 'hook' ? (role === 'lead' ? 'leadHook' : 'rearHook')
          : role === 'lead' ? 'leadUppercut' : 'rearUppercut';
    h.returnSince = t;
    if (!this.active) return;
    this.round.punches[type]++;
    if (role === 'lead') {
      this.round.leadPunches++;
      if (h.rearDropped) {
        this.round.rearDrops++;
        this.cue('rearDrop', `Keep your ${this.rearName} hand home when you jab`, t);
      }
    }
    this.onPunch(type);
  }

  snapshot() {
    const m = roundMetrics(this.round);
    return m;
  }
}
