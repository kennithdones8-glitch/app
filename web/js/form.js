import { example as personalExample, readerFor } from './personal.js';
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

// The pose model sometimes swaps the left and right arm for a frame or two when the arms cross,
// blur or hide each other. Both wrists then "jump" to where the other one was, which looks like
// two fast punches. If swapping them back fits the previous frame far better, undo the swap.
const ARM_PAIRS = [[13, 14], [15, 16], [17, 18], [19, 20], [21, 22]];
export function unswapArms(world, image, prev) {
  const L = world[LM.L_WR], R = world[LM.R_WR];
  let swapped = false;
  if (prev) {
    const same = dist3(L, prev.l) + dist3(R, prev.r);
    const cross = dist3(L, prev.r) + dist3(R, prev.l);
    // Both wrists moved a long way, and each landed where the other one was.
    if (same > 0.3 && cross < same * 0.35) {
      swapped = true;
      const sw = (arr) => {
        const out = arr.slice();
        for (const [a, b] of ARM_PAIRS) { out[a] = arr[b]; out[b] = arr[a]; }
        return out;
      };
      world = sw(world);
      image = sw(image);
    }
  }
  return { world, image, swapped, prev: { l: world[LM.L_WR], r: world[LM.R_WR] } };
}

export const PUNCH_NAMES = {
  jab: 'Jab', cross: 'Cross',
  leadHook: 'Lead hook', rearHook: 'Rear hook',
  leadUppercut: 'Lead uppercut', rearUppercut: 'Rear uppercut',
};

// Head, shoulders and hips must be visible; each hand is checked on its own (filmed side-on,
// the far hand is often hidden without the rest of the body being lost).
const REQUIRED = [LM.NOSE, LM.L_SH, LM.R_SH, LM.L_HIP, LM.R_HIP];

// Stance width (ankle distance / shoulder width) considered good.
export const STANCE_MIN = 0.9;
export const STANCE_MAX = 2.2;
export const BLADE_MIN_DEG = 12;

const CUE_COOLDOWN_MS = 45000; // the same reminder at most every 45 s
const GLOBAL_CUE_GAP_MS = 15000; // and any reminder at most every 15 s

const r2 = (x) => Math.round(x * 100) / 100;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const norm2 = (v) => { const l = Math.hypot(v.x, v.z) || 1; return { x: v.x / l, z: v.z / l }; };

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

// Follows one specific person through a video with others in it. Identity comes from what they
// look like (clothing colour, size) plus where they are, so it survives swapping sides, crossing
// paths and brief occlusion. When the target can't be found it reports nobody (-1) rather than
// jumping to someone else.
export function personFeatures(pts) {
  const hx = (pts[LM.L_HIP].x + pts[LM.R_HIP].x) / 2, hy = (pts[LM.L_HIP].y + pts[LM.R_HIP].y) / 2;
  const top = Math.min(pts[LM.NOSE].y, pts[LM.L_SH].y, pts[LM.R_SH].y);
  const bottom = Math.max(pts[LM.L_ANK].y, pts[LM.R_ANK].y, hy);
  return { x: hx, y: hy, size: Math.max(0.05, bottom - top) };
}

const colorDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export class PersonTracker {
  constructor() {
    this.target = null;
    this.lostSince = null;
    this.crowd = false; // ever seen more than one person
  }

  get locked() {
    return !!this.target;
  }

  lockOn(pts, color = null) {
    this.target = { ...personFeatures(pts), color };
    this.lostSince = null;
  }

  // people: image landmarks per detected person; colors: [r, g, b] torso colour per person.
  pick(people, colors = [], t = 0) {
    if (!this.target || !people?.length) {
      if (this.target && this.lostSince == null) this.lostSince = t;
      return -1;
    }
    if (people.length > 1) this.crowd = true;
    // Nobody else has ever been in shot: the one person found is the boxer, however their
    // position, size or colours changed (a wrong first look used to lose them for good).
    if (people.length === 1 && !this.crowd) {
      this.lockOn(people[0], colors[0] || this.target.color);
      return 0;
    }
    const lost = this.lostSince != null && t - this.lostSince > 1000;
    let best = -1, bestScore = Infinity;
    people.forEach((pts, i) => {
      const f = personFeatures(pts);
      const pd = Math.hypot(f.x - this.target.x, f.y - this.target.y);
      const sd = Math.abs(Math.log(f.size / this.target.size));
      const cd = colors[i] && this.target.color ? colorDist(colors[i], this.target.color) : null;
      // After losing them for a while, position is stale: rely on appearance.
      let score = (lost ? Math.min(pd / 0.2, 1) : pd / 0.2) + sd * 2 + (cd != null ? cd / 45 : 0.6);
      if (cd != null && cd > 85) score += 10; // clearly a different person
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (bestScore > 3.5) {
      if (this.lostSince == null) this.lostSince = t;
      return -1;
    }
    const f = personFeatures(people[best]);
    this.target.x = f.x;
    this.target.y = f.y;
    this.target.size = this.target.size * 0.8 + f.size * 0.2;
    if (colors[best]) {
      this.target.color = this.target.color && bestScore < 2
        ? this.target.color.map((c, k) => c * 0.9 + colors[best][k] * 0.1)
        : this.target.color || colors[best];
    }
    this.lostSince = null;
    return best;
  }
}

// Index of the person nearest a tap (normalised image coordinates).
export function personAt(people, x, y) {
  let best = -1, bestD = Infinity;
  people.forEach((pts, i) => {
    const xs = [LM.NOSE, LM.L_SH, LM.R_SH, LM.L_HIP, LM.R_HIP, LM.L_ANK, LM.R_ANK].map((k) => pts[k]);
    const minX = Math.min(...xs.map((p) => p.x)) - 0.03, maxX = Math.max(...xs.map((p) => p.x)) + 0.03;
    const minY = Math.min(...xs.map((p) => p.y)) - 0.05, maxY = Math.max(...xs.map((p) => p.y)) + 0.03;
    const inside = x >= minX && x <= maxX && y >= minY && y <= maxY;
    const f = personFeatures(pts);
    const d = Math.hypot(x - f.x, y - f.y) - (inside ? 1 : 0);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
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
  // The nose sits in front of the ears in the direction the boxer faces. This is stable from any
  // camera angle (the ear-line normal alone was ~90° off on real side-on pad footage).
  const ox = nose.x - (le.x + re.x) / 2, oz = nose.z - (le.z + re.z) / 2;
  const ol = Math.hypot(ox, oz);
  if (ol >= 0.03) return { x: ox / ol, z: oz / ol };
  // Fallbacks: the ear-line normal, then shoulders → nose.
  const ex = le.x - re.x, ez = le.z - re.z;
  const len = Math.hypot(ex, ez);
  if (len >= 0.03) {
    let fx = -ez / len, fz = ex / len;
    if (fx * ox + fz * oz < 0) { fx = -fx; fz = -fz; }
    return { x: fx, z: fz };
  }
  const l = world[LM.L_SH], r = world[LM.R_SH];
  const nx = nose.x - (l.x + r.x) / 2, nz = nose.z - (l.z + r.z) / 2;
  const nl = Math.hypot(nx, nz);
  return nl > 0.03 ? { x: nx / nl, z: nz / nl } : null;
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
export function leadSide(world, forward = null) {
  const f = forward || facing(world);
  const along = (a, b) => (f ? (a.x - b.x) * f.x + (a.z - b.z) * f.z : b.z - a.z);
  const feet = along(world[LM.L_ANK], world[LM.R_ANK]);
  if (Math.abs(feet) > 0.08) return feet > 0 ? 'L' : 'R';
  const sh = along(world[LM.L_SH], world[LM.R_SH]);
  return Math.abs(sh) > 0.03 ? (sh > 0 ? 'L' : 'R') : null;
}

function emptyRound() {
  return {
    frames: 0, guardEligible: 0, guardUp: 0, stanceFrames: 0, stanceOk: 0, footFrames: 0,
    narrow: 0, wide: 0, crossed: 0, bladeOk: 0, bladeFrames: 0, moving: 0, headMoving: 0, headMoves: 0, t0: null, t1: null, sideFrames: 0,
    punches: { jab: 0, cross: 0, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 },
    returnTimes: [], returnLead: [], returnRear: [], leadPunches: 0, rearDrops: 0,
    punchLog: [], leftCloser: 0, depthFrames: 0,
  };
}

// Punch numbers used by boxers: 1 jab, 2 cross, 3 lead hook, 4 rear hook, 5 lead uppercut, 6 rear uppercut.
export const PUNCH_TYPE = {
  straight: { lead: 'jab', rear: 'cross' }, hook: { lead: 'leadHook', rear: 'rearHook' }, uppercut: { lead: 'leadUppercut', rear: 'rearUppercut' },
};
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

// The punches thrown, in order, with the gap between each pair:
// '-' within 0.7 s (same combination), '~' within 1.6 s (room for a slip or roll), ' ' a new exchange.
export function streamFrom(punchLog, tight = 700, loose = 1600) {
  let s = '', last = null;
  for (const p of punchLog) {
    const d = PUNCH_DIGIT[p.type];
    if (!d) continue;
    if (last != null) {
      const g = p.t - last;
      s += g <= tight ? '-' : g <= loose ? '~' : ' ';
    }
    s += d;
    last = p.t;
  }
  return s;
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

const frontEnough = (n, r) => n >= 0.3 * r.frames;

// Stance width and shoulder turn come from the camera's depth guess. You know which foot leads;
// when depth gets even that wrong most of the time (a low or tilted phone: orthodox read as
// 15-46% left lead), its widths and angles are noise too, so they're left unmeasured.
export function depthTrusted(r, min = 30) {
  if (r.expectLeft == null || (r.depthFrames || 0) < min) return true;
  const agree = r.expectLeft ? r.leftCloser : r.depthFrames - r.leftCloser;
  return agree >= 0.7 * r.depthFrames;
}

export function roundMetrics(r) {
  const total = Object.values(r.punches).reduce((a, b) => a + b, 0);
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const avgReturn = avg(r.returnTimes);
  const sequences = sequencesFrom(r.punchLog);
  const depthOk = depthTrusted(r);
  const front = (n) => depthOk && frontEnough(n, r);
  return {
    frames: r.frames,
    depthOk,
    guard: pct(r.guardUp, r.guardEligible),
    // Stance width and blade need depth, which is only usable when the camera sees you from the
    // front; side-on they're left unmeasured (null) rather than guessed.
    // A few front-on moments in a side-on clip aren't enough to judge: need 30% of the round.
    stance: front(r.stanceFrames) ? pct(r.stanceOk, r.stanceFrames) : null,
    crossedPct: pct(r.crossed, r.footFrames ?? r.stanceFrames),
    narrowPct: front(r.stanceFrames) ? pct(r.narrow, r.stanceFrames) : null,
    widePct: front(r.stanceFrames) ? pct(r.wide, r.stanceFrames) : null,
    blade: front(r.bladeFrames ?? r.frames) ? pct(r.bladeOk, r.bladeFrames ?? r.frames) : null,
    sidePct: pct(r.sideFrames || 0, r.frames),
    footwork: pct(r.moving, r.frames),
    head: pct(r.headMoving, r.frames),
    headPerMin: r.t1 > r.t0 ? Math.round(((r.headMoves || 0) / ((r.t1 - r.t0) / 60000)) * 10) / 10 : null,
    handReturnMs: avgReturn,
    leadReturnMs: avg(r.returnLead),
    rearReturnMs: avg(r.returnRear),
    rearDropPct: pct(r.rearDrops, r.leadPunches),
    punches: { ...r.punches },
    totalPunches: total,
    sequences,
    stream: streamFrom(r.punchLog),
    ...comboStats(sequences),
    leftLeadPct: pct(r.leftCloser, r.depthFrames),
  };
}

// Combine per-round metrics into a session-level summary, weighting by frames.
export function combineRounds(rounds) {
  const valid = rounds.filter((r) => r.frames > 0);
  const out = { perRound: rounds };
  const keys = ['guard', 'stance', 'crossedPct', 'narrowPct', 'widePct', 'blade', 'footwork', 'head', 'handReturnMs', 'leadReturnMs', 'rearReturnMs', 'rearDropPct', 'leftLeadPct', 'sidePct', 'headPerMin'];
  for (const k of keys) {
    let sum = 0, w = 0;
    for (const r of valid) {
      if (r[k] == null) continue;
      sum += r[k] * r.frames;
      w += r.frames;
    }
    out[k] = w ? Math.round(sum / w) : null;
  }
  out.depthOk = !valid.some((r) => r.depthOk === false);
  out.punches = { jab: 0, cross: 0, leadHook: 0, rearHook: 0, leadUppercut: 0, rearUppercut: 0 };
  for (const r of rounds) for (const k in r.punches) out.punches[k] += r.punches[k];
  out.totalPunches = Object.values(out.punches).reduce((a, b) => a + b, 0);
  out.sequences = {};
  for (const r of rounds) for (const [k, n] of Object.entries(r.sequences || {})) out.sequences[k] = (out.sequences[k] || 0) + n;
  Object.assign(out, comboStats(out.sequences));
  return out;
}

// 2D (image-plane) arm measurements. The 3D depth estimate is too weak on side-on pad footage to
// tell straights from hooks, while the flat picture is tracked much more precisely. `A` converts
// x to the same units as y (video width / height). Lengths are in torso heights.
function arm2d(image, sh, el, wr, A) {
  const P = (k) => ({ x: image[k].x * A, y: image[k].y });
  const S = P(sh), E = P(el), W = P(wr);
  const mid = (a, b) => ({ x: (image[a].x + image[b].x) * A / 2, y: (image[a].y + image[b].y) / 2 });
  const torso = Math.hypot(...Object.values(sub2(mid(LM.L_SH, LM.R_SH), mid(LM.L_HIP, LM.R_HIP)))) || 1;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / torso;
  const u = sub2(S, E), f = sub2(W, E);
  const cos = (u.x * f.x + u.y * f.y) / ((Math.hypot(u.x, u.y) * Math.hypot(f.x, f.y)) || 1);
  return {
    W, torso,
    ext: d(S, W), // shoulder → wrist
    angle: (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI, // elbow angle as seen
    fore: d(E, W) / (d(S, E) || 1), // forearm vs upper arm as seen: short when it points at the camera
    elbUp: (S.y - E.y) / torso, // elbow height relative to the shoulder
    vis: Math.min(image[el].visibility ?? 1, image[wr].visibility ?? 1),
  };
}
const sub2 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

// The body's "up" and two level directions, in the pose model's camera-aligned coordinates.
// A phone on the floor tilted up (or held high, tilted down) turns the camera's axes: a punch
// straight at the camera then seems to rise. Measuring against the body fixes that.
const norm3 = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export function bodyFrame(up) {
  const e1 = norm3({ x: 1 - up.x * up.x, y: -up.x * up.y, z: -up.x * up.z }); // camera x, levelled
  const e2 = { x: up.y * e1.z - up.z * e1.y, y: up.z * e1.x - up.x * e1.z, z: up.x * e1.y - up.y * e1.x }; // up × e1
  // Movement d → [sideways, depth] on the level plane and height gained.
  return (d) => ({ h: [dot3(d, e1), dot3(d, e2)], rise: dot3(d, up) });
}

// Forward / sideways travel of a punch path relative to an axis in the ground plane.
function travel(path, axis) {
  let fwd = 0, lat = 0;
  for (const [dx, dz] of path) {
    fwd = Math.max(fwd, dx * axis.x + dz * axis.z);
    lat = Math.max(lat, Math.abs(dx * -axis.z + dz * axis.x));
  }
  return { fwd, lat };
}

// Straight, hook or uppercut from a punch's measurements and the forward axis.
// p: { angle, ext, rise, path: [[dx, dz], ...] } in metres / degrees.
// cal.ratio: how much more forward than sideways travel makes a straight (learned per boxer and
// camera from a drilled combo; pads stop the arm early, so straights aren't always locked out).
export const DEFAULT_STRAIGHT_RATIO = 1.8;
export function classifyPunch(p, axis, cal = null) {
  const { fwd, lat } = travel(p.path || [], axis);
  return classifyFeatures(p, fwd, lat, cal);
}

// The same decision from already-measured forward/sideways travel (also used to score saved clips).
export function classifyFeatures(p, fwd, lat, cal = null) {
  const T = cal?.ratio ?? DEFAULT_STRAIGHT_RATIO;
  const straightish = p.rise < 0.15 && p.ext >= 0.55 && fwd > 0.08 && fwd >= T * lat;
  // A locked-out arm is a straight even when it seems to rise: a low phone (or a tilt the body
  // frame missed) makes straights look like they go up. Hooks and uppercuts keep the elbow bent.
  if ((p.angle >= 145 && p.ext >= 0.8) || straightish) {
    const byDir = straightish ? 0.5 + (fwd / Math.max(lat, 0.01) - T) / (2 * T) : 0;
    return { kind: 'straight', fwd, lat, margin: Math.min(1, Math.max((p.angle - 135) / 35, byDir)) };
  }
  if (p.rise > 0.12 && p.rise > lat && p.rise > fwd * 0.7) {
    return { kind: 'uppercut', fwd, lat, margin: Math.min(1, 0.4 + (p.rise - lat) / 0.15) };
  }
  // The rear hand throws far more crosses than hooks, and a cross at the camera often shows no
  // forward travel at all. Only call it a rear hook when the hand really swung out (three real
  // recordings: crosses read as rear hooks were the top mistake; every real rear hook went 10 cm+).
  if (p.role === 'rear' && lat < REAR_HOOK_LAT) return { kind: 'straight', fwd, lat, margin: 0.3 };
  return { kind: 'hook', fwd, lat, margin: Math.min(1, 0.4 + Math.max(0, 145 - p.angle) / 50, 0.3 + (T - fwd / Math.max(lat, 0.01)) / T) };
}
const REAR_HOOK_LAT = 0.1;

// The direction punches travel, from where each punch ended up relative to where it started.
// Jabs, crosses and hooks all land in front of you; hooks only swing out on the way. This is
// independent of the camera angle and of the face, which may be hidden (filmed from behind).
export function punchAxis(disps, min = 4) {
  let x = 0, z = 0;
  for (const [dx, dz] of disps) { x += dx; z += dz; }
  const l = Math.hypot(x, z);
  return disps.length >= min && l > 0.05 ? { x: x / l, z: z / l } : null;
}

// Hooks lean the average toward one side when one hand throws more of them (e.g. lots of lead
// hooks, no rear hooks). Straights point dead ahead, so re-estimate from the punches that read as
// straight, a few times over.
export function refineAxis(feats, cal = null) {
  let axis = punchAxis(feats.map((f) => f.disp));
  for (let i = 0; axis && i < 3; i++) {
    const straight = feats.filter((f) => classifyPunch(f, axis, cal).kind === 'straight');
    const next = punchAxis(straight.map((f) => f.disp), 3);
    if (!next) break;
    axis = next;
  }
  return axis;
}

const SPEED_WINDOW_MS = 30; // hand speed is measured over at least this much time
// Both hands "punching" with their full extension this close together is one punch: throwing one
// hand turns the body and jolts the other (a bag report counted 13 of these pairs in 23 s).
const PAIR_MS = 120;
// A locked-out straight jolts the idle hand a moment before or after; a bent, short "punch" from
// the other hand that close is that jolt (a floor test: 7 of these around 20 jabs, all 0.1-0.2 s off).
const JOLT_MS = 250;
const locked = (p) => p.peakExt >= 0.88 && p.peakAngle >= 140;
const bent = (p) => p.peakExt < 0.8 && p.peakAngle < 110;
const REARM_MS = 400; // after this long the same hand may punch again even if it stayed out
const PUNCH_CONF = (vis, speed, vTh, margin) => 100 * (0.5 + 0.5 * vis) * (0.55 + 0.45 * Math.min(1, speed / (vTh * 1.8))) * (0.6 + 0.4 * Math.max(0, margin));

export class FormAnalyzer {
  constructor({ stance = 'orthodox', sensitivity = 1, onCue = () => {}, onPunch = () => {}, minVis = 0.5, cal = null, aspect = 1, labels = null } = {}) {
    this.labels = labels; // punches you taught it (personal.js); used only from a similar camera spot
    this.sig = null; // this camera spot: { tilt, side, ratio }, settles over the first second or so
    this.sigN = 0;
    this.aspect = aspect; // video width / height, for measuring angles in the picture
    this.cal = cal; // per-boxer punch calibration, see calibrateFromCombo
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
    this.up = { x: 0, y: -1, z: 0 }; // body up (pose y points down), learned from hips over feet
    this.upN = 0;
    this.frame = bodyFrame(this.up);
    this.headTrail = [];
    this.torsoHist = [];
    this.headHist = [];
    this.headOut = false;
    this.lastHeadMove = -Infinity;
    this.since = {};
    this.lastCue = {};
    this.lastAnyCue = -Infinity;
    this.lastSeen = null;
    this.events = []; // detections with confidence, used for video review
    this.recent = []; // recent punch measurements, for learning which way is forward
    this.pending = []; // punches held for PAIR_MS in case the other hand fires at the same moment
    this.learnedAxis = null;
    this.roundNo = 0;
    // Raw measurements behind each punch decision, for tuning thresholds to a real boxer.
    this.calib = { vTh: Math.round(this.vTh * 100) / 100, punches: [], pt: [], pe: [], rejected: [], nearMiss: [], motion: [], track: [], frames: 0, tracked: 0 };
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
    this.round.expectLeft = this.stance !== 'southpaw';
    this.active = true;
    this.since = {};
  }

  endRound() {
    this._flushPunches(Infinity);
    this.active = false;
    // Camera tilt against the body's up, in degrees (a phone on the floor tilted up reads high).
    // Tilt only when it could be measured (feet in view); null otherwise, not a misleading 0.
    this.calib.tilt = this.upN ? Math.round((Math.acos(Math.min(1, -this.up.y)) * 180) / Math.PI) : null;
    if (this.calib.frames) this.calib.feetPct = Math.round((100 * (this.feetSeen || 0)) / this.calib.frames);
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
    this.now = t;
    if (!world || !image) {
      if (this.active && this.held('nobody', true, t) > 3000) this.cue('visibility', 'Step back, I need to see you', t);
      return null;
    }
    const visible = REQUIRED.every((i) => (image[i]?.visibility ?? 1) > this.minVis);
    if (this.active) {
      this.calib.frames++;
      if (visible) this.calib.tracked++;
    }
    if (!visible) {
      if (this.active && this.held('nobody', true, t) > 3000) this.cue('visibility', 'Step back, I need to see you', t);
      return null;
    }
    this.held('nobody', false, t);
    const fixed = unswapArms(world, image, this.armPrev && t - this.armPrev.t < 300 ? this.armPrev : null);
    world = fixed.world;
    image = fixed.image;
    this.armPrev = { ...fixed.prev, t };
    if (fixed.swapped && this.active) this.calib.swaps = (this.calib.swaps || 0) + 1;
    // Up = feet → hips, averaged over time (hips sit over the feet in any stance).
    const feet = (image[LM.L_ANK]?.visibility ?? 1) > 0.5 && (image[LM.R_ANK]?.visibility ?? 1) > 0.5;
    if (this.active && feet) this.feetSeen = (this.feetSeen || 0) + 1;
    // Feet out of shot: stance, footwork and the tilt correction all need them.
    if (this.active && this.held('noFeet', !feet, t) > 5000) this.cue('feet', 'Step back, show your feet', t);
    if (feet) {
      const v = norm3({
        x: (world[LM.L_HIP].x + world[LM.R_HIP].x - world[LM.L_ANK].x - world[LM.R_ANK].x) / 2,
        y: (world[LM.L_HIP].y + world[LM.R_HIP].y - world[LM.L_ANK].y - world[LM.R_ANK].y) / 2,
        z: (world[LM.L_HIP].z + world[LM.R_HIP].z - world[LM.L_ANK].z - world[LM.R_ANK].z) / 2,
      });
      // Only believable directions (within 60° of the camera's up); fast at first, then steady.
      if (v.y < -0.5) {
        const k = Math.max(0.02, 1 / ++this.upN);
        this.up = norm3({ x: this.up.x * (1 - k) + v.x * k, y: this.up.y * (1 - k) + v.y * k, z: this.up.z * (1 - k) + v.z * k });
        this.frame = bodyFrame(this.up);
      }
    }
    const r = this.round;
    const nose = world[LM.NOSE];

    // --- Punch tracking per hand -------------------------------------------
    this.image = image;
    const f = facing(world);
    if (f) this.face = this.face ? norm2({ x: this.face.x * 0.7 + f.x * 0.3, z: this.face.z * 0.7 + f.z * 0.3 }) : f;
    this._trackSetup(image);
    for (const role of ['lead', 'rear']) this._trackHand(role, world, nose, t);
    this._flushPunches(t);

    if (!this.active) return this.snapshot(world, image);
    r.frames++;

    // --- Guard ---------------------------------------------------------------
    let bothUp = true, eligible = true;
    for (const role of ['lead', 'rear']) {
      const h = this.hands[role];
      const recovering = h.returnSince != null && t - h.returnSince < 700;
      if (h.state !== 'idle' || recovering) { eligible = false; continue; }
      if ((image[h.wr]?.visibility ?? 1) < this.minVis) continue; // hidden hand: don't judge it
      if (this._below(world, world[h.wr]) > 0.06) bothUp = false;
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
    // Side-on (face pointing across the picture), depth-based widths are unreliable.
    const sideOn = this.face ? Math.abs(this.face.x) > 0.7 : false;
    if (sideOn) r.sideFrames++;
    const anklesVisible = (image[LM.L_ANK]?.visibility ?? 1) > 0.5 && (image[LM.R_ANK]?.visibility ?? 1) > 0.5;
    if (anklesVisible) {
      r.footFrames++;
      const crossed = feetCrossed(world);
      if (crossed) r.crossed++;
      const crossedFor = this.held('crossed', crossed, t);
      if (crossedFor > 400) {
        if (!this.crossEventOpen) {
          this.crossEventOpen = true;
          this.event('crossedFeet', this.since.crossed, 100 * this._vis([LM.L_ANK, LM.R_ANK]));
        }
        this.cue('crossed', "Don't cross your feet", t);
      } else if (!crossedFor) this.crossEventOpen = false;
      if (!sideOn) {
        r.stanceFrames++;
        const ratio = stanceRatio(world);
        const narrow = !crossed && ratio < STANCE_MIN;
        const wide = ratio > STANCE_MAX;
        if (narrow) r.narrow++;
        if (wide) r.wide++;
        if (!crossed && !narrow && !wide) r.stanceOk++;
        // Only say it once the depth has shown it can be trusted (it gets your lead foot right).
        const sure = (r.depthFrames || 0) >= 60 && depthTrusted(r);
        if (this.held('narrow', narrow, t) > 1500 && sure) this.cue('narrow', 'Wider stance', t);
        if (this.held('wide', wide, t) > 1500 && sure) this.cue('wide', 'Narrower stance', t);
      }
    }

    // --- Blade (not squared up) ---------------------------------------------
    const bladed = sideOn || bladeAngle(world) >= BLADE_MIN_DEG;
    if (!sideOn) {
      r.bladeFrames++;
      if (bladed) r.bladeOk++;
    }
    const lead = leadSide(world, this.learnedAxis);
    if (lead) {
      r.depthFrames++;
      if (lead === 'L') r.leftCloser++;
    }
    if (this.held('squared', !bladed, t) > 6000 && (r.depthFrames || 0) >= 60 && depthTrusted(r)) this.cue('squared', 'Turn your shoulder', t);


    // --- Footwork and head movement, measured in the picture ------------------------------
    // Scale: your typical torso length over the last few seconds, not this frame's (bending
    // into a roll makes the torso look shorter, which made every roll read as a big step).
    const A = this.aspect || 1;
    const I = (k) => ({ x: image[k].x * A, y: image[k].y });
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const shM = mid(I(LM.L_SH), I(LM.R_SH)), hipM = mid(I(LM.L_HIP), I(LM.R_HIP));
    const torsoNow = Math.hypot(shM.x - hipM.x, shM.y - hipM.y) || 1;
    this.torsoHist.push({ v: torsoNow, t });
    while (this.torsoHist.length && t - this.torsoHist[0].t > 3000) this.torsoHist.shift();
    const torso = median(this.torsoHist.map((q) => q.v)) || torsoNow;

    // Footwork: the hips travelling sideways in the picture (rolls move them up and down).
    const hipRange = this._trailRange(this.hipTrail, { x: hipM.x, y: 0, t }, 1500) / torso; // distance moved, in torsos
    const moving = hipRange > 0.4;
    if (moving) r.moving++;
    if (this.held('static', !moving, t) > 7000) this.cue('static', 'Move your feet', t);

    // Head movement: distinct moves of the head away from where it usually sits over the hips
    // (slips, rolls, pull-backs, level changes). Checked against a pad round with known rolls:
    // 20 detected vs ~22 thrown in 47 s. "head" = share of time with a move in the last 2 s.
    const n = I(LM.NOSE);
    const rel = { x: (n.x - hipM.x) / torso, y: (n.y - hipM.y) / torso, t };
    this.headHist.push(rel);
    while (this.headHist.length && t - this.headHist[0].t > 2000) this.headHist.shift();
    const hist = this.headHist.slice(0, -1);
    const headOff = hist.length >= 5 ? Math.hypot(rel.x - median(hist.map((q) => q.x)), rel.y - median(hist.map((q) => q.y))) : 0;
    if (!this.headOut && headOff > 0.4 && t - this.lastHeadMove > 500) {
      this.headOut = true;
      this.lastHeadMove = t;
      r.headMoves++;
    } else if (this.headOut && headOff < 0.2) this.headOut = false;
    const headMoving = t - this.lastHeadMove < 2000;
    if (headMoving) r.headMoving++;
    if (r.t0 == null) r.t0 = t;
    r.t1 = t;
    if (this.held('headStill', !headMoving, t) > 9000) this.cue('head', 'Move your head', t);
    // Compact per-frame track (time in 0.1 s, nose relative to hips, hips in the picture; typical
    // torso lengths) so head-movement and footwork thresholds can be tuned against known drills.
    if (this.calib.track.length < 750) {
      this.calib.track.push([Math.round(t / 100), r2(rel.x), r2(rel.y), r2(hipM.x / torso), r2(hipM.y / torso)]);
    }
    if (r.frames % 15 === 0 && this.calib.motion.length < 300) this.calib.motion.push([r2(headOff), r2(hipRange), sideOn ? 1 : 0]); // for tuning from reports

    return this.snapshot(world, image);
  }

  // How far a point sits below shoulder height, measured along the body's up (metres).
  _below(world, p) {
    const sy = { x: (world[LM.L_SH].x + world[LM.R_SH].x) / 2, y: (world[LM.L_SH].y + world[LM.R_SH].y) / 2, z: (world[LM.L_SH].z + world[LM.R_SH].z) / 2 };
    return -dot3({ x: p.x - sy.x, y: p.y - sy.y, z: p.z - sy.z }, this.up);
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
    // Speed over at least ~30 ms, not frame to frame: at 60 fps the tracker's normal
    // centimetre wobble divided by 16 ms looks like a fast hand and started fake punches.
    h.trail = (h.trail || []).filter((p) => t - p.t <= 150);
    const ref = h.trail.findLast((p) => t - p.t >= SPEED_WINDOW_MS) || h.trail[0]; // newest sample old enough
    if (ref) {
      const inst = dist3(w, ref) / (Math.max(1, t - ref.t) / 1000);
      h.speed = h.speed * 0.4 + inst * 0.6;
    }
    h.trail.push({ t, x: w.x, y: w.y, z: w.z });
    const away = noseD > h.prevNoseD;
    const handSeen = (this.image?.[h.wr]?.visibility ?? 1) >= this.minVis * 0.7;

    if (h.state === 'idle') {
      // Near-misses: fast hand movements that stayed under the punch threshold.
      if (h.speed > this.vTh * 0.6 && h.speed <= this.vTh && away) h.nearPeak = Math.max(h.nearPeak || 0, h.speed);
      else if (h.nearPeak && h.speed < this.vTh * 0.4) {
        this._calibPush('nearMiss', [role === 'lead' ? 'L' : 'R', r2(h.nearPeak)]);
        h.nearPeak = 0;
      }
      // The same hand can't throw again until it has come back towards you (or paused): a hook or
      // uppercut that swings on after the "end" was being counted twice.
      const extNow = dist3(sh, w) / (h.armLen || 1);
      if (!h.rechambered && (extNow < h.rechamberExt || t - h.lastEnd > REARM_MS)) h.rechambered = true;
      if (h.speed > this.vTh && away && handSeen && t - h.lastEnd > 180 && h.rechambered === false) {
        if (!h.againLogged) this._calibPush('rejected', [role === 'lead' ? 'L' : 'R', r2(h.speed), r2(extNow), 0, 0, 'again']);
        h.againLogged = true;
      } else if (h.speed > this.vTh && away && handSeen && t - h.lastEnd > 180) {
        h.nearPeak = 0;
        h.state = 'punch';
        h.start = h.prev || w;
        h.startT = t;
        h.peakExt = 0; h.peakAngle = 0; h.maxNoseD = noseD; h.maxRise = 0; h.minRise = 0; h.maxLift = 0; h.prevRise = 0; h.maxLat = 0; h.maxFwd = 0; h.peakSpeed = 0;
        h.path = []; h.peakDisp = [0, 0]; h.i2 = null; h.i2start = h.prevW2 || null; // fist in the picture just before the punch
        h.rearDropped = false; h.rearSeen = false; h.peakT = t;
      }
    }
    if (h.state === 'punch') {
      h.peakSpeed = Math.max(h.peakSpeed, h.speed);
      const ext = dist3(sh, w) / (h.armLen || 1);
      const m = this.frame({ x: w.x - h.start.x, y: w.y - h.start.y, z: w.z - h.start.z });
      if (ext > h.peakExt) { h.peakDisp = m.h; h.peakT = t; }
      h.peakExt = Math.max(h.peakExt, ext);
      h.peakAngle = Math.max(h.peakAngle, angleDeg(sh, el, w));
      h.maxNoseD = Math.max(h.maxNoseD, noseD);
      h.maxRise = Math.max(h.maxRise, m.rise);
      // Uppercuts often dip first: the rise that matters is from the bottom of the dip.
      h.minRise = Math.min(h.minRise, m.rise);
      h.maxLift = Math.max(h.maxLift, m.rise - h.minRise);
      // Only with the elbow bent: a body jab dips too, then comes back up to the guard.
      const lifting = h.peakAngle < 140 && h.minRise < -0.05 && m.rise > h.prevRise + 0.01;
      h.prevRise = m.rise;
      // Forward vs sideways relative to where the boxer faces, so it works from any camera angle.
      h.path.push(m.h);
      if (this.image) {
        const a = arm2d(this.image, h.sh, h.el, h.wr, this.aspect || 1);
        if (!h.i2start) h.i2start = a.W;
        // Keep the frame where the arm reaches furthest in the picture.
        if (!h.i2 || a.ext > h.i2.ext) h.i2 = { ...a, dx: (a.W.x - h.i2start.x) / a.torso, dy: (a.W.y - h.i2start.y) / a.torso };
        h.i2.maxAngle = Math.max(h.i2.maxAngle || 0, a.angle);
      }
      // Rear hand during a jab: only judged when the camera can actually see it (side-on, it's
      // often hidden behind the body and its estimated position is a guess).
      const rearSeen = (this.image?.[this.hands.rear.wr]?.visibility ?? 1) >= this.minVis;
      if (rearSeen) h.rearSeen = true;
      if (role === 'lead' && this.active && !h.rearDropped && rearSeen) {
        const rear = world[this.hands.rear.wr];
        if (this._below(world, rear) > 0.1) h.rearDropped = true;
      }
      // The fist coming up from a dip towards the chin isn't the punch pulling back.
      const retracting = noseD < h.maxNoseD - 0.04 && !lifting;
      const slowed = h.speed < this.vTh * 0.5;
      if (retracting || slowed || t - h.startT > 700) {
        h.state = 'idle';
        h.lastEnd = t;
        h.endWhy = retracting ? 'r' : slowed ? 's' : 't';
        h.rechambered = false;
        h.againLogged = false;
        h.rechamberExt = h.peakExt - 0.2; // pulled back a fifth of an arm
        const travel = h.maxNoseD - dist3(h.start, nose);
        // Short, fast punches count too (on pads the mitt meets the punch early); impossible
        // speeds are tracking glitches.
        // Over 6.5 m/s is usually a tracking glitch, but a fast, fully extended straight is real:
        // a sharp jab measured over 30 ms reaches 7-10 m/s (these were being thrown away).
        // Hard punches too: a punch test from the floor (30 fps) threw away ~10 real crosses and
        // uppercuts at 8-12 m/s that reached 85%+ of the arm and travelled 15+ cm. A tracking glitch
        // jumps without the arm opening up and travelling like that.
        // A locked elbow (160°+) is a straight even when depth makes the reach look short (chest-height
        // test: a hard cross at 175° read as 69% reach and was thrown away).
        const fastStraight = h.peakSpeed < 14 && ((h.peakExt >= 0.85 && h.peakAngle >= 120) || h.peakAngle >= 160) && travel >= 0.15;
        // A fist that never got half an arm's length from the shoulder (elbow folded past ~60°) is
        // the guard moving, not a punch: none of 120 labelled punches reached less than 0.54.
        const real = h.peakExt >= 0.5 && (h.peakSpeed < 6.5 || fastStraight) && (travel > 0.1 || h.peakExt > 0.85 || (h.peakSpeed > 2 && h.peakExt > 0.65));
        if (real) this._queuePunch(role, h, t);
        else this._calibPush('rejected', [role === 'lead' ? 'L' : 'R', r2(h.peakSpeed), r2(h.peakExt), Math.round(h.peakAngle), r2(travel)]);
      }
    }
    // Hand return: back in guard near the face.
    if (h.returnSince != null && h.state === 'idle') {
      const done = this._below(world, w) <= 0.06 && noseD < 0.38 ? t - h.returnSince : t - h.returnSince > 1500 ? 1500 : null;
      if (done != null) {
        if (this.active) {
          this.round.returnTimes.push(done);
          this.round[role === 'lead' ? 'returnLead' : 'returnRear'].push(done);
        }
        h.returnSince = null;
      }
    }
    h.prev = { x: w.x, y: w.y, z: w.z };
    h.prevW2 = this.image ? { x: this.image[h.wr].x * (this.aspect || 1), y: this.image[h.wr].y } : null;
    h.prevT = t;
    h.prevNoseD = noseD;
  }

  // Forward axis: learned from recent punches once there are enough, else the face direction.
  axis() {
    return this.learnedAxis || this.face || { x: 0, z: -1 };
  }

  // Hold a punch briefly: if the other hand reached full stretch at the same moment, only the
  // cleaner of the two is a punch (the other was moved by the body turning).
  _queuePunch(role, h, t) {
    const c = {
      role, t, peakT: h.peakT ?? t, vis: this._vis([h.sh, h.el, h.wr]),
      peakAngle: h.peakAngle, peakExt: h.peakExt, maxRise: h.peakAngle < 140 ? Math.max(h.maxRise, h.maxLift) : h.maxRise, path: h.path, peakDisp: h.peakDisp,
      peakSpeed: h.peakSpeed, i2: h.i2, rearSeen: h.rearSeen, rearDropped: h.rearDropped,
      dur: t - h.startT, why: h.endWhy,
    };
    h.returnSince = c.peakT; // hand return is timed from impact (full extension)
    const twin = this.pending.find((p) => {
      if (p.role === role) return false;
      const dt = Math.abs(p.peakT - c.peakT);
      return dt <= PAIR_MS || (dt <= JOLT_MS && ((locked(p) && bent(c)) || (locked(c) && bent(p))));
    });
    if (twin) {
      const score = (p) => p.peakExt + p.peakAngle / 400 + (p.i2?.ext || 0) / 2;
      const [keep, drop] = score(c) > score(twin) ? [c, twin] : [twin, c];
      this.pending = this.pending.filter((p) => p !== drop);
      if (drop === twin) this.pending.push(keep);
      this.hands[drop.role].returnSince = null;
      this._calibPush('rejected', [drop.role === 'lead' ? 'L' : 'R', r2(drop.peakSpeed), r2(drop.peakExt), Math.round(drop.peakAngle), 0, 'pair']);
      return;
    }
    this.pending.push(c);
  }

  _flushPunches(now) {
    if (!this.pending.length) return;
    this.pending = this.pending.filter((c) => {
      const other = this.hands[c.role === 'lead' ? 'rear' : 'lead'];
      // Wait while the other hand is mid-punch and could still peak alongside this one.
      const wait = now - c.peakT <= JOLT_MS || (other.state === 'punch' && other.startT <= c.peakT + JOLT_MS);
      if (wait && now !== Infinity) return true;
      this._registerPunch(c.role, c, c.t);
      return false;
    });
  }

  _registerPunch(role, h, t) {
    const feats = { angle: h.peakAngle, ext: h.peakExt, rise: h.maxRise, path: h.path };
    const axis = this.axis();
    const base = classifyPunch({ ...feats, role }, axis, this.cal);
    let { kind, margin } = base;
    const { fwd, lat } = base;
    const face = this.face ? [this.face.x, this.face.z] : null;
    const i2 = h.i2 ? { ext: h.i2.ext, angle: h.i2.maxAngle, dx: h.i2.dx, dy: h.i2.dy, fore: h.i2.fore } : null;
    const reader = this._reader();
    if (reader) {
      const p = reader.predict(personalExample({ f: feats, fwd, lat, i2, face, setup: this.sig }, null));
      if (p.kind === 'none' && p.share >= 0.7) { // you've taught it this movement isn't a punch
        this.hands[role].returnSince = null;
        this._calibPush('rejected', [role === 'lead' ? 'L' : 'R', r2(h.peakSpeed), r2(h.peakExt), Math.round(h.peakAngle), 0, 'you']);
        return;
      }
      if (p.kind !== 'none') { kind = p.kind; margin = p.share; }
    }
    this.recent.push({ ...feats, disp: h.peakDisp });
    if (this.recent.length > 24) this.recent.shift();
    this.learnedAxis = refineAxis(this.recent, this.cal); // also used for which foot leads
    const vis = h.vis;
    // Visibility counts for half: side-on the far arm is partly hidden even on clean punches.
    const conf = PUNCH_CONF(vis, h.peakSpeed, this.vTh, margin);
    const type = PUNCH_TYPE[kind][role];
    if (!this.active) return;
    this.round.punches[type]++;
    this.round.punchLog.push({ t, type });
    const r3 = (x) => Math.round(x * 1000) / 1000;
    this.event('punch', t, conf, {
      type, role, vis, speed: h.peakSpeed, fwd, lat, baseKind: base.kind, setup: this.sig ? { ...this.sig } : null,
      f: { angle: h.peakAngle, ext: h.peakExt, rise: h.maxRise, path: h.path.map(([a, b]) => [r3(a), r3(b)]), disp: h.peakDisp.map(r3) },
      i2: h.i2 ? { ext: r3(h.i2.ext), angle: Math.round(h.i2.maxAngle), fore: r3(h.i2.fore), elbUp: r3(h.i2.elbUp), dx: r3(h.i2.dx), dy: r3(h.i2.dy), vis: r3(h.i2.vis) } : null,
      face: face ? face.map(r3) : null,
    });
    // When each punch landed (0.1 s) and how long it took / why it ended, to line up with what you threw.
    this._calibPush('pt', Math.round(t / 100));
    this._calibPush('pe', `${Math.round((h.dur || 0) / 10)}${h.why || ''}`);
    this._calibPush('punches', [PUNCH_DIGIT[type], r2(h.peakSpeed), r2(h.peakExt), Math.round(h.peakAngle), r2(h.maxRise), r2(lat), Math.round(conf), r2(fwd)]);
    if (role === 'lead') {
      if (h.rearSeen) this.round.leadPunches++;
      if (h.rearDropped) this.round.rearDrops++;
      // Only a habit is worth saying: 3 of the last 5 jabs, not one misread.
      this.rearDropHist = [...(this.rearDropHist || []), h.rearDropped].slice(-5);
      if (this.rearDropHist.filter(Boolean).length >= 3) this.cue('rearDrop', `${this.rearName[0].toUpperCase()}${this.rearName.slice(1)} hand home`, t);
    }
    this.onPunch(type, { t, conf });
  }

  // After a whole video: re-read every punch against the forward axis learned from the punches
  // around it (both directions in time), so early punches get the same treatment as later ones.
  // Updates event types and confidences and the calibration rows; returns how many changed.
  reclassify(window = 12) {
    const punches = this.events.filter((e) => e.kind === 'punch' && e.f);
    let changed = 0, faceDev = [];
    punches.forEach((e, i) => {
      // A drilled combo pins the axis from punches known to be straights (see calibrate.js).
      const axis = e.axisFixed || refineAxis(punches.slice(Math.max(0, i - window), i + window + 1).map((x) => x.f), this.cal);
      if (!axis) return;
      if (e.face) faceDev.push((Math.acos(Math.max(-1, Math.min(1, e.face[0] * axis.x + e.face[1] * axis.z))) * 180) / Math.PI);
      const c = classifyPunch({ ...e.f, role: e.role }, axis, this.cal);
      e.axis = axis;
      e.fwd = c.fwd;
      e.lat = c.lat;
      e.baseKind = c.kind;
      let { kind, margin } = c;
      const reader = this._reader();
      if (reader) {
        const p = reader.predict(personalExample({ ...e, setup: e.setup || this.sig }, null));
        if (p.kind === 'none' && p.share >= 0.7) { e.notPunch = true; margin = 0; } // starts unticked in review
        else if (p.kind !== 'none') { kind = p.kind; margin = p.share; }
      }
      const type = PUNCH_TYPE[kind][e.role];
      if (type !== e.type) changed++;
      e.type = type;
      e.conf = Math.round(PUNCH_CONF(e.vis, e.speed, this.vTh, margin));
      if (e.notPunch) e.conf = Math.min(e.conf, 30);
    });
    // Keep calibration rows in step with the final decisions.
    this.calib.punches = punches.slice(0, 300).map((e) => [PUNCH_DIGIT[e.type], r2(e.speed), r2(e.f.ext), Math.round(e.f.angle), r2(e.f.rise), r2(e.lat ?? 0), e.conf, r2(e.fwd ?? 0)]);
    // Raw ground-plane vectors (camera frame) so the axis maths can be checked from a report.
    this.calib.vec = punches.slice(0, 100).map((e) => [e.role === 'lead' ? 'L' : 'R', ...e.f.disp.map(r2), ...(e.face || [0, 0]).map(r2), ...e.f.path.flat().map(r2)]);
    // 2D arm measurements per punch: [hand, stretch, elbow angle, forearm/upper arm, elbow height, fist dx, fist dy, visibility].
    this.calib.vec2 = punches.slice(0, 200).map((e) => (e.i2 ? [e.role === 'lead' ? 'L' : 'R', r2(e.i2.ext), e.i2.angle, r2(e.i2.fore), r2(e.i2.elbUp), r2(e.i2.dx), r2(e.i2.dy), r2(e.i2.vis)] : [e.role === 'lead' ? 'L' : 'R']));
    faceDev.sort((a, b) => a - b);
    // Punch times (0.1 s of video), to match against the saved frames.
    this.calib.pt = punches.slice(0, 300).map((e) => Math.round(e.t / 100));
    this.calib.faceDev = faceDev.length ? Math.round(faceDev[Math.floor(faceDev.length / 2)]) : null;
    this.calib.reclassified = changed;
    return changed;
  }

  // Where the camera is, from the picture: legs vs torso (phone height), facing, tilt. Smoothed.
  _trackSetup(image) {
    const v = (k) => image[k]?.visibility ?? 1;
    if (v(LM.L_ANK) < 0.5 || v(LM.R_ANK) < 0.5 || !this.face) return;
    const y = (k) => image[k].y;
    const hipY = (y(LM.L_HIP) + y(LM.R_HIP)) / 2, torso = hipY - (y(LM.L_SH) + y(LM.R_SH)) / 2;
    if (torso <= 0) return;
    const now = { ratio: ((y(LM.L_ANK) + y(LM.R_ANK)) / 2 - hipY) / torso, side: Math.abs(this.face.x) };
    const k = Math.max(0.03, 1 / ++this.sigN);
    const prev = this.sig || now;
    const r2_ = (x) => Math.round(x * 100) / 100;
    this.sig = {
      ratio: r2_(prev.ratio + (now.ratio - prev.ratio) * k),
      side: r2_(prev.side + (now.side - prev.side) * k),
      tilt: this.upN ? Math.round((Math.acos(Math.min(1, -this.up.y)) * 180) / Math.PI) : null,
    };
  }

  // The taught reader for this camera spot, once the spot is known (about a second of frames).
  _reader() {
    return this.labels && this.sigN >= 30 ? readerFor(this.labels, this.sig) : null;
  }

  _calibPush(list, row) {
    // Rejections and near misses carry their time (tenths of a second, like pt) so a punch test
    // report shows which of them happened while a punch was called.
    if (list === 'rejected' || list === 'nearMiss') row = [...row, Math.round((this.now || 0) / 100)];
    if (this.active && this.calib[list].length < 300) this.calib[list].push(row);
  }

  snapshot() {
    const m = roundMetrics(this.round);
    return m;
  }
}
