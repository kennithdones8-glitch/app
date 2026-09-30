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

// Head, shoulders and hips must be visible; each hand is checked on its own (filmed side-on,
// the far hand is often hidden without the rest of the body being lost).
const REQUIRED = [LM.NOSE, LM.L_SH, LM.R_SH, LM.L_HIP, LM.R_HIP];

// Stance width (ankle distance / shoulder width) considered good.
export const STANCE_MIN = 0.9;
export const STANCE_MAX = 2.2;
export const BLADE_MIN_DEG = 12;

const CUE_COOLDOWN_MS = 7000;
const GLOBAL_CUE_GAP_MS = 2500;

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
const PUNCH_TYPE = {
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

export function roundMetrics(r) {
  const total = Object.values(r.punches).reduce((a, b) => a + b, 0);
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const avgReturn = avg(r.returnTimes);
  const sequences = sequencesFrom(r.punchLog);
  return {
    frames: r.frames,
    guard: pct(r.guardUp, r.guardEligible),
    // Stance width and blade need depth, which is only usable when the camera sees you from the
    // front; side-on they're left unmeasured (null) rather than guessed.
    // A few front-on moments in a side-on clip aren't enough to judge: need 30% of the round.
    stance: frontEnough(r.stanceFrames, r) ? pct(r.stanceOk, r.stanceFrames) : null,
    crossedPct: pct(r.crossed, r.footFrames ?? r.stanceFrames),
    narrowPct: frontEnough(r.stanceFrames, r) ? pct(r.narrow, r.stanceFrames) : null,
    widePct: frontEnough(r.stanceFrames, r) ? pct(r.wide, r.stanceFrames) : null,
    blade: frontEnough(r.bladeFrames ?? r.frames, r) ? pct(r.bladeOk, r.bladeFrames ?? r.frames) : null,
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
  const T = cal?.ratio ?? DEFAULT_STRAIGHT_RATIO;
  const straightish = p.rise < 0.15 && p.ext >= 0.55 && fwd > 0.08 && fwd >= T * lat;
  if ((p.angle >= 145 && p.ext >= 0.8 && p.rise < 0.15) || straightish) {
    const byDir = straightish ? 0.5 + (fwd / Math.max(lat, 0.01) - T) / (2 * T) : 0;
    return { kind: 'straight', fwd, lat, margin: Math.min(1, Math.max((p.angle - 135) / 35, byDir)) };
  }
  if (p.rise > 0.12 && p.rise > lat && p.rise > fwd * 0.7) {
    return { kind: 'uppercut', fwd, lat, margin: Math.min(1, 0.4 + (p.rise - lat) / 0.15) };
  }
  return { kind: 'hook', fwd, lat, margin: Math.min(1, 0.4 + Math.max(0, 145 - p.angle) / 50, 0.3 + (T - fwd / Math.max(lat, 0.01)) / T) };
}

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

const PUNCH_CONF = (vis, speed, vTh, margin) => 100 * (0.5 + 0.5 * vis) * (0.55 + 0.45 * Math.min(1, speed / (vTh * 1.8))) * (0.6 + 0.4 * Math.max(0, margin));

export class FormAnalyzer {
  constructor({ stance = 'orthodox', sensitivity = 1, onCue = () => {}, onPunch = () => {}, minVis = 0.5, cal = null, aspect = 1 } = {}) {
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
    this.learnedAxis = null;
    this.roundNo = 0;
    // Raw measurements behind each punch decision, for tuning thresholds to a real boxer.
    this.calib = { vTh: Math.round(this.vTh * 100) / 100, punches: [], rejected: [], nearMiss: [], motion: [], track: [], frames: 0, tracked: 0 };
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
    const f = facing(world);
    if (f) this.face = this.face ? norm2({ x: this.face.x * 0.7 + f.x * 0.3, z: this.face.z * 0.7 + f.z * 0.3 }) : f;
    for (const role of ['lead', 'rear']) this._trackHand(role, world, nose, t);

    if (!this.active) return this.snapshot(world, image);
    r.frames++;

    // --- Guard ---------------------------------------------------------------
    let bothUp = true, eligible = true;
    for (const role of ['lead', 'rear']) {
      const h = this.hands[role];
      const recovering = h.returnSince != null && t - h.returnSince < 700;
      if (h.state !== 'idle' || recovering) { eligible = false; continue; }
      if ((image[h.wr]?.visibility ?? 1) < this.minVis) continue; // hidden hand: don't judge it
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
        if (this.held('narrow', narrow, t) > 1500) this.cue('narrow', 'Widen your stance', t);
        if (this.held('wide', wide, t) > 1500) this.cue('wide', 'Tighten up your stance', t);
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
    if (this.held('squared', !bladed, t) > 2500) this.cue('squared', 'Turn your lead shoulder, stay bladed', t);


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
    if (this.held('headStill', !headMoving, t) > 9000) this.cue('head', 'Move your head, slip after you punch', t);
    // Compact per-frame track (time in 0.1 s, nose relative to hips, hips in the picture; typical
    // torso lengths) so head-movement and footwork thresholds can be tuned against known drills.
    if (this.calib.track.length < 750) {
      this.calib.track.push([Math.round(t / 100), r2(rel.x), r2(rel.y), r2(hipM.x / torso), r2(hipM.y / torso)]);
    }
    if (r.frames % 15 === 0 && this.calib.motion.length < 300) this.calib.motion.push([r2(headOff), r2(hipRange), sideOn ? 1 : 0]); // for tuning from reports

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
    const handSeen = (this.image?.[h.wr]?.visibility ?? 1) >= this.minVis * 0.7;

    if (h.state === 'idle') {
      // Near-misses: fast hand movements that stayed under the punch threshold.
      if (h.speed > this.vTh * 0.6 && h.speed <= this.vTh && away) h.nearPeak = Math.max(h.nearPeak || 0, h.speed);
      else if (h.nearPeak && h.speed < this.vTh * 0.4) {
        this._calibPush('nearMiss', [role === 'lead' ? 'L' : 'R', r2(h.nearPeak)]);
        h.nearPeak = 0;
      }
      if (h.speed > this.vTh && away && handSeen && t - h.lastEnd > 180) {
        h.nearPeak = 0;
        h.state = 'punch';
        h.start = h.prev || w;
        h.startT = t;
        h.peakExt = 0; h.peakAngle = 0; h.maxNoseD = noseD; h.maxRise = 0; h.maxLat = 0; h.maxFwd = 0; h.peakSpeed = 0;
        h.path = []; h.peakDisp = [0, 0]; h.i2 = null; h.i2start = h.prevW2 || null; // fist in the picture just before the punch
        h.rearDropped = false; h.rearSeen = false; h.peakT = t;
      }
    }
    if (h.state === 'punch') {
      h.peakSpeed = Math.max(h.peakSpeed, h.speed);
      const ext = dist3(sh, w) / (h.armLen || 1);
      if (ext > h.peakExt) { h.peakDisp = [w.x - h.start.x, w.z - h.start.z]; h.peakT = t; }
      h.peakExt = Math.max(h.peakExt, ext);
      h.peakAngle = Math.max(h.peakAngle, angleDeg(sh, el, w));
      h.maxNoseD = Math.max(h.maxNoseD, noseD);
      h.maxRise = Math.max(h.maxRise, h.start.y - w.y);
      // Forward vs sideways relative to where the boxer faces, so it works from any camera angle.
      h.path.push([w.x - h.start.x, w.z - h.start.z]);
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
        if (rear.y > shMidY + 0.1) h.rearDropped = true;
      }
      const retracting = noseD < h.maxNoseD - 0.04;
      const slowed = h.speed < this.vTh * 0.5;
      if (retracting || slowed || t - h.startT > 700) {
        h.state = 'idle';
        h.lastEnd = t;
        const travel = h.maxNoseD - dist3(h.start, nose);
        // Short, fast punches count too (on pads the mitt meets the punch early); impossible
        // speeds are tracking glitches.
        const real = h.peakSpeed < 6.5 && (travel > 0.1 || h.peakExt > 0.85 || (h.peakSpeed > 2 && h.peakExt > 0.65));
        if (real) this._registerPunch(role, h, t);
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
    h.prevW2 = this.image ? { x: this.image[h.wr].x * (this.aspect || 1), y: this.image[h.wr].y } : null;
    h.prevT = t;
    h.prevNoseD = noseD;
  }

  // Forward axis: learned from recent punches once there are enough, else the face direction.
  axis() {
    return this.learnedAxis || this.face || { x: 0, z: -1 };
  }

  _registerPunch(role, h, t) {
    const feats = { angle: h.peakAngle, ext: h.peakExt, rise: h.maxRise, path: h.path };
    const axis = this.axis();
    const { kind, margin, fwd, lat } = classifyPunch(feats, axis, this.cal);
    this.recent.push({ ...feats, disp: h.peakDisp });
    if (this.recent.length > 24) this.recent.shift();
    this.learnedAxis = refineAxis(this.recent, this.cal); // also used for which foot leads
    const vis = this._vis([h.sh, h.el, h.wr]);
    // Visibility counts for half: side-on the far arm is partly hidden even on clean punches.
    const conf = PUNCH_CONF(vis, h.peakSpeed, this.vTh, margin);
    const type = PUNCH_TYPE[kind][role];
    h.returnSince = h.peakT ?? t; // hand return is timed from impact (full extension)
    if (!this.active) return;
    this.round.punches[type]++;
    this.round.punchLog.push({ t, type });
    const r3 = (x) => Math.round(x * 1000) / 1000;
    this.event('punch', t, conf, {
      type, role, vis, speed: h.peakSpeed,
      f: { angle: h.peakAngle, ext: h.peakExt, rise: h.maxRise, path: h.path.map(([a, b]) => [r3(a), r3(b)]), disp: h.peakDisp.map(r3) },
      i2: h.i2 ? { ext: r3(h.i2.ext), angle: Math.round(h.i2.maxAngle), fore: r3(h.i2.fore), elbUp: r3(h.i2.elbUp), dx: r3(h.i2.dx), dy: r3(h.i2.dy), vis: r3(h.i2.vis) } : null,
      face: this.face ? [r3(this.face.x), r3(this.face.z)] : null,
    });
    this._calibPush('punches', [PUNCH_DIGIT[type], r2(h.peakSpeed), r2(h.peakExt), Math.round(h.peakAngle), r2(h.maxRise), r2(lat), Math.round(conf), r2(fwd)]);
    if (role === 'lead') {
      if (h.rearSeen) this.round.leadPunches++;
      if (h.rearDropped) {
        this.round.rearDrops++;
        this.cue('rearDrop', `Keep your ${this.rearName} hand home when you jab`, t);
      }
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
      const c = classifyPunch(e.f, axis, this.cal);
      e.axis = axis;
      const type = PUNCH_TYPE[c.kind][e.role];
      if (type !== e.type) changed++;
      e.type = type;
      e.conf = Math.round(PUNCH_CONF(e.vis, e.speed, this.vTh, c.margin));
      e.fwd = c.fwd;
      e.lat = c.lat;
    });
    // Keep calibration rows in step with the final decisions.
    this.calib.punches = punches.slice(0, 300).map((e) => [PUNCH_DIGIT[e.type], r2(e.speed), r2(e.f.ext), Math.round(e.f.angle), r2(e.f.rise), r2(e.lat ?? 0), e.conf, r2(e.fwd ?? 0)]);
    // Raw ground-plane vectors (camera frame) so the axis maths can be checked from a report.
    this.calib.vec = punches.slice(0, 100).map((e) => [e.role === 'lead' ? 'L' : 'R', ...e.f.disp.map(r2), ...(e.face || [0, 0]).map(r2), ...e.f.path.flat().map(r2)]);
    // 2D arm measurements per punch: [hand, stretch, elbow angle, forearm/upper arm, elbow height, fist dx, fist dy, visibility].
    this.calib.vec2 = punches.slice(0, 200).map((e) => (e.i2 ? [e.role === 'lead' ? 'L' : 'R', r2(e.i2.ext), e.i2.angle, r2(e.i2.fore), r2(e.i2.elbUp), r2(e.i2.dx), r2(e.i2.dy), r2(e.i2.vis)] : [e.role === 'lead' ? 'L' : 'R']));
    faceDev.sort((a, b) => a - b);
    this.calib.faceDev = faceDev.length ? Math.round(faceDev[Math.floor(faceDev.length / 2)]) : null;
    this.calib.reclassified = changed;
    return changed;
  }

  _calibPush(list, row) {
    if (this.active && this.calib[list].length < 300) this.calib[list].push(row);
  }

  snapshot() {
    const m = roundMetrics(this.round);
    return m;
  }
}
