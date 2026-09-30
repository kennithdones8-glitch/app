// Optional "Check with Claude": after the on-phone analysis, cropped frames of the boxer are sent
// to Claude (Anthropic API, the boxer's own key), which confirms or corrects each detected punch
// and adds punches the body tracker missed. Nothing is sent unless a key is saved and the check
// is switched on for that video.

const KEY_STORE = 'boxcoach.claudeKey';
const MODEL_STORE = 'boxcoach.claudeModel';
export const AI_MODELS = { 'claude-sonnet-5-5': 'Standard (Sonnet)', 'claude-opus-5-5': 'Best (Opus, costs more)' };
const DEFAULT_MODEL = 'claude-sonnet-5-5';

// The key is kept apart from the app data so it never ends up in a backup or a report.
export function aiKey(storage = globalThis.localStorage) {
  try { return storage?.getItem(KEY_STORE) || ''; } catch { return ''; }
}
export function aiModel(storage = globalThis.localStorage) {
  try {
    const m = storage?.getItem(MODEL_STORE);
    return AI_MODELS[m] ? m : DEFAULT_MODEL;
  } catch { return DEFAULT_MODEL; }
}
export function setAi(key, model, storage = globalThis.localStorage) {
  try {
    if (key) storage.setItem(KEY_STORE, key.trim()); else storage.removeItem(KEY_STORE);
    if (model) storage.setItem(MODEL_STORE, model);
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Contact sheets: frames cropped to the boxer's upper body with room for a full punch either
// side, time-stamped, 4 × 5 to a sheet (about 2 s of video).

const COLS = 4, ROWS = 5, CW = 240, CH = 180;
export const SHEET_FRAMES = COLS * ROWS;
export const MAX_SHEETS = 200; // ~6 minutes of video

// Crop in picture pixels: head to hips tall, a full arm's reach either side of the shoulders.
export function cropBox(pts, W, H) {
  const P = (i) => ((pts[i]?.visibility ?? 1) > 0.3 ? { x: pts[i].x * W, y: pts[i].y * H } : null);
  const ls = P(11), rs = P(12), lh = P(23), rh = P(24), nose = P(0);
  if (!ls || !rs || !(lh || rh)) return null;
  const sh = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const hips = [lh, rh].filter(Boolean);
  const hip = { x: hips.reduce((a, p) => a + p.x, 0) / hips.length, y: hips.reduce((a, p) => a + p.y, 0) / hips.length };
  const torso = Math.max(Math.hypot(sh.x - hip.x, sh.y - hip.y), 20);
  const top = (nose ? Math.min(nose.y, sh.y - 0.45 * torso) : sh.y - 0.45 * torso) - 0.35 * torso;
  const bottom = hip.y + 0.35 * torso;
  const h = Math.max(bottom - top, ((3 * torso) * CH) / CW);
  return { cx: sh.x, cy: (top + bottom) / 2, h };
}

export class FrameSheets {
  constructor({ gap = 100 } = {}) {
    this.gap = gap; // ms between captured frames
    this.sheets = []; // { blob: Promise<Blob>, t0, t1 }
    this.canvas = null;
    this.n = 0;
    this.t0 = 0;
    this.lastT = -Infinity;
    this.box = null;
    this.full = false;
  }

  // frame: canvas of the video frame; pts: image landmarks of the boxer (or null); t in ms.
  add(frame, pts, t) {
    if (this.full || t - this.lastT < this.gap) return;
    const W = frame.videoWidth || frame.width, H = frame.videoHeight || frame.height;
    if (!W || !H) return;
    this.lastT = t;
    const b = pts ? cropBox(pts, W, H) : null;
    // Smooth the crop so the boxer doesn't jump around from frame to frame.
    if (b) this.box = this.box ? { cx: this.box.cx * 0.5 + b.cx * 0.5, cy: this.box.cy * 0.5 + b.cy * 0.5, h: this.box.h * 0.6 + b.h * 0.4 } : b;
    const box = this.box || { cx: W / 2, cy: H / 2, h: H };
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = COLS * CW;
      this.canvas.height = ROWS * CH;
      this.t0 = t;
    }
    const g = this.canvas.getContext('2d');
    const col = this.n % COLS, row = Math.floor(this.n / COLS);
    const w = (box.h * CW) / CH;
    g.fillStyle = '#000';
    g.fillRect(col * CW, row * CH, CW, CH);
    g.drawImage(frame, box.cx - w / 2, box.cy - box.h / 2, w, box.h, col * CW, row * CH, CW, CH);
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(col * CW, row * CH, 52, 20);
    g.fillStyle = '#fff';
    g.font = 'bold 15px sans-serif';
    g.fillText(`${(t / 1000).toFixed(1)}s`, col * CW + 4, row * CH + 15);
    g.strokeStyle = '#555';
    g.strokeRect(col * CW + 0.5, row * CH + 0.5, CW - 1, CH - 1);
    this.n++;
    this.t1 = t;
    if (this.n === SHEET_FRAMES) this.flush();
  }

  flush() {
    if (!this.canvas || !this.n) return;
    const c = this.canvas;
    this.sheets.push({ blob: new Promise((res) => c.toBlob(res, 'image/jpeg', 0.75)), t0: this.t0, t1: this.t1 });
    this.canvas = null;
    this.n = 0;
    if (this.sheets.length >= MAX_SHEETS) this.full = true;
  }
}

// ---------------------------------------------------------------------------
// Asking Claude.

const TOOL = {
  name: 'report_punches',
  description: 'Report what the boxer actually threw.',
  input_schema: {
    type: 'object',
    properties: {
      detected: {
        type: 'array',
        description: 'One entry per listed detection.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            verdict: { type: 'string', enum: ['punch', 'not_a_punch'] },
            hand: { type: 'string', enum: ['lead', 'rear'] },
            kind: { type: 'string', enum: ['straight', 'hook', 'uppercut'] },
            body: { type: 'boolean', description: 'Thrown to the body rather than the head.' },
            sure: { type: 'boolean' },
          },
          required: ['id', 'verdict'],
        },
      },
      missed: {
        type: 'array',
        description: 'Clear punches the list does not have.',
        items: {
          type: 'object',
          properties: {
            t: { type: 'number', description: 'Video time in seconds.' },
            hand: { type: 'string', enum: ['lead', 'rear'] },
            kind: { type: 'string', enum: ['straight', 'hook', 'uppercut'] },
            body: { type: 'boolean' },
            sure: { type: 'boolean' },
          },
          required: ['t', 'hand', 'kind'],
        },
      },
    },
    required: ['detected', 'missed'],
  },
};

