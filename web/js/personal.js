// Your own punches, labelled by you, teach the reader what they look like on your camera.
// Nearest neighbours over the measurements behind each punch: it copes with the camera being in a
// different place each session, because similar setups sit near each other.

export const KIND_OF = { jab: 'straight', cross: 'straight', leadHook: 'hook', rearHook: 'hook', leadUppercut: 'uppercut', rearUppercut: 'uppercut' };
const MAX = 800; // examples kept (newest)
const MIN = 20; // before it's worth trying
const K = 5;

const vec = (x) => [x.ext, x.angle / 180, x.rise, x.fwd, x.lat, x.e2, x.a2 / 180, x.dx, x.dy, Math.min(3, x.fore) / 3, x.side];

// One labelled punch from a detection event. kind: straight / hook / uppercut / none (not a punch).
export function example(e, kind) {
  const r = (v) => Math.round((v || 0) * 1000) / 1000;
  return {
    kind, base: e.baseKind || null,
    ext: r(e.f.ext), angle: Math.round(e.f.angle), rise: r(e.f.rise), fwd: r(e.fwd), lat: r(e.lat),
    e2: r(e.i2?.ext), a2: Math.round(e.i2?.angle || 0), dx: r(e.i2?.dx), dy: r(e.i2?.dy), fore: r(e.i2?.fore ?? 1),
    side: r(e.face ? Math.abs(e.face[0]) : 0.5),
  };
}

// Examples from a reviewed video: every punch you labelled, fixed, confirmed or unticked.
export function harvest(events) {
  return events.filter((e) => e.kind === 'punch' && e.f && (e.labelled || e.edited))
    .map((e) => example(e, e.keep ? KIND_OF[e.fix] : 'none'));
}

export const addExamples = (old = [], add = []) => [...old, ...add].slice(-MAX);

export function trainPersonal(examples) {
  const xs = (examples || []).filter((x) => x && x.kind);
  if (xs.length < MIN || new Set(xs.map((x) => x.kind)).size < 2) return null;
  const raw = xs.map(vec);
  const d = raw[0].length;
  const mean = Array.from({ length: d }, (_, j) => raw.reduce((a, v) => a + v[j], 0) / raw.length);
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(raw.reduce((a, v) => a + (v[j] - mean[j]) ** 2, 0) / raw.length) || 1);
  const pts = raw.map((v) => v.map((x, j) => (x - mean[j]) / sd[j]));
  const vote = (p, skip = -1) => {
    const near = pts.map((q, i) => [i === skip ? Infinity : q.reduce((a, x, j) => a + (x - p[j]) ** 2, 0), i]).sort((a, b) => a[0] - b[0]).slice(0, K);
    const tally = {};
    for (const [dist, i] of near) if (dist < Infinity) tally[xs[i].kind] = (tally[xs[i].kind] || 0) + 1 / (1 + Math.sqrt(dist));
    const total = Object.values(tally).reduce((a, b) => a + b, 0) || 1;
    const [kind, w] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    return { kind, share: w / total };
  };
  // Leave-one-out: how often it gets your own labels right without having seen that punch.
  let right = 0, baseRight = 0, baseN = 0;
  pts.forEach((p, i) => {
    if (vote(p, i).kind === xs[i].kind) right++;
    if (xs[i].base) { baseN++; if (xs[i].base === xs[i].kind) baseRight++; }
  });
  const acc = right / xs.length;
  // "Not a punch" labels the built-in reader never gets right, so compare over all labels.
  const baseAcc = baseN ? baseRight / xs.length : 0;
  return {
    n: xs.length, acc: Math.round(acc * 100) / 100, baseAcc: Math.round(baseAcc * 100) / 100,
    use: acc >= 0.6 && acc >= baseAcc + 0.05,
    predict: (x) => vote(vec(x).map((v, j) => (v - mean[j]) / sd[j])),
  };
}

// Trained once per set of labels.
let memo = { src: null, model: null };
export function personalFor(profile) {
  const src = profile?.punchLabels || null;
  if (memo.src !== src) memo = { src, model: src ? trainPersonal(src) : null };
  return memo.model;
}