const TYPE_OF = {
  lead: { straight: 'jab', hook: 'leadHook', uppercut: 'leadUppercut' },
  rear: { straight: 'cross', hook: 'rearHook', uppercut: 'rearUppercut' },
};
export const aiType = (hand, kind) => TYPE_OF[hand]?.[kind] || null;
const NAME = { jab: 'jab', cross: 'cross', leadHook: 'lead hook', rearHook: 'rear hook', leadUppercut: 'lead uppercut', rearUppercut: 'rear uppercut' };

export function promptText({ stance = 'orthodox', punches, drill = null, subject = 'me' }) {
  const lead = stance === 'southpaw' ? 'right' : 'left';
  const rear = stance === 'southpaw' ? 'left' : 'right';
  return [
    `These contact sheets come from a boxing video (${subject === 'pro' ? 'a professional boxer' : 'the user training'}), cropped around the boxer. Each small frame shows its video time in seconds at the top left; frames run left to right, then top to bottom, about 8 to 10 per second.`,
    `The boxer is ${stance}: lead hand = ${lead} hand, rear hand = ${rear} hand. When they face the camera, their ${lead} hand is on the ${lead === 'left' ? 'right' : 'left'} side of the picture.`,
    punches.length
      ? `A body-tracking model detected these punches (id: time, hand, its guess):\n${punches.map((p) => `#${p.id}: ${(p.t / 1000).toFixed(1)}s, ${p.role}, ${NAME[p.type] || p.type}`).join('\n')}`
      : 'The body-tracking model detected no punches in this part.',
    'For every listed detection, look at the frames around its time and say whether a punch was really thrown there, and if so which hand and what kind: straight (jab or cross), hook or uppercut, and whether to the body. A hand coming back, a guard adjustment, a roll or a slip is not_a_punch. The same punch detected twice: keep the first, not_a_punch the second.',
    'Then list clear punches the model missed, with their time. Straights come straight out from the shoulder with the elbow extending; hooks swing round with the elbow bent and out to the side; uppercuts drive upward with the elbow bent under the fist.',
    drill ? `The boxer says they repeated this combination (1 jab, 2 cross, 3 lead hook, 4 rear hook, 5 lead uppercut, 6 rear uppercut; b = body): ${drill}. Use it only as a hint and report what the frames show.` : '',
    'Mark sure=false when the frames do not show it clearly. Answer with the report_punches tool.',
  ].filter(Boolean).join('\n\n');
}

// Apply Claude's answer to one chunk. detected: [{ id, t, role, type }]. Returns
// { verdicts: { id: type | null }, added: [{ t, type, sure }] } (null = not a punch).
export function readAnswer(input, detected) {
  const ids = new Set(detected.map((p) => p.id));
  const verdicts = {};
  for (const d of input?.detected || []) {
    if (!ids.has(d.id)) continue;
    if (d.verdict === 'not_a_punch') verdicts[d.id] = null;
    else {
      const type = aiType(d.hand, d.kind);
      if (type) verdicts[d.id] = type;
    }
  }
  const added = [];
  for (const m of input?.missed || []) {
    const type = aiType(m.hand, m.kind);
    const t = Math.round(+m.t * 1000);
    if (!type || !Number.isFinite(t)) continue;
    // Already on the list (same hand, close in time) or already added: skip.
    const role = m.hand;
    const near = (x) => Math.abs(x.t - t) < 300;
    if (detected.some((p) => near(p) && p.role === role && verdicts[p.id] !== null)) continue;
    if (added.some((a) => near(a) && a.role === role)) continue;
    added.push({ t, type, role, sure: m.sure !== false });
  }
  return { verdicts, added };
}

async function b64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function ask({ key, model, content, signal }) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model, max_tokens: 4096, tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
          messages: [{ role: 'user', content }],
        }),
      });
    } catch (err) {
      if (signal?.aborted) throw new Error('cancelled');
      if (attempt < 1) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      throw new Error("Couldn't reach Claude. Check your connection and try again.");
    }
    if (res.ok) {
      const data = await res.json();
      const use = data.content?.find((c) => c.type === 'tool_use');
      if (!use) throw new Error('Claude did not return a punch report. Try again.');
      return { input: use.input, usage: data.usage };
    }
    const body = await res.json().catch(() => ({}));
    const msg = body?.error?.message || '';
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); continue; }
    if (res.status === 401) throw new Error('Claude rejected the API key. Check it in Coach → Settings.');
    if (res.status === 404) throw new Error('That Claude model is not available on your key. Pick the other one in Coach → Settings.');
    throw new Error(`Claude check failed (${res.status})${msg ? `: ${msg}` : ''}`);
  }
}

// sheets: from FrameSheets; punches: [{ id, t, role, type }] in video time (ms).
// Sends the sheets in chunks of up to 16 (about 30 s of video each) with that stretch's detections.
export async function checkWithClaude({ sheets, punches, stance, drill, subject, key = aiKey(), model = aiModel(), onProgress = () => {}, signal }) {
  if (!key) throw new Error('Add your Claude API key in Coach → Settings first.');
  const chunks = [];
  for (let i = 0; i < sheets.length; i += 16) chunks.push(sheets.slice(i, i + 16));
  const out = { verdicts: {}, added: [], usage: { input: 0, output: 0 }, model, sheets: sheets.length };
  for (let c = 0; c < chunks.length; c++) {
    const ch = chunks[c];
    const from = c ? ch[0].t0 : -Infinity;
    const to = c < chunks.length - 1 ? chunks[c + 1][0].t0 : Infinity;
    const mine = punches.filter((p) => p.t >= from && p.t < to);
    onProgress(c, chunks.length);
    const images = [];
    for (const s of ch) {
      const blob = await s.blob;
      if (blob) images.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await b64(blob) } });
    }
    const content = [...images, { type: 'text', text: promptText({ stance, punches: mine, drill, subject }) }];
    const { input, usage } = await ask({ key, model, content, signal });
    const r = readAnswer(input, mine);
    Object.assign(out.verdicts, r.verdicts);
    out.added.push(...r.added);
    out.usage.input += usage?.input_tokens || 0;
    out.usage.output += usage?.output_tokens || 0;
  }
  onProgress(chunks.length, chunks.length);
  return out;
}

// Claude's verdicts become the review's starting point; the boxer can still change anything.
export function applyAi(j, r) {
  const tally = { same: 0, retyped: 0, removed: 0, added: 0 };
  for (const e of j.events) {
    if (e.kind !== 'punch' || !(e.i in r.verdicts)) continue;
    const type = r.verdicts[e.i];
    if (type === null) {
      e.keep = false;
      e.ai = 'none';
      tally.removed++;
    } else {
      e.ai = type === e.type ? 'same' : 'fixed';
      tally[type === e.type ? 'same' : 'retyped']++;
      e.fix = type;
      e.keep = true;
      e.conf = Math.max(e.conf, 80);
    }
  }
  const roundMs = (j.roundSec || j.durMs / 1000) * 1000;
  for (const a of r.added) {
    j.events.push({
      kind: 'punch', t: a.t, conf: a.sure ? 80 : 60, round: Math.min(j.rounds.length, Math.floor(a.t / roundMs) + 1),
      type: a.type, fix: a.type, role: a.role, keep: true, ai: 'added', aiAdded: true, i: j.events.length,
    });
    tally.added++;
  }
  return tally;
}
